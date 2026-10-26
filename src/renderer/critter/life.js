// His life between tasks, drawn (src/main/life.js and playtime.js decide what
// and when): his eyes on your cursor, the props of a scene (a sandcastle, a fly,
// bubbles...), what he holds up or puts on for a moment, and what a visiting
// crab says back. Everything here is drawing; the body animations are one
// class per beat in critter.css (body.bit-*), set by critter.js.
'use strict';
(function () {
  const api = window.shellby.critter;
  const C = window.ShellbyCritter;
  const Sprite = window.ShellbySprite;
  const root = document.documentElement.style;
  const host = /** @type {HTMLElement} */ (document.getElementById('prop'));
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- his eyes
  api.onLook(msg => {
    const x = msg?.x === 1 || msg?.x === -1 ? msg.x : 0;
    const y = msg?.y === 1 || msg?.y === -1 ? msg.y : 0;
    root.setProperty('--lookx', String(x));
    root.setProperty('--looky', String(y));
    // A flag, not a class toggled on the side: critter.js rebuilds the body's
    // classes on every repaint. He tiptoes past your cursor (critter.css).
    const near = !!msg?.near;
    if (near !== C.flags.has('cursor-near')) {
      if (near) C.flags.add('cursor-near'); else C.flags.delete('cursor-near');
      C.paint();
    }
  });

  // ---------------------------------------------------------------- props
  // Pixel art for the props that are drawn rather than made of CSS.
  const ART = {
    castle: { palette: { s: '#e9d8a6', S: '#c9b38a', f: '#e63946', k: '#8a6a4a' }, pixels: ['....f....', '....k....', '.s.sSs.s.', '.sSsssSs.', '.sssssss.', 'sSsSSSsSs', 'sssSSSsss'] },
    heart: { palette: { s: '#c9b38a' }, pixels: ['.ss.ss.', 's..s..s', 's.....s', '.s...s.', '..s.s..', '...s...'] },
    fly: { palette: { k: '#2b2d42', w: '#cfe8ff' }, pixels: ['w.w', '.k.'] },
    snowman: { palette: { w: '#f4fbff', W: '#cfe3f0', k: '#2b2d42', o: '#ff9f1c', b: '#8a6a4a', r: '#e63946' },
      pixels: ['..kkk..', '..kkk..', '.kkkkk.', '..wkw..', '..wwoo.', 'rrrrr..', '.wwkww.', 'bwwwwwb', '.wwkww.', 'wwwwwww', 'wwwWwww', '.WWWWW.'] },
    kite: { palette: { r: '#ef476f', y: '#ffd23f', b: '#118ab2' }, pixels: ['...r...', '..rry..', '.rrryy.', 'bbbyyyy', '.bbby..', '..bb...', '...b...'] },
    bigshell: { palette: { s: '#f4a261', S: '#e76f51', k: '#2b2d42' },
      pixels: ['....sss...', '..sSSsSs..', '.sSssSsss.', 'sSsSSsSsSs', 'ssSsssSsk.', 'sSsSSsskk.', '.ssssskk..', '..SSSS....'] },
  };
  // What his claw holds for a scene (a find comes with its own pixels).
  const HOLD = {
    coffee: { palette: { w: '#fff4e4', b: '#6f4e37', s: '#cfd8dc' }, pixels: ['.s.s..', 'wwwww.', 'wbbbww', 'wbbbww', 'wwwww.'] },
    pebble: { palette: { a: '#8d99ae', b: '#b8c2d1' }, pixels: ['.bb.', 'abba', '.aa.'] },
    mic: { palette: { K: '#2b2d42', s: '#cfd8dc', k: '#4a4e69' }, pixels: ['.KKK.', 'KsKsK', '.KKK.', '..k..', '..k..'] },
    rod: { pivot: [0, 8], palette: { b: '#a0693a', s: '#cfd8dc', r: '#ef476f' }, pixels: ['.......bs', '......b.s', '.....b..s', '....b...s', '...b....r', '..b......', '.b.......', 'b........'] },
    sock: { palette: { w: '#fff4e4', r: '#ef476f', d: '#7fd6c2' }, pixels: ['.rrr', '.www', '.ddd', '.www', 'wwww', 'www.'] },
    book: { palette: { b: '#118ab2', w: '#fff4e4', k: '#8d99ae' }, pixels: ['bbbbbbb', 'bwwbwwb', 'bkwbwkb', 'bwwbwwb', 'bbbbbbb'] },
  };
  // What he puts on his face for a scene.
  const WEAR = {
    shades: { slot: 'face', pivot: [4, 1], palette: { K: '#1b1d2a', w: '#7fd6c2' }, pixels: ['KKKKKKKKK', 'KwKKKKwKK', '.KK...KK.'] },
  };

  /** @type {any} */
  let propTimer = null;
  function clearProp() {
    clearTimeout(propTimer);
    host.className = '';
    host.replaceChildren();
  }

  function el(tag, cls, style = {}) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    for (const [k, v] of Object.entries(style)) e.style.setProperty(k, v);
    return e;
  }

  // Each prop: what goes in the host. Positions are in critter.css (#prop.prop-*).
  const DRAW = {
    'castle': () => [Sprite.grid(ART.castle.pixels, ART.castle.palette, { px: Math.max(2, Math.round(C.px() * 0.8)) })],
    // The castle he just built, crumbling: drawn again and knocked down.
    'castle-fall': () => [Sprite.grid(ART.castle.pixels, ART.castle.palette, { px: Math.max(2, Math.round(C.px() * 0.8)) })],
    'heart': () => [Sprite.grid(ART.heart.pixels, ART.heart.palette, { px: Math.max(2, Math.round(C.px() * 0.7)) })],
    'fly': () => {
      const f = el('i', 'fly');
      f.append(Sprite.grid(ART.fly.pixels, ART.fly.palette, { px: Math.max(2, Math.round(C.px() * 0.6)) }));
      return [f];
    },
    'bubbles': () => Array.from({ length: 6 }, (_, i) => el('i', 'bub', { '--d': `${i * 380}ms`, '--x': `${(i % 3) * 7 - 4}px`, '--s': `${6 + (i * 5) % 7}px` })),
    'shooting-star': () => [el('i', 'star')],
    'juggle': () => [0, 1, 2].map(i => {
      const p = el('i', 'peb', { '--d': `${i * -240}ms` });
      p.append(Sprite.grid(HOLD.pebble.pixels, HOLD.pebble.palette, { px: Math.max(1, Math.round(C.px() * 0.5)) }));
      return p;
    }),
    'achoo': () => Array.from({ length: 8 }, (_, i) => el('i', 'grit', { '--dx': `${14 + (i * 13) % 26}px`, '--dy': `${-10 + (i * 7) % 18}px`, '--d': `${i * 18}ms` })),
    'zz': () => ['z', 'z', 'Z'].map((t, i) => { const z = el('i', 'z', { '--d': `${i * 450}ms` }); z.textContent = t; return z; }),
    'notes': () => ['♪', '♫', '♪'].map((t, i) => { const n = el('i', 'note', { '--d': `${i * 520}ms`, '--x': `${i * 9 - 9}px` }); n.textContent = t; return n; }),
    'snowman': () => [Sprite.grid(ART.snowman.pixels, ART.snowman.palette, { px: Math.max(2, Math.round(C.px() * 0.7)) })],
    // High over his head on a string that runs down to his claw.
    'kite': () => {
      const k = el('i', 'kite');
      k.append(Sprite.grid(ART.kite.pixels, ART.kite.palette, { px: Math.max(2, Math.round(C.px() * 0.7)) }));
      return [el('i', 'string'), k];
    },
    // As big as his own, in the room his window has beside him: that's the joke.
    'bigshell': () => [Sprite.grid(ART.bigshell.pixels, ART.bigshell.palette, { px: Math.max(2, Math.round(C.px() * 1.1)) })],
    // Where his line goes in: rings spreading on the water.
    'ripple': () => [0, 1].map(i => el('i', 'ring', { '--d': `${i * 900}ms` })),
    'sweat': () => [0, 1].map(i => el('i', 'drop', { '--d': `${i * 400}ms`, '--x': `${i * 10}px` })),
    'sparkle': () => ['✦', '✧', '✦', '✧'].map((t, i) => { const s = el('i', 'spark', { '--d': `${i * 260}ms`, '--x': `${(i % 2 ? 1 : -1) * (6 + i * 5)}px`, '--y': `${-4 - (i * 7) % 14}px` }); s.textContent = t; return s; }),
    'hearts': () => ['♥', '♥'].map((t, i) => { const e = el('i', 'love', { '--d': `${i * 320}ms`, '--x': `${i * 10 - 5}px` }); e.textContent = t; return e; }),
    // A bug scooped into a jar (src/main/bugdex/index.js): a splash as it drops in,
    // a puff of sparkles as the cork goes on, and the jar in his claw (critter:hold)
    // settling with one little rock (life.css). A ghost leaves a wisp behind.
    'jar': msg => {
      const splash = Array.from({ length: 6 }, (_, i) => el('i', 'splash', { '--d': `${i * 30}ms`, '--dx': `${(i - 2.5) * 5}px`, '--dy': `${-8 - (i * 7) % 11}px` }));
      const sparks = ['✦', '✧', '✦'].map((t, i) => { const s = el('i', 'spark', { '--d': `${i * 180}ms`, '--x': `${(i - 1) * 9}px`, '--y': `${-2 - (i % 2) * 6}px` }); s.textContent = t; return s; });
      return [...splash, ...sparks, ...(msg.ghost ? [el('i', 'wisp')] : [])];
    },
  };

  const STILL = new Set(['castle', 'heart', 'snowman', 'bigshell']);
  api.onProp(msg => {
    const prop = msg?.prop;
    if (!prop || !DRAW[prop]) return clearProp();
    if (reduced() && !STILL.has(prop)) return clearProp(); // a still picture, no moving parts
    clearProp();
    host.className = `prop-${prop}`;
    host.append(...DRAW[prop](msg)); // the whole message: some props are drawn to order (a ghost's wisp)
    const ms = Number.isFinite(msg.ms) ? Math.min(Math.max(msg.ms, 400), 8000) : 2000;
    propTimer = setTimeout(clearProp, ms + 200);
  });

  // ---------------------------------------------------------------- held and worn
  api.onHold(msg => {
    if (!msg) return C.wear('held', null);
    const art = msg.item ? HOLD[msg.item] : (Array.isArray(msg.pixels) && msg.palette ? msg : null);
    if (!art) return C.wear('held', null);
    const w = Math.max(...art.pixels.map(r => r.length)), h = art.pixels.length;
    // Held up by its bottom middle, like a sticker before it goes on (a rod by its handle).
    const pivot = Array.isArray(art.pivot) && !msg.pixels ? art.pivot : [Math.floor(w / 2), h];
    C.wear('held', { slot: 'held', anchor: 'claw', follows: 'claw', pivot, pixels: art.pixels, palette: art.palette });
  });

  api.onWear(msg => {
    const item = msg?.item && WEAR[msg.item];
    if (!item) { C.wear('face', null); return; }
    C.wear('face', { ...item, anchor: 'face' });
  });

  // ---------------------------------------------------------------- a visitor talking back
  /** @type {any} */
  let vTimer = null;
  api.onVisitorSay(msg => {
    const v = C.visitor();
    const b = v?.querySelector('.vbubble');
    if (!b || typeof msg?.text !== 'string') return;
    clearTimeout(vTimer);
    b.textContent = msg.text.slice(0, 40);
    b.classList.add('on');
    const ms = Number.isFinite(msg.ms) ? Math.min(Math.max(msg.ms, 1000), 8000) : 3000;
    vTimer = setTimeout(() => b.classList.remove('on'), ms);
  });
})();
