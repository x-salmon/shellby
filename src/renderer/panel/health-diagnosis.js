/* Shellby panel — Health: how it got here and what would help, under the hero
   while he sweats, gets dizzy or overstuffs his shell. The words are
   health-logic.js's (diagnosis); the app to blame comes from the list in
   health-hogs.js. */
'use strict';
(function () {
  const { h, $ } = SB;
  const L = window.ShellbyHealthLogic;
  const H = SB.health;
  const MIN = 60 * 1000;

  // Which alert setting "Move your line" opens on, by the kind of check.
  const LINE_KEY = { 'gpu-temp': 'gpuWarn', 'cpu-temp': 'cpuWarn', 'storage-temp': 'storageWarn', ram: 'ramWarn', disk: 'diskWarnGb', reclaim: 'reclaimWarnGb' };

  function lineKey(view) {
    const r = view?.checks?.[view?.mood?.id]?.reading;
    return LINE_KEY[r?.kind] || (view?.mood?.id === 'ram' ? 'ramWarn' : null);
  }

  function openLine() {
    const fold = /** @type {HTMLDetailsElement} */ ($('hlSettingsFold'));
    fold.open = true;
    const key = lineKey(H.view());
    const input = /** @type {HTMLInputElement | null} */ (key ? $('hlThresholds').querySelector(`input[data-key="${key}"]`) : null);
    (input || fold).scrollIntoView({ behavior: H.smooth(), block: 'center' });
    input?.focus({ preventScroll: true });
    input?.select();
  }

  function showSpace() {
    const box = $('hlSpace');
    if (box.hidden) return SB.toast("Shellby hasn't measured the clutter yet.");
    box.scrollIntoView({ behavior: H.smooth(), block: 'start' });
  }

  const ACTIONS = {
    end: (/** @type {HTMLButtonElement} */ btn) => H.endTop(btn),
    hogs: () => H.showHogs(),
    space: showSpace,
    line: openLine,
  };

  function link(l) {
    return h('li', { class: `hl-link-step${l.level ? ` lvl-${l.level}` : ''}` },
      h('span', { class: 'hl-step-what', text: l.what }),
      h('b', { class: 'hl-step-big', text: l.big }),
      h('span', { class: 'hl-step-why', text: l.why }));
  }

  function fix(f) {
    return h('li', { class: 'hl-fix' },
      h('div', { class: 'hl-fix-words' }, h('b', { text: f.title }), h('p', { text: f.why })),
      h('button', {
        type: 'button', class: `btn slim-btn${f.id === 'end' ? ' hl-fix-end' : ''}`,
        onclick: e => ACTIONS[f.id]?.(e.currentTarget),
      }, f.id === 'end' ? 'End it' : f.id === 'line' ? 'Change it' : 'Show me'));
  }

  function renderDiagnosis() {
    const view = H.view();
    const d = L.diagnosis(view, H.cause());
    $('hlDiag').hidden = !d;
    // Rebuilt only when the words change (the "for" link moves once a minute),
    // so a focused button survives the 5 s samples.
    const sig = d ? JSON.stringify(d) : '';
    if (!H.changed('diag', `${sig}|${Math.floor(Date.now() / MIN)}`) || !d) return;
    const active = document.activeElement;
    const focused = active && $('hlFixes').contains(active) ? [...$('hlFixes').children].indexOf(/** @type {Element} */ (active.closest('.hl-fix'))) : -1;
    $('hlChain').replaceChildren(...d.chain.map(link));
    $('hlFixes').replaceChildren(...d.fixes.map(fix));
    if (focused >= 0) $('hlFixes').children[focused]?.querySelector('button')?.focus();
  }

  Object.assign(H, { renderDiagnosis });
})();
