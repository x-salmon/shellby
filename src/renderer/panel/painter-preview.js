/* Shellby panel — the Painter's preview (painter.js makes it): him at 4× in
   your colours, doing each mood and work pose with the moves he has on the
   desk (../shared/crab-anim.css), what he holds for each, your outfit with his
   anchors to drag, an accessory on him, an effect round him, a piece of decor
   beside him, and Try him on the desk. */
'use strict';
(function () {
  const { h, api, state, $ } = SB;
  const G = window.ShellbyPixelGrid;
  const WORK = window.ShellbyWorkPoses;
  const PX = 4; // his own size on the desk at Medium
  const SLOT_FOLLOWS = { hat: 'stalks', face: 'stalks', neck: 'body', held: 'claw', shell: 'shell' };
  // The moods first, then how he works (src/main/work-pose.js); 'busy' is Working's scuttle.
  const POSE_LABEL = { idle: 'Idle', working: 'Working', asking: 'Asking', sleeping: 'Sleeping', think: 'Thinking', read: 'Reading', write: 'Editing', run: 'Running', search: 'Searching', web: 'On the web', plan: 'Planning', crew: 'Crew',
    test: 'Testing', git: 'Committing', install: 'Installing', build: 'Building', skill: 'Skill', mcp: 'MCP tool', talk: 'Talking', compact: 'Compacting' };
  const POSES = ['idle', 'working', 'asking', 'sleeping', ...WORK.POSES.filter(p => p !== 'busy')];

  /**
   * x: what painter.js shares: { cur(), doc(), settings(), meta(), commit(next),
   * record(before), afterChange(), stroking(), fill(el, ...kids), reduced() }.
   */
  SB.paintPreview = x => {
    const { doc, settings, meta, commit, fill, reduced } = x;
    const cur = x.cur;
    let pose = 'idle', wear = false;
    /** @type {any} */
    let fx = null;
    let fxKey = '', decorTimer = 0;
    let deskUntil = 0, deskTimer = 0;

    // ------------------------------------------------------------ the preview

    function stageClass() {
      const working = WORK.POSES.includes(pose) && pose !== 'busy';
      const st = working ? 'working' : pose;
      return `pt-stage crab-anim state-${st}${working ? ` work-${pose}` : ''}`;
    }

    function renderPoses() {
      if (cur().mode === 'decor' || cur().mode === 'effect') return;
      fill($('ptPoses'), ...POSES.map(p => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(p === pose), dataset: { pose: p },
        onclick: () => { pose = p; renderPoses(); renderPreview(); if (reduced()) playOnce(); },
      }, POSE_LABEL[p])));
    }

    // What he wears in the preview: his outfit when asked (and an accessory being painted).
    function previewLook() {
      const look = wear && (cur().mode === 'skin' || cur().mode === 'accessory') ? SB.outfitLook?.() || { accessories: [] } : { accessories: [], shell: null, effect: null };
      let accessories = look.accessories || [];
      if (cur().mode === 'accessory') {
        const s = settings();
        const item = { ...G.toItem(doc(), meta(), s), anchor: SB.Sprite.SLOT_ANCHOR[s.slot], follows: SLOT_FOLLOWS[s.slot] };
        accessories = [...accessories.filter(a => a.slot !== s.slot), item];
      }
      const held = WORK.ITEMS[pose];
      if (held) accessories = [...accessories.filter(a => a.slot !== 'held'), held];
      return { accessories, shell: wear ? look.shell : null, effect: look.effect || null };
    }

    function renderPreview() {
      if (!cur()) return;
      const stage = $('ptStage');
      const host = $('ptCrab');
      clearInterval(decorTimer);
      if (cur().mode === 'decor') {
        stage.className = 'pt-stage';
        fill(host, decorPreview());
        return;
      }
      stage.className = stageClass();
      const skin = cur().mode === 'skin' ? G.toSkin(doc(), meta()) : state.skin;
      if (!skin) return;
      const look = previewLook();
      const svg = SB.Sprite.build(skin, { px: PX, accessories: look.accessories, shell: look.shell || undefined });
      fill(host, svg);
      if (cur().mode === 'skin' && wear) host.append(anchorDots());
      const help = cur().mode === 'skin' && wear;
      $('ptAnchorHelp').hidden = !help;
      $('ptAnchorReset').hidden = !doc().anchors;
      const effect = cur().mode === 'effect' ? effectItem() : look.effect;
      const key = effect ? JSON.stringify(effect) : '';
      if (key !== fxKey && !x.stroking()) {
        fxKey = key;
        fxOn()?.set(effect || null);
        if (effect?.motion === 'burst') fx?.burst(effect); // a burst only plays when asked
      }
    }

    function effectItem() {
      const it = G.toItem(doc(), meta(), settings());
      return { ...it, key: 'painter-preview', ink: false, fps: it.fps || 0 };
    }
    function fxOn() {
      fx ||= window.ShellbyFx?.mount($('ptFx'), null, { px: 3 });
      return fx;
    }
    function resetPreviewFx() { fxKey = ''; fx?.set(null); }

    // A piece of decor beside him for size, its pictures taking turns.
    function decorPreview() {
      const d = doc();
      const s = settings();
      const pics = d.frames.map(rows => SB.Sprite.grid(rows, d.palette, { px: PX }));
      const box = h('div', { class: 'pt-decor-piece' }, h('span', {}, pics[d.frame]), state.skin ? SB.Sprite.build(state.skin, { px: 2 }) : null);
      if (pics.length > 1 && !reduced()) {
        let i = d.frame;
        decorTimer = setInterval(() => { i = (i + 1) % pics.length; box.firstChild.replaceChildren(pics[i]); }, 1000 / Math.max(1, s.fps || 2));
      }
      return box;
    }

    // His five anchors as dots you drag (snapped to whole pixels, inside -16..48).
    function anchorDots() {
      const layer = h('div', { class: 'pt-anchors' });
      const all = G.effectiveAnchors(doc());
      for (const name of G.ANCHOR_NAMES) {
        const [x, y] = all[name];
        const dot = h('button', {
          type: 'button', class: 'pt-anchor', dataset: { anchor: name, label: G.ANCHOR_LABEL[name] },
          'aria-label': `${G.ANCHOR_LABEL[name]} at ${x}, ${y}. Arrow keys move it.`,
          style: `left:${(x + 0.5) * PX}px;top:${(y + 0.5) * PX}px`,
        });
        dot.addEventListener('pointerdown', e => dragAnchor(e, name, dot));
        dot.addEventListener('keydown', e => {
          const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
          if (!step) return;
          e.preventDefault();
          const [ax, ay] = G.effectiveAnchors(doc())[name];
          if (commit(G.setAnchor(doc(), name, ax + step[0], ay + step[1]))) $('ptCrab').querySelector(`[data-anchor="${name}"]`)?.focus();
        });
        layer.append(dot);
      }
      return layer;
    }

    function dragAnchor(e, name, dot) {
      e.preventDefault();
      const base = doc();
      const stage = $('ptStage');
      stage.classList.add('pt-holding');
      dot.classList.add('dragging');
      dot.setPointerCapture(e.pointerId);
      const svg = $('ptCrab').querySelector('svg');
      const move = ev => {
        const r = svg.getBoundingClientRect();
        const next = G.setAnchor(doc(), name, Math.floor((ev.clientX - r.left) / PX), Math.floor((ev.clientY - r.top) / PX));
        if (next === doc()) return;
        cur().doc = next;
        const [x, y] = next.anchors[name];
        dot.style.left = `${(x + 0.5) * PX}px`;
        dot.style.top = `${(y + 0.5) * PX}px`;
      };
      const up = () => {
        dot.removeEventListener('pointermove', move);
        dot.removeEventListener('pointerup', up);
        dot.removeEventListener('pointercancel', up);
        stage.classList.remove('pt-holding');
        if (doc() !== base) { x.record(base); x.afterChange(); }
      };
      dot.addEventListener('pointermove', move);
      dot.addEventListener('pointerup', up);
      dot.addEventListener('pointercancel', up);
    }

    $('ptWear').addEventListener('change', e => { wear = e.target.checked; resetPreviewFx(); renderPreview(); });
    $('ptAnchorReset').addEventListener('click', () => commit(G.resetAnchors(doc())));

    // With motion turned down, a pose holds still; this plays its moves once, by
    // script (the reduced-motion rule only stops CSS animations). The moves come
    // from crab-anim.css itself, so they're the same ones he does on the desk.
    function playOnce() {
      const sheet = [...document.styleSheets].find(s => /crab-anim\.css$/.test(s.href || ''));
      if (!sheet) return;
      let rules;
      try { rules = [...sheet.cssRules]; } catch { return; }
      const keyframes = new Map(rules.filter(r => r.constructor?.name === 'CSSKeyframesRule').map(r => [r.name, r]));
      const animated = rules.filter(r => r.selectorText && r.style?.animationName);
      const stage = $('ptStage');
      const secs = v => (/ms$/.test(v) ? parseFloat(v) : parseFloat(v) * 1000) || 0;
      for (const el of [$('ptCrab'), ...stage.querySelectorAll('.part')]) {
        const rule = animated.filter(r => { try { return el.matches(r.selectorText); } catch { return false; } }).pop();
        const name = rule?.style.animationName.split(',')[0].trim();
        const kf = name && keyframes.get(name);
        if (!kf) continue;
        const easing = rule.style.animationTimingFunction.split(/,(?![^(]*\))/)[0].trim() || 'ease';
        const frames = [];
        for (const k of kf.cssRules) {
          for (const at of k.keyText.split(',')) {
            const t = at.trim();
            const f = { offset: t === 'from' ? 0 : t === 'to' ? 1 : parseFloat(t) / 100, easing };
            if (k.style.transform) f.transform = k.style.transform;
            if (k.style.opacity) f.opacity = k.style.opacity;
            frames.push(f);
          }
        }
        frames.sort((a, b) => a.offset - b.offset);
        const count = Number(rule.style.animationIterationCount);
        try {
          el.animate(frames, { duration: secs(rule.style.animationDuration.split(',')[0]), delay: secs(rule.style.animationDelay.split(',')[0]), iterations: Number.isFinite(count) ? Math.min(count, 3) : 2, direction: rule.style.animationDirection.split(',')[0] || 'normal' });
        } catch { /* a keyframe the browser won't take: that part holds still */ }
      }
    }
    $('ptPlayOnce').addEventListener('click', playOnce);

    // ------------------------------------------------------------ on the desk

    async function deskToggle() {
      if (deskUntil > Date.now()) { await api.previewSkin(null); deskUntil = 0; renderDesk(); return; }
      const r = await api.previewSkin(G.toSkin(doc(), meta())).catch(() => null);
      if (!r?.ok) return SB.toast(r?.error || "Couldn't put it on him.");
      deskUntil = r.until;
      renderDesk();
    }
    function renderDesk() {
      clearTimeout(deskTimer);
      const left = Math.ceil((deskUntil - Date.now()) / 1000);
      $('ptDesk').textContent = left > 0 ? `On the desk… ${left}s (take it off)` : 'Try him on the desk';
      $('ptDesk').setAttribute('aria-pressed', String(left > 0));
      if (left > 0) deskTimer = setTimeout(renderDesk, 1000);
    }
    $('ptDesk').addEventListener('click', deskToggle);

    return {
      renderPreview, renderPoses, resetPreviewFx, playOnce,
      /** A new drawing: idle, no outfit pictured over it. */
      reset() { pose = 'idle'; },
      /** Show his outfit (and so his anchors), for a check about them. */
      wearOutfit() { wear = true; $('ptWear').checked = true; renderPreview(); },
      /** Leaving the drawing: no effect or decor still playing. */
      stop() { clearInterval(decorTimer); resetPreviewFx(); },
    };
  };
})();
