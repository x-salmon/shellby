// What he digs up and holds up for you (life.js): the dig, the find held up (a sparkly one longer), a bug in a jar,
// and what a find is worth. Shares its state with life.js through `h`; `st` is where he stands (presenting, on a call).
const gifts = require('./gifts');
const moon = require('./moon');
const { MINUTE, PRESENT_MS, DIG_MS } = require('./life-constants');

/**
 * @param {any} d the same deps createLife takes
 * @param {any} h life.js's own: now, free, napping, later, cancel, changed, getFinds, setFinds, getBond, grow, remember, st
 */
function createFinds(d, { now, free, napping, later, cancel, changed, getFinds, setFinds, getBond, grow, remember, st }) {
  function dug({ manual = false } = {}) {
    if (!manual && !free()) return null;
    const t = now();
    const tide = d.tide?.() || {};
    const r = gifts.dig(getFinds(), { seasons: d.seasons(), night: isNight(t), moon: moon.special(t), manual, event: tide.event || null, digBoost: tide.digBoost, shinyBoost: tide.shinyBoost }, t);
    if (r.shiny) r.odds = Math.round(1 / (gifts.SPARKLE_CHANCE * Math.max(1, Math.min(4, tide.shinyBoost || 1))));
    setFinds(r.state);
    if (!r.find) { if (manual) changed(); return null; }
    present(r.find, r);
    return r.find;
  }

  const isNight = t => { const h = new Date(t).getHours(); return h >= 20 || h < 6; };

  // A bug Claude fixed, in a jar (bugdex/index.js): he lunges, corks it and holds it
  // up. Catches land while he's working, so one waits until he's free; a newer
  // one replaces it, and it goes stale after JAR_WAIT_MS.
  /** @type {any} */
  let jarWaiting = null;
  const JAR_MS = 2600;
  const JAR_WAIT_MS = 10 * MINUTE;
  function presentJar(card) {
    if (!card?.pixels || !card.palette) return;
    jarWaiting = { ...card, at: now() };
    jarIfFree();
  }
  /** @type {NodeJS.Timeout | null} */
  let jarRetry = null;
  const JAR_RETRY_MS = 3000;
  function jarIfFree() {
    clearTimeout(/** @type {any} */ (jarRetry));
    if (!jarWaiting) return;
    if (now() - jarWaiting.at > JAR_WAIT_MS) { jarWaiting = null; return; }
    // Busy (a scene, a dig, a task): look again shortly, rather than at the next idle tick.
    if (!free() || napping()) { jarRetry = setTimeout(jarIfFree, JAR_RETRY_MS); return; }
    const j = jarWaiting;
    jarWaiting = null;
    st.presenting = `jar:${j.species}`;
    d.toCrab('critter:bit', { bit: 'catch', ms: JAR_MS });
    d.toCrab('critter:prop', { prop: 'jar', ms: JAR_MS, ghost: !!j.ghost });
    later(700, () => d.toCrab('critter:hold', { pixels: j.pixels, palette: j.palette }));
    if (j.line) d.speak('found', { force: true, text: j.line });
    // Its cry as the cork goes on (critter/sound.js CUES.cry).
    if (j.cry) later(900, () => d.toCrab('critter:sound', { cue: 'cry', ...j.cry }));
    st.presentDone = () => {
      st.presentDone = null;
      st.presenting = null;
      d.toCrab('critter:hold', null);
      d.toCrab('critter:prop', { prop: null });
    };
    later(PRESENT_MS + 700, () => st.presentDone?.());
  }

  function present(find, r) {
    st.presenting = find.id;
    const shiny = !!r?.shiny;
    // A sparkly one: held up in its own colours, a longer glint and a chime, and his loudest line.
    const look = shiny ? gifts.sparkly(find) : find;
    const ms = shiny ? PRESENT_MS + 1800 : PRESENT_MS;
    d.toCrab('critter:bit', { bit: 'present', ms });
    d.toCrab('critter:hold', { pixels: look.pixels, palette: look.palette, shiny });
    const rare = find.rarity === 'rare' || find.rarity === 'legendary';
    if (rare || shiny) d.toCrab('critter:prop', { prop: 'sparkle', ms, big: shiny });
    if (shiny) d.toCrab('critter:sound', { cue: 'sparkle' });
    d.speak('found', { force: true, text: shiny ? '✨ a SPARKLY one!!' : gifts.foundLine(find) });
    // A trophy it earns has a line of its own: after he's shown you the find, not over it.
    // Cut short (cancel()), it still counts, straight away.
    st.presentDone = () => {
      st.presentDone = null;
      st.presenting = null;
      d.toCrab('critter:hold', null);
      d.toCrab('critter:prop', { prop: null });
      if (r) credit(find, r);
    };
    later(ms, () => st.presentDone?.());
    if (r) d.toPanel('life:found', { ...findCard(find), isNew: r.isNew, shiny });
    if (r && shiny) {
      const big = /** @type {{ pixels: any, palette: any }} */ (gifts.sparkly(find, { big: true })); // the reveal has room for its portrait
      d.toPanel('sparkle:reveal', {
        kind: 'find', id: find.id, name: find.name, rarity: find.rarity, pixels: big.pixels, palette: big.palette,
        odds: r.odds || Math.round(1 / gifts.SPARKLE_CHANCE), after: Math.max(0, gifts.total(r.state) - 1), at: now(), level: d.level?.() || 1,
        first: !!r.firstShiny,
      });
    }
  }

  // The find counts: a stat (trophies), XP, the bond, the story, any set it finished.
  function credit(find, r) {
    const rare = find.rarity === 'rare' || find.rarity === 'legendary';
    // What the tide events' goals look at (events.js): which find, and whether it was the event's own.
    d.stat('find-made', { id: find.id, event: find.event });
    d.awardXp(rare ? 'treasure' : 'find', { label: `He found you a ${find.name.toLowerCase()}` });
    if (r.shiny) {
      d.stat('sparkle-found');
      if (find.rarity === 'legendary') d.stat('sparkle-legendary');
      d.awardXp('sparkle', { label: `A sparkly ${find.name.toLowerCase()}` });
      remember('first-shiny', { item: find.name });
    }
    grow('find');
    const bondNow = getBond();
    if (!bondNow.journal.some(e => e.kind === 'first-find')) remember('first-find', { item: find.name });
    else if (rare && r.isNew) remember('rare-find', { item: find.name });
    if (find.rarity === 'legendary') { d.stat('legendary-find'); d.burst(); }
    for (const setId of r.completed) {
      const set = /** @type {(typeof gifts.SETS)[number]} */ (gifts.SETS.find(s => s.id === setId)); // dig() only completes sets it knows
      d.stat('set-completed');
      d.awardXp('treasure', { label: `Completed the ${set.name} set` });
      remember('set-done', { set: set.name });
      d.burst();
      d.toPanel('life:moment', { eyebrow: 'Set complete', icon: set.icon, title: set.name, text: 'Every one of them, on the shelf.' });
    }
    changed();
  }

  const findCard = f => ({ id: f.id, name: f.name, rarity: f.rarity, rarityLabel: gifts.RARITY[f.rarity].label, blurb: f.blurb, pixels: f.pixels, palette: f.palette });

  /** "Dig for treasure" from his menu: a proper dig, then whatever he finds. */
  function digNow() {
    if (!gifts.canDig(getFinds(), now()) || st.presenting) return false;
    cancel();
    d.toCrab('critter:bit', { bit: 'dig', ms: DIG_MS + 400 });
    d.say('digging…', DIG_MS, 'scene');
    later(DIG_MS + 200, () => { if (!st.onCall && !d.playing?.() && !d.working?.()) dug({ manual: true }); });
    return true;
  }

  function digMenuItem() {
    const s = getFinds();
    if (gifts.canDig(s, now())) return { label: 'Dig for treasure', click: digNow };
    const mins = Math.max(1, Math.ceil((gifts.nextDigAt(s) - now()) / MINUTE));
    return { label: `Dig for treasure (in ${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`})`, enabled: false };
  }

  // stop(): no jar left waiting.
  function resetJar() {
    clearTimeout(/** @type {any} */ (jarRetry));
    jarWaiting = null;
  }

  return { dug, present, findCard, credit, presentJar, jarIfFree, digNow, digMenuItem, resetJar };
}

module.exports = { createFinds };
