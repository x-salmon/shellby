/* Shellby on your phone — talking to the PC. The token lives in this app's
   own storage and goes in a header with every request; the event stream is a
   plain fetch read as it arrives (EventSource can't send a header), and it
   comes back by itself after the phone sleeps, the PC sleeps, or Wi-Fi drops. */
'use strict';
(function (root) {
  const L = root.PocketLogic;
  const API = '/pocket/v1';
  const TOKEN_KEY = 'shellby.pocket.token';
  const STALE_MS = 40000; // pings come every 15s: nothing for this long and the stream is dead

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  const token = () => store.get(TOKEN_KEY);
  const setToken = t => store.set(TOKEN_KEY, t);

  async function call(method, name, body, { timeoutMs = 20000 } = {}) {
    const headers = { Accept: 'application/json' };
    const t = token();
    if (t) headers.Authorization = `Bearer ${t}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(`${API}/${name}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
      });
    } catch {
      return { ok: false, offline: true, error: "Couldn't reach your PC." };
    }
    let data;
    try { data = await res.json(); } catch { data = null; }
    if (res.status === 401) return { ok: false, unpaired: true, error: 'This phone isn’t paired any more.' };
    if (res.status === 429) return { ok: false, error: 'Slow down a little, then try again.' };
    if (res.status === 403 && !data) return { ok: false, error: 'Your PC turned that down.' };
    return data && typeof data === 'object' ? data : { ok: false, error: `Your PC said ${res.status}.` };
  }

  // timeoutMs: starting a task makes a copy of the repo, and Bring it home can run the tests first.
  const post = (name, body = {}, opts) => call('POST', name, body, opts);
  const get = (name, query = {}) => call('GET', `${name}?${new URLSearchParams(query)}`);

  /**
   * The live stream. handlers: { view(v), items({ tabId, items }), item({ tabId, item }),
   * bye({ reason }), live(on), unpaired() }. watch(tabId) reopens it for that conversation.
   */
  function createStream(handlers) {
    let ctrl = null;
    let attempt = 0;
    let timer = null;
    let tab = null;
    let alive = false;
    let lastByte = 0;
    let stopped = false;

    const setLive = on => { if (alive !== on) { alive = on; handlers.live?.(on); } };

    function schedule(ms) {
      clearTimeout(timer);
      if (stopped) return;
      timer = setTimeout(open, ms);
    }

    async function open() {
      clearTimeout(timer);
      ctrl?.abort();
      if (stopped || !token()) return;
      const mine = new AbortController();
      ctrl = mine;
      const q = tab ? `?tab=${encodeURIComponent(tab)}` : '';
      // From now, the watchdog counts: a PC asleep mid-handshake never answers at all.
      lastByte = Date.now();
      let res;
      try {
        res = await fetch(`${API}/events${q}`, { headers: { Authorization: `Bearer ${token()}`, Accept: 'text/event-stream' }, cache: 'no-store', credentials: 'omit', signal: mine.signal });
      } catch {
        if (ctrl !== mine) return;
        setLive(false);
        schedule(L.backoff(attempt++));
        return;
      }
      if (ctrl !== mine) return;
      if (res.status === 401) { setLive(false); stopped = true; handlers.unpaired?.(); return; }
      if (!res.ok || !res.body) { setLive(false); schedule(L.backoff(attempt++)); return; }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      const feed = L.sseParser((name, data) => {
        if (name === 'view' && data) { attempt = 0; setLive(true); handlers.view?.(data); } else if (name === 'items' && data) handlers.items?.(data);
        else if (name === 'item' && data) handlers.item?.(data);
        else if (name === 'bye') { stopped = true; handlers.bye?.(data || {}); }
      });
      lastByte = Date.now();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          lastByte = Date.now();
          feed(value);
        }
      } catch { /* aborted, or the connection went */ }
      if (ctrl !== mine) return;
      setLive(false);
      schedule(L.backoff(attempt++));
    }

    // A connection a sleeping phone left half-open never says it's gone: if no
    // ping has come for a while, it's dead, and a new one starts.
    const watchdog = setInterval(() => {
      if (!stopped && ctrl && Date.now() - lastByte > STALE_MS) { setLive(false); attempt = 0; open(); }
    }, 5000);

    const now = () => { attempt = 0; open(); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') now(); });
    root.addEventListener('online', now);
    root.addEventListener('pageshow', e => { if (e.persisted) now(); });

    return {
      start() { stopped = false; now(); },
      stop() { stopped = true; clearTimeout(timer); ctrl?.abort(); setLive(false); },
      /** Follow one conversation's transcript too (or none). */
      watch(tabId) { if (tab === tabId) return; tab = tabId || null; if (!stopped) now(); },
      get live() { return alive; },
      dispose() { clearInterval(watchdog); this.stop(); },
    };
  }

  root.PocketNet = { API, TOKEN_KEY, call, createStream, get, post, setToken, store, token };
})(window);
