// The checks every save of a page's files goes through (create_page,
// update_page, going back to a version, a page arriving from somewhere else).
// The sandbox and the CSP stop all of this anyway; the checks exist so a
// broken page fails at save time with a reason Claude can act on, instead of
// going blank in front of you. A failure is the tool's error.
//
// Pure: test/pages-checks.test.js.
const { LIMITS } = require('./limits');
const { isFileName, hostOf } = require('./format');

// Served by Shellby to every page; a page can't ship its own copy.
const RESERVED = Object.freeze(['shellby.js', 'guard.js', 'page.json', 'data.json', 'activity.json']);
const BRIDGE_FILE = 'shellby.js';

const bytes = s => Buffer.byteLength(s, 'utf8');
const kb = n => `${Math.ceil(n / 1024)} KB`;

/** Files as a tool passed them: { "index.html": "...", ... } -> a clean map, or an error. */
function filesOf(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'files must be an object of file name to text, like { "index.html": "..." }.' };
  const names = Object.keys(raw);
  if (!names.length) return { ok: false, error: 'A page needs at least index.html.' };
  if (names.length > LIMITS.FILE_COUNT) return { ok: false, error: `A page has at most ${LIMITS.FILE_COUNT} files; this has ${names.length}.` };
  const files = {};
  for (const name of names) {
    if (RESERVED.includes(name.toLowerCase())) return { ok: false, error: `${name} is Shellby's own: leave it out (the page gets ${BRIDGE_FILE} without shipping it).` };
    if (!isFileName(name)) return { ok: false, error: `"${String(name).slice(0, 60)}" isn't a file name a page can use: flat (no folders), and .html, .js, .css, .svg, .json, .txt or .md.` };
    if (typeof raw[name] !== 'string') return { ok: false, error: `${name} must be text.` };
    files[name.toLowerCase() === 'index.html' ? 'index.html' : name] = raw[name];
  }
  if (!('index.html' in files)) return { ok: false, error: 'A page needs an index.html.' };
  return { ok: true, files };
}

/**
 * Cut every open...close comment out, in one pass. A lazy regex like
 * /<!--[\s\S]*?-->/ rescans to the end for each unclosed opener, which is
 * quadratic: "<!--" repeated over a few MB froze main for minutes. An unclosed
 * comment runs to the end, as a browser reads it.
 */
function cut(s, open, close) {
  let out = '';
  let at = 0;
  for (;;) {
    const i = s.indexOf(open, at);
    if (i < 0) return out + s.slice(at);
    out += s.slice(at, i);
    const j = s.indexOf(close, i + open.length);
    if (j < 0) return out;
    at = j + close.length;
  }
}
const stripComments = {
  html: s => cut(s, '<!--', '-->'),
  css: s => cut(s, '/*', '*/'),
  // Good enough to keep a comment from tripping a check; not a JS parser.
  js: s => cut(s, '/*', '*/').replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1'),
};
const REMOTE = /^\s*(?:https?:)?\/\//i;

/**
 * Every start tag, as { tag, text, end } (text: "<name attrs", end: where it
 * stops). One pass: a token runs to the next < or >, so tokens never overlap
 * and no pattern rescans the file. (Patterns like /<link\b[^>]*\bhref/ over the
 * whole file were quadratic: a few hundred KB of "<a " took a minute.)
 */
function* tags(html) {
  for (const m of html.matchAll(/<([a-z][a-z0-9-]*)\b[^<>]*/gi)) {
    yield { tag: m[1].toLowerCase(), text: m[0], end: /** @type {number} */ (m.index) + m[0].length };
  }
}

/** What's between a tag's end and its closing tag (to the end if it never closes, as a browser reads it). lower: html.toLowerCase(), once. */
function body(html, lower, from, tag) {
  const close = lower.indexOf(`</${tag}`, from);
  return { text: html.slice(from + 1, close < 0 ? html.length : close), next: close < 0 ? html.length : close };
}

/** The text of every <style> block. */
function styleBodies(html) {
  const lower = html.toLowerCase();
  const out = [];
  let skipTo = 0;
  for (const t of tags(html)) {
    if (t.end <= skipTo || (t.tag !== 'style' && t.tag !== 'script')) continue;
    const b = body(html, lower, t.end, t.tag);
    skipTo = b.next;
    if (t.tag === 'style') out.push(b.text);
  }
  return out;
}

const attr = (text, re) => re.exec(text)?.[1];

/** Problems in one HTML file. */
function htmlProblems(name, src) {
  const out = [];
  const html = stripComments.html(src);
  const lower = html.toLowerCase();
  let skipTo = 0; // inside a <script>'s body, nothing is a tag
  let handler = null;
  for (const t of tags(html)) {
    if (t.end <= skipTo) continue;
    if (t.tag === 'script') {
      const srcAttr = attr(t.text, /\ssrc\s*=\s*["']?([^"'\s>]+)/i);
      const b = body(html, lower, t.end, 'script');
      skipTo = b.next;
      if (!srcAttr && b.text.trim()) out.push(`${name}: an inline <script> won't run (the page's CSP allows only its own files). Move it to a .js file and load it with <script src="...">.`);
      if (srcAttr && REMOTE.test(srcAttr)) out.push(`${name}: <script src="${srcAttr.slice(0, 80)}"> loads from the web, which a page can't. Put the code in the page's own files.`);
    } else if (t.tag === 'link') {
      const href = attr(t.text, /\shref\s*=\s*["']?([^"'\s>]+)/i);
      if (href && REMOTE.test(href)) out.push(`${name}: <link href="${href.slice(0, 80)}"> loads from the web, which a page can't. Put the stylesheet or font in the page's own files.`);
    } else if (['img', 'iframe', 'audio', 'video', 'source', 'embed', 'object'].includes(t.tag)) {
      const from = attr(t.text, /\s(?:src|data)\s*=\s*["']?([^"'\s>]+)/i);
      if (from && REMOTE.test(from)) out.push(`${name}: "${from.slice(0, 80)}" loads from the web, which a page can't. Use a data: URL, an SVG file, or shellby.fetch().`);
    }
    handler ||= attr(t.text, /\s(on[a-z]+)\s*=/i);
  }
  if (handler) out.push(`${name}: inline handlers like ${handler}="..." are blocked by the page's CSP. Use addEventListener in a .js file.`);
  if (/\b(?:href|src|action)\s*=\s*["']?\s*javascript:/i.test(html)) out.push(`${name}: javascript: links are blocked by the page's CSP. Use addEventListener.`);
  // Anything that makes a window of its own (guard.js only reaches the page's), and shadow
  // roots from HTML, which can be closed to it.
  const framed = /<(iframe|frame|object|embed|portal|fencedframe)\b/i.exec(html);
  if (framed) out.push(`${name}: a page can't hold frames of its own (<${framed[1].toLowerCase()}>).`);
  if (/\sshadowroot(?:mode)?\s*=/i.test(html)) out.push(`${name}: shadow roots from HTML (shadowrootmode) aren't allowed. Use attachShadow in a .js file.`);
  return out;
}

/** Problems in one CSS file or <style> block. */
function cssProblems(name, src) {
  const out = [];
  const css = stripComments.css(src);
  for (const m of css.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)/gi)) {
    if (REMOTE.test(m[1])) out.push(`${name}: @import "${m[1].slice(0, 80)}" loads from the web, which a page can't.`);
  }
  for (const m of css.matchAll(/url\(\s*["']?([^"')\s]+)/gi)) {
    if (REMOTE.test(m[1])) out.push(`${name}: url(${m[1].slice(0, 80)}) loads from the web, which a page can't. Put the file in the page or use a data: URL.`);
  }
  return out;
}

/** Problems in one JS file, and what it calls on the bridge. */
function jsProblems(name, src) {
  const out = [];
  const js = stripComments.js(src);
  if (/(^|[^\w$.])eval\s*\(/.test(js)) out.push(`${name}: eval() is blocked by the page's CSP.`);
  if (/\bnew\s+Function\s*\(/.test(js)) out.push(`${name}: new Function() is blocked by the page's CSP.`);
  if (/\bset(?:Timeout|Interval)\s*\(\s*["'`]/.test(js)) out.push(`${name}: setTimeout/setInterval with a string is blocked by the page's CSP. Pass a function.`);
  // Bounded: an unbounded [\w{}*,\s]+ before "from" rescanned for every "import" (quadratic).
  for (const m of js.matchAll(/\bimport\s*(?:\(\s*|[\w{}*,\s]{1,400}from\s*)["'`]([^"'`\n]{1,400})/g)) {
    if (REMOTE.test(m[1])) out.push(`${name}: import from "${m[1].slice(0, 80)}" loads from the web, which a page can't.`);
  }
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(js.replace(/\bshellby\.fetch\s*\(/g, ''))
    || /\bnew\s+(?:XMLHttpRequest|WebSocket|EventSource)\b/.test(js)) {
    out.push(`${name}: a page can't reach the network itself. Use shellby.fetch(url), and list the host in access.web.`);
  }
  /** @type {{ read: string[], ask: boolean, notify: boolean, hosts: string[] }} */
  const calls = { read: [], ask: false, notify: false, hosts: [] };
  for (const m of js.matchAll(/\bshellby\.read\s*\(\s*["'`]([a-z]+)["'`]/g)) calls.read.push(m[1]);
  if (/\bshellby\.ask\s*\(/.test(js)) calls.ask = true;
  if (/\bshellby\.notify\s*\(/.test(js)) calls.notify = true;
  for (const m of js.matchAll(/\bshellby\.fetch\s*\(\s*["'`](https?:\/\/[^"'`\s]+)/g)) {
    if (m[1].startsWith('http://')) out.push(`${name}: shellby.fetch("${m[1].slice(0, 80)}") is plain http; only https works.`);
    else { const h = hostOf(m[1]); if (h) calls.hosts.push(h); }
  }
  return { problems: out, calls };
}

/**
 * Every check on a save: files (already through filesOf) and the access the
 * page.json asks for. -> { ok, errors: string[], notes: string[], bytes }
 * notes are things worth saying that don't stop the save.
 */
function check(files, access) {
  const errors = [];
  const notes = [];
  const total = Object.values(files).reduce((n, s) => n + bytes(s), 0);
  // Too big stops here, before any pattern reads the files: the size limit is what bounds their cost.
  if (total > LIMITS.FILES_BYTES) return { ok: false, errors: [`The page's files are ${kb(total)}; the most is ${kb(LIMITS.FILES_BYTES)}.`], notes, bytes: total };
  const used = { read: new Set(), ask: false, notify: false, hosts: new Set() };
  for (const [name, src] of Object.entries(files)) {
    const ext = String(name.split('.').pop()).toLowerCase();
    if (ext === 'html') {
      errors.push(...htmlProblems(name, src));
      for (const css of styleBodies(stripComments.html(src))) errors.push(...cssProblems(name, css));
      for (const m of src.matchAll(/\bstyle\s*=\s*"([^"]*)"/gi)) errors.push(...cssProblems(name, m[1]));
    } else if (ext === 'css') {
      errors.push(...cssProblems(name, src));
    } else if (ext === 'js') {
      const r = jsProblems(name, src);
      errors.push(...r.problems);
      r.calls.read.forEach(x => used.read.add(x));
      used.ask ||= r.calls.ask;
      used.notify ||= r.calls.notify;
      r.calls.hosts.forEach(h => used.hosts.add(h));
    } else if (/<script\b|\son[a-z]+\s*=|javascript:/i.test(stripComments.html(src))) {
      // An SVG, JSON or text file is served with no script at all, so code in one never runs.
      errors.push(`${name}: code in a .${ext} file never runs (a page's scripts are its .js files). Take the <script>, handlers or javascript: links out.`);
    }
  }
  const loadsBridge = [...tags(stripComments.html(files['index.html'] || ''))]
    .some(t => t.tag === 'script' && /\ssrc\s*=\s*["']?\.?\/?shellby\.js(?:["'\s/]|$)/i.test(t.text));
  if (!loadsBridge) {
    errors.push('index.html must load the bridge before its own scripts: <script src="shellby.js"></script>. Without it the page gets no data, and Shellby can\'t tell when it breaks.');
  }
  for (const r of used.read) if (!access.read.includes(r)) errors.push(`The code calls shellby.read('${r}'), but access.read doesn't list "${r}".`);
  if (used.ask && !access.ask) errors.push('The code calls shellby.ask(), but access.ask isn\'t true.');
  if (used.notify && !access.notify) errors.push('The code calls shellby.notify(), but access.notify isn\'t true.');
  for (const h of used.hosts) if (!access.web.includes(h)) errors.push(`The code fetches from ${h}, but access.web doesn't list it.`);
  for (const r of access.read) if (!used.read.has(r)) notes.push(`access.read lists "${r}" but no code calls shellby.read('${r}'); asking for less is better.`);
  return { ok: errors.length === 0, errors: [...new Set(errors)].slice(0, 20), notes, bytes: total };
}

module.exports = { RESERVED, BRIDGE_FILE, filesOf, check };
