'use strict';

// Where else Shellby sees a bug, and sees it fixed, besides a command in one
// of his tabs: Claude Code outside Shellby (external.js), a turn's trees and
// its end, a crashed dev server, a red build, a copy coming home, a secret
// stopped at the push, the flaky detective and dependency checkups. Made by
// wireBugdex (wiring/bugdex.js), which does the spotting and the catching.

const path = require('path');
const bugdex = require('../bugdex');
const detect = require('../bugdex/detect');
const lifecycle = require('../bugdex/lifecycle');
const { LIVE } = require('./bugdex-reward');
const { ciSpecies } = require('./bugdex-checks');

const STAY_UP_MS = 60 * 1000;      // a fixed dev server has to stay up this long
const SERVER_FIX_WINDOW_MS = 30 * 60 * 1000;
const MAX_OUTSIDE = 50;

/**
 *   d: what main shares; the rest is wireBugdex's: on, state, save, push, device;
 *   names (project id -> name, shared by reference); project (a folder's project);
 *   update (change the book, tell the panel); spot, catchIt, handle (seeing and
 *   catching); rememberTree, snapshotWithin (the trees seen); bound (a map kept small).
 */
function makeSources({ d, on, state, save, push, device, names, project, update, spot, catchIt, rememberTree, snapshotWithin, handle, bound }) {
  // ---- Claude Code outside Shellby (external.js): the same, from the plugin's hooks

  const outsideStarts = new Map();   // tool_use_id -> promise of the tree when it started

  /** A command is starting in a session outside Shellby: its tree, if it could catch something. */
  function outsideStart({ toolUseId, start, cwd }) {
    if (!on() || !toolUseId || !start?.key || !cwd) return;
    if (!lifecycle.couldCatch(state()?.open, start)) return;
    outsideStarts.set(toolUseId, snapshotWithin(cwd));
    if (outsideStarts.size > MAX_OUTSIDE) outsideStarts.delete(outsideStarts.keys().next().value);
  }

  /** ...and finished: external.js has already read it down to a reading. */
  function outsideResult({ toolUseId, reading, cwd }) {
    const bugTree = outsideStarts.get(toolUseId) || null;
    outsideStarts.delete(toolUseId);
    return handle(reading, { dir: cwd, tabId: null, bugTree });
  }

  /** Claude wrote a file in a session outside Shellby. */
  async function outsideWrote({ cwd }) {
    if (!on() || !state()?.open?.length) return;
    const p = await project(cwd);
    if (p) update(s => bugdex.engage(s, p.id, Date.now()));
  }

  // ---- turns (wiring/sessions.js, timetrack/index.js)

  const fixTurns = new Map();        // dev server id -> when its fix turn ended

  /** A turn started or ended with the code at this tree: remembered, for the revert check. */
  async function treeSeen(root, tree) {
    if (!on()) return;
    const p = await project(root);
    if (p) rememberTree(p.id, tree);
  }

  /** A turn changed files in this folder: Claude's on whatever is open there. */
  async function changed(root) {
    if (!on() || !state()?.open?.length) return;
    const p = await project(root);
    if (p) update(s => bugdex.engage(s, p.id, Date.now()));
  }

  /** A turn ended in a tab: a copy's clash or a dev server's fix is being seen to. */
  function turnEnded(tabId, item) {
    if (!on() || item?.interrupted) return;
    // A catch made mid-turn waits for him to be free: he usually is a moment after.
    setTimeout(() => d.life?.jarIfFree?.(), 1500);
    const open = state()?.open || [];
    if (open.some(e => e.source === 'home' && e.tabId === tabId)) update(s => ({ ...s, open: s.open.map(e => (e.source === 'home' && e.tabId === tabId ? { ...e, engaged: true } : e)) }));
    if (!item?.ok) return;
    for (const s of d.devServers?.view?.().servers || []) {
      if (s.fixTabId !== tabId) continue;
      fixTurns.set(s.id, Date.now());
      bound(fixTurns);
      update(st => bugdex.engageKey(st, 'server', s.id));
    }
  }

  // ---- dev servers (wiring/projects.js)

  const stayUp = new Map();          // dev server id -> timer

  async function serverCrashed(v) {
    if (!on() || !v?.id) return;
    clearTimeout(stayUp.get(v.id));
    stayUp.delete(v.id);
    const lines = d.devServers?.fixDraft?.(v.id)?.lines || [];
    const hit = detect.classify(lines.join('\n'), { source: 'server', live: LIVE });
    const p = await project(v.root);
    if (!hit || !p) return;
    const existing = lifecycle.byKey(state().open, 'server', v.id)[0];
    // A crash after the fix began: it failed again, so the same encounter goes on.
    await spot({ species: existing?.species || hit.species, fp: existing?.fp || hit.fp, project: p.id, name: p.name, source: 'server', key: v.id, lang: hit.lang });
  }

  function serverUp(v) {
    if (!on() || !v?.id) return;
    const e = lifecycle.byKey(state().open, 'server', v.id)[0];
    const fixedAt = fixTurns.get(v.id) || 0;
    if (!e || !e.engaged || Date.now() - fixedAt > SERVER_FIX_WINDOW_MS) return;
    clearTimeout(stayUp.get(v.id));
    stayUp.set(v.id, setTimeout(() => {
      stayUp.delete(v.id);
      const now = (d.devServers?.view?.().servers || []).find(s => s.id === v.id);
      const still = lifecycle.byKey(state().open, 'server', v.id)[0];
      if (now?.status === 'up' && still) { fixTurns.delete(v.id); catchIt(still); }
    }, STAY_UP_MS));
  }

  // ---- CI (wiring/github.js, wiring/startfrom.js)

  async function ciProject(pr) {
    if (pr.forge === 'gitlab') {
      const root = await d.gitlabCloneOf?.(pr.host, pr.repo);
      return root ? project(root) : null;
    }
    const want = String(pr.repo || '').toLowerCase();
    const repos = d.projects ? await d.projects.localRepos().catch(() => []) : [];
    const root = repos.find(r => r.remote && r.remote.toLowerCase() === want)?.root;
    return root ? project(root) : null;
  }

  async function ciFailed(pr) {
    if (!on() || !pr?.key) return;
    const p = await ciProject(pr);
    if (!p) return;
    const species = ciSpecies(pr);
    await spot({ species, fp: detect.fingerprint(species, `ci:${pr.key}`), project: p.id, name: p.name, source: 'ci', key: String(pr.key).slice(0, 200), lang: 'ci' });
  }

  async function ciFixed(pr) {
    if (!on() || !pr?.key) return;
    const e = lifecycle.byKey(state().open, 'ci', String(pr.key).slice(0, 200))[0];
    // Only when Shellby took part: "Fix this build", or a push from here since it went red.
    if (e?.engaged) catchIt(e, { move: 'tests' });
    else if (e) update(s => bugdex.closeEncounter(s, lifecycle.encId(e)));
  }

  const ciEngaged = key => { if (on() && key) update(s => bugdex.engageKey(s, 'ci', String(key).slice(0, 200))); };
  function engageCi(projectId) {
    if (!state()?.open?.some(e => e.source === 'ci' && e.project === projectId)) return;
    update(s => ({ ...s, open: s.open.map(e => (e.source === 'ci' && e.project === projectId ? { ...e, engaged: true } : e)) }));
  }

  // ---- bringing a copy home, and pushing (ipc/repo.js)

  const homeKey = w => `${w.root}|${w.branch}`.toLowerCase().slice(0, 200);

  async function homeResult(tabId, w, merged) {
    if (!on() || !w?.root) return;
    const key = homeKey(w);
    if (merged?.conflict) {
      const p = await project(w.root);
      if (p) await spot({ species: 'two-headed-crab', fp: detect.fingerprint('two-headed-crab', `home:${w.branch}`), project: p.id, name: p.name, source: 'home', key, tabId, lang: 'git' });
      return;
    }
    if (!merged?.ok || !merged.merged) return;
    for (const e of lifecycle.byKey(state().open, 'home', key)) if (e.engaged) catchIt(e, { move: 'git' });
  }

  async function secretSpotted(root, kinds = []) {
    if (!on() || !root) return;
    const p = await project(root);
    if (!p) return;
    // Only the kinds of secret (an AWS key, a GitHub token): never where, never what.
    const what = [...new Set(kinds.map(k => String(k).slice(0, 60)))].sort().join(',');
    await spot({ species: 'leaky-clam', fp: detect.fingerprint('leaky-clam', what), project: p.id, name: p.name, source: 'push', key: path.resolve(root).toLowerCase().slice(0, 200), lang: null });
  }

  function secretIgnored(root) {
    if (!on() || !root) return;
    const key = path.resolve(root).toLowerCase().slice(0, 200);
    if (state()?.open?.some(e => e.source === 'push' && e.key === key)) update(s => ({ ...s, open: lifecycle.closeKey(s.open, 'push', key).list }));
  }

  async function pushedClean(root) {
    if (!on() || !root) return;
    const key = path.resolve(root).toLowerCase().slice(0, 200);
    for (const e of lifecycle.byKey(state().open, 'push', key)) if (e.engaged) catchIt(e, { move: 'git' });
    const p = await project(root);
    if (p) engageCi(p.id);
  }

  // ---- the flaky detective and dependency checkups (wiring/progress.js)

  const flakyFp = id => detect.fingerprint('flaky-phantom', `flaky:${id}`);

  /** A test flaked: the ghost is seen (and if it was caught lately, it got away). */
  function flakySeen(p, testId) {
    if (!on() || !p?.id) return;
    names.set(p.id, p.name);
    const s = state();
    const r = bugdex.recordSeen(s, { species: 'flaky-phantom', fp: flakyFp(testId), project: p.id }, Date.now(), { device: device() });
    save(r.state);
    push();
  }

  /** A flaky test fixed for good (20 clean runs over 3 new versions of the code): that's the proof. */
  function flakyFixed(p, testId, flakes = []) {
    if (!on() || !p?.id) return;
    names.set(p.id, p.name);
    const days = new Set(flakes.filter(Number.isFinite).map(t => new Date(t).toDateString()));
    const species = flakes.length >= 5 && days.size >= 3 ? 'heisenbug' : 'flaky-phantom';
    catchIt({ species, fp: detect.fingerprint(species, `flaky:${testId}`), project: p.id, name: p.name, firstAt: Math.min(...flakes.filter(Number.isFinite), Date.now()), reruns: 1 });
  }

  function auditIssues(p) {
    if (!on() || !p?.id) return;
    names.set(p.id, p.name);
    save(bugdex.recordSeen(state(), { species: 'barnacled-anchor', fp: detect.fingerprint('barnacled-anchor', 'audit'), project: p.id }, Date.now(), { device: device() }).state);
    push();
  }

  function auditPatched(p) {
    if (!on() || !p?.id) return;
    names.set(p.id, p.name);
    catchIt({ species: 'barnacled-anchor', fp: detect.fingerprint('barnacled-anchor', 'audit'), project: p.id, name: p.name, firstAt: 0, reruns: 1 });
  }

  return {
    engageCi,
    treeSeen, changed, turnEnded, outsideStart, outsideResult, outsideWrote,
    serverCrashed, serverUp, ciFailed, ciFixed, ciEngaged, homeResult, secretSpotted, secretIgnored, pushedClean,
    flakySeen, flakyFixed, auditIssues, auditPatched,
  };
}

module.exports = { makeSources };
