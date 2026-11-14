// A copy's branch as a pane's header shows it (panel/tab-panes.js paintLane):
// "shellby/feat-notifications-bell-47f58c" reads as the words "notifications
// bell", with its kind ("feat") as a colour. Shellby's own prefix and the six
// hex characters it adds (main's worktrees branchName) say nothing, so they go;
// the full name stays in the card and the tooltip. No DOM, so it runs in the
// browser and in Node (for tests).
(function (root) {
  // The commit types CONTRIBUTING.md names. The first four get a colour of their own.
  const KINDS = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'chore', 'ci'];
  const COLOURED = new Set(['feat', 'fix', 'perf', 'refactor']);
  const SHELLBY = /^shellby\//;
  const SUFFIX = /-[0-9a-f]{6}$/;

  /**
   * @param {string} full the branch as git has it
   * @returns {{ full: string, kind: string, colour: string, words: string }}
   *   kind is '' when the name doesn't start with one; colour is a kind or 'other'.
   */
  function branchLabel(full) {
    const name = String(full || '');
    const ours = SHELLBY.test(name);
    const slug = ours ? name.replace(SHELLBY, '').replace(SUFFIX, '') : name;
    const [first, ...rest] = slug.split(/[-_/]+/).filter(Boolean);
    const isKind = KINDS.includes(first) && rest.length > 0;
    const words = (isKind ? rest : [first, ...rest]).filter(Boolean).join(' ');
    return {
      full: name,
      kind: isKind ? first : '',
      colour: isKind && COLOURED.has(first) ? first : 'other',
      words: words || slug || name,
    };
  }

  const api = { branchLabel, KINDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShellbyBranchLabel = api;
})(typeof window !== 'undefined' ? window : globalThis);
