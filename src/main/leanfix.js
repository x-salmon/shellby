// One-tap fixes for repeated big reads and loud commands, drafted from what the
// Lean tab measured (usage/hotfiles.js, usage/loud.js), with no model call:
//   - a file Claude keeps reading gets a line in CLAUDE.md saying what it holds,
//     written from the file's own first lines (its leading comment, heading or
//     the names it defines), so Claude needn't open it to find out;
//   - a lockfile, build output or generated file read whole gets a permissions
//     deny rule, Read(./path), in the project's .claude/settings.json;
//   - a command whose output fills the context gets a quieter way to run it,
//     as words only.
// Each fix carries the file's text before and after, so the panel can show the
// diff and lean-fixes.js can check nothing changed before writing.
//
// Pure: no I/O (test/leanfix.test.js). lean-fixes.js reads and writes the files.

const { compactTokens } = require('./fixedcost');

const HEADING = '## Where things live';
const MAX_SUMMARY = 140;
const HEAD_LINES = 60;           // of a file's head, enough for a comment block or a heading
const MIN_SENTENCE = 20;         // a "sentence" shorter than this is an abbreviation's full stop
const MAX_NAMES = 6;
const MAX_FIXES = 12;            // file fixes; loud commands come as the report lists them
const MAX_REL = 1000;

const GENERATED = [
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|cargo\.lock|poetry\.lock|uv\.lock|pipfile\.lock|gemfile\.lock|composer\.lock|go\.sum|packages\.lock\.json|flake\.lock|mix\.lock|pubspec\.lock|deno\.lock)$/i,
  /(^|\/)(dist|build|out|coverage|node_modules|__generated__|__snapshots__|\.next|\.nuxt|\.turbo|\.cache|\.parcel-cache)\//i,
  /(^|\/)target\/(debug|release)\//i,
  /\.(min\.(js|css)|map|snap|pb\.go|pb\.cc|pb\.h|g\.cs|d\.ts\.map)$/i,
  /\.generated\.[\w.]+$/i,
];

// Lines at the top of a file that aren't about what it does.
const NOT_A_DESCRIPTION = /^(#!|['"]use strict['"];?$|\/[/*]\s*(eslint|global|jshint|@ts-|prettier|biome|oxlint))/i;
const LICENCE = /copyright|licen[cs]e|spdx|all rights reserved|\(c\)\s*\d{4}/i;
// How a comment line opens in most languages; a closing marker on the same line is dropped (commentText).
const COMMENT_OPEN = /^\s*(?:\/\/+|#(?!!)|\/\*+|\*+|<!--|--(?!-)|;;|'''|""")\s?/;
const COMMENT_CLOSE = ['*/', '-->', "'''", '"""'];
const DEFINES = /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\*?|class|def|fn|func|interface|type|enum|struct|trait)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORTED_CONST = /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm;
// Control characters, and the ones that look like nothing or reorder what's
// around them (zero-width, bidi marks, a BOM mid-string): what the confirm
// window shows has to be all there is.
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/;
const CONTROL_RUN = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]+/g;

const str = v => (typeof v === 'string' ? v : '');
const list = v => (Array.isArray(v) ? v : []);
const num = v => (Number.isFinite(v) && v > 0 ? v : 0);
const normalise = text => str(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const clean = s => str(s).replace(CONTROL_RUN, ' ').replace(/`/g, '').replace(/\s+/g, ' ').trim();
const extOf = rel => (/\.([A-Za-z0-9]+)$/.exec(str(rel))?.[1] || '').toLowerCase();
const tok = n => `~${compactTokens(n)} tokens`;

/** A lockfile, build output or a generated file: read whole, it tells Claude nothing it can use. */
function isGenerated(rel) {
  const r = str(rel).replace(/\\/g, '/');
  return !!r && GENERATED.some(re => re.test(r));
}

// ---- a line about a file

/** The first sentence of a run of text, or all of it, cut at a word to fit the line. */
function firstSentence(text) {
  let s = clean(text);
  const m = new RegExp(`^(.{${MIN_SENTENCE},}?[.!?])(?=\\s|$)`).exec(s);
  if (m) s = m[1];
  if (s.length > MAX_SUMMARY) s = `${s.slice(0, MAX_SUMMARY).replace(/\s+\S*$/, '').trimEnd()}…`;
  return s;
}

/** "a, b and c", or "a, b, c, d, e, f and 3 more". */
function joinNames(names) {
  const shown = names.slice(0, MAX_NAMES);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0] || '';
}

/** What a comment line says, or null for a line that isn't one. Plain string work after the opener: no regex over the rest. */
function commentText(line) {
  const m = COMMENT_OPEN.exec(line);
  if (!m) return null;
  let text = line.slice(m[0].length).trim();
  const close = COMMENT_CLOSE.find(c => text.endsWith(c));
  if (close) text = text.slice(0, -close.length).trimEnd();
  return text;
}

function fromComments(lines) {
  const got = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) { if (got.length) break; continue; }
    if (!got.length && NOT_A_DESCRIPTION.test(t)) continue;
    if (t === '*/') break;
    const text = commentText(line);
    if (text === null) break;
    if (!text) { if (got.length) break; continue; }
    if (/^@\w/.test(text)) break;
    if (!got.length && LICENCE.test(text)) continue;
    got.push(text);
  }
  return got.length ? firstSentence(got.join(' ')) : null;
}

function fromMarkdown(lines) {
  let i = 0;
  if (lines[0]?.trim() === '---') { i = lines.findIndex((l, k) => k > 0 && l.trim() === '---') + 1; if (!i) return null; }
  const at = lines.findIndex((l, k) => k >= i && /^#{1,6}\s+\S/.test(l));
  if (at < 0) return null;
  const heading = clean(lines[at].replace(/^#+\s+/, '').replace(/\s+#+$/, ''));
  const para = [];
  for (const l of lines.slice(at + 1)) {
    if (!l.trim()) { if (para.length) break; continue; }
    if (/^(#{1,6}\s|```|~~~|<)/.test(l)) break;
    para.push(l);
  }
  if (!heading) return null;
  return para.length ? firstSentence(`${heading}: ${para.join(' ')}`) : firstSentence(heading);
}

function fromJson(lines, rel) {
  const text = lines.join('\n');
  const field = k => new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text)?.[1];
  const name = field('name');
  if (/(^|\/)package\.json$/i.test(rel) && name) {
    const desc = field('description');
    return firstSentence(desc ? `Package manifest for ${name}: ${desc}.` : `Package manifest for ${name}.`);
  }
  const keys = [...text.matchAll(/^(?: {2}|\t)"([^"]+)"\s*:/gm)].map(m => m[1]);
  return keys.length ? firstSentence(`JSON with ${joinNames([...new Set(keys)])}.`) : null;
}

function fromNames(text) {
  const names = [...new Set([...text.matchAll(DEFINES), ...text.matchAll(EXPORTED_CONST)].sort((a, b) => a.index - b.index).map(m => m[1]))];
  return names.length ? firstSentence(`Defines ${joinNames(names)}.`) : null;
}

/**
 * One line saying what a file holds, from its first lines: the leading comment
 * block (licence headers skipped), a markdown heading and its first paragraph,
 * a manifest's name and description, or the names it defines. null when its
 * head gives nothing worth saying.
 * @param {string | null | undefined} head  the file's first few KB
 * @param {string} rel
 * @returns {string | null}
 */
function summaryOf(head, rel) {
  const lines = normalise(head).split('\n').slice(0, HEAD_LINES);
  if (!lines.some(l => l.trim())) return null;
  const ext = extOf(rel);
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return fromMarkdown(lines) || fromComments(lines);
  if (ext === 'json' || ext === 'jsonc' || ext === 'json5') return fromJson(lines, str(rel).replace(/\\/g, '/'));
  return fromComments(lines) || fromNames(lines.join('\n'));
}

/** The CLAUDE.md bullet: the path in code, then the summary, ending in a full stop. */
function claudeLine(rel, summary) {
  const r = str(rel);
  const s = clean(summary);
  if (!r || r.length > MAX_REL || CONTROL.test(r) || r.includes('`') || !s) return null;
  return `- \`${r}\`: ${/[.!?…]$/.test(s) ? s : `${s}.`}`;
}

const isHeading = line => /^#{1,2}\s/.test(line);
const BULLET = /^[-*]\s+\S/;

/**
 * The bullet added under "Where things live": a new section at the end of the
 * file, or after the last bullet of the one already there. -> { text, added, fresh }
 * @param {string} md
 * @param {string} bullet
 */
function appendUnder(md, bullet) {
  const text = normalise(md);
  const lines = text.split('\n');
  const at = lines.findIndex(l => l.trim().toLowerCase() === HEADING.toLowerCase());
  if (at < 0) {
    const gap = !text ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
    const added = `${gap}${HEADING}\n\n${bullet}\n`;
    return { text: text + added, added, fresh: true };
  }
  let end = at + 1;
  while (end < lines.length && !isHeading(lines[end])) end++;
  let last = at;
  for (let i = at + 1; i < end; i++) if (BULLET.test(lines[i])) last = i;
  const insert = last === at ? ['', bullet] : [bullet];
  const out = [...lines.slice(0, last + 1), ...insert, ...lines.slice(last + 1)].join('\n');
  return { text: out.endsWith('\n') ? out : `${out}\n`, added: `${bullet}\n`, fresh: false };
}

/** Does the memory file already name this path (either slant of slash)? */
function mentions(md, rel) {
  const r = str(rel).replace(/\\/g, '/').toLowerCase();
  return !!r && normalise(md).replace(/\\/g, '/').toLowerCase().includes(r);
}

// ---- a deny rule

// Characters a permission rule reads as something other than themselves: globs,
// a negation, the rule's own brackets, a comment or a drive, and a backslash.
const RULE_UNSAFE = /[*?[\]{}!()#\\:]/;

/**
 * Read(./path) for a file inside the project, or null for a path that could
 * reach outside it or that a pattern would read as anything but the path.
 * @param {string} rel
 */
function denyRule(rel) {
  const r = str(rel);
  if (!r || r.length > MAX_REL || CONTROL.test(r) || RULE_UNSAFE.test(r) || /^[/~]/.test(r)) return null;
  if (r.split('/').some(seg => seg === '..' || seg === '.' || seg === '' || seg !== seg.trim())) return null;
  return `Read(./${r})`;
}

/**
 * The settings with the rule on its deny list, as the text to write:
 * { ok, text } or { ok: false, already?, error? }. raw: the file's text ('' when
 * there isn't one yet).
 * @param {string | null} raw
 * @param {string} rule
 */
function denyPlan(raw, rule) {
  if (typeof raw !== 'string' || !rule) return { ok: false, error: "Couldn't read the project's settings." };
  const text = normalise(raw).trim();
  /** @type {any} */
  let data = {};
  if (text) { try { data = JSON.parse(text); } catch { return { ok: false, error: "The project's settings.json isn't valid JSON, so Shellby left it alone." }; } }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: "The project's settings.json isn't a settings object." };
  if (data.permissions != null && (typeof data.permissions !== 'object' || Array.isArray(data.permissions))) return { ok: false, error: "The settings' permissions aren't an object, so Shellby left them alone." };
  const perms = data.permissions || {};
  if (perms.deny != null && !Array.isArray(perms.deny)) return { ok: false, error: "The settings' deny list isn't a list, so Shellby left it alone." };
  const deny = list(perms.deny);
  if (deny.includes(rule)) return { ok: false, already: true };
  const next = { ...data, permissions: { ...perms, deny: [...deny, rule] } };
  return { ok: true, text: `${JSON.stringify(next, null, 2)}\n` };
}

// ---- a quieter command

const TAIL = 'pipe it through `tail -n 60` (`2>&1 | tail -n 60` keeps the errors too)';
/** @type {[RegExp, string][]} */
const QUIETER = [
  [/^(npm test|npm run test\b|npx jest|jest|npx vitest|vitest|yarn test|pnpm test|bun test)/, 'Run it with a quiet reporter (`--reporter=dot` for vitest, `--silent` for jest) or pipe it through `tail -n 60`, so only the failures and the summary reach Claude.'],
  [/^git log\b/, 'Use `git log --oneline -n 30`: one line per commit is all Claude needs to find one.'],
  [/^git diff\b/, 'Ask for `git diff --stat` first, then the diff of the one file that matters.'],
  [/^git status\b/, '`git status --short` says the same in a tenth of the lines.'],
  [/^(cat|type|get-content|gc|bat|less|more|head|tail)$/, "Claude's Read tool shows a file with line numbers and can take a range; for a lockfile or build output, a deny rule keeps it out altogether."],
  [/^(ls|dir|get-childitem|gci|tree|find|fd)$/, 'Narrow it to one folder, or let Claude use Glob, which lists only the paths that match.'],
  [/^(grep|rg|ag|ack|select-string|sls|findstr)$/, "Add `-l` (file names only) or `--max-count`, or use Claude's Grep tool with files_with_matches."],
  [/^cargo (test|build|check|clippy)\b/, 'Add `-q` (`cargo test -q`), or pipe it through `tail -n 60`.'],
  [/^(pytest|python -m pytest|py -m pytest|uv run pytest|poetry run pytest)/, '`pytest -q --tb=short` keeps the summary and the failures and drops the rest.'],
  [/^go test\b/, '`go test ./... 2>&1 | tail -n 60`: `-v` prints every test, so leave it off.'],
  [/^dotnet (test|build|publish)\b/, 'Add `--verbosity quiet` (or `-v q`): the build log is rarely what Claude needs.'],
  [/^docker (build|compose)\b/, 'Add `--quiet` (`-q`), or `--progress=plain 2>&1 | tail -n 40`.'],
  [/^(npm|pnpm|yarn|bun) (install|ci|i|add)\b|^(yarn|pnpm)$/, 'Add `--silent --no-audit --no-fund`, or `2>&1 | tail -n 20`: the install log is rarely what Claude needs.'],
  [/^(curl|wget|iwr|invoke-webrequest|http)\b/, 'Add `-s` and pipe it through `head -c 4000`, or pick out one field with `jq`.'],
  [/^(node|python|python3|py|pwsh|powershell|bash|sh|ruby|php|deno|bun|tsx|ts-node) \S/, `Have the script print a summary and write the rest to a file Claude can Read a part of, or ${TAIL}.`],
  [/^(npm|pnpm|yarn|bun) run /, `Add a quieter script beside it that prints only a summary, or ${TAIL}.`],
];

/**
 * A quieter way to run a loud command (usage/loud.js key), as one sentence of
 * advice. The quiet-output hook (hooks/recipes.js) does the tail for test and
 * build runs by itself; this is for a command's own flags.
 * @param {string} key
 * @returns {string | null}
 */
function quietSuggestion(key) {
  if (typeof key !== 'string' || !key.trim()) return null;
  const k = key.trim().toLowerCase();
  const hit = QUIETER.find(([re]) => re.test(k));
  return hit ? hit[1] : `Add a flag that prints less, or ${TAIL}; the quiet-output hook does this for test and build runs automatically.`;
}

// ---- the fixes

/**
 * The fixes drafted from a hot-files report ({ files, loud } from
 * usage/hotfiles.js scanHotFiles): each a plain object with an id, kind
 * ('deny-read' | 'claude-line' | 'quiet'), title and why, and for the first two
 * the file with its text before and after, so the panel shows the diff and
 * nothing is written that wasn't shown. md: the project's CLAUDE.md (null when
 * unreadable); settingsRaw: its .claude/settings.json ('' when there isn't one,
 * null when unreadable); headOf(rel): a file's first few KB, or null.
 */
function draftFixes({ hot, md, mdFile, settingsRaw, settingsFile, headOf }) {
  /** @type {any[]} */
  const out = [];
  const files = list(hot?.files).filter(f => f && typeof f.rel === 'string' && num(f.reads));
  for (const f of files) {
    if (out.length >= MAX_FIXES) break;
    const each = num(f.tokens) ? `, ${tok(f.tokens)} each time` : '';
    if (isGenerated(f.rel)) {
      if (typeof settingsRaw !== 'string') continue;
      const rule = denyRule(f.rel);
      const plan = rule ? denyPlan(settingsRaw, rule) : null;
      if (!plan?.ok) continue;
      out.push({
        id: `deny:${f.rel}`, kind: 'deny-read', rel: f.rel, file: settingsFile, rule,
        title: `Keep ${f.rel} out of the conversation`,
        why: `A generated file, read ${f.reads}× in ${f.sessions} conversations${each}. A deny rule stops Claude reading it whole; it can still search inside it.`,
        saves: num(f.tokens) * f.reads, before: settingsRaw, after: plan.text, added: `"${rule}"`,
      });
      continue;
    }
    if (typeof md !== 'string' || mentions(md, f.rel)) continue;
    const line = claudeLine(f.rel, summaryOf(headOf(f.rel), f.rel) || '');
    if (!line) continue;
    const plan = appendUnder(md, line);
    out.push({
      id: `line:${f.rel}`, kind: 'claude-line', rel: f.rel, file: mdFile, line,
      title: `Tell Claude what ${f.rel} holds`,
      why: `Read ${f.reads}× in ${f.sessions} conversations${each}, often just to find something. A line in CLAUDE.md can save the read.`,
      saves: num(f.tokens), before: md, after: plan.text, added: plan.added,
    });
  }
  for (const c of list(hot?.loud)) {
    if (!c || typeof c.key !== 'string') continue;
    const suggestion = quietSuggestion(c.key);
    if (!suggestion) continue;
    out.push({
      id: `quiet:${c.key}`, kind: 'quiet', key: c.key, title: `Run ${c.key} more quietly`,
      why: `${tok(c.tokens)} a run, ${c.runs} runs in ${c.sessions} conversations, ${tok(c.total)} in all.`,
      suggestion, saves: num(c.tokens),
    });
  }
  return out;
}

module.exports = { isGenerated, summaryOf, claudeLine, appendUnder, mentions, denyRule, denyPlan, quietSuggestion, draftFixes, HEADING, MAX_FIXES };
