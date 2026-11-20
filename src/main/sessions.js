// Parallel conversations. Each tab owns one ClaudeSession (one CLI process);
// the manager persists transcripts, tracks per-tab status and rolls everything
// up into one state for the desktop critter.
const { EventEmitter } = require('events');
const { ClaudeSession, EFFORTS } = require('./session');
const { cleanTitle } = require('./history');
const review = require('./review-inbox');
const turncost = require('./turncost');
const { isModel } = require('./models');
const localAgent = require('./local/agent');
const localTab = require('./local/tab');
const harnesses = require('./harness/registry');
const planPace = require('./plan-pace');
const { talkOf, todoGlance, aggregateOf } = require('./tab-glance');
const tabStops = require('./tab-stops');
const { items } = require('./sessions-items');
const { turns, IN_TERMINAL, withPreamble } = require('./sessions-turns');
const { choices, onClaude, NOT_CLAUDE } = require('./sessions-choices');

// Tabs left quiet shed their process (stopIdle), so an open tab is cheap; a busy
// one is a running CLI, and nothing limits how many of those run at once. The cap
// is where routines and workflows start recycling old tabs to make room.
const MAX_TABS = 32;
// He talks along while a reply is written (work-pose.js 'talk') until it has
// been this quiet: the reply's 50 ms batches never reach the crab one by one.
const TALK_QUIET_MS = 700;
const TAB_ID = /^[\w-]{1,64}$/;
// An agent's name as Claude Code lists it ("reviewer", "plugin:reviewer"), or ''.
const AGENT_NAME = /^[\w][\w:.-]{0,119}$/;
const cleanAgent = v => (typeof v === 'string' && AGENT_NAME.test(v) ? v : '');
const canPause = t => onClaude(t) && !!t.session.requestPause && !t.localTarget && !t.routineId && !t.workflowRunId;

/** @typedef {typeof items & typeof turns & typeof choices} ManagerMixins */
// EventEmitter at run time: the mixins join the prototype at the end of this
// file. The cast only lets the class (and tsc) see their methods on `this`.
const Base = /** @type {new () => EventEmitter & ManagerMixins} */ (/** @type {unknown} */ (EventEmitter));

class SessionManager extends Base {
  // prepareTurn(tab): an optional promise each turn waits for before Claude
  // sees it (main.js snapshots the folder, for the turn's diff).
  // compose(text, files): the content Claude gets for a steer (attachments.js composeContent).
  // windowShare(weight): a turn's share of the 5-hour window, or null (turncost.js),
  // put on its result before History keeps it.
  // Claude knowing it's in Shellby (see selfaware.js, crabmcp.js), all optional:
  //   getSelfAware() -> { note, tools } | null, read when a tab's process is made
  //   onTool(tab, name, args) -> Promise<{ text, isError? }>, a crab tool was called
  //   decorate(tab, prompt) -> the prompt Claude actually receives
  // getEffort() is the effort new conversations start on; with it on Auto ('')
  // and getEffortPick() true, each one is sized from its first message instead (effort-pick.js).
  // getRemote(cwd) -> how to start Claude Code on another computer when cwd is
  // one of its folders, or null (remote/service.js launch): read at each start.
  // getFallbackModel() and getChrome() are Settings' (session/ has what they do);
  // supports(flag): whether the installed Claude Code takes one of session/args.js OPTIONAL_FLAGS.
  // makeHarness(id, { cwd, mode, resumeId }) -> a session for another agent's CLI (harness/), or null when none can run.
  constructor({ getExe, history, getMode, getModel, getEffort = () => '', getEffortPick = () => false, getOutputStyle = () => '', getFallbackModel = () => '', getChrome = () => false, supports = () => true, argsPrefix = [], getEnv = () => ({}), prepareTurn = null, compose = text => text, windowShare = null, getSelfAware = () => null, onTool = null, decorate = null, getRemote = () => null, savePictures = null, getLocalTarget = () => null, getLocalServer = () => null, warmLocal = null, makeHarness = null, getConnectorServers = () => null, engineerDefault = null }) {
    super();
    Object.assign(this, { makeHarness, getExe, history, getMode, getModel, getEffort, getEffortPick, getOutputStyle, getFallbackModel, getChrome, supports, argsPrefix, getEnv, prepareTurn, compose, windowShare, getSelfAware, onTool, decorate, getRemote, savePictures, getLocalTarget, getLocalServer, warmLocal, getConnectorServers, engineerDefault });
    this.tabs = new Map();
  }

  // Creates (or returns) a tab. `historyEntry` resumes a saved conversation.
  // allowedTools / mcpConfig: a routine's or workflow step's MCP servers (mcpservers.js),
  // fixed for the life of its process.
  // agent: one of your agents to run the conversation (--agent), kept in History.
  // harness: the CLI it runs on (harness/registry.js), Claude Code unless another is picked; kept in History, never changed.
  open({ tabId, cwd, historyEntry = null, mode = null, routineId = null, workflowRunId = null, title = null, allowedTools = [], mcpConfig = null, agent = null, harness = null }) {
    if (!TAB_ID.test(tabId || '')) throw new Error('bad tab id');
    if (this.tabs.has(tabId)) return this.tabs.get(tabId);
    if (this.tabs.size >= MAX_TABS) throw new Error(`Shellby can run up to ${MAX_TABS} conversations at once. Close one first.`);
    const runsOn = harnesses.cleanHarness(historyEntry?.harness ?? harness);
    const other = runsOn !== harnesses.CLAUDE;
    // Never carried on by another agent than the one it began on.
    if (other && !this.makeHarness) throw new Error(`${harnesses.byId(runsOn).name} conversations aren't available here.`);
    const exe = other ? null : this.getExe();
    // A folder on another computer needs Claude Code there, not here.
    if (!other && !exe && !this.getRemote(historyEntry?.cwd || cwd)) throw new Error('Claude Code is not installed.');
    const aware = other ? null : this.getSelfAware();
    // Local model or Claude (local/agent.js), decided once: a saved conversation
    // keeps what it began on, a new one takes Settings' choice now. Never moved
    // later, so a local conversation is never carried on at Anthropic.
    const localTarget = other ? null : historyEntry ? localAgent.cleanTarget(historyEntry.local) : this.getLocalTarget(cwd);
    let tab = null; // the tools are only ever called once it exists
    // Its own effort, kept in History: you chose it, or Shellby picked it.
    const ownEffort = ['you', 'picked'].includes(historyEntry?.effortBy) && (historyEntry.effort === '' || EFFORTS.includes(historyEntry.effort)) ? historyEntry.effort : null;
    const session = other ? this.makeHarness(runsOn, { cwd: historyEntry?.cwd || cwd, mode: mode || this.getMode(), resumeId: historyEntry?.claudeSessionId || null }) : new ClaudeSession({
      remote: () => this.getRemote(session.cwd), // only ever called once it exists
      // Asked again at each start: Claude Code may move while the tab is open
      // (session/). The path found now stands in should it go missing, so
      // the start fails the usual way (ENOENT, "can't find Claude Code").
      exe: () => this.getExe() || exe, argsPrefix: this.argsPrefix,
      cwd: historyEntry?.cwd || cwd,
      mode: mode || this.getMode(),
      // Its own model (setTabModel; '' is Claude Code's default, picked on purpose), or the Settings one.
      // On a local model (local/agent.js) the environment names it: a Claude model kept in History would be refused there.
      model: localTarget || historyEntry?.model === '' ? null : (historyEntry?.model && isModel(historyEntry.model) ? historyEntry.model : '') || this.getModel() || null,
      effort: ownEffort ?? (this.getEffort() || ''),
      outputStyle: this.getOutputStyle() || '',
      fallbackModel: localTarget ? '' : this.getFallbackModel() || '',
      chrome: !!this.getChrome(),
      // Safe mode lasts as long as the conversation, restarts and all, until it's turned off.
      safeMode: historyEntry?.safeMode === true,
      agent: cleanAgent(historyEntry?.agent ?? agent),
      // What Claude Code calls it (/resume, claude.ai): its title, once it has one of its own.
      name: () => (tab && (tab.saved || tab.named) ? tab.title : ''),
      supports: flag => this.supports(flag),
      resumeId: historyEntry?.claudeSessionId || null,
      resumeAt: historyEntry?.resumeAt || null,
      // tab's: it can still move until its first message (local/tab.js).
      extraEnv: () => ({ ...this.getEnv(), ...localAgent.envFor(tab ? tab.localTarget : localTarget) }),
      context: historyEntry?.context || null,
      allowedTools, mcpConfig,
      // The connectors gateway (connectors/), but never on a local model: nothing of a local conversation leaves this PC.
      extraMcp: () => ((tab ? tab.localTarget : localTarget) ? null : this.getConnectorServers?.() || null),
      systemNote: aware?.note || null,
      mcp: aware?.tools && this.onTool ? { tools: aware.tools, call: (name, args) => this.onTool(tab, name, args) } : null,
    });
    tab = {
      id: tabId, session, routineId,
      harness: runsOn,             // the CLI it runs on (harness/registry.js)
      workflowRunId,               // a workflow run's conversation (workflows/service.js)
      pinnedMode: !!mode,          // routines and workflows keep their own mode
      title: historyEntry?.title || title || 'New task',
      saved: !!historyEntry,       // has a history entry (created on first send)
      named: false,                // renamed before its first send: keep that name
      // 'ok' | 'error' | 'stopped' after the last turn; 'cut' when Shellby went
      // down mid-turn (history.takeCutOff), until a turn here finishes.
      outcome: historyEntry?.lastOutcome === 'cut' ? 'cut' : null,
      unread: false,
      localTarget,                 // { url, model } on a local model, else null; kept in History
      localBy: null,               // 'you' once picked on the model chip: Settings no longer decides it
      worktree: historyEntry?.worktree || null, // its own copy of the repo (worktrees/index.js)
      // A branch of another conversation (branch.js): where it came from, the
      // folders it must keep out of, and what Claude is told before its first
      // message (where it is now). All kept in History so a restart keeps them.
      branchOf: historyEntry?.branchOf || null,
      fence: historyEntry?.fence || null,
      preamble: typeof historyEntry?.preamble === 'string' ? historyEntry.preamble : null,
      // Its latest finished work and whether you've looked (review-inbox.js): the review inbox.
      ready: review.restore(historyEntry?.ready),
      // When it was carried on in a terminal (handoff.js): until it's picked up
      // again, nothing is sent from here, or two processes would share it.
      inTerminal: Number.isFinite(historyEntry?.inTerminal) ? historyEntry.inTerminal : null,
      activeAt: Date.now(),        // when it last sent or heard anything, for stopIdle()
      steers: [],                  // what the panel has queued for this turn's next step (steer())
      steeredIds: new Set(),       // ...and what of it has gone in already
      usageTold: 0,                // the usage level Claude was last told about (selfaware.usageNote)
      offered: new Set(),          // features suggested in this conversation
      engineer: historyEntry?.engineer === true, // Engineer mode's chip (wiring/engineer.js)
      // Who set its effort: 'you' (the chip), 'picked' (Shellby, from its first
      // message) or null, following the default for new conversations.
      effortBy: ownEffort === null ? null : historyEntry.effortBy,
    };
    // A reopened conversation remembers what it already offered.
    if (historyEntry) for (const i of this.history.load?.(tabId) || []) if (i?.kind === 'suggest') tab.offered.add(i.feature);
    this.tabs.set(tabId, tab);
    // A new conversation in a project with Engineer mode on by default (wiring/engineer.js).
    if (!historyEntry) this.engineerDefault?.(tab);
    session.takeSteers = () => this.takeSteers(tab);
    // Where it works, for the plain words on its permission cards (plain-words.js).
    session.inCopy = () => !!tab.worktree;
    session.copyOf = () => tab.worktree?.originalCwd || null;

    // Keep warm's ping is keepwarm-service.js's business: none of its turn is
    // saved, shown or counted as a turn of yours; its result settles ping().
    // Only what the process says: a note made meanwhile (note(), safe mode, the
    // crab's suggestions) is the tab's as ever. Its usage readings go through.
    session.on('item', item => (tab.pinging && item.kind !== 'usage' ? this.onPingItem(tab, item) : this.onItem(tab, item)));
    session.on('spend', s => this.emit('spend', tab.id, s, tab));
    session.on('run', r => this.emit('run', tab.id, r, tab)); // an Ultracode run ended, with what it cost (session/ultra.js)
    session.on('call', c => this.emit('call', tab.id, c, tab));
    session.on('cache', () => this.changed());
    session.on('context', (now, before) => { this.emit('context', tab.id, now, before, tab); this.changed(); });
    // A turn's end puts down the talking and the compacting with it.
    session.on('busy', b => { if (!b) this.hush(tab); this.changed(); });
    session.on('tokens', () => this.changed());
    session.on('plan', () => this.changed());
    session.on('crew', () => this.changed());
    // Background commands, Claude's to-do list and planning: the panel and the crab both show them.
    session.on('jobs', view => { this.emit('jobs', tab.id, view, tab); this.changed(); });
    session.on('todos', s => { this.emit('todos', tab.id, s, tab); this.changed(); });
    session.on('planning', () => this.changed());
    session.on('tool', () => this.changed());
    session.on('pause', () => this.changed()); // the pause line and its buttons (session/pause.js)
    session.on('exit', () => {
      this.restoreTurnModel(tab); // no result comes from a process that ended
      // A process stopped mid-ping sends no result (session.js ended), so the ping is settled here.
      if (tab.pinging) this.settlePing(tab, { ok: false, error: 'its Claude Code process ended', tokens: null, denied: false });
      // Its mods ended with it: their status lines go too (plugin null: all of them).
      this.emit('item', tab.id, { kind: 'modstatus', plugin: null, text: null }, tab);
      this.changed();
    });
    this.changed();
    return tab;
  }

  // A name of your own for an open tab. One not yet sent anything has no History
  // entry to hold it, so `named` stops the first message from replacing it.
  rename(tabId, title) {
    const tab = this.tabs.get(tabId);
    const t = cleanTitle(title);
    if (!tab || !t) return false;
    tab.title = t;
    if (tab.saved) this.history.rename(tab.id, t); else tab.named = true;
    this.changed();
    return true;
  }

  /** Mark a tab as carried on in a terminal (at: a time), or picked back up (null). */
  setInTerminal(tabId, at) {
    const tab = this.tabs.get(tabId);
    if (!tab) return false;
    tab.inTerminal = Number.isFinite(at) ? at : null;
    if (tab.saved) this.history.update(tab.id, { inTerminal: tab.inTerminal });
    this.changed();
    return true;
  }

  // Something main.js worked out about a tab (what its last turn changed):
  // kept in the transcript and shown just like the CLI's own items.
  note(tabId, item) {
    const tab = this.tabs.get(tabId);
    if (tab) this.onItem(tab, item);
  }

  /** Counts as just used, for stopIdle: Keep warm lets go of the tabs it kept (keepwarm-service.js stop). */
  touch(tabId) {
    const tab = this.tabs.get(tabId);
    if (tab) tab.activeAt = Date.now();
  }

  respond(tabId, requestId, decision, message, answers, via) {
    const tab = this.tabs.get(tabId);
    if (!tab) return false;
    // A note's Plan, approved: the work goes on in your mode, not Claude Code's default.
    const planApproved = tab.startsIn === 'plan' && decision !== 'deny' && tab.session.pending.get(requestId)?.toolName === 'ExitPlanMode';
    return tab.session.respond(requestId, decision, message, answers, via, planApproved ? this.followMode(tab) : null) || false;
  }

  interrupt(tabId) { this.tabs.get(tabId)?.session.interrupt(); }

  // Pause at the end of Claude's current step, or Continue a held pause (session/pause.js). -> { ok } | { ok: false, error }
  // Not Keep warm's ping, and not a routine's or workflow's turn, which something else is waiting on.
  pause(tabId) { const t = this.tabs.get(tabId); return t && canPause(t) && !t.pinging ? t.session.requestPause() : { ok: false, error: "This conversation can't pause." }; }
  resume(tabId) { return this.tabs.get(tabId)?.session.resumePause?.() || { ok: false, error: "It isn't paused." }; }

  markRead(tabId) {
    const tab = this.tabs.get(tabId);
    if (tab && tab.unread) { tab.unread = false; this.changed(); }
  }

  // The Map's order is the order the tab strip shows, and main.js persists it as
  // `openTabs`, so a reorder here is also what comes back next launch. `beforeId`
  // is the tab to land in front of; null means the end of the strip.
  reorder(tabId, beforeId = null) {
    if (!this.tabs.has(tabId)) return false;
    const was = [...this.tabs.keys()];
    const rest = was.filter(id => id !== tabId);
    const at = beforeId === null ? rest.length : rest.indexOf(beforeId);
    if (at < 0) return false;                                  // unknown neighbour, or itself
    rest.splice(at, 0, tabId);
    if (rest.every((id, i) => id === was[i])) return false;     // already sitting there
    const order = rest.map(id => [id, this.tabs.get(id)]);
    this.tabs.clear();
    for (const [id, tab] of order) this.tabs.set(id, tab);
    this.changed();
    return true;
  }

  // The split view's order (ipc/tabs.js panes:layout): the tabs `ids` names
  // (each pane's tabs in turn) take each other's places in that order, and
  // every tab it doesn't name (one popped out, say) keeps its own. Unknown and
  // repeated ids are skipped. -> whether anything moved (no update is pushed otherwise).
  setOrder(ids) {
    const was = [...this.tabs.keys()];
    const want = [...new Set(ids)].filter(id => this.tabs.has(id));
    const named = new Set(want);
    let i = 0;
    const next = was.map(id => (named.has(id) ? want[i++] : id));
    if (next.every((id, i) => id === was[i])) return false;
    const order = next.map(id => [id, this.tabs.get(id)]);
    this.tabs.clear();
    for (const [id, tab] of order) this.tabs.set(id, tab);
    this.changed();
    return true;
  }

  // Words of the reply arrived: he talks along, until they stop for a moment.
  talked(tab) {
    clearTimeout(tab.talkTimer);
    tab.talkTimer = setTimeout(() => { tab.talkTimer = null; tab.talking = false; this.changed(); }, TALK_QUIET_MS);
    tab.talkTimer.unref?.();
    if (!tab.talking) { tab.talking = true; this.changed(); }
  }

  hush(tab) {
    clearTimeout(tab.talkTimer);
    tab.talkTimer = null;
    tab.talking = false;
    tab.compacting = false;
  }

  // kill: end the process tree now instead of letting it wind down (quitting).
  close(tabId, { kill = false } = {}) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    this.hush(tab);
    // Closed by hand mid-turn: no result is coming, and it wasn't cut off either.
    // Quitting (kill) leaves the mark, so the next start says what didn't finish.
    if (!kill && tab.saved && tab.session.busy) this.history.markTurn?.(tab.id, null);
    // A ping in flight would never hear its result once the listeners are gone: settle it here.
    if (tab.pinging) this.settlePing(tab, { ok: false, error: 'the conversation was closed', tokens: null, denied: false });
    tab.session.removeAllListeners();
    if (kill) tab.session.kill();
    tab.session.close();
    this.tabs.delete(tabId);
    this.changed();
  }

  /** Close a tab and wait until its CLI process has really gone (up to timeoutMs). */
  closeAndWait(tabId, timeoutMs = 8000) {
    const proc = this.tabs.get(tabId)?.session.proc;
    this.close(tabId);
    if (!proc || proc.exitCode !== null) return Promise.resolve();
    return new Promise(resolve => {
      const timer = setTimeout(resolve, timeoutMs);
      proc.once('close', () => { clearTimeout(timer); resolve(); });
    });
  }

  closeAll(opts) { for (const id of [...this.tabs.keys()]) this.close(id, opts); }

  // Tab processes ended while the tabs stay open (tab-stops.js): the quiet ones, and
  // every one on the sign-in from before a sign-out or account switch.
  stopIdle(idleMs, now = Date.now(), keep = () => false) { return tabStops.stopIdle(this.tabs.values(), idleMs, now, keep); }
  stopForSignIn(now = Date.now()) { return tabStops.stopForSignIn(this.tabs.values(), onClaude, now); }
  /** A turn here was turned down as signed out: its next message gets a fresh process (tab-stops.js beforeSend). */
  signedOut(tabId, now = Date.now()) {
    const tab = this.tabs.get(tabId);
    if (tab && onClaude(tab) && !tab.session.remoteHost) tab.signInAt = now;
  }

  require(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error('That conversation is closed.');
    return tab;
  }

  isBusy(tabId) { return !!this.tabs.get(tabId)?.session.busy; }

  get summary() {
    return [...this.tabs.values()].map(t => ({
      id: t.id, title: t.title, cwd: t.session.cwd, busy: t.session.busy, busySince: t.session.busySince,
      turnTokens: t.session.turn?.tokens || 0, // the running turn's so far, beside its clock
      plan: planPace.outlook(t.session.turn?.plan), // its step through Claude's to-do list and when that ends
      pending: t.session.pending.size, crew: t.session.runningCrew().length,
      outcome: t.outcome, unread: t.unread, routineId: t.routineId, workflowRunId: t.workflowRunId || null, saved: t.saved, named: t.named, context: t.session.context, cache: t.session.cache,
      nudge: turncost.nudge(t.session.context, t.session.growths),
      // The model it runs: the latest reply's, else init's, else the one asked for ('' = Claude Code's default).
      // Just switched (/model): the one asked for, until a reply on it comes in.
      model: (t.session.modelSwitched ? t.session.model : t.session.lastModel || t.session.initModel || t.session.model) || '',
      // What it asked for ('' = Claude Code's default), so the panel can name the default it ran on.
      modelAsked: t.session.model || '',
      // The local model it runs on (local/agent.js), else null; canLocal: it can still move between local and Claude.
      local: t.localTarget ? t.localTarget.model : null, canLocal: localTab.canMove(t),
      worktree: t.worktree ? { branch: t.worktree.branch, base: t.worktree.base, originalCwd: t.worktree.originalCwd } : null,
      claudeWorktree: t.claudeWorktree ? { branch: t.claudeWorktree.branch, path: t.claudeWorktree.path } : null, // Claude's own (EnterWorktree)
      branchOf: t.branchOf ? { id: t.branchOf.id, title: t.branchOf.title, at: t.branchOf.at, ...(t.branchOf.shared ? { shared: true } : {}) } : null,
      // The last time Shellby ran its tests (wiring/checks.js): for anything that wants a verdict at a glance.
      // errors: the failing checks' type and lint errors, for the review inbox (wiring/checks.js remember)
      checks: t.checks ? { status: t.checks.status, after: t.checks.after, at: t.checks.at, errors: t.checks.errors || null } : null,
      pr: t.pr || null, // the pull request Ship it opened (ipc/repo.js): { repo, number, url }
      risk: t.risk || null, // "Look here first" (ipc/viewer.js viewer:risk): { [path]: 'high' | 'medium' | 'low' }
      // Its latest changes and whether you've reviewed them (review-inbox.js): the panel's review inbox.
      ready: t.ready ? { ...t.ready, paths: [...t.ready.paths] } : null,
      inTerminal: t.inTerminal || null,
      effort: t.session.effort || '', effortBy: t.effortBy || null, // the effort chip
      // Claude's to-do list at a glance (shared/todos.js), what it left running (jobs.js), and whether it's planning.
      todos: todoGlance(t.session.todos),
      jobs: t.session.jobView(),
      planning: !!t.session.planning,
      pause: t.session.pauseView?.() || null, // pausing, paused or parked (session/pause.js)
      canPause: canPause(t),
      compacting: !!t.compacting, // Claude Code compacting it now: the phone's working line says so
      safeMode: !!t.session.safeMode, engineer: !!t.engineer, agent: t.session.agent || null, harness: t.harness || harnesses.CLAUDE,
      remoteHost: t.session.remoteHost || null, // the computer it runs on: whose plan its usage meter shows (tab-meters.js)
    }));
  }

  // One state for the critter: asking beats working beats idle (tab-glance.js).
  get aggregate() { return aggregateOf(this.tabs.values()); }

  changed() {
    // Coalesce bursts (progress events can be chatty) into one update per tick.
    if (this.pendingEmit) return;
    this.pendingEmit = setImmediate(() => {
      this.pendingEmit = null;
      this.emit('tabs', this.summary);
      this.emit('aggregate', this.aggregate);
    });
  }
}

// What a tab hears, a message going in, and what it runs on (sessions-items.js,
// sessions-turns.js, sessions-choices.js).
Object.assign(SessionManager.prototype, items, turns, choices);

module.exports = { SessionManager, MAX_TABS, IN_TERMINAL, NOT_CLAUDE, withPreamble, talkOf, todoGlance, onClaude };
