// Compact now with a focus: the commit's subject, from its -m (turnwatch.js commitSubject).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const tw = require('../src/main/turnwatch');

test('commitSubject: a quoted -m, the heredoc Claude writes, or none', () => {
  assert.equal(tw.commitSubject('git commit -m "fix: the thing"'), 'fix: the thing');
  assert.equal(tw.commitSubject("git add -A && git commit -qm 'feat: x'"), null, '-qm is not -m');
  assert.equal(tw.commitSubject("git commit -q -m 'feat: x'"), 'feat: x');
  assert.equal(tw.commitSubject(`git commit -m "$(cat <<'EOF'\nfeat: notes for big reads\n\nBody here.\nEOF\n)"`), 'feat: notes for big reads');
  assert.equal(tw.commitSubject('git commit -m "feat: a\nsecond line"'), 'feat: a');
  assert.equal(tw.commitSubject('git commit --amend --no-edit'), null);
});

test('the compact note carries the subject as its focus', () => {
  const w = tw.seeItem(tw.startTurn(), { kind: 'tool', id: 'b1', ...tw.toolFacts('Bash', { command: 'git commit -m "feat: branch costs"' }) });
  const [note] = tw.watchNotes(w, { cost: { contextPct: tw.COMPACT_PCT } });
  assert.equal(note.kind, 'compact');
  assert.match(note.focus, /after "feat: branch costs"/);
  const bare = tw.seeItem(tw.startTurn(), { kind: 'tool', id: 'b2', ...tw.toolFacts('Bash', { command: 'git commit --amend --no-edit' }) });
  assert.equal(tw.watchNotes(bare, { cost: { contextPct: 90 } })[0].focus, undefined);
});
