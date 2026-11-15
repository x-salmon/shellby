// shellby.js: the bridge a page loads with <script src="shellby.js">. Served
// by Shellby (pages/protocol.js) to every page; a page can't ship its own.
//
// Every call is a promise over postMessage to the panel, which passes it to
// main, which decides (pages/rights.js). The panel can't see into the frame,
// so this also reports errors, says when the page is ready, and runs "point
// at it" when the panel turns it on.
//
//   shellby.data.get(key?)  .set({ k: v })  .append(key, item)  .remove(key | [keys])
//   shellby.data.onChange(fn)    after any write: the page's, yours, an agent's
//   shellby.read('usage')        a snapshot, if the page was given it
//   shellby.ask(prompt, { mode })  a card first; you press Ask Claude. mode: 'ask' or 'plan'
//   shellby.notify(title, body)
//   shellby.fetch(url, { method, body, headers })  -> { ok, status, headers, text(), json() }
//   shellby.say(text)            the crab says it
//   shellby.theme                Shellby's colours and fonts, to match or not
'use strict';
/* global window, document, requestAnimationFrame, Promise, Map, Error, JSON, shellbyPicker */
(function () {
  const parent = window.parent;
  if (!parent || parent === window || /** @type {any} */ (window).shellby) return;
  const MAX_MESSAGE = 256 * 1024;
  let seq = 0;
  const pending = new Map();
  const changeFns = [];
  let theme = Object.freeze({});

  function post(msg) {
    let size;
    try { size = JSON.stringify(msg).length; } catch { throw new Error('shellby: what was sent must be plain data.'); }
    if (size > MAX_MESSAGE) throw new Error(`shellby: a call can carry at most ${MAX_MESSAGE / 1024} KB.`);
    parent.postMessage({ shellby: 1, ...msg }, '*');
  }

  function call(method, args) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      try { post({ type: 'call', id, method, args }); } catch (err) { pending.delete(id); reject(err); }
    });
  }

  function report(err, file, line) {
    try {
      post({ type: 'error', message: String(err && err.message || err).slice(0, 500), file: String(String(file || '').split('/').pop()).slice(0, 80), line: Number(line) || 0 });
    } catch { /* nothing more to do */ }
  }

  window.addEventListener('error', e => report(e.error || e.message, e.filename, e.lineno));
  window.addEventListener('unhandledrejection', e => report(e.reason));

  window.addEventListener('message', e => {
    if (e.source !== parent) return;
    const m = e.data;
    if (!m || m.shellby !== 1) return;
    if (m.type === 'answer') {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error || 'Refused.'));
    } else if (m.type === 'change') {
      for (const fn of changeFns.slice()) { try { fn(m.change); } catch (err) { report(err); } }
    } else if (m.type === 'theme') {
      theme = Object.freeze({ ...(m.theme || {}) });
    } else if (m.type === 'point') {
      pointing(!!m.on);
    }
  });

  // ------------------------------------------------------------ point at it
  // picker.js comes first in the same function (pages/protocol.js serves them together).
  // @ts-ignore -- defined by picker.js, served ahead of this file
  const picker = shellbyPicker({ post });
  const pointing = on => picker.set(on);

  // ------------------------------------------------------------------ ready
  function ready() { requestAnimationFrame(() => { try { post({ type: 'ready' }); } catch { /* ignored */ } }); }
  if (document.readyState === 'complete') ready(); else window.addEventListener('load', ready, { once: true });

  function response(r) {
    const body = String(r && r.body || '');
    return Object.freeze({
      ok: !!(r && r.ok), status: Number(r && r.status) || 0, headers: Object.freeze({ ...(r && r.headers || {}) }),
      text: () => Promise.resolve(body),
      json: () => Promise.resolve().then(() => JSON.parse(body)),
    });
  }

  const shellby = Object.freeze({
    data: Object.freeze({
      get: key => call('data.get', [key]),
      set: values => call('data.set', [values]),
      append: (key, item) => call('data.append', [key, item]),
      remove: keys => call('data.remove', [keys]),
      onChange: fn => { if (typeof fn === 'function') changeFns.push(fn); return () => { const i = changeFns.indexOf(fn); if (i >= 0) changeFns.splice(i, 1); }; },
    }),
    read: what => call('read', [what]),
    ask: (prompt, opts) => call('ask', [prompt, opts || {}]),
    notify: (title, body) => call('notify', [title, body || '']),
    fetch: (url, opts) => call('fetch', [String(url), opts || {}]).then(response),
    say: text => call('say', [text]),
    get theme() { return theme; },
  });
  Object.defineProperty(window, 'shellby', { value: shellby, writable: false, configurable: false });
})();
