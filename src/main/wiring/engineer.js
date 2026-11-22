// Engineer mode's conversation side (engineer.js has the tools, engineer-gate.js
// the gate, engineer-prompts.js the words, docs/ENGINEER.md the why).
//
// The chip turns it on for one conversation, kept in History; a project can
// have it on for every new conversation. While it's on: every message carries
// a line telling Claude to decide before it builds; `decide` puts the decision
// on a card; the work hook holds changes back until you approve one, then
// holds file edits to its scope; `amend_decision` asks to widen it; `spike`
// asks to try something first, and Shellby puts the spike's files back after;
// `check_decision` puts how it went on the same card, and Shellby checks that
// itself once the turn ends: which files the work really changed, and the
// test plan's commands, run by Shellby. Every message to Claude about a
// decision goes from a button you pressed, into a conversation that isn't
// working (debug mode's way). Kept out of main.js, which only wires it up.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const eng = require('../engineer');
const gate = require('../engineer-gate');
const words = require('../engineer-prompts');
const changes = require('../changes');
const checks = require('../checks');
const worktrees = require('../worktrees');
const { onClaude } = require('../sessions');

const NEEDS_SELF_AWARE = "Engineer mode needs Claude to know it's in Shellby: turn on Settings, Claude, Tell Claude it's running in Shellby.";
const CLOSED = 'That conversation is closed.';
const MAX_PROJECTS = 100;
const SPIKE_ANSWERS = new Set(['spike-yes', 'spike-no', 'spike-stop']);
const SPIKE_LOST = "Shellby was closed while the spike ran, so its changes weren't put back. Use Undo or Rewind on its turns.";

// Claude Code's own memory folder for a project: ~/.claude/projects/<the path, - for every other character>/memory.
const memoryOf = dir => (dir ? path.join(os.homedir(), '.claude', 'projects', dir.replace(/[^a-zA-Z0-9]/g, '-'), 'memory') : null);

/**
 * Where Claude keeps its own things outside a project, allowed even outside
 * the scope: temp, its plans and todos, and this project's memory. Never the
 * rest of ~/.claude: its settings, hooks, agents and skills can run code.
 */
const outsideOk = dirs => [
  os.tmpdir(), path.join(os.homedir(), '.claude', 'plans'), path.join(os.homedir(), '.claude', 'todos'),
  ...dirs.map(memoryOf),
].filter(Boolean);

/**
 * A path in full: 8.3 short names expanded, links and junctions followed, for
 * the part that exists (a file about to be written doesn't yet). A network
 * path is never looked up: that alone would send this PC's sign-in there.
 */
function longPath(p) {
  const abs = path.resolve(p);
  if (/^[\\/]{2}/.test(abs)) return abs;
  let cur = abs;
  const tail = [];
  for (let i = 0; i < 64; i++) {
    try { return path.join(fs.realpathSync.native(cur), ...tail.reverse()); } catch { /* not there yet: try its folder */ }
    const up = path.dirname(cur);
    if (up === cur) return abs;
    tail.push(path.basename(cur));
    cur = up;
  }
  return abs;
}

/** A file tool's input with its path made absolute and in full, for the gate. */
function withLongPath(input, cwd) {
  if (!input || typeof input !== 'object') return input;
  const key = typeof input.file_path === 'string' ? 'file_path' : typeof input.notebook_path === 'string' ? 'notebook_path' : null;
  return key && input[key] ? { ...input, [key]: longPath(path.resolve(cwd || '.', input[key])) } : input;
}

/** The repo a folder is in, found by its .git (a file in a copy, a folder in a clone), or null. */
function gitTop(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return null;
  let cur = path.resolve(dir);
  for (let i = 0; i < 64; i++) {
    try { if (fs.existsSync(path.join(cur, '.git'))) return cur; } catch { return null; }
    const up = path.dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
  return null;
}

/**
 * d: what main shares (main.js `shared`): manager, history, config, send,
 * tabWindow, panel, wake, log, stat, runCommandsFor, remoteService.
 * opts.now() for tests.
 */
function wireEngineer(d, opts = {}) {
  const now = opts.now || Date.now;
  // tab -> its latest decision / spike, once read. Keyed by the tab itself: a
  // reopened conversation is a new tab, and reads them from History again.
  const decisions = new WeakMap();
  const spikes = new WeakMap();

  const winOf = tabId => d.tabWindow?.(tabId) || d.panel;
  const cwdOf = tab => tab.claudeWorktree?.path || tab.worktree?.cwd || tab.session.cwd;
  const remote = tab => !!d.remoteService?.placeOf?.(tab.session.cwd);

  // The folders this conversation really works in, in full: what History says is checked against them.
  const knownRoots = tab => [tab.worktree?.path, tab.worktree?.root, tab.claudeWorktree?.path, gitTop(tab.session.cwd)]
    .filter(Boolean).map(r => longPath(r).toLowerCase());
  const known = (tab, root) => typeof root === 'string' && knownRoots(tab).includes(longPath(root).toLowerCase());

  // History is a file: a root it names is kept only when it's one of this conversation's own.
  function decisionOf(tab) {
    if (!decisions.has(tab)) {
      const d0 = tab.saved ? eng.latestFrom(d.history.load?.(tab.id)) : null;
      if (d0?.root && !known(tab, d0.root)) delete d0.root;
      decisions.set(tab, d0);
    }
    return decisions.get(tab);
  }
  // A spike read back from History: only its own repo's turns to put back, and
  // one that was running when Shellby closed is over (nothing was put back).
  function spikeOf(tab) {
    if (!spikes.has(tab)) {
      let s = tab.saved ? eng.latestSpikeFrom(d.history.load?.(tab.id)) : null;
      if (s) {
        s = { ...s, refs: (s.refs || []).filter(r => known(tab, r.root)) };
        if (s.root && !known(tab, s.root)) delete s.root;
        if (s.phase === 'running' || s.phase === 'ending') s = { ...s, phase: 'failed', restored: { ok: false, files: 0, error: SPIKE_LOST } };
      }
      spikes.set(tab, s);
    }
    return spikes.get(tab);
  }
  const stateOf = tab => ({ on: !!tab.engineer, decision: decisionOf(tab), spike: spikeOf(tab) });

  // On, and Claude has the crab's tools to answer it with.
  const active = tab => !!tab.engineer && !!d.config.get('selfAware') && !!tab.session.mcp;

  // ------------------------------------------------------------ the project

  // The project a conversation belongs to: a copy counts as the clone it came from.
  const projectRootOf = tab => tab.worktree?.root || gitTop(tab.session.cwd) || null;

  /** This project's Engineer settings: { on, allow }. */
  function prefsOf(root) {
    const store = d.config.get('engineerProjects');
    const k = checks.projectKey(root);
    const v = k && store && typeof store === 'object' && !Array.isArray(store) ? store[k] : null;
    return { on: v?.on === true, allow: gate.readAllow(v?.allow) };
  }

  /** The store with this project's settings, newest kept when it's full. */
  function withPrefs(root, prefs) {
    const k = checks.projectKey(root);
    const store = d.config.get('engineerProjects');
    const kept = Object.entries(store && typeof store === 'object' && !Array.isArray(store) ? store : {}).filter(([key]) => key !== k);
    return Object.fromEntries([...kept.slice(-(MAX_PROJECTS - 1)), [k, prefs]]);
  }

  // The project's own checks, as checks.js finds them: its test, typecheck and lint scripts.
  function ownChecks(tab) {
    if (remote(tab)) return [];
    const cwd = cwdOf(tab);
    return [...new Set([...checks.detectHome(cwd), ...checks.detectProblems(cwd)])];
  }

  // ...run before a decision when Settings lets them (on by default).
  const projectChecks = tab => (d.config.get('engineerChecksFirst') === false ? [] : ownChecks(tab));

  /** What Claude may run before a decision here: the project's checks and what you allowed. */
  function beforeOf(tab) {
    const root = projectRootOf(tab);
    return [...new Set([...projectChecks(tab), ...(root ? prefsOf(root).allow : [])])];
  }

  // ------------------------------------------------------------ the gate's view

  function ctxOf(tab) {
    const decision = decisionOf(tab);
    const spike = spikeOf(tab);
    const cwd = cwdOf(tab);
    const outside = outsideOk([cwd, projectRootOf(tab)]).map(longPath);
    // During a spike, only the repo each turn's snapshot is taken of: what it
    // changes anywhere else couldn't be put back.
    if (spike?.phase === 'running' || spike?.phase === 'ending') {
      return { cwd, roots: [gitTop(cwd) || spike.root].filter(Boolean).map(longPath), outside, before: [] };
    }
    // Repo roots first: a scope is relative to the root, never to a subfolder.
    const roots = [tab.worktree?.path, tab.claudeWorktree?.path, tab.worktree?.root, decision?.root, gitTop(cwd), cwd].filter(Boolean).map(longPath);
    return { cwd, roots: [...new Set(roots)], outside, before: tab.engineerBefore || [] };
  }

  // decide and the rest ride along only in a conversation with it on: every
  // tool listed costs every turn. Fixed for the life of a process, so a change
  // shows from its next start. -> whether the list changed
  function syncTools(tab) {
    const mcp = tab.session.mcp;
    if (!mcp) return false;
    const base = mcp.tools.filter(t => !eng.TOOL_NAMES.includes(t.name));
    const tools = active(tab) ? [...base, ...eng.TOOLS] : base;
    if (tools.length === mcp.tools.length) return false;
    tab.session.mcp = { ...mcp, tools };
    return true;
  }

  // Before each message (wiring/sessions.js decorate): its tools, what it may
  // run before a decision, and the work hook's say on each change while it's on.
  function arm(tab) {
    syncTools(tab);
    tab.engineerBefore = active(tab) ? beforeOf(tab) : [];
    tab.session.gate = active(tab)
      ? input => {
        const ctx = ctxOf(tab);
        return gate.gate(stateOf(tab), input?.tool_name, withLongPath(input?.tool_input, ctx.cwd), worktrees.startsWork, ctx);
      }
      : null;
  }

  function publish(tab, decision) {
    decisions.set(tab, decision);
    const item = { ...eng.view(decision), t: now() };
    try { d.manager.note(tab.id, item); } catch (err) { d.log?.info(`engineer: ${err.message}`); }
    return item;
  }
  function publishSpike(tab, spike) {
    spikes.set(tab, spike);
    const item = { ...eng.spikeView(spike), t: now() };
    try { d.manager.note(tab.id, item); } catch (err) { d.log?.info(`engineer: ${err.message}`); }
    return item;
  }

  // ------------------------------------------------------------ the chip

  /**
   * On or off for one conversation. Its process is let go of when its tools
   * change, so the next message starts it with them, resumed (safe mode's way).
   * Off ends an approval, and puts a spike's files back.
   * -> { ok } | { ok: false, error }
   */
  async function set(tabId, on) {
    const tab = d.manager.tabs.get(tabId);
    if (!tab) return { ok: false, error: CLOSED };
    if (!onClaude(tab)) return { ok: false, error: 'Engineer mode works in Claude Code conversations.' };
    if (on && !d.config.get('selfAware')) return { ok: false, error: NEEDS_SELF_AWARE };
    if (on && !tab.session.mcp) return { ok: false, error: "This conversation started without the crab's tools. Start a new one to use Engineer mode." };
    if (tab.session.busy) return { ok: false, error: 'Let Claude finish this turn (or stop it) first.' };
    if (tab.engineer === !!on) return { ok: true };
    tab.engineer = !!on;
    if (tab.saved) d.history.update(tab.id, { engineer: !!on });
    if (!on) {
      if (decisionOf(tab)?.phase === 'approved') publish(tab, { ...decisionOf(tab), phase: 'closed' });
      const s = spikeOf(tab);
      if (s?.phase === 'running' || s?.phase === 'ending') await putBack(tab, s);
      else if (s?.phase === 'asked') publishSpike(tab, { ...s, phase: 'refused' });
    }
    const changed = syncTools(tab);
    arm(tab);
    if (changed && tab.session.proc) await tab.session.stop();
    d.manager.changed();
    d.stat?.(on ? 'engineer-on' : 'engineer-off');
    return { ok: true };
  }

  /** A new conversation in a project with Engineer mode on for every one (sessions.js open). */
  function engineerDefault(tab) {
    if (!onClaude(tab) || !d.config.get('selfAware') || !tab.session.mcp) return false;
    const root = projectRootOf(tab);
    if (!root || !prefsOf(root).on) return false;
    tab.engineer = true;
    syncTools(tab);
    return true;
  }

  /** Each message's line for Claude (wiring/sessions.js decorate). */
  function decorate(tab, prompt) {
    if (!tab.engineer) return prompt;
    return words.withNote(prompt, words.turnNote(stateOf(tab), { before: tab.engineerBefore || [] }));
  }

  // ------------------------------------------------------------ the crab's tools

  const isTool = name => eng.TOOL_NAMES.includes(name);
  const err = text => ({ text, isError: true });

  function onDecide(tab, args) {
    const s = spikeOf(tab);
    if (s?.phase === 'running') return err('A spike is still running: call mcp__shellby__end_spike with what you found first.');
    const r = eng.readDecision(args);
    if (r.error) return err(r.error);
    const was = decisionOf(tab);
    // A new decision replaces one still open: the old card says so.
    if (was?.phase === 'approved' || was?.phase === 'proposed') publish(tab, { ...was, phase: 'closed' });
    if (s?.phase === 'asked') publishSpike(tab, { ...s, phase: 'refused', note: 'Claude decided without it.' });
    // A spike that's ending counts too: end_spike tells Claude to decide in the same turn,
    // before the turn ends and its files are put back.
    const found = (s?.phase === 'done' || s?.phase === 'ending') && !s.used && s.findings ? { question: s.question, findings: s.findings, ...(s.answer ? { answer: s.answer } : {}) } : null;
    if (found) publishSpike(tab, { ...s, used: true });
    // Shellby runs a plan's command only when it's one of the project's own checks
    // (not any script: `npm run deploy` passes checks.isSafeCommand too). Any other stays Claude's to report.
    const own = new Set(ownChecks(tab));
    const decision = /** @type {Record<string, any>} */ (r.decision);
    const testPlan = decision.testPlan.map(/** @param {{ check: string, command?: string }} t */ t => (t.command && !own.has(t.command) ? { check: t.check } : t));
    publish(tab, { id: crypto.randomUUID(), phase: 'proposed', ...decision, testPlan, ...(found ? { spike: found } : {}) });
    d.wake?.();
    const hint = eng.worthASpike(r.decision) ? ' You marked it low confidence and hard to undo, so the card offers the user a spike first.' : '';
    return { text: `Shown to the user as a decision card. End your turn now: their answer comes as their next message, and file changes stay blocked until they approve.${hint}` };
  }

  function onCheck(tab, args) {
    const decision = decisionOf(tab);
    if (decision?.phase !== 'approved') return err('There is no approved decision to check the work against.');
    const steps = decision.steps?.length || 0;
    const r = eng.readOutcome(args, steps);
    if (r.error || !r.outcome) return err(r.error || 'Say how it went.');
    const o = r.outcome;
    const progress = o.step ? [...(decision.progress || []).filter(p => p.step !== o.step), o].sort((a, b) => a.step - b.step) : decision.progress || [];
    if (o.step && o.step < steps) {
      publish(tab, { ...decision, progress });
      return { text: `Step ${o.step} of ${steps} is on the decision card. Carry on with step ${o.step + 1}.` };
    }
    const runs = [...new Set(decision.testPlan.filter(t => t.command).map(t => t.command))];
    publish(tab, { ...decision, phase: 'checked', outcome: o, ...(progress.length ? { progress } : {}), auditPending: true });
    const then = runs.length ? ` and runs ${runs.join(', ')}` : '';
    return { text: `Put on the decision card. When this turn ends, Shellby compares it with the files the work really changed${then}. Further file changes need a new decision.` };
  }

  function onAmend(tab, args) {
    const decision = decisionOf(tab);
    if (decision?.phase !== 'approved') return err('There is no approved decision to amend. Call decide instead.');
    if (eng.pendingAmendment(decision)) return err('An amendment is already waiting on the user\'s card. End your turn and wait for their answer.');
    if ((decision.amendments || []).length >= 8) return err('This decision has been amended eight times. Call decide with a new decision instead.');
    const r = eng.readAmendment(args);
    if (r.error) return err(r.error);
    publish(tab, { ...decision, amendments: [...(decision.amendments || []), { id: crypto.randomUUID(), phase: 'proposed', ...r.amendment }] });
    d.wake?.();
    return { text: 'Shown on the decision card. End your turn now: edits outside the scope stay blocked until the user approves it.' };
  }

  function onSpike(tab, args) {
    if (decisionOf(tab)?.phase === 'approved') return err('A decision is already approved: a spike comes before deciding. Keep to the decision, or call decide with a new one.');
    const s = spikeOf(tab);
    if (s?.phase === 'running' || s?.phase === 'ending') return err('A spike is already running. Call end_spike first.');
    const r = eng.readSpike(args);
    if (r.error) return err(r.error);
    publishSpike(tab, { id: crypto.randomUUID(), phase: 'asked', ...r.spike });
    d.wake?.();
    return { text: 'Shown to the user as a spike card. End your turn now: their answer comes as their next message, and file changes stay blocked until they allow it.' };
  }

  function onEndSpike(tab, args) {
    const s = spikeOf(tab);
    if (s?.phase !== 'running') return err('There is no spike running.');
    const r = eng.readFindings(args);
    if (r.error) return err(r.error);
    publishSpike(tab, { ...s, phase: 'ending', ...r });
    return { text: 'Noted on the spike card. Every file the spike changed is put back when this turn ends. Now call mcp__shellby__decide, using what you found.' };
  }

  const HANDLERS = { [eng.DECIDE]: onDecide, [eng.CHECK]: onCheck, [eng.AMEND]: onAmend, [eng.SPIKE]: onSpike, [eng.END_SPIKE]: onEndSpike };

  /** One of Engineer mode's tools, from Claude. -> { text, isError? } */
  function tool(tab, name, args) {
    if (!tab.engineer) return { text: 'Engineer mode is off in this conversation, so nothing was shown. Carry on as usual.' };
    return HANDLERS[name] ? HANDLERS[name](tab, args) : err('Unknown Engineer mode tool.');
  }

  // ------------------------------------------------------------ the card's buttons

  /** Sends a button's message, or puts things back as they were. -> { ok } | { ok: false, error } */
  function sendFor(tab, prompt, shown, undo) {
    let turnId;
    try {
      turnId = d.manager.send(tab.id, prompt, { kind: 'user', text: shown });
    } catch (e) {
      undo();
      return { ok: false, error: e.message };
    }
    d.send(winOf(tab.id), 'tab:sent', { tabId: tab.id, item: { kind: 'user', text: shown, attachments: [], turnId } });
    d.wake?.();
    return { ok: true };
  }

  async function answerDecision(tab, decision, { what, option, note }) {
    if (what === 'close') {
      if (decision.phase !== 'approved') return { ok: false, error: 'That decision is no longer open.' };
      publish(tab, { ...decision, phase: 'closed' });
      return { ok: true };
    }
    if (decision.phase !== 'proposed') return { ok: false, error: 'That decision has already been answered.' };
    if (tab.session.busy) return { ok: false, error: 'Claude is still finishing its turn. Press it again in a moment.' };
    const a = words.answerPrompt(decision, { what, option: Number.isInteger(option) ? option : -1, note: typeof note === 'string' ? note : '', keepRecords: d.config.get('engineerRecords') !== false });
    if (a.error) return { ok: false, error: a.error };
    const said = typeof note === 'string' ? note.trim().slice(0, eng.MAX_NOTE) : '';
    const approving = what === 'approve' || what === 'pick';
    // The last turn's diff first: it belongs to the turn that decided, not to the work.
    await settled(tab.id);
    // Where the scope is measured from: the repo, found before the message goes.
    const root = approving ? (tab.worktree?.path || await changes.rootOf(cwdOf(tab)).catch(() => null)) : null;
    if (decisionOf(tab) !== decision) return { ok: false, error: 'That decision has already been answered.' };
    if (tab.session.busy) return { ok: false, error: 'Claude is still finishing its turn. Press it again in a moment.' };
    // A spike still asking would be stale once a decision is approved.
    const s = spikeOf(tab);
    if (approving && s?.phase === 'asked') publishSpike(tab, { ...s, phase: 'refused', note: 'You approved a decision instead.' });
    const phase = approving ? 'approved' : 'returned';
    const next = {
      ...decision, phase, ...(said ? { note: said } : {}),
      ...(what === 'critic' || what === 'spike-first' ? { asked: what } : {}),
      ...(approving ? { picked: a.picked, touched: [], ...(root ? { root } : {}) } : {}),
    };
    // Answered before the message goes: its line for Claude, and the gate, read the new phase.
    decisions.set(tab, next);
    const sent = sendFor(tab, a.prompt, a.shown, () => decisions.set(tab, decision));
    if (sent.ok) publish(tab, next);
    return sent;
  }

  function answerAmendment(tab, decision, amendment, { what, note }) {
    if (decision.phase !== 'approved' || amendment.phase !== 'proposed') return { ok: false, error: 'That amendment has already been answered.' };
    if (tab.session.busy) return { ok: false, error: 'Claude is still finishing its turn. Press it again in a moment.' };
    const yes = what === 'amend-yes';
    const a = words.amendPrompt(decision, amendment, { what: yes ? 'yes' : 'no', note: typeof note === 'string' ? note : '' });
    const next = { ...decision, amendments: decision.amendments.map(m => (m.id === amendment.id ? { ...m, phase: yes ? 'approved' : 'refused' } : m)) };
    decisions.set(tab, next);
    const sent = sendFor(tab, a.prompt, a.shown, () => decisions.set(tab, decision));
    if (sent.ok) publish(tab, next);
    return sent;
  }

  async function answerSpike(tab, spike, { what, note }) {
    if (what === 'spike-stop') {
      if (spike.phase !== 'running') return { ok: false, error: 'That spike is not running.' };
      if (tab.session.busy) return { ok: false, error: 'Stop Claude first, then put the spike back.' };
      if (restoring.has(tab)) return { ok: false, error: 'Already putting it back.' };
      // Its last turn's diff first, or that turn's changes would be left behind.
      await settled(tab.id);
      const now = spikeOf(tab);
      if (now?.id !== spike.id || now.phase !== 'running') return { ok: true };
      await putBack(tab, { ...now, phase: 'ending', note: 'Stopped by you.' });
      return { ok: true };
    }
    if (spike.phase !== 'asked') return { ok: false, error: 'That spike has already been answered.' };
    if (tab.session.busy) return { ok: false, error: 'Claude is still finishing its turn. Press it again in a moment.' };
    const yes = what === 'spike-yes';
    if (yes && decisionOf(tab)?.phase === 'approved') return { ok: false, error: 'A decision is already approved, so this spike is out of date.' };
    const said = typeof note === 'string' ? note.trim().slice(0, eng.MAX_NOTE) : '';
    // The last turn's diff first: it belongs to the turn that asked, not to the spike.
    await settled(tab.id);
    // A spike's files are put back from each turn's snapshots: it needs a git repo.
    const root = yes ? await changes.rootOf(cwdOf(tab)).catch(() => null) : null;
    if (yes && !root) return { ok: false, error: 'A spike needs the project to be a git repository, so Shellby can put its files back.' };
    if (spikeOf(tab) !== spike || tab.session.busy) return { ok: false, error: 'That spike has already been answered.' };
    const a = words.spikePrompt(spike, { what: yes ? 'yes' : 'no', note: said });
    const next = { ...spike, phase: yes ? 'running' : 'refused', ...(said ? { note: said } : {}), ...(root ? { root, refs: [] } : {}) };
    spikes.set(tab, next);
    const sent = sendFor(tab, a.prompt, a.shown, () => spikes.set(tab, spike));
    if (sent.ok) publishSpike(tab, next);
    return sent;
  }

  /**
   * A button on a card. what: 'approve' | 'pick' (option: its index) |
   * 'return' (note: what should change) | 'critic' | 'spike-first' | 'close'
   * an approved one before it's checked (nothing is sent); 'amend-yes' |
   * 'amend-no' (id: the amendment's); 'spike-yes' | 'spike-no' | 'spike-stop'
   * (id: the spike's). -> { ok } | { ok: false, error }
   * @param {string} tabId
   * @param {string} id
   * @param {{ what?: string, option?: number, note?: string }} [answer]
   */
  async function act(tabId, id, { what, option, note } = {}) {
    const tab = d.manager.tabs.get(tabId);
    if (!tab) return { ok: false, error: CLOSED };
    const w = String(what || '');
    // spike-first is a decision's answer; these three are a spike's.
    if (SPIKE_ANSWERS.has(w)) {
      const spike = spikeOf(tab);
      if (!spike || spike.id !== id) return { ok: false, error: 'That spike is no longer open.' };
      return answerSpike(tab, spike, { what: w, note });
    }
    const decision = decisionOf(tab);
    if (w.startsWith('amend-')) {
      const amendment = (decision?.amendments || []).find(m => m.id === id);
      if (!amendment || !['amend-yes', 'amend-no'].includes(w)) return { ok: false, error: 'That amendment is no longer open.' };
      return answerAmendment(tab, decision, amendment, { what: w, note });
    }
    if (!decision || decision.id !== id) return { ok: false, error: w === 'close' ? 'That decision is no longer open.' : 'That decision has already been answered.' };
    if (!['approve', 'pick', 'return', 'critic', 'spike-first', 'close'].includes(w)) return { ok: false, error: 'Unknown answer.' };
    return answerDecision(tab, decision, { what: w, option, note });
  }

  // ------------------------------------------------------------ after each turn

  // tab id -> its end-of-turn work here still going (turnChanged): a button never runs ahead of it.
  const inFlight = new Map();
  // Tabs whose spike is being put back right now: never twice at once.
  const restoring = new WeakSet();

  /** Waits until the last turn's diff has been noted (wiring/sessions.js turnEnds) and handled here. */
  async function settled(tabId) {
    await Promise.resolve(d.turnEnds?.get?.(tabId)).catch(() => {});
    await Promise.resolve(inFlight.get(tabId)).catch(() => {});
  }

  /** A turn's diff as something changes.undo takes: only its own files when it was cut down. */
  const refOf = s => ({ root: s.root, before: s.before, after: s.after, ...(s.scoped ? { paths: s.files.map(f => f.path) } : {}) });

  /**
   * Puts every file a spike changed back, newest turn first, and says how it
   * went on its card. A spike with a turn Shellby couldn't see (its snapshot
   * failed) can't promise everything came back, so it says so.
   */
  async function putBack(tab, spike) {
    if (restoring.has(tab)) return;
    restoring.add(tab);
    try {
      const refs = [...(spike.refs || [])].reverse();
      let files = 0;
      for (const ref of refs) {
        const r = await changes.undo(ref).catch(e => ({ ok: false, restored: 0, error: e.message }));
        if (!r.ok) {
          publishSpike(tab, { ...spike, phase: 'failed', restored: { ok: false, files, error: r.error || "Couldn't put the files back." } });
          return;
        }
        files += r.restored || 0;
      }
      if (spike.blind) {
        publishSpike(tab, { ...spike, phase: 'failed', restored: { ok: false, files, error: `Shellby couldn't see every turn of the spike${files ? `, so after putting ${files} file${files === 1 ? '' : 's'} back` : ''}, some of its changes may still be there.` } });
        return;
      }
      publishSpike(tab, { ...spike, phase: 'done', restored: { ok: true, files } });
    } finally {
      restoring.delete(tab);
    }
  }

  /** Shellby's own run of the plan's commands, onto the card when it's done. Never throws. */
  async function verify(tab, decision, runs) {
    const cwd = cwdOf(tab);
    const r = await (d.runCommandsFor?.(tab.id, { cwd, project: projectRootOf(tab) || cwd, commands: runs }) ?? Promise.resolve({ none: true }))
      .catch(e => ({ error: e.message }));
    const result = r.verdict
      ? { status: 'done', results: r.verdict.commands.map(c => ({ cmd: c.cmd, status: c.ok ? 'pass' : c.timedOut ? 'timeout' : c.error ? 'error' : 'fail', tail: c.ok ? '' : c.tail })) }
      : { status: r.declined ? 'declined' : r.cancelled ? 'cancelled' : r.none ? 'none' : 'error', results: [] };
    // Only if the card is still this one: a newer decision may have come in meanwhile.
    if (decisionOf(tab)?.id === decision.id) publish(tab, { ...decisionOf(tab), verify: result });
  }

  /**
   * The decision's work is checked: the diff against its scope now, and the
   * plan's commands, run by Shellby, after (they can take minutes, and ask
   * first in a new project: nothing waits on them).
   */
  function finish(tab, decision) {
    const audit = { ...gate.audit(decision, decision.touched || []), ...(decision.unseen ? { unseen: true } : {}) };
    // Again now: the project's checks may have changed since the card was made.
    const own = new Set(ownChecks(tab));
    const runs = [...new Set(decision.testPlan.filter(t => t.command && own.has(t.command)).map(t => t.command))];
    const { auditPending: _done, ...rest } = decision;
    publish(tab, { ...rest, audit, ...(runs.length ? { verify: { status: 'running', results: [] } } : {}) });
    if (runs.length) verify(tab, decision, runs).catch(e => d.log?.info(`engineer: ${e.message}`));
  }

  /**
   * A turn has ended (wiring/sessions.js afterChanges), with its diff or null.
   * seen.unseen: Shellby couldn't take the turn's snapshots, so null doesn't
   * mean nothing changed. A running spike keeps the diff to put back; an
   * approved decision keeps its files for the diff check; and whatever ended
   * this turn (end_spike, the last check_decision) is finished now. Never throws.
   */
  function turnChanged(tabId, summary, seen = {}) {
    const p = handleTurn(tabId, summary, seen).catch(e => d.log?.info(`engineer: ${e.message}`));
    inFlight.set(tabId, p);
    p.finally(() => { if (inFlight.get(tabId) === p) inFlight.delete(tabId); });
    return p;
  }

  async function handleTurn(tabId, summary, { unseen = false } = {}) {
    const tab = d.manager.tabs.get(tabId);
    if (!tab) return;
    const s = spikeOf(tab);
    if (s && (s.phase === 'running' || s.phase === 'ending')) {
      const withTurn = { ...s, ...(summary ? { refs: [...(s.refs || []), refOf(summary)] } : {}), ...(unseen ? { blind: true } : {}) };
      if (s.phase === 'ending') await putBack(tab, withTurn);
      else if (summary || unseen) publishSpike(tab, withTurn);
    }
    const decision = decisionOf(tab);
    if (!decision || !(decision.phase === 'approved' || decision.auditPending)) return;
    const touched = summary
      ? [...new Set([...(decision.touched || []), ...summary.files.map(f => f.path)])].slice(0, eng.MAX_TOUCHED)
      : decision.touched || [];
    const next = { ...decision, touched, ...(!decision.root && summary?.root ? { root: summary.root } : {}), ...(unseen ? { unseen: true } : {}) };
    if (next.auditPending) finish(tab, next);
    else if (summary || unseen) publish(tab, next);
  }

  // ------------------------------------------------------------ the project's settings

  /** The project's Engineer settings for the note under the box. -> view | { error } */
  function projectFor(tabId) {
    const tab = d.manager.tabs.get(tabId);
    if (!tab) return { ok: false, error: CLOSED };
    const root = projectRootOf(tab);
    if (!root) return { ok: false, error: 'This conversation isn\'t in a git project.' };
    const prefs = prefsOf(root);
    return { ok: true, name: path.basename(root), on: prefs.on, allow: prefs.allow, checks: projectChecks(tab) };
  }

  /** Changes them. change: { on?, allow? } -> projectFor's view */
  function setProject(tabId, change = {}) {
    const tab = d.manager.tabs.get(tabId);
    if (!tab) return { ok: false, error: CLOSED };
    const root = projectRootOf(tab);
    if (!root) return { ok: false, error: 'This conversation isn\'t in a git project.' };
    const prefs = prefsOf(root);
    const next = {
      on: typeof change.on === 'boolean' ? change.on : prefs.on,
      allow: Array.isArray(change.allow) ? gate.readAllow(change.allow) : prefs.allow,
    };
    d.config.set({ engineerProjects: withPrefs(root, next) });
    arm(tab);
    return projectFor(tabId);
  }

  return { set, arm, decorate, isTool, tool, act, stateOf, turnChanged, projectFor, setProject, engineerDefault };
}

module.exports = { wireEngineer, NEEDS_SELF_AWARE, gitTop };
