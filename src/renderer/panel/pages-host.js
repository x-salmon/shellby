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
   - A draft: Draft, Save to my pages and Keep changing it.
   - It came from another PC (sync/pages.js): the access sheet with where it
     came from on top and its miniature behind glass, Turn it on / Not on this
     PC. A new version from another PC waits in a card while yours runs.
   - It doesn't fit the budget your pages share: a card with the bar.
   - Data arrived from another PC, or an agent wrote: a strip under the header. */
'use strict';
(function () {
  const { h, api } = SB;

  const btn = (text, onclick, cls = 'btn slim-btn') => h('button', { type: 'button', class: cls, text, onclick });
  const card = (tone, ...kids) => h('div', { class: `pg-card ${tone}`, role: tone === 'bad' ? 'alert' : 'status' }, ...kids);
  const STRIP_MS = 6000;
  const mb = n => `${(n / 1024 / 1024).toFixed(1)} MB`;
  const kb = n => (n >= 1024 * 1024 ? mb(n) : `${Math.max(1, Math.round(n / 1024))} KB`);
  const whoLine = w => (!w ? '' : w.kind === 'you' ? 'You' : w.kind === 'page' ? 'The page' : w.name || (w.kind === 'pc' ? 'Another PC' : 'Someone'));

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
    const strip = h('div', { class: 'pg-arrived', role: 'status', hidden: true });
    const cards = h('div', { class: 'pg-cards' });
    const stage = h('div', { class: 'pg-stage' });
    const el = h('section', { class: opts.pane ? 'pg-host pane' : 'pg-host', 'aria-label': 'Page' }, head, strip, cards, stage);
    let stripTimer = 0;

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
      if (pageId !== id()) {
        shown.clear(); ask = null; broken = null; refused = null; pointed = null; setPoint(false); hideStrip();
        if (!/^draft-/.test(pageId)) api.pages.opened?.(pageId).catch(() => {}); // pages travel in the order last opened
      }
      const was = view?.id === pageId ? view.version : null;
      view = await api.pages.view(pageId).catch(() => null);
      if (was !== null && view && view.version !== was) { broken = null; late = false; } // a new version starts clean
      draw();
    }

    // A page from another PC you haven't looked at here, or a new version of one waiting.
    const arrivedNew = () => view?.arrived && !view.arrived.quiet && view.arrived.kind === 'new';
    const arrivedChanged = () => view?.arrived && !view.arrived.quiet && view.arrived.kind === 'changed' && view.pendingVersion;
    const fromName = () => view?.arrived?.from?.name || view?.pendingVersion?.from?.name || 'another PC';

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
      chip.hidden = !(view.draft || !view.enabled || view.wants || arrivedChanged());
      chip.textContent = view.draft ? 'Draft' : view.wants ? 'Wants to be added' : arrivedNew() ? `From ${fromName()}` : arrivedChanged() ? `New version from ${fromName()}` : 'Off';
      chip.className = `chip pg-chip ${view.draft || view.arrived && !view.arrived.quiet ? 'amber' : ''}`;
      changeBtn.hidden = !!view.draft;
      pointBtn.hidden = !view.servable;
      drawCards();
      if (view.servable && !(view.pending?.length && !view.agreed)) mountFrame();
      else { frame?.close(); frame = null; frameFor = null; stage.replaceChildren(gate()); }
    }

    /** The strip under the header: what just arrived, from where, for a few seconds. */
    function showStrip(change) {
      const w = change?.who;
      if (!w || w.kind === 'you' || w.kind === 'page') return;
      const text = w.kind === 'pc' ? `${change.text || 'Data'} from ${w.name || 'another PC'}` : `${w.name || 'An agent'}: ${change.text || 'wrote'}`;
      strip.replaceChildren(h('span', { class: 'pg-live', 'aria-hidden': 'true' }), h('span', { class: 'pg-arrived-text', text }), h('span', { class: 'pg-arrived-when', text: 'just now' }));
      strip.hidden = false;
      clearTimeout(stripTimer);
      stripTimer = setTimeout(hideStrip, STRIP_MS);
    }
    function hideStrip() { clearTimeout(stripTimer); strip.hidden = true; }

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
        onData: change => { dot.classList.remove('pulse'); void dot.offsetWidth; dot.classList.add('pulse'); showStrip(change); snapSoon(3000); },
      });
      stage.replaceChildren(frame.el);
    }

    // What shows instead of the page while it can't run yet.
    function gate() {
      if (arrivedNew()) return arrivalSheet();
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

    /**
     * A page, or a version of one, that came from another PC: the access sheet
     * with where it came from on top, and its miniature behind glass (a picture
     * from there, not the code: nothing runs until Turn it on).
     */
    function arrivalSheet() {
      const pend = arrivedChanged() ? view.pendingVersion : null;
      const shownVersion = pend ? pend.n : view.version;
      const facts = pend || view.facts || {};
      const made = pend ? { who: pend.who, why: pend.why } : view.facts?.version || {};
      const thumb = pend ? pend.thumb : view.thumb;
      const words = pend ? (pend.growth.length ? pend.growth : []) : view.words;
      const when = view.arrived?.at ? SB.relTime(view.arrived.at) : '';
      const maker = made.who ? `${whoLine(made.who)} ${pend ? 'changed' : 'made'} it there${made.why ? `: "${made.why}"` : '.'}` : '';
      return h('div', { class: 'pg-gate pg-access pg-arrival', role: 'dialog', 'aria-label': `${view.name}, from ${fromName()}` },
        h('h3', { text: pend ? `A new version of ${view.name} from ${fromName()}` : `${view.name} came from ${fromName()}` }),
        thumb ? h('div', { class: 'pg-glass' }, h('img', { src: thumb, alt: '' }), h('span', { class: 'chip amber', text: pend ? 'Waiting: a preview, not running' : 'Off: a preview, not running' })) : null,
        h('dl', { class: 'pg-facts' },
          h('dt', { text: 'What it is' }), h('dd', { text: (pend ? pend.description : view.description) || 'No description.' }),
          h('dt', { text: 'From' }), h('dd', { text: `${fromName()}${when ? `, ${when}` : ''}. ${maker}`.trim() }),
          h('dt', { text: 'Files' }), h('dd', { text: `${facts.files || 0} ${facts.files === 1 ? 'file' : 'files'}, ${kb(facts.bytes || 0)}, checked like a new page.` })),
        h('p', { class: 'muted small', text: pend ? (words.length ? 'Beyond what you let it do here, it asks for' : 'It asks for nothing more than you already let it do.') : 'It asks for' }),
        words.length || !pend ? accessList(words) : null,
        pend ? h('p', { class: 'muted small', text: `Your version (${view.version}) keeps running until you turn this one on. Either way, this one is in History.` }) : null,
        h('div', { class: 'row wrap pg-arrival-acts' }, btn('Not on this PC', () => decline(), 'btn ghost slim-btn'), btn('Turn it on', () => turnOn(shownVersion), 'btn allow slim-btn')));
    }

    /** Too big for the budget your pages share: it stays on this PC, and the bar says why. */
    function budgetCard() {
      const s = view.sync;
      const left = Math.max(0, s.budget - s.others);
      const pct = n => `${Math.min(100, Math.round(n / s.budget * 100))}%`;
      return card('warn pg-budget-card',
        h('div', { class: 'pg-card-text' },
          h('b', { text: 'Too big to go to your other PCs' }),
          h('span', { text: `Your pages share ${mb(s.budget)} between them. This one comes to ${mb(s.bytes)}, and ${mb(left)} is left. It stays on this PC; every other page still goes.` }),
          h('div', { class: 'pg-budget' },
            h('div', { class: 'pg-budget-bar' }, h('i', { class: 'used', style: `width:${pct(s.others)}` }), h('i', { class: 'this', style: `width:${pct(Math.min(s.bytes, left))}` })),
            h('div', { class: 'pg-budget-legend' }, h('span', {}, h('i', { class: 'used' }), `Other pages, ${mb(s.others)}`), h('span', {}, h('i', { class: 'this' }), `This one, ${mb(s.bytes)}`), h('span', { class: 'end', text: mb(s.budget) })))),
        btn('Show its data', () => SB.showPageDrawer?.('data'), 'btn slim-btn'),
        btn('Change with Claude', () => api.pages.change(view.id, { ask: 'Make this page smaller so it fits the 2 MB its pages share on the sync: keep what matters and drop or trim the heavy parts.' }).then(fail), 'btn primary slim-btn'));
    }

    function drawCards() {
      if (!view) return;
      const out = [];
      if (view.draft) {
        out.push(card('draft', h('span', { text: "A draft: it isn't on your shelf, your phone or your other PCs yet, and agents can't write to it." }),
          btn('Save to my pages', () => save(), 'btn primary slim-btn')));
      }
      if (arrivedChanged()) out.push(h('div', { class: 'pg-card more' }, arrivalSheet()));
      if (view.agreed && view.pending?.length && view.enabled && !arrivedChanged()) out.push(h('div', { class: 'pg-card more' }, accessSheet(false)));
      if (view.sync?.on && view.sync.where === 'everywhere' && view.sync.fits === false) out.push(budgetCard());
      if (broken) {
        out.push(card('bad',
          h('div', { class: 'pg-card-text' }, h('b', { text: 'This page broke' }), h('code', { text: broken })),
          view.draft ? null : btn('Fix it with Claude', () => api.pages.change(view.id, { error: broken }).then(fail), 'btn primary slim-btn'),
          !view.draft && view.versions?.length > 1 ? btn('Go back to the last version', () => goBack(), 'btn ghost slim-btn') : null));
      }
      if (ask) {
        const a = ask;
        out.push(card('ask',
          h('div', { class: 'pg-card-text' }, h('b', { text: `${view.name} asks Claude` }), h('q', { text: a.prompt }), h('span', { class: 'muted small', text: `In ${a.mode === 'plan' ? 'Plan' : 'Ask first'} mode` })),
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
    async function turnOn(shownVersion) { fail(await api.pages.turnOn(view.id, shownVersion)); await show(view.id); }
    async function decline() { fail(await api.pages.decline(view.id)); await show(view.id); }
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
      close: () => { clearTimeout(snapTimer); hideStrip(); frame?.close(); frame = null; frameFor = null; el.remove(); },
    };
  }

  SB.pageHost = { create };
})();
