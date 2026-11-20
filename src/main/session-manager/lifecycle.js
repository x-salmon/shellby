// Opening, closing and ordering tabs (mixed into SessionManager, sessions.js).
const { ClaudeSession, EFFORTS } = require('../session');
const review = require('../review-inbox');
const { isModel } = require('../models');
const localAgent = require('../local/agent');
const harnesses = require('../harness/registry');
const tabStops = require('../tab-stops');
const { MAX_TABS, TAB_ID, cleanAgent, onClaude } = require('./shared');

class Lifecycle {
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

  /** Counts as just used, for stopIdle: Keep warm lets go of the tabs it kept (keepwarm-service.js stop). */
  touch(tabId) {
    const tab = this.tabs.get(tabId);
    if (tab) tab.activeAt = Date.now();
  }

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
}

module.exports = Lifecycle;
