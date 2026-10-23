/* Shellby on your phone — the parts with no DOM: reading the event stream,
   the words the screens use, a conversation's transcript folded into what's
   drawn, a little markdown, and a diff. Shared with the tests
   (test/pocket-logic.test.js), so it runs in Node as well as on the phone. */
'use strict';
(function (root) {
  // ---------------------------------------------------------------- the stream

  /**
   * Server-sent events, fed a chunk at a time. Calls onEvent(name, data) for
   * each complete event; comments (the keep-alive pings) are skipped.
   */
  function sseParser(onEvent) {
    let buf = '';
    return chunk => {
      buf += chunk;
      let at;
      while ((at = buf.search(/\r?\n\r?\n/)) >= 0) {
        const block = buf.slice(0, at);
        buf = buf.slice(at + (buf[at] === '\r' ? 4 : 2));
        let name = 'message';
        const data = [];
        for (const line of block.split(/\r?\n/)) {
          if (!line || line.startsWith(':')) continue;
          const i = line.indexOf(':');
          const field = i < 0 ? line : line.slice(0, i);
          const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
          if (field === 'event') name = value;
          else if (field === 'data') data.push(value);
        }
        if (!data.length) continue;
        let parsed;
        try { parsed = JSON.parse(data.join('\n')); } catch { parsed = null; }
        onEvent(name, parsed);
      }
      // A stream that never sends a blank line shouldn't grow without end.
      if (buf.length > 4 * 1024 * 1024) buf = '';
    };
  }

  /** How long to wait before the next try: 1s, 2s, 4s… up to 15s, with a little jitter. */
  function backoff(attempt, random = Math.random) {
    const base = Math.min(15000, 1000 * 2 ** Math.max(0, attempt));
    return Math.round(base * (0.8 + random() * 0.4));
  }

  // ---------------------------------------------------------------- words

  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  function duration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '';
    if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m}m ${String(Math.round(seconds % 60)).padStart(2, '0')}s`;
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  }

  function ago(at, now = Date.now()) {
    if (!Number.isFinite(at)) return '';
    const s = Math.max(0, Math.round((now - at) / 1000));
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    return `${Math.round(h / 24)} d ago`;
  }

  const clock = at => {
    const d = new Date(at);
    return Number.isFinite(d.getTime()) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
  };

  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  /** A time in the coming week: "at 14:30" today, "tomorrow at 09:00", else "on Friday at 18:00". */
  function day(at, now = Date.now()) {
    const d = new Date(at), n = new Date(now);
    if (!Number.isFinite(d.getTime())) return '';
    const start = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((start(d) - start(n)) / 86400000);
    if (days === 0) return `at ${clock(at)}`;
    if (days === 1) return `tomorrow at ${clock(at)}`;
    return `on ${DAYS[d.getDay()]} at ${clock(at)}`;
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** A day in the past: "Today", "Yesterday", "Tuesday" within the week, else "12 Oct" (with the year when it isn't this one). */
  function dayLabel(at, now = Date.now()) {
    const d = new Date(at), n = new Date(now);
    if (!Number.isFinite(d.getTime())) return '';
    const start = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((start(n) - start(d)) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days > 1 && days < 7) return DAYS[d.getDay()];
    return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === n.getFullYear() ? '' : ` ${d.getFullYear()}`}`;
  }

  /** Entries (each with `at`) grouped by the day they were last worked on, newest first: [{ label, entries }]. */
  function byDay(list, now = Date.now()) {
    const out = [];
    for (const e of [...(list || [])].sort((a, b) => (b.at || 0) - (a.at || 0))) {
      const label = dayLabel(e.at, now);
      const last = out[out.length - 1];
      if (last && last.label === label) last.entries.push(e); else out.push({ label, entries: [e] });
    }
    return out;
  }

  /** The "While you were away" line: "2 finished, 1 waiting on you, 4% of your window". */
  function awayLine(a) {
    const bits = [];
    if (a.finished?.length) bits.push(`${a.finished.length} finished`);
    if (a.trouble?.length) bits.push(`${a.trouble.length} hit a problem`);
    if (a.waiting?.length) bits.push(`${a.waiting.length} waiting on you`);
    if (Number.isFinite(a.share) && a.share > 0) bits.push(`${a.share < 1 ? '<1' : Math.round(a.share)}% of your window spent`);
    else if (Number.isFinite(a.tokens) && a.tokens > 0) bits.push(`${tokens(a.tokens)} spent`);
    return bits.join(', ');
  }

  function tokens(n) {
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n < 1000) return `${n} tokens`;
    if (n < 100000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k tokens`;
    return `${Math.round(n / 1000)}k tokens`;
  }

  /** The beach's headline: what matters most right now, in a few words. */
  function headline(view) {
    const tabs = view?.tabs || [];
    const asks = view?.prompts?.length || 0;
    const working = tabs.filter(t => t.standing === 'working').length;
    const review = tabs.filter(t => t.standing === 'review').length;
    const crew = view?.crab?.crew?.length || 0;
    if (asks) {
      return { title: asks === 1 ? 'He needs you' : `${asks} things need you`, sub: [working && `${working} on the go`, review && `${review} to review`].filter(Boolean).join(' · ') || 'Waiting on your yes' };
    }
    if (working) return { title: working === 1 ? 'On it' : `${working} on the go`, sub: [crew && plural(crew, 'helper') + ' out', review && `${review} to review`].filter(Boolean).join(' · ') || 'Working away' };
    if (review) return { title: review === 1 ? 'Ready for a look' : `${review} ready for a look`, sub: 'Changes waiting for your review' };
    if (view?.usage?.limit) return { title: 'Napping', sub: `Usage limit: back at ${view.usage.limit.at}` };
    return { title: 'All quiet', sub: tabs.length ? `${plural(tabs.length, 'conversation')}, nothing running` : 'Nothing on the go' };
  }

  /** What a working tab is up to, in one line. */
  function doingLine(t) {
    if (t.pending) return 'Waiting on your yes';
    if (t.compacting) return 'Tidying the conversation up';
    if (t.todos?.current) return t.todos.current;
    if (t.planning) return 'Planning';
    if (t.crew) return `${plural(t.crew, 'helper')} out`;
    return 'Working';
  }

  const STANDING = {
    asking: { label: 'Waiting on you', tone: 'amber' },
    review: { label: 'Ready to review', tone: 'glass' },
    finished: { label: 'Finished', tone: 'glass' },
    working: { label: 'Working', tone: 'coral' },
    quiet: { label: 'Quiet', tone: 'dim' },
  };

  /** The beach's sections, in order, each with its tabs. Asking tabs are drawn as their prompts instead. */
  function sections(view) {
    const out = [];
    for (const key of ['review', 'finished', 'working', 'quiet']) {
      const tabs = (view?.tabs || []).filter(t => t.standing === key);
      if (tabs.length) out.push({ key, ...STANDING[key], tabs });
    }
    // An asking tab whose prompt is on its way (or one a helper is waiting on) still has to be somewhere.
    const promptTabs = new Set((view?.prompts || []).map(p => p.tabId));
    const lost = (view?.tabs || []).filter(t => t.standing === 'asking' && !promptTabs.has(t.id));
    if (lost.length) out.unshift({ key: 'asking', ...STANDING.asking, tabs: lost });
    return out;
  }

  const MODE_LABEL = { ask: 'Ask first', smart: 'Smart', acceptEdits: 'Auto-edit', plan: 'Plan only', autonomous: 'Autonomous', default: 'Ask first', bypassPermissions: 'Autonomous' };
  const modeLabel = m => MODE_LABEL[m] || '';

  // ---------------------------------------------------------------- a transcript

  /**
   * A live item added to a feed, newest last, at most max. A helper's step takes
   * the place of its last one of that kind: fold draws only its latest tool and
   * what it last said, and hundreds kept would push the conversation itself out.
   */
  function keepItem(items, item, max) {
    if (item.sub && item.k !== 'tool' && item.k !== 'text') return items;
    const rest = item.sub ? items.filter(x => !(x.sub && x.parent === item.parent && x.k === item.k)) : items;
    return [...rest, item].slice(-max);
  }

  /**
   * Phone items -> blocks to draw, in order:
   *   { type: 'user', text } | { type: 'text', text } | { type: 'tools', tools: [{ id, label, detail, state }] }
   *   { type: 'crew', lanes: [{ id, type, description, state, summary }] } | { type: 'asked', ... }
   *   { type: 'end', ... } | { type: 'changes', ... } | { type: 'note', text } | { type: 'checks', ... }
   * Helpers' own items (sub) only move their lane along; they aren't the main reply.
   */
  function fold(items) {
    const blocks = [];
    const tools = new Map();     // tool id -> its row
    const lanes = new Map();     // Agent tool id / task id -> its lane
    const asked = new Map();     // requestId -> its block
    const last = () => blocks[blocks.length - 1];
    for (const it of items || []) {
      if (!it || typeof it !== 'object') continue;
      if (it.sub) {
        const lane = lanes.get(it.parent);
        if (lane && it.k === 'tool') lane.activity = [it.label, it.detail].filter(Boolean).join(' ');
        if (lane && it.k === 'text') lane.said = it.text;
        continue;
      }
      switch (it.k) {
        case 'user': blocks.push({ type: 'user', text: it.text || '', turnId: it.turnId || null }); break;
        case 'text': {
          const prev = last();
          if (prev && prev.type === 'text') prev.text += `\n\n${it.text}`;
          else blocks.push({ type: 'text', text: it.text || '' });
          break;
        }
        case 'tool': {
          if (it.agent) {
            const lane = { id: it.id, type: it.agent.type || 'helper', description: it.agent.description || it.label || '', state: 'running', summary: '', activity: '' };
            lanes.set(it.id, lane);
            let crew = last();
            if (!crew || crew.type !== 'crew') { crew = { type: 'crew', lanes: [] }; blocks.push(crew); }
            crew.lanes.push(lane);
            break;
          }
          const row = { id: it.id, label: it.label || it.name || 'Tool', detail: it.detail || '', state: 'running', error: '' };
          tools.set(it.id, row);
          let group = last();
          if (!group || group.type !== 'tools') { group = { type: 'tools', tools: [] }; blocks.push(group); }
          group.tools.push(row);
          break;
        }
        case 'done': {
          const row = tools.get(it.id);
          if (row) { row.state = it.error ? 'error' : 'ok'; row.error = it.text || ''; }
          const lane = lanes.get(it.id);
          if (lane && lane.state === 'running') lane.state = it.error ? 'error' : 'ok';
          break;
        }
        case 'task': {
          const lane = lanes.get(it.toolUseId) || lanes.get(it.taskId);
          if (lane) {
            if (it.taskId) lanes.set(it.taskId, lane);
            if (it.phase === 'done') lane.state = /fail|error/i.test(it.status) ? 'error' : /stop|kill/i.test(it.status) ? 'stopped' : 'ok';
            if (it.summary) lane.summary = it.summary;
          }
          break;
        }
        case 'asked': {
          const b = { type: 'asked', requestId: it.requestId, label: it.label, detail: it.detail, decision: null, via: null };
          asked.set(it.requestId, b);
          blocks.push(b);
          break;
        }
        case 'decision': {
          const b = asked.get(it.requestId);
          if (b) { b.decision = it.decision; b.via = it.via; }
          break;
        }
        case 'end': {
          // A turn that ended stops whatever it left spinning on screen.
          for (const row of tools.values()) if (row.state === 'running') row.state = it.interrupted ? 'stopped' : 'ok';
          blocks.push({ type: 'end', ok: it.ok, interrupted: it.interrupted, error: it.error, seconds: it.seconds, tokens: it.tokens, share: it.share });
          break;
        }
        case 'changes': blocks.push({ type: 'changes', after: it.after, added: it.added, removed: it.removed, files: it.files || [], more: it.more || 0, undone: false }); break;
        case 'undone': {
          for (const b of blocks) if (b.type === 'changes' && b.after === it.after) b.undone = true;
          blocks.push({ type: 'note', text: 'Undone: the files are back as they were.' });
          break;
        }
        case 'checks': blocks.push({ type: 'checks', status: it.status, summary: it.summary }); break;
        case 'note': blocks.push({ type: 'note', what: it.what, text: it.text }); break;
        default: break;
      }
    }
    return blocks;
  }

  /** Words for an ended turn's line: "42s · 1.2k tokens · 3% of your window". */
  function endLine(b) {
    const bits = [];
    if (b.interrupted) bits.push('Stopped');
    else if (!b.ok) bits.push('Hit a problem');
    const d = duration(b.seconds);
    if (d) bits.push(d);
    const t = tokens(b.tokens);
    if (t) bits.push(t);
    if (Number.isFinite(b.share) && b.share > 0) bits.push(`${b.share < 1 ? '<1' : Math.round(b.share)}% of your window`);
    return bits.join(' · ');
  }

  // ---------------------------------------------------------------- markdown, a little

  /**
   * Claude's reply -> blocks of runs, never HTML: the phone builds elements
   * from these with textContent, so nothing in a reply is ever markup.
   *   { t: 'p' | 'h' | 'li' | 'oli' | 'quote', runs } | { t: 'code', text, lang }
   * runs: [{ text, b?, i?, code?, href? }]
   */
  function markdown(src) {
    const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [];
    const flush = () => { if (para.length) { out.push({ t: 'p', runs: inline(para.join(' ')) }); para = []; } };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fence = /^\s*(```|~~~)\s*([\w+-]*)/.exec(line);
      if (fence) {
        flush();
        const body = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
        out.push({ t: 'code', text: body.join('\n'), lang: fence[2] || '' });
        continue;
      }
      if (!line.trim()) { flush(); continue; }
      const head = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
      if (head) { flush(); out.push({ t: 'h', level: head[1].length, runs: inline(head[2]) }); continue; }
      const li = /^\s*[-*+]\s+(.*)$/.exec(line);
      if (li) { flush(); out.push({ t: 'li', runs: inline(li[1]) }); continue; }
      const oli = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
      if (oli) { flush(); out.push({ t: 'oli', n: Number(oli[1]), runs: inline(oli[2]) }); continue; }
      const quote = /^\s*>\s?(.*)$/.exec(line);
      if (quote) { flush(); out.push({ t: 'quote', runs: inline(quote[1]) }); continue; }
      if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) { flush(); out.push({ t: 'hr' }); continue; }
      para.push(line.trim());
    }
    flush();
    return out;
  }

  function inline(text) {
    const runs = [];
    const re = /(`+)([^`]+?)\1|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*?)\*|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g;
    let at = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > at) runs.push({ text: text.slice(at, m.index) });
      if (m[2] != null) runs.push({ text: m[2], code: true });
      else if (m[3] != null || m[4] != null) runs.push({ text: m[3] ?? m[4], b: true });
      else if (m[5] != null) runs.push({ text: m[5], i: true });
      else if (m[6] != null) runs.push({ text: m[6], href: m[7] });
      at = re.lastIndex;
    }
    if (at < text.length) runs.push({ text: text.slice(at) });
    return runs;
  }

  // ---------------------------------------------------------------- a diff

  /**
   * A unified diff -> files of hunks of rows.
   *   [{ path, hunks: [{ header, rows: [{ kind: 'add' | 'del' | 'ctx', text, a, b }] }], binary }]
   */
  function parsePatch(patch) {
    const files = [];
    let file = null, hunk = null, a = 0, b = 0;
    for (const line of String(patch ?? '').split('\n')) {
      if (line.startsWith('diff --git ')) {
        const m = / b\/(.+)$/.exec(line);
        file = { path: m ? m[1] : line.slice(11), hunks: [], binary: false };
        files.push(file);
        hunk = null;
        continue;
      }
      if (!file) continue;
      if (/^Binary files /.test(line)) { file.binary = true; continue; }
      if (line.startsWith('+++ ') || line.startsWith('--- ') || /^(index|new file|deleted file|similarity|rename|old mode|new mode) /.test(line)) continue;
      const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
      if (h) {
        a = Number(h[1]); b = Number(h[2]);
        hunk = { header: h[3].trim(), rows: [] };
        file.hunks.push(hunk);
        continue;
      }
      if (!hunk) continue;
      if (line.startsWith('+')) hunk.rows.push({ kind: 'add', text: line.slice(1), a: null, b: b++ });
      else if (line.startsWith('-')) hunk.rows.push({ kind: 'del', text: line.slice(1), a: a++, b: null });
      else if (line.startsWith('\\')) continue;
      else hunk.rows.push({ kind: 'ctx', text: line.slice(1), a: a++, b: b++ });
    }
    return files;
  }

  // ---------------------------------------------------------------- the phone

  /**
   * Where the app is: #/, #/tab/<id>, #/prompt/<id>/<requestId>, #/diff/<id>/<after>, #/branch/<id>, #/past/<id>,
   * #/files/<id>/<path>, #/queue, #/phone, #/new, #/find, #/history, #/more and its screens.
   */
  function route(hash) {
    const parts = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return ''; } });
    const ok = s => /^[\w-]{1,100}$/.test(s || '');
    if (parts[0] === 'tab' && ok(parts[1])) return { name: 'tab', tabId: parts[1] };
    // One permission prompt, from a tap on its notification: the PC says whether it's still waiting.
    if (parts[0] === 'prompt' && ok(parts[1]) && ok(parts[2])) return { name: 'prompt', tabId: parts[1], requestId: parts[2] };
    if (parts[0] === 'diff' && ok(parts[1]) && ok(parts[2])) return { name: 'diff', tabId: parts[1], after: parts[2] };
    if (parts[0] === 'branch' && ok(parts[1])) return { name: 'branch', tabId: parts[1] };
    if (parts[0] === 'past' && ok(parts[1])) return { name: 'past', id: parts[1] };
    // A file or folder inside a conversation's folder: the PC checks the path, this only carries it.
    if (parts[0] === 'files' && ok(parts[1])) {
      const rest = parts.slice(2);
      const dir = String(hash).endsWith('/') || !rest.length;
      return { name: 'files', tabId: parts[1], path: rest.join('/') + (dir && rest.length ? '/' : '') };
    }
    // share: what another app shared (the service worker keeps it); trophies: his XP card.
    if (['queue', 'phone', 'new', 'share', 'more', 'routines', 'notes', 'wardrobe', 'trophies', 'find', 'history', 'project-history'].includes(parts[0])) return { name: parts[0] };
    return { name: 'beach' };
  }

  /**
   * What a screen reader should hear when the view changes: a prompt that's
   * new since the last view, and a conversation that just finished (working
   * to review or finished). Nothing on the first view: that's just opening the app.
   */
  function announcements(prev, next) {
    if (!prev || !next) return [];
    const out = [];
    const had = new Set((prev.prompts || []).map(p => p.requestId));
    const fresh = (next.prompts || []).filter(p => !had.has(p.requestId));
    if (fresh.length === 1) out.push(`He needs you: ${fresh[0].title}.`);
    else if (fresh.length > 1) out.push(`${fresh.length} prompts need you.`);
    for (const t of next.tabs || []) {
      const was = (prev.tabs || []).find(x => x.id === t.id);
      if (was?.standing !== 'working' || !['review', 'finished'].includes(t.standing)) continue;
      if (t.outcome === 'error') out.push(`${t.title} hit a problem.`);
      else if (t.outcome !== 'stopped') out.push(`${t.title} is done.`);
    }
    return out;
  }

  const TAP_FRESH_MS = 2 * 60 * 1000;
  const TAP_SKEW_MS = 5000;

  /** Where a notification tapped a moment ago goes ('#/…'), as the service worker kept it; null when it's stale or not this app's. */
  function tappedHash(tap, now) {
    if (!tap || typeof tap.url !== 'string' || !Number.isFinite(tap.at) || now - tap.at > TAP_FRESH_MS || tap.at - now > TAP_SKEW_MS) return null;
    if (tap.url === '/') return '#/';
    return tap.url.startsWith('/#/') ? tap.url.slice(1) : null;
  }

  /** An iPhone or iPad's Safari (where only a Home Screen app keeps its storage and gets push). */
  function isIos(ua, touchPoints = 0) {
    const s = String(ua || '');
    return /iPhone|iPad|iPod/.test(s) || (/Macintosh/.test(s) && touchPoints > 1);
  }

  /** How long a list keeps still after the last scroll before the PC's update may redraw it. */
  const SETTLE_MS = 350;

  /** A redraw waits while a thumb is on the list or it's still coasting: iOS drops a scroll whose content is swapped out under it. */
  function holdRedraw({ touching = false, movedAt = 0 } = {}, now = Date.now()) {
    return !!touching || now - movedAt < SETTLE_MS;
  }

  /** A typed pairing code, as it's shown: upper case, a dash after four. */
  function formatCode(typed) {
    const s = String(typed ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
  }

  /** The base64url VAPID key -> the bytes pushManager.subscribe wants. */
  function keyBytes(b64) {
    const s = String(b64 || '').replace(/-/g, '+').replace(/_/g, '/');
    const bin = typeof atob === 'function' ? atob(s + '='.repeat((4 - (s.length % 4)) % 4)) : Buffer.from(s, 'base64').toString('binary');
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  }

  const api = {
    SETTLE_MS, STANDING, ago, announcements, awayLine, backoff, byDay, clock, day, dayLabel, doingLine, duration, endLine, fold, formatCode, headline, holdRedraw, inline, isIos, keepItem, keyBytes,
    markdown, modeLabel, parsePatch, plural, route, sections, sseParser, tappedHash, tokens,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PocketLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
