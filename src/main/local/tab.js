// A conversation's choice between a local model (agent.js) and Claude, while
// it's still open: up to its first message. After that it's kept for good, so
// a local conversation is never carried on at Anthropic, nor a Claude one
// handed to a small model halfway (sessions.js keeps it in History).
const { cleanTarget } = require('./agent');

const STAYS_LOCAL = 'This conversation runs on your local model for good. Start a new one to use Claude.';
const STAYS_CLAUDE = 'This conversation runs on Claude for good. Start a new one to use a local model.';
const NO_SERVER = 'Set up a local model in Settings first (Claude, then Local model).';

/** Whether it can still move: nothing sent, no process, no Claude Code session. */
function canMove(tab) {
  return !tab.saved && !tab.session.proc && !tab.session.sessionId;
}

/**
 * Put a tab on a local model (target) or Claude (null). On a local model the
 * environment names the model: a Claude one on its line would be refused there.
 * @param {any} tab sessions.js's tab
 * @param {{ url: string, model: string } | null} target
 * @param {{ model: string, fallbackModel: string }} claude Settings' models, for a move to Claude
 */
function apply(tab, target, claude) {
  tab.localTarget = target;
  if (target) {
    tab.session.model = null;
    tab.session.fallbackModel = '';
    tab.ownModel = false;
    return;
  }
  if (!tab.ownModel) tab.session.model = claude.model || null;
  tab.session.fallbackModel = claude.fallbackModel || '';
}

/**
 * The model chip's "On this PC": a local server's model, before the first message.
 * @param {any} tab
 * @param {string | null} url the local server (null: none set up, or a folder on another computer)
 * @param {string} model
 */
function pick(tab, url, model) {
  if (!canMove(tab)) throw new Error(tab.localTarget ? STAYS_LOCAL : STAYS_CLAUDE);
  const target = cleanTarget({ url, model });
  if (!target) throw new Error(NO_SERVER);
  tab.localBy = 'you';
  apply(tab, target, { model: '', fallbackModel: '' });
}

/**
 * A Claude model picked on the chip: a tab that can still move goes to Claude
 * and Settings no longer decides it; a local one that has started refuses.
 */
function pickClaude(tab, claude) {
  if (!canMove(tab)) {
    if (tab.localTarget) throw new Error(STAYS_LOCAL);
    return;
  }
  tab.localBy = 'you';
  if (tab.localTarget) apply(tab, null, claude);
}

/** At its first message: Settings' choice now, unless you picked one on the chip. */
function settle(tab, target, claude) {
  if (!tab.localBy && canMove(tab)) apply(tab, target, claude);
}

module.exports = { canMove, apply, pick, pickClaude, settle, STAYS_LOCAL, STAYS_CLAUDE };
