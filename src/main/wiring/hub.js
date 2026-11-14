// The hub: this PC watching and starting work on your other PCs (docs/HUB.md).
//
// Each other PC runs Shellby with "On your phone" on, so it already serves
// what it's doing on your tailnet (pocket/server.js). The hub pairs with it
// like a phone does, with the code that PC shows, and from then on reads its
// view live (hub/link.js) and builds the roster from it (hub/roster.js).
// Starting a task there goes through that PC's own task rules and limits,
// exactly as one from your phone would.
//
// Each PC's token is sealed by Windows (safeStorage) before it's saved, and
// unsealed only to make a request. Removing a PC asks it to forget the hub
// first, so no token is left working over there.
//
// What a PC last said about itself (its Windows, agents, projects, when it was
// last seen) is kept, so one that's asleep still shows what it can run.
// Kept out of main.js, which only wires it up.
const os = require('os');
const { safeStorage } = require('electron');
const peers = require('../hub/peers');
const { PeerLink, pair } = require('../hub/link');
const { roster, summaryOf } = require('../hub/roster');
const { hostReader } = require('../hub/host');
const { phoneHost, line } = require('../pocket/view');

const PUSH_MS = 1000;            // the panel hears about changes this often at most
const SNAPSHOT_EVERY_MS = 5 * 60 * 1000;
const THIS_ID = 'this';
const MAX_SNAPSHOT_PROJECTS = 20;

/**
 * What a PC said about itself, cut down to what the roster shows while it's
 * asleep, whatever it sent: its own facts as the phone view cleans them, a few
 * projects' names and keys, its name. Used both to save and to read back.
 */
function snapshotOf(raw, seenAt) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {
    seenAt: Number.isFinite(seenAt) ? seenAt : null,
    host: phoneHost(raw.host),
    projects: (Array.isArray(raw.projects) ? raw.projects.slice(0, MAX_SNAPSHOT_PROJECTS) : [])
      .filter(p => p && typeof p === 'object').map(p => ({ key: line(p.key, 600), name: line(p.name, 80) })).filter(p => p.key),
    pc: line(raw.pc, 80),
  };
}

/** d: what main shares (main.js `shared`). */
function wireHub(d) {
  /** @type {Map<string, InstanceType<typeof PeerLink>>} */
  const links = new Map();
  /** @type {Map<string, string>} unsealed tokens, kept only in memory */
  const tokens = new Map();
  /** @type {ReturnType<typeof setTimeout> | null} */
  let pushTimer = null;
  const snapshotAt = new Map();
  const adding = new Set(); // addresses being paired now: one at a time each

  const list = () => peers.normalize(d.config.get('hubPeers'));
  const save = next => d.config.set({ hubPeers: next });
  // Read back checked like anything else from another PC: a bad one is dropped, never trusted.
  const snapshots = () => {
    const s = d.config.get('hubSeen');
    if (!s || typeof s !== 'object' || Array.isArray(s)) return {};
    const ids = new Set(list().map(p => p.id));
    return Object.fromEntries(Object.entries(s).filter(([id]) => ids.has(id)).map(([id, v]) => [id, snapshotOf(v, v?.seenAt)]).filter(([, v]) => v));
  };
  const thisName = () => d.config.get('hubName') || os.hostname();

  function tokenOf(peer) {
    if (tokens.has(peer.id)) return tokens.get(peer.id) ?? null;
    try {
      const t = safeStorage.decryptString(Buffer.from(peer.token, 'base64'));
      tokens.set(peer.id, t);
      return t;
    } catch {
      return null; // sealed by another Windows account, or the store was reset: pair again
    }
  }

  function push() {
    if (pushTimer) return;
    pushTimer = setTimeout(() => { pushTimer = null; d.send(d.panel, 'hub:changed'); }, PUSH_MS);
    pushTimer.unref?.();
  }

  /** What a PC said about itself, kept small: enough to show it while it's asleep. */
  function remember(id, view) {
    const now = Date.now();
    if (now - (snapshotAt.get(id) || 0) < SNAPSHOT_EVERY_MS) return;
    snapshotAt.set(id, now);
    const snap = snapshotOf(view, now);
    if (snap) d.config.set({ hubSeen: { ...snapshots(), [id]: snap } });
  }

  function linkFor(peer) {
    const link = new PeerLink({ origin: peer.origin, token: () => tokenOf(peer) });
    link.on('change', push);
    link.on('view', view => { remember(peer.id, view); push(); });
    links.set(peer.id, link);
    link.start();
    return link;
  }

  function startHub() {
    for (const p of list()) if (!links.has(p.id)) linkFor(p);
  }

  function stopHub() {
    for (const link of links.values()) link.stop();
    links.clear();
  }

  // ---- what the panel shows

  function hubView() {
    const now = Date.now();
    const seen = snapshots();
    /** @type {any} this PC's phone view (pocket/view.js phoneView) */
    let own = null;
    try { own = d.pocketCurrentView?.() || null; } catch (e) { d.log.warn('hub: this PC\'s view', e.message); }
    /** @type {Parameters<typeof roster>[0]} */
    const entries = [{ id: THIS_ID, name: thisName(), kind: 'this', state: 'online', view: own }];
    for (const p of list()) {
      const link = links.get(p.id);
      const last = seen[p.id];
      // Never reached since Shellby started: what it said last time, faded.
      const view = link?.view || (last ? { host: last.host, projects: last.projects, pc: last.pc } : null);
      entries.push({ id: p.id, name: p.name, kind: 'pc', state: link?.state || 'connecting', error: link?.error || null, seenAt: link?.seenAt || last?.seenAt || null, view });
    }
    const rows = roster(entries, now);
    return { rows, summary: summaryOf(rows), usage: own?.usage || null };
  }

  // ---- what the panel can do

  async function addPc({ address, code, name }) {
    const origin = peers.originOf(address);
    if (!origin) return { ok: false, error: "That isn't a Tailscale address. It looks like desk.your-tailnet.ts.net: that PC shows it in Settings, Alerts, On your phone." };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: "Windows can't keep the pairing safe on this PC, so the hub can't add one." };
    // Checked before pairing, so a full hub never leaves a token working on a PC it then can't keep.
    if (list().length >= peers.MAX_PEERS && !list().some(p => p.origin === origin)) return { ok: false, error: `The hub keeps up to ${peers.MAX_PEERS} PCs. Remove one first.` };
    if (adding.has(origin)) return { ok: false, error: 'That PC is being added already.' };
    adding.add(origin);
    try {
      return await pairAndKeep(origin, code, name);
    } finally {
      adding.delete(origin);
    }
  }

  async function pairAndKeep(origin, code, name) {
    const r = await pair({ origin, code, name: `${thisName()} (Shellby hub)` });
    if (!r.ok) return r;
    const sealed = safeStorage.encryptString(r.token).toString('base64');
    const added = peers.add(list(), { origin, name, token: sealed, now: Date.now() });
    if (!added.list) return { ok: false, error: added.error || "Couldn't add that PC." };
    save(added.list);
    const peer = added.list.find(p => p.origin === origin);
    if (!peer) return { ok: false, error: "Couldn't add that PC." };
    links.get(peer.id)?.stop();
    tokens.set(peer.id, r.token);
    linkFor(peer);
    d.log.info(`hub: paired ${peer.name}`);
    push();
    return { ok: true, id: peer.id };
  }

  async function removePc(id) {
    const peer = list().find(p => p.id === id);
    if (!peer) return { ok: false, error: 'That PC has gone already.' };
    const link = links.get(id);
    // Asked to forget us first, so the token stops working there too. A PC that's
    // asleep can't hear it: it says so, and its own Settings can forget the hub later.
    const forgot = link ? await link.act('forget', {}) : { ok: false };
    link?.stop();
    links.delete(id);
    tokens.delete(id);
    save(peers.remove(list(), id));
    const seen = { ...snapshots() };
    delete seen[id];
    d.config.set({ hubSeen: seen });
    push();
    return { ok: true, forgotThere: !!forgot?.ok };
  }

  function renamePc(id, name) {
    if (id === THIS_ID) {
      const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (clean) d.config.set({ hubName: clean });
    } else save(peers.rename(list(), id, name));
    push();
    return { ok: true };
  }

  /** A task on another PC, through its own phone-task rules: its project list, its limits, its modes. */
  async function startOn(id, { project, text, mode }) {
    const link = links.get(id);
    if (!link) return { ok: false, error: 'That PC has gone.' };
    if (link.state !== 'online') return { ok: false, error: link.error || "That PC isn't reachable right now." };
    return link.act('task', { project, text, mode, when: 'now' });
  }

  function retryAll() {
    for (const link of links.values()) link.retryNow();
    push();
    return { ok: true };
  }

  // This PC's own facts (Windows, Shellby, memory, disk, agents), in the view it serves its phones and other
  // hubs (wiring/pocket.js), so a hub on another PC can show this one in its roster too.
  const hostNow = hostReader({ claudeInstalled: () => !!d.claudeStatus?.installed });

  return { hostNow, hub: { startHub, stopHub, hubView, addPc, removePc, renamePc, startOn, retryAll, THIS_ID } };
}

module.exports = { wireHub };
