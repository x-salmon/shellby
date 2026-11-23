/* Shellby panel — the toast: SB.toast and SB.toast.job, said by the crab in a
   speech bubble docked above the box you type in. Loads right after a11y.js. */
'use strict';
(function () {
  // The toast stays in the page (a status region that is always there gets read
  // out; one that appears with its words already in it often doesn't), and is
  // emptied rather than hidden.
  //
  // Shellby says it: a speech bubble from the crab, docked at the bottom just
  // above the box you type in, over that box's pane, so it never covers the tabs
  // (placeToast). He carries its state: how many wait behind it, a ring that
  // spins while a job runs, a raised claw when it's urgent, a slump when it failed.
  //
  // A toast with a button holds the slot: anything that comes in while it's up
  // waits its turn (and is dropped if it has gone stale by then), so a clash or a
  // catch can't snatch "Ask him to sort it out" from under the pointer. It stops
  // holding once you click or press Enter anywhere else: you've moved on, and
  // what you did next should answer straight away.
  //
  // A job (SB.toast.job) is one toast for something that takes a while: it spins
  // while it works, then becomes its own result in place. It doesn't hold the
  // slot, so anything else still replaces it, as a plain "Pushing…" always could;
  // its result then arrives as an ordinary toast instead.
  //
  // A line along the bottom drains for the time left, and stops while the
  // pointer or focus is on the toast (the timer does too).
  const TOAST_MS = 2800;
  const TOAST_OFFER_EXTRA_MS = 2500; // time to reach for the button
  const TOAST_LINGER_MS = 3000;      // after the pointer or focus leaves it
  const TOAST_STALE_MS = 4000;       // how much longer than its own time a waiting toast stays worth saying
  const TOAST_WAITING_MAX = 3;
  const TOAST_JOB_MAX_MS = 120000;   // a job nobody finished stops spinning after this
  const TOAST_JOB_STALE_MS = 30000;  // you asked for it: a job's result waits longer behind a button than chatter does
  let toastTimer;
  let toastHolds = false;
  let toastWaiting = []; // [{ msg, opts, until }]
  let toastWired = false;
  let toastShown = 0;     // counts showings, so a job can tell whether the slot is still its own
  let toastWorkingUntil = 0; // when a working job gives up, or 0 when none is up
  let toastOwed = 0;         // a job's result that came while you were on it: its whole time, for when you leave
  /** @type {HTMLElement | null} */
  let toastWater = null;  // the draining line of the toast that's up
  let toastStackTimer;    // re-draws the stack when the first waiting one goes stale
  /** @type {HTMLElement | null} */
  let toastNext = null;   // the line naming what waits behind it
  /** @type {HTMLElement | null} */
  let toastBubble = null; // what he says: the words, the buttons, the ✕
  /** @type {HTMLElement | null} */
  let toastWho = null;    // the crab saying it, who wears the count of what's waiting
  const TOAST_GAP_PX = 10;      // between the bubble and the box you type in
  const TOAST_EDGE_PX = 12;     // in from the sides of the box's pane
  const TOAST_MAX_W_PX = 640;   // a wide panel doesn't make one long thin line
  const TOAST_CLEAR_PX = 8;     // a trophy card that lands while it's up sits this far above it

  // Docks it just above the box you type in, lined up with it, so in a split
  // it's over the pane you're typing in. With no box on screen (another view)
  // panel.css's fallbacks put it above the dock. A trophy card lands down here
  // too, so while one is up, --toast-clear tells it how high to sit.
  function placeToast() {
    const t = SB.$('toast');
    const vars = ['--toast-bottom', '--toast-left', '--toast-width'];
    if (!t.children.length) {
      document.body.style.setProperty('--toast-clear', '');
      return;
    }
    const host = /** @type {HTMLElement | null} */ (t.offsetParent);
    const box = document.getElementById('composer');
    const r = host && box?.getClientRects?.().length ? box.getBoundingClientRect() : null;
    if (!host || !r?.width) for (const k of vars) t.style.setProperty(k, '');
    if (!host) return;
    const frame = host.getBoundingClientRect();
    if (r?.width) {
      t.style.setProperty('--toast-bottom', `${Math.round(frame.bottom - r.top + TOAST_GAP_PX)}px`);
      t.style.setProperty('--toast-left', `${Math.round(r.left - frame.left + TOAST_EDGE_PX)}px`);
      t.style.setProperty('--toast-width', `${Math.round(Math.min(TOAST_MAX_W_PX, r.width - 2 * TOAST_EDGE_PX))}px`);
    }
    // From its layout box, not its rect: that's still moving while it rises in.
    const top = (parseFloat(getComputedStyle(t).bottom) || 0) + t.offsetHeight;
    document.body.style.setProperty('--toast-clear', `${Math.round(top + TOAST_CLEAR_PX)}px`);
  }
  SB.placeToast = placeToast; // tab-panes.js, when the box moves to another pane

  function toastSlot() {
    const t = SB.$('toast');
    if (toastWired) return t;
    toastWired = true;
    const hold = () => { clearTimeout(toastTimer); t.classList.add('held'); };
    // A working job keeps to its own deadline, however often you look at it; anything else gets a moment more.
    const linger = () => {
      if (!t.children.length) return;
      if (toastWorkingUntil) armToast(Math.max(0, toastWorkingUntil - Date.now()), { line: false });
      else armToast(toastOwed || TOAST_LINGER_MS);
      toastOwed = 0;
    };
    t.addEventListener('pointerenter', hold);
    t.addEventListener('focusin', hold);
    t.addEventListener('pointerleave', linger);
    t.addEventListener('focusout', linger);
    t.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); dismissToasts(); } });
    const movedOn = e => { if (toastHolds && !t.contains(e.target)) toastHolds = false; };
    document.addEventListener('pointerdown', movedOn, true);
    document.addEventListener('keydown', e => { if (e.key === 'Enter') movedOn(e); }, true);
    // The box grows as you type a longer message, and the panel resizes: it keeps above both.
    window.addEventListener('resize', placeToast);
    const box = document.getElementById('composer');
    if (box && typeof ResizeObserver === 'function') new ResizeObserver(placeToast).observe(box);
    return t;
  }

  // line: whether the draining line shows the time (a working job has none).
  function armToast(ms, { line = true } = {}) {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(endToast, ms);
    const t = SB.$('toast');
    t.classList.remove('held');
    t.classList.toggle('timed', line);
    t.style.setProperty('--toast-ms', `${ms}ms`);
    if (line && toastWater) {
      toastWater.style.animation = 'none';
      void toastWater.offsetWidth; // restart the line from full
      toastWater.style.animation = '';
    }
  }

  // The ones waiting behind the toast that's up: a count on the crab's corner
  // (data-waiting, drawn in panel.css) and a line in the bubble naming the next.
  // Only ones still worth saying count, and it re-draws when the first goes stale.
  function renderToastStack() {
    clearTimeout(toastStackTimer);
    const t = SB.$('toast');
    // Only the line itself goes: re-inserting the rest would drop focus off a
    // button and restart the water line.
    toastNext?.remove();
    toastNext = null;
    const now = Date.now();
    const live = t.children.length ? toastWaiting.filter(w => w.until > now) : [];
    if (!live.length) {
      delete t.dataset.waiting;
      if (toastWho) delete toastWho.dataset.waiting;
      placeToast();
      return;
    }
    t.dataset.waiting = String(live.length);
    if (toastWho) toastWho.dataset.waiting = String(live.length);
    const [next] = live;
    const more = live.length > 1 ? ` and ${live.length - 1} more` : '';
    // Hidden from the status region: changing it would read the whole toast out again.
    const line = SB.h('span', { class: 'toast-next', 'aria-hidden': 'true' }, 'Next: ', SB.h('b', { text: next.opts.title || next.msg }), more);
    toastNext = line;
    toastBubble?.append(line);
    placeToast(); // the line makes it taller
    toastStackTimer = setTimeout(renderToastStack, Math.min(...live.map(w => w.until)) - now);
  }

  // The slot empties, and the next one still worth saying takes it.
  function endToast() {
    clearTimeout(toastTimer);
    const t = SB.$('toast');
    t.replaceChildren();
    toastHolds = false;
    toastWorkingUntil = 0;
    toastOwed = 0;
    toastWater = null;
    toastBubble = null;
    toastWho = null;
    const now = Date.now();
    toastWaiting = toastWaiting.filter(w => w.until > now);
    const next = toastWaiting.shift();
    if (next) {
      showToast(next.msg, { ...next.opts, ms: Math.min(next.opts.ms ?? TOAST_MS, next.until - now) });
      t.classList.add('promoted'); // it slides forward from the stack
    } else renderToastStack();
  }

  function dismissToasts() {
    toastWaiting = [];
    endToast();
  }

  /**
   * @typedef {{ title?: string, note?: string, action?: string, onAction?: () => void, actions?: { label: string, onAction: () => void }[], tone?: string | null, ms?: number, staleMs?: number }} ToastOpts
   */

  /**
   * @param {string} msg
   * @param {ToastOpts & { job?: 'working' | 'done' | 'failed' }} [opts]
   * @returns {number} which showing this is
   */
  function showToast(msg, { title, note, action, onAction, actions, tone = null, ms = TOAST_MS, job } = {}) {
    const t = toastSlot();
    // A job that ends under your pointer waits for you to move off before its time starts.
    const looking = (job === 'done' || job === 'failed') && t.classList.contains('held');
    t.classList.remove('promoted');
    t.classList.toggle('urgent', tone === 'urgent');
    t.classList.toggle('danger', tone === 'danger');
    t.classList.toggle('working', job === 'working');
    t.classList.toggle('finished', job === 'done');
    const offers = (actions || (action ? [{ label: action, onAction }] : [])).filter(a => a?.label);
    const body = title || note
      ? SB.h('span', { class: 'toast-body' },
        title ? SB.h('strong', { class: 'toast-title', text: title }) : null,
        SB.h('span', { class: 'toast-text', text: msg }),
        note ? SB.h('span', { class: 'toast-note', text: note }) : null)
      : SB.h('span', { text: msg });
    // What the button itself has to say comes first; the waiting ones after.
    const pick = a => {
      clearTimeout(toastTimer);
      t.replaceChildren();
      toastNext = null;
      toastBubble = null;
      toastWho = null;
      toastWater = null;
      delete t.dataset.waiting;
      toastHolds = false;
      a.onAction();
      if (!t.children.length) endToast();
    };
    // ✕ clears it and whatever was waiting behind it: you want them out of the way.
    const dismiss = SB.h('button', { class: 'toast-close', type: 'button', title: 'Dismiss', 'aria-label': 'Dismiss', onclick: dismissToasts },
      SB.icon('M4.5 4.5l7 7M11.5 4.5l-7 7', { width: 1.6 }));
    toastWater = SB.h('i', { class: 'toast-water', 'aria-hidden': 'true' });
    // Words first: they take the width they need, and the buttons sit beside a
    // short line or drop below a long one (panel.css).
    const acts = offers.length
      ? SB.h('span', { class: 'toast-acts' }, offers.map(a => SB.h('button', { class: 'toast-action', type: 'button', onclick: () => pick(a) }, a.label)))
      : null;
    toastWho = SB.h('span', { class: 'toast-who', 'aria-hidden': 'true' }, SB.sprite());
    toastBubble = SB.h('div', { class: 'toast-bubble' }, body, acts, dismiss, toastWater);
    t.replaceChildren(toastWho, SB.h('span', { class: 'toast-tail', 'aria-hidden': 'true' }), toastBubble);
    toastHolds = offers.length > 0;
    toastWorkingUntil = job === 'working' ? Date.now() + ms : 0;
    const time = offers.length ? ms + TOAST_OFFER_EXTRA_MS : ms;
    toastOwed = looking ? time : 0;
    if (toastWorkingUntil) armToast(ms, { line: false });
    else if (looking) t.classList.remove('timed'); // still held: leaving it starts the time
    else armToast(time);
    renderToastStack();
    toastShown += 1;
    return toastShown;
  }

  // actions: [{ label, onAction }] when there's more than one thing to offer.
  // title / note: a bold headline above msg and a quiet line under it, for
  // toasts with more to say than one sentence. tone: 'urgent' (amber) or
  // 'danger' (red) for its edge; sea-glass otherwise.
  SB.toast = (msg, opts = {}) => {
    if (!toastHolds) return showToast(msg, opts);
    const until = Date.now() + (opts.ms ?? TOAST_MS) + (opts.staleMs ?? TOAST_STALE_MS);
    toastWaiting = [...toastWaiting, { msg, opts, until }].slice(-TOAST_WAITING_MAX);
    renderToastStack();
  };

  // One toast for the whole of something slow: SB.toast.job('Pushing…') spins,
  // then .done(msg, opts) or .fail(msg, opts) turns it into the result in place
  // (opts as SB.toast's; fail is tone 'danger' unless told otherwise, and only
  // done gets a tick). If something else took the slot meanwhile, the result is
  // an ordinary toast. Under a toast with a button, the "working" part isn't
  // shown at all: queued, it would only come up stale, after the result.
  // ms: how long it may spin before it gives up on being finished.
  /**
   * @param {string} msg
   * @param {{ ms?: number }} [opts]
   * @returns {{ done: (msg: string, opts?: ToastOpts) => void, fail: (msg: string, opts?: ToastOpts) => void }}
   */
  SB.toast.job = (msg, { ms = TOAST_JOB_MAX_MS } = {}) => {
    const mine = toastHolds ? -1 : showToast(msg, { ms, job: 'working' });
    /** @param {string} text @param {ToastOpts} opts @param {'done' | 'failed'} job */
    const finish = (text, opts, job) => {
      const o = { ...opts, tone: opts.tone === undefined ? (job === 'failed' ? 'danger' : null) : opts.tone };
      if (mine === toastShown && toastWorkingUntil) showToast(text, { ...o, job });
      else SB.toast(text, { ...o, staleMs: TOAST_JOB_STALE_MS });
    };
    return {
      done: (text, opts = {}) => finish(text, opts, 'done'),
      fail: (text, opts = {}) => finish(text, opts, 'failed'),
    };
  };
})();
