/* Shellby panel — find in the file the viewer shows (Ctrl+F there) and go to a
   line (Ctrl+G). Ctrl+F anywhere else still searches the conversation (find.js).
   Matches are painted with the CSS Custom Highlight API, as find.js paints its
   own, so the code isn't rewrapped, and only the code is searched: never the line
   numbers, a comment left on it, or the bar itself. */
'use strict';
(function () {
  const { h, $, state } = SB;
  const MAX_MATCHES = 2000;
  const SEARCHED = '.vw-code .code, .vw-plain'; // a row's code, or the plain text of a long file

  const input = h('input', { class: 'field', type: 'text', spellcheck: 'false', 'aria-label': 'Find in this file' });
  const count = h('span', { class: 'find-count', 'aria-live': 'polite' });
  const icon = d => SB.icon(d, { width: 1.6 });
  const prev = h('button', { type: 'button', class: 'icon-btn', title: 'Previous match (Shift+Enter)', 'aria-label': 'Previous match' }, icon('M4 10l4-4 4 4'));
  const next = h('button', { type: 'button', class: 'icon-btn', title: 'Next match (Enter)', 'aria-label': 'Next match' }, icon('M4 6l4 4 4-4'));
  const close = h('button', { type: 'button', class: 'icon-btn', title: 'Close (Esc)', 'aria-label': 'Close' }, icon('M4.5 4.5l7 7M11.5 4.5l-7 7'));
  const bar = h('div', { class: 'findbar vw-find', id: 'viewerFind', role: 'search', hidden: true }, input, count, prev, next, close);
  $('viewerMain').after(bar);

  let mode = 'find'; // or 'line'
  /** @type {Range[]} */
  let ranges = [];
  let current = -1;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const observer = new MutationObserver(() => {
    if (bar.hidden || mode !== 'find') return;
    clearTimeout(timer);
    timer = setTimeout(() => search({ keep: true }), 200);
  });

  // An element's text as one string, and where each of its characters sits (node, offset).
  function textOf(el) {
    const nodes = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) nodes.push(/** @type {Text} */ (n));
    return { text: nodes.map(n => n.data).join(''), nodes };
  }
  /** @returns {[Text, number]} */
  function at(nodes, offset) {
    let left = offset;
    for (const n of nodes) {
      if (left <= n.data.length) return [n, left];
      left -= n.data.length;
    }
    const last = nodes[nodes.length - 1];
    return [last, last.data.length];
  }

  function collect(q) {
    const needle = q.toLowerCase();
    const out = [];
    if (!needle) return out;
    for (const el of $('viewerMain').querySelectorAll(SEARCHED)) {
      if (out.length >= MAX_MATCHES) break;
      const { text, nodes } = textOf(el);
      if (!nodes.length) continue;
      const hay = text.toLowerCase();
      for (let i = hay.indexOf(needle); i !== -1 && out.length < MAX_MATCHES; i = hay.indexOf(needle, i + needle.length)) {
        const r = new Range();
        r.setStart(...at(nodes, i));
        r.setEnd(...at(nodes, i + needle.length));
        out.push(r);
      }
    }
    return out;
  }

  function paint() {
    CSS.highlights.set('vw-find', new Highlight(...ranges));
    if (ranges[current]) CSS.highlights.set('vw-find-current', new Highlight(ranges[current]));
    else CSS.highlights.delete('vw-find-current');
    const q = input.value;
    count.textContent = !q ? '' : ranges.length ? `${current + 1} of ${ranges.length}${ranges.length >= MAX_MATCHES ? '+' : ''}` : 'No results';
    bar.classList.toggle('none', !!q && !ranges.length);
  }

  const reveal = r => r?.startContainer.parentElement?.closest('.dl, .vw-plain')?.scrollIntoView({ block: 'center' });

  function search({ keep = false } = {}) {
    const was = current;
    ranges = collect(input.value);
    if (!ranges.length) current = -1;
    else if (keep && was >= 0) current = Math.min(was, ranges.length - 1);
    else { current = 0; reveal(ranges[0]); }
    paint();
  }

  function go(step) {
    if (!ranges.length) return;
    if (!ranges[current]?.startContainer.isConnected) search({ keep: true });
    if (!ranges.length) return;
    current = (current + step + ranges.length) % ranges.length;
    reveal(ranges[current]);
    paint();
  }

  function clear() {
    CSS.highlights.delete('vw-find');
    CSS.highlights.delete('vw-find-current');
    ranges = [];
    current = -1;
  }

  function open(how) {
    if (state.view !== 'viewer') return;
    const switching = mode !== how;
    mode = how;
    bar.classList.toggle('line', how === 'line');
    prev.hidden = next.hidden = how === 'line';
    input.placeholder = how === 'line' ? 'Go to line' : 'Find in file';
    input.setAttribute('aria-label', how === 'line' ? 'Go to line' : 'Find in this file');
    input.inputMode = how === 'line' ? 'numeric' : 'text';
    if (switching) { input.value = ''; clear(); count.textContent = ''; bar.classList.remove('none'); }
    bar.hidden = false;
    observer.observe($('viewerMain'), { childList: true, subtree: true, characterData: true });
    input.focus();
    input.select();
    if (how === 'find' && input.value) search();
  }

  function shut({ refocus = true } = {}) {
    if (bar.hidden) return;
    bar.hidden = true;
    observer.disconnect();
    clearTimeout(timer);
    clear();
    if (refocus) /** @type {HTMLElement | null} */ ($('viewerMain').querySelector('.vw-code[tabindex], .vw-scroll'))?.focus({ preventScroll: true });
  }

  function goLine() {
    const n = Number(input.value.trim());
    if (!Number.isInteger(n) || n < 1) { bar.classList.add('none'); count.textContent = 'A line number'; return; }
    bar.classList.remove('none');
    count.textContent = '';
    shut({ refocus: false });
    SB.viewer?.goToLine(n);
  }

  input.addEventListener('input', () => {
    if (mode !== 'find') { bar.classList.remove('none'); count.textContent = ''; return; }
    clearTimeout(timer);
    timer = setTimeout(search, 120);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); if (mode === 'line') goLine(); else go(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); shut(); }
  });
  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  close.addEventListener('click', () => shut());

  document.addEventListener('keydown', e => {
    if (state.view !== 'viewer') return;
    if (SB.shortcuts.matches(e, 'goToLine')) { e.preventDefault(); open('line'); return; }
    if (e.key === 'F3' && !bar.hidden && mode === 'find') { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
  });

  SB.viewerFind = {
    open: () => open('find'),
    goToLine: () => open('line'),
    close: () => shut({ refocus: false }),
    get isOpen() { return !bar.hidden; },
  };
})();
