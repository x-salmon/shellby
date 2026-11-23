// The panel's shared helpers (src/renderer/panel/core.js): plural, the stored
// preferences, the menu item, and the toast (toast.js, which loads after it).
// They're browser scripts, so they run here in a vm with just enough of a page
// to load: elements that record what they're given, and nothing that draws.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const panelSrc = name => fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'panel', name), 'utf8');
const CORE = panelSrc('core.js');
const TOAST = panelSrc('toast.js');

function classSet() {
  const on = new Set();
  return {
    toggle(c, force = !on.has(c)) { if (force) on.add(c); else on.delete(c); return force; },
    contains: c => on.has(c), add: c => on.add(c), remove: c => on.delete(c),
  };
}

function element(tag) {
  return {
    nodeType: 1, tagName: String(tag).toUpperCase(), children: [], attrs: {}, listeners: {}, dataset: {}, style: { setProperty() {} },
    classList: classSet(),
    append(...kids) { for (const k of kids) if (k && typeof k === 'object') k.parentNode = this; this.children.push(...kids); },
    replaceChildren(...kids) { for (const k of kids) if (k && typeof k === 'object') k.parentNode = this; this.children = kids; },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    hasAttribute(k) { return k in this.attrs; },
    closest: () => null,
    contains(el) { return el === this || this.children.some(c => c === el || c.contains?.(el)); },
    focus() {},
  };
}

function loadCore({ storage, search = '' } = {}) {
  const byId = new Map();
  const docListeners = {};
  const body = element('body');
  const classes = new Set();
  body.classList = { toggle() {}, contains: c => classes.has(c), add: c => classes.add(c), remove: c => classes.delete(c) };
  const document = {
    listeners: docListeners,
    body,
    scrollingElement: {},
    activeElement: null,
    createElement: element,
    createElementNS: (_ns, tag) => element(tag),
    createTextNode: text => ({ nodeType: 3, text }),
    getElementById: id => { if (!byId.has(id)) byId.set(id, element('div')); return byId.get(id); },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(type, fn) { docListeners[type] = fn; },
  };
  const window = { shellby: {}, addEventListener() {}, localStorage: storage, innerWidth: 400, innerHeight: 600 };
  // The timers and clock as they are now, so a test's mock.timers reach in here too.
  // The page's address: a popped-out conversation's window says which tab it shows (?popout=).
  const context = vm.createContext({
    window, document, location: { search }, URLSearchParams,
    // The tooltips watch for titles set again (core.js tooltips); nothing here changes one.
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, Date: globalThis.Date,
  });
  vm.runInContext(CORE, context, { filename: 'core.js' });
  vm.runInContext(TOAST, context, { filename: 'toast.js' });
  return { SB: window.SB, document };
}

function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('plural says one or many, with "s" unless told the plural', () => {
  const { SB } = loadCore();
  assert.equal(SB.plural(1, 'file'), '1 file');
  assert.equal(SB.plural(0, 'file'), '0 files');
  assert.equal(SB.plural(3, 'file'), '3 files');
  assert.equal(SB.plural(2, 'copy', 'copies'), '2 copies');
  assert.equal(SB.plural(1, 'copy', 'copies'), '1 copy');
});

test('plural writes the number through format when given one', () => {
  const { SB } = loadCore();
  const comma = n => n.toLocaleString('en-US');
  assert.equal(SB.plural(12000, 'castle', undefined, comma), '12,000 castles');
  assert.equal(SB.plural(1, 'castle', undefined, comma), '1 castle');
  assert.equal(SB.plural(2, 'trophy', 'trophies', n => `#${n}`), '#2 trophies');
});

test('pref reads back what was set, and the fallback when there is nothing', () => {
  const { SB } = loadCore({ storage: memoryStorage() });
  assert.equal(SB.pref('shellby.test', 'map'), 'map');
  assert.equal(SB.pref('shellby.test'), null);
  SB.pref.set('shellby.test', 'list');
  assert.equal(SB.pref('shellby.test', 'map'), 'list');
  SB.pref.set('shellby.n', 3600000);
  assert.equal(SB.pref('shellby.n'), '3600000');
  SB.pref.set('shellby.test', '');
  assert.equal(SB.pref('shellby.test', 'map'), 'map', 'an empty value reads as none');
});

test('pref never throws when storage refuses', () => {
  const refusing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const { SB } = loadCore({ storage: refusing });
  assert.equal(SB.pref('shellby.test', 'on'), 'on');
  assert.doesNotThrow(() => SB.pref.set('shellby.test', 'off'));
});

test('menuItem takes (title, onPick) and (title, sub, onPick, options)', () => {
  const { SB } = loadCore();
  const plain = SB.menuItem('Project page', () => {});
  assert.equal(plain.tagName, 'BUTTON');
  assert.equal(plain.attrs.role, 'menuitem');
  assert.equal(plain.className, 'menu-item');
  assert.equal(plain.children.length, 1, 'no check column unless a glyph is given');

  const full = SB.menuItem('Delete', 'Gone for good', () => {}, { tone: 'danger', glyph: '', disabled: true });
  assert.equal(full.className, 'menu-item danger');
  assert.equal(full.attrs.disabled, '');
  assert.equal(full.children.length, 2);
  assert.equal(full.children[0].className, 'mi-check');
  const [title, sub] = full.children[1].children;
  assert.equal(title.textContent, 'Delete');
  assert.equal(sub.textContent, 'Gone for good');
});

// ------------------------------------------------------------------ toasts

// The slot holds the crab, the tail and the bubble; the bubble holds the words
// first, then the buttons (in .toast-acts), the ✕, the water and the next line.
const part = (t, name) => t.children.find(c => c.className === name);
const bubble = t => part(t, 'toast-bubble');
const toastText = t => bubble(t)?.children[0]?.textContent ?? '';
const toastButtons = t => (bubble(t) && part(bubble(t), 'toast-acts')?.children) || [];

function withClock(fn) {
  return t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const { SB, document } = loadCore();
    fn({ SB, document, slot: SB.$('toast'), tick: ms => t.mock.timers.tick(ms) });
  };
}

test('a plain toast replaces a plain toast', withClock(({ SB, slot }) => {
  SB.toast('Pushing…', { ms: 30000 });
  SB.toast('Pushed 2 commits.');
  assert.equal(toastText(slot), 'Pushed 2 commits.');
}));

test('a toast with a button keeps its slot when another one comes in', withClock(({ SB, slot }) => {
  SB.toast('It clashes with main.', { ms: 12000, action: 'Ask him to sort it out', onAction() {} });
  SB.toast('New to the Bugdex: Off-by-one', { action: 'Bugdex', ms: 4500, onAction() {} });
  assert.equal(toastText(slot), 'It clashes with main.');
  assert.equal(toastButtons(slot)[0].children[0].text, 'Ask him to sort it out');
}));

test('the one that waited shows once the button toast goes', withClock(({ SB, slot, tick }) => {
  SB.toast('It clashes with main.', { ms: 1000, action: 'Ask him to sort it out', onAction() {} });
  SB.toast('Tabs a and b both changed it.', { ms: 5000 });
  tick(1000 + 2500);
  assert.equal(toastText(slot), 'Tabs a and b both changed it.');
  tick(5000);
  assert.equal(slot.children.length, 0);
}));

test('a waiting toast that has gone stale is dropped', withClock(({ SB, slot, tick }) => {
  SB.toast('It clashes with main.', { ms: 20000, action: 'Ask him to sort it out', onAction() {} });
  SB.toast('Copied.', { ms: 1000 });
  tick(20000 + 2500);
  assert.equal(slot.children.length, 0);
}));

test('the toast stays while the pointer is on it, and lingers a moment after', withClock(({ SB, slot, tick }) => {
  SB.toast('It clashes with main.', { ms: 1000, action: 'Ask him to sort it out', onAction() {} });
  slot.listeners.pointerenter();
  tick(60000);
  assert.equal(toastText(slot), 'It clashes with main.');
  slot.listeners.pointerleave();
  tick(2999);
  assert.equal(toastText(slot), 'It clashes with main.');
  tick(1);
  assert.equal(slot.children.length, 0);
}));

test('clicking the button runs it, and what it says comes before what waited', withClock(({ SB, slot }) => {
  let asked = 0;
  SB.toast('It clashes with main.', { ms: 12000, action: 'Ask him to sort it out', onAction() { asked++; SB.toast('Sent.'); } });
  SB.toast('Tabs a and b both changed it.', { ms: 5000 });
  toastButtons(slot)[0].listeners.click();
  assert.equal(asked, 1);
  assert.equal(toastText(slot), 'Sent.');
}));

test('clicking elsewhere lets your own next toast through', withClock(({ SB, document, slot }) => {
  SB.toast('It clashes with main.', { ms: 12000, action: 'Ask him to sort it out', onAction() {} });
  document.listeners.pointerdown({ target: SB.h('button') });
  SB.toast('Copied.');
  assert.equal(toastText(slot), 'Copied.');
}));

const toastClose = t => part(bubble(t), 'toast-close');

test('every toast has a ✕ that clears it and whatever waited behind it', withClock(({ SB, slot, tick }) => {
  SB.toast('Copied.');
  toastClose(slot).listeners.click();
  assert.equal(slot.children.length, 0);

  let asked = 0;
  SB.toast('It clashes with main.', { ms: 12000, action: 'Ask him to sort it out', onAction() { asked++; } });
  SB.toast('Tabs a and b both changed it.', { ms: 5000 });
  toastClose(slot).listeners.click();
  assert.equal(asked, 0, 'dismissing is not the button');
  assert.equal(slot.children.length, 0);
  tick(60000);
  assert.equal(slot.children.length, 0, 'the one that waited is gone too');

  SB.toast('Copied.');
  assert.equal(toastText(slot), 'Copied.', 'the next toast shows straight away');
}));

test('Shellby says it: the crab, a tail pointing at him, then the bubble', withClock(({ SB, slot }) => {
  SB.toast('Update 0.101.0 is ready.', { action: 'Restart and update', onAction() {} });
  assert.deepEqual(slot.children.map(c => c.className), ['toast-who', 'toast-tail', 'toast-bubble']);
  assert.equal(part(slot, 'toast-who').attrs['aria-hidden'], 'true', 'the status region reads only the words');
  assert.equal(part(slot, 'toast-tail').attrs['aria-hidden'], 'true');
  assert.deepEqual(bubble(slot).children.map(c => c.className),
    [undefined, 'toast-acts', 'toast-close', 'toast-water'], 'words first, then the buttons, the ✕ and the water');
}));

test('a toast with nothing to press has no row for buttons', withClock(({ SB, slot }) => {
  SB.toast('Sentry is connected.');
  assert.equal(part(bubble(slot), 'toast-acts'), undefined);
  assert.equal(toastButtons(slot).length, 0);
}));

test('a toast with no box on screen leaves where it sits to the stylesheet', withClock(({ SB, slot }) => {
  const set = {};
  slot.style.setProperty = (k, v) => { set[k] = v; };
  SB.toast('Copied.');
  assert.equal(set['--toast-bottom'], '', 'above the dock, by panel.css');
  assert.equal(set['--toast-left'], '');
}));

test('Escape on a toast dismisses it', withClock(({ SB, slot }) => {
  SB.toast('It clashes with main.', { ms: 12000, action: 'Ask him to sort it out', onAction() {} });
  let stopped = false;
  slot.listeners.keydown({ key: 'Escape', stopPropagation() { stopped = true; } });
  assert.equal(slot.children.length, 0);
  assert.ok(stopped, "Escape doesn't also close whatever is behind it");
}));

// ------------------------------------------------------------------ the stack

// The fake elements keep no textContent for mixed children: put it together.
const words = n => n.text ?? n.textContent ?? n.children.map(words).join('');
const toastNext = t => bubble(t) && part(bubble(t), 'toast-next');
const toastNextLine = t => { const n = toastNext(t); return n && { textContent: words(n) }; };
const ask = (SB, msg, ms = 12000) => SB.toast(msg, { ms, action: 'Allow', onAction() {} });

test('a toast with nothing behind it has no stack', withClock(({ SB, slot }) => {
  ask(SB, 'Run npm run e2e:ci?');
  assert.equal(slot.dataset.waiting, undefined);
  assert.equal(toastNextLine(slot), undefined);
}));

test('what waits behind a button toast is counted on the crab and named', withClock(({ SB, slot }) => {
  ask(SB, 'Run npm run e2e:ci?');
  SB.toast('rack-builder finished its task.', { ms: 5000 });
  assert.equal(slot.dataset.waiting, '1');
  assert.equal(part(slot, 'toast-who').dataset.waiting, '1', 'the count he carries');
  assert.equal(toastText(slot), 'Run npm run e2e:ci?', 'the front one stays first');
  assert.equal(toastNextLine(slot).textContent, 'Next: rack-builder finished its task.');
}));

test('the crab counts every one waiting, and one line names the next', withClock(({ SB, slot }) => {
  ask(SB, 'Run npm run e2e:ci?');
  SB.toast('Tests passed.', { ms: 5000 });
  SB.toast('Pushed 2 commits.', { ms: 5000 });
  SB.toast('Routine finished.', { ms: 5000 });
  assert.equal(slot.dataset.waiting, '3');
  assert.equal(part(slot, 'toast-who').dataset.waiting, '3');
  assert.equal(toastNextLine(slot).textContent, 'Next: Tests passed. and 2 more');
  assert.equal(bubble(slot).children.filter(c => c.className === 'toast-next').length, 1, 'one line, however many come in');
}));

test('the next line names a waiting toast by its title when it has one', withClock(({ SB, slot }) => {
  ask(SB, 'Run npm run e2e:ci?');
  SB.toast('Two tabs changed it.', { title: 'It clashes with main', ms: 5000 });
  assert.equal(toastNextLine(slot).textContent, 'Next: It clashes with main');
}));

test('a waiting toast leaves the stack when it goes stale, not later', withClock(({ SB, slot, tick }) => {
  ask(SB, 'Run npm run e2e:ci?', 60000);
  SB.toast('Copied.', { ms: 1000, staleMs: 1000 });
  tick(1999);
  assert.equal(slot.dataset.waiting, '1');
  tick(1);
  assert.equal(slot.dataset.waiting, undefined);
  assert.equal(toastNextLine(slot), undefined);
  assert.equal(toastText(slot), 'Run npm run e2e:ci?');
}));

test('answering the front one brings the next forward and shrinks the stack', withClock(({ SB, slot }) => {
  ask(SB, 'Run npm run e2e:ci?');
  ask(SB, 'Edit src/main/toast.js?');
  SB.toast('Tests passed.', { ms: 5000 });
  toastButtons(slot)[0].listeners.click();
  assert.equal(toastText(slot), 'Edit src/main/toast.js?');
  assert.ok(slot.classList.contains('promoted'));
  assert.equal(slot.dataset.waiting, '1');
  assert.equal(toastNextLine(slot).textContent, 'Next: Tests passed.');
  toastClose(slot).listeners.click();
  SB.toast('Copied.');
  assert.ok(!slot.classList.contains('promoted'), 'only the one that came out of the stack slides');
}));

test('more coming in leaves the toast itself alone, so a focused button keeps focus', withClock(({ SB, slot, tick }) => {
  ask(SB, 'Run npm run e2e:ci?', 60000);
  const [button] = toastButtons(slot);
  let rebuilt = 0;
  const replace = slot.replaceChildren;
  slot.replaceChildren = function (...kids) { rebuilt++; return replace.apply(this, kids); };
  SB.toast('Tests passed.', { ms: 1000, staleMs: 1000 });
  SB.toast('Pushed 2 commits.', { ms: 1000, staleMs: 1000 });
  tick(2000); // both go stale, and the stack is drawn again
  assert.equal(rebuilt, 0);
  assert.equal(toastButtons(slot)[0], button);
  assert.equal(toastNext(slot), undefined);
}));

test('the next line stays out of what the status region reads', withClock(({ SB, slot }) => {
  ask(SB, 'Run npm run e2e:ci?');
  SB.toast('Tests passed.', { ms: 5000 });
  assert.equal(toastNext(slot).attrs['aria-hidden'], 'true');
}));

test('the ✕ takes the whole stack with it', withClock(({ SB, slot }) => {
  ask(SB, 'Run npm run e2e:ci?');
  SB.toast('Tests passed.', { ms: 5000 });
  toastClose(slot).listeners.click();
  assert.equal(slot.children.length, 0);
  assert.equal(slot.dataset.waiting, undefined);
}));

// ------------------------------------------------------------------ jobs

const has = (el, c) => el.classList.contains(c);

test('a job spins while it works, then becomes its result in the same toast', withClock(({ SB, slot }) => {
  const job = SB.toast.job('Pushing the branch and opening a draft…');
  assert.equal(toastText(slot), 'Pushing the branch and opening a draft…');
  assert.ok(has(slot, 'working'));
  assert.ok(!has(slot, 'timed'), 'no time draining while it works');

  let opened = 0;
  job.done('Draft pull request #412 is up.', { ms: 10000, action: 'Open it', onAction() { opened++; } });
  assert.equal(toastText(slot), 'Draft pull request #412 is up.');
  assert.ok(!has(slot, 'working') && has(slot, 'finished'));
  assert.ok(has(slot, 'timed'), 'the result drains');
  toastButtons(slot)[0].listeners.click();
  assert.equal(opened, 1);
}));

test('a failed job turns red in place', withClock(({ SB, slot }) => {
  SB.toast.job('Pushing…').fail("Couldn't push.", { ms: 9000 });
  assert.equal(toastText(slot), "Couldn't push.");
  assert.ok(has(slot, 'danger'));
  assert.ok(!has(slot, 'finished'), 'no tick on a failure');
}));

test('a working job stays however long the pointer rests on it', withClock(({ SB, slot, tick }) => {
  SB.toast.job('Making a branch…', { ms: 180000 });
  slot.listeners.pointerenter();
  assert.ok(has(slot, 'held'));
  slot.listeners.pointerleave();
  tick(10000);
  assert.equal(toastText(slot), 'Making a branch…', 'leaving it is no reason to drop a job still running');
}));

test('a job nobody finishes stops spinning after its time', withClock(({ SB, slot, tick }) => {
  SB.toast.job('Rewinding…', { ms: 15000 });
  tick(15001);
  assert.equal(slot.children.length, 0);
}));

test('when something else takes the slot, the job\'s result still arrives, as a toast of its own', withClock(({ SB, slot }) => {
  const job = SB.toast.job('Pushing…');
  SB.toast('Copied.');
  assert.equal(toastText(slot), 'Copied.', 'a job never holds the slot');
  job.done('Pushed 2 commits.');
  assert.equal(toastText(slot), 'Pushed 2 commits.');
  assert.ok(!has(slot, 'finished'), 'it is not the same toast, so it does not pretend to be');
}));

test('a job dismissed with ✕ still reports how it went', withClock(({ SB, slot }) => {
  const job = SB.toast.job('Pushing…');
  toastClose(slot).listeners.click();
  assert.equal(slot.children.length, 0);
  job.fail("Couldn't push.");
  assert.equal(toastText(slot), "Couldn't push.");
}));

test('under a toast with a button, a job shows only its result, once the button toast goes', withClock(({ SB, slot, tick }) => {
  SB.toast('It clashes with main.', { ms: 12000, action: 'Ask him to sort it out', onAction() {} });
  const job = SB.toast.job('Pushing…', { ms: 30000 });
  tick(2000);
  job.done('Pushed 2 commits.', { ms: 6000 });
  assert.equal(toastText(slot), 'It clashes with main.', 'the button stays under the pointer');
  tick(12500);
  assert.equal(toastText(slot), 'Pushed 2 commits.', 'the result, never a stale "Pushing…"');
}));

test('a job that finishes under the pointer waits for you to move off, then gets its whole time', withClock(({ SB, slot, tick }) => {
  const job = SB.toast.job('Pushing the branch and opening a draft…');
  slot.listeners.pointerenter();
  job.done('Draft pull request #412 is up.', { ms: 10000, action: 'Open it', onAction() {} });
  tick(60000);
  assert.equal(toastText(slot), 'Draft pull request #412 is up.', 'still there while you read it');
  slot.listeners.pointerleave();
  tick(12000);
  assert.equal(toastText(slot), 'Draft pull request #412 is up.', 'its own time and the time to reach the button, not just a moment');
  tick(1000);
  assert.equal(slot.children.length, 0);
}));

test('looking at a working job never stretches its deadline', withClock(({ SB, slot, tick }) => {
  SB.toast.job('Rewinding…', { ms: 15000 });
  for (let i = 0; i < 3; i++) {
    tick(4000);
    slot.listeners.pointerenter();
    slot.listeners.pointerleave();
  }
  tick(3001);
  assert.equal(slot.children.length, 0);
}));

test('a job whose time ran out still reports how it went, without a tick', withClock(({ SB, slot, tick }) => {
  const job = SB.toast.job('Rewinding…', { ms: 15000 });
  tick(15001);
  job.done('Rewound.');
  assert.equal(toastText(slot), 'Rewound.');
  assert.ok(!has(slot, 'finished'));
}));

test('fail with a plain tone is neither red nor ticked: "Not branched."', withClock(({ SB, slot }) => {
  SB.toast.job('Making a branch…').fail('Not branched.', { tone: null });
  assert.equal(toastText(slot), 'Not branched.');
  assert.ok(!has(slot, 'danger') && !has(slot, 'finished'));
}));

test('the time line stops while you hover, and starts again for the moment after', withClock(({ SB, slot, tick }) => {
  SB.toast('Copied.', { ms: 2000 });
  assert.ok(has(slot, 'timed'));
  slot.listeners.pointerenter();
  assert.ok(has(slot, 'held'));
  tick(5000);
  assert.equal(toastText(slot), 'Copied.');
  slot.listeners.pointerleave();
  assert.ok(!has(slot, 'held') && has(slot, 'timed'));
}));

test('picking a menu item runs it', () => {
  const { SB } = loadCore();
  let picked = 0;
  const item = SB.menuItem('Rename', () => { picked++; });
  item.listeners.click();
  assert.equal(picked, 1);
});

test('the panel is the panel; a popped-out window knows its one conversation from its address', () => {
  const panel = loadCore();
  assert.equal(panel.SB.solo, null);
  assert.equal(panel.document.body.classList.contains('solo'), false);
  const popout = loadCore({ search: '?popout=tab-123' });
  assert.equal(popout.SB.solo, 'tab-123');
  assert.equal(popout.document.body.classList.contains('solo'), true);
});
