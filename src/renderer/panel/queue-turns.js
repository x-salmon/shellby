// How a queue of messages becomes turns (tab-queue.js drains by it, tab-send.js
// asks it before sending): plain messages typed close together go to Claude as
// one turn, each its own paragraph, so a thought in three Enters costs one turn
// of usage, not three. A /command, a message with a file picked, or one that
// started as a command keeps a turn of its own.
// Pure, no DOM. Works in the browser and in Node (test/queue-turns.test.js).
(function (root) {
  /** A message sent while idle waits this long for company before it goes. */
  const MERGE_WINDOW_MS = 1500;

  /**
   * @typedef {{ id?: string, text: string, attachments?: string[], selected?: string, solo?: boolean, taken?: boolean }} Queued
   * @typedef {{ items: Queued[], text: string, attachments: string[], selected: string | undefined, rest: Queued[] }} Turn
   */

  /**
   * Does this message need a turn of its own? A /command (or a ! one) can only
   * start a turn; a file picked in All files goes as one line about one message;
   * and one typed as a command (a snippet, /subtask) stays what it was, however
   * its words were filled in.
   * @param {Queued} m
   */
  function solo(m) {
    return !!(m.solo || m.selected || /^[/!]/.test(m.text || ''));
  }

  /**
   * The next turn off the front of the queue: one solo message, or every plain
   * message up to the first solo one, as one. Their words are joined with blank
   * lines, in order; their files all go, each once. Null for an empty queue.
   * @param {Queued[]} queue
   * @returns {Turn | null}
   */
  function nextTurn(queue) {
    if (!queue.length) return null;
    const firstSolo = queue.findIndex(solo);
    const n = firstSolo === 0 ? 1 : firstSolo < 0 ? queue.length : firstSolo;
    const items = queue.slice(0, n);
    return {
      items,
      text: items.map(m => m.text).filter(Boolean).join('\n\n'),
      attachments: [...new Set(items.flatMap(m => m.attachments || []))],
      selected: n === 1 ? items[0].selected : undefined,
      rest: queue.slice(n),
    };
  }

  /**
   * Can a message typed while the tab is idle wait a moment for company? Only
   * with the setting on, in a tab whose queue isn't paused after an error, and
   * never a message that needs a turn of its own.
   * @param {Queued} m
   * @param {{ on?: boolean, paused?: boolean }} [tab]
   */
  function canMerge(m, { on = true, paused = false } = {}) {
    return on && !paused && !solo(m);
  }

  const api = { MERGE_WINDOW_MS, solo, nextTurn, canMerge };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShellbyQueueTurns = api;
})(typeof window !== 'undefined' ? window : globalThis);
