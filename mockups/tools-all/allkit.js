// What Tools > All does today (src/renderer/panel/toolbox.js and
// toolbox-batch.js), as one store every mockup draws from. The three
// directions differ only in how they lay it out.
(function () {
  'use strict';
  const T = window.TB;

  const SOURCE_NAMES = { user: 'Yours', project: 'This project', cli: 'Built in' };
  const SORTS = [['name', 'A to Z'], ['used', 'Most used'], ['unused', 'Unused first']];
  const KIND_NAMES = { skill: 'Skill', agent: 'Agent', command: 'Command' };
  const PAGE = 150;

  const label = t => (t.kind === 'agent' ? t.name : `/${t.name}`);
  const isOwn = t => (t.source === 'user' || t.source === 'project') && !!t.path;
  const isPlugin = s => (s || '').startsWith('plugin:');
  const sourceLabel = s => (isPlugin(s) ? s.slice(7) : { user: 'yours', project: 'this project', cli: 'built in' }[s] || s);
  const groupName = s => (isPlugin(s) ? s.slice(7) : SOURCE_NAMES[s] || 'Other');
  const groupRank = s => ({ user: 0, project: 1, cli: 2 }[s] ?? 3);
  const bySource = (a, b) => (groupRank(a) - groupRank(b)) || groupName(a).localeCompare(groupName(b));

  function create(phone) {
    const d = T.clone();
    const st = {
      items: d.items, parked: d.parked, q: '', kind: 'all', source: 'all', sort: 'name', only: null,
      picked: new Set(), anchor: null, open: null, folded: new Map(), pinned: new Set(d.items.filter(t => t.pinned).map(t => t.id)),
      shown: PAGE, busy: false,
    };
    const subs = new Set();
    const changed = () => subs.forEach(fn => fn());
    const toast = (text, undo) => T.toast(phone, text, undo);
    const byId = id => st.items.find(t => t.id === id);

    const isIdle = t => !t.uses;
    const isPinned = t => st.pinned.has(t.id);

    // ---------------------------------------------------------------- what's listed
    const inKind = t => st.kind === 'all' || t.kind === st.kind;
    const fromSource = t => st.source === 'all' || (st.source === 'plugins' ? isPlugin(t.source) : t.source === st.source);
    const ONLY = { nodesc: t => isOwn(t) && !t.desc, dupes: t => t.hides.length > 0, unused: isIdle, pinned: isPinned, new: t => t.isNew };
    const matches = t => {
      const q = st.q.trim().toLowerCase();
      return !q || t.name.toLowerCase().includes(q) || (t.desc || '').toLowerCase().includes(q) || sourceLabel(t.source).includes(q);
    };
    const byName = (a, b) => a.name.localeCompare(b.name);
    const ORDER = {
      name: (a, b) => (b.isNew - a.isNew) || (isPinned(b) - isPinned(a)) || byName(a, b),
      used: (a, b) => (b.uses - a.uses) || ((a.lastUsed ?? 999) - (b.lastUsed ?? 999)) || byName(a, b),
      unused: (a, b) => (!!a.uses - !!b.uses) || (b.listTokens - a.listTokens) || byName(a, b),
    };

    function list() {
      return st.items.filter(t => inKind(t) && fromSource(t) && matches(t) && (!st.only || ONLY[st.only](t))).sort(ORDER[st.sort]);
    }
    // Grouped by where they come from when it's everything, A to Z, unsearched.
    const isGrouped = () => !st.q.trim() && !st.only && st.sort === 'name' && (st.source === 'all' || st.source === 'plugins');
    const isFolded = src => st.folded.get(src) ?? (isPlugin(src) && st.source !== 'plugins');
    function groups(items = list()) {
      const map = new Map();
      for (const t of items) { if (!map.has(t.source)) map.set(t.source, []); map.get(t.source).push(t); }
      return [...map.keys()].sort(bySource).map(src => {
        const rows = map.get(src);
        return { src, name: groupName(src), plugin: isPlugin(src), rows, folded: isFolded(src),
          tokens: T.total(rows.map(t => t.listTokens)), used: rows.filter(t => t.uses).length, uses: T.total(rows.map(t => t.uses)) };
      });
    }
    function sources() {
      const kinded = st.items.filter(inKind);
      const n = new Map();
      for (const t of kinded) n.set(t.source, (n.get(t.source) || 0) + 1);
      const plugins = [...n.keys()].filter(isPlugin).sort(bySource);
      return {
        main: [['all', 'All', kinded.length], ...['user', 'project', 'cli'].filter(s => n.has(s)).map(s => [s, SOURCE_NAMES[s], n.get(s)]),
          ...(plugins.length ? [['plugins', 'All plugins', T.total(plugins.map(p => n.get(p)))]] : [])],
        plugins: plugins.map(s => [s, s.slice(7), n.get(s)]),
      };
    }
    const kinds = () => ['all', 'skill', 'agent', 'command'].map(k => [k, k === 'all' ? 'All' : `${KIND_NAMES[k]}s`, k === 'all' ? st.items.length : st.items.filter(t => t.kind === k).length]);

    // ---------------------------------------------------------------- the health line
    function health() {
      const noDesc = st.items.filter(t => isOwn(t) && !t.desc).length;
      const dupes = st.items.filter(t => t.hides.length).length;
      return [
        d.mcpDown ? { key: 'mcp', text: `${T.count(d.mcpDown, 'MCP server')} down`, short: `${d.mcpDown} server down`, tone: 'coral', title: 'Waiting for you to sign in. Opens the MCP tab.' } : null,
        noDesc ? { key: 'nodesc', text: `${noDesc} without a description`, short: `${noDesc} no description`, tone: 'amber', title: 'Claude picks by description, so these rarely get used' } : null,
        dupes ? { key: 'dupes', text: `${dupes} hiding another copy`, short: `${dupes} hidden copy`, tone: 'amber', title: 'Same name in more than one place: only one of them loads' } : null,
      ].filter(Boolean);
    }

    // ---------------------------------------------------------------- what a row knows
    const stats = t => [
      t.uses ? `Used ${t.uses}× lately` : 'Not used lately',
      t.lastUsed != null ? `last ${T.ago(t.lastUsed)}` : null,
      `~${T.tok(t.listTokens)} tokens in every conversation`,
      `~${T.tok(t.useTokens)} each use`,
    ].filter(Boolean);
    function whereFrom(t) {
      if (isPlugin(t.source)) return `Comes with the ${t.source.slice(7)} plugin. Turn it off or remove it in Get more.`;
      return { user: 'Yours: it’s in your own Claude folder, so every project has it.', project: 'This project’s: it’s in the repo, so anyone working here has it too.', cli: 'Built into Claude Code.' }[t.source];
    }
    // Claude picks skills by description alone: an idle one, or one with none, gets a nudge.
    function hint(t) {
      if (isOwn(t) && !t.desc) return { text: 'It has no description, and Claude decides from the description alone, so it never reaches for this.', act: 'Write one with Claude' };
      if (t.kind !== 'skill' || !isIdle(t)) return null;
      return isOwn(t)
        ? { text: 'Claude hasn’t reached for this lately. One that says plainly when to use it, in the words you’d use, gets used.', act: 'Sharpen its description with Claude' }
        : { text: 'Claude hasn’t reached for this lately. If you never need it, turning its plugin off saves room in every conversation.', act: null };
    }
    const maxList = () => Math.max(1, ...list().map(t => t.listTokens));

    // ---------------------------------------------------------------- picking many
    function pick(t, on, shift, shownOwn) {
      const keys = shownOwn.map(x => x.id);
      const from = st.anchor ? keys.indexOf(st.anchor) : -1;
      const to = keys.indexOf(t.id);
      const range = shift && from >= 0 && to >= 0 ? keys.slice(Math.min(from, to), Math.max(from, to) + 1) : [t.id];
      for (const k of range) { if (on) st.picked.add(k); else st.picked.delete(k); }
      st.anchor = t.id;
      changed();
    }
    // Only what you can see stays picked, so the bar never acts on something off screen.
    function prune(shownOwn) {
      const live = new Set(shownOwn.map(t => t.id));
      for (const k of [...st.picked]) if (!live.has(k)) st.picked.delete(k);
    }
    const picked = () => st.items.filter(t => st.picked.has(t.id));

    // ---------------------------------------------------------------- actions (the mock answers for main)
    const actions = {
      use: t => toast(`${label(t)} is in the message box`),
      chatAs: t => toast(`New conversation as ${t.name}`),
      pin(t) {
        const on = !isPinned(t);
        if (on) st.pinned.add(t.id); else st.pinned.delete(t.id);
        toast(on ? `Pinned ${label(t)} to the start screen` : `Unpinned ${label(t)}`);
        changed();
      },
      pinMany(on) {
        const sel = picked();
        for (const t of sel) { if (on) st.pinned.add(t.id); else st.pinned.delete(t.id); }
        toast(`${on ? 'Pinned' : 'Unpinned'} ${sel.length}`);
        changed();
      },
      park(ids = [...st.picked]) {
        const gone = st.items.filter(t => ids.includes(t.id) && isOwn(t));
        const skipped = ids.length - gone.length;
        const before = { items: st.items, parked: st.parked };
        st.items = st.items.filter(t => !gone.includes(t));
        st.parked = [...gone.map(t => ({ id: t.id, kind: t.kind, name: t.name, desc: t.desc, at: 0, was: t })), ...st.parked];
        st.picked.clear();
        toast(`Parked ${gone.length}. New conversations won’t load ${gone.length === 1 ? 'it' : 'them'}.${skipped ? ` ${skipped} left alone (a plugin’s or built in).` : ''}`, () => { Object.assign(st, before); changed(); });
        changed();
      },
      parkUnused() { actions.park(st.items.filter(t => isOwn(t) && isIdle(t) && inKind(t)).map(t => t.id)); },
      restore(ids) {
        const back = st.parked.filter(p => ids.includes(p.id));
        st.items = [...st.items, ...back.map(p => p.was || Object.freeze({ id: p.id, kind: p.kind, name: p.name, source: 'user', desc: p.desc, uses: 0, lastUsed: null, listTokens: 40, useTokens: 2200, isNew: false, pinned: false, path: `C:\\Users\\you\\.claude\\${p.kind}s\\${p.name}.md`, hides: [] }))];
        st.parked = st.parked.filter(p => !ids.includes(p.id));
        toast(`Restored ${back.length}`);
        changed();
      },
      remove(ids = [...st.picked]) {
        const gone = st.items.filter(t => ids.includes(t.id) && isOwn(t));
        const before = st.items;
        st.items = st.items.filter(t => !gone.includes(t));
        st.picked.clear();
        if (gone.some(t => t.id === st.open)) st.open = null;
        toast(`Moved ${gone.length} to the Recycle Bin`, () => { st.items = before; changed(); });
        changed();
      },
      exportPicked: () => toast(`Exported ${st.picked.size} to Downloads\\shellby-tools.json`),
      importTools: () => toast('Added 3 to your Claude folder. 1 you already had.'),
      sharpen: t => toast(`New conversation: Claude rewrites ${label(t)}’s description`),
      edit: t => toast(`Editing ${label(t)} here (Ctrl+S saves)`),
      showFile: () => toast('Opened its folder in Explorer'),
      rescan: () => toast('Toolbox rescanned'),
      openMcp: () => toast('Opens the MCP tab: github is waiting for you to sign in'),
    };

    // ---------------------------------------------------------------- setters
    const set = patch => {
      Object.assign(st, patch);
      if ('q' in patch || 'source' in patch || 'sort' in patch || 'only' in patch || 'kind' in patch) st.shown = PAGE;
      changed();
    };
    const toggleFold = src => { st.folded.set(src, !isFolded(src)); changed(); };
    const toggleOpen = id => { st.open = st.open === id ? null : id; changed(); };

    return {
      st, d, PAGE, SORTS, KIND_NAMES, label, isOwn, isIdle, isPinned, isPlugin, sourceLabel, groupName,
      list, groups, isGrouped, sources, kinds, health, stats, whereFrom, hint, maxList, pick, prune, picked, byId,
      actions, set, toggleFold, toggleOpen, toast,
      on: fn => { subs.add(fn); return () => subs.delete(fn); },
    };
  }

  window.AK = Object.freeze({ create, label, SORTS });
})();
