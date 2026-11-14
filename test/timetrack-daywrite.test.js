// Writing up a day (src/main/timetrack/daywrite.js), Shellby keeping and
// dropping what it wrote (timetrack/service.js), and the drafts and quarter
// hours on the books (timetrack/index.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const dw = require('../src/main/timetrack/daywrite');
const tt = require('../src/main/timetrack');
const { TimeTracker } = require('../src/main/timetrack/service');

const SHELLBY = 'c:\\users\\me\\code\\shellby';
const BOOKING = 'c:\\users\\me\\code\\booking-app';
const DAY = '2026-11-12';
const at = (h, m = 0) => new Date(2026, 10, 12, h, m).getTime();

const project = (key, name, extra = {}) => ({ key, name, client: '', seconds: 3600, commits: [], chats: [], ...extra });
const reply = lines => JSON.stringify({ type: 'result', is_error: false, structured_output: { lines } });

// ------------------------------------------------------------------ what the model is sent

test('gather gives each project and source a short id, and leaves out projects with nothing to go on', () => {
  const g = dw.gather([
    project(SHELLBY, 'shellby', { commits: [{ id: 'g:1', at: at(9), subject: 'feat: merge queue badge' }], chats: [{ id: 'c:a', title: 'Badge', asks: [{ at: at(9), text: 'add a badge' }] }] }),
    project('c:\\quiet', 'quiet'),
    project(BOOKING, 'booking-app', { client: 'Northwind', commits: [{ id: 'g:2', at: at(15), subject: 'sync to Google Calendar' }] }),
  ]);
  assert.deepEqual(g.projects.map(p => [p.alias, p.name]), [['p1', 'shellby'], ['p2', 'booking-app']]);
  assert.deepEqual(g.projects[0].sources.map(s => [s.alias, s.id, s.kind]), [['g1', 'g:1', 'commit'], ['c1', 'c:a', 'chat']]);
  assert.deepEqual(g.projects[1].sources.map(s => s.alias), ['g2'], 'ids run on across projects, so none repeats');
});

test('input names projects and clients but never a folder, and marks commits and asks with their ids', () => {
  const g = dw.gather([project(BOOKING, 'booking-app', {
    client: 'Northwind Dental',
    commits: [{ id: 'g:2', at: at(15, 2), subject: 'feat: sync bookings' }],
    chats: [{ id: 'c:x', title: 'Calendar sync', asks: [{ at: at(13), text: 'bookings should show up in their calendar' }] }],
  })]);
  const text = dw.input(DAY, g);
  assert.match(text, /## p1: booking-app \(for Northwind Dental\), 1h 00m/);
  assert.match(text, /\[g1\] 15:02 feat: sync bookings/);
  assert.match(text, /\[c1\] "Calendar sync": bookings should show up/);
  assert.match(text, /Thursday, November 12, 2026/);
  assert.doesNotMatch(text, /c:\\users|booking-app\\/i, 'no paths leave the PC');
});

test('input stops adding projects once it is full', () => {
  const many = Array.from({ length: 12 }, (_, i) => project(`c:\\p${i}`, `p${i}`, { commits: Array.from({ length: 25 }, (_, j) => ({ id: `g:${i}-${j}`, at: at(9), subject: 'x'.repeat(150) })) }));
  assert.ok(dw.input(DAY, dw.gather(many)).length <= dw.MAX_INPUT + 200);
});

// ------------------------------------------------------------------ what comes back

test('parse maps ids back, keeps each sentence to its own project, and drops what it was not asked', () => {
  const g = dw.gather([
    project(SHELLBY, 'shellby', { commits: [{ id: 'g:1', at: at(9), subject: 'badge' }] }),
    project(BOOKING, 'booking-app', { commits: [{ id: 'g:2', at: at(15), subject: 'sync' }] }),
  ]);
  const r = dw.parse(reply([
    { project: 'p1', sentences: [{ text: 'Added a badge to the merge queue tab.', sources: ['g1', 'g2', 'g9'] }] },
    { project: 'p1', sentences: [{ text: 'A second go at the same project.', sources: [] }] },
    { project: 'p7', sentences: [{ text: 'A project nobody asked about.', sources: [] }] },
    { project: 'p2', sentences: [{ text: 'Bookings reach the calendar.', sources: ['g2'] }] },
  ]), g);
  assert.equal(r.ok, true);
  assert.deepEqual(r.lines, [
    { key: SHELLBY, sentences: [{ text: 'Added a badge to the merge queue tab.', src: ['g:1'] }] },
    { key: BOOKING, sentences: [{ text: 'Bookings reach the calendar.', src: ['g:2'] }] },
  ]);
});

test('parse keeps a line within what a note can hold, dropping whole sentences rather than cutting one', () => {
  const g = dw.gather([project(SHELLBY, 'shellby', { commits: [{ id: 'g:1', at: at(9), subject: 'x' }] })]);
  const long = 'A'.repeat(120);
  const r = dw.parse(reply([{ project: 'p1', sentences: [{ text: `${long}.`, sources: [] }, { text: `${long} too.`, sources: [] }] }]), g);
  assert.equal(r.lines[0].sentences.length, 1);
  assert.ok(tt.draftText(r.lines[0]).length <= tt.NOTE_MAX);
});

test('parse says so when the reply is broken, an error, or empty', () => {
  const g = dw.gather([project(SHELLBY, 'shellby', { commits: [{ id: 'g:1', at: at(9), subject: 'x' }] })]);
  assert.equal(dw.parse('not json', g).ok, false);
  assert.equal(dw.parse(JSON.stringify({ is_error: true }), g).ok, false);
  assert.equal(dw.parse(reply([]), g).ok, false);
});

test('ask goes as the timesheet job, so a local model may write it, and says who did', async () => {
  const calls = [];
  const run = async (args, ms, opts) => { calls.push(opts); return { stdout: reply([{ project: 'p1', sentences: [{ text: 'Did it.', sources: ['g1'] }] }]), by: 'qwen3:8b' }; };
  const r = await dw.ask(DAY, [project(SHELLBY, 'shellby', { commits: [{ id: 'g:1', at: at(9), subject: 'x' }] })], run);
  assert.equal(r.ok, true);
  assert.equal(r.by, 'qwen3:8b');
  assert.equal(calls[0].local, 'timesheet');
  assert.equal(calls[0].lean, true);
  const claude = await dw.ask(DAY, [project(SHELLBY, 'shellby', { commits: [{ id: 'g:1', at: at(9), subject: 'x' }] })], async () => ({ stdout: reply([{ project: 'p1', sentences: [{ text: 'Did it.', sources: [] }] }]) }));
  assert.equal(claude.by, 'Claude');
});

test("ask writes each client's projects in a call of their own, so one client's work never reaches another's line", async () => {
  const inputs = [];
  const run = async (args, ms, opts) => {
    inputs.push(opts.input);
    const ids = [...opts.input.matchAll(/^## (p\d+):/gm)].map(m => m[1]);
    return { stdout: reply(ids.map(id => ({ project: id, sentences: [{ text: `Line for ${id}.`, sources: [] }] }))) };
  };
  const one = (key, name, client) => project(key, name, { client, commits: [{ id: `g:${name}`, at: at(9), subject: name }] });
  const r = await dw.ask(DAY, [one('c:\\a', 'alpha', 'Northwind'), one('c:\\b', 'beta', 'Pike & Co'), one('c:\\c', 'gamma', ''), one('c:\\d', 'delta', 'northwind ')], run);
  assert.equal(inputs.length, 3, 'Northwind, Pike & Co, and your own');
  assert.ok(inputs.every(i => !(/alpha|delta/.test(i) && /beta/.test(i))), "Pike & Co's never shares a call with Northwind's");
  assert.ok(inputs.some(i => /alpha/.test(i) && /delta/.test(i)), 'the same client, however it was typed, shares one');
  assert.deepEqual(r.lines.map(l => l.key).sort(), ['c:\\a', 'c:\\b', 'c:\\c', 'c:\\d']);
});

test('ask keeps the lines it got when one client fails, and only fails when none came back', async () => {
  let n = 0;
  const run = async (args, ms, opts) => (++n === 1 ? { timedOut: true } : { stdout: reply([{ project: 'p1', sentences: [{ text: 'Done.', sources: [] }] }]) });
  const one = (key, client) => project(key, key, { client, commits: [{ id: `g:${key}`, at: at(9), subject: 'x' }] });
  const r = await dw.ask(DAY, [one('c:\\a', 'A'), one('c:\\b', 'B')], run);
  assert.equal(r.ok, true);
  assert.deepEqual(r.lines.map(l => l.key), ['c:\\b']);
  const none = await dw.ask(DAY, [one('c:\\a', 'A')], async () => ({ timedOut: true }));
  assert.match(none.error, /too long/);
});

test('parse only maps back the projects that were sent, not ones that did not fit', () => {
  const g = dw.gather([project(SHELLBY, 'shellby', { commits: [{ id: 'g:1', at: at(9), subject: 'x' }] }), project(BOOKING, 'booking-app', { commits: [{ id: 'g:2', at: at(9), subject: 'y' }] })]);
  const sent = { projects: g.projects.slice(0, 1) };
  const r = dw.parse(reply([{ project: 'p2', sentences: [{ text: 'Never asked.', sources: [] }] }, { project: 'p1', sentences: [{ text: 'Asked.', sources: [] }] }]), sent);
  assert.deepEqual(r.lines.map(l => l.key), [SHELLBY]);
});

test('invisible characters in a commit never reach the model, nor a draft: bidi, zero-width, Unicode tags', () => {
  const sneaky = `fix${String.fromCodePoint(0x200b)}: ${String.fromCodePoint(0x202e)}badge${String.fromCodePoint(0xe0041, 0xe0042)}`;
  const g = dw.gather([project(SHELLBY, 'shellby', { commits: [{ id: 'g:1', at: at(9), subject: sneaky }] })]);
  assert.equal(g.projects[0].sources[0].text, 'fix : badge');
  const r = dw.parse(reply([{ project: 'p1', sentences: [{ text: `Added${String.fromCodePoint(0xe0041)} a badge.`, sources: [] }] }]), g);
  assert.equal(r.lines[0].sentences[0].text, 'Added a badge.');
});

test('ask never calls anything when there is nothing to go on, and reports a timeout', async () => {
  let called = false;
  const none = await dw.ask(DAY, [project(SHELLBY, 'shellby')], async () => { called = true; return {}; });
  assert.equal(none.ok, false);
  assert.equal(called, false);
  const slow = await dw.ask(DAY, [project(SHELLBY, 'shellby', { commits: [{ id: 'g:1', at: at(9), subject: 'x' }] })], async () => ({ timedOut: true }));
  assert.match(slow.error, /too long/);
});

// ------------------------------------------------------------------ the day's conversations

test("conversationsOn takes that day's messages of yours, from where the conversation started, and skips routines", () => {
  const entries = [
    { id: 'a', title: 'Calendar sync', cwd: 'c:\\appdata\\worktrees\\1\\booking-app', worktree: { originalCwd: BOOKING }, createdAt: at(13), updatedAt: at(16) },
    { id: 'b', title: 'Morning summary', cwd: SHELLBY, routineId: 'r1', createdAt: at(8), updatedAt: at(8, 5) },
    { id: 'c', title: 'Yesterday', cwd: SHELLBY, createdAt: at(9) - 86400000, updatedAt: at(9) - 86000000 },
    { id: 'd', title: 'Only replies today', cwd: SHELLBY, createdAt: at(9), updatedAt: at(10) },
  ];
  const items = {
    a: [{ kind: 'user', t: at(13), text: 'bookings should show in their calendar' }, { kind: 'text', t: at(13, 5), text: 'Done' }, { kind: 'user', t: at(15), text: 'poll every minute' }, { kind: 'result', t: at(15, 30) }],
    b: [{ kind: 'user', t: at(8), text: 'summarise' }],
    d: [{ kind: 'text', t: at(9), text: 'only Claude spoke' }],
  };
  const out = dw.conversationsOn(entries, id => items[id] || [], DAY);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { id: 'a', title: 'Calendar sync', home: BOOKING, asks: [{ at: at(13), text: 'bookings should show in their calendar' }, { at: at(15), text: 'poll every minute' }], until: at(15, 30) });
  assert.deepEqual(dw.conversationsOn(entries, () => { throw new Error('gone'); }, DAY), [], 'a transcript that won\'t load is skipped');
});

// ------------------------------------------------------------------ on the books

test('credit marks the quarter hour the time fell in', () => {
  let s = tt.ensureProject(tt.normalize({ enabled: true }), SHELLBY, 'shellby');
  s = tt.credit(s, SHELLBY, 15, at(9, 5));
  s = tt.credit(s, SHELLBY, 15, at(9, 20));
  s = tt.credit(s, SHELLBY, 15, at(14, 59));
  assert.deepEqual(tt.slotList(s.slots[DAY][SHELLBY]), [36, 37, 59]);
});

test('normalize keeps drafts and quarter hours it can read, and only the newest couple of months', () => {
  const s = tt.normalize({
    projects: { [SHELLBY]: { name: 'shellby' } },
    drafts: {
      [DAY]: { [SHELLBY]: { sentences: [{ text: 'Did it.', src: ['g:1', 7] }, { text: '' }], by: 'Claude', at: 5 } },
      '2026-11-13': { [SHELLBY]: { sentences: 'nope' } },
      '2025-01-01': { [SHELLBY]: { sentences: [{ text: 'Long ago.', src: [] }] } },
    },
    slots: { [DAY]: { [SHELLBY]: tt.markSlot('', 40), 'c:\\bad': 'zz' } },
  });
  assert.deepEqual(s.drafts[DAY][SHELLBY], { sentences: [{ text: 'Did it.', src: ['g:1'] }], by: 'Claude', at: 5 });
  assert.equal(s.drafts['2026-11-13'], undefined);
  assert.ok(s.drafts['2025-01-01'], 'old days stay while there are few');
  const many = Object.fromEntries(Array.from({ length: tt.RECENT_DAYS + 5 }, (_, i) => [`2026-0${1 + Math.floor(i / 28)}-${String(1 + (i % 28)).padStart(2, '0')}`, { [SHELLBY]: { sentences: [{ text: 'x', src: [] }] } }]));
  assert.equal(Object.keys(tt.normalize({ drafts: many }).drafts).length, tt.RECENT_DAYS);
  assert.deepEqual(tt.slotList(s.slots[DAY][SHELLBY]), [40]);
  assert.equal(s.slots[DAY]['c:\\bad'], undefined);
});

test("a draft shows on the day's line until a note of yours says otherwise; forgetting a project forgets its drafts", () => {
  let s = tt.ensureProject(tt.normalize({ enabled: true }), SHELLBY, 'shellby');
  s = tt.credit(s, SHELLBY, 60, at(9));
  s = tt.setDraft(s, DAY, SHELLBY, { sentences: [{ text: 'Added a badge.', src: [] }], by: 'Claude' });
  const row = () => tt.summarize(s, { from: DAY, to: DAY }).projects[0].days[0];
  assert.deepEqual(row().draft, { text: 'Added a badge.', by: 'Claude', kept: false });
  assert.equal(tt.lineText(row()), '', "a draft never reaches a timesheet by itself");
  s = tt.setNote(s, DAY, SHELLBY, 'Added a badge.');
  assert.equal(row().draft.kept, true);
  s = tt.setNote(s, DAY, SHELLBY, 'My own words');
  assert.equal(row().draft.kept, false);
  s = tt.removeProject(s, SHELLBY);
  assert.equal(s.drafts[DAY], undefined);
  assert.equal(s.slots[DAY], undefined);
});

// ------------------------------------------------------------------ the service

function tracker({ run = null, chats = [] } = {}) {
  const now = at(18);
  const saved = { timeTracking: { enabled: true } };
  const t = new TimeTracker({
    config: { get: k => saved[k], set: p => Object.assign(saved, p) }, now: () => now,
    toPanel: () => {}, front: () => null, idle: () => ({ idleMs: 0, locked: false }), selfPid: 1,
    known: () => [{ key: SHELLBY, name: 'shellby' }, { key: BOOKING, name: 'booking-app' }],
    claudeAt: () => ({ dirs: [], names: [] }),
    resolve: async dir => ({ root: dir, name: dir.split('\\').pop() }),
    conversations: () => chats,
    draft: () => run,
    writer: () => null,
  });
  t.commitsFor = async () => ({
    [SHELLBY]: [{ at: at(9, 30), subject: 'feat: merge queue badge' }, { at: at(9, 30), subject: 'test: badge' }],
    [BOOKING]: [{ at: at(15, 2), subject: 'feat: sync bookings' }],
  });
  let s = t.state;
  for (const [key, name] of [[SHELLBY, 'shellby'], [BOOKING, 'booking-app']]) s = tt.credit(tt.ensureProject(s, key, name), key, 60, at(key === SHELLBY ? 9 : 15));
  t.state = tt.setNote(s, DAY, BOOKING, 'Calendar sync, my words');
  return { t, saved };
}

test('dayView gives each line its commits with lasting ids, its conversations and its quarter hours', async () => {
  const { t } = tracker({ chats: [{ id: 'h1', title: 'Badge', home: SHELLBY, asks: [{ at: at(9), text: 'add a badge' }], until: at(9, 40) }] });
  const v = await t.dayView(DAY);
  const sh = v.lines.find(l => l.key === SHELLBY);
  assert.deepEqual(sh.commits.map(c => c.id), [`g:${at(9, 30)}`, `g:${at(9, 30)}-2`]);
  assert.deepEqual(sh.chats.map(c => [c.id, c.from, c.to]), [['c:h1', at(9), at(9, 40)]]);
  assert.deepEqual(sh.slots, [36]);
});

test('writeDay writes only the lines without your words, keepDraft makes one the note, dropDraft forgets it', async () => {
  const asked = [];
  const run = async (args, ms, opts) => {
    asked.push(opts.input);
    return { stdout: reply([{ project: 'p1', sentences: [{ text: 'Added a badge to the merge queue tab.', sources: ['g1'] }] }]) };
  };
  const { t, saved } = tracker({ run });
  const r = await t.writeDay(DAY);
  assert.equal(r.ok, true);
  assert.equal(r.written, 1);
  assert.match(asked[0], /shellby/);
  assert.doesNotMatch(asked[0], /booking-app/, 'a line you wrote is never sent to be rewritten');
  assert.deepEqual(t.state.drafts[DAY][SHELLBY].sentences, [{ text: 'Added a badge to the merge queue tab.', src: [`g:${at(9, 30)}`] }]);
  assert.ok(saved.timeTracking.drafts[DAY][SHELLBY], 'saved straight away');
  assert.equal(t.state.notes[DAY][BOOKING], 'Calendar sync, my words');

  assert.equal(t.keepDraft(DAY).kept, 1, 'keeping them all keeps the one without a note');
  assert.equal(t.state.notes[DAY][SHELLBY], 'Added a badge to the merge queue tab.');
  assert.equal(t.keepDraft(DAY).ok, false, 'nothing left to keep');
  assert.equal(t.dropDraft(DAY, SHELLBY).ok, true);
  assert.equal(t.state.drafts[DAY], undefined);
  assert.equal(t.state.notes[DAY][SHELLBY], 'Added a badge to the merge queue tab.', 'a kept line stays when its draft goes');
});

test('keeping one draft never writes over a note of yours', () => {
  const { t } = tracker();
  t.state = tt.setDraft(t.state, DAY, BOOKING, { sentences: [{ text: 'Shellby on booking.', src: [] }], by: 'Claude' });
  const r = t.keepDraft(DAY, BOOKING);
  assert.equal(r.ok, false);
  assert.match(r.error, /your words/);
  assert.equal(t.state.notes[DAY][BOOKING], 'Calendar sync, my words');
});

test('asking twice for the same day while it writes gets the one write-up', async () => {
  let calls = 0;
  let finish;
  const run = () => { calls++; return new Promise(r => { finish = () => r({ stdout: reply([{ project: 'p1', sentences: [{ text: 'Once.', sources: [] }] }]) }); }); };
  const { t } = tracker({ run });
  const a = t.writeDay(DAY);
  const b = t.writeDay(DAY);
  await new Promise(r => setTimeout(r, 20));
  finish();
  assert.deepEqual(await a, await b);
  assert.equal(calls, 1);
});

test('a note you write while it writes wins over the draft for that line', async () => {
  const meanwhile = {}; // the tracker, once made: the run types a note into it while "writing"
  const run = async () => { meanwhile.t.state = tt.setNote(meanwhile.t.state, DAY, SHELLBY, 'Typed meanwhile'); return { stdout: reply([{ project: 'p1', sentences: [{ text: 'Shellby wrote this.', src: [] }] }]) }; };
  const { t } = tracker({ run });
  meanwhile.t = t;
  const r = await t.writeDay(DAY);
  assert.equal(r.written, 0);
  assert.equal(t.state.drafts[DAY], undefined);
});

test('writeDay refuses a day to come, a day with nothing open, and having nothing to write with', async () => {
  const { t } = tracker({ run: async () => ({ stdout: '' }) });
  assert.equal((await t.writeDay('2027-01-01')).ok, false);
  assert.match((await tracker().t.writeDay(DAY)).error, /Settings/);
  t.state = tt.setNote(t.state, DAY, SHELLBY, 'mine');
  assert.match((await t.writeDay(DAY)).error, /already has your words/);
});
