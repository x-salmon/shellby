// More of Claude Code's own commands, drawn instead of printed or sent to a
// terminal: /context's table as a bar (stream.js contextUsageOf, feed-logic.js
// contextSegments), the /insights report's link, /subtask's words, and /loop's
// wake-ups and schedules said in words. And every command Shellby says it
// handles has something in the panel that does.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { toItems, contextUsageOf, tokenCount, describeTool, cronWords, inWords } = require('../src/main/stream');
const { CATALOGUE, HANDLING } = require('../src/main/cli-commands');
const F = require('../src/renderer/panel/feed-logic');

const CONTEXT = fs.readFileSync(path.join(__dirname, 'fixtures', 'context-usage.md'), 'utf8');
const synthetic = text => ({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text }] } });

test('tokenCount reads Claude Code\'s short numbers', () => {
  assert.equal(tokenCount('2.5k'), 2500);
  assert.equal(tokenCount('1m'), 1000000);
  assert.equal(tokenCount('820'), 820);
  assert.equal(tokenCount('943.4k'), 943400);
  assert.equal(tokenCount('lots'), null);
});

test("contextUsageOf reads /context's total and its categories, keeping the whole table", () => {
  const u = contextUsageOf(CONTEXT);
  assert.equal(u.kind, 'context-usage');
  assert.equal(u.model, 'claude-opus-5-5');
  assert.deepEqual([u.used, u.window, u.pct], [23600, 1000000, 2]);
  assert.equal(u.categories.length, 11, 'only the by-category table, not the MCP tools one');
  assert.deepEqual(u.categories[0], { name: 'System prompt', tokens: 2500, pct: 0.3 });
  assert.deepEqual(u.categories.at(-1), { name: 'Autocompact buffer', tokens: 33000, pct: 3.3 });
  assert.match(u.text, /mcp__context7__query-docs/);
  const tiny = contextUsageOf(CONTEXT.replace('| Messages | 820 | 0.1% |', '| Messages | 82 | <0.1% |'));
  assert.deepEqual(tiny.categories.find(c => c.name === 'Messages'), { name: 'Messages', tokens: 82, pct: 0.1 }, 'a share too small to print is kept');
  assert.equal(contextUsageOf('## Something else\n**Tokens:** 1k / 2k (50%)'), null);
  assert.equal(contextUsageOf('## Context Usage\nno numbers here'), null);
});

test("/context's reply becomes a card; the same words from the model stay a reply", () => {
  assert.deepEqual(toItems(synthetic(CONTEXT)).map(i => i.kind), ['context-usage']);
  const fromModel = { type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: CONTEXT }] } };
  assert.deepEqual(toItems(fromModel).map(i => i.kind), ['text']);
  assert.deepEqual(toItems(synthetic('Goal set: ship it')).map(i => i.kind), ['goal', 'text'], 'other notes are untouched');
});

test('contextSegments puts what is used first, biggest first, then the buffer, then free space', () => {
  const segs = F.contextSegments(contextUsageOf(CONTEXT).categories);
  assert.deepEqual(segs.slice(0, 3).map(s => s.name), ['MCP tools (deferred)', 'System tools (deferred)', 'Skills']);
  assert.deepEqual(segs.slice(-2).map(s => [s.name, s.tone]), [['Autocompact buffer', 'buffer'], ['Free space', 'free']]);
  assert.ok(segs.slice(0, -2).every(s => s.tone === 'used'));
  assert.deepEqual(F.contextSegments([{ name: 'x', tokens: 1, pct: 250 }, { name: 'bad', pct: -1 }, null]).map(s => s.pct), [100]);
  assert.deepEqual(F.contextSegments(undefined), []);
});

test("insightsReportIn spots the /insights report's link, and nothing else", () => {
  assert.ok(F.insightsReportIn('Your report: file:///C:/Users/me/.claude/usage-data/report.html'));
  assert.ok(F.insightsReportIn('See file://C:\\Users\\me\\.claude\\usage-data\\report-ab12.html for more'));
  assert.ok(!F.insightsReportIn('file:///C:/somewhere/report.html'));
  assert.ok(!F.insightsReportIn('https://example.com/usage-data/report.html'));
  assert.ok(!F.insightsReportIn(null));
});

test('/subtask says in plain words that a forked helper takes the task', () => {
  const p = F.subtaskPrompt('  find the slow query  ');
  assert.match(p, /subagent_type "fork"/);
  assert.match(p, /in the background/);
  assert.ok(p.endsWith('The task: find the slow query'));
});

test('wake-ups and schedules are said in words', () => {
  assert.equal(inWords(60), 'in 60 s');
  assert.equal(inWords(1200), 'in 20 min');
  assert.equal(inWords(3600), 'in 1 h');
  assert.equal(cronWords('*/5 * * * *'), 'every 5 min');
  assert.equal(cronWords('7 * * * *'), 'every hour at :07');
  assert.equal(cronWords('0 9 * * *'), 'every day at 09:00');
  assert.equal(cronWords('30 8 * * 1-5'), 'weekdays at 08:30');
  assert.equal(cronWords('0 17 * * 5'), 'Fridays at 17:00');
  assert.equal(cronWords('30 14 28 2 *'), 'cron 30 14 28 2 *');
  assert.equal(cronWords('99 99 * * *'), 'cron 99 99 * * *', 'out of range stays as it is');
  assert.equal(cronWords('*/0 * * * *'), 'cron */0 * * * *');
  assert.equal(cronWords('0 9 * * 7'), 'cron 0 9 * * 7');
  assert.deepEqual(describeTool('ScheduleWakeup', { delaySeconds: 1200, reason: 'watching CI', prompt: '/loop x' }), { label: 'Will pick this up again', detail: 'in 20 min: watching CI' });
  assert.deepEqual(describeTool('ScheduleWakeup', { stop: true }), { label: 'Ended the loop', detail: '' });
  assert.deepEqual(describeTool('CronCreate', { cron: '0 9 * * 1-5', prompt: 'check the build', durable: true }),
    { label: 'Scheduled', detail: 'weekdays at 09:00, kept across restarts: check the build' });
  assert.equal(describeTool('CronCreate', { cron: '0 9 * * *', prompt: 'x', recurring: false }).detail, 'every day at 09:00, once: x');
  assert.deepEqual(describeTool('CronDelete', { id: 'job-1' }), { label: 'Cancelled a schedule', detail: 'job-1' });
});

// The keys of `const NAME = { … };` in a panel file: a command is handled there if it has one.
function keysOf(file, name) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'panel', file), 'utf8');
  const start = src.indexOf(`const ${name} = {`);
  assert.ok(start >= 0, `${file} has ${name}`);
  const body = src.slice(start, src.indexOf('\n  };', start));
  return new Set([...body.matchAll(/^\s{4}'?([\w-]+)'?\s*[:,]/gm)].map(m => m[1]));
}

test("every command Shellby says it handles has something in the panel that does it", () => {
  const handled = new Set([...keysOf('builtin-commands.js', 'ACTIONS'), ...keysOf('composer.js', 'LOCAL')]);
  const missing = CATALOGUE.filter(c => c.handling === HANDLING.SHELLBY && !handled.has(c.name)).map(c => c.name);
  assert.deepEqual(missing, []);
});
