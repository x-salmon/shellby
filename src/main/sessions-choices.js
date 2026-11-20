// What a conversation runs on (sessions.js), mixed into SessionManager's
// prototype: its mode (and the mode a note opened it in), its own model, local
// or Claude, its effort (chosen or picked from its first message) and safe mode.

const { EFFORTS } = require('./session');
const { pickEffort } = require('./effort-pick');
const { isModel } = require('./models');
const localTab = require('./local/tab');
const harnesses = require('./harness/registry');

// Runs on Claude Code, not another agent's CLI (harness/): its models, effort, pings and /compact are Claude Code's.
const onClaude = tab => !tab.harness || tab.harness === harnesses.CLAUDE;
const NOT_CLAUDE = 'That only works in a Claude Code conversation.';

const choices = {
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
  },

  setMode(mode) {
    for (const tab of this.tabs.values()) if (!tab.pinnedMode) tab.session.setMode(mode);
  },

  // A note's Ask or Plan (ipc/notes.js) keeps the mode it opened in only to
  // start: Ask's until its first answer is in, Plan's until you approve the
  // plan. From then on it's an ordinary conversation, in your mode.
  modeToStart(tabId) {
    const tab = this.tabs.get(tabId);
    if (tab?.pinnedMode) tab.startsIn = tab.session.mode;
  },

  // Its opening's done: it follows your mode from now on. -> that mode
  followMode(tab) {
    tab.startsIn = null;
    tab.pinnedMode = false;
    return this.getMode();
  },

  // The default changed: the conversations following it follow it now. One
  // with its own (chosen or picked) keeps that.
  setEffort(effort) {
    for (const tab of this.tabs.values()) if (!tab.effortBy) tab.session.setEffort(effort);
  },

  /** This conversation's own effort ('' is Auto), from the chip. From its next turn, or this one's next step. */
  setTabEffort(tabId, effort) {
    const tab = this.require(tabId);
    if (!onClaude(tab)) throw new Error(NOT_CLAUDE);
    if (effort !== '' && !EFFORTS.includes(effort)) throw new Error('bad effort');
    tab.effortBy = 'you';
    tab.session.setEffort(effort);
    this.keepEffort(tab);
    this.changed();
  },

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
  },

  claudeModels() { return { model: this.getModel(), fallbackModel: this.getFallbackModel() }; },

  // The model chip's On this PC: a local model, before its first message (local/tab.js).
  setTabLocal(tabId, model) {
    const tab = this.require(tabId);
    localTab.pick(tab, this.getLocalServer(tab.session.cwd), model);
    this.changed();
    return { ok: true, started: false };
  },

  // Sized from what it was asked, once: only while it follows a default of
  // Auto with picking on. A /command waits for the next real message.
  maybePickEffort(tab, userItem) {
    if (tab.effortBy || this.getEffort() || !this.getEffortPick() || !onClaude(tab)) return;
    const level = pickEffort(userItem.text, Array.isArray(userItem.attachments) ? userItem.attachments.length : 0);
    if (!level) return;
    tab.effortBy = 'picked';
    tab.session.setEffort(level);
    this.keepEffort(tab);
  },

  keepEffort(tab) {
    if (tab.saved) this.history.update(tab.id, { effort: tab.session.effort, effortBy: tab.effortBy });
  },
};

module.exports = { choices, onClaude, NOT_CLAUDE };
