/* Shellby panel — a fresh tab with a summary Shellby writes himself
   (src/main/freshtab.js). While you type into a conversation whose context is
   well filled, main says whether the message reads as a new topic; if so, the
   box above the composer offers a new tab that starts with a summary of this
   one (title, files changed, commits, open to-dos, the last asks), shown for
   editing, with your message after it. Offered once per conversation unless
   you ask from the context chip's menu; never automatic; the old conversation
   stays as it is. Unlike "Start fresh with a summary" (tab-meters.js), Claude
   writes nothing here, so it costs nothing to offer. */
'use strict';
(function () {
  const { h, api, state, $ } = SB;
  const input = $('input');
  const box = $('handoff');
  const DELAY_MS = 450;   // after you stop typing for a moment
  const MIN_CHARS = 15;   // shorter than this is a follow-up, not a topic
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let seq = 0;
  /** @type {{ tabId: string, pct: number | null, saved: number | null, summary: { text: string, tokens: number }, forced: boolean, editing: boolean } | null} */
  let showing = null;

  function hide() {
    seq++; // a lookup still on its way is about an offer that's gone
    showing = null;
    box.hidden = true;
    box.replaceChildren();
  }

  // The offer is about what's in the box of the tab on screen: gone with either.
  // Each keystroke also voids a lookup already on its way: it was about older words.
  function schedule() {
    clearTimeout(timer);
    seq++;
    const tab = SB.activeTab();
    const typed = input.value.trim();
    if (showing && (showing.tabId !== tab?.id || (!typed && !showing.forced))) hide();
    if (!tab || showing || tab.busy || tab.handoffOffered || !tab.saved || !tab.context) return;
    if (typed.length < MIN_CHARS || typed.startsWith('/') || typed.startsWith('!') || SB.isCrabOnly?.()) return;
    timer = setTimeout(() => offer(tab, typed), DELAY_MS);
  }
  input.addEventListener('input', schedule);

  // Main decides: past the mark (freshtab.js HANDOFF_PCT) and a new topic. Once per conversation, unless forced.
  async function offer(tab, typed, { force = false } = {}) {
    const mine = ++seq;
    const r = await api.handoffOffer({ tabId: tab.id, text: typed, force }).catch(() => null);
    // Typed on, switched tabs, or the box no longer says what was looked up: the answer is stale.
    if (mine !== seq || SB.activeTab() !== tab || (!force && input.value.trim() !== typed)) return;
    if (!r?.offer) {
      if (force) SB.toast('That conversation has nothing to sum up yet.');
      return;
    }
    tab.handoffOffered = true;
    showing = { tabId: tab.id, pct: r.pct, saved: r.saved, summary: r.summary, forced: force, editing: force };
    render();
  }

  /** From the context chip's menu: the summary whatever the box says, with the box's text as the ask. */
  SB.offerHandoff = tab => {
    if (!tab?.saved) return SB.toast('That conversation has nothing to sum up yet.');
    if (tab.busy) return SB.toast('Let him finish first.');
    clearTimeout(timer);
    offer(tab, input.value.trim(), { force: true });
  };

  function wordsFor(s) {
    const full = Number.isFinite(s.pct) ? `${s.pct}% full` : 'filling up';
    const saves = Number.isFinite(s.saved) && s.saved > 0 ? ` A fresh tab with his summary saves about ${SB.compact(s.saved)} tokens on every message.` : '';
    return s.forced
      ? `This conversation is ${full}. Shellby's summary of it is below; a fresh tab starts with it, then what's in the box.${saves}`
      : `Looks like a new topic, and this conversation is ${full}.${saves}`;
  }

  function render() {
    const s = showing;
    if (!s) return hide();
    box.hidden = false;
    const editor = h('textarea', {
      class: 'field area handoff-summary', rows: 8, spellcheck: 'false',
      'aria-label': 'The summary the fresh tab starts with. Edit it before you start.',
      oninput: e => { s.summary.text = /** @type {HTMLTextAreaElement} */ (e.target).value; s.summary.tokens = Math.ceil(s.summary.text.length / 4); },
    });
    editor.value = s.summary.text;
    box.replaceChildren(
      h('div', { class: 'handoff-row' },
        SB.icon('M8 2.5v4M8 6.5l3-3M8 6.5l-3-3M3 9.5h10v4H3z', { width: 1.4 }),
        h('span', { class: 'handoff-text', text: wordsFor(s) }),
        h('button', { class: 'queue-x icon-btn', type: 'button', 'aria-label': 'Not now', title: 'Not now', onclick: hide },
          SB.icon('M4.5 4.5l7 7M11.5 4.5l-7 7', { width: 1.5 }))),
      s.editing ? editor : null,
      h('div', { class: 'handoff-actions' },
        h('button', { class: 'btn slim-btn primary handoff-start', type: 'button', onclick: start }, 'Start a fresh tab'),
        h('button', { class: 'btn ghost slim-btn handoff-edit', type: 'button', 'aria-expanded': String(s.editing), onclick: () => { s.editing = !s.editing; render(); } }, s.editing ? 'Hide the summary' : 'Edit the summary'),
        h('span', { class: 'handoff-hint', text: `Summary: ${SB.compact(s.summary.tokens)} tokens` })));
    if (s.editing) requestAnimationFrame(() => { if (document.activeElement === document.body) editor.focus(); });
  }

  // The new tab opens in this one's folder and gets the summary and your message as its first turn.
  let starting = false; // a second click while main opens it would start two
  async function start() {
    const s = showing;
    const tab = s ? state.tabs.get(s.tabId) : null;
    if (!s || !tab) return hide();
    if (starting) return;
    starting = true;
    const typed = input.value.trim();
    const attachments = [...tab.attachments];
    let r;
    try { r = await api.handoffStart({ tabId: tab.id, summary: s.summary.text, text: typed, attachments }).catch(() => null); } finally { starting = false; }
    if (!r?.ok) return SB.toast(r?.error || "Couldn't start a fresh tab.");
    SB.clearComposer(tab);
    hide();
    const fresh = SB.ensureTab({ id: r.tabId, title: r.title, named: true, cwd: tab.cwd });
    SB.activate(r.tabId);
    SB.markSent(fresh, r.text, attachments, r.turnId);
    SB.toast('Started a fresh tab with the summary. The old conversation stays as it was.', { ms: 5000 });
  }
})();
