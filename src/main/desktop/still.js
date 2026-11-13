// Work that holds up the main process waits for him to stand still. While he
// walks, hops, flies or climbs, main moves his window every 16 ms
// (desktop/motion.js), so a 30-50 ms settings save or Toolbox scan there is a
// visible stop mid-step: the crab froze for a split second and walked on.
// Standing still, held work runs straight away, as it always did. Moving, it
// waits for him to stop, and never longer than MAX_HOLD_MS. Asked again while
// it waits, it still runs once: a walk's worth of saves becomes one save.

const RETRY_MS = 250;      // how often a held job looks to see if he's stopped
const MAX_HOLD_MS = 5000;  // a long climb doesn't keep a setting off the disk for long

/**
 * Is he on the move in a way main draws frame by frame? A thrown flight, a hop,
 * a stroll or a climb, or a drag. A ride on a window he's perched on isn't: it
 * mostly sits still for minutes at a time, moving only when that window does.
 * @param {{ busy: boolean, kind: string | null } | null | undefined} motion
 * @param {{ climbing?: boolean, dragging?: boolean }} [also]
 */
function isMoving(motion, { climbing = false, dragging = false } = {}) {
  if (dragging) return true;
  if (!motion?.busy) return false;
  return motion.kind !== 'ride' || climbing;
}

/**
 * @param {{
 *   moving: () => boolean,
 *   onError?: (key: string, err: unknown) => void,
 *   retryMs?: number, maxHoldMs?: number,
 *   setTimer?: (fn: () => void, ms: number) => any, clearTimer?: (t: any) => void,
 *   now?: () => number,
 * }} opts
 */
function createStillGate({ moving, onError = () => {}, retryMs = RETRY_MS, maxHoldMs = MAX_HOLD_MS, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now }) {
  /** @type {Map<string, { fn: () => void, since: number }>} */
  const held = new Map();
  /** @type {any} */
  let timer = null;

  const movingNow = () => { try { return !!moving(); } catch { return false; } };

  function runHeld(key, fn) {
    try { fn(); } catch (err) { onError(key, err); }
  }

  function arm() {
    if (timer || !held.size) return;
    timer = setTimer(tick, retryMs);
    timer?.unref?.();
  }

  // Held jobs whose wait is over: he stopped, or they've waited long enough.
  function tick() {
    timer = null;
    const still = !movingNow();
    const t = now();
    for (const [key, job] of [...held]) {
      if (!still && t - job.since < maxHoldMs) continue;
      held.delete(key);
      runHeld(key, job.fn);
    }
    arm();
  }

  /**
   * Run fn now if he's still, else once he stops. A later fn under the same key
   * replaces a held one but keeps its place in the queue (its wait isn't reset).
   * Run now, fn's errors reach the caller as before; held, they go to onError.
   * @returns {boolean} whether it ran now
   */
  function when(key, fn) {
    if (!movingNow()) {
      held.delete(key);
      fn();
      return true;
    }
    held.set(key, { fn, since: held.get(key)?.since ?? now() });
    arm();
    return false;
  }

  /** Everything held, now, moving or not (quitting). */
  function flush() {
    clearTimer(timer);
    timer = null;
    for (const [key, job] of [...held]) {
      held.delete(key);
      runHeld(key, job.fn);
    }
  }

  return { when, flush, pending: () => held.size };
}

module.exports = { createStillGate, isMoving, RETRY_MS, MAX_HOLD_MS };
