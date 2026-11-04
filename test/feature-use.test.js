// What you use (src/main/feature-use.js): visits counted per screen, and the
// things done with him per action, on this PC.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/main/feature-use');

const DAY = 86400000;
const T0 = Date.UTC(2026, 9, 8);
const EMPTY = { since: 0, views: {}, uses: {} };

test('a visit counts once, and the first one starts the clock', () => {
  let s = F.record(null, 'projects', T0);
  s = F.record(s, 'projects', T0 + 1000);
  s = F.record(s, 'chat', T0 + 2000);
  assert.deepEqual(s, { since: T0, views: { projects: { n: 2, last: T0 + 1000 }, chat: { n: 1, last: T0 + 2000 } }, uses: {} });
});

test('only known screens count', () => {
  assert.deepEqual(F.record(null, 'settings', T0), EMPTY);
  assert.deepEqual(F.record(null, '__proto__', T0), EMPTY);
  assert.deepEqual(F.record(null, 'onboarding', T0).views, {});
});

test('an action done counts once, and starts the clock if a visit has not', () => {
  let s = F.act(null, 'outfit', T0);
  s = F.act(s, 'outfit', T0 + 1000);
  s = F.act(s, 'find-kept', T0 + 2000);
  assert.deepEqual(s, { since: T0, views: {}, uses: { outfit: { n: 2, last: T0 + 1000 }, 'find-kept': { n: 1, last: T0 + 2000 } } });
});

test('an action nobody listed is ignored, and a screen id is not an action', () => {
  assert.deepEqual(F.act(null, 'petted', T0), EMPTY);
  assert.deepEqual(F.act(null, '__proto__', T0), EMPTY);
  assert.deepEqual(F.act(null, 'chat', T0), EMPTY);
  assert.deepEqual(F.act(null, '', T0), EMPTY);
});

test('the actions: each has a name and a line, and the ids main records are all there', () => {
  const ids = F.ACTIONS.map(a => a.id);
  for (const id of ['outfit', 'find-made', 'find-kept', 'bug-caught', 'battle', 'sticker-placed', 'tank', 'reward-opened']) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length, 'no action twice');
  assert.ok(F.ACTIONS.every(a => a.name && a.text), 'each has a name and a line on what it is');
});

test('a value saved before actions were counted is still good, with no uses', () => {
  const old = { since: T0, views: { chat: { n: 4, last: T0 } } };
  assert.deepEqual(F.normalize(old), { ...old, uses: {} });
  assert.deepEqual(F.act(old, 'tank', T0 + DAY).uses, { tank: { n: 1, last: T0 + DAY } });
  assert.equal(F.act(old, 'tank', T0 + DAY).since, T0, 'the clock started with the first visit');
});

test('stored uses are kept to the actions listed, and cleaned like views', () => {
  const s = F.normalize({ uses: { outfit: { n: 3.7, last: 'x' }, battle: { n: 0 }, petted: { n: 9 }, __proto__: { n: 1 } } });
  assert.deepEqual(s.uses, { outfit: { n: 3, last: 0 } });
});

test('the rooms and the Shellby screen tabs are all counted', () => {
  const ids = F.SCREENS.map(s => s.id);
  for (const id of ['history', 'bugdex', 'tank', 'us', 'shop', 'routines', 'time', 'wardrobe', 'chat']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('beach'), 'the beach is part of Us');
  assert.equal(new Set(ids).size, ids.length, 'no screen twice');
  assert.ok(F.SCREENS.every(s => s.name && s.text), 'each has a name and a line on what it is for');
});

test('a corrupt stored value is cleaned, not trusted', () => {
  const s = F.normalize({ since: 'yesterday', views: { chat: { n: -3 }, tank: { n: 2.9, last: 'x' }, nope: { n: 5 } }, uses: 'none' });
  assert.deepEqual(s, { since: 0, views: { tank: { n: 2, last: 0 } }, uses: {} });
  assert.deepEqual(F.normalize('garbage'), EMPTY);
});

test('report: most used first, quiet after 30 days, and what was never opened', () => {
  let s = null;
  for (let i = 0; i < 5; i++) s = F.record(s, 'chat', T0);
  for (let i = 0; i < 2; i++) s = F.record(s, 'projects', T0 + DAY);
  s = F.record(s, 'tank', T0 - 40 * DAY);
  const r = F.report(s, T0 + 2 * DAY);
  assert.deepEqual(r.used.map(x => [x.id, x.n]), [['chat', 5], ['projects', 2]]);
  assert.deepEqual(r.quiet.map(x => x.id), ['tank']);
  assert.ok(r.never.some(x => x.id === 'us'));
  assert.ok(!r.never.some(x => ['chat', 'projects', 'tank'].includes(x.id)));
  assert.equal(r.since, T0, 'counting began with the first visit recorded');
});

test('report on nothing yet: no date, every screen not opened, every action not done', () => {
  const r = F.report(null, T0);
  assert.equal(r.since, null);
  assert.equal(r.never.length, F.SCREENS.length);
  assert.deepEqual(r.actions.used, []);
  assert.deepEqual(r.actions.quiet, []);
  assert.equal(r.actions.never.length, F.ACTIONS.length);
});

test('report.actions: most done first, quiet after 30 days, never with its line, and screens untouched', () => {
  let s = null;
  for (let i = 0; i < 3; i++) s = F.act(s, 'outfit', T0);
  s = F.act(s, 'tank', T0 + DAY);
  s = F.act(s, 'battle', T0 - 40 * DAY);
  s = F.record(s, 'chat', T0);
  const r = F.report(s, T0 + 2 * DAY);
  assert.deepEqual(r.actions.used.map(x => [x.id, x.n]), [['outfit', 3], ['tank', 1]]);
  assert.deepEqual(r.actions.quiet.map(x => [x.id, x.n, x.last]), [['battle', 1, T0 - 40 * DAY]]);
  const never = r.actions.never.find(x => x.id === 'reward-opened');
  assert.ok(never?.name && never.text, 'a thing never done keeps its name and line');
  assert.ok(!r.actions.never.some(x => ['outfit', 'tank', 'battle'].includes(x.id)));
  assert.deepEqual(r.used.map(x => x.id), ['chat'], 'the screens report only screens');
  assert.ok(!r.never.some(x => x.id === 'outfit'), 'and never lists an action');
});
