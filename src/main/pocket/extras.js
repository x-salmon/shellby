// Shellby on your phone: the screens past the beach (wiring/pocket.js hands
// these the phone's calls). Each one goes through what the desk already does:
//
//   focus      Guard my focus, 15, 25 or 50 minutes, and stopping it
//   routines   the list, Run now (in the mode you gave it), and on/off
//   workflows  the list, and Run now for one that needs no inputs
//   notes      a project's Notes list: read, add (as you), tick off
//   wardrobe   what he can wear, and putting it on; a pat on the head
//   files      a conversation's folder, read-only, when you've allowed it
//   photos     a picture for a new task, kept a little while until it's used
//   progress   his level, streak, today's bounties and recent XP (the Trophies page's XP card), to look at
//
// Nothing here takes a path from the phone. A folder is named by its
// conversation, a file by where it sits inside that folder, and both are
// checked against the folder's real path before anything is read.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const attach = require('../attachments');
const notes = require('../notes');

const FOCUS_LENGTHS = [15, 25, 50];
const MAX_LIST = 200;               // entries in one folder listing
const MAX_READ = 200 * 1024;        // a file the phone can read
const PET_EVERY_MS = 10 * 1000;     // a pat from the phone, at most this often
const PHOTO_TTL_MS = 30 * 60 * 1000;
const MAX_PHOTOS = 8;               // kept at once, across phones
const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'out', '.venv', '__pycache__']);
// Never shown on a phone, however the folder is set up: keys, tokens and passwords live in these.
const SECRET = /(^|[\\/])(\.env(\..*)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.htpasswd|\.dockercfg|id_[a-z0-9]+|.*\.(pem|key|p12|pfx|keystore|jks|kdbx|tfstate|tfvars)|appsettings.*\.json|settings\.local\.json|[^\\/]*(secret|token|credential|password|passwd)[^\\/]*)$/i;
// A folder this wide is more than a project: a whole drive, or your home
// folder. (Not AppData: Shellby's own copies of a repo live there.)
function tooWide(dir) {
  const f = path.resolve(dir).toLowerCase().replace(/[\\/]+$/, '');
  return path.parse(f).root.toLowerCase().replace(/[\\/]+$/, '') === f || f === os.homedir().toLowerCase().replace(/[\\/]+$/, '');
}

const ok = extra => ({ ok: true, ...extra });
const no = error => ({ ok: false, error });
const str = (v, n = 200) => (typeof v === 'string' && v.length > 0 && v.length <= n ? v : null);
const clip = (s, n) => String(s ?? '').slice(0, n);
const num = v => (Number.isFinite(v) ? v : 0);
const nameOf = v => clip(typeof v === 'string' ? v : v?.name, 60);

/**
 * The XP card for a phone (wiring/progress.js xpView): only what it draws,
 * clipped. Recent XP keeps its label, which can name a project or a test, as
 * the desk's card does; project paths and the character sheet stay on the PC. Pure.
 */
function phoneProgress(v) {
  if (!v || typeof v !== 'object') return null;
  const b = v.bounties && typeof v.bounties === 'object' ? v.bounties : {};
  const u = v.unlock && typeof v.unlock === 'object' ? v.unlock : null;
  return {
    level: num(v.level), marks: num(v.marks), title: nameOf(v.title), rank: nameOf(v.rank),
    into: num(v.into), needed: num(v.needed), progress: Math.min(1, Math.max(0, num(v.progress))), total: num(v.total),
    streak: { days: num(v.streak?.days), multiplier: num(v.streak?.multiplier) || 1 },
    bounties: {
      list: (Array.isArray(b.list) ? b.list : []).slice(0, 4).map(x => ({ text: clip(x?.text, 120), xp: num(x?.xp), count: num(x?.count), goal: num(x?.goal), done: x?.done === true })),
      cleared: b.cleared === true, bonus: num(b.bonus),
    },
    unlock: u ? { level: num(u.level), xpToGo: num(u.xpToGo), names: (Array.isArray(u.unlocks) ? u.unlocks : []).slice(0, 4).map(x => clip(`${x?.icon ? `${x.icon} ` : ''}${x?.name || ''}`, 60)).filter(Boolean) } : null,
    recent: (Array.isArray(v.log) ? v.log : []).slice(0, 8).map(x => ({ at: num(x?.at), xp: num(x?.xp), label: clip(x?.label, 120) })),
  };
}

/**
 * d: what main shares. allowed(key): whether Settings lets the phone do it.
 * tabRoot(tabId): the folder a conversation works in, or null.
 */
function createPocketExtras(d, { allowed, tabRoot, now = Date.now }) {
  let lastPet = 0;
  const photos = new Map(); // id -> { path, at }

  // ---- Guard my focus

  function focus({ minutes, stop }) {
    if (stop === true) { d.stopFocus(); return ok(); }
    const m = Number(minutes);
    if (!FOCUS_LENGTHS.includes(m)) return no('Pick 15, 25 or 50 minutes.');
    d.startFocus(m);
    return ok();
  }

  // ---- routines and workflows

  function routines() {
    const list = (d.routinesView?.() || []).slice(0, 50).map(r => ({
      id: clip(r.id, 80), name: clip(r.name, 120), enabled: !!r.enabled, running: !!r.running,
      scheduleText: clip(r.scheduleText, 80) || null, next: Number.isFinite(r.next) ? r.next : null,
      lastRunAt: Number.isFinite(r.lastRunAt) ? r.lastRunAt : null, lastStatus: clip(r.lastStatus, 30) || null,
      folder: r.cwd ? path.win32.basename(r.cwd) : null,
    }));
    const wf = d.workflows && !d.config.get('crabOnly') ? (d.workflows.view()?.workflows || []) : [];
    const workflows = wf.slice(0, 50).map(w => ({
      id: clip(w.id, 80), name: clip(w.name, 120), enabled: !!w.enabled, running: !!w.running,
      description: clip(w.description, 200) || null,
      needsInputs: (w.inputs || []).some(i => i?.required && i.default == null),
      lastStatus: clip(w.lastRun?.status, 30) || null,
    }));
    return ok({ routines: list, workflows });
  }

  function runRoutine({ id }) {
    const r = (d.routines?.() || []).find(x => x.id === str(id, 80));
    if (!r) return no('That routine has gone.');
    const res = d.runRoutine(r, { reason: 'manual' });
    return res?.ok ? ok({ tabId: res.tabId || null }) : no(res?.error || (res?.skipped ? 'It’s already running.' : 'It didn’t start.'));
  }

  function toggleRoutine({ id, enabled }) {
    const list = d.routines?.() || [];
    if (!list.some(x => x.id === str(id, 80)) || typeof enabled !== 'boolean') return no('That routine has gone.');
    d.saveRoutines(list.map(r => (r.id === id ? { ...r, enabled } : r)));
    return ok();
  }

  async function runWorkflow({ id }) {
    if (!d.workflows || d.config.get('crabOnly')) return no('Workflows are off on your PC.');
    const wf = (d.workflows.view()?.workflows || []).find(w => w.id === str(id, 80));
    if (!wf) return no('That workflow has gone.');
    if ((wf.inputs || []).some(i => i?.required && i.default == null)) return no('It needs inputs: run it at the desk.');
    const r = await d.workflows.runManual(wf.id, {});
    return r?.ok === false ? no(r.error || 'It didn’t start.') : ok();
  }

  // ---- Notes

  async function projectNotes({ project }) {
    const v = await d.notesView();
    const lists = [{ key: notes.GENERAL, name: 'General', notes: v.general }, ...v.projects];
    const pick = lists.find(l => l.key === project) || lists.find(l => l.key === v.current) || lists[0];
    const shown = n => ({ id: clip(n.id, 80), text: clip(n.text, 2000), done: !!n.done, pinned: !!n.pinned, from: n.from === 'claude' ? 'claude' : 'you', createdAt: n.createdAt || null });
    return ok({
      lists: lists.map(l => ({ key: clip(l.key, 600), name: clip(l.name, 80), open: (l.notes || []).filter(n => !n.done).length })),
      key: pick.key,
      notes: (pick.notes || []).slice(0, 100).map(shown),
    });
  }

  async function addNote({ project, text }) {
    const said = str(typeof text === 'string' ? text.trim() : '', notes.MAX_TEXT);
    if (!said) return no('Write something first.');
    const scope = project === notes.GENERAL ? notes.GENERAL : str(project, 600);
    const where = scope && scope !== notes.GENERAL ? await d.knownNoteProject(scope) : null;
    if (!scope || (scope !== notes.GENERAL && !where)) return no('Pick a list for that note.');
    const r = notes.add(d.config.get('notes'), scope, said, { id: d.randomUUID?.() || crypto.randomUUID(), now: now(), project: where || undefined, from: 'you' });
    if (r.error) return no(r.error);
    await d.saveNotes(r.state);
    return ok();
  }

  async function tickNote({ project, id, done }) {
    if (!str(project, 600) || !str(id, 80) || typeof done !== 'boolean') return no('That note has gone.');
    const before = notes.normalize(d.config.get('notes'));
    const list = project === notes.GENERAL ? before.general : before.projects[project]?.notes;
    if (!list?.some(n => n.id === id)) return no('That note has gone.');
    await d.saveNotes(notes.update(before, project, id, { done }));
    return ok();
  }

  // ---- the wardrobe, and a pat

  function wardrobe() {
    const v = d.wardrobe?.view();
    if (!v) return no('The wardrobe isn’t open yet.');
    const wearing = new Set(Object.values(v.outfit || {}).filter(Boolean));
    return ok({
      items: (v.accessories || []).filter(a => !a.locked).slice(0, 120).map(a => ({ key: clip(a.key, 80), name: clip(a.name, 80), slot: clip(a.slot, 30), on: wearing.has(a.key) })),
    });
  }

  function wear({ key, off }) {
    const item = (d.wardrobe?.view()?.accessories || []).find(a => a.key === str(key, 80) && !a.locked);
    if (!item) return no('He doesn’t have that one yet.');
    const r = d.wardrobe.setOutfit({ [item.slot]: off === true ? null : item.key });
    return r.ok ? ok() : no(r.error || 'It didn’t fit.');
  }

  function pet() {
    const t = now();
    if (t - lastPet < PET_EVERY_MS) return ok({ again: true });
    lastPet = t;
    d.life?.onPet?.();
    d.refreshCritter?.();
    return ok();
  }

  // ---- files, read-only

  // The folder and the file inside it, both real paths, or an error.
  function placeOf(tabId, rel) {
    if (!allowed('files')) return { error: 'Reading files from your phone is off. Turn it on in Settings → On your phone.' };
    const root = tabRoot(str(tabId, 100));
    if (!root) return { error: 'That conversation has closed.' };
    let real;
    try { real = fs.realpathSync.native(root); } catch { return { error: 'That folder has gone.' }; }
    if (tooWide(real)) return { error: 'That conversation works in a folder too wide to browse from a phone.' };
    const want = typeof rel === 'string' ? rel.replace(/\\/g, '/').replace(/^\/+/, '') : '';
    // No drive letters or alternate streams (file:stream), and no way through .. at all.
    if (want.length > 500 || want.includes(':') || want.split('/').some(p => p === '..')) return { error: 'That isn’t in this folder.' };
    let full;
    try { full = fs.realpathSync.native(path.join(real, want)); } catch { return { error: 'That file has gone.' }; }
    const inside = path.relative(real, full);
    if (inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) return { error: 'That isn’t in this folder.' };
    // Checked on the real path, so .GIT or a short name can't get round it.
    if (inside.split(path.sep).some(p => SKIP_DIRS.has(p.toLowerCase()))) return { error: 'That isn’t in this folder.' };
    if (SECRET.test(full)) return { error: 'That file may hold secrets, so it stays on your PC.' };
    return { root: real, full, rel: inside.split(path.sep).join('/') };
  }

  function files({ tabId, dir }) {
    const p = placeOf(tabId, dir);
    if (p.error) return no(p.error);
    let entries;
    try { entries = fs.readdirSync(p.full, { withFileTypes: true }); } catch { return no('That isn’t a folder.'); }
    const list = entries
      .filter(e => !(e.isDirectory() && SKIP_DIRS.has(e.name.toLowerCase())) && !SECRET.test(e.name) && (e.isDirectory() || e.isFile()))
      .sort((a, b) => (Number(b.isDirectory()) - Number(a.isDirectory())) || a.name.localeCompare(b.name))
      .slice(0, MAX_LIST)
      .map(e => ({ name: clip(e.name, 200), dir: e.isDirectory() }));
    return ok({ dir: p.rel, entries: list, more: Math.max(0, entries.length - MAX_LIST), root: path.win32.basename(p.root) });
  }

  function readFile({ tabId, file }) {
    const p = placeOf(tabId, file);
    if (p.error) return no(p.error);
    let st;
    try { st = fs.statSync(p.full); } catch { return no('That file has gone.'); }
    if (!st.isFile()) return no('That isn’t a file.');
    const fd = fs.openSync(p.full, 'r');
    let buf;
    try {
      if (!fs.fstatSync(fd).isFile()) return no('That isn’t a file.');
      buf = Buffer.alloc(Math.min(st.size, MAX_READ));
      fs.readSync(fd, buf, 0, buf.length, 0);
    } finally { fs.closeSync(fd); }
    if (buf.includes(0)) return no('That file isn’t text, so it shows at the desk.');
    return ok({ file: p.rel, text: buf.toString('utf8'), truncated: st.size > MAX_READ, size: st.size });
  }

  // ---- photos for a new task

  function prunePhotos() {
    const t = now();
    // An unused picture goes from disk too, not just from the list.
    const drop = id => { const ph = photos.get(id); photos.delete(id); fs.rm(ph.path, { force: true }, () => {}); };
    for (const [id, ph] of photos) if (t - ph.at > PHOTO_TTL_MS) drop(id);
    while (photos.size > MAX_PHOTOS) drop(photos.keys().next().value);
  }

  /** Picture bytes from the phone: saved as Shellby saves a pasted one, named by an id the phone hands back. */
  function savePhoto(bytes) {
    const { nativeImage } = require('electron');
    const r = attach.saveImage(bytes, d.shotsDir(), { nativeImage });
    if (r.error) return no(r.error);
    prunePhotos();
    const id = crypto.randomBytes(12).toString('base64url');
    photos.set(id, { path: r.path, at: now() });
    prunePhotos();
    return ok({ id });
  }

  /** The saved pictures a task named, each once. */
  function takePhotos(ids) {
    prunePhotos();
    const out = [];
    for (const id of Array.isArray(ids) ? ids.slice(0, 4) : []) {
      const ph = typeof id === 'string' ? photos.get(id) : null;
      if (!ph) continue;
      photos.delete(id);
      out.push(ph.path);
    }
    return out;
  }

  // ---- his progress, to look at

  function progress() {
    const v = phoneProgress(d.xpView?.());
    return v ? ok(v) : no('His XP card isn’t ready yet. Try again in a moment.');
  }

  const actions = {
    focus, routines, 'routine-run': runRoutine, 'routine-toggle': toggleRoutine, 'workflow-run': runWorkflow,
    notes: projectNotes, 'note-add': addNote, 'note-tick': tickNote,
    wardrobe, wear, pet, files, file: readFile, progress,
  };
  return { actions, savePhoto, takePhotos };
}

module.exports = { createPocketExtras, phoneProgress, FOCUS_LENGTHS, SECRET, SKIP_DIRS, MAX_READ };
