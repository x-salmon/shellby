/* Shellby panel — Toolbox: everything Claude Code can use, and what Shellby just learned.
   Two rows of tabs: a section (Tools, Setup, Lean, Team), then the kinds in it.
   Skills, agents and commands list together under All, or one kind at a time.
   MCP servers (/mcp) are toolbox-mcp.js, and your prompt snippets saved, edited
   and run (/snippets) toolbox-snippets.js.
   Skills, agents and commands are one row each: kind, name and what it's for,
   how often it's used and what it costs in every conversation (lean.js usage),
   with Use and the pin where the pointer or keyboard is. They can be filtered by
   where they come from and sorted by use (the numbers are toolbox-usage.js), and
   open up to show the rest: where they live, edit, remove (toolbox-detail.js,
   over skillremove.js). A wide panel adds a rail of sources and a pane for the
   open row (toolbox-tidy.js).
   The Hooks, Rules and Memory tabs live in toolbox-setup.js, Team (the
   repo's .shellby/team.json) in toolbox-team.js, and Mods in toolbox-mods.js.
   Picking many, parking and the health line are toolbox-batch.js. The tab,
   source and order you left it on are kept for next time. */
'use strict';
(function () {
  const { h, api, state, $ } = SB;
  const NEW_FOR_MS = 3 * 24 * 3600 * 1000;
  const PAGE = 150;               // rows drawn at a time: plugins can bring hundreds of skills
  const SEARCH_WAIT_MS = 120;
  const listKey = { skill: 'skills', agent: 'agents', command: 'commands', mcp: 'mcp', mod: 'mods' };
  const MERGED = ['skill', 'agent', 'command'];   // listed together under All ('tool')
  const LISTED = new Set(['tool', ...MERGED]);     // the kinds with source and order pickers
  // Which section each kind sits in, and the kind a section opens on (the one you left it on).
  const GROUP = {
    tool: 'tools', skill: 'tools', agent: 'tools', command: 'tools', mcp: 'tools', mod: 'tools', snippet: 'tools',
    hook: 'setup', rule: 'setup', memory: 'setup', lean: 'lean', team: 'team', shop: 'shop',
  };
  const lastKind = { tools: 'tool', setup: 'hook', lean: 'lean', team: 'team', shop: 'shop' };
  const ALIAS = { permissions: 'rule' }; // /permissions in the composer
  let kind = 'tool';
  const SEARCH_WHAT = {
    tool: 'skills, agents and commands', skill: 'skills', agent: 'agents', command: 'commands', mcp: 'MCP servers', mod: 'mods', snippet: 'snippets',
    hook: 'hooks', rule: 'rules', memory: 'memory files', lean: 'plugins, servers and skills', team: 'the team pack',
  };
  const STAR = 'M8 2.3l1.75 3.6 3.95.55-2.86 2.77.68 3.93L8 11.3l-3.52 1.85.68-3.93L2.3 6.45l3.95-.55z';

  const isNew = t => (state.learned || []).some(l => l.kind === t.kind && l.name === t.name && Date.now() - l.at < NEW_FOR_MS);
  const isPinned = t => (state.pinned || []).some(p => p.kind === t.kind && p.name === t.name);
  const itemsOf = (tb, k) => (k === 'tool' ? MERGED.flatMap(m => tb[listKey[m]] || []) : tb[listKey[k]] || []);
  const shown = t => (t.kind === 'command' || t.kind === 'skill' ? `/${t.name}` : t.name);

  const U = SB.toolboxUsage;  // how often each is used and what it costs (toolbox-usage.js)
  const D = SB.toolboxDetail; // what a row opens to, and editing your own (toolbox-detail.js)
  const { usageOf, isIdle, num, tok, numbers } = U;
  const { toolDetail, sourceLabel } = D;

  // ------------------------------------------------------------ where from, and in what order

  // Per kind, so a source that one tab lacks doesn't reset the others: 'all',
  // 'user', 'project', 'cli', 'plugins' or 'plugin:<name>'.
  const sources = { tool: 'all', skill: 'all', agent: 'all', command: 'all' };
  let sort = 'name';
  const SOURCE_NAMES = { user: 'Yours', project: 'This project', cli: 'Built in' };

  const fromSource = t => {
    const s = sources[kind] || 'all';
    return s === 'all' || (s === 'plugins' ? (t.source || '').startsWith('plugin:') : t.source === s);
  };

  const byName = (a, b) => a.name.localeCompare(b.name);
  const SORTS = {
    name: (a, b) => (Number(isNew(b)) - Number(isNew(a))) || (Number(isPinned(b)) - Number(isPinned(a))) || byName(a, b),
    used: (a, b) => (num(usageOf(b)?.uses) - num(usageOf(a)?.uses)) || (num(usageOf(b)?.lastUsed) - num(usageOf(a)?.lastUsed)) || byName(a, b),
    // Never used, the ones costing the most in every conversation first: what's worth a look.
    unused: (a, b) => (Number(!!num(usageOf(a)?.uses)) - Number(!!num(usageOf(b)?.uses))) || (num(usageOf(b)?.listTokens) - num(usageOf(a)?.listTokens)) || byName(a, b),
  };

  // A health filter from the line above the list: 'nodesc' or 'dupes' (servers go to the MCP tab).
  /** @type {string | null} */
  let only = null;
  const ONLY = { nodesc: t => SB.toolboxBatch.isOwn(t) && !t.description, dupes: t => !!t.hides?.length };

  // The tab, sources and order you left, for next time.
  const VIEW_KEY = 'shellby.toolbox.view';
  function saveView() {
    // Get more isn't kept as where the Toolbox opens: opening it fetches every marketplace's list.
    const keep = kind === 'shop' ? lastKind.tools : kind;
    try { window.localStorage.setItem(VIEW_KEY, JSON.stringify({ kind: keep, sources, sort })); } catch { /* lasts this session */ }
  }
  function loadView() {
    let v;
    try { v = JSON.parse(window.localStorage.getItem(VIEW_KEY) || 'null'); } catch { v = null; }
    if (!v || typeof v !== 'object') return;
    if (typeof v.sort === 'string' && Object.hasOwn(SORTS, v.sort)) sort = v.sort;
    for (const k of Object.keys(sources)) if (typeof v.sources?.[k] === 'string') sources[k] = v.sources[k];
    if (typeof v.kind === 'string' && Object.hasOwn(GROUP, v.kind)) { kind = v.kind; lastKind[GROUP[kind]] = kind; }
  }

  // The picker lists where this kind's items come from, with counts; rebuilt only when that changes.
  function syncSourcePicker(all) {
    const sel = $('toolSource');
    const counts = new Map();
    for (const t of all) counts.set(t.source, (counts.get(t.source) || 0) + 1);
    const plugins = [...counts.keys()].filter(s => (s || '').startsWith('plugin:')).sort();
    const pluginTotal = plugins.reduce((n, s) => n + counts.get(s), 0);
    const opts = [
      ['all', `All (${all.length})`],
      ...['user', 'project', 'cli'].filter(s => counts.has(s)).map(s => [s, `${SOURCE_NAMES[s]} (${counts.get(s)})`]),
      ...(plugins.length ? [['plugins', `All plugins (${pluginTotal})`]] : []),
    ];
    const pluginOpts = plugins.map(s => [s, `${s.slice(7)} (${counts.get(s)})`]);
    const key = JSON.stringify([opts, pluginOpts]);
    if (sel.dataset.key !== key) {
      sel.replaceChildren(
        ...opts.map(([v, t]) => h('option', { value: v, text: t })),
        pluginOpts.length ? h('optgroup', { label: 'One plugin' }, pluginOpts.map(([v, t]) => h('option', { value: v, text: t }))) : null);
      sel.dataset.key = key;
    }
    // Gone from this tab (its last one removed, a plugin uninstalled): back to all of them.
    if (![...sel.options].some(o => o.value === sources[kind])) sources[kind] = 'all';
    sel.value = sources[kind];
  }

  SB.toolChip = (p) => h('button', {
    class: 'trick-chip', type: 'button', title: p.kind === 'agent' ? `Use the ${p.name} agent` : `/${p.name}`,
    onclick: () => SB.useTool(p),
  }, h('span', { class: `kind-dot k-${p.kind}` }), p.name);

  // ------------------------------------------------------------ a row, and what it opens to

  const openRows = new Set(); // 'kind:name' of the rows showing their details
  let shownOwn = [];          // your own ones in the list as filtered, for Shift+click ranges
  let rowSeq = 0;

  // What stays in reach with the row closed: Use and the pin, or a server's switches.
  function quickActions(t) {
    if (t.kind === 'mcp') return SB.toolboxMcp.actions(t);
    const pinned = isPinned(t);
    return [
      // An agent can run a whole conversation, not only be handed one task (claude --agent).
      t.kind === 'agent' ? h('button', { class: 'btn slim-btn', type: 'button', title: `A new conversation run by ${t.name}: its own instructions, tools and model from the start`,
        'aria-label': `New conversation as ${t.name}`, onclick: () => SB.newTabAs(t.name) }, 'Chat as') : null,
      h('button', { class: 'btn slim-btn', type: 'button', 'aria-label': `Use ${t.name}`, onclick: () => SB.useTool(t) }, 'Use'),
      h('button', {
        class: `icon-btn pin${pinned ? ' on' : ''}`, type: 'button', title: pinned ? 'Unpin from the start screen' : 'Pin to the start screen',
        'aria-label': `Pin ${t.name}`, 'aria-pressed': String(pinned),
        onclick: async () => {
          state.pinned = await api.pinTool(t.kind, t.name, !pinned);
          render();
          focusRow(`${t.kind}:${t.name}`, '.pin');
          SB.refreshEmptyStates();
        },
      }, SB.icon(STAR, { width: 1.3 })),
    ];
  }

  // After a redraw, put the keyboard back on the same row's button.
  function focusRow(key, sel) {
    const li = [...$('toolList').querySelectorAll('.tool-item')].find(r => r.dataset.key === key);
    li?.querySelector(sel)?.focus({ preventScroll: true });
  }

  // A list's row leads with its kind as a letter; on your own ones the box to pick it takes
  // that place when the pointer or keyboard is on the row, or once anything is picked.
  const NOUN = { skill: 'skill', agent: 'agent', command: 'command' };
  const GLYPH = { skill: 'S', agent: 'A', command: '/' };
  const lead = t => h('span', { class: 'tool-lead' },
    h('span', { class: `kind-glyph k-${t.kind}`, role: 'img', 'aria-label': NOUN[t.kind], title: NOUN[t.kind], text: GLYPH[t.kind] }),
    SB.toolboxBatch.isOwn(t) ? SB.toolboxBatch.checkbox(t, shownOwn) : null);

  function toolRow(t) {
    const inGroup = groupedView;
    const key = `${t.kind}:${t.name}`;
    const open = openRows.has(key);
    const u = t.kind === 'mcp' ? null : usageOf(t);
    const id = `tool-detail-${++rowSeq}`;
    const listed = LISTED.has(kind);
    const inPane = listed && SB.toolboxTidy.isWide(); // a wide panel shows the open row beside the list
    const li = h('li', { class: `tool-row tool-item${listed ? ' tidy' : ''}${isNew(t) ? ' is-new' : ''}${isIdle(u) ? ' is-unused' : ''}${open ? ' is-open' : ''}${listed && SB.toolboxBatch.isPicked(t) ? ' is-picked' : ''}`, dataset: { key } });
    const toggle = h('button', {
      class: 'tool-toggle', type: 'button', 'aria-expanded': String(open), 'aria-controls': open ? (inPane ? 'toolPane' : id) : null,
      onclick: () => toggleRow(li, t),
    },
    h('span', { class: 'tool-name' },
      t.kind === 'mcp' ? h('span', { class: `mcp-dot s-${(t.status || 'unknown').replace(/[^\w-]/g, '')}`, title: t.status || '' }) : null,
      h('code', { text: shown(t) }),
      isNew(t) ? h('span', { class: 'new-pill', text: 'new' }) : null,
      listed && isPinned(t) ? h('span', { class: 'tool-pinned', title: 'Pinned to the start screen', text: '★' }) : null,
      // A group's heading already says where its rows come from.
      inGroup ? null : h('span', { class: 'src-pill', text: t.kind === 'mcp' ? (t.status || '') : sourceLabel(t.source) }),
      listed && t.hides?.length ? h('span', { class: 'src-pill hides', text: 'hides a copy' }) : null),
    t.description ? h('span', { class: 'tool-desc', text: t.description })
      : listed && SB.toolboxBatch.isOwn(t) ? h('span', { class: 'tool-desc missing', text: 'No description, so Claude never picks it' }) : null);
    const crab = t.kind === 'agent' ? SB.crewPill?.(t.name) : null; // its crew crab's level (crew.js)
    const actions = h('div', { class: 'tool-actions' }, crab, quickActions(t));
    li.append(listed ? h('div', { class: 'tool-head' }, lead(t), toggle, numbers(u), actions) : h('div', { class: 'tool-head' }, toggle, actions));
    if (open && !inPane) li.append(toolDetail(t, id));
    return li;
  }

  // Open or close in place, so the list keeps its scroll and the keyboard stays on the row.
  // Wide, one row is open at a time, in the pane beside the list.
  function toggleRow(li, t) {
    const key = `${t.kind}:${t.name}`;
    if (LISTED.has(kind) && SB.toolboxTidy.isWide()) {
      const was = openRows.has(key);
      openRows.clear();
      if (!was) openRows.add(key);
      render();
      return;
    }
    if (!openRows.delete(key)) openRows.add(key);
    const next = toolRow(t);
    li.replaceWith(next);
    next.querySelector('.tool-toggle').focus();
  }

  // ------------------------------------------------------------ grouped by where they come from

  // When the list is everything in A to Z order, it's grouped by where each one comes
  // from. Plugins can bring hundreds, so theirs start folded; yours and the project's open.
  const folded = new Map(); // source → folded, for the groups you've opened or closed
  // (Picking "All plugins" means you came to see them, so they start open there.)
  const isFolded = src => folded.get(src) ?? (src.startsWith('plugin:') && sources[kind] !== 'plugins');
  const groupRank = s => ({ user: 0, project: 1, cli: 2 }[s] ?? 3);
  const groupName = s => (s.startsWith('plugin:') ? s.slice(7) : SOURCE_NAMES[s] || 'Other');

  let groupedView = false; // rows under a heading leave out where they come from
  function grouped(items, q) {
    groupedView = false;
    const s = sources[kind];
    if (q || sort !== 'name' || (s !== 'all' && s !== 'plugins')) return items;
    const srcOf = t => t.source || '';
    const bySrc = new Map();
    for (const t of items) bySrc.set(srcOf(t), [...(bySrc.get(srcOf(t)) || []), t]);
    if (bySrc.size < 2) return items;
    groupedView = true;
    const order = [...bySrc.keys()].sort((a, b) => (groupRank(a) - groupRank(b)) || groupName(a).localeCompare(groupName(b)));
    return order.flatMap(src => [{ head: true, src, rows: bySrc.get(src) }, ...(isFolded(src) ? [] : bySrc.get(src))]);
  }

  // A heading says how many came from there, how many Claude used lately and what they
  // cost together, so a plugin nobody uses shows before it's opened. Your own groups
  // can be picked whole.
  function groupHead({ src, rows }) {
    const open = !isFolded(src);
    const used = rows.filter(t => num(usageOf(t)?.uses) > 0).length;
    const cost = rows.reduce((n, t) => n + num(usageOf(t)?.listTokens), 0);
    const own = rows.filter(SB.toolboxBatch.isOwn);
    return h('li', { class: `tool-group${open ? ' is-open' : ''}` },
      h('button', {
        class: 'tool-group-btn', type: 'button', 'aria-expanded': String(open), dataset: { src },
        onclick: () => {
          folded.set(src, open);
          render();
          [...$('toolList').querySelectorAll('.tool-group-btn')].find(b => b.dataset.src === src)?.focus();
        },
      },
      h('span', { text: groupName(src) }),
      src.startsWith('plugin:') ? h('span', { class: 'tool-group-kind', text: 'plugin' }) : null,
      h('span', { class: 'tool-group-n', text: String(rows.length) })),
    U.has() ? h('span', { class: `tool-group-meta${used ? '' : ' idle'}` }, used ? `${used} used lately` : 'None used lately', cost ? `, ${tok(cost)}` : '') : null,
    open && own.length > 1 ? h('button', { class: 'tool-group-all', type: 'button', onclick: () => SB.toolboxBatch.pickAll(own) }, `Select all ${own.length}`) : null);
  }

  // ------------------------------------------------------------ the tabs, and drawing it all

  function countOf(k) {
    const setup = SB.toolboxSetup;
    if (setup.owns(k)) return setup.count(k);
    if (k === 'lean') return SB.lean.count();
    if (k === 'team') return SB.toolboxTeam.count();
    if (k === 'snippet') return (state.snippets || []).length;
    return state.toolbox ? itemsOf(state.toolbox, k).length : '';
  }

  // The section row, then only that section's kinds below it (none for Lean and Team).
  function syncTabs() {
    const group = GROUP[kind];
    /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#toolGroups [data-group]')).forEach(b => {
      b.setAttribute('aria-selected', String(b.dataset.group === group));
      const n = b.querySelector('.n');
      if (n) n.textContent = countOf(b.dataset.group);
    });
    /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#toolTabs [data-kind]')).forEach(b => {
      const k = b.dataset.kind;
      b.hidden = GROUP[k] !== group;
      const n = b.querySelector('.n');
      if (n) n.textContent = countOf(k);
      b.setAttribute('aria-selected', String(k === kind));
    });
    $('toolTabs').hidden = group === 'lean' || group === 'team' || group === 'shop';
    $('toolFind').hidden = group === 'shop'; // the shop has its own search
  }

  let floatKeep = -1; // the picked bar's button the keyboard was on, until it can go back
  function render() {
    const tb = state.toolbox;
    const list = $('toolList');
    const setup = SB.toolboxSetup;
    setup.refresh(); // hooks and memory: rescanned when stale, re-renders when it lands
    syncTabs();
    SB.crewCard?.(kind === 'agent'); // the helper crabs sit over the Agents list (crew.js)
    SB.toolboxShop?.shown(kind === 'shop'); // Get more draws its own pane (shop.js, which loads after this file)
    $('toolboxBadge').hidden = true;

    const search = $('toolSearch');
    const what = SEARCH_WHAT[kind] || 'tools';
    if (search.placeholder !== `Search ${what}…`) { search.placeholder = `Search ${what}…`; search.setAttribute('aria-label', `Search ${what}`); }
    const listed = LISTED.has(kind) && !D.editing(kind);
    $('toolSource').hidden = $('toolSort').hidden = !listed;
    list.classList.toggle('is-tidy', listed);
    // The picked bar is rebuilt below. Keep the keyboard on its button, even through the redraw
    // where they're all disabled while one works (focus can't land there, so it waits for the next).
    const floatAt = SB.toolboxTidy.focusAt($('toolFloat'));
    if (floatAt >= 0) floatKeep = floatAt;
    $('toolFloat').replaceChildren();
    SB.toolboxTidy.show(null); // the rail and pane come back below, for a list

    const q = search.value.trim().toLowerCase();
    if (setup.owns(kind)) { $('setupPane').hidden = false; setup.render(kind, q); return; }
    setup.hide();
    if (kind === 'shop') { list.hidden = true; return; }
    if (kind === 'lean') return SB.lean.render(q);
    if (kind === 'snippet') return SB.toolboxSnippets.render(q);
    if (kind === 'mod') return SB.toolboxMods.render(q);
    if (kind === 'team') return SB.toolboxTeam.render(q);
    if (D.showEditor(kind, tb)) return; // one of your own open in the editor, in place of the list
    if (kind === 'mcp') {
      const key = SB.toolboxMcp.paneKey();
      $('setupPane').hidden = false;
      if ($('setupPane').dataset.mounted !== key) { $('setupPane').replaceChildren(...SB.toolboxMcp.pane()); $('setupPane').dataset.mounted = key; }
    }
    if (!tb) { list.replaceChildren(h('li', { class: 'history-empty', text: 'Scanning…' })); return; }
    if (kind !== 'mcp' && !U.tried()) U.load();
    const all = itemsOf(tb, kind);
    if (listed) syncSourcePicker(all);
    const order = listed && U.has() ? SORTS[sort] : SORTS.name;
    const items = all
      .filter(t => !listed || fromSource(t))
      .filter(t => !q || t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q))
      .filter(t => !listed || !only || ONLY[only](t))
      .sort(order);
    const batch = SB.toolboxBatch;
    shownOwn = listed ? items.filter(batch.isOwn) : [];
    const entries = grouped(items, q || only);
    // What needs a look and what you can do to many: one line over the list. Picked, a bar floats under it.
    const healthRow = listed ? batch.topLine(tb, { only, pick: pickHealth, shownOwn, grouped: groupedView }) : null;
    const parkedRows = listed ? batch.parkedRows(kind === 'tool' ? MERGED : [kind], q) : [];
    if (listed) {
      const bar = batch.floatBar(shownOwn);
      if (bar) $('toolFloat').append(bar);
      const back = /** @type {HTMLButtonElement | undefined} */ (bar?.querySelectorAll('button')[floatKeep]);
      if (back && !back.disabled && (floatAt >= 0 || document.activeElement === document.body)) { back.focus({ preventScroll: true }); floatKeep = -1; }
      if (!bar) floatKeep = -1;
      // Wide, one row is open at a time (the last one opened), in the pane.
      if (SB.toolboxTidy.isWide() && openRows.size > 1) { const last = [...openRows].pop(); openRows.clear(); openRows.add(last); }
      list.classList.toggle('is-picking', !!bar);
      SB.toolboxTidy.show({ items, open: items.find(t => openRows.has(`${t.kind}:${t.name}`)) || null });
    }
    if (!items.length) {
      const hint = q || only || (listed && sources[kind] !== 'all') ? 'No matches.' : {
        tool: 'No skills, agents or commands yet. Ask Shellby: "build yourself a skill that…"',
        skill: 'No skills yet. Ask Shellby: "build yourself a skill that…"',
        agent: 'No custom agents yet. Ask Shellby to create one in ~/.claude/agents.',
        command: 'No custom slash commands yet.',
        mcp: 'No MCP servers connected.',
      }[kind];
      list.replaceChildren(...[healthRow, h('li', { class: 'history-empty', text: hint }), ...parkedRows].filter(Boolean));
      return;
    }
    U.setMax(items);
    const refocus = focusedIn(list);
    // What the two columns of numbers are, once usage is here to fill them.
    const cols = listed && U.has() ? h('li', { class: 'tool-cols', 'aria-hidden': 'true' }, h('span', { text: 'Used', title: 'How often Claude used it lately, and when last' }), h('span', { text: 'Tokens', title: 'What its name and description cost in every conversation' })) : null;
    list.replaceChildren(...[healthRow, listed ? U.sortNote(sort) : null, cols, ...page(entries), ...parkedRows].filter(Boolean));
    refocus();
  }

  // A count in the health line: servers open the MCP tab, the rest filter this list.
  function pickHealth(k) {
    only = null;
    if (k === 'mcp') { choose('mcp'); return; }
    only = k;
    render();
  }

  // A redraw (a rescan, usage landing a moment after you clicked) replaces every
  // row, which would drop the keyboard at the top of the page. Put it back on the
  // same heading, or the same button of the same row.
  function focusedIn(list) {
    const a = /** @type {HTMLElement | null} */ (document.activeElement);
    if (!a || a === list || !list.contains(a)) return () => {};
    const head = /** @type {HTMLElement | null} */ (a.closest('.tool-group-btn'));
    const row = /** @type {HTMLElement | null} */ (a.closest('.tool-row[data-key]'));
    if (!head && !row) return () => {};
    const nth = head || !row ? -1 : [...row.querySelectorAll('button')].indexOf(/** @type {any} */ (a));
    return () => {
      const el = head
        ? [...list.querySelectorAll('.tool-group-btn')].find(b => b.dataset.src === head.dataset.src)
        : [...list.querySelectorAll('.tool-row[data-key]')].find(r => r.dataset.key === row?.dataset.key);
      const target = nth >= 0 ? el?.querySelectorAll('button')[nth] : el;
      target?.focus({ preventScroll: true });
    };
  }

  // The first PAGE rows, then a line saying how many more there are. Headings don't count,
  // and a folded group's heading always shows: it has no rows to wait for.
  let shownRows = PAGE;
  let shownFor = '';
  function page(entries) {
    const forKey = `${kind}|${$('toolSearch').value.trim().toLowerCase()}|${sources[kind] || ''}|${sort}|${only || ''}`;
    if (forKey !== shownFor) { shownRows = PAGE; shownFor = forKey; }
    const total = entries.reduce((n, e) => n + (e.head ? 0 : 1), 0);
    const out = [];
    let n = 0;
    for (const e of entries) {
      if (e.head) { if (n < shownRows || total <= shownRows || isFolded(e.src)) out.push(groupHead(e)); }
      else if (n < shownRows) { out.push(toolRow(e)); n++; }
    }
    if (total <= shownRows) return out;
    const more = to => () => {
      const first = shownRows;
      shownRows = to;
      render();
      // Carry on from the first new row rather than dropping the keyboard at the top.
      $('toolList').querySelectorAll('.tool-row')[first]?.querySelector('button')?.focus();
    };
    return [...out, h('li', { class: 'tool-more', role: 'status' },
      `Showing ${shownRows} of ${total}.`,
      h('button', { class: 'btn ghost slim-btn', type: 'button', onclick: more(shownRows + PAGE) }, `Show ${Math.min(PAGE, total - shownRows)} more`),
      total - shownRows > PAGE ? h('button', { class: 'btn ghost slim-btn', type: 'button', onclick: more(total) }, 'Show all') : null)];
  }

  /** @type {ReturnType<typeof setTimeout> | null} */
  let searchWait = null;
  function choose(k) {
    clearTimeout(searchWait ?? undefined);
    kind = GROUP[ALIAS[k] || k] ? ALIAS[k] || k : 'tool';
    lastKind[GROUP[kind]] = kind;
    saveView();
    render();
  }
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#toolGroups [data-group]')).forEach(b => b.addEventListener('click', () => choose(lastKind[b.dataset.group ?? ''])));
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#toolTabs [data-kind]')).forEach(b => b.addEventListener('click', () => choose(b.dataset.kind)));
  $('toolSearch').addEventListener('input', () => {
    clearTimeout(searchWait ?? undefined);
    searchWait = setTimeout(() => { if (state.view === 'toolbox') render(); }, SEARCH_WAIT_MS);
  });
  $('toolSource').addEventListener('change', e => { sources[kind] = e.target.value; saveView(); render(); });
  $('toolSort').addEventListener('change', e => {
    sort = e.target.value;
    saveView();
    if (sort !== 'name' && !U.has() && !U.loading()) U.retry();
    render();
  });
  $('rescanBtn').addEventListener('click', async () => {
    [state.toolbox] = await Promise.all([api.rescanToolbox(), SB.toolboxSetup.reload(), SB.toolboxTeam.refresh()]);
    U.retry(true);
    render();
    SB.toast('Toolbox rescanned');
  });

  SB.onLearned = (trick) => {
    state.learned = [{ ...trick, at: Date.now() }, ...(state.learned || []).filter(l => !(l.kind === trick.kind && l.name === trick.name))];
    if (trick.kind === 'mod') return newMod(trick);
    const noun = { skill: 'skill', agent: 'helper agent', command: 'command' }[trick.kind] || 'trick';
    if (state.view === 'toolbox') render();
    else $('toolboxBadge').hidden = false;
    SB.toast(`✦ Shellby learned a new ${noun}: ${trick.name}`, { action: 'Pin it', onAction: async () => {
      state.pinned = await api.pinTool(trick.kind, trick.name, true);
      SB.refreshEmptyStates();
      SB.toast(`Pinned ${trick.name}`);
    } });
  };

  // A mod showed up in ~/.claude/skills (main's toolbox.js): it loads in every
  // conversation without asking, so the toast says so and offers a look.
  function newMod(mod) {
    if (state.view === 'toolbox') render();
    else $('toolboxBadge').hidden = false;
    SB.toast(`🧩 New mod: ${mod.name}. It runs inside every Claude Code conversation${mod.enabled ? '' : ' once turned on'}.`, {
      ms: 9000, action: 'Look at it', onAction: () => SB.toolboxMods.show(mod.id),
    });
  }

  // /permissions, /mcp: straight to that tab.
  // The tab is picked first, so the Toolbox draws once, on it.
  SB.showToolbox = (k) => {
    const to = ALIAS[k] || k;
    if (GROUP[to]) {
      clearTimeout(searchWait ?? undefined);
      kind = to;
      lastKind[GROUP[kind]] = kind;
      saveView();
    }
    SB.setView('toolbox');
  };

  // Leaving the Toolbox puts the Crew card and Get more away, so coming back is an
  // arrival again: a fresh roster, the plugin list loaded and the visit counted.
  const setView = SB.setView;
  SB.setView = target => {
    setView(target);
    if (state.view === 'toolbox') return;
    SB.crewCard?.(false);
    SB.toolboxShop?.shown(false);
  };

  loadView();
  $('toolSort').value = sort;
  SB.toolboxUsage.init({ render });
  SB.toolboxDetail.init({ render, choose, focusRow, kind: () => kind, forget: key => openRows.delete(key), listKey, merged: MERGED });
  SB.toolboxBatch.init({ render, isIdle: t => isIdle(usageOf(t)) });
  SB.toolboxMcp.init(render);
  SB.toolboxTidy.init({
    render, usageOf, hasUsage: U.has, glyph: t => GLYPH[t.kind], detail: toolDetail, sourceLabel,
    actions: t => [t.kind === 'agent' ? SB.crewPill?.(t.name) : null, quickActions(t)],
    name: shown, noun: t => NOUN[t.kind],
    close: () => {
      const key = [...openRows].pop();
      openRows.clear();
      render();
      if (key) focusRow(key, '.tool-toggle');
    },
  });

  SB.views.toolbox = { render };
})();
