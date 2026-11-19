/* Shellby panel — Settings: Local mode's fit check. A row per model in use
   with a chip for how it suits this PC (all on the GPU, partly in RAM, too
   big) and one for a short context, which "Make a 32K copy" fixes. main's
   local/fit.js does the reading; this only draws. Advice, never a block. */
'use strict';
(function () {
  const { h, api, $ } = SB;
  const PLACES = {
    gpu: { cls: 'gpu', text: 'Fits in GPU', tip: 'All of it fits in your GPU\'s memory: as fast as this PC gets.' },
    ram: { cls: 'ram', text: 'Partly in RAM', tip: 'Some of it runs from RAM: slower, but fine for mixture-of-experts models like qwen3-coder.' },
    'too-big': { cls: 'bad', text: 'Too big', tip: 'More than your GPU and RAM hold comfortably: expect 2 to 5 words a second.' },
  };
  let cached = null;
  let key = '';
  let copying = false;

  const inUse = lm => [...new Set([lm.model, lm.models?.quiz, lm.agent?.model, lm.agent?.helpers, lm.agent?.quick].filter(Boolean))];
  const chip = (cls, text, tip) => h('span', { class: `fit-chip ${cls}`, title: tip, tabindex: '0', 'aria-label': `${text}. ${tip}`, text });

  function draw(fit) {
    const box = $('localFit');
    const names = Object.keys(fit || {});
    box.hidden = !names.length;
    box.replaceChildren(...names.map(name => {
      const f = fit[name];
      const p = PLACES[f.place];
      const row = h('li', {}, h('span', { text: f.sizeGb ? `${name} · ${f.sizeGb} GB` : name }));
      if (p) row.append(chip(p.cls, p.text, p.tip));
      if (f.shortCtx) {
        row.append(chip('bad', 'Short context', f.numCtx ? `Ollama starts it with ${f.numCtx.toLocaleString()} tokens; Claude Code needs 32K.` : 'Ollama may start it with less than the 32K tokens Claude Code needs.'));
        row.append(h('button', { type: 'button', class: 'btn ghost slim-btn', text: 'Make a 32K copy', disabled: copying, onclick: () => copy(name) }));
      }
      return row;
    }));
  }

  async function copy(name) {
    if (copying) return;
    copying = true;
    draw(cached);
    try {
      const r = await api.localCtxCopy(name);
      if (r?.ok) { SB.state.settings = r.settings; SB.renderLocalModel(); await refresh(true); }
      else $('localModelStatus').textContent = r?.error || 'Couldn\'t make the copy.';
    } finally { copying = false; draw(cached); }
  }

  // Read when the models in use change, else drawn from the last read.
  async function refresh(force = false) {
    const lm = SB.state.settings?.localModel;
    const names = lm ? inUse(lm) : [];
    const k = `${lm?.url}|${names.join(',')}`;
    if (!force && k === key) { draw(cached); return; }
    key = k;
    if (!names.length) { cached = null; draw(null); return; }
    try { cached = await api.localFit(); } catch { cached = null; }
    if (key === k) draw(cached);
  }

  SB.refreshLocalFit = refresh;
})();
