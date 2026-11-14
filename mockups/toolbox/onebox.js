// 5. One box: no tabs at all. Opening the toolbox shows what needs you;
// typing searches everything at once: what you have, what you can do, hook
// recipes, your team's pack and the marketplaces. Keys do the rest.
(function () {
  'use strict';
  const T = window.TB;
  const { esc, tok, ago, total, glyph, KINDS } = T;

  const ACTIONS = [
    { id: 'park-idle', name: 'Park everything idle', sub: 'Stop carrying what Claude hasn’t used in three weeks', kw: 'park idle clean trim lean unused save tokens dust weight' },
    { id: 'triage', name: 'See what’s pulling its weight', sub: 'Usage against token cost, on one chart', kw: 'weight cost tokens lean heavy context budget' },
    { id: 'add-hook', name: 'Add a hook', sub: 'Run something at a moment in every turn', kw: 'hook automate when sound format guard' },
    { id: 'add-rule', name: 'Add a permission rule', sub: 'Let a command run without asking, or refuse it', kw: 'rule allow deny permission ask block' },
    { id: 'new-snippet', name: 'Save a prompt as a snippet', sub: 'Run it later as /name, or from a terminal', kw: 'snippet prompt save template' },
    { id: 'new-mod', name: 'Make a mod', sub: 'A pane, status line or command inside Claude Code', kw: 'mod pane status line extend plugin' },
    { id: 'add-mcp', name: 'Add an MCP server', sub: 'A program or URL that gives Claude new tools', kw: 'mcp server connect add tools' },
    { id: 'share-team', name: 'Share your setup with the team', sub: 'Write .shellby/team.json so teammates get it too', kw: 'share export team pack teammates' },
  ];
  const MOMENT = Object.freeze({ Stop: 'When Claude’s done', Notification: 'When Claude needs you', PreToolUse: 'Before Claude uses a tool', PostToolUse: 'After a tool finishes', UserPromptSubmit: 'When you send a message' });
  const on = m => m.split('|').join(', ');
  const TRY = ['review', 'pdf', 'sound', 'park', 'team', 'kubernetes', 'rule'];

  function mount(phone) {
    const d = T.clone();
    const st = { q: '', act: 0, done: new Set(), installed: new Set() };
    const idle = () => d.items.filter(i => T.isIdle(i, d.IDLE_DAYS) && i.tokens > 0 && !st.done.has(`parked:${i.id}`));
    const teamMissing = () => d.team.filter(t => !t.have && !st.done.has(`team:${t.id}`));

    phone.innerHTML = `
      <div class="ob">
        <div class="ob-top">
          <div class="ob-box">
            <input type="search" class="ob-in" placeholder="Find a tool, or say what to do" aria-label="Find a tool, or say what to do" aria-controls="obList" aria-activedescendant="" autocomplete="off" spellcheck="false">
            <kbd>Ctrl K</kbd>
          </div>
        </div>
        <div class="ob-main">
          <div class="ob-res scroll" id="obList" role="listbox" aria-label="Results"></div>
          <aside class="ob-peek" aria-label="Details"></aside>
        </div>
        <div class="ob-keys muted"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> do it</span><span><kbd>Esc</kbd> clear</span></div>
      </div>`;
    const $ = s => phone.querySelector(s);
    const input = $('.ob-in');

    function inbox() {
      const rows = [];
      const auth = d.items.filter(i => i.status === 'needs-auth' && !st.done.has(`auth:${i.id}`));
      auth.forEach(i => rows.push({ type: 'inbox', id: `auth:${i.id}`, glyphKind: 'mcp', name: `${i.name} needs you to sign in`, sub: 'Its tools stay off until you do. It still costs 2.1k tokens a conversation.', btn: 'Sign in', tone: 'coral' }));
      const tm = teamMissing();
      if (tm.length) rows.push({ type: 'inbox', id: 'team', glyphKind: 'workflow', name: `Your team’s pack has ${tm.length} things you don’t`, sub: tm.map(t => t.name).join(', '), btn: 'Set them up', tone: 'glass' });
      const dead = idle();
      if (dead.length) rows.push({ type: 'inbox', id: 'park-idle', glyphKind: 'skill', name: `${dead.length} idle things weigh ${tok(total(dead.map(i => i.tokens)))} tokens`, sub: 'Every conversation carries them. None used in three weeks.', btn: 'Park them', tone: 'amber' });
      const fresh = d.items.filter(i => i.isNew);
      rows.push({ type: 'inbox', id: 'new', glyphKind: 'mod', name: `${fresh.length} new since Tuesday`, sub: fresh.map(i => i.name).join(', '), btn: 'Look', tone: 'quiet' });
      return rows;
    }

    function hay(...parts) { return parts.join(' ').toLowerCase(); }
    function score(text, qs) { return qs.reduce((n, w) => n + (text.includes(w) ? (text.split(/\W+/).some(x => x.startsWith(w)) ? 2 : 1) : 0), 0); }

    function search(q) {
      const qs = q.toLowerCase().split(/\s+/).filter(Boolean);
      const rank = (list, fn) => list.map(x => ({ x, s: score(fn(x), qs) })).filter(r => r.s > 0).sort((a, b) => b.s - a.s).map(r => r.x);
      const have = [
        ...rank(d.items, i => hay(i.name, i.desc, KINDS[i.kind].one)).map(i => ({ type: 'item', id: i.id, glyphKind: i.kind, name: i.name, sub: i.desc, tag: KINDS[i.kind].one, it: i })),
        ...rank(d.hooks, h => hay(h.name, 'hook', h.event)).map(h => ({ type: 'hook', id: h.id, glyphKind: 'hook', name: h.name, sub: `${MOMENT[h.event]}${h.matcher ? `, on ${on(h.matcher)}` : ''}${h.paused ? '. Paused' : ''}`, tag: 'Hook', h })),
        ...rank(d.rules, r => hay(r.rule, r.list, 'rule permission')).map(r => ({ type: 'rule', id: r.id, glyphKind: 'rule', name: r.rule, sub: { allow: 'Runs without asking', ask: 'Asks you first', deny: 'Refused' }[r.list], tag: 'Rule', r })),
        ...rank(d.memory, m => hay(m.name, m.path, 'memory claude.md')).map(m => ({ type: 'memory', id: m.id, glyphKind: 'memory', name: m.name, sub: m.path, tag: 'Memory', m })),
      ].slice(0, 8);
      const doIt = rank(ACTIONS, a => hay(a.name, a.kw)).slice(0, 3).map(a => ({ type: 'action', id: a.id, glyphKind: null, name: a.name, sub: a.sub, tag: 'Do' }));
      const recipes = rank(d.recipes.filter(r => !d.hooks.some(h => h.recipe === r.id)), r => hay(r.name, 'hook recipe', r.event)).slice(0, 3).map(r => ({ type: 'recipe', id: r.id, glyphKind: 'hook', name: r.name, sub: 'A ready-made hook. Adds in one click.', tag: 'Recipe', r }));
      const team = /team|pack|teammate/.test(q.toLowerCase()) ? teamMissing() : rank(teamMissing(), t => hay(t.name, t.note || '', t.kind));
      const teamRows = team.map(t => ({ type: 'team', id: t.id, glyphKind: t.kind, name: t.name, sub: t.note || `A ${KINDS[t.kind].one.toLowerCase()} from the team pack`, tag: 'Team pack', t }));
      const shop = rank(d.market.filter(m => !m.installed), m => hay(m.name, m.desc, m.kinds)).slice(0, 3).map(m => ({ type: 'market', id: m.id, glyphKind: null, name: m.name, sub: m.desc, tag: m.market, m }));
      return [['You have', have], ['Do', doIt], ['Team pack', teamRows], ['Hook recipes', recipes], ['Get more', shop]].filter(([, rows]) => rows.length);
    }

    function primary(r) {
      if (r.type === 'inbox') return r.btn;
      return { item: r.it?.status === 'needs-auth' ? 'Sign in' : r.it?.kind === 'mod' ? 'Open' : 'Use', hook: 'Test run', rule: 'Edit', memory: 'Edit', action: 'Do it', recipe: 'Add', team: 'Add', market: st.installed.has(r.id) ? 'Installed' : 'Install' }[r.type];
    }

    function rowHtml(r, i) {
      const g = r.glyphKind ? glyph(r.glyphKind, 28) : `<span class="kg" style="--k:${r.type === 'market' ? 'var(--sand-dim)' : 'var(--glass)'};--s:28px" aria-hidden="true">${r.type === 'market' ? '+' : '›'}</span>`;
      return `<div class="ob-row${i === st.act ? ' act' : ''}${r.tone ? ` t-${r.tone}` : ''}" role="option" id="ob-${i}" aria-selected="${i === st.act}" data-i="${i}">
        ${g}<span class="ob-t"><b>${esc(r.name)}</b><small>${esc(r.sub)}</small></span>
        ${r.tag ? `<span class="ob-tag">${esc(r.tag)}</span>` : ''}
        <button type="button" class="btn ${r.type === 'inbox' && r.tone === 'amber' ? 'amber' : i === st.act ? 'primary' : ''}" data-go="${i}" tabindex="-1">${esc(primary(r))}</button></div>`;
    }

    let flat = [];
    function render() {
      const q = st.q.trim();
      let html = '';
      if (!q) {
        flat = inbox();
        html = `<div class="ob-hello">${T.crab(4)}<p><b>${d.items.length + d.hooks.length + d.rules.length + d.memory.length} things in your toolbox.</b> Here’s what needs you.</p></div>
          <div class="ob-g">${flat.map(rowHtml).join('')}</div>
          <div class="ob-try"><span class="muted">Try</span>${TRY.map(t => `<button type="button" class="chip" data-try="${t}">${t}</button>`).join('')}</div>`;
      } else {
        const groups = search(q);
        flat = groups.flatMap(([, rows]) => rows);
        let i = 0;
        html = groups.map(([name, rows]) => `<div class="ob-g" role="group" aria-label="${esc(name)}"><p class="ob-gh">${esc(name)}</p>${rows.map(r => rowHtml(r, i++)).join('')}</div>`).join('')
          || `<div class="ob-none"><p><b>Nothing matches “${esc(q)}”.</b></p><p class="muted">Not in your toolbox, your team’s pack or any marketplace you’ve added.</p><button type="button" class="btn" data-make>Ask Claude to make a skill for “${esc(q)}”</button></div>`;
      }
      st.act = Math.min(st.act, Math.max(0, flat.length - 1));
      $('.ob-res').innerHTML = html;
      input.setAttribute('aria-activedescendant', flat.length ? `ob-${st.act}` : '');
      peek();
    }

    function peek() {
      const r = flat[st.act];
      const box = $('.ob-peek');
      if (!r) { box.innerHTML = ''; return; }
      let body = `<p>${esc(r.sub)}</p>`;
      if (r.it) {
        const i = r.it;
        body = `<p>${esc(i.desc)}</p><dl class="ob-dl">
          <div><dt>From</dt><dd>${esc(i.source === 'yours' ? 'You, every project' : i.source === 'project' ? 'This project' : i.source === 'built in' ? 'Claude Code' : `${i.source} plugin`)}</dd></div>
          ${i.tokens ? `<div><dt>Carried</dt><dd>${tok(i.tokens)} tokens a conversation</dd></div>` : ''}
          ${Array.isArray(i.uses) ? `<div><dt>Used</dt><dd>${total(i.uses)}× in six weeks, last ${ago(i.lastUsed)}</dd></div>` : ''}
          ${i.status ? `<div><dt>Status</dt><dd>${i.status === 'connected' ? 'Connected' : 'Needs sign-in'}</dd></div>` : ''}</dl>
          ${Array.isArray(i.uses) ? `<div class="ob-spark">${T.spark(i.uses, KINDS[i.kind].color)}<span class="muted">six weeks</span></div>` : ''}
          <div class="ob-more"><button type="button" class="btn quiet" data-side="pin">Pin</button>${i.tokens ? '<button type="button" class="btn quiet" data-side="park">Park</button>' : ''}<button type="button" class="btn quiet" data-side="file">Show file</button></div>`;
      } else if (r.type === 'hook') {
        body = `<dl class="ob-dl"><div><dt>Runs</dt><dd>${esc(MOMENT[r.h.event])}</dd></div>${r.h.matcher ? `<div><dt>On</dt><dd>${esc(on(r.h.matcher))}</dd></div>` : ''}<div><dt>From</dt><dd>${r.h.source === 'project' ? 'This project' : 'You, every project'}</dd></div></dl>
          <div class="ob-more"><button type="button" class="btn quiet" data-side="pause">${r.h.paused ? 'Resume' : 'Pause'}</button><button type="button" class="btn quiet" data-side="edit">Edit</button><button type="button" class="btn quiet" data-side="file">Show file</button></div>`;
      } else if (r.type === 'team') {
        body = `<p>${esc(r.sub)}</p><p class="muted">From .shellby/team.json in this repo. ${r.t.kind === 'mcp' ? 'You’ll be asked for your own key; it stays on this PC.' : 'Adds to your settings for this project only.'}</p>`;
      } else if (r.type === 'market') {
        body = `<p>${esc(r.m.desc)}</p><dl class="ob-dl"><div><dt>Brings</dt><dd>${esc(r.m.kinds)}</dd></div><div><dt>From</dt><dd>${esc(r.m.market)}</dd></div></dl><p class="muted">Ready in new conversations once installed.</p>`;
      } else if (r.type === 'recipe') {
        body = `<p>${esc(r.r.name)}.</p><p class="muted">Runs ${esc(MOMENT[r.r.event].toLowerCase())}. Pause or remove it any time.</p>`;
      }
      box.innerHTML = `<div class="ob-peek-h">${r.glyphKind ? glyph(r.glyphKind, 40) : ''}<div><h4>${esc(r.name)}</h4>${r.tag ? `<span class="muted">${esc(r.tag)}</span>` : ''}</div></div>${body}
        <button type="button" class="btn primary ob-go" data-go="${st.act}">${esc(primary(r))}</button>`;
    }

    function go(i) {
      const r = flat[i];
      if (!r) return;
      const say = (msg, undo) => T.toast(phone, msg, undo);
      switch (r.type) {
        case 'inbox':
          if (r.id === 'team') { st.q = 'team'; input.value = 'team'; st.act = 0; render(); return; }
          if (r.id === 'park-idle') { const ids = idle().map(x => x.id); const w = total(idle().map(x => x.tokens)); ids.forEach(id => st.done.add(`parked:${id}`)); render(); say(`Parked ${ids.length}. Conversations start ${tok(w)} lighter.`, () => { ids.forEach(id => st.done.delete(`parked:${id}`)); render(); }); return; }
          if (r.id === 'new') { say('Opens the new things: rename-screenshots, folder-auditor, task-pane'); return; }
          st.done.add(r.id); render(); say('Signed in to linear. Its tools are on.'); return;
        case 'action': if (r.id === 'park-idle') { st.q = ''; input.value = ''; st.act = 0; render(); go(flat.findIndex(x => x.id === 'park-idle')); return; } say(`${r.name}: the form opens here`); return;
        case 'recipe': d.hooks.push({ id: r.id, recipe: r.id, event: r.r.event, name: r.r.name, matcher: '' }); render(); say(`Added: ${r.r.name}`); return;
        case 'team': st.done.add(`team:${r.id}`); render(); say(`Added ${r.name} from the team pack`); return;
        case 'market': if (st.installed.has(r.id)) return; st.installed.add(r.id); render(); say(`Installed ${r.name}. It’s ready in new conversations.`); return;
        default: say(`${primary(r)}: ${r.name}`);
      }
    }

    input.addEventListener('input', () => { st.q = input.value; st.act = 0; render(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); st.act = Math.min(flat.length - 1, st.act + 1); render(); $('.ob-row.act')?.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); st.act = Math.max(0, st.act - 1); render(); $('.ob-row.act')?.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter') { e.preventDefault(); go(st.act); }
      else if (e.key === 'Escape' && st.q) { e.preventDefault(); input.value = ''; st.q = ''; st.act = 0; render(); }
    });
    phone.addEventListener('click', e => {
      const t = e.target.closest('[data-go],[data-try],[data-i],[data-side],[data-make]');
      if (!t) return;
      if (t.dataset.go) { go(Number(t.dataset.go)); return; }
      if (t.dataset.try) { input.value = t.dataset.try; st.q = t.dataset.try; st.act = 0; render(); input.focus(); return; }
      if (t.dataset.side) { T.toast(phone, { pin: 'Pinned to the start screen', park: 'Parked', file: 'Showed the file in Explorer', pause: 'Paused. Claude Code skips it until you resume.', edit: 'Opened in the editor' }[t.dataset.side]); return; }
      if ('make' in t.dataset) { T.toast(phone, 'A new tab opened with Claude, ready to write the skill'); return; }
      st.act = Number(t.dataset.i); render();
    });
    const onKey = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); input.select(); } };
    addEventListener('keydown', onKey);

    render();
    return () => removeEventListener('keydown', onKey);
  }

  T.register({
    id: 'onebox',
    name: 'One box',
    line: 'No tabs: what needs you, then type',
    mount,
    notes: {
      pitch: [
        'No sections, no kind chips, no second search for the shop. The toolbox opens on the few things that need you (a server to sign in to, what the team pack adds, idle weight, what’s new), and everything else is one box away.',
        'Typing searches everything at once: what you have, what you can do, hook recipes, the team pack and the marketplaces. Each result has one main action on Enter. “sound” finds both your sound hooks and the recipe you haven’t added, and “kubernetes” goes straight to Install.',
      ],
      tryIt: [
        'Start with the inbox. <b>Park them</b> and <b>Set them up</b> both work.',
        'Type “<b>sound</b>”, “<b>review</b>”, “<b>pdf</b>”, “<b>rule</b>” or “<b>kubernetes</b>”. Move with <b>↑</b> <b>↓</b>, act with <b>Enter</b>.',
        'Type “<b>team</b>” to see only what your team’s pack would add, then add it one at a time.',
        'Type nonsense to see the empty state: it offers to have Claude make a skill.',
        'Switch to <b>Window</b>: the highlighted result opens in a side pane with its usage and Pin, Park and Show file.',
      ],
      map: [
        ['Tools', 'Search results under “You have”. Browsing by kind is a search: “agent”, “mcp”.'],
        ['Setup', 'Hooks, rules and memory come up in the same search.'],
        ['Lean', 'The idle line in the inbox, and the “pulling its weight” action.'],
        ['Team', 'An inbox line when the pack has things you don’t, and a “Team pack” group in results.'],
        ['Get more', 'A “Get more” group at the end of every search. No separate tab.'],
        ['Crew', 'Agents in results; their records would show in the side pane.'],
      ],
      tradeoff: 'Fastest when you know what you want, and nothing to browse when you don’t. It pairs with mockup 4 as the front door: the bench for habits, this box for everything else.',
    },
  });
})();
