// The models the Settings picker offers, passed straight to `claude --model`.
// The bare aliases follow whatever Claude Code currently maps them to; the
// full ids pin a specific release. BUILT_IN is what Shellby ships with; the
// installed Claude Code adds the releases that came after it
// (claude/models-scan.js → setFound), so a new model needs no Shellby release.
// Retired and deprecated models are left out, and so is Mythos (Project
// Glasswing only). main.js only accepts ids listed by models().

const BUILT_IN = Object.freeze([
  { group: 'Latest', id: 'opus', label: 'Opus (latest)' },
  { group: 'Latest', id: 'sonnet', label: 'Sonnet (latest)' },
  { group: 'Latest', id: 'haiku', label: 'Haiku (latest)' },
  { group: 'Fable', id: 'claude-fable-5-2', label: 'Fable 5.2' },
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
  { group: 'Haiku', id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
  { group: 'Haiku', id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
].map(m => Object.freeze(m)));

// Families never offered, whatever Claude Code knows about.
const HIDDEN_FAMILIES = new Set(['mythos']);
// claude-<family>-<major>[-<minor>], nothing after: dated snapshots
// (claude-sonnet-4-5-20250929) duplicate the plain id and are left out.
const RELEASE = /^claude-([a-z]+)-(\d{1,2})(?:-(\d{1,2}))?$/;

const capital = s => s[0].toUpperCase() + s.slice(1);
const versionOf = ([, , major, minor]) => Number(major) * 100 + Number(minor || 0);

/**
 * Picker entries for the ids Claude Code knows that Shellby doesn't yet: only
 * releases newer than the newest built-in one of their family (older ones were
 * left out on purpose, as retired), and whole new families from the newest
 * generation on. Newest first.
 * @param {unknown} ids
 * @returns {{ group: string, id: string, label: string }[]}
 */
function fromIds(ids) {
  if (!Array.isArray(ids)) return [];
  const newest = new Map();
  let generation = 0;
  for (const m of BUILT_IN) {
    const r = RELEASE.exec(m.id);
    if (!r) continue;
    newest.set(r[1], Math.max(newest.get(r[1]) || 0, versionOf(r)));
    generation = Math.max(generation, Number(r[2]));
  }
  const known = new Set(BUILT_IN.map(m => m.id));
  const found = [];
  for (const id of new Set(ids)) {
    const r = typeof id === 'string' ? RELEASE.exec(id) : null;
    if (!r || known.has(id) || HIDDEN_FAMILIES.has(r[1])) continue;
    const floor = newest.has(r[1]) ? newest.get(r[1]) : generation * 100 - 1;
    if (versionOf(r) <= floor) continue;
    found.push({ group: capital(r[1]), id, label: `${capital(r[1])} ${r[2]}${r[3] ? `.${r[3]}` : ''}`, version: versionOf(r) });
  }
  return found.sort((a, b) => b.version - a.version).map(({ group, id, label }) => ({ group, id, label }));
}

let list = BUILT_IN;

/**
 * Take in what the installed Claude Code knows (ids from models-scan.js).
 * @returns {boolean} whether the list changed
 */
function setFound(ids) {
  const extra = fromIds(ids);
  const next = merge(extra);
  const changed = next.length !== list.length || next.some((m, i) => m.id !== list[i].id);
  list = next;
  return changed;
}

/** BUILT_IN with `extra` placed at the top of their family (a new family goes after Latest). */
function merge(extra) {
  if (!extra.length) return BUILT_IN;
  const out = [...BUILT_IN];
  for (const m of [...extra].reverse()) {
    const at = out.findIndex(x => x.group === m.group);
    out.splice(at === -1 ? out.findIndex(x => x.group !== 'Latest') : at, 0, Object.freeze(m));
  }
  return Object.freeze(out);
}

/** The models offered now. */
const models = () => list;

// '' means "let Claude Code pick", which is always allowed.
const isModel = id => id === '' || list.some(m => m.id === id);

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

module.exports = { BUILT_IN, models, isModel, setFound, fromIds, helperEnv, HELPER_ENV };
