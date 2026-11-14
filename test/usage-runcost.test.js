// What a run is likely to cost before it starts (src/main/usage/runcost.js):
// past Ultracode runs, past runs of one workflow, past turns that fanned out.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const rc = require('../src/main/usage/runcost');
const ledger = require('../src/main/usage/ledger');

const NOW = Date.UTC(2026, 10, 14, 12, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// A turn's row with both a rise and a weight, so the ledger knows what a weight is worth: 1000 weight = 1%.
const turn = (over = {}) => ({ at: NOW - 2 * HOUR, pk: 'c:\\code\\app', project: 'app', model: 'claude-opus-4-8', category: 'fix', size: 's', kind: 'tab', weight: 1000, pctRise: 1, ok: true, ...over });
const ultra = (pct, over = {}) => turn({ kind: 'ultracode', run: `w${pct}`, weight: pct * 1000, pctRise: null, category: 'other', ...over });
const step = (run, pct, over = {}) => turn({ kind: 'workflow', wf: 'wf-nightly', run, weight: pct * 1000, pctRise: null, ...over });
// A ledger with enough rows for the weight-to-percent ratio, plus whatever the test adds.
const rows = (...extra) => ledger.normalize([turn(), turn(), turn(), ...extra], NOW);
const advice = (now, { line = 100, resetsAt = NOW + 3 * HOUR } = {}) => ({ over: false, line, now, left: Math.max(0, line - now), resetsAt });

// ---- fanout

test('fanout reads a message that asks for several helpers at once', () => {
  const yes = [
    'Use 3 subagents to audit the repo',
    'Send out several helpers, one per module',
    'Review these files in parallel',
    'Spawn agents to check each package',
    'Fan out over the test suites and report back',
    'Run two agents at once on this',
  ];
  const no = ['Fix the login bug', 'What does the scheduler do?', 'Add a dark mode toggle', 'The agent is slow', '', null];
  for (const t of yes) assert.equal(rc.fanout(t), true, t);
  for (const t of no) assert.equal(rc.fanout(t), false, String(t));
});

// ---- runsOf

test('runsOf lists past Ultracode runs as percent, through the weight ratio', () => {
  assert.deepEqual(rc.runsOf(rows(ultra(12), ultra(20)), { kind: 'ultracode', ratio: ledger.ratioOf(rows()), now: NOW }), [12, 20]);
});

test('runsOf adds a workflow run\'s steps up per run, for that workflow only', () => {
  const r = rows(step('run-a', 2), step('run-a', 3), step('run-b', 4), step('run-c', 9, { wf: 'wf-other' }));
  const ratio = ledger.ratioOf(r);
  assert.deepEqual(rc.runsOf(r, { kind: 'workflow', key: 'wf-nightly', ratio, now: NOW }), [5, 4]);
  assert.deepEqual(rc.runsOf(r, { kind: 'workflow', key: 'wf-other', ratio, now: NOW }), [9]);
  assert.deepEqual(rc.runsOf(r, { kind: 'workflow', key: 'wf-none', ratio, now: NOW }), []);
});

test('runsOf counts a turn as fanned out from two helpers up, and skips failed turns', () => {
  const r = rows(turn({ helpers: 1, pctRise: 2 }), turn({ helpers: 2, pctRise: 6 }), turn({ helpers: 5, pctRise: 8 }), turn({ helpers: 4, pctRise: 30, ok: false }));
  assert.deepEqual(rc.runsOf(r, { kind: 'fanout', now: NOW }), [6, 8]);
});

test('runsOf leaves out rows older than the ledger keeps, and rows with no way to a percent', () => {
  const old = ultra(50, { at: NOW - 61 * DAY });
  assert.deepEqual(rc.runsOf([old, ultra(10)], { kind: 'ultracode', ratio: 0.001, now: NOW }), [10]);
  assert.deepEqual(rc.runsOf([ultra(10)], { kind: 'ultracode', ratio: null, now: NOW }), [], 'a weight with no ratio says nothing');
  assert.deepEqual(rc.runsOf(null, { kind: 'ultracode', now: NOW }), []);
});

// ---- estimateRun

test('estimateRun takes the median and the middle half of past runs', () => {
  const r = rows(ultra(10), ultra(12), ultra(14), ultra(20), ultra(40));
  const e = rc.estimateRun(r, { kind: 'ultracode', ratio: ledger.ratioOf(r), now: NOW });
  assert.equal(e.basis, 'history');
  assert.equal(e.samples, 5);
  assert.equal(e.pct, 14);
  assert.equal(e.low, 12);
  assert.equal(e.high, 20);
});

test('estimateRun widens the range when there are only a couple of runs to go by', () => {
  const r = rows(ultra(20));
  const e = rc.estimateRun(r, { kind: 'ultracode', ratio: ledger.ratioOf(r), now: NOW });
  assert.equal(e.samples, 1);
  assert.equal(e.pct, 20);
  assert.equal(e.low, 14, 'a third under');
  assert.equal(e.high, 26, 'a third over');
});

test('estimateRun falls back to a labelled rough default with no history', () => {
  const e = rc.estimateRun(rows(), { kind: 'ultracode', ratio: 0.001, now: NOW });
  assert.equal(e.basis, 'default');
  assert.equal(e.samples, 0);
  assert.deepEqual([e.low, e.high], rc.DEFAULTS.ultracode);
  assert.equal(e.pct, (rc.DEFAULTS.ultracode[0] + rc.DEFAULTS.ultracode[1]) / 2);
  assert.equal(rc.estimateRun(rows(), { kind: 'workflow', key: 'wf-x', now: NOW }).basis, 'default');
  assert.equal(rc.estimateRun(rows(), { kind: 'fanout', now: NOW }).basis, 'default');
});

test('estimateRun only knows its kinds', () => {
  assert.equal(rc.estimateRun(rows(), { kind: 'tab', now: NOW }), null);
  assert.equal(rc.estimateRun(rows(), { kind: '', now: NOW }), null);
  assert.equal(rc.estimateRun(rows(), null), null);
});

test('estimateRun keeps only the newest runs', () => {
  const many = Array.from({ length: rc.RECENT + 10 }, (_, i) => ultra(i < 10 ? 90 : 10, { run: `w${i}`, at: NOW - (rc.RECENT + 10 - i) * HOUR }));
  const r = rows(...many);
  const e = rc.estimateRun(r, { kind: 'ultracode', ratio: ledger.ratioOf(r), now: NOW });
  assert.equal(e.samples, rc.RECENT);
  assert.equal(e.pct, 10, 'the ten old 90% runs have dropped off');
});

// ---- ending and words

test('ending says where the window would stand, or nothing without a reading', () => {
  const est = { kind: 'ultracode', pct: 15, low: 10, high: 25, samples: 4, basis: 'history' };
  assert.deepEqual(rc.ending(est, advice(40)), { nowPct: 40, endPct: 55, endLow: 50, endHigh: 65 });
  assert.deepEqual(rc.ending(est, advice(null)), { nowPct: null, endPct: null, endLow: null, endHigh: null });
});

test('words give the range, the ending and the reset, from history', () => {
  const v = rc.view({ kind: 'ultracode', pct: 15, low: 12, high: 18, samples: 4, basis: 'history' }, advice(47), { resetText: '4:15 PM' });
  assert.equal(v.text, 'An Ultracode run usually takes 12 to 18% of your 5-hour window (from your last 4 runs). You\'d end near 59 to 65%; it resets at 4:15 PM.');
  assert.equal(v.over, false);
  assert.equal(v.endPct, 62);
});

test('words say when the guess is rough, and when there is no reading to end from', () => {
  const v = rc.view({ kind: 'workflow', pct: 6, low: 2, high: 10, samples: 0, basis: 'default' }, advice(null), { name: 'Nightly tidy', resetText: null });
  assert.equal(v.text, '“Nightly tidy” hasn\'t run here yet; a rough guess is 2 to 10% of your 5-hour window.');
});

test('words name a single past run, and a range whose ends meet as "about"', () => {
  const v = rc.view({ kind: 'fanout', pct: 8, low: 8, high: 8, samples: 1, basis: 'history' }, advice(20), { resetText: '9:00 AM' });
  assert.equal(v.text, 'A turn with several helpers usually takes about 8% of your 5-hour window (from your 1 past run). You\'d end near 28%; it resets at 9:00 AM.');
});

test('words warn when it would run past the limit, or the share the guard keeps', () => {
  const est = { kind: 'ultracode', pct: 30, low: 20, high: 40, samples: 3, basis: 'history' };
  const past = rc.view(est, { ...advice(85), over: true }, { resetText: '4:15 PM' });
  assert.match(past.text, /You'd end near 105 to 125%; it resets at 4:15 PM\. That likely runs past your 5-hour limit before it finishes\.$/);
  assert.equal(past.over, true);
  const guarded = rc.view(est, { ...advice(60, { line: 75 }), over: true }, { resetText: '4:15 PM', guardOn: true });
  assert.match(guarded.text, /past the share you keep for yourself \(25%\)\.$/);
});

// ---- the short forms on and under the button

test('labels: the share for the button, the line under the box with the ending and the reset, and the strip\'s note', () => {
  const v = rc.view({ kind: 'ultracode', pct: 8, low: 5, high: 12, samples: 6, basis: 'history' }, advice(54), { resetText: '4:15 PM' });
  assert.equal(v.share, '~8%');
  assert.equal(v.label, '~8% of your window');
  assert.equal(v.hint, 'about 8% of your 5-hour window · it would end about 62% full · resets 4:15 PM');
  assert.equal(v.note, 'Runs like this took 5% to 12% of your 5-hour window before. Yours is 54% full.');
});

test('labels: a rough guess says so, and without a reading there is no ending, no reset and no "yours"', () => {
  const v = rc.view({ kind: 'workflow', pct: 6, low: 2, high: 10, samples: 0, basis: 'default' }, advice(null), { name: 'Triage' });
  assert.equal(v.label, '~6% of your window');
  assert.equal(v.hint, 'a rough guess: about 6% of your 5-hour window');
  assert.equal(v.note, 'Nothing like it has run here yet; a rough guess is 2 to 10% of your 5-hour window.');
  const half = rc.view({ kind: 'ultracode', pct: 27.5, low: 15, high: 40, samples: 0, basis: 'default' }, advice(20), { resetText: '9:00 AM' });
  assert.equal(half.share, '~28%', 'whole percent, as the meter reads');
  assert.equal(half.hint, 'a rough guess: about 28% of your 5-hour window · it would end about 48% full · resets 9:00 AM');
  assert.equal(half.note, 'Nothing like it has run here yet; a rough guess is 15 to 40% of your 5-hour window. Yours is 20% full.');
});

test('labels: past the limit the ending says so, and the guard\'s share when that is the line', () => {
  const est = { kind: 'ultracode', pct: 30, low: 20, high: 40, samples: 3, basis: 'history' };
  const past = rc.view(est, { ...advice(85), over: true }, { resetText: '4:15 PM' });
  assert.equal(past.hint, 'about 30% of your 5-hour window · it would end about 115% full, past your limit · resets 4:15 PM');
  const guarded = rc.view(est, { ...advice(60, { line: 75 }), over: true }, { resetText: '4:15 PM', guardOn: true });
  assert.match(guarded.hint, /it would end about 90% full, past the share you keep · resets 4:15 PM$/);
});

test('view carries the reset and the line for the panel, and null for no estimate', () => {
  const v = rc.view({ kind: 'ultracode', pct: 15, low: 12, high: 18, samples: 4, basis: 'history' }, advice(47), { resetText: '4:15 PM' });
  assert.equal(v.resetsAt, NOW + 3 * HOUR);
  assert.equal(v.resetText, '4:15 PM');
  assert.equal(v.line, 100);
  assert.equal(v.left, 53);
  assert.equal(rc.view(null, advice(47)), null);
});

// ---- the ledger's side

test('the ledger keeps a run\'s id, its workflow and the helpers a turn sent, and drops odd ones', () => {
  const row = ledger.normalizeRow(turn({ kind: 'ultracode', run: 'w1ultra', wf: 'wf-abc', helpers: 3 }));
  assert.equal(row.kind, 'ultracode');
  assert.equal(row.run, 'w1ultra');
  assert.equal(row.wf, 'wf-abc');
  assert.equal(row.helpers, 3);
  const odd = ledger.normalizeRow(turn({ run: 'a b', wf: 'x'.repeat(100), helpers: -2 }));
  assert.equal(odd.run, null);
  assert.equal(odd.wf, null);
  assert.equal(odd.helpers, 0);
});

test('turn estimates leave Ultracode runs out', () => {
  const r = rows(ultra(80, { category: 'fix' }), ultra(90, { category: 'fix' }), ultra(70, { category: 'fix' }));
  const e = ledger.estimate(r, { pk: 'c:\\code\\app', category: 'fix', now: NOW });
  assert.equal(e.basis, 'project+kind');
  assert.equal(e.pct, 1, 'the three ordinary fixes, not the runs');
});
