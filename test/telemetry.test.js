const { test } = require('node:test');
const assert = require('node:assert/strict');
const tel = require('../src/main/telemetry');

const NOW = new Date(2026, 9, 18, 15, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

const attr = (key, v) => ({ key, value: typeof v === 'number' ? { intValue: String(v) } : { stringValue: v } });
const metric = (name, points) => ({ name, sum: { aggregationTemporality: 1, isMonotonic: true, dataPoints: points } });
const body = metrics => ({ resourceMetrics: [{ resource: { attributes: [attr('service.name', 'claude-code')] }, scopeMetrics: [{ metrics }] }] });

const EXPORT = body([
  metric('claude_code.lines_of_code.count', [
    { asInt: '120', attributes: [attr('type', 'added'), attr('session.id', 's1')] },
    { asInt: '30', attributes: [attr('type', 'removed')] },
  ]),
  metric('claude_code.code_edit_tool.decision', [
    { asInt: '4', attributes: [attr('decision', 'accept'), attr('tool_name', 'Edit')] },
    { asInt: '1', attributes: [attr('decision', 'reject'), attr('tool_name', 'Write')] },
  ]),
  metric('claude_code.commit.count', [{ asInt: '2' }]),
  metric('claude_code.pull_request.count', [{ asInt: '1' }]),
  metric('claude_code.cost.usage', [{ asDouble: 0.4321, attributes: [attr('model', 'claude-opus-5-5')] }]),
  metric('claude_code.active_time.total', [
    { asDouble: 600, attributes: [attr('type', 'cli')] },
    { asDouble: 90, attributes: [attr('type', 'user')] },
  ]),
  metric('claude_code.token.usage', [{ asInt: '5000', attributes: [attr('type', 'input')] }]),
]);

test('reads the data points of an OTLP JSON export, 64-bit integers written as strings', () => {
  const points = tel.pointsFrom(EXPORT);
  assert.equal(points.length, 10);
  assert.deepEqual(points[0], { name: 'claude_code.lines_of_code.count', value: 120, attrs: { type: 'added', 'session.id': 's1' } });
  assert.equal(points.find(p => p.name === 'claude_code.cost.usage').value, 0.4321);
});

test('an attribute named __proto__ stays an attribute and never swaps the prototype', () => {
  const [p] = tel.pointsFrom(body([metric('claude_code.commit.count', [{ asInt: '1', attributes: [attr('__proto__', 'x'), attr('type', 'user')] }])]));
  assert.equal(Object.getPrototypeOf(p.attrs), Object.prototype);
  assert.deepEqual(Object.keys(p.attrs), ['__proto__', 'type']);
  assert.equal(p.attrs.type, 'user');
});

test('anything that is not an export reads as no points', () => {
  for (const junk of [null, 'x', 42, {}, { resourceMetrics: 'no' }, { resourceMetrics: [{ scopeMetrics: [{ metrics: [{ name: 'a', gauge: {} }] }] }] }]) {
    assert.deepEqual(tel.pointsFrom(junk), []);
  }
  assert.deepEqual(tel.pointsFrom(body([metric('m', [{ asInt: 'not a number' }, {}])])), []);
});

test('each kept metric adds to its field, and the rest (tokens) are left to the stream', () => {
  const days = tel.recordPoints({}, tel.pointsFrom(EXPORT), NOW);
  const today = Object.values(days)[0];
  assert.deepEqual(today, { added: 120, removed: 30, accepted: 4, rejected: 1, commits: 2, prs: 1, sessions: 0, cost: 0.4321, userSecs: 90, cliSecs: 600 });
});

test('deltas add up over the day, and a request with nothing kept returns the same ledger', () => {
  let days = tel.recordPoints({}, tel.pointsFrom(EXPORT), NOW);
  days = tel.recordPoints(days, tel.pointsFrom(EXPORT), NOW + 1000);
  assert.equal(Object.values(days)[0].added, 240);
  const same = tel.recordPoints(days, tel.pointsFrom(body([metric('claude_code.token.usage', [{ asInt: '9' }])])), NOW);
  assert.equal(same, days);
});

test('a value no real export holds is left out', () => {
  const days = tel.recordPoints({}, [{ name: 'claude_code.commit.count', value: 1e300, attrs: {} }, { name: 'claude_code.commit.count', value: 2, attrs: {} }], NOW);
  assert.equal(Object.values(days)[0].commits, 2);
});

test('the ledger keeps three weeks and tolerates anything read from disk', () => {
  let days = {};
  for (let i = 30; i >= 0; i--) days = tel.recordPoints(days, [{ name: 'claude_code.commit.count', value: 1, attrs: {} }], NOW - i * DAY);
  assert.equal(Object.keys(days).length, 21);
  const clean = tel.normalizeDays({ nope: { added: 1 }, '2026-10-01': { added: -5, commits: 'x' }, '2026-10-02': { added: 3, junk: 1 } });
  assert.deepEqual(Object.keys(clean), ['2026-10-02']);
  assert.equal(clean['2026-10-02'].added, 3);
  assert.equal(clean['2026-10-02'].junk, undefined);
});

test('the summary sums this week and last, with the share of edits accepted', () => {
  let days = tel.recordPoints({}, tel.pointsFrom(EXPORT), NOW);
  days = tel.recordPoints(days, [{ name: 'claude_code.lines_of_code.count', value: 50, attrs: { type: 'added' } }], NOW - 9 * DAY);
  const s = tel.telemetrySummary(days, NOW);
  assert.equal(s.week.added, 120);
  assert.equal(s.week.acceptRate, 0.8);
  assert.equal(s.week.cost, 0.43);
  assert.equal(s.lastWeek.added, 50);
  assert.equal(s.lastWeek.acceptRate, null);
  assert.equal(tel.telemetrySummary({}, NOW), null);
});

test('telemetry set up by the user, in the environment or settings, is left alone', () => {
  assert.equal(tel.ownTelemetry({ PATH: 'x' }, null), false);
  assert.equal(tel.ownTelemetry({ PATH: 'x' }, { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector' }), true);
  assert.equal(tel.ownTelemetry({ claude_code_enable_telemetry: '1' }), true);
  assert.equal(tel.ownTelemetry({ otel_logs_exporter: 'otlp' }), true);
});

test('the env sends metrics only, as JSON over HTTP with delta temporality, to this PC', () => {
  const env = tel.telemetryEnv({ port: 4567, token: 'abc' });
  assert.equal(env.CLAUDE_CODE_ENABLE_TELEMETRY, '1');
  assert.equal(env.OTEL_METRICS_EXPORTER, 'otlp');
  assert.equal(env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL, 'http/json');
  assert.equal(env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT, 'http://127.0.0.1:4567/v1/metrics');
  assert.equal(env.OTEL_EXPORTER_OTLP_METRICS_HEADERS, 'authorization=Bearer abc');
  assert.equal(env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE, 'delta');
  assert.ok(!Object.keys(env).some(k => /LOGS/.test(k)), 'never logs: they can carry prompts');
});
