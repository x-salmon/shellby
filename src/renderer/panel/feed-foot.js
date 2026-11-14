/* Shellby panel — the footer under each finished turn. Part of Tab (feed.js).
   One bar for the whole context window (earlier replies, then this one), and
   a line under it: what happened on the left, how full the conversation is on
   the right. Opened, it says the rest in plain words. The words and numbers
   are feed-logic.js sounding(); this file only builds them. */
'use strict';
(function () {
  const { h } = SB;
  const F = window.ShellbyFeedLogic;
  let footIds = 0;

  // The bar: earlier replies, this one, and after a compact the room it freed.
  function footBar(v) {
    const b = v.bar;
    if (!b) return null;
    const now = b.past + b.added;
    const el = h('div', {
      class: 'tf-bar', role: 'meter', 'aria-label': 'Conversation used',
      'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(now), 'aria-valuetext': v.meter,
    },
    b.freedTo ? h('i', { class: 'tf-freed' }) : null,
    b.past ? h('i', { class: 'tf-past' }) : null,
    b.added ? h('i', { class: 'tf-added' }) : null,
    h('i', { class: 'tf-mark', title: 'Past here, Shellby asks you to make room' }));
    el.style.setProperty('--past', `${b.past}%`);
    el.style.setProperty('--added', `${b.added}%`);
    if (b.freedTo) el.style.setProperty('--freed', `${b.freedTo}%`);
    return el;
  }

  // Effort as five small bars, the level's count lit. Plain: colour is the context's.
  const footEffort = e => (e ? h('span', { class: 'tf-effort', role: 'img', 'aria-label': `${e.name} effort`, title: `${e.name[0].toUpperCase()}${e.name.slice(1)} effort` },
    Array.from({ length: e.of }, (_, i) => h('i', { class: i < e.lit ? 'on' : null }))) : null);

  // "7% full +3 · 44k", or just the tokens for a turn from before Shellby kept the context.
  function footRoom(v) {
    if (!v.full && !v.tokens) return null;
    return h('span', { class: 'tf-room' },
      v.full ? h('span', { class: 'tf-full', text: v.full }) : null,
      v.change ? h('span', { class: `tf-change is-${v.change.kind}`, text: v.change.text }) : null,
      v.tokens ? h('span', { class: 'tf-tokens', text: v.full ? `· ${v.tokens}` : `${v.tokens} tokens` }) : null);
  }

  class TurnFoot {
    // The footer for a result item. replay: drawn from History, so it stays
    // still and offers no Compact (an old turn's offer would be stale).
    turnFoot(item, replay) {
      const tab = /** @type {any} */ (this); // a Tab once SB.extendTab copies this across
      const v = F.sounding(item, { compact: SB.compact, duration: SB.duration });
      const turnId = tab.lastTurnId;
      const cls = ['meta', 'turn-foot', `is-${v.state}`, v.level ? `is-${v.level}` : '', replay ? '' : 'is-live',
        v.state === 'failed' ? 'bad' : '', v.state === 'waiting' ? 'waiting' : ''].filter(Boolean).join(' ');
      const foot = h('div', { class: cls, title: v.title, dataset: turnId ? { turn: turnId } : {} });

      const summary = [
        h('span', { class: 'tf-what' },
          h('span', { class: 'tf-state', text: v.word }),
          v.soft.length ? h('span', { class: 'tf-soft', text: `· ${v.soft.join(' · ')}` }) : null,
          footEffort(v.effort)),
        footRoom(v),
      ];
      // A reply you might want to take somewhere else: a new tab that remembers
      // everything up to here, with the files as this turn left them. It sits in
      // the opened part, so the line always runs the full width.
      const fork = turnId && item.anchor ? h('button', { class: 'meta-branch', type: 'button', title: 'A new tab that carries on from this reply, leaving this one as it is', onclick: () => SB.openBranch(tab, turnId, 'after') }, SB.forkIcon(), 'Branch from here') : null;

      let more = null;
      let row;
      if (v.details) {
        const id = `tf-more-${++footIds}`;
        // What every turn carries before your words, once the Lean tab has measured it ("setup ~14k/turn").
        const setup = SB.lean?.line?.() || '';
        more = h('div', { class: 'tf-more', id, hidden: true },
          h('p', { text: v.details }),
          setup ? h('p', { class: 'tf-setup', text: `${setup}: what every message carries before your words. Toolbox → Lean lists it.` }) : null,
          fork ? h('div', { class: 'tf-acts' }, fork) : null);
        row = h('button', { class: 'tf-open', type: 'button', 'aria-expanded': 'false', 'aria-controls': id, title: fork ? 'What this turn cost, and branching from here' : 'What this turn cost',
          onclick: () => this.toggleFoot(foot) }, summary);
      } else {
        row = h('span', { class: 'tf-open' }, summary);
      }

      // Past 60% (and again past 80%), the newest footer offers to make room.
      if (!replay) tab.footAct?.remove();
      const act = !replay && v.level && v.state !== 'failed' ? h('button', {
        class: 'tf-act', type: 'button', title: 'Claude sums up the conversation so far and carries on in the room it frees',
        // Busy: compactTab says to let him finish, and the offer stays for after.
        onclick: e => {
          const idle = !tab.busy;
          SB.compactTab(tab);
          if (!idle) return;
          /** @type {HTMLElement} */ (e.currentTarget).remove();
          SB.$('input')?.focus(); // the button's gone: focus goes where the compact shows
        },
      }, v.level === 'crowded' ? 'Make room' : 'Compact') : null;
      if (!replay) tab.footAct = act;

      foot.append(...[footBar(v), h('div', { class: 'tf-row' }, row, act, more ? null : fork), more].filter(x => x !== null));
      return foot;
    }

    // Open or close a footer's details. open: force one way (the context menu's "Show this turn").
    toggleFoot(foot, open) {
      const btn = foot.querySelector('.tf-open');
      const more = foot.querySelector('.tf-more');
      if (!btn || !more) return;
      const next = typeof open === 'boolean' ? open : btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(next));
      more.hidden = !next;
    }
  }

  SB.extendTab(TurnFoot);
})();
