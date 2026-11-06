/* Shellby panel — Settings: the local model (Ollama, LM Studio) that writes
   small drafts before Claude does. main's local/model.js has the say on what's
   saved (cleanSettings) and asks the server for its models (listModels);
   settings.js draws the rest. */
'use strict';
(function () {
  const { h, api, state, $ } = SB;
  const DEFAULT_URL = 'http://127.0.0.1:11434'; // main's local/model.js DEFAULT_URL
  const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
  const OFF_PC = `Use the address of a server on this PC, like ${DEFAULT_URL}.`;

  /** @type {string[] | null} the models Find models last found, for the saved server */
  let found = null;
  let finding = false;
  let findSeq = 0; // a newer edit or search makes an older answer stale

  // The same rule main's baseUrl applies, so the panel can say so at once
  // (main still refuses anything else). -> 'host/path' to compare servers by, or null.
  function serverKey(raw) {
    let u;
    try { u = new URL(String(raw || '').trim()); } catch { return null; }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !LOOPBACK.has(u.hostname) || u.username || u.password) return null;
    if (u.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')) return null; // the server itself or its /v1, as main takes
    return `${u.protocol}//${u.host}`;
  }

  // What's saved. An address that isn't on this PC (a hand-edited file) reads
  // as the default, so the next change saves instead of being refused.
  function current() {
    const lm = state.settings.localModel || {};
    return {
      on: lm.on === true,
      url: serverKey(lm.url) ? lm.url : DEFAULT_URL,
      model: typeof lm.model === 'string' ? lm.model : '',
    };
  }
  const say = text => { $('localModelStatus').textContent = text; };

  function statusText(lm) {
    if (!lm.model) return 'Find models, then pick one.';
    return lm.on ? `Small drafts go to ${lm.model} first.` : `Off. Turn it on to use ${lm.model}.`;
  }

  function renderLocalModel() {
    const lm = current();
    $('localModelToggle').checked = lm.on;
    $('localModelToggle').disabled = !lm.model;
    if (document.activeElement !== $('localModelUrl')) $('localModelUrl').value = lm.url;
    const names = found ? [...found] : [];
    if (lm.model && !names.includes(lm.model)) names.unshift(lm.model);
    $('localModelSelect').replaceChildren(
      h('option', { value: '', text: names.length ? 'None' : 'Find models first' }),
      ...names.map(n => h('option', { value: n, text: n })),
    );
    $('localModelSelect').value = lm.model;
    // Only before there's a model, and only when Claude can do it.
    $('localModelSetup').hidden = !!lm.model || SB.isCrabOnly();
    say(statusText(lm));
  }

  // Hand the install to Claude. The box is filled in, not sent: it runs winget
  // and downloads a few GB, so you see what you're agreeing to first.
  function setupPrompt() {
    return [
      'Set up a local model on this PC so Shellby can write small drafts with it instead of using my Claude plan.',
      '1. Check whether Ollama or LM Studio is already installed or running (http://127.0.0.1:11434/api/tags for Ollama, http://127.0.0.1:1234/v1/models for LM Studio). If one already answers with a model, stop and tell me which.',
      '2. If neither is installed, install Ollama with `winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements` and make sure its server is running.',
      '3. Look at my RAM and GPU memory, then pull one small instruct model that fits comfortably and is good at short JSON answers (around 3B parameters; smaller if I have under 8 GB of RAM). Tell me its download size before pulling.',
      '4. Check the server lists the model, and send it one short test prompt.',
      'Ask me before making anything start with Windows. When it works, tell me the server address and model name so I can press Find models in Shellby\'s Settings.',
    ].join('\n') + '\n';
  }

  // -> whether main saved it as asked (it turns `on` off without a model).
  async function save(patch) {
    const want = { ...current(), ...patch };
    const r = await api.setSettings({ localModel: want });
    state.settings = r.settings;
    renderLocalModel();
    const got = current();
    return got.model === want.model && got.on === (want.on && !!want.model) && serverKey(got.url) === serverKey(want.url);
  }

  // A new server: the old one's model and list don't apply to it.
  async function useServer(url) {
    if (serverKey(url) === serverKey(current().url)) return true;
    const ok = await save({ url, model: '', on: false });
    if (ok) found = null;
    return ok;
  }

  async function findModels() {
    if (finding) return;
    const url = $('localModelUrl').value.trim() || DEFAULT_URL;
    if (!serverKey(url)) { say(OFF_PC); return; }
    const seq = ++findSeq;
    finding = true;
    $('localModelFind').setAttribute('aria-busy', 'true');
    say('Looking…');
    try {
      const r = await api.localModels(url);
      if (seq !== findSeq) return; // the address changed while it looked
      if (!r?.ok) { say(r?.error || 'Couldn\'t ask that server.'); return; }
      if (!(await useServer(url))) { say('Couldn\'t save that address.'); return; }
      found = r.models;
      renderLocalModel();
      say(`${r.models.length} model${r.models.length === 1 ? '' : 's'} found. Pick one.`);
    } catch {
      say('Couldn\'t ask that server.'); // main answers every failure as { ok: false }: this is the IPC call itself failing
    } finally {
      finding = false;
      $('localModelFind').removeAttribute('aria-busy');
    }
  }

  $('localModelFind').addEventListener('click', findModels);
  $('localModelSetup').addEventListener('click', () => SB.prefillNew(setupPrompt()));
  $('localModelUrl').addEventListener('change', async e => {
    const url = e.target.value.trim() || DEFAULT_URL;
    if (!serverKey(url)) { e.target.value = current().url; say(OFF_PC); return; }
    if (serverKey(url) === serverKey(current().url)) return;
    findSeq++;
    if (!(await useServer(url))) say('Couldn\'t save that address.');
  });
  $('localModelSelect').addEventListener('change', async e => {
    if (!(await save({ model: e.target.value }))) say('Couldn\'t save that model.');
  });
  $('localModelToggle').addEventListener('change', async e => {
    if (!(await save({ on: e.target.checked }))) say('Couldn\'t save that.');
  });

  SB.renderLocalModel = renderLocalModel;
})();
