// The fixed cost of every turn: what goes to Claude with every message before
// your own words count, item by item. The output style, each CLAUDE.md and rule
// that loads here, each plugin (Claude Code's own estimate), your skills' and
// agents' listings, MCP servers (whose tool lists Shellby can't size) and the
// hooks that add text as a conversation starts or with each message. Each is an
// estimate, labelled with what it rests on, and gets its share of the measured
// setup (efficiency.js recordSetup). From them, suggestions as data: the style
// can be switched off (lean-fixes.js asks first), an idle plugin turned off
// (lean.js), and a global CLAUDE.md section about one project moved by hand.
//
// Pure: no I/O (test/fixedcost.test.js). lean.js gathers the inputs.

const CHARS_PER_TOKEN = 4;
// Claude Code's built-in styles are a few paragraphs in its system prompt, not
// files on disk, so these are rough figures.
const BUILT_IN_STYLE_TOKENS = { explanatory: 500, learning: 1000 };
const MOVE_MIN_TOKENS = 100;     // a global section this big, about one project, is worth moving there
const MESSAGE_HOOK_MIN = 200;    // tokens a hook adds with each message before it's worth a word
const MIN_NAME = 3;              // shorter project names match too much to mean anything
const MAX_ITEMS = 80;
const MAX_SUGGESTIONS = 12;
const HEADING = /^#{1,2}\s+(\S.*)$/;
// The parts of the setup the Lean tab's bar is coloured by: each item's kind
// belongs to one, and the rest (Claude Code's own prompt and tools) is its own.
const PART_OF = { style: 'style', memory: 'memory', rule: 'memory', plugin: 'plugins', skills: 'skills', mcp: 'mcp', hook: 'hooks' };
const PART_ORDER = ['rest', 'mcp', 'plugins', 'skills', 'memory', 'style', 'hooks'];
const SUGGESTION_PART = { style: 'style', plugin: 'plugins', hook: 'hooks', move: 'memory' };

/** A heading's words: trailing #s and spaces off, by index, so a long line costs one pass. */
function headingText(rest) {
  let end = rest.trimEnd().length;
  while (end > 0 && (rest[end - 1] === '#' || rest[end - 1] === ' ' || rest[end - 1] === '\t')) end--;
  return rest.slice(0, end).trim();
}

const num = v => (Number.isFinite(v) && v > 0 ? v : 0);
const str = v => (typeof v === 'string' ? v : '');
const list = v => (Array.isArray(v) ? v : []);
const tokensOf = text => Math.round(str(text).length / CHARS_PER_TOKEN);

/** "950", "1.5k", "14k", "1.2M": the same shape as the panel's chip. */
function compactTokens(n) {
  const v = Math.round(num(n));
  if (v >= 999500) return `${+(v / 1e6).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return String(v);
}

// ---- the output style

/**
 * Which output style is on, and where it's set: Shellby's own choice (passed to
 * every conversation it starts, so it wins), else the nearest settings file
 * naming one. files: [{ scope, file, data }], nearest first.
 * @param {{ shellby?: string, files?: { scope: string, file: string, data: any }[] }} [input]
 * @returns {{ name: string, source: string, file: string | null } | null}
 */
function activeStyle({ shellby = '', files = [] } = {}) {
  const isOn = name => typeof name === 'string' && name.trim() && name.trim().toLowerCase() !== 'default';
  if (isOn(shellby)) return { name: shellby.trim(), source: 'shellby', file: null };
  for (const f of list(files)) {
    const name = f?.data && typeof f.data === 'object' ? f.data.outputStyle : null;
    if (isOn(name)) return { name: name.trim(), source: str(f.scope) || 'user', file: str(f.file) || null };
  }
  return null;
}

/**
 * What a style adds to the system prompt: a rough figure for Claude Code's own,
 * the file's size for one of yours (chars), unknown otherwise.
 * @param {{ name?: string, chars?: number | null }} style
 * @returns {{ tokens: number | null, estimate: 'rough' | 'size' | null }}
 */
function styleTokens(style) {
  const built = BUILT_IN_STYLE_TOKENS[str(style?.name).trim().toLowerCase()];
  if (built) return { tokens: built, estimate: 'rough' };
  const chars = num(style?.chars);
  if (chars) return { tokens: Math.round(chars / CHARS_PER_TOKEN), estimate: 'size' };
  return { tokens: null, estimate: null };
}

// ---- sections of a memory file

/**
 * A CLAUDE.md split at its `#` and `##` headings: [{ heading, line (1-based),
 * text, tokens }]. Text before the first heading is a section with heading ''.
 * @param {string} md
 */
function sectionsOf(md) {
  const lines = str(md).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  /** @type {{ heading: string, line: number, text: string, tokens: number }[]} */
  const out = [];
  /** @type {{ heading: string, line: number, text: string, tokens: number } | null} */
  let cur = null;
  let fenced = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
    const m = !fenced && HEADING.exec(l);
    if (m) { cur = { heading: headingText(m[1]), line: i + 1, text: '', tokens: 0 }; out.push(cur); return; }
    if (!cur) { cur = { heading: '', line: 1, text: '', tokens: 0 }; out.push(cur); }
    cur.text += `${l}\n`;
  });
  return out.filter(s => s.heading || s.text.trim()).map(s => ({ ...s, tokens: tokensOf(s.text) }));
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Sections of a global CLAUDE.md that name exactly one of your projects and no
 * other, and are big enough to be worth moving into that project's own file:
 * [{ heading, line, tokens, project }].
 * @param {string} md
 * @param {string[]} projects  project names (folder names)
 * @param {{ minTokens?: number }} [opts]
 */
function projectOnlySections(md, projects, { minTokens = MOVE_MIN_TOKENS } = {}) {
  const names = [...new Set(list(projects).filter(p => typeof p === 'string' && p.trim().length >= MIN_NAME).map(p => p.trim()))];
  if (!names.length) return [];
  const res = names.map(n => ({ name: n, re: new RegExp(`(^|[^\\w-])${escapeRe(n)}([^\\w-]|$)`, 'i') }));
  return sectionsOf(md)
    .filter(s => s.heading && s.tokens >= minTokens)
    .flatMap(s => {
      const hit = res.filter(r => r.re.test(`${s.heading}\n${s.text}`));
      return hit.length === 1 ? [{ heading: s.heading, line: s.line, tokens: s.tokens, project: hit[0].name }] : [];
    });
}

/**
 * @typedef {{ name: string, source: string, file?: string | null, chars?: number | null }} Style
 * @typedef {{ setup?: { tokens: number } | null, memory?: any[], plugins?: any[], skills?: any[], mcp?: any[], hooks?: any[],
 *   style?: Style | null, globalMd?: { path: string, text: string } | null, projects?: string[], idleDays?: number }} FixedInput
 */

// ---- the items

/**
 * Everything sent with every turn, as rows for the Lean tab, and the one-line
 * summary the turn footer can show. setup: the measured first call (less your
 * prompt); when there is one, it's the total and the items' shares are of it,
 * with what Claude Code's own prompt and tools take as the rest. Without one,
 * the sized items add up to the total. memory/plugins/skills/mcp: the report's
 * rows (efficiency.js leanReport); hooks: usage/hookctx.js heaviestHooks;
 * style: activeStyle() with the file's size as chars for one of yours.
 * @param {FixedInput} [input]
 */
function fixedCost({ setup = null, memory = [], plugins = [], skills = [], mcp = [], hooks = [], style = null, globalMd = null, projects = [], idleDays = 21 } = {}) {
  /** @type {any[]} */
  const items = [];
  if (style?.name) {
    const t = styleTokens(style);
    items.push({ key: 'style', kind: 'style', label: `Output style "${style.name}"`, tokens: t.tokens, estimate: t.estimate, source: style.source, file: style.file || null });
  }
  for (const m of list(memory)) {
    if (!m || m.onDemand || !num(m.tokens)) continue;
    const rule = /-rule$/.test(str(m.scope));
    items.push({ key: `memory:${m.path}`, kind: rule ? 'rule' : 'memory', label: String(m.path).split(/[\\/]/).pop(), path: m.path, scope: m.scope, tokens: Math.round(m.tokens), estimate: 'size' });
  }
  for (const p of list(plugins)) {
    if (!p || typeof p.id !== 'string') continue;
    items.push({ key: `plugin:${p.id}`, kind: 'plugin', label: p.name || p.id, id: p.id, tokens: Number.isFinite(p.tokens) ? p.tokens : null, estimate: Number.isFinite(p.tokens) ? 'claude' : null, idle: !!p.idle });
  }
  const mine = list(skills).filter(s => s && num(s.listTokens));
  if (mine.length) items.push({ key: 'skills', kind: 'skills', label: `Your skills, agents and commands (${mine.length} listed)`, tokens: mine.reduce((n, s) => n + s.listTokens, 0), count: mine.length, estimate: 'size' });
  for (const s of list(mcp)) {
    if (!s || typeof s.name !== 'string') continue;
    items.push({ key: `mcp:${s.name}`, kind: 'mcp', label: s.name, tokens: null, estimate: null });
  }
  for (const hk of list(hooks)) {
    if (!hk || typeof hk.name !== 'string') continue;
    if (hk.event === 'SessionStart' && num(hk.perConversation)) items.push({ key: `hook:SessionStart:${hk.name}`, kind: 'hook', label: hk.name, tokens: Math.round(hk.perConversation), when: 'start', estimate: 'seen' });
    else if (hk.event === 'UserPromptSubmit' && num(hk.tokens)) items.push({ key: `hook:UserPromptSubmit:${hk.name}`, kind: 'hook', label: hk.name, tokens: Math.round(hk.tokens), when: 'message', estimate: 'seen' });
  }

  const sized = items.filter(i => Number.isFinite(i.tokens));
  const known = sized.reduce((n, i) => n + i.tokens, 0);
  const perMessage = sized.filter(i => i.when === 'message').reduce((n, i) => n + i.tokens, 0);
  const measured = !!setup && num(setup.tokens) > 0;
  const total = measured ? Math.round(setup.tokens) + perMessage : known;
  const rows = items
    .map(i => ({ ...i, share: Number.isFinite(i.tokens) && total ? i.tokens / total : null }))
    .sort((a, b) => ((b.tokens ?? -1) - (a.tokens ?? -1)) || String(a.label).localeCompare(String(b.label)))
    .slice(0, MAX_ITEMS);
  const rest = measured ? Math.max(0, total - known) : 0;
  return {
    total, measured, known, rest,
    line: total ? `setup ~${compactTokens(total)}/turn` : null,
    items: rows,
    parts: partsOf(rows, rest, total),
    suggestions: suggestions({ style, items: rows, globalMd, projects, idleDays }),
  };
}

/**
 * The items grouped into the parts the bar is coloured by, biggest first and
 * the ones Shellby can't size last: [{ key, tokens (null when none of its
 * items is sized), share, keys (its items') }]. The rest is a part of its own.
 * @param {any[]} items  fixedCost's rows
 * @param {number} rest
 * @param {number} total
 */
function partsOf(items, rest, total) {
  /** @type {Map<string, { key: string, tokens: number | null, keys: string[] }>} */
  const by = new Map();
  for (const it of items) {
    const key = PART_OF[it.kind];
    if (!key) continue;
    const p = by.get(key) || /** @type {{ key: string, tokens: number | null, keys: string[] }} */ ({ key, tokens: null, keys: [] });
    p.keys.push(String(it.key));
    if (Number.isFinite(it.tokens)) p.tokens = (p.tokens || 0) + it.tokens;
    by.set(key, p);
  }
  if (rest > 0) by.set('rest', { key: 'rest', tokens: rest, keys: [] });
  return [...by.values()]
    .map(p => ({ ...p, share: p.tokens !== null && total ? p.tokens / total : null }))
    .sort((a, b) => ((b.tokens ?? -1) - (a.tokens ?? -1)) || PART_ORDER.indexOf(a.key) - PART_ORDER.indexOf(b.key));
}

// ---- suggestions

const tok = n => `~${compactTokens(n)} tokens`;

/**
 * What could be left out, biggest saving first. Each is data: text in Shellby's
 * voice, the tokens it saves, the part of the bar it cuts, and an action when
 * one is safe to offer ({ type: 'style-off' } or { type: 'plugin-off', id }),
 * null when it's advice (the panel drafts those for Claude, nothing is written).
 * @param {{ style: Style | null, items: any[], globalMd: { path: string, text: string } | null, projects: string[], idleDays: number }} input
 */
function suggestions({ style, items, globalMd, projects, idleDays }) {
  /** @type {any[]} */
  const out = [];
  const styleRow = items.find(i => i.kind === 'style');
  if (style?.name && styleRow) {
    const where = style.source === 'shellby' ? 'set in Shellby\'s Settings → Claude' : `set in ${style.file || `your ${style.source} settings`}`;
    const size = Number.isFinite(styleRow.tokens) ? `adds ${tok(styleRow.tokens)} to every turn` : 'adds to every turn';
    out.push({ id: 'style-off', kind: 'style', label: styleRow.label, saves: styleRow.tokens || 0, text: `Output style "${style.name}" ${size} (${where}): switch it off and Claude keeps its replies brief.`, short: 'Turn it off. Claude explains when you ask anyway.', action: { type: 'style-off' } });
  }
  for (const p of items.filter(i => i.kind === 'plugin' && i.idle)) {
    const size = Number.isFinite(p.tokens) ? ` and adds ${tok(p.tokens)} to every conversation` : '';
    out.push({ id: `plugin-off:${p.id}`, kind: 'plugin', label: p.label, saves: p.tokens || 0, text: `"${p.label}" sat idle for ${idleDays} days${size}: turn it off. It stays installed.`, short: `${p.label} sat idle for ${idleDays} days. Turn it off; it stays installed.`, action: { type: 'plugin-off', id: p.id } });
  }
  for (const hk of items.filter(i => i.kind === 'hook' && i.when === 'message' && i.tokens >= MESSAGE_HOOK_MIN)) {
    out.push({ id: `hook:${hk.label}`, kind: 'hook', label: hk.label, saves: hk.tokens, text: `The hook ${hk.label} adds ${tok(hk.tokens)} with every message you send, and each copy stays in the conversation: have it print only when something changed, or move standing instructions into CLAUDE.md.`, short: `${hk.label} adds to every message you send. Have it print only when something changed.`, action: null });
  }
  if (globalMd?.text) {
    for (const s of projectOnlySections(globalMd.text, projects)) {
      out.push({ id: `move:${s.heading}`, kind: 'move', label: `"${s.heading}" in CLAUDE.md`, saves: s.tokens, path: globalMd.path, line: s.line, heading: s.heading, project: s.project, text: `Your global CLAUDE.md has a section ("${s.heading}", ${tok(s.tokens)}) that only ${s.project} uses, and every project carries it: move it into ${s.project}'s own CLAUDE.md.`, short: `Move "${s.heading}" out of the global CLAUDE.md into ${s.project}.`, action: null });
    }
  }
  return out
    .map(s => ({ ...s, part: SUGGESTION_PART[s.kind] }))
    .sort((a, b) => (b.saves - a.saves) || a.id.localeCompare(b.id)).slice(0, MAX_SUGGESTIONS);
}

module.exports = { activeStyle, styleTokens, sectionsOf, projectOnlySections, fixedCost, partsOf, compactTokens, BUILT_IN_STYLE_TOKENS, MOVE_MIN_TOKENS, MESSAGE_HOOK_MIN, PART_OF };
