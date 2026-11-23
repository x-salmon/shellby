/* Shellby panel — one conversation's feed, including crew lanes for subagents.
   This file holds the Tab itself: its feed, scrolling, the cap on how much it
   keeps, and what each item becomes. Its other parts are their own files:
   feed-blocks.js (your message, a step and its result, the error block),
   feed-result.js (a turn's end: what was refused, the notes under its cost),
   feed-notes.js (terminal handoff, branches, ! commands), feed-asks.js
   (permission cards and questions), feed-changes.js (what a turn changed) and
   feed-lanes.js (helper lanes). The words are feed-logic.js's. */
'use strict';
/**
 * What the feed's other files reach on the Tab their methods are copied onto.
 * @typedef {{
 *   id: string, cwd: string, busy: boolean, outcome: string | null, inTerminal?: number | null,
 *   el: HTMLElement, tools: Map<string, HTMLElement>, asks: Map<string, HTMLElement>,
 *   lanes: Map<string, { setAsking(on: boolean): void }>, isActive: boolean,
 *   stepUndos?: Map<string, StepUndo[]>,
 *   stepEnds?: Map<string, string>,
 *   append(el: Element, parent?: string): Element, setStatus(text: string): void,
 *   changeRow(f: unknown, ref: unknown, read?: (file: string) => Promise<unknown>): HTMLElement,
 * }} FeedTab
 */
/** @typedef {{ toolId: string, btn: HTMLButtonElement, el: HTMLElement, done: boolean, disarm: (() => void) | null }} StepUndo */
/**
 * The methods feed-*.js add to Tab (SB.extendTab), as render() calls them.
 * @typedef {{
 *   renderLane(item: unknown, replay?: boolean): unknown, renderMessage(item: unknown, replay?: boolean): unknown,
 *   renderFindings(item: unknown, replay?: boolean): unknown, renderPlanning(item: unknown): unknown,
 *   renderTool(item: unknown, replay?: boolean): unknown, renderToolResult(item: unknown): unknown,
 *   renderTask(item: unknown, replay?: boolean): unknown, renderAsk(item: unknown, replay?: boolean): unknown,
 *   markDecision(item: unknown): unknown, foldSavers(): unknown, renderResult(item: unknown, replay?: boolean): unknown,
 *   offerLocal?(item: unknown, replay?: boolean): unknown, renderChanges(item: unknown): unknown,
 *   markUndone(item: unknown): unknown, renderSuggestion(item: unknown, replay?: boolean): unknown,
 *   renderHandOff(item: unknown): unknown, renderHandoff(item: unknown, replay?: boolean): unknown,
 *   renderReadNudge(item: unknown): unknown, renderCutOff(item: unknown, replay?: boolean): unknown,
 *   renderBranched(item: unknown): unknown, renderBranchedOff(item: unknown): unknown,
 *   showStepUndos?(item: unknown): unknown, renderStepPoint?(item: unknown): unknown,
 *   markStepUndone?(item: unknown): unknown, renderShell(item: unknown, replay?: boolean): unknown,
 *   troubleBlock(trouble: unknown, text: unknown): Element, renderUser(item: unknown, replay?: boolean): unknown,
 *   dropCutOff(): unknown, noteTurn?(item: unknown): unknown,
 * }} FeedMixins
 */
(function () {
  const { h, api, state } = SB;
  const F = window.ShellbyFeedLogic;
  const T = window.ShellbyTodos;

  // Top-level blocks kept in one conversation's feed. Past this the oldest are
  // dropped (see Tab.trim); the transcript on disk is never touched.
  const MAX_BLOCKS = 400;
  // How often the reply being written is formatted again as more of it arrives.
  const LIVE_MS = 120;

  // A fork: one line that splits in two (try again from here, in a new tab).
  // Drawn rather than the ⑂ character, which most fonts render tiny and faint.
  const FORK = 'M5 4.5v7M6.5 3a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0M6.5 13a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0M12.5 5a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0M11 6.5c0 2.5-6 2-6 5';
  SB.forkIcon = () => SB.icon(FORK, { width: 1.3 });

  const SUGGESTIONS = [
    'Tidy my Downloads folder into subfolders by file type',
    "What's eating the most disk space on C:?",
    'Find every file I changed today and list them',
    'Summarize the documents on my Desktop',
    'Build yourself a skill that renames screenshots by date, then use it',
    'Send three helpers to audit my Documents, Desktop and Downloads in parallel',
  ];

  // The tour in a tab of its own, in Ask first, waiting to be sent. The folder
  // Shellby works in when it's a repository, or one you pick (tools:first-tour).
  async function firstTour() {
    const t = await api.firstTour();
    if (!t?.ok) return t?.cancelled ? null : t?.needsClaude ? SB.claudeUpsell('helpers') : SB.toast(t?.error || "Couldn't open the tour.");
    const r = await api.setSettings({ firstTour: false });
    state.settings = r.settings;
    SB.refreshEmptyStates();
    if (state.tabs.has(t.tabId)) SB.activate(t.tabId);
    SB.toast('Read the prompt, then send it. It runs in Ask first, so nothing changes.', { ms: 6000 });
  }

  class Tab {
    /** @type {string} */ id;
    /** @type {string} */ cwd;
    /** @type {string[] | undefined} */ shuffled;

    constructor(id, { title = 'New task', cwd = '', saved = false, routineId = null } = {}) {
      Object.assign(this, { id, title, cwd, saved, routineId });
      this.busy = false;
      this.busySince = null;      // when the running turn started (main's clock, or ours until it reports)
      this.autoRetried = null;    // the last blocked step Try again's countdown sent by itself (retryCountdown)
      /** @type {null | (() => void)} */
      this.deniedCheck = null;    // a block that ended out of sight, checked when the tab comes on screen (deniedStrip)
      this.pending = 0;
      this.crew = 0;
      this.outcome = null;
      this.unread = false;
      this.statusText = 'Working…';
      this.compacting = null;     // { chars } while Claude Code compacts the conversation (setCompacting)
      this.modStatus = new Map(); // mod name -> its status line ($.ui.status), under the box while this tab shows
      this.draft = '';
      this.attachments = [];
      this.queue = [];            // messages typed while busy: [{ text, attachments }]
      this.queuePaused = false;   // after an error, wait for the user before sending the next
      this.tools = new Map();     // tool_use_id -> element
      this.asks = new Map();      // requestId -> card
      this.lanes = new Map();     // Agent tool_use_id -> lane
      this.taskLane = new Map();  // task_id -> Agent tool_use_id
      this.todos = T.create();    // Claude's own to-do list, as its tool calls build it (shared/todos.js)
      this.jobs = [];             // what it left running in the background, from main's summary (jobs.js)
      this.trimmed = 0;           // blocks dropped off the top (see trim())
      this.trimmedNotice = null;
      this.live = null;           // Claude's reply while it's being written, until the whole of it arrives
      this.nextPrompt = null;     // what Claude Code guessed you'll ask next (native-cli.js)
      this.goal = null;           // the goal Claude checks before it stops (/goal), while it's set
      // Not a live region: every tool step would be read out. The turn's end
      // and permission asks are announced instead (SB.announce).
      this.el = h('section', { class: 'feed', role: 'tabpanel', dataset: { tab: id } });
      this.empty = SB.$('emptyTemplate').content.firstElementChild.cloneNode(true);
      this.el.append(this.empty); // its links open through core.js's a[data-href] handler
      this.renderEmpty();

      // Keep the newest message in view. `stuck` = you're at the bottom; the
      // feed shrinks whenever the Working bar, queued chips or attachments
      // appear above the composer, and without this the end of your prompt
      // would slide under them.
      // Only you scrolling up lets go: the feed shrinking under a scroll event that is
      // still on its way (the Working bar, 34px, plus a new message's 10px rise) would
      // otherwise read as 'not at the bottom', and the resize below would then leave
      // your prompt's last lines hidden.
      this.stuck = true;
      this.unseen = false;        // something arrived below while you were scrolled up (the pane's ↓ wears a dot)
      this.lastTop = 0;
      this.el.addEventListener('scroll', () => {
        const near = this.distanceFromEnd() < 40;
        const was = this.stuck;
        if (near || this.el.scrollTop < this.lastTop) this.stuck = near;
        this.lastTop = this.el.scrollTop;
        if (this.stuck !== was) { if (this.stuck) this.unseen = false; SB.refreshJump?.(this); }
      }, { passive: true });
      this.resizer = new ResizeObserver(() => { if (this.stuck && this.isShown) this.scrollToEnd(); });
      this.resizer.observe(this.el);
    }

    distanceFromEnd() { return this.el.scrollHeight - this.el.scrollTop - this.el.clientHeight; }

    scrollToEnd() {
      this.el.scrollTop = this.el.scrollHeight;
      const was = this.stuck && !this.unseen;
      this.stuck = true;
      this.unseen = false;
      if (!was) SB.refreshJump?.(this);
    }

    // ------------------------------------------------------------ empty state
    renderEmpty() {
      const e = this.empty;
      e.querySelector('.empty-crab').replaceChildren(SB.sprite());
      e.querySelector('.empty-folder').textContent = SB.tildify(this.cwd || state.cwd);
      // Written like the shortcut table ("Ctrl+K"), not like Settings ("Ctrl + K"), so the legend reads as one.
      e.querySelector('.hotkey-hint').textContent = SB.prettyAccel(state.settings.hotkey).replace(/ \+ /g, '+') || 'The tray icon';
      // Some of these can be changed in the shortcut list, so they come from it.
      for (const k of e.querySelectorAll('kbd[data-key]')) k.textContent = SB.shortcuts?.primary(k.dataset.key) || k.textContent;
      // A quest card takes the third suggestion's room.
      // A new install's first tasks lead with a tour of a project, until it's opened once.
      // Shuffled once per conversation. This runs again whenever his look changes
      // (a new track, a sticker, a molt): reshuffled each time, the chips swapped
      // and rose again under the pointer. They're rebuilt only when what they say changes.
      const tour = state.settings.firstTour && !SB.isCrabOnly();
      this.shuffled ||= [...SUGGESTIONS].sort(() => Math.random() - 0.5);
      const card = SB.firstRunCardShows?.() || SB.questCardShows?.();
      const picks = this.shuffled.slice(0, (card ? 2 : 3) - (tour ? 1 : 0));
      const shown = JSON.stringify([tour, picks]);
      if (shown !== this.shownSuggestions) {
        this.shownSuggestions = shown;
        const chip = (text, onclick, i) => h('button', { class: 'suggestion', type: 'button', style: `animation-delay:${i * 60}ms`, onclick },
          h('span', { class: 'glyph', text: '›' }), text);
        e.querySelector('.suggestions').replaceChildren(
          ...(tour ? [chip('Show me around a project: what it is, how to run it, where to start', firstTour, 0)] : []),
          ...picks.map((s, i) => chip(s, () => SB.send(s), i + (tour ? 1 : 0))));
      }
      SB.renderFirstRun?.(e.querySelector('.first-run-card'));
      SB.renderQuestCard?.(e.querySelector('.quest-card'));
      const pinned = state.pinned || [];
      e.querySelector('.pinned-row').hidden = !pinned.length;
      e.querySelector('.pinned-chips').replaceChildren(...pinned.map(p => SB.toolChip(p)));
    }

    // ------------------------------------------------------------ helpers
    get isEmpty() { return !this.empty.hidden; }

    append(el, parent) {
      this.empty.hidden = true;
      const host = (parent && this.lanes.get(parent)?.body) || this.el;
      const follow = this.stuck || this.distanceFromEnd() < 140;
      host.append(el);
      if (host === this.el) this.trim();
      if (follow && this.isShown) this.scrollToEnd();
      else if (!follow && !this.unseen) { this.unseen = true; SB.refreshJump?.(this); }
      return el;
    }

    // An overnight autonomous run can produce thousands of blocks, and the panel
    // is never closed, so the oldest ones are dropped once there are more than a
    // long scroll of history above you. The full transcript stays on disk, and
    // reopening the conversation from History replays it.
    trim() {
      let over = this.el.children.length - MAX_BLOCKS;
      if (over <= 0) return;
      for (const el of [...this.el.children]) {
        if (over <= 0) break;
        if (el === this.empty || el === this.trimmedNotice) continue;
        this.forget(el);
        el.remove();
        this.trimmed++;
        over--;
      }
      this.showTrimmed();
    }

    // Drop the maps' references to a block that's gone, so a long conversation
    // doesn't keep every tool and lane it ever showed.
    forget(el) {
      const toolId = el.dataset?.toolId;
      if (toolId) this.tools.delete(toolId);
      const laneId = el.dataset?.laneId;
      if (laneId) {
        this.lanes.delete(laneId);
        for (const [taskId, useId] of this.taskLane) if (useId === laneId) this.taskLane.delete(taskId);
      }
    }

    showTrimmed() {
      if (!this.trimmedNotice) {
        this.trimmedNotice = h('div', { class: 'feed-trimmed' });
        this.el.prepend(this.trimmedNotice);
      }
      this.trimmedNotice.textContent = F.trimmedLine(this.trimmed);
    }

    get isActive() { return state.activeTab === this.id; }
    get isShown() { return SB.isShown(this.id); }   // in a pane, focused or not (tab-panes.js)

    setStatus(text) {
      this.statusText = text;
      if (this.isActive) SB.$('statusText').textContent = text;
    }

    // { chars } while Claude Code compacts the conversation, null once it's done.
    setCompacting(c) {
      this.compacting = c;
      this.setStatus(c ? F.compactingLine(c.chars, SB.compact) : 'Working…');
      if (this.isActive) SB.$('status').classList.toggle('compacting', !!c);
    }

    // ------------------------------------------------------------ items
    /** @this {Tab & FeedMixins} */
    render(item, { replay = false } = {}) {
      SB.trailTake?.(this, item, replay); // where he's been in the files (trail.js)
      SB.filesTake?.(this, item, replay); // and lit up in All files (files-dock.js)
      this.noteTurn?.(item); // what the turn was, in case Claude didn't answer it (feed-local.js)
      // Claude's to-do list moves with its tool calls, replayed or live (native-strip.js draws it;
      // an unfocused pane shows its own over its stand-in, tab-panes.js).
      if ((item.kind === 'tool' || item.kind === 'tool_result') && T.apply(this.todos, item)) {
        if (this.isActive || !replay) SB.renderTodos?.(this);
      }
      // The reply as it was being written gives way to whatever comes next on
      // the main thread: the finished words themselves, usually. Those keep the
      // Wrap, Show all and scroll their code blocks had while being written.
      const liveView = this.live && item.kind === 'text' && !item.sub ? SB.codeView?.([this.live]) : null;
      if (this.live && item.kind !== 'partial' && !item.sub) this.endLive();
      if (this.compacting && (item.kind === 'compacted' || item.kind === 'result')) this.setCompacting(null);
      // Anything else from Claude Code means the retried request went through.
      if (this.retrying && item.kind !== 'retrying') {
        this.retrying = false;
        if (!this.compacting) this.setStatus('Working…');
      }
      // ...and anything else while a hook ran means the hook is over.
      if (this.hooking && item.kind !== 'hook') {
        this.hooking = null;
        if (!this.compacting) this.setStatus('Working…');
      }
      switch (item.kind) {
        // The API failed a request and Claude Code is trying again: the busy line
        // says so rather than sitting on Working… (feed-logic.js retryLine).
        case 'retrying':
          if (replay || this.compacting) return;
          this.retrying = true;
          this.setStatus(F.retryLine(item));
          return;
        // A hook running on the main thread: the busy line names it until it's
        // done (feed-logic.js hookLine), so a slow hook doesn't read as Claude stuck.
        case 'hook':
          if (replay || this.compacting || this.retrying) return;
          if (item.on) { this.hooking = item.name; this.setStatus(F.hookLine(item.name)); return; }
          if (this.hooking) { this.hooking = null; this.setStatus('Working…'); }
          return;
        // The mode Claude Code says this conversation is in (an approved plan's
        // "auto-accept edits", say): the chip follows the conversation you're in.
        case 'mode':
          if (!replay && this.isActive && document.body.dataset.mode !== item.mode) SB.applyMode(item.mode);
          return;
        // Claude Code compacting the conversation: the busy line says so, over a
        // bar that runs until it's done (panel.css). The compacted mark stays after.
        case 'compacting':
          if (replay) return;
          this.setCompacting(item.on ? { chars: item.chars } : null);
          return;
        case 'user':
          // Something you just sent always comes into view, even if you'd scrolled up.
          if (!replay) { this.stuck = true; this.dropCutOff(); }
          // What Claude guessed you'd ask next is spent once you've asked something.
          if (!replay && this.nextPrompt) { this.nextPrompt = null; SB.renderNextPrompt?.(this); } // over the box or its pane's stand-in
          return this.renderUser(item, replay);
        // Claude's reply as it's written (--include-partial-messages), formatted
        // as it goes, so the finished one takes its place without a jump.
        case 'partial':
          if (replay) return;
          if (!this.live) {
            this.live = this.append(h('div', { class: 'msg assistant live', 'aria-busy': 'true' }));
            this.liveText = item.text;
            this.setStatus('Writing…');
            // The first words show with the bubble, never an empty one.
            this.paintLive();
            return;
          }
          this.liveText += item.text;
          // A few times a second at most: a long reply arrives in hundreds of pieces.
          this.liveTimer ??= setTimeout(() => this.paintLive(), LIVE_MS);
          return;
        // What Claude Code thinks you'll ask next (native-cli.js shows it by the box).
        case 'next':
          if (replay) return;
          this.nextPrompt = item.text;
          SB.renderNextPrompt?.(this); // in whichever pane shows it (native-cli.js)
          return;
        // A goal Claude checks before it stops (/goal), pinned by the box until it's met or cleared.
        case 'goal':
          this.goal = item.text || null;
          if (this.isActive) SB.renderGoal?.(this);
          if (item.met && !replay) this.append(h('div', { class: 'home-mark' }, h('span', { class: 'chg-icon', 'aria-hidden': 'true', text: '🎯' }), 'Goal met.'));
          return;
        // One of your agents runs this conversation (claude --agent; tabs.js newTabAs).
        case 'agent':
          return this.append(h('div', { class: 'home-mark' }, h('span', { class: 'chg-icon', 'aria-hidden': 'true', text: '🤖' }),
            h('span', {}, 'Your ', h('b', { text: item.name }), " agent runs this conversation: its own instructions, tools and model, from the first message.")));
        // Another agent's CLI runs this conversation (main's harness/): Gemini CLI, OpenCode, Codex.
        case 'harness':
          return this.append(h('div', { class: 'home-mark' }, h('span', { class: 'chg-icon', 'aria-hidden': 'true', text: '🔌' }),
            h('span', {}, h('b', { text: item.name }), ' runs this conversation, with its own model, tools and sign-in. Permission prompts still come here.')));
        // Safe mode turned on or off for this conversation (sessions.js setSafeMode).
        case 'safe':
          return this.append(h('div', { class: 'home-mark' }, h('span', { class: 'chg-icon', 'aria-hidden': 'true', text: item.on ? '🛟' : '🧩' }),
            item.on ? 'Safe mode: from the next message, Claude starts without your CLAUDE.md, skills, plugins, hooks, MCP servers or custom agents. Turn it off from the tab menu.'
              : 'Safe mode off: your CLAUDE.md, skills, plugins, hooks and MCP servers are back from the next message.'));
        case 'text': {
          const el = SB.linkifyPaths(SB.renderMarkdownInto(h('div', { class: `msg assistant${item.sub ? ' sub' : ''}` }), item.text));
          if (!item.sub) SB.decorateReply?.(el, item.text); // the /insights report's button (native-more.js)
          // Before append, so its height is final when the feed follows it down;
          // again after, as a block's scroll only holds once it's on the page.
          SB.restoreCodeView?.([el], liveView);
          this.append(el, item.parent);
          SB.restoreCodeView?.([el], liveView);
          return el;
        }
        case 'thinking':
          if (!replay && !item.sub) this.setStatus('Thinking…');
          // What it thought, folded away: there to read, never in the way of the reply.
          if (item.text) {
            const body = SB.linkifyPaths(SB.renderMarkdownInto(h('div', { class: 'msg assistant thought-body' }), item.text));
            return this.append(h('details', { class: 'thought' }, h('summary', { text: 'Thought it through' }), body), item.parent);
          }
          return;
        case 'tool':
          if (item.agent) return this.renderLane(item, replay);
          // One agent writing to another, a skill, a memory, Claude switching to planning (feed-native.js).
          if (item.message) return this.renderMessage(item, replay);
          if (item.findings) return this.renderFindings(item, replay);
          if (item.name === 'EnterPlanMode' && !item.sub) this.renderPlanning(item);
          return this.renderTool(item, replay);
        case 'tool_result': return this.renderToolResult(item);
        case 'task': return this.renderTask(item, replay);
        case 'permission':
          if (!replay && this.isActive) SB.announce(item.toolName === 'AskUserQuestion' ? 'Claude has a question for you' : 'Claude is asking for your OK');
          return this.renderAsk(item, replay);
        case 'decision': return this.markDecision(item);
        case 'result':
          if (!replay && this.isActive) SB.announce(item.parked ? 'Claude paused' : item.interrupted ? 'Claude stopped' : item.ok ? 'Claude finished' : 'Claude ended with an error');
          if (!replay) this.foldSavers(); // a nudge nobody answered folds to one line (feed-savers.js)
          this.renderResult(item, replay);
          return this.offerLocal?.(item, replay); // Claude didn't answer: your local model can (feed-local.js)
        case 'changes': return this.renderChanges(item);
        case 'undone': return this.markUndone(item);
        case 'checks': return SB.renderChecks?.(this, item);   // turn-checks.js
        case 'shots': return SB.renderShots?.(this, item);     // turn-checks.js
        case 'tries': return SB.renderTries?.(this, item, replay); // tries.js
        case 'debug': return SB.renderDebug?.(this, item, replay); // debug-mode.js
        case 'ultracode': return SB.renderUltracode?.(this, item, replay); // ultracode.js
        case 'engineer': case 'engineer-spike': return SB.renderEngineer?.(this, item); // engineer.js
        case 'context-usage': return SB.renderContextUsage?.(this, item); // /context, as a bar (native-more.js)
        // Shellby's own one-line notes: cleared, moved into a copy, from the phone,
        // brought home, pushed, compacted, started fresh, rewound. /clear empties
        // the screen first, as in the terminal: live or replayed, so a
        // conversation reopened later shows only what came after it.
        case 'cleared':
          this.wipe();
          SB.renderTodos?.(this); // in whichever pane shows it (native-strip.js)
          // falls through
        case 'moved': case 'wt-in': case 'wt-out': case 'phone': case 'home': case 'home-wait': case 'pushed': case 'compacted': case 'fresh': case 'rewound': case 'hook-failed': case 'paused': {
          const mark = F.markFor(item, SB.compact);
          return this.append(h('div', { class: 'home-mark' }, h('span', { class: 'chg-icon', 'aria-hidden': 'true', text: mark.icon }), mark.text));
        }
        // Ship it (src/main/ship.js): the note, and the pull request a click away.
        case 'shipped': {
          const mark = F.markFor(item, SB.compact);
          const url = typeof item.url === 'string' && /^https:\/\//.test(item.url) ? item.url : null;
          return this.append(h('div', { class: 'home-mark' }, h('span', { class: 'chg-icon', 'aria-hidden': 'true', text: mark.icon }), mark.text,
            url ? h('button', { type: 'button', class: 'link-btn small', text: 'Open it', onclick: () => SB.api.openExternal(url) }) : null));
        }
        // A crit hit or a clean landing (src/main/surprises.js), kept with the turn that earned it.
        case 'surprise': return this.append(h('div', { class: `home-mark surprise-mark ${item.what === 'landing' ? 'landing' : 'crit'}` },
          h('span', { class: 'chg-icon', 'aria-hidden': 'true', text: item.what === 'landing' ? '🛬' : '🎲' }),
          h('span', {}, h('b', { text: item.title || (item.what === 'landing' ? 'Clean landing' : 'Critical hit!') }), ` ${item.text || ''}`)));
        // What the turn earned: finds, catches, trophies... (turn-rewards.js), kept with it.
        case 'rewards': { const card = SB.renderRewards?.(item); return card ? this.append(card) : undefined; }
        case 'suggest': return this.renderSuggestion(item, replay); // feed-asks.js
        case 'chat-handoff': return this.renderHandOff(item); // feed-asks.js
        case 'handoff': return this.renderHandoff(item, replay);
        // A repeated big read: the Lean tab's one-tap fix, under the step, mid-turn (feed-savers.js). The panel's alone, never saved.
        case 'read-nudge': return replay ? undefined : this.renderReadNudge(item);
        case 'cutoff': return this.renderCutOff(item, replay);
        case 'branched': return this.renderBranched(item);
        case 'branched-off': return this.renderBranchedOff(item);
        // Where the files stood at the turn's end, for branching; and its steps' Undo to here can show now (feed-changes.js).
        case 'checkpoint': return this.showStepUndos?.(item);
        case 'step-point': return this.renderStepPoint?.(item);
        case 'undone-step': return this.markStepUndone?.(item);
        case 'shell': return this.renderShell(item, replay);
        case 'error': return this.append(this.troubleBlock(item.trouble, item.text));
        case 'lesson': return SB.renderLesson ? this.append(SB.renderLesson(item)) : undefined; // lessons.js
        case 'keepwarm': return SB.renderKeepWarm?.(this, item); // keepwarm.js
        // What a mod shows (toolbox-mods.js): always under its own name, so it can't pass for Claude or Shellby.
        case 'modlog': return this.append(h('div', { class: 'home-mark mod-mark' },
          h('span', { class: 'chg-icon', 'aria-hidden': 'true', text: '🧩' }),
          h('span', {}, h('b', { class: 'mod-name', text: item.plugin }), h('span', { class: 'mod-tag', text: 'mod' }), item.text)));
        case 'modtoast':
          if (!replay && this.isActive && state.view === 'chat') SB.toast(`🧩 ${item.plugin} (mod): ${item.text}`, { ms: item.ms });
          return;
        case 'modstatus':
          // plugin null: the conversation's process ended, and its mods with it.
          if (!item.plugin) this.modStatus.clear();
          else if (item.text) this.modStatus.set(item.plugin, item.text);
          else this.modStatus.delete(item.plugin);
          if (this.isActive) SB.renderModStatus?.(this);
          return;
      }
    }

    // The words written so far go: the finished reply (or the turn's end) takes their place.
    paintLive() {
      this.liveTimer = null;
      if (!this.live) return;
      SB.linkifyPaths(SB.patchMarkdownInto(this.live, this.liveText));
      if (this.stuck && this.isShown) this.scrollToEnd();
    }

    endLive() {
      clearTimeout(this.liveTimer);
      this.liveTimer = null;
      this.live?.remove();
      this.live = null;
    }

    // Everything drawn so far goes, and the empty state is back.
    wipe() {
      clearTimeout(this.liveTimer);
      this.liveTimer = null;
      this.live = null;
      for (const el of [...this.el.children]) if (el !== this.empty) el.remove();
      this.tools.clear();
      this.asks.clear();
      this.lanes.clear();
      this.taskLane.clear();
      this.todos = T.create();
      this.trail = null; // taken in again from what's replayed next (rewind), or starts over (/clear)
      SB.trailReset?.(this);
      this.trimmed = 0;
      this.trimmedNotice = null;
      this.shellPending = null;
      this.lastTurnId = null; // the replay, or the next message, says which turn is last now
      this.lastAsk = '';
      this.empty.hidden = false;
    }

    // Rewind: the feed starts over from what's left of the transcript.
    /** @this {Tab & FeedMixins} */
    reset(items) {
      this.wipe();
      for (const item of items) this.render(item, { replay: true });
      SB.renderTodos?.(this);
      this.scrollToEnd();
    }

    destroy() {
      this.resizer.disconnect();
      this.el.remove();
    }
  }

  // The feed's other files write their part of Tab as a class of their own;
  // this copies its methods (and getters) across, so they behave as if written here.
  SB.extendTab = (part) => {
    for (const name of Object.getOwnPropertyNames(part.prototype)) {
      if (name !== 'constructor') Object.defineProperty(Tab.prototype, name, /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(part.prototype, name)));
    }
  };

  SB.Tab = Tab;
})();
