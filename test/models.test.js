const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BUILT_IN, models, isModel, setFound, fromIds, helperEnv } = require('../src/main/models');
const { scanModels, readIds } = require('../src/main/claude/models-scan');
const { wireModels } = require('../src/main/wiring/models');

afterEach(() => setFound([]));

test('the picker offers the aliases and pinned releases of every family', () => {
  for (const id of ['opus', 'sonnet', 'haiku', 'claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-haiku-4-5']) assert.ok(isModel(id), id);
});

test('Claude Code default is always allowed; anything not listed is refused', () => {
  assert.ok(isModel(''));
  for (const bad of ['claude-mythos-5-1', 'claude-3-opus-20240229', 'gpt-4', '--dangerously-skip-permissions', undefined, null, 5]) assert.ok(!isModel(bad), String(bad));
});

test('model ids are unique and every entry has a group and a label', () => {
  setFound(['claude-opus-6', 'claude-nova-6-1']);
  for (const list of [BUILT_IN, models()]) {
    assert.equal(new Set(list.map(m => m.id)).size, list.length);
    for (const m of list) assert.ok(m.group && m.label && /^[a-z0-9-]+$/.test(m.id), m.id);
  }
});

test('only releases newer than the built-in ones of their family are added', () => {
  const ids = fromIds([
    'claude-opus-6', 'claude-fable-5-3', 'claude-opus-5-5', // new, new, already built in
    'claude-opus-4-1', 'claude-sonnet-4-0', 'claude-sonnet-3-7', 'claude-opus-4', // retired
    'claude-mythos-5-3', 'claude-sonnet-4-5-20250929', 'claude-opus-6-0-preview', 42, null, // hidden, snapshot, odd
  ]).map(m => m.id);
  assert.deepEqual(ids, ['claude-opus-6', 'claude-fable-5-3']);
});

test('a new family is added from the newest generation on, labelled from its id', () => {
  assert.deepEqual(fromIds(['claude-nova-4-9', 'claude-nova-5-1']), [{ group: 'Nova', id: 'claude-nova-5-1', label: 'Nova 5.1' }]);
  assert.deepEqual(fromIds('claude-opus-6'), [], 'not a list');
});

test('found models go to the top of their family, and isModel accepts them', () => {
  assert.equal(isModel('claude-opus-6'), false);
  assert.equal(setFound(['claude-opus-6', 'claude-nova-6']), true);
  assert.ok(isModel('claude-opus-6') && isModel('claude-nova-6'));
  const ids = models().map(m => m.id);
  assert.equal(ids.indexOf('claude-opus-6') + 1, ids.indexOf('claude-opus-5-5'));
  assert.equal(ids.indexOf('claude-nova-6'), ids.indexOf('haiku') + 1, 'a new family comes after Latest');
  assert.equal(setFound(['claude-opus-6', 'claude-nova-6']), false, 'same again: no change');
  assert.equal(setFound([]), true);
  assert.equal(models(), BUILT_IN);
});

test("helpers' model goes to Claude Code as its variable, unless this PC already sets one", () => {
  assert.deepEqual(helperEnv('sonnet', {}), { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' });
  assert.deepEqual(helperEnv('', {}), {}, 'same as the conversation: nothing set');
  assert.deepEqual(helperEnv('gpt-4', {}), {}, 'not a model Shellby offers');
  assert.deepEqual(helperEnv('sonnet', { CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' }), {}, 'yours wins');
});

test('the CLI file is read for quoted ids, including one split across chunks', async () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-models-')));
  try {
    const exe = path.join(dir, 'claude.exe');
    const pad = Buffer.alloc(4 * 1024 * 1024 - 8, 0); // the id straddles the first 4 MB chunk
    fs.writeFileSync(exe, Buffer.concat([pad, Buffer.from('x="claude-opus-6"\0"claude-fable-5-3",claude-bare-9')]));
    assert.deepEqual((await readIds(exe)).sort(), ['claude-fable-5-3', 'claude-opus-6']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the scan is kept until the CLI file changes', async () => {
  let reads = 0;
  const read = async () => { reads++; return ['claude-opus-6']; };
  const stat = async () => ({ size: 10, mtimeMs: 5 });
  assert.equal(await scanModels(null, null, { read, stat }), null);
  const first = await scanModels('C:\\claude.exe', null, { read, stat });
  assert.deepEqual(first, { exe: 'C:\\claude.exe', size: 10, mtimeMs: 5, ids: ['claude-opus-6'] });
  assert.equal(await scanModels('C:\\claude.exe', first, { read, stat }), first);
  await scanModels('C:\\claude.exe', first, { read, stat: async () => ({ size: 11, mtimeMs: 5 }) });
  assert.equal(reads, 2);
});

function shared(settings = {}) {
  const store = { ...settings };
  const sent = [];
  return {
    store, sent,
    config: { get: k => store[k], set: patch => Object.assign(store, patch) },
    claudeStatus: { exe: 'C:\\claude.exe' },
    panel: {},
    send: (_w, channel, payload) => sent.push({ channel, payload }),
    log: { warn: () => {} },
  };
}

test('wiring: last answer applies at once; a scan saves, updates the list and tells the panel', async () => {
  const d = shared({ cliModels: { exe: 'C:\\claude.exe', size: 1, mtimeMs: 1, ids: ['claude-opus-6'] } });
  const found = { exe: 'C:\\claude.exe', size: 2, mtimeMs: 2, ids: ['claude-opus-6', 'claude-sonnet-6'] };
  const { refreshModels } = wireModels(d, { scan: async () => found });
  assert.ok(isModel('claude-opus-6'), 'cached before any scan');
  await refreshModels();
  assert.equal(d.store.cliModels, found);
  assert.ok(isModel('claude-sonnet-6'));
  assert.equal(d.sent.length, 1);
  assert.equal(d.sent[0].channel, 'models:changed');
  await refreshModels();
  assert.equal(d.sent.length, 1, 'nothing new: the panel is left alone');
});

test('wiring: a failed read is logged, and the fake CLI keeps the built-in list', async () => {
  const d = shared();
  const warned = [];
  d.log.warn = (...a) => warned.push(a);
  await wireModels(d, { scan: async () => { throw new Error('EBUSY'); } }).refreshModels();
  assert.equal(warned.length, 1);
  const fake = { ...shared({ cliModels: { ids: ['claude-opus-6'] } }), FAKE_CLI: true };
  await wireModels(fake, { scan: async () => { throw new Error('not called'); } }).refreshModels();
  assert.equal(isModel('claude-opus-6'), false);
});
