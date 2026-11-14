/* Shellby panel — Notes, the open note: its text (click to edit), what Claude
   said when you asked about it, its next step and the other ways to run it,
   and beside it the story so far and the keys. Draws only: notes.js owns the
   state and passes what each button does in `ctx`. Pure decisions are
   notes-logic.js. */
'use strict';
(function () {
  const { h } = SB;
  const L = window.ShellbyNotesLogic;

  const TITLES = {
    'plan-claude': 'Plan what Claude suggested, in a copy on its own branch. It waits in the box for you to read first',
    plan: 'Have Claude plan this in a copy on its own branch. Nothing changes until you approve the plan',
    build: 'Send this to Claude as written, in a copy on its own branch, in your current mode',
    ask: 'Ask Claude if this is a good idea. It reads and reports back, and changes nothing',
    done: 'Tick it off. It folds away under Done',
  };
  const NEXT = { ask: 'Ask Claude', plan: 'Plan it', 'plan-claude': "Plan Claude's version", build: 'Build it', done: 'Tick it off' };
  const KEYS = [['J K', 'Next and previous note'], ['P', 'Plan it as written'], ['B', 'Build'], ['A', 'Ask'], ['X', 'Done, or not done'], ['E', 'Edit the note']];

  const when = at => (at ? SB.relTime(at) : '');

  /**
   * The open note into `el`.
   * ctx: { narrow, editing, editor(), onBack(), onEdit(), onRun(action, anchor),
   *        onDone(done), onPin(), onMenu(anchor), onOpenRun(run) }
   */
  function render(el, n, ctx) {
    el.replaceChildren(
      top(n, ctx),
      h('div', { class: 'nd-body' },
        h('div', { class: 'nd-main' }, text(n, ctx), meta(n), reply(n, ctx), buttons(n, ctx)),
        rail(n, ctx)));
  }

  /** Nothing open: a line saying what goes here. */
  function empty(el, line) {
    el.replaceChildren(h('p', { class: 'nd-empty', text: line }));
  }

  function top(n, ctx) {
    return h('div', { class: 'nd-top' },
      ctx.narrow ? h('button', { class: 'link-btn nd-back', type: 'button', 'data-focus': 'back', onclick: ctx.onBack }, '← All notes') : null,
      h('span', { class: 'nd-spacer' }),
      n.done ? null : h('button', { class: 'btn slim-btn ghost nd-pin', type: 'button', 'data-focus': 'pin', 'aria-pressed': String(n.pinned), onclick: ctx.onPin }, n.pinned ? 'Unpin' : 'Pin to top'),
      h('button', { class: 'btn slim-btn ghost nd-tick', type: 'button', 'data-focus': 'tick', 'aria-pressed': String(n.done), title: n.done ? 'Put it back on the list' : TITLES.done,
        onclick: () => ctx.onDone(!n.done) }, n.done ? 'Not done yet' : 'Done'),
      h('button', { class: 'icon-btn note-more', type: 'button', 'data-focus': 'more', title: 'More', 'aria-label': 'More for this note', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
        onclick: e => ctx.onMenu(e.currentTarget) }, SB.icon(SB.ICONS.more, { width: 2.6 })));
  }

  function text(n, ctx) {
    if (ctx.editing) return ctx.editor();
    return h('div', {
      class: 'nd-text note-text', 'data-focus': 'text', text: n.text, title: 'Click to edit', tabindex: '0', role: 'button',
      onclick: ctx.onEdit,
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); ctx.onEdit(); } },
    });
  }

  function meta(n) {
    const noted = when(n.createdAt);
    return h('p', { class: 'nd-meta' },
      h('span', { text: n.from === 'claude' ? `Claude noted this in a conversation${noted ? ` ${noted}` : ''}` : `You noted this${noted ? ` ${noted}` : ''}` }),
      n.done ? h('span', { class: 'nd-meta-done', text: 'Done' }) : null);
  }

  // What Claude said when asked: its verdict and words, or that it hasn't answered yet.
  function reply(n, ctx) {
    const last = n.runs?.[0];
    const answer = L.lastAnswer(n);
    if (last?.kind === 'ask' && last !== answer) {
      return h('div', { class: 'nd-reply waiting' },
        h('p', { text: "Claude hasn't answered this yet." }),
        h('button', { class: 'link-btn', type: 'button', onclick: () => ctx.onOpenRun(last) }, 'Open the conversation'));
    }
    if (!answer) return null;
    const body = L.answerBody(answer.answer, answer.verdict);
    return h('div', { class: `nd-reply${answer.verdict ? ` v-${answer.verdict}` : ''}` },
      h('div', { class: 'nd-reply-head' },
        h('b', { text: "Claude's answer" }),
        h('span', { text: when(answer.at) }),
        answer.tabId ? h('button', { class: 'link-btn', type: 'button', onclick: () => ctx.onOpenRun(answer) }, 'Open the conversation') : null),
      answer.verdict ? h('h3', { class: 'nd-verdict', text: L.VERDICT[answer.verdict] }) : null,
      body ? SB.linkifyPaths(SB.renderMarkdownInto(h('div', { class: 'msg assistant nd-answer' }), body)) : null,
      answer.answer ? null : h('p', { class: 'nd-answer-missing', text: 'Only the verdict was kept for this one. Open the conversation to read why.' }));
  }

  function buttons(n, ctx) {
    return h('div', { class: 'nd-actions' },
      ...L.actions(n).map(a => h('button', {
        class: `btn${a.primary ? ' primary' : ''} note-run note-${a.id}`, type: 'button', title: TITLES[a.id], 'data-focus': a.id, // P, B and A press plan, build and ask by this (notes.js); Claude's version has a button only
        onclick: e => (a.id === 'done' ? ctx.onDone(true) : ctx.onRun(a, e.currentTarget)),
      }, a.label)),
      h('p', { class: 'nd-hint', text: 'Plan and Build work in a copy on its own branch. Ask only reads.' }));
  }

  function rail(n, ctx) {
    const next = L.nextStep(n);
    return h('aside', { class: 'nd-rail', 'aria-label': 'So far' },
      h('h3', { text: 'So far' }),
      h('ol', { class: 'nd-story' },
        ...L.story(n).map(s => h('li', { class: s.kind ? `k-${s.kind}` : 'k-noted' },
          s.tabId
            ? h('button', { class: 'nd-story-link', type: 'button', title: 'Open that conversation', onclick: () => ctx.onOpenRun(s) }, s.label)
            : h('b', { text: s.label }),
          h('span', { text: when(s.at) }))),
        next ? h('li', { class: 'next' }, h('b', { text: NEXT[next] }), h('span', { text: 'Next' })) : null),
      h('h3', { text: 'Keys' }),
      h('dl', { class: 'nd-keys' }, ...KEYS.flatMap(([k, what]) => [h('dt', {}, h('kbd', { text: k })), h('dd', { text: what })])));
  }

  SB.noteDetail = { render, empty };
})();
