// picker.js: "point at it", shared by a page's bridge and a dev server's window.
//
// pages/protocol.js serves it wrapped in one function with shellby.js, so a
// page gets it without a global of its own; devpoint.js runs it in an isolated
// world of the dev server's window, out of reach of the page's own scripts.
//
// While it's on: what's under the pointer is outlined with its name, and stays
// outlined as the page scrolls. A click picks it and finishes; Shift+click
// picks up to five, and Enter (or a plain click) finishes. Escape cancels. The
// page's own mouse handlers don't run while it's on. With askBox, a finished
// pick shows a box for what should change before it's sent.
//
// post gets { type: 'pointed', picks: [{ text, selector, rect }], ask?, view }
// (rects and view in CSS px of this window) or { type: 'point-cancel' }.
'use strict';
/* global window, document, CSS, requestAnimationFrame */

/**
 * @param {{ post: (msg: any) => void, askBox?: boolean, max?: number }} opts
 * @returns {{ set: (on: boolean) => void, isOn: () => boolean }}
 */
// Used by shellby.js and devpoint.js, which run it in the same function.
// eslint-disable-next-line no-unused-vars
function shellbyPicker({ post, askBox = false, max = 5 }) {
  const MAX_TEXT = 200;
  const MAX_SELECTOR = 200;
  const MAX_ASK = 2000;
  const COLOR = '#ff7a5c';
  const BLOCKED = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu', 'auxclick'];

  let on = false;
  /** @type {Element | null} */
  let hovered = null;
  /** @type {Element[]} */
  let picks = [];
  /** @type {HTMLElement | null} */
  let host = null;
  /** @type {any} */
  let ui = null;
  let queued = false;

  function selectorOf(el) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
      let p = n.localName;
      if (n.id) { parts.unshift(`${p}#${CSS.escape(n.id)}`); break; }
      p += [...n.classList].slice(0, 2).map(c => `.${CSS.escape(c)}`).join('');
      parts.unshift(p);
    }
    return parts.join(' > ').slice(0, MAX_SELECTOR);
  }
  const nameOf = el => `${el.localName}${el.id ? `#${el.id}` : el.classList[0] ? `.${el.classList[0]}` : ''}`.slice(0, 60);
  const textOf = el => String(el.innerText || el.textContent || el.getAttribute?.('aria-label') || el.getAttribute?.('alt') || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  }
  const describe = el => ({ text: textOf(el), selector: selectorOf(el), rect: rectOf(el) });

  // ------------------------------------------------------------ the overlay
  const box = (border, fill) => {
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;pointer-events:none;box-sizing:border-box;border:2px ${border} ${COLOR};border-radius:4px;background:${fill};display:none`;
    return el;
  };
  function build() {
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    const root = host.attachShadow({ mode: 'closed' });
    const hover = box('solid', 'rgba(255,122,92,.12)');
    const label = document.createElement('div');
    label.style.cssText = `position:fixed;pointer-events:none;display:none;font:600 11px/1.6 system-ui,sans-serif;color:#1a1210;background:${COLOR};padding:0 6px;border-radius:3px;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis`;
    const marks = document.createElement('div');
    root.append(hover, label, marks);
    ui = { root, hover, label, marks, form: null };
    document.documentElement.append(host);
  }

  function place(el, r) {
    Object.assign(el.style, { left: `${r.x - 2}px`, top: `${r.y - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px`, display: 'block' });
  }

  function layout() {
    queued = false;
    if (!on || !ui) return;
    if (hovered && hovered.isConnected && !ui.form) {
      const r = rectOf(hovered);
      place(ui.hover, r);
      ui.label.textContent = `${nameOf(hovered)}${picks.length ? `  ·  Shift+click for more (${picks.length}/${max})` : ''}`;
      Object.assign(ui.label.style, { left: `${Math.max(0, r.x)}px`, top: `${r.y > 22 ? r.y - 22 : r.y + r.height + 4}px`, display: 'block' });
    } else {
      ui.hover.style.display = 'none';
      ui.label.style.display = 'none';
    }
    ui.marks.replaceChildren(...picks.filter(el => el.isConnected).map((el, i) => {
      const m = box('dashed', 'rgba(255,122,92,.18)');
      place(m, rectOf(el));
      const n = document.createElement('span');
      n.textContent = String(i + 1);
      n.style.cssText = `position:absolute;top:-10px;left:-10px;width:18px;height:18px;border-radius:9px;background:${COLOR};color:#1a1210;font:700 11px/18px system-ui,sans-serif;text-align:center`;
      m.append(n);
      return m;
    }));
    if (ui.form) placeForm();
  }
  const relayout = () => { if (!queued) { queued = true; requestAnimationFrame(layout); } };

  // ------------------------------------------------------------ what should change
  function showForm() {
    const form = document.createElement('form');
    form.style.cssText = `position:fixed;pointer-events:auto;display:flex;gap:6px;align-items:center;padding:8px;border-radius:8px;background:#1a1210;border:1px solid ${COLOR};box-shadow:0 6px 24px rgba(0,0,0,.4);font:13px system-ui,sans-serif;width:min(420px,calc(100vw - 16px));box-sizing:border-box`;
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = MAX_ASK;
    input.placeholder = picks.length > 1 ? `What should change about these ${picks.length}?` : 'What should change?';
    input.setAttribute('aria-label', 'What should change');
    input.style.cssText = 'flex:1;min-width:0;font:inherit;padding:6px 8px;border-radius:5px;border:1px solid #5a4a44;background:#2a201d;color:#f4e9dc';
    const send = document.createElement('button');
    send.type = 'submit';
    send.textContent = 'Send to Claude';
    send.style.cssText = `font:600 12px system-ui,sans-serif;padding:6px 10px;border-radius:5px;border:0;background:${COLOR};color:#1a1210;cursor:pointer`;
    form.append(input, send);
    form.addEventListener('submit', e => { e.preventDefault(); finish(input.value); });
    ui.form = form;
    ui.root.append(form);
    placeForm();
    input.focus();
  }
  function placeForm() {
    const rs = picks.filter(el => el.isConnected).map(rectOf);
    const bottom = rs.length ? Math.max(...rs.map(r => r.y + r.height)) : 0;
    const left = rs.length ? Math.min(...rs.map(r => r.x)) : 8;
    const h = ui.form.offsetHeight || 48;
    const w = ui.form.offsetWidth || 420;
    const top = bottom + 8 + h < window.innerHeight ? bottom + 8 : Math.max(8, window.innerHeight - h - 8);
    Object.assign(ui.form.style, { top: `${top}px`, left: `${Math.min(Math.max(8, left), Math.max(8, window.innerWidth - w - 8))}px` });
  }

  function finish(ask) {
    const list = picks.filter(el => el.isConnected).map(describe);
    if (!list.length) return;
    const msg = { type: 'pointed', picks: list, view: { width: window.innerWidth, height: window.innerHeight } };
    const said = String(ask || '').trim().slice(0, MAX_ASK);
    stop();
    try { post(said ? { ...msg, ask: said } : msg); } catch { /* too big: ignored */ }
  }
  function done() { if (askBox) { if (!ui.form) { layout(); showForm(); } } else finish(''); }
  function cancel() { stop(); try { post({ type: 'point-cancel' }); } catch { /* gone */ } }

  // ------------------------------------------------------------ events
  const ours = e => !!host && e.composedPath().includes(host);
  function onMove(e) {
    if (ours(e) || ui?.form) return;
    const el = e.target;
    if (el instanceof window.Element && el !== hovered) { hovered = el; relayout(); }
  }
  function onBlocked(e) {
    if (ours(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  function onClick(e) {
    if (ours(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (ui?.form) return; // the box is up: clicks elsewhere do nothing
    const el = e.target;
    if (!(el instanceof window.Element)) return;
    const at = picks.indexOf(el);
    if (e.shiftKey) {
      if (at >= 0) picks = picks.filter(p => p !== el);
      else if (picks.length < max) picks = [...picks, el];
      relayout();
      return;
    }
    if (at < 0 && picks.length < max) picks = [...picks, el];
    done();
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); return; }
    if (e.key === 'Enter' && !ours(e) && picks.length) { e.preventDefault(); e.stopImmediatePropagation(); done(); }
  }

  function listen(fn) {
    fn('mousemove', onMove, true);
    fn('click', onClick, true);
    fn('keydown', onKey, true);
    for (const t of BLOCKED) fn(t, onBlocked, true);
    fn('scroll', relayout, true);
    fn('resize', relayout, false);
  }
  function start() {
    if (on) return;
    on = true;
    if (!host) build();
    else document.documentElement.append(host);
    listen((t, f, c) => window.addEventListener(t, f, c));
    document.documentElement.style.cursor = 'crosshair';
  }
  function stop() {
    if (!on) return;
    on = false;
    listen((t, f, c) => window.removeEventListener(t, f, c));
    picks = [];
    hovered = null;
    if (ui?.form) { ui.form.remove(); ui.form = null; }
    host?.remove();
    document.documentElement.style.cursor = '';
  }

  return { set: v => (v ? start() : stop()), isOn: () => on };
}
