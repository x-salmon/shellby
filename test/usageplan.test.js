// The per-turn ledger's wiring (src/main/wiring/usageplan.js) with a fake
// config and tabs: a turn's spend and usage rise are summed between its start
// and its result, and land as one row without the prompt.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { wireUsagePlan } = require('../src/main/wiring/usageplan');

function fakeShared(settings = {}) {
  const data = { model: '', spendGuard: true, spendReserve: 25, turnCosts: [], lastUsage: null, ...settings };
  const tabs = new Map();
  const d = {
    CAPTURE: false,
    config: { get: k => data[k], set: patch => Object.assign(data, patch) },
    manager: { tabs },
    currentCwd: () => 'C:\\code\\shellby',
    projectKeyOf: dir => ({ project: dir.split('\\').pop(), pk: dir.toLowerCase() }),
    spendSource: tab => ({ kind: tab.routineId ? 'routine' : 'tab', project: 'shellby', pk: 'c:\\code\\shellby' }),
  };
  return { d, data, tabs };
}

const tabOf = (over = {}) => ({ id: 't1', turnId: 'turn-1', turnText: 'fix the failing login test', session: { lastModel: 'claude-opus-4-8' }, ...over });
const reading = (pct, resetsAt = Date.now() + 3600e3) => ({ kind: 'usage', fiveHour: { pct, resetsAt } });

test('a finished turn leaves one row with its spend, rise and category, never its prompt', () => {
  const { d, data } = fakeShared();
  const plan = wireUsagePlan(d);
  const tab = tabOf();
  plan.onUsage('other', reading(10));
  plan.beginTurn(tab);
  plan.onSpend(tab, 400);
  plan.onSpend(tab, 600);
  plan.onUsage('t1', reading(14));
  plan.endTurn(tab, { ok: true, durationMs: 5000, turns: 3, tokens: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } });
  plan.save();
  const [row] = data.turnCosts;
  assert.equal(data.turnCosts.length, 1);
  assert.equal(row.category, 'fix');
  assert.equal(row.weight, 1000);
  assert.equal(row.pctRise, 4);
  assert.equal(row.model, 'claude-opus-4-8');
  assert.equal(row.durationMs, 5000);
  assert.equal(JSON.stringify(data.turnCosts).includes('login'), false);
  assert.equal(tab.turnText, null, 'the prompt is let go as the turn starts');
});

test('a stopped turn, or a summary turn carrying on, leaves no row', () => {
  const { d, data } = fakeShared();
  const plan = wireUsagePlan(d);
  const tab = tabOf();
  plan.beginTurn(tab);
  plan.onSpend(tab, 500);
  plan.endTurn(tab, { ok: false, interrupted: true });
  plan.beginTurn(tab); // the same turn going on (start fresh): already counted
  plan.onSpend(tab, 500);
  plan.endTurn(tab, { ok: true });
  plan.save();
  assert.deepEqual(data.turnCosts, []);
});

test('a turn without a usage reading keeps its rise unknown', () => {
  const { d, data } = fakeShared();
  const plan = wireUsagePlan(d);
  const tab = tabOf();
  plan.beginTurn(tab);
  plan.onSpend(tab, 800);
  plan.endTurn(tab, { ok: true });
  plan.save();
  assert.equal(data.turnCosts[0].pctRise, null);
});

test('estimateFor says hold only with the setting on and the line in reach', () => {
  const rows = [3, 20, 22, 25].map((p, i) => ({ at: Date.now() - i * 1000, pk: 'c:\\code\\shellby', project: 'shellby', category: 'fix', weight: 100, pctRise: p, ok: true }));
  const lastUsage = { fiveHour: { pct: 63, resetsAt: Date.now() + 3600e3 } };
  const tabs = t => t.set('t1', tabOf());
  const off = fakeShared({ turnCosts: rows, lastUsage });
  tabs(off.tabs);
  const e = wireUsagePlan(off.d).estimateFor('t1', 'fix the flaky upload test');
  assert.equal(e.basis, 'project+kind');
  assert.equal(e.over, true);
  assert.equal(e.left, 12);
  assert.equal(e.hold, false, 'never automatic by default');
  const on = fakeShared({ turnCosts: rows, lastUsage, holdBigTasks: true });
  tabs(on.tabs);
  assert.equal(wireUsagePlan(on.d).estimateFor('t1', 'fix the flaky upload test').hold, true);
  on.tabs.set('r1', tabOf({ id: 'r1', routineId: 'r-1' }));
  assert.equal(wireUsagePlan(on.d).estimateFor('r1', 'fix the flaky upload test').hold, false, 'routines have the guard');
});

// ---- what a run usually costs, before it starts (usage/runcost.js through the wiring)

// Turns with both a rise and a weight, so the ledger knows what a weight is worth: 1000 weight = 1%.
const ratioRows = () => [1, 2, 3].map(i => ({ at: Date.now() - i * 60e3, pk: 'c:\\code\\shellby', project: 'shellby', category: 'fix', kind: 'tab', weight: 1000, pctRise: 1, ok: true }));
const workflows = { get: id => (id === 'wf-1' ? { id: 'wf-1', name: 'Nightly tidy' } : null), workflowOfRun: runId => (runId === 'run-9' ? 'wf-1' : null) };

test('estimateRunFor: a workflow needs an id Shellby knows; a kind it knows gets a labelled default without history', () => {
  const { d } = fakeShared({ lastUsage: { fiveHour: { pct: 40, resetsAt: Date.now() + 3600e3 } } });
  d.workflows = workflows;
  const plan = wireUsagePlan(d);
  assert.equal(plan.estimateRunFor({ kind: 'workflow' }), null, 'no id');
  assert.equal(plan.estimateRunFor({ kind: 'workflow', workflowId: null }), null);
  assert.equal(plan.estimateRunFor({ kind: 'workflow', workflowId: 'wf-gone' }), null, 'an id Shellby does not know');
  assert.equal(plan.estimateRunFor({ kind: 'tab' }), null, 'not a kind of run');
  const wf = plan.estimateRunFor({ kind: 'workflow', workflowId: 'wf-1' });
  assert.equal(wf.basis, 'default');
  assert.equal(wf.name, 'Nightly tidy');
  assert.match(wf.text, /^“Nightly tidy” hasn't run here yet; a rough guess is 2 to 10% of your 5-hour window\. You'd end near 42 to 50%; it resets at /);
  assert.equal(wf.over, false);
  const ultra = plan.estimateRunFor({ kind: 'ultracode' });
  assert.equal(ultra.kind, 'ultracode');
  assert.equal(ultra.basis, 'default');
  assert.equal(ultra.endPct, Math.round(40 + (15 + 40) / 2), 'whole percent, as the meter reads');
  assert.ok(ultra.resetText, 'the reset as a clock time');
});

test('estimateRunFor: without a current reading there is no ending, and past the line it says so', () => {
  const none = wireUsagePlan(fakeShared().d).estimateRunFor({ kind: 'fanout' });
  assert.equal(none.endPct, null);
  assert.equal(none.resetText, null);
  assert.doesNotMatch(none.text, /You'd end/);
  const near = wireUsagePlan(fakeShared({ lastUsage: { fiveHour: { pct: 70, resetsAt: Date.now() + 3600e3 } } }).d).estimateRunFor({ kind: 'ultracode' });
  assert.equal(near.over, true, 'a default of 15 to 40% from 70% crosses the guard\'s 75% line');
  assert.match(near.text, /share you keep for yourself \(25%\)/);
});

test('estimateFor carries the run this message would start: Ultracode on, several helpers asked for, or none', () => {
  const { d, tabs } = fakeShared();
  tabs.set('t1', tabOf());
  tabs.set('r1', tabOf({ id: 'r1', routineId: 'r-1' }));
  const plan = wireUsagePlan(d);
  assert.equal(plan.estimateFor('t1', 'Audit the repo', { ultracode: true }).run?.kind, 'ultracode');
  assert.equal(plan.estimateFor('t1', 'Use 3 agents in parallel to audit the packages').run?.kind, 'fanout');
  assert.equal(plan.estimateFor('t1', 'fix the flaky upload test').run, null);
  assert.equal(plan.estimateFor('t1', '/model sonnet').run, null, 'a command starts no run');
  assert.equal(plan.estimateFor('r1', 'Audit the repo', { ultracode: true }).run, null, 'a routine\'s tab has the guard instead');
});

test('endRun leaves an Ultracode run\'s row, and the next estimate is drawn from it', () => {
  const { d, data, tabs } = fakeShared({ turnCosts: ratioRows() });
  const tab = tabOf();
  tabs.set('t1', tab);
  const plan = wireUsagePlan(d);
  plan.endRun(tab, { id: 'w1ultra', weight: 20000, tokens: 400000, durationMs: 90e3, ok: true });
  plan.endRun(tab, { id: 'w2ultra', weight: 0, durationMs: 10, ok: false }); // nothing spent: no row
  plan.save();
  const row = data.turnCosts.find(r => r.kind === 'ultracode');
  assert.equal(data.turnCosts.filter(r => r.kind === 'ultracode').length, 1);
  assert.equal(row.run, 'w1ultra');
  assert.equal(row.weight, 20000);
  assert.equal(row.pctRise, null);
  assert.equal(row.durationMs, 90e3);
  const e = plan.estimateRunFor({ kind: 'ultracode' });
  assert.equal(e.basis, 'history');
  assert.equal(e.samples, 1);
  assert.equal(e.pct, 20, '20000 weight at 1000 a percent');
  assert.match(e.text, /from your 1 past run/);
  const turn = wireUsagePlan(d).estimateFor('t1', 'fix the flaky upload test');
  assert.equal(turn.basis, 'project+kind');
  assert.equal(turn.pct, 1, 'turn estimates leave the run out: the three 1% fixes, not the 20% run');
});

test('a workflow step\'s row carries its run and workflow, and a turn its helpers, so runs can be added up', () => {
  const { d, data } = fakeShared({ turnCosts: ratioRows() });
  d.workflows = workflows;
  d.spendSource = () => ({ kind: 'workflow', project: 'shellby', pk: 'c:\\code\\shellby' });
  const plan = wireUsagePlan(d);
  const tab = tabOf({ id: 'w1', workflowRunId: 'run-9' });
  plan.beginTurn(tab);
  plan.onSpend(tab, 3000);
  plan.endTurn(tab, { ok: true, cost: { helpers: [{ id: 'a' }, { id: 'b' }] } });
  plan.save();
  const row = data.turnCosts.at(-1);
  assert.equal(row.kind, 'workflow');
  assert.equal(row.run, 'run-9');
  assert.equal(row.wf, 'wf-1');
  assert.equal(row.helpers, 2);
  const e = plan.estimateRunFor({ kind: 'workflow', workflowId: 'wf-1' });
  assert.equal(e.basis, 'history');
  assert.equal(e.pct, 3);
});

test('clear empties the ledger', () => {
  const { d, data } = fakeShared({ turnCosts: [{ at: Date.now(), weight: 5, category: 'fix' }] });
  wireUsagePlan(d).clear();
  assert.deepEqual(data.turnCosts, []);
});
