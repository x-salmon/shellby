const { matches } = require('./ipc-args');

// Who may call which channel. Every handler is registered through this, so a
// window can reach only what its own bridge offers: the crab's window (which
// draws friends' visiting crabs and stickers) can move him and take a drop,
// and nothing more, even if something it shows ever runs code. The panel gets
// its full bridge, and so does a conversation popped out into a window of its
// own, which is the panel's page and bridge (wiring/popouts.js); no other window gets anything here (the confirmation
// windows answer on confirm.js's own channels, which check their sender).
//
// allow(channel, sender) -> boolean. A refused invoke rejects; a refused send
// is dropped. Either way it's written down once per channel.

//
// A handler that throws is written down with its channel (onFailed): Electron
// only prints it to a console nobody sees. An invoke still rejects with the
// handler's own words, which the panel shows (many are written for you, like
// "Shellby is still working on the last task."). A send has no one to answer,
// so its failure stops here instead of surfacing as an anonymous uncaught
// exception or unhandled rejection.
//
// handle(channel, fn, schema) and on(channel, fn, schema): schema, from
// ipc-args.js, is checked after who's asking and before the handler. Arguments
// that don't fit are refused the same way, so the handler never sees them.
/**
 * @typedef {(channel: string, fn: (e: any, ...args: any[]) => any, schema?: import('./ipc-args').Check[]) => void} Register
 * @typedef {{ handle: Register, on: Register }} GuardedIpc
 */

/**
 * @param {Pick<import('electron').IpcMain, 'handle' | 'on'>} ipcMain
 * @param {(channel: string, sender: any) => boolean} allow
 * @param {{ onRefused?: (channel: string, sender?: any) => void, onFailed?: (channel: string, err: unknown, info: { answered: boolean }) => void }} [hooks]
 * @returns {GuardedIpc}
 */
function guardIpc(ipcMain, allow, { onRefused = () => {}, onFailed = () => {} } = {}) {
  const refusedOnce = new Set();
  const refuse = (channel, e) => {
    if (refusedOnce.has(channel)) return;
    refusedOnce.add(channel);
    onRefused(channel, e?.sender);
  };
  const failed = (channel, err, answered) => {
    try { onFailed(channel, err, { answered }); } catch { /* the report itself must never throw */ }
  };
  return {
    handle(channel, fn, schema) {
      ipcMain.handle(channel, async (e, ...args) => {
        if (!allow(channel, e.sender)) { refuse(channel, e); throw new Error('Not allowed from this window.'); }
        if (schema && !matches(schema, args)) { refuse(channel, e); throw new Error("That request wasn't one Shellby accepts."); }
        try {
          return await fn(e, ...args);
        } catch (err) {
          failed(channel, err, true);
          throw err;
        }
      });
    },
    on(channel, fn, schema) {
      ipcMain.on(channel, (e, ...args) => {
        if (!allow(channel, e.sender)) { refuse(channel, e); return; }
        if (schema && !matches(schema, args)) { refuse(channel, e); return; }
        try {
          const out = fn(e, ...args);
          if (out && typeof out.then === 'function') out.then(null, err => failed(channel, err, false));
        } catch (err) {
          failed(channel, err, false);
        }
      });
    },
  };
}

// The crab's window: its own bridge (critter-preload.js), and nothing else.
const CRITTER_CHANNELS = /^(critter:(?!reset-position$)[a-z-]+|attach:image)$/;
// The pebble you throw for fetch (toy-preload.js): being dragged, and that's all.
const TOY_CHANNELS = /^toy:drag-(start|move|end)$/;
// The floor strip with his pals and footprints (floor-preload.js): the pointer's over a pal, a pal was poked.
const FLOOR_CHANNELS = /^floor:(hit|poke)$/;
// A note he dragged in (note-preload.js): throw it away.
const NOTE_CHANNELS = /^note:close$/;

/** windows: () => ({ panel, critter, isPopout(wc), isToy(wc), isFloor(wc), isNote(wc) }), any of them possibly gone. */
function windowPolicy(windows) {
  return (channel, sender) => {
    const { panel, critter, isPopout, isToy, isFloor, isNote } = windows();
    if (sender && panel && sender === panel) return true;
    if (sender && isPopout?.(sender)) return true;
    if (sender && critter && sender === critter) return CRITTER_CHANNELS.test(channel);
    if (sender && isToy?.(sender)) return TOY_CHANNELS.test(channel);
    if (sender && isFloor?.(sender)) return FLOOR_CHANNELS.test(channel);
    if (sender && isNote?.(sender)) return NOTE_CHANNELS.test(channel);
    return false;
  };
}

module.exports = { guardIpc, windowPolicy, CRITTER_CHANNELS, TOY_CHANNELS, FLOOR_CHANNELS, NOTE_CHANNELS };
