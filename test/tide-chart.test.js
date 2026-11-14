const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/renderer/shared/tide-chart');
const { runsBetween, nextRun, TIDE } = require('../src/main/routines');
const { startsBetween } = require('../src/main/workflows/triggers');

// Local wall-clock, so these pass in any timezone. Fri 13 Nov 2026, 23:30.
const at = (d, h = 0, m = 0) => new Date(2026, 10, d, h, m).getTime();
const H = 3600000;
const NOW = at(13, 23, 30);

const routine = (extra = {}) => ({ id: 'r1', name: 'PFAS rules watch', enabled: true, upcoming: [], recent: [], lastStatus: null, ...extra });
const workflow = (extra = {}) => ({ id: 'w1', name: 'Red build fixer', enabled: true, upcoming: [], recent: [], listening: null, ...extra });

// ---- main's side: the starts it sends

test('runsBetween lists each start in the window, soonest first, and stops at the cap', () => {
  const daily = { enabled: true, schedule: { type: 'daily', time: '20:00' }, createdAt: at(1) };
  const week = runsBetween(t => nextRun(daily, t), NOW, NOW + 7 * 24 * H);
  assert.equal(week.length, 7);
  assert.equal(week[0], at(14, 20));
  assert.deepEqual(runsBetween(t => nextRun(daily, t), NOW, NOW + 7 * 24 * H, 3), week.slice(0, 3));
});

test('runsBetween gives nothing for a paused schedule or a bad window', () => {
  const paused = { enabled: false, schedule: { type: 'daily', time: '20:00' }, createdAt: at(1) };
  assert.deepEqual(runsBetween(t => nextRun(paused, t), NOW, NOW + 24 * H), []);
  assert.deepEqual(runsBetween(() => NOW + H, NaN, NOW), []);
});

test('startsBetween merges a workflow\'s schedules without repeats, and a paused one has none', () => {
  const wf = {
    enabled: true, createdAt: at(1),
    when: [{ type: 'schedule', schedule: { type: 'daily', time: '08:30' } }, { type: 'schedule', schedule: { type: 'weekly', time: '08:30', days: [1] } }, { type: 'ci', on: 'failed' }],
  };
  const starts = startsBetween(wf, NOW, NOW + 3 * 24 * H);
  assert.deepEqual(starts, [at(14, 8, 30), at(15, 8, 30), at(16, 8, 30)]);
  assert.deepEqual(startsBetween({ ...wf, enabled: false }, NOW, NOW + 3 * 24 * H), []);
});

test('a schedule too sparse for a streak is never cut short by the cap', () => {
  const every3h = { enabled: true, schedule: { type: 'interval', everyHours: 3 }, createdAt: at(1) };
  const week = runsBetween(t => nextRun(every3h, t), NOW, NOW + TIDE.aheadMs);
  assert.equal(week.length, 56);
  assert.ok(week[week.length - 1] > NOW + TIDE.aheadMs - 3 * H);
});

test('odd data from main draws nothing for it rather than throwing', () => {
  const c = T.build({
    now: NOW,
    routines: [null, { id: 'r', upcoming: [NOW + H], recent: 'nope' }],
    workflows: [undefined, { id: 'w', name: 42, recent: [{ at: NOW - H, status: 'constructor' }, null], upcoming: null, listening: 'When files change' }],
    held: 'nope',
  });
  assert.deepEqual(c.marks.map(m => [m.name, m.tone]), [['', 'done'], ['', 'plan']]);
  assert.deepEqual(c.listening, [{ id: 'w', name: '', text: 'When files change' }]);
});

test('the chart\'s reach covers the week ahead it draws', () => {
  assert.ok(TIDE.aheadMs >= T.RANGES.week.ahead);
  assert.ok(TIDE.behindMs >= T.RANGES.week.behind);
});

// ---- the chart

test('an empty Automate page has an empty chart', () => {
  const c = T.build({ now: NOW });
  assert.equal(c.empty, true);
  assert.deepEqual(c.marks, []);
});

test('past runs sit behind now and upcoming ones ahead, in time order', () => {
  const c = T.build({ now: NOW, routines: [routine({ recent: [at(13, 8, 30)], lastStatus: 'ok', upcoming: [at(16, 8, 30)] })] });
  assert.equal(c.empty, false);
  assert.deepEqual(c.marks.map(m => [m.past, m.tone]), [[true, 'ok'], [false, 'plan']]);
  assert.ok(c.marks[0].pct < c.nowPct && c.marks[1].pct > c.nowPct);
});

test('only the latest past run of a routine carries its status', () => {
  const c = T.build({ now: NOW, routines: [routine({ recent: [at(12, 20), at(13, 20)], lastStatus: 'error' })] });
  assert.deepEqual(c.marks.map(m => m.tone), ['done', 'err']);
});

test('a paused routine shows what it did, nothing to come', () => {
  const c = T.build({ now: NOW, routines: [routine({ enabled: false, recent: [at(13, 20)], lastStatus: 'ok', upcoming: [at(14, 20)] })] });
  assert.deepEqual(c.marks.map(m => m.past), [true]);
});

test('workflow runs keep their run, and each status its tone', () => {
  const recent = [['ok', 'ok'], ['error', 'err'], ['waiting', 'wait'], ['running', 'run'], ['stopped', 'off'], ['odd', 'done']]
    .map(([status], i) => ({ at: at(12, 12) + i * T.DENSE_GAP, status, runId: `run${i}` })); // spaced out, so none are thinned
  const c = T.build({ now: NOW, workflows: [workflow({ recent })] });
  assert.deepEqual(c.marks.map(m => m.tone), ['ok', 'err', 'wait', 'run', 'off', 'done']);
  assert.equal(c.marks[1].runId, 'run1');
});

test('marks outside the range are left off', () => {
  const c = T.build({ now: NOW, range: 'day', routines: [routine({ upcoming: [at(14, 8, 30), at(16, 8, 30)], recent: [at(10, 8)] })] });
  assert.equal(c.marks.length, 1);
});

test('held work shows where it will run, and the window it waits on is shaded', () => {
  const resetAt = at(14, 2, 10);
  const c = T.build({ now: NOW, resetAt, held: [{ id: 'h1', kind: 'task', name: 'Refactor billing', at: resetAt }, { id: 'h2', kind: 'note', at: resetAt }] });
  assert.deepEqual(c.marks.map(m => [m.kind, m.tone, m.name]), [['held', 'held', 'Refactor billing']]);
  assert.ok(c.band.left < c.nowPct && c.band.right > c.nowPct);
  assert.equal(c.band.at, resetAt);
});

test('no band once the reset has passed or when there is none', () => {
  assert.equal(T.build({ now: NOW, resetAt: NOW - H }).band, null);
  assert.equal(T.build({ now: NOW }).band, null);
});

test('workflows that wait on events are listening, with what they wait for', () => {
  const c = T.build({ now: NOW, workflows: [workflow({ listening: 'When a pull request goes red' }), workflow({ id: 'w2', listening: null }), workflow({ id: 'w3', enabled: false, listening: 'When files change' })] });
  assert.deepEqual(c.listening, [{ id: 'w1', name: 'Red build fixer', text: 'When a pull request goes red' }]);
  assert.equal(c.empty, false);
});

test('each thing names its next start once; its later starts are dots', () => {
  const upcoming = [1, 2, 3].map(d => at(14 + d, 9));
  const c = T.build({ now: NOW, widthPx: 1200, routines: [routine({ upcoming })] });
  assert.deepEqual(c.marks.map(m => !!m.label), [true, false, false]);
});

test('labels that would cover each other go on another row, and drop when rows run out', () => {
  const four = [1, 2, 3, 4].map(i => routine({ id: `r${i}`, upcoming: [at(15, 9, i)] }));
  const c = T.build({ now: NOW, widthPx: 1200, routines: four });
  assert.deepEqual(c.marks.map(m => m.label?.level ?? null), [0, 1, 2, null]);
});

test('a failed or waiting run is named even though it is past', () => {
  const c = T.build({ now: NOW, widthPx: 1200, workflows: [workflow({ recent: [{ at: at(13, 9), status: 'ok' }, { at: at(13, 22), status: 'waiting' }] })] });
  assert.deepEqual(c.marks.map(m => !!m.label), [false, true]);
});

test('labels stay inside the chart at both ends', () => {
  const c = T.build({ now: NOW, widthPx: 300, routines: [routine({ name: 'A long routine name near the end', upcoming: [NOW + T.RANGES.week.ahead - H] })] });
  const l = c.marks[0].label;
  assert.ok(l && l.left >= 0 && l.left + l.width <= 100.0001);
});

test('a schedule every few minutes is one streak to the chart\'s end, named with how often', () => {
  const upcoming = Array.from({ length: 48 }, (_, i) => NOW + (i + 1) * 15 * 60000);
  const c = T.build({ now: NOW, widthPx: 1200, workflows: [workflow({ name: 'Site watch', upcoming })] });
  assert.equal(c.marks.length, 1);
  const [m] = c.marks;
  assert.equal(m.name, 'Site watch, every 15 min');
  assert.equal(m.streak.end, c.to);
  assert.ok(Math.abs(m.streak.endPct - 100) < 1e-9);
  assert.ok(m.label && Math.abs(m.label.left - m.pct) < 1e-9); // its name starts where it does
});

test('a frequent schedule keeps only its latest run and the ones that need a look', () => {
  const recent = Array.from({ length: 10 }, (_, i) => ({ at: NOW - (10 - i) * 30 * 60000, status: i === 3 ? 'error' : 'ok' }));
  const c = T.build({ now: NOW, workflows: [workflow({ recent })] });
  assert.deepEqual(c.marks.map(m => m.tone), ['err', 'ok']);
});

test('daily runs are never a streak, and held tasks never are', () => {
  const daily = Array.from({ length: 7 }, (_, i) => at(14 + i, 9));
  const held = Array.from({ length: 7 }, (_, i) => ({ id: `h${i}`, kind: 'task', name: 'Task', at: NOW + (i + 1) * 60000 }));
  const c = T.build({ now: NOW, routines: [routine({ upcoming: daily })], held });
  assert.equal(c.marks.filter(m => m.streak).length, 0);
  assert.equal(c.marks.length, 14);
});

test('everyText says how often in plain words', () => {
  assert.equal(T.everyText(5 * 60000), 'every 5 min');
  assert.equal(T.everyText(H), 'every hour');
  assert.equal(T.everyText(2 * H), 'every 2 hours');
});

test('the week has a line at each midnight and names each day, today as Today', () => {
  const c = T.build({ now: NOW, locale: 'en-US' });
  const names = c.ticks.filter(t => t.label).map(t => t.label);
  assert.ok(names.includes('Today'));
  // Thu (36 hours back) through the Friday a week on.
  assert.deepEqual(names, ['Thu', 'Today', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  assert.ok(c.ticks.filter(t => t.line).every(t => new Date(t.at).getHours() === 0));
});

test('the day view marks every six hours', () => {
  const c = T.build({ now: NOW, range: 'day', locale: 'en-US' });
  assert.ok(c.ticks.length >= 5);
  assert.ok(c.ticks.every(t => new Date(t.at).getHours() % 6 === 0 && t.at >= c.from && t.at <= c.to));
});
