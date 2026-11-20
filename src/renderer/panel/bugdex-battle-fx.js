/* Shellby panel — what a bug battle looks like, move by move: a lunge and
   the claw's slash, the magnifying glass of a scout, a beam of shots, the
   flash, shake and sparks of a hit with its damage floating up, a miss, a
   shield, a heal, the bug striking back, the faint, dust as it flees, a crew
   member hopping in to help and back out, the party row, and confetti.
   bugdex-battle.js makes one (SB.battleFx) with the way to the open scene
   and plays each move through it; main's bugdex/battle.js decided the move.
   Nothing here is ever put in as HTML. Loaded before bugdex-battle.js. */
'use strict';
(function () {
  const { h, state } = SB;
  const LENS = { palette: { r: '#d9c8a0', g: '#bfe9ff', w: '#ffffff', k: '#5c4a32' }, pixels: ['.rrr...', 'rgwgr..', 'rggggr.', 'rggggr.', '.rrrr..', '....kk.', '.....kk'] };

  /**
   * @param {{ scene: () => any, reduced: () => boolean, wait: (ms: number) => Promise<void>, cue: (name: string, opts?: any) => void, setHp: (hp: number) => void }} ctx
   *   scene(): the open battle screen ({ parts, b, ... }) or null; reduced(): motion turned down;
   *   wait(): a pause that shrinks with it; cue(): a sound; setHp(): the HP bar (bugdex-battle.js).
   */
  SB.battleFx = function (ctx) {
    const { reduced, wait, cue, setHp } = ctx;
    const scene = () => ctx.scene();

    // Where something is, in the screen's own coordinates.
    function centre(el) {
      const s = scene().parts.screen.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2, w: r.width, h: r.height };
    }

    function bit(cls, x, y, style = '') {
      const el = h('i', { class: `bb-bit ${cls}`, style: `left:${x}px;top:${y}px;${style}` });
      scene().parts.fx.append(el);
      return el;
    }

    const gone = a => a.finished.then(() => a.effect.target.remove(), () => a.effect.target?.remove());

    function shake(px, ms) {
      if (reduced() || !scene()) return;
      const k = Array.from({ length: 8 }, (_, i) => ({ transform: `translate(${(i % 2 ? -1 : 1) * px * (1 - i / 8)}px, ${(i % 3 - 1) * px * 0.4}px)` }));
      scene().parts.screen.animate([...k, { transform: 'translate(0,0)' }], { duration: ms });
    }

    function flash(color = '#ffffff', ms = 220) {
      if (reduced() || !scene()) return;
      const f = h('i', { class: 'bb-flash', style: `background:${color}` });
      scene().parts.fx.append(f);
      gone(f.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: ms }));
    }

    function floater(text, cls, at) {
      if (!scene()) return;
      const el = bit(`bb-float ${cls}`, at.x, at.y - at.h * 0.4);
      el.textContent = text;
      if (reduced()) { setTimeout(() => el.remove(), 700); return; }
      gone(el.animate([{ transform: 'translate(-50%, 0) scale(.6)', opacity: 0 }, { transform: 'translate(-50%, -14px) scale(1.15)', opacity: 1, offset: 0.25 }, { transform: 'translate(-50%, -26px) scale(1)', opacity: 0 }], { duration: 900, easing: 'ease-out' }));
    }

    function burst(at, color, n = 10, spread = 40) {
      if (reduced() || !scene()) return;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
        const d = spread * (0.6 + Math.random() * 0.6);
        const el = bit('bb-spark', at.x, at.y, `background:${color}`);
        gone(el.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(.3)`, opacity: 0 }], { duration: 500 + Math.random() * 300, easing: 'cubic-bezier(.2,.8,.2,1)' }));
      }
    }

    async function blink(el, times = 3) {
      if (reduced()) return;
      await el.animate(Array.from({ length: times * 2 + 1 }, (_, i) => ({ opacity: i % 2 ? 0.1 : 1 })), { duration: times * 140, easing: 'steps(1, end)' }).finished.catch(() => {});
    }

    async function lunge(el, dir = 1) {
      if (reduced()) return;
      await el.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${-6 * dir}px, 2px)`, offset: 0.3 }, { transform: `translate(${22 * dir}px, -10px)`, offset: 0.6 }, { transform: 'translate(0,0)' }], { duration: 420, easing: 'cubic-bezier(.3,.7,.3,1)' }).finished.catch(() => {});
    }

    async function slash(attacker) {
      const p = scene().parts;
      const claw = attacker === p.me ? p.crab.querySelector('.part-claw') : null;
      if (claw && !reduced()) claw.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-18deg)' }, { transform: 'rotate(8deg)' }, { transform: 'rotate(0)' }], { duration: 420, transformOrigin: 'center' });
      const go = lunge(attacker);
      await wait(220);
      const at = centre(p.foeArt);
      if (!reduced()) {
        for (let i = 0; i < 3; i++) {
          const el = bit('bb-slash', at.x + (i - 1) * 10, at.y + (i - 1) * 6);
          gone(el.animate([{ transform: 'translate(-50%,-50%) rotate(-35deg) scaleX(0)', opacity: 1 }, { transform: 'translate(-50%,-50%) rotate(-35deg) scaleX(1)', opacity: 1, offset: 0.5 }, { transform: 'translate(-50%,-50%) rotate(-35deg) scaleX(1)', opacity: 0 }], { duration: 300, delay: i * 70 }));
        }
      }
      await go;
    }

    async function scout() {
      const p = scene().parts;
      const at = centre(p.foeArt);
      if (reduced()) return;
      const lens = bit('bb-lens', at.x, at.y);
      lens.append(SB.Sprite.grid(LENS.pixels, LENS.palette, { px: 3 }));
      await lens.animate([
        { transform: 'translate(-90%, -40%) rotate(-10deg)', opacity: 0 },
        { transform: 'translate(-90%, -40%) rotate(-10deg)', opacity: 1, offset: 0.15 },
        { transform: 'translate(-10%, -70%) rotate(8deg)', offset: 0.45 },
        { transform: 'translate(-60%, -10%) rotate(-4deg)', offset: 0.75 },
        { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 0 },
      ], { duration: 900, easing: 'ease-in-out' }).finished.catch(() => {});
      lens.remove();
      const q = bit('bb-float scout', at.x, at.y - at.h * 0.6);
      q.textContent = '?';
      gone(q.animate([{ transform: 'translate(-50%,0) scale(.4)', opacity: 0 }, { transform: 'translate(-50%,-8px) scale(1.2)', opacity: 1, offset: 0.4 }, { transform: 'translate(-50%,-12px) scale(1)', opacity: 0 }], { duration: 700 }));
    }

    async function beam(attacker, color, n) {
      const p = scene().parts;
      const go = lunge(attacker === p.me ? p.me.querySelector('.bb-me-art') : attacker, 0.5);
      if (reduced()) { await go; return; }
      const from = centre(attacker === p.me ? p.crab : attacker);
      const to = centre(p.foeArt);
      const runs = [];
      for (let i = 0; i < n; i++) {
        const el = bit('bb-shot', from.x, from.y - 6, `background:${color};box-shadow:0 0 6px ${color}`);
        const wob = (i % 2 ? 1 : -1) * (6 + (i * 7) % 12);
        runs.push(gone(el.animate([
          { transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 },
          { transform: `translate(calc(-50% + ${(to.x - from.x) * 0.5}px), calc(-50% + ${(to.y - from.y) * 0.5 + wob}px)) scale(1)`, opacity: 1, offset: 0.5 },
          { transform: `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${to.y - from.y + 6}px)) scale(.8)`, opacity: 0.9 },
        ], { duration: 420, delay: i * 30, easing: 'cubic-bezier(.4,.1,.6,1)' })));
      }
      await Promise.all([go, ...runs]);
    }

    async function impact(m) {
      const p = scene().parts;
      const at = centre(p.foeArt);
      const heavy = m.fx === 'crit' || m.fx === 'finish';
      const big = heavy || m.fx === 'super';
      cue(heavy ? 'smash' : m.fx === 'super' ? 'super' : 'hit');
      if (m.fx === 'finish') { flash('#ffffff', 420); shake(12, 640); burst(at, '#ffd23f', 26, 76); burst(at, '#ffffff', 12, 40); }
      else if (m.fx === 'crit') { flash('#ffffff', 320); shake(9, 520); burst(at, '#ffd23f', 18, 60); }
      else if (m.fx === 'super') { flash('#fff4d6', 200); shake(5, 380); burst(at, '#ffd166', 12, 46); }
      else burst(at, '#ffffff', 7, 28);
      if (m.dmg > 0) floater(`-${m.dmg}`, big ? 'dmg big' : 'dmg', at);
      await blink(p.foeArt, big ? 4 : 2);
    }

    async function dodge(scouting) {
      const p = scene().parts;
      cue('miss');
      if (scouting) return;
      const at = centre(p.foeArt);
      floater('MISS', 'miss', at);
      if (reduced()) return;
      await p.foeArt.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(18px) translateY(-4px)', offset: 0.35 }, { transform: 'translateX(18px)', offset: 0.6 }, { transform: 'translateX(0)' }], { duration: 480, easing: 'ease-out' }).finished.catch(() => {});
    }

    // The bug's turn: it lunges at the crab, who flinches (he has no HP to lose).
    async function strikeBack() {
      const p = scene().parts;
      const go = lunge(p.foe, -1);
      if (!reduced()) await wait(250);
      cue('hit');
      const at = centre(p.crab);
      burst(at, '#ff7a5c', 9, 30);
      shake(4, 300);
      await Promise.all([go, blink(p.me.querySelector('.bb-me-art'), 2)]);
    }

    async function heal() {
      const p = scene().parts;
      cue('heal');
      const at = centre(p.foeArt);
      floater('+HP', 'heal', at);
      if (reduced()) return;
      for (let i = 0; i < 10; i++) {
        const el = bit('bb-spark heal', at.x + (i - 5) * 6, at.y + at.h * 0.3);
        gone(el.animate([{ transform: 'translate(-50%,0)', opacity: 0 }, { transform: 'translate(-50%,-10px)', opacity: 1, offset: 0.3 }, { transform: 'translate(-50%,-36px)', opacity: 0 }], { duration: 800, delay: i * 50 }));
      }
      await p.foeArt.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(1.6) drop-shadow(0 0 6px #80ed99)' }, { filter: 'brightness(1)' }], { duration: 700 }).finished.catch(() => {});
    }

    async function resist() {
      const p = scene().parts;
      cue('resist');
      const at = centre(p.foeArt);
      floater('RESIST', 'resist', at);
      if (reduced()) return;
      const shield = bit('bb-shield', at.x, at.y, `width:${at.w * 1.5}px;height:${at.h * 1.5}px`);
      await gone(shield.animate([{ transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.05)', opacity: 1, offset: 0.3 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.7 }, { transform: 'translate(-50%,-50%) scale(1.2)', opacity: 0 }], { duration: 800 }));
    }

    async function faint() {
      const p = scene().parts;
      setHp(0);
      cue('faint');
      if (reduced()) { p.foeArt.style.transform = 'rotate(180deg)'; return; }
      await blink(p.foeArt, 3);
      // Belly-up, the way a knocked-out fish floats.
      p.foeArt.style.animation = 'none';
      await p.foeArt.animate([{ transform: 'rotate(0)', filter: 'saturate(1)' }, { transform: 'rotate(180deg)', filter: 'saturate(.4)' }], { duration: 520, easing: 'cubic-bezier(.3,1.4,.5,1)', fill: 'forwards' }).finished.catch(() => {});
    }

    // Pixel confetti for a badge or the Hall of Fame.
    function confetti(n) {
      if (reduced() || !scene()) return;
      const w = scene().parts.screen.clientWidth;
      const colours = ['#ffd23f', '#ff7a5c', '#7fd6c2', '#9d8cff', '#ffffff', '#80ed99'];
      for (let i = 0; i < n; i++) {
        const el = bit('bb-confetti', Math.random() * w, -8, `background:${colours[i % colours.length]}`);
        const drift = (Math.random() - 0.5) * 80;
        gone(el.animate([{ transform: 'translate(0,0) rotate(0)' }, { transform: `translate(${drift}px, ${260 + Math.random() * 80}px) rotate(${360 + Math.random() * 360}deg)` }], { duration: 1600 + Math.random() * 1200, delay: Math.random() * 500, easing: 'cubic-bezier(.3,.1,.7,1)' }));
      }
    }

    function dust(el) {
      if (reduced()) return;
      const at = centre(el);
      for (let i = 0; i < 6; i++) {
        const d = bit('bb-dust', at.x - i * 8, at.y + at.h * 0.35);
        gone(d.animate([{ transform: 'translate(-50%,-50%) scale(.3)', opacity: 0.9 }, { transform: `translate(calc(-50% - ${10 + i * 4}px), calc(-50% - 8px)) scale(1.3)`, opacity: 0 }], { duration: 600, delay: i * 50 }));
      }
    }

    // A crew member hops in from the edge to help, then hops back out.
    async function helperIn(by) {
      const p = scene().parts;
      if (!by) return null;
      const svg = SB.sprite(state.skin, {});
      svg.style.filter = `hue-rotate(${Number(by.hue) || 0}deg) saturate(1.1)`;
      const el = h('div', { class: 'bb-helper' }, svg, h('span', { class: 'bb-helper-tag', text: `${by.name} · Lv${by.level || 1}` }));
      p.screen.insertBefore(el, p.foeHud);
      if (!reduced()) await el.animate([{ transform: 'translate(-160%, 30%)' }, { transform: 'translate(-30%, -40%)', offset: 0.5 }, { transform: 'translate(0, 0)' }], { duration: 520, easing: 'cubic-bezier(.3,.7,.3,1)' }).finished.catch(() => {});
      return el;
    }

    function helperOut(el) {
      if (reduced()) { el.remove(); return; }
      gone(el.animate([{ transform: 'translate(0,0)', opacity: 1 }, { transform: 'translate(-20%, -50%)', opacity: 1, offset: 0.4 }, { transform: 'translate(-180%, 20%)', opacity: 0 }], { duration: 600, delay: 400, easing: 'ease-in', fill: 'forwards' }));
    }

    function renderParty(b) {
      if (!scene()) return;
      const slots = Array.from({ length: 6 }, (_, i) => b.party[i] || null);
      scene().parts.party.replaceChildren(...slots.map(m => {
        if (!m) return h('span', { class: 'bb-slot empty', 'aria-hidden': 'true' });
        const svg = SB.sprite(state.skin, {});
        svg.style.filter = `hue-rotate(${Number(m.hue) || 0}deg) saturate(1.1)`;
        return h('span', { class: 'bb-slot', title: `${m.name} (${m.type}), level ${m.level || 1}` }, svg);
      }));
    }

    return { centre, bit, gone, shake, flash, floater, burst, blink, lunge, slash, scout, beam, impact, dodge, strikeBack, heal, resist, faint, confetti, dust, helperIn, helperOut, renderParty };
  };
})();
