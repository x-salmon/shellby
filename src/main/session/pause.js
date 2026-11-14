'use strict';

// Pause: Claude stops at the end of the step he's on and waits there, his
// conversation exactly as it was, until you press Continue. Mixed into
// ClaudeSession's prototype by session/index.js.
//
// Every finished tool call, the main thread's and each helper's, asks Shellby's
// steer hook before Claude reads its result (args.js initHooks). While paused,
// that answer is held back, so nothing is cut short: the step is done and Claude
// waits to read it. Claude Code waits on a held hook for STEER_TIMEOUT_S, and
// sends control_cancel_request if it gives up.
//
// phase: 'pausing' (asked; some step is still running), 'paused' (every thread
// held), 'parking' (let go so he can say he's paused and end the turn), 'parked'
// (the turn ended where he stopped; Continue sends a message to carry on).
//
// A held conversation can't touch its prompt cache, and neither can a Keep warm
// ping, which would only queue up behind the hold. So a pause the main thread
// holds alone is parked shortly before its one-hour cache would go cold, or
// before Claude Code would give up on the hook: his reply to that reads (and so
// renews) the cache, and from then on it's an idle conversation Keep warm can ping.

const { randomUUID } = require('crypto');
const { LEAD_MS } = require('../keepwarm');
const { STEER_TIMEOUT_S } = require('./args');

const HOUR = 60 * 60 * 1000;
// What parking tells Claude: he reads his step's result, says so, and stops.
const PARK_TEXT = 'The user paused you in Shellby. Reply with the single word: paused. Use no tools. When they continue, carry on where you left off.';
// Parked this long before Claude Code would give up on the held hook.
const PARK_BEFORE_TIMEOUT_MS = 10 * 60 * 1000;
// Dev/e2e only (main.js, SHELLBY_PARK_AFTER_MS): park this long after pausing,
// so a check needn't wait 55 minutes.
let testParkAfterMs = 0;
const testParkAfter = ms => { testParkAfterMs = Number(ms) > 0 ? Number(ms) : 0; };

const pause = {
  /**
   * Ask Claude to pause at the end of his current step. -> { ok } | { ok: false, error }
   * @returns {{ ok: true } | { ok: false, error: string }}
   */
  requestPause() {
    // A turn still waiting to start (its folder being snapshotted, say) pauses at its first step.
    if (!this.busy || (!this.proc && !this.waiting)) return { ok: false, error: "There's nothing running to pause." };
    if (this.interrupting) return { ok: false, error: "It's stopping already." };
    if (this.pause) return { ok: true };
    this.pause = { phase: 'pausing', since: Date.now(), pausedAt: null, holds: new Map(), timer: null, parkAt: null };
    this.pauseChanged();
    return { ok: true };
  },

  // A finished step's hook (control.js steer): held while pausing or paused.
  // -> whether it was held. One Stop has cut short isn't: that thread is ending.
  holdStep(requestId, input) {
    const p = this.pause;
    if (!p || (p.phase !== 'pausing' && p.phase !== 'paused') || this.interrupting || input?.is_interrupt) return false;
    const agentId = typeof input?.agent_id === 'string' ? input.agent_id : null;
    if (!agentId) this.openTools.delete(input?.tool_use_id);
    p.holds.set(requestId, { input, agentId, tool: typeof input?.tool_name === 'string' ? input.tool_name : null });
    // A helper held after the pause settled (one in the background, say): parking would end it.
    if (agentId && p.phase === 'paused' && p.parkAt) { clearTimeout(p.timer); p.parkAt = null; this.pauseChanged(); }
    this.settlePause();
    return true;
  },

  // The helpers this turn waits on: running, and their Agent call still open.
  waitedHelpers() {
    return this.runningCrew().filter(t => !t.background && t.toolUseId && this.openTools.has(t.toolUseId));
  },

  // Whether every thread has stopped: the main thread is held (or only waits on
  // helpers), and so is each helper it waits on. Claude Code reports a helper's
  // task under its agent id; should a version not, enough held helpers will do.
  allHeld() {
    const p = this.pause;
    if (!p) return false;
    const helpers = this.waitedHelpers();
    const calls = new Set(helpers.map(t => t.toolUseId));
    if ([...this.openTools].some(id => !calls.has(id))) return false; // a step of his is still running
    const holds = [...p.holds.values()];
    if (!holds.some(h => !h.agentId) && !calls.size) return false;  // he's thinking or writing
    const heldAgents = new Set(holds.map(h => h.agentId).filter(Boolean));
    const mapped = [...heldAgents].some(id => this.tasks.has(id));
    return mapped || !heldAgents.size ? helpers.every(t => heldAgents.has(t.taskId)) : heldAgents.size >= helpers.length;
  },

  // Pausing becomes paused once everything has stopped. Called on each hold and
  // whenever the helpers change (crew.js trackTask).
  settlePause() {
    const p = this.pause;
    if (p?.phase !== 'pausing' || !this.allHeld()) return;
    p.phase = 'paused';
    p.pausedAt = Date.now();
    this.armPark();
    this.pauseChanged();
  },

  // When to park, if this pause can be parked: only the main thread holds it
  // (parking a helper would end it early and lose its work).
  armPark() {
    const p = this.pause;
    if (!p || [...p.holds.values()].some(h => h.agentId)) return;
    // From when it was asked for: its first step may have been held since.
    const timeoutAt = p.since + STEER_TIMEOUT_S * 1000 - PARK_BEFORE_TIMEOUT_MS;
    const c = this.cache;
    const coolAt = c && c.ttlMs >= HOUR ? c.at + c.ttlMs - LEAD_MS : Infinity;
    p.parkAt = testParkAfterMs ? Date.now() + testParkAfterMs : Math.min(timeoutAt, coolAt);
    p.timer = setTimeout(() => this.park(), Math.max(0, p.parkAt - Date.now()));
    p.timer.unref?.();
  },

  // Let go of a main-thread pause so Claude reads his step's result, says he's
  // paused and ends the turn (index.js marks that result parked).
  park() {
    const p = this.pause;
    if (p?.phase !== 'paused' || !this.proc?.stdin.writable) return false;
    if ([...p.holds.values()].some(h => h.agentId)) { p.parkAt = null; this.pauseChanged(); return false; }
    clearTimeout(p.timer);
    p.phase = 'parking';
    this.write({ type: 'user', message: { role: 'user', content: PARK_TEXT } });
    for (const [id, h] of p.holds) this.answerStep(id, h.input, false);
    p.holds.clear();
    this.pauseChanged();
    return true;
  },

  /**
   * Continue a held pause: every step goes on, with what you queued meanwhile
   * read at the main thread's (control.js answerStep). A parked one has no turn
   * to go back to: the panel sends a message instead, and that clears it (clearParked).
   * @returns {{ ok: true } | { ok: false, error: string }}
   */
  resumePause() {
    const p = this.pause;
    if (!p) return { ok: false, error: "It isn't paused." };
    if (p.phase === 'parked') return { ok: false, error: 'Send a message to carry on.' };
    if (p.phase === 'parking') return { ok: false, error: "It's still settling into its pause." };
    this.releasePause();
    return { ok: true };
  },

  // Every held step goes on, and the pause is over. Helpers first, so the main
  // thread's steer (control.js answerStep) sees the step as done.
  releasePause() {
    const p = this.pause;
    if (!p) return;
    clearTimeout(p.timer);
    this.pause = null;
    const order = [...p.holds.entries()].sort((a, b) => Number(!a[1].agentId) - Number(!b[1].agentId));
    for (const [id, h] of order) this.answerStep(id, h.input);
    this.pauseChanged();
  },

  clearParked() {
    if (this.pause?.phase !== 'parked') return;
    this.pause = null;
    this.pauseChanged();
  },

  // Claude Code gave up on a request (control_cancel_request): a held step it
  // stopped waiting for has gone on, so the pause is over, and the rest go on too.
  cancelledRequest(requestId) {
    const p = this.pause;
    if (!p?.holds.has(requestId)) return;
    p.holds.delete(requestId);
    this.releasePause();
    this.emitItem({ kind: 'paused', what: 'ran-out' });
  },

  // The turn ended. Parking: that's the pause, now parked. Still pausing: it
  // finished before there was a step to stop at.
  pauseAtResult(item) {
    const p = this.pause;
    // Parked already: this is a turn since (a Keep warm ping), which leaves it parked.
    if (!p || p.phase === 'parked') return;
    clearTimeout(p.timer);
    if (p.phase === 'parking') {
      Object.assign(item, { parked: true, ok: true, interrupted: false, error: null });
      this.pause = { phase: 'parked', since: p.since, pausedAt: p.pausedAt, holds: new Map(), timer: null, parkAt: null };
    } else {
      item.pauseMissed = true;
      this.pause = null;
    }
    this.pauseChanged();
  },

  // Parking asked him to use no tools. Should he reach for one anyway, the turn
  // is stopped there (and still ends parked): he wasn't meant to do anything.
  // Not with interrupt(), which would end the pause itself.
  strayWhileParking() {
    const p = this.pause;
    if (p?.phase !== 'parking' || p.stray) return;
    p.stray = true;
    this.write({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } });
  },

  // The CLI's echo of parking's own note (--replay-user-messages): not a steer of yours being read.
  isParkEcho(event) {
    if (this.pause?.phase !== 'parking') return false;
    const c = event.message?.content;
    return c === PARK_TEXT || (Array.isArray(c) && c.some(b => b?.text === PARK_TEXT));
  },

  // The process went (or was let go of): nothing it held can go on. A parked
  // pause stays: its turn is over, and the next message resumes the conversation.
  pauseEnded() {
    if (!this.pause || this.pause.phase === 'parked') return;
    clearTimeout(this.pause.timer);
    this.pause = null;
    this.pauseChanged();
  },

  // What the panel shows: null, or { phase, since, pausedAt, waitingOn, helpers, coolsAt, parkAt }.
  // waitingOn: what pausing still waits for. coolsAt: when its cache goes cold, for a pause
  // that can't be parked (a helper holds it, or its cache lasts only 5 minutes).
  pauseView() {
    const p = this.pause;
    if (!p) return null;
    const helpers = p.phase === 'pausing' || p.phase === 'paused' ? this.waitedHelpers().length : 0;
    /** @type {string | null} */
    let waitingOn = null;
    if (p.phase === 'pausing') {
      const calls = new Set(this.waitedHelpers().map(t => t.toolUseId));
      const mainRunning = [...this.openTools].some(id => !calls.has(id));
      const heldHelpers = new Set([...p.holds.values()].map(h => h.agentId).filter(Boolean)).size;
      if (mainRunning) waitingOn = this.tool || 'a step';
      else if (helpers > heldHelpers) waitingOn = `${helpers - heldHelpers} of ${helpers} helper${helpers === 1 ? '' : 's'}`;
      else waitingOn = 'his reply';
    }
    const c = this.cache;
    const expires = c ? c.at + c.ttlMs : null;
    const coolsAt = p.phase === 'paused' && expires && !(p.parkAt && p.parkAt < expires) ? expires : null;
    return { phase: p.phase, since: p.since, pausedAt: p.pausedAt, waitingOn, helpers, coolsAt, parkAt: p.parkAt };
  },

  pauseChanged() {
    this.emit('pause', this.pauseView());
  },
};

module.exports = { pause, PARK_TEXT, PARK_BEFORE_TIMEOUT_MS, testParkAfter };
