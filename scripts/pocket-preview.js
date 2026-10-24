// Serve Shellby's phone app with a made-up Shellby behind it, so it can be
// looked at (and screenshotted) without Electron, Tailscale or a phone.
//
//   node scripts/pocket-preview.js [--port 47916] [--skin classic]
//
// Open the URL it prints in a browser at phone size (devtools' device mode),
// and pair with the code it prints. One conversation works away on its own:
// tools tick, a helper crab goes out, a reply types itself, and every so often
// he asks for permission. Allow, Deny, Stop, Undo, Bring it home and New task
// all answer as Shellby would. Nothing here touches a real repo or Claude.
const fs = require('fs');
const path = require('path');
const { PocketServer } = require('../src/main/pocket/server');
const view = require('../src/main/pocket/view');
const { MODELS } = require('../src/main/models');

const ROOT = path.join(__dirname, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const skin = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'skins', `${arg('skin', 'classic')}.json`), 'utf8'));
const CODE = 'PREV1EW2';
const TOKEN = 'p'.repeat(43);
const DEVICE = { id: '0000000000000001', name: 'Preview', login: '' };
const now = Date.now();
const min = 60 * 1000;

// ---- a made-up Shellby
const tabs = [
  { id: 'flaky', title: '📱 Fix the flaky upload test', cwd: 'C:\\code\\shellby', busy: false, busySince: null, pending: 1, crew: 0, outcome: null, unread: false, worktree: { branch: 'shellby/fix-upload', base: 'main', originalCwd: 'C:\\code\\shellby' }, ready: null, checks: null, todos: null, turnTokens: 4200, planning: false },
  { id: 'summary', title: 'Refactor the tab summary', cwd: 'C:\\code\\shellby', busy: true, busySince: now - 4 * min, pending: 0, crew: 2, outcome: null, unread: false, worktree: { branch: 'shellby/tab-summary', base: 'main', originalCwd: 'C:\\code\\shellby' }, ready: null, checks: null, todos: { total: 5, done: 3, current: 'Add the mode to the summary' }, turnTokens: 18000, planning: false },
  { id: 'tailnet', title: 'Tailnet range for localOrHttps', cwd: 'C:\\code\\shellby', busy: false, busySince: null, pending: 0, crew: 0, outcome: 'ok', unread: true, worktree: { branch: 'shellby/tailnet-range', base: 'main', originalCwd: 'C:\\code\\shellby' }, ready: { after: 'a1b2c3', files: 2, added: 18, removed: 3, paths: ['src/main/channels/index.js', 'test/channels.test.js'], at: now - 4 * min, reviewed: false }, checks: { status: 'pass', after: 'a1b2c3', at: now }, todos: null, turnTokens: 0, planning: false },
  { id: 'site', title: 'Hero copy for the website', cwd: 'C:\\code\\shellby-site', busy: false, busySince: null, pending: 0, crew: 0, outcome: 'ok', unread: true, worktree: null, ready: null, checks: null, todos: null, turnTokens: 0, planning: false },
  { id: 'deck', title: 'Stream Deck key icons', cwd: 'C:\\code\\shellby', busy: false, pending: 0, crew: 0, outcome: 'ok', unread: false, worktree: null, ready: null },
  { id: 'notes', title: 'Release notes for 0.90', cwd: 'C:\\code\\shellby', busy: false, pending: 0, crew: 0, outcome: 'ok', unread: false, worktree: null, ready: null },
  { id: 'dots', title: 'Tidy the dotfiles', cwd: 'C:\\code\\dotfiles', busy: false, pending: 0, crew: 0, outcome: 'ok', unread: false, worktree: null, ready: null },
];
let prompts = [
  { tabId: 'flaky', requestId: 'r1', toolName: 'Bash', label: 'Run', detail: 'npm test -- --grep upload', input: { command: 'npm test -- --grep upload' }, plain: { ask: 'Run the upload tests, then read what failed' }, warnings: [] },
];
const extras = { flaky: { mode: 'ask', fromPhone: true, canReply: true }, summary: { mode: 'smart' }, tailnet: { mode: 'ask', canReply: true }, site: { mode: 'acceptEdits' } };
const held = [
  { id: 'h1', kind: 'task', name: 'Write tests for the deck ref check', prompt: 'Write tests for the deck ref check', folder: 'shellby', atText: '14:20', running: false, fromPhone: true },
  { id: 'h2', kind: 'task', name: 'Tidy the docs index', prompt: 'Tidy the docs index', folder: 'shellby', atText: '01:00', when: 'tonight', running: false, fromPhone: true },
];
const projects = [{ key: 'C:\\code\\shellby', name: 'shellby' }, { key: 'C:\\code\\shellby-site', name: 'shellby-site' }, { key: 'C:\\code\\dotfiles', name: 'dotfiles' }];

const items = {
  flaky: [
    { kind: 'phone' },
    { kind: 'user', text: 'The upload test fails about one run in five. Find out why and fix it.', turnId: 'u1' },
    { kind: 'text', text: "I'll start by reading the test and the upload code, then run it a few times to catch it failing." },
    { kind: 'tool', id: 'f1', name: 'Read', label: 'Read', detail: 'test/upload.test.js' },
    { kind: 'tool_result', id: 'f1' },
    { kind: 'tool', id: 'f2', name: 'Grep', label: 'Search', detail: '"setTimeout" in src/upload' },
    { kind: 'tool_result', id: 'f2' },
    { kind: 'text', text: 'The test waits **100ms** for the upload to finish, but the upload retries after `150ms` on a busy server. That race is the flake.\n\nI want to run the suite to confirm it before changing anything:' },
    { kind: 'permission', requestId: 'r1', label: 'Run', detail: 'npm test -- --grep upload' },
  ],
  summary: [
    { kind: 'user', text: 'Move the mode and the phone marker into the tab summary, so every screen reads them from one place.', turnId: 'u2' },
    { kind: 'text', text: "Sure. Here's the plan:\n\n1. Add `mode` and `fromPhone` to `summary` in sessions.js\n2. Read them in the deck and the phone app\n3. Tests for both" },
    { kind: 'tool', id: 's1', name: 'Read', label: 'Read', detail: 'src/main/sessions.js' }, { kind: 'tool_result', id: 's1' },
    { kind: 'tool', id: 's2', name: 'Grep', label: 'Search', detail: '"summary" · 14 hits' }, { kind: 'tool_result', id: 's2' },
    { kind: 'tool', id: 's3', name: 'Read', label: 'Read', detail: 'src/main/deck.js' }, { kind: 'tool_result', id: 's3' },
    { kind: 'tool', id: 's4', name: 'Read', label: 'Read', detail: 'src/main/pocket/view.js' }, { kind: 'tool_result', id: 's4' },
    { kind: 'tool', id: 's5', name: 'Read', label: 'Read', detail: 'test/sessions.test.js' }, { kind: 'tool_result', id: 's5' },
    { kind: 'tool', id: 'a1', name: 'Agent', label: 'Agent', detail: 'map tab-sort callers', agent: { type: 'Explore', description: 'mapping tab-sort callers' } },
    { kind: 'tool', id: 'a2', name: 'Agent', label: 'Agent', detail: 'write the summary tests', agent: { type: 'test-writer', description: 'test/sessions-summary.test.js' } },
    { kind: 'tool', id: 's6', name: 'Edit', label: 'Edit', detail: 'src/main/sessions.js' },
  ],
  tailnet: [
    { kind: 'user', text: 'localOrHttps should accept Tailscale addresses (100.64.0.0/10) over http.', turnId: 'u3' },
    { kind: 'tool', id: 't1', name: 'Edit', label: 'Edit', detail: 'src/main/channels/index.js' }, { kind: 'tool_result', id: 't1' },
    { kind: 'tool', id: 't2', name: 'Edit', label: 'Edit', detail: 'test/channels.test.js' }, { kind: 'tool_result', id: 't2' },
    { kind: 'tool', id: 't3', name: 'Bash', label: 'Run', detail: 'npm test -- channels' }, { kind: 'tool_result', id: 't3' },
    { kind: 'text', text: 'Done. `localOrHttps` now takes **100.64.0.0/10** over plain http, and the tests cover the edges of the range:\n\n- `100.64.0.1` and `100.127.255.254` pass\n- `100.63.255.255` and `100.128.0.0` don\'t' },
    { kind: 'changes', root: 'x', before: 'b0', after: 'a1b2c3', added: 18, removed: 3, files: [{ path: 'src/main/channels/index.js', status: 'M', added: 6, removed: 2 }, { path: 'test/channels.test.js', status: 'M', added: 12, removed: 1 }] },
    { kind: 'result', ok: true, durationMs: 252000, tokens: 23100, cost: { share: 4 } },
  ],
  site: [{ kind: 'user', text: 'Punchier hero copy, please.', turnId: 'u4' }, { kind: 'text', text: 'How about: **Same Claude Code. Less babysitting.**' }, { kind: 'result', ok: true, durationMs: 41000, tokens: 3100, cost: { share: 1 } }],
};

const PATCH = `diff --git a/src/main/channels/index.js b/src/main/channels/index.js
index 1111111..2222222 100644
--- a/src/main/channels/index.js
+++ b/src/main/channels/index.js
@@ -207,8 +207,12 @@ function localOrHttps(raw) {
   const h = u.hostname.replace(/\\.+$/, '');
   // The ranges are for addresses only: "10.example.com" is a public name.
   const ip4 = net.isIPv4(h);
-  return h === 'localhost' || h === '127.0.0.1' || u.hostname === '[::1]' || h.endsWith('.local')
-    || (ip4 && (/^10\\./.test(h) || /^192\\.168\\./.test(h) || /^172\\.(1[6-9]|2\\d|3[01])\\./.test(h)));
+  return h === 'localhost' || h === '127.0.0.1' || u.hostname === '[::1]' || h.endsWith('.local')
+    || (ip4 && (/^10\\./.test(h) || /^192\\.168\\./.test(h) || /^172\\.(1[6-9]|2\\d|3[01])\\./.test(h) || tailnet(h)));
+}
+
+// Tailscale's addresses: 100.64.0.0/10, the shared address space it hands out.
+const tailnet = h => { const [a, b] = h.split('.').map(Number); return a === 100 && b >= 64 && b <= 127; };
diff --git a/test/channels.test.js b/test/channels.test.js
--- a/test/channels.test.js
+++ b/test/channels.test.js
@@ -88,3 +88,14 @@ test('localOrHttps', () => {
   assert.equal(localOrHttps('http://192.168.1.4:8080'), true);
+  assert.equal(localOrHttps('http://100.64.0.1'), true);
+  assert.equal(localOrHttps('http://100.127.255.254'), true);
+  assert.equal(localOrHttps('http://100.63.255.255'), false);
+  assert.equal(localOrHttps('http://100.128.0.0'), false);
 });
`;

const currentView = () => view.phoneView({
  pc: 'desk-pc', tabs, prompts, extras, held, projects, skin,
  crab: { state: prompts.length ? 'asking' : tabs.some(t => t.busy) ? 'working' : 'idle', say: null, crew: [{ label: 'mapping tab-sort callers', type: 'Explore' }, { label: 'writing tests', type: 'test-writer' }] },
  lastUsage: { fiveHour: { pct: 42, resetsAt: Date.now() + 2 * 60 * min } },
  limits: { perHour: 30, atOnce: 10, open: 1 },
  models: MODELS, model: 'sonnet',
  health: { cpu: { load: 34, temp: 62 }, gpus: [{ load: 12, temp: 48 }], ram: { pct: 58 }, battery: null },
  now: Date.now(),
});

let server = null;
const changed = () => server?.broadcast(currentView());
const emit = (tabId, item) => { items[tabId] = [...(items[tabId] || []), item]; const p = view.phoneItem(item); if (p) server.item(tabId, p); };

// ---- the conversation that works on its own
let beat = 0;
setInterval(() => {
  const t = tabs.find(x => x.id === 'summary');
  if (!t.busy) return;
  beat++;
  if (beat % 6 === 1) emit('summary', { kind: 'tool_result', id: `s${5 + Math.floor(beat / 6)}` });
  if (beat % 6 === 2) emit('summary', { kind: 'tool', id: `s${6 + Math.floor(beat / 6)}`, name: 'Edit', label: 'Edit', detail: ['src/main/sessions.js', 'src/main/pocket/view.js', 'test/sessions.test.js'][beat % 3] });
  if (beat % 6 === 3) for (const [n, text] of ['Moving', 'Moving the mode', 'Moving the mode into the summary', 'Moving the mode into the summary now.'].entries()) setTimeout(() => server.item('summary', { k: 'partial', text }), n * 250);
  if (beat % 6 === 4) emit('summary', { kind: 'text', text: 'Moving the mode into the summary now.' });
  if (beat === 20 && !prompts.some(p => p.tabId === 'summary')) {
    prompts.push({ tabId: 'summary', requestId: 'r2', toolName: 'Edit', label: 'Edit', detail: 'src/main/sessions.js', input: { file_path: 'C:\\code\\shellby\\src\\main\\sessions.js', old_string: '      safeMode: !!t.session.safeMode,', new_string: '      safeMode: !!t.session.safeMode,\n      mode: t.session.mode || null,\n      fromPhone: !!(t.fromPhone || t.fromPocket),' }, plain: { ask: 'Edit src/main/sessions.js in its own copy of the repo' }, warnings: [] });
    t.pending = 1;
    emit('summary', { kind: 'permission', requestId: 'r2', label: 'Edit', detail: 'src/main/sessions.js' });
    changed();
  }
}, 1000);

async function onAction(device, name, body) {
  await new Promise(r => setTimeout(r, 250));
  if (name === 'answer') {
    const p = prompts.find(x => x.requestId === body.requestId);
    if (!p) return { ok: false, error: 'That was already answered.' };
    prompts = prompts.filter(x => x !== p);
    const t = tabs.find(x => x.id === p.tabId);
    t.pending = 0;
    emit(p.tabId, { kind: 'decision', requestId: p.requestId, decision: body.decision, via: 'pocket' });
    if (p.tabId === 'flaky') {
      t.busy = true; t.busySince = Date.now();
      setTimeout(() => {
        emit('flaky', { kind: 'tool', id: 'f3', name: 'Bash', label: 'Run', detail: 'npm test -- --grep upload' });
        setTimeout(() => {
          emit('flaky', { kind: 'tool_result', id: 'f3' });
          emit('flaky', { kind: 'text', text: 'Confirmed: 3 of 20 runs failed on the timeout. I waited for the upload event instead of a fixed delay, and it passes 20 runs in a row now.' });
          emit('flaky', { kind: 'changes', root: 'x', before: 'b0', after: 'a1b2c3', added: 7, removed: 4, files: [{ path: 'test/upload.test.js', status: 'M', added: 7, removed: 4 }] });
          emit('flaky', { kind: 'result', ok: true, durationMs: 96000, tokens: 9100, cost: { share: 2 } });
          Object.assign(t, { busy: false, outcome: 'ok', unread: true, ready: { after: 'a1b2c3', files: 1, added: 7, removed: 4, paths: ['test/upload.test.js'], at: Date.now(), reviewed: false } });
          changed();
        }, 3000);
      }, 600);
    } else if (body.decision === 'deny') { emit(p.tabId, { kind: 'text', text: "Fair enough, I'll leave that file alone." }); }
    changed();
    return { ok: true };
  }
  if (name === 'stop') { const t = tabs.find(x => x.id === body.tabId); if (!t?.busy) return { ok: false, error: "He's not working on that one." }; t.busy = false; t.crew = 0; emit(t.id, { kind: 'result', ok: false, interrupted: true, durationMs: 30000 }); changed(); return { ok: true }; }
  if (name === 'undo') { emit(body.tabId, { kind: 'undone', after: body.after }); const t = tabs.find(x => x.id === body.tabId); t.ready = null; changed(); return { ok: true, restored: 2 }; }
  if (name === 'home') { const t = tabs.find(x => x.id === body.tabId); emit(t.id, { kind: 'home', base: 'main', commits: 2 }); t.ready = null; t.unread = false; changed(); return { ok: true, merged: true, commits: 2, base: 'main' }; }
  if (name === 'reviewed') { const t = tabs.find(x => x.id === body.tabId); t.ready = null; t.unread = false; changed(); return { ok: true }; }
  if (name === 'cancel-held') { held.splice(0, held.length); changed(); return { ok: true }; }
  if (name === 'held-edit') { const x = held.find(y => y.id === body.id); if (!x) return { ok: false, error: 'That has already gone.' }; x.prompt = x.name = body.prompt; changed(); return { ok: true }; }
  if (name === 'held-move') { const i = held.findIndex(y => y.id === body.id); const j = i + (body.dir === 'up' ? -1 : 1); if (i < 0 || !held[j]) return { ok: false, error: 'That has already gone.' }; [held[i], held[j]] = [held[j], held[i]]; changed(); return { ok: true }; }
  if (name === 'checks-run') { const t = tabs.find(x => x.id === body.tabId); t.checks = { status: 'running', after: t.ready?.after || 'a1b2c3', at: Date.now() }; changed(); setTimeout(() => { t.checks = { status: 'pass', after: t.checks.after, at: Date.now() }; changed(); }, 3000); return { ok: true, started: true }; }
  if (name === 'branch-from') return onAction(device, 'task', { text: body.at === 'after' ? 'Branch of the conversation' : 'Tried again', project: 'C:\\code\\shellby' });
  if (name === 'task' && (body.when === 'reset' || body.when === 'tonight')) { held.push({ id: `h${Date.now()}`, kind: 'task', name: body.text.slice(0, 60), prompt: body.text, folder: 'shellby', atText: body.when === 'tonight' ? '01:00' : '14:20', when: body.when, running: false, fromPhone: true }); changed(); return { ok: true, held: true, atText: body.when === 'tonight' ? '01:00' : '14:20', when: body.when }; }
  if (name === 'task') {
    const id = `new${Date.now()}`;
    tabs.unshift({ id, title: `📱 ${body.text.slice(0, 60)}`, cwd: body.project, busy: true, busySince: Date.now(), pending: 0, crew: 0, worktree: { branch: 'shellby/new', base: 'main' } });
    extras[id] = { mode: 'ask', fromPhone: true, canReply: true };
    items[id] = [{ kind: 'phone' }, { kind: 'user', text: body.text, turnId: 'n' }];
    changed();
    return { ok: true, tabId: id };
  }
  if (name === 'reply') { emit(body.tabId, { kind: 'user', text: body.text }); return { ok: true }; }
  if (name === 'push') return { ok: false, error: 'The preview has no push service.' };
  if (name === 'look-over') return onAction(device, 'task', { text: 'Look over shellby', project: body.project || 'C:\\code\\shellby' });
  if (name === 'notes') return { ok: true, key: 'C:\\code\\shellby', lists: [{ key: 'general', name: 'General', open: 0 }, { key: 'C:\\code\\shellby', name: 'shellby', open: 2 }], notes: [{ id: 'n1', text: 'Make the queue screen show the weekly window too', done: false, from: 'you' }, { id: 'n2', text: 'Flaky: e2e-voice on a slow runner', done: false, from: 'claude' }] };
  if (name === 'progress') {
    return {
      ok: true, level: 23, marks: 0, title: 'Tide Runner', rank: 'Coral', into: 640, needed: 1100, progress: 0.58, total: 18420,
      streak: { days: 12, multiplier: 1.05 },
      bounties: { list: [{ text: 'Pass the tests twice', xp: 30, count: 2, goal: 2, done: true }, { text: 'Bring a copy home', xp: 40, count: 0, goal: 1, done: false }, { text: 'Answer three prompts', xp: 25, count: 1, goal: 3, done: false }], cleared: false, bonus: 50 },
      unlock: { level: 25, xpToGo: 1460, names: ['🏷️ Reef Warden'] },
      recent: [{ at: Date.now() - 4 * min, xp: 30, label: 'Tests passed in shellby' }, { at: Date.now() - 50 * min, xp: 60, label: 'Brought a copy home' }, { at: Date.now() - 3 * 60 * min, xp: 30, label: 'Bounty: Pass the tests twice' }],
    };
  }
  if (name === 'routines') {
    const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); return d.getTime(); };
    return {
      ok: true,
      routines: [
        { id: 'r1', name: 'Docs check: shellby', enabled: true, running: false, scheduleText: 'Every day at 8:00 PM', next: at(20, 0), folder: 'shellby' },
        { id: 'r2', name: 'Tax deadline check', enabled: true, running: false, scheduleText: 'Mon at 9:00 AM', next: at(9, 0), folder: 'home' },
        { id: 'r3', name: 'Open items reminder', enabled: false, running: false, scheduleText: 'Every day at 8:30 AM', next: null, folder: 'home' },
        { id: 'r4', name: 'Rules watch', enabled: true, running: true, scheduleText: 'Mon at 8:30 AM', next: at(8, 30), folder: 'shellby' },
      ],
      workflows: [
        { id: 'w1', name: 'Fix a red build', description: 'When CI fails on main, find the cause and open a fix.', enabled: true, running: false, needsInputs: false },
        { id: 'w2', name: 'Release notes', description: 'Gather the change notes into a draft.', enabled: false, running: false, needsInputs: true },
      ],
    };
  }
  if (name === 'routine-toggle' || name === 'routine-run' || name === 'workflow-run') return { ok: true };
  if (name === 'forget') return { ok: true };
  return { ok: false, error: 'unknown' };
}

server = new PocketServer({
  srcDir: path.join(ROOT, 'src'), assetsDir: path.join(ROOT, 'assets'), port: Number(arg('port', 47916)),
  getPlace: () => ({}), ownerLogin: () => '',
  findDevice: t => (t === TOKEN ? DEVICE : null),
  onPair: async ({ code }) => (code.replace(/[^A-Z0-9]/gi, '').toUpperCase() === CODE ? { ok: true, token: TOKEN, deviceId: DEVICE.id } : { ok: false, error: "That's not the code. Check it on your PC's screen." }),
  onOpen: (device, { tab }) => ({ view: currentView(), items: tab ? view.phoneItems(items[tab] || []) : undefined }),
  onAction,
  onDiff: async () => ({ ok: true, patch: PATCH }),
});
server.on('status', v => {
  if (v.status === 'listening') console.log(`Shellby's phone app: http://127.0.0.1:${server.port}/  (pair with ${CODE.slice(0, 4)}-${CODE.slice(4)})`);
  else if (v.status !== 'off') console.log(`Couldn't serve: ${v.status}`);
});
server.start();
setInterval(changed, 5000);
module.exports = { TOKEN, CODE };
