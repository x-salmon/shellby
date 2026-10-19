// Shellby on your phone, past the beach (pocket/extras.js): focus, routines,
// notes, the wardrobe, and a conversation's files, read-only, never outside
// its folder and never a file that may hold secrets.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPocketExtras } = require('../src/main/pocket/extras');
const notes = require('../src/main/notes');

function folder() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-extras-')));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'const a = 1;\n');
  fs.writeFileSync(path.join(root, '.env'), 'TOKEN=secret\n');
  fs.writeFileSync(path.join(root, 'blob.bin'), Buffer.from([1, 0, 2]));
  fs.writeFileSync(path.join(path.dirname(root), 'outside.txt'), 'nope');
  return root;
}

function extrasFor({ root = null, allow = true, config = {} } = {}) {
  const rec = [];
  const store = { ...config };
  const d = {
    config: { get: k => store[k], set: p => Object.assign(store, p) },
    startFocus: m => rec.push(['startFocus', m]),
    stopFocus: () => rec.push(['stopFocus']),
    notesView: async () => ({ general: notes.normalize(store.notes).general, projects: [], current: null }),
    saveNotes: async next => { store.notes = next; },
    knownNoteProject: async () => null,
    randomUUID: () => `id${rec.length}`,
  };
  const x = createPocketExtras(d, { allowed: () => allow, tabRoot: id => (id === 't1' ? root : null) });
  return { x, rec, store };
}

test('focus starts for 15, 25 or 50 minutes only, and stops', async () => {
  const { x, rec } = extrasFor();
  assert.equal((await x.actions.focus({ minutes: 40 })).ok, false);
  assert.equal((await x.actions.focus({ minutes: 25 })).ok, true);
  assert.equal((await x.actions.focus({ stop: true })).ok, true);
  assert.deepEqual(rec, [['startFocus', 25], ['stopFocus']]);
});

test('a note from the phone goes on General as yours, and can be ticked off', async () => {
  const { x, store } = extrasFor();
  assert.equal((await x.actions['note-add']({ project: notes.GENERAL, text: '  ' })).ok, false);
  assert.equal((await x.actions['note-add']({ project: notes.GENERAL, text: 'Try dark mode' })).ok, true);
  const [n] = store.notes.general;
  assert.equal(n.from, 'you');
  assert.equal((await x.actions['note-tick']({ project: notes.GENERAL, id: n.id, done: true })).ok, true);
  assert.equal(store.notes.general[0].done, true);
  assert.equal((await x.actions['note-tick']({ project: notes.GENERAL, id: 'gone', done: true })).ok, false);
});

test('files are off until Settings allows them', async () => {
  const { x } = extrasFor({ root: folder(), allow: false });
  assert.match((await x.actions.files({ tabId: 't1', dir: '' })).error, /off/);
});

test('a folder lists without node_modules or secrets, and a file reads as text', async () => {
  const { x } = extrasFor({ root: folder() });
  const list = await x.actions.files({ tabId: 't1', dir: '' });
  assert.equal(list.ok, true);
  assert.deepEqual(list.entries.map(e => e.name), ['src', 'blob.bin']);
  const f = await x.actions.file({ tabId: 't1', file: 'src/app.js' });
  assert.equal(f.text, 'const a = 1;\n');
  assert.match((await x.actions.file({ tabId: 't1', file: 'blob.bin' })).error, /isn’t text/);
});

test('nothing outside the folder, through .. or otherwise, and no .env', async () => {
  const { x } = extrasFor({ root: folder() });
  assert.equal((await x.actions.file({ tabId: 't1', file: '../outside.txt' })).ok, false);
  assert.equal((await x.actions.file({ tabId: 't1', file: 'src/../../outside.txt' })).ok, false);
  assert.match((await x.actions.file({ tabId: 't1', file: '.env' })).error, /secrets/);
  assert.equal((await x.actions.files({ tabId: 'other', dir: '' })).ok, false);
});

test('a photo id nobody sent names nothing', () => {
  const { x } = extrasFor();
  assert.deepEqual(x.takePhotos(['made-up', 42]), []);
});

test('a skipped folder is skipped whatever its case, and no alternate streams', async () => {
  const root = folder();
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, '.git', 'config'), '[remote]');
  const { x } = extrasFor({ root });
  assert.equal((await x.actions.file({ tabId: 't1', file: '.GIT/config' })).ok, false);
  assert.equal((await x.actions.file({ tabId: 't1', file: 'src/app.js::$DATA' })).ok, false);
  assert.match((await x.actions.file({ tabId: 't1', file: 'api-token.txt' })).error ?? '', /gone|secrets/);
});

test('a whole drive is too wide to browse', async () => {
  const { x } = extrasFor({ root: path.parse(os.tmpdir()).root });
  assert.match((await x.actions.files({ tabId: 't1', dir: '' })).error, /too wide/);
});
