// Pages on your phone (docs/plans/shellby-pages.md, section 6): the phone runs
// the page, the PC decides. wiring/pocket.js hands this the phone's calls.
//
//   pages        the shelf: every page, pinned first, with its miniature and
//                whether it opens here (marked "phone": true, on, agreed)
//   page-open    a short-lived capability for one page's files, as a URL the
//                app can put in a sandboxed iframe: /pages/<cap>/index.html
//   page-call    the bridge: one call from the page's frame, decided on the
//                PC by pages/rights.js like a call from the desk
//   page-info    its data (with who wrote each key) and its History, to look at
//   page-ask     you pressed Ask Claude on the phone's sheet: a task, under
//                the phone's limits, in Ask first or Plan
//   page-change  Change with Claude, as a task on the PC, under the same limits
//
// Why a capability: an <iframe> can't send the device token in a header, and
// a token never goes in a URL. So the app asks (with its token) for a cap: 32
// random bytes, bound to this phone and this page, good for a few minutes,
// enough to load the page's files. Every file answers with the same CSP the
// desk's protocol uses (pages/protocol.js), plus frame-ancestors 'self' so
// only the app can frame it, guard.js first, no-store, nosniff.
//
// A read-only phone may look at a page and read its data, and nothing else.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const format = require('../pages/format');
const protocol = require('../pages/protocol');
const pageRights = require('../pages/rights');
const { LIMITS } = require('../pages/limits');
const { rightsOf, READ_ONLY_SAYS } = require('./rights');

const CAP_TTL_MS = 15 * 60 * 1000;   // long enough to load a page and its files; the app asks again to reload
const CAPS_PER_DEVICE = 8;           // live at once: a phone flipping between pages, not a hoard
const CAP_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, base64url
const READ_METHODS = ['data.get', 'read']; // what a read-only phone's page may still call
const INFO_ACTIVITY = 20;
const PAGE_CSP = `${protocol.CSP}; frame-ancestors 'self'`;
const PAGE_CSP_INERT = `${protocol.CSP_INERT}; frame-ancestors 'self'`;
const PAGE_SIDE = path.join(__dirname, '..', 'pages', 'page-side');
const DESK_ONLY = "Claude built this one for a wide screen, so it doesn't open here yet. Ask him to make it fit a phone and it opens here next time.";
const NOT_SERVED = 'This page is off, or waiting for your OK at the desk.';
// On a phone, guard.js is the only thing between a page and WebRTC (the desk also
// turns WebRTC's UDP off for every window), and that hasn't been checked in Safari
// or mobile Chrome. So a page that reads your PC's own data (usage, git, your
// conversations) opens at the desk only, for now: it has the most worth sending out.
const READS_AT_DESK = "This page reads things from your PC, so for now it opens only at the desk. Pages that keep to their own data open here.";
const ASK_EVERY_MS = 30 * 1000; // one ask a page in this long, whatever its frame does

const ok = extra => ({ ok: true, ...extra });
const no = error => ({ ok: false, error });
const clip = (s, n) => String(s ?? '').slice(0, n);

/**
 * d: main's shared deps (d.pages from wiring/pages.js).
 *   devices():           the paired phones, as they are now
 *   claimStart(opts):    a place under the phone's hourly and at-once limits -> { ok } | { ok: false, reply }
 *   adopt(tabId):        the conversation is the phone's (📱)
 *   pushView():          the view changed
 *   once(kind, body, start): a task asked again with the same key starts once
 *   notifyPage(p):       a push to every phone, named after the page (pocket/notices.js)
 *   server():            the PocketServer, for events to phones watching a page
 */
function createPocketPages(d, { devices, claimStart, adopt, pushView, once, notifyPage, server, now = Date.now }) {
  /** @type {Map<string, { deviceId: string, pageId: string, expiresAt: number }>} */
  const caps = new Map();
  const sideFiles = {
    'shellby.js': fs.readFileSync(path.join(PAGE_SIDE, 'shellby.js'), 'utf8'),
    'guard.js': fs.readFileSync(path.join(PAGE_SIDE, 'guard.js'), 'utf8'),
  };
  const notified = new Map(); // page id -> when its last push went
  const asked = new Map();    // page id -> when its last ask went to a phone's sheet

  const on = () => !!d.pages?.enabled();
  const store = () => d.pages.store();
  const deviceOf = id => devices().find(dv => dv.id === id) || null;
  // Forgotten between the server's check and here: no rights at all (not the default's full).
  const fullRights = id => { const dv = deviceOf(id); return !!dv && rightsOf(dv) === 'full'; };
  const readsPC = id => (store().access(id)?.read || []).length > 0;

  /** Whether a page opens on a phone: a real page, marked for the phone, on, and agreed. */
  function phoneReady(id) {
    if (!on() || !format.isId(id)) return false;
    const s = store();
    if (!s.known(id)) return false;
    return s.manifest(id)?.phone === true && d.pages.servable(id) && !readsPC(id);
  }

  /** One page for the shelf: the desk's summary, clipped, with its miniature and whether it opens here. */
  function tile(p) {
    const s = store();
    const t = s.thumb(p.id);
    return {
      id: p.id, name: clip(p.name, LIMITS.NAME), description: clip(p.description, LIMITS.DESCRIPTION), icon: clip(p.icon, 4),
      pinned: !!p.pinned, phone: !!p.phone, enabled: !!p.enabled, needsOk: !!p.needsOk, wants: p.wants || null, broken: !!p.broken,
      updatedAt: Number(p.updatedAt) || 0, lastChange: p.lastChange ? { text: clip(p.lastChange.text, 120), at: Number(p.lastChange.at) || 0 } : null,
      ready: phoneReady(p.id), atDesk: !!p.phone && readsPC(p.id),
      thumb: t ? `data:image/jpeg;base64,${t.toString('base64')}` : null,
    };
  }

  // ---- the shelf

  function pages() {
    if (!on()) return ok({ on: false, pages: [] });
    return ok({ on: true, pages: store().list().map(tile) });
  }

  // ---- opening a page: a capability for its files

  function issue(deviceId, pageId) {
    const t = now();
    for (const [cap, c] of caps) if (c.expiresAt <= t) caps.delete(cap);
    const mine = [...caps].filter(([, c]) => c.deviceId === deviceId);
    for (const [cap] of mine.slice(0, Math.max(0, mine.length + 1 - CAPS_PER_DEVICE))) caps.delete(cap);
    const cap = crypto.randomBytes(32).toString('base64url');
    const expiresAt = t + CAP_TTL_MS;
    caps.set(cap, { deviceId, pageId, expiresAt });
    return { cap, expiresAt };
  }

  function pageOpen({ id }, device) {
    if (!on()) return no('Pages are off on your PC.');
    const s = store();
    if (!format.isId(id) || !s.known(id)) return no('No such page.');
    const man = s.manifest(id);
    const page = tile(s.summary(id));
    if (!man?.phone) return { ok: false, desk: true, error: DESK_ONLY, page };
    if (readsPC(id)) return { ok: false, desk: true, reads: true, error: READS_AT_DESK, page };
    if (!d.pages.servable(id)) return { ok: false, error: NOT_SERVED, page };
    const { cap, expiresAt } = issue(device.id, id);
    // Its data too: the app keeps a snapshot of it (the service worker's cache) for when the PC is asleep.
    return ok({ url: `/pages/${cap}/index.html`, expiresAt, page, values: s.read(id).values || {} });
  }

  /**
   * One request for a page's file, by its capability: /pages/<cap>/<file>.
   * -> { status, type, body, headers } (pocket/server.js writes it out).
   */
  function serve(route) {
    const m = /^\/pages\/([^/]+)(?:\/(.*))?$/.exec(String(route || ''));
    const gone = { status: 404, type: 'text/plain', body: 'Not found.', headers: { ...protocol.HEADERS, 'Content-Security-Policy': PAGE_CSP_INERT } };
    if (!m || !CAP_RE.test(m[1])) return gone;
    const cap = m[1];
    const c = caps.get(cap);
    if (!c) return gone;
    if (c.expiresAt <= now()) { caps.delete(cap); return gone; }
    // Forgotten since, or the page turned off or made desk-only meanwhile: the cap is spent.
    if (!deviceOf(c.deviceId) || !phoneReady(c.pageId)) { caps.delete(cap); return gone; }
    const s = store();
    const a = protocol.answer(`${protocol.SCHEME}://${c.pageId}/${m[2] || ''}`, { known: id => s.known(id), servable: id => phoneReady(id), readFile: (id, name) => s.readFile(id, name) }, sideFiles);
    const csp = a.type === 'text/html' || a.type === 'text/javascript' ? PAGE_CSP : PAGE_CSP_INERT;
    return { ...a, headers: { ...protocol.HEADERS, 'Content-Security-Policy': csp } };
  }

  // ---- the bridge

  async function pageCall({ id, method, args }, device) {
    if (!on()) return no('Pages are off on your PC.');
    if (!format.isId(id) || !phoneReady(id)) return no("That page isn't open on a phone.");
    const name = clip(method, 20);
    if (!pageRights.METHODS.includes(name)) return no(`shellby has no "${name}".`);
    if (!fullRights(device.id) && !READ_METHODS.includes(name)) return no(READ_ONLY_SAYS);
    if (name === 'ask' && now() - (asked.get(id) || 0) < ASK_EVERY_MS) return no('This page asked just now. It can ask again in a moment.');
    const list = Array.isArray(args) ? args.slice(0, 10) : [];
    const r = await d.pages.call(id, name, list, 'phone');
    if (r.ok && r.ask) asked.set(id, now());
    return r.ok ? ok({ value: r.value, ...(r.ask ? { ask: r.ask } : {}) }) : no(r.error || 'Refused.');
  }

  // ---- its data and History, to look at

  function pageInfo({ id }) {
    if (!on()) return no('Pages are off on your PC.');
    const s = store();
    if (!format.isId(id) || !s.known(id)) return no('No such page.');
    // Its data is the page's to show once you've agreed to it at the desk: not one that's off or waiting.
    if (!d.pages.servable(id)) return no(NOT_SERVED);
    const sum = s.summary(id);
    if (!sum) return no('No such page.');
    const r = s.read(id);
    const st = s.state(id);
    return ok({
      page: tile(sum),
      values: r.values || {}, by: r.by || {},
      words: format.accessWords(s.manifest(id)?.access).map(w => clip(w.text, 120)),
      versions: st.versions.slice().reverse().map(v => ({ n: v.n, at: v.at, who: { kind: v.who.kind, name: clip(v.who.name, 80) }, why: clip(v.why, LIMITS.WHY), current: v.n === st.version })),
      activity: s.activity(id).slice(-INFO_ACTIVITY).reverse().map(a => ({ at: a.at, who: { kind: a.who.kind, name: clip(a.who.name, 80) }, text: clip(a.text, 200) })),
    });
  }

  // ---- Ask Claude, from the phone's sheet; Change with Claude

  // A task, as a phone task: under the hourly and at-once limits, marked 📱, and never with the panel pulled up.
  function startFor(id, run) {
    const gate = claimStart();
    if (!gate.ok) return no(gate.reply);
    const r = run();
    if (!r?.ok) return no(r?.error || "Couldn't start it.");
    adopt(r.tabId);
    pushView();
    return ok({ tabId: r.tabId });
  }

  function pageAsk(body, device) {
    return once('page-ask', body, ({ id, prompt, mode }) => {
      if (!on()) return no('Pages are off on your PC.');
      if (!format.isId(id) || !phoneReady(id)) return no("That page isn't open on a phone.");
      if (!fullRights(device.id)) return no(READ_ONLY_SAYS);
      const s = store();
      // The same decision the desk makes for a page's ask: it has that access, and the mode is Ask first or Plan.
      const verdict = pageRights.decide('ask', [prompt, { mode }], { access: s.access(id), draft: false, enabled: true });
      if (!verdict.ok) return no(verdict.error);
      return startFor(id, () => d.pages.ask(id, verdict.args[0], verdict.args[1].mode, { show: false }));
    });
  }

  function pageChange(body, device) {
    return once('page-change', body, ({ id }) => {
      if (!on()) return no('Pages are off on your PC.');
      if (!format.isId(id) || !store().known(id)) return no('No such page.');
      if (!fullRights(device.id)) return no(READ_ONLY_SAYS);
      return startFor(id, () => d.pages.change(id, {}, { show: false }));
    });
  }

  // ---- what changed on the PC, to the phones

  const SHELF_KINDS = ['meta', 'list', 'files', 'saved', 'removed', 'data'];
  function onChanged(ev) {
    if (!ev || typeof ev !== 'object') return;
    const srv = server();
    if (ev.kind === 'notify' && format.isId(ev.id)) { pushNotify(ev); return; }
    if (ev.id && !format.isId(ev.id)) return; // a draft: never on a phone
    if (!srv) return;
    if (ev.id) {
      const out = { id: ev.id, kind: ev.kind };
      // A page's data goes to phones only once you've agreed to the page (not one that's off or waiting).
      if (ev.kind === 'data' && ev.change && d.pages.servable(ev.id)) out.change = { keys: ev.change.keys, values: ev.change.values, who: ev.change.who, text: ev.change.text };
      if (ev.kind === 'files') out.version = ev.version;
      srv.pageEvent?.(ev.id, out);
    }
    if (SHELF_KINDS.includes(ev.kind)) srv.pagesEvent?.({ id: ev.id || null, kind: ev.kind, at: now() });
  }

  /** A page's notify, or an agent's write to a page that asked for notify: one push a minute per page, named after the page. */
  function pushNotify(ev) {
    const t = now();
    if (t - (notified.get(ev.id) || 0) < 60_000) return;
    const man = store().manifest(ev.id);
    if (!man) return;
    notified.set(ev.id, t);
    notifyPage({ id: ev.id, name: man.name, title: clip(ev.title, 80), body: clip(ev.body, 200) });
  }

  // Hearing the desk's changes from the start: wiring/pages.js is wired before the phone is.
  const stop = d.pages?.onChanged ? d.pages.onChanged(onChanged) : () => {};

  const actions = { pages, 'page-open': pageOpen, 'page-call': pageCall, 'page-info': pageInfo, 'page-ask': pageAsk, 'page-change': pageChange };
  return { actions, serve, stop, phoneReady, caps: () => caps.size };
}

module.exports = { createPocketPages, CAP_TTL_MS, CAPS_PER_DEVICE, READ_METHODS, PAGE_CSP, PAGE_CSP_INERT, DESK_ONLY, READS_AT_DESK, ASK_EVERY_MS };
