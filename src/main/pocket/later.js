// Shellby on your phone: what the phone sets going for later or again
// (wiring/pocket.js hands these the phone's calls):
//
//   a task for later   after the reset or tonight, into the desk's own queue
//   cancel-held        take something out of the queue (a running task stops)
//   held-edit          reword a queued task that hasn't started anywhere yet
//   held-move          move it up or down: the queue goes oldest first
//   checks-run         run a conversation's checks again, on its last change
//   branch-from        Try again from a message, or Branch from after its turn (branching.js)
//
// None of these is open to a read-only phone (pocket/rights.js lists none of them).
const pt = require('../channels/phone-tasks');

const CHECKS_ANSWER_MS = 1500; // a check that can't start says why in this time; one that runs is reported by the view

const ok = extra => ({ ok: true, ...extra });
const no = error => ({ ok: false, error });
const str = (v, n = 200) => (typeof v === 'string' && v.length > 0 && v.length <= n ? v : null);

/**
 * @param d  main's shared deps
 * @param o  adopt(tabId): a new conversation is the phone's; pushView: the view changed;
 *   claimStart(opts): a place under the phone's task limits ({ ok } or { ok: false, reply }); opts.open: count as open instead;
 *   once(kind, body, start): the same key asked again gets the first answer
 */
function createPocketLater(d, { adopt, pushView, claimStart, once }) {
  /** A task the phone queued for later. prompt, cwd, mode and model are checked already. */
  function queueForLater({ prompt, cwd, mode, model, when, photos }) {
    if (Array.isArray(photos) && photos.length) return no('Pictures only go with a task that starts now.');
    // It runs with nobody there, so Autonomous for later is the desk's to queue (it asks each time).
    if (mode === 'autonomous') return no('An Autonomous task for later is queued at your PC, where it asks first.');
    // Counted in the hour like any phone task, but not as open: nothing runs yet.
    const gate = claimStart({ open: 0 });
    if (!gate.ok) return no(gate.reply);
    const held = d.holdForReset({ kind: 'task', prompt, cwd, mode, fromPhone: true, when, ...(model ? { model } : {}) });
    if (!held.ok) return no(held.error || "Couldn't queue it.");
    d.sendOutlook?.();
    pushView();
    return ok({ held: true, atText: held.atText, when });
  }

  function cancelHeld({ id }) {
    const r = d.cancelHeld?.(str(id));
    if (!r?.ok) return no('That has already gone.');
    d.sendOutlook?.();
    pushView();
    return ok();
  }

  function heldChange(fn) {
    const r = d.heldService ? fn() : { ok: false, error: 'The queue isn’t ready yet.' };
    if (!r.ok) return no(r.error || 'That has already gone.');
    pushView();
    return ok();
  }
  // Only a task the phone queued itself, and never into a command: rewording one queued at the desk
  // (in Autonomous, say) would send the phone's words off under the desk's rules.
  function heldEdit({ id, prompt }) {
    const h = (d.heldList?.() || []).find(x => x.id === str(id, 64));
    if (!h || h.kind !== 'task') return no('That has already gone.');
    if (!h.fromPhone || h.mode === 'autonomous') return no('That one was queued at your PC, so it changes there.');
    const text = pt.cleanText(typeof prompt === 'string' ? prompt : '').slice(0, pt.MAX_TEXT).trim();
    if (/^[/!]/.test(text)) return no('Commands that start with / or ! only run at the desk.');
    return heldChange(() => d.heldService.rewordHeld(h.id, text));
  }
  const heldMove = ({ id, dir }) => heldChange(() => d.heldService.moveHeld(str(id, 64), dir === 'up' ? -1 : 1));

  // Run checks again on the conversation's last change: after Fix it, say.
  async function runChecks({ tabId }) {
    if (!str(tabId) || !d.manager.tabs.has(tabId)) return no('That conversation has closed.');
    const last = [...d.history.load(tabId)].reverse().find(i => i?.kind === 'changes');
    if (!last) return no('Nothing has changed here yet, so there is nothing to check.');
    const ref = d.changeRef?.({ tabId, root: last.root, before: last.before, after: last.after });
    if (!ref) return no("That isn't a change from this conversation.");
    // The run can take minutes: the phone hears "running" from the view, and the verdict the same way.
    const going = Promise.resolve(d.runChecksFor(ref)).catch(err => ({ ok: false, error: err.message }));
    const quick = await Promise.race([going, new Promise(resolve => setTimeout(() => resolve(null), CHECKS_ANSWER_MS))]);
    pushView();
    if (!quick) return ok({ started: true });
    if (quick.declined) return no('Your PC asked whether to run checks in this project. Say yes there first.');
    return quick.ok ? ok({ status: quick.status }) : no(quick.error || "Couldn't run the checks.");
  }

  // A new conversation from that point, in a copy with the files as they were then.
  const branchFrom = body => once('branch', body, startBranch);
  async function startBranch({ tabId, turnId, at }) {
    if (!str(tabId) || !d.manager.tabs.has(tabId)) return no('That conversation has closed.');
    if (!str(turnId, 100)) return no('There is nothing to branch from there.');
    if (!d.branchRun) return no('Branching isn’t ready yet.');
    // A new conversation (and with Try again, a turn): it counts as a phone task.
    const gate = claimStart();
    if (!gate.ok) return no(gate.reply);
    // Try again sends your message again; Branch from after it waits for yours.
    const r = await d.branchRun({ tabId, turnId, at: at === 'after' ? 'after' : 'before', send: at !== 'after' });
    if (!r?.ok) return no(r?.error || "Couldn't branch it.");
    if (r.tabId) adopt(r.tabId);
    pushView();
    return ok({ tabId: r.tabId || null });
  }

  const actions = { 'cancel-held': cancelHeld, 'held-edit': heldEdit, 'held-move': heldMove, 'checks-run': runChecks, 'branch-from': branchFrom };
  return { actions, queueForLater };
}

module.exports = { createPocketLater, CHECKS_ANSWER_MS };
