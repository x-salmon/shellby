// Engineer mode's conversation side (engineer.js has the rules, docs/ENGINEER.md
// the why).
//
// The chip turns it on for one conversation, kept in History. While it's on:
// every message carries a line telling Claude to decide before it builds; the
// crab's `decide` tool puts the decision on a card; the work hook denies file
// changes until you approve one; and `check_decision` puts how it went on the
// same card. Every message to Claude about the decision goes from a button you
// pressed, into a conversation that isn't working (debug mode's way).
// Kept out of main.js, which only wires it up.
const crypto = require('crypto');
const eng = require('../engineer');
const worktrees = require('../worktrees');
const { onClaude } = require('../sessions');

const NEEDS_SELF_AWARE = "Engineer mode needs Claude to know it's in Shellby: turn on Settings, Claude, Tell Claude it's running in Shellby.";
const CLOSED = 'That conversation is closed.';

/**
 * d: what main shares (main.js `shared`): manager, history, config, send,
 * tabWindow, panel, wake, sayText, log. opts.now() for tests.
 */
function wireEngineer(d, opts = {}) {
  const now = opts.now || Date.now;
  // tab -> its latest decision, once read. Keyed by the tab itself: a reopened
  // conversation is a new tab, and reads it from History again.
  const decisions = new WeakMap();

  const winOf = tabId => d.tabWindow?.(tabId) || d.panel;

  // Its latest decision: what this run of Shellby knows, else what History kept.
  function decisionOf(tab) {
    if (!decisions.has(tab)) decisions.set(tab, tab.saved ? eng.latestFrom(d.history.load?.(tab.id)) : null);
    return decisions.get(tab);
  }
  const stateOf = tab => ({ on: !!tab.engineer, decision: decisionOf(tab) });

  // On, and Claude has the crab's tools to answer it with.
  const active = tab => !!tab.engineer && !!d.config.get('selfAware') && !!tab.session.mcp;

  // decide and check_decision ride along only in a conversation with it on:
  // every tool listed costs every turn. Fixed for the life of a process, so a
  // change shows from its next start. -> whether the list changed
  function syncTools(tab) {
    const mcp = tab.session.mcp;
    if (!mcp) return false;
    const base = mcp.tools.filter(t => !eng.TOOL_NAMES.includes(t.name));
    const tools = active(tab) ? [...base, ...eng.TOOLS] : base;
    if (tools.length === mcp.tools.length) return false;
    tab.session.mcp = { ...mcp, tools };
    return true;
  }

  // Before each message (wiring/sessions.js decorate): its tools, and the work
  // hook's say on each change (session/control.js answerHook) while it's on.
  function arm(tab) {
    syncTools(tab);
    tab.session.gate = active(tab)
      ? input => eng.gate(stateOf(tab), input?.tool_name, input?.tool_input, worktrees.startsWork)
      : null;
  }

  function publish(tab, decision) {
    decisions.set(tab, decision);
    const item = { ...eng.view(decision), t: now() };
    try { d.manager.note(tab.id, item); } catch (err) { d.log?.info(`engineer: ${err.message}`); }
    return item;
  }

  // ------------------------------------------------------------ the chip

  /**
   * On or off for one conversation. Its process is let go of when its tools
   * change, so the next message starts it with them, resumed (safe mode's way).
   * -> { ok } | { ok: false, error }
   */
  async function set(tabId, on) {
    const tab = d.manager.tabs.get(tabId);
    if (!tab) return { ok: false, error: CLOSED };
    if (!onClaude(tab)) return { ok: false, error: 'Engineer mode works in Claude Code conversations.' };
    if (on && !d.config.get('selfAware')) return { ok: false, error: NEEDS_SELF_AWARE };
    if (on && !tab.session.mcp) return { ok: false, error: "This conversation started without the crab's tools. Start a new one to use Engineer mode." };
    if (tab.session.busy) return { ok: false, error: 'Let Claude finish this turn (or stop it) first.' };
    if (tab.engineer === !!on) return { ok: true };
    tab.engineer = !!on;
    if (tab.saved) d.history.update(tab.id, { engineer: !!on });
    // Off ends an approval: turned back on, the next change needs a new decision.
    if (!on && decisionOf(tab)?.phase === 'approved') publish(tab, { ...decisionOf(tab), phase: 'closed' });
    const changed = syncTools(tab);
    arm(tab);
    if (changed && tab.session.proc) await tab.session.stop();
    d.manager.changed();
    d.stat?.(on ? 'engineer-on' : 'engineer-off');
    return { ok: true };
  }

  /** Each message's line for Claude (wiring/sessions.js decorate). */
  function decorate(tab, prompt) {
    if (!tab.engineer) return prompt;
    return eng.withNote(prompt, eng.turnNote(stateOf(tab)));
  }

  // ------------------------------------------------------------ the crab's tools

  const isTool = name => eng.TOOL_NAMES.includes(name);

  /** decide or check_decision, from Claude. -> { text, isError? } */
  function tool(tab, name, args) {
    if (!tab.engineer) return { text: 'Engineer mode is off in this conversation, so nothing was shown. Carry on as usual.' };
    if (name === eng.DECIDE) {
      const r = eng.readDecision(args);
      if (r.error) return { text: r.error, isError: true };
      publish(tab, { id: crypto.randomUUID(), phase: 'proposed', ...r.decision });
      d.wake?.();
      return { text: 'Shown to the user as a decision card. End your turn now: their answer comes as their next message, and file changes stay blocked until they approve.' };
    }
    const decision = decisionOf(tab);
    if (decision?.phase !== 'approved') return { text: 'There is no approved decision to check the work against.', isError: true };
    const r = eng.readOutcome(args);
    if (r.error) return { text: r.error, isError: true };
    publish(tab, { ...decision, phase: 'checked', outcome: r.outcome });
    return { text: 'Put on the decision card. Further file changes need a new decision.' };
  }

  // ------------------------------------------------------------ the card's buttons

  /**
   * what: 'approve' | 'pick' (option: its index) | 'return' (note: what should
   * change), or 'close' an approved one before it's checked (nothing is sent:
   * the next message's line tells Claude a new decision is needed).
   * -> { ok } | { ok: false, error }
   * @param {string} tabId
   * @param {string} id
   * @param {{ what?: string, option?: number, note?: string }} [answer]
   */
  function act(tabId, id, { what, option, note } = {}) {
    const tab = d.manager.tabs.get(tabId);
    if (!tab) return { ok: false, error: CLOSED };
    const decision = decisionOf(tab);
    if (what === 'close') {
      if (!decision || decision.id !== id || decision.phase !== 'approved') return { ok: false, error: 'That decision is no longer open.' };
      publish(tab, { ...decision, phase: 'closed' });
      return { ok: true };
    }
    if (!decision || decision.id !== id || decision.phase !== 'proposed') return { ok: false, error: 'That decision has already been answered.' };
    if (typeof what !== 'string' || !['approve', 'pick', 'return'].includes(what)) return { ok: false, error: 'Unknown answer.' };
    if (tab.session.busy) return { ok: false, error: 'Claude is still finishing its turn. Press it again in a moment.' };
    const a = eng.answerPrompt(decision, { what: String(what), option: Number.isInteger(option) ? option : -1, note: typeof note === 'string' ? note : '', keepRecords: d.config.get('engineerRecords') !== false });
    if (a.error) return { ok: false, error: a.error };
    const said = typeof note === 'string' ? note.trim().slice(0, eng.MAX_NOTE) : '';
    const next = what === 'return'
      ? { ...decision, phase: 'returned', ...(said ? { note: said } : {}) }
      : { ...decision, phase: 'approved', picked: a.picked, ...(said ? { note: said } : {}) };
    // Answered before the message goes: its line for Claude, and the gate, read the new phase.
    decisions.set(tab, next);
    let turnId;
    try {
      turnId = d.manager.send(tabId, a.prompt, { kind: 'user', text: a.shown });
    } catch (err) {
      decisions.set(tab, decision);
      return { ok: false, error: err.message };
    }
    d.send(winOf(tabId), 'tab:sent', { tabId, item: { kind: 'user', text: a.shown, attachments: [], turnId } });
    publish(tab, next);
    d.wake?.();
    return { ok: true };
  }

  return { set, arm, decorate, isTool, tool, act, stateOf };
}

module.exports = { wireEngineer, NEEDS_SELF_AWARE };
