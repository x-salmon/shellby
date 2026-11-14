/* Shellby panel — a fresh tab with a summary Shellby writes himself
   (src/main/freshtab.js). When you send into a conversation whose context is
   well filled and the message reads as a new topic, a dashed line is drawn in
   the feed where the topic turned, with the offer on it: a new tab that starts
   with a summary of everything above (title, files changed, commits, open
   to-dos, the last asks), shown for editing, and your message goes with it.
   The message waits under the line until you pick; "Stay in this one" sends
   it here and leaves the line, so you can come back to it. Offered once per
   conversation (savers.js runs the gate, feed-savers.js draws it); the
   context chip's menu brings it back any time. Never automatic; the old
   conversation stays as it was. Unlike "Start fresh with a summary"
   (tab-meters.js), Claude writes nothing here, so it costs nothing to offer. */
'use strict';
(function () {
  const { h, api, $ } = SB;
  const input = $('input');
  const MIN_CHARS = 15;   // shorter than this is a follow-up, not a topic

  /**
   * Is this message a new topic in a well-filled conversation? Main says
   * (freshtab.js HANDOFF_PCT, looksNewTopic), and under the mark answers
   * without reading the transcript. Once per conversation. -> the offer, or null.
   */
  SB.handoffCheck = async (tab, text) => {
    if (!tab?.saved || !tab.context || tab.handoffOffered || text.length < MIN_CHARS) return null;
    const r = await api.handoffOffer({ tabId: tab.id, text, force: false }).catch(() => null);
    return r?.offer ? r : null;
  };

  /**
   * Draw the line and its card, with the message waiting under it (savers.js
   * saverGate, or the chip's menu). msg: { text, attachments, picked, auto }.
   */
  SB.showHandoff = (tab, offer, msg) => {
    tab.handoffOffered = true;
    SB.clearComposer(tab);
    const has = !!(msg.text || msg.attachments?.length);
    const view = tab.renderHandoffDivider(
      { pct: offer.pct, saved: offer.saved, summary: offer.summary, contextTokens: tab.context?.tokens, title: tab.title, hasMessage: has },
      { start: () => settle(tab, 'start'), stay: () => settle(tab, 'stay') });
    const pending = has ? tab.renderPendingSend(msg.text, msg.attachments) : null;
    const waiting = has ? tab.renderWaitingLine() : null;
    tab.saver = { kind: 'handoff', offer, msg, view, pending, waiting };
  };

  let starting = false; // a second click while main opens the tab would start two
  /**
   * 'start': the new tab, in this one's folder, with the summary as edited and
   * the message as its first turn. 'stay': the message goes here, and the line stays.
   */
  async function settle(tab, answer) {
    const s = tab.saver;
    if (!s || s.kind !== 'handoff') return;
    if (answer === 'start') {
      if (starting) return;
      starting = true;
      let r;
      try { r = await api.handoffStart({ tabId: tab.id, summary: s.view.editor.value, text: s.msg.text || '', attachments: s.msg.attachments || [] }).catch(() => null); } finally { starting = false; }
      if (!r?.ok) return SB.toast(r?.error || "Couldn't start a fresh tab.");
      tab.saver = null;
      s.pending?.remove();
      s.waiting?.remove();
      s.view.card.remove();
      s.view.rule.replaceChildren(h('span', { text: 'New topic · carried on in a fresh tab' }));
      const fresh = SB.ensureTab({ id: r.tabId, title: r.title, named: true, cwd: tab.cwd });
      SB.activate(r.tabId);
      SB.markSent(fresh, r.text, s.msg.attachments || [], r.turnId);
      SB.toast('Started a fresh tab with the summary. The old conversation stays as it was.', { ms: 5000 });
      return;
    }
    tab.saver = null;
    s.view.card.remove();
    s.waiting?.remove();
    s.pending?.remove();
    if (!s.msg.text && !s.msg.attachments?.length) { s.view.el.remove(); return; } // nothing waited on it: nothing to mark
    await SB.sendGated(tab, s.msg, s.msg.auto || {});
  }
  SB.settleHandoff = settle;

  /** From the context chip's menu: the summary whatever the box says, with the box's text as the ask. */
  SB.offerHandoff = async tab => {
    if (!tab?.saved) return SB.toast('That conversation has nothing to sum up yet.');
    if (tab.busy) return SB.toast('Let him finish first.');
    if (tab.saver) await SB.settleSaver(tab, 'keep');
    const text = input.value.trim();
    const r = await api.handoffOffer({ tabId: tab.id, text, force: true }).catch(() => null);
    if (!r?.offer) return SB.toast('That conversation has nothing to sum up yet.');
    if (SB.activeTab() !== tab || tab.saver || tab.busy) return;
    SB.showHandoff(tab, r, { text, attachments: [...tab.attachments], picked: SB.treePickOpts?.(tab), auto: null });
  };
})();
