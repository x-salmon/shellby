/* Shellby panel — Toolbox → Lean, the bar. Everything a turn carries before
   your first word as one stacked bar coloured by part (main's fixedcost.js
   parts), a legend, a row per part with its tokens, its share of a turn and
   the cut on offer, and a card that adds the cuts up. A cut that is safe to
   do (the output style, an idle plugin) goes through its confirm window
   (lean-fixes.js); the rest (a section to move, a hook to quieten, an MCP
   server's tool list) open as a draft prompt in a new tab for you to read and
   send. "Take all" does each in turn. Nothing here writes a file by itself. */
'use strict';
(function () {
  const { h, state } = SB;
  const WINDOW_TOKENS = 200000;   // the usual context window, for "N% of a window"
  const MAX_NAMED = 4;            // members named on a row before "and N more"
  const WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const PART = {
    rest: { name: "Claude Code's own prompt and tools", short: 'Claude Code' },
    mcp: { name: 'MCP tool lists', short: 'MCP' },
    plugins: { name: 'Plugins', short: 'plugins' },
    skills: { name: 'Skill descriptions', short: 'skills' },
    memory: { name: 'CLAUDE.md and rules', short: 'CLAUDE.md' },
    style: { name: 'Output style', short: 'style' },
    hooks: { name: 'Hooks', short: 'hooks' },
  };
  const k = n => SB.compact(Math.round(n));
  const pct = r => `${Math.round(r * 100)}%`;
  const count = n => (n < WORDS.length ? WORDS[n] : String(n));
  const rerender = () => { if (state.view === 'toolbox') SB.views.toolbox.render(); };
  let taking = false;             // "Take all" is working through the cuts

  // ------------------------------------------------------------ drafts for Claude (a new tab, unsent)

  const MOVE_ASK = s => `My global Claude Code memory file, ${s.path}, has a section "${s.heading}" (from line ${s.line}, about ${k(s.saves)} tokens) that only the ${s.project} project uses, yet every project carries it with every message. Move it into ${s.project}'s own CLAUDE.md at that project's root: show me both files as diffs, the section taken out of the global file and added to the project's word for word, and ask me where ${s.project} is if you can't find it. Do not edit anything until I say so.`;
  const HOOK_ASK = s => `The Claude Code hook ${s.label} adds about ${k(s.saves)} tokens to every message I send, and each copy stays in the conversation. Find where it is set up (~/.claude/settings.json, the project's .claude/settings.json or a plugin's hooks), read what it prints, and propose a version that prints only when something changed, or that moves standing instructions into CLAUDE.md. Show the change as a diff. Do not edit anything until I say so.`;
  // Per-tool cuts are advice only: Shellby can't list a server's tools, and only a
  // settings deny rule naming each one (mcp__<server>__<tool>) takes it out of the list.
  const MCP_ASK = names => `These MCP servers list their tools for Claude in every call: ${names.join(', ')}. For each, list its tools and ask me which I actually use rather than guessing. Then propose permissions.deny rules for my ~/.claude/settings.json naming the ones I never use (mcp__<server>__<tool>), which takes them out of the tool list, shown as a diff. Claude Code already defers MCP tools behind tool search once their descriptions pass a tenth of the context window, so say whether that covers me already. Do not edit anything until I say so.`;
  const DRAFT_HEAD = 'A few ways to make what every Claude Code conversation carries leaner, from the Lean tab in Shellby. Take them one at a time, propose each as a diff, and edit nothing until I say so.';

  function draftFor(s) {
    if (s.kind === 'move') return MOVE_ASK(s);
    if (s.kind === 'hook') return HOOK_ASK(s);
    if (s.kind === 'mcp') return MCP_ASK(s.names);
    return null;
  }

  function openDraft(text) {
    SB.setView('chat');
    SB.newTabIn({ cwd: state.cwd, draft: text });
  }

  // ------------------------------------------------------------ the parts

  /** A part's members, in a few words: "global 1.3k · ts.md 0.9k". */
  function detail(part, items, rep) {
    const named = items.slice(0, MAX_NAMED);
    const more = items.length > MAX_NAMED ? ` · and ${items.length - MAX_NAMED} more` : '';
    const size = it => (it.tokens == null ? 'not sized' : k(it.tokens));
    if (part.key === 'rest') return rep.fixed.measured ? 'the same for everyone · measured on the last fresh start' : '';
    if (part.key === 'skills') return `${items[0]?.count || 0} listed`;
    if (part.key === 'style') return items[0]?.source === 'shellby' ? 'Settings → Claude' : `${SB.basename(items[0]?.file || 'settings.json')} · outputStyle`;
    if (part.key === 'mcp') return `${named.map(it => it.label).join(' · ')}${more} · Shellby can't size their tool lists`;
    if (part.key === 'hooks') return `${named.map(it => `${it.label} ${size(it)}${it.when === 'message' ? ' every message' : ''}`).join(' · ')}${more}`;
    return `${named.map(it => `${it.kind === 'memory' || it.kind === 'rule' ? SB.basename(it.path || it.label) : it.label} ${size(it)}`).join(' · ')}${more}`;
  }

  function nameOf(part, items) {
    if (part.key !== 'style') return PART[part.key]?.name || part.key;
    const m = /"(.+)"/.exec(items[0]?.label || '');
    return m ? `Output style: ${m[1]}` : 'Output style';
  }

  /** The cuts on a part's row: its suggestions, or a word on why there is none. */
  function cutsFor(part, rep, items) {
    const mine = rep.fixed.suggestions.filter(s => s.part === part.key);
    if (mine.length) return mine;
    if (part.key === 'mcp') {
      return [{ id: 'mcp-tools', kind: 'mcp', names: items.map(it => it.label), saves: 0, action: null, short: 'Claude Code lists every tool in each call; a deny rule for the ones you never use takes them out.' }];
    }
    if (part.key === 'skills') {
      const idle = (rep.skills || []).filter(t => t.idle).length;
      if (idle) return [{ id: 'skills-idle', kind: 'none', saves: 0, short: `${idle} of them ${idle === 1 ? 'hasn\'t' : 'haven\'t'} been used in ${rep.idleDays} days: ${idle === 1 ? 'it has' : 'each has'} Remove… on its row below.` }];
    }
    return [{ id: 'none', kind: 'none', saves: 0, short: 'Nothing to cut here.' }];
  }

  async function doCut(s) {
    if (s.action?.type === 'style-off') return SB.leanFixes.styleOff(s);
    if (s.action?.type === 'plugin-off') return SB.leanFixes.pluginOff(s);
    const draft = draftFor(s);
    if (draft) openDraft(draft);
    return null;
  }

  function cutEl(s) {
    const working = SB.leanFixes.isBusy(s.id);
    const button = s.action
      ? h('button', { class: 'btn slim-btn lean-cut-btn', type: 'button', disabled: taking || working, title: s.action.type === 'style-off' ? 'Shellby asks first, and Undo puts it back' : 'Shellby asks first; the plugin stays installed', onclick: () => doCut(s) }, working ? '…' : 'Turn off')
      : draftFor(s)
        ? h('button', { class: 'btn ghost slim-btn lean-cut-btn', type: 'button', title: 'Opens a new tab with a prompt for you to read and send. Claude proposes a diff; nothing changes until you say so.', onclick: () => doCut(s) }, 'Draft it')
        : null;
    return h('div', { class: `lean-cut${s.kind === 'none' ? ' is-none' : ''}`, dataset: { id: s.id } },
      h('span', { class: 'lean-cut-text', title: s.text || null },
        s.short || s.text,
        s.saves ? h('b', { class: 'lean-less', title: 'What it saves on every call', text: ` −${k(s.saves)}` }) : null),
      button);
  }

  function partRow(part, rep, largest) {
    const items = part.keys.map(key => rep.fixed.items.find(it => it.key === key)).filter(Boolean);
    const sized = part.tokens != null;
    return h('li', { class: `lean-part is-${part.key}`, dataset: { part: part.key } },
      h('span', { class: 'lean-key', 'aria-hidden': 'true' }),
      h('span', { class: 'lean-part-name' },
        h('b', { text: nameOf(part, items) }),
        h('small', { text: detail(part, items, rep) })),
      h('span', { class: `lean-part-tok${sized ? '' : ' is-unsized'}`, text: sized ? k(part.tokens) : 'not sized' }),
      h('span', { class: 'lean-share', title: sized ? 'Its share of what every call carries before your words' : 'Shellby can\'t size this one' },
        h('span', { class: 't' }, h('i', { style: `--w: ${sized && largest ? Math.max(2, Math.round(part.tokens / largest * 100)) : 0}%` })),
        h('span', { text: sized && part.share != null ? `${pct(part.share)} of a turn` : '' })),
      h('div', { class: 'lean-part-cuts' }, ...cutsFor(part, rep, items).map(cutEl)));
  }

  // ------------------------------------------------------------ the bar and its card

  function before(rep) {
    const fx = rep.fixed;
    const parts = fx.parts;
    const sized = parts.filter(p => p.tokens);
    const s = rep.setup;
    const basis = fx.measured && s ? `measured ${SB.relTime(s.at)} in ${s.name}` : 'added up from the parts; measured the next time a conversation starts';
    return h('section', { class: 'lean-fc-before' },
      h('div', { class: 'lean-fc-top' },
        h('h3', { text: 'Before your first word' }),
        h('p', { class: 'lean-fc-sum' }, h('b', { text: k(fx.total) }), ` tokens on every call · ${pct(fx.total / WINDOW_TOKENS)} of a 200k window · ${basis} · cached after the first call`)),
      h('div', { class: 'lean-fc-bar', role: 'img', 'aria-label': sized.map(p => `${PART[p.key]?.name || p.key} ${k(p.tokens)}`).join(', ') },
        ...sized.map(p => h('i', { class: `is-${p.key}`, style: `--g: ${p.tokens}`, dataset: { l: `${PART[p.key]?.short || p.key} ${k(p.tokens)}` }, title: `${PART[p.key]?.name || p.key}: ${k(p.tokens)} tokens` }))),
      h('div', { class: 'lean-fc-legend' },
        ...parts.map(p => h('span', { class: `is-${p.key}` }, h('span', { class: 'lean-key', 'aria-hidden': 'true' }), `${PART[p.key]?.name || p.key} `, h('b', { text: p.tokens == null ? 'not sized' : k(p.tokens) })))));
  }

  async function takeAll(cuts) {
    if (taking) return;
    taking = true;
    rerender();
    try {
      // Each switch asks in its confirm window; Cancel on one moves on to the next.
      // Another question already up (busy) means stop here, not pile up behind it.
      for (const c of cuts.filter(x => x.action)) {
        const r = await doCut(c);
        if (r?.busy) return;
      }
      const drafts = cuts.filter(x => !x.action).map(draftFor).filter(Boolean);
      if (drafts.length) openDraft([DRAFT_HEAD, ...drafts].join('\n\n'));
    } finally {
      taking = false;
      rerender();
    }
  }

  // The cuts the card adds up: those with a row above (a suggestion is always about an item, but never trust it).
  const cutsOf = fx => fx.suggestions.filter(s => fx.parts.some(p => p.key === s.part));

  function howText(acts, drafts) {
    const ask = acts === 1 ? 'Shellby asks before the switch in the confirm window' : `Shellby asks before each of the ${count(acts)} switches in the confirm window`;
    const draft = acts
      ? `the ${drafts === 1 ? 'other opens' : `${count(drafts)} others open`} as one draft in a new tab for you to read`
      : `${drafts === 1 ? 'It opens' : 'They open'} as one draft in a new tab for you to read`;
    return `${acts ? ask : ''}${acts && drafts ? '; ' : ''}${drafts ? draft : ''}. Nothing here edits a file by itself.`;
  }

  function takeCard(rep) {
    const fx = rep.fixed;
    const cuts = cutsOf(fx);
    if (!cuts.length) return null;
    const saves = cuts.reduce((n, s) => n + (s.saves || 0), 0);
    const acts = cuts.filter(s => s.action).length;
    const drafts = cuts.length - acts;
    const all = cuts.length === 1 ? 'this one' : `all ${count(cuts.length)}`;
    return h('section', { class: 'lean-take' },
      h('h3', { text: `If you take ${all}` }),
      h('div', { class: 'lean-take-numbers' },
        h('span', {}, h('span', { class: 'n', text: k(fx.total) }), h('small', { text: 'on every call now' })),
        h('span', { class: 'arrow', 'aria-hidden': 'true', text: '→' }),
        h('span', { class: 'after' }, h('span', { class: 'n', text: k(Math.max(0, fx.total - saves)) }), h('small', { text: 'after' }))),
      h('p', {}, 'Up to ', h('b', { text: `${k(saves)} less on every call` }), ', and the first call in each new tab would be cheaper too.'),
      h('p', { text: howText(acts, drafts) }),
      h('button', { class: 'btn primary lean-take-btn', type: 'button', disabled: taking, onclick: () => takeAll(cuts) }, taking ? (cuts.length === 1 ? 'Working on it…' : 'Working through them…') : `${acts ? 'Take' : 'Draft'} ${cuts.length === 1 ? 'it' : all}`));
  }

  function cacheCard(rep) {
    const c = rep.cache.week;
    const was = rep.cache.lastWeek;
    const week = c.rate == null
      ? 'No calls this week yet.'
      : `${pct(c.rate)} of your input came from the cache${was.rate == null ? '' : ` (last week ${pct(was.rate)})`}: ${SB.compact(c.saved)} tokens' worth billed at a tenth.`;
    return h('section', { class: 'lean-cache-card' },
      h('h3', { text: 'What the cache does' }),
      h('dl', {},
        h('dt', { text: 'Cached' }), h('dd', {}, 'After the first call, this setup is read from the prompt cache: ', h('b', { text: 'about a tenth' }), ' of the price.'),
        h('dt', { text: 'Still counts' }), h('dd', { text: 'It\'s in every call\'s input all the same, and after about 5 minutes idle the cache goes cold and it\'s full price again.' }),
        h('dt', { text: 'This week' }), h('dd', { class: 'lean-cache', text: week })));
  }

  /**
   * The whole block, for the Lean tab's summary; null when nothing has been sized
   * yet. match: the tab's search, which narrows the rows (by their words) and
   * leaves the picture, the bar and the cards, as it is.
   * @param {any} rep
   * @param {(s: string) => boolean} [match]
   */
  function block(rep, match = () => true) {
    const fx = rep?.fixed;
    if (!fx?.total) return null;
    const largest = Math.max(0, ...fx.parts.map(p => p.tokens || 0));
    const rows = fx.parts.map(p => partRow(p, rep, largest)).filter(li => match(li.textContent || ''));
    return h('div', { class: 'lean-fc' },
      before(rep),
      rows.length ? h('ul', { class: 'lean-parts', 'aria-label': 'The parts of every call, and what could go' }, ...rows) : null,
      h('aside', { class: 'lean-fc-side' }, takeCard(rep), cacheCard(rep)));
  }

  SB.leanBar = { block, draftFor };
})();
