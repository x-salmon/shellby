// A message going in (sessions.js), mixed into SessionManager's prototype: send
// (History, the preamble, the effort pick, a turn on another model), the panel's
// queue steered into a running turn, and Keep warm's ping through a tab.

const { randomUUID } = require('crypto');
const { classify } = require('./usage/ledger');
const { isModel } = require('./models');
const localTab = require('./local/tab');
const harnesses = require('./harness/registry');
const turncost = require('./turncost');
const turnwatch = require('./turnwatch');
const tabStops = require('./tab-stops');
const { onClaude, NOT_CLAUDE } = require('./sessions-choices');

const IN_TERMINAL = 'This conversation is carrying on in a terminal. Close it there (/exit), then choose Pick it up here.';

const turns = {
  /** One message in. opts.model: this one turn on that model (model-pick.js's card); onItem
   *  puts the tab's own back at the result. Never a local tab or another CLI. -> the turn's id. */
  send(tabId, prompt, userItem, { model: turnModel = null } = {}) {
    const tab = this.require(tabId);
    // Before anything below touches History or the turn: session.send would
    // refuse anyway, but only after a message Claude never saw was saved.
    if (tab.session.busy) throw new Error('Shellby is still working on the last task.');
    if (tab.inTerminal) throw new Error(IN_TERMINAL);
    tab.activeAt = Date.now();
    tab.session.clearParked?.(); // a message after a parked pause is how it carries on (session/pause.js)
    tab.idleCompacting = false; // set again by wiring/idle-compact.js when the turn is its /compact
    // Opened before Settings changed (an empty tab left waiting): local or Claude is read again now.
    localTab.settle(tab, this.getLocalTarget(tab.session.cwd), this.claudeModels());
    if (!tab.saved) {
      this.history.create({ id: tab.id, title: tab.named ? tab.title : userItem.title || userItem.text || tab.title, cwd: tab.session.cwd, mode: tab.session.mode, routineId: tab.routineId });
      // A tab that opened in its own copy before its first message (a Next up draft):
      // the copy goes in History with it, or reopening it would lose Bring home.
      if (tab.worktree) this.history.update(tab.id, { worktree: tab.worktree });
      // ...and so would the agent it was opened with, or safe mode turned on before it.
      if (tab.session.agent) this.history.update(tab.id, { agent: tab.session.agent });
      if (tab.session.safeMode) this.history.update(tab.id, { safeMode: true });
      if (tab.localTarget) this.history.update(tab.id, { local: tab.localTarget });
      if (tab.localTarget) this.warmLocal?.(tab.localTarget); // its quick model loaded beside the main one (local/ollama.js keepLoaded)
      if (tab.harness !== harnesses.CLAUDE) this.history.update(tab.id, { harness: tab.harness });
      tab.title = this.history.get(tab.id).title;
      tab.saved = true;
      if (tab.effortBy) this.keepEffort(tab); // chosen on the chip before its first message
      if (tab.ownModel) this.history.update(tab.id, { model: tab.session.model }); // and the model, the same way
    } else if (this.history.get(tab.id)?.done) {
      // You've just given it more to do, so it plainly isn't done any more.
      this.history.setDone(tab.id, false);
    }
    // Each message you send gets an id of its own, so it can be rewound to later.
    userItem = { ...userItem, turnId: userItem.turnId || randomUUID() };
    this.history.append(tab.id, userItem);
    tab.turnId = userItem.turnId; // the turn now starting, for what main.js notes about it (its diff)
    tab.steers = [];
    tab.steeredIds = new Set();
    // Who sent it: a routine's run, a workflow's step, a task you queued for
    // the reset, or you (main.js armGuard).
    tab.turnFrom = { routine: userItem.routine || null, workflow: userItem.workflow || null, queued: userItem.queued || null };
    // What was asked, for its category in the per-turn ledger (usage/ledger.js). Read once as the turn starts.
    tab.turnText = typeof userItem.text === 'string' ? userItem.text : '';
    tab.turnCategory = classify(tab.turnText);
    tab.turnWatch = turnwatch.startTurn(tab.turnWatch); // what's been read whole, and not changed, carries on
    tab.outcome = null;
    // The note goes with the first real message (a /command must still start
    // with its slash), and is only forgotten once Claude has started with it:
    // if the process never starts, the next message takes it instead.
    if (tab.preamble && !(typeof prompt === 'string' && prompt.trimStart().startsWith('/'))) {
      prompt = withPreamble(prompt, tab.preamble);
      tab.preambleSent = true;
    }
    if (this.decorate) prompt = this.decorate(tab, prompt);
    tab.pictures = (tab.pictures || 0) + turncost.picturesIn(prompt);
    this.maybePickEffort(tab, userItem);
    if (turnModel && onClaude(tab) && !tab.localTarget && isModel(turnModel) && turnModel !== (tab.session.model || '')) {
      tab.turnModel = { was: tab.session.model || '' };
      tab.session.setModel(turnModel);
    }
    tabStops.beforeSend(tab); // still on the sign-in from before a change: a fresh process takes this one
    try { tab.session.send(prompt, this.prepareTurn?.(tab) || null); } catch (e) { this.restoreTurnModel(tab); throw e; }
    // On disk at once, so a power cut mid-turn still leaves it marked unfinished.
    this.history.markTurn?.(tab.id, { turnId: userItem.turnId, at: Date.now() });
    this.changed();
    return userItem.turnId;
  },

  /** The panel's queue while a turn runs, [{ id, text, attachments }]: it goes in at Claude's next step
   *  (session/control.js steer), only for the turn it was queued behind; what went in already stays out. -> taken? */
  steer(tabId, turnId, list) {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.session.busy || !turnId || turnId !== tab.turnId) return false;
    tab.steers = list.filter(m => !tab.steeredIds.has(m.id));
    return true;
  },

  /** A queued message taken back before Claude has it (the chip's ×), by id here where takeSteers() runs:
   *  the panel's list can be a step behind. -> false when it's too late (it went in this turn). */
  unsteer(tabId, id) {
    const tab = this.tabs.get(tabId);
    if (!tab) return true; // nothing of it can reach Claude
    if (tab.steeredIds.has(id)) return false;
    tab.steers = tab.steers.filter(m => m.id !== id);
    return true;
  },

  // A turn run on a cheaper model (send's opts.model) is over, or never ran: the tab's own model is back.
  restoreTurnModel(tab) { if (tab.turnModel) { const { was } = tab.turnModel; tab.turnModel = null; tab.session.setModel(was); } },

  // What the session hands Claude now, off the list ('steering' locks its chip; the 'user' item's
  // steerId drops it once read). One that can't be put together stays queued, with all after it.
  // No rewind point of its own (code is kept between turns, not mid-turn): turnOf is offered instead.
  takeSteers(tab) {
    // After the ping, as a turn of its own; and you picked the cheaper model for one message only.
    if (tab.pinging || tab.turnModel) return [];
    const taken = [];
    for (const m of tab.steers) {
      let content;
      try { content = this.compose(m.text, m.attachments); } catch { break; }
      taken.push({ content, item: { kind: 'user', text: m.text, attachments: m.attachments, steerId: m.id, turnOf: tab.turnId || null } });
    }
    tab.steers = tab.steers.slice(taken.length);
    for (const t of taken) {
      tab.steeredIds.add(t.item.steerId);
      tab.pictures = (tab.pictures || 0) + turncost.picturesIn(t.content);
    }
    if (taken.length) this.emit('steering', tab.id, taken.map(t => t.item.steerId));
    return taken;
  },

  /**
   * Keep warm's ping (keepwarm-service.js): one message through the tab's
   * running process and nothing else send() does. No History, effort pick,
   * preamble, decorate or prepareTurn, so the conversation's cached prompt
   * and its effort stay exactly as they were.
   * -> a promise of { ok, error, tokens, denied } when its turn ends.
   */
  ping(tabId, text) {
    const tab = this.require(tabId);
    if (!onClaude(tab)) return Promise.reject(new Error(NOT_CLAUDE)); // keeping a prompt cache warm is Claude's
    const s = tab.session;
    // A process on its way out (a stop asked for, or exited and not yet closed) would drop it unanswered.
    if (!s.proc || s.stopping || s.proc.exitCode != null || s.busy || s.pending.size || tab.inTerminal || tab.pinging) return Promise.reject(new Error("That conversation can't take a ping now."));
    return new Promise(resolve => {
      // growths: put back after, so a one-word reply doesn't slow the "filling up" pace (turncost.js).
      tab.pinging = { resolve, denied: false, growths: s.growths };
      try { s.send(text); } catch (err) {
        tab.pinging = null;
        resolve({ ok: false, error: err.message, tokens: null, denied: false });
      }
    });
  },

  // An item of a ping's turn: a tool it asks for is refused (nobody's there to
  // say yes, and a ping uses none), and its result ends the ping.
  onPingItem(tab, item) {
    const p = tab.pinging;
    if (item.kind === 'permission') {
      p.denied = true;
      tab.session.respond(item.requestId, 'deny', 'Keep-warm pings use no tools.');
      return;
    }
    if (item.kind !== 'result') return;
    this.settlePing(tab, { ok: !!item.ok && !p.denied, error: item.error || null, tokens: item.tokens || null, denied: p.denied });
  },

  settlePing(tab, r) {
    const p = tab.pinging;
    tab.pinging = null;
    tab.session.growths = p.growths;
    p.resolve(r);
    this.changed();
  },
};

// A note for Claude ahead of what you typed, as a block of its own so your
// words reach it exactly as you wrote them (a prompt, or blocks when pictures go with it).
function withPreamble(prompt, preamble) {
  return [{ type: 'text', text: preamble }, ...(Array.isArray(prompt) ? prompt : [{ type: 'text', text: String(prompt) }])];
}

module.exports = { turns, IN_TERMINAL, withPreamble };
