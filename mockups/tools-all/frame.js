// The Toolbox around the All list, the same in every mockup: its heading,
// the section tabs and the kind chips. Skills, Agents and Commands narrow the
// same list (as today); MCP, Mods and Snippets are the next round of mockups.
(function () {
  'use strict';
  const { esc } = window.TB;
  const SECTIONS = ['Tools', 'Setup', 'Lean', 'Team', 'Get more'];
  const LATER = [['mcp', 'MCP'], ['mod', 'Mods'], ['snippet', 'Snippets']];

  function frame(phone, ak) {
    phone.innerHTML = `
      <div class="bar"><h3>Toolbox</h3><button type="button" class="btn quiet" data-f="rescan">Rescan</button></div>
      <div class="fr-nav">
        <div class="fr-sections" role="tablist" aria-label="Section">${SECTIONS.map((s, i) => `<button type="button" role="tab" aria-selected="${i === 0}" data-f="section">${s}</button>`).join('')}</div>
        <div class="fr-kinds" role="tablist" aria-label="Kind"></div>
      </div>
      <div class="fr-body"></div>`;
    const kinds = phone.querySelector('.fr-kinds');
    const draw = () => {
      const k = ak.st.kind;
      kinds.innerHTML = ak.kinds().map(([id, name, n]) => `<button type="button" role="tab" data-kind="${id}" aria-selected="${k === id}">${esc(name)} <span>${n}</span></button>`).join('')
        + LATER.map(([id, name]) => `<button type="button" role="tab" data-later="${id}" aria-selected="false">${name} <span>${ak.d.tabs[id]}</span></button>`).join('');
    };
    phone.querySelector('.fr-nav').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.kind) ak.set({ kind: b.dataset.kind });
      else if (b.dataset.later) ak.toast(`${b.textContent.replace(/\d+/, '').trim()} gets its own mockups once All is settled`);
      else if (b.dataset.f === 'section' && b.getAttribute('aria-selected') !== 'true') ak.toast(`${b.textContent} isn’t part of this round`);
    });
    phone.querySelector('[data-f="rescan"]').addEventListener('click', () => ak.actions.rescan());
    const off = ak.on(draw);
    draw();
    return { body: phone.querySelector('.fr-body'), off };
  }

  window.AK_FRAME = frame;
})();
