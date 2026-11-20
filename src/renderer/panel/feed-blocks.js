/* Shellby panel — the blocks in a conversation's feed. Part of Tab (feed.js):
   your message (with its rewind and branch buttons), a tool step and what came
   back from it (its diff folded inside, its pictures under it), a helper's lane
   and the task events that feed it, and the error block with the next step as a
   button. Also the attachment chips under a message and the picture thumbnails. */
'use strict';
(function () {
  const { h, api, state } = SB;
  const T = window.ShellbyTodos;

  // Edit rows whose diff isn't built yet -> { text (lower case), build() }, for find.js.
  const unbuiltDiffs = new WeakMap();
  SB.unbuiltDiffs = unbuiltDiffs;

  class FeedBlocks {
    // Something went wrong: what happened in a sentence, and the next step as a
    // button (main's trouble.js picks both). What the program said isn't shown,
    // it's in the log, and Copy details puts it on the clipboard. A transcript
    // from before Shellby said it this way shows the program's words, as it did.
    troubleBlock(trouble, raw) {
      const tab = /** @type {any} */ (this);
      if (!trouble?.message) {
        return h('div', { class: 'error-block raw' }, h('div', { class: 'error-raw', text: raw }), raw?.trim() ? SB.copyButton(() => raw, 'the error') : null);
      }
      const act = trouble.action && trouble.action.id !== 'copy'
        ? h('button', { class: 'btn slim-btn', type: 'button', onclick: () => SB.troubleAction(trouble.action.id, tab) }, trouble.action.label)
        : null;
      // Only when there's more to it than the sentence already says.
      const more = raw && !trouble.message.includes(raw.trim().replace(/\.$/, ''));
      const copy = more ? h('button', { class: 'btn ghost slim-btn', type: 'button', title: 'What the program said, word for word, for a bug report or a search',
        onclick: () => { api.copyText(raw); SB.toast('Copied the details.', { ms: 2500 }); } }, 'Copy details') : null;
      return h('div', { class: 'error-block trouble', role: 'alert', dataset: { kind: trouble.kind } },
        h('p', { class: 'trouble-text', text: trouble.message }),
        act || copy ? h('div', { class: 'trouble-actions' }, act, copy) : null);
    }

    renderUser(item, replay = false) {
      const tab = /** @type {any} */ (this);
      const routine = item.routine ? h('div', { class: 'routine-tag' }, '⟳ ', item.routine.name, item.routine.reason === 'catch-up' ? ' · catch-up run' : '') : null;
      // Ran on a cheaper model, as you picked on the card or chose for its kind (feed-savers.js).
      const onModel = item.model ? tab.modelTag(item, replay) : null;
      // Messages sent since rewind came in carry an id, and a way back to just
      // before them: in this tab (rewind), or in a new one that leaves this be (branch).
      // One read mid-turn (a steer) is part of the turn it went into, which keeps its id.
      if (!item.steerId) {
        tab.lastTurnId = item.turnId || null;
        tab.lastAsk = item.text || ''; // for Try again, after something goes wrong
      }
      // A steer has no point of its own to go back to (Shellby keeps the code
      // as it was between turns, not mid-turn), so it says so, and its ↶ goes
      // back to before the message whose turn it joined.
      const turnOf = item.steerId && !item.turnId ? item.turnOf || tab.lastTurnId : null;
      const steerTip = 'Sent while Claude was working, so it rewinds with the message before it: back to just before that one';
      const back = item.turnId ? h('button', { class: 'msg-rewind', type: 'button', title: 'Rewind to just before this message', 'aria-label': 'Rewind to just before this message', onclick: () => SB.openRewind(tab, item.turnId) })
        : turnOf ? h('button', { class: 'msg-rewind', type: 'button', title: steerTip, 'aria-label': steerTip, onclick: () => SB.openRewind(tab, turnOf) }) : null;
      const fork = item.turnId ? h('button', { class: 'msg-branch', type: 'button', title: 'Try again from here, in a new tab', 'aria-label': 'Try again from here, in a new tab', onclick: () => SB.openBranch(tab, item.turnId, 'before') }, SB.forkIcon()) : null;
      const steered = item.steerId ? h('div', { class: 'routine-tag', title: 'Claude read this between two steps of the turn before it' }, '↪ sent mid-turn') : null;
      tab.append(h('div', { class: 'msg user', dataset: item.turnId ? { turn: item.turnId } : {} }, back, fork, routine || steered || onModel, item.text || '',
        item.attachments?.length ? h('div', { class: 'att-list' }, SB.attachmentChips(item.attachments)) : null));
    }

    renderTool(item, replay) {
      const tab = /** @type {any} */ (this);
      // Files it touched are links to your editor; edits fold open to their diff.
      const file = item.filePath || (item.name === 'Read' && item.detail ? item.detail : null);
      const edits = item.edits?.length ? item.edits : null;
      const el = h('details', { class: `tool pending${item.sub ? ' sub' : ''}${edits ? ' edit' : ''}` },
        h('summary', {},
          h('span', { class: 't-state' }),
          h('span', { class: 't-label', text: item.label }),
          file
            ? SB.fileLink(file, { line: item.line, text: SB.relPath(file, tab.cwd), cls: 't-detail' })
            : h('span', { class: 't-detail', text: item.detail, title: item.detail }),
          edits ? SB.diffStats(edits) : null));
      el.dataset.toolId = item.id; // so trim() can forget it with the element
      // A picture Claude wrote or edited shows on its step once the write is done.
      if (item.filePath && isPicture(item.filePath)) el.dataset.picture = item.filePath;
      if (edits) {
        el.dataset.edit = '1';
        // Built on first open: a long conversation has hundreds of these. Until
        // then Ctrl+F looks in its text here, and builds it on a match (find.js).
        const build = () => {
          unbuiltDiffs.delete(el);
          if (!el.querySelector('.ediff')) el.querySelector('summary').after(SB.diffView(edits, { line: item.line, file: item.filePath }));
        };
        unbuiltDiffs.set(el, { text: edits.map(e => `${e.old || ''}\n${e.new || ''}`).join('\n').toLowerCase(), build });
        el.addEventListener('toggle', () => { if (el.open) build(); });
      }
      SB.decorateTool?.(tab, el, item); // a skill says what it's for, a memory what was kept (feed-native.js)
      tab.tools.set(item.id, el);
      tab.append(el, item.parent);
      // In plain words when there are some (plain-words.js), else the step as Claude Code names it;
      // a to-do ticked over: what Claude is on now, as its list words it.
      const todoNow = item.todo ? T.summary(tab.todos).current : null;
      const now = todoNow ? `${todoNow}…` : state.settings.plainCards !== false && item.doing ? `${item.doing}…` : `${item.label} ${item.detail}`.trim();
      if (!replay && !item.sub) tab.setStatus(now);
      const lane = item.parent && tab.lanes.get(item.parent);
      if (lane && !replay) lane.setActivity(now);
    }

    renderToolResult(item) {
      const tab = /** @type {any} */ (this);
      const lane = tab.lanes.get(item.id);
      if (lane) return lane.finish({ ok: !item.isError, stats: item.agentStats, resultText: item.text });
      const el = tab.tools.get(item.id);
      if (!el) return;
      el.classList.remove('pending');
      el.classList.add(item.isError ? (/declined|denied|interrupted/i.test(item.text) ? 'denied' : 'err') : 'ok');
      // A successful edit's result is "The file … has been updated"; the diff says it better.
      // A message sent, a to-do ticked: what the tool said back is noise unless it went wrong.
      // Its pictures stand in for the "[image]" Claude Code's text has where they were.
      const text = item.pictures?.length ? (item.text || '').replace(/^\[image\]$/gm, '').trim() : item.text;
      if (text?.trim() && !((el.dataset.edit || el.dataset.quiet) && !item.isError)) el.append(SB.resultBox(text, { err: !!item.isError }));
      if (item.isError) return;
      const label = el.querySelector('.t-label')?.textContent || 'this step';
      const pictures = [
        ...(item.pictures || []).map(id => () => api.toolPicture({ tabId: tab.id, id }).then(r => (r?.ok ? r.url : null))),
        ...(el.dataset.picture ? [() => api.filePicture(el.dataset.picture)] : []),
      ];
      if (pictures.length) el.after(pictureStrip(pictures, label));
    }

    // ------------------------------------------------------------ crew lanes
    renderLane(item, replay) {
      const tab = /** @type {any} */ (this);
      const index = tab.lanes.size;
      const lane = new SB.Lane(item, index);
      lane.el.dataset.laneId = item.id; // so trim() can forget it with the element
      tab.lanes.set(item.id, lane);
      tab.append(lane.el, item.parent);
      if (!replay) tab.setStatus(`Sent a helper: ${item.agent.description || item.agent.type}`);
    }

    renderTask(item, replay) {
      const tab = /** @type {any} */ (this);
      // A helper sent another message (SendMessage) starts again under that call's id:
      // it's still the lane its Agent call made, so the first id it had wins.
      if (item.toolUseId && item.taskId && (tab.lanes.has(item.toolUseId) || !tab.taskLane.has(item.taskId))) tab.taskLane.set(item.taskId, item.toolUseId);
      const lane = tab.lanes.get(tab.taskLane.get(item.taskId)) || tab.lanes.get(item.toolUseId);
      if (!lane) return;
      lane.update(item, replay);
    }
  }
  SB.extendTab(FeedBlocks);

  // Pictures get a thumbnail, fetched once per path (main reads the file; the
  // panel's CSP only loads images from data:).
  const thumbs = new Map();
  const isPicture = f => /\.(png|jpe?g|gif|webp)$/i.test(f);
  const thumbImg = f => {
    const img = h('img', { class: 'att-thumb', alt: '' });
    if (!thumbs.has(f)) thumbs.set(f, api.attachThumb(f).catch(() => null));
    thumbs.get(f).then(url => { if (url) img.src = url; else img.remove(); });
    return img;
  };

  // A step's pictures, under it rather than folded inside it, so they're seen
  // as the work goes. Fetched once they scroll into view (a long conversation
  // reopened from History can hold dozens); a click shows one at full width.
  const pictureStrip = (loaders, label) => {
    const strip = h('div', { class: 'tool-pics' });
    for (const load of loaders) {
      const img = h('img', { alt: `A picture from ${label}` });
      const btn = h('button', { class: 'tool-pic', type: 'button', title: 'Show bigger', 'aria-pressed': 'false' }, img);
      btn.addEventListener('click', () => btn.setAttribute('aria-pressed', String(btn.classList.toggle('big'))));
      btn.load = load;
      strip.append(btn);
    }
    const seen = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      seen.disconnect();
      for (const btn of [...strip.children]) {
        Promise.resolve().then(btn.load).catch(() => null).then(url => {
          if (url) btn.firstChild.src = url; else btn.remove();
          if (!strip.children.length) strip.remove();
        });
      }
    });
    seen.observe(strip);
    return strip;
  };

  // An @ pick's snapshot (src/main/wiring/mention-context.js) opens to exactly what goes to Claude.
  const isContext = f => /[\\/]context[\\/][0-9a-f]{8}[\\/][a-z0-9-]+\.txt$/.test(f);
  SB.attachmentChips = (files, onRemove) => files.map((f, i) => h('span', { class: `att${isPicture(f) ? ' pic' : ''}${isContext(f) ? ' ctx' : ''}`, title: isContext(f) ? 'From Shellby: open it to read exactly what Claude gets' : f },
    isPicture(f) ? thumbImg(f) : null,
    isContext(f) ? SB.fileLink(f, { text: SB.basename(f) }) : h('span', { text: SB.basename(f) }),
    onRemove ? h('button', { type: 'button', 'aria-label': `Remove ${SB.basename(f)}`, onclick: () => onRemove(i) }, '×') : null));

  // The next step after something went wrong, by trouble.js's action id. `tab`
  // is the conversation it happened in (or null, from a toast).
  SB.troubleAction = async (id, tab = SB.activeTab()) => {
    const ask = tab?.lastAsk || '';
    const signIn = async () => { if (await api.claudeLogin()) SB.toast('Finish signing in in the window that opened. Shellby notices when you’re done.', { ms: 6000 }); };
    const actions = {
      retry: () => {
        if (!tab || !ask) return SB.toast('Type your message again: there was nothing to resend.');
        SB.activate(tab.id);
        return SB.resend(tab, ask);
      },
      'sign-in': signIn,
      setup: () => { SB.onboardPath = 'claude'; SB.setView('onboarding'); },
      'fresh-tab': () => SB.newTabIn({ cwd: tab?.cwd || state.cwd, draft: ask }),
      remote: () => SB.showSetting('rcList'),
      hold: async () => {
        if (!tab || !ask) return SB.toast('Type your message again, then hold it with Ctrl+Shift+Enter.');
        const r = await api.holdForReset({ kind: 'message', tabId: tab.id, text: ask, attachments: [] });
        SB.toast(r?.ok ? `Held. It goes at ${r.atText}, once your usage resets.` : r?.error || "Couldn't hold it.", { ms: 5000 });
      },
    };
    return actions[id]?.();
  };
})();
