/* Shellby on your phone — the beach (#/): the tide at the top (him, what he's
   up to, your usage window and the PC itself), what's waiting on you, and a
   card for every conversation; and steadyList, the list that keeps its place
   while the PC's updates redraw it (the queue borrows it). pocket.js hands in
   what it shares with the other screens. */
'use strict';
(function (root) {
  root.PocketBeach = ({ S, L, D, N, h, icon, live, go, buzz, canAct, topbar, dock, offlineBanner, promptCard, celebrate, Later, Find, Pages }) => {
    // Your other PCs, one line each: reachable or not, what's working there, its
    // conversations' titles, and a link to its own page for anything more.
    function otherPcs(others) {
      return [
        h('h3', { class: 'sect' }, h('span', { text: 'Your other PCs' }), h('b', { text: others.length })),
        ...others.map(o => {
          const busy = (o.tabs || []).filter(t => t.busy);
          const what = !o.live ? 'Not reachable right now' : busy.length ? `Working on ${busy.slice(0, 2).map(t => t.title).join(', ')}${busy.length > 2 ? ` and ${busy.length - 2} more` : ''}` : (o.tabs?.length ? `${o.tabs.length} open, all quiet` : 'Nothing on the go');
          const body = [h('span', { class: `pc ${o.live ? 'on' : 'off'}` }, h('i'), h('span', { text: o.name })), h('span', { class: 'muted small', text: what })];
          return /^https:\/\/[a-z0-9.-]+\.ts\.net(:\d+)?$/.test(o.url || '') // only a page on your tailnet, as pocket-wide.js checks
            ? h('a', { class: 'tab-card other-pc', href: `${o.url}/`, 'aria-label': `Open Shellby on ${o.name}` }, ...body)
            : h('div', { class: 'tab-card other-pc' }, ...body);
        }),
      ];
    }

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
      if (L.mixedAgents(S.view)) meta.push(D.agent(t.harness));
      const right = t.standing === 'working' && t.crew
        ? h('span', { class: 'mini-crew', 'aria-label': `${L.plural(t.crew, 'helper')} out` }, ...Array.from({ length: Math.min(3, t.crew) }, (_, i) => D.crab({ px: 0.9, state: 'working', hue: D.helperHue(i), label: '' })))
        : t.standing === 'review' && t.checks ? h('span', { class: `pill ${t.checks.status === 'pass' ? '' : 'amber'}`, text: t.checks.status === 'pass' ? '✓ checks' : t.checks.status === 'fail' ? '✕ checks' : 'checks' })
          : t.standing === 'finished' ? h('span', { class: `pill ${t.outcome === 'error' ? 'coral' : ''}`, text: t.outcome === 'error' ? 'hit a problem' : t.outcome === 'stopped' ? 'stopped' : 'done' })
            : t.fromPhone ? h('span', { class: 'pill dim', text: '📱' }) : null;
      const prog = t.todos?.total ? h('div', { class: 'prog', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': t.todos.total, 'aria-valuenow': t.todos.done, 'aria-label': 'To-dos done' }, h('i', { class: `w${Math.round((t.todos.done / t.todos.total) * 20) * 5}` })) : null;
      // On a wide screen the open one sits beside the list, so its card shows it.
      const open = S.route?.name === 'tab' && S.route.tabId === t.id;
      return h('button', { type: 'button', class: `card tab-card s-${t.standing}${open ? ' sel' : ''}`, 'aria-current': open ? 'true' : null, onclick: go1 },
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
        machineLine(view?.machine),
        view?.usage?.warning ? h('p', { class: 'tide-warn', text: view.usage.warning }) : null);
    }

    // The PC itself, from Health on your PC: heat, load, memory and the battery. Nothing when Health is off.
    function machineLine(m) {
      if (!m) return null;
      const bits = [];
      if (m.cpu?.temp != null || m.cpu?.load != null) bits.push(`CPU ${[m.cpu.load != null ? `${m.cpu.load}%` : null, m.cpu.temp != null ? `${m.cpu.temp}°` : null].filter(Boolean).join(' · ')}`);
      if (m.gpu && (m.gpu.temp != null || m.gpu.load != null)) bits.push(`GPU ${[m.gpu.load != null ? `${m.gpu.load}%` : null, m.gpu.temp != null ? `${m.gpu.temp}°` : null].filter(Boolean).join(' · ')}`);
      if (m.ram != null) bits.push(`RAM ${m.ram}%`);
      if (m.battery) bits.push(`Battery ${m.battery.level}%${m.battery.charging ? ' ⚡' : ''}`);
      if (!bits.length) return null;
      return h('p', { class: `machine${m.hot ? ` ${m.hot}` : ''}`, 'aria-label': `Your PC: ${bits.join(', ')}${m.warn ? `. Running hot: ${m.warn}` : ''}` },
        icon('chip'), h('span', { text: bits.join('  ·  ') }), m.warn ? h('b', { text: ` ${m.warn}` }) : null);
    }

    // A pat from the beach: he feels it on your desktop (pocket/extras.js pet).
    async function patHim() {
      if (!live()) return;
      const r = await N.post('pet', {});
      if (r.ok && !r.again) { buzz([6, 40, 6]); celebrate('He loved that.'); }
    }

    // A list the PC's updates redraw: it keeps its place, and a redraw that comes
    // while your thumb is on it (or it's still coasting) waits until it's still.
    // Swapping the content out mid-swipe stopped the scroll dead on an iPhone.
    function steadyList(scroll) {
      const feel = { touching: false, movedAt: 0 };
      let waiting = null;
      /** @type {number | null} */ let timer = null;
      function put(parts) {
        const top = scroll.scrollTop;
        scroll.replaceChildren(...parts);
        scroll.scrollTop = top;
      }
      function later() {
        timer = null;
        if (!waiting) return;
        if (L.holdRedraw(feel)) { timer = setTimeout(later, L.SETTLE_MS); return; }
        const parts = waiting;
        waiting = null;
        put(parts);
      }
      const wait = () => { if (waiting && !timer) timer = setTimeout(later, L.SETTLE_MS); };
      const lift = () => { feel.touching = false; feel.movedAt = Date.now(); wait(); };
      scroll.addEventListener('touchstart', () => { feel.touching = true; }, { passive: true });
      scroll.addEventListener('touchend', lift, { passive: true });
      scroll.addEventListener('touchcancel', lift, { passive: true });
      scroll.addEventListener('scroll', () => { feel.movedAt = Date.now(); }, { passive: true });
      // now: something you tapped on the list itself, which answers straight away.
      return function draw(parts, now = false) {
        if (now || !L.holdRedraw(feel)) { waiting = null; put(parts); return; }
        waiting = parts;
        wait();
      };
    }

    function beachScreen() {
      const scroll = h('div', { class: 'scroll beach' });
      const draw = steadyList(scroll);
      const fab = h('a', { href: '#/new', class: 'fab', 'aria-label': 'New task' }, icon('plus'), h('span', { text: 'New task' }));
      const el = h('div', { class: 'screen' }, topbar(), h('div', { class: 'offline-slot' }), scroll, fab, dock('beach'));
      let quietOpen = false;
      function update(now = false) {
        const v = S.view;
        el.replaceChild(topbar(), el.firstChild);
        el.querySelector('.offline-slot').replaceChildren(offlineBanner() || '');
        fab.hidden = !canAct();
        if (!v) { draw([h('div', { class: 'loading' }, D.crab({ px: 4, state: 'working' }), h('p', { text: 'Finding your PC…' }))], true); return; }
        const parts = [tide(v), Later.outboxCard(), Find.awayCard(), Find.searchRow()];
        const prompts = v.prompts || [];
        if (prompts.length) {
          parts.push(h('h3', { class: 'sect asking' }, h('i'), h('span', { text: 'Waiting on you' }), h('b', { text: prompts.length })));
          for (const p of prompts) parts.push(promptCard(p));
        }
        // What's waiting on your other PCs, answered through this one (main's pocket/view.js phoneOthers).
        for (const o of v.others || []) {
          if (!o.prompts?.length) continue;
          parts.push(h('h3', { class: 'sect asking' }, h('i'), h('span', { text: `Waiting on ${o.name}` }), h('b', { text: o.prompts.length })));
          for (const p of o.prompts) parts.push(promptCard(p));
        }
        parts.push(...Pages.pinnedRow()); // after what's waiting on you, before what's ready to review, as at the desk
        for (const s of L.sections(v)) {
          if (s.key === 'quiet' && s.tabs.length > 2) {
            parts.push(h('button', { type: 'button', class: 'sect sect-toggle', 'aria-expanded': quietOpen ? 'true' : 'false', onclick: () => { quietOpen = !quietOpen; update(true); } },
              h('span', { text: s.label }), h('b', { text: s.tabs.length }), icon('chevron', quietOpen ? 'open' : '')));
            if (quietOpen) for (const t of s.tabs) parts.push(tabCard(t));
            continue;
          }
          parts.push(h('h3', { class: `sect ${s.key}` }, h('span', { text: s.label }), h('b', { text: s.tabs.length })));
          for (const t of s.tabs) parts.push(tabCard(t));
        }
        if (v.others?.length) parts.push(...otherPcs(v.others));
        if (!v.tabs?.length && !prompts.length) {
          parts.push(h('div', { class: 'empty' }, h('p', { text: canAct() ? 'Nothing on the go. Give him something to do and he’ll scuttle off with it.' : 'Nothing on the go.' }), canAct() ? h('a', { href: '#/new', class: 'btn go', text: 'Start a task' }) : null));
        }
        // No "while you were away" card is null, which replaceChildren would print.
        draw(parts.filter(Boolean), now);
      }
      update();
      // What waits to send changes on the phone alone: the card follows it.
      const stopOut = Later.onOutbox(() => { if (S.screen?.el === el || S.screen?.beach?.el === el) update(); else stopOut(); });
      return { el, update: () => update(), title: 'Shellby' };
    }

    return { beachScreen, steadyList };
  };
})(window);
