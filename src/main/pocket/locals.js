// The local models a phone can start a task on: the desk's model chip's "On
// this PC" (renderer/panel/composer.js localNames), the same names. Settings'
// model and the agent's come first, then what the server says it has, asked
// at most once a minute and only while the phone looks (the view is built
// every few seconds). A new answer calls onChange, so the phone hears of it.

const localModel = require('../local/model');

const REFRESH_MS = 60 * 1000;
const MAX_LOCALS = 40;

/**
 * The names to offer, or none when no local server is set up (or Shellby is
 * behind a proxy, where it never uses one).
 * @param {any} saved config's localModel
 * @param {string[]} [found] what the server listed
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function namesFrom(saved, found = [], env = process.env) {
  if (!saved || typeof saved !== 'object' || !localModel.baseUrl(saved.url) || localModel.proxied(env)) return [];
  const all = [saved.agent?.model, saved.model, ...(Array.isArray(found) ? found : [])].map(localModel.modelName).filter(Boolean);
  return [...new Set(all)].slice(0, MAX_LOCALS);
}

/**
 * @param {{ settings: () => any, list?: (url: string) => Promise<any>, onChange?: () => void, now?: () => number, env?: NodeJS.ProcessEnv, log?: any }} deps
 */
function createLocals({ settings, list = localModel.listModels, onChange = () => {}, now = Date.now, env = process.env, log = null }) {
  let found = { url: '', models: /** @type {string[]} */ ([]) };
  let askedAt = -Infinity;
  let asking = false;

  async function refresh(url) {
    asking = true;
    askedAt = now();
    try {
      const r = await list(url);
      if (!r?.ok || !Array.isArray(r.models)) return;
      const before = found.url === url ? found.models.join('\n') : null;
      found = { url, models: r.models };
      if (r.models.join('\n') !== before) onChange();
    } catch (err) {
      log?.info?.(`pocket: local models: ${err?.message || err}`);
    } finally {
      asking = false;
    }
  }

  /** What to offer now; asks the server again when it's been a while. */
  function names() {
    const saved = settings();
    const url = localModel.baseUrl(saved?.url);
    if (url && !asking && now() - askedAt >= REFRESH_MS) refresh(url);
    return namesFrom(saved, found.url === url ? found.models : [], env);
  }

  /** Whether a phone's pick is one offered. */
  const has = (/** @type {unknown} */ name) => typeof name === 'string' && !!name && names().includes(name);

  /**
   * A phone task's model: { on } a Claude id isModel takes, { onPc } a local
   * one offered here, neither for the desk's own, or { error } in words.
   * A local one starts now: it spends nothing of the plan, so there's no reset to wait for.
   * runOn: the options a start takes for it ({ model } or { local }, or none).
   * @param {{ model?: unknown, local?: unknown, when?: unknown }} body
   * @param {(id: string) => boolean} isModel
   * @returns {{ on: string | null, onPc: string | null, runOn: { model?: string, local?: string }, error?: string }}
   */
  function pick({ model, local, when }, isModel) {
    const on = typeof model === 'string' && model ? model : null;
    const onPc = typeof local === 'string' && local ? local : null;
    const out = { on, onPc, runOn: { ...(on ? { model: on } : {}), ...(onPc ? { local: onPc } : {}) } };
    if (on && !isModel(on)) return { ...out, error: "Shellby doesn't know that model. Pick one from the list." };
    if (!onPc) return out;
    if (on) return { ...out, error: 'Pick a Claude model or a local one, not both.' };
    if (!has(onPc)) return { ...out, error: "That local model isn't set up on your PC any more. Pick one from the list." };
    if (when) return { ...out, error: 'A local model doesn’t use your plan, so it starts now. Leave When on Now.' };
    return out;
  }

  return { names, has, pick };
}

module.exports = { createLocals, namesFrom, REFRESH_MS, MAX_LOCALS };
