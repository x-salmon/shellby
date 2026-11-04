// A turn's rewards, as a card in its conversation (turn-rewards.js). Every
// reward already goes to the panel through d.send (or life's toPanel), so the
// tap there is the one place that sees them all; nothing that pays out needs to
// know about this. A turn opens at beginTurn (wiring/sessions.js) and its card
// is written once its result is in and its changes and checks cards are (the
// turnEnds promise), so it lands last, under what the turn did.
const { entryOf, createLedger } = require('../turn-rewards');

function wireTurnRewards(d) {
  const ledger = createLedger();
  let watching = false;

  const on = () => !d.CAPTURE && d.config?.get('rewardCards') !== false;

  function watch() {
    if (watching || !d.manager?.on) return;
    watching = true;
    d.manager.on('item', (tabId, item) => {
      if (item?.kind !== 'result') return;
      ledger.ending(tabId);
      // After every other listener's own payouts for this result (the turn's XP, a level it brings).
      setImmediate(() => finish(tabId));
    });
  }

  async function finish(tabId) {
    try { await d.turnEnds?.get(tabId); } catch { /* its changes card failed; the rewards still stand */ }
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
    ledger.close(tabId);
  }

  /** Every send passes here; the rewards among them are kept for the turn. */
  function tapReward(channel, payload) {
    if (!ledger.open()) return;
    try { ledger.add(entryOf(channel, payload)); } catch (err) { d.log?.info?.(`turn rewards: ${err.message}`); }
  }

  return { rewardsBegin, rewardsForget, tapReward };
}

module.exports = { wireTurnRewards };
