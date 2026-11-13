// Stat tiles on the share cards (src/renderer/panel/card.js): a big number
// shrinks to fit its tile whole instead of being cut short with "…".
// card.js runs in a vm with a SB and DOM stubs holding only what it reads at
// load, and a canvas whose text measures 0.6em a character, like Martian Mono.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'panel', 'card.js'), 'utf8');

function element() {
  return { addEventListener() {}, querySelector: () => element(), querySelectorAll: () => [], dataset: {} };
}

function loadKit() {
  const SB = { api: {}, state: {}, $: () => element() };
  const document = { querySelectorAll: () => [] };
  vm.runInContext(SRC, vm.createContext({ SB, document }), { filename: 'card.js' });
  return SB.cardKit;
}

function fakeCtx() {
  const drawn = [];
  const ctx = {
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
    measureText(text) { return { width: [...text].length * Number(/(\d+)px/.exec(this.font)[1]) * 0.6 }; },
    fillText(text) { drawn.push({ text, font: this.font }); },
    beginPath() {}, moveTo() {}, arcTo() {}, closePath() {}, fill() {}, stroke() {}, fillRect() {},
  };
  return { ctx, drawn };
}

// A wide card's tiles: the right column is 576px across, three to a row.
const tilesWithTasks = tasks => [[tasks, 'tasks done', '#f00'], ['53/107', 'trophies', '#f00'], ['1', 'project shipped', '#f00']];

test('a wide card shows thousands of tasks and a long trophy count whole', () => {
  const K = loadKit();
  const { ctx, drawn } = fakeCtx();
  K.drawTiles(ctx, tilesWithTasks('6,312'), 568, 576, 226);
  const numbers = drawn.filter((_, i) => i % 2 === 0).map(d => d.text);
  assert.deepEqual(numbers, ['6,312', '53/107', '1']);
});

test('a short number keeps the full 46px size', () => {
  const K = loadKit();
  const { ctx, drawn } = fakeCtx();
  K.drawTiles(ctx, tilesWithTasks('42'), 568, 576, 226);
  assert.match(drawn[0].font, /\b46px/);
});

test('ten million tasks still fit whole', () => {
  const K = loadKit();
  const { ctx, drawn } = fakeCtx();
  K.drawTiles(ctx, tilesWithTasks('10,000,000'), 568, 576, 226);
  assert.equal(drawn[0].text, '10,000,000');
});

test('fitNumber cuts a number short only once the font reaches its floor', () => {
  const K = loadKit();
  const { ctx } = fakeCtx();
  const text = K.fitNumber(ctx, '1234567890123', 100, '500 {px}px "Martian Mono"', 46, 22);
  assert.match(ctx.font, /\b22px/);
  assert.ok(text.endsWith('…'));
});
