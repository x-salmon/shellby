// His life when there's no task: the part of Shellby that doesn't need Claude.
// Keeps him awake while you're at your PC (and lets him nap now and then), notices
// your day (a game you just finished, a call, a long afternoon in Excel, Friday),
// plays his little scenes, turns his digging into gifts, remembers the two of
// you, follows your cursor with his eyes, and does the talking when a friend's
// crab visits.
//
// The rules all live in pure modules (surroundings, scenes, gifts, bond, banter);
// this wires them to the clock, the screen and his window through `deps`, which
// main.js provides, so it holds no Electron objects of its own.

const surroundings = require('./surroundings');
const scenes = require('./scenes');
const gifts = require('./gifts');
const bond = require('./bond');
const voice = require('./voice');
const { createFinds } = require('./life-finds');
const { createVisit } = require('./life-visit');
const { MINUTE, WATCH_MS, TANK_REMARK_GAP, MIC_MS, LOOK_MS, HERE_IDLE_S, SCENE_EVERY, SCENE_CHANCE, RECALL_CHANCE, NAP_CHECK_MS, NAP_MS, DIG_MS, CLUMSY_MS, NEAR_PX } = require('./life-constants');

const MIC_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';

// What his claw holds for a scene that isn't a find. The renderer draws these
// from its own art (src/renderer/critter/life.js), so only the name goes over.
const BOND_LINES = Object.freeze(['', "we're pals now!", "we're buddies now!", "we're close friends now!", "we're best friends now!", "we're inseparable now!"]);

function createLife(d) {
  const now = () => d.now?.() ?? Date.now();
  /** @type {NodeJS.Timeout | null} */
  let watchTimer = null;
  /** @type {NodeJS.Timeout | null} */
  let micTimer = null;
  /** @type {NodeJS.Timeout | null} */
  let lookTimer = null;
  let track = surroundings.emptyState();
  let micBusy = false;
  let onCall = false;
  /** @type {boolean | null} */
  let forcedCall = null;          // dev/e2e: pretend you're on a call (or aren't)
  let playing = false;
  /** @type {{ id: string, timers: NodeJS.Timeout[] } | null} */
  let scene = null;              // { id, timers } while a scene plays
  /** @type {string | null} */
  let presenting = null;         // a find being held up
  /** @type {(() => void) | null} */
  let presentDone = null;        // ...and what happens when he puts it down
  let lastSceneAt = now();
  const recent = [];             // scene ids, newest last
  let napUntil = 0;
  let lastNapCheck = now();
  let lastPetAt = 0;             // no nodding off straight after a fuss
  let look = { x: 0, y: 0, near: false };
  let lookSent = '';
  /** @type {string | null} */
  let lastDay = null;
  // One-off moments queued for a little later (a find after a dig, a keepsake,
  // a line once the desktop is back). cancel() and stop() drop them all.
  const pending = new Set();
  const later = (ms, fn) => { const t = setTimeout(() => { pending.delete(t); fn(); }, ms); pending.add(t); return t; };
  const dropPending = () => { pending.forEach(clearTimeout); pending.clear(); };
  // Free for something of his own: not busy, not in a game, not in your hand.
  const free = () => d.isIdle() && !onCall && !scene && !presenting && !d.playing?.();

  // ---------------------------------------------------------------- state on disk
  const getBond = () => bond.normalize(d.config.get('bond'));
  const setBond = s => d.config.set({ bond: s });
  const getFinds = () => gifts.normalize(d.config.get('finds'));
  const setFinds = s => d.config.set({ finds: s });
  const getSeen = () => {
    const v = d.config.get('scenesSeen');
    return Array.isArray(v) ? v.filter(id => scenes.SCENES.some(s => s.id === id)) : [];
  };
  const temperament = () => d.temperament();
  // His scenes plus any from wardrobe packs, in the voice he's wearing (scenes.inVoice).
  const repertoire = () => { const g = d.dialogue?.() || {}; return scenes.inVoice(g.scenes, g.voice); };
  const chatter = () => voice.chatterOf(d.config.get('chatter'));
  const app = exe => surroundings.niceName(exe) || null;
  const changed = () => d.toPanel('life', view());

  // Down for a while (dev/e2e: beats.js dozing off and waking).
  function napFor(ms) {
    if (!free() || napUntil >= now() + ms) return; // busy, or already down for longer
    cancel();
    napUntil = now() + ms;
    d.refresh();
    later(ms + 100, () => { if (!napping()) d.touch(); d.refresh(); });
  }

  // ---------------------------------------------------------------- the bond grows
  function grow(kind) {
    const r = bond.earn(getBond(), kind, now());
    if (!r.gained && !r.milestone) { if (r.state) setBond(r.state); return r; }
    setBond(r.state);
    if (r.levelUp) {
      const up = r.levelUp;
      d.stat('bond-level', { n: up.index });
      d.awardXp('bond', { label: `You and Shellby: ${up.name}` });
      celebrate(BOND_LINES[up.index], { eyebrow: 'Closer', icon: up.icon, title: up.name, text: bond.UNLOCKS.find(u => u.level === up.index)?.text || '' });
      d.askForIdea?.(up.index); // once ever, at Buddies (feedback.js)
    }
    if (r.milestone) celebrate(bond.celebrationLine('days', { days: r.milestone }), { eyebrow: 'Together', icon: '🗓️', title: `${r.milestone} days together`, text: 'He counts. Every one of them.' });
    changed();
    return r;
  }

  function remember(kind, data) {
    const r = bond.remember(getBond(), kind, now(), data);
    if (r.added) { setBond(r.state); changed(); }
    return r.added;
  }

  // A moment worth a fuss: his line, confetti, and the panel's celebration card.
  function celebrate(line, card) {
    if (line) d.speak('milestone', { force: true, text: line.length <= voice.MAX_LINE ? line : null });
    d.burst();
    if (card) d.toPanel('life:moment', card);
  }

  // ---------------------------------------------------------------- awake while you're here
  // He used to nod off three minutes after the last task, even with you right
  // there. Now your own keyboard and mouse keep him up, and he still naps when
  // you step away (or, now and then, because he felt like it).
  function hereCheck() {
    const idleS = d.systemIdleSeconds();
    if (idleS == null) return;
    if (idleS < HERE_IDLE_S && !napping()) d.touch();
  }

  function napping() { return napUntil > now(); }

  function maybeNap() {
    const t = now();
    if (t - lastNapCheck < NAP_CHECK_MS || t - lastPetAt < 5 * MINUTE || napping() || !free()) return;
    lastNapCheck = t;
    const h = new Date(t).getHours();
    const sleepy = temperament() === 'sleepy' ? 2.2 : 1;
    const drowsy = (h >= 13 && h < 16) || h >= 23 || h < 5 ? 1.6 : 1;
    if (Math.random() > 0.1 * sleepy * drowsy) return;
    napUntil = t + NAP_MS[0] + Math.random() * (NAP_MS[1] - NAP_MS[0]);
    cancel();
    d.refresh();
    // Up again: as if you'd just moved the mouse, so he doesn't drift straight back off.
    later(napUntil - t + 100, () => { if (!napping()) d.touch(); d.refresh(); });
  }

  // Something needs him (a click, a drag, a task, a pet): the nap's over.
  function wake() {
    if (!napping()) return;
    napUntil = 0;
    d.touch();
    d.refresh();
  }

  // ---------------------------------------------------------------- your day
  function sample() {
    if (!d.native?.available?.()) return { kind: null, exe: '', micBusy };
    const info = d.native.describe(d.native.foreground());
    if (!info) return { kind: null, exe: '', micBusy };
    const own = (d.ownPids?.() || []).includes(info.pid);
    const fullscreen = d.native.notificationState() === d.native.QUNS.D3D_FULL_SCREEN;
    return { kind: own ? null : surroundings.kindOfApp({ exe: info.exe, path: info.path, fullscreen }), exe: info.exe, micBusy };
  }

  function watch() {
    if (!d.enabled()) return;
    hereCheck();
    const r = surroundings.track(track, sample(), now());
    track = r.state;
    playing = r.playing;
    setCall(forcedCall ?? r.onCall);
    for (const e of r.events) onEvent(e);
    // What kind of day it is: Friday afternoon, the weekend, Monday morning.
    const day = surroundings.dayOccasion(new Date(now()));
    if (day && d.isIdle() && !onCall) d.speak(day);
    else if (d.tankRemark && d.isIdle() && !onCall) tankRemark();
    newDay();
    maybeNap();
    jarIfFree();
  }

  // Now and then a word about his tank (tank/life.js remark). The voice's own
  // cooldown for 'tank' keeps it rare and the chatter setting applies; the
  // check here is only a time stamp until that cooldown could be over.
  let tankAfter = 0;
  function tankRemark() {
    const t = now();
    if (t < tankAfter) return;
    tankAfter = t + TANK_REMARK_GAP;
    const text = d.tankRemark();
    if (text) d.speak('tank', { text });
  }

  function setCall(on) {
    if (on === onCall) return;
    onCall = on;
    if (onCall) { cancel(); d.leavePerch?.(); }
    d.refresh();
  }

  function onEvent(e) {
    if (e.type === 'gameOver') {
      d.stat('game-watched');
      const name = app(e.exe);
      if (!getBond().journal.some(j => j.kind === 'game' && j.data.app === name)) remember('game', name ? { app: name } : {});
      // Once per game, so it gets past the gap after his last line (quiet, focus and calls still win).
      later(3000, () => d.speak('gameOver', { force: true })); // let the desktop come back first
    }
    if (e.type === 'callOver') {
      d.stat('call-hushed');
      remember('first-call');
      later(2500, () => d.speak('callOver', { force: true }));
    }
    if (e.type === 'stretch') d.speak(surroundings.occasionFor(e), { force: true }); // once per stretch
  }

  async function micCheck() {
    // Locked: nobody's on a call at this desk. Only covered or away, a call may
    // well be going on (Discord over him, a long listen), so the check goes on.
    if (!d.enabled() || !d.readMic || (d.locked ? d.locked() : d.calm())) return;
    try {
      const out = await d.readMic(MIC_KEY);
      micBusy = surroundings.micUsers(out, { own: d.ownExes?.() || [], now: now(), bootAt: d.bootAt?.() ?? null }).length > 0;
    } catch { micBusy = false; }
  }

  // Once a day: count it, and see whether it's a day worth marking.
  function newDay() {
    const t = now();
    const key = new Date(t).toDateString();
    if (key === lastDay || !d.isIdle() || onCall || d.guarding()) return;
    lastDay = key;
    grow('day');
    const special = bond.specialDay(getBond(), t);
    if (!special) return;
    const years = special === 'hatchday' ? new Date(t).getFullYear() - new Date(getBond().hatchedAt).getFullYear() : 0;
    setBond(bond.celebrate(getBond(), special, t));
    const kept = gifts.keepsake(getFinds(), special, t);
    if (kept.find) setFinds(kept.state);
    celebrate(bond.celebrationLine(special, { years }), special === 'birthday'
      ? { eyebrow: 'Happy birthday', icon: '🎂', title: 'Happy birthday!', text: 'He dug you up something special. It\'s on the shelf.', find: kept.find && findCard(kept.find) }
      : { eyebrow: 'Hatch day', icon: '🕯️', title: years > 1 ? `${years} years together` : 'One year together', text: 'A year ago today he moved onto your desktop.', find: kept.find && findCard(kept.find) });
    if (kept.find) later(3500, () => { if (free()) present(kept.find, null); });
    changed();
  }

  // ---------------------------------------------------------------- his eyes on your cursor
  // Not while he's calm (covered, hidden under a game, nobody at the desk, the
  // screen locked): nobody sees where his eyes go, and it's a poll every 280 ms.
  function lookTick() {
    if (!d.enabled() || d.calm()) return;
    const eye = d.eyePoint();
    if (!eye) return;
    const p = d.cursor();
    const dx = p.x - eye.x, dy = p.y - eye.y;
    const dist = Math.hypot(dx, dy);
    look = {
      x: Math.abs(dx) < 30 ? 0 : Math.sign(dx),
      y: dy < -70 ? -1 : dy > 50 ? 1 : 0,
      near: dist < NEAR_PX,
    };
    const key = `${look.x},${look.y},${look.near}`;
    if (key === lookSent) return;
    lookSent = key;
    d.toCrab('critter:look', look);
  }

  // ---------------------------------------------------------------- scenes and habits
  function context() {
    const t = new Date(now());
    return {
      temperament: temperament(), hour: t.getHours(), weekday: t.getDay(),
      dayOccasion: surroundings.dayOccasion(t), music: !!d.music(), cursorNear: look.near,
      hasFind: !!gifts.favourite(getFinds()), bond: bond.levelFor(getBond().points).index, seasons: d.seasons(),
    };
  }

  /**
   * An idle moment (main.js's idle loop decided he's free and it's habit time).
   * Plays a scene if one is due, else one of his everyday habits; a dig might
   * turn up a gift, and now and then he brings up a memory.
   */
  function idleBit() {
    if (scene || presenting || onCall || napping()) return true;
    const level = chatter();
    if (!voice.hasHabits(level)) return false; // quiet, or just about work
    const t = now();
    if (t - lastSceneAt >= (SCENE_EVERY[level] || SCENE_EVERY.normal) && Math.random() < SCENE_CHANCE) {
      const s = scenes.pickScene(context(), recent, Math.random, repertoire().list);
      if (s) { play(s); return true; }
    }
    const bit = voice.pickBit(voice.normalize(d.config.get('voice')).seed);
    d.toCrab('critter:bit', { bit });
    if (bit === 'dig') later(DIG_MS, () => dug());
    // A trip or a stuck claw gets a sheepish word once he's picked himself up.
    if (voice.CLUMSY_BITS.includes(bit)) { later(CLUMSY_MS, () => d.speak('oops')); return true; }
    if (Math.random() < RECALL_CHANCE && recallMemory()) return true;
    d.speak('idle');
    return true;
  }

  function recallMemory() {
    const r = bond.recall(getBond(), now(), Math.random, { throws: d.throws() });
    if (!r) return false;
    const spoken = d.speak('memory', { text: r.text });
    // Only told if he actually said it (a voice in another language says its own line).
    if (spoken?.text === r.text) setBond(r.state);
    return !!spoken;
  }

  function play(s, { force = false } = {}) {
    cancel();
    const beats = scenes.resolve(s, temperament(), Math.random, { silent: repertoire().silent(s) });
    const timers = [];
    let at = 0;
    for (const b of beats) {
      timers.push(setTimeout(() => {
        if (!force && (!d.isIdle() || onCall)) return cancel();
        d.toCrab('critter:bit', { bit: b.bit, ms: b.ms + 120, dir: look.x || null });
        d.toCrab('critter:prop', { prop: b.prop, ms: b.ms });
        d.toCrab('critter:hold', holdFor(b.hold));
        d.toCrab('critter:wear', { item: b.wear });
        if (b.say) d.say(b.say, b.ms + 400, 'scene');
      }, at));
      at += b.ms;
    }
    timers.push(setTimeout(() => { scene = null; clearProps(); }, at + 150));
    scene = { id: s.id, timers };
    lastSceneAt = now();
    recent.push(s.id);
    while (recent.length > 4) recent.shift();
    const seen = getSeen();
    // Only his own scenes count toward the Us page and Storyteller: a pack can't hand those out.
    if (scenes.SCENES.includes(s) && !seen.includes(s.id)) {
      d.config.set({ scenesSeen: [...seen, s.id] });
      d.stat('scenes-seen', { n: seen.length + 1 });
      changed();
    }
    return s.id;
  }

  function holdFor(hold) {
    if (hold === 'find') {
      const f = gifts.favourite(getFinds());
      return f ? { pixels: f.pixels, palette: f.palette } : null;
    }
    return hold ? { item: hold } : null;
  }

  function clearProps() {
    d.toCrab('critter:prop', { prop: null });
    d.toCrab('critter:hold', null);
    d.toCrab('critter:wear', { item: null });
  }

  /** Something else needs him (a task, a drag, a throw, a perch): drop what he's doing. */
  function cancel() {
    dropPending();
    if (presentDone) {
      presentDone();
      d.toCrab('critter:bit', { bit: 'none', ms: 800 });
    }
    if (scene) {
      scene.timers.forEach(clearTimeout);
      scene = null;
      d.toCrab('critter:bit', { bit: 'none', ms: 800 });
    }
    clearProps();
  }

  // He's standing in: what the parts below read and set (presenting, on a call).
  const st = {
    get presenting() { return presenting; }, set presenting(v) { presenting = v; },
    get presentDone() { return presentDone; }, set presentDone(v) { presentDone = v; },
    get onCall() { return onCall; },
  };
  const finds = createFinds(d, { now, free, napping, later, cancel, changed, getFinds, setFinds, getBond, grow, remember, st });
  const { dug, present, findCard, presentJar, jarIfFree, digNow, digMenuItem } = finds;
  const { visit } = createVisit(d, { now, temperament, getBond, getFinds, chatter, grow, remember, st });

  // ---------------------------------------------------------------- what happened elsewhere
  function onPet() {
    wake();
    lastPetAt = now();
    remember('first-pet');
    const r = grow('pet');
    if (r.gained) d.awardXp('pet');
  }

  function onStat(event, payload = {}) {
    if (event === 'thrown') remember('first-throw');
    if (event === 'perched' && payload.exe) remember('first-perch', { app: app(payload.exe) || 'a window' });
    if (event === 'shaken') {
      const name = app(payload.exe);
      const week = now() - 7 * 24 * 60 * MINUTE;
      if (!getBond().journal.some(e => e.kind === 'shaken' && e.data.app === name && e.at > week)) remember('shaken', name ? { app: name } : {});
    }
    if (event === 'ride' && payload.n >= 300) {
      grow('ride');
      const best = Math.max(0, ...getBond().journal.filter(e => e.kind === 'big-ride').map(e => e.data.px || 0));
      if (payload.n >= 1500 && payload.n > best) remember('big-ride', { app: app(payload.exe) || 'a window', px: payload.n });
    }
  }

  /** A game ended (playtime.js). */
  function played(kind, data = {}) {
    const r = grow('play');
    if (r.gained || kind) d.awardXp('play', { label: { hide: 'Played hide and seek', fetch: 'Played fetch' }[kind] || 'Played a game' });
    if (kind === 'hide' && data.foundMs != null && data.best) remember('hide-found', { ms: data.foundMs });
    if (kind === 'hide' && data.foundMs == null) remember('hide-won');
    if (kind === 'fetch') remember('first-fetch');
    changed();
  }

  // ---------------------------------------------------------------- the Us and Finds pages
  function view() {
    const t = temperament();
    const seen = getSeen();
    return {
      temperament: { id: t, ...voice.TEMPERAMENT_INFO[t] },
      bond: bond.view(getBond(), now()),
      finds: gifts.view(getFinds(), now(), { seasons: d.seasons(), ...(d.tideShelf?.() || {}) }),
      play: d.playView?.() || null,
      scenes: { seen: seen.length, of: scenes.SCENES.length, list: scenes.SCENES.map(s => ({ id: s.id, name: seen.includes(s.id) ? s.name : null })) },
      onCall, playing,
    };
  }

  function setBirthday(bd) { setBond(bond.setBirthday(getBond(), bd)); lastDay = null; changed(); return view(); }
  function setFavourite(id) { setFinds(gifts.setFavourite(getFinds(), id)); changed(); return view(); }
  function findsSeen() { setFinds(gifts.markSeen(getFinds())); changed(); }

  // ---------------------------------------------------------------- start and stop
  function start() {
    stop();
    // He moved in on your first day with Shellby, not the day this shipped.
    setBond(bond.hatch(getBond(), now(), { since: d.firstDay?.() || null }));
    watchTimer = setInterval(() => { try { watch(); } catch (e) { d.log?.(`life watch: ${e.message}`); } }, WATCH_MS);
    micTimer = setInterval(() => micCheck(), MIC_MS);
    lookTimer = setInterval(() => { try { lookTick(); } catch { /* the screen went away */ } }, LOOK_MS);
    later(5000, () => { try { watch(); } catch { /* next tick */ } });
    micCheck();
  }

  function stop() {
    for (const t of [watchTimer, micTimer, lookTimer]) if (t) clearInterval(t);
    watchTimer = micTimer = lookTimer = null;
    finds.resetJar();
    cancel();
  }

  return {
    start, stop, idleBit, cancel, onPet, onStat, played, visit, digNow, digMenuItem, view, setBirthday, setFavourite, findsSeen,
    presentJar, jarIfFree,
    remember: (kind, data) => remember(kind, data), // a moment for the journal (bond.js MEMORIES)
    changed: () => changed(), // the shelf moved under it (a swap, a hatch's gift): tell the panel
    hushed: () => onCall, onCall: () => onCall, playing: () => playing, napping, wake,
    busy: () => !!scene || !!presenting,
    lookNow: () => look,
    // The crab's page (re)loaded: send where he's looking on the next tick even if
    // it hasn't changed, since a still cursor would otherwise never send it again.
    resendLook: () => { lookSent = ''; },
    // dev/e2e
    playScene: id => { const s = repertoire().list.find(x => x.id === id); return s ? play(s, { force: true }) : null; },
    dig: dug,
    event: onEvent,
    newDayForTest: () => { lastDay = null; newDay(); },
    callForTest: on => { forcedCall = on == null ? null : !!on; setCall(!!on); },
    napForTest: ms => { napFor(ms); return napping(); }, // down now for ms (beats.js: dozing off and waking)
  };
}

module.exports = { createLife, MIC_KEY };
