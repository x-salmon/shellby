// The Bugdex, wired up: where Shellby sees a bug (a failed command in one of
// his tabs, a crashed dev server, a red build, a clash bringing a copy home, a
// secret stopped at the push), and where he sees it fixed. The rules are the
// pure modules (bugdex/index.js, bugdex/*.js); this holds the snapshots, the git
// checks, the moment he jars it and the rewards. See docs/plans/bugdex.md.
//
// Nothing a command printed is kept: detect.js reads it and hands back a
// species id and a short hash. A catch needs the code to have changed (or a
// remedy to have run) and the change to be a fix (cheats.js), so a false
// catch is rarer than a missed one.
//
// Beside it: bugdex-page.js (the book on the panel and the page's buttons),
// bugdex-sources.js (the other places he sees a bug: outside sessions, turns,
// dev servers, CI, a copy coming home, a push, the flaky detective),
// bugdex-battles.js (the fights) and bugdex-reward.js (what a catch pays).
const crypto = require('crypto');
const path = require('path');
const changes = require('../changes');
const worktrees = require('../worktrees');
const bugdex = require('../bugdex');
const detect = require('../bugdex/detect');
const lifecycle = require('../bugdex/lifecycle');
const { judge } = require('../bugdex/cheats');
const battle = require('../bugdex/battle');
const { speciesById } = require('../bugdex/species');
const { projectOf } = require('../gitinfo');
const { activeSeasons } = require('../wardrobe/seasons');
const { normalizeXp } = require('../progression/xp');
const events = require('../events');
const { makeBattles } = require('./bugdex-battles');
const { makeReward, LIVE } = require('./bugdex-reward');
const { ciSpecies, markersLeft } = require('./bugdex-checks');
const { makePage } = require('./bugdex-page');
const { makeSources } = require('./bugdex-sources');

// Everything that can be seen: the book's live species, and the hidden one.
const RARITY_ORDER = { common: 0, uncommon: 1, rare: 2, legendary: 3, special: 4 };
const PROJECT_TTL_MS = 60 * 1000;
const MAX_TREES = 30;              // per project: trees seen, for "that's just a revert"
const MAX_REMEDIES = 20;
const GIT_MS = 5000;
// Tools that scout rather than change anything: a 'scout' move in a battle.
const SCOUT_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch']);
// A tide event's bug comes along after the catch that brought it, as a moment of its own.
const EVENT_BUG_AFTER_MS = 4500;

/** d: what main shares (main.js `shared`). */
function wireBugdex(d) {
  const on = () => !d.CAPTURE && !!d.config && d.config.get('catchBugs') !== false && !d.config.get('crabOnly');
  const device = () => normalizeXp(d.config.get('xp')).device || 'local';
  // Always a whole book, even before the first bug (config starts it as null).
  const state = () => {
    const dev = device();
    // Catches from before this PC had its id move onto it.
    return dev !== 'local' ? bugdex.withDevice(d.config.get('bugdex'), dev) : bugdex.normalize(d.config.get('bugdex'));
  };
  const save = s => d.config.set({ bugdex: s });
  const today = () => (d.today ? d.today() : new Date()); // the app's one calendar (today.js)
  const seasons = () => { try { return activeSeasons(today(), d.seasonsWhere?.() || {}).map(x => x.id); } catch { return []; } };

  // ---- memory: never saved

  const projects = new Map();        // lower-cased folder -> { at, p: promise of projectOf }
  const names = new Map();           // project id -> name
  const trees = new Map();           // project id -> [{ tree, at }]
  const remedies = new Map();        // project id -> [{ kind, at }]
  const conflicts = new Map();       // encounter id -> { files } (the files git named)

  function project(dir) {
    if (!dir) return Promise.resolve(null);
    const key = path.resolve(dir).toLowerCase();
    const hit = projects.get(key);
    if (hit && Date.now() - hit.at < PROJECT_TTL_MS) return hit.p;
    const p = projectOf(dir).catch(() => null).then(x => { if (x) { names.set(x.id, x.name); bound(names); } return x; });
    projects.set(key, { at: Date.now(), p });
    if (projects.size > 200) projects.delete(projects.keys().next().value);
    return p;
  }

  /** The folder's git tree now, or null (not a repo, or slower than SNAPSHOT_WAIT_MS). */
  function snapshotWithin(dir) {
    let late = false;
    let timer = null;
    const taken = changes.snapshot(dir).catch(() => null).then(s => (late ? null : s));
    const slow = new Promise(r => { timer = setTimeout(() => { late = true; r(null); }, d.SNAPSHOT_WAIT_MS); });
    return Promise.race([taken, slow]).finally(() => clearTimeout(timer));
  }

  const ringPush = (map, id, row, max) => { map.set(id, [...(map.get(id) || []), row].slice(-max)); bound(map); };
  // None of these may grow for as long as Shellby runs.
  const MAX_KEYS = 200;
  const bound = map => { while (map.size > MAX_KEYS) map.delete(map.keys().next().value); };
  // The first time a tree was seen is what counts: seeing it again after a
  // failure must not make an undo look new.
  const rememberTree = (projectId, tree, at = Date.now()) => {
    if (projectId && tree && !(trees.get(projectId) || []).some(t => t.tree === tree)) ringPush(trees, projectId, { tree, at }, MAX_TREES);
  };
  /** Was this tree the code before the bug turned up (an undo, not a fix)? */
  const wasBefore = (projectId, tree, firstAt) => (trees.get(projectId) || []).some(t => t.tree === tree && t.at < firstAt);
  const remediesSince = (projectId, at) => (remedies.get(projectId) || []).filter(r => r.at >= at).map(r => r.kind);

  // ---- the panel: the book's view, the friends' board, his buddy and the page's buttons (bugdex-page.js)

  const { view, push, openPage, buddy, sendBuddy, seen, setFavourite, friendVisited, openTab, forget } = makePage({ d, on, state, save, names, today });

  /** Change the book, then tell the panel. */
  function update(fn) {
    const before = bugdex.prune(state(), Date.now());
    const next = fn(before);
    // Every file Claude writes engages what's open: most of the time that's already so.
    if (JSON.stringify(next) === JSON.stringify(before)) return before;
    save(next);
    push();
    return next;
  }

  /** An entry point main calls without waiting: a failure is logged, never a snag. */
  const guarded = fn => (...args) => {
    try {
      const out = fn(...args);
      return out && typeof out.catch === 'function' ? out.catch(e => d.log.error('bugdex', e)) : out;
    } catch (e) {
      d.log.error('bugdex', e);
      return undefined;
    }
  };

  const { battles, battleOf, fight, fightAll, battleList, cue, endBattle } = makeBattles({ d, on, state, names });
  const reward = makeReward({ d, view: () => view(), names, openPage: id => openPage(id) });
  // Where else he sees a bug (bugdex-sources.js): handed the seeing and catching below, which hoist.
  const {
    engageCi, treeSeen, changed, turnEnded, outsideStart, outsideResult, outsideWrote, serverCrashed, serverUp,
    ciFailed, ciFixed, ciEngaged, homeResult, secretSpotted, secretIgnored, pushedClean, flakySeen, flakyFixed, auditIssues, auditPatched,
  } = makeSources({ d, on, state, save, push, device, names, project, update, spot, catchIt, rememberTree, snapshotWithin, handle, bound });

  // ---- seeing

  /**
   * Open an encounter, or refresh one that failed again.
   *   again: { kind (detect.js commandKind), failed } — what failed again, for its battle
   */
  async function spot(enc, again = null) {
    const now = Date.now();
    const r = bugdex.spot(state(), enc, now, { device: device() });
    save(r.state);
    push();
    if (r.isNew) d.log.info(`bugdex: spotted ${enc.species}`);
    if (r.escaped) d.log.info(`bugdex: ${enc.species} got away`);
    const e = r.state.open.find(x => lifecycle.encId(x) === lifecycle.encId(enc));
    if (e && r.isNew) { d.bugNests?.opened(e, now); battleOf(e, now, again?.failed ?? null); } // history and nests first: a rematch starts stronger
    else if (e) fight(e, b => battle.act(b, { move: again?.kind || 'run', failed: again?.failed ?? null, at: now }));
    return r;
  }

  /**
   * A failed command showed a bug: open its encounter.
   *   r: detect.read()'s reading; at: { dir, tabId, bugTree }
   */
  async function observe(r, at) {
    const hit = r.hit;
    if (!hit) return;
    const p = await project(at.dir);
    if (!p) return;
    const snap = await snapshotWithin(at.dir);
    if (snap) rememberTree(p.id, snap.tree);
    const conflict = hit.species === 'two-headed-crab';
    // No picture of the code (not a repo, or too slow): nothing could ever prove
    // it fixed, so it's only seen, not left on the loose for a day saying "waiting".
    if (!snap && !conflict) {
      save(bugdex.recordSeen(state(), { species: hit.species, fp: hit.fp, project: p.id }, Date.now(), { device: device() }).state);
      push();
      return;
    }
    const enc = {
      species: hit.species, fp: hit.fp, project: p.id, name: p.name, source: 'bash',
      // A conflict is caught by settling it, not by the same command passing.
      keys: conflict ? [] : r.keys, kind: r.kind, narrow: !conflict && r.narrow === true,
      failTree: snap?.tree || null, tabId: at.tabId || null, lang: hit.lang, passed: r.passed,
    };
    if (conflict) { conflicts.set(lifecycle.encId(enc), { files: r.conflictFiles }); bound(conflicts); }
    await spot(enc, { kind: r.kind, failed: Number.isInteger(r.failed) ? r.failed : null });
  }

  // ---- catching

  /**
   * Jar it: the book, the rewards and the moment.
   *   e: the encounter (or { species, fp, project, name, firstAt })
   */
  function catchIt(e, { remedy = false, quiet = false, move = null } = {}) {
    const now = Date.now();
    const sp = speciesById(e.species);
    const boosts = d.eventBoosts?.() || null;
    // Who helped, read before the battle ends: a helper in the fight brings Pen Pal Week's bug.
    const party = e.source ? (battles.get(lifecycle.encId(e))?.party?.length || 0) : 0;
    const r = bugdex.recordCatch(state(), {
      species: e.species, fp: e.fp, project: e.project, name: e.name || names.get(e.project) || '',
      firstAt: e.firstAt, firstTry: e.reruns === 0, remedy, lang: e.lang, device: device(), seasons: seasons(), rand: Math.random,
      shinyBoost: boosts ? boosts.shinyFor(sp?.habitat) : 1,
    }, now);
    const next = e.source ? bugdex.closeEncounter(r.state, lifecycle.encId(e)) : r.state;
    save(next);
    if (e.source) endBattle(e, r, now, remedy ? 'remedy' : move);
    if (!r.counted) { push(); return r; }
    d.log.info(`bugdex: caught ${e.species}${r.isNew ? ' (new)' : ''}`);
    reward(e, r, { quiet, boosts });
    push();
    if (sp && !sp.event) maybeEventBug(e, r, { party, now });
    return r;
  }

  /**
   * A tide event's own bug comes along with a real catch made its way
   * (events.js bugComesAlong): after nine at The Haunting, with a helper in
   * Pen Pal Week, a fix that deletes more than it adds in Spring Clean...
   */
  function maybeEventBug(e, r, { party, now }) {
    const a = d.activeEvent?.();
    if (!a) return;
    const sp = speciesById(e.species);
    const ctx = { hour: new Date(now).getHours(), habitat: sp.habitat, forms: r.forms, party, trimmed: e.trimmed === true, todayCount: r.state.today };
    if (!events.bugComesAlong(a.ev.id, ctx)) return;
    // Its own fingerprint, from the catch that brought it: the same fix can't bring it twice.
    const fp = crypto.createHash('sha1').update(`event:${a.ev.id}:${e.fp}`).digest('hex').slice(0, 12);
    setTimeout(() => {
      try {
        const got = catchIt({ species: a.ev.bug, fp, project: e.project, name: e.name, firstAt: now });
        if (got.counted) d.log.info(`bugdex: ${a.ev.bug} came along (${a.ev.id})`);
      } catch (err) { d.log.warn('event bug failed', err.message); }
    }, EVENT_BUG_AFTER_MS);
  }

  /** A passing command: does it catch anything open for it? */
  async function tryCatch(r, at) {
    const p = await project(at.dir);
    if (!p || !r.key) return;
    const cands = lifecycle.candidates(state().open, { project: p.id, key: r.key, scriptKey: r.scriptKey, kind: r.kind, broad: r.broad });
    if (!cands.length) return;
    // The code as it was when the command started and as it ended: if it moved
    // while it ran, the pass proves nothing.
    const start = await at.bugTree;
    const end = await snapshotWithin(at.dir);
    if (!start || !end || start.tree !== end.tree) return;
    rememberTree(p.id, end.tree);
    const caught = [];
    for (const e of cands) {
      if (!e.failTree || r.fps.includes(e.fp)) continue;
      const sp = speciesById(e.species);
      const same = e.failTree === end.tree;
      // A fix that isn't code: the species' own remedies, or a cleared cache, which
      // makes whatever it was a Cache Ghoul (reveal).
      const ran = same ? remediesSince(p.id, e.firstAt) : [];
      const remedy = ran.some(k => sp.remedies?.includes(k)) || ran.includes('cache');
      let files = [], patch = '';
      if (!same) {
        const sum = await changes.summarize({ root: end.root, tree: e.failTree }, end).catch(() => null);
        files = sum?.files || [];
        if (files.length) patch = (await changes.patchFor({ root: end.root, before: e.failTree, after: end.tree }).catch(() => null))?.patch || '';
      }
      const verdict = judge({
        files, patch, species: e.species, remedy, revert: !same && wasBefore(p.id, end.tree, e.firstAt),
        passFlags: r.passFlags, counts: { before: e.passed, after: r.passed },
      });
      // The very same code passing: it was never a bug in the code (a flake, or
      // something outside it). Nothing could prove it fixed, so it goes free
      // now instead of waiting on the loose for a day. Only on the same tree:
      // a diff git failed to read is no proof that nothing changed.
      if (!verdict.ok && verdict.reason === 'no-change' && same) {
        update(s => bugdex.closeEncounter(s, lifecycle.encId(e)));
        d.log.info('bugdex: let go (passed with no change)');
        continue;
      }
      if (!verdict.ok) {
        update(s => bugdex.refuse(s, lifecycle.encId(e), verdict.reason));
        fight(e, b => battle.resist(b, { at: Date.now(), reason: verdict.reason }));
        d.log.info(`bugdex: no catch (${verdict.reason})`);
        continue;
      }
      // Spring Clean's bug wants a fix that took code away (events.js).
      const lines = patch.split('\n');
      const added = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
      const removed = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;
      caught.push({ e: { ...e, trimmed: removed > added, fix: { files, patch, judged: verdict, counts: { before: e.passed, after: r.passed } } }, remedy }); // fix: for the report (bugdex-nests.js)
    }
    // One pass, one moment: the rarest is the catch, the rest come along quietly.
    caught.sort((a, b) => RARITY_ORDER[speciesById(b.e.species).rarity] - RARITY_ORDER[speciesById(a.e.species).rarity]);
    caught.forEach(({ e, remedy }, i) => catchIt(reveal(e, remedy), { remedy, quiet: i > 0, move: r.kind }));
  }

  // A squatter or a stuck file fixed by killing a leftover process was a
  // zombie all along; anything cured by clearing a cache was a cache ghoul.
  function reveal(e, remedy) {
    if (!remedy) return e;
    const kinds = remediesSince(e.project, e.firstAt);
    const own = kinds.filter(k => speciesById(e.species).remedies?.includes(k));
    if ((e.species === 'port-squatter' || e.species === 'clingy-barnacle') && own.includes('kill')) return { ...e, species: 'zombie-process' };
    // Only when nothing of its own fixed it: a cleared cache did.
    if (!own.length && kinds.includes('cache')) return { ...e, species: 'cache-ghoul' };
    return e;
  }

  /** Remedies, walking away from a merge, settling one, pushes and commits. */
  async function sideEffects(r, at) {
    const p = await project(at.dir);
    if (!p) return;
    if (r.remedy) ringPush(remedies, p.id, { kind: r.remedy, at: Date.now() }, MAX_REMEDIES);
    const open = state().open.filter(e => e.project === p.id && e.source === 'bash');
    if (r.remedy) fightAll(open, b => battle.act(b, { move: 'remedy', at: Date.now() }));
    if (r.flee) {
      const fled = open.filter(e => e.species === 'two-headed-crab');
      if (fled.length) update(s => fled.reduce((acc, e) => bugdex.closeEncounter(acc, lifecycle.encId(e)), s));
      return;
    }
    if (r.resolve) await settleConflicts(p, at.dir, open.filter(e => e.species === 'two-headed-crab'));
    // Read again: settling a conflict took a while, and caught what it caught.
    const now = state().open.filter(e => e.project === p.id && e.source === 'bash');
    if (r.fairPush) {
      for (const e of now.filter(x => x.species === 'bounced-bottle')) catchIt(e, { move: 'git' });
      engageCi(p.id);
    }
    if (r.hookedCommit) for (const e of now.filter(x => x.species === 'gatekeeper-goby' && x.engaged)) catchIt(e, { move: 'git' });
  }

  /** A merge was committed: caught, if git agrees nothing is left unmerged and no markers are left. */
  async function settleConflicts(p, dir, list) {
    if (!list.length) return;
    const root = await changes.rootOf(dir).catch(() => null);
    if (!root) return;
    const unmerged = await worktrees.git(root, ['ls-files', '-u'], { timeout: GIT_MS });
    if (!unmerged.ok || unmerged.out.trim()) return;
    for (const e of list) {
      const files = conflicts.get(lifecycle.encId(e))?.files || [];
      if (files.some(f => markersLeft(root, f))) continue;
      conflicts.delete(lifecycle.encId(e));
      catchIt(e, { move: 'git' });
    }
  }

  // ---- Bash and PowerShell in a tab (wiring/sessions.js)

  /** A command is about to run: the code as it is, if an open bug could be caught by it. */
  function commandStart({ command, dir }) {
    if (!on() || !dir) return null;
    if (!lifecycle.couldCatch(state()?.open, detect.startOf(command))) return null;
    return snapshotWithin(dir);
  }

  /** A conversation closed: the bugs it spotted got away (their battles show it), instead of waiting a day. */
  function tabClosed(tabId) {
    if (!on() || typeof tabId !== 'string') return;
    let gone = 0;
    update(s => { const r = lifecycle.closeTab(s.open, tabId); gone = r.closed.length; return gone ? { ...s, open: r.list } : s; });
    if (gone) d.log.info(`bugdex: ${gone} got away (conversation closed)`);
  }

  /** Claude wrote a file in a tab: whatever is open in that project is being worked on. */
  async function wrote(tabId) {
    if (!on() || !state()?.open?.length) return;
    const dir = d.manager?.tabs.get(tabId)?.session?.cwd;
    const p = await project(dir);
    if (p) update(s => bugdex.engage(s, p.id, Date.now()));
  }

  /**
   * What a tab can be fighting, or []: in the project it works in, and spotted
   * in that tab (or in none, like a red build). Another conversation's bug is
   * its own fight.
   */
  async function openInTab(tabId) {
    if (!state()?.open?.length) return [];
    const p = await project(d.manager?.tabs.get(tabId)?.session?.cwd);
    return p ? state().open.filter(e => e.project === p.id && (!e.tabId || e.tabId === tabId)) : [];
  }

  /**
   * Any tool Claude used in a tab: an edit engages what's loose (and is a
   * Patch), reading round is a Scout. A helper's own tools are its assist.
   */
  async function tool(tabId, item) {
    if (!on() || !item?.name) return;
    if (item.filePath) await wrote(tabId);
    if (item.sub || item.parent) return;
    const move = item.filePath ? 'patch' : SCOUT_TOOLS.has(item.name) ? 'scout' : null;
    if (!move) return;
    const at = Date.now();
    fightAll(await openInTab(tabId), b => battle.act(b, { move, at }));
  }

  /** A helper Claude sent out came back (wiring/crew.js): its crew member jumps into the battles there. */
  async function assist(tabId, type) {
    if (!on() || !type) return;
    const m = d.crewRoster?.member?.(type);
    if (!m) return;
    const at = Date.now();
    for (const e of await openInTab(tabId)) {
      const special = !!m.specialty && m.specialty === speciesById(e.species)?.type;
      fight(e, b => battle.act(b, { move: 'assist', at, by: { type: m.type, name: m.name, hue: m.hue, level: m.level, special } }));
    }
  }

  /**
   * What one finished command amounts to, wherever it ran.
   *   r: detect.read()'s reading (no output in it); at: { dir, tabId, bugTree }
   */
  async function handle(r, at) {
    try {
      if (!on() || !r || !at.dir) return;
      if (r.outcome === 'fail') return await observe(r, at);
      await sideEffects(r, at);
      await tryCatch(r, at);
    } catch (e) {
      d.log.error('bugdex', e);
    }
  }

  /** A command finished in a tab. c: the pending entry from sessions.js. */
  function commandResult(c, item, tail) {
    if (!on() || !c.dir || c.background) return Promise.resolve();
    const { output, complete } = detect.fullOutput(item, tail);
    const r = detect.read({ cmd: c.command, output, isError: item.isError, complete, live: LIVE });
    return handle(r, { dir: c.dir, tabId: c.tabId, bugTree: c.bugTree });
  }

  // Main calls these from its own events and never waits: each one logs its
  // own failure instead of letting it reach main's "snag" handler.
  const hooks = Object.fromEntries(Object.entries({
    commandStart, commandResult, tabClosed, wrote, tool, assist, friendVisited, treeSeen, changed, turnEnded, outsideStart, outsideResult, outsideWrote,
    serverCrashed, serverUp, ciFailed, ciFixed, ciEngaged, homeResult, secretSpotted, secretIgnored, pushedClean,
    flakySeen, flakyFixed, auditIssues, auditPatched,
  }).map(([k, fn]) => [k, guarded(fn)]));

  return {
    on, view, push, openPage, seen, setFavourite, openTab, forget, battles: battleList, cue, buddy, sendBuddy,
    ...hooks,
    // For the tests: the species a red build would be.
    ciSpecies,
  };
}

module.exports = { wireBugdex };
