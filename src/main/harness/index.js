// A conversation on another agent's CLI (Gemini CLI, OpenCode, Codex): the
// session sessions.js gets for it, with how to start that CLI found on this PC
// at each start (it may be installed or moved while the tab is open).
//
// fake: a script that stands in for every ACP agent (tests and e2e, never a
// packaged build): fixtures/fake-acp.js, run with node.
const registry = require('./registry');
const { AcpSession } = require('./acp-session');

/**
 * @param {{ fake?: string | null, node?: string, env?: () => Record<string, string> }} [o]
 * @returns {(id: string, opts: { cwd: string, mode?: string, resumeId?: string | null }) => InstanceType<typeof AcpSession>}
 */
function harnessFactory({ fake = null, node = 'node', env = () => ({}) } = {}) {
  return (id, { cwd, mode, resumeId = null }) => {
    const harness = registry.byId(id);
    if (!harness) throw new Error('Shellby doesn\'t know that agent.');
    return new AcpSession({
      harness, cwd, mode, resumeId, env,
      args: fake ? [] : harness.args,
      command: () => (fake ? { file: node, prefix: [fake] } : registry.commandFor(id)),
    });
  };
}

module.exports = { harnessFactory };
