// Local mode's Get button: download a preset's model into Ollama, with
// progress, a free-space check first and a cancel. Only names from the preset
// table (presets.js SIZES) are taken, so the panel can't make main fetch any
// model it likes, and only from a server on this PC. One at a time.
//
// Ollama streams POST /api/pull as NDJSON lines ({ status, completed, total });
// an aborted pull keeps its finished layers, so a retry resumes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { baseUrl, proxied } = require('./model');
const { SIZES } = require('./presets');

const GB = 1024 ** 3;
const SPARE_BYTES = 10 * GB;      // room left after the model, so the disk isn't filled to the brim
const MAX_LINE = 64 * 1024;        // a status line is tiny; anything longer isn't Ollama
const PROGRESS_EVERY_MS = 250;

/** @type {{ model: string, abort: AbortController } | null} */
let current = null;

/** Where Ollama keeps models: OLLAMA_MODELS, else ~/.ollama/models (or the nearest folder that exists). */
function modelsDir(env = process.env) {
  let dir = env.OLLAMA_MODELS || path.join(os.homedir(), '.ollama', 'models');
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  return dir;
}

/** -> free bytes on the drive models go to, or null if it can't be read. */
async function freeBytes(env = process.env) {
  try {
    const s = await fs.promises.statfs(modelsDir(env));
    return s.bavail * s.bsize;
  } catch { return null; }
}

/**
 * Whether a model can be fetched now: { ok, sizeGb } or { ok: false, error }.
 * @param {string} model @param {number | null} free
 */
function canPull(model, free) {
  const sizeGb = SIZES[model];
  if (!sizeGb) return { ok: false, error: 'Shellby only fetches the models its presets name.' };
  if (current) return { ok: false, error: `Already getting ${current.model}.` };
  if (free != null && free < sizeGb * GB + SPARE_BYTES) {
    return { ok: false, error: `${model} needs ${sizeGb} GB plus 10 GB to spare; that drive has ${Math.floor(free / GB)} GB free.` };
  }
  return { ok: true, sizeGb };
}

/** One NDJSON line -> { status, completed, total } or null. */
function parseLine(line) {
  try {
    const j = JSON.parse(line);
    if (!j || typeof j !== 'object') return null;
    if (typeof j.error === 'string') return { error: j.error.slice(0, 300) };
    return {
      status: typeof j.status === 'string' ? j.status.slice(0, 100) : '',
      completed: Number.isFinite(j.completed) ? j.completed : 0,
      total: Number.isFinite(j.total) ? j.total : 0,
    };
  } catch { return null; }
}

/**
 * Pull a preset model. Progress goes to onProgress({ model, status, completed, total }).
 * @param {{ url: string, model: string, onProgress?: (p: any) => void, fetchFn?: typeof fetch, env?: any, free?: number | null }} o
 * @returns {Promise<{ ok: boolean, error?: string, cancelled?: boolean }>}
 */
async function pull({ url: rawUrl, model, onProgress = () => {}, fetchFn = globalThis.fetch, env = process.env, free }) {
  if (proxied(env)) return { ok: false, error: 'Shellby is set to use a proxy, so it won\'t talk to a local model.' };
  const url = baseUrl(rawUrl);
  if (!url) return { ok: false, error: 'Use the address of a server on this PC.' };
  const check = canPull(model, free === undefined ? await freeBytes(env) : free);
  if (!check.ok) return check;
  const abort = new AbortController();
  current = { model, abort };
  try {
    const res = await fetchFn(`${url}/api/pull`, {
      method: 'POST', redirect: 'error', signal: abort.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
    });
    if (!res.ok || !res.body) return { ok: false, error: `${url} answered ${res.status}. Is it Ollama?` };
    return await readStream(res.body, model, onProgress);
  } catch (err) {
    if (abort.signal.aborted) return { ok: false, error: 'Stopped. Getting it again picks up where it left off.', cancelled: true };
    return { ok: false, error: `Couldn't reach ${url}. Is Ollama running?` };
  } finally {
    current = null;
  }
}

/** @param {AsyncIterable<Uint8Array>} body @param {string} model @param {(p: any) => void} onProgress @returns {Promise<{ ok: boolean, error?: string }>} */
async function readStream(body, model, onProgress) {
  const decoder = new TextDecoder();
  let buf = '';
  let last = 0;
  let done = false;
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    if (buf.length > MAX_LINE && !buf.includes('\n')) return { ok: false, error: 'The server sent something that isn\'t a download.' };
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const p = line.trim() && parseLine(line);
      if (!p) continue;
      if (p.error) return { ok: false, error: `Ollama: ${p.error}` };
      if (p.status === 'success') done = true;
      const now = Date.now();
      if (done || now - last >= PROGRESS_EVERY_MS) { last = now; onProgress({ model, ...p }); }
    }
  }
  return done ? { ok: true } : { ok: false, error: 'The download stopped before it finished. Try again to resume.' };
}

/** Stop the pull under way; true if there was one. */
function cancel() {
  if (!current) return false;
  current.abort.abort();
  return true;
}

const pulling = () => current?.model || null;

module.exports = { pull, cancel, pulling, canPull, parseLine, freeBytes, modelsDir, SPARE_BYTES };
