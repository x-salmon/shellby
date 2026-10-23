// Stopping a dev server Shellby didn't start (src/main/projects/ipc.js,
// servers:found-stop / found-adopt): only a pid from the last listing, still
// the same dev program right before taskkill, after the confirm window; the
// script only ever main's own reading; one stop at a time per pid; and no
// start in its place until it has really gone.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerProjectsIpc } = require('../src/main/projects/ipc');
const { Discovery } = require('../src/main/devservers/discover-io');

const ROOT = 'C:\\code\\site';
const listing = JSON.stringify({
  listen: [{ LocalAddress: '::', LocalPort: 5173, OwningProcess: 1002 }, { LocalAddress: '::', LocalPort: 8000, OwningProcess: 4001 }],
  procs: [
    { ProcessId: 1001, ParentProcessId: 1, Name: 'node.exe', CommandLine: 'node npm-cli.js run dev' },
    { ProcessId: 1002, ParentProcessId: 1001, Name: 'node.exe', CommandLine: 'node C:\\code\\site\\node_modules\\vite\\bin\\vite.js' },
    { ProcessId: 4001, ParentProcessId: 1, Name: 'python.exe', CommandLine: 'python C:\\code\\site\\manage.py runserver' },
  ],
});

// stubborn: a taskkill that doesn't take.
function setup({ answer = 0, stubborn = false } = {}) {
  const handlers = new Map();
  const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn) };
  const procs = new Map([[1002, { alive: true, createdAt: 500, name: 'node.exe' }], [4001, { alive: true, createdAt: 600, name: 'python.exe' }]]);
  const killed = [];
  const started = [];
  const asked = [];
  const ports = new Map([[5173, [1002]], [8000, [4001]]]);
  const d = {
    projects: () => ({ listed: new Map([[ROOT.toLowerCase(), ROOT]]), nameFor: () => 'site', knowsRoot: r => (r.toLowerCase() === ROOT.toLowerCase() ? ROOT : null) }),
    devServers: () => ({ ownPids: () => new Set(), start: a => { started.push(a); return { ok: true, server: { id: 'srv-abcdefgh' } }; } }),
    ask: spec => { asked.push(spec); return Promise.resolve(answer); },
    processInfo: pid => { const p = procs.get(pid); return p ? { alive: p.alive, createdAt: p.createdAt } : { alive: false, createdAt: null }; },
    imageOf: pid => ({ name: procs.get(pid)?.name || '', full: '' }),
    ownPids: () => new Set(),
    openExternal: () => {},
    doctor: { whoHasPort: async port => (ports.get(port) || []).filter(pid => procs.get(pid)?.alive).map(pid => ({ pid })) },
    stopProcess: async pid => { killed.push(pid); if (procs.get(pid) && !stubborn) procs.get(pid).alive = false; },
  };
  d.discovery = new Discovery({ roots: () => [{ root: ROOT, project: 'site' }], ownPids: () => new Set(), info: d.processInfo, read: async () => listing });
  registerProjectsIpc(ipcMain, d);
  const call = (ch, arg) => handlers.get(ch)({}, arg);
  return { call, procs, killed, started, asked };
}

test('stop: confirm first, then only the dev program just listed; the renderer cannot name anything else', async () => {
  const t = setup();
  assert.deepEqual(await t.call('servers:found'), [{ pid: 1002, port: 5173, program: 'node', project: 'site', script: 'dev', root: ROOT }, { pid: 4001, port: 8000, program: 'python', project: 'site', script: null, root: ROOT }]);
  // Nothing from the renderer but a pid on the list; a null or odd argument is a no, never a throw.
  for (const bad of [null, undefined, {}, { pid: 'x' }, { pid: 2 }, { pid: 999 }]) {
    const r = await t.call('servers:found-stop', bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
  assert.equal(t.killed.length, 0);
  assert.equal(t.asked.length, 0, 'no window for something that was never listed');
  const r = await t.call('servers:found-stop', { pid: 1002 });
  assert.deepEqual(r, { ok: true });
  assert.equal(t.asked.length, 1);
  assert.match(t.asked[0].title, /Stop site's server/);
  assert.deepEqual(t.killed, [1002]);
  assert.equal(t.started.length, 0);
  // Gone from the list once stopped.
  assert.match((await t.call('servers:found-stop', { pid: 1002 })).error, /isn't on the list/);
});

test('"Leave it" stops nothing', async () => {
  const t = setup({ answer: 1 });
  await t.call('servers:found');
  const r = await t.call('servers:found-stop', { pid: 1002 });
  assert.deepEqual(r, { ok: false, cancelled: true });
  assert.deepEqual(t.killed, []);
});

test('the pid must still be the dev program right before taskkill, even after the window', async () => {
  const t = setup();
  await t.call('servers:found');
  // Replaced by something else with the same pid and a start time within the slack.
  t.procs.set(1002, { alive: true, createdAt: 800, name: 'explorer.exe' });
  const r = await t.call('servers:found-stop', { pid: 1002 });
  assert.equal(r.ok, false);
  assert.deepEqual(t.killed, []);
  assert.equal(t.asked.length, 0, 'not even asked');
  // Changed while the window was open: asked, then refused.
  const t2 = setup();
  await t2.call('servers:found');
  t2.asked.push = spec => { t2.procs.set(1002, { alive: true, createdAt: 500, name: 'chrome.exe' }); return Array.prototype.push.call(t2.asked, spec); };
  const r2 = await t2.call('servers:found-stop', { pid: 1002 });
  assert.equal(r2.ok, false);
  assert.deepEqual(t2.killed, []);
  // Gone while the window was open.
  const t3 = setup();
  await t3.call('servers:found');
  t3.asked.push = spec => { t3.procs.get(1002).alive = false; return Array.prototype.push.call(t3.asked, spec); };
  assert.match((await t3.call('servers:found-stop', { pid: 1002 })).error, /already stopped/);
  assert.deepEqual(t3.killed, []);
});

test('adopt runs the script main read off the command line, never one the page sent', async () => {
  const t = setup();
  await t.call('servers:found');
  for (const bad of [{ pid: 1002, script: 'build' }, { pid: 1002, script: 'dev && calc' }, { pid: 1002 }, { pid: 1002, script: null }]) {
    const r = await t.call('servers:found-adopt', bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.match(r.error, /different script/);
  }
  // One whose script couldn't be read: no adopt at all, Stop only.
  const r0 = await t.call('servers:found-adopt', { pid: 4001, script: 'dev' });
  assert.equal(r0.ok, false);
  assert.match(r0.error, /couldn't tell which script/);
  assert.deepEqual(t.killed, []);
  const r = await t.call('servers:found-adopt', { pid: 1002, script: 'dev' });
  assert.equal(r.ok, true);
  assert.deepEqual(t.killed, [1002]);
  assert.deepEqual(t.started, [{ root: ROOT, script: 'dev', project: 'site' }]);
  assert.match(t.asked[0].title, /Run site's server in Shellby instead/);
  assert.match(t.asked[0].message, /"dev" script/);
});

test('adopt starts nothing while the old one is still there', async () => {
  const t = setup({ stubborn: true });
  await t.call('servers:found');
  const r = await t.call('servers:found-adopt', { pid: 1002, script: 'dev' });
  assert.equal(r.ok, false);
  assert.match(r.error, /didn't stop/);
  assert.deepEqual(t.killed, [1002], 'it was asked to stop');
  assert.deepEqual(t.started, [], 'but nothing started in its place');
});

test('one stop at a time per pid: a second click while the window is open is refused', async () => {
  const t = setup();
  await t.call('servers:found');
  const [a, b] = await Promise.all([t.call('servers:found-stop', { pid: 1002 }), t.call('servers:found-stop', { pid: 1002 })]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, false);
  assert.match(b.error, /already stopping/);
  assert.deepEqual(t.killed, [1002], 'killed once');
  assert.equal(t.asked.length, 1, 'one window');
});
