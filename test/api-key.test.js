// "Bill to: my API key": the sealed store (claude/api-key.js) and how the key
// reaches Claude Code's environment, and only it (claude/cli.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApiKeyStore, cleanKey, hintOf } = require('../src/main/claude/api-key');
const { claudeEnv, terminalEnv, billingScrub, BILLING_ENV } = require('../src/main/claude/cli');

const KEY = `sk-ant-api03-${'a'.repeat(40)}wxyz`;
const OTHER = { ANTHROPIC_API_KEY: 'sk-ant-from-the-pc', ANTHROPIC_BASE_URL: 'https://proxy.example', CLAUDE_CODE_USE_BEDROCK: '1' };

// A stand-in for safeStorage that really changes the bytes, so a test can see the key isn't on disk in the clear.
const fakeCrypto = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: s => Buffer.from(Buffer.from(s, 'utf8').map(b => b ^ 0x5a)),
  decryptString: b => Buffer.from(b.map(x => x ^ 0x5a)).toString('utf8'),
});
const tmpFile = () => path.join(fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-key-'))), 'anthropic-key.bin');

test('cleanKey accepts an Anthropic key, trimmed, and refuses anything else', () => {
  assert.equal(cleanKey(`  ${KEY}\n`), KEY);
  for (const bad of ['', 'hello', 'sk-ant-short', `sk-ant-${'a'.repeat(30)} rm -rf`, `sk-ant-${'a'.repeat(30)}\nX=1`, 'sk-proj-abcdefghijklmnopqrstuvwxyz', 42, null, `sk-ant-${'a'.repeat(300)}`]) {
    assert.equal(cleanKey(bad), null, String(bad));
  }
});

test('hintOf shows only the last four characters', () => {
  assert.equal(hintOf(KEY), 'sk-ant-…wxyz');
});

test('a saved key is sealed on disk, comes back for Claude Code, and the view never holds it', () => {
  const file = tmpFile();
  const store = createApiKeyStore(file, fakeCrypto());
  assert.deepEqual(store.save(KEY), { ok: true });
  assert.ok(!fs.readFileSync(file).toString('utf8').includes(KEY), 'the key is not in the file in the clear');
  assert.equal(store.read(), KEY);
  const view = store.view();
  assert.deepEqual(view, { saved: true, hint: 'sk-ant-…wxyz', canEncrypt: true });
  assert.ok(!JSON.stringify(view).includes(KEY.slice(0, -4)));
  store.clear();
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(store.view(), { saved: false, hint: null, canEncrypt: true });
});

test('a key is refused when Windows cannot encrypt it, and nothing is written', () => {
  const file = tmpFile();
  const r = createApiKeyStore(file, fakeCrypto(false)).save(KEY);
  assert.equal(r.ok, false);
  assert.equal(fs.existsSync(file), false);
});

test('something that is not a key is refused before it is sealed', () => {
  const file = tmpFile();
  const r = createApiKeyStore(file, fakeCrypto()).save('my password');
  assert.equal(r.ok, false);
  assert.match(r.error, /sk-ant-/);
  assert.equal(fs.existsSync(file), false);
});

test('a file that does not open reads as no key', () => {
  const file = tmpFile();
  fs.writeFileSync(file, 'not sealed');
  assert.equal(createApiKeyStore(file, fakeCrypto()).read(), '');
});

test('API key billing puts the saved key in, in place of everything set on the PC, and asks Claude Code to keep it from its tools', () => {
  const env = claudeEnv({ PATH: 'x', ...OTHER }, { onlyPlan: false, keyMode: true, key: KEY });
  assert.equal(env.ANTHROPIC_API_KEY, KEY);
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  assert.equal(env.CLAUDE_CODE_USE_BEDROCK, undefined);
  assert.equal(env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, '1');
  assert.equal(env.PATH, 'x');
});

test('API key billing with no key saved falls back to the plan, not to what the PC has set', () => {
  const env = claudeEnv({ PATH: 'x', ...OTHER }, { onlyPlan: false, keyMode: true, key: '' });
  for (const k of BILLING_ENV) assert.equal(env[k], undefined, k);
});

test('plan only wins over a key: no key goes in', () => {
  const env = claudeEnv({ PATH: 'x' }, { onlyPlan: true, keyMode: true, key: KEY });
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
});

test('the key never goes to a terminal, and the terminal drops what the PC has set too', () => {
  const env = terminalEnv({ PATH: 'x', ...OTHER }, { onlyPlan: false, keyMode: true });
  for (const k of BILLING_ENV) assert.equal(env[k], undefined, k);
  assert.equal(env.SHELLBY_OWNED, undefined);
  assert.deepEqual(billingScrub(false, true), BILLING_ENV);
  assert.deepEqual(billingScrub(false, false), []);
});
