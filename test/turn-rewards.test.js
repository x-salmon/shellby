const { test } = require('node:test');
const assert = require('node:assert/strict');
const { entryOf, createLedger, cardOf, MAX_ITEMS } = require('../src/main/turn-rewards');
const { wireTurnRewards } = require('../src/main/wiring/turn-rewards');
const { PERSISTED } = require('../src/main/history');

test('entryOf reads each reward channel and ignores the rest', () => {
  assert.deepEqual(entryOf('critter:xp', { amount: 25, kind: 'task' }), { kind: 'xp', amount: 25 });
  assert.equal(entryOf('life:found', { id: 'shell', name: 'Cowrie', isNew: true, rarityLabel: 'Rare' }).title, 'Dug up Cowrie');
  assert.equal(entryOf('bugdex:caught', { id: 'mite', name: 'Null Mite', battle: 'enc-1' }).battle, 'enc-1');
  assert.equal(entryOf('stickers:new', { id: 'p', name: 'shellby' }).go, 'stickers');
  assert.equal(entryOf('wardrobe:unlocked', { achievement: { id: 'a', name: 'First steps', icon: '👣' }, rewards: [{ name: 'Party hat' }] }).text, 'unlocked Party hat');
  assert.equal(entryOf('xp:levelup', { level: 12, title: 'Tidewalker' }).title, 'Level 12');
  assert.equal(entryOf('quests', { done: { id: 'q', title: 'Dig once' } }).kind, 'quest');
  assert.equal(entryOf('quests', { view: {} }), null, 'a quests push with nothing done is not a reward');
  assert.equal(entryOf('critter:xp', { amount: 0 }), null);
  assert.equal(entryOf('tab:item', { kind: 'text' }), null);
  assert.equal(entryOf('life:found', null), null);
});

test('a reward goes to the turn that started most recently and is still running', () => {
  const ledger = createLedger();
  ledger.begin('a');
  ledger.begin('b');
  assert.equal(ledger.add({ kind: 'find', id: 'x', title: 'Dug up X' }), 'b');
  ledger.ending('b');
  assert.equal(ledger.add({ kind: 'find', id: 'y', title: 'Dug up Y' }), 'a', 'a running turn beats one only waiting for its card');
});

test('a turn whose result is in still collects until its card is written', () => {
  const ledger = createLedger();
  ledger.begin('a');
  ledger.ending('a');
  ledger.add({ kind: 'level', title: 'Level 3' });
  const card = ledger.close('a', 5);
  assert.equal(card.items[0].title, 'Level 3');
  assert.equal(card.at, 5);
});

test('with no turn going, a reward is not kept', () => {
  const ledger = createLedger();
  assert.equal(ledger.add({ kind: 'find', title: 'Dug up X' }), null);
});

test('a turn that earned only XP makes no card', () => {
  assert.equal(cardOf([{ kind: 'xp', amount: 30 }, { kind: 'xp', amount: 5 }]), null);
});

test('the card sums XP, drops repeats and caps its list', () => {
  const finds = Array.from({ length: MAX_ITEMS + 2 }, (_, i) => ({ kind: 'find', id: `f${i}`, title: `Dug up ${i}` }));
  const card = cardOf([{ kind: 'xp', amount: 10 }, ...finds, finds[0], { kind: 'xp', amount: 15 }], 1);
  assert.equal(card.kind, 'rewards');
  assert.equal(card.xp, 25);
  assert.equal(card.items.length, MAX_ITEMS);
  assert.equal(card.more, 2);
});

test('rewards cards are kept in History', () => {
  assert.ok(PERSISTED.has('rewards'));
});

// A manager double: 'item' listeners, the tabs it has and what was noted.
function fakeDeps({ rewardCards = true } = {}) {
  const listeners = [];
  const noted = [];
  const d = {
    config: { get: k => (k === 'rewardCards' ? rewardCards : undefined) },
    manager: { on: (ev, fn) => { if (ev === 'item') listeners.push(fn); }, tabs: new Map([['t1', {}]]), note: (id, item) => noted.push({ id, item }) },
    turnEnds: new Map(),
    log: { info() {} },
  };
  const emit = (tabId, item) => listeners.forEach(fn => fn(tabId, item));
  const settle = () => new Promise(r => setTimeout(r, 60));
  return { d, emit, noted, settle };
}

test('a turn that earns a find gets a rewards card after its result', async () => {
  const { d, emit, noted, settle } = fakeDeps();
  const w = wireTurnRewards(d, { quietMs: 5 });
  w.rewardsBegin('t1');
  w.tapReward('critter:xp', { amount: 20 });
  w.tapReward('life:found', { id: 'c', name: 'Cowrie' });
  emit('t1', { kind: 'result', ok: true });
  w.tapReward('xp:levelup', { level: 4, title: 'Sandstepper' }); // the turn's own XP brought it, after the result
  await settle();
  assert.equal(noted.length, 1);
  assert.equal(noted[0].id, 't1');
  assert.deepEqual(noted[0].item.items.map(e => e.kind), ['find', 'level']);
  assert.equal(noted[0].item.xp, 20);
});

test('the card waits for the turn\'s changes card, so it lands last', async () => {
  const { d, emit, noted, settle } = fakeDeps();
  let release;
  d.turnEnds.set('t1', new Promise(r => { release = r; }));
  const w = wireTurnRewards(d, { quietMs: 5 });
  w.rewardsBegin('t1');
  w.tapReward('stickers:new', { id: 'p', name: 'shellby' });
  emit('t1', { kind: 'result', ok: true });
  await settle();
  assert.equal(noted.length, 0);
  release();
  await settle();
  assert.equal(noted.length, 1);
});

test('turned off in Settings, no card is written', async () => {
  const { d, emit, noted, settle } = fakeDeps({ rewardCards: false });
  const w = wireTurnRewards(d, { quietMs: 5 });
  w.rewardsBegin('t1');
  w.tapReward('life:found', { id: 'c', name: 'Cowrie' });
  emit('t1', { kind: 'result', ok: true });
  await settle();
  assert.equal(noted.length, 0);
});

test('a tab closed mid-turn drops what it gathered', async () => {
  const { d, emit, noted, settle } = fakeDeps();
  const w = wireTurnRewards(d, { quietMs: 5 });
  w.rewardsBegin('t1');
  w.tapReward('life:found', { id: 'c', name: 'Cowrie' });
  w.rewardsForget('t1');
  emit('t1', { kind: 'result', ok: true });
  await settle();
  assert.equal(noted.length, 0);
});

test('a payout that comes after the turn\'s checks still makes its card', async () => {
  const { d, emit, noted } = fakeDeps();
  const w = wireTurnRewards(d, { quietMs: 30 });
  w.rewardsBegin('t1');
  w.tapReward('life:found', { id: 'c', name: 'Cowrie' });
  emit('t1', { kind: 'result', ok: true });
  await new Promise(r => setTimeout(r, 10));
  w.tapReward('wardrobe:unlocked', { achievement: { id: 'crit', name: 'Critical Hit' }, rewards: [] }); // a crit on the checks' green
  await new Promise(r => setTimeout(r, 120));
  assert.equal(noted.length, 1);
  assert.deepEqual(noted[0].item.items.map(e => e.kind), ['find', 'trophy']);
});
