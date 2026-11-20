// A tab's own name, mode, effort, model and safe mode (mixed into SessionManager, sessions.js).
const { EFFORTS } = require('../session');
const { cleanTitle } = require('../history');
const { isModel } = require('../models');
const localTab = require('../local/tab');
const { onClaude, NOT_CLAUDE } = require('./shared');

class Settings {
  // A name of your own for an open tab. One not yet sent anything has no History
  // entry to hold it, so `named` stops the first message from replacing it.
  rename(tabId, title) {
    const tab = this.tabs.get(tabId);
    const t = cleanTitle(title);
    if (!tab || !t) return false;
    tab.title = t;
    if (tab.saved) this.history.rename(tab.id, t); else tab.named = true;
    this.changed();
    return true;
  }

  /**
   * Safe mode on or off for one conversation (session/index.js safeMode): its process
   * is let go of now, so the next message starts it the new way, resumed.
   * -> { ok } | { ok: false, error }
   */
  async setSafeMode(tabId, on) {
    const tab = this.tabs.get(tabId);
    if (!tab) return { ok: false, error: 'That conversation is closed.' };
    if (tab.session.busy) return { ok: false, error: 'Let Claude finish this turn (or stop it) first.' };
    if (!this.supports('--safe-mode') || tab.session.remote?.()) return { ok: false, error: "This Claude Code can't start in safe mode. Update it, then try again." };
    if (tab.session.safeMode === !!on) return { ok: true };
    tab.session.safeMode = !!on;
    if (tab.saved) this.history.update(tab.id, { safeMode: !!on });
    await tab.session.stop();
    this.onItem(tab, { kind: 'safe', on: !!on });
    this.changed();
    return { ok: true };
  }

  /** Mark a tab as carried on in a terminal (at: a time), or picked back up (null). */
  setInTerminal(tabId, at) {
    const tab = this.tabs.get(tabId);
    if (!tab) return false;
    tab.inTerminal = Number.isFinite(at) ? at : null;
    if (tab.saved) this.history.update(tab.id, { inTerminal: tab.inTerminal });
    this.changed();
    return true;
  }

  setMode(mode) {
    for (const tab of this.tabs.values()) if (!tab.pinnedMode) tab.session.setMode(mode);
  }

  // A note's Ask or Plan (ipc/notes.js) keeps the mode it opened in only to
  // start: Ask's until its first answer is in, Plan's until you approve the
  // plan. From then on it's an ordinary conversation, in your mode.
  modeToStart(tabId) {
    const tab = this.tabs.get(tabId);
    if (tab?.pinnedMode) tab.startsIn = tab.session.mode;
  }

  // Its opening's done: it follows your mode from now on. -> that mode
  followMode(tab) {
    tab.startsIn = null;
    tab.pinnedMode = false;
    return this.getMode();
  }

  // The default changed: the conversations following it follow it now. One
  // with its own (chosen or picked) keeps that.
  setEffort(effort) {
    for (const tab of this.tabs.values()) if (!tab.effortBy) tab.session.setEffort(effort);
  }

  /** This conversation's own effort ('' is Auto), from the chip. From its next turn, or this one's next step. */
  setTabEffort(tabId, effort) {
    const tab = this.require(tabId);
    if (!onClaude(tab)) throw new Error(NOT_CLAUDE);
    if (effort !== '' && !EFFORTS.includes(effort)) throw new Error('bad effort');
    tab.effortBy = 'you';
    tab.session.setEffort(effort);
    this.keepEffort(tab);
    this.changed();
  }

  /**
   * This conversation's own model, as the terminal's /model switches it ('' is
   * Claude Code's default): from its next turn, kept in History. One that has
   * started reads the whole conversation again on the next turn, at full price,
   * since each model has its own cache: -> started, so the panel can say so.
   * Set at once (a first message sent right after starts on it); only a
   * running CLI's answer is waited for, and its no puts the old one back.
   * byYou: you picked it (chip, /model); Shellby's own picks leave a local one local.
   */
  setTabModel(tabId, model, { byYou = false } = {}) {
    const tab = this.require(tabId);
    if (!onClaude(tab)) throw new Error(NOT_CLAUDE);
    if (typeof model !== 'string' || !isModel(model)) throw new Error("Shellby doesn't know that model.");
    if (!byYou && tab.localTarget) return Promise.resolve({ ok: true, started: false });
    // Before its first message, yours goes to Claude whatever Settings says. It can only
    // move with no process, where setModel never says no, so the revert below never undoes it.
    localTab.pickClaude(tab, this.claudeModels());
    const started = !!(tab.session.proc || tab.session.sessionId);
    const before = { model: tab.session.model, own: tab.ownModel };
    const asked = tab.session.setModel(model);
    tab.ownModel = true;
    if (tab.saved) this.history.update(tab.id, { model });
    this.changed();
    return asked.then(r => {
      if (r.ok) return { ok: true, started };
      tab.session.model = before.model;
      tab.session.modelSwitched = false;
      tab.ownModel = before.own;
      if (tab.saved) this.history.update(tab.id, { model: before.own ? before.model || '' : undefined });
      this.changed();
      return { ok: false, error: `Claude Code didn't switch: ${r.error}` };
    });
  }

  claudeModels() { return { model: this.getModel(), fallbackModel: this.getFallbackModel() }; }

  // The model chip's On this PC: a local model, before its first message (local/tab.js).
  setTabLocal(tabId, model) {
    const tab = this.require(tabId);
    localTab.pick(tab, this.getLocalServer(tab.session.cwd), model);
    this.changed();
    return { ok: true, started: false };
  }

  keepEffort(tab) {
    if (tab.saved) this.history.update(tab.id, { effort: tab.session.effort, effortBy: tab.effortBy });
  }
}

module.exports = Settings;
