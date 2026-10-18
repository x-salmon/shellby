const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const { POSES, poseOf, poseNow, kindOf, latest } = require('../src/main/work-pose');
const { ClaudeSession } = require('../src/main/session');
const { applyHookEvent, summarize } = require('../src/main/external');

test('each tool has its pose, and between tools he thinks', () => {
  assert.equal(poseOf(null), 'think');
  assert.equal(poseOf('Read'), 'read');
  assert.equal(poseOf('MultiEdit'), 'write');
  assert.equal(poseOf('PowerShell'), 'run');
  assert.equal(poseOf('Grep'), 'search');
  assert.equal(poseOf('WebSearch'), 'web');
  assert.equal(poseOf('TodoWrite'), 'plan');
  assert.equal(poseOf('Agent'), 'crew');
  assert.equal(poseOf('Skill'), 'skill');
  assert.equal(poseOf('mcp__github__list_issues'), 'mcp', 'an MCP server tool is a call out');
  assert.equal(poseOf('SomethingNew'), 'busy', 'anything else is the scuttle he always had');
  assert.equal(poseOf('constructor'), 'busy', 'no prototype names');
});

test('a shell command gets the pose for what it runs', () => {
  const bash = command => poseOf('Bash', kindOf('Bash', { command }));
  assert.equal(bash('npm test'), 'test');
  assert.equal(bash('cd app && npm run lint'), 'test', 'lint holds his breath too');
  assert.equal(bash('npx tsc --noEmit'), 'test', 'and a typecheck');
  assert.equal(bash('git commit -m "fix"'), 'git');
  assert.equal(bash('git push -u origin main'), 'git');
  assert.equal(bash('git status'), 'run', 'a git command that only reads is just a command');
  assert.equal(bash('npm ci'), 'install');
  assert.equal(bash('pip install requests'), 'install');
  assert.equal(bash('npm run build'), 'build');
  assert.equal(bash('ls -la'), 'run');
  assert.equal(poseOf('PowerShell', kindOf('PowerShell', { command: 'npm test' })), 'test');
  assert.equal(kindOf('Bash', {}), null, 'no command, no kind');
  assert.equal(kindOf('Bash', { command: 42 }), null);
  assert.equal(kindOf('Read', { command: 'npm test' }), null, 'only a shell runs commands');
  assert.equal(poseOf('Read', 'test'), 'read', 'a kind never changes a tool that is not a shell');
  assert.equal(poseOf('Bash', 'toString'), 'run', 'an unknown kind is just a command');
  assert.equal(poseOf(null, 'test'), 'think', 'between tools he thinks, whatever ran last');
});

test('every pose the renderer knows has a rule in the shared crab animations', () => {
  const fs = require('fs');
  const css = fs.readFileSync(require.resolve('../src/renderer/shared/crab-anim.css'), 'utf8');
  const shared = require('../src/renderer/shared/workposes');
  assert.deepEqual([...shared.POSES].sort(), [...POSES].sort(), 'the renderer knows every pose main sends, and no others');
  for (const p of POSES) {
    if (p !== 'busy') assert.ok(css.includes(`:is(body, :where(.crab-anim)).work-${p} `), `crab-anim.css draws ${p}`);
  }
});

test('the tool that started or finished last wins', () => {
  assert.equal(latest([]), null);
  assert.equal(latest([{ tool: 'Read', toolAt: null }]), null, 'no tool run yet');
  assert.equal(latest([{ tool: 'Read', toolAt: 5 }, { tool: null, toolAt: 9 }, { tool: 'Bash', toolAt: 7 }]).tool, null);
  assert.equal(latest([{ tool: 'Read', toolAt: 5 }, null, { tool: 'Bash', toolAt: 7 }]).tool, 'Bash');
});

test('a conversation knows the main thread tool running, and forgets it between tools', () => {
  const s = new ClaudeSession({ exe: 'x', cwd: os.tmpdir(), mode: 'ask' });
  const seen = [];
  s.on('tool', t => seen.push(t));
  const use = (id, name, input) => s.trackSteps({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
  const done = id => s.trackSteps({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id }] } });
  use('a', 'Read');
  use('b', 'Grep');
  assert.equal(s.tool, 'Grep');
  done('b');
  assert.equal(s.tool, 'Grep', 'Read is still out');
  done('a');
  assert.equal(s.tool, null);
  assert.ok(Number.isFinite(s.toolAt));
  assert.deepEqual(seen, ['Read', 'Grep', null]);
  use('c', 'Bash', { command: 'npm test' });
  assert.equal(s.toolKind, 'test', 'what sort of command it runs');
  done('c');
  use('d', 'Bash', { command: 'git push' });
  assert.equal(s.toolKind, 'git', 'the same tool with another command moves him on');
  s.setBusy(true);
  assert.equal(s.toolAt, null, 'a new turn starts thinking');
  assert.equal(s.toolKind, null);
});

test('outside sessions: the busy one that moved last says what he does', () => {
  let m = new Map();
  const ev = (hook_event_name, session_id, extra = {}) => ({ hook_event_name, session_id, cwd: `C:\\p\\${session_id}`, ...extra });
  m = applyHookEvent(m, ev('UserPromptSubmit', 'a'), 1).sessions;
  m = applyHookEvent(m, ev('PreToolUse', 'a', { tool_name: 'Edit' }), 2).sessions;
  m = applyHookEvent(m, ev('UserPromptSubmit', 'b'), 3).sessions;
  m = applyHookEvent(m, ev('PreToolUse', 'b', { tool_name: 'WebFetch' }), 4).sessions;
  assert.equal(summarize(m).tool, 'WebFetch');
  m = applyHookEvent(m, ev('PostToolUse', 'b', { tool_name: 'WebFetch' }), 5).sessions;
  assert.equal(summarize(m).tool, null, 'b is thinking');
  m = applyHookEvent(m, ev('Stop', 'b'), 6).sessions;
  assert.equal(summarize(m).tool, 'Edit', 'an idle session has no say');
  m = applyHookEvent(m, ev('PreToolUse', 'a', { tool_name: 'Bash', tool_input: { command: 'npm install' } }), 7).sessions;
  assert.equal(summarize(m).kind, 'install', 'and what sort of command it runs');
  m = applyHookEvent(m, ev('PostToolUse', 'a', { tool_name: 'Bash' }), 8).sessions;
  assert.equal(summarize(m).kind, null, 'forgotten between tools');
});

test('compacting beats everything, and words of the reply between tools are him talking', () => {
  assert.equal(poseNow(null), 'think');
  assert.equal(poseNow(null, { talking: true }), 'talk');
  assert.equal(poseNow({ tool: 'Read' }, { talking: true }), 'read', 'a tool running keeps its pose');
  assert.equal(poseNow({ tool: 'Bash', kind: 'test' }), 'test');
  assert.equal(poseNow({ tool: 'Read' }, { compacting: true, talking: true }), 'compact');
});

test('a tab talks while its reply streams in, goes quiet after, and compacts until the mark', async () => {
  const { SessionManager } = require('../src/main/sessions');
  const P = SessionManager.prototype;
  const aggregate = Object.getOwnPropertyDescriptor(P, 'aggregate').get;
  const s = new ClaudeSession({ exe: 'x', cwd: os.tmpdir(), mode: 'ask' });
  s.busy = true;
  const tab = { id: 't1', session: s };
  let changes = 0;
  const mgr = { tabs: new Map([['t1', tab]]), changed: () => changes++, emit() {}, talked: P.talked, hush: P.hush };
  const agg = () => aggregate.call(mgr);
  assert.equal(agg().talking, false);
  P.onItem.call(mgr, tab, { kind: 'partial', text: 'Here' });
  P.onItem.call(mgr, tab, { kind: 'partial', text: ' is' });
  assert.equal(agg().talking, true);
  assert.equal(changes, 1, 'one change for a stream of words, not one each');
  s.tool = 'Read';
  assert.equal(agg().talking, false, 'a tool running is not him talking');
  s.tool = null;
  await new Promise(r => setTimeout(r, 800));
  assert.equal(agg().talking, false, 'quiet a moment after the words stop');
  P.onItem.call(mgr, tab, { kind: 'compacting', on: true });
  assert.equal(agg().compacting, true);
  P.hush(tab);
  assert.equal(agg().compacting, false, 'the turn ending puts it all down');
  s.close();
});
