/* Shellby panel — when Claude doesn't answer: the offer to ask the local model
   you set up for it (Settings → Local model) instead. Only your question goes,
   only when you press the button, and the answer is shown as the local
   model's, never put into Claude's conversation. Part of Tab (feed.js). */
'use strict';
(function () {
  const { h, api, state } = SB;
  const F = window.ShellbyFeedLogic;

  // The model asked instead, or null when that's off (main's local/model.js answerSettings).
  function answerModel() {
    const lm = state.settings?.localModel;
    if (!lm?.answers?.on) return null;
    return lm.answers.model || lm.model || null;
  }

  class LocalAnswers {
    // What the turn so far was, for refusalOf(): your question, Claude's last
    // words, how many steps it took, and whether the API stopped it.
    noteTurn(item) {
      if (item.kind === 'user' && !item.steerId) {
        // Only something you asked: a routine's or a queued prompt, or a /command, is never handed on.
        const yours = !item.routine && !item.queued && !/^\s*\//.test(item.text || '');
        this.turn = yours ? { ask: item.text || '', reply: '', tools: 0, refused: false } : null;
        return;
      }
      const t = this.turn;
      if (!t || item.sub) return;
      if (item.kind === 'text') t.reply = item.text || '';
      else if (item.kind === 'tool') t.tools++;
      else if (item.kind === 'refusal') t.refused = true;
      else if (item.kind === 'result' && item.refused) t.refused = true;
    }

    // At a turn's end: the offer, when Claude didn't answer and there's a model to ask.
    offerLocal(item, replay) {
      const turn = this.turn;
      this.turn = null; // once per question
      if (replay || item.interrupted || !turn) return;
      const why = F.refusalOf(turn);
      if (!why) return;
      const model = answerModel();
      // Not set up: only the API's certain stop says so, quietly, with the way to set it up.
      if (!model) {
        if (why !== 'api') return;
        // The switch only shows once a model is picked: before that, the model list is the first step.
        const first = state.settings?.localModel?.model ? 'localAnswersToggle' : 'localModelSelect';
        /** @type {any} */ (this).append(h('div', { class: 'home-mark local-instead-note' },
          h('span', { text: 'Claude didn\'t answer this.' }),
          h('button', { class: 'link-btn small', type: 'button', title: 'Set up a local model in Settings', onclick: () => SB.showSetting(first) }, 'Ask a model on your PC')));
        return;
      }
      this.renderLocalOffer(turn.ask, why, model);
    }

    renderLocalOffer(question, why, model) {
      // A spent offer takes no more room than it needs: the answer takes its
      // place, and Not now leaves one line you can still ask from.
      // ask and later only run once the card below exists.
      const later = () => {
        const line = h('div', { class: 'home-mark local-instead-note', dataset: { localOffer: 'later' } },
          h('span', { text: 'Claude didn\'t answer this.' }),
          h('button', { class: 'link-btn small', type: 'button', onclick: () => line.replaceWith(card) }, `Ask ${model}`));
        card.replaceWith(line);
      };
      const ask = async e => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        btn.textContent = `Asking ${model}…`;
        let r;
        try { r = await api.localAnswerInstead(question); } catch { r = { ok: false, error: 'Couldn\'t ask it.' }; }
        if (!r?.ok) {
          btn.disabled = false;
          btn.removeAttribute('aria-busy');
          btn.textContent = 'Try again';
          SB.toast(r?.error || 'Couldn\'t ask it.');
          return;
        }
        card.replaceWith(this.localAnswerEl(r));
      };
      const card = h('div', { class: 'ask suggest local-instead', role: 'group', 'aria-label': 'Ask your local model instead', dataset: { localOffer: 'open' } },
        h('div', { class: 'ask-head' },
          h('span', { class: 'ask-crab' }, SB.sprite()),
          h('div', {},
            h('div', { class: 'ask-title', text: 'Claude didn\'t answer this' }),
            h('div', { class: 'ask-sub', text: why === 'api'
              ? `The API's safety check stopped the reply. ${model} on this PC can be asked instead: only your question goes to it.`
              : `${model} on this PC can be asked instead: only your question goes to it, and its answer stays out of Claude's conversation.` }))),
        h('div', { class: 'ask-actions' },
          h('button', { class: 'btn allow', type: 'button', onclick: ask }, `Ask ${model}`),
          h('button', { class: 'btn ghost', type: 'button', onclick: later }, 'Not now')));
      /** @type {any} */ (this).append(card); // Tab's own (feed.js)
    }

    // The answer, always under the local model's name: it never passes for Claude's.
    localAnswerEl(r) {
      // Formatted like Claude's (escaped first, core.js), but its paths stay plain text:
      // an uncensored model's words aren't something to open with a click.
      const body = SB.renderMarkdownInto(h('div', { class: 'msg assistant local-instead-body' }), r.text);
      // Its name on a tag, like a visitor's badge: another model speaking in his chat.
      return h('div', { class: 'local-instead-answer', role: 'note', dataset: { localOffer: 'answered' }, 'aria-label': `Answer from ${r.model} on this PC, not from Claude` },
        h('div', { class: 'local-instead-head', title: `${r.model} took ${(r.ms / 1000).toFixed(1)} s on this PC` },
          h('span', { class: 'local-tag', text: r.model }),
          h('span', { class: 'local-instead-who', text: 'answered instead of Claude, on your PC' })),
        body);
    }
  }

  SB.extendTab(LocalAnswers);
})();
