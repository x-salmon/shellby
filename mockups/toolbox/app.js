// The gallery: a picker of the five concepts, one phone, and its notes.
(function () {
  'use strict';
  const { concepts, esc } = window.TB;
  const picker = document.getElementById('picker');
  const phone = document.getElementById('phone');
  const notes = document.getElementById('notes');
  let cleanup = null;

  picker.innerHTML = concepts.map((c, i) => `
    <button type="button" data-id="${c.id}">
      <span class="pk-n">${i + 1}</span>
      <span class="pk-t"><b>${esc(c.name)}</b><small>${esc(c.line)}</small></span>
    </button>`).join('');

  function renderNotes(c, i) {
    const n = c.notes;
    notes.innerHTML = `
      <p class="num">Mockup ${i + 1} of ${concepts.length}</p>
      <h2>${esc(c.name)}</h2>
      ${n.pitch.map(p => `<p>${esc(p)}</p>`).join('')}
      <h3>Things to try</h3>
      <ul class="try">${n.tryIt.map(t => `<li>${t}</li>`).join('')}</ul>
      <h3>${esc(n.mapTitle || 'Where today’s toolbox goes')}</h3>
      <dl class="map">${n.map.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl>
      <h3>The trade-off</h3>
      <p>${esc(n.tradeoff)}</p>`;
  }

  function show(id) {
    const i = Math.max(0, concepts.findIndex(c => c.id === id));
    const c = concepts[i];
    if (cleanup) cleanup();
    phone.innerHTML = '';
    phone.className = `phone c-${c.id}`;
    cleanup = c.mount(phone) || null;
    renderNotes(c, i);
    picker.querySelectorAll('button').forEach(b => b.setAttribute('aria-current', String(b.dataset.id === c.id)));
    if (location.hash.slice(1) !== c.id) history.replaceState(history.state, '', `${location.search}#${c.id}`);
  }

  picker.addEventListener('click', e => {
    const b = e.target.closest('button[data-id]');
    if (b) show(b.dataset.id);
  });
  addEventListener('hashchange', () => show(location.hash.slice(1)));
  // Alt+1..5 jumps between concepts.
  addEventListener('keydown', e => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const n = Number(e.key);
    if (n >= 1 && n <= concepts.length) { e.preventDefault(); show(concepts[n - 1].id); }
  });

  show(location.hash.slice(1) || concepts[0].id);
})();
