// Dev servers in workflows (src/main/devservers/flow.js): the trigger's data,
// and the step's start / stop / restart over a fake DevServers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { serverEvent, serverStep } = require('../src/main/devservers/flow');

const ROOT = path.resolve('C:\\code\\site');
const OTHER = path.resolve('C:\\code\\other');

function setup({ servers = [], last = null, scripts = [{ name: 'dev', likely: true }, { name: 'build', likely: false }], settle = s => ({ ...s, status: 'up', port: 5173, url: 'http://localhost:5173/' }) } = {}) {
  const calls = [];
  const list = servers.map((s, i) => ({ id: `srv-${i}`, kind: 'server', status: 'up', project: 'site', root: ROOT, script: 'dev', startedAt: i, ...s }));
  const fake = {
    view: () => ({ servers: list }),
    lastScript: root => (path.resolve(root) === ROOT ? last : null),
    start: ({ root, script, project }) => { calls.push(['start', root, script, project]); const s = { id: 'srv-new', kind: 'server', status: 'starting', project, root, script, port: null, url: null }; list.push(s); return { ok: true, server: s }; },
    stop: async id => { calls.push(['stop', id]); return { ok: true }; },
    restart: async id => { calls.push(['restart', id]); const s = list.find(x => x.id === id); s.status = 'starting'; return { ok: true, server: s }; },
    settled: async id => { calls.push(['settled', id]); const s = list.find(x => x.id === id); return s ? settle(s) : null; },
  };
  const projects = {
    site: { key: 'local:site', name: 'site', local: [{ root: ROOT }, { root: OTHER }] },
    cloud: { key: 'github:me/cloud', name: 'cloud', local: [] },
  };
  const deps = {
    servers: fake,
    resolve: async ({ project }) => (projects[project] ? { project: projects[project] } : { error: `No project called "${project}" on Shellby's Projects page.` }),
    readScripts: root => (path.resolve(root) === ROOT ? { scripts } : null),
  };
  return { deps, calls, list };
}

test('a server event becomes the trigger data', () => {
  assert.deepEqual(serverEvent('crashed', { project: 'site', script: 'dev', port: 5173, url: 'http://localhost:5173/', exitCode: 1, root: ROOT, framework: 'vite', pid: 4 }), {
    event: 'crashed', project: 'site', script: 'dev', port: 5173, url: 'http://localhost:5173/', exitCode: 1, root: ROOT, framework: 'vite',
  });
  assert.deepEqual(serverEvent('up', { project: 'site', script: 'start', root: ROOT }), {
    event: 'up', project: 'site', script: 'start', port: null, url: null, exitCode: null, root: ROOT, framework: null,
  });
});

test('start: the script named, else the last one run, else the likeliest, then waits for up', async () => {
  const t = setup({ last: 'serve' });
  const r = await serverStep(t.deps, { action: 'start', project: 'site' });
  assert.deepEqual(r, { ok: true, status: 'up', port: 5173, url: 'http://localhost:5173/', project: 'site', script: 'serve' });
  assert.deepEqual(t.calls, [['start', ROOT, 'serve', 'site'], ['settled', 'srv-new']]);

  const named = setup({ last: 'serve' });
  await serverStep(named.deps, { action: 'start', project: 'site', script: 'dev' });
  assert.equal(named.calls[0][2], 'dev');

  const likely = setup();
  await serverStep(likely.deps, { action: 'start', project: 'site' });
  assert.equal(likely.calls[0][2], 'dev', 'the likely script, never build');

  const none = setup({ scripts: [{ name: 'build', likely: false }] });
  assert.match((await serverStep(none.deps, { action: 'start', project: 'site' })).error, /no dev script/);
});

test('a crash on the way up, an unknown project and one not cloned here all fail the step', async () => {
  const t = setup({ settle: s => ({ ...s, status: 'crashed', exitCode: 1, neverUp: true }) });
  assert.match((await serverStep(t.deps, { action: 'start', project: 'site' })).error, /didn't start \(exit code 1\)/);
  assert.match((await serverStep(t.deps, { action: 'start', project: 'nope' })).error, /No project called "nope"/);
  assert.match((await serverStep(t.deps, { action: 'restart', project: 'cloud' })).error, /isn't cloned on this PC/);
  const gone = setup({ settle: () => null });
  assert.match((await serverStep(gone.deps, { action: 'start', project: 'site' })).error, /went away/);
});

test('stop ends every live server of the project (or just the script named); nothing live is fine', async () => {
  const t = setup({ servers: [{ script: 'dev' }, { script: 'storybook', root: OTHER }, { script: 'old', status: 'crashed' }] });
  const r = await serverStep(t.deps, { action: 'stop', project: 'site' });
  assert.deepEqual(r, { ok: true, status: 'stopped', port: null, url: null, project: 'site', script: 'dev' });
  assert.deepEqual(t.calls, [['stop', 'srv-0'], ['stop', 'srv-1']], 'the crashed one is left alone');

  const one = setup({ servers: [{ script: 'dev' }, { script: 'storybook' }] });
  await serverStep(one.deps, { action: 'stop', project: 'site', script: 'Storybook' });
  assert.deepEqual(one.calls, [['stop', 'srv-1']]);

  const idle = setup();
  assert.deepEqual(await serverStep(idle.deps, { action: 'stop', project: 'site' }), { ok: true, status: 'stopped', port: null, url: null, project: 'site', script: null });
  assert.deepEqual(idle.calls, []);
});

test('restart picks the newest live server, else the newest known one, else starts afresh', async () => {
  const t = setup({ servers: [{ script: 'dev', startedAt: 1 }, { script: 'dev', root: OTHER, startedAt: 2 }] });
  const r = await serverStep(t.deps, { action: 'restart', project: 'site' });
  assert.equal(r.ok, true);
  assert.deepEqual(t.calls, [['restart', 'srv-1'], ['settled', 'srv-1']]);

  const crashed = setup({ servers: [{ script: 'dev', status: 'crashed' }] });
  await serverStep(crashed.deps, { action: 'restart', project: 'site', script: 'dev' });
  assert.deepEqual(crashed.calls[0], ['restart', 'srv-0']);

  const fresh = setup({ servers: [{ script: 'dev', status: 'crashed' }] });
  await serverStep(fresh.deps, { action: 'restart', project: 'site', script: 'preview' });
  assert.deepEqual(fresh.calls[0], ['start', ROOT, 'preview', 'site'], 'no server of that script yet: a start');
});
