// From review: quotes in a commit's subject, helpers' edits, the cap on files remembered, the hook naming its call.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const tw = require('../src/main/turnwatch');
const loud = require('../src/main/usage/loud');

const size = tw.REREAD_TOKENS * 4;
const read = (w, id, path) => tw.seeItem(tw.seeItem(w, { kind: 'tool', id, wholeRead: true, readPath: path }), { kind: 'tool_result', id, chars: size });

test('commitSubject keeps quotes inside the message', () => {
  assert.equal(tw.commitSubject(`git commit -m "$(cat <<'EOF'\nfix: "foo" bar\n\nBody.\nEOF\n)"`), 'fix: "foo" bar');
  assert.equal(tw.commitSubject('git commit -m "fix: \\"a\\" b"'), 'fix: "a" b');
});

test("a helper's edit, or its git checkout, means the file has changed", () => {
  const first = read(tw.startTurn(), 'r1', '/p/a.js');
  const helperEdit = tw.seeItem(first, { kind: 'tool', id: 'h1', editPath: '/p/a.js', sub: { parent: 'x' } });
  assert.equal(read(helperEdit, 'r2', '/p/a.js').reread, null);
  const helperShell = tw.seeItem(first, { kind: 'tool', id: 'h2', changesFiles: true, sub: { parent: 'x' } });
  assert.equal(read(helperShell, 'r2', '/p/a.js').reread, null);
  const helperRead = read({ ...first }, 'r3', '/p/b.js');
  assert.ok(helperRead.files['/p/b.js']);
});

test('files remembered are capped, the oldest going first', () => {
  let w = tw.startTurn();
  for (let i = 0; i < 520; i++) w = read(w, `r${i}`, `/p/f${i}.js`);
  const keys = Object.keys(w.files);
  assert.equal(keys.length, 500);
  assert.ok(!w.files['/p/f0.js']);
  assert.ok(w.files['/p/f519.js']);
});

test('rewroteIn names the call when the hook line does', () => {
  const line = JSON.stringify({ type: 'attachment', toolUseID: 'toolu_1', attachment: { type: 'hook_success', hookEvent: 'PreToolUse', stdout: '{"hookSpecificOutput":{"updatedInput":{"command":"set -o pipefail; npm test 2>&1 | tail -n 60"}}}' } });
  assert.equal(loud.rewroteIn(line), 'toolu_1');
});
