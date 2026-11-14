// One conversation on another PC, open on the hub (hub/convo.js): its tail,
// then each step, with the reply as it's typed, all rebuilt from what the PC
// sent and nothing more. Another PC is a fake fetch here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConvoLink, cleanItem, MAX_ITEMS } = require('../src/main/hub/convo');

const enc = new TextEncoder();
const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function fakeTimers() {
  const timers = [];
  return {
    timers,
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  };
}

/** A PC whose events stream sends these chunks, then holds the line open. */
function pcSending(chunks, seen = []) {
  return async (url, init) => {
    seen.push({ url, init });
    return { status: 200, ok: true, body: (async function* gen() { for (const c of chunks) yield enc.encode(c); await new Promise(() => {}); })() };
  };
}

const settle = () => new Promise(r => setTimeout(r, 20));

test("the conversation's tail arrives, then each step, with the reply as it's typed", async () => {
  const seen = [];
  const link = new ConvoLink({
    origin: 'https://laptop.t.ts.net', tabId: 'tab-1', token: () => 'T'.repeat(30), ...fakeTimers(),
    fetch: pcSending([
      sse('view', { pc: 'laptop' }),
      sse('items', { tabId: 'tab-1', items: [{ k: 'user', text: 'Fix the test' }, { k: 'tool', name: 'Read', label: 'Read a file', detail: 'a.js' }] }),
      sse('item', { tabId: 'tab-1', item: { k: 'partial', text: 'Looking' } }),
      sse('item', { tabId: 'tab-1', item: { k: 'partial', text: 'Looking at it' } }),
    ], seen),
  });
  link.start();
  await settle();
  const s = link.snapshot();
  assert.equal(s.state, 'online');
  assert.equal(s.loaded, true);
  assert.deepEqual(s.items.map(i => i.k), ['user', 'tool']);
  assert.equal(s.typing, 'Looking at it', 'the reply so far, replaced each time, never a pile of partials');
  assert.equal(seen[0].url, 'https://laptop.t.ts.net/pocket/v1/events?tab=tab-1');
  assert.equal(seen[0].init.headers.Authorization, `Bearer ${'T'.repeat(30)}`);
  assert.equal(seen[0].init.redirect, 'error');
  link.onEvent({ event: 'item', data: JSON.stringify({ tabId: 'tab-1', item: { k: 'text', text: 'Fixed.' } }) });
  assert.equal(link.typing, '', 'the whole text replaces what was being typed');
  assert.equal(link.items.at(-1).text, 'Fixed.');
  link.stop();
});

test("another conversation's steps, and anything that isn't one, are ignored", () => {
  const link = new ConvoLink({ origin: 'https://x.t.ts.net', tabId: 'mine', token: () => 'T'.repeat(30), ...fakeTimers() });
  assert.equal(link.onEvent({ event: 'item', data: JSON.stringify({ tabId: 'other', item: { k: 'text', text: 'not yours' } }) }), false);
  assert.equal(link.onEvent({ event: 'item', data: '{not json' }), false);
  assert.equal(link.onEvent({ event: 'item', data: JSON.stringify({ tabId: 'mine', item: { k: 'script', text: '<b>' } }) }), false);
  assert.equal(link.onEvent({ event: 'items', data: JSON.stringify({ tabId: 'mine', items: 'lots' }) }), true);
  assert.deepEqual(link.items, []);
});

test('a step is rebuilt from the fields the hub draws, cut short, and junk is dropped', () => {
  assert.deepEqual(cleanItem({ k: 'user', text: 'x'.repeat(9000), evil: 1 }), { k: 'user', text: 'x'.repeat(4000) });
  assert.deepEqual(cleanItem({ k: 'tool', name: 'Bash', label: 'Ran', detail: 7, agent: { description: 'a helper' }, sub: 'yes' }), { k: 'tool', name: 'Bash', label: 'Ran', detail: '', sub: false, agent: 'a helper' });
  assert.equal(cleanItem({ k: 'done', error: false }), null, 'a step that went fine draws nothing');
  assert.deepEqual(cleanItem({ k: 'changes', files: new Array(5).fill({}), more: 2, added: 'many' }), { k: 'changes', added: 0, removed: 0, files: 7 });
  for (const junk of [null, 3, 'text', [], { k: '__proto__' }, { k: 'view' }]) assert.equal(cleanItem(junk), null);
});

test('a long conversation keeps only its latest steps', () => {
  const link = new ConvoLink({ origin: 'https://x.t.ts.net', tabId: 'a', token: () => 'T'.repeat(30), ...fakeTimers() });
  link.onEvent({ event: 'items', data: JSON.stringify({ tabId: 'a', items: Array.from({ length: MAX_ITEMS }, (_, i) => ({ k: 'note', text: `n${i}` })) }) });
  link.onEvent({ event: 'item', data: JSON.stringify({ tabId: 'a', item: { k: 'note', text: 'newest' } }) });
  assert.equal(link.items.length, MAX_ITEMS);
  assert.equal(link.items[0].text, 'n1');
  assert.equal(link.items.at(-1).text, 'newest');
});

test('a PC that forgot the hub says so and stops; one that drops the line is tried again', async () => {
  const t = fakeTimers();
  const gone = new ConvoLink({ origin: 'https://x.t.ts.net', tabId: 'a', token: () => 'T'.repeat(30), ...t, fetch: async () => ({ status: 401, ok: false }) });
  await gone.connect();
  assert.equal(gone.state, 'unpaired');
  assert.equal(t.timers.length, 0, 'no retry');
  const t2 = fakeTimers();
  const flaky = new ConvoLink({ origin: 'https://x.t.ts.net', tabId: 'a', token: () => 'T'.repeat(30), ...t2, fetch: async () => { throw new TypeError('fetch failed'); } });
  await flaky.connect();
  assert.equal(flaky.state, 'offline');
  assert.ok(t2.timers.some(x => x.ms === 3000), 'tried again in a few seconds');
  flaky.stop();
  assert.equal(t2.timers.length, 0, 'stopping it cancels the retry');
});

test('a conversation id that could change the address is refused', () => {
  assert.throws(() => new ConvoLink({ origin: 'https://x.t.ts.net', tabId: 'a&tab=b', token: () => 't' }));
  assert.throws(() => new ConvoLink({ origin: 'https://x.t.ts.net', tabId: '../x', token: () => 't' }));
});

test('each change bumps the version; the steps have their own, which the reply being typed leaves alone', () => {
  const link = new ConvoLink({ origin: 'https://x.t.ts.net', tabId: 'a', token: () => 'T'.repeat(30), ...fakeTimers() });
  link.onEvent({ event: 'items', data: JSON.stringify({ tabId: 'a', items: [] }) });
  const { itemsAt } = link.snapshot();
  link.onEvent({ event: 'item', data: JSON.stringify({ tabId: 'a', item: { k: 'partial', text: 'Lo' } }) });
  assert.equal(link.snapshot().itemsAt, itemsAt, 'typing is not a new step');
  link.onEvent({ event: 'item', data: JSON.stringify({ tabId: 'a', item: { k: 'note', text: 'n' } }) });
  assert.equal(link.snapshot().itemsAt, itemsAt + 1);
});

test('a stopped conversation says nothing more', async () => {
  let release;
  const link = new ConvoLink({ origin: 'https://x.t.ts.net', tabId: 'a', token: () => 'T'.repeat(30), ...fakeTimers(),
    fetch: async () => ({ status: 200, ok: true, body: (async function* gen() { await new Promise(r => { release = r; }); yield* []; })() }) });
  link.start();
  await settle();
  let changes = 0;
  link.on('change', () => changes++);
  link.stop();
  release();
  await settle();
  assert.equal(changes, 0);
});
