// What a session says, as the tab keeps it: items, the review inbox, notes and the talking pose (mixed into SessionManager, sessions.js).
const review = require('../review-inbox');
const turncost = require('../turncost');
const turnwatch = require('../turnwatch');
const mods = require('../mods');
const { TALK_QUIET_MS } = require('./shared');

class Items {
  onItem(tab, raw) {
    // The reply as it's written, what you might ask next, and compacting under
    // way are only for the panel now: the reply itself is kept when it's done,
    // a guess goes stale, the compacted mark follows the compacting, a retry
    // is over once the request goes through, a hook's line goes with the hook,
    // and the mode is kept on the session itself.
    if (raw.kind === 'partial' || raw.kind === 'next' || raw.kind === 'compacting' || raw.kind === 'retrying' || raw.kind === 'hook' || raw.kind === 'mode') {
      tab.activeAt = Date.now();
      if (raw.kind === 'partial') this.talked(tab);
      if (raw.kind === 'compacting' && tab.compacting !== !!raw.on) { tab.compacting = !!raw.on; this.changed(); }
      this.emit('item', tab.id, raw, tab);
      return;
    }
    // A long tool result's tail is only for main to read (flaky/index.js): it's
    // neither saved with the tab nor sent to the panel.
    let { tail, images, ...item } = raw;
    // A tool's pictures are saved apart (tool-pictures.js): the item names them.
    if (images?.length && this.savePictures) {
      let ids = [];
      try { ids = this.savePictures(tab.id, item.id, images) || []; } catch { /* no pictures, the step still shows */ }
      if (ids.length) item.pictures = ids;
    }
    // Pictures the conversation holds, for the note when they pile up (turncost.js
    // pictureNote): a helper's stay in its own context. A new start has none.
    // Counted from when this run of Shellby opened the tab: a reopened conversation's
    // older pictures aren't, so the note can come late but never wrongly.
    if (images?.length && !item.sub) tab.pictures = (tab.pictures || 0) + images.length;
    if (item.kind === 'compacted' || item.kind === 'fresh' || item.kind === 'cleared') {
      tab.pictures = 0;
      tab.picturesNoted = false;
      tab.watchSaid = { ...tab.watchSaid, compact: false };
      tab.turnWatch = turnwatch.startTurn(); // the earlier reads went with what was dropped
    }
    // What the turn did that its notes speak of (turnwatch.js).
    tab.turnWatch = turnwatch.seeItem(tab.turnWatch, item);
    // A mod's lines and toasts, within its budget: one that says something on
    // every step would bury the conversation and its history (mods.js).
    if (item.kind === 'modlog' || item.kind === 'modtoast') {
      tab.modLines ??= new Map();
      const say = mods.modLineAllowed(tab.modLines, item.plugin);
      if (say === 'drop') return;
      if (say === 'last') item = { kind: 'modlog', plugin: item.plugin, text: 'is saying a lot, so Shellby hides the rest of what it says this minute.' };
    }
    tab.activeAt = Date.now();
    // A rewind's fork exists once Claude Code reports its id: from then on it's an ordinary resume.
    if (item.kind === 'init' && tab.saved) this.history.update(tab.id, { claudeSessionId: item.sessionId, resumeAt: null });
    if (item.kind === 'init' && item.model) this.changed(); // the model chip shows it before the first reply
    if (item.kind === 'init' && tab.preambleSent) {
      tab.preamble = null;
      tab.preambleSent = false;
      if (tab.saved) this.history.update(tab.id, { preamble: null });
    }
    // What the turn cost, in words the panel shows as they are.
    if (item.kind === 'result' && item.cost) {
      let share = null;
      try { share = this.windowShare?.(item.cost.weight, tab) ?? null; } catch { /* no reading to go on: tokens and context still show */ }
      // Each helper's share the same way: its part of what Shellby spent in this window.
      const helpers = item.cost.helpers?.map(x => {
        let s = null;
        try { s = this.windowShare?.(x.weight, tab) ?? null; } catch { /* as above */ }
        return { ...x, share: Number.isFinite(s) ? s : null, shareText: turncost.shareText(s) };
      });
      const cost = { ...item.cost, share: Number.isFinite(share) ? share : null, ...(helpers ? { helpers } : {}) };
      // A warm cache it missed, and helpers that outspent it or pictures piling up
      // (each once a conversation): notes under the cost.
      const notes = turncost.turnNotes(cost, { helpers: !tab.helpersNoted, pictures: tab.picturesNoted ? 0 : tab.pictures || 0 });
      if (notes.some(n => n.kind === 'helpers')) tab.helpersNoted = true;
      if (notes.some(n => n.kind === 'pictures')) tab.picturesNoted = true;
      // A big whole-file read, a long helper brief, a commit worth compacting after, a small job thought hard on.
      const watched = turnwatch.watchNotes(tab.turnWatch, { cost, category: tab.turnCategory, said: tab.watchSaid, style: tab.session?.outputStyle || '', compact: turncost.compact });
      tab.watchSaid = turnwatch.markSaid(tab.watchSaid, watched);
      notes.push(...watched);
      item.cost = { ...cost, line: turncost.costLine(cost), detail: turncost.costDetail(cost), effortBadge: turncost.effortBadge(cost), ...(notes.length ? { notes } : {}) };
    }
    if (item.kind === 'compacted' && tab.compacting) { tab.compacting = false; this.changed(); }
    // Shellby's own /compact while the tab sat idle (wiring/idle-compact.js): its mark says so.
    if (item.kind === 'compacted' && tab.idleCompacting) item = { ...item, trigger: 'idle' };
    if (item.kind === 'result') {
      this.restoreTurnModel(tab);
      // A note's Ask has its answer: whatever you say next is in your mode.
      if (item.ok && tab.startsIn && tab.startsIn !== 'plan') tab.session.setMode(this.followMode(tab));
      tab.outcome = item.interrupted ? 'stopped' : item.ok ? 'ok' : 'error';
      if (!(tab.idleCompacting && item.ok && !item.interrupted)) tab.unread = true;
      if (tab.saved) {
        this.history.update(tab.id, { lastOutcome: tab.outcome, context: tab.session.context });
        this.history.markTurn?.(tab.id, null);
      }
    }
    if (tab.saved) this.history.append(tab.id, item);
    const ready = review.next(tab.ready, item);
    if (ready !== tab.ready) this.setReady(tab, ready);
    this.emit('item', tab.id, item, tab, tail);
    if (['permission', 'decision', 'result', 'error'].includes(item.kind)) this.changed();
  }

  // Kept in History without bumping updatedAt (history.setReady): looking at work isn't work on it.
  setReady(tab, ready) {
    tab.ready = ready;
    if (tab.saved) this.history.setReady(tab.id, ready);
    this.changed();
  }

  /** Mark a tab's latest changes reviewed (or put them back in the inbox). -> whether anything changed. */
  setReviewed(tabId, reviewed = true, after = null) {
    const tab = this.tabs.get(tabId);
    if (!tab?.ready) return false;
    if (after && tab.ready.after !== after) return false; // a newer turn's changes: not the ones you saw
    const ready = review.setReviewed(tab.ready, reviewed);
    if (ready === tab.ready) return false;
    this.setReady(tab, ready);
    return true;
  }

  // Something main.js worked out about a tab (what its last turn changed):
  // kept in the transcript and shown just like the CLI's own items.
  note(tabId, item) {
    const tab = this.tabs.get(tabId);
    if (tab) this.onItem(tab, item);
  }

  // Words of the reply arrived: he talks along, until they stop for a moment.
  talked(tab) {
    clearTimeout(tab.talkTimer);
    tab.talkTimer = setTimeout(() => { tab.talkTimer = null; tab.talking = false; this.changed(); }, TALK_QUIET_MS);
    tab.talkTimer.unref?.();
    if (!tab.talking) { tab.talking = true; this.changed(); }
  }

  hush(tab) {
    clearTimeout(tab.talkTimer);
    tab.talkTimer = null;
    tab.talking = false;
    tab.compacting = false;
  }
}

module.exports = Items;
