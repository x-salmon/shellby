/* Shellby panel — the usage forecast and "after the reset": the banner above
   the box, held messages alongside the queued ones, and Ctrl+Shift+Enter to
   hold what you've typed. Main works out the forecast and does the holding
   and sending (src/main/forecast.js, held.js); this only shows it. The same
   banner carries two quieter tips while you type: a cold cache this message
   would pay for, and, for a conversation that hasn't started, a past one
   that asked much the same (src/main/history/similar.js) or Sonnet. */
'use strict';
(function () {
  const { h, api, state, $ } = SB;
  const input = $('input');
  let dismissed = null; // the reset whose warning you closed: it stays closed for that window
  let dismissedEstimate = null; // the tab whose "this usually takes…" you closed, until its box empties
  let dismissedTip = null;      // the tab whose tip you closed, until its box empties

  SB.applyOutlook = o => {
    state.outlook = o || null;
    SB.refreshUsage?.();
    SB.renderQueue?.(); // held chips, and the banner with them
    if (state.view === 'routines') SB.views.routines?.render();
  };

  // Which note, which actions and the words for them live in shared/outlook-format.js.
  const W = window.ShellbyOutlookFormat;
  const heldFor = tab => W.heldFor(state.outlook, tab.id);

  // ------------------------------------------------------------ banner

  function renderOutlook() {
    const box = $('outlook');
    const o = state.outlook;
    const tab = SB.activeTab();
    const big = liveEstimate();
    renderCostHint(big);
    // At the limit beats an estimate that this message would go over, which beats
    // a warning, which beats a tip. A warning you closed lets a tip through.
    const warned = W.noteFor(o);
    const tip = tipFor(big);
    const note = !o?.limit && big?.over && dismissedEstimate !== big.tabId
      ? { text: overText(big), key: null, cls: 'warning', estimate: true }
      : warned && dismissed !== warned.key ? warned : tip;
    const show = !!note && !!tab && (note.estimate || note.tip || dismissed !== note.key) && !SB.isCrabOnly?.();
    box.hidden = !show;
    if (!show) { box.replaceChildren(); return; }
    box.className = `outlook ${note.cls}`;
    const typed = !!input.value.trim() || tab.attachments.length > 0;
    const queued = tab.queue.length;
    const actions = note.tip ? note.actions : note.estimate ? [
      // A prompt, never a block: Enter still sends, and so does this.
      h('button', { class: 'btn slim-btn ghost', type: 'button', onclick: () => SB.send(undefined, { force: true }) }, 'Send anyway'),
      o?.resetAt ? h('button', { class: 'btn slim-btn', type: 'button', title: 'Ctrl+Shift+Enter', onclick: holdTyped }, 'Send after the reset') : null,
    ].filter(Boolean) : W.actionsFor({ resetAt: o.resetAt, typed, queued }).map(kind => (
      kind === 'send-typed' ? h('button', { class: 'btn slim-btn', type: 'button', title: 'Ctrl+Shift+Enter', onclick: holdTyped }, 'Send after the reset')
        : kind === 'hold-queue' ? h('button', { class: `btn slim-btn${typed ? ' ghost' : ''}`, type: 'button', onclick: () => holdQueue(tab) }, `Hold ${queued} queued`)
          : h('span', { class: 'outlook-hint' }, h('kbd', { text: 'Ctrl+Shift+Enter' }), ' in the box holds a message for then')));
    box.replaceChildren(...[
      SB.icon(SB.ICONS.clock, { width: 1.4 }),
      h('span', { class: 'outlook-text', text: note.text }),
      note.estimate || note.tip
        ? h('button', { class: 'queue-x icon-btn', type: 'button', 'aria-label': 'Hide this for this message', title: 'Hide this for this message', onclick: () => { if (note.tip) dismissedTip = big.tabId; else dismissedEstimate = big.tabId; renderOutlook(); } },
          SB.icon('M4.5 4.5l7 7M11.5 4.5l-7 7', { width: 1.5 }))
        : h('button', { class: 'queue-x icon-btn', type: 'button', 'aria-label': 'Hide until the reset', title: 'Hide until the reset', onclick: () => { dismissed = note.key; renderOutlook(); } },
        SB.icon('M4.5 4.5l7 7M11.5 4.5l-7 7', { width: 1.5 })),
      actions.length ? h('div', { class: 'outlook-actions' }, actions) : null,
    ].filter(Boolean));
  }
  SB.renderOutlook = renderOutlook;
  // Whether there's anything to send after the reset changes as you type, and so
  // does what it usually costs.
  input.addEventListener('input', () => {
    if (state.outlook?.warning || state.outlook?.limit || state.estimate) renderOutlook();
    scheduleEstimate();
  });

  // ------------------------------------------------------------ what this usually costs (src/main/usage/ledger.js)

  const EST_DELAY_MS = 450;   // after you stop typing for a moment
  const EST_MIN_CHARS = 15;   // shorter than this says too little to guess from
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let estTimer;
  let estSeq = 0;
  state.estimate = null;      // { tabId, text, ...main's estimate }

  const pctText = n => (n < 1 ? 'under 1%' : `${Math.round(n)}%`);
  // "about 3%", but never "about under 1%".
  const aboutPct = n => (n < 1 ? pctText(n) : `about ${pctText(n)}`);
  const KIND_NOUN = {
    question: 'questions', review: 'reviews', tests: 'test tasks', fix: 'fixes', feature: 'new features',
    refactor: 'refactors', docs: 'docs tasks', tidy: 'tidy-ups', other: 'tasks',
  };
  const typedNow = () => input.value.trim();
  // A /model switch is looked at too: it can throw a warm cache away.
  const estimable = t => /^\/model\s+\S/i.test(t) || (t.length >= EST_MIN_CHARS && !t.startsWith('!') && !t.startsWith('/'));

  // The estimate, while it's still about what's in the box of the tab on screen.
  function liveEstimate() {
    const e = state.estimate;
    const tab = SB.activeTab();
    return e && tab && e.tabId === tab.id && estimable(typedNow()) ? e : null;
  }

  // "from 12 similar fixes in shellby": what the guess is drawn from.
  function basisText(e) {
    const n = e.samples;
    const kind = KIND_NOUN[e.category] || 'tasks';
    if (e.basis === 'project+kind') return `From ${n} similar ${kind} in ${e.project}`;
    if (e.basis === 'project') return `From your last ${n} tasks in ${e.project}`;
    return `From ${n} similar ${kind} across your projects`;
  }

  function overText(e) {
    const until = e.guardOn ? 'before he stops' : 'before your limit';
    return `This usually takes ${aboutPct(e.pct)} and you've ${pctText(e.left)} left ${until}.`;
  }

  // ------------------------------------------------------------ tips (src/main/cachebreak.js, usage/ledger.js)

  // A short message into a big conversation whose cache went cold sends all of
  // it again: one that doesn't need the conversation costs far less in a new tab.
  // Else, a conversation not started yet, on a top model, for a kind of ask
  // that usually suits Sonnet. Either way Enter still sends as it is.
  function tipFor(e) {
    if (!e || dismissedTip === e.tabId) return null;
    const tab = SB.activeTab();
    // A model switch mid-conversation: each model has a cache of its own.
    if (e.rebuild) {
      return {
        tip: true, cls: 'quiet', key: null,
        text: `Each model keeps a cache of its own, so after this switch the next message sends this conversation's ~${SB.compact(e.rebuild.tokens)} tokens again at full price. A new tab on that model starts cheaper if this one isn't needed.`,
        actions: [h('button', { class: 'btn slim-btn', type: 'button', title: 'The switch goes to a new tab in this folder, which starts on that model.', onclick: () => askInNewTab(tab) }, 'Switch in a new tab')],
      };
    }
    // Not with files attached: a new tab would leave them behind.
    if (e.cold && !tab?.attachments.length) {
      return {
        tip: true, cls: 'quiet', key: null,
        text: `This conversation's cache went cold ${SB.relTime(e.cold.coldSince)}, so sending this pays for its ~${SB.compact(e.cold.tokens)} tokens again in full. If it doesn't need this conversation, a new tab costs far less.`,
        actions: [h('button', { class: 'btn slim-btn', type: 'button', onclick: () => askInNewTab(tab) }, 'Ask in a new tab')],
      };
    }
    // Before Sonnet: the answer you already have costs nothing at all.
    if (e.before && tab) {
      const b = e.before;
      return {
        tip: true, cls: 'quiet', key: null,
        text: beforeText(b),
        actions: [
          h('button', { class: 'btn slim-btn', type: 'button', title: 'That conversation goes with this message as context', onclick: () => bringIn(tab, b) }, 'Bring it in'),
          h('button', { class: 'btn slim-btn ghost', type: 'button', title: b.ask || b.title, onclick: () => openBefore(tab, b) }, 'Open it'),
        ],
      };
    }
    if (e.suggest) {
      const kind = KIND_NOUN[e.category] || 'tasks';
      return {
        tip: true, cls: 'quiet', key: null,
        text: `${kind[0].toUpperCase()}${kind.slice(1)} like this usually take ${aboutPct(e.suggest.pct)} of your window on this model${e.suggest.measured ? `, and ${pctText(e.suggest.cheaper)} on Sonnet for you` : `; Sonnet usually costs ${aboutPct(e.suggest.cheaper)}`}.`,
        actions: [h('button', { class: 'btn slim-btn', type: 'button', title: 'This conversation starts on Sonnet. Others keep the model in Settings.', onclick: () => useSonnet(tab) }, 'Start this one on Sonnet')],
      };
    }
    return null;
  }

  // What's in the box goes to a new tab in the same folder, and leaves this one.
  function askInNewTab(tab) {
    if (!tab) return;
    const text = input.value;
    SB.clearComposer(tab);
    SB.newTabIn({ cwd: tab.cwd, draft: text });
  }

  async function useSonnet(tab) {
    if (!tab) return;
    const r = await api.setTabModel(tab.id, 'sonnet').catch(() => null);
    if (!r?.ok) return SB.toast(r?.error || "Couldn't change its model.", { ms: 6000 });
    dismissedTip = tab.id;
    SB.toast('This conversation starts on Sonnet.');
    renderOutlook();
  }

  function renderCostHint(e = liveEstimate()) {
    const el = $('costHint');
    const show = !!e && e.basis !== 'none' && !e.over && !SB.isCrabOnly?.();
    el.hidden = !show;
    if (!show) { el.textContent = ''; el.removeAttribute('title'); return; }
    el.textContent = `usually ${aboutPct(e.pct)} of your window`;
    el.title = `${basisText(e)}. Most land between ${pctText(e.low)} and ${pctText(e.high)}.`;
  }

  function scheduleEstimate() {
    clearTimeout(estTimer);
    if (!estimable(typedNow())) {
      dismissedEstimate = null; // the next message gets its own heads-up
      dismissedTip = null;
      if (state.estimate) { state.estimate = null; renderOutlook(); }
      return;
    }
    estTimer = setTimeout(refreshEstimate, EST_DELAY_MS);
  }

  // The box was emptied (sent, held, cleared): nothing to estimate, and the next
  // message gets its own heads-up. A lookup still on its way is ignored.
  SB.resetEstimate = () => {
    clearTimeout(estTimer);
    estSeq++;
    dismissedEstimate = null;
    dismissedTip = null;
    if (!state.estimate) return;
    state.estimate = null;
    renderOutlook();
  };

  async function refreshEstimate() {
    const tab = SB.activeTab();
    const text = typedNow();
    const seq = ++estSeq;
    if (!tab || !estimable(text) || SB.isCrabOnly?.()) return;
    const [r, similar] = await Promise.all([
      api.estimateUsage({ tabId: tab.id, text }).catch(() => null),
      // Only before the first message: main says the same (ipc/mentions.js).
      !tab.saved && state.settings?.askedBefore !== false ? api.context.similar(tab.id, text).catch(() => []) : [],
    ]);
    if (seq !== estSeq) return; // you've typed on since
    const before = Array.isArray(similar) && similar[0] ? similar[0] : null;
    state.estimate = (r && (r.basis !== 'none' || r.rebuild || r.cold || r.suggest)) || before
      ? { basis: 'none', ...r, before, tabId: tab.id, text } : null;
    renderOutlook();
  }

  // ------------------------------------------------------------ "You've asked this before" (src/main/history/similar.js)

  function beforeText(b) {
    const when = SB.relTime(b.updatedAt);
    return `You asked something like this ${when === 'just now' ? 'just now' : when.endsWith('ago') ? when : `on ${when}`}: “${b.title}”${b.done ? ', ticked off as done' : ''}. Its answer may save working it out again.`;
  }

  // Its whole conversation goes in the box as context, as an @ pick of it would.
  async function bringIn(tab, b) {
    const r = await api.context.attach(tab.id, `chat:${b.id}`).catch(() => null);
    if (!r?.ok) return SB.toast(r?.error || "Couldn't bring it in.");
    dismissedTip = tab.id;
    if (SB.activeTab() === tab) SB.addAttachments([r.path]);
    else if (!tab.attachments.includes(r.path)) tab.attachments.push(r.path);
    renderOutlook();
  }

  // In a tab of its own; what you've typed stays in this one's box.
  function openBefore(tab, b) {
    dismissedTip = tab.id;
    renderOutlook();
    SB.openHistory(b.id);
  }

  // "Hold big tasks for the reset" (Settings): SB.send asks before sending.
  // -> true when it was held, false to send as usual.
  SB.holdIfBig = async (tab, text, attachments) => {
    // Commands (/compact, ! runs) go now: holding one would only get in the way.
    if (!state.settings.holdBigTasks || !text || text.startsWith('!') || text.startsWith('/')) return false;
    const est = await api.estimateUsage({ tabId: tab.id, text }).catch(() => null);
    if (!est?.hold) return false;
    const r = await hold(tab, text, attachments);
    if (!r.ok) return false; // couldn't hold it (no reset known yet): it goes now, as it would have
    state.estimate = null;
    SB.toast(`Held for the reset at ${r.atText} — it usually takes ~${pctText(est.pct)}.`, {
      ms: 6000, action: 'Send now', onAction: () => sendHeldNow(tab, r.id),
    });
    return true;
  };

  // Changed your mind: out of the hold and on its way.
  async function sendHeldNow(tab, id) {
    const r = await api.cancelHeld(id);
    if (!r.ok) return SB.toast('That one has already gone.');
    if (!(await SB.sendDirect(tab, r.item.text, r.item.attachments || []))) SB.handBack(tab, r.item.text, r.item.attachments || []);
  }

  // ------------------------------------------------------------ holding

  async function hold(tab, text, attachments) {
    const r = await api.holdForReset({ kind: 'message', tabId: tab.id, text, attachments });
    if (!r.ok) SB.toast(r.error, { ms: 5000 });
    return r;
  }

  // What's in the box, held until the reset. The box empties at once (so a
  // second press, or switching tabs, can't hold or wipe the wrong thing) and
  // gets it back if it can't be held.
  let holding = false;
  async function holdTyped() {
    const tab = SB.activeTab();
    if (!tab || holding) return;
    const text = input.value.trim();
    const attachments = [...tab.attachments];
    if (!text && !attachments.length) return;
    // Not before the reset time is known, and never a ! command (composer.js runs those now).
    const refusal = W.holdRefusal(text, state.outlook?.resetAt);
    if (refusal) return SB.toast(refusal.text, refusal.ms ? { ms: refusal.ms } : undefined);
    holding = true;
    SB.clearComposer(tab);
    try {
      const r = await hold(tab, text, attachments);
      if (r.ok) SB.toast(`Held. It goes at ${r.atText}, once your usage resets.`, { ms: 4000 });
      else SB.handBack(tab, text, attachments);
    } finally {
      holding = false;
    }
  }

  // Everything queued in a tab, held instead (oldest first, so they go in order).
  async function holdQueue(tab) {
    // Taken out first: a turn ending meanwhile would otherwise send them too.
    // Not what Claude is reading already (main's 'steering').
    const taken = tab.queue.filter(m => !m.taken);
    tab.queue = tab.queue.filter(m => m.taken);
    SB.syncSteers(tab); // nor steer them into the turn that's running
    let n = 0, at = null;
    for (const m of taken) {
      const r = await hold(tab, m.text, m.attachments);
      if (!r.ok) { tab.queue.unshift(...taken.slice(n)); break; }
      n++;
      at = r.atText;
    }
    if (!tab.queue.length) tab.queuePaused = false;
    if (tab.isActive) SB.syncBusyUi();
    if (n) SB.toast(W.queueHeldText(n, at), { ms: 4000 });
  }
  SB.holdQueue = holdQueue;

  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.ctrlKey || !e.shiftKey || e.altKey || e.isComposing) return;
    e.preventDefault();
    holdTyped();
  });

  // ------------------------------------------------------------ held messages, with the queue

  // Chips for the queue strip (tabs.js renderQueue): click to edit (it comes
  // back to the box and is no longer held), ✕ to drop it.
  SB.heldChips = tab => heldFor(tab).map(m => h('div', { class: 'queue-item held' },
    h('span', { class: 'queue-tag', title: `Held until your usage resets: goes at ${m.atText}`, text: m.atText }),
    h('button', { class: 'queue-text', type: 'button', title: 'Edit (puts it back in the box; it won\'t wait for the reset)', onclick: () => unhold(tab, m.id, true) }, W.describe(m)),
    h('button', { class: 'queue-x icon-btn', type: 'button', 'aria-label': 'Don\'t send after the reset', onclick: () => unhold(tab, m.id, false) },
      SB.icon('M4.5 4.5l7 7M11.5 4.5l-7 7', { width: 1.5 }))));

  async function unhold(tab, id, edit) {
    const r = await api.cancelHeld(id);
    if (!r.ok) return; // already sent, or already gone
    if (edit && SB.handBack(tab, r.item.text, r.item.attachments) && tab.isActive) input.focus();
  }

  // ------------------------------------------------------------ from main

  api.onOutlook(SB.applyOutlook);
  // A held message went out after the reset.
  api.onTabSent(({ tabId, item }) => {
    const tab = state.tabs.get(tabId);
    if (tab && item) SB.markSent(tab, item.text, item.attachments || [], item.turnId);
  });
  // One that couldn't go: back in its box, never lost.
  api.onHeldReturned(({ tabId, text, attachments, error }) => {
    const tab = state.tabs.get(tabId);
    if (!tab) return;
    SB.handBack(tab, text, attachments || []);
    SB.toast(`A held message couldn't be sent${error ? ` (${error})` : ''}. It's back in its box.`, { ms: 6000 });
  });
})();
