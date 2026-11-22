// Which window asked. A conversation's own window (wiring/popouts.js) has the
// panel's whole bridge, and most of main answers "the panel": a dialog over it,
// a screen opened in it, a conversation added to it. While main is handling
// something such a window asked for, those belong to that window instead.
// Kept only until the handler settles: what it leaves running (Claude Code's
// process, a timer) is nobody's window in particular.
const { AsyncLocalStorage } = require('async_hooks');

/** @type {AsyncLocalStorage<{ win: any }>} */
const asks = new AsyncLocalStorage();

/**
 * Run a handler as asked by `win` (null: the panel, or nobody).
 * @template T
 * @param {any} win
 * @param {() => T} fn
 * @returns {T}
 */
function askedBy(win, fn) {
  const ask = { win };
  const done = () => { ask.win = null; };
  return asks.run(ask, () => {
    /** @type {any} */
    let out;
    try { out = fn(); } catch (err) { done(); throw err; }
    if (out && typeof out.then === 'function') out.then(done, done); else done();
    return out;
  });
}

/** The conversation's own window main is answering now, or null. */
function askingWindow() {
  const win = asks.getStore()?.win;
  return win && !win.isDestroyed() ? win : null;
}

/** The window to answer in: the one that asked, else the panel. */
const fromWindow = panel => askingWindow() || panel;

module.exports = { askedBy, askingWindow, fromWindow };
