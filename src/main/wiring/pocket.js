// Shellby on your phone (pocket/): the server, Tailscale, pairing, push, and
// what each tap on the phone does. Kept out of main.js, which only wires it up.
//
// Off until you turn it on in Settings → On your phone, which asks in the
// confirmation window. On, it serves 127.0.0.1:47916 and asks Tailscale to
// serve that on your tailnet; off, it stops both.
//
// The phone does what the desk does, through the same functions, under the
// phone's rules (the same ones the notifications follow):
//   - Allow and Deny only; never Always allow, and nothing deskOnlyReason flags
//     but a Deny.
//   - New tasks in Ask first, in their own copy when the folder is a repo, at
//     most 10 an hour and 3 at once, held for the reset at the limit.
//   - Replies only into conversations the phone started, which are Ask first too.
//   - Undo and Bring it home through the desk's own code, with its checks gate.
const { app, safeStorage } = require('electron');
const path = require('path');
const attach = require('../attachments');
const confirm = require('../confirm');
const guard = require('../guard');
const pt = require('../channels/phone-tasks');
const { appDeskOnlyReason } = require('../channels/replies');
const { EVENTS } = require('../channels/messages');
const { MODES: PHONE_MODES } = require('../config');
const { qrRows } = require('../qr');
const pairing = require('../pocket/pairing');
const push = require('../pocket/push');
const { PocketServer, DEFAULT_PORT } = require('../pocket/server');
const { createTailscale, pickHttpsPort } = require('../pocket/tailscale');
const view = require('../pocket/view');
const { createPocketExtras } = require('../pocket/extras');
const { createPocketNotices } = require('../pocket/notices');

const WATCH_MS = 60 * 1000;          // how often Tailscale is looked at while it's on: Funnel never stays on
const TICK_MS = 5 * 1000;            // the usage meter and the queue change without a tab event
const SEEN_SAVE_MS = 5 * 60 * 1000;  // "last seen" goes to disk this often at most
const TAILSCALE_URL = 'https://tailscale.com/download/windows';
const HTTPS_URL = 'https://login.tailscale.com/admin/dns';
// As the desk's Skip says it (feed-asks.js).
const SKIPPED_QUESTION = "The user skipped the question. Continue with your best judgement, or ask in plain text if you're stuck.";

// The phone app's notifications start as the phone channels do: the same events, on by the same defaults.
const NOTIFY_DEFAULTS = { enabled: true, events: Object.fromEntries(Object.entries(EVENTS).map(([k, e]) => [k, e.default])), minSeconds: 60, whileFocused: false, working: false };
const EVENT_LABELS = Object.fromEntries(Object.entries(EVENTS).map(([k, e]) => [k, e.label]));
// Off until you tick them in Settings → On your phone:
//   push:      push a conversation's branch after bringing it home
//   files:     read a conversation's files, read-only
const ALLOW_KEYS = ['push', 'files'];

// Another port for a dev run beside an installed Shellby, or 0 for whichever is free (the tests).
function portFromEnv(raw) {
  const n = Number(raw);
  return raw != null && raw !== '' && Number.isInteger(n) && n >= 0 && n <= 65535 ? n : DEFAULT_PORT;
}

// e2e runs stand a fake Tailscale in (test/fixtures/fake-tailscale.js). Dev builds only.
function devTailscale() {
  const file = process.env.SHELLBY_FAKE_TAILSCALE;
  if (!file || app?.isPackaged) return null;
  return require(path.resolve(file)).createFakeTailscale();
}

/** d: what main shares (main.js `shared`). */
function wirePocket(d) {
  const tailscale = d.tailscaleCli || devTailscale() || createTailscale();
  let ts = { installed: null, state: 'unknown', dnsName: '', login: '', https: false };
  let serve = { httpsPort: 0, url: '', funnel: false, taken: [] };
  let checking = null;
  let problem = null;       // why it isn't serving, for Settings: { text, link?, linkText? }
  let code = null;          // the pairing window: { code, expiresAt, tries }
  let vapid = null;
  let watcher = null;
  let ticker = null;
  let lastView = '';
  const lastTurn = new Map(); // watched tab -> the turn whose message the phone has
  // Focus, routines, notes, the wardrobe, files and photos (pocket/extras.js).
  const extra = createPocketExtras(d, {
    allowed: key => !!settings().allow[key],
    tabRoot: id => { const tab = id && d.manager?.tabs.get(id); return tab?.session?.cwd || null; },
  });

  // ---- settings

  function settings() {
    const r = d.config.get('pocket') || {};
    const notify = { ...NOTIFY_DEFAULTS, ...(r.notify && typeof r.notify === 'object' ? r.notify : {}) };
    notify.events = { ...NOTIFY_DEFAULTS.events, ...(r.notify?.events || {}) };
    const allow = r.allow && typeof r.allow === 'object' ? r.allow : {};
    return {
      enabled: r.enabled === true,
      // What the phone may do beyond the usual, each one turned on at the desk.
      allow: Object.fromEntries(ALLOW_KEYS.map(k => [k, allow[k] === true])),
      login: typeof r.login === 'string' ? r.login : '',
      dnsName: typeof r.dnsName === 'string' ? r.dnsName : '',
      servedPort: Number.isInteger(r.servedPort) ? r.servedPort : 0, // the https port Shellby asked serve for, to take back
      notify,
    };
  }
  const save = patch => d.config.set({ pocket: { ...d.config.get('pocket'), ...patch } });
  const devices = () => pairing.normalizeDevices(d.config.get('pocketDevices'));
  const saveDevices = list => d.config.set({ pocketDevices: list });

  // ---- the key push messages are signed with: made once, encrypted by Windows

  function vapidKeys() {
    if (vapid) return vapid;
    if (!safeStorage.isEncryptionAvailable()) return null;
    const raw = d.config.get('pocketVapid');
    if (raw) {
      try {
        const k = JSON.parse(safeStorage.decryptString(Buffer.from(raw, 'base64')));
        if (push.validVapidKeys(k)) vapid = k;
      } catch { vapid = null; }
    }
    if (!vapid) {
      vapid = push.newVapidKeys();
      d.config.set({ pocketVapid: safeStorage.encryptString(JSON.stringify(vapid)).toString('base64') });
      // A new key means every old subscription is someone else's: they go.
      saveDevices(devices().map(dv => ({ ...dv, push: null })));
    }
    return vapid;
  }

  // ---- Tailscale

  // fresh: a look that starts now, after any already on its way (which may have
  // begun before serve was turned on or off).
  async function refreshTailscale({ fresh = false } = {}) {
    if (checking && !fresh) return checking;
    const before = checking || Promise.resolve();
    const mine = before.catch(() => {}).then(async () => {
      ts = await tailscale.status();
      const port = d.pocket?.port || DEFAULT_PORT;
      serve = ts.state === 'running' && ts.dnsName ? await tailscale.serveStatus({ port, dnsName: ts.dnsName }) : { httpsPort: 0, url: '', funnel: false, taken: [] };
      if (serve.funnel && d.pocket?.status === 'listening') {
        // On the open internet: the one thing this never is. Off now, and Settings says why.
        d.pocket.stop();
        problem = { text: 'Tailscale Funnel is on for this address, which puts it on the open internet. Shellby stopped serving your phone. Turn Funnel off, then turn this on again.' };
        d.log.warn('pocket: funnel is on for our address, stopped');
      }
      return ts;
    }).finally(() => { if (checking === mine) checking = null; });
    checking = mine;
    return mine;
  }

  const place = () => ({ dnsName: ts.dnsName || settings().dnsName, httpsPort: serve.httpsPort || settings().servedPort || 443 });
  const url = () => serve.url || '';

  // What's missing before it can be on, in order. null: nothing.
  function setupProblem() {
    if (ts.installed === false) return { step: 'install', text: 'Tailscale isn’t on this PC yet.', link: TAILSCALE_URL, linkText: 'Get Tailscale' };
    if (ts.state === 'needs-login' || ts.state === 'stopped') return { step: 'sign-in', text: 'Tailscale is installed but not connected. Open it and sign in.' };
    if (ts.state !== 'running' || !ts.dnsName) return { step: 'sign-in', text: ts.error || 'Tailscale isn’t running.' };
    if (!ts.https) return { step: 'https', text: 'Turn on HTTPS certificates for your tailnet (Admin console → DNS). Your phone needs them to install the app.', link: HTTPS_URL, linkText: 'Open the DNS page' };
    if (!ts.login) return { step: 'sign-in', text: 'Tailscale didn’t say who’s signed in on this PC.' };
    return null;
  }

  // ---- the server

  function findDevice(token) {
    if (!settings().enabled) return null;
    return pairing.deviceFor(devices(), token);
  }

  const seenSaved = new Map();
  function onSeen(device) {
    const now = Date.now();
    if (now - (seenSaved.get(device.id) || 0) < SEEN_SAVE_MS) return;
    seenSaved.set(device.id, now);
    saveDevices(devices().map(dv => (dv.id === device.id ? { ...dv, lastSeenAt: now } : dv)));
    d.send(d.panel, 'pocket', pocketViewNow());
  }

  async function onPair({ code: typed, name, agent, login }) {
    const r = pairing.tryCode(code, typed, Date.now());
    code = r.state;
    if (!r.ok) {
      d.send(d.panel, 'pocket', pocketViewNow());
      return { ok: false, error: r.error === 'closed' ? 'That code has run out. Make a new one in Settings → On your phone.' : "That's not the code. Check it on your PC's screen." };
    }
    const made = pairing.newDevice({ name: name || pairing.nameFromAgent(agent), login });
    saveDevices(pairing.addDevice(devices(), made.device));
    d.log.info(`pocket: paired ${made.device.name}`);
    d.notify?.('Your phone is paired', `${made.device.name} can see what Shellby's doing now.`, () => showPocketSettings());
    d.send(d.panel, 'pocket', pocketViewNow());
    return { ok: true, token: made.token, deviceId: made.device.id, name: made.device.name, vapid: vapidKeys()?.publicKey || null };
  }

  // Waiting prompts, oldest first across every conversation (as the Stream Deck orders them).
  function waitingPrompts() {
    const out = [];
    for (const [tabId, tab] of d.manager?.tabs || []) {
      for (const item of tab.session.pending.values()) out.push({ ...item, tabId, firstAt: item.at || 0 });
    }
    return out;
  }

  function extras() {
    const out = {};
    for (const [id, tab] of d.manager?.tabs || []) {
      out[id] = { mode: tab.session.mode || null, fromPhone: !!(tab.fromPocket || tab.fromPhone), canReply: !tab.inTerminal };
    }
    return out;
  }

  function projects() {
    const out = new Map();
    const add = (dir, name) => {
      if (typeof dir !== 'string' || !path.win32.isAbsolute(dir) || !attach.isLocalPath(dir)) return;
      const key = dir.toLowerCase();
      if (out.has(key) || !d.isFolder(dir)) return;
      out.set(key, { key: dir, name: name || path.win32.basename(dir) });
    };
    // The folder you're in, then the ones open in a conversation, then every one Shellby has seen.
    add(d.currentCwd?.());
    for (const tab of d.manager?.tabs.values() || []) add(tab.worktree?.originalCwd || tab.session?.cwd);
    try { for (const p of d.knownProjects?.() || []) add(p.key, p.name); } catch { /* none known yet */ }
    for (const dir of d.config.get('projects')?.added || []) add(dir);
    return [...out.values()].slice(0, 60);
  }

  function crab() {
    const own = d.manager?.aggregate || { state: 'idle', crew: [] };
    return { state: d.lastStatus?.state || own.state, work: d.lastStatus?.work || null, say: d.said, crew: own.crew };
  }

  function currentView() {
    return view.phoneView({
      pc: ts.dnsName ? ts.dnsName.split('.')[0] : require('os').hostname(),
      tabs: d.manager?.summary || [],
      prompts: waitingPrompts(),
      crab: crab(),
      extras: extras(),
      outlook: d.outlookView?.() || null,
      lastUsage: d.config.get('lastUsage'),
      held: d.heldService?.heldViews() || [],
      projects: projects(),
      skin: d.activeSkin?.() || null,
      limits: { perHour: pt.MAX_STARTS_PER_HOUR, atOnce: pt.MAX_OPEN, open: openCount() },
      pushKey: vapid?.publicKey || null,
      allow: settings().allow,
      focus: d.focusState?.() || null,
      guard: guard.settingsOf(k => d.config.get(k)),
      now: Date.now(),
    });
  }

  function onOpen(device, { tab }) {
    const out = { view: currentView() };
    if (tab && d.manager?.tabs.has(tab)) {
      out.items = view.phoneItems(d.history.load(tab));
      lastTurn.set(tab, d.manager.tabs.get(tab).turnId || null);
    }
    return out;
  }

  // Every change: the whole view goes out, when it looks different.
  let pending = null;
  function pushView() {
    if (pending || !d.pocket || d.pocket.status !== 'listening' || !d.pocket.clients.size) return;
    pending = setTimeout(() => {
      pending = null;
      if (!d.pocket?.clients.size) return;
      const v = currentView();
      const said = JSON.stringify({ ...v, at: 0 });
      if (said === lastView) return;
      lastView = said;
      d.pocket.broadcast(v);
      badge(v.prompts.length);
    }, 120);
  }

  // A message typed at the desk isn't one of the manager's items (the panel draws
  // its own): when a watched conversation starts a turn, the phone gets it from History.
  function newTurns() {
    if (!d.pocket?.clients.size) return;
    for (const tabId of d.pocket.watched()) {
      const tab = d.manager.tabs.get(tabId);
      if (!tab || !tab.turnId || lastTurn.get(tabId) === tab.turnId) continue;
      lastTurn.set(tabId, tab.turnId);
      const said = [...d.history.load(tabId)].reverse().find(i => i?.kind === 'user' && i.turnId === tab.turnId);
      if (said) d.pocket.item(tabId, view.phoneItem(said));
    }
  }

  function onItem(tabId, item) {
    if (!d.pocket?.clients.size) return;
    if (item.kind === 'usage' || item.kind === 'result') pushView();
    if (!d.pocket.watched().has(tabId)) return;
    const p = view.phoneItem(item);
    if (p) d.pocket.item(tabId, p);
  }

  // ---- what the phone does

  const ok = extra => ({ ok: true, ...extra });
  const no = error => ({ ok: false, error });
  const str = (v, n = 200) => (typeof v === 'string' && v.length > 0 && v.length <= n ? v : null);

  // "3 at once" counts every task a phone started, from this app or from
  // Telegram or ntfy, working or waiting on you, plus any on their way to starting.
  let starting = 0;
  function openCount() {
    let n = starting;
    for (const [id, tab] of d.manager?.tabs || []) {
      if ((tab.fromPocket || tab.fromPhone) && (d.manager.isBusy(id) || tab.session.pending.size)) n++;
    }
    return n;
  }
  let starts = [];
  // A task the phone sent again (its answer was slow, so it tried once more) is the same task.
  const sent = new Map(); // key -> the promise of its answer
  const KEY = /^[A-Za-z0-9_-]{8,64}$/;

  async function onAction(device, name, body) {
    if (!settings().enabled) return no('Shellby on your phone is off.');
    switch (name) {
      case 'answer': return answer(body);
      case 'task': return task(body);
      case 'reply': return reply(body);
      case 'stop': return stop(body);
      case 'undo': return undo(body);
      case 'home': return home(body);
      case 'reviewed': return reviewed(body);
      case 'cancel-held': return cancelHeld(body);
      case 'push': return setPush(device, body);
      case 'forget': return forget(device.id, 'You forgot this phone.');
      default: {
        const fn = Object.prototype.hasOwnProperty.call(extra.actions, name) ? extra.actions[name] : null;
        if (!fn) return no('unknown');
        const r = await fn(body);
        if (r.ok && ['focus', 'routine-toggle'].includes(name)) pushView();
        return r;
      }
    }
  }

  function answer({ tabId, requestId, decision, answers, notes, read }) {
    if (!str(tabId) || !str(requestId) || !['allow', 'always', 'deny'].includes(decision)) return no('That answer is not one the phone can give.');
    const pendingItem = d.manager.tabs.get(tabId)?.session.pending.get(requestId);
    if (!pendingItem) return no('That was already answered.');
    if (decision === 'always' && (!pendingItem.suggestions?.length || ['AskUserQuestion', 'ExitPlanMode'].includes(pendingItem.toolName))) return no('That one has no always-allow. Allow it this once.');
    // A no is always safe, so a desk-only prompt can still be turned down here: otherwise it holds the conversation until you're back.
    const why = appDeskOnlyReason(pendingItem);
    if (why && decision !== 'deny') return no(why);
    const extra = answerExtra(pendingItem, { decision, answers, notes, read, mayWrite: mayWriteTo(d.manager.tabs.get(tabId)) });
    if (extra.error) return no(extra.error);
    d.log.info(`pocket: ${decision} for ${pendingItem.toolName}`);
    return d.answerPermission(tabId, requestId, decision, { via: 'pocket', ...extra }) ? ok() : no('That was already answered.');
  }

  // A question needs an answer to each of its questions; a plan is only approved
  // once the phone says it was read to the end, and a no carries your notes.
  // Your own words into a conversation (a typed answer, notes on a plan) go
  // only where a reply could: anywhere but a terminal.
  const mayWriteTo = tab => !tab?.inTerminal;

  function answerExtra(item, { decision, answers, notes, read, mayWrite }) {
    if (item.toolName === 'AskUserQuestion') {
      if (decision === 'deny') return { message: SKIPPED_QUESTION };
      const asked = (item.input?.questions || []).map(q => q?.question).filter(q => typeof q === 'string');
      const given = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
      const clean = Object.fromEntries(asked.map(q => [q, typeof given[q] === 'string' ? given[q].trim().slice(0, 2000) : '']));
      if (!asked.length || Object.values(clean).some(a => !a)) return { error: 'Answer each question first.' };
      if (!mayWrite) {
        // Only the options offered, then: a typed answer to a desk conversation is a reply.
        const offered = q => new Set(((item.input.questions || []).find(x => x?.question === q)?.options || []).map(o => o?.label));
        if (Object.entries(clean).some(([q, a]) => a.split(', ').some(part => !offered(q).has(part)))) return { error: 'Pick from the options: typed answers to this one go from the desk.' };
      }
      return { answers: clean };
    }
    if (item.toolName === 'ExitPlanMode') {
      if (decision === 'allow') return read === true ? {} : { error: 'Read the plan to the end first.' };
      const said = typeof notes === 'string' ? notes.trim().slice(0, 2000) : '';
      if (said && !mayWrite) return { error: 'Notes on this plan go from the desk. Send it back without them, or write them there.' };
      return said ? { message: `The user read your plan and wants it revised before anything changes. Their notes:\n${said}` } : {};
    }
    return {};
  }

  function task(body) {
    const key = typeof body?.key === 'string' && KEY.test(body.key) ? body.key : null;
    if (key && sent.has(key)) return sent.get(key);
    const answer = startTask(body);
    if (key) {
      sent.set(key, answer);
      while (sent.size > 50) sent.delete(sent.keys().next().value);
    }
    return answer;
  }

  async function startTask({ project, text, mode, photos }) {
    const runAs = modeOf(mode);
    const prompt = pt.cleanText(typeof text === 'string' ? text : '').slice(0, pt.MAX_TEXT).trim();
    if (!prompt) return no('Say what you want done first.');
    if (/^[/!]/.test(prompt)) return no('Commands that start with / or ! only run at the desk.');
    const target = projects().find(p => p.key === project);
    if (!target) return no("That project isn't one Shellby knows. Pick one from the list.");
    const now = Date.now();
    const gate = pt.startGate({ starts, open: openCount(), now });
    if (!gate.ok) return no(gate.reply);
    starts = [...pt.recent(starts, now), now];
    // At the limit, or past what you keep for yourself: it waits for the reset.
    const w = d.usageService?.limitWait();
    const usage = d.config.get('lastUsage');
    if (w || guard.holdBeforeStart(guard.settingsOf(k => d.config.get(k)), usage, now)) {
      const held = d.holdForReset({ kind: 'task', prompt, cwd: target.key, mode: runAs, fromPhone: true });
      if (!held.ok) return no(`Couldn't queue it: ${held.error}`);
      d.sendOutlook?.();
      pushView();
      return ok({ held: true, atText: held.atText });
    }
    const title = pt.titleFor(prompt);
    // Pictures the phone sent first (POST /upload), each used once.
    const files = extra.takePhotos(photos);
    // Its place is kept while the copy is made, so two at once can't both slip under the cap.
    starting++;
    let r;
    try {
      r = await d.startTaskInCopy(target.key, title, () => prompt, { mode: runAs, ...(files.length ? { attachments: () => files } : {}) });
      if (!r.ok && r.noCopy) r = d.startTask(files.length && d.composePrompt ? d.composePrompt(prompt, files) : prompt, title, { mode: runAs, cwd: target.key });
      if (r.ok) adopt(r.tabId);
    } finally { starting--; }
    if (!r.ok) return no(r.error || "Couldn't start it.");
    d.log.info('pocket: started a task in', target.name);
    pushView();
    return ok({ tabId: r.tabId });
  }

  // What the phone picked, from the desk's own list; anything else is Ask (pt.MODE).
  const modeOf = m => (PHONE_MODES.includes(m) ? m : pt.MODE);

  function adopt(tabId) {
    const tab = d.manager.tabs.get(tabId);
    if (tab) tab.fromPocket = true;
    d.manager.note(tabId, { kind: 'phone' });
    d.history.update(tabId, { fromPhone: true });
  }

  function reply({ tabId, text, mode }) {
    const tab = str(tabId) && d.manager.tabs.get(tabId);
    if (!tab) return no('That conversation has closed.');
    if (tab.inTerminal) return no("It's in a terminal on your PC now. Reply there.");
    const said = pt.cleanText(typeof text === 'string' ? text : '').slice(0, pt.MAX_TEXT).trim();
    if (!said) return no('Type something first.');
    if (/^[/!]/.test(said)) return no('Commands that start with / or ! only run at the desk.');
    if (d.manager.isBusy(tabId)) return no("He's still on it. Wait for this turn to end, or stop it.");
    // The mode the phone picked, or Ask: kept when the desk's mode changes.
    const runAs = modeOf(mode);
    if (tab.session.mode !== runAs) tab.session.setMode(runAs);
    tab.pinnedMode = true;
    const r = d.sendToTab(tabId, said, []);
    if (!r.ok) return no(r.error);
    // The desk's panel draws a message it didn't send itself from this.
    d.send(d.tabWindow?.(tabId) || d.panel, 'tab:sent', { tabId, item: r.item });
    lastTurn.set(tabId, r.turnId);
    d.pocket?.item(tabId, view.phoneItem(r.item));
    return ok({ turnId: r.turnId });
  }

  function stop({ tabId }) {
    if (!str(tabId) || !d.manager.isBusy(tabId)) return no("He's not working on that one.");
    d.manager.interrupt(tabId);
    return ok();
  }

  // A turn's changes, as History has them: the phone names the turn, main finds the rest.
  function changesOf(tabId, after) {
    if (!str(tabId) || !str(after, 100) || !d.manager.tabs.has(tabId)) return null;
    return [...d.history.load(tabId)].reverse().find(i => i?.kind === 'changes' && i.after === after) || null;
  }

  async function undo({ tabId, after }) {
    const c = changesOf(tabId, after);
    if (!c) return no("That isn't a change from this conversation.");
    const r = await d.undoChanges({ tabId, root: c.root, before: c.before, after: c.after });
    return r.ok ? ok({ restored: r.restored }) : no(r.error || "Couldn't undo it.");
  }

  async function onDiff(device, { tab, after, file }) {
    const c = changesOf(tab, after);
    if (!c) return no("That isn't a change from this conversation.");
    if (file && !(c.files || []).some(f => f.path === file)) return no("That file isn't in that change.");
    const r = await d.diffChanges({ tabId: tab, root: c.root, before: c.before, after: c.after, ...(file ? { file } : {}) });
    if (r?.error) return no(r.error);
    // A phone needs a page or two, not a whole refactor.
    const patch = String(r?.patch || '');
    return ok({ patch: patch.slice(0, 200000), truncated: !!r?.truncated || patch.length > 200000 });
  }

  // push: and push the branch it lands on, when Settings allows it. The desk's
  // own checks go first (the secret scan, other people's commits), as at the desk.
  async function home({ tabId, force, push: andPush }) {
    if (!str(tabId)) return no('That conversation has closed.');
    if (andPush === true && !settings().allow.push) return no('Pushing from your phone is off. Turn it on in Settings → On your phone.');
    if (andPush === true && force === true) return no('Red checks and a push together only happen at the desk.');
    const r = await d.bringTabHome(tabId, { force: force === true, ...(andPush === true ? { push: true } : {}) });
    if (r.red) return { ok: false, red: true, error: r.error };
    const pushed = r.push;
    return r.ok ? ok({ merged: !!r.merged, commits: r.commits || 0, base: r.base || null, ...(andPush === true ? { pushed: !!pushed?.ok, pushError: pushed && !pushed.ok ? String(pushed.error || '') : null } : {}) }) : no(r.error || "Couldn't bring it home.");
  }

  function reviewed({ tabId, after }) {
    if (!str(tabId)) return no('That conversation has closed.');
    return d.manager.setReviewed(tabId, true, str(after, 100)) ? ok() : no('Nothing to mark.');
  }

  function cancelHeld({ id }) {
    const r = d.cancelHeld?.(str(id));
    if (!r?.ok) return no('That has already gone.');
    d.sendOutlook?.();
    pushView();
    return ok();
  }

  function setPush(device, { subscription }) {
    if (subscription == null) {
      saveDevices(devices().map(dv => (dv.id === device.id ? { ...dv, push: null } : dv)));
      d.send(d.panel, 'pocket', pocketViewNow());
      return ok({ push: false });
    }
    if (!vapidKeys()) return no("Windows can't keep the notification key safe on this PC, so notifications are off.");
    const sub = push.normalizeSubscription(subscription);
    if (!sub) return no("That browser's push service isn't one Shellby knows.");
    saveDevices(devices().map(dv => (dv.id === device.id ? { ...dv, push: sub } : dv)));
    d.send(d.panel, 'pocket', pocketViewNow());
    return ok({ push: true });
  }

  function forget(deviceId, reason = 'This phone was forgotten.') {
    const list = devices();
    const gone = list.find(dv => dv.id === deviceId);
    if (!gone) return no('That phone has already gone.');
    saveDevices(list.filter(dv => dv.id !== deviceId));
    d.pocket?.dropDevice(deviceId, reason);
    d.log.info(`pocket: forgot ${gone.name}`);
    d.send(d.panel, 'pocket', pocketViewNow());
    return ok();
  }

  // ---- push notifications (pocket/notices.js)

  const { notify, noticeWork, testPush, badge } = createPocketNotices(d, {
    settings, devices, saveDevices, vapidKeys, waitingPrompts,
    changed: () => d.send(d.panel, 'pocket', pocketViewNow()),
  });

  // ---- on and off (the panel asks; the confirmation window decides)

  // The server, listening (or not, and why) before Settings is told how it went.
  function listen() {
    if (d.pocket.status === 'listening') return Promise.resolve();
    return new Promise(resolve => {
      d.pocket.once('status', () => resolve());
      d.pocket.start();
    });
  }

  async function start() {
    problem = null;
    vapidKeys(); // the phone needs the key to turn notifications on, after a restart too
    await listen();
    if (d.pocket.status !== 'listening') return;
    // Our port behind Tailscale's https, unless it already is.
    const port = d.pocket.port;
    if (!serve.httpsPort) {
      const httpsPort = pickHttpsPort(serve);
      if (!httpsPort) { problem = { text: 'Tailscale already serves something else on every port it offers. Free 443 and try again.' }; return; }
      const r = await tailscale.serveOn({ port, httpsPort });
      if (!r.ok) {
        // "Serve is not enabled on your tailnet" comes with the page that turns it on.
        problem = { text: `Tailscale didn't put Shellby on your tailnet: ${r.error}`, link: r.link || null, linkText: r.link ? 'Turn on Serve' : null };
        d.log.warn('pocket: serve failed', r.error);
      } else save({ servedPort: httpsPort });
      await refreshTailscale({ fresh: true });
    }
    if (serve.funnel) {
      d.pocket.stop();
      problem = { text: 'Tailscale Funnel is on for this address. Turn it off first: Shellby only serves your phone on your own tailnet.' };
    }
    watch();
  }

  function watch() {
    clearInterval(watcher);
    clearInterval(ticker);
    watcher = setInterval(() => { refreshTailscale().catch(() => {}); }, WATCH_MS);
    ticker = setInterval(() => { pushView(); }, TICK_MS);
    watcher.unref?.();
    ticker.unref?.();
  }

  async function stopServing() {
    clearInterval(watcher);
    clearInterval(ticker);
    watcher = ticker = null;
    d.pocket?.stop();
    await takeServeBack();
  }

  // Only what Shellby asked Tailscale for itself, and only while it still points
  // at us. When Tailscale can't be asked (stopped, signed out), servedPort is
  // kept, and the next start of Shellby takes it back.
  async function takeServeBack() {
    const s = settings();
    if (!s.servedPort) return;
    await refreshTailscale({ fresh: true }).catch(() => {});
    if (ts.state !== 'running') { d.log.info('pocket: Tailscale is not running, so serve is taken back later'); return; }
    if (serve.httpsPort === s.servedPort) {
      const r = await tailscale.serveOff({ httpsPort: s.servedPort });
      if (!r.ok) { d.log.warn('pocket: serve off failed', r.error); return; }
    }
    save({ servedPort: 0 });
    await refreshTailscale({ fresh: true }).catch(() => {});
  }

  async function setPocket(patch = {}) {
    if (patch.enabled === false) {
      save({ enabled: false });
      code = null;
      await stopServing();
      return pocketView();
    }
    if (patch.allow && typeof patch.allow === 'object') {
      const next = { ...settings().allow };
      for (const k of ALLOW_KEYS) if (k in patch.allow) next[k] = patch.allow[k] === true;
      save({ allow: next });
      pushView();
      return pocketView();
    }
    if (patch.notify && typeof patch.notify === 'object') {
      const s = settings();
      const n = { ...s.notify };
      if ('enabled' in patch.notify) n.enabled = !!patch.notify.enabled;
      if ('whileFocused' in patch.notify) n.whileFocused = !!patch.notify.whileFocused;
      if ('working' in patch.notify) n.working = !!patch.notify.working;
      if (patch.notify.events && typeof patch.notify.events === 'object') {
        n.events = { ...n.events };
        for (const k of Object.keys(NOTIFY_DEFAULTS.events)) if (k in patch.notify.events) n.events[k] = !!patch.notify.events[k];
      }
      if ('minSeconds' in patch.notify) {
        const v = Number(patch.notify.minSeconds);
        if (Number.isFinite(v)) n.minSeconds = Math.min(3600, Math.max(0, Math.round(v)));
      }
      save({ notify: n });
      return pocketView();
    }
    if (patch.enabled === true) return enable();
    return pocketView();
  }

  async function enable() {
    await refreshTailscale();
    const missing = setupProblem();
    if (missing) return { ...(await pocketView()), error: missing.text };
    if (serve.funnel) return { ...(await pocketView()), error: 'Tailscale Funnel is on for this address. Turn it off first.' };
    const who = ts.login;
    d.wake();
    const response = await confirm.ask(d.panel, {
      ...d.dialogLook(), icon: '📱', danger: true,
      title: 'Put Shellby on your phone?',
      message: `Over your tailnet, at ${ts.dnsName}, for ${who}`.slice(0, 200),
      detail: [
        'A phone you pair can see your conversations as they happen, answer Allow or Deny, answer questions, approve plans, start tasks and routines, stop a turn, undo a turn and bring a copy home.',
        'Tasks from the phone always run in Ask first, so every edit and command still waits for your yes. Always allow and anything the card would warn you about stay at the desk.',
        `Only devices signed in to Tailscale as ${who} can reach it, and each phone needs a code from this screen to pair.`,
      ].join('\n\n'),
      note: 'Only say yes if you set this up yourself.',
      buttons: [{ label: 'Put him on my phone', style: 'danger' }, { label: 'Cancel' }], defaultId: 1, cancelId: 1,
    });
    if (response !== 0) return { ...(await pocketView()), cancelled: true };
    await refreshTailscale();
    if (setupProblem() || ts.login !== who) return { ...(await pocketView()), error: 'Tailscale changed while that was open. Try again.' };
    // A different account than last time: phones paired by the old one go.
    if (settings().login && settings().login.toLowerCase() !== who.toLowerCase()) saveDevices([]);
    save({ enabled: true, login: who, dnsName: ts.dnsName });
    vapidKeys();
    await start();
    d.log.info('pocket: on');
    return pocketView();
  }

  function newPairCode() {
    if (!settings().enabled || d.pocket?.status !== 'listening') return { ...pocketViewNow(), error: 'Turn it on first.' };
    code = pairing.openPairing(Date.now());
    return pocketViewNow();
  }

  function forgetDevice(id) {
    const r = forget(typeof id === 'string' ? id : '', 'This phone was forgotten from the PC.');
    return r.ok ? pocketViewNow() : { ...pocketViewNow(), error: r.error };
  }

  function showPocketSettings() {
    d.showPanel({ focusInput: false });
    d.send(d.panel, 'panel:view', 'settings');
    d.send(d.panel, 'panel:jump', 'On your phone');
  }

  // ---- what Settings shows

  function pocketViewNow() {
    const s = settings();
    const now = Date.now();
    const open = code && now <= code.expiresAt ? code : null;
    const address = url();
    return {
      enabled: s.enabled,
      server: d.pocket ? d.pocket.view() : { status: 'off', port: DEFAULT_PORT, connected: 0, streams: 0 },
      tailscale: { installed: ts.installed, state: ts.state, dnsName: ts.dnsName, login: ts.login, https: ts.https },
      owner: s.login,
      url: address,
      qr: address && s.enabled ? qrRows(address) : null,
      setup: setupProblem(),
      problem,
      funnel: !!serve.funnel,
      code: open ? { text: pairing.showCode(open.code), expiresAt: open.expiresAt, triesLeft: pairing.CODE_TRIES - open.tries } : null,
      devices: pairing.devicesView(devices(), now),
      notify: s.notify,
      allow: s.allow,
      eventLabels: EVENT_LABELS,
      canEncrypt: safeStorage.isEncryptionAvailable(),
    };
  }

  async function pocketView() {
    await refreshTailscale().catch(() => {});
    return pocketViewNow();
  }

  function createPocket() {
    d.pocket = new PocketServer({
      srcDir: path.join(__dirname, '..', '..'),
      assetsDir: path.join(d.ROOT, 'assets'),
      port: portFromEnv(process.env.SHELLBY_POCKET_PORT),
      getPlace: place,
      ownerLogin: () => settings().login,
      findDevice,
      onPair, onOpen, onAction, onDiff,
      onUpload: (_device, bytes) => (settings().enabled ? extra.savePhoto(bytes) : no('Shellby on your phone is off.')),
    });
    d.pocket.on('seen', onSeen);
    d.pocket.on('status', () => {
      lastView = '';
      pushView();
      d.send(d.panel, 'pocket', pocketViewNow());
    });
    d.manager.on('tabs', () => { pushView(); newTurns(); noticeWork(); });
    d.manager.on('aggregate', pushView);
    d.manager.on('item', onItem);
    if (settings().enabled) {
      // Back on after a restart: Tailscale first, so the address and the login are known.
      refreshTailscale().then(() => start()).catch(err => d.log.warn('pocket: could not start', err.message));
    } else if (settings().servedPort) {
      // Turned off while Tailscale couldn't be asked: take the serve back now.
      takeServeBack().catch(err => d.log.warn('pocket: could not take serve back', err.message));
    }
  }

  return {
    createPocket, forgetPocketDevice: forgetDevice, newPocketCode: newPairCode, pocketNotify: notify, pocketView, pocketViewNow,
    setPocket, testPocketPush: testPush,
  };
}

module.exports = { wirePocket, NOTIFY_DEFAULTS };
