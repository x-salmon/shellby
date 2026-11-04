// Answering main's confirm window (src/renderer/dialog/dialog.html) from an e2e
// script, the one way every script does it. The window is a race at both ends:
//   - /json/list can name it while it's still loading, or a moment after it was
//     answered and is closing, and a socket to a closing page never opens or
//     never answers. So each try connects afresh, every call times out, and the
//     window must be ready (its buttons in, the default focused) before use.
//   - Pressing a button closes it. The click goes on the next tick so the call
//     can answer first, and even so the window can close before the reply is
//     sent. It only ever closes once it's answered, so a close during the press
//     is the click landing; whatever the click did is for the script to check.
// Then it waits for the window to leave the list, so the next confirm a script
// looks for is never this one on its way out.
const { savePng } = require('./shot');

const CALL_MS = 10000;   // a CDP call slower than this is a window that went away
const OPEN_MS = 20000;   // how long a confirm window gets to turn up and be ready
const GONE_MS = 10000;   // and to leave the list once answered
const wait = ms => new Promise(r => setTimeout(r, ms));

const READY = "document.querySelectorAll('#actions button').length > 0 && (document.getElementById('title')?.textContent || '').length > 0 && document.activeElement?.tagName === 'BUTTON'";

// What a confirm window says, for the script's own checks.
const SAID = `({
  title: document.getElementById('title')?.textContent || '',
  message: document.getElementById('message')?.textContent || '',
  detail: document.getElementById('detail')?.textContent || '',
  note: document.getElementById('note')?.textContent || '',
  danger: !!document.getElementById('dialog')?.classList.contains('danger'),
  focused: document.activeElement?.textContent || '',
  buttons: [...document.querySelectorAll('#actions button')].map(b => b.textContent.trim()),
  items: [...document.querySelectorAll('.item .nm')].map(n => n.textContent),
  text: document.body.innerText,
})`;

async function targets(port) {
  try { return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { return []; }
}

/** A CDP connection that fails, rather than hangs, when its page goes away. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const gone = why => { for (const p of pending.values()) p.fail(new Error(why)); pending.clear(); };
  await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('the window never answered')), CALL_MS);
    ws.onopen = () => { clearTimeout(timer); ok(); };
    ws.onerror = () => { clearTimeout(timer); fail(new Error('the window went away')); };
    ws.onclose = () => { clearTimeout(timer); fail(new Error('the window went away')); };
  });
  ws.onclose = () => gone('the window went away');
  ws.onerror = () => gone('the window went away');
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    const p = pending.get(m.id);
    if (p) { pending.delete(m.id); p.ok(m); }
  };
  const send = (method, params = {}) => new Promise((ok, fail) => {
    const i = ++id;
    const timer = setTimeout(() => { pending.delete(i); fail(new Error(`${method} got no answer`)); }, CALL_MS);
    pending.set(i, { ok: m => { clearTimeout(timer); ok(m.result); }, fail: e => { clearTimeout(timer); fail(e); } });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r?.result?.value;
  };
  return { send, ev, close: () => ws.close() };
}

// The button to press: its exact (trimmed) text, a pattern, or a position.
function finder(label) {
  if (typeof label === 'number') return `[...document.querySelectorAll('#actions button')][${label}]`;
  const test = label instanceof RegExp
    ? `new RegExp(${JSON.stringify(label.source)}, ${JSON.stringify(label.flags)}).test(b.textContent.trim())`
    : `b.textContent.trim() === ${JSON.stringify(label)}`;
  return `[...document.querySelectorAll('#actions button')].find(b => ${test})`;
}

/**
 * Find the confirm window, read it, and press `press`.
 *   port   the app's --remote-debugging-port
 *   press  button text (exact, trimmed), a RegExp, or an index; null only reads
 *   shot   a file to save a screenshot of it to before pressing
 *   ready  a page expression that must be true first (default: buttons in,
 *          title set, default button focused)
 *   ms     how long it gets to turn up and be ready
 * -> what it said ({ title, message, detail, note, danger, focused, buttons,
 *    items (a pack's previewed pieces), text }), or null if no ready confirm
 *    window turned up. Throws if it has no
 *    such button: that's a script bug, not a race.
 */
async function answerDialog(port, { press, shot = null, ready = READY, ms = OPEN_MS } = {}) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = (await targets(port)).find(x => x.url.includes('dialog.html'));
    if (!t) { await wait(150); continue; }
    let d = null;
    let said = null;
    try {
      d = await connect(t.webSocketDebuggerUrl);
      if (!(await d.ev(`!!(${ready})`))) { await wait(150); continue; }
      said = await d.ev(SAID);
      if (shot) await savePng(d.send, shot);
    } catch {
      await wait(150);
      continue; // still loading, or one on its way out: look again
    } finally {
      if (!said) d?.close();
    }
    try {
      if (press !== null && press !== undefined) {
        const pressed = await d.ev(`(() => { const b = ${finder(press)}; if (!b) return false; setTimeout(() => b.click(), 0); return true; })()`)
          .catch(e => { if (/went away|got no answer/.test(e.message)) return true; throw e; });
        if (!pressed) throw new Error(`the confirm window "${said.title}" has no ${press} button (it has ${said.buttons.join(', ')})`);
      }
    } finally {
      d.close();
    }
    if (press !== null && press !== undefined) {
      const goneBy = Date.now() + GONE_MS;
      while (Date.now() < goneBy && (await targets(port)).some(x => x.id === t.id)) await wait(150);
    }
    return said;
  }
  return null;
}

module.exports = { answerDialog, connect, CALL_MS, OPEN_MS };
