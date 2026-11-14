// Pieces every mockup draws the same way: a row's quick actions, what an
// opened row shows, the bar for picked ones, and the parked list. Clicks are
// handled in one place through data-a="..." and data-id.
(function () {
  'use strict';
  const T = window.TB;
  const { esc } = T;
  const STAR = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2.3l1.75 3.6 3.95.55-2.86 2.77.68 3.93L8 11.3l-3.52 1.85.68-3.93L2.3 6.45l3.95-.55z"/></svg>';

  const btn = (a, t, text, cls = 'btn', extra = '') => `<button type="button" class="${cls}" data-a="${a}" data-id="${esc(t ? t.id : '')}" ${extra}>${text}</button>`;

  // Use and the pin stay in reach with the row closed; agents can also run a whole conversation.
  function acts(ak, t) {
    const on = ak.isPinned(t);
    return `${t.kind === 'agent' ? btn('chat', t, 'Chat as', 'btn ghost', `title="A new conversation run by ${esc(t.name)}"`) : ''}${btn('use', t, 'Use', 'btn', `aria-label="Use ${esc(ak.label(t))}"`)}${btn('pin', t, STAR, `star${on ? ' on' : ''}`, `aria-pressed="${on}" aria-label="Pin ${esc(ak.label(t))}" title="${on ? 'Unpin from' : 'Pin to'} the start screen"`)}`;
  }

  function detail(ak, t) {
    const h = ak.hint(t);
    const own = ak.isOwn(t);
    return `
      <p class="dt-where">${esc(ak.whereFrom(t))}</p>
      <p class="dt-stats${t.uses ? '' : ' idle'}">${esc(ak.stats(t).join(', '))}</p>
      ${h ? `<div class="dt-hint"><p>${esc(h.text)}</p>${h.act ? btn('sharpen', t, esc(h.act), 'btn amber') : ''}</div>` : ''}
      ${t.path ? `<code class="dt-path" title="${esc(t.path)}">${esc(t.path)}</code>` : ''}
      ${t.hides.length ? `<div class="dt-hint"><p>Only this copy (${esc(ak.sourceLabel(t.source))}) loads. Another copy hides behind it; remove the one you don’t want, so there’s no doubt which Claude gets.</p>
        ${t.hides.map(x => `<div class="dt-copy"><span class="tag">${esc(ak.sourceLabel(x.source))}</span><code>${esc(x.path)}</code>${btn('show', t, 'Show file', 'btn ghost')}</div>`).join('')}</div>` : ''}
      <div class="dt-acts">
        ${t.path ? btn('show', t, 'Show file', 'btn ghost') : ''}
        ${own ? btn('edit', t, 'Edit', 'btn ghost') : ''}
        ${own ? btn('remove', t, 'Remove', 'btn ghost danger', 'title="Shellby asks first, and it goes to the Recycle Bin"') : ''}
      </div>`;
  }

  function batchBar(ak) {
    const n = ak.st.picked.size;
    if (!n) return '';
    return `<div class="batch" role="toolbar" aria-label="Picked tools">
      <b>${n} picked</b>
      ${btn('pin-many', null, 'Pin', 'btn ghost')}${btn('unpin-many', null, 'Unpin', 'btn ghost')}
      ${btn('park', null, 'Park', 'btn ghost', 'title="Turn them off without deleting: Shellby keeps them, and Restore puts them back"')}
      ${btn('export', null, 'Export…', 'btn ghost')}${btn('remove-many', null, 'Remove…', 'btn ghost danger')}
      <span class="gap"></span>${btn('clear', null, 'Clear', 'btn quiet')}
    </div>`;
  }

  function parked(ak, glyphSize = 20) {
    const q = ak.st.q.trim().toLowerCase();
    const list = ak.st.parked.filter(p => (ak.st.kind === 'all' || p.kind === ak.st.kind) && (!q || p.name.includes(q)));
    if (!list.length) return '';
    return `<section class="parked" aria-label="Parked">
      <header><b>Parked</b><span class="muted">off, kept by Shellby</span>${list.length > 1 ? btn('restore-all', null, 'Restore all', 'btn ghost') : ''}</header>
      ${list.map(p => `<div class="parked-row">${T.glyph(p.kind, glyphSize)}<span><code>${esc(window.AK.label(p))}</code> <span class="muted">${p.at ? `parked ${esc(T.ago(p.at))}` : 'parked just now'}</span><small>${esc(p.desc)}</small></span><button type="button" class="btn" data-a="restore" data-id="${esc(p.id)}">Restore</button></div>`).join('')}
    </section>`;
  }

  // One click handler for all of it; returns true when it handled the click.
  function handle(ak, e) {
    const b = e.target.closest('[data-a]');
    if (!b) return false;
    const t = ak.byId(b.dataset.id);
    const A = ak.actions;
    const run = {
      use: () => A.use(t), chat: () => A.chatAs(t), pin: () => A.pin(t), sharpen: () => A.sharpen(t), edit: () => A.edit(t),
      show: () => A.showFile(t), remove: () => A.remove([t.id]),
      'pin-many': () => A.pinMany(true), 'unpin-many': () => A.pinMany(false), park: () => A.park(), export: () => A.exportPicked(),
      'remove-many': () => A.remove(), clear: () => { ak.st.picked.clear(); ak.set({}); },
      restore: () => A.restore([b.dataset.id]), 'restore-all': () => A.restore(ak.st.parked.map(p => p.id)),
      import: () => A.importTools(), 'park-unused': () => A.parkUnused(), mcp: () => A.openMcp(),
    }[b.dataset.a];
    if (!run) return false;
    run();
    return true;
  }

  // A redraw replaces the rows: put the keyboard back on the same button of the same row.
  function keepFocus(root, draw) {
    const a = document.activeElement;
    const inside = a && root.contains(a) && a !== root;
    const sig = inside ? [a.dataset.a, a.dataset.id, a.dataset.k, a.dataset.src, a.closest('[data-row]')?.dataset.row].map(v => v || '') : null;
    draw();
    if (!sig) return;
    const [act, id, k, src, row] = sig;
    const sel = act ? `[data-a="${act}"][data-id="${CSS.escape(id)}"]` : k ? `[data-k="${k}"]` : src ? `[data-src="${CSS.escape(src)}"]` : null;
    const scope = row && !act ? root.querySelector(`[data-row="${CSS.escape(row)}"]`) : root;
    const el = sel ? (scope || root).querySelector(sel) : null;
    el?.focus({ preventScroll: true });
  }

  window.AK_PARTS = Object.freeze({ acts, detail, batchBar, parked, handle, keepFocus, STAR });
})();
