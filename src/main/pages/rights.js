// Whether a page may make a bridge call: the one place that decides, in main.
// The panel's bridge (renderer/panel/pages-bridge.js) only passes calls on,
// naming the page by which frame they came from, never by what they say.
//
//   decide(method, args, ctx) -> { ok: true, args } | { ok: false, error, refused? }
//     ctx: { access, draft, enabled }
//
// `refused` marks a call the page wasn't given (as opposed to a malformed
// one): the header shows it once, with Let it. Rates are kept by the caller
// (service.js), which knows the clock. Pure: test/pages-rights.test.js.
const { LIMITS } = require('./limits');
const format = require('./format');

const METHODS = Object.freeze(['data.get', 'data.set', 'data.append', 'data.remove', 'read', 'ask', 'notify', 'fetch', 'say']);

const ok = args => ({ ok: true, args });
const bad = error => ({ ok: false, error });
const refuse = (error, refused) => ({ ok: false, error, refused });
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

/** A URL a page may name for shellby.fetch: https, a host, no credentials. */
function fetchUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  const host = format.hostOf(u.hostname);
  return host ? { url: u.href, host } : null;
}

function decide(method, rawArgs, ctx) {
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  const access = ctx?.access || format.NO_ACCESS;
  if (!METHODS.includes(method)) return bad(`shellby has no "${str(method, 40)}".`);
  if (!ctx?.draft && ctx?.enabled === false) return bad('This page is turned off.');

  switch (method) {
    case 'data.get': {
      const key = args[0];
      if (key !== undefined && key !== null && typeof key !== 'string') return bad('data.get takes a key, or nothing for all of it.');
      return ok([key ?? null]);
    }
    case 'data.set': {
      const values = args[0];
      if (!values || typeof values !== 'object' || Array.isArray(values)) return bad('data.set takes an object: { key: value }.');
      return ok([values]);
    }
    case 'data.append': {
      if (typeof args[0] !== 'string') return bad('data.append takes a key and an item.');
      return ok([args[0], args[1]]);
    }
    case 'data.remove': {
      const keys = Array.isArray(args[0]) ? args[0] : [args[0]];
      if (!keys.length || keys.some(k => typeof k !== 'string')) return bad('data.remove takes a key or a list of keys.');
      return ok([keys]);
    }
    case 'read': {
      const what = args[0];
      if (!format.READS.includes(what)) return bad(`shellby.read takes one of: ${format.READS.join(', ')}.`);
      if (ctx?.draft) return refuse("A draft's preview runs with no access. It gets real data once it's saved and you've let it.", { kind: 'read', what });
      if (!access.read.includes(what)) return refuse(`This page wasn't given "${what}".`, { kind: 'read', what });
      return ok([what]);
    }
    case 'ask': {
      const prompt = str(args[0], LIMITS.ASK_PROMPT).trim();
      if (!prompt) return bad('shellby.ask takes what to ask.');
      if (ctx?.draft) return refuse("A draft's preview can't ask Claude for anything.", { kind: 'ask' });
      if (!access.ask) return refuse("This page wasn't given ask.", { kind: 'ask' });
      // Ask first or Plan: a page can't ask for a mode that edits files without asking.
      const mode = args[1]?.mode === 'plan' ? 'plan' : 'ask';
      return ok([prompt, { mode }]);
    }
    case 'notify': {
      const title = str(args[0], 80).trim();
      if (!title) return bad('shellby.notify takes a title.');
      if (ctx?.draft) return refuse("A draft's preview can't send notifications.", { kind: 'notify' });
      if (!access.notify) return refuse("This page wasn't given notify.", { kind: 'notify' });
      return ok([title, str(args[1], 200)]);
    }
    case 'fetch': {
      const target = fetchUrl(args[0]);
      if (!target) return bad('shellby.fetch takes an https:// URL.');
      if (ctx?.draft) return refuse("A draft's preview can't reach the web.", { kind: 'web', what: target.host });
      if (!access.web.includes(target.host)) return refuse(`This page tried to reach ${target.host}, which it didn't ask for.`, { kind: 'web', what: target.host });
      const o = args[1] && typeof args[1] === 'object' ? args[1] : {};
      const verb = String(o.method || 'GET').toUpperCase();
      if (!['GET', 'POST'].includes(verb)) return bad('shellby.fetch does GET and POST.');
      const body = verb === 'POST' && typeof o.body === 'string' ? o.body.slice(0, LIMITS.FETCH_BYTES) : undefined;
      const headers = {};
      const type = o.headers && typeof o.headers === 'object' ? o.headers['content-type'] ?? o.headers['Content-Type'] : undefined;
      if (typeof type === 'string') headers['content-type'] = type.slice(0, 100);
      return ok([target.url, { method: verb, body, headers }]);
    }
    case 'say': {
      const text = str(args[0], 120).trim();
      if (!text) return bad('shellby.say takes a line.');
      if (ctx?.draft) return refuse("A draft's preview can't make the crab talk.", { kind: 'say' });
      return ok([text]);
    }
    default:
      return bad('Unknown call.');
  }
}

module.exports = { METHODS, decide, fetchUrl };
