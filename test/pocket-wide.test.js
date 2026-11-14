// Shellby on your phone on a wide screen (pocket-wide.js): the script
// decides when the beach and a conversation sit side by side, and pocket.css
// lays them out at its own width. The two widths have to be the same, or a
// window between them gets the two-pane markup with the phone's layout (or
// the other way round).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const POCKET = path.join(__dirname, '..', 'src', 'renderer', 'pocket');
const read = name => fs.readFileSync(path.join(POCKET, name), 'utf8');

test('the script and the stylesheet split the screen at the same width', () => {
  const js = read('pocket-wide.js').match(/const WIDE = window\.matchMedia\?\.\('\(min-width: (\d+)px\)'\)/);
  assert.ok(js, 'pocket-wide.js names its wide width in WIDE');
  const css = read('pocket.css');
  const block = css.indexOf('.wide {');
  assert.ok(block > 0, 'pocket.css lays out .wide');
  const media = [...css.slice(0, block).matchAll(/@media \(min-width: (\d+)px\)/g)].pop();
  assert.ok(media, '.wide sits inside a min-width block');
  assert.equal(media[1], js[1]);
});

test('the open conversation is marked in the list, for a screen reader too', () => {
  const js = read('pocket.js');
  assert.match(js, /tab-card s-\$\{t\.standing\}\$\{open \? ' sel' : ''\}/);
  assert.match(js, /'aria-current': open \? 'true' : null/);
});

// Which agent runs a conversation (pocket-logic.js agentOf, mixedAgents).
const L = require('../src/renderer/pocket/pocket-logic');

test('each agent the PC can run has its own name', () => {
  assert.deepEqual(L.agentOf('codex'), { key: 'codex', label: 'Codex' });
  assert.deepEqual(L.agentOf('gemini'), { key: 'gemini', label: 'Gemini' });
  assert.deepEqual(L.agentOf('opencode'), { key: 'opencode', label: 'OpenCode' });
  assert.deepEqual(L.agentOf('claude'), { key: 'claude', label: 'Claude' });
});

test('an unknown or missing agent reads as Claude, and never becomes a class name', () => {
  for (const odd of [undefined, null, '', 'aider', 'x" onclick="y', 'constructor', 'toString', 42]) {
    assert.deepEqual(L.agentOf(odd), { key: 'claude', label: 'Claude' });
  }
});

test('agents are marked only once a conversation runs on another one', () => {
  assert.equal(L.mixedAgents(null), false);
  assert.equal(L.mixedAgents({ tabs: [] }), false);
  assert.equal(L.mixedAgents({ tabs: [{ harness: 'claude' }, { harness: 'claude' }] }), false);
  assert.equal(L.mixedAgents({ tabs: [{ harness: 'claude' }, { harness: 'unknown' }] }), false);
  assert.equal(L.mixedAgents({ tabs: [{ harness: 'claude' }, { harness: 'gemini' }] }), true);
});

// The PC switcher (pocket/view.js phonePcs): the hub's other PCs, as links to each one's own page.
const { phonePcs, phoneView } = require('../src/main/pocket/view');

test('the switcher gets each PC as a name and its tailnet address, never its token', () => {
  const pcs = phonePcs([{ id: 'p-0123456789ab', name: 'LAPTOP', origin: 'https://laptop.tail3f2c.ts.net', token: 'sealed-secret', pairedAt: 1 }]);
  assert.deepEqual(pcs, [{ name: 'LAPTOP', url: 'https://laptop.tail3f2c.ts.net' }]);
  assert.doesNotMatch(JSON.stringify(phoneView({ pcs: [{ name: 'LAPTOP', origin: 'https://laptop.tail3f2c.ts.net', token: 'sealed-secret' }] })), /sealed-secret/);
});

test('only an https address on your tailnet becomes a link', () => {
  const pcs = phonePcs([
    { name: 'lan', origin: 'http://192.168.1.5' },
    { name: 'web', origin: 'https://example.com' },
    { name: 'js', origin: 'javascript:alert(1)' },
    { name: 'login', origin: 'https://me:pw@desk.tail3f2c.ts.net' },
    { name: 'MEDIA-PC', origin: 'https://media-pc.tail3f2c.ts.net:8443/some/path?x=1' },
  ]);
  assert.deepEqual(pcs, [{ name: 'MEDIA-PC', url: 'https://media-pc.tail3f2c.ts.net:8443' }]);
});

test('a PC listed twice shows once, a missing name falls back to its machine name, and odd input is an empty list', () => {
  assert.deepEqual(phonePcs([{ origin: 'https://laptop.tail3f2c.ts.net' }, { name: 'again', origin: 'https://laptop.tail3f2c.ts.net/' }]), [{ name: 'laptop', url: 'https://laptop.tail3f2c.ts.net' }]);
  for (const odd of [null, undefined, 'x', {}, [null, 3, 'y']]) assert.deepEqual(phonePcs(odd), []);
  assert.deepEqual(phoneView({}).pcs, []);
});
