const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStillGate, isMoving, RETRY_MS, MAX_HOLD_MS } = require('../src/main/desktop/still');
const { Config } = require('../src/main/config');
const { ToolboxWatcher } = require('../src/main/toolbox');

// A clock and timers the test moves by hand.
function fakeTime() {
  let t = 1000;
  const timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const h = { fn, at: t + ms }; timers.push(h); return h; },
    clearTimer: h => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = timers.filter(h => h.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers.splice(timers.indexOf(due), 1);
        t = due.at;
        due.fn();
      }
      t = end;
    },
  };
}

function gate(state, time = fakeTime(), extra = {}) {
  return { time, g: createStillGate({ moving: () => state.moving, now: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer, ...extra }) };
}

test('standing still, work runs straight away', () => {
  const { g } = gate({ moving: false });
  let ran = 0;
  assert.equal(g.when('save', () => ran++), true);
  assert.equal(ran, 1);
  assert.equal(g.pending(), 0);
});

test('mid-walk, work waits until he stops, then runs once however often it was asked for', () => {
  const state = { moving: true };
  const { g, time } = gate(state);
  const runs = [];
  g.when('save', () => runs.push('first'));
  g.when('save', () => runs.push('second'));
  g.when('save', () => runs.push('third'));
  time.advance(RETRY_MS * 3);
  assert.deepEqual(runs, [], 'nothing while he walks');
  state.moving = false;
  time.advance(RETRY_MS);
  assert.deepEqual(runs, ['third'], 'the latest one, once');
  assert.equal(g.pending(), 0);
});

test('different jobs held together each run when he stops', () => {
  const state = { moving: true };
  const { g, time } = gate(state);
  const runs = [];
  g.when('save', () => runs.push('save'));
  g.when('scan', () => runs.push('scan'));
  state.moving = false;
  time.advance(RETRY_MS);
  assert.deepEqual(runs.sort(), ['save', 'scan']);
});

test('a long climb holds work for MAX_HOLD_MS at most, counted from the first ask', () => {
  const state = { moving: true };
  const { g, time } = gate(state);
  let ran = 0;
  g.when('save', () => ran++);
  time.advance(MAX_HOLD_MS - RETRY_MS);
  g.when('save', () => ran++); // asked again late: the wait doesn't start over
  time.advance(RETRY_MS - 1);
  assert.equal(ran, 0);
  time.advance(RETRY_MS);
  assert.equal(ran, 1, 'ran though he is still climbing');
});

test('stopping and asking again runs at once, and drops the held copy', () => {
  const state = { moving: true };
  const { g, time } = gate(state);
  let ran = 0;
  g.when('save', () => ran++);
  state.moving = false;
  g.when('save', () => ran++);
  assert.equal(ran, 1);
  time.advance(RETRY_MS * 4);
  assert.equal(ran, 1, 'the held one never runs as well');
});

test('flush runs everything held, moving or not (quitting)', () => {
  const state = { moving: true };
  const { g } = gate(state);
  const runs = [];
  g.when('save', () => runs.push('save'));
  g.when('scan', () => runs.push('scan'));
  g.flush();
  assert.deepEqual(runs.sort(), ['save', 'scan']);
  assert.equal(g.pending(), 0);
});

test('a held job that throws is reported, and the others still run', () => {
  const state = { moving: true };
  const errors = [];
  const { g, time } = gate(state, fakeTime(), { onError: (key, err) => errors.push(`${key}: ${err.message}`) });
  let ran = 0;
  g.when('save', () => { throw new Error('disk full'); });
  g.when('scan', () => ran++);
  state.moving = false;
  time.advance(RETRY_MS);
  assert.deepEqual(errors, ['save: disk full']);
  assert.equal(ran, 1);
});

test('a moving() that throws counts as still, so nothing is held for good', () => {
  const g = createStillGate({ moving: () => { throw new Error('no window'); } });
  let ran = 0;
  g.when('save', () => ran++);
  assert.equal(ran, 1);
});

test('moving: flights, hops, strolls, climbs and drags, but not a perched ride', () => {
  assert.equal(isMoving(null), false);
  assert.equal(isMoving({ busy: false, kind: null }), false);
  for (const kind of ['flight', 'hop', 'stroll']) assert.equal(isMoving({ busy: true, kind }), true, kind);
  assert.equal(isMoving({ busy: true, kind: 'ride' }), false, 'up on a window, mostly sitting');
  assert.equal(isMoving({ busy: true, kind: 'ride' }, { climbing: true }), true, 'a climb is a ride too');
  assert.equal(isMoving(null, { dragging: true }), true);
});

test('settings set mid-walk are saved once he stops, with every change made meanwhile', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-still-'));
  const state = { moving: false };
  const { g, time } = gate(state);
  const c = new Config(dir, { whenStill: g.when });
  const file = path.join(dir, 'settings.json');
  const saved = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  c.set({ voice: { seed: 1 } });
  assert.deepEqual(saved().voice, { seed: 1 }, 'still: saved at once, as before');
  state.moving = true;
  c.set({ voice: { seed: 2 } });
  c.set({ bond: { level: 3 } });
  assert.deepEqual(saved().voice, { seed: 1 }, 'not mid-stride');
  assert.deepEqual(c.get('voice'), { seed: 2 }, 'though the change is there to read');
  state.moving = false;
  time.advance(RETRY_MS);
  assert.deepEqual(saved().voice, { seed: 2 });
  assert.deepEqual(saved().bond, { level: 3 });
});

test('a Toolbox poll that comes due mid-walk scans once he stops', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-still-home-'));
  const state = { moving: true };
  const { g, time } = gate(state);
  const w = new ToolboxWatcher({ home, pollMs: 20, debounceMs: 0, whenStill: g.when });
  let scans = 0;
  const refresh = w.refresh.bind(w);
  w.refresh = initial => { scans++; return refresh(initial); };
  w.start();
  try {
    assert.equal(scans, 1, 'the first look at start');
    await new Promise(r => setTimeout(r, 70));
    assert.equal(scans, 1, 'polls held while he walks');
    assert.equal(g.pending(), 1, 'as one job');
    state.moving = false;
    time.advance(RETRY_MS);
    assert.equal(scans, 2);
  } finally {
    w.stop();
  }
});
