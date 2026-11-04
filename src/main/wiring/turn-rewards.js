// A turn's rewards, as a card in its conversation (turn-rewards.js). Every
// reward already goes to the panel through d.send (or life's toPanel), so the
// tap there is the one place that sees them all; nothing that pays out needs to
// know about this. A turn opens at beginTurn (wiring/sessions.js) and its card
// is written once its result is in, its changes and checks cards are (the
// turnEnds promise), and the payouts those set off have stopped coming (a crit
// on green tests is a trophy, which is XP, which may be a level), so it lands
// last, under what the turn did, with all of it.
const { entryOf, createLedger } = require('../turn-rewards');

// The card waits for this long without a new reward before it's written...
const QUIET_MS = 400;
// ...but never longer than this after the turn's checks are in.
const MAX_SETTLE_MS = 3000;

const pause = ms => new Promise(r => setTimeout(r, ms));

function wireTurnRewards(d, { quietMs = QUIET_MS, maxSettleMs = MAX_SETTLE_MS } = {}) {
  const ledger = createLedger();
  const added = new Map(); // tabId -> how many rewards it has gained, to tell a quiet spell
  let watching = false;

  const on = () => !d.CAPTURE && d.config?.get('rewardCards') !== false;

  function watch() {
    if (watching || !d.manager?.on) return;
    watching = true;
    d.manager.on('item', (tabId, item) => {
      if (item?.kind !== 'result') return;
      ledger.ending(tabId);
      // After every other listener's own payouts for this result (the turn's XP, a level it brings).
      setImmediate(() => { finish(tabId).catch(err => d.log?.info?.(`turn rewards: ${err.message}`)); });
    });
  }

  // Until a quiet spell with nothing new for this turn, or the cap.
  async function settle(tabId) {
    const until = Date.now() + maxSettleMs;
    for (;;) {
      const before = added.get(tabId) || 0;
      await pause(quietMs);
      if ((added.get(tabId) || 0) === before || Date.now() >= until) return;
    }
  }

  async function finish(tabId) {
    try { await d.turnEnds?.get(tabId); } catch { /* its changes card failed; the rewards still stand */ }
    await settle(tabId);
    added.delete(tabId);
    const card = ledger.close(tabId, Date.now());
    if (!card || !on() || !d.manager?.tabs?.has(tabId)) return;
    d.manager.note(tabId, card);
  }

  /** A turn is starting in this tab. */
  function rewardsBegin(tabId) {
    if (!on() || typeof tabId !== 'string') return;
    watch();
    ledger.begin(tabId);
  }

  /** A tab closed mid-turn: what it was gathering goes with it. */
  function rewardsForget(tabId) {
    added.delete(tabId);
    ledger.close(tabId);
  }

  /** Every send passes here; the rewards among them are kept for the turn. */
  function tapReward(channel, payload) {
    if (!ledger.open()) return;
    try {
      const id = ledger.add(entryOf(channel, payload));
      if (id != null) added.set(id, (added.get(id) || 0) + 1);
    } catch (err) {
      d.log?.info?.(`turn rewards: ${err.message}`);
    }
  }

  return { rewardsBegin, rewardsForget, tapReward };
}

module.exports = { wireTurnRewards, QUIET_MS, MAX_SETTLE_MS };
