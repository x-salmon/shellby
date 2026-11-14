// The Lean tab's one-tap fixes, the half that touches disk. leanfix.js drafts
// them from a hot-files report (a CLAUDE.md line about a file Claude keeps
// reading, a deny rule for a generated one it reads whole); this reads the
// project's files for it, and applies a fix only when:
//   - the panel named a fix Shellby itself drafted for the folder it's on
//     (the panel sends an id, never a path or text),
//   - the file still resolves inside the project, links followed,
//   - the file still reads exactly as the preview showed, before and after the
//     confirm window, which shows what goes in,
// and keeps what was there, so Undo puts the file back as long as nothing else
// has changed it since. The same goes for switching the output style off, in
// Shellby's own setting or in a Claude Code settings file (fixedcost.js says
// which is on): your own in your home, a project's only while it sits inside
// the project. Every write makes its temp file fresh ('wx'), so a link planted
// beside the target can't send it elsewhere. Nothing is written anywhere else.
// See test/lean-fixes.test.js.
const fs = require('fs');
const path = require('path');
const claudeSetup = require('./claude/setup');
const learnedRules = require('./learned-rules');
const outputStyles = require('./outputstyles');
const { samePath } = require('./toolbox');
const { relativeTo } = require('./usage/hotfiles');
const fixedcost = require('./fixedcost');
const leanfix = require('./leanfix');
const { obj, str } = require('./ipc-args');

const HEAD_BYTES = 4096;                 // of a file, for the line about it
const MAX_MEMORY = 512 * 1024;           // a CLAUDE.md bigger than this is left alone (claude/setup.js has the same limit)
const MAX_SETTINGS = 1024 * 1024;        // and a settings file bigger than this
const MAX_UNDO = 20;
const FIX_ID = str({ max: 1200 });
const UNDO_ID = str({ max: 80 });

const base = f => path.basename(String(f || ''));

/** The first HEAD_BYTES of a file as text, or null when it can't be read. */
function head(file) {
  /** @type {number | null} */
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    return buf.toString('utf8', 0, fs.readSync(fd, buf, 0, HEAD_BYTES, 0));
  } catch { return null; } finally { if (fd !== null) fs.closeSync(fd); }
}

/** A file's text as it is on disk: null when there is no file, undefined when it can't be read. */
function readRaw(file, max = Infinity) {
  try {
    if (fs.statSync(file).size > max) return undefined;
    return fs.readFileSync(file, 'utf8');
  } catch (e) { return e && e.code === 'ENOENT' ? null : undefined; }
}

/** Is there anything at this path, a link to nowhere included? */
function present(p) {
  try { fs.lstatSync(p); return true; } catch { return false; }
}

/**
 * A new file with exactly this text, made fresh: anything already at the path
 * (a stale one, or a link planted there to send the write elsewhere) is removed
 * first, and 'wx' refuses to open through anything that appears meanwhile.
 */
function createFresh(file, text) {
  if (present(file)) fs.unlinkSync(file);
  const fd = fs.openSync(file, 'wx');
  try { fs.writeFileSync(fd, text); } finally { fs.closeSync(fd); }
}

/** Write the text to the file in one move: a fresh temp file beside it, then renamed over it. */
function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.shellby-tmp`;
  createFresh(tmp, text);
  fs.renameSync(tmp, file);
}

/**
 * Where a path really is, links followed, even for a file not made yet (its
 * nearest existing folder is followed). A link to nowhere is null: there's no
 * telling where a write through it would land.
 */
function realDeep(p) {
  let cur = path.resolve(p);
  /** @type {string[]} */
  const tail = [];
  while (!present(cur)) {
    const up = path.dirname(cur);
    if (up === cur) return null;
    tail.unshift(path.basename(cur));
    cur = up;
  }
  try { return path.join(fs.realpathSync.native(cur), ...tail); } catch { return null; }
}

/** Does the file sit inside the project once every link is followed? */
function insideProject(file, project) {
  const real = realDeep(file);
  const root = realDeep(project);
  return !!real && !!root && relativeTo(real, root) !== null;
}

const normalise = text => String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
/** `text` in the shape `raw` had: its BOM and its line endings. */
const shaped = (raw, text) => (raw && raw.startsWith('﻿') ? '﻿' : '') + (raw && raw.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text);

/**
 * deps: { config, askOnce(spec) -> button index | null when another question is
 * up, setupWhere() -> { home, cwd }, log }
 */
function createLeanFixes({ config, askOnce, setupWhere, log, now = Date.now }) {
  /** @type {{ project: string | null, fixes: any[] }} */
  let drafted = { project: null, fixes: [] };
  /** @type {Map<string, any>} */
  const undos = new Map();
  let seq = 0;

  // The folder the panel is on, when it's a project and not the home folder itself.
  function projectOf() {
    const { home, cwd } = setupWhere();
    return cwd && !(home && samePath(cwd, home)) ? cwd : null;
  }

  function remember(entry) {
    const id = `undo:${++seq}:${now()}`;
    undos.set(id, { ...entry, at: now() });
    while (undos.size > MAX_UNDO) undos.delete(undos.keys().next().value);
    return id;
  }

  // ---- drafting

  /**
   * The fixes for the folder the panel is on, from its hot-files report. Kept
   * here with each file's exact text, so apply() can check nothing moved.
   */
  function drafts(hot) {
    const project = projectOf();
    if (!project || !hot) { drafted = { project: null, fixes: [] }; return []; }
    const mdFile = learnedRules.fileFor(project);
    const mdRaw = insideProject(mdFile, project) ? readRaw(mdFile, MAX_MEMORY) : undefined;
    const settingsFile = path.join(project, '.claude', 'settings.json');
    const settingsRaw = insideProject(settingsFile, project) ? readRaw(settingsFile, MAX_SETTINGS) : undefined;
    const headOf = rel => {
      const file = path.resolve(project, rel);
      return relativeTo(file, project) !== null && insideProject(file, project) ? head(file) : null;
    };
    const fixes = leanfix.draftFixes({
      hot, mdFile, settingsFile, headOf,
      md: mdRaw === undefined ? null : normalise(mdRaw ?? ''),
      settingsRaw: settingsRaw === undefined ? null : (settingsRaw ?? ''),
    }).map(f => {
      if (f.kind === 'claude-line') return { ...f, raw: mdRaw ?? null, write: shaped(mdRaw, f.after) };
      if (f.kind === 'deny-read') return { ...f, raw: settingsRaw ?? null, write: shaped(settingsRaw, f.after) };
      return f;
    });
    drafted = { project, fixes };
    return fixes.map(({ raw: _raw, write: _write, ...pub }) => pub);
  }

  // ---- applying

  function windowFor(fix) {
    const buttons = [{ label: fix.kind === 'deny-read' ? 'Add the rule' : 'Add the line', style: 'primary' }, { label: 'Cancel' }];
    if (fix.kind === 'deny-read') {
      return {
        icon: '🧹', title: `Keep ${fix.rel} out of the conversation?`,
        message: `Shellby adds a deny rule to ${fix.file}, so Claude can't read ${fix.rel} whole in this project. It can still search inside it. The file is written back with two-space indents. Undo on the Lean tab takes the rule out again, and so does Toolbox → Setup → Rules.`,
        detail: `Added to permissions.deny:\n${fix.rule}`, buttons, defaultId: 1, cancelId: 1,
      };
    }
    const fresh = typeof fix.added === 'string' && fix.added.includes(leanfix.HEADING);
    return {
      icon: '🧹', title: `Add a line about ${fix.rel} to CLAUDE.md?`,
      message: `Shellby adds it under "${leanfix.HEADING.replace(/^#+\s*/, '')}" in ${fix.file}${fresh ? ', a new section at the end' : ''}. Nothing else in the file changes, and Undo on the Lean tab takes it out again.`,
      detail: fix.line, buttons, defaultId: 1, cancelId: 1,
    };
  }

  /** Apply a drafted fix by its id: asked first, written only if the file still reads as the preview did. */
  async function apply(id) {
    const fix = drafted.fixes.find(f => f.id === id);
    const project = projectOf();
    if (!fix || !project || !drafted.project || !samePath(project, drafted.project)) return { ok: false, error: 'That fix is from an earlier look. Check again and try once more.' };
    if (fix.kind !== 'deny-read' && fix.kind !== 'claude-line') return { ok: false, error: "That one is a suggestion to try by hand: there's nothing to apply." };
    const name = base(fix.file);
    // Still inside the project (links followed), still the file the preview showed: checked
    // before asking, and again after, since the window stays up a while.
    const check = () => {
      if (!insideProject(fix.file, project)) return { ok: false, error: `${name} points outside the project, so Shellby left it alone.` };
      if (fix.kind === 'claude-line' && !/\.md$/i.test(realDeep(fix.file) || '')) return { ok: false, error: "That isn't a markdown file, so Shellby won't write to it." };
      if (readRaw(fix.file) !== fix.raw) return { ok: false, changed: true, error: `${name} changed since this fix was drafted. Check again to see the new one.` };
      return null;
    };
    const before = check();
    if (before) return before;
    const response = await askOnce(windowFor(fix));
    if (response === null) return { ok: false, cancelled: true, busy: true };
    if (response !== 0) return { ok: false, cancelled: true };
    const since = check();
    if (since) return since;
    try { writeText(fix.file, fix.write); } catch (e) {
      log?.warn?.(`lean fixes: couldn't write ${fix.file}: ${e && e.message}`);
      return { ok: false, error: `Couldn't write ${name}.` };
    }
    const undoId = remember({ kind: fix.kind, scope: 'project', file: fix.file, before: fix.raw, after: fix.write, label: fix.title });
    return { ok: true, undoId, file: fix.file };
  }

  /** Put a file back as it was before a fix (or a style switch), if nothing else has changed it since. */
  function undo(id) {
    const u = typeof id === 'string' ? undos.get(id) : null;
    if (!u) return { ok: false, error: "That change isn't one Shellby can take back any more." };
    if (u.kind === 'style-config') {
      config.set({ outputStyle: outputStyles.clean(u.before) });
      undos.delete(id);
      return { ok: true };
    }
    const name = base(u.file);
    // A project's file must still be inside it (your own settings file lives in your home).
    if (u.scope !== 'user') {
      const project = projectOf();
      if (!project || !insideProject(u.file, project)) return { ok: false, error: `${name} is outside the project now, so Shellby left it alone.` };
    }
    if (readRaw(u.file) !== u.after) return { ok: false, error: `${name} changed since Shellby wrote it, so it's left as it is.` };
    try {
      if (u.before === null) fs.unlinkSync(u.file);
      else writeText(u.file, u.before);
    } catch (e) {
      log?.warn?.(`lean fixes: couldn't put back ${u.file}: ${e && e.message}`);
      return { ok: false, error: `Couldn't put ${name} back.` };
    }
    undos.delete(id);
    return { ok: true, file: u.file };
  }

  // ---- the output style

  // A style of your own is a markdown file in an output-styles folder, by file name or its frontmatter name.
  function styleChars(name, { home, cwd }) {
    const want = String(name).toLowerCase();
    if (fixedcost.BUILT_IN_STYLE_TOKENS[want]) return null;
    for (const dir of [cwd ? path.join(cwd, '.claude', 'output-styles') : null, home ? path.join(home, '.claude', 'output-styles') : null]) {
      if (!dir) continue;
      let names;
      try { names = fs.readdirSync(dir).filter(n => /\.md$/i.test(n)); } catch { continue; }
      const hit = names.find(n => n.slice(0, -3).toLowerCase() === want)
        || names.find(n => String(outputStyles.frontmatter(head(path.join(dir, n)) || '').name || '').toLowerCase() === want);
      if (hit) { try { return fs.statSync(path.join(dir, hit)).size; } catch { return null; } }
    }
    return null;
  }

  /** Which output style is on and where: { name, source, file, chars } or null. */
  function activeStyle() {
    const where = setupWhere();
    const files = claudeSetup.settingsFiles(where).reverse().map(f => ({ ...f, data: claudeSetup.readSettings(f.file).data }));
    const style = fixedcost.activeStyle({ shellby: outputStyles.clean(config.get('outputStyle')), files });
    return style ? { ...style, chars: styleChars(style.name, where) } : null;
  }

  // The settings file without its outputStyle, as text: { ok, before, after } or { ok: false, error }.
  function withoutStyle(file) {
    const raw = readRaw(file, MAX_SETTINGS);
    if (typeof raw !== 'string') return { ok: false, error: `Couldn't read ${base(file)}, so Shellby left it alone.` };
    /** @type {any} */
    let data;
    try { data = JSON.parse(raw.replace(/^﻿/, '') || '{}'); } catch { return { ok: false, error: `${base(file)} isn't valid JSON, so Shellby left it alone.` }; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: `${base(file)} isn't a settings object, so Shellby left it alone.` };
    const { outputStyle: _off, ...rest } = data;
    return { ok: true, before: raw, after: shaped(raw, `${JSON.stringify(rest, null, 2)}\n`) };
  }

  /** Switch the active style off, asked first: Shellby's own setting, or the key in the settings file that names it. */
  async function styleOff() {
    const style = activeStyle();
    if (!style) return { ok: false, error: 'No output style is on.' };
    const own = style.source === 'shellby';
    // A project's settings file is written only while it sits inside the project, links followed.
    const target = () => {
      if (own || !style.file) return null;
      const real = realDeep(style.file);
      if (!real) return null;
      if (style.source === 'user') return real;
      const project = projectOf();
      return project && insideProject(style.file, project) ? real : null;
    };
    if (!own && !target()) return { ok: false, error: `${base(style.file)} points outside the project, so Shellby left it alone.` };
    const plan = own ? null : withoutStyle(/** @type {string} */ (target()));
    if (plan && !plan.ok) return plan;
    const response = await askOnce({
      icon: '🧹', title: `Switch off the "${style.name}" output style?`,
      message: own
        ? 'New conversations Shellby starts use the Default style, which keeps replies brief. Pick a style again any time in Settings → Claude, or Undo on the Lean tab.'
        : `Shellby takes outputStyle out of ${style.file}. New conversations use the Default style; a backup of the file is kept beside it, and Undo on the Lean tab puts it back.`,
      buttons: [{ label: 'Switch it off', style: 'primary' }, { label: 'Cancel' }], defaultId: 1, cancelId: 1,
    });
    if (response === null) return { ok: false, cancelled: true, busy: true };
    if (response !== 0) return { ok: false, cancelled: true };
    if (own) {
      const before = config.get('outputStyle');
      config.set({ outputStyle: '' });
      return { ok: true, undoId: remember({ kind: 'style-config', before }), was: style };
    }
    // Checked again after the wait: the file where it was, and still as read.
    const file = target();
    if (!file || !plan) return { ok: false, error: `${base(style.file)} points outside the project, so Shellby left it alone.` };
    if (readRaw(file) !== plan.before) return { ok: false, changed: true, error: `${base(file)} changed meanwhile, so Shellby left it alone. Check again.` };
    try {
      // A one-time backup beside it, as the hooks and the status line keep (claude/setup.js), made fresh.
      const backup = `${file}.shellby-backup`;
      if (!present(backup)) createFresh(backup, plan.before);
      writeText(file, plan.after);
    } catch (e) {
      log?.warn?.(`lean fixes: couldn't write ${file}: ${e && e.message}`);
      return { ok: false, error: `Couldn't write ${base(file)}.` };
    }
    return { ok: true, undoId: remember({ kind: 'style-file', scope: style.source, file, before: plan.before, after: plan.after }), was: style };
  }

  function register(ipcMain) {
    ipcMain.handle('lean:fix-apply', (_e, a) => apply(a.id), [obj({ id: FIX_ID })]);
    ipcMain.handle('lean:fix-undo', (_e, a) => undo(a.id), [obj({ id: UNDO_ID })]);
    ipcMain.handle('lean:style-off', () => styleOff());
  }

  return { drafts, apply, undo, activeStyle, styleOff, register };
}

module.exports = { createLeanFixes, insideProject, realDeep };
