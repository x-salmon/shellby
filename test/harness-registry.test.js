const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const reg = require('../src/main/harness/registry');
const { MODES } = require('../src/main/config');

test('every harness names its agent mode for each of Shellby\'s modes', () => {
  for (const h of reg.HARNESSES) {
    for (const m of MODES) assert.ok(Array.isArray(h.modes[m]) && h.modes[m].length, `${h.id} ${m}`);
    assert.match(h.install, /^npm install -g /, h.id);
    assert.match(h.command, /^[a-z][a-z0-9-]*$/, h.id);
  }
});

test('a saved harness id is one of ours, else Claude', () => {
  assert.equal(reg.cleanHarness('gemini'), 'gemini');
  assert.equal(reg.cleanHarness('codex'), 'codex');
  assert.equal(reg.cleanHarness(undefined), 'claude');
  assert.equal(reg.cleanHarness('../evil'), 'claude');
  assert.equal(reg.cleanHarness('claude'), 'claude');
});

test('installed is read from PATH and npm\'s folder', () => {
  const npm = 'C:\\Users\\me\\AppData\\Roaming\\npm';
  const files = new Set([path.join(npm, 'opencode.exe').toLowerCase()]);
  const o = { env: { PATH: '', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, exists: p => files.has(p.toLowerCase()), read: () => '' };
  const list = reg.listHarnesses(o);
  assert.deepEqual(list.map(h => [h.id, h.installed]), [['gemini', false], ['opencode', true], ['codex', false]]);
  assert.deepEqual(reg.commandFor('opencode', o), { file: path.join(npm, 'opencode.exe'), prefix: [] });
  assert.equal(reg.commandFor('nope', o), null);
});
