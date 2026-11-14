/* Shellby panel — the task board, a card on a project's page
   (src/main/wiring/taskboard.js): what Shellby's conversations have handed
   each other in this project. Each task says where it is (open, waiting on
   another, being done, done, failed), who has it, and what came back. Open
   jumps to the conversation doing it; Cancel stops an unfinished one being
   picked up. Conversations do everything else themselves, with their tools.

   The card stays hidden until the project has something on its board. */
'use strict';
(function () {
  const { h, api, state } = SB;

  const SHOWN = 6;
  const TAG = { open: 'Open', claimed: 'Doing', done: 'Done', failed: 'Failed', cancelled: 'Gone' };
  const TONE = { claimed: 'now', failed: 'error', open: 'issue' };
  const live = new Set(); // each card's load(), for 'taskboard:changed'
  const expanded = new Set();

  function openTab(tabId) {
    SB.setView('chat');
    if (state.tabs.has(tabId)) SB.activate(tabId); else SB.openHistory(tabId);
  }

  function subline(t) {
    if (t.status === 'claimed') return `${t.claimedBy?.title || 'A conversation'} is on it`;
    if (t.status === 'open' && t.waitingOn.length) return `Waiting on ${t.waitingOn.join(', ')}`;
    if (t.status === 'open') return t.ready ? 'Ready for any conversation to pick up' : 'Can\'t start: something it needs failed';
    if (t.result) return t.result.split('\n')[0];
    return t.status === 'cancelled' ? 'Cancelled' : '';
  }

  function row(t, reload) {
    const opener = t.open[0];
    const acts = h('span', { class: 'pj-h-acts' },
      opener && h('button', { type: 'button', class: 'btn slim-btn', text: 'Open', 'aria-label': `Open the conversation doing ${t.title}`, onclick: () => openTab(opener) }),
      (t.status === 'open' || t.status === 'claimed') && h('button', {
        type: 'button', class: 'btn ghost slim-btn', text: 'Cancel', 'aria-label': `Cancel ${t.title}`,
        onclick: async e => {
          e.currentTarget.disabled = true;
          const r = await api.taskBoardCancel(t.id);
          if (!r?.ok) SB.toast(r?.error || "Couldn't cancel it.");
          reload();
        },
      }));
    const by = t.postedBy?.title ? `Posted by ${t.postedBy.title}` : '';
    return h('li', { class: 'pj-h-row bl-row tb-row', dataset: { id: t.id } },
      h('span', { class: `bl-tag ${TONE[t.status] || ''}`, text: TAG[t.status] || t.status }),
      h('span', { class: 'pj-h-text' },
        h('span', { class: 'bl-title' }, h('b', { text: t.title, title: t.detail || t.title })),
        h('span', { class: 'muted small', title: t.result || by }, `${t.id} · `, subline(t)),
        t.helper?.branch && h('span', { class: 'bl-where', text: t.helper.branch })),
      acts);
  }

  /** The card for one project. root: its main clone. */
  function card({ root }) {
    const box = h('section', { class: 'pj-panel tb-card', 'aria-label': 'Task board', hidden: true });
    const body = h('div');
    box.append(
      h('div', { class: 'bl-head' }, h('p', { class: 'row-label', text: 'Task board' })),
      h('p', { class: 'muted small tb-intro', text: 'Work Shellby\'s conversations have handed each other here. Ask one to split a job up and it posts the parts.' }),
      body);

    async function load() {
      if (!box.isConnected && box.dataset.loaded) { live.delete(load); return; }
      const v = await api.taskBoardView(root).catch(() => null);
      box.dataset.loaded = '1';
      const tasks = v?.tasks || [];
      box.hidden = !tasks.length;
      // The page's jump link to this card, which has nothing to jump to while it's empty.
      const jump = /** @type {HTMLElement | null} */ (document.querySelector('[data-keep="jump:board"]'));
      if (jump) jump.hidden = !tasks.length;
      if (!tasks.length) return;
      const all = expanded.has(root);
      const shown = all ? tasks : tasks.slice(0, SHOWN);
      body.replaceChildren(
        h('ul', { class: 'pj-h-list' }, shown.map(t => row(t, load))),
        tasks.length > SHOWN && h('button', {
          type: 'button', class: 'link-btn', text: all ? 'Show fewer' : `Show all ${tasks.length}`,
          onclick: () => { if (all) expanded.delete(root); else expanded.add(root); load(); },
        }));
    }
    live.add(load);
    load();
    return box;
  }

  api.onTaskBoardChanged?.(() => { for (const load of [...live]) load(); });

  SB.taskBoard = { card };
})();
