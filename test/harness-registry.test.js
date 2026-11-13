const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const reg = require('../src/main/harness/registry');
const { MODES } = require('../src/main/config');

test('every harness lists its modes for each of Shellby\'s, and never a looser one for a stricter mode', () => {
  for (const h of reg.HARNESSES) {
    for (const m of MODES) assert.ok(Array.isArray(h.modes[m]), `${h.id} ${m}`);
    // Ask first and Plan only ask before everything: no auto, build, auto-edit, yolo or full access.
    for (const m of ['ask', 'plan']) assert.ok(!h.modes[m].some(id => ['auto', 'build', 'auto_edit', 'yolo', 'full-access'].includes(id)), `${h.id} ${m} asks at least as much`);
    // Auto-edit still asks before commands: not a mode that runs them unasked.
    assert.ok(!h.modes.acceptEdits.some(id => ['auto', 'build', 'yolo', 'full-access'].includes(id)), `${h.id} acceptEdits still asks before commands`);
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
