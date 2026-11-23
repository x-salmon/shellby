// Settings' Start/Stop Ollama (src/main/local/ollama.js), with fakes for the
// port, the file system and the processes: nothing real is started or ended.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createOllama, findInstall, APP_EXE, SERVER_EXE } = require('../src/main/local/ollama');

const LOCAL = 'C:\\Users\\me\\AppData\\Local';
const DIR = path.join(LOCAL, 'Programs', 'Ollama');

function rig({ files = [path.join(DIR, SERVER_EXE), path.join(DIR, APP_EXE)], running = false, startsServer = true, killStops = [APP_EXE] } = {}) {
  const state = { running, spawned: [], killed: [], clock: 0 };
  const deps = {
    env: { LOCALAPPDATA: LOCAL, SystemRoot: 'C:\\Windows', PATH: '' },
    exists: p => files.includes(p),
    fetchFn: async () => { if (!state.running) throw new Error('ECONNREFUSED'); return { ok: true }; },
    spawnFn: (file, args) => { state.spawned.push([file, args]); if (startsServer) state.running = true; return { on() {}, unref() {} }; },
    execFileFn: async (file, args) => {
      state.killed.push(args[1]);
      assert.equal(file, 'C:\\Windows\\System32\\taskkill.exe');
      if (killStops.includes(args[1])) state.running = false;
    },
    sleep: async ms => { state.clock += ms; },
    now: () => state.clock,
  };
  return { state, ollama: createOllama(deps) };
}

test('finds the installer\'s folder with its tray app', () => {
  const files = [path.join(DIR, SERVER_EXE), path.join(DIR, APP_EXE)];
  assert.deepEqual(findInstall({ LOCALAPPDATA: LOCAL }, p => files.includes(p)), { app: files[1], server: files[0] });
});

test('finds ollama.exe on PATH, ignoring relative entries', { skip: process.platform !== 'win32' && 'Windows-only: ollama.exe and taskkill' }, () => {
  const exe = path.join('D:\\tools\\ollama', SERVER_EXE);
  const seen = [];
  const found = findInstall({ PATH: ['.\\bin', 'D:\\tools\\ollama'].join(path.delimiter) }, p => { seen.push(p); return p === exe; });
  assert.deepEqual(found, { app: null, server: exe });
  assert.ok(seen.every(p => path.isAbsolute(p)));
});

test('says not installed when there is no ollama.exe', async () => {
  const { ollama, state } = rig({ files: [] });
  assert.deepEqual(await ollama.status(), { installed: false, running: false });
  const r = await ollama.start();
  assert.equal(r.ok, false);
  assert.match(r.error, /isn't installed/);
  assert.equal(state.spawned.length, 0);
});

test('start opens the tray app, detached, and waits for the port', async () => {
  const { ollama, state } = rig();
  assert.deepEqual(await ollama.start(), { ok: true, running: true });
  assert.deepEqual(state.spawned, [[path.join(DIR, APP_EXE), []]]);
});

test('start runs ollama serve when there is no tray app', async () => {
  const { ollama, state } = rig({ files: [path.join(DIR, SERVER_EXE)] });
  await ollama.start();
  assert.deepEqual(state.spawned, [[path.join(DIR, SERVER_EXE), ['serve']]]);
});

test('start does nothing when it already answers', async () => {
  const { ollama, state } = rig({ running: true });
  assert.deepEqual(await ollama.start(), { ok: true, running: true });
  assert.equal(state.spawned.length, 0);
});

test('start gives up when the port never answers', async () => {
  const { ollama } = rig({ startsServer: false });
  const r = await ollama.start();
  assert.equal(r.ok, false);
  assert.equal(r.running, false);
  assert.match(r.error, /didn't answer/);
});

test('stop ends the tray app and leaves ollama.exe alone when that was enough', { skip: process.platform !== 'win32' && 'Windows-only: ollama.exe and taskkill' }, async () => {
  const { ollama, state } = rig({ running: true });
  assert.deepEqual(await ollama.stop(), { ok: true, running: false });
  assert.deepEqual(state.killed, [APP_EXE]);
});

test('stop ends a server started without the tray app', { skip: process.platform !== 'win32' && 'Windows-only: ollama.exe and taskkill' }, async () => {
  const { ollama, state } = rig({ running: true, killStops: [SERVER_EXE] });
  assert.deepEqual(await ollama.stop(), { ok: true, running: false });
  assert.deepEqual(state.killed, [APP_EXE, SERVER_EXE]);
});

test('stop says so when it still answers', async () => {
  const { ollama } = rig({ running: true, killStops: [] });
  const r = await ollama.stop();
  assert.equal(r.ok, false);
  assert.equal(r.running, true);
});

test('stop does nothing when it is not running', async () => {
  const { ollama, state } = rig();
  assert.deepEqual(await ollama.stop(), { ok: true, running: false });
  assert.equal(state.killed.length, 0);
});
