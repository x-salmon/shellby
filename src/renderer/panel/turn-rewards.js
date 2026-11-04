/* Shellby panel — what a turn earned, as a card under it (src/main/turn-rewards.js).
 *
 * Finds, catches, stickers, trophies, quests and levels used to live only in
 * their own rooms and a passing toast; this puts them where the work is. Each
 * row opens what it's about: a catch with a battle replays it, the rest open
 * their screen. The card is a transcript item, so History replays it too. */
'use strict';
(function () {
  const { h, api } = SB;

  const KINDS = new Set(['level', 'class', 'find', 'catch', 'sticker', 'trophy', 'quest']);
  const GO = new Set(['trophies', 'finds', 'bugdex', 'stickers']);
  const str = (v, max = 120) => (typeof v === 'string' ? v.slice(0, max) : '');

  function open(e) {
    api.featureActed?.('reward-opened'); // Settings → What you use
    if (e.kind === 'catch' && e.battle && SB.battleOf?.(e.battle)) return SB.openBattle(e.battle);
    if (GO.has(e.go)) SB.setView(e.go);
  }

  function row(e) {
    const label = e.kind === 'catch' && e.battle && SB.battleOf?.(e.battle) ? 'Watch' : 'See it';
    return h('li', { class: `reward-row reward-${e.kind}` },
      h('span', { class: 'reward-icon', 'aria-hidden': 'true', text: str(e.icon, 8) }),
      h('span', { class: 'reward-what' }, h('b', { text: str(e.title) }), e.text ? h('span', { class: 'reward-note', text: ` ${str(e.text)}` }) : null),
      GO.has(e.go) ? h('button', { type: 'button', class: 'link-btn small', text: label, onclick: () => open(e) }) : null);
  }

  /** The card for a `rewards` item, or null when it carries nothing to show. */
  SB.renderRewards = item => {
    const items = (Array.isArray(item?.items) ? item.items : []).filter(e => e && KINDS.has(e.kind));
    if (!items.length) return null;
    const xp = Math.max(0, Math.floor(Number(item.xp) || 0));
    const more = Math.max(0, Math.floor(Number(item.more) || 0));
    return h('div', { class: 'home-mark reward-card', role: 'group', 'aria-label': 'What this task earned' },
      h('div', { class: 'reward-head' }, h('b', { text: 'This one earned' }), xp ? h('span', { class: 'reward-xp', text: `+${xp} XP` }) : null),
      h('ul', { class: 'reward-list' }, ...items.map(row)),
      more ? h('span', { class: 'reward-note', text: `and ${more} more` }) : null);
  };
})();
