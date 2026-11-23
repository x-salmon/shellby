// "Open in VS Code" (src/main/editor.js): finding the launcher, keeping every
// path on cmd's line one Shellby made and checked, and the two sides of a real
// git change written out (with the real file standing in when it's unchanged).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('../src/main/editor');
const { snapshot } = require('../src/main/changes');

// An absolute path on this OS: C:\<parts> on Windows, /<parts> on a Mac.
const abs = (...parts) => path.resolve(path.sep, ...parts);
const WIN = process.platform === 'win32';
const WIN_ONLY = !WIN && 'Windows-only: cmd.exe, code.cmd and drive-letter paths';
// The two sides open() handed the editor: read off cmd's line on Windows, off the argument list on a Mac.
const diffSides = call => (WIN ? call.args[3].match(/--diff "([^"]+)" "([^"]+)"/).slice(1) : call.args.slice(1));
const CODE = abs('VS Code', 'bin', WIN ? 'code.cmd' : 'code');

test('editorCandidates tries the usual install folders first, then PATH', { skip: WIN_ONLY }, () => {
  const env = { PATH: 'C:\\Tools;relative\\bin;"C:\\Quoted Dir";C:\\Gone', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', ProgramFiles: 'C:\\Program Files' };
  const list = E.editorCandidates(env, dir => dir !== 'C:\\Gone');
  const user = path.join('C:\\Users\\me\\AppData\\Local', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd');
  const machine = path.join('C:\\Program Files', 'Microsoft VS Code', 'bin', 'code.cmd');
  assert.equal(list[0], user);
  assert.equal(list[1], machine);
  assert.ok(list.indexOf(path.join('C:\\Tools', 'code.cmd')) > list.indexOf(machine));
  assert.ok(list.includes(path.join('C:\\Quoted Dir', 'code.cmd')));
  assert.ok(!list.some(p => p.startsWith('relative')), 'a relative PATH entry is never searched');
  assert.ok(!list.some(p => p.startsWith('C:\\Gone')), 'a PATH folder that does not exist is never searched');
  assert.ok(list.some(p => /code-insiders\.cmd$/.test(p)));
  assert.ok(list.some(p => /cursor\.cmd$/.test(p)));
});

test('editorCandidates on a Mac tries the Applications folders first, then PATH folders that exist', () => {
  const env = { HOME: '/Users/me', PATH: '/opt/bin:relative/bin:/gone:/usr/local/bin' };
  const list = E.editorCandidates(env, dir => dir !== '/gone', 'darwin');
  const app = '/Contents/Resources/app/bin/code';
  assert.equal(list[0], `/Applications/Visual Studio Code.app${app}`);
  assert.ok(list.indexOf('/Users/me/Applications/Visual Studio Code.app' + app) > list.indexOf('/Applications/Cursor.app/Contents/Resources/app/bin/cursor'));
  assert.ok(list.indexOf('/usr/local/bin/code') > list.indexOf('/Users/me/Applications/Cursor.app/Contents/Resources/app/bin/cursor'));
  assert.ok(list.includes('/opt/bin/code-insiders'));
  assert.ok(!list.some(p => p.startsWith('relative') || p.startsWith('/gone')), 'a relative or missing PATH entry is never searched');
  assert.equal(new Set(list).size, list.length);
});

test('findEditor on a Mac takes the first launcher that exists', { skip: process.platform !== 'darwin' && 'Mac-only: findEditor reads this OS' }, () => {
  const env = { HOME: '/Users/me', PATH: '/planted' };
  const installed = '/Users/me/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
  const exists = p => p === installed || p === '/planted/code';
  assert.equal(E.findEditor(env, exists, () => true), installed);
  assert.equal(E.findEditor(env, () => false, () => true), null);
});

test('findEditor prefers an installed VS Code over a code.cmd on PATH', { skip: WIN_ONLY }, () => {
  const env = { PATH: 'C:\\Planted', LOCALAPPDATA: 'C:\\L' };
  const installed = path.join('C:\\L', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd');
  const exists = p => p === installed || p === path.join('C:\\Planted', 'code.cmd');
  assert.equal(E.findEditor(env, exists, () => true), installed);
});

test('findEditor picks the first that exists, and never one with characters cmd would read', { skip: WIN_ONLY }, () => {
  const env = { PATH: 'C:\\100%;C:\\ok', LOCALAPPDATA: 'C:\\L' };
  const exists = p => p.startsWith('C:\\100%') || p === path.join('C:\\ok', 'code.cmd');
  assert.equal(E.findEditor(env, exists, () => true), path.join('C:\\ok', 'code.cmd'));
  assert.equal(E.findEditor(env, () => false, () => true), null);
});

test('liveFile accepts only a plain file inside the project that still matches', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-live-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-outside-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'same');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'same');
    assert.equal(E.liveFile(dir, 'a.txt', Buffer.from('same')), path.join(dir, 'a.txt'));
    assert.equal(E.liveFile(dir, 'a.txt', Buffer.from('different')), null);
    assert.equal(E.liveFile(dir, 'missing.txt', Buffer.from('same')), null);
    assert.equal(E.liveFile(dir, path.join('..', path.basename(outside), 'secret.txt'), Buffer.from('same')), null);
    let linked = false;
    try { fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'link.txt'), 'file'); linked = true; } catch { /* no symlink rights on this PC */ }
    if (linked) assert.equal(E.liveFile(dir, 'link.txt', Buffer.from('same')), null, 'a symlink is never the live side');
    let junction = false;
    try { fs.symlinkSync(outside, path.join(dir, 'via'), 'junction'); junction = true; } catch { /* no junctions here */ }
    if (junction) assert.equal(E.liveFile(dir, path.join('via', 'secret.txt'), Buffer.from('same')), null, 'a file reached through a junction is outside');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('safeName keeps letters, digits, dot, dash and underscore only', () => {
  assert.equal(E.safeName('src/components/Button.tsx'), 'Button.tsx');
  assert.equal(E.safeName('a\\b\\we ird&name%1!.js'), 'we_ird_name_1_.js');
  assert.equal(E.safeName('..'), 'file');
  assert.equal(E.safeName('.env'), 'env');
  assert.equal(E.safeName('x..y'), 'x.y');
  assert.equal(E.safeName(''), 'file');
  assert.ok(E.safeName(`${'a'.repeat(300)}.js`).length <= 80);
});

test('diffCommandLine quotes each path and refuses any it cannot quote safely', () => {
  const before = abs('t', 'before-a.js');
  assert.equal(E.diffCommandLine(CODE, before, abs('t', 'after-a.js')), `""${CODE}" --diff "${before}" "${abs('t', 'after-a.js')}""`);
  for (const bad of [abs('t', '%PATH%.js'), abs('t', 'a"&calc&".js'), abs('t', '!x!.js'), abs('t', 'a^b.js'), 'relative.js', abs('t', 'a\nb.js'), null]) {
    assert.equal(E.diffCommandLine(CODE, before, bad), null, String(bad));
  }
});

test('staleTemp lists only our own temp folders past a day old', () => {
  const now = 10 * 86400000;
  const entries = [
    { name: 'a1b2c3d4e5f6', mtimeMs: now - 2 * 86400000 },
    { name: '0123456789ab', mtimeMs: now - 3600000 },
    { name: 'not-ours', mtimeMs: 0 },
  ];
  assert.deepEqual(E.staleTemp(entries, now), ['a1b2c3d4e5f6']);
});

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-editor-'));
  const g = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true });
  g('init', '-q');
  g('config', 'user.email', 't@example.com');
  g('config', 'user.name', 'T');
  g('config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  g('add', '-A');
  g('commit', '-qm', 'init');
  return { dir, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function fakeSpawn() {
  const calls = [];
  return { calls, impl: (exe, args, opts) => { calls.push({ exe, args, opts }); return { on() {}, unref() {} }; } };
}

test('open writes both sides and diffs against the real file when it is unchanged', async () => {
  const r = repo();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-editor-tmp-'));
  try {
    const start = await snapshot(r.dir);
    fs.writeFileSync(path.join(r.dir, 'a.txt'), 'one\ntwo\n');
    const end = await snapshot(r.dir);
    const s = fakeSpawn();
    const ref = { root: start.root, before: start.tree, after: end.tree, file: 'a.txt', status: 'M' };
    const out = await E.open(ref, { spawnImpl: s.impl, tmp, editor: CODE });
    assert.deepEqual(out, { ok: true, live: true });
    if (WIN) {
      assert.match(s.calls[0].exe, /cmd\.exe$/i);
      assert.deepEqual(s.calls[0].args.slice(0, 3), ['/d', '/s', '/c']);
    } else {
      assert.equal(s.calls[0].exe, CODE, 'a Mac starts the launcher itself, no shell');
      assert.equal(s.calls[0].args[0], '--diff');
    }
    const [left, right] = diffSides(s.calls[0]);
    assert.equal(fs.readFileSync(left, 'utf8'), 'one\n');
    assert.equal(path.basename(left), 'before-a.txt');
    assert.equal(right.toLowerCase(), path.join(start.root, 'a.txt').toLowerCase());

    // Changed again since: both sides are copies, and the project is left alone.
    fs.writeFileSync(path.join(r.dir, 'a.txt'), 'something else\n');
    const again = await E.open(ref, { spawnImpl: s.impl, tmp, editor: CODE });
    assert.deepEqual(again, { ok: true, live: false });
    const copy = diffSides(s.calls[1])[1];
    assert.equal(path.basename(copy), 'after-a.txt');
    assert.equal(fs.readFileSync(copy, 'utf8'), 'one\ntwo\n');
  } finally { r.done(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('open treats an added file as empty before, and says when VS Code is missing', async () => {
  const r = repo();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-editor-tmp-'));
  try {
    const start = await snapshot(r.dir);
    fs.writeFileSync(path.join(r.dir, 'new.txt'), 'hi\n');
    const end = await snapshot(r.dir);
    const s = fakeSpawn();
    const ref = { root: start.root, before: start.tree, after: end.tree, file: 'new.txt', status: 'A' };
    assert.equal((await E.open(ref, { spawnImpl: s.impl, tmp, editor: CODE })).ok, true);
    const [left] = diffSides(s.calls[0]);
    assert.equal(fs.readFileSync(left, 'utf8'), '');
    const missing = await E.open(ref, { spawnImpl: s.impl, tmp, editor: null });
    assert.equal(missing.ok, false);
    assert.equal(missing.notFound, true);
    assert.match(missing.error, /VS Code/);
  } finally { r.done(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('open refuses a ref that is not a snapshot or names a path outside the project', async () => {
  const s = fakeSpawn();
  const base = { root: path.resolve(os.tmpdir()), before: 'a'.repeat(40), after: 'b'.repeat(40) };
  for (const file of ['../x', 'C:\\Windows\\win.ini', undefined]) {
    const r = await E.open({ ...base, file }, { spawnImpl: s.impl, editor: CODE });
    assert.equal(r.ok, false, String(file));
  }
  assert.equal((await E.open({ ...base, before: 'HEAD', file: 'a' }, { spawnImpl: s.impl, editor: CODE })).ok, false);
  assert.equal(s.calls.length, 0);
});

// ---- folders (a mod's, from the Toolbox)

test('folderCommandLine quotes the editor and the folder for cmd', () => {
  const dir = abs('Users', 'me', '.claude', 'skills', 'tidy');
  assert.equal(E.folderCommandLine(CODE, dir), `""${CODE}" "${dir}""`);
});

test('folderCommandLine refuses relative paths and characters cmd would act on', () => {
  const code = CODE;
  assert.equal(E.folderCommandLine(code, 'relative/dir'), null);
  assert.equal(E.folderCommandLine('code.cmd', abs('x')), null);
  for (const bad of [abs('a"b'), abs('a%PATH%'), abs('a!b'), abs('a^b'), abs('a\nb'), abs('a\0b')]) {
    assert.equal(E.folderCommandLine(code, bad), null, JSON.stringify(bad));
    assert.equal(E.folderCommandLine(bad, abs('x')), null, JSON.stringify(bad));
  }
  assert.equal(E.folderCommandLine(code, undefined), null);
});

test('openFolder starts the editor on the folder, detached, from that folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-editor-folder-'));
  try {
    const s = fakeSpawn();
    assert.deepEqual(E.openFolder(dir, { spawnImpl: s.impl, editor: CODE, env: { PATH: 'x' } }), { ok: true });
    assert.equal(s.calls.length, 1);
    if (WIN) {
      assert.match(s.calls[0].exe, /cmd\.exe$/i);
      assert.deepEqual(s.calls[0].args.slice(0, 3), ['/d', '/s', '/c']);
      assert.equal(s.calls[0].args[3], `""${CODE}" "${dir}""`);
      assert.equal(s.calls[0].opts.windowsHide, true);
    } else {
      assert.equal(s.calls[0].exe, CODE, 'a Mac starts the launcher itself, no shell');
      assert.deepEqual(s.calls[0].args, [dir]);
    }
    assert.equal(s.calls[0].opts.cwd, dir);
    assert.equal(s.calls[0].opts.detached, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('openFolder says so when the folder is gone, and starts nothing', () => {
  const s = fakeSpawn();
  const r = E.openFolder(path.join(os.tmpdir(), 'shellby-no-such-folder-xyz'), { spawnImpl: s.impl, editor: CODE });
  assert.equal(r.ok, false);
  assert.match(r.error, /isn't there/);
  assert.equal(s.calls.length, 0);
});

test('openFolder reports notFound when there is no editor, and refuses a path cmd would misread', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-editor-folder-'));
  try {
    const s = fakeSpawn();
    const none = E.openFolder(dir, { spawnImpl: s.impl, editor: null });
    assert.equal(none.ok, false);
    assert.equal(none.notFound, true);
    assert.match(none.error, /VS Code/);
    const unsafe = path.join(dir, 'a%b');
    fs.mkdirSync(unsafe);
    const r = E.openFolder(unsafe, { spawnImpl: s.impl, editor: CODE });
    assert.equal(r.ok, false);
    assert.equal(s.calls.length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('openFolder turns a failed start into an error instead of throwing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-editor-folder-'));
  try {
    const r = E.openFolder(dir, { spawnImpl: () => { throw new Error('spawn denied'); }, editor: CODE });
    assert.equal(r.ok, false);
    assert.match(r.error, /spawn denied/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
