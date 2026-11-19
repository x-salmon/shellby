/* Shellby panel — Settings: Local mode's setup card. One card at the top of
   Local model for whatever this PC is missing: Ollama itself, Ollama running,
   or a first model, with a recommendation for this hardware. main's
   local/setup.js does the looking and installing (winget, after a confirm),
   local/ollama.js the starting; downloads go through the same Get as presets (local/pull.js). */
'use strict';
(function () {
  const { h, api, $ } = SB;
  const RECHECK_MS = 30000; // nvidia-smi and two local requests: not on every render
  let last = null;
  let checkedAt = 0;
  let busy = false;

  const gbText = n => `${n >= 10 ? Math.round(n) : n.toFixed(1)} GB`;
  function recLine(s) {
    const { main, quick, note } = s.rec;
    const pick = main ? `${main} for the work and ${quick} for quick tasks` : `${quick} for small drafts`;
    return `For this PC: ${pick}. ${note}`;
  }
  const button = (text, onclick, primary = true) => h('button', { type: 'button', class: primary ? 'btn slim-btn' : 'btn ghost slim-btn', text, onclick });

  function show(title, text, actions) {
    $('localSetupCard').hidden = false;
    $('localSetupTitle').textContent = title;
    $('localSetupText').textContent = text;
    $('localSetupActions').replaceChildren(...actions);
  }

  function render(s) {
    last = s;
    // While the card offers Start Ollama, the Server row's own Start button would only repeat it.
    $('ollamaPower').classList.toggle('setup-has-it', s?.state === 'stopped');
    if (!s || s.state === 'ready' || s.state === 'lmstudio' || s.state === 'proxied') { $('localSetupCard').hidden = true; return; }
    if (s.state === 'none') {
      show('Run models on this PC, free and private', `Ollama runs AI models on your own GPU, so drafts and whole conversations need none of your plan. ${recLine(s)}`,
        [button(s.winget ? 'Install Ollama' : 'Get Ollama', () => act(() => api.localInstall(false), 'Installing Ollama… this takes a few minutes.'))]);
    } else if (s.state === 'stopped') {
      show('Ollama is installed but not running', 'Start it and it stays in your tray.', [button('Start Ollama', () => act(async () => { const r = await api.ollamaStart(); SB.refreshOllama?.(); return r; }, 'Starting Ollama…'))]);
    } else if (s.state === 'old') {
      show(`Ollama ${s.version} is too old for local conversations`, 'Local conversations need Ollama 0.14 or newer. Drafts still work.',
        [button('Update Ollama', () => act(() => api.localInstall(true), 'Updating Ollama…'))]);
    } else if (s.state === 'empty') {
      const picks = [s.rec.quick, s.rec.main].filter(Boolean);
      show('Ollama is running. Now a model', recLine(s), [button(`Get ${picks.length > 1 ? 'these' : 'it'}`, () => getModels(picks))]);
    }
  }

  async function act(run, working) {
    if (busy) return;
    busy = true;
    $('localSetupText').textContent = working;
    for (const b of $('localSetupActions').querySelectorAll('button')) b.disabled = true;
    try {
      const r = await run();
      if (r?.opened) $('localSetupText').textContent = 'The download page is open in your browser. Come back here once Ollama is installed.';
      else if (r && !r.ok && !r.cancelled) $('localSetupText').textContent = r.error || 'That didn\'t work.';
      else await refresh(true);
    } finally {
      busy = false;
      if (last && !$('localSetupCard').hidden) for (const b of $('localSetupActions').querySelectorAll('button')) b.disabled = false;
    }
  }

  // The quick model first, so something works in minutes, then the main one; then Coding fills the pickers.
  async function getModels(models) {
    await act(async () => {
      for (const m of models) {
        $('localSetupText').textContent = `Getting ${m}…`;
        const r = await api.localPull(m);
        if (!r?.ok) return r;
      }
      const p = await api.localPreset('coding');
      if (p?.ok) { SB.state.settings = p.settings; SB.renderLocalModel(); }
      return { ok: true };
    }, 'Getting models…');
  }
  api.onLocalPull(p => {
    if (!busy || p.done || !p.total || $('localSetupCard').hidden) return;
    $('localSetupText').textContent = `Getting ${p.model}: ${gbText(p.completed / 1024 ** 3)} of ${gbText(p.total / 1024 ** 3)}`;
  });

  async function refresh(force = false) {
    if (!force && Date.now() - checkedAt < RECHECK_MS) { render(last); return; }
    checkedAt = Date.now();
    try { render(await api.localSetup()); } catch { render(null); }
  }

  SB.refreshLocalSetup = refresh;
})();
