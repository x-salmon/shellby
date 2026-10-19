/* Shellby panel — Toolbox → Lean: what every new conversation carries before your
   first word and where it goes, how much of Claude's input came from the prompt
   cache (and a word when today's falls well short), Claude Code's own count of
   lines, edits and commits, the files Claude keeps coming back to, the
   commands whose output fills its context, the hooks that add to it, and the
   plugins, MCP servers and your own skills that sit idle. Nothing here touches a prompt, the model
   or what Claude reads: turning a plugin off only affects new conversations and
   is one click to undo, and "Suggest a trim" and "Ask Claude" only draft a
   prompt for you to send.
   The numbers come from main (lean.js, efficiency.js). */
'use strict';
(function () {
  const { h, api, state, $ } = SB;
  const TRIM_FROM = 400;   // tokens: smaller memory files aren't worth a trim
  let loading = null;
  let loadingSince = 0;
  let tick = null;         // redraws the waiting line each second, so it never looks stuck
  let error = null;
  const busy = new Set();  // plugin ids / server names with a change in flight

  const tok = n => `~${SB.compact(Math.round(n))} tokens`;
  const pct = r => `${Math.round(r * 100)}%`;
  const rerender = () => { if (state.view === 'toolbox') SB.views.toolbox.render(); };
  const waited = () => { const s = Math.round((Date.now() - loadingSince) / 1000); return loading && s >= 2 ? `${s} s` : ''; };

  function load(refresh = false) {
    if (loading) return loading;
    error = null;
    loadingSince = Date.now();
    loading = api.leanReport(refresh)
      .then(r => { if (r?.ok) state.lean = r; else error = r?.error || "Couldn't read that from Claude Code."; })
      .catch(() => { error = "Couldn't read that from Claude Code."; })
      .finally(() => { loading = null; clearInterval(tick); tick = null; rerender(); });
    if (!state.lean) tick ??= setInterval(() => { const el = document.querySelector('#toolList .lean-wait'); if (el) el.textContent = waited(); }, 1000);
    rerender();
    return loading;
  }

  async function change(key, fn, done) {
    if (busy.has(key)) return;
    busy.add(key);
    rerender();
    let r;
    try { r = await fn(); } catch { r = { ok: false, error: "Shellby couldn't do that." }; }
    busy.delete(key);
    if (r?.ok) {
      if (r.plugins) state.lean = r;
      if (done) SB.toast(done, { ms: 6000 });
    } else if (!r?.cancelled) SB.toast(r?.error || "Couldn't do that.", { ms: 8000 });
    rerender();
    return r;
  }

  function lastUsedText(row, rep) {
    if (row.background) return `Works in the background (hooks or a language server)${Number.isFinite(row.lastUsed) ? `, last called ${SB.relTime(row.lastUsed)}` : ''}`;
    if (Number.isFinite(row.lastUsed)) return `last used ${SB.relTime(row.lastUsed)}`;
    if (rep.watched) return `not used in ${rep.idleDays}+ days`;
    return 'no use seen yet';
  }

  // Advice instead of removal: what Shellby measured, handed to Claude with a
  // brief to keep every capability reachable. The prompt waits in a new tab, unsent.
  const ASK_ROWS = 25;     // per section: enough to judge, short enough to read before sending
  function ADVICE_ASK(rep) {
    const s = rep.setup;
    const some = (rows, line) => [...rows.slice(0, ASK_ROWS).map(line), ...(rows.length > ASK_ROWS ? [`- and ${rows.length - ASK_ROWS} more`] : [])];
    const used = r => {
      const t = lastUsedText(r, rep);
      return `${r.idle && Number.isFinite(r.lastUsed) ? 'idle, ' : ''}${t[0].toLowerCase()}${t.slice(1)}`;
    };
    const c = rep.cache.week;
    return [
      'Help me make what Claude Code loads into every conversation leaner without losing any functionality I use. Do not edit any file, setting or plugin: propose changes and I will decide.',
      '',
      'What Shellby measured on this PC:',
      s ? `- A new conversation carries ${tok(s.tokens)} before my first message (in ${s.name}).` : null,
      c.rate == null ? null : `- ${pct(c.rate)} of input came from the prompt cache this week.`,
      rep.plugins.length ? `\nPlugins turned on (Claude Code's estimate of what each adds to every conversation):` : null,
      ...some(rep.plugins, p => `- ${p.id}${p.tokens == null ? '' : `: ${tok(p.tokens)}`}, ${used(p)}`),
      rep.mcp.length ? '\nMCP servers I added:' : null,
      ...some(rep.mcp, m => `- ${m.name}: ${used(m)}`),
      rep.memory.length ? '\nCLAUDE.md and rules files:' : null,
      ...some(rep.memory, m => `- ${m.path}: ${tok(m.tokens)}, ${m.onDemand ? 'only for matching files' : 'every conversation'}`),
      '',
      'Read the files and settings yourself before suggesting anything. Ideas to weigh, where they fit:',
      '- moving CLAUDE.md sections that only matter for some files into rules that load only for those paths',
      '- turning a plugin on only in the projects that use it instead of everywhere',
      '- scoping an MCP server to the project that needs it',
      '- removing text repeated across memory files, and tightening long skill or agent descriptions I own',
      '- habits that keep the prompt cache warm',
      '',
      'For each suggestion say what to change, roughly how many tokens it saves per conversation, and what I would notice afterwards. Order them by savings. Leave out anything that would take away a feature I use; if you are unsure whether I use something, ask instead of guessing.',
    ].filter(l => l !== null).join('\n');
  }

  // ------------------------------------------------------------ the summary

  const BUDGET = {
    memory: { label: 'CLAUDE.md and rules', cls: 'is-memory' },
    plugins: { label: "plugins (Claude Code's estimate)", cls: 'is-plugins' },
    skills: { label: "your skills' listings", cls: 'is-skills' },
    hooks: { label: 'what start hooks add', cls: 'is-hooks' },
    rest: { label: "Claude Code's own prompt and tools, and MCP servers you added", cls: 'is-rest' },
  };

  // Where the setup weight goes, as one bar: the parts Shellby can size, and the rest.
  function budgetBar(b) {
    const parts = [...b.parts, ...(b.rest ? [{ key: 'rest', tokens: b.rest }] : [])];
    const whole = parts.reduce((n, p) => n + p.tokens, 0) || 1;
    const legend = parts.map(p => `${BUDGET[p.key].label} ${tok(p.tokens)}`).join(' · ');
    return h('div', { class: 'lean-budget' },
      h('div', { class: 'lean-bar', role: 'img', 'aria-label': legend },
        ...parts.map(p => h('span', { class: `lean-seg ${BUDGET[p.key].cls}`, style: `flex-grow: ${p.tokens / whole}`, title: `${BUDGET[p.key].label}: ${tok(p.tokens)}` }))),
      h('p', { class: 'muted small' },
        `${pct(b.share)} of a 200k context window before you type: `,
        ...parts.flatMap((p, i) => [i ? ' · ' : '', h('span', { class: `lean-key ${BUDGET[p.key].cls}`, 'aria-hidden': 'true' }), ` ${BUDGET[p.key].label} ${tok(p.tokens)}`])));
  }

  function grewText(s) {
    if (!s?.prev) return null;
    const d = s.tokens - s.prev;
    return `${d > 0 ? 'Up' : 'Down'} ${tok(Math.abs(d))} since ${new Date(s.prevAt).toLocaleDateString()}.`;
  }

  // Claude Code's own count, from the metrics it sends Shellby (main's telemetry.js).
  function telemetryBlock(rep) {
    const on = state.settings?.claudeTelemetry !== false;
    const toggle = h('button', { class: 'btn ghost slim-btn', type: 'button',
      title: on ? "Conversations Shellby starts stop sending Claude Code's metrics here" : "Conversations Shellby starts send Claude Code's metrics to Shellby, on this PC only",
      onclick: async () => {
        const r = await api.setSettings({ claudeTelemetry: !on });
        if (r?.settings) state.settings = r.settings;
        SB.toast('Applies to new conversations.');
        rerender();
      } }, on ? 'Turn off' : 'Turn on');
    const t = rep.telemetry?.week;
    let text;
    if (!on) text = "Claude Code's own count of lines, accepted edits and commits is off.";
    else if (!t) text = "Claude Code's own count of lines, accepted edits and commits shows here after a conversation Shellby starts. Telemetry you set up yourself is left alone.";
    else {
      const hours = t.cliSecs / 3600;
      text = [
        `This week Claude Code counted +${SB.compact(t.added)} / −${SB.compact(t.removed)} lines`,
        t.acceptRate == null ? null : `${t.accepted} of ${t.accepted + t.rejected} edits accepted (${pct(t.acceptRate)})`,
        t.commits ? `${t.commits} commit${t.commits === 1 ? '' : 's'}` : null,
        t.prs ? `${t.prs} pull request${t.prs === 1 ? '' : 's'}` : null,
        hours >= 0.1 ? `${hours.toFixed(1)} h of Claude working` : null,
      ].filter(Boolean).join(', ') + '.';
    }
    return h('div', { class: 'mcp-bar lean-telemetry' }, h('span', { class: 'lean-cache', text }), toggle);
  }

  // Warm caches that missed this week (main's cachebreak.js), and what came before them.
  function breaksText(b) {
    const times = n => (n === 1 ? 'once' : `${n} times`);
    const why = [
      b.resume ? `${b.resume} right after a conversation's process started again` : null,
      b.model ? `${b.model} on a fallback model` : null,
      b.other ? `${b.other} for reasons Shellby can't see` : null,
    ].filter(Boolean).join(', ');
    return `This week the cache missed ${times(b.count)} while it should still have held, sending ${tok(b.tokens)} at full price: ${why}.`
      + (b.resume ? " A restart misses when CLAUDE.md, a plugin or an MCP server changed meanwhile. If yours follow quiet spells, Keep warm (the mug above the tabs) holds the process while you're away." : '');
  }

  function summary(rep) {
    const s = rep.setup;
    const head = s
      ? h('p', { class: 'lean-head' },
        'Every new conversation carries ', h('strong', { text: tok(s.tokens) }), ' before your first word',
        h('span', { class: 'muted', text: ` (measured ${SB.relTime(s.at)} in ${s.name})` }),
        grewText(s) ? h('span', { class: 'muted', text: ` ${grewText(s)}` }) : null)
      : h('p', { class: 'lean-head', text: 'Shellby measures what a conversation carries before your first word the next time one starts.' });
    const parts = [
      rep.totals.plugins ? `plugins ${tok(rep.totals.plugins)} (Claude Code's estimate)` : null,
      rep.totals.memory ? `CLAUDE.md and rules ${tok(rep.totals.memory)}` : null,
      rep.totals.skills ? `your skills' names and descriptions ${tok(rep.totals.skills)}` : null,
      rep.totals.hooks ? `what your start hooks add ${tok(rep.totals.hooks)}` : null,
      'plus Claude Code\'s own prompt and tools',
    ].filter(Boolean);
    const c = rep.cache.week;
    const was = rep.cache.lastWeek;
    const cacheLine = c.rate == null
      ? 'No calls this week yet.'
      : `${pct(c.rate)} of Claude's input came from the prompt cache this week${was.rate == null ? '' : ` (last week ${pct(was.rate)})`}: ${tok(c.saved)}' worth billed at a tenth.`;
    const drop = rep.cacheDrop;
    return h('div', { class: 'lean-summary' },
      head,
      rep.budget ? budgetBar(rep.budget) : null,
      h('div', { class: 'setup-intro lean-ask' },
        h('p', { text: 'Rather than turning things off, Claude can look over this setup and suggest leaner ways to keep every feature you use.' }),
        h('button', { class: 'btn slim-btn', type: 'button', title: 'Opens a new tab with a prompt for you to read and send. Claude only proposes; nothing changes until you say so.',
          onclick: () => { SB.setView('chat'); SB.newTabIn({ cwd: state.cwd, draft: ADVICE_ASK(rep) }); } }, 'Ask Claude')),
      h('p', { class: 'muted small', text: `That includes ${parts.join(', ')}. While the cache is warm it costs a tenth, but it always takes room in the context window, and it's paid in full whenever the cache goes cold.` }),
      h('p', { class: 'lean-cache', text: cacheLine }),
      drop ? h('p', { class: 'lean-warn', role: 'status', text: `Only ${pct(drop.today)} of today's input came from the cache, against ${pct(drop.usual)} most days. That's usual after a change to CLAUDE.md, a plugin or an MCP server (the cached start no longer matches), or long gaps between messages.` }) : null,
      rep.breaks ? h('p', { class: 'lean-warn', text: breaksText(rep.breaks) }) : null,
      telemetryBlock(rep),
      h('div', { class: 'mcp-bar' },
        h('span', { class: 'muted small', text: rep.watched
          ? `Idle means unused for ${rep.idleDays} days in this PC's Claude Code history, Shellby and the terminal both. Use on another PC or in WSL doesn't show here. Turning something off only changes new conversations.`
          : rep.watchedFrom
            ? `Claude Code's history here starts ${new Date(rep.watchedFrom).toLocaleDateString()}. Shellby calls something idle once it covers ${rep.idleDays} days.`
            : "Claude Code hasn't kept any history here yet, so nothing is called idle." }),
        h('button', { class: 'btn ghost slim-btn', type: 'button', disabled: !!loading, onclick: () => load(true) }, loading ? 'Checking…' : 'Check again')));
  }

  // ------------------------------------------------------------ rows

  const label = text => h('li', { class: 'row-label lean-label', text });

  function pluginRow(p, rep) {
    const working = busy.has(p.id);
    return h('li', { class: `tool-row${p.idle ? ' is-idle' : ''}` },
      h('div', { class: 'tool-main' },
        h('div', { class: 'tool-name' },
          h('code', { text: p.name }),
          p.idle ? h('span', { class: 'idle-pill', text: 'idle' }) : null,
          h('span', { class: 'src-pill', title: "Claude Code's estimate of what it adds to every conversation", text: p.tokens == null ? '' : tok(p.tokens) })),
        h('p', { class: 'tool-desc', text: lastUsedText(p, rep) })),
      h('div', { class: 'tool-actions' },
        h('button', { class: `btn ${p.idle ? '' : 'ghost '}slim-btn`, type: 'button', disabled: working,
          onclick: () => change(p.id, () => api.leanPlugin(p.id, false), `Turned off ${p.name}. New conversations won't load it.`) }, working ? '…' : 'Turn off')));
  }

  function offRow(p) {
    const working = busy.has(p.id);
    return h('li', { class: 'tool-row is-off' },
      h('div', { class: 'tool-main' }, h('div', { class: 'tool-name' }, h('code', { text: p.name }), h('span', { class: 'src-pill', text: 'off' }))),
      h('div', { class: 'tool-actions' },
        h('button', { class: 'btn ghost slim-btn', type: 'button', disabled: working,
          onclick: () => change(p.id, () => api.leanPlugin(p.id, true), `${p.name} is back on for new conversations.`) }, working ? '…' : 'Turn on')));
  }

  function mcpRow(s, rep) {
    const working = busy.has(`mcp:${s.name}`);
    const remove = async () => {
      const r = await change(`mcp:${s.name}`, () => api.removeMcp(state.activeTab, s.name), `Removed ${s.name}. New conversations won't have it.`);
      if (r?.ok) { await api.leanMcpRemoved(s.name); state.toolbox = await api.getToolbox(); load(); }
    };
    return h('li', { class: `tool-row${s.idle ? ' is-idle' : ''}` },
      h('div', { class: 'tool-main' },
        h('div', { class: 'tool-name' },
          h('code', { text: s.name }),
          s.idle ? h('span', { class: 'idle-pill', text: 'idle' }) : null,
          h('span', { class: 'src-pill', title: 'Its tools are listed for Claude in every conversation', text: 'MCP server' })),
        h('p', { class: 'tool-desc', text: lastUsedText(s, rep) })),
      h('div', { class: 'tool-actions' },
        h('button', { class: `btn ${s.idle ? '' : 'ghost '}slim-btn`, type: 'button', disabled: working, title: 'Shellby asks first, and shows what it runs so you can add it back', onclick: remove }, working ? '…' : 'Remove…')));
  }

  const NOUN = { skill: 'skill', command: 'command', agent: 'agent' };

  function skillUseText(t, rep) {
    const used = t.uses ? `used ${t.uses}× lately, last ${SB.relTime(t.lastUsed)}` : lastUsedText(t, rep);
    return [used, t.useTokens ? `${tok(t.useTokens)} each time it's used` : null].filter(Boolean).join(' · ');
  }

  function skillRow(t, rep) {
    const key = `${t.kind}:${t.name}`;
    const working = busy.has(key);
    const remove = async () => {
      const r = await change(key, () => api.removeTool(t.kind, t.name), `Moved ${t.kind === 'agent' ? t.name : `/${t.name}`} to the Recycle Bin. Restore it from there if you change your mind.`);
      if (r?.ok) {
        if (r.toolbox) state.toolbox = r.toolbox;
        state.pinned = (state.pinned || []).filter(p => !(p.kind === t.kind && p.name === t.name));
        SB.refreshEmptyStates();
        load();
      }
    };
    return h('li', { class: `tool-row${t.idle ? ' is-idle' : ''}` },
      h('div', { class: 'tool-main' },
        h('div', { class: 'tool-name' },
          h('code', { text: t.kind === 'agent' ? t.name : `/${t.name}` }),
          t.idle ? h('span', { class: 'idle-pill', text: 'idle' }) : null,
          h('span', { class: 'src-pill', title: 'Its name and description are listed for Claude in every conversation', text: `${NOUN[t.kind]} · ${tok(t.listTokens)}` })),
        h('p', { class: 'tool-desc', text: skillUseText(t, rep) })),
      h('div', { class: 'tool-actions' },
        h('button', { class: `btn ${t.idle ? '' : 'ghost '}slim-btn`, type: 'button', disabled: working, title: 'Shellby asks first, and it goes to the Recycle Bin', onclick: remove }, working ? '…' : 'Remove…')));
  }

  // A trim Claude proposes and you approve: the prompt waits in a new tab, unsent.
  const TRIM_ASK = m => `Look at my Claude Code memory file at ${m.path}. ${m.onDemand ? 'It loads whenever you work on matching files' : 'It loads into every conversation'}, so every line of it is sent with every message after that. `
    + 'Suggest a shorter version that keeps everything you could not work out from the code or the project itself: commands, conventions, gotchas, preferences and rules. '
    + 'Only drop what is repeated, out of date, or obvious from the code. Do not edit the file. Show me the proposed version as a diff, and for each removal say what it was and why it is safe to drop.';

  function memoryRow(m) {
    return h('li', { class: 'tool-row' },
      h('div', { class: 'tool-main' },
        h('div', { class: 'tool-name' },
          h('code', { text: SB.basename(m.path) }),
          h('span', { class: 'src-pill', text: tok(m.tokens) })),
        h('p', { class: 'tool-desc', text: m.onDemand ? `Only when Claude works on matching files · ${m.path}` : m.path, title: m.path })),
      h('div', { class: 'tool-actions' },
        m.tokens >= TRIM_FROM ? h('button', { class: 'btn ghost slim-btn', type: 'button', title: 'Opens a new tab with a prompt for you to read and send. Claude proposes a diff; nothing changes until you say so.',
          onclick: () => { SB.setView('chat'); SB.newTabIn({ cwd: state.cwd, draft: TRIM_ASK(m) }); } }, 'Suggest a trim') : null,
        h('button', { class: 'icon-btn', type: 'button', title: 'Show file', 'aria-label': 'Show file', onclick: () => api.revealSetupFile(m.path) },
          SB.icon(SB.ICONS.folder, { width: 1.3 }))));
  }

  // ------------------------------------------------------------ hot files

  const HOT_ASK = rows => [
    'These files in this project are the ones Claude Code keeps coming back to (counted from its transcripts on this PC):',
    ...rows.map(r => `- ${r.rel}: read ${r.reads}×, edited ${r.edits}×, in ${r.sessions} conversations${r.tokens ? `, about ${r.tokens} tokens` : ''}`),
    '',
    "Look at them and at CLAUDE.md, then suggest how Claude could need them less: a short note in CLAUDE.md (what each holds, where things live, conventions it shows) so they needn't be read just to find something, or a split for any that is large and read for one part. Do not edit anything. For each suggestion, say what to add or change and what reading it saves.",
  ].join('\n');

  function hotRow(r) {
    const used = [`read ${r.reads}×`, r.edits ? `edited ${r.edits}×` : null, `in ${r.sessions} conversations`].filter(Boolean).join(', ');
    return h('li', { class: 'tool-row' },
      h('div', { class: 'tool-main' },
        h('div', { class: 'tool-name' },
          h('code', { text: r.rel }),
          r.tokens ? h('span', { class: 'src-pill', title: 'What reading all of it costs, at its size now', text: tok(r.tokens) }) : null),
        h('p', { class: 'tool-desc', text: used })));
  }

  // ------------------------------------------------------------ loud commands

  const LOUD_ASK = rows => [
    "These commands put the most output into Claude Code's context in this project (counted from its transcripts on this PC). Everything a command prints stays in the conversation and is sent again with every message after it:",
    ...rows.map(r => `- ${r.key}: about ${r.tokens} tokens a run, ${r.runs} runs in ${r.sessions} conversations`),
    '',
    'Look at how each is used here (package.json scripts, CLAUDE.md, the tools themselves) and suggest how Claude could run them with less output and still see what it needs: a quieter flag or reporter, piping through tail or a filter that keeps the failures, a script that prints only a summary, or a line in CLAUDE.md saying how to run them. Do not edit anything. For each suggestion, say what to change and roughly how many tokens a run it saves.',
  ].join('\n');

  function loudRow(r) {
    return h('li', { class: 'tool-row' },
      h('div', { class: 'tool-main' },
        h('div', { class: 'tool-name' },
          h('code', { text: r.key }),
          h('span', { class: 'src-pill', title: 'What one run puts in the conversation, on average', text: `${tok(r.tokens)} a run` })),
        h('p', { class: 'tool-desc', text: `ran ${r.runs}× in ${r.sessions} conversations, ${tok(r.total)} in all` })));
  }

  // ------------------------------------------------------------ hooks that add to the conversation

  // When each kind of hook adds what it prints (main's usage/hookctx.js).
  const WHEN = {
    SessionStart: 'as each conversation starts',
    UserPromptSubmit: 'with every message you send',
    PreToolUse: 'before a tool runs',
    PostToolUse: 'after a tool runs',
    PostToolUseFailure: 'after a tool fails',
    SubagentStart: 'as each helper starts',
  };
  const when = r => WHEN[r.event] || r.event;

  const HOOKS_ASK = rows => [
    "These Claude Code hooks add text to my conversations (counted from Claude Code's transcripts on this PC). Whatever a hook adds stays in the conversation and is sent again with every message after it:",
    ...rows.map(r => `- ${r.name} (${r.event}): about ${r.tokens} tokens ${when(r)}, ${r.runs} runs in ${r.sessions} conversations`),
    '',
    'Find where each hook is set up (~/.claude/settings.json, the project\'s .claude/settings.json, or a plugin\'s hooks), read what it prints, and suggest how it could add less and still do its job: shorter text, printing only when something changed, moving standing instructions into CLAUDE.md or a rule that loads only where it applies, or turning off one I may not need. Do not edit anything. For each suggestion, say what to change and roughly how many tokens it saves per conversation.',
  ].join('\n');

  function hookRow(r) {
    return h('li', { class: 'tool-row' },
      h('div', { class: 'tool-main' },
        h('div', { class: 'tool-name' },
          h('code', { text: r.name }),
          h('span', { class: 'src-pill', title: 'What one run adds to the conversation, on average', text: `${tok(r.tokens)} a run` })),
        h('p', { class: 'tool-desc', text: `adds it ${when(r)} · ran ${r.runs}× in ${r.sessions} conversations, ${tok(r.perConversation)} a conversation` })));
  }

  // ------------------------------------------------------------ the tab

  function render(q) {
    const pane = $('setupPane');
    const list = $('toolList');
    pane.hidden = false;
    list.hidden = false;
    pane.dataset.mounted = '';
    const rep = state.lean;
    if (!rep) {
      // Before the first report: one centred note in the list, like the Shop's.
      if (!loading && !error) load();
      pane.replaceChildren();
      list.replaceChildren(h('li', { class: `history-empty lean-loading${error ? ' err' : ''}`, role: 'status' },
        h('span', { text: error || 'Asking Claude Code what each plugin adds to a conversation…' }),
        error
          ? h('button', { class: 'btn ghost slim-btn', type: 'button', onclick: () => load(true) }, 'Check again')
          : h('span', { class: 'lean-wait', 'aria-hidden': 'true', text: waited() }),
        error ? null : h('span', { class: 'lean-wait-hint', text: 'The first time takes a minute or so with lots of plugins.' })));
      return;
    }
    pane.replaceChildren(...[summary(rep), error ? h('p', { class: 'setup-status err', role: 'status', text: error }) : null].filter(Boolean));
    const match = s => !q || s.toLowerCase().includes(q);
    const plugins = rep.plugins.filter(p => match(p.name));
    const off = (rep.off || []).filter(p => match(p.name));
    const mcp = rep.mcp.filter(s => match(s.name));
    const skills = (rep.skills || []).filter(t => match(t.name));
    const memory = rep.memory.filter(m => match(m.path) && !m.onDemand);
    const onDemand = rep.memory.filter(m => match(m.path) && m.onDemand);
    const hot = (rep.hot?.files || []).filter(r => match(r.rel));
    const noisy = (rep.hot?.loud || []).filter(r => match(r.key));
    const loudLabel = noisy.length ? h('li', { class: 'row-label lean-label lean-hot-label' },
      h('span', { text: `Commands whose output fills the context here (last ${rep.hot.days} days)` }),
      h('button', { class: 'btn ghost slim-btn', type: 'button', title: 'Opens a new tab with a prompt for you to read and send. Claude only proposes; nothing changes until you say so.',
        onclick: () => { SB.setView('chat'); SB.newTabIn({ cwd: state.cwd, draft: LOUD_ASK(rep.hot.loud) }); } }, 'Ask Claude')) : null;
    const hooks = (rep.hot?.hooks || []).filter(r => match(r.name));
    const hooksLabel = hooks.length ? h('li', { class: 'row-label lean-label lean-hot-label' },
      h('span', { text: `Hooks that add to the conversation (last ${rep.hot.days} days)` }),
      h('button', { class: 'btn ghost slim-btn', type: 'button', title: 'Opens a new tab with a prompt for you to read and send. Claude only proposes; nothing changes until you say so.',
        onclick: () => { SB.setView('chat'); SB.newTabIn({ cwd: state.cwd, draft: HOOKS_ASK(rep.hot.hooks) }); } }, 'Ask Claude')) : null;
    const hotLabel = hot.length ? h('li', { class: 'row-label lean-label lean-hot-label' },
      h('span', { text: `Files Claude keeps coming back to here (last ${rep.hot.days} days)` }),
      h('button', { class: 'btn ghost slim-btn', type: 'button', title: 'Opens a new tab with a prompt for you to read and send. Claude only proposes; nothing changes until you say so.',
        onclick: () => { SB.setView('chat'); SB.newTabIn({ cwd: state.cwd, draft: HOT_ASK(rep.hot.files) }); } }, 'Ask Claude')) : null;
    const rows = [
      plugins.length ? label('Plugins') : null, ...plugins.map(p => pluginRow(p, rep)),
      mcp.length ? label('MCP servers you added') : null, ...mcp.map(s => mcpRow(s, rep)),
      skills.length ? label(`Your skills, commands and agents (${tok(rep.totals.skills || 0)} in every conversation)`) : null, ...skills.map(t => skillRow(t, rep)),
      memory.length ? label('CLAUDE.md and rules, every conversation') : null, ...memory.map(memoryRow),
      onDemand.length ? label(`Rules for matching files only (${tok(rep.totals.memoryOnDemand)} in all)`) : null, ...onDemand.map(memoryRow),
      hooksLabel, ...hooks.map(hookRow),
      hotLabel, ...hot.map(hotRow),
      loudLabel, ...noisy.map(loudRow),
      off.length ? label('Turned off') : null, ...off.map(offRow),
    ].filter(Boolean);
    list.replaceChildren(...(rows.length ? rows : [h('li', { class: 'history-empty', text: q ? 'No matches.' : 'Nothing loads into every conversation besides Claude Code itself.' })]));
  }

  SB.lean = { render, load, count: () => (state.lean ? state.lean.totals.idleCount || '' : '') };
})();
