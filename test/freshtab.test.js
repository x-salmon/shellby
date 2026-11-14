// A fresh tab with a summary Shellby writes (src/main/freshtab.js): when a new
// message reads as a new topic, the summary from the transcript, and the first
// message the new tab starts with.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ft = require('../src/main/freshtab');

const user = text => ({ kind: 'user', text, turnId: `t-${text.length}` });
const reply = text => ({ kind: 'text', text });
const changes = files => ({ kind: 'changes', files: files.map(([path, added, removed]) => ({ path, status: 'M', added, removed })) });
const commit = subject => ({ kind: 'tool', id: `tu-${subject.length}`, name: 'Bash', commits: true, commitSubject: subject });
const edit = file => ({ kind: 'tool', id: `tu-e-${file}`, name: 'Edit', editPath: file });
const todo = (id, subject, status) => ({ kind: 'tool', id: `tu-${id}`, name: 'TaskCreate', todo: { op: 'create', subject } });
const todoMade = (id, todoId) => ({ kind: 'tool_result', id: `tu-${id}`, todoId });
const todoDone = todoId => ({ kind: 'tool', id: `tu-up-${todoId}`, name: 'TaskUpdate', todo: { op: 'update', id: todoId, status: 'completed' } });

const CONVO = [
  user('Fix the scheduler so routines run at the right time in src/main/routines/index.js'),
  edit('src/main/routines/index.js'),
  reply('The scheduler used local midnight. I changed nextStart to use the routine\'s own time zone.'),
  changes([['src/main/routines/index.js', 12, 3], ['test/routines.test.js', 20, 0]]),
  commit('fix: routines run at their own time'),
  user('Now add a test for a routine that runs weekly'),
  todo(1, 'Write the weekly test'), todoMade(1, 'td-1'),
  todo(2, 'Run the suite'), todoMade(2, 'td-2'),
  todoDone('td-1'),
  reply('Added a weekly case to test/routines.test.js.'),
  changes([['test/routines.test.js', 15, 2]]),
];

// ---- words and files

test('words keeps the content words and drops stop words, short words and numbers', () => {
  assert.deepEqual([...ft.words('Fix the scheduler so routines run at 3 o\'clock, please')], ['scheduler', 'routines', 'clock']);
  assert.equal(ft.words('').size, 0);
  assert.equal(ft.words(null).size, 0);
});

test('filesIn finds paths and file names, not plain words or versions', () => {
  assert.deepEqual(ft.filesIn('Look at src/main/weather/index.js and widgets\\clock.css, then README.md.'), ['src/main/weather/index.js', 'widgets\\clock.css', 'README.md']);
  assert.deepEqual(ft.filesIn('Bump to v2.0 and call e.g. the API'), []);
  assert.deepEqual(ft.filesIn('@panel.css is odd'), ['panel.css']);
});

// ---- what the conversation has been about

test('recentOf keeps the last few asks with their replies, and every file touched', () => {
  const r = ft.recentOf(CONVO);
  assert.deepEqual(r.asks, ['Fix the scheduler so routines run at the right time in src/main/routines/index.js', 'Now add a test for a routine that runs weekly']);
  assert.match(r.replies[0], /time zone/);
  assert.match(r.replies[1], /weekly case/);
  assert.deepEqual(r.files, ['src/main/routines/index.js', 'test/routines.test.js']);
});

test('recentOf counts a file a tool touched even when no changes item names it, and a message naming it stays here', () => {
  const r = ft.recentOf([user('Tidy the weather widget'), edit('src/main/weather/index.js'), { kind: 'tool', id: 'tu-r', name: 'Read', readPath: 'docs/WEATHER.md' }]);
  assert.deepEqual(r.files, ['src/main/weather/index.js', 'docs/WEATHER.md']);
  const t = ft.looksNewTopic('Something quite different about the forecast cache in weather/index.js', r);
  assert.equal(t.why, 'files');
  assert.deepEqual(t.files, ['weather/index.js']);
});

test('recentOf starts over after a fresh start or /clear, and skips routine and workflow turns', () => {
  const r = ft.recentOf([user('old topic about widgets'), { kind: 'fresh' }, user('new one'), { kind: 'user', text: 'tidy up', routine: { id: 'r1' } }]);
  assert.deepEqual(r.asks, ['new one']);
  assert.deepEqual(ft.recentOf([user('a'), { kind: 'cleared' }]).asks, []);
  assert.deepEqual(ft.recentOf(null).asks, []);
});

test('looksNewTopic: a message about something else is new', () => {
  const t = ft.looksNewTopic('Explain how the weather widget fetches its forecast and caches it', ft.recentOf(CONVO));
  assert.equal(t.fresh, true);
  assert.equal(t.why, 'new');
  assert.equal(t.overlap, 0);
});

test('looksNewTopic: a message that carries on the same topic is not', () => {
  const t = ft.looksNewTopic('The weekly routine test still fails on the scheduler, run the suite again', ft.recentOf(CONVO));
  assert.equal(t.fresh, false);
  assert.equal(t.why, 'same');
  assert.ok(t.overlap > ft.OVERLAP_MAX, `overlap ${t.overlap}`);
});

test('looksNewTopic: naming a file this conversation touched keeps it here, by path or by name', () => {
  const byPath = ft.looksNewTopic('Something unrelated in src/main/routines/index.js looks wrong', ft.recentOf(CONVO));
  assert.equal(byPath.fresh, false);
  assert.equal(byPath.why, 'files');
  assert.deepEqual(byPath.files, ['src/main/routines/index.js']);
  const byName = ft.looksNewTopic('Open routines.test.js and rename the weird describe blocks', ft.recentOf(CONVO));
  assert.equal(byName.why, 'files');
});

test('looksNewTopic: a short follow-up is never a new topic', () => {
  assert.deepEqual(ft.looksNewTopic('yes do it', ft.recentOf(CONVO)), { fresh: false, why: 'short', overlap: null, files: [] });
  assert.equal(ft.looksNewTopic('', ft.recentOf(CONVO)).fresh, false);
  assert.equal(ft.looksNewTopic('Explain how the weather widget fetches its forecast', null).fresh, true, 'nothing recent: anything is new');
});

test('shouldOffer needs a well-filled context and a new topic', () => {
  const fresh = { fresh: true };
  assert.equal(ft.shouldOffer({ pct: ft.HANDOFF_PCT, topic: fresh }), true);
  assert.equal(ft.shouldOffer({ pct: 95, topic: fresh }), true);
  assert.equal(ft.shouldOffer({ pct: ft.HANDOFF_PCT - 1, topic: fresh }), false);
  assert.equal(ft.shouldOffer({ pct: 90, topic: { fresh: false } }), false);
  assert.equal(ft.shouldOffer({ pct: null, topic: fresh }), false);
  assert.equal(ft.shouldOffer({ pct: 90, topic: null }), false);
});

// ---- the summary

test('summarize gathers the title, the asks, the files with their lines, the commits and the open to-dos', () => {
  const s = ft.summarize(CONVO, { title: 'Scheduler fix' });
  const want = [
    '# Handoff: Scheduler fix',
    'Written by Shellby from what he saw in the conversation, not by Claude.',
    '',
    '## Asked lately',
    '- Fix the scheduler so routines run at the right time in src/main/routines/index.js',
    '- Now add a test for a routine that runs weekly',
    '',
    '## Files changed',
    '- src/main/routines/index.js (+12 −3)',
    '- test/routines.test.js (+35 −2)',
    '',
    '## Commits',
    '- fix: routines run at their own time',
    '',
    '## Open to-dos',
    '- [ ] Run the suite',
  ].join('\n');
  assert.equal(s.text, want);
  assert.deepEqual(s.counts, { asks: 2, files: 2, commits: 1, todos: 1 });
  assert.equal(s.tokens, Math.ceil(want.length / ft.CHARS_PER_TOKEN));
});

test('summarize says so when there is nothing to carry over, and only what came after a fresh start', () => {
  assert.match(ft.summarize([], { title: '' }).text, /^# Handoff: a conversation\n.*\n\nNothing was asked, changed or committed in it yet\.$/s);
  const s = ft.summarize([...CONVO, { kind: 'fresh' }, user('Something new')], { title: 'T' });
  assert.equal(s.counts.files, 0);
  assert.deepEqual(s.counts, { asks: 1, files: 0, commits: 0, todos: 0 });
});

test('summarize keeps the newest asks, folds a long list of files and caps the whole thing', () => {
  const many = Array.from({ length: ft.MAX_FILES + 5 }, (_, i) => [`src/file${i}.js`, 1, 0]);
  const asks = Array.from({ length: ft.MAX_ASKS + 3 }, (_, i) => user(`ask number ${i} about something`));
  const s = ft.summarize([...asks, changes(many)], { title: 'Big' });
  assert.match(s.text, new RegExp(`## Files changed \\(${ft.MAX_FILES} of ${ft.MAX_FILES + 5}\\)`));
  assert.equal((s.text.match(/^- ask number/gm) || []).length, ft.MAX_ASKS);
  assert.match(s.text, /- ask number 6 about something/, 'the newest ask is there');
  assert.doesNotMatch(s.text, /- ask number 0 about/, 'the oldest is not');
  // Every section at its cap, each line as long as a line gets: more than the whole summary may be.
  const long = n => Array.from({ length: n }, (_, i) => `${i} ${'y'.repeat(300)}`);
  const huge = ft.summarize([
    ...long(ft.MAX_ASKS + 3).map(user),
    changes(long(ft.MAX_FILES + 5).map(p => [`src/${p.replace(' ', '/')}.js`, 1, 0])),
    ...long(ft.MAX_COMMITS + 5).map(commit),
    ...long(ft.MAX_TODOS + 5).flatMap((t, i) => [todo(100 + i, t), todoMade(100 + i, `td-${100 + i}`)]),
  ], { title: 'Huge' });
  assert.equal(huge.text.length, ft.MAX_SUMMARY);
  assert.ok(huge.text.endsWith('…'));
  assert.ok(ft.summarize(CONVO, { title: 'T' }).text.length < ft.MAX_SUMMARY, 'an ordinary one is well under');
});

test('summarize counts an in-progress to-do as open and marks it', () => {
  const s = ft.summarize([todo(1, 'Write it'), todoMade(1, 'td-1'), { kind: 'tool', id: 'tu-x', name: 'TaskUpdate', todo: { op: 'update', id: 'td-1', status: 'in_progress' } }], { title: 'T' });
  assert.match(s.text, /- \[~\] Write it/);
});

// ---- what it saves and what the new tab gets

test('saved is the context less the summary, never below zero, and null without a reading', () => {
  assert.equal(ft.saved(120000, 400), 119600);
  assert.equal(ft.saved(100, 400), 0);
  assert.equal(ft.saved(null, 400), null);
  assert.equal(ft.saved(0, 400), null);
});

test('titleFor names the new tab for the ask, on one line and clipped, or for where it came from', () => {
  assert.equal(ft.titleFor('Explain the weather widget', 'Old'), 'Explain the weather widget');
  assert.equal(ft.titleFor('  line one\nline two  ', 'Old'), 'line one line two');
  const long = ft.titleFor('x'.repeat(100), 'Old');
  assert.equal(long.length, ft.TITLE_CHARS);
  assert.ok(long.endsWith('…'));
  assert.equal(ft.titleFor('', 'Scheduler fix'), 'Fresh: Scheduler fix');
  assert.equal(ft.titleFor('', 'y'.repeat(100)).length, ft.TITLE_CHARS);
  assert.equal(ft.titleFor(null, ''), 'Fresh: a conversation');
});

test('firstMessage carries the summary and then the ask, or says to pick up from there', () => {
  const m = ft.firstMessage('# Handoff: T\n- stuff', 'Explain the weather widget');
  assert.match(m, /^Shellby started this tab fresh to save context\./);
  assert.match(m, /\n\n# Handoff: T\n- stuff\n\n---\n\nExplain the weather widget$/);
  assert.match(ft.firstMessage('  # Handoff  ', ''), /# Handoff\n\nPick up from there, and wait for what is next\.$/);
  assert.match(ft.firstMessage('', 'x'), /\(nothing to carry over\)/);
});
