// Opening the profile at boot (wiring/profile.js): settings and history are
// there for everything after, rooms are decided once, and a settings file that
// couldn't be read is written down rather than lost quietly.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installFakeElectron } = require('./helpers/fake-ipc');

const userData = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-profile-')));
after(() => fs.rmSync(userData, { recursive: true, force: true }));
installFakeElectron({ userData });
const { wireProfile } = require('../src/main/wiring/profile');

// Claude Code's own folder, empty unless a test gives it a conversation.
const claudeDir = path.join(userData, 'claude');

function open() {
  const errors = [];
  const warnings = [];
  const d = { log: { error: (...a) => errors.push(a), info: () => {}, warn: (...a) => warnings.push(a) }, claudeConfigDir: () => claudeDir };
  wireProfile(d).openProfile();
  return { d, errors, warnings };
}

test('settings and history are open for everything after', () => {
  const { d, errors } = open();
  assert.equal(typeof d.config.get, 'function');
  assert.ok(Array.isArray(d.history.list()));
  assert.equal(errors.length, 0);
});

test('rooms are decided once and kept', () => {
  const first = open().d.config.get('rooms');
  assert.ok(first != null);
  const { d } = open();
  assert.deepEqual(d.config.get('rooms'), first);
});

test('someone new who already uses Claude Code starts with the tool screens open', () => {
  const settings = path.join(userData, 'settings.json');
  const before = fs.readFileSync(settings, 'utf8');
  fs.writeFileSync(settings, JSON.stringify({ onboarded: false }));
  fs.mkdirSync(path.join(claudeDir, 'projects', 'C--code-app'), { recursive: true });
  try {
    const rooms = open().d.config.get('rooms');
    assert.equal(rooms.all, false);
    assert.ok(rooms.open.includes('projects') && rooms.open.includes('toolbox'), JSON.stringify(rooms));
  } finally {
    fs.rmSync(claudeDir, { recursive: true, force: true });
    fs.writeFileSync(settings, before);
  }
});

test('a settings file that could not be read comes back from the backup, and says so', () => {
  fs.writeFileSync(path.join(userData, 'settings.json'), '{ not json');
  const { d, errors, warnings } = open();
  assert.ok(d.config.recoveredFrom);
  assert.ok(d.config.restoredFrom, 'the earlier boots left a backup');
  assert.equal(errors.length, 0);
  assert.match(warnings[0][0], /brought back from the backup/);
  assert.match(warnings[0][1], /damaged copy is at/);
});

// A power cut wiped settings.json on a PC that had no backup yet: he started
// over as if new, with the welcome and every screen but one locked away.
test('settings lost with no backup: logged, and still someone who was here', () => {
  fs.rmSync(path.join(userData, 'settings.backup.json'), { force: true });
  fs.writeFileSync(path.join(userData, 'settings.json'), Buffer.alloc(256));
  const { d, errors } = open();
  assert.ok(d.config.recoveredFrom);
  assert.match(errors[0][0], /could not be read and there was no backup/);
  assert.match(errors[0][1], /old copy is at/);
  assert.equal(d.config.get('onboarded'), true);
  assert.deepEqual(d.config.get('rooms'), require('../src/main/rooms').initialRooms(true), 'every screen open');
});
