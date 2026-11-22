/* Shellby panel — the message box's terminal conveniences, as Claude Code has them:
   @ file mentions, Up/Down and Ctrl+R through what you've sent, ! to run a
   command yourself, and Shellby's own slash commands (/export, /rewind, /effort…).
   The effort and model chips under the box are composer-chips.js; rewinding to
   an earlier message (Esc Esc) and branching from one are composer-rewind.js.
   tabs.js owns the box itself and calls in here (SB.pickKeydown, SB.runLocal…). */
'use strict';
(function () {
  const { h, api, $ } = SB;
  const input = $('input');

  // ------------------------------------------------------------ the pick menu (@ files, Ctrl+R history)

  // mode: null | 'files' | 'history'. One menu serves both, since they never overlap.
  /** @typedef {{ ctx?: boolean, glyph: string, label: string, sub: string, dir?: boolean, path: string, mention: string }} PickFile */
  /** @type {{ mode: 'files' | 'history' | null, items: Array<PickFile | string>, index: number, start: number, query: string, original: string, seq: number }} */
  const pick = { mode: null, items: [], index: 0, start: 0, query: '', original: '', seq: 0 };

  function renderPick() {
    const menu = $('pickMenu');
    if (!pick.mode || !pick.items.length) {
      menu.hidden = !pick.mode || pick.mode === 'files';
      if (pick.mode === 'history') menu.replaceChildren(h('div', { class: 'pick-empty', text: pick.query ? `Nothing you've sent matches "${pick.query}".` : "Nothing sent yet." }));
      return;
    }
    menu.hidden = false;
    SB.fitMenu(menu);
    const head = pick.mode === 'history'
      ? h('div', { class: 'pick-head', text: `Search what you've sent${pick.query ? `: "${pick.query}"` : ''} · Enter to use · ${SB.shortcuts.primary('searchSent')} for older` })
      : null;
    menu.replaceChildren(...[head, ...pick.items.map((it, i) => {
      const file = /** @type {PickFile} */ (it); // by mode: a file or context entry, or a sent message
      const sent = /** @type {string} */ (it);
      return h('button', {
      type: 'button', role: 'option', class: `slash-item pick-item${file.ctx ? ' pick-ctx' : ''}${i === pick.index ? ' on' : ''}`, 'aria-selected': String(i === pick.index),
      onmousedown: e => { e.preventDefault(); choose(i); },
    }, pick.mode === 'files' && file.ctx
      ? [h('span', { class: 'pick-glyph', text: file.glyph }), h('span', { class: 'slash-name', text: file.label }), h('span', { class: 'slash-desc', text: file.sub })]
      : pick.mode === 'files'
      ? [h('span', { class: 'pick-glyph', text: file.dir ? '▸' : '·' }), h('span', { class: 'slash-name', text: file.path }), h('span')]
      : [h('span', { class: 'pick-glyph', text: sent.startsWith('!') ? '!' : '›' }), h('span', { class: 'pick-text', text: sent.replace(/\s+/g, ' ').slice(0, 200) }), h('span')]);
    })].filter(Boolean));
    menu.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }

  // Closing Ctrl+R without choosing keeps whatever is in the box; Esc puts back what was there (pickKeydown).
  SB.hidePick = () => {
    pick.mode = null;
    pick.items = [];
    $('pickMenu').hidden = true;
  };

  function choose(i) {
    const it = pick.items[i];
    if (it == null) return;
    const file = /** @type {PickFile} */ (it); // in files mode
    if (pick.mode === 'history') {
      input.value = /** @type {string} */ (it);
      SB.hidePick();
    } else if (file.ctx) {
      attachContext(file);
    } else {
      const caret = input.selectionStart;
      const text = file.dir ? file.mention : `${file.mention} `;
      input.value = input.value.slice(0, pick.start) + text + input.value.slice(caret);
      const at = pick.start + text.length;
      input.setSelectionRange(at, at);
      SB.hidePick();
      if (file.dir) mentionCheck(); // keep going inside the folder
    }
    SB.autosize();
    input.focus();
    shellMode();
  }

  SB.pickKeydown = (e) => {
    if (SB.shortcuts.matches(e, 'searchSent')) {
      e.preventDefault();
      if (pick.mode === 'history') { if (pick.items.length) { pick.index = (pick.index + 1) % pick.items.length; renderPick(); } return true; }
      openHistorySearch();
      return true;
    }
    if (!pick.mode || $('pickMenu').hidden) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!pick.items.length) return true;
      e.preventDefault();
      pick.index = (pick.index + (e.key === 'ArrowDown' ? 1 : -1) + pick.items.length) % pick.items.length;
      renderPick();
      return true;
    }
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      if (!pick.items.length) { SB.hidePick(); return e.key === 'Tab'; }
      e.preventDefault();
      choose(pick.index);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (pick.mode === 'history') { input.value = pick.original; SB.autosize(); }
      SB.hidePick();
      return true;
    }
    return false;
  };

  // ------------------------------------------------------------ @ file mentions

  // What Shellby knows and Claude can't see (a dev server, a red build, a chat,
  // a note) sits above the files (src/main/wiring/mention-context.js). A pick
  // takes the @word out of the box and attaches a snapshot: its chip opens to
  // exactly what goes to Claude.
  async function attachContext(it) {
    const tab = SB.activeTab();
    const caret = input.selectionStart;
    input.value = input.value.slice(0, pick.start) + input.value.slice(caret);
    input.setSelectionRange(pick.start, pick.start);
    SB.hidePick();
    if (!tab) return;
    if (it.kind === 'ci') SB.toast('Getting the build log…', { ms: 3000 });
    const r = await api.context.attach(tab.id, it.id).catch(() => null);
    if (!r?.ok) return SB.toast(r?.error || "Couldn't attach that.");
    if (SB.activeTab() === tab) return SB.addAttachments([r.path]);
    // Moved on while a build log came in: it waits in the box it was picked in.
    if (!tab.attachments.includes(r.path)) tab.attachments.push(r.path);
  }

  // What's being typed after an @ just before the caret: a bare path, or a
  // quoted one with spaces in it.
  const MENTION = /(?:^|\s)@("[^"]*|[^\s"]*)$/;

  /** @type {number | null} */
  let mentionTimer = null;
  function mentionCheck() {
    const tab = SB.activeTab();
    const before = input.value.slice(0, input.selectionStart);
    const m = input.selectionStart === input.selectionEnd && MENTION.exec(before);
    if (!m || !tab) { if (pick.mode === 'files') SB.hidePick(); return; }
    const query = m[1].replace(/^"/, '');
    pick.start = before.length - m[1].length - 1;
    if (mentionTimer) clearTimeout(mentionTimer);
    const seq = ++pick.seq;
    mentionTimer = setTimeout(async () => {
      const [ctx, files] = await Promise.all([
        api.context.suggest(tab.id, query).catch(() => []),
        api.suggestFiles(tab.id, query).catch(() => []),
      ]);
      const items = [...ctx.map(c => ({ ...c, ctx: true })), ...files];
      if (seq !== pick.seq) return; // typed on since
      pick.mode = 'files';
      pick.items = items;
      pick.index = 0;
      pick.query = query;
      renderPick();
    }, 70);
  }

  // ------------------------------------------------------------ what you've sent (Up / Down, Ctrl+R)

  let sent = [];
  let walk = -1;        // where Up/Down is in `sent`; -1 = your own draft
  let draft = '';
  api.promptHistory().then(list => { if (Array.isArray(list)) sent = [...list, ...sent.filter(s => !list.includes(s))]; }).catch(() => {});

  SB.notePrompt = (text) => {
    const t = String(text || '').trim();
    if (!t) return;
    sent = [...sent.filter(s => s !== t), t].slice(-200);
    walk = -1;
  };

  SB.historyKeydown = (e) => {
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    // Inside a message of several lines, the arrows move between its lines first.
    if (e.key === 'ArrowUp' && input.value.slice(0, input.selectionStart).includes('\n')) return;
    if (e.key === 'ArrowDown' && input.value.slice(input.selectionEnd).includes('\n')) return;
    if (e.key === 'ArrowDown' && walk < 0) return;
    if (e.key === 'ArrowUp' && !sent.length) return;
    e.preventDefault();
    if (walk < 0) { draft = input.value; walk = sent.length; }
    walk += e.key === 'ArrowUp' ? -1 : 1;
    if (walk < 0) walk = 0;
    if (walk >= sent.length) { walk = -1; input.value = draft; } else input.value = sent[walk];
    input.setSelectionRange(input.value.length, input.value.length);
    SB.autosize();
    shellMode();
  };

  function historyMatches(q) {
    const needle = q.trim().toLowerCase();
    const out = [];
    for (let i = sent.length - 1; i >= 0 && out.length < 12; i--) if (!needle || sent[i].toLowerCase().includes(needle)) out.push(sent[i]);
    return out;
  }

  function openHistorySearch() {
    pick.mode = 'history';
    pick.original = input.value;
    pick.query = input.value;
    pick.items = historyMatches(pick.query);
    pick.index = 0;
    renderPick();
  }

  // ------------------------------------------------------------ ! runs a command yourself

  const SHELL_HINT = '! runs this in PowerShell here · the output goes to Claude with your next message';
  let wasShell = false;
  function shellMode() {
    const on = input.value.startsWith('!') && !input.value.startsWith('!!');
    $('composer').classList.toggle('shell-mode', on);
    if (on) $('sendHint').textContent = SHELL_HINT;
    else if (wasShell) SB.syncBusyUi();
    wasShell = on;
  }
  SB.composerShellMode = shellMode; // a rewind puts your message back in the box (composer-rewind.js)

  // Every change to the box's text (typing, pasting, clearing after a send).
  SB.composerInput = () => {
    walk = -1;
    shellMode();
    if (pick.mode === 'history') {
      pick.query = input.value;
      pick.items = historyMatches(pick.query);
      pick.index = 0;
      renderPick();
      return;
    }
    mentionCheck();
  };
  input.addEventListener('click', () => { if (pick.mode === 'files') mentionCheck(); });

  async function runShell(tab, command) {
    if (!command) { SB.toast('Type a command after the !, like: !git status'); return; }
    SB.notePrompt(`!${command}`);
    tab.renderShellPending(command);
    const r = await api.runShell(tab.id, command);
    if (!r?.ok) { tab.renderShellPending(null); if (!r?.cancelled) SB.toast(r?.error || "Couldn't run that."); }
  }

  // ------------------------------------------------------------ Shellby's own slash commands

  SB.LOCAL_COMMANDS = [
    { name: 'clear', kind: 'shellby', description: 'Start a new conversation in this tab: Claude forgets everything so far. /export still has it' },
    { name: 'rewind', kind: 'shellby', description: 'Go back to an earlier message: the conversation, the code, or both (Esc Esc)' },
    { name: 'branch', kind: 'shellby', description: 'Try again from an earlier message in a new tab, with its own copy of the files. This one stays as it is' },
    { name: 'tries', kind: 'shellby', description: 'Try a message 2, 3 or 4 ways at once, each in its own copy, then pick the best: /tries 3 fix the login. Asks first, with the cost' },
    { name: 'debug', kind: 'shellby', description: 'Find what really causes a bug: Claude adds logging, you reproduce it, he fixes it from what was logged, then takes the logging out: /debug the cart total is wrong' },
    { name: 'btw', kind: 'shellby', description: 'Ask a quick side question, even while Claude works. It sees the conversation but stays out of it' },
    { name: 'export', kind: 'shellby', description: 'Save this conversation as Markdown (/export clipboard copies it)' },
    { name: 'effort', kind: 'shellby', description: 'How hard Claude thinks here: low, medium, high, xhigh, max or auto. /effort new <level|pick> for new conversations' },
    { name: 'permissions', kind: 'shellby', description: 'The allow, ask and deny rules Claude Code follows' },
    { name: 'mcp', kind: 'shellby', description: 'MCP servers: add, remove, reconnect, turn on or off' },
    { name: 'model', kind: 'shellby', description: 'Switch the model this conversation runs: /model, or /model sonnet, opus, haiku, default' },
    { name: 'output-style', kind: 'shellby', description: 'How Claude talks while it works (Explanatory, Learning…)' },
    { name: 'snippets', kind: 'shellby', description: 'Your saved prompts. /snippets save [name] keeps the last thing you sent; /snippets new writes one' },
  ];

  const LOCAL = {
    clear: (tab) => clearConversation(tab),
    rewind: (tab) => SB.openRewind(tab),
    branch: (tab) => SB.openBranch(tab),
    // Try it N ways (tries.js): main asks first, with what it usually costs.
    tries: (tab, arg) => startTries(tab, arg),
    try: (tab, arg) => startTries(tab, arg),
    btw: (tab, arg) => askBtw(tab, arg),
    // Debug mode (debug-mode.js): every later step is a button on its card.
    debug: (tab, arg) => SB.startDebug(tab, arg),
    export: async (tab, arg) => {
      if (!tab.saved) return SB.toast('Send it something first: there is nothing to export yet.');
      const to = /^clip/i.test(arg) ? 'clipboard' : 'file';
      const r = await api.exportSession(tab.id, to);
      if (r?.ok) SB.toast(to === 'clipboard' ? 'Copied the conversation as Markdown.' : `Saved to ${SB.tildify(r.path)}`, { ms: 5000 });
      else if (!r?.cancelled) SB.toast(r?.error || "Couldn't export it.");
    },
    effort: (_tab, arg) => SB.effortCommand(arg), // a level, or the chip's menu (composer-chips.js)
    permissions: () => SB.showToolbox?.('permissions'),
    mcp: () => SB.showToolbox?.('mcp'),
    // As in the terminal: /model opens the picker, /model sonnet (or an id, a label, default) switches (composer-chips.js).
    model: (_tab, arg) => SB.modelCommand(arg),
    'output-style': () => SB.showSetting?.('styleSelect'),
    snippets: (tab, arg) => {
      if (!arg) return SB.showToolbox?.('snippet');
      if (/^new$/i.test(arg)) return SB.newSnippet();
      // Without a name: the editor, with the message in it, to name and tidy.
      if (/^save$/i.test(arg)) {
        const last = lastSent();
        return last ? SB.newSnippet({ text: last }) : SB.toast('Send Claude something first, then save it.');
      }
      const m = /^save\s+(\S+)$/i.exec(arg);
      if (!m) return SB.toast("That's /snippets, /snippets new, or /snippets save [name] to keep the last thing you sent.");
      saveLastAsSnippet(m[1].replace(/^[/@]/, ''));
    },
  };

  // /tries 3 fix the login: main reads the number and the message, and asks.
  // What's attached goes to every try.
  const TAKES_FILES = new Set(['tries', 'try']);
  function startTries(tab, arg) {
    if (!arg) {
      // The box is emptied once this returns: what was attached comes back.
      const files = [...(tab.attachments || [])];
      queueMicrotask(() => SB.giveBackAttachments?.(tab, files));
      return SB.toast('Say how many ways and what: /tries 3 fix the flaky login test');
    }
    SB.startTries?.(tab, { arg, attachments: [...(tab.attachments || [])] });
  }

  // /clear, as in the terminal: main ends Claude's conversation and notes
  // 'cleared', which empties the feed as it arrives (feed.js). The next message
  // starts a new one here, in the same folder and copy.
  async function clearConversation(tab) {
    if (!tab) return;
    if (tab.busy) return SB.toast('Let him finish first (or press Stop), then clear.');
    const r = await api.clearTab(tab.id);
    if (!r?.ok) return SB.toast(r?.error || "Couldn't clear it.");
    // Nothing sent yet: only ! output on screen, which main has let go of too.
    if (r.empty) { if (tab.isEmpty) SB.toast('Nothing to clear yet.'); else tab.wipe(); }
  }
  SB.clearConversation = clearConversation; // the palette's Clear (nav.js)

  // /btw what was that file called?: answered in a card of its own (feed-notes.js),
  // from a fork of the conversation that Claude never sees (btw.js).
  async function askBtw(tab, question) {
    if (!question) return SB.toast('Ask something after /btw, like: /btw what was that file called?');
    tab.renderBtw(question, (q, history) => api.askBtw(tab.id, q, history));
  }

  // The last thing you asked Claude, kept as a snippet: "that worked, keep it".
  const lastSent = () => [...sent].reverse().find(s => !/^[/!]/.test(s));
  async function saveLastAsSnippet(name) {
    const last = lastSent();
    if (!last) return SB.toast('Send Claude something first, then save it.');
    const r = await api.saveSnippet({ name, text: last });
    if (!r?.ok) return SB.toast(r?.error || "Couldn't save it.", { ms: 6000 });
    SB.applySnippets(r);
    SB.toast(`Saved as /${r.name}. From a terminal: shellby do @${r.name}`, { ms: 6000 });
  }

  /** Handles a message that's for Shellby, not Claude. true = handled. */
  // !! sends Claude a message that starts with a single !.
  // With attachments, only the commands that take them run here (/tries); the
  // rest go to Claude with the files, as they always have.
  SB.runLocal = (text, tab, attachments = []) => {
    if (text.startsWith('!!')) return false;
    if (text.startsWith('!')) { if (attachments.length) return false; runShell(tab, text.slice(1).trim()); return true; }
    const m = /^\/([\w-]+)(?:\s+(.*))?$/s.exec(text);
    const fn = m && LOCAL[m[1].toLowerCase()];
    // Then Claude Code's own that print mode can't run (builtin-commands.js).
    if (!fn && !attachments.length) return !!SB.runBuiltin?.(text, tab);
    if (!fn || (attachments.length && !TAKES_FILES.has(m[1].toLowerCase()))) return false;
    SB.notePrompt(text);
    fn(tab, (m[2] || '').trim());
    return true;
  };
})();
