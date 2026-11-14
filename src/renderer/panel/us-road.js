/* Shellby panel — the road on Us: how close you are, as a stage per level
   (src/main/bond.js stagesOf). Each stage holds what it opened and the moments
   from while you were at it; the one you're at is the big one, with today's
   ways to get closer. Across the page when there's room, newest at the top
   when there isn't, so in the panel where you are now comes first, under the
   one you're heading for. together.js calls render with the life view. */
'use strict';
(function () {
  const { h, $, plural } = SB;
  const WIDE_AT = 1180;   // css px of road before the stages sit side by side
  const MEMS_SHOWN = 3;   // a stage's newest moments; the rest wait behind "All N"
  const road = $('usRoad');
  const shown = new Set(); // stages showing every moment
  /** @type {any} */
  let last = null;         // the view last drawn, to draw again on a resize
  let across = false;      // drawn across the page last time
  let drawn = '';          // what the last drawing showed, so an unchanged view isn't rebuilt under your pointer

  const thisYear = t => new Date(t).getFullYear() === new Date().getFullYear();
  const day = t => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short', year: thisYear(t) ? undefined : 'numeric' });
  const clock = ms => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const until = t => {
    const m = Math.max(1, Math.ceil((t - Date.now()) / 60000));
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  };
  const howLong = days => (days < 14 ? plural(days, 'day') : days < 70 ? `${Math.round(days / 7)} weeks` : `${Math.round(days / 30)} months`);

  // ------------------------------------------------------------ one stage

  function when(s, v) {
    const b = v.bond;
    if (s.state === 'past') return s.reachedAt ? day(s.reachedAt) : '';
    if (s.state === 'here') return s.reachedAt ? `Since ${day(s.reachedAt)}` : 'Where you are now';
    if (s.index !== b.level.index + 1) return `At ${s.at.toLocaleString()} points`;
    return b.pace ? `About ${howLong(b.pace.days)} at your pace` : `${(s.at - b.level.points).toLocaleString()} points to go`;
  }

  function unlock(u) {
    return h('p', { class: `us-unlock${u.open ? ' open' : ''}` },
      h('span', { class: 'sr-only', text: u.open ? 'Opened: ' : 'Opens here: ' }), u.text);
  }

  function moments(s) {
    const n = s.memories.length;
    if (!n) return null;
    const all = shown.has(s.index);
    return h('div', { class: 'us-mems-wrap' },
      h('ul', { class: 'us-mems', 'aria-label': `While you were ${s.name}` },
        ...(all ? s.memories : s.memories.slice(0, MEMS_SHOWN)).map(m => h('li', {},
          h('span', { class: 'us-mem-icon', 'aria-hidden': 'true', text: m.icon }),
          h('span', { class: 'us-mem-text' }, m.text, h('time', { datetime: new Date(m.at).toISOString(), text: day(m.at) }))))),
      n > MEMS_SHOWN ? h('button', { type: 'button', class: 'us-more', 'aria-expanded': String(all), dataset: { stage: String(s.index) } },
        all ? 'Fewer' : `All ${n} moments`) : null);
  }

  // Today's ways to get closer: each says what it's worth and what's left of its day.
  function closer(v) {
    const b = v.bond, l = b.level, e = b.earn, p = v.play, f = v.finds;
    const playing = !!p?.playing;
    const next = l.next !== null ? b.stages[l.index + 1].name : null;
    const left = k => Math.max(0, e[k].perDay - e[k].today);
    const gamesDone = !left('play');
    const way = (kind, icon, title, sub, pts, disabled = false) => h('button', {
      type: 'button', class: `us-way${kind === 'pet' ? ' go' : ''}`, dataset: { play: kind }, disabled,
      'aria-label': `${title}. ${sub}. Worth ${pts} toward your bond.`,
    },
    h('span', { class: 'us-way-icon', 'aria-hidden': 'true', text: icon }),
    h('span', { class: 'us-way-text' }, h('b', { text: title }), h('small', { text: sub })),
    h('em', { 'aria-hidden': 'true', text: `+${pts}` }));
    const hide = p?.hide.games ? `Found him ${plural(p.hide.found, 'time')}${p.hide.best ? `, best ${clock(p.hide.best)}` : ''}${p.hide.won ? `. He won ${p.hide.won}` : ''}` : 'He hides behind your windows';
    const fetch = p?.fetch.fetched ? `${plural(p.fetch.fetched, 'fetch', 'fetches')}${p.fetch.longest ? `, longest ${p.fetch.longest.toLocaleString()} px` : ''}` : 'Throw him a pebble';
    const dig = !f.canDig ? `Again in ${until(f.nextDigAt)}` : f.total ? `${plural(f.total, 'find')} dug up` : 'See what turns up';
    return h('div', { class: 'us-closer' },
      h('div', {
        class: 'us-progress', role: 'progressbar', 'aria-label': next ? `On the way to ${next}` : 'How close you are',
        'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(l.progress * 100)),
      }, h('i', { style: `--p:${l.progress}` })),
      next
        ? h('p', { class: 'us-points' }, h('b', { text: `${l.points.toLocaleString()} of ${l.next.toLocaleString()}` }), ` ${(l.next - l.points).toLocaleString()} more and you're ${next}`)
        : h('p', { class: 'us-points' }, h('b', { text: 'As close as it gets' })),
      h('h5', { class: 'us-closer-h', text: next ? 'Get closer today' : 'Spend time with him' }),
      h('div', { class: 'us-ways' },
        way('pet', '♥', 'Pet him', left('pet') ? `${left('pet')} more count today` : 'Today’s pets are all in', e.pet.points),
        way('hide', '🙈', 'Hide and seek', gamesDone ? 'Today’s games are all in' : hide, e.play.points, playing),
        way('fetch', '🎾', 'Fetch', gamesDone ? 'Today’s games are all in' : fetch, e.play.points, playing),
        way('dig', '⛏️', 'Dig', dig, e.find.points, playing || !f.canDig)),
      h('button', { type: 'button', class: 'btn ghost us-stop', dataset: { play: 'stop' }, hidden: !playing }, 'Stop playing'),
      h('p', { class: 'us-day', text: `Every day together adds ${e.day.points} on its own.${b.nextMilestone ? ` ${plural(b.nextMilestone - b.days, 'day')} to ${b.nextMilestone} days together.` : ''} Right-click him on the desktop for these too.` }));
  }

  function stage(s, v) {
    const here = s.state === 'here';
    const t = v.temperament;
    return h('li', {
      class: `us-stage us-${s.state}`,
      'aria-current': here ? 'step' : null,
      style: here ? `--p:${v.bond.level.progress}` : null,
    },
    h('div', { class: 'us-marker' },
      h('span', { class: 'us-dot', 'aria-hidden': 'true', text: s.icon }),
      h('div', { class: 'us-marker-text' }, h('h4', { class: 'us-name', text: s.name }), when(s, v) ? h('p', { class: 'us-when', text: when(s, v) }) : null)),
    here ? h('p', { class: 'us-temper' }, h('b', { text: `Your crab is ${t.name.toLowerCase()}.` }), ` ${t.blurb}`) : null,
    ...s.unlocks.map(unlock),
    here ? closer(v) : null,
    moments(s));
  }

  // ------------------------------------------------------------ the whole road

  function order(stages, wide) {
    if (wide) return stages;
    // Newest at the top: the stage you're heading for, where you are, then back to the start.
    return stages.filter(s => s.state !== 'ahead' || s.index === stages.find(x => x.state === 'here').index + 1).reverse();
  }

  // Everything a stage shows, as a key: the road is only rebuilt when it changes.
  const keyOf = (v, wide) => JSON.stringify([wide, [...shown], v.bond.stages, v.bond.level, v.bond.earn, v.bond.pace, v.bond.days, v.bond.nextMilestone,
    v.temperament?.name, v.play, v.finds.canDig, v.finds.total, v.finds.canDig ? 0 : Math.ceil((v.finds.nextDigAt - Date.now()) / 60000)]);

  function render(v, force = false) {
    if (!v?.bond?.stages) return;
    last = v;
    across = road.clientWidth >= WIDE_AT;
    const key = keyOf(v, across);
    if (!force && key === drawn) return;
    drawn = key;
    // A new view rebuilds the buttons; whichever had the keyboard keeps it.
    const had = road.contains(document.activeElement) ? { ...(/** @type {HTMLElement} */ (document.activeElement).dataset) } : null;
    road.classList.toggle('across', across);
    road.replaceChildren(...order(v.bond.stages, across).map(s => stage(s, v)));
    if (had?.play || had?.stage) {
      const sel = had.play ? `[data-play="${had.play}"]` : `[data-stage="${had.stage}"]`;
      /** @type {HTMLButtonElement | null} */
      let to = road.querySelector(sel);
      // A game starting turns the ways off: the keyboard goes to Stop instead of falling off the page.
      if (!to || to.disabled || to.hidden) to = road.querySelector('[data-play="stop"]:not([hidden])') || road.querySelector('[data-play]:not(:disabled):not([hidden])');
      to?.focus({ preventScroll: true });
    }
  }

  road.addEventListener('click', e => {
    const target = /** @type {HTMLElement} */ (e.target);
    const play = /** @type {HTMLElement | null} */ (target.closest('[data-play]'));
    if (play) {
      if (play.dataset.play === 'pet') SB.beachScene?.pet ? SB.beachScene.pet() : SB.api.critter.pet();
      else SB.play(play.dataset.play);
      return;
    }
    const more = /** @type {HTMLElement | null} */ (target.closest('.us-more'));
    if (!more) return;
    const i = Number(more.dataset.stage);
    if (shown.has(i)) shown.delete(i); else shown.add(i);
    render(last, true);
  });

  // Across or down, by the room there is.
  new ResizeObserver(() => { if (last && (road.clientWidth >= WIDE_AT) !== across) render(last); }).observe(road);

  SB.usRoad = { render };
})();
