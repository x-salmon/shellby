/* Shellby panel — Your PCs, acting on another PC's conversations (pcs.js,
   src/main/wiring/hub.js): answering what's waiting on you there, and one of
   its conversations open on the hub, live, with a box to reply.

   Everything goes through that PC's own phone rules, so the hub can do
   exactly what a paired phone can: a prompt the PC says needs its desk
   (deskOnly) only shows here, a plan is approved only once it's been read to
   the end, and a reply keeps the mode the conversation is in.

   Views redraw every second while PCs talk: what you've picked, typed or
   scrolled is kept outside the DOM (picked, read, the pane's own composer). */
'use strict';
(function () {
  const { h } = SB;
  // The hub's calls (preload.js), as a plain object the screens call through:
  // the bridge's own is frozen, and e2e-hub stands in for these with another PC.
  const HUB_CALLS = ['hubView', 'hubAdd', 'hubRemove', 'hubRename', 'hubTask', 'hubRetry', 'hubAnswer', 'hubReply', 'hubOpen', 'hubClose', 'hubConvo'];
  const api = SB.hubApi = Object.fromEntries(HUB_CALLS.map(n => [n, (...args) => SB.api[n](...args)]));

  const MODE_NAMES = { ask: 'Ask first', smart: 'Smart', acceptEdits: 'Auto-edit', plan: 'Plan only' };
  const picked = new Map(); // requestId + question -> the labels picked
  const read = new Set();   // requestIds whose plan was read to the end
  const planAt = new Map(); // requestId -> how far down its plan you'd scrolled

  async function answer(r, p, decision, extra = {}, reload) {
    const res = await api.hubAnswer(r.id, { tabId: p.tabId, requestId: p.requestId, decision, ...extra }).catch(() => null);
    if (!res?.ok) { SB.toast(res?.error || "Couldn't answer it there."); return; }
    SB.toast(decision === 'deny' ? `Said no on ${r.name}` : `Answered on ${r.name}`);
    reload();
  }

  function questionsBlock(r, p, reload) {
    const key = q => `${p.requestId}\n${q.question}`;
    const chosen = q => picked.get(key(q)) || [];
    const send = h('button', { type: 'button', class: 'btn primary slim-btn', text: 'Send answers', dataset: { keep: `ans:${p.requestId}` } });
    const ready = () => p.questions.every(q => chosen(q).length);
    send.disabled = !ready();
    send.onclick = () => answer(r, p, 'allow', { answers: Object.fromEntries(p.questions.map(q => [q.question, chosen(q).join(', ')])) }, reload);
    const blocks = p.questions.map((q, qi) => h('fieldset', { class: 'pcs-q' },
      h('legend', { text: q.question }),
      ...q.options.map((o, oi) => {
        const input = h('input', {
          type: q.multiSelect ? 'checkbox' : 'radio', name: `q-${p.requestId}-${qi}`, checked: chosen(q).includes(o.label),
          dataset: { keep: `opt:${p.requestId}:${qi}:${oi}` },
          onchange: () => {
            const now = q.multiSelect ? (input.checked ? [...chosen(q), o.label] : chosen(q).filter(l => l !== o.label)) : [o.label];
            picked.set(key(q), now);
            send.disabled = !ready();
          },
        });
        return h('label', { class: 'pcs-opt' }, input, h('span', {}, h('b', { text: o.label }), o.description && h('small', { text: o.description })));
      })));
    return [...blocks, h('div', { class: 'pcs-actions' }, send,
      h('button', { type: 'button', class: 'btn ghost slim-btn', text: 'Skip', onclick: () => answer(r, p, 'deny', {}, reload) }))];
  }

  function planBlock(r, p, reload) {
    const approve = h('button', { type: 'button', class: 'btn primary slim-btn', text: 'Approve', disabled: !read.has(p.requestId), title: read.has(p.requestId) ? '' : 'Read it to the end first', dataset: { keep: `plan:${p.requestId}` } });
    const box = h('pre', { class: 'pcs-plan', tabindex: '0', 'aria-label': 'The plan', text: p.planText || p.plan });
    const check = () => {
      // Only a box that's on screen and laid out counts: a detached one measures 0 all round, which isn't reading it.
      if (!box.isConnected || !box.clientHeight) return;
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 4 && !read.has(p.requestId)) {
        read.add(p.requestId);
        approve.disabled = false;
        approve.title = '';
      }
    };
    box.addEventListener('scroll', () => { if (box.isConnected) planAt.set(p.requestId, box.scrollTop); check(); });
    // Where you were, if it's drawn anew; and a short plan is read once it's shown.
    requestAnimationFrame(() => { if (!box.isConnected) return; box.scrollTop = planAt.get(p.requestId) || 0; check(); });
    approve.onclick = () => answer(r, p, 'allow', { read: true }, reload);
    return [box, h('div', { class: 'pcs-actions' }, approve,
      h('button', { type: 'button', class: 'btn ghost slim-btn', text: 'Send it back', onclick: () => answer(r, p, 'deny', {}, reload) }))];
  }

  /** One prompt waiting there, with the answers the hub may give it. */
  function promptEl(r, p, reload) {
    const head = h('div', { class: 'pcs-prompt-head' },
      h('b', { text: p.title }),
      p.helper && h('small', { class: 'muted', text: `its helper: ${p.helper}` }));
    const what = h('p', { class: 'pcs-prompt-ask', text: p.ask || p.label || p.toolName });
    const body = [head, what];
    if (p.detail && !p.planText) body.push(h('pre', { class: 'pcs-prompt-detail', text: p.detail }));
    for (const w of p.warnings) body.push(h('p', { class: 'pcs-warn', text: w }));
    if (r.kind === 'this') {
      body.push(h('div', { class: 'pcs-actions' }, h('button', { type: 'button', class: 'btn primary slim-btn', text: 'Open it', onclick: () => { SB.setView('chat'); SB.activate(p.tabId); } })));
    } else if (p.deskOnly) {
      body.push(h('p', { class: 'muted small', text: `${p.deskOnly} Answer it at ${r.name}.` }));
    } else if (p.questions.length) {
      body.push(...questionsBlock(r, p, reload));
    } else if (p.planText || p.plan) {
      body.push(...planBlock(r, p, reload));
    } else {
      body.push(h('div', { class: 'pcs-actions' },
        h('button', { type: 'button', class: 'btn primary slim-btn', text: 'Allow', dataset: { keep: `allow:${p.requestId}` }, onclick: () => answer(r, p, 'allow', {}, reload) }),
        p.always && h('button', { type: 'button', class: 'btn slim-btn', text: p.always, onclick: () => answer(r, p, 'always', {}, reload) }),
        h('button', { type: 'button', class: 'btn ghost slim-btn', text: 'Deny', onclick: () => answer(r, p, 'deny', {}, reload) })));
    }
    return h('article', { class: 'pcs-prompt' }, ...body);
  }

  /** @type {Map<string, { sig: string, el: HTMLElement }>} the cards drawn, kept while what they show is the same */
  const cards = new Map();

  /**
   * "Waiting on you": every prompt on that PC, or only one conversation's.
   * The same card while its prompts are the same, so a plan being read keeps its place.
   */
  function promptsCard(r, reload, tabId = null) {
    const list = tabId ? r.prompts.filter(p => p.tabId === tabId) : r.prompts;
    const key = `${r.id}|${tabId || ''}`;
    if (!list.length) { cards.delete(key); return null; }
    const sig = JSON.stringify(list);
    const kept = cards.get(key);
    if (kept && kept.sig === sig) return kept.el;
    const el = makePromptsCard(r, reload, list);
    cards.set(key, { sig, el });
    return el;
  }

  function makePromptsCard(r, reload, list) {
    return h('section', { class: 'pcs-card pcs-waiting' },
      h('h3', { text: list.length === 1 ? 'Waiting on you' : `${list.length} waiting on you` }),
      ...list.map(p => promptEl(r, p, reload)));
  }

  // ---- one conversation there, open on the hub

  function itemEl(i) {
    switch (i.k) {
      case 'user': return h('div', { class: 'pcs-said you' }, h('span', { class: 'pcs-who', text: 'You' }), h('p', { text: i.text }));
      case 'text': return h('div', { class: `pcs-said ${i.sub ? 'sub' : ''}` }, h('p', { text: i.text }));
      case 'tool': return h('div', { class: `pcs-step ${i.sub ? 'sub' : ''}` }, h('span', { text: i.label || i.name }), i.detail && h('code', { text: i.detail }));
      case 'done': return h('div', { class: 'pcs-step bad' }, h('span', { text: i.text || 'That step failed.' }));
      case 'asked': return h('div', { class: 'pcs-step' }, h('span', { text: `Asked: ${i.label}` }), i.detail && h('code', { text: i.detail }));
      case 'decision': return h('div', { class: 'pcs-step' }, h('span', { text: `${i.decision === 'deny' ? 'Said no' : 'Allowed'}${i.via ? ` (${i.via === 'pocket' ? 'away from the desk' : i.via})` : ''}` }));
      case 'end': return h('div', { class: `pcs-end ${i.ok ? '' : 'bad'}`, text: i.interrupted ? 'Stopped.' : i.ok ? `Done${Number.isFinite(i.seconds) ? ` in ${i.seconds} s` : ''}.` : i.error || 'It ran into trouble.' });
      case 'changes': return h('div', { class: 'pcs-step' }, h('span', { text: `Changed ${i.files} file${i.files === 1 ? '' : 's'}, +${i.added} −${i.removed}` }));
      case 'checks': return h('div', { class: 'pcs-step' }, h('span', { text: `Checks: ${i.summary || i.status}` }));
      case 'task': return h('div', { class: 'pcs-step' }, h('span', { text: `Helper: ${i.description}${i.status ? `, ${i.status}` : ''}` }));
      case 'note': return h('div', { class: 'pcs-step' }, h('span', { text: i.text }));
      default: return null;
    }
  }

  /**
   * The open conversation: its own element, kept while it's open so the reply
   * being typed and where you've scrolled survive each redraw.
   */
  function makePane({ onBack }) {
    const log = h('div', { class: 'pcs-log', tabindex: '0', 'aria-label': 'The conversation' });
    const typing = h('div', { class: 'pcs-said typing', hidden: true }, h('p'));
    let drawnAt = -1; // the steps' version drawn in the log
    const status = h('p', { class: 'muted small pcs-convo-status' });
    const title = h('h3');
    const prompts = h('div');
    const box = h('textarea', { class: 'field area', maxlength: '4000', 'aria-label': 'Your reply', dataset: { keep: 'reply' } });
    const send = h('button', { type: 'submit', class: 'btn primary slim-btn', text: 'Send' });
    const how = h('small', { class: 'muted' });
    const form = h('form', { class: 'pcs-task' }, box, h('div', { class: 'row pcs-send' }, how, send));
    const el = h('section', { class: 'pcs-card pcs-convo' },
      h('div', { class: 'pcs-convo-head' }, h('button', { type: 'button', class: 'btn ghost slim-btn', text: 'Back', onclick: onBack }), title),
      status, log, prompts, form);
    /** @type {{ r: any, tab: any, reload: () => void }} */
    let current = { r: null, tab: null, reload: () => {} };

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const { r, tab } = current;
      const said = box.value.trim();
      if (!said || !r || !tab) { box.focus(); return; }
      send.disabled = true;
      const res = await api.hubReply(r.id, { tabId: tab.id, text: said }).catch(() => null);
      send.disabled = false;
      if (!res?.ok) { SB.toast(res?.error || "Couldn't send it there."); return; }
      box.value = '';
      SB.toast(res.queued ? 'Sent. It goes in at his next step.' : `Sent to ${r.name}`);
      current.reload();
    });
    box.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit(); });

    function update(r, tab, convo, reload) {
      current = { r, tab, reload };
      title.textContent = tab ? tab.title : 'That conversation has closed';
      const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 24;
      // The steps are drawn again only when they've changed: the reply being typed is its own line.
      const at = convo ? convo.itemsAt ?? 0 : -1;
      if (at !== drawnAt) {
        drawnAt = at;
        log.replaceChildren(...(convo?.items || []).map(itemEl).filter(Boolean), typing);
      }
      typing.hidden = !convo?.typing;
      typing.firstElementChild.textContent = convo?.typing || '';
      if (atEnd) log.scrollTop = log.scrollHeight;
      status.textContent = !r.live ? r.error || "That PC isn't reachable right now."
        : convo?.state === 'unpaired' || convo?.state === 'offline' ? convo.error || 'Reconnecting…'
          : !convo?.loaded ? 'Loading the conversation…'
            : [tab?.agent, tab?.busy ? 'working' : 'waiting for you'].filter(Boolean).join(', ');
      place(prompts, [promptsCard(r, reload, tab?.id)].filter(Boolean));
      // As wiring/hub.js replyOn: only in a mode the hub sends in, and never into a terminal.
      const why = !tab ? '' : !tab.canReply ? `It's in a terminal on ${r.name}. Reply there.`
        : tab.mode === 'autonomous' ? `It's on Autonomous on ${r.name}, which the hub never sends in. Reply there.`
          : !MODE_NAMES[tab.mode] ? `${r.name} didn't say how it may work. Reply there.` : '';
      const canSend = !!tab && r.live && !why;
      box.disabled = !canSend;
      send.disabled = !canSend;
      box.placeholder = why || (tab ? `Reply on ${r.name}` : '');
      how.textContent = canSend ? `In ${MODE_NAMES[tab.mode]}${tab.busy ? ', after his current step' : ''}. Ctrl+Enter sends.` : '';
    }

    return { el, update, focus: () => box.focus() };
  }

  /**
   * Make box's children these nodes, in order, moving only what has to move:
   * a node that stays where it is is never taken out, so it keeps its scroll and focus.
   */
  function place(box, nodes) {
    for (const c of [...box.children]) if (!nodes.includes(c)) c.remove();
    nodes.forEach((n, i) => { if (box.children[i] !== n) box.insertBefore(n, box.children[i] || null); });
  }

  SB.pcsTalk = { promptsCard, makePane, itemEl, place };
})();
