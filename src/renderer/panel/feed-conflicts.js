/* Shellby panel — what clashes when a copy can't come home: each file, and in
   it each place where your branch and the copy both changed the same lines,
   the two sides next to each other. Main reads it from git alone (worktrees/
   conflicts.js), so nothing in your checkout moves. Each clash, or all of them,
   can go to Claude to resolve in the copy, where the merge belongs. Part of Tab
   (feed.js). */
'use strict';
(function () {
  const { h, api } = SB;
  const S = window.ShellbySyntax;
  const { plural } = SB;

  // One side of a clash, coloured as its file is.
  function side(title, lines, file) {
    const tk = S?.lineTokenizer(S.langFromPath(file));
    const code = h('pre', { class: 'cf-code' }, (lines.length ? lines : ['']).map(l => {
      const row = h('span', { class: 'cf-line' });
      if (tk && l) SB.paintTokens(row, tk.line(l)); else row.textContent = l || ' ';
      return row;
    }));
    return h('div', { class: 'cf-side' }, h('div', { class: 'cf-side-head', text: lines.length ? title : `${title} (nothing here)` }), code);
  }

  class ConflictsFeed {
    /** r: main's worktree:conflicts answer, with files: [{ path, hunks: [{ at, ours, theirs, prompt }] }]. */
    renderConflicts(r) {
      const ask = prompt => {
        if (this.busy) return SB.toast('Let him finish first.');
        SB.activate(this.id);
        SB.send(prompt);
      };
      const clashes = r.files.reduce((n, f) => n + Math.max(1, f.hunks.length), 0);
      const fileBlock = f => h('section', { class: 'cf-file' },
        h('h4', { class: 'cf-path' }, SB.fileLink ? SB.fileLink(f.path, { text: f.path }) : f.path),
        ...(f.hunks.length ? f.hunks.map(hk => h('div', { class: 'cf-hunk', role: 'group', 'aria-label': `${f.path}, around line ${hk.at}` },
          h('div', { class: 'cf-hunk-head' },
            h('span', { class: 'small muted', text: `Around line ${hk.at}` }),
            h('button', { class: 'btn ghost slim-btn', type: 'button', title: 'He merges in the copy, starting with this clash, keeping what both sides meant', onclick: () => ask(hk.prompt) }, 'Let Claude resolve this')),
          h('div', { class: 'cf-sides' }, side(`In ${r.base}`, hk.ours, f.path), side('In this copy', hk.theirs, f.path))))
          : [h('p', { class: 'small muted', text: 'Changed on one side and deleted or renamed on the other: no lines to put side by side.' })]));
      const el = h('details', { class: 'changes conflicts', open: true },
        h('summary', {},
          h('span', { class: 'chg-icon', 'aria-hidden': 'true', text: '⚠' }),
          h('span', { class: 'chg-title', text: `Clashes with ${r.base}: ${plural(r.files.length + (r.more || 0), 'file')}, ${plural(clashes, 'place')}` })),
        h('p', { class: 'small muted cf-lede', text: `Nothing was merged and your checkout is as it was. These are the places where ${r.base} and this copy both changed the same lines.` }),
        ...r.files.map(fileBlock),
        r.more ? h('p', { class: 'small muted', text: `…and ${plural(r.more, 'more file')}.` }) : null,
        h('div', { class: 'chg-actions' },
          h('button', { class: 'btn slim-btn', type: 'button', onclick: () => ask(r.prompt) }, 'Let Claude resolve them all'),
          h('span', { class: 'small muted', text: `He merges ${r.base} into the copy and sorts each one out. Then bring it home again.` })));
      this.append(el);
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  SB.extendTab(ConflictsFeed);

  /** Bring it home clashed: show where, in the conversation (tab-git.js). */
  SB.showConflicts = async (tab) => {
    const r = await api.worktreeConflicts(tab.id).catch(() => null);
    if (!r?.ok) return SB.toast(r?.error || "Couldn't work out where it clashes.", { ms: 8000 });
    if (r.clean) return SB.toast(`It merges cleanly into ${r.base} now. Bring it home again.`, { ms: 7000 });
    SB.activate(tab.id);
    tab.renderConflicts(r);
  };
})();
