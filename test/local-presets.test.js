const { test } = require('node:test');
const assert = require('node:assert');
const { applyPreset, cleanPreset, PRESETS } = require('../src/main/local/presets');
const { cleanSettings } = require('../src/main/local/model');

const lm = cleanSettings({ on: false, url: 'http://127.0.0.1:11434', model: '' });

test('Coding picks the best installed model for each slot', () => {
  const { settings, missing } = applyPreset(lm, 'coding', ['qwen3:4b', 'qwen3-coder:30b', 'devstral:latest']);
  assert.deepStrictEqual(missing, []);
  assert.strictEqual(settings.preset, 'coding');
  assert.strictEqual(settings.on, true);
  assert.strictEqual(settings.model, 'qwen3:4b');
  assert.strictEqual(settings.models.quiz, 'qwen3-coder:30b');
  assert.deepStrictEqual(settings.agent, { on: true, model: 'qwen3-coder:30b', helpers: '', quick: 'qwen3:4b' });
});

test('a model named without a tag matches its :latest', () => {
  assert.strictEqual(applyPreset(lm, 'coding', ['devstral:latest']).settings.agent.model, 'devstral:latest');
});

test('slots with nothing installed are named so Settings can offer them', () => {
  const { settings, missing } = applyPreset(lm, 'coding', ['qwen3:4b']);
  assert.deepStrictEqual(missing, [{ slot: 'main', model: PRESETS.coding.main[0] }]);
  assert.strictEqual(settings.agent.on, false);
  assert.strictEqual(settings.on, true);
});

test('with no quick model, quick tasks run on the main one', () => {
  const { settings, missing } = applyPreset(lm, 'chat', ['gpt-oss:20b']);
  assert.deepStrictEqual(missing, [{ slot: 'quick', model: 'qwen3:4b' }]);
  assert.strictEqual(settings.agent.quick, '');
  assert.strictEqual(settings.model, 'gpt-oss:20b');
});

test('Off turns drafts, answers and conversations off but keeps their models', () => {
  const on = applyPreset(lm, 'coding', ['qwen3:4b', 'qwen3-coder:30b']).settings;
  const off = applyPreset({ ...on, answers: { on: true, model: 'x' } }, 'off', []).settings;
  assert.strictEqual(off.on, false);
  assert.strictEqual(off.answers.on, false);
  assert.strictEqual(off.agent.on, false);
  assert.strictEqual(off.agent.model, 'qwen3-coder:30b');
  assert.strictEqual(off.answers.model, 'x');
});

test('applied settings survive cleanSettings unchanged', () => {
  const { settings } = applyPreset(lm, 'coding', ['qwen3:4b', 'qwen3-coder:30b']);
  assert.deepStrictEqual(cleanSettings(settings), settings);
});

test('an unknown preset reads as custom', () => {
  assert.strictEqual(cleanPreset('turbo'), 'custom');
  assert.strictEqual(cleanPreset(undefined), 'custom');
  assert.strictEqual(applyPreset(lm, 'nope', []).settings.preset, 'custom');
});
