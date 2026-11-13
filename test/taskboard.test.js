const { test } = require('node:test');
const assert = require('node:assert/strict');
const board = require('../src/main/taskboard/board');

const A = { tab: 'tab-a', title: 'Planner' };
const B = { tab: 'tab-b', title: 'Helper' };
const C = { tab: 'tab-c', title: 'Other helper' };
const NOW = 1_700_000_000_000;
let n = 0;
const nextId = () => `b-${String(++n).padStart(6, '0')}`;

function posted(state, input, by = A) {
  const r = board.post(state, { project: 'c:\\repo', ...input }, { by, now: NOW, id: nextId() });
  assert.equal(r.ok, true, r.error);
  return r;
}

test('posting adds an open task and reports a posted event without touching the old state', () => {
  const empty = board.normalize(null);
  const r = posted(empty, { title: '  Write the migration\n', detail: 'Add a nullable column.' });
  assert.equal(empty.tasks.length, 0);
  assert.equal(r.task.status, 'open');
  assert.equal(r.task.title, 'Write the migration');
  assert.deepEqual(r.task.postedBy, A);
  assert.equal(r.event.kind, 'posted');
});

test('a task needs a title, and only tasks on the same board can be needed', () => {
  const s = posted(board.normalize(null), { title: 'First' }).state;
  assert.equal(board.post(s, { title: '  ' }, { by: A, now: NOW, id: nextId() }).ok, false);
  assert.match(board.post(s, { title: 'x', needs: ['b-nothere'] }, { by: A, now: NOW, id: nextId() }).error, /no task/);
  const other = board.post(s, { title: 'x', project: 'c:\\other', needs: [s.tasks[0].id] }, { by: A, now: NOW, id: nextId() });
  assert.match(other.error, /another project/);
});

test('a task waits for what it needs, then becomes ready', () => {
  let s = board.normalize(null);
  const first = posted(s, { title: 'Schema' });
  s = first.state;
  const second = posted(s, { title: 'API', needs: [first.task.id] });
  s = second.state;
  assert.deepEqual(board.list(s, { status: 'ready' }).map(t => t.id), [first.task.id]);
  assert.match(board.claim(s, second.task.id, { by: B, now: NOW }).error, /waiting on/);
  s = board.complete(s, first.task.id, { outcome: 'done', result: 'Added it.', by: B, now: NOW }).state;
  assert.deepEqual(board.list(s, { status: 'ready' }).map(t => t.id), [second.task.id]);
});

test('a failed need blocks the task for good', () => {
  let s = board.normalize(null);
  const first = posted(s, { title: 'Schema' });
  s = posted(first.state, { title: 'API', needs: [first.task.id] }).state;
  s = board.complete(s, first.task.id, { outcome: 'failed', result: 'The DB is read-only.', by: B, now: NOW }).state;
  const api = s.tasks[1];
  assert.match(board.claim(s, api.id, { by: C, now: NOW }).error, /failed/);
  assert.equal(board.list(s, { status: 'ready' }).length, 0);
});

test('only one conversation can hold a claim, and claiming again is harmless', () => {
  const p = posted(board.normalize(null), { title: 'Tests' });
  const c = board.claim(p.state, p.task.id, { by: B, now: NOW });
  assert.equal(c.ok, true);
  assert.equal(c.event.kind, 'claimed');
  assert.match(board.claim(c.state, p.task.id, { by: C, now: NOW }).error, /already claimed by "Helper"/);
  const again = board.claim(c.state, p.task.id, { by: B, now: NOW });
  assert.equal(again.ok, true);
  assert.equal(again.event, null);
});

test('completing needs the claimer and a result; an open ready task is claimed on the way', () => {
  const p = posted(board.normalize(null), { title: 'Docs' });
  assert.match(board.complete(p.state, p.task.id, { outcome: 'done', result: '', by: B, now: NOW }).error, /Say what you did/);
  const done = board.complete(p.state, p.task.id, { outcome: 'done', result: 'Wrote README.', by: B, now: NOW });
  assert.equal(done.ok, true);
  assert.equal(done.task.status, 'done');
  assert.deepEqual(done.task.claimedBy, B);
  const claimed = board.claim(p.state, p.task.id, { by: B, now: NOW }).state;
  assert.match(board.complete(claimed, p.task.id, { outcome: 'done', result: 'x', by: C, now: NOW }).error, /not you/);
});

test('releasing puts a claimed task back to open', () => {
  const p = posted(board.normalize(null), { title: 'Lint' });
  const s = board.claim(p.state, p.task.id, { by: B, now: NOW }).state;
  assert.match(board.complete(s, p.task.id, { outcome: 'released', by: C, now: NOW }).error, /haven't claimed/);
  const r = board.complete(s, p.task.id, { outcome: 'released', by: B, now: NOW });
  assert.equal(r.task.status, 'open');
  assert.equal(r.task.claimedBy, null);
});

test('a closed conversation\'s claims go back to open', () => {
  const p = posted(board.normalize(null), { title: 'Bench' });
  const s = board.claim(p.state, p.task.id, { by: B, now: NOW }).state;
  const kept = board.releaseGone(s, () => true);
  assert.equal(kept.state, s);
  const r = board.releaseGone(s, tab => tab !== B.tab);
  assert.equal(r.state.tasks[0].status, 'open');
  assert.deepEqual(r.events.map(e => e.kind), ['released']);
});

test('only the poster or the user can cancel', () => {
  const p = posted(board.normalize(null), { title: 'Spike' });
  assert.match(board.cancel(p.state, p.task.id, { by: B, now: NOW }).error, /Only the conversation/);
  assert.equal(board.cancel(p.state, p.task.id, { by: A, now: NOW }).task.status, 'cancelled');
  assert.equal(board.cancel(p.state, p.task.id, { user: true, now: NOW }).task.status, 'cancelled');
});

test('settled is true only once every id has finished', () => {
  let s = board.normalize(null);
  const a = posted(s, { title: 'One' }); s = a.state;
  const b = posted(s, { title: 'Two' }); s = b.state;
  s = board.complete(s, a.task.id, { outcome: 'done', result: 'ok', by: B, now: NOW }).state;
  assert.equal(board.settled(s, [a.task.id, b.task.id]).settled, false);
  s = board.cancel(s, b.task.id, { user: true, now: NOW }).state;
  assert.equal(board.settled(s, [a.task.id, b.task.id]).settled, true);
  assert.deepEqual(board.settled(s, ['b-missing']).missing, ['b-missing']);
});

test('lists filter by project and status', () => {
  let s = board.normalize(null);
  s = posted(s, { title: 'Here' }).state;
  s = posted(s, { title: 'There', project: 'c:\\other' }).state;
  assert.equal(board.list(s, { project: 'c:\\repo' }).length, 1);
  assert.equal(board.list(s, { project: null }).length, 2);
  assert.equal(board.list(s, { status: 'done' }).length, 0);
});

test('reading the file back drops what is malformed and opens a claim with no claimer', () => {
  const s = board.normalize({ tasks: [
    { id: 'b-aaaaaa', title: 'Good', status: 'open', postedAt: NOW },
    { id: 'b-aaaaaa', title: 'Duplicate', status: 'open' },
    { id: 'nope', title: 'Bad id', status: 'open' },
    { id: 'b-bbbbbb', title: '', status: 'open' },
    { id: 'b-cccccc', title: 'Orphan claim', status: 'claimed', claimedBy: { tab: '../../x' } },
    { id: 'b-dddddd', title: 'Odd status', status: 'exploded' },
  ] });
  assert.deepEqual(s.tasks.map(t => [t.id, t.status]), [['b-aaaaaa', 'open'], ['b-cccccc', 'open']]);
});

test('a full board drops finished tasks first, and refuses past the unfinished limit', () => {
  const many = Array.from({ length: board.MAX_TASKS }, (_, i) => ({ id: `b-${String(i).padStart(6, '0')}x`, title: `t${i}`, status: i < 5 ? 'done' : 'open', postedAt: NOW }));
  const open = board.normalize({ tasks: many.filter(t => t.status === 'open').slice(0, board.MAX_OPEN) });
  assert.match(board.post(open, { title: 'one more' }, { by: A, now: NOW, id: 'b-zzzzzz' }).error, /unfinished/);
  const full = { tasks: many.map(t => ({ ...t, status: 'done' })) };
  const r = board.post(board.normalize(full), { title: 'fresh' }, { by: A, now: NOW, id: 'b-yyyyyy' });
  assert.equal(r.state.tasks.length, board.MAX_TASKS);
  assert.equal(r.state.tasks.at(-1).title, 'fresh');
});

test('describe says who holds it, what it waits on and its result', () => {
  let s = board.normalize(null);
  const a = posted(s, { title: 'Schema' }); s = a.state;
  const b = posted(s, { title: 'API', needs: [a.task.id] }); s = b.state;
  assert.match(board.describe(s, b.task), /needs: b-/);
  s = board.claim(s, a.task.id, { by: B, now: NOW }).state;
  assert.match(board.describe(s, s.tasks[0]), /\[claimed by "Helper"\]/);
  s = board.complete(s, a.task.id, { outcome: 'done', result: 'Column added.', by: B, now: NOW }).state;
  assert.match(board.describe(s, s.tasks[0]), /result: Column added\./);
  assert.match(board.describe(s, s.tasks[1]), /\(ready\)/);
});
