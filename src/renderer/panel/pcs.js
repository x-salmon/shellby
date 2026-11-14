/* Shellby panel — Your PCs, the hub (src/main/wiring/hub.js): this PC and your
   other ones in one roster, with what each is doing, how it's holding up, what
   it can run, and a way to start a task on any of them. A PC is added the way
   a phone is paired, with the code it shows; it must be signed in to the same
   Tailscale account.

   The roster is mockup B: in the narrow panel each PC is a compact row (the
   rest is in the detail under it); widened, it opens out into the full table
   (pcs.css, a container query). */
'use strict';
(function () {
  const { h, state, $ } = SB;
  const api = SB.hubApi; // pcs-talk.js
  const MODES = [['ask', 'Ask first'], ['smart', 'Smart'], ['acceptEdits', 'Auto-edit'], ['plan', 'Plan only']];
  const STANDING = { asking: 'asks you', review: 'ready to review', finished: 'finished', working: 'working', quiet: 'quiet' };

  /** @type {{ rows: any[], summary: string, usage: any } | null} the last hub:view */
  let view = null;
  let selected = 'this';  // the row whose detail shows
  let tasking = false;    // the Start a task form is open for the selected PC
  let removing = null;    // the PC whose Remove is waiting for a second press
  let renaming = null;    // the PC whose name is being changed
  /** @type {{ pcId: string, tabId: string, ready?: boolean } | null} a conversation there, open on the hub (pcs-talk.js) */
  let opened = null;
  /** @type {any} */
  let convo = null;       // its transcript, as hub:convo last said
  /** @type {any} */
  let pane = null;        // its pane, kept while it's open
  // The forms, kept across redraws so what's typed in them stays (the view redraws every second).
  const forms = new Map();

  const rowOf = id => view?.rows.find(r => r.id === id) || null;

  function ago(at) {
    if (!Number.isFinite(at)) return 'never';
    const m = Math.round((Date.now() - at) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const hrs = Math.round(m / 60);
    return hrs < 48 ? `${hrs} h ago` : `${Math.round(hrs / 24)} days ago`;
  }

  const meter = (pct, hot) => h('span', { class: 'pcs-meter', 'aria-hidden': 'true' }, h('i', { class: hot ? 'hot' : '', style: `width:${Math.max(0, Math.min(100, pct))}%` }));
  const dash = () => h('span', { class: 'faint', text: '–', 'aria-label': 'not known' });

  function ramText(r) {
    if (!r.ram) return null;
    if (Number.isFinite(r.ram.totalGb)) return { text: `${r.ram.usedGb ?? '?'} / ${r.ram.totalGb} GB`, pct: r.ram.usedGb != null ? (r.ram.usedGb / r.ram.totalGb) * 100 : 0 };
    return Number.isFinite(r.ram.pct) ? { text: `${r.ram.pct}%`, pct: r.ram.pct } : null;
  }

  function statusLine(r) {
    if (r.kind === 'this') return [r.os, 'this PC, the hub'].filter(Boolean).join(', ');
    if (r.live) return r.os || 'reachable';
    if (r.state === 'unpaired') return r.error || 'Needs pairing again';
    if (r.state === 'connecting') return 'Connecting…';
    return `Not reachable, seen ${ago(r.seenAt)}`;
  }

  function rowEl(r) {
    const ram = ramText(r);
    const cell = (content, wide = false) => h('td', { class: wide ? 'pcs-wide' : '' }, content ?? dash());
    const tr = h('tr', {
      class: r.live ? '' : 'off', tabindex: '0', 'aria-selected': String(r.id === selected), dataset: { id: r.id, keep: `pc:${r.id}` },
      onclick: () => select(r.id),
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(r.id); } },
    },
    h('th', { scope: 'row' }, h('span', { class: 'pcs-name' }, h('span', { class: `pcs-dot ${r.live ? 'on' : ''}`, 'aria-hidden': 'true' }),
      h('span', {}, h('b', { text: r.name }), h('small', { text: statusLine(r) })))),
    cell(r.working == null ? null : h('span', { class: 'pcs-num', text: String(r.working) })),
    cell(r.waiting == null ? null : r.waiting ? h('span', { class: 'pcs-ask', text: `${r.waiting} waiting` }) : h('span', { class: 'faint', text: 'none' })),
    cell(r.cpu == null ? null : h('span', {}, h('span', { class: 'pcs-num', text: `${r.cpu}%` }), meter(r.cpu))),
    cell(r.gpu?.temp == null ? null : h('span', {}, h('span', { class: `pcs-num ${r.gpu.temp >= 75 || r.hot ? 'pcs-warm' : ''}`, text: `${r.gpu.temp}°C` }), meter(r.gpu.load ?? r.gpu.temp, r.gpu.temp >= 75)), true),
    cell(ram ? h('span', {}, h('span', { class: 'pcs-num', text: ram.text }), meter(ram.pct)) : null, true),
    cell(r.diskFreeGb == null ? null : h('span', { class: 'pcs-num', text: `${r.diskFreeGb} GB free` }), true),
    cell(r.power ? h('span', { class: /^battery/.test(r.power) ? 'pcs-warm' : '', text: r.power }) : null, true),
    cell(r.agents.length ? h('span', {}, ...r.agents.map(a => h('span', { class: 'pcs-ag', title: a.name, text: a.name.split(' ')[0] }))) : null),
    cell(r.projects.length ? h('span', { class: 'pcs-projects', text: r.projects.map(p => p.name).join(', ') + (r.moreProjects ? ` and ${r.moreProjects} more` : '') }) : null, true));
    return tr;
  }

  function table() {
    const th = (text, wide = false) => h('th', { scope: 'col', class: wide ? 'pcs-wide' : '', text });
    return h('table', { class: 'pcs-table' },
      h('thead', {}, h('tr', {}, th('PC'), th('Working'), th('Waiting on you'), th('CPU'), th('GPU', true), th('Memory', true), th('Disk', true), th('Power', true), th('Agents'), th('Projects', true))),
      h('tbody', {}, ...(view?.rows || []).map(rowEl)));
  }

  function convosCard(r) {
    const live = r.tabs.filter(t => t.standing !== 'quiet' || t.busy);
    return h('section', { class: 'pcs-card' },
      h('h3', { text: `On ${r.name} now` }),
      !r.live ? h('p', { class: 'muted small', text: r.error || "It isn't reachable, so what it's doing isn't known." })
        : live.length ? h('ul', { class: 'pcs-convos' }, ...live.map(t => h('li', {}, h('button', {
          type: 'button', class: 'pcs-convo-btn', dataset: { keep: `convo:${t.id}` },
          title: r.kind === 'this' ? 'Open it in Chat' : `Open it here, live from ${r.name}`,
          onclick: () => openConvo(r, t),
        },
        h('span', { class: `pcs-dot ${t.busy ? 'on' : ''}`, 'aria-hidden': 'true' }),
        h('span', { text: t.title }),
        h('span', { class: t.standing === 'asking' ? 'pcs-ask' : 'who', text: [t.agent, STANDING[t.standing] || t.standing].filter(Boolean).join(', ') })))))
          : h('p', { class: 'muted small', text: 'Nothing on the go there.' }));
  }

  function factsCard(r) {
    const kv = [
      ['Windows', r.os], ['Shellby', r.version], ['Agents', r.agents.map(a => a.name).join(', ')],
      ['Projects', r.projects.map(p => p.name).join(', ') + (r.moreProjects ? ` and ${r.moreProjects} more` : '')],
      ['Memory', ramText(r)?.text], ['Disk', r.diskFreeGb != null ? `${r.diskFreeGb} GB free` : null], ['Power', r.power],
      ['Last seen', r.kind === 'this' ? null : r.live ? 'now' : ago(r.seenAt)],
    ].filter(([, v]) => v);
    return h('section', { class: 'pcs-card' },
      h('h3', { text: r.kind === 'this' ? 'This PC' : r.name }),
      kv.length ? h('dl', { class: 'pcs-kv' }, ...kv.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])) : h('p', { class: 'muted small', text: "It hasn't said anything about itself yet." }));
  }

  function actionsCard(r) {
    const card = h('section', { class: 'pcs-card' }, h('h3', { text: 'Do something there' }));
    if (r.kind === 'this') {
      card.append(h('p', { class: 'muted small', text: 'Conversations on this PC start in Chat.' }),
        h('div', { class: 'pcs-actions' }, h('button', { type: 'button', class: 'btn primary slim-btn', text: 'New conversation', onclick: () => { SB.setView('chat'); SB.newTab(); } })));
      return card;
    }
    const acts = h('div', { class: 'pcs-actions' },
      h('button', { type: 'button', class: 'btn primary slim-btn', text: 'Start a task', disabled: !r.live || !r.projects.length, title: !r.live ? 'It isn\'t reachable right now' : !r.projects.length ? 'Shellby there knows no projects yet' : '', onclick: () => { tasking = !tasking; render(); } }),
      !r.live && h('button', { type: 'button', class: 'btn slim-btn', text: 'Try again', onclick: () => api.hubRetry() }),
      h('button', { type: 'button', class: 'btn ghost slim-btn', text: 'Rename', onclick: () => { renaming = renaming === r.id ? null : r.id; render(); } }),
      h('button', { type: 'button', class: `btn ghost slim-btn ${removing === r.id ? 'danger' : ''}`, text: removing === r.id ? `Remove ${r.name}?` : 'Remove', onclick: () => remove(r) }));
    card.append(acts);
    if (renaming === r.id) card.append(renameForm(r));
    if (tasking && r.live) card.append(taskForm(r));
    return card;
  }

  function taskForm(r) {
    const key = `task:${r.id}`;
    if (!forms.has(key)) forms.set(key, makeTaskForm(r));
    return forms.get(key);
  }

  function makeTaskForm(r) {
    const text = h('textarea', { class: 'field area', dataset: { keep: 'task' }, placeholder: `What should it do on ${r.name}?`, maxlength: '4000', 'aria-label': 'The task' });
    const project = h('select', { class: 'field slim', 'aria-label': 'Which project' }, ...r.projects.map(p => h('option', { value: p.key, text: p.name })));
    const mode = h('select', { class: 'field slim', 'aria-label': 'How it may work' }, ...MODES.map(([v, label]) => h('option', { value: v, text: label })));
    const send = h('button', { type: 'submit', class: 'btn primary slim-btn', text: `Start on ${r.name}` });
    const form = h('form', { class: 'pcs-task', onsubmit: async e => {
      e.preventDefault();
      if (!text.value.trim()) { text.focus(); return; }
      send.disabled = true;
      const res = await api.hubTask(r.id, { project: project.value, text: text.value.trim(), mode: mode.value }).catch(() => null);
      send.disabled = false;
      if (!res?.ok) { SB.toast(res?.error || res?.reply || "Couldn't start it there."); return; }
      tasking = false;
      forms.delete(`task:${r.id}`);
      SB.toast(res.held ? `Queued on ${r.name}: ${res.atText || 'after the reset'}` : `Started on ${r.name}`);
      load();
    } }, text, h('div', { class: 'row' }, project, mode), h('div', { class: 'row' }, send));
    requestAnimationFrame(() => text.focus());
    return form;
  }

  function renameForm(r) {
    const key = `rename:${r.id}`;
    if (!forms.has(key)) forms.set(key, makeRenameForm(r));
    return forms.get(key);
  }

  function makeRenameForm(r) {
    const input = h('input', { class: 'field slim', dataset: { keep: 'rename' }, value: r.name, maxlength: '40', 'aria-label': `New name for ${r.name}` });
    requestAnimationFrame(() => { input.focus(); input.select(); });
    return h('form', { class: 'pcs-task', onsubmit: async e => {
      e.preventDefault();
      if (!input.value.trim()) return;
      await api.hubRename(r.id, input.value.trim());
      renaming = null;
      forms.delete(`rename:${r.id}`);
      load();
    } }, h('div', { class: 'row' }, input, h('button', { type: 'submit', class: 'btn slim-btn', text: 'Save' })));
  }

  async function remove(r) {
    if (removing !== r.id) { removing = r.id; render(); return; }
    removing = null;
    const res = await api.hubRemove(r.id);
    if (res?.ok) {
      SB.toast(res.forgotThere ? `${r.name} is off the hub, and has forgotten it.` : `${r.name} is off the hub. It was asleep: forget the hub in its own Settings, Alerts, On your phone.`);
      selected = 'this';
    }
    load();
  }

  function select(id) {
    if (selected !== id) { tasking = false; removing = null; renaming = null; forms.clear(); closeConvo(); }
    selected = id;
    render();
  }

  // ---- a conversation there, open on the hub

  function openConvo(r, t) {
    if (r.kind === 'this') { SB.setView('chat'); SB.activate(t.id); return; }
    /** @type {{ pcId: string, tabId: string, ready?: boolean }} */
    const mine = { pcId: r.id, tabId: t.id };
    opened = mine;
    convo = null;
    pane = SB.pcsTalk.makePane({ onBack: () => { const back = opened?.tabId; closeConvo(); render(); if (back) SB.focusKept($('pcsDetail'), `convo:${back}`); } });
    api.hubOpen(r.id, t.id).then(res => {
      if (opened !== mine) return; // another was opened meanwhile: this answer is about one that's gone
      if (!res?.ok) { SB.toast(res?.error || "Couldn't open it there."); closeConvo(); } else mine.ready = true;
      load();
    });
    render();
    requestAnimationFrame(() => pane?.focus());
  }

  function closeConvo() {
    if (!opened) return;
    opened = null;
    convo = null;
    pane = null;
    api.hubClose();
  }

  function detailOf(r) {
    const o = opened;
    if (o && o.pcId === r.id && pane) {
      pane.update(r, r.tabs.find(t => t.id === o.tabId) || null, convo, load);
      return [pane.el];
    }
    return [SB.pcsTalk.promptsCard(r, load), convosCard(r), factsCard(r), actionsCard(r)].filter(Boolean);
  }

  function render() {
    const root = $('pcsRoster');
    if (!view) { root.replaceChildren(h('p', { class: 'pcs-empty', text: 'Looking for your PCs…' })); return; }
    $('pcsSummary').textContent = view.rows.length > 1 ? view.summary : "Only this PC so far. Add your others to see them here and start work on them.";
    if (!rowOf(selected)) selected = 'this';
    SB.keepFocus($('pcsView'), () => {
      root.replaceChildren(table());
      const r = rowOf(selected);
      const detail = $('pcsDetail');
      const next = r ? detailOf(r) : [];
      // What's the same stays put (the open conversation, a plan being read), keeping focus, scroll and what's typed.
      SB.pcsTalk.place(detail, next);
      detail.classList.toggle('talking', !!(opened && pane && r?.id === opened.pcId));
    });
  }

  async function load() {
    const o = opened;
    const [v, c] = await Promise.all([api.hubView(selected).catch(() => null), o ? api.hubConvo(convo?.version ?? null).catch(() => null) : null]);
    view = v;
    if (o && o === opened) {
      // Unchanged since the last ask: keep what's drawn. Gone on main's side (the hub stopped): back to the PC.
      if (c?.same && convo) { /* kept */ } else if (c && c.pcId === o.pcId && c.tabId === o.tabId) convo = c;
      else if (!c && o.ready) { opened = null; convo = null; pane = null; }
    }
    if (state.view === 'pcs') render();
  }

  // ---- adding a PC

  const addForm = $('pcsAdd');
  const addError = $('pcsAddError');
  function openAdd(open = true) {
    addForm.hidden = !open;
    addError.hidden = true;
    if (open) { $('pcsAddress').focus(); addForm.scrollIntoView({ block: 'nearest' }); }
  }
  $('pcsAddBtn').addEventListener('click', () => openAdd(addForm.hidden));
  $('pcsAddCancel').addEventListener('click', () => openAdd(false));
  addForm.addEventListener('submit', async e => {
    e.preventDefault();
    const pair = $('pcsPair');
    pair.disabled = true;
    pair.textContent = 'Adding…';
    const res = await api.hubAdd({ address: $('pcsAddress').value.trim(), code: $('pcsCode').value.trim(), name: $('pcsName').value.trim() }).catch(() => null);
    pair.disabled = false;
    pair.textContent = 'Add it';
    if (!res?.ok) { addError.textContent = res?.error || "Couldn't add it."; addError.hidden = false; return; }
    for (const id of ['pcsAddress', 'pcsCode', 'pcsName']) $(id).value = '';
    openAdd(false);
    selected = res.id;
    SB.toast('Added. It shows here while it can be reached.');
    load();
  });

  SB.api.onHubChanged(() => { if (state.view === 'pcs') load(); });
  // From Settings, Alerts, On your phone: how another PC joins (html/settings-alerts.html).
  $('pocketHubLink')?.addEventListener('click', () => SB.setView('pcs'));

  SB.views.pcs = {
    // Opening the screen tries the PCs that weren't reachable at once, rather than at their next retry.
    render: () => { api.hubRetry(); load(); },
    // Away from the screen, nothing there is watched live.
    leave: () => closeConvo(),
  };
})();
