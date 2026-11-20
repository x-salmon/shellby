'use strict';

// The book on the panel: its view (names, friends, the tide event), the
// friends' board, his favourite catch following him round the desk, and what
// the page's buttons do. Made by wireBugdex (wiring/bugdex.js), which shares
// its state with it.

const bugdex = require('../bugdex');
const { speciesById } = require('../bugdex/species');
const events = require('../events');
const boards = require('../board');

/** A species the book itself named (a favourite, a gift): always one it knows. */
const known = id => /** @type {NonNullable<ReturnType<typeof speciesById>>} */ (speciesById(id));

/**
 *   d: what main shares; on, state, save, today: wireBugdex's;
 *   names: its project id -> name map (shared, by reference).
 */
function makePage({ d, on, state, save, names, today }) {
  function nameMap() {
    const out = {};
    try { for (const p of Object.values(d.stickerState?.()?.projects || {})) if (p?.id && p.name) out[p.id] = p.name; } catch { /* no stickers yet */ }
    for (const [id, name] of names) out[id] = name;
    return out;
  }

  // Friends whose cards share their Bugdex (github/card.js): their reports, on your page.
  const friendBooks = () => (d.config.get('friends')?.list || []).filter(f => f?.card?.bugdex).map(f => ({ login: f.login, bugdex: f.card.bugdex }));

  // The tide event going on (events.js), and when each one is next on, for the book's event bugs.
  function eventInfo() {
    const where = d.seasonsWhere?.() || {};
    const day = today();
    const a = d.activeEvent?.();
    const back = {};
    for (const ev of events.EVENTS) { const at = events.backOn(ev.id, day, where); if (at) back[ev.id] = at.getTime(); }
    return { on: a ? a.ev.id : null, back };
  }

  function view() {
    const tabs = new Set(d.manager ? [...d.manager.tabs.keys()] : []);
    return { ...bugdex.view(state(), Date.now(), { names: nameMap(), tabs, friends: friendBooks(), event: eventInfo() }), board: board() };
  }

  // The friends' board (board.js): only when you share your Bugdex, and someone else does too.
  function board() {
    if (!d.config.get('shareBugdex')) return null;
    const friends = friendBooks();
    if (!friends.length) return null;
    const now = Date.now();
    const b = boards.board({ me: { login: d.github?.view?.().login || null, month: bugdex.shared(state(), now).month }, friends, key: bugdex.monthKey(now) });
    const r = boards.settle(d.config.get('boardLast'), b);
    if (JSON.stringify(r.state) !== JSON.stringify(d.config.get('boardLast'))) d.config.set({ boardLast: r.state });
    if (r.ended) monthOver(r.ended);
    return b;
  }

  // A month on the board is over: where you finished goes in the journal, and first is a trophy.
  function monthOver(e) {
    d.log.info(`board: ${e.month} over, ${e.place} of ${e.of}`);
    d.life?.remember?.('board-month', { place: `${boards.ordinal(e.place)} of ${e.of}`, month: e.month });
    if (e.place === 1) {
      d.stat('board-won');
      d.send(d.panel, 'life:moment', { eyebrow: 'The friends\' board', icon: '🥇', title: `Top crab in ${e.month}`, text: `More bugs fixed than any of your ${e.of - 1} friends on the board.` });
    }
  }

  // His favourite catch follows him round the desk (critter.js #buddy): its art, or null.
  /** @type {string | null} */ let buddySent = null;
  function buddy() {
    const baby = d.babyBuddy?.();
    if (baby && d.config.get('bugFollower') !== false) return baby;
    if (!on() || d.config.get('bugFollower') === false) return null;
    const s = state();
    const id = bugdex.favourite(s);
    if (!id) return null;
    const sp = known(id);
    const a = bugdex.artFor(sp, s.species[id]); // its portrait, as in the book: critter.js shrinks it to fit beside him
    return { id, name: sp.name, ghost: sp.habitat === 'wreck', pixels: a.pixels, palette: a.palette };
  }
  function sendBuddy({ force = true } = {}) {
    const b = buddy();
    const key = JSON.stringify(b);
    if (!force && key === buddySent) return;
    buddySent = key;
    if (d.critter) d.send(d.critter, 'critter:buddy', b);
  }

  const push = () => {
    if (d.panel) d.send(d.panel, 'bugdex', view());
    sendBuddy({ force: false }); // a new favourite (or its next stage) goes straight to the desk
  };

  function openPage(id = null) {
    d.showPanel({ focusInput: false });
    d.send(d.panel, 'panel:view', 'bugdex');
    if (id) d.send(d.panel, 'bugdex:focus', { id });
  }

  // ---- the page (ipc/progress.js)

  function seen() {
    if (!d.config) return;
    save(bugdex.markSeen(state()));
    push();
  }

  function setFavourite(id) {
    if (id != null && (typeof id !== 'string' || !speciesById(id))) return view();
    save(bugdex.setFavourite(state(), id));
    const v = view();
    push();
    return v;
  }

  /** A friend who shares their Bugdex dropped by: they leave a jar (one a day each). */
  function friendVisited(login, theirs) {
    if (!on()) return;
    const species = bugdex.giftFor(state(), login, theirs, Date.now());
    if (!species) return;
    save(bugdex.addGift(state(), { species, from: login }, Date.now()));
    push();
    const sp = known(species);
    d.sayText?.(`@${login} brought a jar: ${sp.name}!`.slice(0, 60), 'visit', 5000);
    d.send(d.panel, 'bugdex:gift', { id: species, name: sp.name, from: login });
  }

  function openTab(tabId) {
    if (typeof tabId !== 'string' || !view().loose.some(l => l.tabId === tabId)) return;
    d.showPanel({ focusInput: false, tabId });
  }

  async function forget() {
    const response = await d.askOnce({
      icon: '🫙', title: 'Start the Bugdex over?',
      message: 'Every bug you\'ve caught, seen and evolved goes, on every PC that syncs with this one. XP and trophies you\'ve earned stay.',
      buttons: [{ label: 'Start over', style: 'danger' }, { label: 'Keep it' }], defaultId: 1, cancelId: 1,
    });
    if (response !== 0) return { ok: false, canceled: true };
    // A reset marker, not nothing: sync carries it, so other PCs start over too
    // instead of handing the old counts back (bugdex/index.js merge).
    save(bugdex.normalize({ resetAt: Date.now() }));
    push();
    return { ok: true };
  }

  return { view, push, openPage, buddy, sendBuddy, seen, setFavourite, friendVisited, openTab, forget };
}

module.exports = { makePage };
