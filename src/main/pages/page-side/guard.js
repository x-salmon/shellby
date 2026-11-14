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
  const sweep = root => {
    if (!root || typeof root !== 'object') return;
    if (root.nodeType === 1 && FRAMES.test(root.nodeName)) { root.remove?.(); return; }
    for (const el of root.querySelectorAll?.('iframe, frame, object, embed, portal, fencedframe') || []) el.remove();
  };
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
  guardHtml(Element.prototype, ['innerHTML', 'outerHTML'], true);
  guardHtml(typeof ShadowRoot !== 'undefined' ? ShadowRoot.prototype : null, ['innerHTML'], true);
  guardHtml(Element.prototype, ['insertAdjacentHTML', 'setHTMLUnsafe'], false);
  guardHtml(typeof ShadowRoot !== 'undefined' ? ShadowRoot.prototype : null, ['setHTMLUnsafe'], false);
  guardHtml(Range.prototype, ['createContextualFragment'], false);
  guardHtml(Document.prototype, ['write', 'writeln'], false);
  new MutationObserver(list => {
    for (const m of list) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (FRAMES.test(n.nodeName)) /** @type {Element} */ (n).remove(); else sweep(n);
    }
  }).observe(document, { childList: true, subtree: true });
})();
