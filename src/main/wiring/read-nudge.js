// The nudge under a repeated big read (read-nudge.js), wired to the turns:
// each whole-file Read is remembered until its result comes; a result big
// enough is checked against the week's transcripts for the project
// (usage/hotfiles.js, scanned at most every SCAN_MS), and a file read in
// enough conversations gets the same one-tap fix the Lean tab drafts
// (lean-fixes.js draftNudge), sent to the panel as a card under that step.
// The card is the panel's alone: never saved, never on the phone. Kept out
// of main.js, which only wires it up.
const { scanHotFiles, relativeTo } = require('../usage/hotfiles');
const readNudge = require('../read-nudge');
const { compactTokens } = require('../fixedcost');
const { samePath } = require('../toolbox');

const SCAN_MS = 10 * 60 * 1000;   // a project's week of reads: scanned again at most this often
const SCAN_TOP = 200;             // files the week's scan brings back (the Lean tab's ten would miss most)
const CHARS_PER_TOKEN = 4;
const MAX_OPEN = 200;             // reads waiting for their result, across every tab
const MAX_SCANS = 20;             // projects whose week of reads is kept

/** d: what main shares (main.js `shared`). */
function wireReadNudge(d) {
  /** @type {Map<string, { at: number, promise: Promise<any> }>} */
  const scans = new Map();
  /** @type {Map<string, string>} */
  const openReads = new Map(); // `${tabId}:${toolId}` -> the file, for a whole read whose result hasn't come

  const store = () => readNudge.cleanStore(d.config.get('readNudges'));

  // The week's reads for a project, shared by every read that asks within SCAN_MS.
  function weekOf(project) {
    const cur = scans.get(project);
    if (cur && Date.now() - cur.at < SCAN_MS) return cur.promise;
    if (scans.size >= MAX_SCANS) scans.delete(scans.keys().next().value); // the oldest project goes
    const promise = scanHotFiles({ configDir: d.claudeConfigDir(), cwd: project, lookbackMs: readNudge.WEEK_MS, top: SCAN_TOP })
      .catch(err => { d.log.info(`read nudge: the week's scan failed: ${err.message}`); return null; });
    scans.set(project, { at: Date.now(), promise });
    return promise;
  }

  // The project a conversation's reads count under: its folder, or the one its
  // copy came from. Never the home folder, never a folder on another computer.
  function projectOf(tab) {
    const cwd = tab?.worktree?.originalCwd || tab?.session?.cwd;
    if (!cwd || d.remoteService?.placeOf(cwd)) return null;
    const home = d.setupWhere?.().home;
    return home && samePath(cwd, home) ? null : cwd;
  }

  const sameRel = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

  // A whole read's result is in: worth a card? The cheap checks first (size, rested, never), the scan after.
  async function consider(tabId, tab, { id, file, chars }) {
    const project = projectOf(tab);
    const rel = project ? relativeTo(file, tab.session?.cwd || project) : null;
    if (!project || !rel) return;
    const now = Date.now();
    const tokens = Math.round((Number.isFinite(chars) && chars > 0 ? chars : 0) / CHARS_PER_TOKEN);
    if (!readNudge.shouldNudge({ rel, tokens, sessions: readNudge.MIN_SESSIONS, store: store(), project, now }).ok) return;
    const turnId = tab.turnId;
    const week = await weekOf(project);
    const row = week?.files?.find(f => sameRel(f.rel, rel));
    const verdict = readNudge.shouldNudge({ rel, tokens, sessions: row?.sessions ?? 0, store: store(), project, now: Date.now() });
    if (!verdict.ok || !row) return;
    // Another turn began while the scan ran (the step is far up by now), or the turn is over (nothing would fold it).
    if (tab.turnId !== turnId || !tab.session?.busy) return;
    const fix = d.lean?.fixes?.draftNudge({ project, file: { rel, reads: row.reads, edits: row.edits, sessions: row.sessions, tokens: row.tokens ?? tokens } });
    if (!fix) return;
    d.config.set({ readNudges: readNudge.markSeen(store(), project, rel, Date.now()) });
    const words = readNudge.words({ rel, sessions: row.sessions, tokens, edits: row.edits, fix, compact: compactTokens });
    d.send(d.tabWindow(tabId), 'tab:item', { tabId, item: { kind: 'read-nudge', id, toolId: id, rel, tokens, sessions: row.sessions, reads: row.reads, fix, words } });
  }

  /** Every item of every conversation (wiring/sessions.js): the reads, and their results. */
  function onItem(tabId, item, tab) {
    if (d.CAPTURE || !item || item.sub || !tab) return;
    if (item.kind === 'tool' && item.wholeRead && typeof item.readPath === 'string' && typeof item.id === 'string') {
      openReads.set(`${tabId}:${item.id}`, item.readPath);
      while (openReads.size > MAX_OPEN) openReads.delete(openReads.keys().next().value);
      return;
    }
    if (item.kind !== 'tool_result') return;
    const key = `${tabId}:${item.id}`;
    const file = openReads.get(key);
    if (!file) return;
    openReads.delete(key);
    if (item.isError) return;
    consider(tabId, tab, { id: item.id, file, chars: item.chars }).catch(err => d.log.info(`read nudge: ${err.message}`));
  }

  /** "Not this one" (it rests a week either way) or "Never for this file". -> { ok, never? } */
  function answer(tabId, rel, choice) {
    const tab = d.manager?.tabs.get(tabId);
    const project = projectOf(tab);
    if (!project) return { ok: false, error: 'That conversation is closed.' };
    if (choice === 'never') {
      d.config.set({ readNudges: readNudge.markNever(store(), project, rel) });
      return { ok: true, never: true };
    }
    return { ok: true };
  }

  return { onItem, answer };
}

module.exports = { wireReadNudge };
