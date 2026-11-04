// What you do with him (feature-use.js ACTIONS), recorded in main: one
// listener on the achievement stat bus (wiring/game-hooks.js onStat) turns the
// stats that already mean an action into its count, and `featureAct(id)` is
// for the ones nothing reports yet, called where the user does the thing
// (ipc/wardrobe.js, ipc/progress.js, ipc/tank.js, ipc/life.js) and from the
// panel over features:act (ipc/critter.js). Counted on this PC only, never
// synced. Kept out of main.js, which only wires it up.
const featureUse = require('../feature-use');

// An achievement stat that is an action: stat name -> action id. Stats that
// fire on every save (tank-pieces, stickers-earned) aren't here: those actions
// are recorded where the save happens, so one save counts once.
const STAT_ACTIONS = Object.freeze({
  'find-made': 'find-made',
  'bug-caught': 'bug-caught',
});

/** d: what main shares (main.js `shared`): config, onStat. */
function wireFeatureActs(d) {
  /** Action `id` done now. An id feature-use.js doesn't list changes nothing. */
  function featureAct(id) {
    const before = d.config.get('featureUse'); // read fresh: the renderer's visits write the same key
    const next = featureUse.act(before, String(id || ''), Date.now());
    if (JSON.stringify(next) !== JSON.stringify(featureUse.normalize(before))) d.config.set({ featureUse: next });
  }

  d.onStat?.(event => { if (STAT_ACTIONS[event]) featureAct(STAT_ACTIONS[event]); });

  return { featureAct };
}

module.exports = { wireFeatureActs, STAT_ACTIONS };
