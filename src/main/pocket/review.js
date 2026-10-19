// Shellby on your phone: looking back, and looking before bringing home
// (wiring/pocket.js hands these the phone's calls). Each one reads what the
// desk already keeps, History above all:
//
//   find        past conversations by their title, your first prompt and Claude's
//               last word, ranked as the desk's own search ranks (history/search.js)
//   history     one project's conversations, newest first; the phone groups them by day
//   past        a closed conversation's transcript, read-only (an open one is live, #/tab)
//   away        what happened since the phone last looked: finished, waiting on you, spent
//   checks      a conversation's last checks, command by command, with the tail of what failed
//   checks-fix  a reply asking Claude to fix them, through the phone's own reply path
//   branch      a copy's whole branch against where it started: what Bring it home would bring
//
// Nothing here takes a path from the phone. A conversation is named by its id,
// a project by one from the list the phone was given, and a file by its place
// in a diff main worked out itself.
const fs = require('fs');
const path = require('path');
const changes = require('../changes');
const checks = require('../checks');
const { rank, textOf } = require('../history/search');
const { git, checkWorktree } = require('../worktrees');
const { line, clip, phoneItems } = require('./view');

const PAGE = 10;                      // search results a page
const HISTORY_PAGE = 30;              // a project's conversations a page
const READ_AT_ONCE = 4;               // transcripts read together while the search index catches up
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const AWAY_MAX_MS = 7 * 24 * 60 * 60 * 1000; // "while you were away" looks back a week at most
const AWAY_LIST = 10;                 // conversations named on the card
const TAIL_LINES = 20;                // of a failed command's output
const MAX_TAIL = 3000;
const MAX_FILES = 60;                 // files named in a branch's diff
const MAX_PATCH = 200000;             // a phone needs a page or two, not a whole refactor
const BRANCH_CACHE_MS = 30 * 1000;    // the branch's snapshot, kept while its files are tapped through

const ok = extra => ({ ok: true, ...extra });
const no = error => ({ ok: false, error });
const str = (v, n = 200) => (typeof v === 'string' && v.length > 0 && v.length <= n ? v : null);
const num = v => (Number.isFinite(v) ? v : null);
const pageOf = v => (Number.isInteger(v) && v >= 0 && v < 1000 ? v : 0);
const folderOf = e => path.win32.basename(e?.worktree?.originalCwd || e?.cwd || '');
const fold = s => String(s || '').toLowerCase();
const under = (dir, root) => { const d = fold(dir), r = fold(root).replace(/[\\/]+$/, ''); return d === r || d.startsWith(`${r}\\`) || d.startsWith(`${r}/`); };

/**
 * The gist of a transcript, for the search: your first prompt and Claude's
 * last reply (its summary of what it did), as history/search.js documents.
 * at: the item's index, so opening lands on it. Pure.
 */
function gistOf(jsonl) {
  /** @type {{ at: number, kind: string, text: string, low: string } | null} */
  let first = null;
  /** @type {{ at: number, kind: string, text: string, low: string } | null} */
  let last = null;
  let at = 0;
  for (const raw of String(jsonl || '').split('\n')) {
    if (!raw) continue;
    let item;
    try { item = JSON.parse(raw); } catch { continue; }
    if (item) {
      const text = textOf(item);
      if (text.trim()) {
        if (!first && item.kind === 'user') first = { at, kind: 'user', text, low: fold(text) };
        else if (item.kind === 'text' && !item.sub) last = { at, kind: 'text', text, low: fold(text) };
      }
    }
    at++;
  }
  return [first, last].filter(Boolean);
}

/** The last few lines of a command's output, clipped for a phone. Pure. */
function tailOf(text, lines = TAIL_LINES) {
  return clip(String(text || '').split('\n').slice(-lines).join('\n'), MAX_TAIL);
}

/**
 * What a project's conversations look like on the phone, and what the search
 * finds: never a path, only the folder's name. Pure.
 */
function phoneEntry(e, { open = false } = {}) {
  return {
    id: e.id, title: line(e.title, 120) || 'Untitled', folder: line(folderOf(e), 80),
    at: num(e.updatedAt) || num(e.createdAt) || 0, createdAt: num(e.createdAt),
    outcome: line(e.lastOutcome, 20) || null, done: !!e.done, open, copy: !!e.worktree, fromPhone: !!e.fromPhone,
  };
}

/**
 * Since the phone last looked: the turns that ended, which went wrong, and
 * what they cost. load(id) is a transcript; since/now are times. Pure.
 */
function sinceThen(entries, load, since, now) {
  const finished = [], trouble = [];
  let share = 0, tokens = 0, turns = 0;
  for (const e of entries) {
    if (!((e.updatedAt || 0) > since)) continue;
    const ended = load(e.id).filter(i => i?.kind === 'result' && Number.isFinite(i.t) && i.t > since && i.t <= now);
    if (!ended.length) continue;
    turns += ended.length;
    for (const r of ended) {
      share += num(r.cost?.share) || 0;
      tokens += num(r.tokens) || num(r.cost?.tokens) || 0;
    }
    const last = ended[ended.length - 1];
    (last.ok && !last.interrupted ? finished : trouble).push(e);
  }
  return { finished, trouble, share, tokens, turns };
}

/** A fix-it reply that fits a phone message: the tails shrink until it does. Pure. */
function fixText(verdict, { branch, max }) {
  for (const lines of [TAIL_LINES, 10, 5, 0]) {
    const trimmed = { ...verdict, commands: (verdict.commands || []).map(c => ({ ...c, tail: lines ? String(c.tail || '').split('\n').slice(-lines).join('\n') : '' })) };
    const text = checks.fixPrompt(trimmed, { branch });
    if (text.length <= max) return text;
  }
  return checks.fixPrompt({ ...verdict, commands: (verdict.commands || []).map(c => ({ ...c, tail: '', failed: [] })) }, { branch }).slice(0, max);
}

/**
 * d: what main shares.
 *   projects():         the projects the phone was given ([{ key, name }], wiring/pocket.js)
 *   prompts():          the prompts waiting on you, each with its tabId
 *   reply({ tabId, text, mode }): the phone's own reply path, rules and all
 *   maxText:            how long a reply from the phone may be
 */
function createPocketReview(d, { projects, prompts, reply, maxText = 4000, now = Date.now, fsp = fs.promises }) {
  const tabOf = id => (str(id, 100) ? d.manager?.tabs.get(id) : null) || null;
  const isOpen = id => !!d.manager?.tabs.has(id);
  const gists = new Map();   // id -> { size, mtimeMs, docs }

  // ---- the search index: the gist of each transcript, read again only when its file changed

  async function refreshGists() {
    try { d.history.flush?.(); } catch { /* read what's there */ }
    const entries = d.history.list();
    const live = new Set(entries.map(e => e.id));
    for (const id of [...gists.keys()]) if (!live.has(id)) gists.delete(id);
    const queue = [...entries];
    const worker = async () => { for (let e = queue.shift(); e; e = queue.shift()) await refreshOne(e.id); };
    await Promise.all(Array.from({ length: READ_AT_ONCE }, worker));
  }

  async function refreshOne(id) {
    let file;
    try { file = d.history.file(id); } catch { return; }
    let st;
    try { st = await fsp.stat(file); } catch { gists.set(id, { size: 0, mtimeMs: 0, docs: [] }); return; }
    const had = gists.get(id);
    if (had && had.size === st.size && had.mtimeMs === st.mtimeMs) return;
    if (st.size > MAX_FILE_BYTES) { gists.set(id, { size: st.size, mtimeMs: st.mtimeMs, docs: [] }); return; }
    try { gists.set(id, { size: st.size, mtimeMs: st.mtimeMs, docs: gistOf(await fsp.readFile(file, 'utf8')) }); } catch { /* next time */ }
  }

  async function find({ query, page }) {
    const q = str(typeof query === 'string' ? query.trim() : '', 300);
    if (!q) return no('Type a word or two to look for.');
    await refreshGists();
    const found = rank(d.history.list(), id => gists.get(id)?.docs, q, {}, now());
    const p = pageOf(page);
    const slice = found.slice(p * PAGE, (p + 1) * PAGE);
    return ok({
      query: q, page: p, more: found.length > (p + 1) * PAGE,
      results: slice.map(r => {
        const e = d.history.get(r.id) || r;
        const hit = r.hits[0];
        return { ...phoneEntry(e, { open: isOpen(r.id) }), snippet: hit ? clip(hit.snippet.text, 240) : null, said: hit ? (hit.kind === 'user' ? 'you' : 'claude') : null };
      }),
    });
  }

  // ---- one project's conversations

  function history({ project, page }) {
    const pick = str(project, 600) ? (projects() || []).find(x => fold(x.key) === fold(project)) : null;
    if (str(project, 600) && !pick) return no("That project isn't one Shellby knows. Pick one from the list.");
    const all = d.history.list()
      .filter(e => !pick || under(e.worktree?.originalCwd || e.cwd, pick.key))
      .map(e => phoneEntry(e, { open: isOpen(e.id) }))
      .sort((a, b) => b.at - a.at);
    const p = pageOf(page);
    return ok({ project: pick ? { key: pick.key, name: line(pick.name, 80) } : null, page: p, more: all.length > (p + 1) * HISTORY_PAGE, entries: all.slice(p * HISTORY_PAGE, (p + 1) * HISTORY_PAGE) });
  }

  // ---- a closed conversation, read-only

  function past({ id }) {
    const e = str(id, 100) ? d.history.get(id) : null;
    if (!e) return no('That conversation has gone from History.');
    const open = isOpen(e.id);
    return ok({ entry: phoneEntry(e, { open }), open, items: open ? [] : phoneItems(d.history.load(e.id)) });
  }

  // ---- while you were away

  function away({ since }) {
    const t = now();
    const from = Number.isFinite(since) && since > 0 && since < t ? Math.max(since, t - AWAY_MAX_MS) : null;
    if (from == null) return no('Since when?');
    const r = sinceThen(d.history.list(), id => d.history.load(id), from, t);
    const named = list => list.slice(0, AWAY_LIST).map(e => phoneEntry(e, { open: isOpen(e.id) }));
    const waiting = new Map();
    for (const p of prompts() || []) if (!waiting.has(p.tabId)) waiting.set(p.tabId, { tabId: p.tabId, title: line(tabOf(p.tabId)?.title, 120) || 'Untitled' });
    return ok({
      since: from, finished: named(r.finished), trouble: named(r.trouble), waiting: [...waiting.values()].slice(0, AWAY_LIST),
      turns: r.turns, share: Math.round(r.share * 10) / 10, tokens: r.tokens,
    });
  }

  // ---- checks, and Fix it

  // The last verdict in full: this run's (wiring/checks.js), else the one History kept.
  function verdictOf(tabId) {
    const tab = tabOf(tabId);
    if (!tab) return null;
    const live = d.lastVerdict?.(tabId);
    if (live) return live;
    const items = d.history.load(tabId);
    for (let i = items.length - 1; i >= 0; i--) if (items[i]?.kind === 'checks' && Array.isArray(items[i].commands)) return items[i];
    return null;
  }

  const canFix = (tab, v) => !!v && v.status !== 'pass' && !tab.inTerminal && !d.manager.isBusy(tab.id) && !tab.session?.pending?.size;

  function checksOf({ tabId }) {
    const tab = tabOf(tabId);
    if (!tab) return no('That conversation has closed.');
    const running = d.checksRunning?.(tab.id) || null;
    const v = verdictOf(tab.id);
    if (!v && !running) return ok({ status: null, after: null, at: null, commands: [], canFix: false });
    return ok({
      status: running ? 'running' : line(v.status, 20),
      after: line(running ? running.after : v?.after, 80) || null,
      at: num(v?.at),
      commands: (v?.commands || []).slice(0, 10).map(c => ({
        cmd: line(c.cmd, 200), ok: !!c.ok, timedOut: !!c.timedOut, error: line(c.error, 200) || null,
        failed: (c.failed || []).slice(0, 10).map(f => line(f, 120)), tail: c.ok ? '' : tailOf(c.tail),
      })),
      canFix: !running && canFix(tab, v),
    });
  }

  function fixChecks({ tabId, mode }) {
    const tab = tabOf(tabId);
    if (!tab) return no('That conversation has closed.');
    const v = verdictOf(tab.id);
    if (!v) return no('No checks have run here yet.');
    if (v.status === 'pass') return no('Nothing to fix: the checks passed.');
    if (d.checksRunning?.(tab.id)) return no('The checks are still running. Wait for them.');
    const text = fixText(v, { branch: tab.worktree?.branch || null, max: maxText });
    return reply({ tabId: tab.id, text, mode });
  }

  // ---- the whole branch, before Bring it home

  const branches = new Map(); // tabId -> { at, w, base, tree, files, added, removed }

  // Only a copy in Shellby's own folder, as ipc/repo.js allows: a History entry
  // edited by hand can't point this at some other worktree of yours.
  function copyOf(tab) {
    const w = tab?.worktree;
    if (!w || checkWorktree(w)) return null;
    const home = path.resolve(d.worktreeHome()).toLowerCase() + path.sep;
    return path.resolve(w.path).toLowerCase().startsWith(home) ? w : null;
  }

  // Where the branch stands against where it started: the commit it left the
  // base at, and the copy's folder now, uncommitted and untracked work included
  // (as Bring it home commits it). -> { base, tree, files, added, removed } | { error }
  async function standing(w) {
    if (!fs.existsSync(w.path)) return { error: 'The copy is gone (deleted outside Shellby).' };
    const mb = await git(w.root, ['merge-base', w.base, w.branch], { timeout: 15000 });
    const base = mb.ok ? mb.out.trim() : '';
    if (!/^[0-9a-f]{40,64}$/.test(base)) return { error: `Couldn't find where ${w.branch} left ${w.base}.` };
    const snap = await changes.snapshot(w.path, null, { hooks: false, noFetch: true });
    if (!snap?.tree) return { error: "Couldn't read the copy's files." };
    const stat = await git(w.root, ['diff', '--numstat', '--no-renames', base, snap.tree], { timeout: 30000 });
    if (!stat.ok) return { error: "Couldn't read the branch's changes." };
    const files = [];
    let added = 0, removed = 0;
    for (const row of stat.out.split('\n')) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(row.trimEnd());
      if (!m) continue;
      const f = { path: m[3], added: m[1] === '-' ? 0 : Number(m[1]), removed: m[2] === '-' ? 0 : Number(m[2]), binary: m[1] === '-' };
      added += f.added; removed += f.removed;
      files.push(f);
    }
    return { base, tree: snap.tree, files, added, removed };
  }

  async function branch({ tabId, file }) {
    const tab = tabOf(tabId);
    if (!tab) return no('That conversation has closed.');
    const w = copyOf(tab);
    if (!w) return no('That conversation has no copy of its own.');
    const want = typeof file === 'string' ? file.slice(0, 500) : null;
    let s = branches.get(tab.id);
    if (!s || s.w !== w || now() - s.at > BRANCH_CACHE_MS) {
      const r = await standing(w);
      if (r.error) return no(r.error);
      s = { at: now(), w, ...r };
      branches.set(tab.id, s);
      while (branches.size > 20) branches.delete(branches.keys().next().value);
    }
    if (want && !s.files.some(f => f.path === want)) return no("That file isn't on this branch.");
    const head = {
      branch: line(w.branch, 120), base: line(w.base, 120), added: s.added, removed: s.removed, more: Math.max(0, s.files.length - MAX_FILES),
      files: s.files.slice(0, MAX_FILES).map(f => ({ path: line(f.path, 300), added: f.added, removed: f.removed, binary: f.binary })),
    };
    if (!want && s.files.length > 3) return ok(head); // the phone asks for each file as it's opened, as See the changes does
    if (!s.files.length) return ok({ ...head, patch: '', truncated: false });
    const p = await changes.patchFor({ root: w.root, before: s.base, after: s.tree, ...(want ? { file: want } : {}) }, { noFetch: true });
    if (p.error) return no(p.error);
    const patch = String(p.patch || '');
    return ok({ ...head, patch: patch.slice(0, MAX_PATCH), truncated: !!p.truncated || patch.length > MAX_PATCH });
  }

  const actions = { find, history, past, away, checks: checksOf, 'checks-fix': fixChecks, branch };
  return { actions };
}

module.exports = { createPocketReview, gistOf, phoneEntry, sinceThen, fixText, tailOf, PAGE, HISTORY_PAGE, AWAY_MAX_MS };
