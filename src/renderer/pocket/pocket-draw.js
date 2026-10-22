/* Shellby on your phone — making elements. Everything from the PC goes in as
   text (textContent), never as markup: the CSP has no inline script and no
   inline style, and a reply from Claude can't become HTML here. */
'use strict';
(function (root) {
  const L = root.PocketLogic;
  const SVG = 'http://www.w3.org/2000/svg';

  /** h('div', { class, text, onclick, ...attrs }, ...children) */
  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  // ---------------------------------------------------------------- icons
  // 16px strokes in currentColor, drawn like the panel's.
  const PATHS = {
    beach: 'M2 12c2-1.5 4-1.5 6 0s4 1.5 6 0M3 8.5 8 3l5 5.5',
    queue: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM8 5v3l2 1.5',
    phone: 'M5 1.5h6a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1ZM7 12.5h2',
    plus: 'M8 3v10M3 8h10',
    back: 'M10 3 5 8l5 5',
    stop: 'M4.5 4.5h7v7h-7z',
    send: 'M2.5 8 13.5 3l-3 10.5-2.5-4.5Z',
    shield: 'M8 2 3 4v4c0 3 2.2 5 5 6 2.8-1 5-3 5-6V4z',
    home: 'M2.5 8 8 3l5.5 5M4.5 7v6h7V7',
    undo: 'M5 4 2 7l3 3M2.5 7H10a3.5 3.5 0 0 1 0 7H8',
    check: 'M3 8.5 6.5 12 13 4.5',
    bell: 'M4 11V7a4 4 0 0 1 8 0v4l1.5 1.5h-11ZM6.5 14h3',
    chevron: 'M6 3l5 5-5 5',
    files: 'M4 1.5h5l3 3v10H4zM9 1.5v3h3',
    eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
    warn: 'M8 2 1.5 13.5h13ZM8 6.5v3.5M8 12v.5',
    more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
    focus: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
    note: 'M3.5 2.5h9v11h-9zM5.5 5.5h5M5.5 8h5M5.5 10.5h3',
    history: 'M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5M8 5v3l2 1.5',
    shirt: 'M5.5 2.5 2 4.5l1.5 3 1.5-.5v6.5h6V7l1.5.5 1.5-3-3.5-2a2.5 2.5 0 0 1-5 0Z',
    folder: 'M1.5 4v8.5h13V5.5H8L6.5 4Z',
    mic: 'M8 1.5a2 2 0 0 0-2 2V8a2 2 0 0 0 4 0V3.5a2 2 0 0 0-2-2ZM4 7.5a4 4 0 0 0 8 0M8 11.5v3',
    camera: 'M2 5h3l1-1.5h4L11 5h3v8H2zM8 6.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
    share: 'M8 2v8M5 4.5 8 1.5l3 3M3.5 7v6.5h9V7',
    find: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM10.5 10.5 14 14',
    clock: 'M2.5 8a5.5 5.5 0 1 1 1.6 3.9M2.5 12V8.5H6M8 5v3l2 1.5',
    moon: 'M9.5 2.5a5.5 5.5 0 1 0 4 9.5A6 6 0 0 1 9.5 2.5Z',
    sun: 'M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1',
    trophy: 'M5 2.5h6v3.5a3 3 0 0 1-6 0zM5 4H2.5a2.5 2.5 0 0 0 2.7 3M11 4h2.5a2.5 2.5 0 0 1-2.7 3M8 9v3M5.5 13.5h5',
    play: 'M5 3.5v9l7-4.5z',
  };
  function icon(name, cls = '') {
    const s = document.createElementNS(SVG, 'svg');
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('class', `ic ${cls}`.trim());
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', PATHS[name] || '');
    s.append(p);
    return s;
  }

  // ---------------------------------------------------------------- the crab
  const HUES = [145, 250, 60, 300, 200, 0];
  let skin = null;
  const setSkin = s => { if (s && Array.isArray(s.pixels)) skin = s; };

  /**
   * Shellby himself, from the skin the PC sends (shared/sprite.js), or a plain
   * shape until it arrives. state: idle | working | asking | success | error | sleeping.
   */
  function crab({ px = 3, state = 'idle', hue = null, label = 'Shellby' } = {}) {
    const wrap = h('span', { class: `crab state-${state}`, role: 'img', 'aria-label': label });
    if (skin && root.ShellbySprite) {
      const svg = root.ShellbySprite.build(skin, { px });
      if (hue != null) wrap.classList.add(`hue-${hue}`);
      wrap.append(svg);
    } else {
      wrap.classList.add('crab-blank');
    }
    return wrap;
  }
  const helperHue = i => HUES[i % HUES.length];

  // ---------------------------------------------------------------- Claude's words
  function runs(list) {
    return list.map(r => {
      if (r.code) return h('code', { text: r.text });
      if (r.href) return h('a', { href: r.href, target: '_blank', rel: 'noopener noreferrer', text: r.text });
      if (r.b) return h('strong', { text: r.text });
      if (r.i) return h('em', { text: r.text });
      return document.createTextNode(r.text);
    });
  }

  function markdown(text) {
    const box = h('div', { class: 'md' });
    let list = null;
    for (const b of L.markdown(text)) {
      if (b.t === 'li' || b.t === 'oli') {
        const tag = b.t === 'li' ? 'ul' : 'ol';
        if (!list || list.tagName.toLowerCase() !== tag) { list = h(tag); box.append(list); }
        list.append(h('li', {}, runs(b.runs)));
        continue;
      }
      list = null;
      if (b.t === 'p') box.append(h('p', {}, runs(b.runs)));
      else if (b.t === 'h') box.append(h(`h${Math.min(6, b.level + 2)}`, { class: 'md-h' }, runs(b.runs)));
      else if (b.t === 'quote') box.append(h('blockquote', {}, runs(b.runs)));
      else if (b.t === 'hr') box.append(h('hr'));
      else if (b.t === 'code') box.append(h('pre', { class: 'code', tabindex: '0' }, h('code', { text: b.text })));
    }
    return box;
  }

  // ---------------------------------------------------------------- a diff
  function diffFile(file) {
    if (file.binary) return h('p', { class: 'muted small pad', text: 'A binary file: nothing to show on a phone.' });
    if (!file.hunks.length) return h('p', { class: 'muted small pad', text: 'No line changes (a rename or a mode change).' });
    const box = h('div', { class: 'diff', role: 'table', 'aria-label': `Changes to ${file.path}` });
    for (const hunk of file.hunks) {
      box.append(h('div', { class: 'diff-hunk', role: 'row', text: hunk.header ? `@@ ${hunk.header}` : '@@' }));
      for (const r of hunk.rows) {
        box.append(h('div', { class: `diff-row ${r.kind}`, role: 'row' },
          h('span', { class: 'diff-n', 'aria-hidden': 'true', text: r.kind === 'del' ? r.a : r.b }),
          h('span', { class: 'diff-sign', 'aria-hidden': 'true', text: r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ' ' }),
          h('span', { class: 'diff-text', text: r.text || ' ', 'aria-label': `${r.kind === 'add' ? 'added' : r.kind === 'del' ? 'removed' : ''} ${r.text}`.trim() })));
      }
    }
    return box;
  }

  root.PocketDraw = { crab, diffFile, h, helperHue, icon, markdown, setSkin };
})(window);
