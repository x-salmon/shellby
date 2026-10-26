/* Shellby panel — Claude Code's own slash commands that print mode can't run.
   main's cli-commands.js says how each is handled and sends the list with the
   toolbox (state.toolbox.builtins). 'cli' ones go to Claude Code as they are;
   'shellby' ones open what Shellby has for them (ACTIONS below, given the tab
   and the words after the command); 'terminal'
   ones say why and offer to carry the conversation on in a terminal.
   composer.js's SB.runLocal asks here after Shellby's own commands. */
'use strict';
(function () {
  const { api, state, $ } = SB;

  const CLAUDE_ISSUES = 'https://github.com/anthropics/claude-code/issues';

  // A setting, in view; or the Settings tab it lives on when it's not showing.
  const setting = (id, tab) => () => {
    if ($(id)?.closest('.setting-group')) return SB.showSetting(id);
    SB.setView('settings');
    if (tab) SB.showSettingsTab?.(tab);
  };

  const usage = () => {
    const meters = $('usage');
    if (meters && !meters.hidden) return meters.click();
    SB.toast('Your plan usage shows here once Claude Code has reported it, after your first message.', { ms: 5000 });
  };

  // Typed in Shellby, /bug and /feedback are as likely about him as about Claude
  // Code, so they ask which before opening anything.
  const feedbackFor = kind => () => SB.toast(kind === 'bug' ? 'Which one misbehaved?' : 'Feedback on which?', {
    ms: 10000,
    actions: [
      { label: 'Shellby', onAction: () => (kind === 'bug' ? api.reportProblem() : api.suggestIdea()) },
      { label: 'Claude Code', onAction: () => api.openExternal(CLAUDE_ISSUES) },
    ],
  });

  // /tasks: the tray above the box already lists what runs in the background (native-strip.js).
  const tasks = () => {
    const tray = $('jobs');
    if (tray && !tray.hidden) { tray.scrollIntoView({ block: 'nearest' }); return tray.querySelector('button')?.focus(); }
    SB.toast('Nothing is running in the background here. When Claude leaves a command or a watch going, it shows above the box, with its output and a Stop.', { ms: 7000 });
  };

  // /workflows: this conversation's Workflow runs are its Ultracode cards (ultracode.js).
  const workflows = tab => {
    const last = tab ? [...tab.el.querySelectorAll('.ultra-card')].pop() : null;
    if (last) { last.scrollIntoView({ block: 'center' }); return last.querySelector('button')?.focus(); }
    SB.toast('No workflow runs in this conversation yet. Turn on Ultracode with the chip under the box and Claude can start one: each run shows here as a card, its agents as helper crabs.', { ms: 8000 });
  };

  // /autofix-pr: "Fix this build" on a failing pull request Shellby watches (startfrom.js).
  const autofix = async () => {
    const ci = await api.getCi().catch(() => null);
    if (!ci?.enabled && !ci?.githubEnabled) {
      return SB.toast('Shellby fixes failing builds once it watches your pull requests: Settings → Connections → GitHub.', { ms: 7000, action: 'Open', onAction: setting('githubGroup', 'connect') });
    }
    const failing = (ci.prs || []).filter(p => p.state === 'failing');
    const name = p => p.ref || `${p.repo}#${p.number}`;
    if (!failing.length) return SB.toast("None of your pull requests is failing right now. When one goes red, Shellby offers Fix this build.", { ms: 6000 });
    if (failing.length === 1) return SB.startFrom.open('build', failing[0].key);
    SB.toast('Which build should Claude fix?', { ms: 12000, actions: failing.slice(0, 3).map(p => ({ label: name(p), onAction: () => SB.startFrom.open('build', p.key) })) });
  };

  // /ultraplan <what>: Claude Code's own, in a terminal, which asks before the cloud session starts (wiring/handoff.js).
  const ultraplan = async (tab, what) => {
    if (!what) return SB.toast('Say what to plan: /ultraplan <what to plan>. A cloud session drafts it, and you edit and approve it in the terminal it opens in.', { ms: 8000 });
    const r = await api.openCloud({ kind: 'ultraplan', value: what, tabId: tab?.id || null }).catch(() => null);
    SB.toast(r?.ok ? r.text : r?.error || "Couldn't open a terminal.", { ms: 8000 });
  };

  // /subtask on its own; with a task it never gets here, as SB.rewriteBuiltin sends it as words.
  const subtask = () => SB.toast('Say what the helper should do: /subtask <task>. It takes this whole conversation with it, and its result comes back here.', { ms: 7000 });

  /**
   * Commands that go to Claude as the words they stand for, through the usual
   * send (queued, held, Ultracode and all): /subtask <task> asks for a forked
   * helper with the whole conversation (feed-logic.js). -> the words, or null.
   * Your own command or skill of the same name wins, as it does for the rest.
   */
  SB.rewriteBuiltin = text => {
    const m = /^\/subtask\s+([\s\S]*\S[\s\S]*)$/i.exec(text);
    if (!m || entryOf('subtask')?.handling !== 'shellby') return null;
    SB.notePrompt?.(text);
    return window.ShellbyFeedLogic.subtaskPrompt(m[1]);
  };

  const ACTIONS = {
    agents: () => SB.showToolbox?.('agent'),
    'autofix-pr': autofix,
    chrome: setting('chromeToggle', 'claude'),
    daemon: () => SB.setView('routines'),
    loops: () => SB.setView('routines'),
    mobile: () => SB.showMobileQr?.(),
    subtask,
    tasks,
    ultraplan,
    wellbeing: () => SB.setView('time'),
    workflows,
    bug: feedbackFor('bug'),
    feedback: feedbackFor('feedback'),
    config: () => SB.setView('settings'),
    diff: tab => SB.showChanges?.(tab),
    doctor: () => SB.setView('health'),
    help: () => SB.showToolbox?.('command'),
    hooks: () => SB.showToolbox?.('hook'),
    install: setting('claudeUpdateCheck', 'general'),
    restart: setting('claudeUpdateCheck', 'general'),
    keybindings: () => SB.openShortcuts?.(),
    login: async () => { if (await api.claudeLogin()) SB.toast('Finish signing in in the window that opened. Shellby notices when you’re done.', { ms: 6000 }); },
    logout: setting('claudeSignOut', 'claude'),
    memory: () => SB.showToolbox?.('memory'),
    plan: () => SB.chooseMode?.('plan'),
    plugin: () => SB.openShop?.(),
    resume: () => SB.setView('history'),
    skills: () => SB.showToolbox?.('skill'),
    status: setting('claudeModeBtn', 'claude'),
    usage,
  };

  // The entry for a name or alias, from what main sent. Your own command or
  // skill of the same name isn't in the list, so it goes to Claude as yours.
  function entryOf(name) {
    const tb = state.toolbox || {};
    const list = tb.builtins || [];
    const hit = list.find(c => c.name === name) || list.find(c => (c.aliases || []).includes(name));
    if (hit) return hit;
    const mine = [...(tb.commands || []), ...(tb.skills || [])].some(t => t.name === name);
    return !mine && ACTIONS[name] ? { name, handling: 'shellby' } : null;
  }

  function offerTerminal(tab, c) {
    const msg = `/${c.name} only works in Claude Code's own terminal. ${c.reason || ''}`.trim();
    if (!tab?.saved) return SB.toast(msg, { ms: 6000 });
    SB.toast(msg, { ms: 8000, action: 'Open in a terminal', onAction: () => SB.continueInTerminal(tab.id) });
  }

  /** text: what was sent. true = handled here, false = send it to Claude Code. */
  SB.runBuiltin = (text, tab) => {
    const m = /^\/([\w:.-]+)(?:\s+([\s\S]*))?$/.exec(text);
    const c = m && entryOf(m[1].toLowerCase());
    if (!c || c.handling === 'cli' || (c.handling === 'shellby' && !ACTIONS[c.name])) return false;
    SB.notePrompt?.(text);
    if (c.handling === 'terminal') offerTerminal(tab, c);
    else ACTIONS[c.name]?.(tab, (m[2] || '').trim());
    return true;
  };
})();
