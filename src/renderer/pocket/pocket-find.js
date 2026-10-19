/* Shellby on your phone — looking back, and looking before bringing home:

     the beach's Search box, and the "While you were away" card
     #/find              past conversations, by title, your first prompt and Claude's summary
     #/project-history           one project's conversations, grouped by day, newest first
     #/past/<id>         a closed conversation, read-only, from History
     #/branch/<id>       a copy's whole branch against where it started
     the checks card on a conversation, with Fix it

   Each asks the PC when it opens (pocket/review.js answers), rather than
   riding the stream. pocket.js hands in what it shares with the other screens. */
'use strict';
(function (root) {
  root.PocketFind = ({ S, L, D, N, h, icon, live, go, act, actButton, topbar, offlineBanner, dock, openSheet, modePicker, refresh, loaded, transcript, shortPath }) => {
    const SEEN_KEY = 'shellby.pocket.seen';
    const HISTORY_KEY = 'shellby.pocket.history';
    const AWAY_MS = 10 * 60 * 1000;   // hidden this long, and the card says what happened meanwhile
    const SEEN_EVERY_MS = 60 * 1000;

    const hashOf = e => (e.open ? `#/tab/${encodeURIComponent(e.id)}` : `#/past/${encodeURIComponent(e.id)}`);
    const outcomePill = e => (e.outcome === 'error' ? h('span', { class: 'pill coral', text: 'hit a problem' }) : e.outcome === 'stopped' ? h('span', { class: 'pill dim', text: 'stopped' }) : e.outcome === 'cut' ? h('span', { class: 'pill dim', text: 'cut off' }) : e.done ? h('span', { class: 'pill', text: 'done' }) : null);

    /** One past conversation as a row: tap for its transcript (live when it's open). */
    function entryRow(e, extra = null) {
      return h('button', { type: 'button', class: 'card hist-row', onclick: () => go(hashOf(e)) },
        h('span', { class: 'card-t' }, h('span', { class: 'card-title', text: e.title }), e.open ? h('span', { class: 'pill', text: 'open' }) : outcomePill(e)),
        h('span', { class: 'card-m' }, e.folder ? h('span', { class: 'muted', text: e.folder }) : null, h('span', { class: 'muted', text: L.clock(e.at) }), e.copy ? h('span', { class: 'pill dim', text: 'own copy' }) : null, e.fromPhone ? h('span', { class: 'pill dim', text: '📱' }) : null),
        extra);
    }

    // ---------------------------------------------------------------- the beach: a box, and a card

    function searchRow() {
      const input = h('input', { type: 'search', class: 'find-in', placeholder: 'Find a past conversation…', 'aria-label': 'Search past conversations', enterkeyhint: 'search', maxlength: '300' });
      const run = () => { const q = input.value.trim(); if (!q) { input.focus(); return; } S.findQuery = q; go('#/find'); };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
      return h('div', { class: 'find-row' }, input,
        h('button', { type: 'button', class: 'btn slim', 'aria-label': 'Search', onclick: run }, icon('find')),
        h('a', { class: 'btn slim ghost', href: '#/project-history', 'aria-label': 'History' }, icon('clock')));
    }

    /** "While you were away: 2 finished, 1 waiting on you…", with a tap to each, until it's dismissed. */
    function awayCard() {
      const a = S.away;
      if (!a) return null;
      const dismiss = () => { S.away = null; markSeen(); refresh(); };
      const rows = [];
      for (const e of a.finished) rows.push(h('button', { type: 'button', class: 'away-row', onclick: () => go(hashOf(e)) }, h('span', { class: 'tool-g ok', text: '✓' }), h('span', { class: 'away-title', text: e.title })));
      for (const e of a.trouble) rows.push(h('button', { type: 'button', class: 'away-row', onclick: () => go(hashOf(e)) }, h('span', { class: 'tool-g err', text: '✕' }), h('span', { class: 'away-title', text: e.title })));
      for (const w of a.waiting) rows.push(h('button', { type: 'button', class: 'away-row', onclick: () => go(`#/tab/${encodeURIComponent(w.tabId)}`) }, h('span', { class: 'tool-g ask', text: '?' }), h('span', { class: 'away-title', text: w.title })));
      return h('section', { class: 'card away', 'aria-label': 'While you were away' },
        h('div', { class: 'card-t' }, h('span', { class: 'card-title' }, icon('clock'), ' While you were away'), h('button', { type: 'button', class: 'away-x', 'aria-label': 'Dismiss', text: '×', onclick: dismiss })),
        h('p', { class: 'away-line', text: `${L.awayLine(a)}. Since ${L.dayLabel(a.since).toLowerCase()} ${L.clock(a.since)}.` }),
        rows.length ? h('div', { class: 'away-rows' }, ...rows) : null);
    }

    // The phone keeps when it last looked. Back after a while, it asks what happened since.
    let pendingSince = null;
    const markSeen = () => N.store.set(SEEN_KEY, String(Date.now()));
    const lastSeen = () => Number(N.store.get(SEEN_KEY)) || 0;

    function cameBack() {
      const seen = lastSeen();
      if (seen && Date.now() - seen > AWAY_MS) pendingSince = seen;
      markSeen();
      if (pendingSince && live()) askAway();
    }

    async function askAway() {
      const since = pendingSince;
      pendingSince = null;
      const r = await N.post('away', { since });
      if (!r.ok) return;
      S.away = r.finished.length || r.trouble.length || r.waiting.length || r.turns ? { ...r, since } : null;
      refresh();
    }

    /** pocket.js calls this with each view: an answer owed from before the PC was reachable goes now. */
    function onView() { if (pendingSince && live()) askAway(); }

    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cameBack(); else markSeen(); });
    root.addEventListener('pageshow', e => { if (e.persisted) cameBack(); });
    setInterval(() => { if (document.visibilityState === 'visible') markSeen(); }, SEEN_EVERY_MS);
    cameBack(); // the app just opened

    // ---------------------------------------------------------------- search

    function findScreen() {
      const scroll = h('div', { class: 'scroll' });
      const el = h('div', { class: 'screen' }, topbar({ back: '#/' }), h('div', { class: 'offline-slot' }), scroll, dock('beach'));
      const input = h('input', { type: 'search', class: 'find-in', placeholder: 'A word or two…', 'aria-label': 'Search past conversations', enterkeyhint: 'search', maxlength: '300', value: S.findQuery || '' });
      const results = h('div', { class: 'find-results' });
      let page = 0, query = S.findQuery || '';
      async function search(more = false) {
        if (!query) return;
        if (!more) { page = 0; results.replaceChildren(h('div', { class: 'loading small' }, D.crab({ px: 2.5, state: 'working' }))); }
        const r = await N.post('find', { query, page });
        if (!r.ok) { results.replaceChildren(h('p', { class: 'warn pad', text: r.error || 'Your PC didn’t answer.' })); return; }
        const rows = r.results.map(e => entryRow(e, e.snippet ? h('span', { class: `snippet${e.said === 'you' ? ' you' : ''}`, text: e.snippet }) : null));
        if (!more) results.replaceChildren();
        else results.querySelector('.find-more')?.remove();
        results.append(...rows);
        if (!r.results.length && !more) results.append(h('div', { class: 'empty' }, h('p', { text: `Nothing about “${query}” in History.` })));
        if (r.more) results.append(h('button', { type: 'button', class: 'btn ghost find-more', text: 'More', onclick: () => { page++; search(true); } }));
      }
      const run = () => { query = input.value.trim(); S.findQuery = query; if (query) search(); else input.focus(); };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
      scroll.append(h('h2', { class: 'screen-title', text: 'Search' }),
        h('div', { class: 'find-row' }, input, h('button', { type: 'button', class: 'btn slim', 'aria-label': 'Search', onclick: run }, icon('find'))),
        h('p', { class: 'muted small', text: 'Titles, what you asked for and what Claude said he did, across every project.' }),
        results);
      let asked = false;
      const update = () => {
        el.replaceChild(topbar({ back: '#/' }), el.firstChild);
        el.querySelector('.offline-slot').replaceChildren(offlineBanner() || '');
        if (!asked && live() && query) { asked = true; search(); }
      };
      update();
      if (!query) setTimeout(() => input.focus(), 260);
      return { el, update, title: 'Search' };
    }

    // ---------------------------------------------------------------- a project's history

    function historyScreen() {
      let project = N.store.get(HISTORY_KEY) || '';
      const known = S.view?.projects || [];
      if (project && !known.some(p => p.key === project)) project = '';
      return loaded({
        title: 'History', active: 'beach', back: '#/', backLabel: 'Beach', name: 'project-history', body: { project: project || undefined, page: 0 },
        draw: d => {
          const chips = h('div', { class: 'projects', role: 'radiogroup', 'aria-label': 'Which project' },
            ...[{ key: '', name: 'Everything' }, ...known].map(p => h('button', {
              type: 'button', role: 'radio', 'aria-checked': p.key === project ? 'true' : 'false', class: `proj${p.key === project ? ' on' : ''}`, text: p.name,
              onclick: () => { N.store.set(HISTORY_KEY, p.key || null); go('#/project-history'); },
            })));
          const parts = [chips];
          if (!d.entries.length) parts.push(h('div', { class: 'empty' }, h('p', { text: project ? 'Nothing in History for this project yet.' : 'Nothing in History yet.' })));
          for (const day of L.byDay(d.entries)) {
            parts.push(h('h3', { class: 'sect' }, h('span', { text: day.label }), h('b', { text: day.entries.length })));
            for (const e of day.entries) parts.push(entryRow(e));
          }
          if (d.more) parts.push(h('p', { class: 'muted small pad', text: `Only the latest ${d.entries.length} are shown here; the rest are in History on your PC.` }));
          return parts;
        },
      });
    }

    // ---------------------------------------------------------------- a closed conversation, read-only

    function pastScreen(id) {
      return loaded({
        title: 'From History', active: 'beach', back: '#/project-history', backLabel: 'History', name: 'past', body: { id },
        draw: d => {
          // Open on the PC after all: it's live, so that screen has it.
          if (d.open) { setTimeout(() => go(`#/tab/${encodeURIComponent(id)}`), 0); return []; }
          const e = d.entry;
          const head = h('div', { class: 'tab-head' }, h('h2', { class: 'tab-title', text: e.title }),
            h('div', { class: 'chips' }, e.folder ? h('span', { class: 'pill dim', text: e.folder }) : null, outcomePill(e), e.copy ? h('span', { class: 'pill dim', text: 'own copy' }) : null,
              h('span', { class: 'pill dim', text: `${L.dayLabel(e.at)} ${L.clock(e.at)}` })),
            h('p', { class: 'muted small', text: 'Closed. Open it again to carry on where it left off.' }),
            actButton({ label: 'Open it again', cls: 'go', run: async () => { const r = await act('resume', { id }); if (r.ok) go(`#/tab/${encodeURIComponent(r.tabId)}`); } }));
          const nodes = transcript(d.items, { tabId: id, readOnly: true });
          return [head, h('div', { class: 'feed' }, ...(nodes.length ? nodes : [h('p', { class: 'muted pad', text: 'Nothing said yet.' })]))];
        },
      });
    }

    // ---------------------------------------------------------------- the whole branch

    function branchScreen(tabId) {
      const t = S.view?.tabs?.find(x => x.id === tabId);
      const back = `#/tab/${encodeURIComponent(tabId)}`;
      const scroll = h('div', { class: 'scroll' });
      const bar = () => topbar({ back, backLabel: 'Conversation' });
      const el = h('div', { class: 'screen' }, bar(), h('div', { class: 'offline-slot' }), scroll);
      const head = h('div', { class: 'tab-head' }, h('h2', { class: 'tab-title', text: t?.title || 'Everything' }));
      const list = h('div', { class: 'files' });
      scroll.append(head, list);
      let asked = false;
      async function fileBody(path, body, row) {
        body.replaceChildren(h('p', { class: 'muted small pad', text: 'Loading…' }));
        const r = await N.post('branch', { tabId, ...(path ? { file: path } : {}) }, { timeoutMs: 60000 });
        if (!r.ok) { body.replaceChildren(h('p', { class: 'warn small pad', text: r.error || "Couldn't read that change." })); return; }
        const parsed = L.parsePatch(r.patch);
        const one = path ? parsed.find(f => f.path === path) || parsed[0] : null;
        body.replaceChildren(...(path ? [one ? D.diffFile(one) : h('p', { class: 'muted small pad', text: 'No line changes.' })] : parsed.map(f => h('div', {}, h('p', { class: 'file-name mono', text: f.path }), D.diffFile(f)))));
        if (r.truncated) body.append(h('p', { class: 'muted small pad', text: 'That’s as much as fits on a phone. The rest is on your PC.' }));
        row?.classList.add('loaded');
      }
      async function load() {
        asked = true;
        list.replaceChildren(h('div', { class: 'loading small' }, D.crab({ px: 2.5, state: 'working' }), h('p', { text: 'Reading the branch…' })));
        const r = await N.post('branch', { tabId }, { timeoutMs: 60000 });
        if (!r.ok) { list.replaceChildren(h('div', { class: 'empty' }, h('p', { text: r.error || 'Your PC didn’t answer.' }))); return; }
        head.replaceChildren(h('h2', { class: 'tab-title', text: t?.title || 'Everything' }),
          h('p', { class: 'muted' }, h('span', { class: 'mono', text: r.branch }), ` against ${r.base} · `, h('span', { class: 'add', text: `+${r.added}` }), ' ', h('span', { class: 'del', text: `−${r.removed}` }), ` · ${L.plural(r.files.length + (r.more || 0), 'file')}`),
          h('p', { class: 'muted small', text: 'Everything Bring it home would bring: every turn, and anything left uncommitted.' }));
        list.replaceChildren();
        if (!r.files.length) { list.append(h('div', { class: 'empty' }, h('p', { text: 'Nothing on this branch yet that its base hasn’t got.' }))); return; }
        // Three files or fewer come whole; more are opened one at a time, as See the changes does.
        if (typeof r.patch === 'string') {
          const body = h('div', { class: 'file-body' });
          list.append(body);
          const parsed = L.parsePatch(r.patch);
          body.replaceChildren(...parsed.map(f => h('div', {}, h('p', { class: 'file-name mono', text: f.path }), D.diffFile(f))));
          if (r.truncated) body.append(h('p', { class: 'muted small pad', text: 'That’s as much as fits on a phone. The rest is on your PC.' }));
          return;
        }
        for (const f of r.files) {
          const body = h('div', { class: 'file-body' });
          const det = h('details', { class: 'file' },
            h('summary', {}, h('span', { class: 'mono file-path', text: shortPath(f.path) }), h('span', { class: 'add', text: f.binary ? 'bin' : `+${f.added}` }), h('span', { class: 'del', text: f.binary ? '' : `−${f.removed}` })),
            body);
          det.addEventListener('toggle', () => { if (det.open && !det.classList.contains('loaded')) fileBody(f.path, body, det); });
          list.append(det);
        }
        if (r.more) list.append(h('p', { class: 'muted small pad', text: `And ${r.more} more on your PC.` }));
      }
      const update = () => {
        el.replaceChild(bar(), el.firstChild);
        el.querySelector('.offline-slot').replaceChildren(offlineBanner() || '');
        if (!asked && live()) load();
      };
      update();
      return { el, update, title: 'Everything' };
    }

    // ---------------------------------------------------------------- checks, with Fix it

    const details = new Map(); // `${tabId}:${after}:${status}` -> what the PC said, or a promise of it

    function checksCard(tabId, t) {
      const c = t.checks;
      if (!c) return null;
      const status = c.status;
      const word = { pass: 'Checks passed', fail: 'Checks failed', running: 'Checking…', timeout: 'Checks ran out of time', error: 'Checks couldn’t run' }[status] || `Checks: ${status}`;
      const card = h('div', { class: `card checks-card ${status}` },
        h('div', { class: 'card-t' }, h('span', { class: 'card-title' }, h('span', { class: 'tool-g', 'aria-hidden': 'true', text: { pass: '✓', fail: '✕', running: '◌', timeout: '⊘', error: '✕' }[status] || '' }), ` ${word}`)));
      if (status === 'pass' || status === 'running') return card;
      const key = `${tabId}:${c.after}:${status}`;
      let got = details.get(key);
      if (!got) {
        got = N.post('checks', { tabId }).then(r => { if (!r.ok) details.delete(key); return r; });
        details.set(key, got);
        while (details.size > 20) details.delete(details.keys().next().value);
      }
      const body = h('div', { class: 'checks-body' }, h('p', { class: 'muted small', text: 'Loading…' }));
      card.append(body);
      const canFix = () => { const now = S.view?.tabs?.find(x => x.id === tabId); return !!now?.canReply && !now.busy && !now.pending && now.checks?.status !== 'running'; };
      got.then(r => {
        if (!r.ok) { body.replaceChildren(h('p', { class: 'warn small', text: r.error || 'Your PC didn’t say.' })); return; }
        const parts = [];
        for (const cmd of r.commands.filter(x => !x.ok)) {
          parts.push(h('div', { class: 'check-cmd' },
            h('p', { class: 'cmd-file' }, h('span', { class: 'mono', text: cmd.cmd }), cmd.timedOut ? ' ran out of time' : cmd.error ? ` · ${cmd.error}` : cmd.failed.length ? `: ${cmd.failed.join(', ')}` : ' failed'),
            cmd.tail ? h('pre', { class: 'cmd tail', text: cmd.tail }) : null));
        }
        if (r.canFix && canFix()) {
          parts.push(actButton({ label: 'Fix it', cls: 'go slim', iconName: 'check', run: () => fixSheet(tabId, t) }));
        } else if (r.commands.some(x => !x.ok)) {
          parts.push(h('p', { class: 'muted small', text: t.busy ? 'He’s busy: Fix it comes back when this turn ends.' : !t.canReply ? 'It’s in a terminal on your PC now, so Fix it goes from there.' : 'Answer what’s waiting first, then Fix it.' }));
        }
        body.replaceChildren(...parts);
      });
      return card;
    }

    // Fix it is a reply: it goes in the mode you pick, under the reply's own rules.
    function fixSheet(tabId, t) {
      return new Promise(resolve => {
        openSheet({ label: 'Fix the checks', build: close => {
          const mode = modePicker(t.mode);
          const send = actButton({
            label: 'Fix it', cls: 'go big',
            run: async () => {
              const r = await act('checks-fix', { tabId, mode: mode.value }, { okText: 'Sent. He’s on the checks.' });
              if (r.ok) { close(); go(`#/tab/${encodeURIComponent(tabId)}`); }
              resolve(r.ok);
            },
          });
          const el = h('div', { class: 'confirm' },
            h('h2', { class: 'sheet-title', text: 'Ask him to fix the checks?' }),
            h('p', { text: 'Sends what failed, with the tail of its output, as a reply. He fixes it, runs the checks again and commits.' }),
            h('label', { class: 'mode-row' }, h('span', { text: 'Mode' }), mode),
            h('div', { class: 'btns' }, h('button', { type: 'button', class: 'btn big', text: 'Not now', onclick: () => { close(); resolve(false); } }), send));
          return { el };
        } });
      });
    }

    return { searchRow, awayCard, onView, findScreen, historyScreen, pastScreen, branchScreen, checksCard };
  };
})(window);
