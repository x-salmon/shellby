// The file viewer's review reads and its one write (main's viewer.js): a Viewed tick's
// fingerprint, a diff with whitespace left out, who last changed a line, a picture's
// preview, and a hunk put back. Against real git repos in temp folders.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createViewer, parseRaw, parseBlame } = require('../src/main/viewer');

function repo() {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-vreview-')));
  const dir = path.join(base, 'proj');
  fs.mkdirSync(dir);
  const g = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@example.com');
  g('config', 'user.name', 'T');
  g('config', 'core.autocrlf', 'false');
  const write = (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); };
  write('a.js', 'function a() {\n  return 1;\n}\n\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;\nconst f = 6;\nconst g = 7;\n\nmodule.exports = { a };\n');
  g('add', '-A');
  g('commit', '-qm', 'init');
  return { base, dir, g, write, done: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test('parseRaw maps each path to the blob it ends at, and a deleted file to the one it was', () => {
  const A = 'a'.repeat(40), B = 'b'.repeat(40), Z = '0'.repeat(40);
  const out = `:100644 100644 ${A} ${B} M\0src/x.js\0:000000 100644 ${Z} ${B} A\0new file.txt\0:100644 000000 ${A} ${Z} D\0gone.js\0`;
  const m = parseRaw(out);
  assert.equal(m.get('src/x.js'), B);
  assert.equal(m.get('new file.txt'), B);
  assert.equal(m.get('gone.js'), A);
  assert.equal(parseRaw('').size, 0);
});

test('parseBlame reads who, when and the summary, and says when a line is not committed', () => {
  const sha = 'c'.repeat(40);
  const one = `${sha} 3 3 1\nauthor Ada\nauthor-mail <ada@example.com>\nauthor-time 1700000000\nsummary fix: the thing\nfilename a.js\n\tconst x = 1;\n`;
  const r = parseBlame(one);
  assert.deepEqual(r, { uncommitted: false, commit: 'cccccccccc', author: 'Ada', when: 1700000000000, summary: 'fix: the thing' });
  assert.equal(JSON.stringify(r).includes('example.com'), false, 'no e-mail reaches the panel');
  assert.equal(parseBlame(`${'0'.repeat(40)} 1 1 1\nauthor Not Committed Yet\n`).uncommitted, true);
  assert.equal(parseBlame('fatal: no such path'), null);
});

test('each changed file carries a sig that moves when the file changes again', async () => {
  const r = repo();
  try {
    r.write('a.js', fs.readFileSync(path.join(r.dir, 'a.js'), 'utf8').replace('return 1;', 'return 10;'));
    const v = createViewer();
    const h = await v.open({ dir: r.dir, base: 'HEAD' });
    const first = (await v.changesOf(h.id)).files.find(f => f.path === 'a.js');
    assert.match(first.sig, /^M:[0-9a-f]{16}$/);
    r.write('a.js', fs.readFileSync(path.join(r.dir, 'a.js'), 'utf8').replace('return 10;', 'return 11;'));
    v.staleFor(r.dir);
    const again = (await v.changesOf(h.id)).files.find(f => f.path === 'a.js');
    assert.notEqual(again.sig, first.sig, 'the same counts, another blob: the tick goes');
  } finally { r.done(); }
});

test('Ignore whitespace leaves a reindented line out of the diff', async () => {
  const r = repo();
  try {
    const text = fs.readFileSync(path.join(r.dir, 'a.js'), 'utf8');
    r.write('a.js', text.replace('  return 1;', '    return 1;').replace('const g = 7;', 'const g = 70;'));
    const v = createViewer();
    const h = await v.open({ dir: r.dir, base: 'HEAD' });
    await v.changesOf(h.id);
    const all = await v.diffOf(h.id, 'a.js');
    const some = await v.diffOf(h.id, 'a.js', { ignoreSpace: true });
    assert.match(all.patch, /^\+ {4}return 1;$/m);
    assert.doesNotMatch(some.patch, /^\+ {4}return 1;$/m);
    assert.match(some.patch, /^\+const g = 70;$/m);
  } finally { r.done(); }
});

test('blame says who last changed a line, and whether Claude Code made the commit', async () => {
  const r = repo();
  try {
    const text = fs.readFileSync(path.join(r.dir, 'a.js'), 'utf8');
    r.write('a.js', text.replace('const d = 4;', 'const d = 40;'));
    r.g('commit', '-qam', 'feat: d is bigger\n\nCo-Authored-By: Claude Opus <noreply@anthropic.com>');
    r.write('a.js', fs.readFileSync(path.join(r.dir, 'a.js'), 'utf8').replace('const f = 6;', 'const f = 60;'));
    const v = createViewer();
    const h = await v.open({ dir: r.dir, base: 'HEAD' });
    const byClaude = await v.blameOf(h.id, 'a.js', 7);
    assert.equal(byClaude.ok, true);
    assert.equal(byClaude.claude, true);
    assert.equal(byClaude.summary, 'feat: d is bigger');
    const mine = await v.blameOf(h.id, 'a.js', 1);
    assert.equal(mine.claude, false);
    assert.equal(mine.author, 'T');
    const notYet = await v.blameOf(h.id, 'a.js', 9);
    assert.equal(notYet.uncommitted, true);
    assert.equal((await v.blameOf(h.id, '../outside.js', 1)).missing, true);
    assert.equal((await v.blameOf(h.id, 'a.js', 0)).ok, false);
  } finally { r.done(); }
});

test('a picture comes back as a data: URL, and only a picture', async () => {
  const r = repo();
  try {
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    fs.writeFileSync(path.join(r.dir, 'icon.png'), png);
    r.write('notes.txt', 'not a picture');
    const v = createViewer();
    const h = await v.open({ dir: r.dir });
    const img = await v.imageOf(h.id, 'icon.png');
    assert.equal(img.ok, true);
    assert.equal(img.url, `data:image/png;base64,${png.toString('base64')}`);
    assert.equal((await v.imageOf(h.id, 'notes.txt')).ok, false);
    assert.equal((await v.imageOf(h.id, '../x.png')).missing, true);
  } finally { r.done(); }
});

test('a hunk goes back only in a conversation\'s own folder, never mid-turn, and the list looks again', async () => {
  const r = repo();
  try {
    const text = fs.readFileSync(path.join(r.dir, 'a.js'), 'utf8');
    r.write('a.js', text.replace('return 1;', 'return 2;').replace('module.exports = { a };', 'module.exports = { a, b };'));
    const v = createViewer();
    const project = await v.open({ dir: r.dir, base: 'HEAD' });
    await v.changesOf(project.id);
    const patch = (await v.diffOf(project.id, 'a.js')).patch;
    const headers = patch.split('\n').filter(l => l.startsWith('@@'));
    assert.equal(headers.length, 2);
    assert.equal((await v.undoHunk(project.id, 'a.js', { hunk: 0, header: headers[0] })).ok, false, 'a folder the Project page opened');

    const mine = await v.open({ dir: r.dir, base: 'HEAD', tabId: 't1' });
    await v.changesOf(mine.id);
    assert.equal((await v.undoHunk(mine.id, 'a.js', { hunk: 0, header: headers[0] }, () => true)).ok, false, 'mid-turn');
    assert.equal((await v.undoHunk(mine.id, 'a.js', { hunk: 1, header: headers[0] })).ok, false, 'a header that is not that hunk\'s');
    const done = await v.undoHunk(mine.id, 'a.js', { hunk: 0, header: headers[0] });
    assert.equal(done.ok, true, done.error);
    const now = fs.readFileSync(path.join(r.dir, 'a.js'), 'utf8');
    assert.match(now, /return 1;/);
    assert.match(now, /module\.exports = \{ a, b \};/, 'the other hunk stays');
    await v.changesOf(mine.id);
    assert.equal((await v.diffOf(mine.id, 'a.js')).patch.split('\n').filter(l => l.startsWith('@@')).length, 1);
  } finally { r.done(); }
});
