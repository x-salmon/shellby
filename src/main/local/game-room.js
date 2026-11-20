// Local models make room for a game.
//
// A local model sits in graphics memory for as long as Ollama keeps it (30
// minutes after its last use, and Shellby keeps the quick one loaded too), and
// a game wants that memory more than an idle model does. When Shellby gives way
// to a game (wiring/windows.js giveWayToGame), this asks Ollama to unload the
// models Shellby uses that are loaded but not working; when the game has gone,
// it loads the ones an open local conversation runs on again, so the next
// message there doesn't wait on a load.
//
// Only Shellby's own models are touched (the ones named in Settings → Local
// model): something else you run on Ollama is yours. Nothing is unloaded while
// a local conversation is mid-turn; it's tried again on the next poll. LM Studio
// has no /api/ps, so it's left alone. Off with localModel.makeRoom: false.
//
// createGameRoom takes fetch, the settings, the open conversations and the clock
// injected (test/local-game-room.test.js).
const { baseUrl, modelName } = require('./model');

const PS_TIMEOUT_MS = 5000;
const UNLOAD_TIMEOUT_MS = 15000;
const LOAD_TIMEOUT_MS = 120000; // loading from disk takes a while; nothing waits on it
const KEEP_LOADED = '30m';      // as local/ollama.js keepLoaded

/** Every model name Shellby's local settings use. @param {any} lm localModel as saved @returns {Set<string>} */
function ourModels(lm) {
  const names = [lm?.model, lm?.answers?.model, lm?.agent?.model, lm?.agent?.helpers, lm?.agent?.quick,
    ...Object.values(lm?.models && typeof lm.models === 'object' ? lm.models : {})];
  return new Set(names.map(modelName).filter(Boolean));
}

/** Same model, with or without Ollama's ":latest". @param {string} a @param {string} b */
const sameModel = (a, b) => a === b || a.replace(/:latest$/, '') === b.replace(/:latest$/, '');

/**
 * What Ollama has loaded: [{ name, vram }] (vram in bytes), or null when it
 * doesn't say (not running, or LM Studio).
 * @param {string} url @param {typeof fetch} fetchFn
 * @returns {Promise<{ name: string, vram: number }[] | null>}
 */
async function loadedModels(url, fetchFn) {
  try {
    const r = await fetchFn(`${url}/api/ps`, { redirect: 'error', signal: AbortSignal.timeout(PS_TIMEOUT_MS) });
    if (!r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j?.models)) return null;
    return j.models
      .filter(m => typeof m?.name === 'string')
      .map(m => ({ name: m.name, vram: Number.isFinite(m.size_vram) && m.size_vram > 0 ? m.size_vram : 0 }));
  } catch { return null; }
}

/** Ask Ollama to load (keep: '30m') or unload (keep: 0) one model. @returns {Promise<boolean>} */
async function setKeep(url, name, keep, fetchFn, timeoutMs) {
  try {
    const r = await fetchFn(`${url}/api/generate`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: name, keep_alive: keep }),
    });
    return r.ok;
  } catch { return false; }
}

/**
 * @typedef {{ at: number, models: string[], bytes: number }} Room what was freed, and when
 * @param {{
 *   settings: () => any,
 *   targets: () => { url: string, model: string, quick?: string }[],
 *   busy: () => boolean,
 *   fetchFn?: typeof fetch,
 *   now?: () => number,
 *   log?: { info: (msg: string) => void },
 *   onRoom?: (room: Room) => void,
 * }} deps
 */
function createGameRoom({ settings, targets, busy, fetchFn = globalThis.fetch, now = Date.now, log, onRoom }) {
  let gaming = false;
  let done = false;      // this game's room is made (or there was nothing to free)
  let working = false;   // a free or a restore in flight: polls don't stack up
  /** @type {{ url: string } | null} */
  let freed = null;      // something was unloaded for this game: load back when it's over
  /** @type {Room | null} */
  let last = null;

  async function makeRoom() {
    const lm = settings();
    const url = baseUrl(lm?.url);
    if (lm?.makeRoom === false || !url) { done = true; return; }
    if (busy()) return; // a local turn is running: next poll
    const loaded = await loadedModels(url, fetchFn);
    if (!loaded) { done = true; return; }
    const ours = [...ourModels(lm)];
    const idle = loaded.filter(m => ours.some(o => sameModel(m.name, o)));
    done = true;
    if (!idle.length) return;
    const unloaded = [];
    for (const m of idle) if (await setKeep(url, m.name, 0, fetchFn, UNLOAD_TIMEOUT_MS)) unloaded.push(m);
    if (!unloaded.length) return;
    freed = { url };
    last = { at: now(), models: unloaded.map(m => m.name), bytes: unloaded.reduce((n, m) => n + m.vram, 0) };
    log?.info(`Made room for a game: unloaded ${last.models.join(', ')}`);
    onRoom?.(last);
  }

  async function loadBack() {
    const was = freed;
    freed = null;
    if (!was || settings()?.makeRoom === false) return;
    const names = new Set();
    for (const t of targets()) {
      if (baseUrl(t?.url) !== was.url) continue;
      for (const n of [t.model, t.quick]) if (modelName(n)) names.add(modelName(n));
    }
    for (const n of names) await setKeep(was.url, n, KEEP_LOADED, fetchFn, LOAD_TIMEOUT_MS);
    if (names.size) log?.info(`Game over: loaded ${[...names].join(', ')} again`);
  }

  /** Every game poll: whether Shellby is giving way to one right now. @param {boolean} on */
  async function update(on) {
    if (working) return;
    working = true;
    try {
      if (on && !gaming) { gaming = true; done = false; }
      if (on && !done) await makeRoom();
      if (!on && gaming) { gaming = false; await loadBack(); }
    } finally { working = false; }
  }

  return { update, view: () => last, gaming: () => gaming };
}

module.exports = { createGameRoom, ourModels, loadedModels, sameModel, KEEP_LOADED };
