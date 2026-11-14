/* Shellby on your phone — Pages (docs/plans/shellby-pages.md, section 6):

     #/pages        the shelf: every page in the desk's order, pinned first, two
                    across with its miniature; one built for the desk greyed with
                    a chip
     #/page/<id>    one page, full-screen under a 40px header, in a sandboxed
                    iframe the PC serves at /pages/<cap>/ (the cap comes from
                    page-open, asked for with this phone's token); Change with
                    Claude, its data and History in the ⋯ menu; a desk-only
                    page's own screen; and, while the PC is asleep, the last
                    snapshot (the service worker's cache), dimmed and read-only

   The bridge: the page posts to this window as it does to the desk's panel
   (pages/page-side/shellby.js). A message is the page's because it came from
   its frame (event.source), never because of what it says; over 256 KB it's
   dropped; every call goes to the PC (page-call), which decides (pages/rights.js).
   A page's ask comes back as the phone's own sheet: the prompt in full, Ask
   first or Plan only, and it counts as a phone task. The page never starts
   anything by itself. pocket.js hands in what it shares with the other screens. */
'use strict';
(function (root) {
  root.PocketPages = ({ S, L, D, N, h, icon, live, go, toast, buzz, act, actButton, topbar, offlineBanner, dock, openSheet, canAct, lookOnly, refresh }) => {
    const MAX_MESSAGE = 256 * 1024;
    const MAX_IN_FLIGHT = 4;      // a page's calls waiting on the PC at once; more are refused here
    const ASK_ARM_MS = 700;       // the sheet's Ask Claude wakes after this
    const READY_MS = 5000;
    const SNAPS = 'shellby-pocket-pages'; // the service worker's cache: the shelf and each page's last look (sw.js keeps it)
    const SHELF_KEY = '/__pages';
    const SNAP_TEXT = 20000;
    const MODE_NAME = { ask: 'Ask first', plan: 'Plan only' };
    const THEME_VARS = { bg: '--ink', panel: '--reef', text: '--sand', muted: '--sand-dim', accent: '--coral', good: '--glass', warn: '--amber', line: '--line', font: '--font-body', mono: '--font-mono', pixel: '--font-pixel' };
    const DESK_ONLY = "Claude built this one for a wide screen, so it doesn't open here yet. Ask him to make it fit a phone and it opens here next time.";

    // S.pages: { on, pages, at } the shelf as the PC last gave it (or the cache did).
    let shelfAsked = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let shelfTimer;
    /** @type {any} the one open page: { id, frame, page, ready, timer, values, mode, setNote, pulse, reopen } */
    let current = null;

    // ---------------------------------------------------------------- what the service worker keeps

    async function keep(key, value) {
      try { const c = await root.caches.open(SNAPS); await c.put(key, new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })); } catch { /* no room, or no cache here */ }
    }
    async function kept(key) {
      try { const c = await root.caches.open(SNAPS); const r = await c.match(key); return r ? await r.json() : null; } catch { return null; }
    }
    const snapKey = id => `/__page/${encodeURIComponent(id)}`;
    function dataText(values) {
      let text;
      try { text = JSON.stringify(values ?? {}, null, 1); } catch { text = ''; }
      return text.length > SNAP_TEXT ? `${text.slice(0, SNAP_TEXT)}\n…` : text;
    }
    // A snapshot is a picture and the data as text, never the page's code: nothing runs from it.
    const saveSnap = (page, values) => keep(snapKey(page.id), { id: page.id, name: page.name, thumb: page.thumb || null, text: dataText(values), at: Date.now() });

    // ---------------------------------------------------------------- the shelf

    async function loadShelf() {
      shelfAsked = true;
      if (!live()) { if (!S.pages) { const c = await kept(SHELF_KEY); if (c && !S.pages) { S.pages = c; refresh(); } } return; }
      const r = await N.post('pages');
      if (!r.ok) return;
      S.pages = { on: r.on, pages: r.pages || [], at: Date.now() };
      keep(SHELF_KEY, S.pages);
      refresh();
    }
    const shelfSoon = () => { clearTimeout(shelfTimer); shelfTimer = setTimeout(loadShelf, 300); };
    const shelfIf = () => { if (!shelfAsked) loadShelf(); };
    const pageOf = id => S.pages?.pages?.find(p => p.id === id) || null;

    function chipFor(p) {
      if (!p.phone) return 'Built for the desk';
      if (p.atDesk) return 'At the desk for now';
      if (!p.enabled) return 'Off';
      if (p.wants === 'add') return 'Wants to be added';
      if (p.needsOk) return 'Needs your OK';
      if (!p.ready) return 'Not yet';
      return null;
    }

    /** One tile: the miniature, the pin, a chip when it can't open here, its name and what changed last. */
    function tile(p, { small = false } = {}) {
      const chip = chipFor(p);
      const mini = h('span', { class: 'pg-mini' }, p.thumb ? h('img', { src: p.thumb, alt: '' }) : h('span', { class: 'pg-mini-blank', text: p.icon || p.name.slice(0, 1) }));
      const last = p.lastChange ? `${p.lastChange.text}${p.lastChange.at ? `, ${L.ago(p.lastChange.at)}` : ''}` : (p.description || '');
      return h('button', {
        type: 'button', class: `pg-tile${chip ? ' off' : ''}`, 'aria-label': `${p.name}${chip ? `, ${chip.toLowerCase()}` : ''}`, dataset: { id: p.id },
        onclick: () => go(`#/page/${encodeURIComponent(p.id)}`),
      },
      mini,
      p.pinned && !small ? h('span', { class: 'pg-pin', 'aria-label': 'Pinned', text: '📌' }) : null,
      chip ? h('span', { class: 'pg-over' }, h('span', { class: 'pg-chip', text: chip })) : null,
      h('span', { class: 'pg-meta' },
        h('b', {}, p.ready && live() ? h('i', { class: 'pg-dot live', 'aria-hidden': 'true' }) : null, h('span', { text: p.name })),
        last ? h('span', { text: last }) : null));
    }

    function pagesScreen() {
      const scroll = h('div', { class: 'scroll' });
      const el = h('div', { class: 'screen' }, topbar({ title: 'Pages' }), h('div', { class: 'offline-slot' }), scroll, dock('pages'));
      /** @type {string | null} */
      let drawn = null;
      function update() {
        el.replaceChild(topbar({ title: 'Pages' }), el.firstChild);
        el.querySelector('.offline-slot').replaceChildren(offlineBanner() || '');
        const sh = S.pages;
        const now = JSON.stringify([live(), sh?.at, sh?.pages?.map(p => [p.id, p.updatedAt, p.pinned, p.enabled, p.ready, !!p.thumb])]);
        if (drawn === now) return;
        drawn = now;
        if (!sh) { scroll.replaceChildren(h('div', { class: 'loading' }, D.crab({ px: 3, state: 'working' }), h('p', { text: live() ? 'Fetching your pages…' : 'Nothing kept of your pages yet.' }))); return; }
        const parts = [];
        if (!live() && sh.at) parts.push(h('p', { class: 'pg-stale' }, icon('clock'), h('span', { text: `The shelf as it was at ${L.clock(sh.at)}.` })));
        if (!sh.on) parts.push(h('div', { class: 'empty' }, h('p', { text: 'Pages are off on your PC. Turn them on in Settings › Claude › Pages.' })));
        else if (!sh.pages.length) parts.push(h('div', { class: 'empty' }, h('p', { text: 'No pages yet. Describe one on your PC (the Pages screen, Ctrl+9) and Claude builds it; the ones marked for a phone open here.' })));
        else parts.push(h('div', { class: 'pg-shelf' }, ...sh.pages.map(p => tile(p))));
        scroll.replaceChildren(...parts);
      }
      update();
      loadShelf();
      return { el, update, title: 'Pages' };
    }

    /** The beach's row of pinned pages: after what's waiting on you, before what's ready to review. */
    function pinnedRow() {
      shelfIf();
      const pinned = (S.pages?.pages || []).filter(p => p.pinned).slice(0, 3);
      if (!pinned.length) return [];
      return [
        h('h3', { class: 'sect pg-sect' }, h('span', { text: 'Pinned pages' }), h('a', { href: '#/pages', class: 'pg-all', text: 'All pages' })),
        h('div', { class: 'pg-strip' }, ...pinned.map(p => tile(p, { small: true }))),
      ];
    }

    // ---------------------------------------------------------------- one page, running

    const send = msg => { try { current?.frame?.contentWindow?.postMessage({ shellby: 1, ...msg }, '*'); } catch { /* gone */ } };
    function theme() {
      const cs = getComputedStyle(document.documentElement);
      return Object.fromEntries(Object.entries(THEME_VARS).map(([k, v]) => [k, cs.getPropertyValue(v).trim()]));
    }

    // The bridge: only the open page's frame is heard, and only by which window sent it.
    root.addEventListener('message', async e => {
      const c = current;
      if (!c?.frame?.contentWindow || e.source !== c.frame.contentWindow || e.origin !== 'null') return;
      const m = e.data;
      if (!m || typeof m !== 'object' || m.shellby !== 1) return;
      let size;
      try { size = JSON.stringify(m).length; } catch { return; }
      if (size > MAX_MESSAGE) { if (m.type === 'call') send({ type: 'answer', id: m.id, ok: false, error: 'A call can carry at most 256 KB.' }); return; }
      switch (m.type) {
        case 'call': {
          if ((c.inFlight || 0) >= MAX_IN_FLIGHT) { send({ type: 'answer', id: m.id, ok: false, error: 'Too many calls at once. Wait for one to answer.' }); return; }
          const args = Array.isArray(m.args) ? m.args.slice(0, 10) : [];
          c.inFlight = (c.inFlight || 0) + 1;
          let r;
          try { r = await N.post('page-call', { id: c.id, method: String(m.method || '').slice(0, 20), args }); } finally { c.inFlight -= 1; }
          if (current !== c) return;
          send({ type: 'answer', id: m.id, ok: !!r.ok, value: r.value, error: r.ok ? undefined : (r.error || (r.offline ? "Your PC isn't answering right now." : 'Refused.')) });
          // Never over a sheet you have open, and one ask at a time: a page can't swap what you're reading.
          if (r.ok && r.ask && !S.sheet) openSheet(askSheet(c, r.ask));
          break;
        }
        case 'ready': c.ready = true; clearTimeout(c.timer); c.setNote(null); break;
        case 'error': c.setNote(`The page hit an error: ${String(m.message || 'An error').slice(0, 200)}. Fix it with Claude at the desk.`); break;
        default: break;
      }
    });

    /** What the PC says changed on this page (the stream's page events): data into the frame, new files reload it. */
    function onPageEvent(ev) {
      const c = current;
      if (!c || !ev || ev.id !== c.id) return;
      if (ev.kind === 'data' && ev.change) {
        send({ type: 'change', change: ev.change });
        const next = { ...(c.values || {}) };
        for (const k of ev.change.keys || []) { if (ev.change.values && Object.hasOwn(ev.change.values, k)) next[k] = ev.change.values[k]; else delete next[k]; }
        c.values = next;
        if (c.page) saveSnap(c.page, next);
        c.pulse();
      } else if (ev.kind === 'files') c.reopen();
      else if (ev.kind === 'removed') { toast('That page was deleted on your PC.'); go('#/pages'); }
      else if (ev.kind === 'meta') shelfSoon();
    }
    const onShelfEvent = () => shelfSoon();

    function header(name, { asleep = false, dot = null, menu = null } = {}) {
      return h('header', { class: 'ph' },
        h('button', { type: 'button', class: 'ph-back', 'aria-label': 'Back to Pages', onclick: () => go('#/pages') }, icon('back')),
        h('span', { class: 'ph-name', text: name }),
        dot,
        h('span', { class: 'ph-end' }, asleep ? h('span', { class: 'pill amber', text: `${S.view?.pc || 'Your PC'} is asleep` }) : null, menu));
    }

    function pageScreen(id) {
      const body = h('div', { class: 'pg-body' });
      const el = h('div', { class: 'screen pg-screen' }, header(pageOf(id)?.name || 'Page'), body);
      /** @type {any} */
      const c = { id, frame: null, ready: false, timer: 0, values: null, page: pageOf(id), note: null, mode: null };
      current = c;
      const dot = h('i', { class: 'pg-dot live', 'aria-label': 'Live from your PC' });
      c.pulse = () => { dot.classList.remove('pulse'); void dot.offsetWidth; dot.classList.add('pulse'); };
      const noteBox = h('div', { class: 'pg-note-slot' });
      c.setNote = text => { c.note = text; noteBox.replaceChildren(text ? h('p', { class: 'pg-note' }, icon('warn'), h('span', { text })) : ''); };
      const head = () => el.replaceChild(header(c.page?.name || 'Page', {
        asleep: c.mode === 'snap',
        dot: c.mode === 'live' ? dot : null,
        menu: c.mode === 'live' || c.mode === 'desk' ? h('button', { type: 'button', class: 'ph-more', 'aria-label': 'Menu', onclick: () => openSheet(menuSheet(c)) }, icon('more')) : null,
      }), el.firstChild);

      function mount(frameUrl) {
        c.frame?.remove();
        const frame = /** @type {HTMLIFrameElement} */ (h('iframe', {
          class: 'pg-frame', title: c.page?.name || 'Page', sandbox: 'allow-scripts', referrerpolicy: 'no-referrer',
          allow: "camera 'none'; microphone 'none'; geolocation 'none'; usb 'none'; serial 'none'; hid 'none'; clipboard-read 'none'; display-capture 'none'",
        }));
        c.frame = frame;
        c.ready = false;
        clearTimeout(c.timer);
        c.timer = setTimeout(() => { if (!c.ready && current === c) c.setNote("It didn't finish loading within 5 seconds. Pull down to try again, or fix it at the desk."); }, READY_MS);
        frame.addEventListener('load', () => send({ type: 'theme', theme: theme() }));
        frame.src = frameUrl;
        body.replaceChildren(noteBox, h('div', { class: 'pg-stage' }, frame));
      }

      async function openIt() {
        if (!live()) { await snapshot(); return; }
        const r = await N.post('page-open', { id });
        if (current !== c) return;
        if (r.ok) {
          c.page = r.page; c.values = r.values || {}; c.mode = 'live';
          saveSnap(r.page, c.values);
          head();
          mount(r.url);
          return;
        }
        if (r.page) c.page = r.page;
        if (r.desk) { c.mode = 'desk'; head(); body.replaceChildren(deskOnly(c, r.reads ? r.error : null)); return; }
        if (r.offline) { await snapshot(); return; }
        c.mode = 'gone'; head();
        body.replaceChildren(h('div', { class: 'empty pg-gone' }, D.crab({ px: 4, state: 'idle', label: '' }), h('p', { text: r.error || "That page isn't here." }), h('button', { type: 'button', class: 'btn ghost', text: 'Back to Pages', onclick: () => go('#/pages') })));
      }
      c.reopen = () => { if (live()) openIt(); };

      // The PC is asleep: the last snapshot, dimmed, read-only, with when it was taken.
      async function snapshot() {
        const s = await kept(snapKey(id));
        if (current !== c) return;
        c.mode = 'snap';
        if (s?.name) c.page = { ...(c.page || {}), name: s.name };
        head();
        if (!s) { body.replaceChildren(h('div', { class: 'empty pg-gone' }, D.crab({ px: 4, state: 'sleeping', label: '' }), h('p', { text: `Nothing kept of this page yet. It shows once ${S.view?.pc || 'your PC'} answers.` }))); return; }
        body.replaceChildren(
          h('div', { class: 'card warn pg-snap-note' }, h('b', { text: `As it was at ${L.clock(s.at)}.` }), h('p', { text: `You can read it, not change it, until ${S.view?.pc || 'your PC'} wakes up.` })),
          h('div', { class: 'scroll pg-snap' },
            s.thumb ? h('div', { class: 'pg-snap-pic' }, h('img', { src: s.thumb, alt: `${s.name} as it last looked` })) : null,
            s.text ? h('h3', { class: 'sect' }, h('span', { text: 'What it held' })) : null,
            s.text ? h('pre', { class: 'pg-snap-text', text: s.text }) : null));
      }

      let wasLive = live();
      function update() {
        if (live() !== wasLive) { wasLive = live(); openIt(); }
      }
      openIt();
      return { el, update, title: c.page?.name || 'Page', leave: () => { if (current === c) { clearTimeout(c.timer); current = null; } } };
    }

    // ---------------------------------------------------------------- built for the desk

    // reads: why a page made for a phone still opens at the desk (it reads your PC's data); no Change button then.
    function deskOnly(c, reads = null) {
      const p = c.page || { name: 'This page' };
      if (reads) {
        return h('div', { class: 'scroll pg-desk' },
          h('div', { class: 'pg-desk-thumb' }, p.thumb ? h('img', { src: p.thumb, alt: '' }) : h('span', { class: 'pg-mini-blank big', text: p.icon || p.name.slice(0, 1) }), h('span', { class: 'pg-over' }, h('span', { class: 'pg-chip', text: 'At the desk for now' }))),
          h('h3', { class: 'pg-desk-name', text: p.name }),
          h('p', { class: 'muted', text: reads }));
      }
      return h('div', { class: 'scroll pg-desk' },
        h('div', { class: 'pg-desk-thumb' }, p.thumb ? h('img', { src: p.thumb, alt: '' }) : h('span', { class: 'pg-mini-blank big', text: p.icon || p.name.slice(0, 1) }), h('span', { class: 'pg-over' }, h('span', { class: 'pg-chip', text: 'Built for the desk' }))),
        h('h3', { class: 'pg-desk-name', text: p.name }),
        h('p', { class: 'muted', text: DESK_ONLY }),
        canAct() ? changeButton(c, 'go big') : lookOnly(),
        h('p', { class: 'fine left', text: `Starts as a task on ${S.view?.pc || 'your PC'}, in Ask first, like any task from your phone. The page keeps working at the desk meanwhile.` }));
    }

    function changeButton(c, cls = 'go') {
      const key = L.newKey();
      return actButton({
        label: 'Change with Claude', cls,
        run: async () => {
          const r = await act('page-change', { id: c.id, key }, { okText: 'Claws out. He’s on it.', timeoutMs: 60000 });
          if (r.ok && r.tabId) go(`#/tab/${encodeURIComponent(r.tabId)}`);
        },
      });
    }

    // ---------------------------------------------------------------- the menu: Change with Claude, its data, History

    function menuSheet(c) {
      return { label: c.page?.name || 'Page', build: close => {
        const row = (name, label, sub, onclick) => h('button', { type: 'button', class: 'card link-card', onclick },
          h('span', { class: 'card-t' }, h('span', { class: 'card-title' }, icon(name), ` ${label}`), icon('chevron')),
          h('span', { class: 'card-m', text: sub }));
        const change = canAct() ? h('button', { type: 'button', class: 'card link-card', onclick: async () => {
          close();
          const r = await act('page-change', { id: c.id, key: L.newKey() }, { okText: 'Claws out. He’s on it.', timeoutMs: 60000 });
          if (r.ok && r.tabId) go(`#/tab/${encodeURIComponent(r.tabId)}`);
        } },
        h('span', { class: 'card-t' }, h('span', { class: 'card-title' }, icon('send'), ' Change with Claude'), icon('chevron')),
        h('span', { class: 'card-m', text: `A task on ${S.view?.pc || 'your PC'}, in Ask first.` })) : lookOnly();
        return { el: h('div', { class: 'pg-menu' },
          h('h2', { class: 'sheet-title', text: c.page?.name || 'Page' }),
          change,
          row('files', 'Its data', 'Every key, and who wrote it last.', () => { close(); openSheet(infoSheet(c, 'data')); }),
          row('history', 'History', 'Every version, with who made it and why.', () => { close(); openSheet(infoSheet(c, 'history')); })) };
      } };
    }

    function infoSheet(c, which) {
      return { label: which === 'data' ? 'Its data' : 'History', tall: true, build: () => {
        const box = h('div', { class: 'pg-info' }, h('h2', { class: 'sheet-title', text: which === 'data' ? 'Its data' : 'History' }), h('div', { class: 'loading small' }, D.crab({ px: 3, state: 'working' })));
        N.post('page-info', { id: c.id }).then(r => {
          if (!r.ok) { box.replaceChildren(h('h2', { class: 'sheet-title', text: which === 'data' ? 'Its data' : 'History' }), h('p', { class: 'muted', text: r.error || 'Your PC didn’t answer.' })); return; }
          const who = w => (w?.kind === 'you' ? 'you' : w?.kind === 'page' ? 'the page' : w?.name || w?.kind || 'someone');
          const parts = [h('h2', { class: 'sheet-title', text: which === 'data' ? 'Its data' : 'History' })];
          if (which === 'data') {
            const keys = Object.keys(r.values || {});
            if (!keys.length) parts.push(h('p', { class: 'muted', text: 'Nothing in it yet.' }));
            for (const k of keys) {
              let v; try { v = JSON.stringify(r.values[k]); } catch { v = String(r.values[k]); }
              const by = r.by?.[k];
              parts.push(h('div', { class: 'pg-key' }, h('code', { text: k }), h('pre', { class: 'pg-val', text: v.length > 600 ? `${v.slice(0, 600)}…` : v }), by ? h('span', { class: 'muted small', text: `${who(by.who)}${by.at ? `, ${L.ago(by.at)}` : ''}` }) : null));
            }
            parts.push(h('p', { class: 'fine', text: 'To change it by hand, open the page at the desk.' }));
          } else {
            for (const v of r.versions || []) {
              parts.push(h('div', { class: 'card pg-ver' },
                h('div', { class: 'card-t' }, h('span', { class: 'card-title', text: `Version ${v.n}` }), v.current ? h('span', { class: 'pill', text: 'current' }) : null),
                h('div', { class: 'card-m' }, h('span', { text: v.why || '' }), h('span', { class: 'muted', text: `${who(v.who)}${v.at ? `, ${L.ago(v.at)}` : ''}` }))));
            }
            parts.push(h('p', { class: 'fine', text: 'Go back to this one is at the desk.' }));
          }
          box.replaceChildren(...parts);
        });
        return { el: box };
      } };
    }

    // ---------------------------------------------------------------- the ask, as the phone's own sheet

    /** shellby.ask from the page: the prompt in full, Ask first or Plan only, and you press Ask Claude. */
    function askSheet(c, { prompt, mode }) {
      return { label: 'The page wants to ask Claude', build: close => {
        let picked = MODE_NAME[mode] ? mode : 'ask';
        const modes = h('div', { class: 'pg-modes', role: 'radiogroup', 'aria-label': 'Mode' });
        const drawModes = () => modes.replaceChildren(...Object.entries(MODE_NAME).map(([id, name]) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': picked === id ? 'true' : 'false', class: `proj${picked === id ? ' on' : ''}`, text: name,
          onclick: () => { picked = id; drawModes(); },
        })));
        drawModes();
        const key = L.newKey();
        const lim = S.view?.limits;
        const ask = actButton({
          label: 'Ask Claude', cls: 'go big',
          run: async () => {
            const r = await act('page-ask', { id: c.id, prompt, mode: picked, key }, { timeoutMs: 60000 });
            if (!r.ok) return;
            close();
            buzz([6, 30, 6]);
            toast('Claws out. He’s on it.', { tone: 'ok' });
            if (r.tabId) go(`#/tab/${encodeURIComponent(r.tabId)}`);
          },
        });
        // A page knows when its sheet appears, and could time a tap of yours onto Ask Claude:
        // the button wakes only after a moment.
        ask.disabled = true;
        setTimeout(() => { ask.disabled = false; }, ASK_ARM_MS);
        return { el: h('div', { class: 'pg-ask' },
          h('h2', { class: 'sheet-title', text: `${c.page?.name || 'The page'} wants to ask Claude` }),
          h('p', { class: 'muted small pg-who', text: 'The page asked. Nothing has started.' }),
          h('blockquote', { class: 'pg-quote', text: String(prompt || '') }),
          h('p', { class: 'lbl', text: 'Mode' }),
          modes,
          h('p', { class: 'rule' }, icon('shield'), h('span', { text: `Runs as a task on ${S.view?.pc || 'your PC'}, in its own conversation${lim ? `, and counts as one of your ${lim.perHour} an hour` : ''}.` })),
          canAct() ? h('div', { class: 'btns' }, h('button', { type: 'button', class: 'btn big', text: 'Not now', onclick: close }), ask) : lookOnly()) };
      } };
    }

    return { pagesScreen, pageScreen, pinnedRow, onPageEvent, onShelfEvent, loadShelf };
  };
})(window);
