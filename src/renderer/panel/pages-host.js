/* Shellby panel — one page on screen: its slim header, the cards that sit
   under it, and its frame (pages-bridge.js). The Pages screen shows it full
   size (pages.js) and a pane beside a chat shows it too (tool-tabs.js), so
   both get the same header and the same cards:

   - First run, or a version that asks for more: the access sheet, in plain
     words, with Let it and Not now. Let it names the version it showed.
   - Off, or from a routine or a terminal and not added yet: what it is, with
     Turn it on / Add page.
   - It asked Claude for something (shellby.ask): a card with the prompt, and
     Ask Claude. Never started without you.
   - It tried something it wasn't given: one line, once, with Let it for a
     web host.
   - It broke (an error, or no "ready" in 5 seconds): the error, Fix it with
     Claude, and Go back to the last version.
   - A draft: Draft, Save to my pages and Keep changing it. */
'use strict';
(function () {
  const { h, api } = SB;

  const btn = (text, onclick, cls = 'btn slim-btn') => h('button', { type: 'button', class: cls, text, onclick });
  const card = (tone, ...kids) => h('div', { class: `pg-card ${tone}`, role: tone === 'bad' ? 'alert' : 'status' }, ...kids);

  /**
   * opts: { pane: boolean, onBack(), onMenu(anchor, view), onSaved(id) }
   * -> { el, show(id), refresh(), id(), close() }
   */
  function create(opts = {}) {
    const name = h('span', { class: 'pg-name' });
    const icon = h('span', { class: 'pg-icon', 'aria-hidden': 'true' });
    const dot = h('span', { class: 'pg-live', title: 'Live: agents and the page write here', hidden: true });
    const chip = h('span', { class: 'chip pg-chip', hidden: true });
    const pointBtn = h('button', { type: 'button', class: 'btn ghost slim-btn pg-point', 'aria-pressed': 'false', text: 'Point at it', title: 'Click part of the page to name it when you change it' });
    const changeBtn = btn('Change with Claude', () => change(pointed), 'btn slim-btn');
    const moreBtn = h('button', { type: 'button', class: 'icon-btn pg-more', 'aria-label': 'More', 'aria-haspopup': 'menu', title: 'More' }, SB.icon('M3.5 8h.01M8 8h.01M12.5 8h.01', { width: 2.4 }));
    const back = opts.pane ? null : h('button', { type: 'button', class: 'back-btn', 'aria-label': 'Back to Pages', text: '‹ Pages', onclick: () => opts.onBack?.() });
    const head = h('div', { class: 'pg-head' }, back, icon, name, dot, chip, h('span', { class: 'pg-grow' }), pointBtn, changeBtn, moreBtn);
    const cards = h('div', { class: 'pg-cards' });
    const stage = h('div', { class: 'pg-stage' });
    const el = h('section', { class: opts.pane ? 'pg-host pane' : 'pg-host', 'aria-label': 'Page' }, head, cards, stage);

    /** @type {any} */
    let view = null;      // main's pages:view for the page on show
    /** @type {any} */
    let frame = null;     // SB.pageFrames handle
    /** @type {string | null} */
    let frameFor = null;  // which id the frame shows
    let pointing = false;
    /** @type {any} */
    let pointed = null;   // what you last pointed at
    const shown = new Set(); // refusals already shown, "kind:what"
    /** @type {any} */
    let ask = null;       // a pending shellby.ask
    /** @type {string | null} */
    let broken = null;    // the error, while it's broken
    /** @type {any} */
    let refused = null;   // the refusal on show

    const id = () => view?.id || null;

    let snapTimer = 0;
    // The shelf's miniature: a while after it loads, and after its data settles, while it's on screen.
    const snapSoon = ms => { clearTimeout(snapTimer); snapTimer = setTimeout(() => { if (!opts.pane && el.offsetParent !== null) snapshot(); }, ms); };
    let late = false;     // broken only because "ready" was late: ready clears it
    async function show(pageId) {
      if (pageId !== id()) { shown.clear(); ask = null; broken = null; refused = null; pointed = null; setPoint(false); }
      const was = view?.id === pageId ? view.version : null;
      view = await api.pages.view(pageId).catch(() => null);
      if (was !== null && view && view.version !== was) { broken = null; late = false; } // a new version starts clean
      draw();
    }

    function draw() {
      if (!view) {
        frame?.close(); frame = null; frameFor = null;
        name.textContent = 'This page is gone';
        cards.replaceChildren();
        stage.replaceChildren(h('p', { class: 'muted pg-gone', text: 'It was deleted, or turned into a page with another name.' }));
        return;
      }
      icon.textContent = view.icon || '▦';
      name.textContent = view.name;
      chip.hidden = !(view.draft || !view.enabled || view.wants);
      chip.textContent = view.draft ? 'Draft' : view.wants ? 'Wants to be added' : 'Off';
      chip.className = `chip pg-chip ${view.draft ? 'amber' : ''}`;
      changeBtn.hidden = !!view.draft;
      pointBtn.hidden = !view.servable;
      drawCards();
      if (view.servable && !(view.pending?.length && !view.agreed)) mountFrame();
      else { frame?.close(); frame = null; frameFor = null; stage.replaceChildren(gate()); }
    }

    function mountFrame() {
      if (frame && frameFor === view.id) {
        if (!frame.el.isConnected) stage.replaceChildren(frame.el);
        frame.touch();
        return;
      }
      frame?.close();
      frameFor = view.id;
      frame = SB.pageFrames.open(view.id, view.url, {
        onReady: () => {
          snapSoon(1500);
          if (broken && late) { broken = null; late = false; drawCards(); }
          if (!broken && view && !view.draft && view.broken) api.pages.broken(view.id, null);
        },
        onBroken: (message, { timeout = false } = {}) => {
          if (broken && !late) return; // the first error is the one worth fixing
          broken = message;
          late = timeout;
          drawCards();
          if (view && !view.draft) api.pages.broken(view.id, message);
        },
        // Only while you've turned Point at it on, and it only fills a card: a page can't start anything.
        onPointed: p => { if (!pointing) return; pointed = p; setPoint(false); drawCards(); },
        onRefused: r => {
          const key = `${r.refused?.kind}:${r.refused?.what || ''}`;
          if (shown.has(key)) return;
          shown.add(key);
          refused = r;
          drawCards();
        },
        onAsk: a => { ask = a; drawCards(); },
        onData: () => { dot.classList.remove('pulse'); void dot.offsetWidth; dot.classList.add('pulse'); snapSoon(3000); },
      });
      stage.replaceChildren(frame.el);
    }

    // What shows instead of the page while it can't run yet.
    function gate() {
      if (view.wants === 'add') {
        return h('div', { class: 'pg-gate' },
          h('h3', { text: `${view.name} wants to be added` }),
          h('p', { text: `${view.from === 'routine' ? 'A routine' : 'A conversation outside Shellby'} made it. It hasn't run yet, and agents can't write to it until you add it.` }),
          view.description ? h('p', { class: 'muted', text: view.description }) : null,
          accessList(view.words),
          h('div', { class: 'row wrap' }, btn('Add page', () => addPage(), 'btn primary slim-btn'), btn('Delete it', () => remove(), 'btn ghost slim-btn')));
      }
      if (!view.enabled) {
        return h('div', { class: 'pg-gate' },
          h('h3', { text: `${view.name} is off` }),
          h('p', { class: 'muted', text: "It doesn't run, and agents can't write to it." }),
          btn('Turn it on', () => set({ enabled: true }), 'btn primary slim-btn'));
      }
      return accessSheet(true);
    }

    function accessList(words) {
      if (!words?.length) return h('p', { class: 'muted', text: 'It asks for nothing beyond its own data.' });
      return h('ul', { class: 'pg-rights' }, ...words.map(w => h('li', { class: `pg-right ${w.kind}` }, w.text)));
    }

    // The access sheet: first run shows everything it asks for; a newer version shows what's new.
    function accessSheet(first) {
      const list = first ? view.words : view.pending;
      return h('div', { class: 'pg-gate pg-access', role: 'dialog', 'aria-label': `What ${view.name} can do` },
        h('h3', { text: first ? `Before ${view.name} runs` : `${view.name} asks for more` }),
        h('p', { text: first ? 'It can always keep its own data. It also asks to:' : `Version ${view.version} asks to:` }),
        accessList(list),
        h('p', { class: 'muted small', text: 'You can take any of it back in Settings › Pages.' }),
        h('div', { class: 'row wrap' }, btn('Let it', () => agree(), 'btn allow slim-btn'), btn('Not now', () => opts.onBack ? opts.onBack() : null, 'btn ghost slim-btn')));
    }

    function drawCards() {
      if (!view) return;
      const out = [];
      if (view.draft) {
        out.push(card('draft', h('span', { text: "A draft: it isn't on your shelf, your phone or your other PCs yet, and agents can't write to it." }),
          btn('Save to my pages', () => save(), 'btn primary slim-btn')));
      }
      if (view.agreed && view.pending?.length && view.enabled) out.push(h('div', { class: 'pg-card more' }, accessSheet(false)));
      if (broken) {
        out.push(card('bad',
          h('div', { class: 'pg-card-text' }, h('b', { text: 'This page broke' }), h('code', { text: broken })),
          view.draft ? null : btn('Fix it with Claude', () => api.pages.change(view.id, { error: broken }).then(fail), 'btn primary slim-btn'),
          !view.draft && view.versions?.length > 1 ? btn('Go back to the last version', () => goBack(), 'btn ghost slim-btn') : null));
      }
      if (ask) {
        const a = ask;
        out.push(card('ask',
          h('div', { class: 'pg-card-text' }, h('b', { text: `${view.name} asks Claude` }), h('q', { text: a.prompt }), h('span', { class: 'muted small', text: `In ${a.mode === 'plan' ? 'Plan' : a.mode === 'edits' ? 'Edit files' : 'Ask first'} mode` })),
          btn('Ask Claude', () => { ask = null; drawCards(); api.pages.ask(view.id, a.prompt, a.mode).then(fail); }, 'btn primary slim-btn'),
          btn('Not now', () => { ask = null; drawCards(); }, 'btn ghost slim-btn')));
      }
      if (pointed && !view.draft) {
        const p = pointed;
        out.push(card('ask',
          h('div', { class: 'pg-card-text' }, h('b', { text: 'You pointed at' }), h('q', { text: p.text || p.selector })),
          btn('Change it with Claude', () => change(p), 'btn primary slim-btn'),
          btn('Not now', () => { pointed = null; drawCards(); }, 'btn ghost slim-btn')));
      }
      if (refused) {
        const r = refused;
        out.push(card('warn',
          h('span', { class: 'pg-card-text', text: r.error }),
          r.refused?.kind === 'web' && !view.draft ? btn('Let it', () => { api.pages.addHost(view.id, r.refused.what).then(fail); refused = null; drawCards(); }, 'btn slim-btn') : null,
          btn('OK', () => { refused = null; drawCards(); }, 'btn ghost slim-btn')));
      }
      cards.replaceChildren(...out);
    }

    const fail = r => { if (r?.ok === false && r.error) SB.toast(r.error); return r; };
    async function set(patch) { fail(await api.pages.set(view.id, patch)); await show(view.id); }
    async function agree() { fail(await api.pages.agree(view.id, view.version)); await show(view.id); }
    async function addPage() { fail(await api.pages.set(view.id, { enabled: true })); await show(view.id); }
    async function goBack() {
      const prev = view.versions?.[1];
      if (!prev) return;
      broken = null;
      fail(await api.pages.revert(view.id, prev.n));
      await show(view.id);
    }
    async function remove() {
      const r = fail(await api.pages.remove(view.id));
      if (r?.ok !== false) opts.onBack?.();
    }
    async function save() {
      const r = fail(await api.pages.save(view.id));
      if (r?.ok === false) return;
      SB.toast(`${view.name} is on your shelf.`);
      opts.onSaved?.(r.id);
      await show(r.id);
    }

    function setPoint(on) {
      pointing = on;
      pointBtn.setAttribute('aria-pressed', String(on));
      pointBtn.textContent = on ? 'Use it' : 'Point at it';
      frame?.point(on);
    }
    pointBtn.addEventListener('click', () => setPoint(!pointing));

    /** Change with Claude: only ever from your click (the header's button, or the pointed-at card). */
    function change(p = null) {
      if (!view || view.draft) return;
      api.pages.change(view.id, p ? { pointed: p } : {}).then(fail);
      pointed = null;
      drawCards();
    }

    /** Keep a miniature of the page as it looks now, for its tile on the shelf. */
    function snapshot() {
      if (!view || view.draft || broken || !frame?.el.isConnected) return Promise.resolve();
      // The top-left of the page, at about the tile's shape, so a wide screen's page stays readable small.
      const r = frame.el.getBoundingClientRect();
      const width = Math.min(r.width, 520);
      const height = Math.min(r.height, Math.round(width / 2.5));
      return api.pages.thumb(view.id, { x: r.x, y: r.y, width, height }).catch(() => {});
    }

    moreBtn.addEventListener('click', () => { if (view) opts.onMenu?.(moreBtn, view); });

    return {
      el, show, id,
      refresh: () => (view ? show(view.id) : null),
      reload: () => frame?.reload(),
      snapshot,
      close: () => { clearTimeout(snapTimer); frame?.close(); frame = null; frameFor = null; el.remove(); },
    };
  }

  SB.pageHost = { create };
})();
