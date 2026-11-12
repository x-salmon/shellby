// Conversations on a local model: Claude Code itself, every tool and all,
// talking to Ollama (0.14+) or LM Studio (0.4.1+) instead of Anthropic. Both
// serve Anthropic's /v1/messages, so pointing ANTHROPIC_BASE_URL at them is
// enough. Off unless turned on in Settings (localModel.agent), and only for
// conversations started after that: a running process keeps the model it began on.
//
// Every model name Claude Code might ask for (the main one, the opus/sonnet/haiku
// aliases its helpers and background calls use, subagents) maps to the local
// model, so nothing in a local conversation reaches Anthropic by name.
//
// Pure: takes the cleaned settings, returns what to add.
const { baseUrl, modelName } = require('./model');

// Claude Code's own name for a token it sends as-is; local servers ignore it,
// but Claude Code won't start a non-Anthropic endpoint without one.
const LOCAL_TOKEN = 'local';
const ALIAS_VARS = ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL'];

/** -> { on, model } for localModel.agent: off unless turned on, its own model or the drafts' one. */
function cleanAgent(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return { on: src.on === true, model: modelName(src.model) };
}

/**
 * The local model new conversations run on, or null when they run on Claude.
 * @param {any} settings localModel as saved
 * @returns {{ url: string, model: string } | null}
 */
function agentTarget(settings) {
  if (!settings || typeof settings !== 'object') return null;
  const agent = cleanAgent(settings.agent);
  const url = baseUrl(settings.url);
  const model = agent.model || modelName(settings.model);
  return agent.on && url && model ? { url, model } : null;
}

/** -> the environment that sends Claude Code to the local server, or {}. */
function agentEnv(settings) {
  const t = agentTarget(settings);
  if (!t) return {};
  return {
    ANTHROPIC_BASE_URL: t.url,
    ANTHROPIC_AUTH_TOKEN: LOCAL_TOKEN,
    ANTHROPIC_API_KEY: '', // a key set on this PC would otherwise win over the token
    ...Object.fromEntries(ALIAS_VARS.map(k => [k, t.model])),
    // No telemetry, error reports or update checks: "local" stays local.
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
}

module.exports = { cleanAgent, agentTarget, agentEnv, ALIAS_VARS, LOCAL_TOKEN };
