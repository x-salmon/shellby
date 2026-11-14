// What a page is on disk: its id, its page.json, its file names and its access.
// Everything here reads untrusted input (a model wrote it, or a file it wrote
// came back from disk) and returns a clean copy or an error; nothing is changed
// in place. Pure: test/pages-format.test.js.
const { LIMITS } = require('./limits');

const FORMAT = 1;
// A page's id is the host in shellby-page://<id>/, so it keeps to what a host
// can be: lower case, digits and dashes. "draft-" is kept for drafts.
const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const DRAFT_RE = /^draft-[a-z0-9]{8}$/;
// Flat files of text. Images go in as data: URLs or SVG.
const FILE_RE = /^[a-z0-9][a-z0-9_.-]{0,60}\.(html|js|css|svg|json|txt|md)$/i;
const TYPES = Object.freeze({
  html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml',
  json: 'application/json', txt: 'text/plain', md: 'text/plain',
});

const READS = Object.freeze(['usage', 'conversations', 'projects', 'health', 'routines', 'git']);
const AGENTS = Object.freeze(['any', 'shellby', 'none']);
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
// A page data key: short, printable; never a name every object already has.
const KEY_RE = /^[^\u0000-\u001f]{1,100}$/;
const RESERVED_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);
// Who wrote something: you, the page, a conversation, a routine, a terminal, another PC.
const WHO_KINDS = Object.freeze(['you', 'page', 'agent', 'routine', 'terminal', 'pc']);
// Another PC's id (progression/xp.js DEVICE_RE) and its name.
const PC_RE = /^[\w-]{1,64}$/;

const ok = extra => ({ ok: true, ...extra });
const no = error => ({ ok: false, error });

/** One line, trimmed and cut to n, or ''. */
function line(v, n) {
  return typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, n) : '';
}

// Names a page's folder or file can't have: Windows devices (CON, NUL, COM1..., even with an
// extension on Windows 10) and Object.prototype's own, which ids and keys meet as map keys.
const DEVICE_RE = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;
const PROTO_NAMES = new Set(Object.getOwnPropertyNames(Object.prototype));
const isId = v => typeof v === 'string' && ID_RE.test(v) && !v.startsWith('draft-') && !DEVICE_RE.test(v) && !PROTO_NAMES.has(v);
const isDraftId = v => typeof v === 'string' && DRAFT_RE.test(v);
const isFileName = v => typeof v === 'string' && FILE_RE.test(v) && !v.includes('..') && !DEVICE_RE.test(v);
const isDataKey = v => typeof v === 'string' && KEY_RE.test(v) && !RESERVED_KEYS.includes(v);

/** Who did something, cleaned: { kind, name }. */
function whoOf(raw) {
  const w = raw && typeof raw === 'object' ? raw : {};
  return { kind: WHO_KINDS.includes(w.kind) ? w.kind : 'you', name: line(w.name, 80) };
}

/** Another PC, as a page from it names it: { pc, name }, or null. */
function pcOf(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  if (typeof p.pc !== 'string' || !PC_RE.test(p.pc)) return null;
  return { pc: p.pc, name: line(p.name, 64) || 'another PC' };
}
/** @param {string} name */
const typeOf = name => /** @type {Record<string, string>} */ (TYPES)[String(String(name).split('.').pop()).toLowerCase()] || 'application/octet-stream';

/** An id made from a name: "Print queue!" -> "print-queue". Never empty. */
function slug(name) {
  const s = String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  const id = s.startsWith('draft-') || DEVICE_RE.test(s) || PROTO_NAMES.has(s) ? `page-${s}`.slice(0, 40) : s;
  return isId(id) ? id : 'page';
}

/** A host a page may name in `web`: "api.example.com" (https only, no port, no path). */
function hostOf(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim().toLowerCase();
  if (s.startsWith('https://')) s = s.slice(8);
  s = s.replace(/\/.*$/, '');
  return HOST_RE.test(s) ? s : null;
}

/**
 * Access as page.json asks for it, cleaned. Unknown reads and bad hosts are
 * errors rather than dropped, so Claude hears why at save time.
 */
function accessOf(raw) {
  const a = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const read = Array.isArray(a.read) ? a.read : [];
  const badRead = read.find(r => !READS.includes(r));
  if (badRead !== undefined) return no(`"${line(String(badRead), 40)}" isn't something a page can read. It can read: ${READS.join(', ')}.`);
  const web = Array.isArray(a.web) ? a.web : [];
  if (web.length > LIMITS.WEB_HOSTS) return no(`A page can name at most ${LIMITS.WEB_HOSTS} web hosts.`);
  const hosts = [];
  for (const h of web) {
    const host = hostOf(h);
    if (!host) return no(`"${line(String(h), 80)}" isn't a host. Give hosts like "api.example.com": https only, no port or path.`);
    if (!hosts.includes(host)) hosts.push(host);
  }
  return ok({ access: { read: READS.filter(r => read.includes(r)), ask: a.ask === true, notify: a.notify === true, web: hosts } });
}

const NO_ACCESS = Object.freeze({ read: [], ask: false, notify: false, web: [] });

/** What `next` asks for that `prev` didn't: [] when it asks for nothing more. */
function accessGrowth(prev, next) {
  const p = prev || NO_ACCESS;
  const out = [];
  for (const r of next.read) if (!p.read.includes(r)) out.push({ kind: 'read', what: r });
  if (next.ask && !p.ask) out.push({ kind: 'ask' });
  if (next.notify && !p.notify) out.push({ kind: 'notify' });
  for (const h of next.web) if (!p.web.includes(h)) out.push({ kind: 'web', what: h });
  return out;
}

/** Both together: what was agreed plus hosts you added yourself. */
function accessUnion(a, b) {
  return {
    read: READS.filter(r => a.read.includes(r) || b.read.includes(r)),
    ask: a.ask || b.ask,
    notify: a.notify || b.notify,
    web: [...new Set([...a.web, ...b.web])],
  };
}

const READ_WORDS = Object.freeze({
  usage: 'See your Claude usage and limits',
  conversations: 'See the titles and status of your conversations',
  projects: 'See your projects and their folders',
  health: "See this PC's temperatures, memory and disk",
  routines: 'See your routines and when they last ran',
  git: 'See branches and changes in your projects',
});

/** Each entry in plain words, for the access sheet. */
function accessWords(access) {
  const a = access || NO_ACCESS;
  return [
    ...a.read.map(r => ({ kind: 'read', what: r, text: READ_WORDS[r] })),
    ...(a.ask ? [{ kind: 'ask', text: 'Ask Claude to do something (you see each request first)' }] : []),
    ...(a.notify ? [{ kind: 'notify', text: 'Send you notifications, at most one a minute' }] : []),
    ...a.web.map(h => ({ kind: 'web', what: h, text: `Fetch from ${h}` })),
  ];
}

/**
 * page.json, as Claude wrote it or as it came back from disk, cleaned. `id`
 * comes from the store, never from the file.
 */
/** @param {unknown} raw @param {{ id?: string | null }} [o] */
function manifestOf(raw, { id } = {}) {
  /** @type {Record<string, any>} */
  const m = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const name = line(m.name, LIMITS.NAME);
  if (!name) return no('A page needs a name.');
  const access = accessOf(m.access);
  if (!access.ok) return access;
  const icon = typeof m.icon === 'string' ? [...m.icon.trim()].slice(0, 2).join('') : '';
  return ok({
    manifest: {
      format: FORMAT,
      id: id ?? null,
      name,
      description: line(m.description, LIMITS.DESCRIPTION),
      icon,
      phone: m.phone === true,
      project: typeof m.project === 'string' && m.project.trim() ? m.project.trim().slice(0, 400) : null,
      access: access.access,
      agents: AGENTS.includes(m.agents) ? m.agents : 'any',
    },
  });
}

module.exports = {
  FORMAT, READS, AGENTS, NO_ACCESS, TYPES, WHO_KINDS,
  isId, isDraftId, isFileName, isDataKey, typeOf, slug, hostOf, line, whoOf, pcOf,
  accessOf, accessGrowth, accessUnion, accessWords, manifestOf,
};
