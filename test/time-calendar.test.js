// The Time tab's month calendar (src/renderer/shared/time-calendar.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/renderer/shared/time-calendar');

const H = 3600;
// A summary as main's timetrack.summarize() returns it, cut down to what the calendar reads.
const row = (day, total, extra = {}) => ({ day, total, tracked: total, manual: 0, estimate: 0, estimated: false, note: '', billed: total, commits: [], commitCount: 0, ...extra });
const summary = projects => ({ currency: 'USD', projects, days: [], totals: { seconds: projects.reduce((n, p) => n + p.seconds, 0), billed: 0, amount: 0, unfilled: 0 } });
const project = (key, name, rows, extra = {}) => ({ key, name, client: '', rate: null, billable: true, days: rows, seconds: rows.reduce((n, r) => n + r.total, 0), billed: 0, amount: 0, ...extra });

test('monthOf gives the month a day is in', () => {
  assert.equal(C.monthOf('2026-11-13'), '2026-11');
});

test('shiftMonth steps across a year in both directions', () => {
  assert.equal(C.shiftMonth('2026-11', 1), '2026-12');
  assert.equal(C.shiftMonth('2026-12', 1), '2027-01');
  assert.equal(C.shiftMonth('2026-01', -1), '2025-12');
});

test('monthRange runs from the 1st to the last day, whatever the month length', () => {
  assert.deepEqual(C.monthRange('2026-11'), { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(C.monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(C.monthRange('2026-12'), { from: '2026-12-01', to: '2026-12-31' });
});

test('weeks start on Monday and fill out the first and last week from the months around', () => {
  const weeks = C.weeks('2026-11', '2026-11-13');
  // Nov 1 2026 is a Sunday: the first week starts Monday Oct 26.
  assert.equal(weeks[0][0].day, '2026-10-26');
  assert.equal(weeks[0][6].day, '2026-11-01');
  assert.equal(weeks[0][0].inMonth, false);
  assert.equal(weeks[0][6].inMonth, true);
  assert.equal(weeks.at(-1)[6].day, '2026-12-06');
  assert.ok(weeks.every(w => w.length === 7));
  assert.equal(weeks.length, 6);
});

test('weeks mark today and the days after it', () => {
  const cells = C.weeks('2026-11', '2026-11-13').flat();
  assert.equal(cells.find(c => c.day === '2026-11-13').today, true);
  assert.equal(cells.find(c => c.day === '2026-11-13').future, false);
  assert.equal(cells.find(c => c.day === '2026-11-14').future, true);
  assert.equal(cells.find(c => c.day === '2026-11-12').future, false);
});

test('a month that starts on Monday has no days from the month before', () => {
  const weeks = C.weeks('2026-06', '2026-06-10');
  assert.equal(weeks[0][0].day, '2026-06-01');
  assert.equal(weeks[0][0].inMonth, true);
});

test('level steps up with the hours, from none to a long day', () => {
  assert.equal(C.level(0), 0);
  assert.equal(C.level(30 * 60), 1);
  assert.equal(C.level(2.5 * H), 2);
  assert.equal(C.level(4.5 * H), 3);
  assert.equal(C.level(7 * H), 4);
  assert.equal(C.level(12 * H), 4);
});

test('byDay totals each day across projects, biggest project first', () => {
  const s = summary([
    project('a', 'shellby', [row('2026-11-12', 5 * H), row('2026-11-13', 1 * H)]),
    project('b', 'booking', [row('2026-11-12', 2 * H)]),
  ]);
  const days = C.byDay(s);
  assert.equal(days.get('2026-11-12').seconds, 7 * H);
  assert.deepEqual(days.get('2026-11-12').mix.map(m => m.key), ['a', 'b']);
  assert.equal(days.get('2026-11-13').seconds, 1 * H);
  assert.equal(days.get('2026-11-01'), undefined);
});

test('byDay flags a day with commits but no time as one to guess at', () => {
  const s = summary([project('a', 'shellby', [row('2026-11-11', 0, { tracked: 0, estimate: 45 * 60, commitCount: 3 })])]);
  const d = C.byDay(s).get('2026-11-11');
  assert.equal(d.seconds, 0);
  assert.equal(d.guess, 45 * 60);
});

test('lines lists each project with something on that day, with its time and where it came from', () => {
  const s = summary([
    project('a', 'shellby', [row('2026-11-12', 5 * H, { commits: [{ at: 1, subject: 'feat: x' }], commitCount: 1 })]),
    project('b', 'booking', [row('2026-11-12', 2.75 * H, { tracked: 2.5 * H, manual: 15 * 60, note: 'Calendar sync' })], { client: 'Northwind' }),
    project('c', 'rack', [row('2026-11-11', H)]),
  ]);
  const lines = C.lines(s, '2026-11-12');
  assert.deepEqual(lines.map(l => l.key), ['a', 'b']);
  assert.equal(lines[1].client, 'Northwind');
  assert.equal(lines[1].note, 'Calendar sync');
  assert.equal(lines[1].manual, 15 * 60);
  assert.equal(lines[0].commitCount, 1);
});

test('lines puts the biggest day first and is empty for a day with nothing', () => {
  const s = summary([project('a', 'small', [row('2026-11-12', H)]), project('b', 'big', [row('2026-11-12', 3 * H)])]);
  assert.deepEqual(C.lines(s, '2026-11-12').map(l => l.name), ['big', 'small']);
  assert.deepEqual(C.lines(s, '2026-11-02'), []);
});

test('stats averages over the days with time, not every day of the month', () => {
  const s = summary([project('a', 'shellby', [row('2026-11-02', 4 * H), row('2026-11-03', 6 * H)])]);
  const st = C.stats(s);
  assert.equal(st.seconds, 10 * H);
  assert.equal(st.daysWorked, 2);
  assert.equal(st.perDay, 5 * H);
});

test('stats has no average when nothing was kept', () => {
  assert.equal(C.stats(summary([])).perDay, 0);
  assert.equal(C.stats(summary([])).daysWorked, 0);
});

test('pickDay keeps a picked day in the month, else today, else the last day with time', () => {
  const s = summary([project('a', 'shellby', [row('2026-10-20', H), row('2026-10-28', H)])]);
  assert.equal(C.pickDay('2026-11', '2026-11-13', '2026-11-05', s), '2026-11-05');
  assert.equal(C.pickDay('2026-11', '2026-11-13', '2026-10-05', s), '2026-11-13');
  assert.equal(C.pickDay('2026-10', '2026-11-13', null, s), '2026-10-28');
  assert.equal(C.pickDay('2026-09', '2026-11-13', null, summary([])), '2026-09-30');
});

test('pickDay never picks a day after today', () => {
  assert.equal(C.pickDay('2026-11', '2026-11-13', '2026-11-20', summary([])), '2026-11-13');
});

test('colours gives the busiest projects a colour each, in order, and the rest none', () => {
  const projects = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((k, i) => project(k, k, [row('2026-11-02', (10 - i) * H)]));
  const colours = C.colours(summary(projects));
  assert.equal(colours.get('a'), 0);
  assert.equal(colours.get('e'), 4);
  assert.equal(colours.get('f'), undefined);
});

test('monthLabel names the month and year', () => {
  assert.match(C.monthLabel('2026-11'), /November/);
  assert.match(C.monthLabel('2026-11'), /2026/);
});

test('clock gives hours and minutes the way a timesheet does', () => {
  assert.equal(C.clock(0), '0:00');
  assert.equal(C.clock(5 * 60), '0:05');
  assert.equal(C.clock(8 * H + 20 * 60), '8:20');
  assert.equal(C.clock(29), '0:00');
});

test('nudge takes off 15 minutes, but never more than the day has', () => {
  assert.equal(C.nudge({ total: 2 * H }, -1), -15);
  assert.equal(C.nudge({ total: 10 * 60 }, -1), -10);
});

test('nudge adds 15 minutes, and on a guessed day keeps the guess as well', () => {
  assert.equal(C.nudge({ total: H }, 1), 15);
  assert.equal(C.nudge({ total: 4 * H, estimated: true, estimate: 4 * H }, 1), 4 * 60 + 15);
});
