// The panel on a Mac. Shellby's words and shortcuts were written for Windows;
// on a Mac this makes them read right without a second copy of every screen:
//
//  - Cmd does what Ctrl does. A Cmd press is handed to the page's handlers as
//    the Ctrl press it stands for. The real event is left for the system, so
//    Cmd+C, Cmd+V and the menu still work, and only when one of Shellby's
//    handlers takes the stand-in (preventDefault) is the real one cancelled.
//    Settings keep "Ctrl+...", so your own keys mean the same on both.
//  - Keys read as a Mac shows them ("Ctrl+Shift+D" -> "⌘⇧D") and Windows'
//    words as a Mac's ("this PC" -> "this Mac"), in the panel's own text only:
//    never in the conversation, code, or anything you type.
//
// body gets the class "mac", so a Windows-only control can say .win-only and go.
(function (root) {
  const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform || navigator.userAgent || '');

  // A lone "Alt" is the key only when it doesn't start "Alt text" (an image's description).
  /** @type {[RegExp, string][]} */
  const GLYPHS = [[/\bCtrl\+/g, '⌘'], [/\bAlt\+/g, '⌥'], [/\bShift\+/g, '⇧'], [/\bCtrl\b/g, '⌘'], [/\bAlt\b(?! [Tt]ext)/g, '⌥']];

  // Most specific first: "Windows' ssh agent" before "Windows".
  /** @type {[RegExp, string][]} */
  const WORDS = [
    [/\bWindows only( for now)?\./g, 'Not on a Mac yet.'],
    [/\b[Ss]tart with Windows\b/g, 'Open at login'],
    [/\b([Ss])tarts with Windows\b/g, '$1tarts at login'],
    [/\bstart with Windows\b/g, 'open at login'],
    [/\bRun On Windows Startup\b/g, 'Open at Login'],
    [/\bat Windows startup\b/g, 'at login'],
    [/\bencrypted by Windows\b/g, 'kept in your keychain'],
    [/\bWindows can't encrypt\b/g, "macOS can't encrypt"],
    [/\byour Windows account\b/g, 'your Mac account'],
    [/\bWindows' default app\b/g, "the Mac's default app"],
    [/\bWindows Terminal\b/g, 'Terminal'],
    [/\bWindows' (own )?ssh agent\b/g, 'the ssh agent'],
    [/\bWindows' own speech recognition\b/g, "Apple's speech recognition"],
    [/\bWindows' animation effects are off\b/g, 'Reduce motion is on'],
    [/\bWindows Settings\b/g, 'System Settings'],
    [/\bWindows\b/g, 'macOS'],
    [/\b([Tt])his PC\b/g, '$1his Mac'],
    [/\b([Yy])our PC\b/g, '$1our Mac'],
    [/\b([Tt])he PC\b/g, '$1he Mac'],
  ];

  const swap = (text, table) => table.reduce((s, [re, to]) => s.replace(re, to), text);

  /** A key as a Mac shows it ("Ctrl+Shift+D" -> "⌘⇧D"); as it is elsewhere. Pure. */
  function keyText(text, mac = isMac) {
    if (!mac || typeof text !== 'string' || !/\b(Ctrl|Alt)\b/.test(text)) return text;
    return swap(text, GLYPHS);
  }

  /** The panel's words as a Mac's ("this PC" -> "this Mac"); as they are elsewhere. Pure. */
  function macWords(text, mac = isMac) {
    if (!mac || typeof text !== 'string' || !/\b(Windows|PC)\b/.test(text)) return text;
    return swap(text, WORDS);
  }

  const relabelText = text => macWords(keyText(text));
  const api = { isMac, keyText, macWords };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.ShellbyMacUi = api;
  if (!isMac) return;

  // ------------------------------------------------------------ Cmd as Ctrl

  const PLAIN = new Set(['Meta', 'Control', 'Shift', 'Alt']);
  // Left to the system: copy, paste, undo, select all, quit, hide, minimize.
  const SYSTEM = new Set(['c', 'v', 'x', 'z', 'a', 'q', 'h', 'm']);
  let handing = false;

  function standIn(e) {
    if (handing || !e.isTrusted || !e.metaKey || e.ctrlKey || PLAIN.has(e.key)) return;
    if (SYSTEM.has(String(e.key).toLowerCase())) return;
    const copy = new root.KeyboardEvent(e.type, {
      key: e.key, code: e.code, location: e.location, repeat: e.repeat, isComposing: e.isComposing,
      ctrlKey: true, metaKey: false, shiftKey: e.shiftKey, altKey: e.altKey, bubbles: true, cancelable: true, composed: true,
    });
    e.stopImmediatePropagation();
    handing = true;
    try { (e.target || document).dispatchEvent(copy); } finally { handing = false; }
    if (copy.defaultPrevented) e.preventDefault();
  }
  root.addEventListener('keydown', standIn, true);
  root.addEventListener('keyup', standIn, true);

  // ------------------------------------------------------------ the panel's words

  // Never what Claude or you wrote: the conversation, code, and anything you type in.
  const SKIP = '.feed, .msg, .md, pre, code, textarea, input, [contenteditable], .viewer-body, .term';
  const ATTRS = ['title', 'aria-label', 'placeholder', 'data-tip', 'data-label'];

  function relabel(node) {
    if (node.nodeType === 3) {
      const p = node.parentElement;
      if (p && !p.closest(SKIP)) { const t = relabelText(node.nodeValue); if (t !== node.nodeValue) node.nodeValue = t; }
      return;
    }
    if (node.nodeType !== 1 || node.closest(SKIP)) return;
    for (const el of [node, ...node.querySelectorAll(ATTRS.map(a => `[${a}]`).join(', '))]) {
      if (el.closest(SKIP)) continue;
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (v) { const t = relabelText(v); if (t !== v) el.setAttribute(a, t); }
      }
    }
    const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) relabel(n);
  }

  function watch() {
    document.body.classList.add('mac');
    relabel(document.body);
    new MutationObserver(list => {
      for (const m of list) {
        if (m.type === 'characterData') relabel(m.target);
        else if (m.type === 'attributes') relabel(/** @type {Node} */ (m.target));
        else m.addedNodes.forEach(relabel);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch, { once: true });
})(typeof window !== 'undefined' ? window : globalThis);
