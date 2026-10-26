/* Shellby panel — Ship it: a copy's work to a pull request in one go. Main
   does the steps (src/main/ship.js: the tests, the commit, the secret scan,
   the push and the pull request); this starts it, says how it went, and offers
   what would get it unstuck. The branch chip, Ctrl+K and the review inbox all
   come here. */
'use strict';
(function () {
  const { api } = SB;
  const shipping = new Set(); // tabs on their way: a double click is one

  function setUpGithub() {
    SB.setView('settings');
    setTimeout(() => SB.$('githubGroup')?.scrollIntoView({ block: 'start' }), 80);
  }

  /** @param {any} r  a pull request opened, or one pushed to again */
  function shippedText(r) {
    const what = r.existing ? `Pushed the new work to pull request #${r.number}` : `Opened ${r.draft ? 'a draft ' : ''}pull request #${r.number}`;
    return `${what} on ${r.repo}.${r.green ? ' Tests green on this branch.' : ''}`;
  }

  /**
   * @param {any} tab
   * @param {{ draft?: boolean, force?: boolean }} [opts]  force: past red checks
   */
  async function shipIt(tab, { draft = false, force = false } = {}) {
    if (!tab?.worktree) return SB.toast('Ship it works on a conversation with a copy of its own (Settings → Claude → Copies of a project).', { ms: 8000 });
    if (tab.busy) return SB.toast('Let him finish first.');
    if (shipping.has(tab.id)) return SB.toast('Already shipping this one.');
    shipping.add(tab.id);
    SB.toast(force ? 'Pushing it and opening the pull request…' : 'Running the tests in the copy, then opening a pull request…', { ms: 60000 });
    /** @type {any} */
    let r;
    try {
      r = await api.shipWorktree(tab.id, { draft, force });
    } catch {
      r = null;
    } finally {
      shipping.delete(tab.id);
    }
    if (r?.ok) return SB.toast(shippedText(r), { ms: 10000, action: 'Open it', onAction: () => api.openExternal(r.url) });
    if (r?.red) {
      return SB.toast(r.error, { ms: 14000, actions: [
        { label: 'Ship it anyway', onAction: () => shipIt(tab, { draft, force: true }) },
        r.fix ? { label: 'Ask him to fix them', onAction: () => { SB.activate(tab.id); SB.send(r.fix); } } : null,
      ].filter(Boolean) });
    }
    if (r?.github) return SB.toast(r.error, { ms: 10000, action: 'Set up GitHub', onAction: setUpGithub });
    SB.toast(r?.error || "Couldn't ship it.", { ms: 9000 });
  }

  SB.shipIt = shipIt;
})();
