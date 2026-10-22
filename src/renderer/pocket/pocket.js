/* Shellby on your phone — the app. One page, a screen at a time:

     #/              the beach: the crab, what's waiting on you, every conversation
     #/tab/<id>      one conversation, live, with its prompt, its changes and a reply box
     #/prompt/<id>/<r> one permission prompt on its own, from a tap on its notification
     #/diff/<id>/<a> what one of its turns changed, file by file
     #/new           the New task sheet, over the beach (a shortcut on the app icon too)
     #/share         the same, with what another app shared (the service worker keeps it)
     #/queue         what's waiting for the usage reset
     #/phone         this phone: notifications, quiet hours, and forgetting it
     #/more …        focus, routines, notes, the wardrobe and files (pocket-more.js)
     #/find …        search, a project's history, a closed conversation, a whole branch (pocket-find.js)
                     (New task and Look over my changes live in pocket-new.js)
                     (the prompt screen and the quiet hours card live in pocket-phone.js)

   Everything comes from one stream (pocket-stream.js). Each screen is mounted
   once per visit and told when the view changes, so a half-typed reply or the
   scroll position never goes when something arrives. A phone the desk set to
   read-only (view.rights) sees everything and gets no button it can't use. */
'use strict';
(function () {
  const L = window.PocketLogic;
  const D = window.PocketDraw;
  const N = window.PocketNet;
  const { h, icon } = D;

  const VIEW_KEY = 'shellby.pocket.view';
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = L.isIos(navigator.userAgent, navigator.maxTouchPoints);

  const S = {
    view: cached(),
    live: false,
    route: L.route(location.hash),
    feeds: new Map(),        // tabId -> { items, loaded }
    partial: new Map(),      // tabId -> the reply as it's typed
    answering: new Map(),    // requestId -> 'allow' | 'deny' while it's on its way
    outcomes: new Map(),     // tabId -> standing last seen, for the celebration
    celebrate: null,         // { until, title }
    away: null,              // what happened while the phone was away (pocket-find.js), until dismissed
    findQuery: '',
    screen: null,
    sheet: null,
    installSkipped: false,
  };

  function cached() {
    try { return JSON.parse(N.store.get(VIEW_KEY) || 'null'); } catch { return null; }
  }

  const app = document.getElementById('app');
  const toasts = document.getElementById('toasts');
  const sheetRoot = document.getElementById('sheets');
  const announcer = document.getElementById('announce');

  // ---------------------------------------------------------------- little things

  function toast(text, { tone = '', ms = 3200 } = {}) {
    const t = h('div', { class: `toast ${tone}`, role: 'status', text });
    toasts.append(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, ms);
  }

  const buzz = pattern => { try { navigator.vibrate?.(pattern); } catch { /* not here */ } };

  // What a screen reader hears as things change (L.announcements): emptied
  // first, so the same words twice are read twice.
  function announce(lines) {
    if (!announcer || !lines.length) return;
    announcer.textContent = '';
    requestAnimationFrame(() => { announcer.textContent = lines.join(' '); });
  }

  function go(hash) {
    if (location.hash === hash) mount();
    else location.hash = hash;
  }

  const live = () => S.live;
  const tabOf = id => S.view?.tabs?.find(t => t.id === id) || null;
  // Whether this phone may do things, or only look (pocket/rights.js, set at the desk).
  const canAct = () => S.view?.rights !== 'readonly';
  const LOOK_ONLY = 'This phone can only look. What it may do is set on your PC, in Settings → On your phone.';

  /** A button that does something on the PC: it waits for the answer, and can't be pressed twice. */
  function actButton({ label, cls = '', iconName = null, aria = null, run, offlineOk = false }) {
    const b = h('button', { type: 'button', class: `btn ${cls}`.trim(), 'aria-label': aria || null },
      iconName ? icon(iconName) : null, h('span', { class: 'btn-label', text: label }));
    b.addEventListener('click', async e => {
      e.stopPropagation();
      if (b.disabled) return;
      if (!live() && !offlineOk) { toast("Your PC isn't answering right now.", { tone: 'warn' }); return; }
      b.disabled = true;
      b.classList.add('working');
      try { await run(b); } finally { b.disabled = false; b.classList.remove('working'); }
    });
    return b;
  }

  async function act(name, body, { okText = null, failText = null, timeoutMs } = {}) {
    const r = await N.post(name, body, timeoutMs ? { timeoutMs } : undefined);
    if (r.unpaired) { unpaired('This phone was forgotten on your PC.'); return r; }
    if (r.ok) { if (okText) toast(okText, { tone: 'ok' }); buzz(8); } else toast(r.error || failText || 'That didn’t work.', { tone: 'warn', ms: 4800 });
    return r;
  }

  // Questions and plans, usage, sharing a moment, and speaking or snapping a task (pocket-bits.js).
  // What another app shared, and keeping the screen on while you watch, too.
  const { questionSheet, planSheet, usageDetail, shareTurn, voiceButton, photoButton, takeShared, wake } = window.PocketBits({ S, L, D, N, h, icon, toast, buzz, act, actButton });
  // The mode and model pickers, New task and Look over my changes (pocket-new.js).
  const { modePicker, newTaskSheet, lookOverSheet } = window.PocketNew({ S, N, h, icon, go, toast, act, actButton, voiceButton, photoButton });

  /** A line for what a read-only phone can't press. */
  const lookOnly = () => h('p', { class: 'desk-only' }, icon('eye'), h('span', { text: LOOK_ONLY }));

  // ---------------------------------------------------------------- the frame

  function topbar({ back = null, backLabel = 'Beach', title = null, right = null } = {}) {
    const pc = S.view?.pc || 'your PC';
    return h('header', { class: 'top' },
      back
        ? h('button', { type: 'button', class: 'top-back', 'aria-label': 'Back', onclick: () => (history.length > 1 ? history.back() : go(back)) }, icon('back'), h('span', { text: backLabel }))
        : h('div', { class: 'brand' }, D.crab({ px: 1.5, state: S.view?.crab?.state || 'idle', label: '' }), h('span', { text: 'Shellby' })),
      title ? h('h1', { class: 'top-title', text: title }) : h('span', { class: 'top-gap' }),
      right || h('span', { class: `pc ${live() ? 'on' : 'off'}`, role: 'status', 'aria-label': live() ? `Connected to ${pc}` : `Not connected to ${pc}` }, h('i'), h('span', { text: pc })));
  }

  function dock(active) {
    const held = S.view?.held?.length || 0;
    const item = (key, label, iconName, hash, badge = 0) => h('a', {
      href: hash, class: `dock-item${active === key ? ' on' : ''}`, 'aria-current': active === key ? 'page' : null,
    }, h('span', { class: 'dock-pill' }, icon(iconName), badge ? h('b', { class: 'dock-badge', text: badge, 'aria-label': `${badge} waiting` }) : null), h('span', { text: label }));
    return h('nav', { class: 'dock', 'aria-label': 'Screens' },
      item('beach', 'Beach', 'beach', '#/', S.view?.prompts?.length || 0),
      item('queue', 'Queue', 'queue', '#/queue', held),
      item('more', 'More', 'more', '#/more'),
      item('phone', 'Phone', 'phone', '#/phone'));
  }

  function offlineBanner() {
    if (live() || !S.view) return null;
    return h('div', { class: 'offline', role: 'status' },
      h('b', { text: `Can't reach ${S.view.pc || 'your PC'}.` }),
      h('span', { text: S.view.at ? ` This is how things were at ${L.clock(S.view.at)}.` : ' It may be asleep.' }));
  }

  // ---------------------------------------------------------------- prompts

  // after(): what happens once an answer went (the prompt screen goes back to the beach).
  function promptCard(p, { compact = false, inTab = false, after = null } = {}) {
    const sending = S.answering.get(p.requestId);
    const card = h('article', { class: `ask${p.deskOnly ? ' desk' : ''}${sending ? ' sending' : ''}`, 'aria-label': `${p.title}: ${p.ask || p.label}` });
    card.append(h('div', { class: 'ask-head' },
      D.crab({ px: 1.6, state: 'asking', label: '' }),
      h('div', { class: 'ask-what' },
        h('p', { class: 'ask-title', text: p.deskOnly ? 'One for the desk' : p.plan ? 'Here’s my plan' : p.question ? 'I’ve a question' : p.helper ? 'A helper wants to do this' : 'Can I do this?' }),
        h('p', { class: 'ask-where', text: p.helper ? `${p.title} · ${p.helper}` : p.title }))));
    // Why it can't be answered here comes first: no buttons below would otherwise read as broken.
    if (p.deskOnly) card.append(h('p', { class: 'desk-only' }, icon('eye'), h('span', { text: p.deskOnly })));
    card.append(h('p', { class: 'ask-plain', text: p.question || p.plan || p.ask || [p.label, p.detail].filter(Boolean).join(' ') }));
    const pv = p.preview;
    // The desk shows it in full, so here a glimpse is enough.
    if (pv?.kind === 'command') card.append(h('pre', { class: `cmd${p.deskOnly ? ' peek' : ''}`, text: pv.command }));
    else if (pv?.kind === 'edit' && !compact) card.append(editPreview(pv));
    else if (pv?.kind === 'write' && !compact) card.append(h('div', { class: 'cmd-file', text: shortPath(pv.file) }), h('pre', { class: 'cmd write', text: pv.content }));
    else if (pv?.kind === 'url') card.append(h('pre', { class: 'cmd', text: pv.url }));
    else if (pv?.file) card.append(h('div', { class: 'cmd-file', text: shortPath(pv.file) }));
    for (const w of p.warnings || []) card.append(h('p', { class: 'flag' }, icon('warn'), h('span', { text: `Heads up: ${w}` })));
    const answer = decision => actButton({
      label: decision === 'always' ? p.always : decision === 'allow' ? (sending === 'allow' ? 'Allowing…' : 'Allow') : (sending === 'deny' ? 'Denying…' : 'Deny'),
      cls: decision === 'allow' ? 'allow big' : decision === 'always' ? 'always' : 'big',
      run: async () => {
        S.answering.set(p.requestId, decision);
        const r = await act('answer', { tabId: p.tabId, requestId: p.requestId, decision });
        if (!r.ok) S.answering.delete(p.requestId);
        else buzz(decision === 'deny' ? 12 : [6, 30, 6]);
        refresh();
        if (r.ok) after?.();
      },
    });
    // A phone that may only look sees the prompt, and no way to answer it.
    if (!canAct()) {
      card.append(lookOnly());
      if (!inTab) card.append(h('button', { type: 'button', class: 'btn ghost', text: 'See the conversation', onclick: () => go(`#/tab/${encodeURIComponent(p.tabId)}`) }));
      return card;
    }
    // Only the desk can say yes, but a no from here lets the conversation get on without it.
    if (p.deskOnly) {
      card.append(h('div', { class: 'btns' }, answer('deny'),
        inTab ? null : h('button', { type: 'button', class: 'btn ghost', text: 'See the conversation', onclick: () => go(`#/tab/${encodeURIComponent(p.tabId)}`) })));
      return card;
    }
    // In a sheet: the beach redraws its cards as things change, and a half-picked answer mustn't go.
    if (p.questions) {
      card.append(h('button', { type: 'button', class: 'btn go big', text: p.questions.length > 1 ? 'Answer them' : 'Answer it', onclick: () => openSheet(questionSheet(p, after)) }));
      return card;
    }
    if (p.planText) {
      card.append(h('button', { type: 'button', class: 'btn go big', text: 'Read the plan', onclick: () => openSheet(planSheet(p, after)) }));
      return card;
    }
    card.append(h('div', { class: 'btns' }, answer('deny'), answer('allow')));
    if (p.always) card.append(answer('always'));
    if (compact && (pv?.kind === 'edit' || pv?.kind === 'write')) {
      card.append(h('button', { type: 'button', class: 'link', text: pv.kind === 'edit' ? 'See the edit first' : 'See what it writes', onclick: () => openSheet(promptSheet(p)) }));
    }
    return card;
  }

  function editPreview(pv) {
    const box = h('div', { class: 'edit-pv' }, h('div', { class: 'cmd-file', text: shortPath(pv.file) }));
    const lines = (text, kind) => String(text || '').split('\n').slice(0, 40).map(l => h('div', { class: `diff-row ${kind}` }, h('span', { class: 'diff-sign', text: kind === 'add' ? '+' : '−' }), h('span', { class: 'diff-text', text: l || ' ' })));
    box.append(h('div', { class: 'diff compact' }, ...lines(pv.old, 'del'), ...lines(pv.new, 'add')));
    if (pv.more) box.append(h('p', { class: 'muted small', text: `And ${L.plural(pv.more, 'more edit')} to the same file.` }));
    return box;
  }

  const shortPath = p => {
    const parts = String(p || '').split(/[\\/]/).filter(Boolean);
    return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : parts.join('/');
  };

  function promptSheet(p) {
    return { label: 'Permission', build: close => {
      const card = promptCard(p);
      card.classList.add('in-sheet');
      // Answered while it was open (here or at the desk): it closes itself.
      const watch = () => { if (!S.view?.prompts?.some(x => x.requestId === p.requestId)) close(); };
      return { el: card, update: watch };
    } };
  }

  // ---------------------------------------------------------------- the beach

  function tabCard(t) {
    const go1 = () => go(`#/tab/${encodeURIComponent(t.id)}`);
    const meta = [];
    if (t.standing === 'working') {
      meta.push(h('span', { class: 'doing', text: L.doingLine(t) }));
      if (t.busySince) meta.push(h('span', { class: 'mono since', dataset: { since: t.busySince }, text: L.duration((Date.now() - t.busySince) / 1000) }));
    }
    if (t.ready) meta.push(h('span', { class: 'add', text: `+${t.ready.added}` }), h('span', { class: 'del', text: `−${t.ready.removed}` }), h('span', { text: L.plural(t.ready.files, 'file') }));
    if (t.copy) meta.push(h('span', { class: 'pill', text: 'own copy' }));
    if (t.folder && !t.copy) meta.push(h('span', { class: 'muted', text: t.folder }));
    const right = t.standing === 'working' && t.crew
      ? h('span', { class: 'mini-crew', 'aria-label': `${L.plural(t.crew, 'helper')} out` }, ...Array.from({ length: Math.min(3, t.crew) }, (_, i) => D.crab({ px: 0.9, state: 'working', hue: D.helperHue(i), label: '' })))
      : t.standing === 'review' && t.checks ? h('span', { class: `pill ${t.checks.status === 'pass' ? '' : 'amber'}`, text: t.checks.status === 'pass' ? '✓ checks' : t.checks.status === 'fail' ? '✕ checks' : 'checks' })
        : t.standing === 'finished' ? h('span', { class: `pill ${t.outcome === 'error' ? 'coral' : ''}`, text: t.outcome === 'error' ? 'hit a problem' : t.outcome === 'stopped' ? 'stopped' : 'done' })
          : t.fromPhone ? h('span', { class: 'pill dim', text: '📱' }) : null;
    const prog = t.todos?.total ? h('div', { class: 'prog', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': t.todos.total, 'aria-valuenow': t.todos.done, 'aria-label': 'To-dos done' }, h('i', { class: `w${Math.round((t.todos.done / t.todos.total) * 20) * 5}` })) : null;
    return h('button', { type: 'button', class: `card tab-card s-${t.standing}`, onclick: go1 },
      h('span', { class: 'card-t' }, h('span', { class: 'card-title', text: t.title }), right),
      meta.length ? h('span', { class: 'card-m' }, ...meta) : null,
      prog);
  }

  function tide(view) {
    const head = L.headline(view);
    const cel = S.celebrate && Date.now() < S.celebrate.until ? S.celebrate : null;
    const state = cel ? 'success' : view?.crab?.state || 'idle';
    const said = cel ? 'nailed it' : view?.crab?.say || { asking: 'can I?', working: 'claws out', sleeping: 'zzz' }[state] || null;
    const u = view?.usage || {};
    const meter = u.pct != null ? h('div', { class: 'meter' },
      h('div', { class: 'meter-row' }, h('span', { text: '5-hour window' }), h('span', { text: `${u.pct}%${u.resetsAt ? ` · resets ${L.clock(u.resetsAt)}` : ''}` })),
      h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': u.pct, 'aria-label': 'Your 5-hour usage window' }, h('i', { class: `w${Math.min(100, Math.round(u.pct / 5) * 5)} ${u.pct >= 85 ? 'hot' : u.pct >= 60 ? 'warm' : ''}` })))
      : u.limit ? h('p', { class: 'tide-limit', text: `At your ${u.limit.name || 'usage'} limit. Back at ${u.limit.at}.` }) : null;
    return h('section', { class: `tide${cel ? ' cheer' : ''}`, 'aria-label': 'What Shellby is doing' },
      h('button', { type: 'button', class: 'tide-crab', 'aria-label': `Shellby, ${state}. Give him a pat`, onclick: patHim }, D.crab({ px: 4, state, label: '' }), said ? h('span', { class: `bubble ${state}`, text: said }) : null),
      h('div', { class: 'tide-words' }, h('h2', { class: 'tide-title', text: cel ? 'Nailed it' : head.title }), h('p', { class: 'tide-sub', text: cel ? cel.title : head.sub })),
      meter,
      view?.usage?.warning ? h('p', { class: 'tide-warn', text: view.usage.warning }) : null);
  }

  // A pat from the beach: he feels it on your desktop (pocket/extras.js pet).
  async function patHim() {
    if (!live()) return;
    const r = await N.post('pet', {});
    if (r.ok && !r.again) { buzz([6, 40, 6]); celebrate('He loved that.'); }
  }

  function beachScreen() {
    const scroll = h('div', { class: 'scroll beach' });
    const fab = h('a', { href: '#/new', class: 'fab', 'aria-label': 'New task' }, icon('plus'), h('span', { text: 'New task' }));
    const el = h('div', { class: 'screen' }, topbar(), h('div', { class: 'offline-slot' }), scroll, fab, dock('beach'));
    let quietOpen = false;
    function update() {
      const v = S.view;
      el.replaceChild(topbar(), el.firstChild);
      el.querySelector('.offline-slot').replaceChildren(offlineBanner() || '');
      fab.hidden = !canAct();
      if (!v) { scroll.replaceChildren(h('div', { class: 'loading' }, D.crab({ px: 4, state: 'working' }), h('p', { text: 'Finding your PC…' }))); return; }
      const parts = [tide(v), Find.awayCard(), Find.searchRow()];
      const prompts = v.prompts || [];
      if (prompts.length) {
        parts.push(h('h3', { class: 'sect asking' }, h('i'), h('span', { text: 'Waiting on you' }), h('b', { text: prompts.length })));
        for (const p of prompts) parts.push(promptCard(p, { compact: true }));
      }
      for (const s of L.sections(v)) {
        if (s.key === 'quiet' && s.tabs.length > 2) {
          parts.push(h('button', { type: 'button', class: 'sect sect-toggle', 'aria-expanded': quietOpen ? 'true' : 'false', onclick: () => { quietOpen = !quietOpen; update(); } },
            h('span', { text: s.label }), h('b', { text: s.tabs.length }), icon('chevron', quietOpen ? 'open' : '')));
          if (quietOpen) for (const t of s.tabs) parts.push(tabCard(t));
          continue;
        }
        parts.push(h('h3', { class: `sect ${s.key}` }, h('span', { text: s.label }), h('b', { text: s.tabs.length })));
        for (const t of s.tabs) parts.push(tabCard(t));
      }
      if (!v.tabs?.length && !prompts.length) {
        parts.push(h('div', { class: 'empty' }, h('p', { text: canAct() ? 'Nothing on the go. Give him something to do and he’ll scuttle off with it.' : 'Nothing on the go.' }), canAct() ? h('a', { href: '#/new', class: 'btn go', text: 'Start a task' }) : null));
      }
      // No "while you were away" card is null, which replaceChildren would print.
      scroll.replaceChildren(...parts.filter(Boolean));
    }
    update();
    return { el, update, title: 'Shellby' };
  }

  // One conversation and what its turns changed live in pocket-tab.js; the checks card on it comes from pocket-find.js.
  const { tabScreen, diffScreen, transcript } = window.PocketTab({ S, L, D, N, h, icon, live, tabOf, go, toast, buzz, act, actButton, topbar, offlineBanner, promptCard, confirmSheet, celebrate, shortPath, modePicker, shareTurn, openSheet, photoButton, voiceButton, canAct, lookOnly, wake, checksCard: (...a) => Find.checksCard(...a) });
  // A note's Start it opens New task with the note in it; Look over my changes picks a project.
  const More = window.PocketMore({ S, L, D, N, h, icon, live, go, toast, buzz, act, actButton, topbar, offlineBanner, dock, confirmSheet, canAct, lookOnly, newTask: prefill => openSheet(newTaskSheet(prefill)), lookOver: () => openSheet(lookOverSheet()) });
  // Search, history, a closed conversation, the whole branch, and what happened while you were away.
  const Find = window.PocketFind({ S, L, D, N, h, icon, live, go, act, actButton, topbar, offlineBanner, dock, openSheet, modePicker, refresh, loaded: More.loaded, transcript, shortPath });
  // One prompt from its notification, and the quiet hours card (pocket-phone.js).
  const { promptScreen, quietCard, pushState, turnOnPush, turnOffPush } = window.PocketPhone({ S, L, D, h, ios, standalone, icon, live, tabOf, go, toast, act, topbar, offlineBanner, promptCard, canAct });

  // ---------------------------------------------------------------- the queue

  function queueScreen() {
    const scroll = h('div', { class: 'scroll' });
    const el = h('div', { class: 'screen' }, topbar(), h('div', { class: 'offline-slot' }), scroll, dock('queue'));
    function update() {
      el.replaceChild(topbar(), el.firstChild);
      el.querySelector('.offline-slot').replaceChildren(offlineBanner() || '');
      const v = S.view;
      const u = v?.usage || {};
      const parts = [h('h2', { class: 'screen-title', text: 'For the reset' })];
      parts.push(h('div', { class: 'card usage-card' },
        u.limit ? h('p', {}, h('b', { text: 'At your usage limit.' }), ` He's back at ${u.limit.at}, and this queue starts by itself then.`)
          : u.pct != null ? h('p', {}, h('b', { text: `${u.pct}% of your 5-hour window used.` }), u.resetsAt ? ` It resets at ${L.clock(u.resetsAt)}.` : '')
            : h('p', { class: 'muted', text: 'No reading of your usage window yet.' }),
        u.pct != null ? h('div', { class: 'bar' }, h('i', { class: `w${Math.min(100, Math.round(u.pct / 5) * 5)} ${u.pct >= 85 ? 'hot' : u.pct >= 60 ? 'warm' : ''}` })) : null,
        ...usageDetail(u)));
      const held = v?.held || [];
      if (!held.length) parts.push(h('div', { class: 'empty' }, h('p', { text: 'Nothing waiting for the reset. A task you start from here at your limit waits in this list, and starts by itself.' })));
      for (const x of held) {
        parts.push(h('div', { class: 'card held' },
          h('div', { class: 'card-t' }, h('span', { class: 'card-title', text: x.name }), x.running ? h('span', { class: 'pill', text: 'running' }) : h('span', { class: 'pill dim', text: x.atText || 'at the reset' })),
          h('div', { class: 'card-m' }, h('span', { class: 'muted', text: x.kind === 'routine' ? 'A routine' : x.kind === 'message' ? 'A message' : x.folder || 'A task' })),
          canAct() ? actButton({ label: x.running ? 'Stop it' : 'Take it out', cls: 'ghost slim', run: () => confirmSheet({ title: x.running ? 'Stop it and take it out?' : 'Take it out of the queue?', text: x.name, yes: x.running ? 'Stop it' : 'Take it out', danger: true, then: () => act('cancel-held', { id: x.id }, { okText: 'Taken out.' }) }) }) : null));
      }
      scroll.replaceChildren(...parts);
    }
    update();
    return { el, update, title: 'Queue' };
  }

  // ---------------------------------------------------------------- this phone

  function phoneScreen() {
    const scroll = h('div', { class: 'scroll' });
    const el = h('div', { class: 'screen' }, topbar(), h('div', { class: 'offline-slot' }), scroll, dock('phone'));
    const pushBox = h('div', { class: 'card' });
    async function drawPush() {
      const st = await pushState();
      pushBox.replaceChildren(h('div', { class: 'card-t' }, h('span', { class: 'card-title' }, icon('bell'), ' Notifications'), h('span', { class: `pill ${st.on ? '' : 'dim'}`, text: st.on ? 'on' : 'off' })),
        h('p', { class: 'muted', text: st.can ? (st.on ? 'He buzzes this phone when he needs you, and when a long task is done. Which ones is set on your PC, in Settings → On your phone.' : 'Get a buzz when he needs your yes, with the card one tap away.') : st.why }),
        ...(st.can ? [actButton({ label: st.on ? 'Turn them off' : 'Turn them on', cls: st.on ? 'ghost' : 'go', run: async () => { if (st.on) await turnOffPush(); else await turnOnPush(); drawPush(); } })] : []));
    }
    function update() {
      el.replaceChild(topbar(), el.firstChild);
      el.querySelector('.offline-slot').replaceChildren(offlineBanner() || '');
      const pc = S.view?.pc || 'your PC';
      scroll.replaceChildren(
        h('h2', { class: 'screen-title', text: 'This phone' }),
        h('div', { class: 'card hello' }, D.crab({ px: 3, state: live() ? 'idle' : 'sleeping', label: '' }), h('div', {},
          h('b', { text: live() ? `Talking to ${pc}` : `Waiting for ${pc}` }),
          h('p', { class: 'muted', text: live() ? 'Over your tailnet. Nothing goes through a server of ours.' : 'Your PC may be asleep, or Tailscale off on one of them.' }))),
        pushBox,
        quietCard(),
        h('div', { class: 'card' },
          h('div', { class: 'card-t' }, h('span', { class: 'card-title' }, icon('shield'), ' What this phone can do'), canAct() ? null : h('span', { class: 'pill amber', text: 'read only' })),
          canAct() ? h('ul', { class: 'plain' },
            h('li', { text: 'Allow or Deny a prompt, or always allow it when the desk would offer that. Answer a question, or approve a plan once you’ve read it. Anything the card warns about waits for the desk.' }),
            h('li', { text: 'Start a task or reply to any conversation, in the mode you pick, and a new task on the model you pick. A new task runs in its own copy when the folder is a repo.' }),
            h('li', { text: 'Stop a turn, undo one, or bring a copy home. Have him look over a project’s changes for security problems.' }),
            h('li', { text: 'Run a routine, guard your focus, add a note, or dress him up.' }),
            S.view?.allow?.files ? h('li', { text: 'Read a conversation’s files.' }) : null,
            S.view?.allow?.push ? h('li', { text: 'Push after bringing a copy home.' }) : null)
            : h('ul', { class: 'plain' },
              h('li', { text: 'Look: every conversation as it happens, what’s waiting, what’s ready to review and what changed.' }),
              h('li', { text: 'Not answer, start, reply, stop, undo or bring anything home. Your PC set this phone to read only, in Settings → On your phone.' }),
              h('li', { text: 'Turn its own notifications on or off, and forget itself.' }))),
        h('button', { type: 'button', class: 'btn danger-ghost', text: 'Forget this phone', onclick: () => confirmSheet({ title: 'Forget this phone?', text: 'It stops seeing Shellby straight away. To use it again, pair it with a new code from your PC.', yes: 'Forget it', danger: true, then: async () => { await turnOffPush().catch(() => {}); await N.post('forget'); unpaired('This phone is forgotten. Pair it again any time.'); } }) }),
        h('p', { class: 'fine', text: 'Shellby on your phone · served by your PC' }));
      drawPush();
    }
    // Redrawn only when the connection, the rights or the quiet hours change: the
    // notification card asks the browser each time.
    let was = null;
    const maybe = () => {
      el.replaceChild(topbar(), el.firstChild);
      el.querySelector('.offline-slot').replaceChildren(offlineBanner() || '');
      const now = JSON.stringify([live(), S.view?.rights, S.view?.quiet]);
      if (was !== now) { was = now; update(); }
    };
    maybe();
    return { el, update: maybe, title: 'This phone' };
  }

  // ---------------------------------------------------------------- sheets

  function openSheet(spec) {
    closeSheet(true);
    const scrim = h('div', { class: 'scrim', onclick: () => closeSheet() });
    const panel = h('div', { class: `sheet${spec.tall ? ' tall' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': spec.label || 'Sheet' });
    const grab = h('div', { class: 'grab', 'aria-hidden': 'true' });
    const close = () => closeSheet();
    const built = spec.build(close);
    panel.append(grab, built.el);
    sheetRoot.replaceChildren(scrim, panel);
    document.body.classList.add('sheet-open');
    requestAnimationFrame(() => { scrim.classList.add('in'); panel.classList.add('in'); });
    S.sheet = { panel, scrim, update: built.update || null, back: document.activeElement };
    // Drag it down to let it go.
    let y0 = null, dy = 0;
    grab.addEventListener('pointerdown', e => { y0 = e.clientY; dy = 0; grab.setPointerCapture(e.pointerId); panel.classList.add('dragging'); });
    grab.addEventListener('pointermove', e => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); panel.style.transform = `translateY(${dy}px)`; });
    const end = () => { if (y0 == null) return; y0 = null; panel.classList.remove('dragging'); panel.style.transform = ''; if (dy > 90) closeSheet(); };
    grab.addEventListener('pointerup', end);
    grab.addEventListener('pointercancel', end);
    setTimeout(() => panel.querySelector('button, textarea, input, a')?.focus({ preventScroll: true }), 50);
  }

  function closeSheet(now = false) {
    const sh = S.sheet;
    if (!sh) return;
    S.sheet = null;
    document.body.classList.remove('sheet-open');
    sh.panel.classList.remove('in');
    sh.scrim.classList.remove('in');
    const gone = () => { if (!S.sheet) sheetRoot.replaceChildren(); };
    if (now || reduced()) gone(); else setTimeout(gone, 260);
    sh.back?.focus?.({ preventScroll: true });
  }

  function confirmSheet({ title, text, yes, danger = false, then }) {
    return new Promise(resolve => {
      openSheet({ label: title, build: close => {
        const el = h('div', { class: 'confirm' },
          h('h2', { class: 'sheet-title', text: title }),
          text ? h('p', { text }) : null,
          h('div', { class: 'btns' },
            h('button', { type: 'button', class: 'btn big', text: 'Cancel', onclick: () => { close(); resolve(false); } }),
            actButton({ label: yes, cls: `${danger ? 'danger' : 'go'} big`, run: async () => { await then(); close(); resolve(true); } })));
        return { el };
      } });
    });
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.sheet) closeSheet(); });

  // ---------------------------------------------------------------- pairing

  function pairScreen(message = null) {
    const showInstall = ios && !standalone() && !S.installSkipped;
    if (showInstall) {
      return { title: 'Add Shellby', el: h('div', { class: 'screen pair' }, h('div', { class: 'pair-body' },
        D.crab({ px: 5, state: 'idle' }),
        h('h1', { text: 'Put me on your Home Screen' }),
        h('p', { text: 'Shellby works best as an app: it keeps you paired, and it can buzz you when he needs your yes.' }),
        h('ol', { class: 'steps' },
          h('li', {}, 'Tap ', h('b', { text: 'Share' }), ' in Safari’s toolbar.'),
          h('li', {}, 'Choose ', h('b', { text: 'Add to Home Screen' }), '.'),
          h('li', {}, 'Open ', h('b', { text: 'Shellby' }), ' from your Home Screen and pair it there.')),
        h('button', { type: 'button', class: 'link', text: 'Skip this and pair here in Safari', onclick: () => { S.installSkipped = true; mount(); } }))), update() {} };
    }
    const input = h('input', {
      class: 'code-in', id: 'pairCode', type: 'text', inputmode: 'text', autocapitalize: 'characters', autocomplete: 'one-time-code', autocorrect: 'off', spellcheck: 'false',
      maxlength: '9', placeholder: 'XXXX-XXXX', 'aria-label': 'Pairing code',
    });
    const err = h('p', { class: 'pair-err', role: 'alert', text: message || '' });
    const pair = actButton({
      label: 'Pair', cls: 'go big', offlineOk: true,
      run: async () => {
        const code = input.value.replace(/[^A-Za-z0-9]/g, '');
        if (code.length !== 8) { err.textContent = 'The code is eight letters and numbers.'; input.focus(); return; }
        const r = await N.call('POST', 'pair', { code, name: '' });
        if (!r.ok) { err.textContent = r.error || 'That didn’t work.'; buzz([20, 40, 20]); input.select(); return; }
        N.setToken(r.token);
        buzz([6, 30, 6]);
        S.justPaired = true;
        start();
      },
    });
    input.addEventListener('input', () => { const at = input.value; input.value = L.formatCode(at); err.textContent = ''; if (input.value.length === 9) pair.click(); });
    const el = h('div', { class: 'screen pair' }, h('div', { class: 'pair-body' },
      D.crab({ px: 5, state: 'idle' }),
      h('h1', { text: 'Say hello to your PC' }),
      h('p', { text: 'On your PC: Shellby → Settings → On your phone → Pair a phone. Type the code it shows.' }),
      h('label', { class: 'code-label', for: 'pairCode', text: 'Pairing code' }),
      input, err, pair,
      h('p', { class: 'fine', text: location.host })));
    setTimeout(() => input.focus(), 300);
    return { el, update() {}, title: 'Pair' };
  }

  function notifyAsk() {
    return { title: 'Notifications', el: h('div', { class: 'screen pair' }, h('div', { class: 'pair-body' },
      D.crab({ px: 5, state: 'success' }),
      h('h1', { text: 'Paired. Hello!' }),
      h('p', { text: 'Want a buzz when he needs your yes, or when a long task is done?' }),
      actButton({ label: 'Turn on notifications', cls: 'go big', run: async () => { await turnOnPush(); S.justPaired = false; go('#/'); } }),
      h('button', { type: 'button', class: 'link', text: 'Not now', onclick: () => { S.justPaired = false; go('#/'); } }))), update() {} };
  }

  function unpaired(message) {
    N.setToken(null);
    N.store.set(VIEW_KEY, null);
    stream?.stop();
    S.view = null;
    S.feeds.clear();
    show(pairScreen(message));
  }

  // ---------------------------------------------------------------- mounting

  function show(screen) {
    const old = S.screen;
    S.screen = screen;
    document.title = screen.title ? `${screen.title} · Shellby` : 'Shellby';
    screen.el.classList.add('enter');
    app.replaceChildren(screen.el);
    requestAnimationFrame(() => screen.el.classList.remove('enter'));
    if (old && old !== screen) window.scrollTo(0, 0);
    wake.sync(!!screen.tabId);
  }

  // New task with what another app shared, or plain when it kept nothing.
  // A phone that may only look leaves it where the service worker kept it.
  async function openShared() {
    if (!canAct()) { toast(LOOK_ONLY, { ms: 5200 }); return; }
    const shared = await takeShared();
    openSheet(newTaskSheet(shared ? { text: shared.text, photos: shared.photos, shared: true } : {}));
  }

  function mount() {
    if (!N.token()) { show(pairScreen()); return; }
    if (!stream) { start(); return; }
    S.route = L.route(location.hash);
    closeSheet(true);
    const r = S.route;
    if (S.justPaired && 'PushManager' in window) { show(notifyAsk()); return; }
    if (r.name === 'new' || r.name === 'share') {
      history.replaceState(null, '', '#/');
      S.route = { name: 'beach' };
      show(beachScreen());
      stream.watch(null);
      if (r.name === 'share') openShared(); else openSheet(newTaskSheet());
      return;
    }
    if (r.name === 'tab') { show(tabScreen(r.tabId)); stream.watch(r.tabId); return; }
    stream.watch(r.name === 'diff' || r.name === 'branch' ? r.tabId : null);
    if (r.name === 'prompt') show(promptScreen(r.tabId, r.requestId));
    else if (r.name === 'diff') show(diffScreen(r.tabId, r.after));
    else if (r.name === 'queue') show(queueScreen());
    else if (r.name === 'more') show(More.moreScreen());
    else if (r.name === 'routines') show(More.routinesScreen());
    else if (r.name === 'notes') show(More.notesScreen());
    else if (r.name === 'wardrobe') show(More.wardrobeScreen());
    else if (r.name === 'trophies') show(More.trophiesScreen());
    else if (r.name === 'history') show(More.historyScreen());
    else if (r.name === 'files') show(More.filesScreen(r.tabId, r.path));
    else if (r.name === 'find') show(Find.findScreen());
    else if (r.name === 'project-history') show(Find.historyScreen());
    else if (r.name === 'past') show(Find.pastScreen(r.id));
    else if (r.name === 'branch') show(Find.branchScreen(r.tabId));
    else if (r.name === 'phone') show(phoneScreen());
    else show(beachScreen());
  }

  function refresh() {
    S.screen?.update?.();
    S.sheet?.update?.();
  }

  function celebrate(title) {
    S.celebrate = { until: Date.now() + 2800, title };
    buzz([8, 50, 8, 50, 16]);
    refresh();
    setTimeout(refresh, 2900);
  }

  // A conversation that just landed (working -> review or finished, and fine): he cheers.
  function noticeLandings(prev, next) {
    if (!prev) return;
    for (const t of next.tabs || []) {
      const was = prev.tabs?.find(x => x.id === t.id);
      if (was?.standing === 'working' && ['review', 'finished'].includes(t.standing) && t.outcome !== 'error' && t.outcome !== 'stopped') {
        celebrate(t.title);
        return;
      }
    }
  }

  async function tidyNotifications(view) {
    const n = view.prompts?.length || 0;
    try { if (n) await navigator.setAppBadge?.(n); else await navigator.clearAppBadge?.(); } catch { /* no badge here */ }
    // A prompt answered at the desk: its notification goes too.
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const open = new Set((view.prompts || []).map(p => `ask-${p.tabId}`));
      const busy = new Set((view.tabs || []).filter(t => t.busy).map(t => `tab-${t.id}`));
      for (const note of (await reg?.getNotifications()) || []) {
        if (note.tag?.startsWith('ask-') && !open.has(note.tag)) note.close();
        // A "working on it" left from a turn that ended without a "done" (stopped, say).
        else if (note.tag?.startsWith('tab-') && note.silent && !busy.has(note.tag)) note.close();
      }
    } catch { /* nothing to tidy */ }
  }

  let stream = null;
  function start() {
    stream?.dispose();
    stream = N.createStream({
      view(v) {
        const prev = S.view;
        S.view = v;
        D.setSkin(v.skin);
        for (const id of [...S.answering.keys()]) if (!v.prompts?.some(p => p.requestId === id)) S.answering.delete(id);
        try { N.store.set(VIEW_KEY, JSON.stringify({ ...v, skin: v.skin })); } catch { /* full */ }
        noticeLandings(prev, v);
        announce(L.announcements(prev, v));
        tidyNotifications(v);
        if (S.screen?.update) refresh(); else mount();
        Find.onView();
      },
      items({ tabId, items }) {
        S.feeds.set(tabId, { items: items || [], loaded: true });
        S.partial.delete(tabId);
        if (S.screen?.tabId === tabId) S.screen.feed();
      },
      item({ tabId, item }) {
        const feed = S.feeds.get(tabId) || { items: [], loaded: true };
        if (item.k === 'partial') S.partial.set(tabId, item.text);
        else {
          if (item.k === 'text' && !item.sub) S.partial.delete(tabId);
          if (item.k === 'end') S.partial.delete(tabId);
          feed.items.push(item);
          if (feed.items.length > 600) feed.items.splice(0, feed.items.length - 600);
        }
        S.feeds.set(tabId, feed);
        if (S.screen?.tabId === tabId) S.screen.feed();
      },
      live(on) {
        S.live = on;
        document.body.classList.toggle('offline-mode', !on);
        refresh();
      },
      bye({ reason }) { unpaired(reason || 'This phone was forgotten on your PC.'); },
      unpaired() { unpaired('This phone isn’t paired any more. Pair it again with a new code.'); },
    });
    if (S.view) D.setSkin(S.view.skin);
    mount();
    stream.start();
  }

  // The working clocks tick without a message from the PC.
  setInterval(() => {
    for (const el of document.querySelectorAll('[data-since]')) el.textContent = L.duration((Date.now() - Number(el.dataset.since)) / 1000);
  }, 1000);

  window.addEventListener('hashchange', mount);

  // A notification tapped: the service worker says where to go, and keeps it a
  // moment too, for a message the phone dropped or an iPhone that opened the start page.
  const TAPPED = 'shellby-pocket-tapped';
  async function takeTap() {
    try {
      const kept = await window.caches.open(TAPPED);
      const res = await kept.match('/__tapped');
      if (!res) return null;
      await kept.delete('/__tapped');
      return L.tappedHash(await res.json(), Date.now());
    } catch { return null; }
  }
  async function followTap(hash) {
    const to = hash || await takeTap();
    // Already there (the message and the kept copy both came, or it opened at that URL): no redraw.
    if (to && N.token() && location.hash !== to) go(to);
  }
  navigator.serviceWorker?.addEventListener('message', e => {
    const to = typeof e.data?.open === 'string' ? L.tappedHash({ url: e.data.open, at: Date.now() }, Date.now()) : null;
    if (!to) return;
    takeTap(); // the kept copy is spent, so coming back later doesn't go there again
    followTap(to);
  });
  document.addEventListener('visibilitychange', () => {
    // The browser let the screen lock go while the app was at the back: taken again here.
    wake.sync(!!S.screen?.tabId);
    if (document.visibilityState === 'visible') followTap();
  });
  window.addEventListener('pageshow', e => { if (e.persisted) followTap(); });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* no offline shell, still works */ });

  // The Classic skin, until the PC says which one he wears: the pairing screen has him too.
  async function firstSkin() {
    if (S.view?.skin) return;
    try { const r = await fetch('/skin.json', { cache: 'no-cache' }); if (r.ok) D.setSkin(await r.json()); } catch { /* a plain crab will do */ }
  }

  firstSkin().finally(() => { if (N.token()) start(); else show(pairScreen()); followTap(); });
})();
