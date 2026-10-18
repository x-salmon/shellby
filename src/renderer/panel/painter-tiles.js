/* Shellby panel — the Painter's start screen tiles (painter.js makes them):
   your drafts, the skins and things you could start from (a locked one shows,
   but can't be a starting point), a blank one, and the month's contest. */
'use strict';
(function () {
  const { h, api, state, $ } = SB;
  const G = window.ShellbyPixelGrid;

  /**
   * x: what painter.js shares: { mode(), items(), statusOf(kind, id), contestNow(),
   * startBlank(opts), startFromSkin(skin), startFromItem(item), openDraft(draft),
   * throwAway(draft), fill(el, ...kids) }.
   */
  SB.paintTiles = x => {
    const { mode, statusOf, contestNow, startBlank, startFromSkin, startFromItem, openDraft, throwAway, fill } = x;

    function renderContest() {
      const c = contestNow();
      const box = $('ptContest');
      box.hidden = !c;
      if (!c) return;
      fill(box,
        h('span', { 'aria-hidden': 'true', text: '🎨' }),
        h('span', { class: 'pt-contest-text' }, h('b', { text: c.title }), c.body ? ` ${c.body}` : ''),
        c.url ? h('button', { type: 'button', class: 'btn ghost slim-btn', onclick: () => api.openExternal(c.url) }, 'Rules') : null,
        h('button', { type: 'button', class: 'btn slim-btn', onclick: () => startBlank({ name: c.theme ? `${c.theme[0].toUpperCase()}${c.theme.slice(1)} crab` : '' }) }, 'Paint an entry'));
    }

    // A small picture of a drawing, for its tile.
    function artOf(m, d) {
      if (m === 'skin') return SB.Sprite.build(G.toSkin(d, { id: 'x' }), { fit: true, ink: true });
      return SB.Sprite.grid(G.rows({ ...d, frame: 0 }), d.palette, { ink: m === 'accessory' });
    }

    function pill(state_) {
      if (!state_) return null;
      return h('span', { class: `pt-pill ${state_}`, text: state_ === 'gallery' ? 'In the gallery' : 'In review' });
    }

    function draftTile(d) {
      return h('div', { class: 'pt-tile-wrap', style: 'position:relative;display:grid' },
        h('button', { type: 'button', class: 'pt-tile', dataset: { draft: d.id }, title: `Carry on with ${d.name || 'this drawing'}`, onclick: () => openDraft(d) },
          h('span', { class: 'pt-art' }, artOf(d.mode, d.doc)),
          h('span', { class: 'pt-tile-name', text: d.name || 'Untitled' }),
          h('span', { class: 'pt-tile-meta', text: SB.relTime(d.updatedAt) }),
          pill(statusOf(d.mode, d.id))),
        h('button', { type: 'button', class: 'pt-tile-x', title: 'Throw this draft away', 'aria-label': `Throw away the draft of ${d.name || 'Untitled'}`, onclick: () => throwAway(d) }, '✕'));
    }

    function blankTile() {
      return h('button', { type: 'button', class: 'pt-tile blank', dataset: { blank: mode() }, onclick: () => startBlank() },
        h('span', { class: 'pt-art big-plus', text: '+' }),
        h('span', { class: 'pt-tile-name', text: mode() === 'skin' ? 'A blank crab' : 'A blank one' }),
        h('span', { class: 'pt-tile-meta', text: `${G.MODES[mode()].start[0]} × ${G.MODES[mode()].start[1]}` }));
    }

    // Every skin you have: built in, your own, and pack skins you've unlocked.
    // A locked one shows (it's something to earn), but can't be a starting point.
    function skinTiles() {
      return state.skins.map(s => {
        const own = s.source === 'user';
        return h('button', {
          type: 'button', class: 'pt-tile', dataset: { skin: s.id }, disabled: s.locked ? true : null,
          title: s.locked ? `${s.name}: ${s.locked.text || 'locked'}` : own ? `Edit ${s.name}` : `Start from ${s.name}`,
          onclick: () => startFromSkin(s),
        },
        h('span', { class: 'pt-art' }, SB.sprite(s, { plain: true })),
        h('span', { class: 'pt-tile-name', text: s.name }),
        h('span', { class: 'pt-tile-meta', text: s.locked ? '🔒 locked' : own ? 'Edit' : 'Start from this one' }),
        own ? pill(statusOf('skin', s.id)) : null);
      });
    }

    function itemTiles() {
      return x.items().map(it => h('button', {
        type: 'button', class: 'pt-tile', dataset: { item: it.key }, disabled: it.locked ? true : null,
        title: it.locked ? `${it.name}: locked` : it.mine ? `Edit ${it.name}` : `Start from ${it.name}`,
        onclick: () => startFromItem(it),
      },
      h('span', { class: 'pt-art' }, it.item ? (mode() === 'effect' ? (() => { const p = SB.Sprite.poster(it.item.sprites); return SB.Sprite.grid(p.pixels, p.palette, { ink: !!it.item.ink }); })() : SB.Sprite.grid(it.item.pixels, it.item.palette, { ink: mode() === 'accessory' })) : h('span', { text: '🔒' })),
      h('span', { class: 'pt-tile-name', text: it.name }),
      h('span', { class: 'pt-tile-meta', text: it.locked ? '🔒 locked' : it.mine ? 'Edit' : 'Start from this one' }),
      it.mine ? pill(statusOf(mode(), it.key.split('/').pop())) : null));
    }

    return { renderContest, draftTile, blankTile, skinTiles, itemTiles, pill };
  };
})();
