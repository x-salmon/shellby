// Shellby panel: the character sheet on Trophies → Character (html/trophies.html).
// Draws what progression/character.js works out: his class and the nearest one,
// a diamond of the four stats, a card per stat with the ways to raise it, and
// every class there is. xp.js calls SB.characterSheet.render on each XP update.
(() => {
  const { h, $ } = SB;
  const SVG = 'http://www.w3.org/2000/svg';
  const R = 42;          // the diamond's radius; the viewBox is wider than tall, for the side labels
  const LABEL_R = 52;    // where the stat names sit
  const RINGS = 4;       // guide diamonds
  const WAYS = 3;        // ways to raise a stat, on its card
  const fmt = n => Number(n || 0).toLocaleString();
  // Shipping up, Rigour right, Craft down, Tidiness left: one stat per point.
  const AXES = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const ANCHOR = ['middle', 'start', 'middle', 'end'];

  const svg = (tag, attrs = {}) => {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  };
  const diamond = r => AXES.map(([x, y]) => `${(x * r).toFixed(2)},${(y * r).toFixed(2)}`).join(' ');

  // The diamond: guides, the class line while he has none, then his shape.
  function renderRadar(c) {
    const top = Math.max(10, ...c.stats.map(s => s.score));
    const parts = [];
    for (let i = 1; i <= RINGS; i++) parts.push(svg('polygon', { class: `xp-radar-ring${i === RINGS ? ' outer' : ''}`, points: diamond((R * i) / RINGS) }));
    for (const [x, y] of AXES) parts.push(svg('line', { class: 'xp-radar-axis', x1: 0, y1: 0, x2: x * R, y2: y * R }));
    if (c.cls.id === 'wanderer') parts.push(svg('polygon', { class: 'xp-radar-goal', points: diamond((R * c.classAt) / top) }));
    const pts = c.stats.map((s, i) => [AXES[i][0] * R * (s.score / top), AXES[i][1] * R * (s.score / top)]);
    if (c.stats.some(s => s.score > 0)) {
      parts.push(svg('polygon', { class: 'xp-radar-shape', points: pts.map(p => p.map(n => n.toFixed(2)).join(',')).join(' ') }));
      pts.forEach(([x, y], i) => parts.push(svg('rect', { class: `xp-radar-dot${c.cls.stats.includes(c.stats[i].id) ? ' top' : ''}`, x: x - 2, y: y - 2, width: 4, height: 4 })));
    }
    c.stats.forEach((s, i) => {
      const t = svg('text', { class: 'xp-radar-label', x: AXES[i][0] * LABEL_R, y: AXES[i][1] * LABEL_R + (AXES[i][1] ? AXES[i][1] * 2 + 2 : 3), 'text-anchor': ANCHOR[i] });
      t.textContent = `${s.short} ${s.value}`;
      parts.push(t);
    });
    const el = $('xpRadarSvg');
    el.setAttribute('aria-label', `Stat shape: ${c.stats.map(s => `${s.name} ${s.value}`).join(', ')}`);
    el.replaceChildren(...parts);
  }

  // A card per stat: value, the bar to its next point, what feeds it and how.
  function renderStats(c, ways) {
    $('xpStats').replaceChildren(...c.stats.map(s => {
      const next = s.next ? `${fmt(s.next)} XP to ${s.value + 1}` : 'Maxed out';
      const aim = c.goal?.stat === s.id;
      const mine = ways.filter(w => s.kinds.includes(w.kind)).sort((a, b) => b.xp - a.xp).slice(0, WAYS);
      return h('li', { class: ['xp-stat', c.cls.stats.includes(s.id) ? 'top' : '', aim ? 'aim' : ''].filter(Boolean).join(' '), 'data-stat': s.id },
        h('div', { class: 'xp-stat-head' },
          h('span', { class: 'xp-stat-icon', 'aria-hidden': 'true', text: s.icon }),
          h('span', { class: 'xp-stat-name', text: s.name }),
          h('span', { class: 'xp-stat-gain', text: s.gain ? `+${s.gain} this week` : '' }),
          h('b', { class: 'xp-stat-value', text: String(s.value) })),
        h('span', { class: 'xp-stat-bar', role: 'progressbar', 'aria-label': `${s.name}: ${next}`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(s.progress * 100)) },
          h('i', { style: `transform:scaleX(${s.progress.toFixed(3)})` })),
        h('p', { class: 'xp-stat-next' }, h('span', { text: next }), aim ? h('span', { class: 'xp-stat-aim', text: `${c.goal.icon} ${c.goal.name} in ${fmt(c.goal.xp)} XP` }) : null),
        h('p', { class: 'xp-stat-what', text: s.what }),
        mine.length ? h('ul', { class: 'xp-stat-ways', 'aria-label': `Ways to raise ${s.name}` }, ...mine.map(w => h('li', {},
          h('span', { text: w.text }), h('b', { text: `+${w.xp}` })))) : null);
    }));
  }

  // Every class: the one he is, the ones he's been, the rest with their recipe.
  function renderRoster(c) {
    const icon = id => c.stats.find(s => s.id === id)?.icon || '';
    const met = c.roster.filter(x => x.seen).length;
    $('xpRosterCount').textContent = `${met} of ${c.roster.length} found`;
    $('xpRoster').replaceChildren(...c.roster.map(x => {
      const recipe = x.stats.length === c.stats.length ? 'All four, close together' : x.stats.map(id => c.stats.find(s => s.id === id)?.name).join(' + ');
      const state = x.current ? 'He is this class now' : x.seen ? 'He has been this class' : 'Not yet';
      return h('li', { class: ['xp-cls', x.current ? 'current' : '', x.seen ? 'seen' : 'locked'].filter(Boolean).join(' '), 'data-class': x.id, title: `${x.name}: ${x.blurb} ${state}.` },
        h('span', { class: 'xp-cls-icon', 'aria-hidden': 'true', text: x.icon }),
        h('span', { class: 'xp-cls-name', text: x.name }),
        h('span', { class: 'xp-cls-recipe', 'aria-hidden': 'true', text: x.stats.map(icon).join('') }),
        h('span', { class: 'sr-only', text: `${recipe}. ${state}.` }));
    }));
  }

  function renderGoal(c) {
    const g = c.goal;
    const stat = g && c.stats.find(s => s.id === g.stat);
    $('xpGoal').hidden = !g;
    $('xpGoal').replaceChildren(...(g ? [
      h('span', { class: 'xp-goal-label', text: c.cls.id === 'wanderer' ? 'Quickest class' : 'Nearest class' }),
      h('b', { text: `${g.icon} ${g.name}` }),
      h('span', { text: `${fmt(g.xp)} more ${stat?.name || ''} XP` }),
    ] : []));
  }

  function render(c, ways) {
    $('xpClassIcon').textContent = c.cls.icon;
    $('xpClassName').textContent = c.cls.name;
    $('xpClassBlurb').textContent = c.cls.blurb;
    $('xpSheetWeek').textContent = c.weekCls && c.weekCls.id !== c.cls.id ? `· played as a ${c.weekCls.name} this week` : '';
    renderGoal(c);
    renderRadar(c);
    renderStats(c, ways || []);
    renderRoster(c);
  }

  SB.characterSheet = { render };
})();
