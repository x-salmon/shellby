// 1. Loadout: Tools and Lean are one list. A strip across the top is the
// context window every conversation starts with, one slice per thing you
// carry, so weight and use sit side by side and idle weight is visible.
(function () {
  'use strict';
  const T = window.TB;
  const { esc, tok, ago, total, glyph, spark, KINDS } = T;

  const FILTERS = [['all', 'Everything'], ['mcp', 'MCP'], ['memory', 'Memory'], ['skill', 'Skills'], ['agent', 'Agents'], ['command', 'Commands'], ['mod', 'Mods'], ['snippet', 'Snippets']];
  const SORTS = [['heavy', 'Heaviest'], ['used', 'Most used'], ['idle', 'Idle first'], ['az', 'A to Z']];
  const STRIP_ORDER = ['memory', 'mcp', 'skill', 'agent', 'command'];

  function mount(phone) {
    const d = T.clone();
    const items = [
      ...d.memory.map(m => ({ ...m, desc: `${m.loads}.`, scopeNote: m.path })),
      ...d.items,
    ];
    const st = { filter: 'all', sort: 'heavy', q: '', sel: null, parked: new Set(), removed: new Set(), pinned: new Set(['code-reviewer', 'sn-review']) };
    const idle = it => T.isIdle(it, d.IDLE_DAYS);
    const live = () => items.filter(it => !st.parked.has(it.id) && !st.removed.has(it.id));
    const carried = () => d.BASELINE.tokens + total(live().map(it => it.tokens));
    const idleWeight = () => live().filter(it => idle(it) && it.tokens > 0);
    let shown = carried();

    phone.innerHTML = `
      <div class="bar"><h3>Toolbox</h3><button type="button" class="btn quiet" data-act="rescan">Rescan</button></div>
      <div class="lo">
        <section class="lo-hero" aria-labelledby="loHead">
          <p class="lo-lede" id="loHead">Every conversation starts out carrying</p>
          <p class="lo-big"><b class="lo-num"></b> <span>tokens</span> <small class="lo-pct"></small></p>
          <div class="lo-strip" aria-hidden="true"></div>
          <p class="lo-tip muted" aria-live="polite">Point at a slice to see what it is.</p>
          <div class="lo-advice" role="status"></div>
        </section>
        <nav class="lo-kinds" aria-label="Show" role="tablist"></nav>
        <div class="lo-find">
          <input type="search" class="field" placeholder="Search everything you have" aria-label="Search">
          <select class="field" aria-label="Order">${SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        </div>
        <div class="lo-list scroll"><ul role="list"></ul></div>
        <aside class="lo-insp" aria-label="Details"></aside>
      </div>`;

    const $ = s => phone.querySelector(s);
    const num = $('.lo-num');

    function renderHero() {
      const now = carried();
      T.countTo(num, shown, now);
      shown = now;
      $('.lo-pct').textContent = `${Math.round((now / d.WINDOW) * 100)}% of the window, before your first word`;
      const segs = [`<span class="seg base" style="flex:${d.BASELINE.tokens}" data-tip="${esc(d.BASELINE.label)}, ${tok(d.BASELINE.tokens)} tokens. Not yours to trim."></span>`];
      STRIP_ORDER.forEach(k => {
        live().filter(it => it.kind === k && it.tokens > 0).sort((a, b) => b.tokens - a.tokens).forEach(it => {
          const tip = `${it.name}: ${tok(it.tokens)} tokens. ${idle(it) ? `Idle, last used ${ago(it.lastUsed)}.` : ''}`;
          segs.push(`<span class="seg${idle(it) ? ' idle' : ''}${st.sel === it.id ? ' sel' : ''}" style="flex:${it.tokens};--k:${KINDS[k].color}" data-id="${esc(it.id)}" data-tip="${esc(tip)}"></span>`);
        });
      });
      $('.lo-strip').innerHTML = segs.join('');
      const dead = idleWeight();
      const weight = total(dead.map(it => it.tokens));
      $('.lo-advice').innerHTML = dead.length
        ? `<span><b>${dead.length} idle things</b> carry ${tok(weight)} of that. Nothing’s used them in ${d.IDLE_DAYS} days.</span><button type="button" class="btn amber" data-act="park-idle">Park all ${dead.length}</button>`
        : '<span>Everything you carry has been used in the last three weeks.</span>';
      $('.lo-advice').classList.toggle('clear', !dead.length);
    }

    function renderKinds() {
      $('.lo-kinds').innerHTML = FILTERS.map(([k, label]) => {
        const these = live().filter(it => k === 'all' || it.kind === k);
        const w = total(these.map(it => it.tokens));
        const dot = k === 'all' ? '' : `<i style="--k:${KINDS[k].color}"></i>`;
        return `<button type="button" role="tab" data-kind="${k}" aria-selected="${st.filter === k}">${dot}<span>${label}</span><small>${these.length}</small><em>${w ? tok(w) : ''}</em></button>`;
      }).join('');
    }

    function sorted(list) {
      const by = {
        heavy: (a, b) => b.tokens - a.tokens || total(b.uses) - total(a.uses),
        used: (a, b) => total(b.uses) - total(a.uses),
        idle: (a, b) => idle(b) - idle(a) || b.tokens - a.tokens,
        az: (a, b) => a.name.replace('/', '').localeCompare(b.name.replace('/', '')),
      }[st.sort];
      return [...list].sort(by);
    }

    function usesLabel(it) {
      if (it.kind === 'memory') return `<small>edited ${ago(it.edited)}</small>`;
      if (it.kind === 'mod') return `<small>${it.on ? 'on' : 'off'}</small>`;
      if (idle(it)) return `<small class="warn">${it.lastUsed == null ? 'never used' : `idle ${ago(it.lastUsed)}`}</small>`;
      return `<small>${T.count(total(it.uses), 'use')}</small>`;
    }

    function row(it, max) {
      const w = it.tokens ? Math.max(4, Math.round((it.tokens / max) * 100)) : 0;
      return `<li><button type="button" class="lo-row${idle(it) ? ' idle' : ''}${st.sel === it.id ? ' sel' : ''}" data-id="${esc(it.id)}">
        ${glyph(it.kind)}
        <span class="lo-main"><span class="lo-name">${esc(it.name)}${it.isNew ? ' <span class="pill">new</span>' : ''}${st.pinned.has(it.id) ? ' <span class="pin" title="Pinned">★</span>' : ''}</span><span class="lo-desc">${esc(it.desc)}</span></span>
        <span class="lo-use">${it.kind === 'memory' ? '' : spark(it.uses, KINDS[it.kind].color)}${usesLabel(it)}</span>
        <span class="lo-cost">${it.tokens ? `<b>${tok(it.tokens)}</b><i style="--w:${w}%"></i>` : '<b class="free" title="Costs nothing until it’s used">free</b>'}</span>
      </button></li>`;
    }

    function renderList() {
      const q = st.q.trim().toLowerCase();
      const pool = live().filter(it => (st.filter === 'all' || it.kind === st.filter) && (!q || `${it.name} ${it.desc}`.toLowerCase().includes(q)));
      const max = Math.max(1, ...live().map(it => it.tokens));
      const parked = items.filter(it => st.parked.has(it.id));
      let html = sorted(pool).map(it => row(it, max)).join('');
      if (!pool.length) html = `<li class="lo-empty">Nothing you have matches “${esc(st.q)}”. <button type="button" class="link" data-act="shop">Look in the marketplaces</button></li>`;
      if (parked.length) {
        html += `<li class="lo-parked"><div class="lo-parked-head"><b>Parked</b><span class="muted">${parked.length} things, ${tok(total(parked.map(it => it.tokens)))} tokens you no longer carry</span><button type="button" class="link" data-act="restore-all">Bring them all back</button></div>
          <div class="lo-parked-chips">${parked.map(it => `<button type="button" class="chip" data-restore="${esc(it.id)}" title="Bring back">${glyph(it.kind, 18)}${esc(it.name)}</button>`).join('')}</div></li>`;
      }
      $('.lo-list ul').innerHTML = html;
    }

    function renderInsp() {
      const it = items.find(x => x.id === st.sel);
      const box = $('.lo-insp');
      box.classList.toggle('open', Boolean(it));
      if (!it) {
        const top = [...live()].sort((a, b) => b.tokens - a.tokens).slice(0, 3);
        box.innerHTML = `<div class="lo-insp-empty">${T.crab(5, '#ff7a5c')}<p>Pick anything to see what it costs, when Claude last reached for it, and what to do about it.</p>
          <p class="muted">Heaviest right now: ${top.map(x => `<button type="button" class="link" data-id="${esc(x.id)}">${esc(x.name)}</button>`).join(', ')}.</p></div>`;
        return;
      }
      const k = KINDS[it.kind];
      const isParked = st.parked.has(it.id);
      const mine = it.source === 'yours' || it.source === 'project';
      const weeks = Array.isArray(it.uses) ? `<div class="lo-weeks" role="img" aria-label="Uses per week, six weeks">${it.uses.map((u, i) => `<span style="--h:${Math.max(0.06, u / Math.max(1, ...it.uses)).toFixed(2)};--k:${k.color}" class="${u ? '' : 'zero'}"><i>${u}</i><small>${i === 5 ? 'this wk' : `${5 - i}w`}</small></span>`).join('')}</div>` : '';
      const vague = it.desc.split(' ').length < 4;
      box.innerHTML = `
        <button type="button" class="lo-close btn quiet" data-act="close" aria-label="Close">✕</button>
        <div class="lo-insp-head">${glyph(it.kind, 40)}<div><h4>${esc(it.name)}</h4><p class="muted">${esc(k.one)}, ${esc(sourceWords(it.source))}</p></div></div>
        <p class="lo-insp-desc">${esc(it.desc)}</p>
        ${vague && idle(it) ? `<div class="lo-hint"><b>Claude never picks this one.</b> Its description is ${it.desc.split(' ').length} words, too little for Claude to know when it fits.<button type="button" class="btn" data-act="sharpen">Sharpen it with Claude</button></div>` : ''}
        <dl class="lo-facts">
          <div><dt>Carried</dt><dd>${it.tokens ? `${tok(it.tokens)} tokens in every conversation` : 'Nothing until it runs'}</dd></div>
          ${it.useTokens ? `<div><dt>Each use</dt><dd>about ${tok(it.useTokens)} tokens</dd></div>` : ''}
          ${Array.isArray(it.uses) ? `<div><dt>Used</dt><dd>${total(it.uses) === 1 ? 'Once' : `${total(it.uses)} times`} in six weeks, last ${ago(it.lastUsed)}</dd></div>` : ''}
          ${it.scopeNote ? `<div><dt>File</dt><dd class="mono">${esc(it.scopeNote)}</dd></div>` : ''}
          ${it.status ? `<div><dt>Status</dt><dd>${it.status === 'connected' ? 'Connected' : '<span class="warn">Needs you to sign in</span>'}</dd></div>` : ''}
        </dl>
        ${weeks}
        <div class="lo-acts">
          ${it.status === 'needs-auth' ? '<button type="button" class="btn primary" data-act="signin">Sign in</button>' : it.kind === 'mcp' ? '<button type="button" class="btn primary" data-act="turnoff">Turn off</button>' : it.kind !== 'memory' && it.kind !== 'mod' ? `<button type="button" class="btn primary" data-act="use">Use ${esc(it.name.startsWith('/') ? it.name : '')}</button>` : '<button type="button" class="btn primary" data-act="edit">Edit</button>'}
          ${it.kind !== 'memory' ? `<button type="button" class="btn" data-act="pin">${st.pinned.has(it.id) ? 'Unpin' : 'Pin to start'}</button>` : ''}
          ${it.tokens ? `<button type="button" class="btn" data-act="${isParked ? 'restore' : 'park'}">${isParked ? 'Bring back' : `Park, save ${tok(it.tokens)}`}</button>` : ''}
          ${mine && it.kind !== 'memory' ? '<button type="button" class="btn quiet" data-act="edit">Edit</button>' : ''}
          ${it.kind !== 'memory' ? '<button type="button" class="btn quiet" data-act="remove">Remove</button>' : ''}
        </div>`;
    }

    function sourceWords(s) {
      if (s === 'yours') return 'yours, in every project';
      if (s === 'project') return 'this project’s';
      if (s === 'built in') return 'built into Claude Code';
      return `from the ${s} plugin`;
    }

    function all() { renderHero(); renderKinds(); renderList(); renderInsp(); }

    function park(ids, msg) {
      const fresh = ids.filter(id => !st.parked.has(id));
      fresh.forEach(id => st.parked.add(id));
      all();
      T.toast(phone, msg, () => { fresh.forEach(id => st.parked.delete(id)); all(); });
    }

    phone.addEventListener('click', e => {
      const t = e.target.closest('[data-act],[data-kind],[data-id],[data-restore]');
      if (!t) return;
      if (t.dataset.kind) { st.filter = t.dataset.kind; renderKinds(); renderList(); return; }
      if (t.dataset.restore) { st.parked.delete(t.dataset.restore); all(); return; }
      if (t.dataset.id && !t.dataset.act) { st.sel = st.sel === t.dataset.id && t.classList.contains('lo-row') ? null : t.dataset.id; all(); return; }
      const it = items.find(x => x.id === st.sel);
      switch (t.dataset.act) {
        case 'park-idle': { const dead = idleWeight(); park(dead.map(x => x.id), `Parked ${dead.length}. New conversations start ${tok(total(dead.map(x => x.tokens)))} lighter.`); break; }
        case 'park': park([it.id], `Parked ${it.name}. It’s one click away if you want it back.`); break;
        case 'restore': st.parked.delete(it.id); all(); break;
        case 'restore-all': st.parked.clear(); all(); break;
        case 'close': st.sel = null; all(); break;
        case 'pin': st.pinned.has(it.id) ? st.pinned.delete(it.id) : st.pinned.add(it.id); all(); T.toast(phone, st.pinned.has(it.id) ? `Pinned ${it.name} to the start screen` : `Unpinned ${it.name}`); break;
        case 'remove': { const id = it.id; st.removed.add(id); st.sel = null; all(); T.toast(phone, `Moved ${it.name} to the Recycle Bin`, () => { st.removed.delete(id); all(); }); break; }
        case 'use': T.toast(phone, `Opened a new conversation with ${it.name}`); break;
        case 'edit': T.toast(phone, `Opened ${it.scopeNote || it.name} in the editor`); break;
        case 'turnoff': T.toast(phone, `Turned off ${it.name}. New conversations start ${tok(it.tokens)} lighter.`); break;
        case 'signin': T.toast(phone, 'Opened Linear’s sign-in page in your browser'); break;
        case 'sharpen': T.toast(phone, 'Claude is drafting a sharper description in a new tab'); break;
        case 'rescan': T.toast(phone, 'Scanned again. Nothing new since this morning.'); break;
        case 'shop': T.toast(phone, 'This is where Get more would open, already searched'); break;
      }
    });

    const strip = $('.lo-strip');
    const tip = $('.lo-tip');
    strip.addEventListener('mousemove', e => {
      const s = e.target.closest('.seg');
      if (!s) return;
      tip.textContent = s.dataset.tip;
      strip.querySelectorAll('.seg.hot').forEach(x => x.classList.remove('hot'));
      s.classList.add('hot');
      strip.classList.add('hovering');
    });
    strip.addEventListener('mouseleave', () => { tip.textContent = 'Point at a slice to see what it is.'; strip.classList.remove('hovering'); strip.querySelectorAll('.hot').forEach(x => x.classList.remove('hot')); });
    strip.addEventListener('click', e => { const s = e.target.closest('.seg[data-id]'); if (s) { st.sel = s.dataset.id; all(); phone.querySelector(`.lo-row[data-id="${CSS.escape(s.dataset.id)}"]`)?.scrollIntoView({ block: 'nearest' }); } });
    $('.lo-find input').addEventListener('input', e => { st.q = e.target.value; renderList(); });
    $('.lo-find select').addEventListener('change', e => { st.sort = e.target.value; renderList(); });
    const onKey = e => { if (e.key === 'Escape' && st.sel) { st.sel = null; all(); } };
    phone.addEventListener('keydown', onKey);

    all();
  }

  T.register({
    id: 'loadout',
    name: 'Loadout',
    line: 'Tools and Lean as one list, weighed',
    mount,
    notes: {
      pitch: [
        'One list of everything Claude carries, with the context window drawn across the top. Each slice is one skill, server or memory file, sized by the tokens it adds to every conversation before you type.',
        'Weight and use sit on the same row, so the question Lean answers in a separate tab (is this worth carrying?) is answered wherever you look. The three biggest slices here are MCP servers, and one of them, claude-in-chrome, hasn’t been touched in a month.',
      ],
      tryIt: [
        'Point along the strip. The striped slices are idle. Click one to open it.',
        'Press <b>Park all</b> in the amber line. The number counts down and the strip closes up. Undo is in the toast.',
        'Open <b>csv-cleaner</b>. It’s never been picked because its description is two words, and the fix is one button.',
        'Sort by <b>Most used</b>, or search “review”.',
        'Switch to <b>Window</b>. Kinds become a rail with their weight beside them, and details stay open on the right.',
      ],
      map: [
        ['Tools', 'The list. Kinds are filters with counts and weight, not a second tab row.'],
        ['Lean', 'The strip, the amber line and the cost column. No separate tab.'],
        ['Setup', 'Memory files sit in the list, because they’re weight too. Hooks and rules go to a Setup view (see mockup 3).'],
        ['Crew', 'An agent’s details show its crab and record (see mockup 4).'],
        ['Get more', 'An empty search offers the marketplaces.'],
        ['Parked', 'A shelf at the bottom of the list, one click to bring anything back.'],
      ],
      tradeoff: 'It leads with cost. Someone who never thinks about tokens sees a budget first. Mockup 4 leads with using things instead.',
    },
  });
})();
