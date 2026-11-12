/* Shellby panel — Settings: the local model (Ollama, LM Studio) that writes
   small drafts before Claude does. main's local/model.js has the say on what's
   saved (cleanSettings) and asks the server for its models (listModels);
   settings.js draws the rest. */
'use strict';
(function () {
  const { h, api, state, $ } = SB;
  const DEFAULT_URL = 'http://127.0.0.1:11434'; // main's local/model.js DEFAULT_URL
  const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
  // main's local/model.js JOBS and JOB_DEFAULTS, in the order Settings lists them.
  const JOBS = [
    { id: 'rules', label: 'Wording of the rules Shellby learns', on: true },
    { id: 'routines', label: 'Routine drafts', on: true },
    { id: 'hooks', label: 'Hook drafts', on: true },
    { id: 'workflows', label: 'Workflow drafts', on: true },
    { id: 'quiz', label: 'Quiz me questions (best with a model that reads code well)', on: false },
  ];
  const OFF_PC =`Use the address of a server on this PC, like ${DEFAULT_URL}.`;

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
      jobs: Object.fromEntries(JOBS.map(j => [j.id, typeof lm.jobs?.[j.id] === 'boolean' ? lm.jobs[j.id] : j.on])),
      models: lm.models && typeof lm.models === 'object' ? { ...lm.models } : {},
      answers: { on: lm.answers?.on === true, model: typeof lm.answers?.model === 'string' ? lm.answers.model : '' },
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
    renderJobs(lm, names);
    renderAnswers(lm, names);
    $('localModelTry').hidden = !lm.model;
    refreshTally();
  }

  // Each job: on or off, and a model of its own or the one above.
  function renderJobs(lm, names) {
    $('localModelJobs').hidden = !lm.model;
    if (!lm.model) return;
    $('localModelJobList').replaceChildren(...JOBS.map(j => {
      const box = h('input', { type: 'checkbox' });
      box.checked = lm.jobs[j.id];
      box.addEventListener('change', async () => {
        if (!(await save({ jobs: { ...current().jobs, [j.id]: box.checked } }))) say('Couldn\'t save that.');
      });
      const own = lm.models[j.id] || '';
      const pick = h('select', { class: 'field slim', 'aria-label': `Model for ${j.label.toLowerCase()}` },
        h('option', { value: '', text: 'Same model' }),
        ...[...new Set([...names, ...(own ? [own] : [])])].map(n => h('option', { value: n, text: n })));
      pick.value = own;
      pick.disabled = !lm.jobs[j.id];
      pick.addEventListener('change', async () => {
        const models = { ...current().models, [j.id]: pick.value };
        if (!pick.value) delete models[j.id];
        if (!(await save({ models }))) say('Couldn\'t save that model.');
      });
      const label = h('label', { class: 'toggle' }, box, h('span', { class: 'switch' }), j.label);
      return h('div', { class: 'local-job' }, label, pick);
    }));
  }

  // Asking it when Claude won't answer (feed-local.js): its own on/off and model,
  // apart from the drafts', so an uncensored model needn't write them.
  function renderAnswers(lm, names) {
    $('localAnswers').hidden = !lm.model;
    if (!lm.model) return;
    $('localAnswersToggle').checked = lm.answers.on;
    const own = lm.answers.model;
    $('localAnswersModel').replaceChildren(
      h('option', { value: '', text: 'Same model' }),
      ...[...new Set([...names, ...(own ? [own] : [])])].map(n => h('option', { value: n, text: n })));
    $('localAnswersModel').value = own;
    $('localAnswersModel').disabled = !lm.answers.on;
  }

  const plural = (n, one) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`;
  const tokens = n => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
  const clock = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // main's failure reasons (local/model.js ask()), as a clause after the model's name.
  function why(text) {
    const t = String(text || '');
    if (t === 'timed out') return 'took too long';
    if (t.startsWith('couldn\'t reach')) return 'wasn\'t running';
    if (/schema|not JSON|not a JSON|no reply/.test(t)) return 'answered in the wrong shape';
    if (t === 'resting') return 'was resting';
    return `failed (${t})`;
  }

  // What it has saved so far, and why Claude last stepped in.
  let tallySeq = 0;
  async function refreshTally() {
    const seq = ++tallySeq;
    let st;
    try { st = await api.localState(); } catch { return; } // the tally is extra: Settings works without it
    if (seq !== tallySeq || !st) return;
    const lm = current();
    const any = st.local + st.claude > 0;
    const rest = st.resting?.[0];
    $('localModelTally').hidden = !lm.model || (!any && !rest && !st.lastFail);
    $('localModelTallyText').textContent = !any ? 'Nothing written yet.'
      : `Since ${new Date(st.since).toLocaleDateString()}: ${plural(st.local, 'draft')} written on this PC, about ${tokens(st.tokens)} tokens your plan didn't spend`
        + `${st.local ? `, ${(st.avgMs / 1000).toFixed(1)} s each` : ''}.${st.claude ? ` Claude stepped in ${plural(st.claude, 'time')}.` : ''}`;
    const fb = $('localModelFallback');
    fb.hidden = !rest && !st.lastFail;
    if (rest) fb.textContent = `${rest.model} is left out until ${clock(rest.until)}${st.lastFail ? ` after it ${why(st.lastFail.why)}` : ''}. Claude writes drafts until then.`;
    else if (st.lastFail) fb.textContent = `Last time Claude stepped in (${clock(st.lastFail.at)}), ${st.lastFail.model} ${why(st.lastFail.why)}.`;
    $('localModelWake').hidden = !rest;
  }

  // Detect: Ollama and LM Studio on their usual ports. The first with a model is used.
  async function detectServers() {
    const seq = ++findSeq;
    $('localModelDetect').setAttribute('aria-busy', 'true');
    say('Looking for Ollama and LM Studio…');
    try {
      const servers = await api.localDetect();
      if (seq !== findSeq) return;
      if (!servers?.length) {
        say('Neither Ollama nor LM Studio answered with a model.');
        $('localModelSetup').hidden = SB.isCrabOnly();
        return;
      }
      const first = servers[0];
      $('localModelUrl').value = first.url;
      if (!(await useServer(first.url))) { say('Couldn\'t save that address.'); return; }
      found = first.models;
      renderLocalModel();
      const others = servers.slice(1).map(f => f.name).join(' and ');
      say(`Found ${first.name} with ${plural(first.models.length, 'model')}.${others ? ` ${others} is running too.` : ''} Pick one.`);
    } catch {
      say('Couldn\'t look for servers.');
    } finally {
      $('localModelDetect').removeAttribute('aria-busy');
    }
  }

  // Try it: one question, answered on this PC.
  let asking = false;
  async function tryIt() {
    if (asking) return;
    const lm = current();
    const out = $('localModelAnswer');
    asking = true;
    $('localModelAsk').setAttribute('aria-busy', 'true');
    out.hidden = false;
    out.textContent = `Asking ${lm.model}…`;
    try {
      const r = await api.localTry({ url: lm.url, model: lm.model, question: $('localModelQuestion').value.trim() || null });
      out.textContent = r?.ok ? `${r.model} (${(r.ms / 1000).toFixed(1)} s): ${r.text}` : (r?.error || 'Couldn\'t ask it.');
    } catch {
      out.textContent = 'Couldn\'t ask it.';
    } finally {
      asking = false;
      $('localModelAsk').removeAttribute('aria-busy');
    }
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
    const ok = await save({ url, model: '', on: false, answers: { ...current().answers, model: '' } });
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
  $('localModelDetect').addEventListener('click', detectServers);
  $('localModelAsk').addEventListener('click', tryIt);
  $('localModelQuestion').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); tryIt(); } });
  $('localModelWake').addEventListener('click', async () => {
    try { await api.localWake(); } catch { say('Couldn\'t do that.'); }
    refreshTally();
  });
  $('localModelResetTally').addEventListener('click', async () => {
    try { await api.localResetTally(); } catch { say('Couldn\'t reset it.'); }
    refreshTally();
  });
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
  $('localAnswersToggle').addEventListener('change', async e => {
    if (!(await save({ answers: { ...current().answers, on: e.target.checked } }))) say('Couldn\'t save that.');
  });
  $('localAnswersModel').addEventListener('change', async e => {
    if (!(await save({ answers: { ...current().answers, model: e.target.value } }))) say('Couldn\'t save that model.');
  });
  $('localModelToggle').addEventListener('change', async e => {
    if (!(await save({ on: e.target.checked }))) say('Couldn\'t save that.');
  });

  SB.renderLocalModel = renderLocalModel;
})();
