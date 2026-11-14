// Shellby's conversations seeing each other and handing one another work,
// wired up (chatlink.js has the rules and the wording).
//
//   tool(tab, name, args)   list_chats, read_chat, hand_off (crab-api.js)
//   decide(id, yes)         the user's answer on a hand-off card (ipc/progress.js)
//
// Only this project's conversations, worked out from where the asking one
// runs (the task board's projectOf). A hand-off puts a card in the sender's
// feed and waits for the user's yes, unless Settings says not to ask
// (config.handoffAsk). Routines and workflows can't hand off: nobody is
// watching their cards.
const { execFile } = require('child_process');
const path = require('path');
const { randomUUID } = require('crypto');
const chatlink = require('../chatlink');
const crabmcp = require('../crabmcp');
const helpers = require('../taskboard/helpers');
const { noHooks } = require('../changes');

const GIT_TIMEOUT_MS = 5000;
const samePath = (a, b) => { const f = p => path.resolve(p).toLowerCase(); return f(a) === f(b); };
const done = text => ({ text });
const oops = text => ({ text, isError: true });

/** -> { branch, commit, dirty } of a folder, or null when it isn't a repo. */
function gitState(cwd) {
  const run = args => new Promise(resolve => {
    execFile('git', ['-c', 'core.fsmonitor=false', ...noHooks(), '-C', cwd, ...args],
      { windowsHide: true, timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout) => resolve(err ? null : String(stdout || '')));
  });
  return Promise.all([
    run(['rev-parse', '--short', 'HEAD']),
    run(['symbolic-ref', '--quiet', '--short', 'HEAD']),
    run(['status', '--porcelain']),
  ]).then(([commit, branch, status]) => (commit ? {
    commit: commit.trim(),
    branch: (branch || '').trim(),
    dirty: (status || '').split('\n').filter(Boolean).length,
  } : null));
}

/** d: what main shares (main.js `shared`). */
function wireChatLink(d) {
  /** @type {Map<string, { tabId: string, resolve: (yes: boolean) => void }>} */
  const pending = new Map();

  const enabled = () => !!d.taskBoard?.enabled();
  const asks = () => d.config.get('handoffAsk') !== false;
  const where = tab => tab.worktree?.path || tab.session.cwd;

  /** The other open conversations in the same project as `tab`. */
  async function peers(tab) {
    const mine = (await d.taskBoard.projectOf(tab)).key;
    const out = [];
    for (const t of d.manager.tabs.values()) {
      if (t.id === tab.id) continue;
      if ((await d.taskBoard.projectOf(t)).key === mine) out.push(t);
    }
    return out;
  }

  async function tool(tab, name, args) {
    if (!enabled()) return oops('Conversations working together is off in Settings (Task board).');
    switch (name) {
      case 'list_chats': return listChats(tab);
      case 'read_chat': return readChat(tab, args);
      case 'hand_off': return handOff(tab, args);
      default: return oops(`Unknown tool: ${name}`);
    }
  }

  async function listChats(tab) {
    const list = (await peers(tab)).map(t => ({
      id: t.id, title: t.title, busy: !!t.session.busy, asking: t.session.pending?.size > 0,
      inTerminal: !!t.inTerminal, branch: t.worktree?.branch || '', activeAt: t.activeAt || 0,
    }));
    return done(chatlink.describeList(list, Date.now()));
  }

  async function readChat(tab, args) {
    const id = typeof args?.id === 'string' ? args.id : '';
    const peer = (await peers(tab)).find(t => t.id === id);
    if (!peer) return oops(`There's no conversation ${id.slice(0, 60)} open in this project. list_chats has the ids.`);
    const items = peer.saved ? d.manager.history.load(peer.id) : [];
    return done(chatlink.describeTranscript(items, { title: peer.title, turns: args.turns }));
  }

  /** A card in the sender's feed; resolves with the user's answer, or no after the timeout or when the tab closes. */
  function askUser(tab, card) {
    const id = randomUUID();
    d.manager.onItem(tab, { kind: 'chat-handoff', id, ...card });
    return new Promise(resolve => {
      const finish = yes => {
        clearTimeout(timer);
        d.manager.off('tabs', onTabs);
        pending.delete(id);
        resolve(yes);
      };
      const onTabs = () => { if (!d.manager.tabs.has(tab.id)) finish(false); };
      const timer = setTimeout(() => finish(false), chatlink.DECIDE_TIMEOUT_MS);
      d.manager.on('tabs', onTabs);
      pending.set(id, { tabId: tab.id, resolve: finish });
    });
  }

  function decide(id, yes) {
    const p = pending.get(id);
    if (!p) return { ok: false, error: 'That hand-off has already been answered or has timed out.' };
    p.resolve(!!yes);
    return { ok: true };
  }

  async function handOff(tab, args) {
    if (tab.routineId || tab.workflowRunId) return oops("A routine's or workflow's conversation can't hand off work: nobody is there to approve it. Use post_task.");
    const c = chatlink.checkHandOff(args);
    if (!c.ok) return oops(c.error);
    const isNew = c.to === chatlink.NEW;
    const target = isNew ? null : (await peers(tab)).find(t => t.id === c.to);
    if (!isNew && !target) return oops(`There's no conversation ${c.to.slice(0, 60)} open in this project. list_chats has the ids.`);
    // Nobody watches a routine's or workflow's conversation, so nothing is slipped into one.
    if (target && (target.routineId || target.workflowRunId)) return oops(`"${target.title || 'That conversation'}" is a routine's or workflow's run: it can't take a hand-off. Use to: "new".`);
    const targetId = target ? target.id : null;
    const git = await gitState(where(tab));
    const toTitle = target ? target.title || 'Untitled' : c.title;
    // A chat that may do more without asking than this one is never handed work unseen, whatever Settings says.
    const elevated = !!target && chatlink.escalates(tab.session.mode, target.session.mode);
    const approved = asks() || elevated;
    if (approved) {
      const yes = await askUser(tab, { to: targetId, toTitle, elevatedMode: elevated ? chatlink.modeName(target.session.mode) : null, isNew, brief: c.brief, dirty: git?.dirty || 0 });
      if (!yes) return oops('The user said no to this hand-off, or didn\'t answer. Carry on yourself, or ask them.');
    }
    const fromTitle = tab.title || 'another conversation';
    if (!targetId) return startNew(tab, c, git, fromTitle, approved);
    // Checked again now: it may have started on something while the card was up.
    const now = d.manager.tabs.get(targetId);
    if (!now) return oops(`"${toTitle}" has closed.`);
    if (now.session.busy || now.inTerminal) return oops(`"${toTitle}" is busy now. Try again when it's idle, or use to: "new".`);
    const sameCopy = samePath(where(now), where(tab));
    const prompt = chatlink.briefPrompt({ fromTitle, brief: c.brief, approved, note: chatlink.worktreeNote(git, { sameCopy }) });
    try {
      d.manager.send(now.id, prompt, { kind: 'user', text: prompt });
    } catch (err) {
      return oops(`Couldn't send it: ${err.message}`);
    }
    return done(chatlink.sentReply({ toTitle, isNew: false, dirty: sameCopy ? 0 : git?.dirty || 0 }));
  }

  async function startNew(tab, c, git, fromTitle, approved) {
    const project = await d.taskBoard.projectOf(tab);
    const mode = helpers.helperMode(tab.session.mode);
    const make = note => chatlink.briefPrompt({ fromTitle, brief: c.brief, approved, note });
    let r = await d.startTaskInCopy(project.root, c.title, () => make(chatlink.worktreeNote(git)), { mode });
    if (!r.ok && r.notRepo) r = d.startTask(make(''), c.title, { mode, cwd: project.root });
    if (!r.ok) return oops(`Couldn't start a new conversation: ${r.error || 'it failed to start'}.`);
    return done(chatlink.sentReply({ toTitle: c.title, isNew: true, branch: r.worktree?.branch || '', dirty: git?.dirty || 0 }));
  }

  const isChatTool = name => crabmcp.CHAT_TOOL_NAMES.includes(name);

  return { chatLink: { tool, decide, isChatTool } };
}

module.exports = { wireChatLink, gitState };
