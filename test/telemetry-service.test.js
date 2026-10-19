const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createTelemetry } = require('../src/main/telemetry-service');

function fakeConfig(init = {}) {
  const store = { ...init };
  return { store, get: k => store[k], set: o => Object.assign(store, o) };
}

const tmpDir = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-tel-')));

async function started(opts = {}) {
  const t = createTelemetry({ config: opts.config || fakeConfig(), configDir: () => opts.dir || tmpDir(), env: opts.env || {}, managedFile: opts.managed || path.join(tmpDir(), 'none.json'), log: { warn() {} } });
  t.start();
  for (let i = 0; i < 100 && !t.port(); i++) await new Promise(r => setImmediate(r));
  return t;
}

const EXPORT = JSON.stringify({ resourceMetrics: [{ scopeMetrics: [{ metrics: [
  { name: 'claude_code.commit.count', sum: { dataPoints: [{ asInt: '3' }] } },
] }] }] });

const post = (t, { auth = `Bearer ${t.token()}`, body = EXPORT, url = '/v1/metrics', type = 'application/json', extra = {} } = {}) =>
  fetch(`http://127.0.0.1:${t.port()}${url}`, { method: 'POST', headers: { authorization: auth, 'content-type': type, ...extra }, body });

// An upload past the limit. The receiver answers 413 and cuts the connection off
// rather than read the rest, and Windows drops unread data when a connection is
// reset, so the 413 often never reaches the sender (fetch threw on CI). Either
// way it's refused: resolves to the status, or to 'cut off' on a reset.
// declared: say the size up front (refused from the header); otherwise it's
// streamed without one and refused once it grows past the limit.
function oversized(t, { declared }) {
  const size = 5 * 1024 * 1024;
  return new Promise(resolve => {
    const req = http.request({
      host: '127.0.0.1', port: t.port(), path: '/v1/metrics', method: 'POST',
      headers: { authorization: `Bearer ${t.token()}`, 'content-type': 'application/json', ...(declared ? { 'content-length': size } : {}) },
    }, res => { res.resume(); resolve(res.statusCode); req.destroy(); });
    req.on('error', e => resolve(/ECONNRESET|EPIPE|ECONNABORTED/.test(e.code) ? 'cut off' : e.message));
    const chunk = Buffer.alloc(64 * 1024, 0x20);
    let sent = 0;
    const more = () => {
      while (sent < size && !req.destroyed) {
        sent += chunk.length;
        if (!req.write(chunk)) return req.once('drain', more);
      }
      if (!req.destroyed) req.end();
    };
    more();
  });
}

test('takes an export with the token, and the summary counts it', async () => {
  const t = await started();
  try {
    const r = await post(t);
    assert.equal(r.status, 200);
    assert.equal(t.summary().week.commits, 3);
  } finally { t.stop(); }
});

test('turns away a wrong token, another path and a body that is not JSON', async () => {
  const t = await started();
  try {
    assert.equal((await post(t, { auth: 'Bearer nope' })).status, 401);
    assert.equal((await post(t, { url: '/v1/logs' })).status, 404);
    assert.equal((await post(t, { type: 'application/x-protobuf' })).status, 415);
    assert.equal((await post(t, { body: '{not json' })).status, 400);
    assert.equal((await post(t, { extra: { origin: 'https://evil.example' } })).status, 403, 'a browser');
    const refused = [413, 'cut off'];
    const big = await oversized(t, { declared: true });
    assert.ok(refused.includes(big), `too big by its own account: refused (got ${big})`);
    const streamed = await oversized(t, { declared: false });
    assert.ok(refused.includes(streamed), `too big as it streams in: refused (got ${streamed})`);
    assert.equal(t.summary(), null, 'nothing counted');
    assert.equal((await post(t)).status, 200, 'and it still takes a real export after');
  } finally { t.stop(); }
});

test('the ledger is saved when it stops', async () => {
  const config = fakeConfig();
  const t = await started({ config });
  await post(t);
  t.stop();
  assert.equal(Object.values(config.store.telemetryDays)[0].commits, 3);
});

test('env points Claude Code here, unless it is turned off or telemetry of your own is set up', async () => {
  const dir = tmpDir();
  const config = fakeConfig();
  const t = await started({ config, dir });
  try {
    assert.equal(t.env().OTEL_EXPORTER_OTLP_METRICS_ENDPOINT, `http://127.0.0.1:${t.port()}/v1/metrics`);
    config.set({ claudeTelemetry: false });
    assert.deepEqual(t.env(), {});
    config.set({ claudeTelemetry: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ env: { OTEL_METRICS_EXPORTER: 'otlp' } }));
    assert.deepEqual(t.env(), {}, "your settings' telemetry stays yours");
  } finally { t.stop(); }
  const own = await started({ env: { CLAUDE_CODE_ENABLE_TELEMETRY: '1' } });
  try { assert.deepEqual(own.env(), {}); } finally { own.stop(); }
  const managed = path.join(tmpDir(), 'managed-settings.json');
  fs.writeFileSync(managed, JSON.stringify({ env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://org.example' } }));
  const org = await started({ managed });
  try { assert.deepEqual(org.env(), {}, "an organisation's telemetry stays theirs"); } finally { org.stop(); }
});

test('asking for the env starts the receiver, and it is empty until it listens', async () => {
  const t = createTelemetry({ config: fakeConfig(), configDir: tmpDir, env: {}, managedFile: path.join(tmpDir(), 'none.json') });
  try {
    assert.deepEqual(t.env(), {});
    for (let i = 0; i < 100 && !t.port(); i++) await new Promise(r => setImmediate(r));
    assert.ok(t.env().OTEL_EXPORTER_OTLP_METRICS_ENDPOINT);
  } finally { t.stop(); }
});

test('turned off, it never starts', () => {
  const t = createTelemetry({ config: fakeConfig({ claudeTelemetry: false }), configDir: tmpDir, env: {} });
  assert.deepEqual(t.env(), {});
  assert.equal(t.port(), null);
  t.stop();
});
