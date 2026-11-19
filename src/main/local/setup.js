// Local mode's setup card: what this PC has (Ollama installed? running? which
// version? any models?), what to get for its hardware, and installing Ollama
// with winget when asked (winget checks the installer's hash and signature;
// Shellby never downloads or runs one itself). Starting it is ollama.js's.
//
// status() only reads. install() is behind a button and a confirm in main (ipc/settings.js).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { baseUrl, listModels, proxied } = require('./model');
const { recommend } = require('./presets');
const { freeBytes } = require('./pull');
const { findNvidiaSmi } = require('../health/sensors');
const { findInstall } = require('./ollama');

const OLLAMA_URL = 'http://127.0.0.1:11434';
const LMSTUDIO_URL = 'http://127.0.0.1:1234';
const MIN_VERSION = [0, 14, 0]; // the first with Anthropic's /v1/messages, which local conversations need
const ASK_MS = 1500;
const INSTALL_MAX_MS = 15 * 60 * 1000;
const WINGET_ID = 'Ollama.Ollama';
const DOWNLOAD_PAGE = 'https://ollama.com/download';
const GB = 1024 ** 3;

const exists = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/** Ollama, if it's installed (ollama.js decides where it looks). */
const findOllama = (env = process.env) => findInstall(env);

/** winget, if this Windows has it. */
function findWinget(env = process.env) {
  const p = path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'WindowsApps', 'winget.exe');
  return exists(p) ? p : null;
}

/** '0.14.2' -> whether it's at least MIN_VERSION. Unparseable: assume fine. */
function newEnough(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version || '');
  if (!m) return true;
  const v = m.slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (v[i] !== MIN_VERSION[i]) return v[i] > MIN_VERSION[i];
  return true;
}

/** GET a small JSON from a server on this PC, or null. */
async function askJson(url, fetchFn) {
  try {
    const res = await fetchFn(url, { redirect: 'error', signal: AbortSignal.timeout(ASK_MS) });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length < 64 * 1024 ? JSON.parse(text) : null;
  } catch { return null; }
}

/** -> NVIDIA VRAM in GB, or null without one. */
function readVram(env = process.env) {
  const smi = findNvidiaSmi(env);
  if (!smi) return Promise.resolve(null);
  return new Promise(resolve => {
    execFile(smi, ['--query-gpu=memory.total', '--format=csv,noheader,nounits'], { timeout: 5000, windowsHide: true }, (err, out) => {
      const mb = err ? NaN : Math.max(...String(out).split(/\r?\n/).map(Number).filter(Number.isFinite));
      resolve(Number.isFinite(mb) && mb > 0 ? Math.round(mb / 1024) : null);
    });
  });
}

/** This PC's memory, GPU and free disk where models go. */
async function hardware(env = process.env) {
  const [vramGb, free] = await Promise.all([readVram(env), freeBytes(env)]);
  return { vramGb, ramGb: Math.round(os.totalmem() / GB), freeGb: free == null ? null : Math.floor(free / GB) };
}

/**
 * Where setup stands: 'none' (no Ollama), 'stopped', 'old' (too old for local
 * conversations), 'empty' (running, no models), 'ready', or 'lmstudio'.
 * @param {{ url?: string, fetchFn?: typeof fetch, env?: any, hw?: any }} [o]
 */
async function status({ url, fetchFn = globalThis.fetch, env = process.env, hw } = {}) {
  const machine = hw || await hardware(env);
  const rec = recommend(machine);
  const base = { hw: machine, rec, winget: !!findWinget(env), downloadPage: DOWNLOAD_PAGE };
  if (proxied(env)) return { ...base, state: 'proxied' };
  const ollamaUrl = baseUrl(url) || OLLAMA_URL;
  const v = await askJson(`${ollamaUrl}/api/version`, fetchFn);
  if (!v) {
    if (await askJson(`${LMSTUDIO_URL}/v1/models`, fetchFn)) return { ...base, state: 'lmstudio' };
    return { ...base, state: findOllama(env) ? 'stopped' : 'none' };
  }
  const version = typeof v.version === 'string' ? v.version.slice(0, 40) : '';
  if (!newEnough(version)) return { ...base, state: 'old', version };
  const list = await listModels(ollamaUrl, fetchFn, env);
  const models = list.ok ? list.models : [];
  return { ...base, state: models?.length ? 'ready' : 'empty', version, models: models || [] };
}

/** winget install (or upgrade) Ollama. -> { ok } or { ok: false, error }. */
function install({ upgrade = false, env = process.env } = {}) {
  const winget = findWinget(env);
  if (!winget) return Promise.resolve({ ok: false, error: 'winget isn\'t on this PC.', noWinget: true });
  const args = [upgrade ? 'upgrade' : 'install', '--id', WINGET_ID, '-e', '--silent', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'];
  return new Promise(resolve => {
    execFile(winget, args, { timeout: INSTALL_MAX_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, err => {
      if (!err) return resolve({ ok: true });
      resolve({ ok: false, error: err.killed ? 'The install took too long and was stopped.' : `winget couldn't ${upgrade ? 'update' : 'install'} Ollama (exit ${err.code}).` });
    });
  });
}

module.exports = { status, install, hardware, findOllama, findWinget, newEnough, OLLAMA_URL, WINGET_ID, DOWNLOAD_PAGE, MIN_VERSION };
