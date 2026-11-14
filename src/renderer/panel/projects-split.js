/* Shellby panel — Projects on a wide page. Once the page is SPLIT_MIN wide
   (projects-logic.js), the list stays on the left and the open project's page
   sits beside it; from THREE_MIN the inbox and the health sections leave the
   bottom of the list for a column of their own on the right. A narrower page
   is the panel's single list, with every part back where it started.

   projects.js asks P.split() whenever it shows a screen, and calls P.afterClose()
   when a project closes, so a wide page always has one open if there is one. */
'use strict';
(function () {
  const { $, state } = SB;
  const L = window.ShellbyProjectsLogic;
  const P = SB.pj;

  // What moves to the third column, top to bottom.
  const SIDE_IDS = ['pjInbox', 'depsHealth', 'flakyTests', 'depWatch'];
  /** @type {Map<string, Comment>} where each one lives on a narrower page */
  const homes = new Map();

  const view = $('projectsView');
  let layout = 'one';
  /** @type {string | null} the project a wide page opened by itself (pickFirst) */
  let auto = null;
  P.split = () => layout !== 'one';

  function toSide() {
    for (const id of SIDE_IDS) {
      const el = $(id);
      if (!homes.has(id)) {
        const mark = document.createComment(` ${id} on a narrower page `);
        el.before(mark);
        homes.set(id, mark);
      }
      $('pjSide').append(el);
    }
  }

  function toHome() {
    for (const id of SIDE_IDS) homes.get(id)?.after($(id));
  }

  function apply(next) {
    if (next === layout) return;
    layout = next;
    view.dataset.layout = next;
    if (next === 'three') toSide(); else toHome();
    $('pjSide').hidden = next !== 'three';
    // A project the wide page opened by itself closes again on the panel's
    // single list, which starts on the list as it always has.
    if (next === 'one' && auto && P.openKey() === auto) { auto = null; P.closeProject(); return; }
    const sheet = !$('pjScanSheet').hidden ? 'scan' : !$('pjCloneSheet').hidden ? 'clone' : null;
    P.showScreen(sheet || (P.openKey() ? 'detail' : 'list'));
    P.renderAll();
    pickFirst();
  }

  // A wide page with nothing open opens the top project, as a mail app opens
  // the newest message. Nothing is opened under a scan or a clone, and a
  // project whose page couldn't be read isn't tried again (that would loop).
  let picking = false;
  const unreadable = new Set();
  async function pickFirst() {
    if (!P.split() || P.openKey() || P.wanted() || picking || state.view !== 'projects') return;
    if (!$('pjScanSheet').hidden || !$('pjCloneSheet').hidden) return;
    const key = P.visibleKeys().find(k => !unreadable.has(k));
    if (!key) return;
    picking = true;
    try {
      await P.openProject(key, { quiet: true });
      if (P.openKey() === key) auto = key; else unreadable.add(key);
    } finally { picking = false; }
  }
  P.afterClose = pickFirst;

  // Each visit to the page tries every project again: a page that couldn't be read once may read now.
  const shown = SB.views.projects.render;
  SB.views.projects.render = () => { unreadable.clear(); shown(); };

  // The list draws after its data comes back: the first rows are the moment to pick.
  new MutationObserver(() => pickFirst()).observe($('pjProjects'), { childList: true });

  // A hidden view measures 0 wide: keep the layout it had until it's seen again.
  new ResizeObserver(([entry]) => {
    const width = entry.contentRect.width;
    if (width) apply(L.layoutFor(width));
  }).observe(view);

  // J and K walk the list beside the page, as they do in a mail app.
  const typing = el => el instanceof HTMLElement && (el.isContentEditable || el.matches('input, textarea, select'));
  document.addEventListener('keydown', e => {
    if (state.view !== 'projects' || !P.split() || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    if (e.key !== 'j' && e.key !== 'k') return;
    if (e.defaultPrevented || typing(document.activeElement) || !$('pjMenu').hidden || !$('pjScanSheet').hidden || !$('pjCloneSheet').hidden) return;
    // Nothing changes behind a sheet, the palette or a popover.
    if ([...document.querySelectorAll('[role="dialog"]')].some(d => d.checkVisibility())) return;
    const key = L.stepKey(P.visibleKeys(), P.openKey(), e.key === 'j' ? 1 : -1);
    if (!key || key === P.openKey()) return;
    e.preventDefault();
    P.openProject(key).then(() => {
      const row = $('pjProjects').querySelector(`.pj-row[aria-current="true"]`);
      row?.scrollIntoView({ block: 'nearest' });
      const name = P.detail()?.name;
      if (name) SB.announce(name);
    });
  });
})();
