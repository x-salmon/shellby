/* Shellby panel — Settings: the local model (Ollama, LM Studio) that writes
   small drafts before Claude does. main's local/model.js has the say on what's
   saved (cleanSettings) and asks the server for its models (listModels);
   settings.js draws the rest. */
'use strict';
(function () {
  const { h, api, state, $ } = SB;
  const DEFAULT_URL = 'http://127.0.0.1:11434'; // main's local/model.js DEFAULT_URL
  const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
  // The roles a local conversation splits its work into (main's local/agent.js, ROLE_VARS).
  const AGENT_ROLES = [{ key: 'helpers', id: 'localAgentHelpers' }, { key: 'quick', id: 'localAgentQuick' }];
  // main's local/model.js JOBS and JOB_DEFAULTS, in the order Settings lists them.
  const JOBS = [
    { id: 'rules', label: 'Wording of the rules Shellby learns', on: true },
    { id: 'routines', label: 'Routine drafts', on: true },
    { id: 'hooks', label: 'Hook drafts', on: true },
    { id: 'workflows', label: 'Workflow drafts', on: true },
    { id: 'timesheet', label: 'Writing up your day on the Time page', on: true },
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
      agent: { on: lm.agent?.on === true, ...Object.fromEntries(['model', ...AGENT_ROLES.map(r => r.key)].map(k => [k, typeof lm.agent?.[k] === 'string' ? lm.agent[k] : ''])) },
      preset: ['off', 'coding', 'chat', 'custom'].includes(lm.preset) ? lm.preset : 'custom',
      makeRoom: lm.makeRoom !== false, // every save carries it, so another change never turns it back on
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
    // Shown without a model too, greyed and inert (the fieldset disables them all), so you can see what's here.
    $('localModelMore').disabled = !lm.model;
    renderJobs(lm, names);
    renderAnswers(lm, names);
    renderAgent(lm, names);
    $('localMakeRoomToggle').checked = lm.makeRoom;
    renderPreset(lm);
    SB.refreshLocalSetup?.();
    SB.refreshLocalFit?.();
    refreshTally();
    refreshOllama();
  }

  // Start/Stop Ollama: only once it's installed. Running is whatever answers on its port.
  let ollamaSeq = 0;
  let ollamaBusy = false;
  async function refreshOllama() {
    if (ollamaBusy) return;
    const seq = ++ollamaSeq;
    let st;
    try { st = await api.ollamaStatus(); } catch { return; } // extra: Settings works without it
    if (seq !== ollamaSeq || ollamaBusy || !st) return;
    showOllama(st);
  }
  SB.refreshOllama = refreshOllama;
  function showOllama(st) {
    const btn = $('ollamaPower');
    btn.hidden = !st.installed && !st.running;
    btn.textContent = st.running ? 'Stop Ollama' : 'Start Ollama';
    btn.dataset.running = st.running ? '1' : '';
  }
  async function toggleOllama() {
    if (ollamaBusy) return;
    const btn = $('ollamaPower');
    const stopping = btn.dataset.running === '1';
    ollamaBusy = true;
    ollamaSeq++;
    btn.setAttribute('aria-busy', 'true');
    say(stopping ? 'Stopping Ollama…' : 'Starting Ollama…');
    let r;
    try {
      r = await (stopping ? api.ollamaStop() : api.ollamaStart());
    } catch {
      r = { ok: false, error: stopping ? 'Couldn\'t stop Ollama.' : 'Couldn\'t start Ollama.' };
    } finally {
      ollamaBusy = false;
      btn.removeAttribute('aria-busy');
    }
    if (typeof r?.running === 'boolean') showOllama({ installed: true, running: r.running });
    if (!r?.ok) { say(r?.error || 'Couldn\'t do that.'); return; }
    if (stopping) { say('Ollama is off. Claude writes the drafts until it\'s back.'); return; }
    // Running again: show what it has, as Detect would.
    if (!current().model || serverKey(current().url) === serverKey(DEFAULT_URL)) await detectServers();
    else say('Ollama is running.');
  }

  // Each job: on or off, and a model of its own or the one above.
  function renderJobs(lm, names) {
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
    $('localAnswersToggle').checked = lm.answers.on;
    const own = lm.answers.model;
    $('localAnswersModel').replaceChildren(
      h('option', { value: '', text: 'Same model' }),
      ...[...new Set([...names, ...(own ? [own] : [])])].map(n => h('option', { value: n, text: n })));
    $('localAnswersModel').value = own;
    $('localAnswersModel').disabled = !lm.answers.on;
  }

  // Conversations on a local model (main's local/agent.js): its own on/off and
  // model, and a model for each role (empty: the main one).
  function fillPicker(sel, own, names, blank) {
    sel.replaceChildren(
      h('option', { value: '', text: blank }),
      ...[...new Set([...names, ...(own ? [own] : [])])].map(n => h('option', { value: n, text: n })));
    sel.value = own;
  }
  function renderAgent(lm, names) {
    $('localAgentToggle').checked = lm.agent.on;
    fillPicker($('localAgentModel'), lm.agent.model, names, 'Same model');
    $('localAgentModel').disabled = !lm.agent.on;
    for (const r of AGENT_ROLES) {
      fillPicker($(r.id), lm.agent[r.key], names, 'Same as main');
      $(r.id).disabled = !lm.agent.on;
    }
  }

  // Local mode's presets (main's local/presets.js): Off / Coding / Chat / Custom.
  function renderPreset(lm) {
    for (const b of $('localPreset').querySelectorAll('[data-preset]')) {
      const on = b.dataset.preset === lm.preset;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }
  async function pickPreset(name, again = false) {
    if (name === current().preset && !again) return;
    say(name === 'off' ? 'Turning local models off…' : 'Picking models…');
    const r = await api.localPreset(name);
    if (!r?.ok) { say(r?.error || 'Couldn\'t switch.'); return; }
    state.settings = r.settings;
    renderLocalModel();
    renderMissing(r.missing || []);
    SB.refreshLocalSetup?.(true); // a model may have arrived: the setup card may be done
  }

  // The preset's models that aren't installed, each with a Get button
  // (main's local/pull.js). Only one downloads at a time.
  let missing = [];
  let pullingNow = null;
  const gb = n => `${n >= 10 ? Math.round(n) : n.toFixed(1)} GB`;
  function renderMissing(list) {
    missing = list;
    const box = $('localPull');
    box.hidden = !list.length;
    box.replaceChildren(...list.map(m => {
      const busy = pullingNow === m.model;
      const row = h('div', { class: 'local-pull-row', 'data-model': m.model });
      row.append(
        h('button', { type: 'button', class: 'btn slim-btn', text: busy ? 'Stop' : `Get ${m.model} · ${gb(m.sizeGb)}`, disabled: !!pullingNow && !busy }),
        h('progress', { max: 100, value: 0, hidden: !busy, 'aria-label': `Getting ${m.model}` }),
        h('span', { class: 'muted small' }),
      );
      return row;
    }));
    if (list.length && !pullingNow) say(`${list.length === 1 ? 'One model isn\'t' : 'Some models aren\'t'} installed yet. Get ${list.length === 1 ? 'it' : 'them'} here; the rest already work.`);
  }
  $('localPull').addEventListener('click', async e => {
    const row = e.target.closest('.local-pull-row');
    if (!row || !e.target.closest('button')) return;
    const model = row.dataset.model;
    if (pullingNow === model) { await api.localPullCancel(); return; }
    pullingNow = model;
    renderMissing(missing);
    const r = await api.localPull(model);
    pullingNow = null;
    if (r?.ok) { say(`${model} is ready.`); await pickPreset(current().preset, true); SB.refreshLocalFit?.(true); return; }
    renderMissing(missing);
    say(r?.error || `Couldn't get ${model}.`);
  });
  api.onLocalPull(p => {
    const row = $('localPull').querySelector(`[data-model="${CSS.escape(p.model)}"]`);
    if (!row || p.done) return;
    const bar = row.querySelector('progress');
    bar.hidden = false;
    if (p.total) bar.value = Math.floor((p.completed / p.total) * 100); else bar.removeAttribute('value');
    row.querySelector('span').textContent = p.total ? `${gb(p.completed / 1024 ** 3)} of ${gb(p.total / 1024 ** 3)}` : p.status;
  });
  $('localPreset').addEventListener('click', e => {
    const b = e.target.closest('[data-preset]');
    if (b) pickPreset(b.dataset.preset);
  });
  $('localPreset').addEventListener('keydown', e => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const btns = [...$('localPreset').querySelectorAll('[data-preset]')];
    const next = btns[(btns.indexOf(document.activeElement) + step + btns.length) % btns.length];
    next.focus();
    pickPreset(next.dataset.preset);
  });

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
    // The last time a game got the local models' memory (main's local/game-room.js).
    const room = st.room;
    $('localMakeRoomLast').hidden = !room;
    if (room) {
      const gb = room.bytes >= 1e9 ? `, ${(room.bytes / 1e9).toFixed(1)} GB` : '';
      $('localMakeRoomLast').textContent = `Last made room at ${clock(room.at)}: ${room.models.join(', ')}${gb}.`;
    }
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
    const want = { ...current(), preset: 'custom', ...patch }; // a picker changed by hand: Custom
    const r = await api.setSettings({ localModel: want });
    state.settings = r.settings;
    renderLocalModel();
    const got = current();
    return got.model === want.model && got.on === (want.on && !!want.model) && serverKey(got.url) === serverKey(want.url);
  }

  // A new server: the old one's model and list don't apply to it.
  async function useServer(url) {
    if (serverKey(url) === serverKey(current().url)) return true;
    const ok = await save({ url, model: '', on: false, answers: { ...current().answers, model: '' }, agent: { on: false, model: '' } });
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
  $('ollamaPower').addEventListener('click', toggleOllama);
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
  // Not save(): this isn't a model pick, so the preset stays as it is.
  $('localMakeRoomToggle').addEventListener('change', async e => {
    try {
      const r = await api.setSettings({ localModel: { ...current(), makeRoom: e.target.checked } });
      state.settings = r.settings;
      renderLocalModel();
    } catch { say('Couldn\'t save that.'); }
  });
  $('localAnswersToggle').addEventListener('change', async e => {
    if (!(await save({ answers: { ...current().answers, on: e.target.checked } }))) say('Couldn\'t save that.');
  });
  $('localAnswersModel').addEventListener('change', async e => {
    if (!(await save({ answers: { ...current().answers, model: e.target.value } }))) say('Couldn\'t save that model.');
  });
  $('localAgentToggle').addEventListener('change', async e => {
    if (!(await save({ agent: { ...current().agent, on: e.target.checked } }))) say('Couldn\'t save that.');
  });
  $('localAgentModel').addEventListener('change', async e => {
    if (!(await save({ agent: { ...current().agent, model: e.target.value } }))) say('Couldn\'t save that model.');
  });
  for (const r of AGENT_ROLES) {
    $(r.id).addEventListener('change', async e => {
      if (!(await save({ agent: { ...current().agent, [r.key]: e.target.value } }))) say('Couldn\'t save that model.');
    });
  }
  $('localModelToggle').addEventListener('change', async e => {
    if (!(await save({ on: e.target.checked }))) say('Couldn\'t save that.');
  });

  SB.renderLocalModel = renderLocalModel;
})();
