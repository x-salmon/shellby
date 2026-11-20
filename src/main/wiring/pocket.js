// Shellby on your phone (pocket/): the server, Tailscale, pairing, push, and
// what each tap on the phone does. Kept out of main.js, which only wires it up.
//
// Off until turned on in Settings → On your phone (the confirmation window asks).
// On, it serves 127.0.0.1:47916 and Tailscale serves that on your tailnet
// (pocket/serving.js).
//
// The phone does what the desk does, through the same functions, under the
// phone's rules (docs/PHONE.md, pocket/actions.js): what appCaution warns about allowed once (never always), tasks in the mode
// and on the model picked, at most 30 an hour and 10 at once, and nothing at all from a phone set
// to read-only at the desk (pocket/rights.js).
const { app, safeStorage } = require('electron');
const path = require('path');
const attach = require('../attachments');
const confirm = require('../confirm');
const guard = require('../guard');
const pt = require('../channels/phone-tasks');
const { EVENTS } = require('../channels/messages');
const { models } = require('../models');
const { qrRows } = require('../qr');

const pairing = require('../pocket/pairing');
const push = require('../pocket/push');
const { PocketServer, DEFAULT_PORT } = require('../pocket/server');
const { createTailscale } = require('../pocket/tailscale');
const { createPocketServing } = require('../pocket/serving');
const view = require('../pocket/view');
const { createPocketExtras } = require('../pocket/extras');
const { createPocketNotices } = require('../pocket/notices');
const { createPocketReview } = require('../pocket/review');
const quiet = require('../pocket/quiet');
const rights = require('../pocket/rights');
const { createPocketActions, APP_MAX_OPEN, APP_STARTS_PER_HOUR } = require('../pocket/actions');

const SEEN_SAVE_MS = 5 * 60 * 1000;  // "last seen" goes to disk this often at most
// The phone app's notifications start as the phone channels do: the same events, on by the same defaults.
const NOTIFY_DEFAULTS = { enabled: true, events: Object.fromEntries(Object.entries(EVENTS).map(([k, e]) => [k, e.default])), minSeconds: 60, whileFocused: false, working: false };
const EVENT_LABELS = Object.fromEntries(Object.entries(EVENTS).map(([k, e]) => [k, e.label]));
// Off until you tick them in Settings → On your phone:
//   push:      push a conversation's branch after bringing it home
//   files:     read a conversation's files, read-only
//   notifyAnswers: Allow and Deny on a prompt's notification (Android), which can work from a locked phone
const ALLOW_KEYS = ['push', 'files', 'notifyAnswers', 'otherPcs']; // otherPcs: what's waiting on your other PCs, answered through this one (the hub)

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
  /** @type {ReturnType<typeof pairing.openPairing> | null} */ let code = null;          // the pairing window: { code, expiresAt, tries }
  /** @type {ReturnType<typeof push.newVapidKeys> | null} */ let vapid = null;
  let lastView = '';
  const lastTurn = new Map(); // watched tab -> the turn whose message the phone has
  // Focus, routines, notes, the wardrobe, files and photos (pocket/extras.js).
  const extra = createPocketExtras(d, {
    allowed: key => !!settings().allow[key],
    tabRoot: id => { const tab = id && d.manager?.tabs.get(id); return tab?.session?.cwd || null; },
  });
  // Search and history, "while you were away", checks with Fix it, and the whole branch (pocket/review.js).
  const review = createPocketReview(d, {
    projects: () => projects(),
    prompts: () => waitingPrompts(),
    reply: body => actions.reply(body), // actions is made further down; called only later
    maxText: pt.MAX_TEXT,
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
      quiet: quiet.normalizeQuiet(r.quiet),
    };
  }
  const save = patch => d.config.set({ pocket: { ...d.config.get('pocket'), ...patch } });
  const devices = () => pairing.normalizeDevices(d.config.get('pocketDevices'));
  const saveDevices = list => d.config.set({ pocketDevices: list });
  // A phone's rights as they are now: a stream's device record is from when it opened.
  const rightsOf = deviceId => rights.rightsOf(devices().find(dv => dv.id === deviceId));

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

  // ---- Tailscale, and our port on the tailnet (pocket/serving.js)

  const tail = createPocketServing(d, { tailscale, settings, save, vapidKeys, pushView: () => pushView() });
  const { refreshTailscale, setupProblem } = tail;

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
      out[id] = {
        mode: tab.session.mode || null, fromPhone: !!(tab.fromPocket || tab.fromPhone), canReply: !tab.inTerminal,
        effort: tab.session.effort || '', checksRunning: d.checksRunning?.(id) || null,
      };
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

  const locals = require('../pocket/locals').createLocals({ settings: () => d.config.get('localModel'), onChange: () => pushView(), log: d.log }); // local models a phone task can start on
  // Your other PCs as the hub sees them (wiring/hub.js), each with its own address, when the desk allows it.
  function otherPcs() {
    if (!settings().allow.otherPcs || !d.hub) return [];
    const origins = new Map((d.config.get('hubPeers') || []).map(p => [p?.id, p?.origin]));
    try {
      return d.hub.hubView(null, { plans: true }).rows.filter(r => r.kind === 'pc').map(r => ({ ...r, url: origins.get(r.id) || null }));
    } catch (e) { d.log.warn('pocket: other PCs', e.message); return []; }
  }
  d.pocketHubChanged = () => pushView();

  function currentView() {
    const ts = tail.ts();
    return view.phoneView({
      pc: ts.dnsName ? ts.dnsName.split('.')[0] : require('os').hostname(), pcs: d.config.get('hubPeers'), // pcs: only names and addresses reach the phone (view.js phonePcs)
      others: otherPcs(),
      tabs: d.manager?.summary || [],
      prompts: waitingPrompts(),
      crab: crab(),
      extras: extras(),
      outlook: d.outlookView?.() || null,
      lastUsage: d.config.get('lastUsage'),
      held: d.heldService?.heldViews() || [],
      projects: projects(),
      skin: d.activeSkin?.() || null,
      limits: { perHour: APP_STARTS_PER_HOUR, atOnce: APP_MAX_OPEN, open: actions.openCount() },
      pushKey: vapid?.publicKey || null,
      allow: settings().allow,
      mode: d.config.get('mode'),
      models: models(), model: d.config.get('model') || null, locals: locals.names(),
      focus: d.focusState?.() || null,
      guard: guard.settingsOf(k => d.config.get(k)),
      quiet: settings().quiet,
      health: d.health?.monitor?.latest || null,
      mood: d.healthMood || null, host: d.hostNow?.() || null, // host: the PC itself, for the hub's roster (wiring/hub.js)
      now: Date.now(),
    });
  }

  // The same view, with this phone's own rights on it (the app hides what it can't use).
  const viewFor = (v, device) => ({ ...v, rights: rightsOf(device.id) });

  function onOpen(device, { tab }) {
    const out = { view: viewFor(currentView(), device) };
    if (tab && d.manager?.tabs.has(tab)) {
      out.items = view.phoneItems(d.history.load(tab));
      lastTurn.set(tab, d.manager.tabs.get(tab).turnId || null);
    }
    return out;
  }

  // Every change: the whole view goes out, when it looks different.
  /** @type {NodeJS.Timeout | null} */ let pending = null;
  function pushView() {
    if (pending || !d.pocket || d.pocket.status !== 'listening' || !d.pocket.clients.size) return;
    pending = setTimeout(() => {
      pending = null;
      if (!d.pocket?.clients.size) return;
      const v = currentView();
      const said = JSON.stringify({ ...v, at: 0 });
      if (said === lastView) return;
      lastView = said;
      d.pocket.broadcast(v, viewFor);
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

  // ---- push notifications (pocket/notices.js)

  const settingsChanged = () => d.send(d.panel, 'pocket', pocketViewNow());
  const { notify, notifyPage, noticeWork, testPush, badge } = createPocketNotices(d, {
    settings, devices, saveDevices, vapidKeys, waitingPrompts,
    changed: settingsChanged,
  });

  // ---- what the phone does (pocket/actions.js)

  const actions = createPocketActions(d, {
    settings, save, devices, saveDevices, vapidKeys, extra, review, locals, projects, lastTurn, notifyPage,
    pushView: () => pushView(),
    changed: settingsChanged,
    resend: () => { lastView = ''; pushView(); },
  });

  // ---- on and off (the panel asks; the confirmation window decides)

  async function setPocket(patch = {}) {
    if (patch.enabled === false) {
      save({ enabled: false });
      code = null;
      await tail.stopServing();
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
    if (patch.quiet && typeof patch.quiet === 'object') {
      const r = actions.setQuiet(patch.quiet);
      return r.ok ? pocketView() : { ...(await pocketView()), error: r.error };
    }
    if (patch.device && typeof patch.device === 'object') {
      const r = actions.setDeviceRights(patch.device);
      return r.ok ? pocketView() : { ...(await pocketView()), error: r.error };
    }
    if (patch.enabled === true) return enable();
    return pocketView();
  }

  async function enable() {
    await refreshTailscale();
    const missing = setupProblem();
    if (missing) return { ...(await pocketView()), error: missing.text };
    if (tail.serve().funnel) return { ...(await pocketView()), error: 'Tailscale Funnel is on for this address. Turn it off first.' };
    const ts = tail.ts();
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
    if (setupProblem() || tail.ts().login !== who) return { ...(await pocketView()), error: 'Tailscale changed while that was open. Try again.' };
    // A different account than last time: phones paired by the old one go.
    if (settings().login && settings().login.toLowerCase() !== who.toLowerCase()) saveDevices([]);
    save({ enabled: true, login: who, dnsName: tail.ts().dnsName });
    vapidKeys();
    await tail.start();
    d.log.info('pocket: on');
    return pocketView();
  }

  function newPairCode() {
    if (!settings().enabled || d.pocket?.status !== 'listening') return { ...pocketViewNow(), error: 'Turn it on first.' };
    code = pairing.openPairing(Date.now());
    return pocketViewNow();
  }

  function forgetDevice(id) {
    const r = actions.forget(typeof id === 'string' ? id : '', 'This phone was forgotten from the PC.');
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
    const address = tail.url();
    const ts = tail.ts();
    return {
      enabled: s.enabled,
      server: d.pocket ? d.pocket.view() : { status: 'off', port: DEFAULT_PORT, connected: 0, streams: 0 },
      tailscale: { installed: ts.installed, state: ts.state, dnsName: ts.dnsName, login: ts.login, https: ts.https },
      owner: s.login,
      url: address,
      qr: address && s.enabled ? qrRows(address) : null,
      setup: setupProblem(),
      problem: tail.problem(),
      funnel: !!tail.serve().funnel,
      code: open ? { text: pairing.showCode(open.code), expiresAt: open.expiresAt, triesLeft: pairing.CODE_TRIES - open.tries } : null,
      devices: pairing.devicesView(devices(), now),
      notify: s.notify,
      allow: s.allow,
      quiet: s.quiet,
      rightsLevels: rights.RIGHTS,
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
      getPlace: tail.place,
      ownerLogin: () => settings().login,
      findDevice,
      onPair, onOpen, onAction: actions.onAction, onDiff: actions.onDiff, onPicture: require('../pocket/pictures').createPocketPictures(d).onPicture, onPage: actions.onPage,
      onUpload: actions.onUpload,
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
      refreshTailscale().then(() => tail.start()).catch(err => d.log.warn('pocket: could not start', err.message));
    } else if (settings().servedPort) {
      // Turned off while Tailscale couldn't be asked: take the serve back now.
      tail.takeServeBack().catch(err => d.log.warn('pocket: could not take serve back', err.message));
    }
  }

  return {
    createPocket, forgetPocketDevice: forgetDevice, newPocketCode: newPairCode, pocketNotify: notify, pocketView, pocketViewNow, pocketCurrentView: currentView,
    setPocket, testPocketPush: testPush,
  };
}

module.exports = { wirePocket, NOTIFY_DEFAULTS };
