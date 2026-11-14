/* Shellby panel — the message box: what's attached, sending, the busy line
   under it with its clock, Stop, and dropping or pasting files in. The queue
   behind a running turn is tab-queue.js, the slash menu slash-menu.js. */
'use strict';
(function () {
  const { api, state, $ } = SB;
  const L = window.ShellbyTabLogic;
  const input = $('input');
  // Theirs, reached when they're called (the files load after this one).
  const renderQueue = () => SB.renderQueue();
  const syncSteers = tab => SB.syncSteers(tab);
  const queueItem = (text, attachments, selected) => SB.queueItem(text, attachments, selected);
  const editQueued = (tab, i) => SB.editQueued(tab, i);
  const updateSlash = () => SB.updateSlash();
  const slashKeydown = e => SB.slashKeydown(e);

  // ------------------------------------------------------------ busy / status

  function syncBusyUi() {
    const tab = SB.activeTab();
    const busy = !!tab?.busy;
    const pause = L.pauseLine(tab?.pause);
    // A parked pause has no turn running, but its line and Continue stay until you carry on.
    $('status').hidden = !busy && pause.button !== 'continue';
    syncPause(tab, busy, pause);
    $('status').classList.toggle('compacting', busy && !!tab.compacting);
    // While Shellby works you can keep typing: Enter queues the message, and
    // Claude reads it at his next step (or when he finishes, if there's none).
    // With a message waiting for company (tab-queue.js), Enter adds to it.
    const merging = !!SB.isMerging?.(tab);
    $('sendBtn').title = busy ? 'Queue: Claude reads it at his next step' : merging ? 'Goes with what\'s waiting · Ctrl+Enter sends now' : 'Send · right-click to try it 2, 3 or 4 ways';
    $('sendBtn').classList.toggle('queueing', busy);
    $('sendHint').textContent = busy ? 'Enter to queue for his next step · Shift+Enter new line' : merging ? 'Enter adds to it · Ctrl+Enter sends now' : 'Enter to send · Shift+Enter new line';
    const line = pause.text || (busy ? tab?.statusText : '');
    if (tab) $('statusText').textContent = line ? line + (tab.queue.length ? ` · ${tab.queue.length} queued` : '') : '';
    if (tab) syncSteers(tab);
    SB.renderModStatus?.(tab);
    SB.renderGoal?.(tab); // its goal and what you might ask next (native-cli.js)
    SB.renderNextPrompt?.(tab);
    SB.renderTodos?.(tab); // Claude's to-do list and its background commands (native-strip.js)
    SB.renderJobs?.(tab);
    SB.renderUltraChip?.(tab); // whether Ultracode is on here (ultracode.js)
    tickClock();
    renderQueue();
  }

  // How long the current prompt has been running and the tokens it's used so far,
  // like Claude Code's "(12s · ↓ 4.2k tokens · esc to interrupt)", then its step
  // through Claude's to-do list and roughly how long the rest takes (plan-pace.js).
  // One timer, alive only while the tab on screen is working; main's tab summaries
  // bring the tokens and the plan (sessions.js) and re-render it between ticks.
  let clockTimer = null;
  function tickClock() {
    const tab = SB.activeTab();
    const since = tab?.busy && tab.busySince;
    const tokens = since && tab.turnTokens ? `${SB.compact(tab.turnTokens)} tokens` : '';
    const plan = since ? L.planLine(tab.plan, Date.now()) : '';
    $('statusTime').textContent = since ? [SB.clock(Date.now() - since), tokens, plan].filter(Boolean).join(' · ') : '';
    if (since && !clockTimer) clockTimer = setInterval(tickClock, 1000);
    if (!since && clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  }
  SB.syncBusyUi = syncBusyUi;

  // ------------------------------------------------------------ composer

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }
  input.addEventListener('input', () => { autosize(); updateSlash(); SB.composerInput?.(); });
  SB.autosize = autosize;

  function renderAttachments() {
    const tab = SB.activeTab();
    const files = tab ? tab.attachments : [];
    $('attachments').hidden = !files.length;
    $('attachments').replaceChildren(...SB.attachmentChips(files, i => { files.splice(i, 1); renderAttachments(); }));
  }
  SB.addAttachments = files => {
    const tab = SB.activeTab();
    if (!tab) return;
    for (const f of files) if (!tab.attachments.includes(f)) tab.attachments.push(f);
    renderAttachments();
    input.focus();
  };

  // Send to any tab: the active one, or a background tab draining its queue. opts: the file picked
  // in All files when you typed it (files-select.js); a message Shellby composed carries none.
  // opts.fromQueue: the queue sending it by itself, which isn't you back at the PC (Keep warm).
  async function sendNow(tab, text, attachments, opts) {
    const r = await api.sendTask(tab.id, text, attachments, opts);
    if (!r.ok) {
      // Out in a terminal: the way back is one click from the refusal. Not set
      // up (or signed out): the toast takes you to the fix.
      const label = { setup: 'Set up Claude Code', 'sign-in': 'Sign in again' }[r.action];
      if (tab.inTerminal) SB.toast(r.error, { action: 'Pick it up here', onAction: () => SB.pickUpHere(tab.id), ms: 6000 });
      else SB.toast(r.error, label ? { action: label, ms: 9000, onAction: () => SB.troubleAction(r.action, tab) } : undefined);
      return false;
    }
    // !! is how a message that starts with ! reaches Claude; it shows (and is sent) with one.
    // A turn on a cheaper model (savers.js) is noted on the message, as main keeps it.
    const onModel = opts?.model ? { model: opts.model, modelBy: opts.modelBy || 'you', modelCls: opts.modelCls || null } : undefined;
    markSent(tab, text.startsWith('!!') ? text.slice(1) : text, attachments, r.turnId, onModel);
    SB.notePrompt?.(text);
    return true;
  }
  SB.sendNow = sendNow;

  // A message has gone to Claude: from the box, the queue, or held for the
  // usage reset and sent by main (boot.js onTabSent). onModel: the cheaper
  // model this turn runs on, and why ({ model, modelBy, modelCls }), if one does.
  function markSent(tab, text, attachments, turnId, onModel = undefined) {
    tab.render({ kind: 'user', text, attachments, turnId, ...(onModel || {}) });
    tab.busy = true;
    tab.busySince = Date.now();
    tab.turnTokens = 0;
    tab.plan = null;
    tab.turnId = turnId; // what's queued behind it is steered into this turn
    syncSteers(tab);
    tab.saved = true;
    tab.statusText = 'Working…';
    if (tab.title === L.NEW_TITLE && !tab.named) tab.title = L.firstTitle(text, attachments);
    if (tab.isActive) syncBusyUi();
    SB.renderTabStrip();
  }
  SB.markSent = markSent;

  function clearComposer(tab) {
    input.value = '';
    tab.attachments = [];
    renderAttachments();
    autosize();
    SB.composerInput?.();
    SB.resetEstimate?.(); // what it usually costs was about what's just gone (outlook.js)
  }
  SB.clearComposer = clearComposer;
  SB.renderAttachments = renderAttachments;

  // -> true once it has gone (or is queued, or held for the reset, or waiting a
  // moment for company), false if it stayed where it was. force: send even if it
  // would be held as a big task. now: don't wait for company (Ctrl+Enter).
  SB.send = async (text, { force = false, now = false } = {}) => {
    const tab = SB.activeTab();
    if (!tab) return false;
    const typed = text == null; // the box is the user's message; a string from code is Shellby's own and carries no pick
    text = (text ?? input.value).trim();
    // Enter on an empty box while a message waits for company: it goes now.
    if (!text && !tab.attachments.length) { if (typed && SB.isMerging?.(tab)) { SB.flushMerge(tab); return true; } return false; }
    const attachments = [...tab.attachments];
    const picked = typed ? SB.treePickOpts?.(tab) : undefined; // as it was when you pressed Enter
    // Typed as a /command: a turn of its own, whatever words it becomes below (queue-turns.js).
    const solo = /^[/!]/.test(text);
    let snippet = null; // its name, counted as a use once the prompt has gone
    // /subtask <task> and the like go as the words they stand for, shown as sent (builtin-commands.js).
    const rewritten = SB.rewriteBuiltin?.(text);
    if (rewritten) text = rewritten;
    // /export, /rewind, ! commands and friends happen here, not in Claude (composer.js).
    else if (SB.runLocal?.(text, tab, attachments)) { clearComposer(tab); return true; }
    // /review and the rest of your snippets: Claude gets the prompt they stand for,
    // filled in before it can be queued, so editing the snippet can't change it later.
    if (SB.isSnippetCall?.(text)) {
      // A second Enter while main fills it in would send it twice.
      if (tab.expanding) return false;
      tab.expanding = true;
      let r;
      try { r = await api.expandSnippet(text, tab.id); } finally { tab.expanding = false; }
      if (r && !r.ok) { SB.toast(r.error); return false; }
      if (r?.newTab && !tab.isEmpty) return sendInNewTab(tab, text, r, attachments);
      if (r) { snippet = r.name; text = r.prompt; }
    }
    // Ultracode on here (or the word typed): the word goes in, where you can see
    // it, and the first one in a conversation asks first (ultracode.js).
    if (SB.ultraWords) {
      const words = await SB.ultraWords(tab, text);
      if (words === null) return false;
      text = words;
    }
    // Before it goes, two things worth a card in the feed, one at a time (savers.js):
    // a fresh tab for a new topic in a well-filled conversation (handoff.js), else a
    // cheaper model for a small message. Only a message you typed, into an idle tab,
    // on its own: the gate clears the box itself once it has the message.
    if (typed && !solo && SB.saverGate) {
      // A second Enter while main looks would take it twice.
      if (tab.gating) return false;
      tab.gating = true;
      let took;
      try { took = await SB.saverGate(tab, text, attachments, picked); } finally { tab.gating = false; }
      if (took) {
        SB.setView('chat');
        if (snippet) api.snippetUsed(snippet);
        return true;
      }
    }
    // "Hold big tasks for the reset" (Settings): one that usually takes more than
    // the window has left waits for the reset instead (outlook.js).
    if (!force && state.settings.holdBigTasks) {
      // A second Enter while main looks it up would send (or hold) it twice.
      if (tab.holdChecking) return false;
      tab.holdChecking = true;
      let held;
      try { held = await SB.holdIfBig?.(tab, text, attachments); } finally { tab.holdChecking = false; }
      if (held) {
        clearComposer(tab);
        if (snippet) api.snippetUsed(snippet);
        return true;
      }
    }
    const item = queueItem(text, attachments, picked?.selected, { solo });
    if (tab.busy || tab.draining) {
      tab.queue.push(item);
      clearComposer(tab);
      syncBusyUi();
      if (snippet) api.snippetUsed(snippet);
      return true;
    }
    // Idle: a plain message you typed waits a moment for company, so a thought in
    // several Enters goes as one turn (tab-queue.js). A command typed while one
    // waits sends what's waiting now and goes after it, in a turn of its own.
    const Q = window.ShellbyQueueTurns;
    const waiting = SB.isMerging?.(tab);
    if (typed && (Q.canMerge(item, { on: state.settings.mergeSends !== false, paused: !!tab.queuePaused }) || waiting)) {
      tab.queue.push(item);
      clearComposer(tab);
      SB.setView('chat');
      tab.merged = true;
      if (now || Q.solo(item)) SB.flushMerge(tab); else SB.armMerge(tab);
      syncBusyUi();
      if (snippet) api.snippetUsed(snippet);
      return true;
    }
    // A second Enter while main checks the picked file would send it twice.
    if (tab.sending) return false;
    tab.sending = true;
    let ok;
    try { ok = await sendNow(tab, text, attachments, picked); } finally { tab.sending = false; }
    if (!ok) return false;
    clearComposer(tab);
    SB.setView('chat');
    if (snippet) api.snippetUsed(snippet);
    return true;
  };

  // A message that skips the box (a held one you chose to send now): queued
  // behind the turn in progress, or sent at once. -> true once it's on its way.
  SB.sendDirect = async (tab, text, attachments = []) => {
    if (tab.busy) {
      tab.queue.push({ text, attachments });
      syncBusyUi();
      return true;
    }
    return sendNow(tab, text, attachments);
  };

  // Try again after something went wrong: the same words again, leaving
  // whatever's in the box alone (queued if a turn is running by then). A
  // message shown with one ! went to Claude as !!, so it does again.
  SB.resend = (tab, text) => {
    const words = text.startsWith('!') ? `!${text}` : text;
    if (!tab.busy) return sendNow(tab, words, []);
    tab.queue.push(queueItem(words, []));
    syncBusyUi();
    return true;
  };

  // A snippet set to start a conversation of its own: the one you're in is left
  // as it was. If the new one can't open, what you typed stays in the box; if it
  // opens but can't start, the prompt waits in its box.
  async function sendInNewTab(from, typed, { name, prompt }, attachments) {
    clearComposer(from);
    const fresh = await SB.newTab();
    if (!fresh) {
      from.attachments = attachments;
      renderAttachments();
      SB.prefill(typed);
      return false;
    }
    if (await sendNow(fresh, prompt, attachments)) { SB.setView('chat'); api.snippetUsed(name); return true; }
    SB.prefill(prompt);
    return false;
  }

  $('form').addEventListener('submit', e => { e.preventDefault(); SB.send(); });
  input.addEventListener('keydown', e => {
    if (SB.pickKeydown?.(e)) return;
    if (slashKeydown(e)) return;
    if (SB.shortcuts.matches(e, 'zoomPane')) return; // zooms the pane (tabs.js), never sends
    // Ctrl+Enter sends now, without waiting a moment for company (tab-queue.js).
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); SB.send(undefined, { now: e.ctrlKey }); }
    if (e.key === 'Tab' && e.shiftKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); SB.cycleMode(); return; }
    // Tab in an empty box takes what Claude guessed you'd ask next, like Claude Code (native-cli.js).
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !input.value && SB.takeNextPrompt?.()) { e.preventDefault(); return; }
    // Up in an empty box pulls back the last queued message, like Claude Code.
    // Not with Alt or Ctrl held: Alt+Up and Ctrl+Alt+Up are pane keys (tabs.js).
    const tab = SB.activeTab();
    const bare = !e.altKey && !e.ctrlKey && !e.metaKey;
    if (e.key === 'ArrowUp' && bare && !input.value && tab?.queue.length) { e.preventDefault(); editQueued(tab, tab.queue.length - 1); return; }
    // Otherwise Up and Down walk back through what you've sent before.
    SB.historyKeydown?.(e);
  });
  $('stopBtn').addEventListener('click', stop);
  function stop() {
    const tab = SB.activeTab();
    const parked = tab?.pause?.phase === 'parked';
    if (!tab?.busy && !parked) return;
    api.stopTask(tab.id);
    tab.pause = null; // Stop ends a pause too (main's control.js interrupt)
    if (tab.busy) tab.setStatus('Stopping…');
    else SB.onTurnEnded?.(tab, { ok: false, interrupted: true }); // parked: as after a Stop, what you queued comes back to the box
    syncBusyUi();
  }

  SB.stopTask = stop;

  // ------------------------------------------------------------ pause

  // The Pause button as the tab's pause has it: Pause, Pausing… (it waits for
  // the step he's on) or Continue. Only Claude Code conversations can pause.
  function syncPause(tab, busy, pause) {
    const btn = $('pauseBtn');
    btn.hidden = !tab?.canPause || (!busy && pause.button !== 'continue');
    btn.disabled = pause.button === 'pausing';
    btn.textContent = pause.button === 'continue' ? 'Continue' : pause.button === 'pausing' ? 'Pausing…' : 'Pause';
    btn.classList.toggle('continue', pause.button === 'continue');
    btn.title = pause.button === 'continue' ? 'He picks up where he stopped. What you queued goes in with it'
      : pause.button === 'pausing' ? "He's finishing the step he's on" : "He finishes the step he's on, then waits until you continue";
    $('stopBtn').hidden = !pause.stop;
  }

  $('pauseBtn').addEventListener('click', () => pauseOrContinue());
  async function pauseOrContinue(tab = SB.activeTab()) {
    if (!tab?.canPause) return;
    const phase = tab.pause?.phase;
    if (phase === 'parked') return continueParked(tab);
    if (phase === 'pausing' || phase === 'parking') return;
    const r = phase === 'paused' ? await api.resumeTask(tab.id) : tab.busy ? await api.pauseTask(tab.id) : null;
    if (!r) return;
    if (!r.ok) { SB.toast(r.error || "Couldn't do that just now."); return; }
    // Main's next summary has the details; until then the button says it's in hand.
    tab.pause = phase === 'paused' ? null : { phase: 'pausing', waitingOn: null };
    if (phase === 'paused') tab.setStatus('Working…');
    if (tab.isActive) syncBusyUi();
  }
  SB.pauseTask = pauseOrContinue;

  // A parked pause's turn has ended where he stopped: what you queued meanwhile
  // goes first, or a message asking him to carry on.
  async function continueParked(tab) {
    if (tab.busy) return;
    tab.pause = null; // carrying on: main clears its side when the message arrives (sessions.js send)
    if (tab.queue.length) { tab.queuePaused = false; await SB.drainQueue(tab); return; }
    if (!(await sendNow(tab, L.CONTINUE_TEXT, []))) tab.pause = { phase: 'parked' };
    if (tab.isActive) syncBusyUi();
  }

  // drag files onto the panel too
  let dragDepth = 0;
  // Only files: dragging a sticker onto his shell (stickers.js) is not an attachment.
  const carriesFiles = e => !!e.dataTransfer?.types?.includes('Files');
  window.addEventListener('dragenter', e => { if (!carriesFiles(e)) return; e.preventDefault(); if (dragDepth++ === 0) document.body.classList.add('dropping'); });
  window.addEventListener('dragleave', e => { if (!carriesFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dropping'); } });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dropping');
    if (e.dataTransfer.files.length) attachFrom(e.dataTransfer.files);
  });

  // A picture with no file behind it (a snip, an image out of a browser) is saved
  // by main first, so everything attached ends up as a path.
  async function attachFrom(files) {
    const { paths, error } = await api.attachFiles([...files]); // a FileList doesn't cross the bridge; an array of Files does
    if (error) SB.toast(error);
    if (paths.length) { SB.setView('chat'); SB.addAttachments(paths); }
  }

  // Ctrl+V a Win+Shift+S snip (or files copied in Explorer) straight into the
  // composer. Anything that also carries text (a cell out of Excel brings a
  // picture of itself along) pastes as text, the way it always did.
  input.addEventListener('paste', e => {
    const data = e.clipboardData;
    if (!data?.files.length || data.getData('text/plain')) return;
    e.preventDefault();
    attachFrom(data.files);
  });

  $('attachBtn').addEventListener('click', async () => {
    const paths = await api.pickFiles();
    if (paths.length) SB.addAttachments(paths);
    else input.focus();
  });

  // "Attach what I just saw" (main's just-saw.js): opt-in in Settings, one press, a new task.
  SB.syncJustSaw = () => { $('justSawBtn').hidden = state.settings?.attachWhatISaw !== true; };
  $('justSawBtn').addEventListener('click', async () => {
    const r = await api.justSawTake();
    if (!r.ok) return SB.toast(r.error);
    await SB.newTabIn({ cwd: r.cwd, draft: r.draft });
    if (r.attachments.length) SB.addAttachments(r.attachments);
    SB.toast(`Attached ${r.label}. Add what you want done, then send.`);
  });

  // Put text in the box (not sent) with the caret at the end, ready to add to.
  SB.prefill = (text) => {
    SB.setView('chat');
    input.value = text;
    autosize();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  };

  // A prompt Shellby wrote for you to look over (a "let Claude set it up"
  // button): in a conversation of its own, not on the end of the one you're in.
  // A blank, idle tab with nothing typed is used as is.
  SB.prefillNew = (text) => {
    const cur = SB.activeTab();
    if (SB.isBlankTab(cur) && !input.value.trim()) return SB.prefill(text);
    return SB.newTabIn({ draft: text });
  };

  SB.useTool = (t) => {
    if (t.kind === 'snippet') return SB.runSnippet(t.name);
    const prefix = t.kind === 'agent' ? `Use the ${t.name} agent to ` : `/${t.name} `;
    SB.prefill(prefix + input.value.replace(/^\/\S*\s*/, ''));
  };
})();
