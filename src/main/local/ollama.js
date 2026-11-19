// Starting and stopping Ollama from Settings → Local model, for when it was
// quit from its tray icon (or never started with Windows) and Detect finds
// nothing.
//
// Start opens Ollama the way its own CLI does when the server is down: the tray
// app ("ollama app.exe"), which runs the server, keeps its icon and updates.
// Without the app (a Scoop or zip install), `ollama.exe serve` runs on its own.
// Stop ends the tray app's tree, then any server still answering, as the
// tray's Quit would.
//
// Whether it's running is read from the port, never from process names: that's
// what the rest of Shellby asks (local/model.js), and a server someone started
// in a terminal counts too.

const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

const URL_BASE = 'http://127.0.0.1:11434'; // local/model.js SERVERS' Ollama
const PING_MS = 1500;
const POLL_MS = 500;
const START_WAIT_MS = 20000; // finding the GPU took ~9 s on a 3080 Ti, and a first start does more
const STOP_WAIT_MS = 8000;
const APP_EXE = 'ollama app.exe';
const SERVER_EXE = 'ollama.exe';

/**
 * Where Ollama is installed, or null. Its installer puts both exes in
 * %LOCALAPPDATA%\Programs\Ollama; other installs only need ollama.exe on PATH.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {(p: string) => boolean} [exists]
 * @returns {{ app: string | null, server: string } | null}
 */
function findInstall(env = process.env, exists = fs.existsSync) {
  const dirs = [
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'Ollama'),
    env.ProgramFiles && path.join(env.ProgramFiles, 'Ollama'),
    // Only absolute PATH entries: a relative one would mean wherever Shellby happens to be.
    ...String(env.PATH || env.Path || '').split(path.delimiter).map(d => d.trim().replace(/^"|"$/g, '')).filter(d => path.isAbsolute(d)),
  ].filter(Boolean);
  for (const dir of /** @type {string[]} */ (dirs)) {
    const server = path.join(dir, SERVER_EXE);
    if (!exists(server)) continue;
    const app = path.join(dir, APP_EXE);
    return { app: exists(app) ? app : null, server };
  }
  return null;
}

/**
 * Whether an Ollama server answers on its usual port.
 * @param {typeof fetch} [fetchFn]
 */
async function answers(fetchFn = globalThis.fetch) {
  try {
    const res = await fetchFn(`${URL_BASE}/api/version`, { redirect: 'error', signal: AbortSignal.timeout(PING_MS) });
    return !!res.ok;
  } catch {
    return false;
  }
}

/**
 * Ollama started from Settings and stopped from it.
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   exists?: (p: string) => boolean,
 *   fetchFn?: typeof fetch,
 *   spawnFn?: typeof spawn,
 *   execFileFn?: (file: string, args: string[]) => Promise<void>,
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => number,
 *   log?: any,
 * }} [deps]
 */
function createOllama(deps = {}) {
  const {
    env = process.env, exists = fs.existsSync, fetchFn = globalThis.fetch, spawnFn = spawn,
    execFileFn = runQuietly, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, log = null,
  } = deps;
  let busy = false;

  const taskkill = path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'); // by full path, never whatever's on PATH

  /** Wait until answers() is `want`, or the time is up. -> whether it got there. */
  async function until(want, maxMs) {
    const end = now() + maxMs;
    for (;;) {
      if (await answers(fetchFn) === want) return true;
      if (now() >= end) return false;
      await sleep(POLL_MS);
    }
  }

  /** -> { installed, running } for Settings. */
  async function status() {
    return { installed: !!findInstall(env, exists), running: await answers(fetchFn) };
  }

  /** -> { ok: true, running: true } or { ok: false, running, error } in words for the panel. */
  async function start() {
    if (busy) return { ok: false, running: await answers(fetchFn), error: 'Still working on the last one.' };
    busy = true;
    try {
      if (await answers(fetchFn)) return { ok: true, running: true };
      const install = findInstall(env, exists);
      if (!install) return { ok: false, running: false, error: 'Ollama isn\'t installed on this PC.' };
      const [file, args] = install.app ? [install.app, []] : [install.server, ['serve']];
      try {
        const child = spawnFn(file, args, { detached: true, stdio: 'ignore', windowsHide: true, cwd: path.dirname(file) });
        child.on?.('error', err => log?.warn?.(`ollama start: ${err?.message || err}`));
        child.unref?.();
      } catch (err) {
        log?.warn?.(`ollama start: ${/** @type {any} */ (err)?.message || err}`);
        return { ok: false, running: false, error: 'Couldn\'t start Ollama.' };
      }
      if (await until(true, START_WAIT_MS)) return { ok: true, running: true };
      return { ok: false, running: false, error: `Ollama didn't answer within ${START_WAIT_MS / 1000} s. It may still be starting.` };
    } finally {
      busy = false;
    }
  }

  /** -> { ok: true, running: false } or { ok: false, running, error } in words for the panel. */
  async function stop() {
    if (busy) return { ok: false, running: await answers(fetchFn), error: 'Still working on the last one.' };
    busy = true;
    try {
      if (!(await answers(fetchFn))) return { ok: true, running: false };
      // The tray app and everything it started (server, model runners)...
      await execFileFn(taskkill, ['/IM', APP_EXE, '/T', '/F']).catch(() => { /* not running: started some other way */ });
      // ...then a server started some other way (ollama serve in a terminal).
      if (!(await until(false, POLL_MS * 2))) {
        await execFileFn(taskkill, ['/IM', SERVER_EXE, '/T', '/F']).catch(() => { /* already gone */ });
      }
      if (await until(false, STOP_WAIT_MS)) return { ok: true, running: false };
      return { ok: false, running: true, error: 'Ollama is still answering. It may be running as another user or a service.' };
    } finally {
      busy = false;
    }
  }

  return { status, start, stop };
}

/** execFile as a promise, output thrown away. @param {string} file @param {string[]} args */
function runQuietly(file, args) {
  return new Promise(/** @type {(resolve: (v?: void) => void, reject: (e: Error) => void) => void} */ ((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 10000 }, err => (err ? reject(err) : resolve()));
  }));
}

const KEEP_LOADED = '30m';
const KEEP_ASK_MS = 120000; // loading a model from disk takes a while; nothing waits on it

/**
 * Load a local conversation's quick model next to its main one, so Claude Code's
 * small calls (titles, summaries, checks) don't unload the big model each time.
 * An empty /api/generate loads a model without asking it anything. Only when the
 * quick model differs; Ollama keeps both if OLLAMA_MAX_LOADED_MODELS and memory
 * allow, else it's a no-op that costs nothing. LM Studio answers 404: ignored.
 * @param {{ url: string, model: string, quick?: string }} target local/agent.js's
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<boolean>} whether it was asked
 */
async function keepLoaded(target, fetchFn = globalThis.fetch) {
  const { baseUrl, modelName } = require('./model');
  const url = baseUrl(target?.url);
  const quick = modelName(target?.quick);
  if (!url || !quick || quick === target.model) return false;
  try {
    await fetchFn(`${url}/api/generate`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(KEEP_ASK_MS),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: quick, keep_alive: KEEP_LOADED }),
    });
    return true;
  } catch { return false; }
}

module.exports = { keepLoaded, createOllama, findInstall, answers, URL_BASE, START_WAIT_MS, STOP_WAIT_MS, APP_EXE, SERVER_EXE };
