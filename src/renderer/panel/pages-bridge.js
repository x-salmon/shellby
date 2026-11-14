/* Shellby panel — the bridge between a page's frame and main
   (docs/plans/shellby-pages.md). A page runs in <iframe sandbox="allow-scripts">
   from shellby-page://<id>/, with no way out but postMessage to here.

   This only passes things on. A message is taken to be from page X because it
   came from X's frame (event.source), never because of anything it says, and
   main decides whether the call is allowed (pages/rights.js). Messages over
   256 KB are dropped. Going the other way: the page's answers, its data
   changing, the theme, and "point at it" on or off.

   A frame also tells the panel when it's ready, when it throws, and what you
   pointed at (shellby.js); no "ready" within 5 seconds counts as broken. At
   most five frames stay alive: opening a sixth closes the oldest one that's
   off screen. */
'use strict';
(function () {
  const { h, api } = SB;
  const MAX_MESSAGE = 256 * 1024;
  const READY_MS = 5000;
  const MAX_OPEN = 5;
  const THEME_VARS = { bg: '--ink', panel: '--reef', text: '--sand', muted: '--sand-dim', accent: '--coral', good: '--glass', warn: '--amber', line: '--line', font: '--font-body', mono: '--font-mono', pixel: '--font-pixel' };

  /** @type {Set<any>} every live frame: { id, el, frame, handlers, ready, timer, used } */
  const frames = new Set();
  let useClock = 0;

  const send = (f, msg) => { try { f.frame.contentWindow?.postMessage({ shellby: 1, ...msg }, '*'); } catch { /* gone */ } };

  function theme() {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(Object.entries(THEME_VARS).map(([k, v]) => [k, cs.getPropertyValue(v).trim()]));
  }

  function armReady(f) {
    clearTimeout(f.timer);
    f.ready = false;
    f.timer = setTimeout(() => { if (!f.ready && f.frame.isConnected) f.handlers.onBroken?.("It didn't finish loading within 5 seconds.", { timeout: true }); }, READY_MS);
  }

  /** Close the oldest frames that aren't on screen, so at most MAX_OPEN live. */
  function trim() {
    if (frames.size <= MAX_OPEN) return;
    const idle = [...frames].filter(f => !f.el.isConnected || f.el.offsetParent === null).sort((a, b) => a.used - b.used);
    for (const f of idle) { if (frames.size <= MAX_OPEN) break; destroy(f); }
  }

  function destroy(f) {
    clearTimeout(f.timer);
    f.frame.src = 'about:blank';
    f.el.remove();
    frames.delete(f);
  }

  /**
   * A frame showing page id. handlers: onReady, onBroken(message), onPointed({ text, selector }),
   * onRefused({ refused, error }), onAsk({ prompt, mode }), onData(change).
   * -> { el, reload(), point(on), close(), id }
   */
  function open(id, url, handlers = {}) {
    const frame = /** @type {HTMLIFrameElement} */ (h('iframe', {
      class: 'pg-frame', title: 'Page', sandbox: 'allow-scripts', referrerpolicy: 'no-referrer',
      allow: "camera 'none'; microphone 'none'; geolocation 'none'; usb 'none'; serial 'none'; hid 'none'; clipboard-read 'none'; display-capture 'none'",
    }));
    const el = h('div', { class: 'pg-frame-box' }, frame);
    const f = { id, el, frame, handlers, ready: false, timer: 0, used: ++useClock, url };
    frames.add(f);
    frame.addEventListener('load', () => send(f, { type: 'theme', theme: theme() }));
    frame.src = url;
    armReady(f);
    trim();
    return {
      el, id,
      reload: () => { f.used = ++useClock; armReady(f); frame.src = `${url}?r=${f.used}`; }, // a new query, so it really loads again
      point: on => send(f, { type: 'point', on: !!on }),
      close: () => destroy(f),
      touch: () => { f.used = ++useClock; },
    };
  }

  window.addEventListener('message', async e => {
    /** @type {any} */
    let f = null;
    for (const x of frames) if (x.frame.contentWindow && x.frame.contentWindow === e.source) { f = x; break; }
    if (!f || e.origin !== 'null') return; // not one of ours: ignored
    const m = e.data;
    if (!m || typeof m !== 'object' || m.shellby !== 1) return;
    let size;
    try { size = JSON.stringify(m).length; } catch { return; }
    if (size > MAX_MESSAGE) {
      if (m.type === 'call') send(f, { type: 'answer', id: m.id, ok: false, error: 'A call can carry at most 256 KB.' });
      return;
    }
    f.used = ++useClock;
    switch (m.type) {
      case 'call': {
        const args = Array.isArray(m.args) ? m.args.slice(0, 10) : [];
        const r = await api.pages.call(f.id, String(m.method || '').slice(0, 20), args).catch(err => ({ ok: false, error: err.message }));
        send(f, { type: 'answer', id: m.id, ok: !!r?.ok, value: r?.value, error: r?.error });
        break;
      }
      case 'ready':
        f.ready = true;
        clearTimeout(f.timer);
        f.handlers.onReady?.();
        break;
      case 'error':
        f.handlers.onBroken?.(`${String(m.message || 'An error').slice(0, 300)}${m.file ? ` (${String(m.file).slice(0, 60)}${m.line ? `, line ${Number(m.line)}` : ''})` : ''}`);
        break;
      case 'pointed':
        f.handlers.onPointed?.({ text: String(m.text || '').slice(0, 200), selector: String(m.selector || '').slice(0, 200) });
        break;
      default:
        break;
    }
  });

  // Main says what changed: data goes into every frame of that page, new files reload them.
  api.pages.onChanged(ev => {
    if (!ev?.id) return;
    for (const f of frames) {
      if (f.id !== ev.id) continue;
      if (ev.kind === 'data') { send(f, { type: 'change', change: ev.change }); f.handlers.onData?.(ev.change); }
      else if (ev.kind === 'files') { armReady(f); f.frame.src = `${f.url}?v=${ev.version || ++useClock}`; }
      else if (ev.kind === 'refused') f.handlers.onRefused?.({ refused: ev.refused, error: ev.error });
      else if (ev.kind === 'ask') f.handlers.onAsk?.({ prompt: ev.prompt, mode: ev.mode });
      else if (ev.kind === 'removed') destroy(f);
    }
  });

  SB.pageFrames = { open, count: () => frames.size };
})();
