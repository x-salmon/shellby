const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ID, PATH, either, list, matches, obj, opt, str, text } = require('../src/main/ipc-args');
const { guardIpc } = require('../src/main/ipc-guard');
const { scanMain, scanSource } = require('../scripts/lib/ipc-scan');

const ROOT = path.join(__dirname, '..');
const UNCHECKED = path.join(__dirname, 'fixtures', 'ipc-unchecked.json');

function guarded(schema) {
  const handlers = new Map();
  const seen = [];
  const refused = [];
  const raw = { handle: (c, fn) => handlers.set(c, fn), on: (c, fn) => handlers.set(c, fn) };
  const ipc = guardIpc(raw, () => true, { onRefused: c => refused.push(c) });
  ipc.handle('h', (_e, ...args) => { seen.push(args); return 'ran'; }, schema);
  ipc.on('o', (_e, ...args) => { seen.push(args); }, schema);
  return { call: (c, ...args) => handlers.get(c)({ sender: {} }, ...args), seen, refused };
}

test('str takes a non-empty string within its limits', () => {
  assert.equal(str()('a'), true);
  assert.equal(str()(''), false);
  assert.equal(str()(1), false);
  assert.equal(str({ max: 2 })('abc'), false);
  assert.equal(str({ re: /^a+$/ })('aab'), false);
});

test('text takes an empty string but not a long one', () => {
  assert.equal(text(2)(''), true);
  assert.equal(text(2)('abc'), false);
  assert.equal(text(2)(null), false);
});

test('obj checks only the fields it names, and refuses arrays and null', () => {
  const check = obj({ id: ID });
  assert.equal(check({ id: 'x', other: 1 }), true);
  assert.equal(check({}), false);
  assert.equal(check([]), false);
  assert.equal(check(null), false);
});

test('list checks every item and its length', () => {
  assert.equal(list(ID)(['a', 'b']), true);
  assert.equal(list(ID)(['a', 2]), false);
  assert.equal(list(ID, 1)(['a', 'b']), false);
  assert.equal(list(ID)('a'), false);
});

test('opt lets a missing value through and still checks a present one', () => {
  assert.equal(opt(ID)(undefined), true);
  assert.equal(opt(ID)(null), true);
  assert.equal(opt(ID)({}), false);
});

test('either takes what any of its checks takes', () => {
  const idOrInt = either(ID, Number.isInteger);
  assert.equal(idOrInt('a'), true);
  assert.equal(idOrInt(3), true);
  assert.equal(idOrInt(1.5), false);
});

test('a Windows long path fits PATH, and an object does not', () => {
  assert.equal(PATH(`C:\\${'a'.repeat(30_000)}`), true);
  assert.equal(PATH({ toString: () => 'C:\\x' }), false);
});

test('matches ignores arguments past the schema, as a handler does', () => {
  assert.equal(matches([ID], ['a', { anything: true }]), true);
  assert.equal(matches([ID, ID], ['a']), false);
});

test('a handle with fitting arguments runs', async () => {
  const g = guarded([ID]);
  assert.equal(await g.call('h', 'tab-1'), 'ran');
  assert.deepEqual(g.seen, [['tab-1']]);
  assert.deepEqual(g.refused, []);
});

test('a handle with arguments that do not fit rejects before the handler runs', async () => {
  const g = guarded([ID]);
  await assert.rejects(g.call('h', { $gt: '' }), /wasn't one Shellby accepts/);
  assert.deepEqual(g.seen, []);
  assert.deepEqual(g.refused, ['h']);
});

test('a send with arguments that do not fit is dropped before the handler runs', () => {
  const g = guarded([ID]);
  g.call('o', 42);
  assert.deepEqual(g.seen, []);
  assert.deepEqual(g.refused, ['o']);
});

test('a handler with no schema still gets whatever was sent', async () => {
  const g = guarded(undefined);
  assert.equal(await g.call('h', 42), 'ran');
});

test('the scan tells a handler that takes arguments from one that takes none', () => {
  const found = scanSource(`
    ipcMain.handle('a', () => 1);
    ipcMain.handle('b', (_e) => 1);
    ipcMain.on('c', (_e, id) => id);
    ipcMain.handle('d', (_e, { x } = {}) => x, [obj()]);
    ipcMain.on('e', someFunction);
    other.handle('f', (_e, id) => id);
  `, 'x.js');
  assert.deepEqual(found.map(f => [f.channel, f.takesArgs, f.hasSchema]), [
    ['a', false, false], ['b', false, false], ['c', true, false], ['d', true, true], ['e', true, false],
  ]);
});

test('the scan is not fooled by rest parameters or an empty schema', () => {
  const found = scanSource(`
    ipcMain.handle('a', (...args) => args);
    ipcMain.handle('b', (_e, id) => id, []);
    ipcMain.handle('c', (_e, id) => id, somewhere);
  `, 'x.js');
  assert.deepEqual(found.map(f => [f.channel, f.takesArgs, f.hasSchema]), [
    ['a', true, false], ['b', true, false], ['c', true, false],
  ]);
});

test('every handler that takes arguments has a schema, or is on the shrinking list', () => {
  const unchecked = scanMain(ROOT)
    .filter(r => r.takesArgs && !r.hasSchema && r.file !== 'src/main/ipc-guard.js')
    .map(r => r.channel || r.file);
  const listed = JSON.parse(fs.readFileSync(UNCHECKED, 'utf8'));
  const added = unchecked.filter(c => !listed.includes(c));
  const fixed = listed.filter(c => !unchecked.includes(c));
  assert.deepEqual(added, [], 'give new handlers a schema (src/main/ipc-args.js), not a place on this list');
  assert.deepEqual(fixed, [], 'these have schemas now: take them off test/fixtures/ipc-unchecked.json');
});
