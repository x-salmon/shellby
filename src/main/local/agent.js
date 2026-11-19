// Conversations on a local model: Claude Code itself, every tool and all,
// talking to Ollama (0.14+) or LM Studio (0.4.1+) instead of Anthropic. Both
// serve Anthropic's /v1/messages, so pointing ANTHROPIC_BASE_URL at them is
// enough. Off unless turned on in Settings (localModel.agent), and only for
// conversations started after that: a running process keeps the model it began on.
//
// Every model name Claude Code might ask for maps to a local model, so nothing
// in a local conversation reaches Anthropic by name. The names split into roles:
// main work (the main model, opus, sonnet), helper crabs (subagents) and quick
// tasks (haiku: titles, summaries, small checks). A role left empty runs on the
// main model, so settings saved before roles existed read exactly as before.
//
// Pure: takes the cleaned settings, returns what to add.
const { baseUrl, modelName } = require('./model');

// Claude Code's own name for a token it sends as-is; local servers ignore it,
// but Claude Code won't start a non-Anthropic endpoint without one.
const LOCAL_TOKEN = 'local';
const ROLE_VARS = {
  model: ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL'],
  quick: ['ANTHROPIC_DEFAULT_HAIKU_MODEL'],
  helpers: ['CLAUDE_CODE_SUBAGENT_MODEL'],
};
const ALIAS_VARS = Object.values(ROLE_VARS).flat();
const ROLES = ['helpers', 'quick'];

/** The roles that differ from the main model, cleaned: { helpers?, quick? }. */
function ownRoles(src, main) {
  const out = {};
  for (const r of ROLES) {
    const m = modelName(src[r]);
    if (m && m !== main) out[r] = m;
  }
  return out;
}

/** -> { on, model, helpers, quick } for localModel.agent: off unless turned on; an empty model is the drafts' one, an empty role the main one. */
function cleanAgent(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return { on: src.on === true, model: modelName(src.model), helpers: modelName(src.helpers), quick: modelName(src.quick) };
}

/**
 * The local model new conversations run on, or null when they run on Claude.
 * @param {any} settings localModel as saved
 * @returns {{ url: string, model: string, helpers?: string, quick?: string } | null}
 */
function agentTarget(settings) {
  if (!settings || typeof settings !== 'object') return null;
  const agent = cleanAgent(settings.agent);
  const url = baseUrl(settings.url);
  const model = agent.model || modelName(settings.model);
  return agent.on && url && model ? { url, model, ...ownRoles(agent, model) } : null;
}

/**
 * A conversation's own target as kept in History, checked again (it's read
 * from a file): the same rules as Settings, or null.
 * @param {any} raw
 * @returns {{ url: string, model: string, helpers?: string, quick?: string } | null}
 */
function cleanTarget(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const url = baseUrl(raw.url);
  const model = modelName(raw.model);
  return url && model ? { url, model, ...ownRoles(raw, model) } : null;
}

/** -> the environment the settings would give a new conversation, or {}. */
function agentEnv(settings) {
  return envFor(agentTarget(settings));
}

/**
 * The environment that sends Claude Code to a local server, or {} for Claude.
 * A conversation keeps the target it opened with (sessions.js), so turning the
 * setting off or on never moves one that's already under way.
 * @param {{ url: string, model: string, helpers?: string, quick?: string } | null} t
 */
function envFor(t) {
  if (!t) return {};
  return {
    ANTHROPIC_BASE_URL: t.url,
    ANTHROPIC_AUTH_TOKEN: LOCAL_TOKEN,
    ANTHROPIC_API_KEY: '', // a key set on this PC would otherwise win over the token
    ...Object.fromEntries(Object.entries(ROLE_VARS).flatMap(([role, vars]) => vars.map(k => [k, t[role] || t.model]))),
    // No telemetry, error reports or update checks: "local" stays local.
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
}

module.exports = { cleanAgent, cleanTarget, agentTarget, agentEnv, envFor, ALIAS_VARS, ROLE_VARS, LOCAL_TOKEN };
