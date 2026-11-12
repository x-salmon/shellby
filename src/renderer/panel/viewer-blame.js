/* Shellby panel — who last changed a line, in the file viewer: right-click a
   line (or press the menu key on the line picked with the arrows) and a note
   under it says which commit, when, and whether Claude Code made it. Main runs
   git blame through the viewer's handle (viewer.js blameOf), so the panel still
   never names a path outside it or a ref. */
'use strict';
(function () {
  const { h, $, api } = SB;

  /** @type {HTMLElement | null} */
  let shown = null;
  const drop = () => { shown?.remove(); shown = null; };

  // The line a row is in the file as it is now: a diff row's new-side number (its last), a whole
  // file's only one. A removed line has none.
  function lineOf(row) {
    const nums = row.querySelectorAll(':scope > .vw-ln');
    const n = Number(nums[nums.length - 1]?.textContent || '');
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function card(row, body) {
    drop();
    const close = h('button', { type: 'button', class: 'rv-link', 'aria-label': 'Close', text: '×', onclick: drop });
    shown = h('div', { class: 'vw-blame', role: 'note' }, h('div', { class: 'vw-blame-body' }, ...body), close);
    let at = row.parentElement?.classList.contains('sx-row') ? row.parentElement : row;
    while (at.nextElementSibling && !at.nextElementSibling.classList.contains('dl')) at = at.nextElementSibling;
    at.after(shown);
  }

  function said(r) {
    if (!r?.ok) return [h('span', { class: 'muted', text: r?.missing ? 'Git has no history for this file yet.' : r?.error || "Couldn't ask git about that line." })];
    if (r.uncommitted) return [h('span', { class: 'vw-who', text: 'Not committed yet' }), h('span', { class: 'muted', text: ' · changed here since the last commit' })];
    return [
      r.claude ? h('span', { class: 'vw-claude', text: 'Claude', title: "Claude Code's name is on this commit" }) : null,
      h('span', { class: 'vw-who', text: r.author || 'Someone' }),
      h('span', { class: 'muted', text: ` · ${r.when ? SB.relTime(r.when) : ''}` }),
      h('code', { class: 'vw-sha', text: ` ${r.commit}` }),
      r.summary ? h('span', { class: 'vw-msg', text: ` ${r.summary}` }) : null,
    ].filter(Boolean);
  }

  async function blame(row) {
    const me = SB.viewer?.current();
    if (!me?.file || me.gone) return;
    const n = lineOf(row);
    if (!n) { card(row, [h('span', { class: 'muted', text: 'This line was removed in these changes, so nobody has it now.' })]); return; }
    card(row, [h('span', { class: 'muted', text: `Asking git about line ${n}…` })]);
    const holder = shown;
    const r = await api.viewerBlame(me.id, me.file, n).catch(() => null);
    if (shown !== holder || SB.viewer?.current()?.file !== me.file) return;
    card(row, said(r));
  }

  $('viewerMain').addEventListener('contextmenu', e => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (t.closest('.rv-box, .rv-note, .vw-blame, textarea, input')) return;
    // From the keyboard (the menu key) the event lands on the focused diff: its picked line.
    const row = t.closest('.vw-code .dl') || t.querySelector?.('.dl.cursor, .dl.hit');
    if (!row || row.classList.contains('hunk') || row.classList.contains('meta')) return;
    if (!SB.viewer?.current()?.git) return;
    e.preventDefault();
    blame(/** @type {HTMLElement} */ (row));
  });
})();
