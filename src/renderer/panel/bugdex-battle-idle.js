/* Shellby panel — a bug battle between moves. Claude can take minutes over a
   turn, and moves only come with real work, so while nothing's queued the two
   fill the gap, turn about: Shellby fidgets while the text box says what
   Claude is up to, then the bug acts up in its own way. Never logged; a real
   move cuts it off where it is. bugdex-battle.js makes one (SB.battleIdle),
   ticks it every second while a battle is open, and stops it when a move
   comes in. Loaded before bugdex-battle.js. */
'use strict';
(function () {
  const { state } = SB;
  const IDLE_FIRST_MS = 3500;    // quiet this long between moves, and they fill the gap...
  const IDLE_EVERY_MS = 6000;    // ...then again this often
  // What each type of bug gets up to while it waits: how it moves, and what the text box says.
  const ANTICS = {
    runtime: { move: 'glitch', lines: ['{n} throws a stack frame around.', '{n} rattles its call stack.'] },
    io: { move: 'shiver', lines: ['{n} jiggles the file lock.', '{n} hides in a temp folder.'] },
    net: { move: 'lag', lines: ['{n} is buffering…', '{n} drops a packet on purpose.'] },
    vcs: { move: 'peek', lines: ['{n} ties another merge knot.', '{n} rewrites a little history.'] },
    ci: { move: 'hop', lines: ['{n} turns the light red again.', '{n} waits for a runner.'] },
    build: { move: 'puff', lines: ['{n} kicks over some rubble.', '{n} sits on a stale cache.'] },
    types: { move: 'glitch', lines: ['{n} twists into a union type.', '{n} insists it’s any.'] },
    py: { move: 'coil', lines: ['{n} coils into a new indent.', '{n} mixes tabs and spaces.'] },
    sys: { move: 'puff', lines: ['{n} squeezes a little more memory.', '{n} grabs another handle.'] },
    test: { move: 'shiver', lines: ['{n} passes. No, wait, it fails.', '{n} flickers between green and red.'] },
    sec: { move: 'peek', lines: ['{n} leaves a door unlocked.', '{n} pinches a secret.'] },
    ghost: { move: 'fade', lines: ['Now you see {n}…', '{n} isn’t there. Or is it?'] },
  };
  const WIGGLES = {
    hop: [{ transform: 'translateY(0)' }, { transform: 'translateY(-14px)', offset: 0.35 }, { transform: 'translateY(0)', offset: 0.6 }, { transform: 'translateY(-5px)', offset: 0.8 }, { transform: 'translateY(0)' }],
    shiver: Array.from({ length: 9 }, (_, i) => ({ transform: `translateX(${i === 8 ? 0 : i % 2 ? -3 : 3}px)` })),
    glitch: [{ transform: 'translateX(0)', filter: 'none' }, { transform: 'translateX(5px)', filter: 'hue-rotate(90deg)', offset: 0.2 }, { transform: 'translateX(-4px)', filter: 'hue-rotate(200deg) invert(.15)', offset: 0.4 }, { transform: 'translateX(2px)', filter: 'none', offset: 0.6 }, { transform: 'translateX(0)', filter: 'none' }],
    lag: [{ transform: 'translateX(0)' }, { transform: 'translateX(8px)', offset: 0.25 }, { transform: 'translateX(8px)', offset: 0.75 }, { transform: 'translateX(0)' }],
    fade: [{ opacity: 1 }, { opacity: 0.1, offset: 0.3 }, { opacity: 0.1, offset: 0.65 }, { opacity: 1 }],
    puff: [{ transform: 'scale(1)' }, { transform: 'scale(1.18, 1.1)', offset: 0.5 }, { transform: 'scale(1)' }],
    coil: [{ transform: 'scale(1)' }, { transform: 'scale(1.1, .82)', offset: 0.3 }, { transform: 'scale(.92, 1.12) translateY(-6px)', offset: 0.6 }, { transform: 'scale(1)' }],
    peek: [{ transform: 'rotate(0)' }, { transform: 'translateX(-4px) rotate(-10deg)', offset: 0.3 }, { transform: 'translateX(4px) rotate(10deg)', offset: 0.7 }, { transform: 'rotate(0)' }],
  };
  // Shellby's moment between moves: what Claude is up to, if the conversation is busy, or just waiting.
  const THINKING = ['Claude is thinking…', 'Claude sizes up {n}…', 'Claude plans the next move…', 'Claude reads up on {n}…'];
  const WAITING = ['{n} waits for Claude’s next move.', 'Shellby keeps a claw up.', '{n} circles on its rock.'];

  /**
   * @param {{ scene: () => any, reduced: () => boolean, fx: any, charMs: number }} ctx
   *   scene(): the open battle screen or null, carrying gen, idleN, idling, idleAnims and quietSince
   *   (bugdex-battle.js sets them as it opens one); fx: the effects (bugdex-battle-fx.js);
   *   charMs: the text box's typing speed.
   */
  SB.battleIdle = function (ctx) {
    const { reduced, fx, charMs } = ctx;
    const scene = () => ctx.scene();

    function tick() {
      const s = scene();
      if (!s?.ready || s.playing || s.idling || s.queue.length || s.b?.over || document.hidden) return;
      if (Date.now() - s.quietSince < (s.idleN ? IDLE_EVERY_MS : IDLE_FIRST_MS)) return;
      const gen = s.gen;
      fidget(s, gen).catch(() => {}).finally(() => {
        if (scene() !== s || s.gen !== gen) return;
        s.idling = false;
        s.quietSince = Date.now();
      });
    }

    /** A real move is here: whatever filler is playing stops where it is. */
    function stop() {
      const s = scene();
      if (!s?.idling) return;
      s.gen++;
      for (const a of s.idleAnims) a.cancel();
      s.idleAnims = [];
      s.idling = false;
    }

    // Turn about: Shellby's moment (what Claude is up to), then the bug's.
    async function fidget(s, gen) {
      s.idling = true;
      s.idleAnims = [];
      const n = s.idleN++;
      s.parts.screen.dataset.fillers = String(s.idleN); // how many gaps it has filled (e2e-battle)
      const b = s.b;
      const p = s.parts;
      const fill = t => t.replaceAll('{n}', b.name);
      const round = Math.floor(n / 2);
      if (n % 2 === 0) {
        const thinking = !!(b.tabId && state.tabs?.get(b.tabId)?.busy);
        const pool = thinking ? THINKING : WAITING;
        if (thinking) fx.floater('…', 'think', fx.centre(p.crab));
        await Promise.all([crabFidget(round), mutter(fill(pool[round % pool.length]), gen)]);
        return;
      }
      const antic = ANTICS[b.type] || ANTICS.ghost;
      await Promise.all([wiggle(p.foeArt, WIGGLES[antic.move]), mutter(fill(antic.lines[round % antic.lines.length]), gen)]);
    }

    function crabFidget(round) {
      const p = scene().parts;
      const kind = round % 3;
      if (kind === 0) {
        const claw = p.crab.querySelector('.part-claw');
        return wiggle(claw, [{ transform: 'rotate(0)' }, { transform: 'rotate(-20deg)' }, { transform: 'rotate(4deg)' }, { transform: 'rotate(-20deg)' }, { transform: 'rotate(0)' }], { duration: 640 });
      }
      // He glances back over his shell...
      if (kind === 1) return wiggle(p.crab, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(-1)', offset: 0.2 }, { transform: 'scaleX(-1)', offset: 0.7 }, { transform: 'scaleX(1)' }], { duration: 1100, easing: 'steps(1, end)' });
      // ...or bounces on his toes.
      return wiggle(p.me.querySelector('.bb-me-art'), WIGGLES.hop, { duration: 620, easing: 'ease-out' });
    }

    function wiggle(el, frames, opts = {}) {
      const s = scene();
      if (!el || !s || reduced()) return Promise.resolve();
      const a = el.animate(frames, { duration: 760, easing: 'steps(8, end)', ...opts });
      s.idleAnims.push(a);
      return a.finished.catch(() => {});
    }

    /** Type a filler line, stopping the moment a real move takes the box (gen moves on). */
    async function mutter(line, gen) {
      const s = scene();
      if (!s || s.gen !== gen) return;
      const p = s.parts;
      p.caret.hidden = true;
      if (reduced()) p.text.textContent = line;
      else {
        for (let i = 1; i <= line.length; i++) {
          if (scene() !== s || s.gen !== gen) return;
          p.text.textContent = line.slice(0, i);
          if (line[i - 1] !== ' ') await new Promise(r => setTimeout(r, charMs));
        }
      }
      if (scene() === s && s.gen === gen) p.caret.hidden = false;
    }

    return { tick, stop };
  };
})();
