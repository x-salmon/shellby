/* Shellby panel — Toolbox → Lean, two more sections. What every turn carries
   before your own words, item by item with its share and what each estimate
   rests on, then suggestions that say what they save: the output style can be
   switched off from here, an idle plugin turned off, a CLAUDE.md section moved
   by hand. And one-tap fixes for repeated big reads and loud commands: a line
   for CLAUDE.md, a deny rule for the project's settings, each shown as a diff
   before Apply, which asks in the confirm window; Undo on the row puts the file
   back. The numbers and the drafts come from main (fixedcost.js, lean-fixes.js). */
'use strict';
(function () {
  const { h, api, state } = SB;
  const MAX_DIFF_ROWS = 60;
  const tok = n => `~${SB.compact(Math.round(n))} tokens`;
  const pct = r => `${Math.round(r * 100)}%`;
  const rerender = () => { if (state.view === 'toolbox') SB.views.toolbox.render(); };
  const busy = new Set();     // ids with a change in flight
  const open = new Set();     // fixes whose diff is shown
  const applied = new Map();  // a fix's key -> { undoId, file }, until undone or the panel reloads
  const keyOf = f => `${f.file || ''}|${f.id}`;

  const BASIS = {
    size: 'from its size on disk, at four characters a token',
    rough: 'a rough figure: Claude Code keeps its built-in styles in its own prompt, not on disk',
    claude: "Claude Code's own estimate",
    seen: "as seen in Claude Code's transcripts",
  };
  const KIND = { style: 'output style', memory: 'CLAUDE.md', rule: 'rule', plugin: 'plugin', skills: 'listings', mcp: 'MCP server', hook: 'hook' };
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

  // ------------------------------------------------------------ what every turn carries

  function itemDesc(it) {
    const basis = it.estimate ? BASIS[it.estimate] : '';
    if (it.kind === 'mcp') return "Its tools are listed for Claude in every conversation; Shellby can't size the list.";
    if (it.kind === 'hook') return `${it.when === 'message' ? 'Adds it with every message you send' : 'Adds it as each conversation starts'} · ${basis}`;
    if (it.kind === 'style') return `${it.source === 'shellby' ? 'Set in Settings → Claude' : `Set in ${it.file || `your ${it.source} settings`}`}${basis ? ` · ${basis}` : ''}`;
    if (it.kind === 'plugin') return it.tokens == null ? "Claude Code didn't say what it adds" : basis;
    return it.path ? `${it.path} · ${basis}` : basis;
  }

  function itemRow(it) {
    const size = it.tokens == null ? 'not sized' : `${tok(it.tokens)}${it.share != null ? ` · ${pct(it.share)}` : ''}`;
    return h('li', { class: 'tool-row lean-item', dataset: { kind: it.kind } },
      h('div', { class: 'tool-main' },
        h('div', { class: 'tool-name' },
          h('code', { text: it.label, title: it.path || it.label }),
          h('span', { class: 'lean-kind', text: KIND[it.kind] || it.kind }),
          h('span', { class: 'src-pill', title: it.share != null ? 'Its share of what every turn carries' : 'Shellby can\'t size this one', text: size })),
        h('p', { class: 'tool-desc', text: itemDesc(it), title: it.path || null })));
  }

  async function undo(undoId, done) {
    const r = await api.leanFixUndo(undoId).catch(() => null);
    if (r?.ok) { SB.toast(done); SB.lean.load(); } else SB.toast(r?.error || "Couldn't undo that.", { ms: 8000 });
  }

  async function styleOff(s) {
    const r = await change(s.id, () => api.leanStyleOff());
    if (!r?.ok) return;
    if (state.settings && r.was?.source === 'shellby') state.settings.outputStyle = '';
    SB.toast(`Switched off the "${r.was?.name || ''}" style. New conversations keep replies brief.`, { action: 'Undo', onAction: () => undo(r.undoId, 'The style is back on.'), ms: 10000 });
    SB.lean.load();
  }

  async function pluginOff(s) {
    const r = await change(s.id, () => api.leanPlugin(s.action.id, false));
    if (!r?.ok) return;
    if (r.plugins) state.lean = r;
    SB.toast(`Turned off ${s.label}. New conversations won't load it.`, { ms: 6000 });
    rerender();
  }

  function suggestionRow(s) {
    const working = busy.has(s.id);
    let action = null;
    if (s.action?.type === 'style-off') action = h('button', { class: 'btn slim-btn', type: 'button', disabled: working, title: 'Shellby asks first, and Undo puts it back', onclick: () => styleOff(s) }, working ? '…' : 'Switch it off');
    else if (s.action?.type === 'plugin-off') action = h('button', { class: 'btn slim-btn', type: 'button', disabled: working, title: 'Shellby asks first; the plugin stays installed', onclick: () => pluginOff(s) }, working ? '…' : 'Turn it off');
    else if (s.path) action = h('button', { class: 'icon-btn', type: 'button', title: 'Show file', 'aria-label': 'Show file', onclick: () => api.revealSetupFile(s.path) }, SB.icon(SB.ICONS.folder, { width: 1.3 }));
    return h('li', { class: 'tool-row lean-sugg', dataset: { id: s.id } },
      h('div', { class: 'tool-main' },
        h('div', { class: 'tool-name' },
          h('code', { text: s.label || s.kind }),
          s.action ? null : h('span', { class: 'lean-kind', text: 'by hand' }),
          s.saves ? h('span', { class: 'src-pill', title: 'What it saves on every turn', text: `saves ${tok(s.saves)}` }) : null),
        h('p', { class: 'tool-desc', text: s.text })),
      action ? h('div', { class: 'tool-actions' }, action) : null);
  }

  /** The rows for "Sent with every turn" and its suggestions, or none before a report says. */
  function fixedRows(rep, match) {
    const fx = rep?.fixed;
    if (!fx?.items?.length) return [];
    const items = fx.items.filter(i => match(String(i.label)) || match(String(i.path || '')));
    const suggs = (fx.suggestions || []).filter(s => match(s.text));
    const head = `Sent with every turn: ${tok(fx.total)}${fx.measured ? ', measured on the last fresh start' : ', estimated'}`;
    return [
      h('li', { class: 'row-label lean-label lean-fixed-label', text: head }),
      ...items.map(itemRow),
      fx.rest ? h('li', { class: 'lean-note', text: `Claude Code's own prompt and tools take the other ${tok(fx.rest)}. Each size is an estimate.` }) : null,
      suggs.length ? h('li', { class: 'row-label lean-label', text: 'What could go' }) : null,
      ...suggs.map(suggestionRow),
    ].filter(Boolean);
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

  SB.leanFixes = { fixedRows, fixRows, line: () => state.lean?.fixed?.line || '' };
})();
