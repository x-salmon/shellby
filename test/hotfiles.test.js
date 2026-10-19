const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const hf = require('../src/main/usage/hotfiles');

const CWD = 'C:\\work\\shop';

const line = (cwd, uses) => JSON.stringify({
  type: 'assistant', cwd, timestamp: new Date().toISOString(),
  message: { content: uses.map(([name, input]) => ({ type: 'tool_use', id: 'x', name, input })) },
});

test("Claude Code's folder for a working directory", () => {
  assert.equal(hf.folderOf('C:\\Users\\jacob\\Documents\\GitHub\\shellby'), 'C--Users-jacob-Documents-GitHub-shellby');
});

test('the project folder, its Claude Code worktrees and Shellby copies of the repo count; others do not', () => {
  assert.ok(hf.isProjectFolder('C--work-shop', CWD));
  assert.ok(hf.isProjectFolder('c--work-shop', CWD), 'drive letters come in either case');
  assert.ok(hf.isProjectFolder('C--work-shop--claude-worktrees-fix-it', CWD));
  assert.ok(hf.isProjectFolder('C--Users-j-AppData-Roaming-Shellby-worktrees-53e7b1-shop', CWD));
  assert.ok(!hf.isProjectFolder('C--work-shopping', CWD));
  assert.ok(!hf.isProjectFolder('C--Users-j-AppData-Roaming-Shellby-worktrees-53e7b1-shopping', CWD));
});

test('a path inside the project reads relative to it; one outside is left out', () => {
  assert.equal(hf.relativeTo('C:\\work\\shop\\src\\a.js', CWD), 'src/a.js');
  assert.equal(hf.relativeTo('C:\\Users\\j\\.claude\\CLAUDE.md', CWD), null);
  assert.equal(hf.relativeTo(null, CWD), null);
  assert.equal(hf.relativeTo('src/../../x.js', CWD), null, 'a relative path that climbs out');
  assert.equal(hf.relativeTo('..notes.md', CWD), '..notes.md', 'a name that only starts with dots');
  assert.equal(hf.relativeTo('C:\\work\\shop\\a\nb.js', CWD), null, 'control characters would end up in a prompt');
});

test('reads and edits from file tools in a transcript line, and nothing from other lines', () => {
  const l = line(CWD, [['Read', { file_path: 'C:\\work\\shop\\a.js' }], ['Edit', { file_path: 'C:\\work\\shop\\b.js' }], ['NotebookEdit', { notebook_path: 'C:\\work\\shop\\n.ipynb' }], ['Bash', { command: 'ls' }]]);
  assert.deepEqual(hf.touchesIn(l), [{ rel: 'a.js', kind: 'read' }, { rel: 'b.js', kind: 'edit' }, { rel: 'n.ipynb', kind: 'edit' }]);
  assert.equal(hf.touchesIn(line(CWD, [['Bash', { command: 'cat a.js' }]])), null);
  assert.equal(hf.touchesIn('{"type":"tool_use","name":"Read" broken'), null);
  assert.equal(hf.touchesIn(42), null);
});

test('paths go by where the session started, not where Claude cd-ed to', () => {
  const l = line('C:\\work\\shop\\src', [['Read', { file_path: 'C:\\work\\shop\\README.md' }], ['Read', { file_path: 'C:\\work\\shop\\src\\a.js' }]]);
  assert.deepEqual(hf.touchesIn(l, CWD).map(t => t.rel), ['README.md', 'src/a.js']);
  assert.equal(hf.rootIn(JSON.stringify({ type: 'user', cwd: CWD })), CWD);
  assert.equal(hf.rootIn('{"type":"summary"}'), null);
});

test("a subagent's transcript belongs to the conversation that ran it", () => {
  assert.equal(hf.sessionOf('C:\\p\\abc\\subagents\\agent-1.jsonl'), 'C:\\p\\abc');
  assert.equal(hf.sessionOf('C:\\p\\abc.jsonl'), 'C:\\p\\abc');
});

test('the tally counts each conversation once per file, and only habits make the list', () => {
  let tally = new Map();
  for (let i = 0; i < 3; i++) tally = hf.tallyTranscript(tally, [{ rel: 'a.js', kind: 'read' }, { rel: 'a.js', kind: 'read' }, { rel: 'b.js', kind: 'edit' }]);
  tally = hf.tallyTranscript(tally, [{ rel: 'c.js', kind: 'read' }]);
  const rows = hf.hottest(tally, rel => (rel === 'a.js' ? 4000 : null));
  assert.deepEqual(rows.map(r => r.rel), ['a.js', 'b.js']);
  assert.deepEqual(rows[0], { rel: 'a.js', reads: 6, edits: 0, sessions: 3, tokens: 1000 });
  assert.equal(rows[1].tokens, null);
});

test("scans this project's transcripts, worktrees with them, and not another project's", async () => {
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-hot-')));
  const cwd = path.join(home, 'shop');
  const tree = path.join(cwd, '.claude', 'worktrees', 'fix');
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'src', 'big.js'), 'x'.repeat(8000));
  const projects = path.join(home, 'config', 'projects');
  const write = (folderCwd, name, lines) => {
    const dir = path.join(projects, hf.folderOf(folderCwd));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), lines.join('\n') + '\n');
  };
  const read = c => line(c, [['Read', { file_path: path.join(c, 'src', 'big.js') }]]);
  write(cwd, 'one.jsonl', [read(cwd), read(cwd)]);
  write(cwd, 'two.jsonl', [read(cwd)]);
  write(tree, 'three.jsonl', [read(tree)]);
  write(path.join(home, 'other'), 'four.jsonl', [read(path.join(home, 'other'))]);
  const sub = path.join(projects, hf.folderOf(cwd), 'two', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-1.jsonl'), read(cwd) + '\n');
  const r = await hf.scanHotFiles({ configDir: path.join(home, 'config'), cwd });
  assert.equal(r.sessions, 3);
  assert.deepEqual(r.files, [{ rel: 'src/big.js', reads: 5, edits: 0, sessions: 3, tokens: 2000 }], "the subagent's read counts, its conversation doesn't twice");
  assert.equal(r.days, 30);
  fs.rmSync(home, { recursive: true, force: true });
});

test('no history yet is an empty list', async () => {
  const r = await hf.scanHotFiles({ configDir: path.join(os.tmpdir(), 'shellby-hot-no-such-dir'), cwd: CWD });
  assert.deepEqual(r.files, []);
});
