// Local mode's setup card: what this PC has (Ollama installed? running? which
// version? any models?), what to get for its hardware, and the two steps
// Shellby takes for the user when asked: installing Ollama with winget (which
// checks the installer's hash and signature; Shellby never downloads or runs
// one itself) and starting it.
//
// status() only reads. install() and start() are behind a button and, for
// install, a confirm in main (ipc/settings.js).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { baseUrl, listModels, proxied } = require('./model');
const { recommend } = require('./presets');
const { freeBytes } = require('./pull');
const { findNvidiaSmi } = require('../health/sensors');

const OLLAMA_URL = 'http://127.0.0.1:11434';
const LMSTUDIO_URL = 'http://127.0.0.1:1234';
const MIN_VERSION = [0, 14, 0]; // the first with Anthropic's /v1/messages, which local conversations need
const ASK_MS = 1500;
const START_WAIT_MS = 20000;
const START_POLL_MS = 500;
const INSTALL_MAX_MS = 15 * 60 * 1000;
const WINGET_ID = 'Ollama.Ollama';
const DOWNLOAD_PAGE = 'https://ollama.com/download';
const GB = 1024 ** 3;

const exists = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/** Ollama's tray app and CLI where the installer puts them, or nulls. */
function findOllama(env = process.env) {
  const dir = path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Ollama');
  const app = path.join(dir, 'ollama app.exe');
  const cli = path.join(dir, 'ollama.exe');
  const onPath = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean).map(d => path.join(d, 'ollama.exe')).find(exists);
  return { app: exists(app) ? app : null, cli: exists(cli) ? cli : onPath || null };
}

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
    const found = findOllama(env);
    return { ...base, state: found.app || found.cli ? 'stopped' : 'none' };
  }
  const version = typeof v.version === 'string' ? v.version.slice(0, 40) : '';
  if (!newEnough(version)) return { ...base, state: 'old', version };
  const list = await listModels(ollamaUrl, fetchFn, env);
  const models = list.ok ? list.models : [];
  return { ...base, state: models?.length ? 'ready' : 'empty', version, models: models || [] };
}

/** Start the tray app (it starts the server), then wait for it to answer. */
async function start({ fetchFn = globalThis.fetch, env = process.env, wait = START_WAIT_MS } = {}) {
  const found = findOllama(env);
  const exe = found.app || found.cli;
  if (!exe) return { ok: false, error: 'Ollama isn\'t installed.' };
  try {
    const child = spawn(exe, found.app ? [] : ['serve'], { detached: true, stdio: 'ignore', windowsHide: !found.app });
    child.on('error', () => {});
    child.unref(); // Ollama's own server: it keeps running after Shellby, as it would started by hand
  } catch { return { ok: false, error: 'Couldn\'t start Ollama.' }; }
  const until = Date.now() + wait;
  while (Date.now() < until) {
    if (await askJson(`${OLLAMA_URL}/api/version`, fetchFn)) return { ok: true };
    await new Promise(r => setTimeout(r, START_POLL_MS));
  }
  return { ok: false, error: 'Ollama started but isn\'t answering yet. Give it a moment, then check again.' };
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

module.exports = { status, start, install, hardware, findOllama, findWinget, newEnough, OLLAMA_URL, WINGET_ID, DOWNLOAD_PAGE, MIN_VERSION };
