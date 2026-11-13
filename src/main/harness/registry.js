// The agents a conversation can run on. Claude Code is Shellby's own and runs
// through session/; the others speak the Agent Client Protocol and run through
// harness/acp-session.js.
//
// Each lists, for every Shellby mode, the agent's own session modes that mean
// it, best first: the session picks the first one the agent offers and leaves
// the agent's default alone when it offers none of them. What a mode allows is
// still the agent's to decide (OpenCode's permission rules, Codex's sandbox):
// Shellby's card shows whatever it asks.
//
// Aider has no protocol to speak (it has no machine-readable mode at all), so
// it isn't one of these.
//
// Pure apart from findCommand's injected fs. test/harness-registry.test.js.
const fs = require('fs');
const { findCommand } = require('./launch');

const CLAUDE = 'claude';

/**
 * @typedef {{ id: string, name: string, short: string, command: string, args: string[],
 *   install: string, signIn: string, site: string, modes: Record<string, string[]> }} Harness
 */

/** @type {Harness[]} */
const HARNESSES = [
  {
    id: 'gemini', name: 'Gemini CLI', short: 'Gemini', command: 'gemini', args: ['--acp'],
    install: 'npm install -g @google/gemini-cli',
    signIn: 'Run gemini once in a terminal and choose Log in with Google, or set GEMINI_API_KEY.',
    site: 'https://github.com/google-gemini/gemini-cli',
    modes: { ask: ['default'], smart: ['default'], acceptEdits: ['auto_edit'], plan: ['plan'], autonomous: ['yolo'] },
  },
  {
    id: 'opencode', name: 'OpenCode', short: 'OpenCode', command: 'opencode', args: ['acp'],
    install: 'npm install -g @opencode/cli',
    signIn: 'Run opencode auth login in a terminal.',
    site: 'https://opencode.ai',
    modes: { ask: ['build'], smart: ['build'], acceptEdits: ['build'], plan: ['plan'], autonomous: ['build'] },
  },
  {
    id: 'codex', name: 'Codex CLI', short: 'Codex', command: 'codex-acp', args: [],
    install: 'npm install -g @openai/codex @agentclientprotocol/codex-acp',
    signIn: 'Run codex login in a terminal.',
    site: 'https://github.com/openai/codex',
    modes: { ask: ['read-only', 'auto'], smart: ['auto'], acceptEdits: ['auto'], plan: ['read-only'], autonomous: ['full-access'] },
  },
];

const byId = id => HARNESSES.find(h => h.id === id) || null;

/** A harness id as saved (History, a request from the panel): one of ours, else Claude. */
function cleanHarness(id) {
  return byId(id) ? id : CLAUDE;
}

/**
 * How to start a harness's CLI on this PC, or null when it isn't installed.
 * @param {string} id
 * @param {{ env?: Record<string, string | undefined>, exists?: (p: string) => boolean, read?: (p: string) => string }} [o]
 */
function commandFor(id, { env = process.env, exists = p => fs.existsSync(p), read = p => fs.readFileSync(p, 'utf8') } = {}) {
  const h = byId(id);
  return h ? findCommand(h.command, { env, exists, read }) : null;
}

/** Every harness, with whether it's installed here: for the panel's picker. Claude's own install is checked elsewhere. */
function listHarnesses(o) {
  return HARNESSES.map(h => ({
    id: h.id, name: h.name, short: h.short, install: h.install, signIn: h.signIn, site: h.site,
    installed: !!commandFor(h.id, o),
  }));
}

module.exports = { CLAUDE, HARNESSES, byId, cleanHarness, commandFor, listHarnesses };
