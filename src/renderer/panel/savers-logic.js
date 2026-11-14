// The inline savers in the chat feed, and how they keep out of each other's
// way: the card that offers Haiku for a small message (savers.js), the nudge
// under a repeated big read (feed-savers.js) and the divider that offers a
// fresh tab at a topic change (handoff.js). One card at a time; when a message
// earns both the divider and the model card, the divider wins; the model card
// stops asking in a tab after "Keep Opus" twice in a row (a countdown that
// runs out counts as one); and a card nobody answered folds into one line once
// Claude's reply comes in. Pure, no DOM. Works in the browser and in Node
// (test/savers-logic.test.js).
(function (root) {
  /** What wins when one message earns more than one card, first first. */
  const ORDER = ['handoff', 'model'];
  /** "Keep Opus" this many times in a row and the model card stops asking in that tab. */
  const KEEP_LIMIT = 2;
  /** How long the model card waits for a pick before the message goes on the tab's own model. */
  const COUNTDOWN_MS = 8000;
  /** The kinds of small message (main's model-pick.js classOf), as "always for …" names them. */
  const CLASS_WORDS = Object.freeze({ question: 'questions like this', lookup: 'lookups like this', tweak: 'small changes like this' });

  /** 'claude-haiku-5-5' -> 'Haiku'; a model that can't be placed reads as the top model. */
  function modelName(id) {
    const m = String(id || '').toLowerCase().match(/opus|sonnet|haiku|fable/);
    return m ? m[0][0].toUpperCase() + m[0].slice(1) : 'Opus';
  }

  /**
   * Which card may show for a message: the first in ORDER among the candidates,
   * or none while another card is up.
   * @param {{ handoff?: boolean, model?: boolean }} candidates
   * @param {string | null} [showing]  the kind of the card already up in the tab
   */
  function pick(candidates, showing = null) {
    if (showing) return null;
    return ORDER.find(k => !!candidates?.[k]) || null;
  }

  /**
   * The tab's "Keep Opus" streak after an answer to the model card: one more
   * after a keep (the countdown running out is a keep), back to none after
   * any other pick.
   * @param {number} keeps
   * @param {'keep' | 'timeout' | 'cheaper' | 'always' | string} answer
   */
  function keepsAfter(keeps, answer) {
    return answer === 'keep' || answer === 'timeout' ? (Number.isFinite(keeps) ? keeps : 0) + 1 : 0;
  }

  /** Has the model card been kept away often enough to stop asking in this tab? */
  const quiet = keeps => Number.isFinite(keeps) && keeps >= KEEP_LIMIT;

  /** "Opus in 6 s if you don't pick". */
  function countdownText(modelName, msLeft) {
    const s = Math.max(0, Math.ceil((Number.isFinite(msLeft) ? msLeft : 0) / 1000));
    return `${modelName} in ${s} s if you don't pick`;
  }

  /**
   * The one line a card folds into when it wasn't answered.
   * kind: 'model' (the countdown ran out), 'nudge' (the turn ended around
   * it), 'handoff' (the offer was superseded).
   * @param {string} kind
   * @param {{ modelName?: string, rel?: string, tokens?: string }} [c]
   */
  function foldLine(kind, c = {}) {
    if (kind === 'model') return `Kept ${c.modelName || 'the tab\'s model'}: nothing was picked in time. Haiku is on the model chip when you want it.`;
    if (kind === 'nudge') return `Claude read ${c.rel || 'that file'} again${c.tokens ? ` (about ${c.tokens} tokens)` : ''}. The Lean tab has a one-tap fix for it.`;
    if (kind === 'handoff') return 'The fresh-tab offer passed; the context chip\'s menu brings it back.';
    return '';
  }

  const api = { ORDER, KEEP_LIMIT, COUNTDOWN_MS, CLASS_WORDS, modelName, pick, keepsAfter, quiet, countdownText, foldLine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShellbySavers = api;
})(typeof window !== 'undefined' ? window : globalThis);
