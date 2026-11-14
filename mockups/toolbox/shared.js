// Helpers every concept uses, and the registry the gallery mounts them from.
(function () {
  'use strict';

  const KINDS = Object.freeze({
    skill: { one: 'Skill', many: 'Skills', color: '#7fd6c2', glyph: 'S' },
    agent: { one: 'Agent', many: 'Agents', color: '#ff7a5c', glyph: 'A' },
    command: { one: 'Command', many: 'Commands', color: '#ffc15e', glyph: '/' },
    mcp: { one: 'MCP server', many: 'MCP', color: '#b3a6ff', glyph: 'M' },
    mod: { one: 'Mod', many: 'Mods', color: '#8fc7ff', glyph: 'm' },
    snippet: { one: 'Snippet', many: 'Snippets', color: '#e9dcc0', glyph: '“' },
    memory: { one: 'Memory', many: 'Memory', color: '#d9b98a', glyph: '¶' },
    hook: { one: 'Hook', many: 'Hooks', color: '#f29bc4', glyph: 'h' },
    rule: { one: 'Rule', many: 'Rules', color: '#a7d47a', glyph: '✓' },
    workflow: { one: 'Workflow', many: 'Workflows', color: '#8fc7ff', glyph: 'w' },
  });

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function tok(n) {
    if (!n) return '0';
    if (n < 1000) return String(Math.round(n));
    return `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '')}k`;
  }

  function ago(days) {
    if (days == null) return 'never';
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 14) return `${days} days ago`;
    if (days < 60) return `${Math.round(days / 7)} weeks ago`;
    return `${Math.round(days / 30)} months ago`;
  }

  const total = arr => (arr || []).reduce((a, b) => a + b, 0);
  const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const isIdle = (it, idleDays) => Array.isArray(it.uses) && (it.lastUsed == null || it.lastUsed > idleDays);

  function glyph(kind, size = 26) {
    const k = KINDS[kind];
    return `<span class="kg" style="--k:${k.color};--s:${size}px" aria-hidden="true">${esc(k.glyph)}</span>`;
  }

  // Six weekly bars, oldest first.
  function spark(uses, color = 'var(--glass)') {
    if (!Array.isArray(uses)) return '<span class="spark none" aria-hidden="true"></span>';
    const max = Math.max(1, ...uses);
    const bars = uses.map((u, i) => {
      const h = u ? Math.max(2, Math.round((u / max) * 14)) : 1;
      return `<rect x="${i * 7}" y="${16 - h}" width="5" height="${h}" rx="1" fill="${u ? color : 'var(--reef-3)'}"/>`;
    }).join('');
    return `<svg class="spark" viewBox="0 0 40 16" width="40" height="16" role="img" aria-label="${count(total(uses), 'use')} in six weeks">${bars}</svg>`;
  }

  // A hermit crab in pixels: body, eyes on stalks, a spiral shell on his back.
  const CRAB = [
    '.r.......r.',
    'rr.e...e.rr',
    '.r.l...l.r.',
    '..bbbbbbb..',
    '.bbbbbbbbb.',
    'bbbwbbbwbbb',
    'l.bbbbbbb.l',
    '.l.l...l.l.',
  ];
  function crab(px = 3, tint = '#ff7a5c', label = '') {
    const shade = { r: tint, b: tint, l: `color-mix(in srgb, ${tint} 70%, #071012)`, e: '#f3e6cc', w: 'rgba(7, 16, 18, .55)' };
    let rects = '';
    CRAB.forEach((row, y) => [...row].forEach((c, x) => {
      if (shade[c]) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" style="fill:${shade[c]}"/>`;
    }));
    const role = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
    return `<svg class="crab" viewBox="0 0 11 8" width="${11 * px}" height="${8 * px}" shape-rendering="crispEdges" ${role}>${rects}</svg>`;
  }

  // A toast inside the phone, with an optional Undo.
  function toast(phone, text, undo) {
    let t = phone.querySelector('.toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'toast';
      t.setAttribute('role', 'status');
      phone.append(t);
    }
    t.innerHTML = `<span>${esc(text)}</span>${undo ? '<button type="button" class="link">Undo</button>' : ''}`;
    t.classList.add('on');
    clearTimeout(t._timer);
    if (undo) t.querySelector('button').onclick = () => { undo(); t.classList.remove('on'); };
    t._timer = setTimeout(() => t.classList.remove('on'), 4200);
  }

  // Counts a number from one value to another; instant under reduced motion.
  function countTo(el, from, to, fmt = tok, ms = 600) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const step = now => {
      const p = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  const concepts = [];
  window.TB = Object.freeze({
    KINDS, esc, tok, ago, total, count, isIdle, glyph, spark, crab, toast, countTo,
    concepts,
    register: c => concepts.push(c),
    clone: () => structuredClone(window.TB_DATA),
  });
})();
