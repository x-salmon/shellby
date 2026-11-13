// ACP agents' updates, rewritten as Claude Code's events and then read by
// stream.js exactly as Claude's are: what comes out is what the panel shows.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toItems } = require('../src/main/stream');
const acp = require('../src/main/harness/acp-translate');

const items = evs => evs.flatMap(toItems);

test('streamed text shows as it comes, then lands as one reply when a tool starts', () => {
  const t = acp.createTranslator();
  const a = items(t.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Let me ' } }));
  const b = items(t.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'look.' } }));
  assert.deepEqual(a, [{ kind: 'partial', text: 'Let me ' }]);
  assert.deepEqual(b, [{ kind: 'partial', text: 'look.' }]);
  const c = items(t.update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Run tests', kind: 'execute', status: 'pending', rawInput: { command: 'npm test' } }));
  assert.equal(c[0].kind, 'text');
  assert.equal(c[0].text, 'Let me look.');
  assert.equal(c[1].kind, 'tool');
  assert.equal(c[1].name, 'Bash');
  assert.equal(c[1].id, 't1');
});

test('a finished tool call is its result, and a failed one an error', () => {
  const t = acp.createTranslator();
  t.update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read', kind: 'read', status: 'in_progress', locations: [{ path: 'C:\\repo\\a.js' }] });
  const ok = items(t.update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'const a = 1;' } }] }));
  assert.deepEqual(ok.map(i => [i.kind, i.id, i.isError, i.text]), [['tool_result', 't1', false, 'const a = 1;']]);
  t.update({ sessionUpdate: 'tool_call', toolCallId: 't2', title: 'npm test', kind: 'execute', status: 'in_progress' });
  const bad = items(t.update({ sessionUpdate: 'tool_call_update', toolCallId: 't2', status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'exit 1' } }] }));
  assert.equal(bad[0].isError, true);
  assert.deepEqual(items(t.update({ sessionUpdate: 'tool_call_update', toolCallId: 't2', status: 'failed' })), [], 'a result is only sent once');
});

test("an update for a tool that never started still gets its row", () => {
  const t = acp.createTranslator();
  const out = items(t.update({ sessionUpdate: 'tool_call_update', toolCallId: 'x9', title: 'grep', kind: 'search', status: 'completed', rawInput: { pattern: 'TODO' } }));
  assert.deepEqual(out.map(i => i.kind), ['tool', 'tool_result']);
  assert.equal(out[0].name, 'Grep');
});

test('edits with a diff become Edit, new files Write, so the card shows the change', () => {
  const edit = acp.toolOf({ kind: 'edit', title: 'Edit a.js', content: [{ type: 'diff', path: 'C:\\repo\\a.js', oldText: 'a = 1', newText: 'a = 2' }] });
  assert.deepEqual(edit, { name: 'Edit', input: { file_path: 'C:\\repo\\a.js', old_string: 'a = 1', new_string: 'a = 2' } });
  const write = acp.toolOf({ kind: 'edit', content: [{ type: 'diff', path: 'C:\\repo\\new.md', oldText: null, newText: '# Hi' }] });
  assert.deepEqual(write, { name: 'Write', input: { file_path: 'C:\\repo\\new.md', content: '# Hi' } });
});

test('other kinds map to their Claude counterparts, and MCP tools keep their server and name', () => {
  assert.equal(acp.toolOf({ kind: 'fetch', rawInput: { url: 'https://x.dev' } }).input.url, 'https://x.dev');
  assert.equal(acp.toolOf({ kind: 'search', title: 'find TODO' }).name, 'Grep');
  assert.equal(acp.toolOf({ kind: 'execute', rawInput: { command: ['git', 'status'] } }).input.command, 'git status');
  assert.equal(acp.toolOf({ kind: 'other', title: 'Thinking hard' }).name, 'Thinking hard');
  assert.equal(acp.toolOf({ kind: 'other', title: 'x', _meta: { 'gemini-cli': { mcp: { server_name: 'linear', tool_name: 'create_issue' } } } }).name, 'mcp__linear__create_issue');
});

test('a plan becomes the to-do list', () => {
  const t = acp.createTranslator();
  const out = items(t.update({ sessionUpdate: 'plan', entries: [{ content: 'Read the code', status: 'completed', priority: 'high' }, { content: 'Fix it', status: 'in_progress' }] }));
  assert.equal(out[0].kind, 'tool');
  assert.equal(out[0].name, 'TodoWrite');
  assert.deepEqual(out[0].todo.items.map(i => [i.subject, i.status]), [['Read the code', 'completed'], ['Fix it', 'in_progress']]);
});

test("the turn's end flushes the reply and is a result with its usage", () => {
  const t = acp.createTranslator();
  t.update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Hmm.' } });
  t.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'All done.' } });
  const out = items(t.end({ stopReason: 'end_turn', usage: { inputTokens: 1200, outputTokens: 80, cachedReadTokens: 900, thoughtTokens: 30 } }, { sessionId: 's-1', durationMs: 4200 }));
  assert.deepEqual(out.map(i => i.kind), ['thinking', 'text', 'result']);
  const r = out[2];
  assert.equal(r.ok, true);
  assert.equal(r.sessionId, 's-1');
  assert.equal(r.durationMs, 4200);
  assert.deepEqual(r.tokens, { input: 1200, output: 80, cacheRead: 900, cacheWrite: 0 });
  assert.equal(r.thinkingTokens, 30);
});

test('a refusal, a length cut-off or an error fails the turn and says why; a cancel does not', () => {
  const end = (answer, o) => items(acp.createTranslator().end(answer, o)).at(-1);
  assert.equal(end({ stopReason: 'refusal' }).refused, true);
  assert.match(end({ stopReason: 'max_tokens' }).error, /length limit/);
  assert.match(end(null, { error: 'the agent exited (code 41)' }).error, /code 41/);
  assert.equal(end({ stopReason: 'cancelled' }).ok, true);
});

test('a permission request is a card naming the tool and its input', () => {
  const ev = acp.permissionEvent({ toolCall: { toolCallId: 't5', title: 'rm -rf build', kind: 'execute', rawInput: { command: 'rm -rf build' } }, options: [] }, 'req-1');
  const [card] = toItems(ev);
  assert.equal(card.kind, 'permission');
  assert.equal(card.requestId, 'req-1');
  assert.equal(card.toolName, 'Bash');
  assert.equal(card.input.command, 'rm -rf build');
});

test("the card's answer picks the agent's own option for it, or cancels", () => {
  const options = [
    { optionId: 'proceed_once', kind: 'allow_once' }, { optionId: 'proceed_always', kind: 'allow_always' }, { optionId: 'cancel', kind: 'reject_once' },
  ];
  assert.deepEqual(acp.permissionOutcome(options, { decision: 'allow' }), { outcome: { outcome: 'selected', optionId: 'proceed_once' } });
  assert.deepEqual(acp.permissionOutcome(options, { decision: 'allow', always: true }), { outcome: { outcome: 'selected', optionId: 'proceed_always' } });
  assert.deepEqual(acp.permissionOutcome(options, { decision: 'deny' }), { outcome: { outcome: 'selected', optionId: 'cancel' } });
  assert.deepEqual(acp.permissionOutcome([], { decision: 'allow' }), { outcome: { outcome: 'cancelled' } }, 'nothing to pick: never allowed by guesswork');
  const alwaysOnly = [{ optionId: 'forever', kind: 'allow_always' }, { optionId: 'no', kind: 'reject_once' }];
  assert.deepEqual(acp.permissionOutcome(alwaysOnly, { decision: 'allow' }), { outcome: { outcome: 'cancelled' } }, 'a one-time Allow never becomes Always');
  assert.deepEqual(acp.permissionOutcome([{ optionId: 'once', kind: 'allow_once' }], { decision: 'allow', always: true }), { outcome: { outcome: 'selected', optionId: 'once' } }, 'Always falls back to once');
});
