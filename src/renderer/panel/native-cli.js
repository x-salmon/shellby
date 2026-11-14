/* Shellby panel — by the box, for the conversation on screen: the goal Claude
   checks before it stops (/goal, pinned until it's met or cleared), and what
   Claude Code guesses you'll ask next (its prompt suggestions), which Tab or a
   click puts in the box, unsent. Shellby makes neither: both are Claude Code's.
   An unfocused pane shows its own guess over its stand-in (tab-panes.js); a
   click there brings the box to that pane with the guess in it. */
'use strict';
(function () {
  const { h, $ } = SB;
  const input = $('input');

  function renderGoal(tab) {
    const box = $('goalPin');
    const goal = tab && SB.activeTab() === tab ? tab.goal : null;
    box.hidden = !goal;
    if (!goal) { box.replaceChildren(); return; }
    box.replaceChildren(
      h('span', { class: 'goal-icon', 'aria-hidden': 'true', text: '🎯' }),
      h('span', { class: 'goal-text', title: goal }, h('b', { text: 'Goal ' }), goal),
      h('button', { class: 'icon-btn goal-clear', type: 'button', title: 'Clear the goal (/goal clear)', 'aria-label': 'Clear the goal',
        disabled: !!tab.busy, onclick: () => clearGoal(tab) }, '×'));
  }

  async function clearGoal(tab) {
    if (tab.busy) return SB.toast('Claude is working. Clear the goal once this turn ends.');
    await SB.sendNow(tab, '/goal clear', []); // it says itself if it couldn't
  }

  // syncBusyUi calls this on every turn ending in any tab, every queue change and
  // more. Rebuilt each time, the chip replayed its fade-in and was swapped out
  // from under the pointer: it flashed and wouldn't stay hovered. Only a new
  // guess (or the chip going away) touches it. Each box, the composer's and
  // every pane's, remembers what it shows.
  /** @type {WeakMap<HTMLElement, { tab: any, text: string | null }>} */
  const shownNext = new WeakMap();
  function renderNextPrompt(tab) {
    const active = !tab || SB.activeTab() === tab;
    const box = active ? $('nextPrompt') : SB.paneTrayBox?.(tab.id, 'nextPrompt');
    if (!box) return;
    const text = tab && !tab.busy ? tab.nextPrompt : null;
    const was = shownNext.get(box);
    if (was && text === was.text && (!text || tab === was.tab) && box.hidden === !text) return;
    shownNext.set(box, { tab, text });
    box.hidden = !text;
    if (!text) { box.replaceChildren(); return; }
    box.replaceChildren(h('button', { class: 'suggestion next-chip', type: 'button',
      title: active ? 'Put it in the box (Tab). Nothing is sent until you press Enter.' : 'Put it in the box, in this pane. Nothing is sent until you press Enter.',
      onclick: () => take(tab) },
    h('span', { class: 'glyph', text: '›' }), text, active ? h('kbd', { class: 'next-key', text: 'Tab' }) : null));
  }

  function take(tab) {
    if (!tab?.nextPrompt || tab.busy) return false;
    if (SB.activeTab() !== tab) SB.activate(tab.id); // from an unfocused pane: the box comes to it first
    input.value = tab.nextPrompt;
    tab.nextPrompt = null;
    renderNextPrompt(tab);
    SB.autosize?.();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    return true;
  }

  SB.renderGoal = renderGoal;
  SB.renderNextPrompt = renderNextPrompt;
  SB.takeNextPrompt = () => take(SB.activeTab());
})();
