const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../src/main/pocket/view');

const tab = (over = {}) => ({
  id: 't1', title: 'Fix the upload test', cwd: 'C:\\code\\shellby', busy: false, busySince: null, pending: 0, crew: 0,
  outcome: null, unread: false, worktree: null, ready: null, checks: null, todos: null, turnTokens: 0, planning: false, ...over,
});

test('the beach is in the panel order: asking, review, finished, working, quiet', () => {
  const tabs = [
    tab({ id: 'quiet' }),
    tab({ id: 'working', busy: true }),
    tab({ id: 'finished', unread: true }),
    tab({ id: 'review', ready: { after: 'abc', files: 2, added: 3, removed: 1, paths: ['a.js'], at: 1, reviewed: false } }),
    tab({ id: 'asking', pending: 1 }),
  ];
  const view = v.phoneView({ tabs, now: 10 });
  assert.deepEqual(view.tabs.map(t => t.id), ['asking', 'review', 'finished', 'working', 'quiet']);
  assert.deepEqual(view.tabs.map(t => t.standing), ['asking', 'review', 'finished', 'working', 'quiet']);
});

test("the desk's mode goes to the phone, so a new task starts in it", () => {
  assert.equal(v.phoneView({ mode: 'autonomous' }).mode, 'autonomous');
  assert.equal(v.phoneView({}).mode, null, 'none said: the phone falls back to its own last pick');
});

test('a tab carries its folder, its copy and what is ready, never its full path', () => {
  const t = v.phoneTab(tab({
    worktree: { branch: 'shellby/fix-upload', base: 'main', originalCwd: 'C:\\code\\shellby' },
    cwd: 'C:\\Users\\me\\AppData\\Roaming\\Shellby\\worktrees\\abc\\shellby',
    ready: { after: 'abc', files: 2, added: 3, removed: 1, paths: ['a.js'], at: 1, reviewed: false },
  }), { mode: 'ask', fromPhone: true, canReply: true });
  assert.equal(t.folder, 'shellby');
  assert.ok(!JSON.stringify(t).includes('AppData'));
  assert.deepEqual(t.copy, { branch: 'shellby/fix-upload', base: 'main' });
  assert.equal(t.ready.added, 3);
  assert.equal(t.canReply, true);
  // Reviewed already: nothing waiting.
  assert.equal(v.phoneTab(tab({ ready: { after: 'x', reviewed: true, paths: [] } })).ready, null);
});

test('a tab’s checks: the last verdict, or the run going now', () => {
  assert.equal(v.phoneTab(tab()).checks, null);
  assert.deepEqual(v.phoneTab(tab({ checks: { status: 'fail', after: 'a1', at: 5 } })).checks, { status: 'fail', after: 'a1' });
  assert.deepEqual(v.phoneTab(tab({ checks: { status: 'fail', after: 'a1' } }), { checksRunning: { after: 'a2' } }).checks, { status: 'running', after: 'a2' });
  assert.deepEqual(v.phoneTab(tab(), { checksRunning: { after: null } }).checks, { status: 'running', after: null });
});

test('a tab says when Claude Code is compacting it', () => {
  assert.equal(v.phoneTab(tab()).compacting, false);
  assert.equal(v.phoneTab(tab({ busy: true, compacting: true })).compacting, true);
});

test('a prompt says why the phone may only look, by the same rule as the phone notifications', () => {
  const tabs = [tab()];
  const prompts = [
    { tabId: 't1', requestId: 'r1', toolName: 'Bash', label: 'Run', detail: 'npm test', input: { command: 'npm test' }, plain: { ask: 'Run the tests' }, warnings: ['Goes online'] },
    { tabId: 't1', requestId: 'r2', toolName: 'ExitPlanMode', input: {}, planSummary: '4 steps' },
    { tabId: 't1', requestId: 'r3', toolName: 'Bash', input: { command: 'x'.repeat(400) } },
    { tabId: 't1', requestId: 'r4', toolName: 'Bash', input: { command: 'node build.js' }, runsCreated: ['build.js'] },
  ];
  const view = v.phoneView({ tabs, prompts });
  assert.equal(view.prompts[0].deskOnly, null);
  assert.equal(view.prompts[0].ask, 'Run the tests');
  assert.deepEqual(view.prompts[0].warnings, ['Goes online']);
  assert.deepEqual(view.prompts[0].preview, { kind: 'command', command: 'npm test' });
  assert.equal(view.prompts[0].title, 'Fix the upload test');
  assert.match(view.prompts[1].deskOnly, /plan/);
  assert.equal(view.prompts[1].plan, '4 steps');
  assert.match(view.prompts[2].deskOnly, /too long/);
  assert.match(view.prompts[3].deskOnly, /file Claude wrote/);
});

test('an edit shows what it changes before you say yes', () => {
  const p = v.preview({ toolName: 'Edit', input: { file_path: 'C:\\code\\a.js', old_string: 'a', new_string: 'b' } });
  assert.deepEqual(p, { kind: 'edit', file: 'C:\\code\\a.js', old: 'a', new: 'b' });
  const w = v.preview({ toolName: 'Write', input: { file_path: 'b.js', content: 'y'.repeat(5000) } });
  assert.equal(w.content.length, 1500);
  assert.equal(v.preview({ toolName: 'Grep', input: { pattern: 'x' } }), null);
});

test('the usage meter is only shown while its window is still open', () => {
  assert.deepEqual(v.phoneUsage({ fiveHour: { pct: 42.4, resetsAt: 2000 } }, null, 1000), { pct: 42, resetsAt: 2000, limit: null, warning: null });
  assert.equal(v.phoneUsage({ fiveHour: { pct: 90, resetsAt: 500 } }, null, 1000).pct, null);
  assert.equal(v.phoneUsage(null, null, 1).pct, null);
});

test('transcript items are cut down to what a phone draws', () => {
  const items = [
    { kind: 'user', text: 'fix it', turnId: 'u1' },
    { kind: 'thinking', text: 'hmm' },
    { kind: 'text', text: 'On it.' },
    { kind: 'tool', id: 'x1', name: 'Bash', label: 'Run', detail: 'npm test', input: { command: 'npm test' } },
    { kind: 'tool_result', id: 'x1', isError: false, text: 'lots of output' },
    { kind: 'task', phase: 'started', taskId: 'k', toolUseId: 'a', description: 'map callers', subagentType: 'Explore', taskType: 'local_agent' },
    { kind: 'usage', fiveHour: {} },
    { kind: 'changes', root: 'C:\\x', before: 'b', after: 'a', added: 3, removed: 1, files: [{ path: 'a.js', status: 'M', added: 3, removed: 1 }] },
    { kind: 'result', ok: true, durationMs: 4200, tokens: 900, cost: { share: 2, line: '900 tokens' } },
    { kind: 'partial', text: 'On i' },
  ];
  const out = v.phoneItems(items);
  assert.deepEqual(out.map(i => i.k), ['user', 'text', 'tool', 'done', 'task', 'changes', 'end']);
  // A result's text never goes, only whether it failed; and a change names no folder.
  assert.equal(out[3].text, undefined);
  assert.ok(!JSON.stringify(out[5]).includes('C:\\x'));
  assert.equal(out[6].seconds, 4);
  assert.equal(out[6].share, 2);
  // Live, a partial reply does go: it's what makes him look like he's typing.
  assert.deepEqual(v.phoneItem({ kind: 'partial', text: 'On i' }), { k: 'partial', text: 'On i' });
  assert.equal(v.phoneItem({ kind: 'partial', text: 'x', sub: true }), null);
});

test('long text is clipped and one-liners lose their control characters', () => {
  assert.equal(v.phoneItem({ kind: 'text', text: 'x'.repeat(20000) }).text.length, 8000);
  assert.equal(v.line('a\u0007b\n\nc', 10), 'a b c');
  assert.equal(v.phoneItems(Array.from({ length: 500 }, () => ({ kind: 'text', text: 'x' }))).length, v.MAX_ITEMS);
});

test('questions come with their options, and a plan in full, for the phone to answer', () => {
  const prompts = [
    { tabId: 't1', requestId: 'q', toolName: 'AskUserQuestion', input: { questions: [{ question: 'Which?', header: 'DB', multiSelect: true, options: [{ label: 'A', description: 'first' }] }] } },
    { tabId: 't1', requestId: 'p', toolName: 'ExitPlanMode', plan: '# Plan\n1. Go', planSummary: '1 step' },
    { tabId: 't1', requestId: 's', toolName: 'ExitPlanMode', plan: 'x', selfConfig: 'your hooks' },
  ];
  const view = v.phoneView({ tabs: [tab()], prompts });
  assert.equal(view.prompts[0].deskOnly, null);
  assert.deepEqual(view.prompts[0].questions, [{ question: 'Which?', header: 'DB', multiSelect: true, options: [{ label: 'A', description: 'first' }] }]);
  assert.equal(view.prompts[1].deskOnly, null);
  assert.equal(view.prompts[1].planText, '# Plan\n1. Go');
  assert.match(view.prompts[2].deskOnly, /hooks/);
});

test('a plan too long to show in full goes to the desk', () => {
  const { PLAN_MAX } = require('../src/main/channels/replies');
  const prompts = [{ tabId: 't1', requestId: 'p', toolName: 'ExitPlanMode', plan: 'x'.repeat(PLAN_MAX + 1) }];
  const view = v.phoneView({ tabs: [tab()], prompts });
  assert.match(view.prompts[0].deskOnly, /too long/);
});

test('the usage view has the week, the guard and focus', () => {
  const now = Date.UTC(2026, 9, 19, 12);
  const view = v.phoneView({
    lastUsage: { fiveHour: { pct: 40, resetsAt: now + 3600e3 }, sevenDay: { pct: 61.4, resetsAt: now + 86400e3 }, at: now - 1000 },
    guard: { on: true, reserve: 25 }, focus: { phase: 'focus', endsAt: now + 60e3, minutes: 25 }, now,
  });
  assert.equal(view.usage.weekPct, 61);
  assert.deepEqual(view.usage.guard, { reserve: 25, ceiling: 75 });
  assert.equal(view.focus.phase, 'focus');
  assert.deepEqual(view.allow, { push: false, files: false });
});

test('a prompt carries the desk’s always-allow label, never on one only the desk may answer', () => {
  const edit = v.phonePrompt({ tabId: 't', requestId: 'r', toolName: 'Edit', suggestions: [{ type: 'setMode', mode: 'acceptEdits' }] }, () => 'T');
  assert.equal(edit.always, 'Allow all edits');
  const rule = v.phonePrompt({ tabId: 't', requestId: 'r', toolName: 'Bash', input: { command: 'npm test' }, suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }] }] }, () => 'T');
  assert.equal(rule.always, 'Always allow Bash(npm test)');
  assert.equal(v.phonePrompt({ tabId: 't', requestId: 'r', toolName: 'Bash' }, () => 'T').always, null);
  const plan = v.phonePrompt({ tabId: 't', requestId: 'r', toolName: 'ExitPlanMode', suggestions: [{ type: 'setMode', mode: 'acceptEdits' }] }, () => 'T');
  assert.ok(plan.deskOnly);
  assert.equal(plan.always, null);
});

test('the PC line has the CPU, the first GPU, memory and the battery from Health, and Health’s own warning', () => {
  const sample = { cpu: { load: 42.4, temp: 71.6 }, gpus: [{ load: 90, temp: 83 }, { load: 1, temp: 30 }], ram: { pct: 61.2 }, battery: { level: 80, rate: 12 } };
  const m = v.phoneMachine(sample, { level: 'warn', text: '83°' });
  assert.deepEqual(m, { cpu: { load: 42, temp: 72 }, gpu: { load: 90, temp: 83 }, ram: 61, battery: { level: 80, charging: true }, warn: '83°', hot: 'warn' });
  assert.equal(v.phoneMachine(null), null, 'nothing when Health is off');
  assert.equal(v.phoneMachine({ cpu: {}, gpus: [] }, null).gpu, null);
  assert.equal(v.phoneView({ health: sample }).machine.cpu.load, 42);
  assert.equal(v.phoneView({}).machine, null);
});

test('a queued task on the phone carries its words, when it goes, and whether it started', () => {
  const t = v.phoneHeld({ id: 'h1', kind: 'task', name: 'Refactor', prompt: 'Refactor the auth module', folder: 'shellby', atText: '01:00', when: 'tonight', tabId: null });
  assert.equal(t.prompt, 'Refactor the auth module');
  assert.equal(t.when, 'tonight');
  assert.equal(t.started, false);
  assert.equal(v.phoneHeld({ id: 'h2', kind: 'task', prompt: 'x', tabId: 'tab1' }).started, true);
});
