/* Shellby panel — "Look over my changes", with a choice of what to look for
   (shared/review-lenses.js): the project shield on Time, and a conversation's
   row in the review inbox. Each starts a read-only review in Ask-first mode
   (main's review.js); none of them changes anything. */
'use strict';
(function () {
  const { h, api } = SB;
  const L = window.ShellbyReviewLenses;
  const menu = h('div', { class: 'popover', id: 'lensMenu', role: 'menu', 'aria-label': 'Look over the changes for', hidden: true });
  document.body.append(menu);

  /**
   * The menu of lenses under `anchor`. goal: offer "Does it do what I asked?" (a conversation has a
   * first message to compare with; a project doesn't). onPick(id) starts the review.
   * @param {HTMLElement} anchor
   * @param {(id: string) => void} onPick
   * @param {{ goal?: boolean }} [opts]
   */
  SB.pickReviewLens = (anchor, onPick, { goal = false } = {}) => {
    SB.openMenu(menu, anchor, () => [
      h('div', { class: 'menu-label', text: 'Look over the changes for' }),
      ...L.lensesFor({ goal }).map(l => SB.menuItem(l.label, l.sub, () => { SB.closeMenus(); onPick(l.id); })),
      h('p', { class: 'small muted vw-menu-note', text: 'He reads and reports back. Nothing is changed.' }),
    ]);
  };

  // A review of one conversation's work (the inbox, the viewer): its own folder, any lens.
  SB.lookOverTab = async (tabId, lens) => {
    const r = await api.reviewFromSuggestion(tabId, lens).catch(() => null);
    if (r?.needsClaude) return SB.claudeUpsell?.('review');
    if (!r?.ok) return SB.toast(r?.error || "Couldn't start that.");
    SB.toast('Shellby is looking over the changes');
  };

})();
