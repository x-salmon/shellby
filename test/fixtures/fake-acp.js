// A stand-in for an Agent Client Protocol agent (gemini --acp, opencode acp,
// codex-acp): newline-delimited JSON-RPC on stdin/stdout, so harness tests
// run without any of them installed.
//
// Behaviour per prompt:
//   "tool"   -> asks to run `npm test`; replies ALLOWED (and runs it) or DENIED
//   "edit"   -> asks to edit a.js with a diff; replies EDITED or DENIED
//   "slow"   -> waits until session/cancel, then ends the turn cancelled
//   "crash"  -> exits with code 3 mid-turn
//   "fail"   -> answers session/prompt with an error
//   "mode"   -> replies with the mode it was last set to
//   "plan"   -> sends a plan, then replies
//   "stubborn" -> starts a tool and ignores session/cancel (Shellby has to end it)
//   "multiedit" -> asks to edit two files, one of them .gemini/settings.json
//   "nocmd"  -> asks to run a command without saying which
//   anything else -> streams "echo: <text>" in two chunks, with usage
//
// FAKE_ACP_NO_LOAD=1: initialize says it can't load sessions.
// FAKE_ACP_LOAD_FAILS=1: session/load answers an error.
// FAKE_ACP_SLOW_START=<ms>: session/new and session/load take that long.
// FAKE_ACP_NO_MODES=1: offers no session modes at all.
// session/load replays the conversation as ACP agents do: a user chunk, the
// agent's reply and a tool call.
const readline = require('readline');

let mode = 'default';
let cancelled = null;  // resolve() of the turn waiting on a cancel
let nextId = 1000;
const waiting = new Map(); // our requests to the client -> resolve

const send = msg => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
const later = fn => setTimeout(fn, Number(process.env.FAKE_ACP_SLOW_START) || 0);
const MODES = process.env.FAKE_ACP_NO_MODES === '1' ? undefined
  : { currentModeId: 'default', availableModes: [{ id: 'default' }, { id: 'auto_edit' }, { id: 'plan' }, { id: 'yolo' }] };
const update = (sessionId, u) => send({ method: 'session/update', params: { sessionId, update: u } });
const ask = (method, params) => new Promise(resolve => {
  const id = nextId++;
  waiting.set(id, resolve);
  send({ id, method, params });
});

process.stderr.write('fake-acp: ready\n');

async function prompt(id, { sessionId, prompt: blocks }) {
  const text = (blocks || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  if (text === 'crash') process.exit(3);
  if (text === 'fail') return send({ id, error: { code: -32000, message: 'Quota exceeded' } });
  if (text === 'slow') {
    update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 's1', title: 'sleep 60', kind: 'execute', status: 'in_progress', rawInput: { command: 'sleep 60' } });
    await new Promise(resolve => { cancelled = resolve; });
    return send({ id, result: { stopReason: 'cancelled' } });
  }
  if (text === 'stubborn') {
    update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'st', title: 'forever', kind: 'execute', status: 'in_progress' });
    return undefined; // never answers, even when cancelled
  }
  if (text === 'mode') {
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `mode: ${mode}` } });
    return send({ id, result: { stopReason: 'end_turn' } });
  }
  if (text === 'plan') {
    update(sessionId, { sessionUpdate: 'plan', entries: [{ content: 'Look', status: 'completed', priority: 'high' }, { content: 'Fix', status: 'pending', priority: 'high' }] });
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'planned' } });
    return send({ id, result: { stopReason: 'end_turn' } });
  }
  if (text === 'multiedit' || text === 'nocmd') {
    const call = text === 'nocmd'
      ? { toolCallId: 'n1', title: 'Run tests', kind: 'execute' }
      : { toolCallId: 'm1', title: 'Tidy up', kind: 'edit', content: [{ type: 'diff', path: 'a.js', oldText: 'x', newText: 'y' }, { type: 'diff', path: '.gemini/settings.json', oldText: '{}', newText: '{"tools":{}}' }] };
    const r = await ask('session/request_permission', { sessionId, toolCall: call, options: [{ optionId: 'yes', kind: 'allow_once' }, { optionId: 'no', kind: 'reject_once' }] });
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: r?.outcome?.optionId === 'yes' ? 'DONE' : 'DENIED' } });
    return send({ id, result: { stopReason: 'end_turn' } });
  }
  if (text === 'tool' || text === 'edit') {
    const call = text === 'tool'
      ? { toolCallId: 't1', title: 'npm test', kind: 'execute', rawInput: { command: 'npm test' } }
      : { toolCallId: 't2', title: 'Edit a.js', kind: 'edit', content: [{ type: 'diff', path: 'a.js', oldText: 'a = 1', newText: 'a = 2' }] };
    update(sessionId, { sessionUpdate: 'tool_call', ...call, status: 'pending' });
    const r = await ask('session/request_permission', {
      sessionId, toolCall: call,
      options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }, { optionId: 'always', name: 'Always', kind: 'allow_always' }, { optionId: 'no', name: 'Reject', kind: 'reject_once' }],
    });
    const allowed = r?.outcome?.outcome === 'selected' && (r.outcome.optionId === 'yes' || r.outcome.optionId === 'always');
    update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: call.toolCallId, status: allowed ? 'completed' : 'failed', content: [{ type: 'content', content: { type: 'text', text: allowed ? 'ok' : 'rejected' } }] });
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: allowed ? (text === 'tool' ? `ALLOWED ${r.outcome.optionId}` : 'EDITED') : 'DENIED' } });
    return send({ id, result: { stopReason: 'end_turn' } });
  }
  update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'echo: ' } });
  update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
  update(sessionId, { sessionUpdate: 'usage_update', used: 5300, size: 1000000 });
  send({ id, result: { stopReason: 'end_turn', usage: { inputTokens: 5000, outputTokens: 300, totalTokens: 5300 } } });
}

readline.createInterface({ input: process.stdin }).on('line', line => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id !== undefined && !msg.method) {
    const r = waiting.get(msg.id);
    waiting.delete(msg.id);
    r?.(msg.result);
    return;
  }
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      return send({ id, result: { protocolVersion: 1, agentCapabilities: { loadSession: process.env.FAKE_ACP_NO_LOAD !== '1' }, authMethods: [] } });
    case 'session/new':
      return later(() => send({ id, result: { sessionId: `sess-${process.pid}`, modes: MODES } }));
    case 'session/load':
      if (process.env.FAKE_ACP_LOAD_FAILS === '1') return send({ id, error: { code: -32000, message: 'no such session' } });
      update(params.sessionId, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'earlier' } });
      update(params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'REPLAYED reply' } });
      update(params.sessionId, { sessionUpdate: 'tool_call', toolCallId: 'old1', title: 'old command', kind: 'execute', status: 'completed', rawInput: { command: 'echo old' } });
      return later(() => send({ id, result: { modes: MODES } }));
    case 'session/set_mode':
      mode = params.modeId;
      return send({ id, result: {} });
    case 'session/set_model':
      return send({ id, result: {} });
    case 'session/prompt':
      prompt(id, params);
      return undefined;
    case 'session/cancel':
      for (const [, r] of waiting) r({ outcome: { outcome: 'cancelled' } });
      waiting.clear();
      cancelled?.();
      cancelled = null;
      return undefined;
    default:
      if (id !== undefined) send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
      return undefined;
  }
});
