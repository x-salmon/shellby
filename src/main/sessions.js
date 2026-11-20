// Parallel conversations. Each tab owns one ClaudeSession (one CLI process);
// the manager persists transcripts, tracks per-tab status and rolls everything
// up into one state for the desktop critter. Its methods live in session-manager/: lifecycle
// (open, close, order), turns (send, steer, ping), items (what a session says) and
// settings (a tab's own name, mode, effort and model), mixed in below.
const { EventEmitter } = require('events');
const turncost = require('./turncost');
const localTab = require('./local/tab');
const harnesses = require('./harness/registry');
const planPace = require('./plan-pace');
const { talkOf, todoGlance, aggregateOf } = require('./tab-glance');
const { MAX_TABS, IN_TERMINAL, NOT_CLAUDE, withPreamble, onClaude, canPause } = require('./session-manager/shared');
const Lifecycle = require('./session-manager/lifecycle');
const Turns = require('./session-manager/turns');
const Items = require('./session-manager/items');
const Settings = require('./session-manager/settings');

class SessionManager extends EventEmitter {
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
  constructor({ getExe, history, getMode, getModel, getEffort = () => '', getEffortPick = () => false, getOutputStyle = () => '', getFallbackModel = () => '', getChrome = () => false, supports = () => true, argsPrefix = [], getEnv = () => ({}), prepareTurn = null, compose = text => text, windowShare = null, getSelfAware = () => null, onTool = null, decorate = null, getRemote = () => null, savePictures = null, getLocalTarget = () => null, getLocalServer = () => null, warmLocal = null, makeHarness = null, engineerDefault = null }) {
    super();
    Object.assign(this, { makeHarness, getExe, history, getMode, getModel, getEffort, getEffortPick, getOutputStyle, getFallbackModel, getChrome, supports, argsPrefix, getEnv, prepareTurn, compose, windowShare, getSelfAware, onTool, decorate, getRemote, savePictures, getLocalTarget, getLocalServer, warmLocal, engineerDefault });
    this.tabs = new Map();
  }

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

// The parts are classes of methods only: copied onto the prototype, getters and all.
for (const Part of [Lifecycle, Turns, Items, Settings]) {
  for (const key of Object.getOwnPropertyNames(Part.prototype)) {
    if (key !== 'constructor') Object.defineProperty(SessionManager.prototype, key, Object.getOwnPropertyDescriptor(Part.prototype, key));
  }
}

module.exports = { SessionManager, MAX_TABS, IN_TERMINAL, NOT_CLAUDE, withPreamble, talkOf, todoGlance, onClaude };
