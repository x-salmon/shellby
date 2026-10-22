// Shellby on your phone: "Look over my changes" (ipc/progress.js review:start,
// the desk's shield). A read-only security review of what's pending, in a
// conversation's own folder (its copy's branch) or in a project from the
// phone's list. Always Ask first, whatever mode is picked, so a review can't
// change anything without you; it counts as a task the phone started, under
// the same limits (wiring/pocket.js claimStart). At the usage limit it says
// so rather than queueing: a review is worth reading when it's fresh.
const { repoOf } = require('../gitinfo');
const { reviewPrompt } = require('../review');

const ok = extra => ({ ok: true, ...extra });
const no = error => ({ ok: false, error });
const str = (v, n = 200) => (typeof v === 'string' && v.length > 0 && v.length <= n ? v : null);

/**
 * d: what main shares. projects(): the phone's list. claimStart() -> { ok, reply }:
 * a place under the phone's limits, taken. adopt(tabId): mark it as the phone's.
 */
function createLookOver(d, { projects, claimStart, adopt, pushView }) {
  return async function lookOver({ tabId, project }) {
    const tab = str(tabId) ? d.manager.tabs.get(tabId) : null;
    if (str(tabId) && !tab) return no('That conversation has closed.');
    const dir = tab ? tab.session?.cwd : projects().find(p => p.key === project)?.key;
    if (!dir) return no("That project isn't one Shellby knows. Pick one from the list.");
    const repo = await repoOf(dir).catch(() => null);
    if (!repo) return no("That folder isn't a git repository, so there are no changes to look over.");
    if (d.usageService?.limitWait()) return no("You're at your usage limit. Ask again after the reset.");
    const gate = claimStart();
    if (!gate.ok) return no(gate.reply);
    const r = d.startTask(reviewPrompt(repo.name), `Look over ${repo.name}`, { mode: 'ask', cwd: repo.root });
    if (!r.ok) return no(r.error || "Couldn't start it.");
    adopt(r.tabId);
    d.questDone?.('look-over');
    d.log.info('pocket: looking over', repo.name);
    pushView();
    return ok({ tabId: r.tabId });
  };
}

module.exports = { createLookOver };
