// Claude Code's `auth status` says signed in whenever credentials are saved,
// even ones the server has turned down. After a turn fails as signed out,
// Shellby says so until the credentials change (claude/cli.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { signInLapsed, signInStamp, applyLapsed, accountOf, accountChanged } = require('../src/main/claude/cli');

function setup() {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-lapsed-'));
  const creds = path.join(configDir, '.credentials.json');
  fs.writeFileSync(creds, '{}');
  const status = { installed: true, loggedIn: true, authMethod: 'claude.ai', email: 'crab@example.com', configDir };
  return { creds, status };
}

test('a sign-in turned down mid-turn shows as signed out, through later checks', () => {
  const { status } = setup();
  const now = signInLapsed(status);
  assert.equal(now.loggedIn, false);
  assert.equal(now.lapsed, true);
  const later = applyLapsed(status); // `claude auth status` still says signed in
  assert.equal(later.loggedIn, false);
  assert.equal(later.lapsed, true);
});

test('signing in again (the credentials change) clears it', () => {
  const { creds, status } = setup();
  signInLapsed(status);
  const t = new Date(Date.now() + 5000);
  fs.utimesSync(creds, t, t);
  assert.deepEqual(applyLapsed(status), status);
  assert.deepEqual(applyLapsed(status), status, 'and it stays cleared');
});

test('a real sign-out clears it, and an API key is never marked', () => {
  const { status } = setup();
  signInLapsed(status);
  assert.equal(applyLapsed({ ...status, loggedIn: false }).lapsed, undefined);
  assert.deepEqual(applyLapsed(status), status);
  const key = { ...status, authMethod: 'api_key' };
  assert.deepEqual(signInLapsed(key), key);
});

// Claude Code reads its sign-in once, as it starts: a process from before the
// current sign-in (an account switch) failing says nothing about this one.
test('a process older than the sign-in failing leaves it signed in', () => {
  const { creds, status } = setup();
  const signedIn = Date.now();
  fs.utimesSync(creds, new Date(signedIn), new Date(signedIn));
  assert.equal(signInLapsed(status, signedIn - 60000), status, 'started a minute before the sign-in');
  assert.deepEqual(applyLapsed(status), status, 'and later checks agree');
  const newer = signInLapsed(status, signedIn + 1000);
  assert.equal(newer.lapsed, true, 'one started on this sign-in still marks it');
  applyLapsed({ ...status, loggedIn: false }); // clears it for the tests after
});

test('the account changed: signed in after a sign-out, or as someone else', () => {
  const me = { loggedIn: true, email: 'crab@example.com' };
  assert.equal(accountOf(me), 'crab@example.com');
  assert.equal(accountOf({ loggedIn: false, lapsed: true }), null);
  assert.equal(accountOf(null), undefined);
  assert.equal(accountChanged(null, me), true, 'signed in after a sign-out');
  assert.equal(accountChanged('crab@example.com', { ...me, email: 'other@example.com' }), true);
  assert.equal(accountChanged('crab@example.com', { ...me }), false, 'the same account checked again');
  assert.equal(accountChanged(undefined, me), false, 'not knowing yet is not a change');
  assert.equal(accountChanged('crab@example.com', { loggedIn: false }), false, 'signing out is handled where it happens');
  assert.equal(accountChanged('', { loggedIn: true }), false, 'an account that never says its email');
});

test('the sign-in stamp moves when the credentials are rewritten, wherever the sign-in happened', () => {
  const { creds, status } = setup();
  const before = signInStamp(status.configDir);
  assert.ok(before > 0);
  fs.utimesSync(creds, new Date(), new Date(Date.now() + 5000)); // a /login in a terminal
  assert.notEqual(signInStamp(status.configDir), before);
  fs.rmSync(creds); // /logout
  assert.equal(signInStamp(status.configDir), 0);
});
