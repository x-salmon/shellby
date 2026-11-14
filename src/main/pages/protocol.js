// shellby-page://<id>/<file>: where a page's files come from.
//
// Every response carries the page CSP: only the page's own files, no network,
// no eval, no inline script, and `sandbox allow-scripts` (an opaque origin even
// if something loaded it outside its iframe). Every HTML response gets
// guard.js as its first script, which takes WebRTC away (the spike's one
// leak), and every page can load shellby.js, the bridge. The spike in
// scripts/spikes/pages-sandbox checked all of it.
//
// A page that's off, or hasn't had your OK yet, isn't served at all, so it
// can't run before the access sheet.
const fs = require('fs');
const path = require('path');
const format = require('./format');

const SCHEME = 'shellby-page';
const CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self' data:", "media-src 'self' data: blob:",
  "connect-src 'none'", "form-action 'none'", "base-uri 'none'", "frame-src 'none'", "worker-src 'none'",
  'sandbox allow-scripts',
].join('; ');
const HEADERS = Object.freeze({
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
});
const PAGE_SIDE = path.join(__dirname, 'page-side');
const GUARD_TAG = '<script src="guard.js"></script>';

/** The privileges the scheme needs, for protocol.registerSchemesAsPrivileged before app ready. */
const PRIVILEGES = Object.freeze({ scheme: SCHEME, privileges: { standard: true, secure: true } });

/** Put guard.js ahead of everything else in a page's HTML. */
function withGuard(html) {
  const m = /^\s*<!doctype[^>]*>/i.exec(html);
  return m ? `${m[0]}${GUARD_TAG}${html.slice(m[0].length)}` : `${GUARD_TAG}${html}`;
}

/** The URL a page loads from. */
const urlOf = id => `${SCHEME}://${id}/index.html`;

/**
 * What to answer for one request: { status, type, body } (body a Buffer or string).
 * pages: { known(id), servable(id), readFile(id, name) }
 */
function answer(rawUrl, pages, sideFiles) {
  let u;
  try { u = new URL(rawUrl); } catch { return { status: 400, type: 'text/plain', body: 'Bad address.' }; }
  const id = u.hostname;
  if (!(format.isId(id) || format.isDraftId(id)) || !pages.known(id)) return { status: 404, type: 'text/plain', body: 'No such page.' };
  if (!pages.servable(id)) return { status: 403, type: 'text/plain', body: "This page is off, or waiting for your OK." };
  let name = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  if (name.includes('/') || name.includes('\\')) return { status: 404, type: 'text/plain', body: 'Not found.' };
  if (name === 'shellby.js' || name === 'guard.js') return { status: 200, type: 'text/javascript', body: sideFiles[name] };
  if (!format.isFileName(name)) return { status: 404, type: 'text/plain', body: 'Not found.' };
  if (name.toLowerCase() === 'index.html') name = 'index.html';
  const buf = pages.readFile(id, name);
  if (!buf) return { status: 404, type: 'text/plain', body: 'Not found.' };
  const type = format.typeOf(name);
  return { status: 200, type, body: type === 'text/html' ? withGuard(buf.toString('utf8')) : buf };
}

/** Serve pages on a session's protocol (Electron's protocol.handle). */
function servePages(protocol, pages) {
  const sideFiles = {
    'shellby.js': fs.readFileSync(path.join(PAGE_SIDE, 'shellby.js'), 'utf8'),
    'guard.js': fs.readFileSync(path.join(PAGE_SIDE, 'guard.js'), 'utf8'),
  };
  protocol.handle(SCHEME, req => {
    if (req.method !== 'GET') return new Response('Only GET.', { status: 405, headers: HEADERS });
    const a = answer(req.url, pages, sideFiles);
    return new Response(a.body, { status: a.status, headers: { ...HEADERS, 'Content-Type': `${a.type}${/^text\//.test(a.type) || a.type.includes('javascript') ? '; charset=utf-8' : ''}` } });
  });
}

module.exports = { SCHEME, CSP, PRIVILEGES, urlOf, withGuard, answer, servePages };
