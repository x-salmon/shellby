const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPeer, RpcError, METHOD_NOT_FOUND } = require('../src/main/harness/rpc');

function pair() {
  const sent = [];
  const peer = createPeer({ write: line => sent.push(JSON.parse(line)) });
  return { peer, sent, last: () => sent.at(-1) };
}

test('a request is one line with an id, and its answer resolves it', async () => {
  const { peer, last } = pair();
  const p = peer.request('session/new', { cwd: 'C:\\x' });
  assert.deepEqual(last(), { jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: 'C:\\x' } });
  peer.receive(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { sessionId: 's1' } }));
  assert.deepEqual(await p, { sessionId: 's1' });
  assert.equal(peer.pending, 0);
});

test('an error answer rejects with its code and message', async () => {
  const { peer } = pair();
  const p = peer.request('session/load', {});
  peer.receive(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'Authentication required' } }));
  await assert.rejects(p, e => e instanceof RpcError && e.code === -32000 && /Authentication/.test(e.message));
});

test("the agent's requests are answered with the same id, errors included", async () => {
  const { peer, sent } = pair();
  peer.onRequest = async (method, params) => {
    if (method === 'session/request_permission') return { outcome: { outcome: 'selected', optionId: params.options[0].optionId } };
    throw new RpcError('nope', METHOD_NOT_FOUND);
  };
  peer.receive(JSON.stringify({ jsonrpc: '2.0', id: 'a7', method: 'session/request_permission', params: { options: [{ optionId: 'allow' }] } }));
  peer.receive(JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'fs/read_text_file', params: {} }));
  await new Promise(r => setImmediate(r));
  assert.deepEqual(sent[0], { jsonrpc: '2.0', id: 'a7', result: { outcome: { outcome: 'selected', optionId: 'allow' } } });
  assert.deepEqual(sent[1], { jsonrpc: '2.0', id: 8, error: { code: METHOD_NOT_FOUND, message: 'nope' } });
});

test('notifications go to their handler; stray lines to onOther', () => {
  const { peer } = pair();
  const got = [];
  const other = [];
  peer.onNotification = (m, p) => got.push([m, p]);
  peer.onOther = l => other.push(l);
  peer.receive(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk' } } }));
  peer.receive('Loaded cached credentials.');
  peer.receive('[1,2]');
  peer.receive('   ');
  assert.equal(got.length, 1);
  assert.equal(got[0][0], 'session/update');
  assert.deepEqual(other, ['Loaded cached credentials.', '[1,2]']);
});

test('a listener that throws does not break the stream', () => {
  const { peer } = pair();
  peer.onNotification = () => { throw new Error('bug'); };
  assert.doesNotThrow(() => peer.receive(JSON.stringify({ jsonrpc: '2.0', method: 'x' })));
});

test('closing fails everything still waiting, and later requests at once', async () => {
  const { peer } = pair();
  const p = peer.request('session/prompt', {});
  peer.close('the agent exited (code 1)');
  await assert.rejects(p, /exited \(code 1\)/);
  await assert.rejects(peer.request('x'), /exited/);
  assert.equal(peer.closed, true);
});

test('a request with no answer times out and its late answer is ignored', async () => {
  const timers = [];
  const peer = createPeer({ write: () => {}, timeoutMs: 1000, setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
  const p = peer.request('initialize');
  timers[0]();
  await assert.rejects(p, /got no answer in 1s/);
  assert.doesNotThrow(() => peer.receive(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })));
});

test('a write that fails closes the peer', async () => {
  const peer = createPeer({ write: () => { throw new Error('EPIPE'); } });
  await assert.rejects(peer.request('x'), /EPIPE/);
  assert.equal(peer.closed, true);
});

test("an answer whose id comes back as a string still resolves its request", async () => {
  const { peer } = pair();
  const p = peer.request('session/prompt', {});
  peer.receive(JSON.stringify({ jsonrpc: '2.0', id: '1', result: { stopReason: 'end_turn' } }));
  assert.deepEqual(await p, { stopReason: 'end_turn' });
});
