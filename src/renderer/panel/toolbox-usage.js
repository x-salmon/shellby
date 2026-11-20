/* Shellby panel — the Toolbox's usage and cost (toolbox.js): how often Claude
   used each skill, agent and command lately, and what its listing costs in every
   conversation, read once from Claude Code's history (lean.js usage). The two
   columns at the end of a row with the bar against the costliest one, the stats
   line in an open row, and the note above the list while an order that needs
   the numbers waits for them. toolbox.js hands in its render at init. */
'use strict';
(function () {
  const { h, api, state } = SB;
  const USAGE_RETRY_MS = 30 * 1000;
  const MIN_BAR_PCT = 3;          // a cost bar never shrinks to nothing, so every row has one to compare

  /** @type {any} */
  let usage = null;        // { tools: { 'kind:name': { uses, lastUsed, listTokens, useTokens } }, watchedFrom }
  /** @type {Promise<void> | null} */
  let usageLoading = null;
  let usageTried = false;  // asked once; after one retry, a failure waits for Rescan
  let usageFailed = false;
  let usageRetried = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let usageRetry = null;
  let redraw = () => {};   // the Toolbox's render, once it's up (init)

  function loadUsage(refresh = false) {
    if (usageLoading) return usageLoading;
    usageTried = true;
    clearTimeout(usageRetry ?? undefined);
    usageRetry = null;
    usageLoading = api.leanUsage(refresh)
      .then(r => { usageFailed = !r?.ok; if (r?.ok) usage = r; })
      .catch(() => { usageFailed = true; })
      .finally(() => {
        usageLoading = null;
        if (usageFailed && !usageRetried) {
          usageRetried = true;
          usageRetry = setTimeout(() => loadUsage(), USAGE_RETRY_MS);
        }
        if (state.view === 'toolbox') redraw();
      });
    return usageLoading;
  }

  const usageOf = t => usage?.tools?.[`${t.kind}:${t.name}`] || null;
  const num = v => (Number.isFinite(v) ? v : 0);
  // Listed in every conversation and not once used lately: what a cleanup is after.
  const isIdle = u => !!u && !u.uses && !!usage?.watchedFrom;
  const tok = n => `~${SB.compact(n)} tokens`;

  // A line above the list when the order needs usage that isn't here (yet).
  function sortNote(sort) {
    if (sort === 'name' || usage) return null;
    const text = usageLoading || !usageTried ? 'Counting uses from Claude Code history…'
      : usageRetry ? "Couldn't read usage yet. Trying again shortly; A to Z until then."
        : "Couldn't read usage, so this is A to Z. Rescan to try again.";
    return h('li', { class: 'tool-note', role: 'status', text });
  }

  function statsLine(t) {
    const u = usageOf(t);
    if (!u) return null;
    const parts = [
      u.uses ? `used ${u.uses}× lately` : usage.watchedFrom ? 'not used lately' : null,
      Number.isFinite(u.lastUsed) ? `last ${SB.relTime(u.lastUsed)}` : null,
      u.listTokens ? `${tok(u.listTokens)} in every conversation` : null,
      u.useTokens ? `${tok(u.useTokens)} each use` : null,
    ].filter(Boolean);
    if (!parts.length) return null;
    const text = parts.join(' · ');
    return h('p', { class: `tool-stats${u.uses ? '' : ' unused'}`, text: text[0].toUpperCase() + text.slice(1),
      title: `From the last ${usage.lookbackDays} days or so of this PC's Claude Code history, Shellby and the terminal both. Its name and description are listed for Claude in every conversation; the rest of its file is read only when it's used.` });
  }

  // Two columns at the end of a row: how often it's been used lately (and when last), and what
  // it costs in every conversation, with a bar against the costliest one listed. Amber when
  // it costs something and hasn't been used lately.
  let maxList = 0;
  function numbers(u) {
    if (!u) return h('span', { class: 'tool-nums' });
    const idle = isIdle(u);
    const uses = num(u.uses);
    const fill = h('i');
    const pct = maxList ? (100 * num(u.listTokens)) / maxList : 0;
    fill.style.setProperty('--w', `${Math.max(MIN_BAR_PCT, Math.round(pct))}%`);
    const last = Number.isFinite(u.lastUsed) ? SB.relTime(u.lastUsed) : '';
    return h('span', { class: `tool-nums${idle ? ' idle' : ''}` },
      h('span', { class: 'tool-uses', title: uses ? `${uses} ${uses === 1 ? 'use' : 'uses'} lately${last ? `, last ${last}` : ''}` : 'Not used lately' },
        uses ? h('b', { text: String(uses) }) : null,
        h('small', { text: uses ? last : idle ? 'not lately' : '' })),
      h('span', { class: 'tool-cost', title: u.listTokens ? `${tok(u.listTokens)} in every conversation` : 'Nothing until it’s used' },
        h('b', { text: u.listTokens ? SB.compact(u.listTokens) : '0' }),
        h('span', { class: 'cost-bar', 'aria-hidden': 'true' }, fill)));
  }

  SB.toolboxUsage = {
    init: ({ render }) => { redraw = render; },
    load: loadUsage,
    // Rescan, or an order that needs the numbers: ask again, even after the one retry gave up.
    retry: (refresh = false) => { usageRetried = false; loadUsage(refresh); },
    has: () => !!usage,
    tried: () => usageTried,
    loading: () => !!usageLoading,
    // The costliest listing on the page, which every row's bar is measured against.
    setMax: items => { maxList = items.reduce((m, t) => Math.max(m, num(usageOf(t)?.listTokens)), 0); },
    usageOf, isIdle, num, tok, statsLine, numbers, sortNote,
  };
})();
