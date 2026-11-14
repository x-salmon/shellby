/* Shellby panel — Toolbox → Lean, the changes it makes. The cuts the bar offers
   (lean-bar.js): the output style switched off and an idle plugin turned off,
   each asked in the confirm window first, with Undo for the style. And one-tap
   fixes for repeated big reads and loud commands: a line for CLAUDE.md, a deny
   rule for the project's settings, each shown as a diff before Apply, which
   asks in the confirm window; Undo on the row puts the file back. The numbers
   and the drafts come from main (fixedcost.js, lean-fixes.js). */
'use strict';
(function () {
  const { h, api, state } = SB;
  const MAX_DIFF_ROWS = 60;
  const rerender = () => { if (state.view === 'toolbox') SB.views.toolbox.render(); };
  const busy = new Set();     // ids with a change in flight
  const open = new Set();     // fixes whose diff is shown
  const applied = new Map();  // a fix's key -> { undoId, file }, until undone or the panel reloads
  const keyOf = f => `${f.file || ''}|${f.id}`;
  const FIX_KIND = { 'deny-read': 'deny rule', 'claude-line': 'CLAUDE.md line', quiet: 'suggestion' };

  async function change(key, fn) {
    if (busy.has(key)) return null;
    busy.add(key);
    rerender();
    let r;
    try { r = await fn(); } catch { r = { ok: false, error: "Shellby couldn't do that." }; }
    busy.delete(key);
    if (!r?.ok && !r?.cancelled) SB.toast(r?.error || "Couldn't do that.", { ms: 8000 });
    rerender();
    return r;
  }

  // ------------------------------------------------------------ the cuts the bar offers

  async function undo(undoId, done) {
    const r = await api.leanFixUndo(undoId).catch(() => null);
    if (r?.ok) { SB.toast(done); SB.lean.load(); } else SB.toast(r?.error || "Couldn't undo that.", { ms: 8000 });
  }

  /** Switch the output style off (asked first). -> main's answer, null when already in flight. */
  async function styleOff(s) {
    const r = await change(s.id, () => api.leanStyleOff());
    if (!r?.ok) return r;
    if (state.settings && r.was?.source === 'shellby') state.settings.outputStyle = '';
    SB.toast(`Switched off the "${r.was?.name || ''}" style. New conversations keep replies brief.`, { action: 'Undo', onAction: () => undo(r.undoId, 'The style is back on.'), ms: 10000 });
    SB.lean.load();
    return r;
  }

  /** Turn an idle plugin off (asked first; it stays installed). -> main's answer. */
  async function pluginOff(s) {
    const r = await change(s.id, () => api.leanPlugin(s.action.id, false));
    if (!r?.ok) return r;
    if (r.plugins) state.lean = r;
    SB.toast(`Turned off ${s.label}. New conversations won't load it.`, { ms: 6000 });
    rerender();
    return r;
  }

  // ------------------------------------------------------------ one-tap fixes

  // The file as the fix would leave it, red and green (shared/diff.js); only the added lines when the file isn't along.
  function diffBox(f) {
    const D = window.ShellbyDiff;
    const rows = typeof f.before === 'string' && typeof f.after === 'string' && D
      ? D.rows({ old: f.before, new: f.after }, { context: 2 })
      : String(f.added || '').replace(/\n$/, '').split('\n').map(s => ({ t: '+', s }));
    const box = h('pre', { class: 'diff lean-diff', 'aria-label': `${SB.basename(f.file)} after this fix` });
    rows.forEach((r, i) => {
      if (i === MAX_DIFF_ROWS) { box.append(h('span', { class: 'dl meta', text: `… ${rows.length - MAX_DIFF_ROWS} more lines` })); return; }
      if (i > MAX_DIFF_ROWS) return;
      if (r.t === '…') { box.append(h('span', { class: 'dl meta', text: `⋯ ${r.n} unchanged line${r.n === 1 ? '' : 's'}` })); return; }
      box.append(h('span', { class: `dl ${r.t === '+' ? 'add' : r.t === '-' ? 'del' : 'ctx'}`, text: `${r.t === ' ' ? ' ' : r.t} ${r.s}` }));
    });
    return box;
  }

  async function apply(f) {
    const r = await change(f.id, () => api.leanFixApply(f.id));
    if (r?.ok) {
      applied.set(keyOf(f), { undoId: r.undoId, file: r.file });
      SB.toast(`Added to ${SB.basename(r.file)}. New conversations see it.`, { action: 'Undo', onAction: () => undoFix(f), ms: 10000 });
    } else if (r?.changed) SB.lean.load(); // drafted again from the file as it is now
    rerender();
  }

  async function undoFix(f) {
    const done = applied.get(keyOf(f));
    if (!done) return;
    const r = await change(f.id, () => api.leanFixUndo(done.undoId));
    if (r?.ok) { applied.delete(keyOf(f)); SB.toast(`${SB.basename(done.file)} is back as it was.`); }
    rerender();
  }

  function fixRow(f) {
    const working = busy.has(f.id);
    const done = applied.get(keyOf(f));
    const shown = open.has(f.id);
    const canApply = f.kind === 'deny-read' || f.kind === 'claude-line';
    const actions = [];
    if (canApply) actions.push(h('button', { class: 'btn ghost slim-btn', type: 'button', 'aria-expanded': String(shown), title: 'The file as it would read afterwards', onclick: () => { if (shown) open.delete(f.id); else open.add(f.id); rerender(); } }, shown ? 'Hide diff' : 'Preview'));
    if (canApply && !done) actions.push(h('button', { class: 'btn slim-btn', type: 'button', disabled: working, title: 'Shellby shows the change in the confirm window first, and Undo puts the file back', onclick: () => apply(f) }, working ? '…' : 'Apply'));
    if (done) actions.push(h('button', { class: 'btn ghost slim-btn', type: 'button', disabled: working, title: 'Puts the file back as it was, if nothing else changed it since', onclick: () => undoFix(f) }, working ? '…' : 'Undo'));
    return h('li', { class: `tool-row lean-fix${done ? ' is-applied' : ''}`, dataset: { id: f.id, kind: f.kind } },
      h('div', { class: 'tool-main' },
        h('div', { class: 'tool-name' },
          h('code', { text: f.kind === 'quiet' ? f.key : f.rel }),
          h('span', { class: 'lean-kind', text: FIX_KIND[f.kind] || f.kind }),
          done ? h('span', { class: 'idle-pill lean-applied', text: 'applied' }) : null,
          canApply && f.file ? h('span', { class: 'src-pill', title: f.file, text: SB.basename(f.file) }) : null),
        h('p', { class: 'tool-desc', text: f.why }),
        f.kind === 'quiet' ? h('p', { class: 'tool-desc lean-fix-sugg', text: f.suggestion }) : null,
        canApply ? h('p', { class: 'tool-desc lean-fix-line' }, h('code', { text: f.kind === 'deny-read' ? f.rule : f.line })) : null,
        shown ? diffBox(f) : null),
      actions.length ? h('div', { class: 'tool-actions' }, ...actions) : null);
  }

  /** The rows for the one-tap fixes, or none when there is nothing to fix here. */
  function fixRows(rep, match) {
    const fixes = (rep?.fixes || []).filter(f => match(String(f.rel || f.key || '')));
    if (!fixes.length) return [];
    return [
      h('li', { class: 'row-label lean-label lean-fixes-label', text: 'One-tap fixes: repeated big reads and loud commands' }),
      ...fixes.map(fixRow),
    ];
  }

  // diffBox: the nudge under a repeated read shows its fix the same way (feed-savers.js).
  SB.leanFixes = { fixRows, styleOff, pluginOff, diffBox, isBusy: id => busy.has(id), line: () => state.lean?.fixed?.line || '' };
})();
