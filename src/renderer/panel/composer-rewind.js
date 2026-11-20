/* Shellby panel — going back: rewinding a conversation to just before one of
   your messages (the conversation, the code, or both), its other half, branching
   into a new tab that remembers it up to that point in its own copy of the files
   (branching.js), and Esc Esc in an empty box opening the picker. Both menus
   open above the message box. composer.js and feed-blocks.js call in here
   (SB.openRewind, SB.openBranch, SB.escRewind). */
'use strict';
(function () {
  const { h, api, $ } = SB;
  const input = $('input');
  const { plural } = SB;

  // ------------------------------------------------------------ rewind

  // Menus open below their anchor; this one belongs above the box.
  function openAboveBox(build) {
    const menu = $('rewindMenu');
    SB.openMenu(menu, $('form'), build);
    if (menu.hidden) return;
    const r = $('form').getBoundingClientRect();
    menu.style.top = `${Math.max(8, r.top - menu.offsetHeight - 8)}px`;
    menu.style.left = `${Math.max(8, r.left)}px`;
  }

  SB.openRewind = async (tab, turnId = null) => {
    if (!tab) return;
    if (tab.busy) return SB.toast('Let him finish first (or press Stop), then rewind.');
    const { points = [] } = await api.rewindPoints(tab.id).catch(() => ({}));
    if (!points.length) return SB.toast('Nothing to rewind to yet.');
    const chosen = turnId && points.find(p => p.turnId === turnId);
    if (chosen) return rewindOptions(tab, chosen);
    // A timeline, newest at the top: each stop is "before turn N", with what going back there undoes.
    openAboveBox(() => [
      h('div', { class: 'menu-label', text: 'Rewind to just before…' }),
      h('div', { class: 'rewind-timeline' }, points.slice(0, 30).map((p, i) => h('button', { class: `menu-item rewind-point${p.code ? ' has-code' : ''}`, onclick: () => rewindOptions(tab, p) },
        h('span', { class: 'rewind-stop', 'aria-hidden': 'true' }),
        h('span', {},
          h('div', { class: 'mi-title rewind-text', text: p.text || '(no text)' }),
          h('div', { class: 'mi-sub', text: [`before turn ${points.length - i}`, p.at ? SB.relTime(p.at) : null, codeAfter(p)].filter(Boolean).join(' · ') }))))),
    ]);
  };

  // "undoes 3 files, +40 −12" for a stop with code after it (rewind.js weight).
  function codeAfter(p) {
    if (!p.code) return 'no file changes after it';
    return p.files ? `undoes ${plural(p.files, 'file')}, +${p.added || 0} −${p.removed || 0}` : `${plural(p.code, 'turn')} of file changes after it`;
  }

  function rewindOptions(tab, p) {
    const option = (glyph, title, sub, opts, enabled = true) => h('button', { class: 'menu-item', disabled: !enabled, onclick: () => { SB.closeMenus(); doRewind(tab, p, opts); } },
      h('span', { class: 'mi-check', text: glyph }), h('span', {}, h('div', { class: 'mi-title', text: title }), h('div', { class: 'mi-sub', text: sub })));
    const files = p.code ? `undoes ${plural(p.code, 'turn')} of file changes` : 'no files changed after it';
    const older = p.conversation ? null : 'From before Shellby could rewind conversations';
    SB.closeMenus();
    openAboveBox(() => [
      h('div', { class: 'menu-label', text: 'Rewind to just before' }),
      h('div', { class: 'menu-item path rewind-quote', text: p.text || '(no text)' }),
      h('div', { class: 'menu-sep' }),
      option('⟲', 'Conversation and code', older || `Forget everything after it, and ${files}`, { conversation: true, code: true }, p.conversation && p.code > 0),
      option('💬', 'Conversation only', older || 'Forget everything after it. Files stay as they are now', { conversation: true, code: false }, p.conversation),
      option('⎌', 'Code only', p.code ? `Put the files back; the conversation carries on` : 'No files changed after it', { conversation: false, code: true }, p.code > 0),
      h('div', { class: 'menu-sep' }),
      // The way back that loses nothing: this conversation and its files stay as they are.
      h('button', { class: 'menu-item', disabled: !p.conversation, onclick: () => { SB.closeMenus(); doBranch(tab, p.turnId, 'before'); } },
        h('span', { class: 'mi-check', text: '⑂' }),
        h('span', {}, h('div', { class: 'mi-title', text: 'Try it in a new tab instead' }), h('div', { class: 'mi-sub', text: older || 'Keeps this conversation and its files exactly as they are' }))),
      h('div', { class: 'menu-sep' }),
      h('button', { class: 'menu-item', onclick: () => SB.closeMenus() }, h('span', { class: 'mi-check', text: '' }), h('span', { class: 'mi-title', text: 'Never mind' })),
    ]);
  }

  async function doRewind(tab, p, opts) {
    const job = SB.toast.job('Rewinding…', { ms: 15000 });
    const r = await api.rewind(tab.id, p.turnId, opts).catch(() => null);
    if (!r?.ok) return job.fail(r?.error || "Couldn't rewind.", { ms: 9000 });
    const files = r.restored ? ` Put ${plural(r.restored, 'file')} back.` : '';
    if (r.kept) return job.done(`Code rewound.${files}`, { ms: 6000 });
    tab.reset(r.items || []);
    tab.queue = [];
    if (tab.isActive) {
      // Like the terminal: what you said comes back, ready to change and send again.
      if (!input.value.trim()) input.value = r.text || '';
      for (const f of r.attachments || []) if (!tab.attachments.includes(f)) tab.attachments.push(f);
      SB.renderAttachments();
      SB.autosize();
      input.focus();
      SB.composerShellMode(); // the box may hold a ! command again
      SB.syncBusyUi();
    } else if (!tab.draft) tab.draft = r.text || '';
    job.done(`Rewound.${files} Your message is back in the box.`, { ms: 6000 });
  }

  // ------------------------------------------------------------ branch (branching.js)
  //
  // Rewind's other half: instead of taking this conversation back, open a new
  // tab that remembers it up to a point, in its own copy of the files as they
  // were then. This one carries on untouched, so two tries can run side by side.

  // A conversation's name as a link that opens it (from History if it's closed).
  SB.historyLink = (id, text) => h('button', { class: 'link-btn', type: 'button', onclick: () => SB.openHistory(id) }, text);

  // turnId: the message to branch at (none: pick one, newest first).
  // at: 'before' the message (try it again) or 'after' its reply (carry on from there).
  SB.openBranch = async (tab, turnId = null, at = 'before') => {
    if (!tab) return;
    if (!tab.saved) return SB.toast('Send it something first: there is nothing to branch yet.');
    const { points = [] } = await api.rewindPoints(tab.id).catch(() => ({}));
    if (!points.length) return SB.toast('Nothing to branch from yet.');
    const chosen = turnId && points.find(p => p.turnId === turnId);
    if (chosen) return branchOptions(tab, chosen, at);
    openAboveBox(() => [
      h('div', { class: 'menu-label', text: 'Try again in a new tab from just before…' }),
      ...points.slice(0, 30).map(p => h('button', { class: 'menu-item rewind-point', disabled: !p.conversation, onclick: () => branchOptions(tab, p, 'before') },
        h('span', { class: 'mi-check', text: '⑂' }),
        h('span', {},
          h('div', { class: 'mi-title rewind-text', text: p.text || '(no text)' }),
          h('div', { class: 'mi-sub', text: p.conversation ? (p.at ? SB.relTime(p.at) : '') : 'From before Shellby could branch conversations' })))),
    ]);
  };

  function branchOptions(tab, p, at) {
    const option = (glyph, title, sub, run, enabled = true) => h('button', { class: 'menu-item', disabled: !enabled, onclick: () => { SB.closeMenus(); run(); } },
      h('span', { class: 'mi-check', text: glyph }), h('span', {}, h('div', { class: 'mi-title', text: title }), h('div', { class: 'mi-sub', text: sub })));
    const older = p.conversation ? null : 'From before Shellby could branch conversations';
    const files = tab.worktree || tab.cwd ? 'its own copy of the files as they were then' : 'the files';
    SB.closeMenus();
    openAboveBox(() => [
      h('div', { class: 'menu-label', text: at === 'after' ? 'Branch after the reply to' : 'Try again from just before' }),
      h('div', { class: 'menu-item path rewind-quote', text: p.text || '(no text)' }),
      h('div', { class: 'menu-sep' }),
      ...(at === 'after'
        ? [option('⑂', 'Branch from here', older || `A new tab that carries on from this reply, with ${files}`, () => doBranch(tab, p.turnId, 'after'), p.conversation)]
        : [
          option('✎', 'Change it and try again', older || `A new tab from just before this message, with ${files}. Your message waits in the box`, () => doBranch(tab, p.turnId, 'before'), p.conversation),
          option('↻', 'Run it again in a new tab', older || 'The same message, sent again straight away: two takes side by side', () => doBranch(tab, p.turnId, 'before', { send: true }), p.conversation),
        ]),
      h('div', { class: 'small muted menu-note', text: 'This conversation and its files stay exactly as they are.' }),
      h('div', { class: 'menu-sep' }),
      h('button', { class: 'menu-item', onclick: () => SB.closeMenus() }, h('span', { class: 'mi-check', text: '' }), h('span', { class: 'mi-title', text: 'Never mind' })),
    ]);
  }

  async function doBranch(tab, turnId, at, { send = false } = {}) {
    // Long enough for its copy's packages to install (copy-deps.js); the answer replaces it.
    const job = SB.toast.job('Making a branch…', { ms: 180000 });
    const r = await api.branch(tab.id, turnId, { at, send }).catch(() => null);
    if (!r?.ok) return r?.cancelled ? job.fail('Not branched.', { ms: 2800, tone: null }) : job.fail(r?.error || "Couldn't make the branch.", { ms: 9000 });
    // The new tab has opened itself (boot.js onTabOpened).
    const where = r.branch ? `its own copy on ${r.branch}` : 'the same folder as the original';
    const note = r.filesNow ? ' The files are as they are now: the ones from then had been tidied away.' : r.approx ? ' The files are as near to then as Shellby can tell.' : '';
    job.done(r.sent ? `Running it again in ${where}.${note}` : at === 'before' ? `Branched into ${where}. Change your message and send it.${note}` : `Branched into ${where}. Carry on from there.${note}`, { ms: 7000 });
  }

  // Esc twice in an empty box (not working), within a moment: the rewind
  // picker. A single Esc does nothing: home is where Esc stops (tabs.js), and
  // a stray press must never make the window vanish.
  const DOUBLE_ESC_MS = 420;
  let escAt = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let escTimer = null;
  SB.escRewind = (tab, e) => {
    if (e?.repeat) return true; // a held-down Esc is one press, not a double
    if (!tab?.saved || tab.busy || input.value.trim() || document.activeElement !== input) return false;
    const now = Date.now();
    if (escTimer && now - escAt < DOUBLE_ESC_MS) {
      clearTimeout(escTimer);
      escTimer = null;
      SB.openRewind(tab);
      return true;
    }
    escAt = now;
    clearTimeout(escTimer ?? undefined);
    escTimer = setTimeout(() => { escTimer = null; }, DOUBLE_ESC_MS);
    return true;
  };
})();
