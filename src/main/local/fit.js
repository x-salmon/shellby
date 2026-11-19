// Local mode's fit check: does each picked model suit this PC? A chip per
// model, from its size against GPU memory and RAM, and whether Ollama gives it
// the 32K tokens of context Claude Code needs, with "Make a 32K copy" to fix
// that. Advice only: it never blocks saving.
//
// fitOf() is pure. read() asks Ollama (/api/tags for sizes, /api/show for
// context); makeCopy() is /api/create. Loopback only, like the rest.
const { baseUrl, modelName, proxied, readJson } = require('./model');

const GB = 1024 ** 3;
const NEED_CTX = 32768;
const MAX_JSON = 2 * 1024 * 1024; // /api/show includes the template and licence
const ASK_MS = 4000;
const COPY_MS = 60000;
const COPY_SUFFIX = '-32k';

/**
 * -> { place: 'gpu' | 'ram' | 'too-big' | 'unknown', shortCtx: boolean }.
 * @param {{ sizeBytes: number | null, numCtx: number | null, vramGb: number | null, ramGb: number }} m
 */
function fitOf({ sizeBytes, numCtx, vramGb, ramGb }) {
  let place = 'unknown';
  if (sizeBytes && vramGb != null) {
    const gb = sizeBytes / GB;
    // Room for the context cache and Windows' own use of the GPU.
    if (gb <= vramGb * 0.9) place = 'gpu';
    else if (gb <= vramGb + ramGb / 2) place = 'ram';
    else place = 'too-big';
  } else if (sizeBytes && sizeBytes / GB > ramGb / 2) place = 'too-big';
  return { place, shortCtx: !numCtx || numCtx < NEED_CTX };
}

/** Ollama's own default for models that don't set one, when this PC sets it (OLLAMA_CONTEXT_LENGTH), or null. */
function serverCtx(env = process.env) {
  const n = Number(env.OLLAMA_CONTEXT_LENGTH);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Ollama's `parameters` text ("num_ctx 32768\nstop ...") -> num_ctx, or null. */
function numCtxOf(parameters) {
  const m = /(?:^|\n)\s*num_ctx\s+(\d+)/.exec(typeof parameters === 'string' ? parameters : '');
  return m ? Number(m[1]) : null;
}

async function getJson(fetchFn, url, init = {}) {
  try {
    const res = await fetchFn(url, { redirect: 'error', signal: AbortSignal.timeout(ASK_MS), ...init });
    if (!res.ok) return null;
    const r = await readJson(res, MAX_JSON);
    return r.error ? null : r.json;
  } catch { return null; }
}

/**
 * The fit of each named model on this server.
 * @param {{ url: string, models: string[], hw: { vramGb: number | null, ramGb: number }, fetchFn?: typeof fetch, env?: any }} o
 * @returns {Promise<Record<string, { place: string, shortCtx: boolean, sizeGb: number | null, numCtx: number | null }>>}
 */
async function read({ url: rawUrl, models, hw, fetchFn = globalThis.fetch, env = process.env }) {
  const url = baseUrl(rawUrl);
  if (!url || proxied(env)) return {};
  const tags = await getJson(fetchFn, `${url}/api/tags`);
  const sizes = new Map((Array.isArray(tags?.models) ? tags.models : []).map(m => [m?.name, Number(m?.size) || null]));
  const names = [...new Set(models.map(modelName).filter(Boolean))];
  const out = {};
  await Promise.all(names.map(async name => {
    const show = await getJson(fetchFn, `${url}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: name }) });
    const sizeBytes = sizes.get(name) ?? sizes.get(`${name}:latest`) ?? null;
    const numCtx = numCtxOf(show?.parameters) ?? serverCtx(env);
    out[name] = { ...fitOf({ sizeBytes, numCtx, ...hw }), sizeGb: sizeBytes ? Math.round((sizeBytes / GB) * 10) / 10 : null, numCtx };
  }));
  return out;
}

/** The copy's name: 'qwen3:8b' -> 'qwen3:8b-32k'. */
function copyName(model) {
  const m = modelName(model);
  return m ? (m.endsWith(COPY_SUFFIX) ? m : `${m}${COPY_SUFFIX}`) : '';
}

/** Make `<model>-32k`, the same model started with 32K of context. */
async function makeCopy({ url: rawUrl, model, fetchFn = globalThis.fetch, env = process.env }) {
  const url = baseUrl(rawUrl);
  const name = copyName(model);
  if (!url || !name || proxied(env)) return { ok: false, error: 'Can\'t make a copy of that one.' };
  try {
    const res = await fetchFn(`${url}/api/create`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(COPY_MS),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: name, from: modelName(model), parameters: { num_ctx: NEED_CTX }, stream: false }),
    });
    if (!res.ok) return { ok: false, error: `Ollama answered ${res.status}. Is it 0.5.5 or newer?` };
    return { ok: true, model: name };
  } catch { return { ok: false, error: 'Ollama didn\'t answer. Is it running?' }; }
}

module.exports = { fitOf, numCtxOf, serverCtx, read, makeCopy, copyName, NEED_CTX };
