// The models the Settings picker offers, passed straight to `claude --model`.
// The bare aliases follow whatever Claude Code currently maps them to; the
// full ids pin a specific release. Retired and deprecated models are left out,
// and so is Mythos (Project Glasswing only). main.js only accepts ids listed
// here, so add new releases to this list.

const MODELS = [
  { group: 'Latest', id: 'opus', label: 'Opus (latest)' },
  { group: 'Latest', id: 'sonnet', label: 'Sonnet (latest)' },
  { group: 'Latest', id: 'haiku', label: 'Haiku (latest)' },
  { group: 'Fable', id: 'claude-fable-5-1', label: 'Fable 5.1' },
  { group: 'Fable', id: 'claude-fable-5', label: 'Fable 5' },
  { group: 'Opus', id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { group: 'Opus', id: 'claude-opus-5', label: 'Opus 5' },
  { group: 'Opus', id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { group: 'Opus', id: 'claude-opus-4-7', label: 'Opus 4.7' },
  { group: 'Opus', id: 'claude-opus-4-6', label: 'Opus 4.6' },
  { group: 'Opus', id: 'claude-opus-4-5', label: 'Opus 4.5' },
  { group: 'Sonnet', id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { group: 'Sonnet', id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { group: 'Sonnet', id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { group: 'Sonnet', id: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
  { group: 'Haiku', id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];

// '' means "let Claude Code pick", which is always allowed.
const isModel = id => id === '' || MODELS.some(m => m.id === id);

const HELPER_ENV = 'CLAUDE_CODE_SUBAGENT_MODEL';

/**
 * The variable that runs helpers (subagents) on another model, for the
 * conversations Shellby starts: {} for none, or when it's already set on this
 * PC, which is yours to keep. Claude Code applies it only to helpers that don't
 * name a model of their own (CLAUDE_CODE_SUBAGENT_MODEL_FORCE is for all of them).
 */
function helperEnv(model, env = process.env) {
  if (!model || !isModel(model) || env[HELPER_ENV]) return {};
  return { [HELPER_ENV]: model };
}

module.exports = { MODELS, isModel, helperEnv, HELPER_ENV };
