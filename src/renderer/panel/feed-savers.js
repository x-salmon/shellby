/* Shellby panel — the inline savers' cards, each in its place in the chat
   feed: a message waiting on a card below it, the card offering Haiku for a
   small message (savers.js), the nudge under a repeated big read with the
   Lean tab's one-tap fix (main's read-nudge.js), and the dashed line that
   offers a fresh tab where the topic turned (handoff.js). Which may show
   when is savers-logic.js. Part of Tab (feed.js). */
'use strict';
(function () {
  const { h, api, state } = SB;
  const S = window.ShellbySavers;

  /** The one line a card folds into, in the feed's quiet voice. */
  const foldEl = (text, ...more) => h('div', { class: 'home-mark saver-fold', role: 'note' }, h('span', { text }), ...more);
  /** A card gives way to something smaller: the host that sized it goes with it. */
  const giveWay = (card, el) => (card.parentElement?.classList.contains('saver-host') ? card.parentElement : card).replaceWith(el);

  class FeedSavers {
    // ------------------------------------------------------------ a message waiting on a card
    /** What you sent, dimmed, where it will sit once it goes; the card it waits on comes under it. */
    renderPendingSend(text, attachments) {
      const self = /** @type {any} */ (this);
      self.stuck = true;
      return self.append(h('div', { class: 'msg user pending', 'aria-label': 'Waiting to be sent' }, text,
        attachments?.length ? h('div', { class: 'att-list' }, SB.attachmentChips(attachments)) : null));
    }

    /** A card in its host, at the end of the feed. */
    hostCard(card) {
      const self = /** @type {any} */ (this);
      self.stuck = true;
      self.append(h('div', { class: 'saver-host' }, card));
      return card;
    }

    /** "on Haiku" beside a message that ran on a cheaper model; one sent by an "always" offers Undo. */
    modelTag(item, replay) {
      const name = S.modelName(item.model);
      const always = item.modelBy === 'always';
      const kind = S.CLASS_WORDS[item.modelCls] || 'messages like this';
      const undo = always && !replay && item.modelCls
        ? h('button', { class: 'link-btn small model-tag-undo', type: 'button', title: `Stop sending ${kind} to ${name} by themselves. The card asks again next time.`, onclick: async e => {
          const btn = /** @type {HTMLButtonElement} */ (e.currentTarget);
          btn.disabled = true;
          const { [item.modelCls]: _gone, ...rest } = state.settings?.modelAlways || {};
          const r = await api.setSettings({ modelAlways: rest }).catch(() => null);
          if (!r?.settings) { btn.disabled = false; return SB.toast("Couldn't change that."); }
          state.settings = r.settings;
          btn.replaceWith(h('span', { class: 'model-tag-undone', text: 'undone: the card asks next time' }));
        } }, 'Undo')
        : null;
      return h('div', { class: 'routine-tag model-tag', title: always ? `Went to ${name} by itself: you chose "always" for ${kind}.` : `Went to ${name} for this one turn, as you picked. The tab is back on its own model.` },
        `↘ on ${name}`, always ? ` · always for ${kind}` : ' · this one', undo);
    }

    // ------------------------------------------------------------ a cheaper model for a small message
    /**
     * The card under a small message, before Claude starts (savers.js shows and
     * settles it). sug: main's answer (model-pick.js words); onPick(answer):
     * 'cheaper' | 'keep' | 'always' | 'off'. -> the card; its .saver-wait holds the countdown.
     */
    renderModelCard(sug, { onPick }) {
      const w = sug.words;
      const max = Math.max(w.current.pct, w.cheaper.pct, 0.1);
      const bar = (pct, lit) => h('span', { class: `saver-bar${lit ? ' lit' : ''}`, role: 'img', 'aria-label': `about ${pct}% of the 5-hour window` }, h('i', { style: `--w:${Math.max(3, Math.round((100 * pct) / max))}%` }));
      const more = h('div', { class: 'saver-always', hidden: true },
        h('button', { class: 'btn ghost slim-btn saver-always-yes', type: 'button', onclick: () => onPick('always') }, `Always use ${w.cheaper.name} for ${w.always.replace(/^Always for /, '')}`),
        h('button', { class: 'btn ghost slim-btn saver-off', type: 'button', title: 'Settings → Limits turns them back on', onclick: () => onPick('off') }, 'Stop suggesting cheaper models'));
      const card = h('section', { class: 'saver-card saver-ask', role: 'group', 'aria-label': 'Which model for this message', dataset: { saver: 'model' } },
        h('h3', { class: 'saver-title', text: w.title }),
        h('p', { class: 'saver-text', text: w.body }),
        h('div', { class: 'saver-cmp' },
          h('span', { class: 'saver-name' }, w.current.name, h('span', { class: 'muted', text: ' (this tab)' })), bar(w.current.pct, false), h('b', { text: `~${w.current.pct}%` }),
          h('span', { class: 'saver-name', text: w.cheaper.name }), bar(w.cheaper.pct, true), h('b', { text: `~${w.cheaper.pct}%` })),
        h('div', { class: 'saver-acts' },
          h('button', { class: 'btn glass slim-btn saver-cheaper', type: 'button', onclick: () => onPick('cheaper') }, `Use ${w.cheaper.name} for this one`),
          h('button', { class: 'btn slim-btn saver-keep', type: 'button', onclick: () => onPick('keep') }, `Keep ${w.current.name}`),
          h('button', { class: 'btn ghost slim-btn saver-always-btn', type: 'button', 'aria-expanded': 'false', onclick: e => {
            more.hidden = !more.hidden;
            /** @type {HTMLElement} */ (e.currentTarget).setAttribute('aria-expanded', String(!more.hidden));
          } }, w.always, h('span', { class: 'saver-caret', 'aria-hidden': 'true', text: '▾' })),
          h('span', { class: 'saver-wait', role: 'timer' }, h('span', { class: 'saver-wait-bar', 'aria-hidden': 'true' }, h('i')), h('span', { class: 'saver-wait-text' }))),
        more);
      return this.hostCard(card);
    }

    /** The one-line note a model card folds into when nothing was picked in time. */
    foldModelCard(card, modelName) { giveWay(card, foldEl(S.foldLine('model', { modelName }))); }

    /** The card is answered: gone. */
    dropCard(card) { (card.parentElement?.classList.contains('saver-host') ? card.parentElement : card).remove(); }

    // ------------------------------------------------------------ a repeated big read
    /**
     * The card under a Read step, mid-turn (main's wiring/read-nudge.js item):
     * the count, the drafted fix with its diff, and the choice. The turn runs
     * on around it; foldSavers() folds it when the reply comes unanswered.
     */
    renderReadNudge(item) {
      const self = /** @type {any} */ (this);
      // One inline card at a time: a nudge already up, or a card holding a message, keeps the floor.
      if (self.saver || self.el.querySelector('.nudge-card')) return null;
      const w = item.words || {};
      const fix = item.fix;
      const step = self.tools.get(item.toolId);
      const acts = h('div', { class: 'saver-acts' });
      const card = h('section', { class: 'saver-card nudge-card', role: 'group', 'aria-label': 'A repeated read', dataset: { saver: 'nudge', rel: item.rel, tokens: SB.compact(item.tokens) } },
        h('div', { class: 'nudge-mark' }, h('i', { 'aria-hidden': 'true', text: '!' }),
          h('span', {}, w.lead || '', h('b', { text: w.nth || '' }), w.mid || '', h('code', { text: item.rel }), w.tail || '')),
        h('div', { class: 'nudge-main' }, h('p', { class: 'saver-text', text: w.what }), fix ? SB.leanFixes.diffBox(fix) : null),
        h('div', { class: 'nudge-side' },
          h('p', { class: 'saver-text' }, h('b', { text: 'This conversation keeps the read' }), ' it already did. The change starts with the next message.'),
          h('p', { class: 'saver-text' }, h('b', { text: 'One click to undo' }), `, here or on the Lean tab. Shellby never ${fix?.kind === 'deny-read' ? 'adds a rule' : 'writes a line'} by itself.`)),
        acts);
      // While a confirm window is up the card stays put, so Apply's Undo line has somewhere to land.
      const busy = on => {
        card.dataset.busy = on ? '1' : '';
        for (const b of acts.querySelectorAll('button')) /** @type {HTMLButtonElement} */ (b).disabled = on;
      };
      const apply = async () => {
        busy(true);
        let r;
        try { r = await api.leanFixApply(fix.id); } catch { r = null; }
        if (r?.ok) return giveWay(card, this.appliedLine(fix, r));
        busy(false);
        if (r?.cancelled) return;
        SB.toast(r?.error || "Couldn't apply that.", { ms: 8000 });
        if (r?.changed) giveWay(card, foldEl(`${SB.basename(fix.file)} changed since this was drafted. The Lean tab drafts it again.`));
      };
      const wave = async (answer, said) => {
        busy(true);
        const r = await api.nudgeAnswer({ tabId: self.id, rel: item.rel, answer }).catch(() => null);
        this.dropCard(card);
        if (said) SB.toast(r?.ok ? said : (r?.error || "Couldn't keep that."), { ms: 5000 });
      };
      acts.append(
        h('button', { class: 'btn glass slim-btn nudge-apply', type: 'button', disabled: !fix, title: 'Shellby shows the change in the confirm window first, and Undo puts the file back', onclick: apply }, 'Apply to this project'),
        h('button', { class: 'btn ghost slim-btn nudge-not', type: 'button', title: 'Nothing changes; this file rests for a week', onclick: () => wave('not', '') }, 'Not this one'),
        h('button', { class: 'btn ghost slim-btn nudge-never', type: 'button', title: 'Nothing changes, and Shellby never brings this file up again', onclick: () => wave('never', `Shellby won't bring up ${item.rel} again.`) }, 'Never for this file'),
        w.saves ? h('span', { class: 'saver-fine', text: w.saves }) : null);
      if (!step) return this.hostCard(card);
      step.classList.add('hot');
      // Under its step; the feed follows only if you were at the end.
      const follow = self.stuck || self.distanceFromEnd() < 140;
      step.after(h('div', { class: 'saver-host' }, card));
      if (follow && self.isShown) self.scrollToEnd();
      return card;
    }

    /** After Apply: one line with Undo, in the card's place. */
    appliedLine(fix, r) {
      const name = SB.basename(r.file || fix.file);
      const line = foldEl(`Added ${fix.kind === 'deny-read' ? fix.rule : 'a line about the file'} to ${name}. New conversations in this project skip the read.`);
      const undo = h('button', { class: 'link-btn small nudge-undo', type: 'button', title: 'Puts the file back as it was, if nothing else changed it since', onclick: async () => {
        undo.disabled = true;
        const u = await api.leanFixUndo(r.undoId).catch(() => null);
        if (!u?.ok) { undo.disabled = false; return SB.toast(u?.error || "Couldn't put it back.", { ms: 6000 }); }
        line.replaceWith(foldEl(`${name} is back as it was.`));
      } }, 'Undo');
      line.append(undo);
      return line;
    }

    // ------------------------------------------------------------ a fresh tab where the topic turned
    /**
     * The dashed line and its card (handoff.js shows and settles it). o: { pct,
     * saved, summary: { text, tokens }, contextTokens, title, hasMessage };
     * on.start / on.stay. -> { el, rule, card, editor }.
     */
    renderHandoffDivider(o, on) {
      const self = /** @type {any} */ (this);
      const count = h('span', { class: 'cut-count', text: `${SB.compact(o.summary.tokens)} tokens` });
      const editor = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'cut-box', rows: 6, spellcheck: 'false', 'aria-label': 'The summary the fresh tab starts with. Edit it before you start.',
        oninput: () => { count.textContent = `${SB.compact(Math.ceil(editor.value.length / 4))} tokens`; } }));
      editor.value = o.summary.text;
      const here = Number.isFinite(o.contextTokens) && o.contextTokens > 0 ? o.contextTokens : null;
      const num = (n, label, after = false) => h('span', { class: 'cut-num' }, h('span', { class: `cut-n${after ? ' after' : ''}`, text: n }), h('small', { text: label }));
      const goes = o.hasMessage ? 'the message below goes with it' : "what's in the box goes with it";
      const sum = SB.compact(o.summary.tokens);
      const words = here
        ? `Each message you send carries the whole thread, ${SB.compact(here)} tokens. A fresh tab from this line carries the summary instead, about ${sum} plus Claude Code's setup, and ${goes}. This tab stays as it is.`
        : `A fresh tab from this line carries Shellby's summary instead of the whole thread, about ${sum} tokens plus Claude Code's setup, and ${goes}. This tab stays as it is.`;
      const rule = h('div', { class: 'cut-rule' }, h('span', { text: `New topic · ${Number.isFinite(o.pct) ? `${o.pct}% full` : 'filling up'}` }));
      const card = h('section', { class: 'saver-card cut-card', 'aria-label': 'Start fresh from here' },
        h('h3', { class: 'saver-title', text: `Everything above is “${o.title || 'this conversation'}”. From this line on, a fresh tab.` }),
        h('div', { class: 'cut-main' },
          h('p', { class: 'saver-text', text: words }),
          here ? h('div', { class: 'cut-per' },
            num(SB.compact(here), 'per message, here'),
            num(sum, 'per message, fresh', true),
            Number.isFinite(o.saved) && o.saved > 0 ? num(`${SB.compact(o.saved)} less`, 'on every message after this one', true) : null) : null),
        h('div', { class: 'cut-sum' }, h('div', { class: 'cut-lbl' }, 'Carried over · edit it here', count), editor),
        h('div', { class: 'saver-acts' },
          h('button', { class: 'btn glass slim-btn cut-start', type: 'button', onclick: on.start }, 'Start fresh from here'),
          h('button', { class: 'btn slim-btn cut-stay', type: 'button', onclick: on.stay }, 'Stay in this one'),
          h('span', { class: 'saver-fine', text: 'If you stay, the line stays too, so you can come back to it.' })));
      const el = h('div', { class: 'cut-divider', dataset: { saver: 'handoff' } }, rule, card);
      self.stuck = true;
      self.append(el);
      return { el, rule, card, editor };
    }

    /** "Waiting on the line above", under the message that waits. */
    renderWaitingLine() {
      const self = /** @type {any} */ (this);
      return self.append(h('div', { class: 'cut-pending', role: 'status' }, h('i', { 'aria-hidden': 'true' }), 'Waiting on the line above. Claude starts in whichever tab you pick.'));
    }

    // ------------------------------------------------------------ at the turn's end
    /** A nudge nobody answered folds into one line once Claude's reply is in. */
    foldSavers() {
      const self = /** @type {any} */ (this);
      for (const card of self.el.querySelectorAll('.nudge-card:not([data-busy="1"])')) giveWay(card, foldEl(S.foldLine('nudge', { rel: card.dataset.rel, tokens: card.dataset.tokens })));
    }
  }

  SB.extendTab(FeedSavers);
})();
