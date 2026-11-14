/* Shellby panel — Workflows: the list. */
'use strict';
(function () {
  const { h, api, state } = SB;
  const W = SB.wfKit;
  const {
    clone, setMapMode, fill, screen, openEditor, blankWorkflow, current, throttle, editing, keepFocus, uid,
    unsaved, TRIGGER_INFO, icon, ICON, iconBtn, go, normErrors, popup, menuItem, focusFk, openFileBtn,
  } = W;

  // ================================================================ the list

  const list = { rows: null, gallery: null, secrets: null, lede: null, pending: false };
  let describeText = '';
  let drafting = false;
  let runFormFor = null;     // workflow id whose inputs form is open
  let runValues = {};
  /** @type {{ id: string, inputs: Record<string, string>, est: any } | null} */
  let estimateFor = null;    // the workflow whose run would pass the limit: its box, with "Run after the reset"
  /** @type {Map<string, any>} */
  const estimates = new Map(); // workflow id -> what a run usually costs (src/main/usage/runcost.js), for its Run button
  let estSeq = 0;
  let estSeen = { key: '', outlook: undefined }; // what the estimates were last asked for

  const workflows = () => state.workflows?.workflows || [];
  const DEF_KEYS = ['id', 'name', 'description', 'enabled', 'cwd', 'concurrency', 'inputs', 'when', 'steps', 'createdAt'];
  const toDef = w => Object.fromEntries(DEF_KEYS.filter(k => w[k] !== undefined).map(k => [k, clone(w[k])]));

  function renderList() {
    setMapMode(false);
    list.rows = h('ul', { class: 'wf-list', 'aria-label': 'Your workflows' });
    list.gallery = h('div', { class: 'wf-gallery' });
    // Folded away: you add a secret once and then only refer to it.
    list.secrets = h('details', { class: 'wf-disclosure wf-secrets' });
    // The explainer is for before your first workflow; after that the list says it.
    list.lede = h('div', { class: 'wf-hero' },
      h('h3', { class: 'wf-hero-title', text: 'Nothing in the tide pool yet' }),
      h('p', { class: 'wf-hero-sub', text: 'Something happens, and Shellby works through a list of steps: asking Claude, running a command, calling a web address, or checking with you.' }),
      h('p', { class: 'wf-hero-sub', text: 'Describe one below, or start from a template. You can always run one by hand too.' }));
    fill(screen,
      h('div', { class: 'view-head' },
        h('h2', { text: 'Workflows' }),
        h('div', { class: 'wf-head-actions' },
          h('button', { type: 'button', class: 'btn ghost slim-btn', onclick: openImport }, 'Import'),
          h('button', { type: 'button', class: 'btn primary slim-btn', onclick: () => openEditor(blankWorkflow()) }, 'New workflow'))),
      list.lede,
      describeBox(),
      list.rows,
      list.gallery,
      list.secrets);
    estSeen = { key: '', outlook: undefined }; // a fresh look at the page asks again once
    fillList();
    if (focusDescribe) requestAnimationFrame(takeDescribeFocus);
  }

  // Ctrl+K › Describe a workflow lands in the box, even if the list is still loading.
  let focusDescribe = false;
  function takeDescribeFocus() {
    const box = screen.querySelector('.wf-describe-text');
    if (!box) return;
    focusDescribe = false;
    box.focus();
  }
  function focusDescribeSoon() {
    focusDescribe = true;
    requestAnimationFrame(takeDescribeFocus);
  }

  // A fresh View from main: the list redraws if it's showing.
  function applyView(v) {
    if (!v || typeof v !== 'object') return;
    state.workflows = v;
    if (state.view === 'workflows' && current().name === 'list') fillList();
    if (state.view === 'workflows' || state.view === 'routines') SB.renderTide?.();
  }
  const refreshList = throttle(() => { if (state.view === 'workflows' && current().name === 'list') fillList(); }, 600);
  SB.refreshWorkflowRows = refreshList; // a run held for the reset, or let go (outlook.js applyOutlook)

  // Live updates refill the rows, but never under your cursor: if you're typing
  // in a run form or the secrets box, it waits until you leave.
  function fillList() {
    if (!list.rows?.isConnected) return;
    const a = document.activeElement;
    if (editing(a) && (list.rows.contains(a) || list.secrets.contains(a))) { list.pending = true; return; }
    list.pending = false;
    keepFocus(() => {
      fill(list.rows, ...workflows().map(workflowRow));
      list.rows.hidden = !workflows().length;
      list.lede.hidden = !!workflows().length;
      fillGallery();
      fillSecrets();
    });
    if (estimatesStale()) refreshEstimates();
  }
  screen.addEventListener('focusout', e => {
    if (list.pending && !(editing(e.relatedTarget) && screen.contains(e.relatedTarget))) setTimeout(fillList, 0);
  });

  // ------------------------------------------------------------ describe it

  function describeBox() {
    const id = uid('describe');
    const box = h('textarea', {
      class: 'field area wf-describe-text', id, rows: 1, maxlength: 2000, disabled: drafting,
      placeholder: 'When a build fails on my repo, have Claude find out why and tell me on my phone',
      oninput: e => { describeText = e.target.value; },
      // It looks like one line, so Enter sends; Shift+Enter starts a new line.
      onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } },
    });
    box.value = describeText;
    const note = h('p', { class: 'wf-note', id: uid('note'), 'aria-live': 'polite', text: 'Claude drafts it for you to check. Nothing is saved until you press Save.' });
    box.setAttribute('aria-describedby', note.id);
    const btn = h('button', { type: 'submit', class: 'btn slim-btn', disabled: drafting }, drafting ? [h('span', { class: 'wf-spin', 'aria-hidden': 'true' }), 'Drafting…'] : 'Draft it');
    async function submit() {
      if (drafting) return;
      const text = describeText.trim();
      if (!text) { setNote('Say what should happen, and when.', true); box.focus(); return; }
      drafting = true;
      box.disabled = true;
      btn.disabled = true;
      fill(btn, h('span', { class: 'wf-spin', 'aria-hidden': 'true' }), 'Drafting…');
      setNote('Claude is drafting it…');
      let res;
      try { res = await api.draftWorkflow(text); } catch { res = { ok: false, error: 'Couldn\'t reach Claude. Try again.' }; }
      drafting = false;
      if (res?.ok && res.workflow) {
        describeText = '';
        openEditor(res.workflow, { title: 'Drafted workflow' });
        SB.toast('Drafted. Check it over, then press Save.');
        return;
      }
      if (!box.isConnected) {
        // You left the list while Claude worked: say how it went, and redraw the box if it's back on screen.
        SB.toast(res?.error || 'Claude couldn\'t draft that.');
        if (state.view === 'workflows' && current().name === 'list') renderList();
        return;
      }
      box.disabled = false;
      btn.disabled = false;
      fill(btn, 'Draft it');
      setNote(res?.error || 'Claude couldn\'t draft that. Try saying it another way.', true);
      box.focus();
    }
    function setNote(text, err = false) { note.textContent = text; note.classList.toggle('err', err); }
    return h('form', { class: `wf-describe${drafting ? ' busy' : ''}`, novalidate: true, onsubmit: e => { e.preventDefault(); submit(); } },
      h('label', { class: 'field-label', for: id, text: 'Describe a workflow' }),
      h('div', { class: 'wf-describe-row' }, box, btn),
      note);
  }

  /**
   * Describe it, from somewhere else: the Routines page hands over a request a
   * routine can't do. Drafts it and opens the editor, the way the box here does.
   * true once the draft is open.
   */
  async function draftFrom(text) {
    const want = String(text || '').slice(0, 2000);
    if (drafting) { SB.toast('Claude is already drafting one. Give it a moment.'); return false; }
    drafting = true;
    SB.setView('workflows');
    SB.toast('Claude is drafting it as a workflow…');
    let res;
    try { res = await api.draftWorkflow(want); } catch { res = { ok: false, error: 'Couldn\'t reach Claude. Try again.' }; }
    drafting = false;
    if (!res?.ok || !res.workflow) {
      describeText = want;
      if (state.view === 'workflows' && current().name === 'list') renderList();
      SB.toast(res?.error || 'Claude couldn\'t draft that.');
      return false;
    }
    // Never over a workflow you're part-way through editing.
    if (current().name === 'editor' && unsaved()) {
      describeText = want;
      SB.toast('Claude drafted it, but you have changes open. Save or close them, then describe it again.');
      return false;
    }
    openEditor(res.workflow, { title: 'Drafted workflow', note: res.note || '' });
    SB.toast('Drafted. Check it over, then press Save.');
    return true;
  }

  // ------------------------------------------------------------ rows

  // One quiet line: how the last run went (a dot and a few words), then when it runs.
  function lastRunNote(w) {
    const last = w.lastRun;
    const at = last?.endedAt || last?.startedAt;
    if (last?.waiting) return { tone: 'wait', text: 'Needs you' };
    if (w.running) return { tone: 'run', text: 'Running now' };
    if (!last) return { tone: 'none', text: 'Never run' };
    const word = { ok: 'Ran', error: 'Failed', stopped: 'Stopped', interrupted: 'Interrupted' }[last.status] || 'Started';
    const tone = { ok: 'ok', error: 'err', interrupted: 'warn' }[last.status] || 'none';
    return { tone, text: at ? `${word} ${SB.relTime(at)}` : word };
  }

  // A run of it held for after the usage reset, from its cost estimate (outlook.js brings the list).
  const heldRun = w => (state.outlook?.held || []).find(x => x.kind === 'workflow' && x.workflowId === w.id) || null;

  function workflowRow(w) {
    const last = w.lastRun;
    const note = lastRunNote(w);
    const when = [w.triggers?.length ? w.triggers.join(' · ') : 'Run by hand'];
    if (!w.enabled) when.push('off');
    else if (w.next) when.push(`next ${SB.untilTime(w.next)}`);
    const held = heldRun(w);
    const firstTrigger = w.when?.[0]?.type;
    return h('li', { class: `ar-row wf-row${w.enabled ? '' : ' paused'}${last?.waiting ? ' waiting' : ''}`, 'data-workflow-id': w.id },
      h('div', { class: 'ar-top' },
        h('span', { class: 'ar-icon', 'aria-hidden': 'true', title: firstTrigger ? TRIGGER_INFO[firstTrigger]?.name : 'By hand' }, icon(ICON[firstTrigger] ? firstTrigger : 'play')),
        h('div', { class: 'ar-main' },
          h('div', { class: 'ar-name' }, h('button', { type: 'button', class: 'ar-title', 'aria-label': `Edit “${w.name}”`, 'data-fk': `edit-${w.id}`, onclick: () => openEditor(toDef(w)) }, w.name)),
          h('div', { class: 'ar-meta' },
            h('span', { class: `ar-status ${note.tone}` }, h('span', { class: 'ar-dot', 'aria-hidden': 'true' }), note.text),
            h('span', { class: 'ar-when', text: when.join(' · ') }),
            held ? h('button', { type: 'button', class: 'ar-held', title: 'Held until your usage resets. Click to take it out of the queue.', 'data-fk': `held-${w.id}`, onclick: () => unholdRun(w, held) }, `runs after the reset · ${held.atText}`) : null),
          w.description ? h('div', { class: 'ar-desc', text: w.description, title: w.description }) : null),
        h('div', { class: 'ar-actions' },
          runButton(w),
          iconBtn('more', `More for “${w.name}”`, e => rowMenu(w, e.currentTarget), { 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-fk': `more-${w.id}` }),
          h('label', { class: 'toggle mini', title: w.enabled ? 'Turn off' : 'Turn on' },
            h('input', { type: 'checkbox', checked: w.enabled, 'aria-label': `Run “${w.name}” automatically`, 'data-fk': `en-${w.id}`, onchange: e => setEnabled(w, e.target) }),
            h('span', { class: 'switch' })))),
      last?.waiting ? waitingBox(last) : null,
      runFormFor === w.id ? runForm(w) : null,
      estimateFor?.id === w.id ? estimateBox(w) : null);
  }

  // Run, with what a run usually costs on it ("Run · ~3% of your window"); amber when it
  // would pass the limit. The plain play button until the estimate has come.
  function runButton(w) {
    const est = estimates.get(w.id) || null;
    const attrs = { 'data-fk': `run-${w.id}`, 'aria-expanded': w.inputs?.length ? String(runFormFor === w.id) : null };
    if (!est) return iconBtn('play', `Run “${w.name}” now`, () => startRun(w), attrs);
    return h('button', { type: 'button', class: `btn slim-btn wf-run${est.over ? ' over' : ''}`, title: est.text, 'aria-label': `Run “${w.name}” now, ${est.label}${est.over ? ', past your limit' : ''}`, onclick: () => startRun(w), ...attrs },
      icon('play'), 'Run', h('span', { class: 'pct' }, ` · ${est.share}`, h('span', { class: 'pct-long', text: ' of your window' })));
  }

  // What each run would cost is asked for when the list first shows, and again only
  // when something that moves the guess has changed: a workflow added or gone, a
  // run ending, or a fresh usage reading (each comes with a new outlook). Never on
  // every redraw: that would be one call to main per workflow each time.
  function estimatesStale() {
    const key = workflows().map(w => `${w.id}:${w.lastRun?.endedAt || w.lastRun?.startedAt || ''}:${w.running ? 1 : 0}`).join('|');
    if (key === estSeen.key && state.outlook === estSeen.outlook) return false;
    estSeen = { key, outlook: state.outlook };
    return true;
  }

  async function refreshEstimates() {
    const ids = new Set(workflows().map(w => w.id));
    for (const id of [...estimates.keys()]) if (!ids.has(id)) estimates.delete(id);
    const seq = ++estSeq;
    const got = await Promise.all(workflows().map(w => api.estimateRun({ kind: 'workflow', workflowId: w.id }).then(e => [w.id, e || null], () => [w.id, null])));
    if (seq !== estSeq) return;
    let changed = false;
    for (const [id, e] of got) {
      const was = estimates.get(id);
      if (was?.label !== e?.label || !!was?.over !== !!e?.over) changed = true;
      estimates.set(id, e);
    }
    if (changed) fillList();
  }

  function waitingBox(last) {
    const wt = last.waiting;
    if (wt.question || wt.choices) {
      const choices = wt.choices?.length ? wt.choices : ['Continue', 'Stop'];
      return h('div', { class: 'wf-waiting', role: 'group', 'aria-label': 'Waiting for you' },
        h('p', { class: 'wf-waiting-q', text: wt.question || 'Carry on?' }),
        h('div', { class: 'row wrap' }, choices.map(c => h('button', {
          type: 'button', class: 'btn slim-btn',
          onclick: async ev => { ev.currentTarget.disabled = true; await answer(last.id, wt.key, c); },
        }, c)), wt.file ? openFileBtn(wt.file) : null));
    }
    return h('div', { class: 'wf-waiting quiet' }, h('span', { text: wt.until ? `Waiting until ${SB.untilTime(wt.until)}` : 'Waiting for your OK in its conversation' }),
      h('button', { type: 'button', class: 'btn ghost slim-btn', onclick: () => go('run', { runId: last.id }) }, 'Open the run'));
  }

  async function answer(runId, key, choice) {
    let res;
    try { res = await api.answerRun(runId, key, choice); } catch { res = { ok: false, error: 'Couldn\'t send that. Try again.' }; }
    SB.toast(res?.ok ? `Answered “${choice}”` : res?.error || 'Couldn\'t send that.');
  }

  async function setEnabled(w, input) {
    const enabled = input.checked;
    let res;
    try { res = await api.saveWorkflow({ ...toDef(w), enabled }); } catch { res = { ok: false, errors: [{ message: 'Couldn\'t save. Try again.' }] }; }
    if (res?.ok) {
      if (res.view) applyView(res.view);
      SB.toast(enabled ? `“${w.name}” is on` : `“${w.name}” is off`);
    } else {
      input.checked = !enabled;
      SB.toast(normErrors(res?.errors).map(e => e.message).join(' ') || 'Couldn\'t save that.');
    }
  }

  const ROW_ICONS = {
    runs: 'M3 4h10M3 8h10M3 12h6',
    duplicate: 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7',
    export: 'M8 2.5v7M5 5.5l3-3 3 3M3.5 9.5v3h9v-3',
  };
  const glyph = d => ({ glyph: SB.icon(d, { width: 1.4 }) });

  function rowMenu(w, anchor) {
    popup(anchor, () => [
      menuItem('Edit', null, () => openEditor(toDef(w)), glyph(SB.ICONS.edit)),
      menuItem('Runs', w.lastRun ? `Last ${SB.relTime(w.lastRun.startedAt)}` : 'None yet', () => go('runs', { id: w.id, name: w.name }), glyph(ROW_ICONS.runs)),
      menuItem('Duplicate', 'Opens a copy in the editor', () => openEditor(duplicateOf(w), { title: 'Copy of a workflow' }), glyph(ROW_ICONS.duplicate)),
      menuItem('Export', 'Copies it as JSON', () => exportWorkflow(w), glyph(ROW_ICONS.export)),
      h('div', { class: 'menu-sep' }),
      menuItem('Delete', null, () => deleteWorkflow(w), glyph(SB.ICONS.trash)),
    ]);
  }

  function duplicateOf(w) {
    const d = toDef(w);
    delete d.id;
    delete d.createdAt;
    d.name = `${w.name} copy`.slice(0, 60);
    // A web hook's token is its address: a copy gets its own when it's saved.
    d.when = (d.when || []).map(t => { const c = { ...t }; delete c.token; return c; });
    return d;
  }

  async function exportWorkflow(w) {
    let res;
    try { res = await api.exportWorkflow(w.id); } catch { res = { ok: false }; }
    SB.toast(res?.ok ? `Copied “${w.name}” as JSON` : res?.error || 'Couldn\'t copy it.');
  }

  async function deleteWorkflow(w) {
    const def = toDef(w);
    let v;
    try { v = await api.deleteWorkflow(w.id); } catch { SB.toast('Couldn\'t delete it. Try again.'); return; }
    if (v) applyView(v);
    SB.toast(`Deleted “${w.name}”`, {
      action: 'Undo', ms: 6000,
      onAction: async () => {
        let res;
        try { res = await api.saveWorkflow(def); } catch { res = { ok: false }; }
        if (res?.ok && res.view) applyView(res.view);
        SB.toast(res?.ok ? `“${w.name}” is back` : 'Couldn\'t bring it back.');
      },
    });
  }

  // ------------------------------------------------------------ running by hand

  function startRun(w) {
    if (w.inputs?.length) {
      runFormFor = runFormFor === w.id ? null : w.id;
      runValues = Object.fromEntries(w.inputs.map(i => [i.name, i.default || '']));
      fillList();
      if (runFormFor) requestAnimationFrame(() => list.rows.querySelector('.wf-runform .field')?.focus());
      return;
    }
    runNow(w, {});
  }

  // One tap runs it. Only a run that would pass your limit stops first, in a box on
  // its row that offers the reset (src/main/usage/runcost.js); estimated: you said
  // to run it anyway.
  async function runNow(w, inputs, { estimated = false } = {}) {
    if (!estimated) {
      let est;
      try { est = await api.estimateRun({ kind: 'workflow', workflowId: w.id }); } catch { est = null; }
      estimates.set(w.id, est || null);
      if (est?.over && est.text) {
        estimateFor = { id: w.id, inputs, est };
        runFormFor = null;
        fillList();
        requestAnimationFrame(() => list.rows?.querySelector('.wf-estimate .wf-run-go')?.focus());
        return false;
      }
    }
    let res;
    try { res = await api.runWorkflow(w.id, inputs); } catch { res = { ok: false, error: 'Couldn\'t start it. Try again.' }; }
    if (!res?.ok) { SB.toast(res?.error || 'Couldn\'t start it.'); return false; }
    SB.toast(`Started “${w.name}”`, { action: 'Watch', onAction: () => go('run', { runId: res.runId }) });
    return true;
  }

  // Past the limit: the warning, "Run after the reset" first, and the way to run it anyway.
  function estimateBox(w) {
    const { est, inputs } = estimateFor;
    const close = () => { estimateFor = null; fillList(); focusFk(`run-${w.id}`); };
    return h('div', { class: 'wf-estimate over', role: 'group', 'aria-label': `What “${w.name}” would cost` },
      h('p', { class: 'wf-estimate-text', text: est.text }),
      h('div', { class: 'row wrap' },
        est.resetText ? h('button', { type: 'button', class: 'btn slim-btn primary wf-run-later', title: 'Held until your usage resets, then run by hand with these inputs', onclick: () => holdRun(w, inputs) }, `Run after the reset (${est.resetText})`) : null,
        h('button', { type: 'button', class: 'btn slim-btn wf-run-go', onclick: () => { estimateFor = null; runNow(w, inputs, { estimated: true }); } }, 'Run anyway'),
        h('button', { type: 'button', class: 'btn ghost slim-btn', onclick: close }, 'Cancel')));
  }

  async function holdRun(w, inputs) {
    let r;
    try { r = await api.holdForReset({ kind: 'workflow', workflowId: w.id, inputs }); } catch { r = { ok: false, error: 'Couldn\'t hold it. Try again.' }; }
    estimateFor = null;
    fillList();
    SB.toast(r?.ok ? `“${w.name}” runs after the reset, at ${r.atText}.` : r?.error || 'Couldn\'t hold it.');
  }

  async function unholdRun(w, held) {
    let r;
    try { r = await api.cancelHeld(held.id); } catch { r = { ok: false }; }
    SB.toast(r?.ok ? `“${w.name}” won't run after the reset.` : 'That one has already gone.');
  }

  function runForm(w) {
    const err = h('p', { class: 'wf-err', role: 'alert', hidden: true });
    const fields = w.inputs.map(i => {
      const id = uid('in');
      const el = h('input', { class: 'field', id, type: 'text', autocomplete: 'off', spellcheck: 'false', required: i.required, 'data-fk': `rv-${w.id}-${i.name}`, oninput: e => { runValues[i.name] = e.target.value; } });
      el.value = runValues[i.name] ?? '';
      return h('div', { class: 'wf-field' }, h('label', { class: 'field-label', for: id, text: `${i.label || i.name}${i.required ? '' : ' (optional)'}` }), el);
    });
    return h('form', {
      class: 'wf-runform', novalidate: true, 'aria-label': `Run “${w.name}”`,
      onsubmit: async e => {
        e.preventDefault();
        const missing = w.inputs.filter(i => i.required && !String(runValues[i.name] || '').trim());
        if (missing.length) { err.hidden = false; err.textContent = `Fill in ${missing.map(i => i.label || i.name).join(', ')}.`; return; }
        if (await runNow(w, { ...runValues })) { runFormFor = null; fillList(); }
      },
      onkeydown: e => { if (e.key === 'Escape') { e.stopPropagation(); runFormFor = null; fillList(); focusFk(`run-${w.id}`); } },
    },
    fields, err,
    h('div', { class: 'row end' },
      h('button', { type: 'button', class: 'btn ghost slim-btn', onclick: () => { runFormFor = null; fillList(); focusFk(`run-${w.id}`); } }, 'Cancel'),
      h('button', { type: 'submit', class: 'btn primary slim-btn' }, 'Start')));
  }

  // ------------------------------------------------------------ templates

  function fillGallery() {
    const templates = state.workflows?.templates || [];
    if (!templates.length) { fill(list.gallery); return; }
    const cards = h('div', { class: 'templates' }, templates.map(t => h('button', {
      class: 'template wf-template', type: 'button', 'data-fk': `tpl-${t.key}`,
      onclick: () => openEditor(clone(t.workflow), { title: t.name }),
    },
    h('span', { class: 'wf-template-icon', 'aria-hidden': 'true', text: t.icon || '⚡' }),
    h('span', { class: 'wf-template-text' }, h('b', { text: t.name }), h('span', { text: t.description || '' })))));
    if (!workflows().length) {
      fill(list.gallery, h('h3', { class: 'wf-gallery-head', text: 'Start from a template' }), cards);
      return;
    }
    const open = list.gallery.querySelector('details')?.open;
    fill(list.gallery, h('details', { class: 'wf-disclosure', open: !!open }, h('summary', { text: 'Start from a template' }), cards));
  }

  // ------------------------------------------------------------ secrets

  let secretError = '';
  function fillSecrets() {
    const names = state.workflows?.secrets || [];
    const nameId = uid('sname');
    const valueId = uid('sval');
    const nameEl = h('input', { class: 'field wf-mono', id: nameId, maxlength: 40, autocomplete: 'off', spellcheck: 'false', placeholder: 'GITHUB_TOKEN', 'data-fk': 'secret-name', oninput: e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'); } });
    const valueEl = h('input', { class: 'field', id: valueId, type: 'password', autocomplete: 'off', 'data-fk': 'secret-value' });
    const err = h('p', { class: 'wf-err', role: 'alert', hidden: !secretError, text: secretError });
    fill(list.secrets,
      h('summary', {}, 'Secrets', names.length ? h('span', { class: 'wf-count', text: String(names.length) }) : null),
      h('div', { class: 'wf-secrets-body' },
      h('p', { class: 'field-hint' }, 'Use as ', h('code', { text: '{{ secrets.NAME }}' }), ' in commands and web requests. Kept encrypted by Windows.'),
      names.length ? h('ul', { class: 'wf-secret-list' }, names.map(n => h('li', {},
        h('code', { text: n }), h('span', { class: 'wf-dots', 'aria-hidden': 'true', text: '••••••' }),
        iconBtn('close', `Delete the secret ${n}`, () => deleteSecret(n), { 'data-fk': `sdel-${n}` })))) : null,
      h('form', {
        class: 'wf-secret-add', novalidate: true,
        onsubmit: async e => {
          e.preventDefault();
          const name = nameEl.value.trim();
          if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(name)) { showSecretError('Names are capitals, digits and _, starting with a letter (like GITHUB_TOKEN).', nameEl); return; }
          if (!valueEl.value) { showSecretError('Type the secret itself.', valueEl); return; }
          let v;
          try { v = await api.setWorkflowSecret(name, valueEl.value); } catch { showSecretError('Couldn\'t save it. Try again.', valueEl); return; }
          valueEl.value = '';
          secretError = '';
          if (v) applyView(v);
          SB.toast(`Saved the secret ${name}`);
          focusFk('secret-name');
        },
      },
      h('div', { class: 'wf-field' }, h('label', { class: 'field-label', for: nameId, text: 'Name' }), nameEl),
      h('div', { class: 'wf-field' }, h('label', { class: 'field-label', for: valueId, text: 'Value' }), valueEl),
      h('button', { type: 'submit', class: 'btn slim-btn', 'data-fk': 'secret-add' }, 'Add')),
      err));
    if (secretError) list.secrets.open = true;
    function showSecretError(text, el) { secretError = text; err.hidden = false; err.textContent = text; el.focus(); }
  }

  async function deleteSecret(name) {
    let v;
    try { v = await api.deleteWorkflowSecret(name); } catch { SB.toast('Couldn\'t delete it. Try again.'); return; }
    if (v) applyView(v);
    SB.toast(`Deleted the secret ${name}`);
  }

  // ------------------------------------------------------------ import

  function openImport() {
    const returnTo = document.activeElement;
    const titleId = uid('imp');
    const taId = uid('impta');
    const ta = h('textarea', { class: 'field area wf-json', id: taId, rows: 10, spellcheck: 'false', placeholder: '{ "name": "…", "steps": [ … ] }' });
    const err = h('p', { class: 'wf-err', role: 'alert', hidden: true });
    const go2 = h('button', { type: 'button', class: 'btn primary', onclick: doImport }, 'Open in the editor');
    const sheet = h('div', {
      class: 'card-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId,
      onmousedown: e => { if (e.target === sheet) close(); },
      // Tab stays inside it: a11y.js keeps every open .card-sheet's keyboard.
      onkeydown: e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } },
    },
    h('div', { class: 'card-box wf-import' },
      h('div', { class: 'card-head' }, h('h2', { id: titleId, text: 'Import a workflow' }), iconBtn('close', 'Close', () => close())),
      h('label', { class: 'field-label', for: taId, text: 'Paste a workflow\'s JSON' }),
      ta,
      h('p', { class: 'field-hint', text: 'It opens in the editor first. Nothing is saved until you press Save.' }),
      err,
      h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn ghost', onclick: () => close() }, 'Cancel'), go2)));
    document.body.append(sheet);
    ta.focus();
    async function doImport() {
      if (!ta.value.trim()) { err.hidden = false; err.textContent = 'Paste the JSON first.'; ta.focus(); return; }
      go2.disabled = true;
      let res;
      try { res = await api.importWorkflow(ta.value); } catch { res = { ok: false, error: 'Couldn\'t read that. Try again.' }; }
      go2.disabled = false;
      if (!res?.ok) { err.hidden = false; err.textContent = res?.error || 'That isn\'t a workflow Shellby can read.'; ta.focus(); return; }
      close(false);
      openEditor(res.workflow, { title: 'Imported workflow' });
    }
    function close(refocus = true) {
      sheet.remove();
      if (refocus && returnTo?.isConnected) returnTo.focus();
    }
  }

  Object.assign(W, {
    renderList, applyView, workflows, runNow, startRun, toDef, answer, refreshList, focusDescribeSoon, draftFrom,
  });
})();
