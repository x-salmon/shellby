// Served into every page as its first script, ahead of the page's own
// (pages/protocol.js puts it there). WebRTC is the one way out of the sandbox
// that CSP has no rule for: in the spike (scripts/spikes/pages-sandbox) STUN
// over UDP and TURN over TCP both reached a local canary. A page gets no
// WebRTC at all. At the desk the window's WebRTC policy (disable_non_proxied_udp)
// is set as well, for UDP; on a phone this file is all there is.
//
// A child frame would be a fresh window with WebRTC of its own (an about:blank
// one needs no fetch, so frame-src 'none' doesn't stop it). The save checks
// refuse frames in a page's HTML; here a page also can't make one while it runs,
// and can't reach into one if it somehow has one.
'use strict';
/* global window, document, Document, HTMLIFrameElement, HTMLFrameElement, HTMLObjectElement, HTMLEmbedElement, MutationObserver */
(() => {
  for (const name of Object.getOwnPropertyNames(window)) {
    if (/^(webkit)?RTC/.test(name)) {
      try { delete window[name]; } catch { /* not configurable: left as it is */ }
    }
  }

  const FRAMES = /^(iframe|frame|object|embed|portal|fencedframe)$/i;
  const lock = (proto, prop, value) => {
    try { Object.defineProperty(proto, prop, { configurable: false, get: () => value }); } catch { /* not there */ }
  };

  // No way in: a frame-like element's window or document reads as null.
  for (const Kind of [typeof HTMLIFrameElement !== 'undefined' && HTMLIFrameElement, typeof HTMLFrameElement !== 'undefined' && HTMLFrameElement,
    typeof HTMLObjectElement !== 'undefined' && HTMLObjectElement, typeof HTMLEmbedElement !== 'undefined' && HTMLEmbedElement]) {
    if (!Kind) continue;
    lock(Kind.prototype, 'contentWindow', null);
    lock(Kind.prototype, 'contentDocument', null);
    try { Object.defineProperty(Kind.prototype, 'getSVGDocument', { configurable: false, value: () => null }); } catch { /* not there */ }
  }
  // window.frames is the window itself; with no frames, its length stays 0.
  lock(window, 'length', 0);

  // No way to make one: createElement refuses, and one that arrives some other
  // way (innerHTML, a parser) is taken out before it's connected long.
  const make = Document.prototype.createElement;
  const makeNS = Document.prototype.createElementNS;
  const refuse = tag => { if (FRAMES.test(String(tag))) throw new Error('A page can\'t make frames.'); };
  try {
    Object.defineProperty(Document.prototype, 'createElement', { configurable: false, value: function (tag, ...rest) { refuse(tag); return make.call(this, tag, ...rest); } });
    Object.defineProperty(Document.prototype, 'createElementNS', { configurable: false, value: function (ns, tag, ...rest) { refuse(String(tag).split(':').pop()); return makeNS.call(this, ns, tag, ...rest); } });
  } catch { /* left as it is */ }
  // Every shadow root a page makes is open (attachShadow below), so a sweep can go into each.
  const SEL = 'iframe, frame, object, embed, portal, fencedframe';
  const sweep = root => {
    if (!root || typeof root !== 'object') return;
    if (root.nodeType === 1 && FRAMES.test(root.nodeName)) { root.remove?.(); return; }
    for (const el of root.querySelectorAll?.(SEL) || []) el.remove();
    if (root.shadowRoot) sweep(root.shadowRoot);
    for (const el of root.querySelectorAll?.('*') || []) if (el.shadowRoot) sweep(el.shadowRoot);
  };
  // Declarative shadow roots (<template shadowrootmode>) can be closed, out of a sweep's
  // reach: HTML asking for one is refused wherever HTML is parsed with them on.
  const DECLARATIVE = /shadowroot(mode)?\s*=/i;
  const noDeclarative = html => { if (DECLARATIVE.test(String(html))) throw new Error("A page can't make shadow roots from HTML."); };
  const isFrame = n => !!n && n.nodeType === 1 && FRAMES.test(n.nodeName);
  // Inserting a node: frames inside it go first, and a frame itself is refused,
  // before it's connected (a connected frame has a window the page could reach).
  const guardInsert = (proto, names) => {
    for (const name of names) {
      const orig = proto && Object.getOwnPropertyDescriptor(proto, name)?.value;
      if (typeof orig !== 'function') continue;
      try {
        Object.defineProperty(proto, name, {
          configurable: false, writable: false,
          value: function (...args) {
            for (const a of args) { if (isFrame(a)) throw new Error('A page can\'t make frames.'); sweep(a); }
            return orig.apply(this, args);
          },
        });
      } catch { /* left as it is */ }
    }
  };
  /* global Node, Element, DocumentFragment, Range, ShadowRoot */
  guardInsert(Node.prototype, ['appendChild', 'insertBefore', 'replaceChild']);
  guardInsert(Element.prototype, ['append', 'prepend', 'before', 'after', 'replaceWith', 'replaceChildren', 'insertAdjacentElement']);
  guardInsert(DocumentFragment.prototype, ['append', 'prepend', 'replaceChildren']);
  guardInsert(Document.prototype, ['append', 'prepend', 'replaceChildren', 'adoptNode', 'importNode']);
  guardInsert(Range.prototype, ['insertNode', 'surroundContents']);
  // HTML as text: whatever it made is swept straight after, before the page's code goes on.
  const guardHtml = (proto, names, setter) => {
    for (const name of names) {
      const desc = proto && Object.getOwnPropertyDescriptor(proto, name);
      if (!desc) continue;
      try {
        if (setter && desc.set) {
          // The parent is taken first: outerHTML replaces the element itself.
          Object.defineProperty(proto, name, { configurable: false, get: desc.get, set(v) { const p = this.parentNode; desc.set.call(this, v); sweep(p || this); sweep(this); } });
        } else if (!setter && typeof desc.value === 'function') {
          const orig = desc.value;
          Object.defineProperty(proto, name, { configurable: false, writable: false, value: function (...args) { const r = orig.apply(this, args); sweep(this.parentNode || this); sweep(this); if (r && typeof r === 'object') sweep(r); return r; } });
        }
      } catch { /* left as it is */ }
    }
  };
  // HTML parsed with declarative shadow roots on: refused if it asks for one, then swept.
  /** @type {any[]} */
  const parsers = [Element.prototype, typeof ShadowRoot !== 'undefined' ? ShadowRoot.prototype : null];
  for (const proto of parsers) {
    const name = 'setHTMLUnsafe';
    const orig = proto && Object.getOwnPropertyDescriptor(proto, name)?.value;
    if (typeof orig !== 'function') continue;
    try { Object.defineProperty(proto, name, { configurable: false, writable: false, value: function (html, ...rest) { noDeclarative(html); const r = orig.call(this, html, ...rest); sweep(this); return r; } }); } catch { /* left as it is */ }
  }
  if (typeof Document.parseHTMLUnsafe === 'function') {
    const parse = Document.parseHTMLUnsafe;
    try { Object.defineProperty(Document, 'parseHTMLUnsafe', { configurable: false, writable: false, value: function (html, ...rest) { noDeclarative(html); return parse.call(this, html, ...rest); } }); } catch { /* left as it is */ }
  }
  // A page's shadow roots are open, so a sweep can see into them, and watched like the document.
  const attach = Element.prototype.attachShadow;
  try {
    Object.defineProperty(Element.prototype, 'attachShadow', { configurable: false, writable: false, value: function (init, ...rest) { const root = attach.call(this, { ...(init || {}), mode: 'open' }, ...rest); watch(root); return root; } });
  } catch { /* left as it is */ }
  // Editing commands that insert HTML (a contentEditable page): refused.
  const exec = Document.prototype.execCommand;
  try {
    Object.defineProperty(Document.prototype, 'execCommand', { configurable: false, writable: false, value: function (cmd, ...rest) { if (/^insert(html|image)$/i.test(String(cmd))) return false; const r = exec.call(this, cmd, ...rest); sweep(this); return r; } });
  } catch { /* left as it is */ }
  guardHtml(Element.prototype, ['innerHTML', 'outerHTML'], true);
  guardHtml(typeof ShadowRoot !== 'undefined' ? ShadowRoot.prototype : null, ['innerHTML'], true);
  guardHtml(Element.prototype, ['insertAdjacentHTML'], false);
  guardHtml(Range.prototype, ['createContextualFragment'], false);
  guardHtml(Document.prototype, ['write', 'writeln'], false);
  const observer = new MutationObserver(list => {
    for (const m of list) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (FRAMES.test(n.nodeName)) /** @type {Element} */ (n).remove(); else sweep(n);
    }
  });
  function watch(root) { try { observer.observe(root, { childList: true, subtree: true }); } catch { /* not a node */ } }
  watch(document);
})();
