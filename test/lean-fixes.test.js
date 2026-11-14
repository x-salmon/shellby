// Applying a Lean fix (src/main/lean-fixes.js): drafted from a project's own
// files, written only after the confirm window and only when the file still
// reads as the preview showed, kept inside the project, and undone exactly.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLeanFixes } = require('../src/main/lean-fixes');

const HOT = {
  files: [
    { rel: 'package-lock.json', reads: 4, edits: 0, sessions: 3, tokens: 9000 },
    { rel: 'src/app.js', reads: 5, edits: 1, sessions: 4, tokens: 300 },
  ],
  loud: [{ key: 'npm test', runs: 3, sessions: 2, tokens: 3000, total: 9000 }],
};

function fakeConfig(init = {}) {
  const store = { ...init };
  return { store, get: k => store[k], set: o => Object.assign(store, o) };
}

// A home and a project in a temp folder, with a CLAUDE.md, a described file and a lockfile.
function world({ md = '# Proj\n\nBuild with npm.\n', answer = 0, config = fakeConfig() } = {}) {
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-leanfix-')));
  const home = path.join(tmp, 'home');
  const project = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  if (md !== null) fs.writeFileSync(path.join(project, 'CLAUDE.md'), md);
  fs.writeFileSync(path.join(project, 'src', 'app.js'), '// The app: wires the screens together.\nmodule.exports = 1;\n');
  fs.writeFileSync(path.join(project, 'package-lock.json'), '{}\n');
  const asked = [];
  const w = { tmp, home, project, config, asked, answer, cwd: project };
  w.svc = createLeanFixes({
    config, log: { info() {}, warn() {} },
    askOnce: async spec => { asked.push(spec); return w.answer; },
    setupWhere: () => ({ home, cwd: w.cwd }),
  });
  return w;
}

const read = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);

test('drafts: a deny rule in the project settings, a CLAUDE.md line, advice for the loud command; none in the home folder', () => {
  const w = world();
  const fixes = w.svc.drafts(HOT);
  assert.deepEqual(fixes.map(f => f.kind), ['deny-read', 'claude-line', 'quiet']);
  assert.equal(fixes[0].file, path.join(w.project, '.claude', 'settings.json'));
  assert.equal(fixes[0].before, '', 'no settings file yet');
  assert.equal(fixes[1].file, path.join(w.project, 'CLAUDE.md'));
  assert.equal(fixes[1].line, '- `src/app.js`: The app: wires the screens together.');
  w.cwd = w.home;
  assert.deepEqual(w.svc.drafts(HOT), [], 'the home folder is no project');
  assert.deepEqual(w.svc.drafts(null), []);
});

test("draftNudge: one file's fix for the conversation's own project, applied and undone there, apart from the Lean tab's drafts", async () => {
  const w = world({ answer: 0 });
  w.cwd = w.home; // the panel sits on the home folder: the Lean tab has no project to draft for
  assert.deepEqual(w.svc.drafts(HOT), []);
  const file = { rel: 'package-lock.json', reads: 4, edits: 0, sessions: 3, tokens: 9000 };
  const fix = w.svc.draftNudge({ project: w.project, file });
  assert.match(fix.id, /^nudge:\d+:deny:package-lock\.json$/);
  assert.equal(fix.kind, 'deny-read');
  assert.equal(fix.file, path.join(w.project, '.claude', 'settings.json'));
  assert.equal(fix.before, '', 'no settings file yet');
  assert.equal(fix.raw, undefined, 'the file text stays in main');
  assert.equal(fix.project, undefined);
  const r = await w.svc.apply(fix.id);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(JSON.parse(read(fix.file)), { permissions: { deny: ['Read(./package-lock.json)'] } });
  assert.equal(w.asked.length, 1, 'asked in the confirm window first');
  assert.equal(w.svc.undo(r.undoId).ok, true, 'undo knows the project the fix was written in, wherever the panel is');
  assert.equal(read(fix.file), null);
  assert.equal(w.svc.draftNudge({ project: w.home, file }), null, 'never the home folder');
  assert.equal(w.svc.draftNudge({ project: w.project, file: { rel: 'src/app.js', reads: 3, edits: 0, sessions: 3, tokens: 300 } }).kind, 'claude-line', 'a file that is not generated gets a CLAUDE.md line');
  assert.equal(w.svc.draftNudge({ project: w.project, file: { rel: 'src/nothing-here.js', reads: 3, edits: 0, sessions: 3, tokens: 300 } }), null, 'nothing to say about a file with no head to read');
});

test('apply: cancelled in the confirm window writes nothing; confirmed writes exactly the preview; undo takes it back', async () => {
  const w = world({ answer: 1 });
  const [deny] = w.svc.drafts(HOT);
  const settings = path.join(w.project, '.claude', 'settings.json');
  let r = await w.svc.apply(deny.id);
  assert.deepEqual(r, { ok: false, cancelled: true });
  assert.equal(w.asked.length, 1);
  assert.match(w.asked[0].title, /package-lock\.json/);
  assert.match(w.asked[0].detail, /Read\(\.\/package-lock\.json\)/, 'the window shows the rule');
  assert.equal(w.asked[0].buttons[w.asked[0].cancelId].label, 'Cancel');
  assert.equal(read(settings), null, 'nothing written');

  w.answer = 0;
  r = await w.svc.apply(deny.id);
  assert.equal(r.ok, true);
  assert.equal(r.file, settings);
  assert.equal(read(settings), deny.after);
  assert.deepEqual(JSON.parse(read(settings)), { permissions: { deny: ['Read(./package-lock.json)'] } });

  const again = await w.svc.apply(deny.id);
  assert.equal(again.ok, false);
  assert.equal(again.changed, true, 'the file no longer reads as the preview did');

  const u = w.svc.undo(r.undoId);
  assert.equal(u.ok, true);
  assert.equal(read(settings), null, 'a file that was not there before is gone again');
  assert.equal(w.svc.undo(r.undoId).ok, false, 'once');
});

test('apply the CLAUDE.md line: the section lands at the end; an outside edit refuses the undo; the exact text comes back', async () => {
  const w = world();
  const line = w.svc.drafts(HOT).find(f => f.kind === 'claude-line');
  const md = path.join(w.project, 'CLAUDE.md');
  const r = await w.svc.apply(line.id);
  assert.equal(r.ok, true);
  assert.equal(read(md), '# Proj\n\nBuild with npm.\n\n## Where things live\n\n- `src/app.js`: The app: wires the screens together.\n');
  assert.match(w.asked[0].detail, /- `src\/app\.js`: The app/, 'the window shows the line');
  fs.appendFileSync(md, 'More.\n');
  const refused = w.svc.undo(r.undoId);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /changed since/);
  fs.writeFileSync(md, read(md).replace('More.\n', ''));
  assert.equal(w.svc.undo(r.undoId).ok, true);
  assert.equal(read(md), '# Proj\n\nBuild with npm.\n');
  // Drafted again: the file is as it was, so the same fix is on offer.
  assert.ok(w.svc.drafts(HOT).some(f => f.id === line.id));
});

test('a CLAUDE.md with Windows line endings and a BOM keeps both', async () => {
  const w = world({ md: '﻿# Proj\r\n\r\nBuild with npm.\r\n' });
  const line = w.svc.drafts(HOT).find(f => f.kind === 'claude-line');
  assert.equal(line.before, '# Proj\n\nBuild with npm.\n', 'the preview reads plain');
  const r = await w.svc.apply(line.id);
  assert.equal(r.ok, true);
  assert.equal(read(path.join(w.project, 'CLAUDE.md')), '﻿# Proj\r\n\r\nBuild with npm.\r\n\r\n## Where things live\r\n\r\n- `src/app.js`: The app: wires the screens together.\r\n');
  assert.equal(w.svc.undo(r.undoId).ok, true);
  assert.equal(read(path.join(w.project, 'CLAUDE.md')), '﻿# Proj\r\n\r\nBuild with npm.\r\n');
});

test('a fix whose file resolves outside the project is refused, and nothing is written there', async () => {
  const w = world();
  const deny = w.svc.drafts(HOT).find(f => f.kind === 'deny-read');
  // .claude turned into a link elsewhere after the draft: the apply follows it and stops.
  const elsewhere = path.join(w.tmp, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.symlinkSync(elsewhere, path.join(w.project, '.claude'), 'junction');
  const r = await w.svc.apply(deny.id);
  assert.equal(r.ok, false);
  assert.match(r.error, /outside the project/);
  assert.equal(w.asked.length, 0, 'refused before asking');
  assert.deepEqual(fs.readdirSync(elsewhere), []);
  // And with the link there from the start, no such fix is drafted at all.
  assert.ok(!w.svc.drafts(HOT).some(f => f.kind === 'deny-read'));
});

// A file link needs a privilege most Windows accounts don't have; a test about one skips without it.
function fileLink(target, link) {
  try { fs.symlinkSync(target, link, 'file'); return true; } catch { return false; }
}

test('a temp file or link planted beside the target is removed, never written through', async t => {
  const w = world();
  const line = w.svc.drafts(HOT).find(f => f.kind === 'claude-line');
  const md = path.join(w.project, 'CLAUDE.md');
  const tmp = `${md}.shellby-tmp`;
  const elsewhere = path.join(w.tmp, 'elsewhere.txt');
  fs.writeFileSync(elsewhere, 'keep me\n');
  const linked = fileLink(elsewhere, tmp);
  if (!linked) fs.writeFileSync(tmp, 'stale\n'); // at least a stale file in the way
  const r = await w.svc.apply(line.id);
  assert.equal(r.ok, true);
  assert.match(read(md), /## Where things live/);
  assert.equal(fs.existsSync(tmp), false, 'the temp file is gone after the rename');
  assert.equal(read(elsewhere), 'keep me\n', 'nothing went through the link');
  if (!linked) t.diagnostic('file links need a privilege this account lacks: checked a stale file only');
});

test('a link to nowhere where the target should be is refused', async t => {
  const w = world();
  const line = w.svc.drafts(HOT).find(f => f.kind === 'claude-line');
  const md = path.join(w.project, 'CLAUDE.md');
  fs.unlinkSync(md);
  if (!fileLink(path.join(w.tmp, 'nowhere.md'), md)) { t.skip('file links need a privilege this account lacks'); return; }
  const r = await w.svc.apply(line.id);
  assert.equal(r.ok, false);
  assert.equal(w.asked.length, 0);
  assert.equal(fs.existsSync(path.join(w.tmp, 'nowhere.md')), false);
});

test('an unknown fix, advice, or a drafts list from another folder: nothing to apply', async () => {
  const w = world();
  const fixes = w.svc.drafts(HOT);
  assert.equal((await w.svc.apply('line:nope')).ok, false);
  const quiet = await w.svc.apply(fixes.find(f => f.kind === 'quiet').id);
  assert.equal(quiet.ok, false);
  assert.match(quiet.error, /suggestion/);
  w.cwd = path.join(w.tmp, 'other');
  fs.mkdirSync(w.cwd);
  const moved = await w.svc.apply(fixes[0].id);
  assert.equal(moved.ok, false);
  assert.equal(w.asked.length, 0);
  assert.equal(read(path.join(w.project, '.claude', 'settings.json')), null);
});

test('a confirm window that could not open (another question up) answers busy, and writes nothing', async () => {
  const w = world({ answer: null });
  const [deny] = w.svc.drafts(HOT);
  assert.deepEqual(await w.svc.apply(deny.id), { ok: false, cancelled: true, busy: true });
  assert.equal(read(path.join(w.project, '.claude', 'settings.json')), null);
});

// ---- the output style

test('the active style: Shellby\'s own first, then the settings files, with a custom style\'s size', () => {
  const w = world({ config: fakeConfig({ outputStyle: 'Explanatory' }) });
  assert.deepEqual(w.svc.activeStyle(), { name: 'Explanatory', source: 'shellby', file: null, chars: null });
  w.config.store.outputStyle = '';
  assert.equal(w.svc.activeStyle(), null);
  fs.writeFileSync(path.join(w.home, '.claude', 'settings.json'), JSON.stringify({ outputStyle: 'terse', hooks: {} }, null, 2));
  fs.mkdirSync(path.join(w.home, '.claude', 'output-styles'));
  fs.writeFileSync(path.join(w.home, '.claude', 'output-styles', 'Terse.md'), '---\nname: terse\n---\nSay less.\n');
  const s = w.svc.activeStyle();
  assert.equal(s.name, 'terse');
  assert.equal(s.source, 'user');
  assert.equal(s.file, path.join(w.home, '.claude', 'settings.json'));
  assert.equal(s.chars, fs.statSync(path.join(w.home, '.claude', 'output-styles', 'Terse.md')).size);
});

test('switching a style off: Shellby\'s own setting is cleared, and undo puts it back', async () => {
  const w = world({ config: fakeConfig({ outputStyle: 'Explanatory' }) });
  const r = await w.svc.styleOff();
  assert.equal(r.ok, true);
  assert.match(w.asked[0].title, /Explanatory/);
  assert.equal(w.config.store.outputStyle, '');
  assert.equal(w.svc.undo(r.undoId).ok, true);
  assert.equal(w.config.store.outputStyle, 'Explanatory');
  w.config.store.outputStyle = '';
  assert.equal((await w.svc.styleOff()).ok, false, 'none on: nothing to switch off');
});

test('switching a style off in a settings file: only that key goes, a backup is kept, and undo restores the text', async () => {
  const w = world();
  const file = path.join(w.home, '.claude', 'settings.json');
  const was = '{\n  "outputStyle": "Learning",\n  "hooks": {}\n}\n';
  fs.writeFileSync(file, was);
  const r = await w.svc.styleOff();
  assert.equal(r.ok, true);
  assert.match(w.asked[0].message, /settings\.json/);
  assert.deepEqual(JSON.parse(read(file)), { hooks: {} });
  assert.equal(read(`${file}.shellby-backup`), was);
  assert.equal(w.svc.undo(r.undoId).ok, true);
  assert.equal(read(file), was);
  w.answer = 1;
  assert.deepEqual(await w.svc.styleOff(), { ok: false, cancelled: true });
  assert.equal(read(file), was);
});

test('a style set in the project\'s own settings: switched off there while the file sits inside the project, refused once it points out', async () => {
  const w = world();
  const dir = path.join(w.project, '.claude');
  fs.mkdirSync(dir);
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{"outputStyle":"Learning","permissions":{"allow":["Bash(npm test:*)"]}}\n');
  assert.equal(w.svc.activeStyle().source, 'project');
  const r = await w.svc.styleOff();
  assert.equal(r.ok, true);
  assert.deepEqual(JSON.parse(read(file)), { permissions: { allow: ['Bash(npm test:*)'] } });
  assert.equal(w.svc.undo(r.undoId).ok, true);
  assert.equal(w.svc.activeStyle().name, 'Learning');
  // .claude swapped for a link elsewhere: the style is still read there, but never written there.
  fs.rmSync(dir, { recursive: true });
  const elsewhere = path.join(w.tmp, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.writeFileSync(path.join(elsewhere, 'settings.json'), '{"outputStyle":"Learning"}\n');
  fs.symlinkSync(elsewhere, dir, 'junction');
  w.asked.length = 0;
  const refused = await w.svc.styleOff();
  assert.equal(refused.ok, false);
  assert.match(refused.error, /outside the project/);
  assert.equal(w.asked.length, 0, 'refused before asking');
  assert.equal(read(path.join(elsewhere, 'settings.json')), '{"outputStyle":"Learning"}\n');
});
