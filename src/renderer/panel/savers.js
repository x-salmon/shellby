/* Shellby panel — the inline savers, before a message goes (savers-logic.js
   says which may show, feed-savers.js draws them): the gate tab-send.js runs
   every typed message through, the card offering Haiku for a small message
   with a short countdown that keeps the tab's own model, and the hand-off of
   a new topic in a well-filled conversation to handoff.js. Nothing switches a
   model unless you pick. "Always" for a kind of message is kept in Settings
   (modelAlways) and noted on each turn it sends, with Undo. */
'use strict';
(function () {
  const { api, state } = SB;
  const S = window.ShellbySavers;

  /**
   * @typedef {{ text: string, attachments: string[], picked?: { selected?: string } | undefined, auto?: { model: string, modelBy: string, modelCls: string } | null }} Gated
   *   a message that waited on a card; auto: the model an "always" sends it to
   */

  /** Send a message that waited on a card, with any per-turn model; a send that fails puts it back in the box. */
  async function sendGated(tab, msg, extra = {}) {
    if (tab.sending) return false;
    tab.sending = true;
    let ok;
    try { ok = await SB.sendNow(tab, msg.text, msg.attachments || [], { ...(msg.picked || {}), ...extra }); } finally { tab.sending = false; }
    if (!ok) SB.handBack(tab, msg.text, msg.attachments || []);
    return !!ok;
  }
  SB.sendGated = sendGated;

  /** Main's word on a cheaper model for this message (model-pick.js), or null with the setting off. */
  function suggestFor(tab, text, attachments) {
    if (state.settings?.modelSuggest === false) return Promise.resolve(null);
    return api.modelSuggest({ tabId: tab.id, text, files: attachments.length, ultracode: !!tab.ultracode }).catch(() => null);
  }

  /**
   * Run a typed message through the savers before it goes (tab-send.js). -> true
   * when it was taken: waiting on a card in the feed, or sent to the model you
   * chose for its kind. false: it goes the usual way. A card already up in the
   * tab is settled first (the earlier message goes as it stood), and this one follows.
   */
  SB.saverGate = async (tab, text, attachments, picked) => {
    if (tab.saver) await settle(tab, 'keep');
    if (tab.busy || tab.draining || SB.isMerging?.(tab) || SB.isCrabOnly?.()) return false;
    const [offer, sug] = await Promise.all([SB.handoffCheck ? SB.handoffCheck(tab, text) : null, suggestFor(tab, text, attachments)]);
    if (tab.busy || tab.saver || !state.tabs.has(tab.id)) return false; // the tab moved on while main looked
    /** @type {Gated} */
    const msg = { text, attachments, picked, auto: sug?.auto ? { model: sug.auto, modelBy: 'always', modelCls: sug.cls } : null };
    const kind = S.pick({ handoff: !!offer, model: !!sug?.ask && !S.quiet(tab.modelKeeps) }, null);
    if (kind === 'handoff') { SB.showHandoff(tab, offer, msg); return true; }
    if (kind === 'model') { showModelCard(tab, sug, msg); return true; }
    if (msg.auto) { SB.clearComposer(tab); await sendGated(tab, msg, msg.auto); return true; }
    return false;
  };

  // The card, with the message waiting above it and the countdown running.
  function showModelCard(tab, sug, msg) {
    SB.clearComposer(tab);
    const pending = tab.renderPendingSend(msg.text, msg.attachments);
    const card = tab.renderModelCard(sug, { onPick: answer => settle(tab, answer) });
    const s = { kind: 'model', sug, msg, pending, card, timer: /** @type {ReturnType<typeof setTimeout> | null} */ (null) };
    tab.saver = s;
    // The bar drains over COUNTDOWN_MS and the words count the seconds; at nought the message goes on the tab's own model.
    const words = card.querySelector('.saver-wait-text');
    const bar = /** @type {HTMLElement | null} */ (card.querySelector('.saver-wait-bar > i'));
    const end = Date.now() + S.COUNTDOWN_MS;
    const tick = () => {
      if (tab.saver !== s) return;
      if (!state.tabs.has(tab.id)) { tab.saver = null; return; } // closed meanwhile: nothing to send it to
      const left = end - Date.now();
      if (words) words.textContent = S.countdownText(sug.modelName, left);
      if (bar) bar.style.width = `${Math.max(0, (100 * left) / S.COUNTDOWN_MS)}%`;
      if (left <= 0) { settle(tab, 'timeout'); return; }
      s.timer = setTimeout(tick, 250);
    };
    tick();
  }

  /**
   * The card is answered: 'cheaper' (Haiku for this one), 'keep', 'always' (this
   * kind goes to Haiku from now on), 'off' (no more suggestions), or 'timeout'
   * (the countdown ran out: the tab's own model, and the card folds to a line).
   * A fresh-tab divider waiting in the tab is handoff.js's to settle.
   */
  async function settle(tab, answer) {
    const s = tab.saver;
    if (!s) return;
    if (s.kind === 'handoff') return SB.settleHandoff(tab, answer === 'start' ? 'start' : 'stay');
    tab.saver = null;
    if (s.timer) clearTimeout(s.timer);
    tab.modelKeeps = S.keepsAfter(tab.modelKeeps, answer);
    s.pending.remove();
    if (answer === 'timeout') tab.foldModelCard(s.card, s.sug.modelName); else tab.dropCard(s.card);
    if (answer === 'off') {
      const r = await api.setSettings({ modelSuggest: false }).catch(() => null);
      if (r?.settings) state.settings = r.settings;
      SB.toast('No more model suggestions. Settings → Limits turns them back on.', { ms: 6000 });
    }
    if (answer === 'always') {
      const r = await api.setSettings({ modelAlways: { ...(state.settings?.modelAlways || {}), [s.sug.cls]: s.sug.cheaper } }).catch(() => null);
      if (r?.settings) state.settings = r.settings;
    }
    const cheaper = answer === 'cheaper' || answer === 'always';
    await sendGated(tab, s.msg, cheaper ? { model: s.sug.cheaper, modelBy: answer === 'always' ? 'always' : 'you', modelCls: s.sug.cls } : {});
  }
  SB.settleSaver = settle;
})();
