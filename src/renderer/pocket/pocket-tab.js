/* Shellby on your phone — one conversation (#/tab/<id>), live, with its
   prompt, its changes, a reply box and the buttons for its turn; and what one
   of its turns changed, file by file (#/diff/<id>/<after>). pocket.js hands in
   what it shares with the other screens. */
'use strict';
(function (root) {
  root.PocketTab = ({ S, L, D, N, h, icon, tabOf, toast, act, actButton, topbar, offlineBanner, promptCard, confirmSheet, celebrate, shortPath, shareTurn }) => {
    // ---------------------------------------------------------------- one conversation

    function tabScreen(tabId) {
      S.feeds.set(tabId, S.feeds.get(tabId) || { items: [], loaded: false });
      const header = h('div', { class: 'tab-head' });
      const feedEl = h('div', { class: 'feed', 'aria-live': 'off' });
      const asks = h('div', { class: 'feed-asks' });
      const scroll = h('div', { class: 'scroll' }, header, feedEl, asks);
      const foot = h('div', { class: 'foot' });
      const el = h('div', { class: 'screen tab-screen' }, topbar({ back: '#/' }), h('div', { class: 'offline-slot' }), scroll, foot);

      // The reply box is made once, so what you've typed stays while he works.
      const input = h('textarea', { class: 'reply-in', rows: '1', placeholder: 'Reply…', 'aria-label': 'Reply', maxlength: '4000', enterkeyhint: 'send' });
      input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(160, input.scrollHeight)}px`; });
      const send = actButton({
        label: 'Send', cls: 'go icon-only', iconName: 'send', aria: 'Send',
        run: async () => {
          const text = input.value.trim();
          if (!text) return;
          const r = await act('reply', { tabId, text });
          if (r.ok) { input.value = ''; input.style.height = ''; }
        },
      });
      const replyRow = h('div', { class: 'reply' }, input, send);
      const stop = actButton({
        label: 'Stop', cls: 'stop', iconName: 'stop', aria: 'Stop this turn',
        run: () => confirmSheet({ title: 'Stop him?', text: 'The turn ends where it is. Anything he changed so far stays, and Undo can take it back.', yes: 'Stop', danger: true, then: () => act('stop', { tabId }, { okText: 'Stopped.' }) }),
      });

      let stick = true;
      scroll.addEventListener('scroll', () => { stick = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80; }, { passive: true });
      const toBottom = () => { if (stick) requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; }); };

      function drawHeader(t) {
        const chips = [];
        if (t.mode) chips.push(h('span', { class: `pill ${t.mode === 'ask' ? 'dim' : t.mode === 'autonomous' ? 'coral' : ''}`, text: L.modeLabel(t.mode) }));
        if (t.copy) chips.push(h('span', { class: 'pill', text: 'own copy' }), h('span', { class: 'pill dim mono', text: t.copy.branch }));
        else if (t.folder) chips.push(h('span', { class: 'pill dim', text: t.folder }));
        if (t.fromPhone) chips.push(h('span', { class: 'pill dim', text: '📱 from your phone' }));
        const tools = [];
        if (S.view?.allow?.files) tools.push(h('a', { class: 'btn ghost slim', href: `#/files/${encodeURIComponent(tabId)}/` }, icon('folder'), h('span', { class: 'btn-label', text: 'Files' })));
        if (['review', 'finished'].includes(t.standing) && t.outcome !== 'error') tools.push(h('button', { type: 'button', class: 'btn ghost slim', onclick: () => shareTurn(t) }, icon('share'), h('span', { class: 'btn-label', text: 'Share' })));
        header.replaceChildren(h('h2', { class: 'tab-title', text: t.title }), h('div', { class: 'chips' }, ...chips), tools.length ? h('div', { class: 'tab-tools' }, ...tools) : '');
      }

      // Each reply's elements are kept between redraws, by where it is and what it says:
      // the same words twice in a conversation are two replies, not one moved.
      const mdCache = new Map();
      const md = (text, at) => {
        const key = `${at}\n${text}`;
        let node = mdCache.get(key);
        if (!node) { node = D.markdown(text); mdCache.set(key, node); if (mdCache.size > 400) mdCache.delete(mdCache.keys().next().value); }
        return node;
      };

      function drawBlock(b, i, all) {
        switch (b.type) {
          case 'user': return h('div', { class: 'msg-user' }, h('p', { text: b.text }));
          case 'text': return h('div', { class: 'msg-claude' }, md(b.text, i));
          case 'tools': {
            const many = b.tools.length > 4 && i < all.length - 1;
            const shown = many ? b.tools.slice(-2) : b.tools;
            const rows = shown.map(r => h('div', { class: `tool ${r.state}` },
              h('span', { class: 'tool-g', 'aria-hidden': 'true', text: { running: '◌', ok: '✓', error: '✕', stopped: '⊘' }[r.state] }),
              h('span', { class: 'tool-l', text: r.label }), h('span', { class: 'tool-d', text: r.detail })));
            if (!many) return h('div', { class: 'tools' }, ...rows);
            const det = h('details', { class: 'tools-more' }, h('summary', { text: `${L.plural(b.tools.length - 2, 'step')} before these` }),
              ...b.tools.slice(0, -2).map(r => h('div', { class: `tool ${r.state}` }, h('span', { class: 'tool-g', text: { running: '◌', ok: '✓', error: '✕', stopped: '⊘' }[r.state] }), h('span', { class: 'tool-l', text: r.label }), h('span', { class: 'tool-d', text: r.detail }))));
            return h('div', { class: 'tools' }, det, ...rows);
          }
          case 'crew': return h('div', { class: 'crew' }, ...b.lanes.map((lane, n) => h('div', { class: `lane ${lane.state} hue-${D.helperHue(n)}` },
            D.crab({ px: 1.4, state: lane.state === 'running' ? 'working' : lane.state === 'ok' ? 'success' : 'idle', hue: D.helperHue(n), label: '' }),
            h('div', { class: 'lane-words' }, h('b', { text: lane.type }), h('span', { text: lane.state === 'running' ? (lane.activity || lane.description) : (lane.summary || lane.description) })),
            h('span', { class: 'tool-g', text: { running: '◌', ok: '✓', error: '✕', stopped: '⊘' }[lane.state] }))));
          case 'asked': return h('div', { class: `asked ${b.decision || 'open'}` }, h('span', { text: b.decision ? `${b.decision === 'deny' ? 'Denied' : 'Allowed'}${b.via === 'pocket' ? ' from your phone' : b.via === 'phone' ? ' from a notification' : b.via === 'deck' ? ' on the Stream Deck' : ''}: ` : 'Asked: ' }), h('span', { class: 'mono', text: [b.label, b.detail].filter(Boolean).join(' ') }));
          case 'end': return b.ok || b.interrupted
            ? h('div', { class: 'turn-end', text: L.endLine(b) })
            : h('div', { class: 'trouble' }, h('b', { text: 'He hit a problem' }), h('p', { text: b.error || 'The turn ended with an error.' }), h('span', { class: 'turn-end', text: L.endLine(b) }));
          case 'changes': return changesCard(b);
          case 'checks': return h('div', { class: `note checks ${b.status}`, text: b.summary || `Checks: ${b.status}` });
          case 'note': return h('div', { class: `note ${b.what || ''}`, text: b.text });
          default: return null;
        }
      }

      function changesCard(b) {
        const files = b.files.slice(0, 6).map(f => h('li', {}, h('span', { class: 'mono', text: shortPath(f.path) }), h('span', { class: 'add', text: f.binary ? 'bin' : `+${f.added}` }), h('span', { class: 'del', text: f.binary ? '' : `−${f.removed}` })));
        const more = b.files.length + (b.more || 0) - 6;
        return h('div', { class: `changes${b.undone ? ' undone' : ''}` },
          h('div', { class: 'changes-head' }, icon('files'), h('b', { text: b.undone ? 'Changed, then undone' : `Changed ${L.plural(b.files.length + (b.more || 0), 'file')}` }), h('span', { class: 'add', text: `+${b.added}` }), h('span', { class: 'del', text: `−${b.removed}` })),
          h('ul', { class: 'changes-files' }, ...files, more > 0 ? h('li', { class: 'muted', text: `and ${more} more` }) : null),
          b.undone ? null : h('a', { class: 'btn ghost', href: `#/diff/${encodeURIComponent(tabId)}/${encodeURIComponent(b.after)}`, text: 'See the changes' }));
      }

      function drawFeed() {
        const feed = S.feeds.get(tabId);
        if (!feed.loaded) { feedEl.replaceChildren(h('div', { class: 'loading small' }, D.crab({ px: 2.5, state: 'working' }), h('p', { text: 'Fetching the conversation…' }))); return; }
        const blocks = L.fold(feed.items);
        const nodes = blocks.map((b, i) => drawBlock(b, i, blocks)).filter(Boolean);
        const typing = S.partial.get(tabId);
        if (typing) nodes.push(h('div', { class: 'msg-claude typing' }, D.markdown(typing), h('span', { class: 'caret', 'aria-hidden': 'true' })));
        if (!nodes.length) nodes.push(h('p', { class: 'muted pad', text: 'Nothing said yet.' }));
        feedEl.replaceChildren(...nodes);
        toBottom();
      }

      function drawFoot(t) {
        const parts = [];
        const prompts = (S.view?.prompts || []).filter(p => p.tabId === tabId);
        asks.replaceChildren(...prompts.map(p => promptCard(p)));
        if (t.busy) {
          const doing = h('div', { class: 'working-line' }, D.crab({ px: 1.5, state: 'working', label: '' }), h('span', { class: 'doing', text: L.doingLine(t) }),
            t.busySince ? h('span', { class: 'mono since', dataset: { since: t.busySince }, text: L.duration((Date.now() - t.busySince) / 1000) }) : null);
          parts.push(h('div', { class: 'foot-row' }, doing, stop));
        }
        const reviewing = t.ready && !t.busy && !t.pending;
        if (reviewing) parts.push(reviewBar(t));
        if (!t.busy && !t.pending) {
          if (t.canReply) parts.push(replyRow);
          else if (!reviewing) parts.push(h('p', { class: 'foot-note', text: S.view?.allow?.replyDesk ? 'Reply to this one at the desk: it isn’t in Ask first.' : 'Reply to this one at the desk. Your phone replies to the conversations it started, and to desk ones in Ask first if you allow it in Settings → On your phone.' }));
        }
        foot.replaceChildren(...parts);
      }

      function reviewBar(t) {
        const undo = actButton({
          label: 'Undo turn', cls: 'ghost', iconName: 'undo',
          run: () => confirmSheet({ title: 'Undo this turn?', text: `Puts back every file it changed (${L.plural(t.ready.files, 'file')}). The conversation stays.`, yes: 'Undo it', danger: true, then: () => act('undo', { tabId, after: t.ready.after }, { okText: 'Undone. The files are back.' }) }),
        });
        const home = t.copy ? actButton({
          label: 'Bring it home', cls: 'go', iconName: 'home',
          run: () => confirmSheet({
            title: 'Bring it home?', text: `Merges ${t.copy.branch} into ${t.copy.base}. Never a force-push: your checkout keeps its history.`, yes: 'Bring it home',
            then: async () => {
              const r = await act('home', { tabId }, { timeoutMs: 600000 });
              if (r.ok) { celebrate(t.title); toast(r.merged ? `Home in ${r.base || t.copy.base}${r.commits ? `, ${L.plural(r.commits, 'commit')}` : ''}.` : 'Nothing new to bring home.', { tone: 'ok', ms: 4200 }); } else if (r.red) confirmSheet({ title: 'His checks are red', text: `${r.error} Bring it home anyway?`, yes: 'Bring it home anyway', danger: true, then: () => act('home', { tabId, force: true }, { okText: 'Brought home.', timeoutMs: 600000 }) });
            },
          }),
        }) : actButton({ label: 'Looks good', cls: 'go', iconName: 'check', run: () => act('reviewed', { tabId, after: t.ready.after }, { okText: 'Marked as looked at.' }) });
        return h('div', { class: 'review-bar' },
          h('a', { class: 'btn ghost', href: `#/diff/${encodeURIComponent(tabId)}/${encodeURIComponent(t.ready.after)}` }, icon('files'), h('span', { text: 'Changes' }), h('span', { class: 'add', text: `+${t.ready.added}` }), h('span', { class: 'del', text: `−${t.ready.removed}` })),
          undo, home, pushHome(t));
      }

      // Bring it home and push, when Settings allows the phone to push. The desk's
      // secret scan and its question about other people's commits still come first.
      function pushHome(t) {
        if (!t.copy || !S.view?.allow?.push) return null;
        return actButton({
          label: 'Home and push', cls: 'ghost', iconName: 'send',
          run: () => confirmSheet({
            title: 'Bring it home and push?', text: `Merges ${t.copy.branch} into ${t.copy.base}, then pushes ${t.copy.base}. If your PC needs to ask you something first, it asks there.`, yes: 'Home and push',
            then: async () => {
              const r = await act('home', { tabId, push: true }, { timeoutMs: 600000 });
              if (!r.ok) return;
              celebrate(t.title);
              toast(r.pushed ? `Home in ${r.base || t.copy.base}, and pushed.` : `Home in ${r.base || t.copy.base}, but the push didn’t go${r.pushError ? `: ${r.pushError}` : '.'}`, { tone: r.pushed ? 'ok' : 'warn', ms: 6000 });
            },
          }),
        });
      }

      function update() {
        el.replaceChild(topbar({ back: '#/' }), el.firstChild);
        el.querySelector('.offline-slot').replaceChildren(offlineBanner() || '');
        const t = tabOf(tabId);
        if (!t) {
          header.replaceChildren(h('h2', { class: 'tab-title', text: S.view ? 'That conversation has closed' : 'Finding your PC…' }));
          foot.replaceChildren();
          asks.replaceChildren();
          if (S.view) feedEl.replaceChildren(h('p', { class: 'muted pad', text: 'It’s in History on your PC.' }), h('a', { class: 'btn', href: '#/', text: 'Back to the beach' }));
          return;
        }
        drawHeader(t);
        drawFoot(t);
        toBottom();
      }

      drawFeed();
      update();
      return { el, update, feed: drawFeed, tabId, title: tabOf(tabId)?.title || 'Conversation' };
    }

    // ---------------------------------------------------------------- what a turn changed

    function diffScreen(tabId, after) {
      const scroll = h('div', { class: 'scroll' });
      const bar = () => topbar({ back: `#/tab/${encodeURIComponent(tabId)}`, backLabel: 'Conversation' });
      const el = h('div', { class: 'screen' }, bar(), h('div', { class: 'offline-slot' }), scroll);
      const feed = S.feeds.get(tabId);
      const t = tabOf(tabId);
      // Opened straight from a link, before the transcript: the tab's own "ready" has the totals.
      const block = (feed ? L.fold(feed.items).find(b => b.type === 'changes' && b.after === after) : null)
        || (t?.ready?.after === after ? { added: t.ready.added, removed: t.ready.removed, files: (t.ready.paths || []).map(path => ({ path, added: 0, removed: 0 })), fromReady: true } : null);
      const head = h('div', { class: 'tab-head' }, h('h2', { class: 'tab-title', text: t?.title || 'Changes' }),
        block ? h('p', { class: 'muted' }, h('span', { class: 'add', text: `+${block.added}` }), ' ', h('span', { class: 'del', text: `−${block.removed}` }), ` · ${L.plural(block.fromReady ? t.ready.files : block.files.length, 'file')}`) : null);
      const list = h('div', { class: 'files' });
      scroll.append(head, list);
      // The per-file counts come with the transcript; without it, the whole diff at once.
      const files = block?.files?.length && !block.fromReady ? block.files : null;
      async function load(path, body, row) {
        body.replaceChildren(h('p', { class: 'muted small pad', text: 'Loading…' }));
        const r = await N.get('diff', { tab: tabId, after, ...(path ? { file: path } : {}) });
        if (!r.ok) { body.replaceChildren(h('p', { class: 'warn small pad', text: r.error || "Couldn't read that change." })); return; }
        const parsed = L.parsePatch(r.patch);
        const one = path ? parsed.find(f => f.path === path) || parsed[0] : null;
        body.replaceChildren(...(path ? [one ? D.diffFile(one) : h('p', { class: 'muted small pad', text: 'No line changes.' })] : parsed.map(f => h('div', {}, h('p', { class: 'file-name mono', text: f.path }), D.diffFile(f)))));
        if (r.truncated) body.append(h('p', { class: 'muted small pad', text: 'That’s as much as fits on a phone. The rest is on your PC.' }));
        row?.classList.add('loaded');
      }
      if (!files) {
        const body = h('div', { class: 'file-body' });
        list.append(body);
        load(null, body, null);
      } else {
        for (const f of files) {
          const body = h('div', { class: 'file-body' });
          const det = h('details', { class: 'file' },
            h('summary', {}, h('span', { class: 'mono file-path', text: shortPath(f.path) }), h('span', { class: 'add', text: f.binary ? 'bin' : `+${f.added}` }), h('span', { class: 'del', text: f.binary ? '' : `−${f.removed}` })),
            body);
          det.addEventListener('toggle', () => { if (det.open && !det.classList.contains('loaded')) load(f.path, body, det); });
          list.append(det);
        }
        if (files.length <= 3) list.querySelectorAll('details').forEach(d => { d.open = true; });
      }
      return { el, update: () => { el.replaceChild(bar(), el.firstChild); el.querySelector('.offline-slot').replaceChildren(offlineBanner() || ''); }, title: 'Changes' };
    }

    return { tabScreen, diffScreen };
  };
})(window);
