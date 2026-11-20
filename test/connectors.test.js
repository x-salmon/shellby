const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const gateway = require('../src/main/connectors/gateway');
const { createConnectors } = require('../src/main/connectors');
const { ClaudeSession } = require('../src/main/session');
const { AcpSession } = require('../src/main/harness/acp-session');

const crypto = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(`sealed:${s}`), decryptString: b => b.toString().replace(/^sealed:/, '') };
const tmp = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-connectors-')));

test('a pasted gateway is cleaned: https only, no ${VAR}, no login in the address', () => {
  assert.deepEqual(gateway.cleanSetup({ url: ' https://mcp.example.com/u/abc#x ', key: ' k123 ', preset: 'composio' }),
    { url: 'https://mcp.example.com/u/abc', key: 'k123', header: 'x-api-key', preset: 'composio' });
  assert.equal(gateway.cleanSetup({ url: 'http://localhost:3000/mcp' }).url, 'http://localhost:3000/mcp', 'plain http only on this PC');
  for (const [raw, why] of [
    [{ url: 'http://mcp.example.com' }, /https/],
    [{ url: 'https://x.example.com/${HOME}' }, /environment/],
    [{ url: 'https://x.example.com', key: '${GITHUB_TOKEN}' }, /environment/],
    [{ url: 'https://user:pw@x.example.com' }, /key box/],
    [{ url: 'not a url' }, /web address/],
    [{ url: '' }, /Paste/],
    [{ url: 'https://x.example.com', key: 'a b' }, /space/],
    [{ url: 'https://x.example.com', header: 'X Bad' }, /header/],
  ]) assert.match(gateway.cleanSetup(raw).error, why, JSON.stringify(raw));
  assert.equal(gateway.cleanSetup({ url: 'https://x.example.com', preset: 'nope' }).preset, 'custom');
});

test('the key goes in its header: Bearer for Authorization, as typed for any other', () => {
  assert.deepEqual(gateway.authHeaders({ key: 'k', header: 'Authorization' }), { Authorization: 'Bearer k' });
  assert.deepEqual(gateway.authHeaders({ key: 'Basic abc', header: 'Authorization' }), { Authorization: 'Basic abc' }, 'a scheme of its own is kept');
  assert.deepEqual(gateway.authHeaders({ key: 'k', header: 'x-api-key' }), { 'x-api-key': 'k' });
  assert.deepEqual(gateway.authHeaders({ key: '', header: 'Authorization' }), {}, 'no key, no header: the URL carries it');
});

test('Claude gets an http server; an ACP agent only when it takes http servers', () => {
  const s = { url: 'https://g.example.com/mcp', key: 'k', header: 'x-api-key' };
  assert.deepEqual(gateway.claudeServers(s), { [gateway.SERVER]: { type: 'http', url: s.url, headers: { 'x-api-key': 'k' } } });
  assert.deepEqual(gateway.acpServers(s, { http: true }), [{ type: 'http', name: gateway.SERVER, url: s.url, headers: [{ name: 'x-api-key', value: 'k' }] }]);
  assert.deepEqual(gateway.acpServers(s, {}), []);
  assert.deepEqual(gateway.acpServers(s, undefined), []);
});

test('the panel only ever sees the host and the key\'s last four', () => {
  const v = gateway.view({ url: 'https://mcp.zapier.com/api/mcp/s/SECRET/mcp', key: 'abcdef1234', preset: 'zapier' });
  assert.deepEqual(v, { saved: true, host: 'mcp.zapier.com', hint: '…1234', preset: 'zapier' });
  assert.ok(!JSON.stringify(v).includes('SECRET'));
  assert.deepEqual(gateway.view(null), { saved: false, host: null, hint: null, preset: null });
});

test('saved sealed, handed out only when switched on, per kind of agent', () => {
  const dir = tmp();
  let switches = {};
  const c = createConnectors({ file: path.join(dir, 'connectors.bin'), crypto, switches: () => switches });
  assert.equal(c.save({ url: 'http://example.com' }).ok, false);
  assert.equal(c.save({ url: 'https://g.example.com/mcp', key: 'topsecret', header: 'Authorization' }).ok, true);
  assert.ok(fs.readFileSync(path.join(dir, 'connectors.bin'), 'utf8').startsWith('sealed:'), 'only ever written sealed');
  assert.equal(c.claudeServers(), null, 'saved is not on');
  switches = { on: true };
  assert.equal(c.claudeServers()[gateway.SERVER].headers.Authorization, 'Bearer topsecret');
  assert.equal(c.acpServers({ http: true }).length, 1);
  switches = { on: true, agents: false };
  assert.deepEqual(c.acpServers({ http: true }), []);
  assert.ok(c.claudeServers());
  const v = c.view();
  assert.equal(v.saved, true);
  assert.ok(!JSON.stringify(v).includes('topsecret'));
  c.clear();
  assert.equal(c.claudeServers(), null);
});

test('Test lists its tools without your environment', async () => {
  const dir = tmp();
  const seen = [];
  const c = createConnectors({ file: path.join(dir, 'c.bin'), crypto, switches: () => ({}), list: async (def, opts) => { seen.push([def, opts]); return [{ name: 'gmail_send' }, { name: 'slack_post' }]; } });
  assert.deepEqual(await c.test(), { ok: false, error: 'Save a gateway first.' });
  c.save({ url: 'https://g.example.com/mcp', key: 'k', header: 'x-api-key' });
  assert.deepEqual(await c.test(), { ok: true, tools: 2, names: ['gmail_send', 'slack_post'] });
  assert.deepEqual(seen[0][0], { type: 'http', url: 'https://g.example.com/mcp', headers: { 'x-api-key': 'k' } });
  assert.deepEqual(seen[0][1].env, {}, 'nothing from your environment goes along');
  const failing = createConnectors({ file: path.join(dir, 'c.bin'), crypto, switches: () => ({}), list: async () => { throw new Error('401 Unauthorized'); } });
  assert.deepEqual(await failing.test(), { ok: false, error: '401 Unauthorized' });
});

// A stand-in CLI that copies whatever --mcp-config names, and the flags, then exits.
async function runWith(opts) {
  const dir = tmp();
  const out = path.join(dir, 'seen.json');
  const script = path.join(dir, 'cli.js');
  fs.writeFileSync(script, `const a = process.argv; const i = a.indexOf('--mcp-config'); const f = i < 0 ? null : a[i + 1];
require('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify({ args: a.slice(2), file: f, text: f && require('fs').existsSync(f) ? require('fs').readFileSync(f, 'utf8') : null }));`);
  const s = new ClaudeSession({ exe: process.execPath, argsPrefix: [script], cwd: dir, mode: 'ask', ...opts });
  s.start();
  const line = s.buildArgs().join(' ');
  await new Promise(r => s.proc.once('exit', r));
  await new Promise(r => setTimeout(r, 100));
  return { line, seen: JSON.parse(fs.readFileSync(out, 'utf8')) };
}

test('a Claude conversation gets the gateway in its own config file, never on the command line', async () => {
  const servers = gateway.claudeServers({ url: 'https://g.example.com/mcp', key: 'topsecret', header: 'Authorization' });
  const { line, seen } = await runWith({ extraMcp: () => servers });
  assert.ok(!line.includes('topsecret'), 'the key is not on the command line');
  assert.ok(!seen.args.includes('--strict-mcp-config'), 'beside your own servers, not instead of them');
  assert.deepEqual(JSON.parse(seen.text).mcpServers[gateway.SERVER], servers[gateway.SERVER]);
  assert.equal(fs.existsSync(seen.file), false, 'the file goes with the process');
});

test("a routine's strict set of servers stays strict: no gateway beside it", async () => {
  const mcpConfig = { mcpServers: { linear: { type: 'http', url: 'https://l.example.com' } } };
  const { seen } = await runWith({ mcpConfig, extraMcp: () => gateway.claudeServers({ url: 'https://g.example.com', key: '', header: 'Authorization' }) });
  assert.ok(seen.args.includes('--strict-mcp-config'));
  assert.deepEqual(Object.keys(JSON.parse(seen.text).mcpServers), ['linear']);
});

test('no gateway saved: the command line is as it always was', async () => {
  const { seen } = await runWith({ extraMcp: () => null });
  assert.equal(seen.file, null);
});

test('an ACP agent that takes http servers gets the gateway in session/new', async t => {
  const FAKE = path.join(__dirname, 'fixtures', 'fake-acp.js');
  const asked = [];
  const s = new AcpSession({
    harness: { id: 'gemini', name: 'Gemini CLI' }, command: () => ({ file: process.execPath, prefix: [FAKE] }), cwd: __dirname,
    kill: proc => proc.kill(), env: () => ({ FAKE_ACP_MCP_HTTP: '1' }),
    mcpServers: caps => { asked.push(caps); return gateway.acpServers({ url: 'https://g.example.com/mcp', key: 'k', header: 'x-api-key' }, caps); },
  });
  t.after(() => s.kill());
  const items = [];
  s.on('item', i => items.push(i));
  s.send('hi');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no result')), 5000);
    s.on('item', i => { if (i.kind === 'result') { clearTimeout(timer); resolve(); } });
  });
  assert.deepEqual(asked, [{ http: true }]);
  assert.match(items.filter(i => i.kind === 'text').map(i => i.text).join(''), /\[mcp: shellby-connectors https:\/\/g\.example\.com\/mcp x-api-key\]/);
});
