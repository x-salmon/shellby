// Templates ({{ path | filter }}) and conditions (a.b == "x" and not c) for
// workflows. Hand-written tokenizer and parser, no eval and no regex built from
// user text: a workflow file is untrusted input, and so is everything a run
// reads back (a webhook body, a PR title, Claude's reply).

const MAX_TEMPLATE = 120000;   // above the longest field (an http body)
const MAX_SUBSTITUTIONS = 100;
const MAX_RENDERED = 200000;
const MAX_CONDITION = 1000;
const MAX_DEPTH = 32;

// Where a path may start. Anything else is read as a step id (`diagnose.cause`
// means `steps.diagnose.cause`).
const ROOTS = ['trigger', 'inputs', 'vars', 'steps', 'loop', 'run', 'now', 'today', 'secrets'];
const FILTERS = ['json', 'upper', 'lower', 'trim', 'length', 'first', 'last', 'join', 'default', 'lines', 'slice'];

// ---------------------------------------------------------------- paths

/** "a.b[2].c" -> ['a', 'b', 2, 'c'], or null if it isn't a path. */
function parsePath(text) {
  const t = String(text ?? '').trim();
  if (!t || t.length > 300) return null;
  const out = [];
  for (const part of t.split('.')) {
    const m = /^([A-Za-z_][\w-]{0,63})((?:\[\d{1,4}\])*)$/.exec(part);
    if (!m) return null;
    out.push(m[1]);
    for (const idx of m[2].match(/\d+/g) || []) out.push(Number(idx));
  }
  return out;
}

const own = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

/** Value at a parsed path, or undefined. Only own properties: never a prototype. */
function lookup(ctx, segs) {
  if (!segs || !segs.length) return undefined;
  let cur;
  let rest;
  if (ROOTS.includes(segs[0]) || own(ctx, segs[0])) {
    cur = ctx[segs[0]];
    rest = segs.slice(1);
  } else {
    cur = ctx.steps?.[segs[0]];
    rest = segs.slice(1);
  }
  for (const s of rest) {
    if (typeof s === 'number') cur = Array.isArray(cur) ? cur[s] : undefined;
    else cur = own(cur, s) ? cur[s] : undefined;
    if (cur === undefined) return undefined;
  }
  return cur;
}

function getPath(ctx, text) { return lookup(ctx, parsePath(text)); }

// ---------------------------------------------------------------- values

function toText(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return ''; }
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim() !== '' && v.trim().toLowerCase() !== 'false';
  return !!v;
}

const numeric = v => (typeof v === 'number' && Number.isFinite(v))
  || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));

// ---------------------------------------------------------------- filters

// A filter's arguments: "text", 'text' or numbers, space separated.
function parseArgs(text) {
  const args = [];
  let i = 0;
  const s = String(text);
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '"' || c === "'") {
      const end = s.indexOf(c, i + 1);
      if (end < 0) return null;
      args.push(s.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    const m = /^-?\d+(\.\d+)?/.exec(s.slice(i));
    if (!m) return null;
    args.push(Number(m[0]));
    i += m[0].length;
  }
  return args;
}

function applyFilter(value, name, args) {
  switch (name) {
    case 'json': return JSON.stringify(value ?? null, null, 2);
    case 'upper': return toText(value).toUpperCase();
    case 'lower': return toText(value).toLowerCase();
    case 'trim': return toText(value).trim();
    case 'length': return Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : toText(value).length;
    case 'first': return Array.isArray(value) ? value[0] : toText(value).slice(0, 1);
    case 'last': return Array.isArray(value) ? value[value.length - 1] : toText(value).slice(-1);
    case 'join': return Array.isArray(value) ? value.map(toText).join(args[0] === undefined ? ', ' : String(args[0])) : toText(value);
    case 'default': return value === undefined || value === null || value === '' ? args[0] ?? '' : value;
    case 'lines': return toText(value).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    case 'slice': {
      const a = Number.isInteger(args[0]) ? args[0] : 0;
      const b = Number.isInteger(args[1]) ? args[1] : undefined;
      return Array.isArray(value) ? value.slice(a, b) : toText(value).slice(a, b);
    }
    default: return value;
  }
}

// ---------------------------------------------------------------- templates

// "a | join " | " | upper" -> ['a ', ' join " | " ', ' upper']: a | inside quotes is text.
function splitPipes(text) {
  const out = [];
  let cur = '';
  let quote = null;
  for (const c of text) {
    if (quote) { if (c === quote) quote = null; cur += c; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '|') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** @typedef {{ path: string, segs: any[], filters: { name: string, args: any[] }[] }} Part */

/**
 * "Hi {{ a.b | upper }}" -> parts: ['Hi ', { path, segs, filters }], or an error.
 * Parsed once and checked by schema.js, so a bad template is caught on save.
 * @returns {{ ok: true, parts: (string | Part)[], error?: undefined } | { ok: false, error: string, parts?: undefined }}
 */
function parseTemplate(text) {
  const s = String(text ?? '');
  if (s.length > MAX_TEMPLATE) return { ok: false, error: `Text is too long (over ${MAX_TEMPLATE} characters)` };
  /** @type {(string | Part)[]} */
  const parts = [];
  let i = 0;
  let subs = 0;
  while (i < s.length) {
    const open = s.indexOf('{{', i);
    if (open < 0) { parts.push(s.slice(i)); break; }
    if (open > i) parts.push(s.slice(i, open));
    const close = s.indexOf('}}', open + 2);
    if (close < 0) return { ok: false, error: 'A {{ has no matching }}' };
    if (++subs > MAX_SUBSTITUTIONS) return { ok: false, error: `Too many {{ }} values (over ${MAX_SUBSTITUTIONS})` };
    const inner = s.slice(open + 2, close);
    const [head, ...pipes] = splitPipes(inner);
    const segs = parsePath(head);
    if (!segs) return { ok: false, error: `“${head.trim().slice(0, 40)}” isn't a value Shellby knows how to read` };
    const filters = [];
    for (const p of pipes) {
      const m = /^\s*([a-z]+)\s*([\s\S]*)$/.exec(p);
      if (!m || !FILTERS.includes(m[1])) return { ok: false, error: `Unknown filter “${p.trim().slice(0, 20)}”` };
      const args = parseArgs(m[2].trim());
      if (!args) return { ok: false, error: `The filter “${m[1]}” has arguments Shellby can't read` };
      filters.push({ name: m[1], args });
    }
    parts.push({ path: head.trim(), segs, filters });
    i = close + 2;
  }
  return { ok: true, parts };
}

const evalPart = (part, ctx) => part.filters.reduce((v, f) => applyFilter(v, f.name, f.args), lookup(ctx, part.segs));

/**
 * Template -> string. `quote(value, part)` formats each substitution (Claude
 * prompts wrap it «», commands make it a literal). Throws on a bad template:
 * callers validate first.
 * @param {string} text
 * @param {any} ctx
 * @param {{ quote?: (value: any, part: Part) => string }} [opts]
 */
function render(text, ctx, { quote = toText } = {}) {
  const parsed = parseTemplate(text);
  if (!parsed.ok) throw new Error(parsed.error);
  let out = '';
  for (const part of parsed.parts) {
    out += typeof part === 'string' ? part : quote(evalPart(part, ctx), part);
    if (out.length > MAX_RENDERED) return out.slice(0, MAX_RENDERED);
  }
  return out;
}

/**
 * A template that is nothing but one {{ value }} gives that value as it is (a
 * list stays a list, for `each` and `set`); anything else renders as text.
 */
function resolve(text, ctx) {
  const parsed = parseTemplate(text);
  if (!parsed.ok) throw new Error(parsed.error);
  const p = parsed.parts;
  if (p.length === 1 && typeof p[0] !== 'string') return evalPart(p[0], ctx);
  return render(text, ctx);
}

/** Every path a template reads, as segment arrays (for checks on save). */
function templateRefs(text) {
  const parsed = parseTemplate(text);
  return parsed.ok ? parsed.parts.filter(p => typeof p !== 'string').map(p => p.segs) : [];
}

const hasTemplate = text => typeof text === 'string' && text.includes('{{');

// ---------------------------------------------------------------- conditions

const KEYWORDS = { and: 'and', or: 'or', not: 'not', contains: 'op', true: 'lit', false: 'lit', null: 'lit' };
const OPS = ['==', '!=', '>=', '<=', '>', '<'];

function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')') { toks.push({ t: c }); i++; continue; }
    const op = OPS.find(o => src.startsWith(o, i));
    if (op) { toks.push({ t: 'op', v: op }); i += op.length; continue; }
    if (c === '!' ) { toks.push({ t: 'not' }); i++; continue; }
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new Error('A quote is never closed');
      toks.push({ t: 'lit', v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const num = /^-?\d+(\.\d+)?/.exec(src.slice(i));
    if (num && (c !== '-' || /\d/.test(src[i + 1] || ''))) { toks.push({ t: 'lit', v: Number(num[0]) }); i += num[0].length; continue; }
    const word = /^[A-Za-z_][\w.[\]-]*/.exec(src.slice(i));
    if (word) {
      const w = word[0];
      const kw = KEYWORDS[w.toLowerCase()];
      if (kw === 'lit') toks.push({ t: 'lit', v: { true: true, false: false, null: null }[w.toLowerCase()] });
      else if (kw === 'op') toks.push({ t: 'op', v: 'contains' });
      else if (kw) toks.push({ t: kw });
      else {
        const segs = parsePath(w);
        if (!segs) throw new Error(`“${w.slice(0, 40)}” isn't a value Shellby knows how to read`);
        toks.push({ t: 'path', v: segs, text: w });
      }
      i += w.length;
      continue;
    }
    throw new Error(`Unexpected “${c}”`);
  }
  return toks;
}

// or > and > not > comparison > primary
function parseCondition(text) {
  let src = String(text ?? '').trim();
  const wrapped = /^\{\{([\s\S]*)\}\}$/.exec(src);
  if (wrapped) src = wrapped[1].trim();
  if (!src) return { ok: false, error: 'The condition is empty' };
  if (src.length > MAX_CONDITION) return { ok: false, error: 'The condition is too long' };
  let toks;
  try { toks = tokenize(src); } catch (e) { return { ok: false, error: e.message }; }
  let pos = 0;
  let depth = 0;
  const peek = () => toks[pos];
  const take = t => (peek()?.t === t ? toks[pos++] : null);
  function or() {
    let left = and();
    while (take('or')) left = { k: 'or', a: left, b: and() };
    return left;
  }
  function and() {
    let left = not();
    while (take('and')) left = { k: 'and', a: left, b: not() };
    return left;
  }
  function not() {
    if (take('not')) return { k: 'not', a: not() };
    return cmp();
  }
  function cmp() {
    const left = primary();
    const op = peek()?.t === 'op' ? toks[pos++].v : null;
    return op ? { k: 'cmp', op, a: left, b: primary() } : left;
  }
  function primary() {
    const tok = toks[pos++];
    if (!tok) throw new Error('The condition stops too soon');
    if (tok.t === '(') {
      if (++depth > MAX_DEPTH) throw new Error('Too many brackets');
      const inner = or();
      depth--;
      if (!take(')')) throw new Error('A bracket is never closed');
      return inner;
    }
    if (tok.t === 'lit') return { k: 'lit', v: tok.v };
    if (tok.t === 'path') return { k: 'path', v: tok.v };
    throw new Error('The condition has something out of place');
  }
  try {
    const ast = or();
    if (pos !== toks.length) throw new Error('The condition has something out of place');
    return { ok: true, ast };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function compare(op, a, b) {
  if (op === 'contains') {
    if (Array.isArray(a)) return a.some(x => toText(x) === toText(b));
    return toText(a).toLowerCase().includes(toText(b).toLowerCase());
  }
  if (numeric(a) && numeric(b)) {
    const x = Number(a), y = Number(b);
    return { '==': x === y, '!=': x !== y, '>': x > y, '>=': x >= y, '<': x < y, '<=': x <= y }[op];
  }
  if (op === '==' || op === '!=') {
    const blank = v => v === null || v === undefined;
    const same = blank(a) || blank(b) ? blank(a) === blank(b)
      : typeof a === 'boolean' || typeof b === 'boolean' ? truthy(a) === truthy(b)
        : toText(a) === toText(b);
    return op === '==' ? same : !same;
  }
  const x = toText(a), y = toText(b);
  return { '>': x > y, '>=': x >= y, '<': x < y, '<=': x <= y }[op];
}

function evaluate(node, ctx) {
  switch (node.k) {
    case 'lit': return node.v;
    case 'path': return lookup(ctx, node.v);
    case 'not': return !truthy(evaluate(node.a, ctx));
    case 'and': return truthy(evaluate(node.a, ctx)) && truthy(evaluate(node.b, ctx));
    case 'or': return truthy(evaluate(node.a, ctx)) || truthy(evaluate(node.b, ctx));
    case 'cmp': return compare(node.op, evaluate(node.a, ctx), evaluate(node.b, ctx));
    default: return false;
  }
}

/** Condition text -> boolean. Throws on a condition that doesn't parse. */
function test(text, ctx) {
  const parsed = parseCondition(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return truthy(evaluate(parsed.ast, ctx));
}

/** Every path a condition reads, as segment arrays. */
function conditionRefs(text) {
  const parsed = parseCondition(text);
  if (!parsed.ok) return [];
  const out = [];
  (function walk(n) {
    if (!n) return;
    if (n.k === 'path') out.push(n.v);
    walk(n.a); walk(n.b);
  })(parsed.ast);
  return out;
}

// ---------------------------------------------------------------- quoting

// For a Claude prompt: the value is clearly data. «» can't be closed early by
// the value itself, since any » inside it is replaced.
const quoteForClaude = v => `«${toText(v).replace(/[«»]/g, '"')}»`;

// For a PowerShell command: a single-quoted literal, where nothing is special
// except the quote itself, which is doubled. The typographic single quotes are
// also quote characters to PowerShell, so they're doubled too.
const quoteForPowerShell = v => `'${toText(v).replace(/[\u0000]/g, '').replace(/['‘’‚‛]/g, q => q + q)}'`;

// ---------------------------------------------------------------- commands

const MAX_ENV_VALUE = 30000;     // Windows allows 32,767 characters per variable
const ENV_PREFIX = 'SHELLBY_VALUE_';

/**
 * A command template for PowerShell, the way a database takes parameters: no
 * value is ever written into the command. Each {{ }} becomes $env:SHELLBY_VALUE_n
 * and its text goes in through the environment, so PowerShell reads it as one
 * string and never as code, whether it stands alone or sits inside "...".
 * (Inside '...' a variable isn't expanded; schema.js refuses that placement.)
 *   -> { command, env: { SHELLBY_VALUE_1: text, ... } }
 */
function renderPowerShell(text, ctx) {
  const parsed = parseTemplate(text);
  if (!parsed.ok) throw new Error(parsed.error);
  const env = {};
  let n = 0;
  let command = '';
  for (const part of parsed.parts) {
    if (typeof part === 'string') { command += part; continue; }
    const name = `${ENV_PREFIX}${++n}`;
    env[name] = toText(evalPart(part, ctx)).replace(/\u0000/g, '').slice(0, MAX_ENV_VALUE);
    // Braced, so text straight after it ("{{ x }}.txt") isn't read as part of the name.
    command += `\${env:${name}}`;
  }
  return { command, env };
}

/**
 * The same for /bin/sh (a Mac's run steps, shells.js). A value is
 * "${SHELLBY_VALUE_n}": sh expands a variable once and never reads what's in
 * it as code, and the quotes keep it one word, unsplit and unglobbed. Inside
 * "..." it's the bare ${...}, already quoted. (PowerShell's ${env:X} is
 * substring expansion of $env in sh, so every value came out empty.)
 *   -> { command, env: { SHELLBY_VALUE_1: text, ... } }
 */
function renderShell(text, ctx) {
  const parsed = parseTemplate(text);
  if (!parsed.ok) throw new Error(parsed.error);
  const scan = shellScan(parsed.parts);
  if (scan.problem) throw new Error(scan.problem);
  const env = {};
  let n = 0;
  let command = '';
  for (const part of parsed.parts) {
    if (typeof part === 'string') { command += part; continue; }
    const name = `${ENV_PREFIX}${++n}`;
    env[name] = toText(evalPart(part, ctx)).replace(/\u0000/g, '').slice(0, MAX_ENV_VALUE);
    command += scan.inDouble[n - 1] ? `\${${name}}` : `"\${${name}}"`;
  }
  return { command, env };
}

// Where bash (a Mac's /bin/sh) evaluates arithmetic, which runs a[$(cmd)]:
// $(( )), (( )), $[ ], [[ ]], let, and integer variables (declare -i and its
// kin); and the nestings ($( ), backticks, $'...', $"...", here-docs) that a
// quote scanner can't follow. A command with a {{ value }} may have none of them.
const SH_REFUSED = [/\$\(/, /`/, /\(\(/, /\$\[/, /\[\[/, /<</, /\$'/, /\$"/,
  /(?:^|[\s;&|(])(?:let|eval|declare|typeset|local|readonly)(?=\s)/];
const SH_REFUSED_MSG = "On a Mac, a {{ value }} can't share a command with $( ), backticks, (( )), $[ ], [[ ]], $'...', a here-doc, let, eval, declare, typeset, local or readonly: sh could read the value as code there. Put that part in a step of its own.";
const SH_WORD_MSG = 'On a Mac, a {{ value }} must be a word of its own or sit inside "double quotes", so sh reads it as text.';
// Outside quotes, what may stand either side of a value: an allowlist, so a
// subscript (a[{{ v }}]) or anything else sh treats specially is refused.
const SH_BEFORE = /[\s;&|=:,/]/;
const SH_AFTER = /[\s;&|)/.:,]/;
// sh's metacharacters: a word starts after any of them, and a # there starts a comment.
const SH_META = /[\s;&|()<>]/;

/**
 * Each value must stand as its own word or sit inside plain "double quotes".
 * -> { problem: why not, or null; inDouble: per value, whether it's inside "..." }
 * @param {any[]} parts parseTemplate's
 */
function shellScan(parts) {
  /** @type {boolean[]} */
  const inDouble = [];
  const result = problem => ({ problem, inDouble });
  if (parts.every(p => typeof p === 'string')) return result(null);
  const literal = parts.filter(p => typeof p === 'string').join(' ');
  if (SH_REFUSED.some(re => re.test(literal))) return result(SH_REFUSED_MSG);
  let single = false, double = false, braces = 0;
  let prev = ''; // the last character before this point ('' at the start, or right after a value)
  let wordStart = true; // is the next character the start of a word, as sh splits them?
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k];
    if (typeof part !== 'string') {
      if (single) return result('A {{ value }} inside \'single quotes\' stays as text. Put it in "double quotes", or on its own.');
      if (braces > 0) return result('A {{ value }} inside ${ } is read as more than text by sh. Put it on its own, or in "double quotes".');
      const next = typeof parts[k + 1] === 'string' ? parts[k + 1][0] || '' : '';
      if (double ? prev === '[' : (prev && !SH_BEFORE.test(prev)) || (next && !SH_AFTER.test(next))) return result(SH_WORD_MSG);
      inDouble.push(double);
      prev = '';
      wordStart = false; // what follows a value is the same word
      continue;
    }
    for (let i = 0; i < part.length; i++) {
      const c = part[i];
      prev = c;
      if (single) { if (c === "'") single = false; wordStart = false; continue; }
      // An escaped character is plain text, never a boundary: "a\ #b" is one word.
      if (c === '\\') { i++; prev = part[i] ?? ''; wordStart = false; continue; }
      // A comment: an unquoted # at the start of a word, outside ${ } (where # is
      // an operator, ${x#pat}). To the end of the line.
      if (c === '#' && wordStart && !double && braces === 0) {
        const nl = part.indexOf('\n', i);
        if (nl < 0) return result('On a Mac, a {{ value }} after a # comment is never run. Take it out of the comment.');
        i = nl; prev = '\n'; wordStart = true; continue;
      }
      if (c === '$' && part[i + 1] === '{') { braces++; i++; prev = '{'; wordStart = false; continue; }
      if (c === '}' && braces > 0) braces--;
      else if (c === '"') double = !double;
      else if (c === "'" && !double) single = true;
      // A new word starts only after an unquoted, unescaped metacharacter.
      wordStart = !double && !single && braces === 0 && SH_META.test(c);
    }
  }
  // Unbalanced quotes or ${ at the end: sh would read it differently, or not at all.
  if (single || double || braces) return result('On a Mac, this command leaves a quote or ${ open, so sh would read it differently. Close it.');
  return result(null);
}

/** Why sh can't take this template safely, or null: the editor's lint on a Mac. */
function shellProblem(text) {
  const parsed = parseTemplate(text);
  return parsed.ok ? shellScan(parsed.parts).problem : parsed.error;
}

/**
 * Is any {{ }} inside a single-quoted PowerShell string, where it would stay
 * as the literal text "$env:..."? A lint for the editor only: getting this
 * wrong costs a confusing message, never safety (the value is never in the command).
 */
function valuesInSingleQuotes(text) {
  const parsed = parseTemplate(text);
  if (!parsed.ok) return false;
  let single = false, double = false;
  for (const part of parsed.parts) {
    if (typeof part !== 'string') { if (single) return true; continue; }
    for (let i = 0; i < part.length; i++) {
      const c = part[i];
      if (single) { if ("'‘’‚‛".includes(c)) { if ("'‘’‚‛".includes(part[i + 1] || '')) i++; else single = false; } continue; }
      if (c === '`') { i++; continue; }
      if (double) { if ('"“”„'.includes(c)) double = false; continue; }
      if (c === '#') { const nl = part.indexOf('\n', i); i = nl < 0 ? part.length : nl; continue; }
      if ("'‘’‚‛".includes(c)) single = true;
      else if ('"“”„'.includes(c)) double = true;
    }
  }
  return false;
}

module.exports = {
  renderPowerShell, renderShell, shellProblem, valuesInSingleQuotes,
  ROOTS, FILTERS,
  parsePath, getPath, lookup, toText, truthy,
  parseTemplate, render, resolve, templateRefs, hasTemplate,
  parseCondition, evaluate, test, conditionRefs,
  quoteForClaude, quoteForPowerShell,
};
