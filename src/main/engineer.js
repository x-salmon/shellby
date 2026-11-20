// Engineer mode (docs/ENGINEER.md): decide before you build.
//
// With the Engineer chip on, Claude looks around, then puts its decision on a
// card through the crab's `decide` tool: the goal, what constrains it, the
// options it weighed with their trade-offs, which one it picks and why, the
// files it will change (its scope), how it'll be tested, and the risks.
// Nothing that changes a file runs until you approve one, and once you have,
// only files inside the scope (engineer-gate.js). `amend_decision` asks to
// widen it; `spike` asks to try something first, thrown away after.
// `check_decision` says how it went, and Shellby checks that for itself:
// what the diff really touched, and the test plan's commands, run by Shellby.
//
// This file is pure: the tools, their checks, and the card's view. The gate
// is engineer-gate.js, what Claude is told engineer-prompts.js, and the
// conversation's side wiring/engineer.js.
const checks = require('./checks');

const DECIDE = 'decide';
const CHECK = 'check_decision';
const AMEND = 'amend_decision';
const SPIKE = 'spike';
const END_SPIKE = 'end_spike';
const TOOL_NAMES = Object.freeze([DECIDE, CHECK, AMEND, SPIKE, END_SPIKE]);

const MAX_TITLE = 80;
const MAX_TEXT = 1200;
const MAX_ITEM = 300;
const MAX_ITEMS = 8;
const MAX_OPTIONS = 4;
const MAX_NOTE = 2000;
const MAX_SCOPE = 24;
const MAX_PATH = 200;
const MAX_TOUCHED = 300;
const RESULTS = Object.freeze(['passed', 'failed', 'skipped']);
const LEVELS = Object.freeze(['low', 'medium', 'high']);
const REVERSIBILITY = Object.freeze(['easy', 'moderate', 'hard']);
// Where an approved decision is written down in the repo (when Settings keeps them).
const RECORD_DIR = 'docs/decisions';

// proposed: on the card, waiting for you. approved: the work is under way.
// returned: you sent it back. checked: the work's done and compared with it.
// closed: you closed it (or turned the chip off) before it was checked.
const PHASES = Object.freeze(['proposed', 'approved', 'returned', 'checked', 'closed']);
// A spike: asked (on its card), running, ending (end_spike called, put back
// when the turn ends), done, refused (you said no) or failed (couldn't put back).
const SPIKE_PHASES = Object.freeze(['asked', 'running', 'ending', 'done', 'refused', 'failed']);
const AMEND_PHASES = Object.freeze(['proposed', 'approved', 'refused']);

const STR = { type: 'string' };
const LIST = { type: 'array', items: STR };
const obj = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });

const TOOLS = Object.freeze([
  {
    name: DECIDE,
    description: 'Only while Shellby\'s Engineer mode is on: put your decision before the user, as a card, before changing any file. '
      + 'Explore first, including earlier decision records in docs/decisions. Give the real options you weighed (two or more where there are; one only when nothing else is sane, and say why) with honest trade-offs, '
      + 'pick one, name the files or folders you will change (scope), and say how you will know it works. Then end your turn: their answer arrives as their next message, '
      + 'and file changes are blocked until they approve, then held to the scope.',
    inputSchema: obj({
      title: { type: 'string', description: 'The decision in a few words, e.g. "Cache prices in memory"' },
      goal: { type: 'string', description: 'What done means, in a sentence or two' },
      constraints: { ...LIST, description: 'What you found that limits the options' },
      options: {
        type: 'array',
        items: obj({ name: STR, summary: STR, pros: LIST, cons: LIST }, ['name', 'summary']),
      },
      choice: { type: 'string', description: 'The name of the option you pick' },
      why: { type: 'string', description: 'Why that one over the others' },
      scope: { ...LIST, description: 'The files or folders you will change, relative to the repo root: "src/cache.js", "src/cache/", "test/*.test.js". Edits outside it are blocked until the user approves an amendment.' },
      test_plan: {
        type: 'array',
        description: 'How you will check it works. Give a check the project\'s own command where there is one ("npm run test", "npm run typecheck", "cargo test", "go test ./...", "python -m pytest -q"): Shellby runs those itself afterwards.',
        items: { anyOf: [STR, obj({ check: STR, command: STR }, ['check'])] },
      },
      risks: { ...LIST, description: 'What could go wrong, and what would change your mind' },
      steps: { ...LIST, description: 'For work too big for one go: the steps in order. Report each with check_decision({ step }).' },
      related: { ...LIST, description: 'Earlier decision records this builds on, e.g. "docs/decisions/0003-cache-layer.md"' },
      supersedes: { type: 'string', description: 'An earlier decision record this one replaces, if any' },
      confidence: { type: 'string', enum: [...LEVELS], description: 'How sure you are this is the right choice' },
      reversibility: { type: 'string', enum: [...REVERSIBILITY], description: 'How hard it would be to undo once built' },
      critique: { ...LIST, description: 'When the user asked for a critic: the strongest points it made against your pick' },
    }, ['title', 'goal', 'options', 'choice', 'why', 'scope', 'test_plan']),
  },
  {
    name: CHECK,
    description: 'Only while Shellby\'s Engineer mode is on: once the approved work (or one step of it) is done, say how it went against the decision. '
      + 'Run the test plan first and report each check truthfully; Shellby runs the plan\'s commands itself too and shows both. '
      + 'Give step for one step of a decision with steps; the last step, or no step, closes it, and further file changes need a new decision.',
    inputSchema: obj({
      step: { type: 'integer', description: 'Which step this reports, counting from 1, for a decision with steps' },
      followed: { type: 'boolean', description: 'Whether the work did what was decided' },
      summary: { type: 'string', description: 'What was done, in a sentence or two' },
      deviations: { type: 'array', items: obj({ what: STR, why: STR }, ['what', 'why']), description: 'Where the work left the decision, and why' },
      tests: { type: 'array', items: obj({ check: STR, result: { type: 'string', enum: RESULTS } }, ['check', 'result']) },
      record: { type: 'string', description: 'The decision record file you wrote, if you wrote one' },
    }, ['followed', 'summary']),
  },
  {
    name: AMEND,
    description: 'Only while Shellby\'s Engineer mode is on and a decision is approved: ask to change files outside its scope. '
      + 'Say which and why; it shows on the decision card. Then end your turn: edits outside the scope stay blocked until the user approves.',
    inputSchema: obj({
      add_scope: { ...LIST, description: 'The files or folders to add, relative to the repo root' },
      why: { type: 'string', description: 'Why the work needs them' },
    }, ['add_scope', 'why']),
  },
  {
    name: SPIKE,
    description: 'Only while Shellby\'s Engineer mode is on, before a decision: ask to try something out when the right choice depends on what only trying will show '
      + '(does the library do X, how slow is Y). Every change you make in the spike is put back afterwards. Then end your turn and wait for the user to allow it.',
    inputSchema: obj({
      question: { type: 'string', description: 'What the spike will find out' },
      plan: { type: 'string', description: 'What you will try, briefly' },
    }, ['question', 'plan']),
  },
  {
    name: END_SPIKE,
    description: 'Only during an Engineer mode spike: say what you found. Shellby puts every file the spike changed back when this turn ends. '
      + 'Then call decide, using what you found.',
    inputSchema: obj({
      findings: { type: 'string', description: 'What the spike showed' },
      answer: { type: 'string', description: 'The answer to the spike\'s question, in a sentence' },
    }, ['findings']),
  },
]);

// Characters that change how text around them shows without showing
// themselves (direction overrides, zero-width ones): a title or path could
// read as something else on the card.
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
// One line, control characters and runs of blanks gone, cut to n.
const line = (v, n) => String(v ?? '').replace(INVISIBLE, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
// Several lines kept as they are (a goal can be a short paragraph), the rest cleaned.
const para = (v, n) => String(v ?? '').replace(INVISIBLE, '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
const items = (v, n = MAX_ITEM, max = MAX_ITEMS) => (Array.isArray(v) ? v : []).map(x => line(x, n)).filter(Boolean).slice(0, max);
// A title or an option's name: it goes inside Shellby's own bracketed lines to
// Claude, so no brackets or quotes that could pass for the end of one.
const named = v => line(String(v ?? '').replace(/[[\]"`]/g, ''), MAX_TITLE);
const oneOf = (v, list) => (list.includes(/** @type {string} */ (v)) ? /** @type {string} */ (v) : null);
const record = v => (v && typeof v === 'object' ? /** @type {Record<string, unknown>} */ (v) : {});

/**
 * A scope path from Claude -> its normal form ("src/cache/", "test/*.js"), or
 * null for one that isn't a path inside the repo. Relative, forward slashes,
 * no .. and no drive or leading slash: a scope can't reach outside the project.
 */
function scopePath(v) {
  const p = line(v, MAX_PATH).replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/{2,}/g, '/');
  if (!p || p === '.' || p.startsWith('/') || /^[a-z]:/i.test(p) || p.split('/').includes('..') || /[[\]"`]/.test(p)) return null;
  return p;
}

/** A list of scope paths -> { paths } | { error } */
function readScope(v, what = 'scope') {
  const raw = (Array.isArray(v) ? v : []).slice(0, MAX_SCOPE);
  const paths = [];
  for (const x of raw) {
    const p = scopePath(x);
    if (!p) return { error: `${what}: "${line(x, 60)}" isn't a path inside the repo. Give paths relative to its root, like "src/cache.js" or "src/cache/".` };
    if (!paths.includes(p)) paths.push(p);
  }
  if (!paths.length) return { error: `Say which files or folders you will change (${what}), relative to the repo root.` };
  return { paths };
}

/**
 * A test plan item -> { check, command? }. A command is kept only when it's
 * one Shellby would build itself (checks.isSafeCommand): those it runs after
 * the work; any other stays a check Claude reports on.
 */
function planItem(x) {
  if (typeof x === 'string') { const check = line(x, MAX_ITEM); return check ? { check } : null; }
  const o = record(x);
  const check = line(o.check, MAX_ITEM);
  if (!check) return null;
  const command = line(o.command, 100).replace(/^npm test$/, 'npm run test');
  return checks.isSafeCommand(command) ? { check, command } : { check };
}
const readPlan = v => (Array.isArray(v) ? v : []).map(planItem).filter(Boolean).slice(0, MAX_ITEMS);

/**
 * `decide`'s arguments -> { decision } | { error }. The decision is what the
 * card shows and History keeps: everything clipped, nothing trusted as markup.
 * @param {unknown} args
 */
function readDecision(args) {
  const a = record(args);
  const title = named(a.title);
  const goal = para(a.goal, MAX_TEXT);
  const why = para(a.why, MAX_TEXT);
  if (!title) return { error: 'Give the decision a title.' };
  if (!goal) return { error: 'Say what done means (goal).' };
  const options = (Array.isArray(a.options) ? a.options : []).slice(0, MAX_OPTIONS).map(o => {
    const x = record(o);
    return { name: named(x.name), summary: para(x.summary, MAX_TEXT), pros: items(x.pros), cons: items(x.cons) };
  }).filter(o => o.name);
  if (!options.length) return { error: 'List the options you weighed, each with a name and a summary.' };
  const names = options.map(o => o.name.toLowerCase());
  if (new Set(names).size !== names.length) return { error: 'Give each option its own name.' };
  const choice = options.findIndex(o => o.name.toLowerCase() === named(a.choice).toLowerCase());
  if (choice < 0) return { error: `choice must be one of the options' names: ${options.map(o => o.name).join(', ')}.` };
  if (!why) return { error: 'Say why you picked it (why).' };
  const scope = readScope(a.scope);
  if (scope.error) return { error: scope.error };
  const testPlan = readPlan(a.test_plan);
  if (!testPlan.length) return { error: 'Say how you will check it works (test_plan).' };
  const supersedes = line(a.supersedes, MAX_PATH).replace(/[[\]"`]/g, '');
  return {
    decision: {
      title, goal, constraints: items(a.constraints), options, choice, why, scope: scope.paths, testPlan, risks: items(a.risks),
      steps: items(a.steps, MAX_ITEM, MAX_ITEMS),
      related: items(a.related, MAX_PATH).map(r => r.replace(/[[\]"`]/g, '')).filter(Boolean),
      ...(supersedes ? { supersedes } : {}),
      confidence: oneOf(a.confidence, LEVELS), reversibility: oneOf(a.reversibility, REVERSIBILITY),
      critique: items(a.critique),
    },
  };
}

/** Low confidence in something hard to undo: worth trying before building. Pure. */
const worthASpike = d => d?.confidence === 'low' && d?.reversibility === 'hard';

/**
 * `check_decision`'s arguments -> { outcome } | { error }. steps: how many the
 * decision has (0 for none): a step out of range is refused.
 * @param {unknown} args
 */
function readOutcome(args, steps = 0) {
  const a = record(args);
  if (typeof a.followed !== 'boolean') return { error: 'Say whether the work followed the decision (followed: true or false).' };
  const summary = para(a.summary, MAX_TEXT);
  if (!summary) return { error: 'Say what was done (summary).' };
  /** @type {number | null} */
  let step = null;
  if (a.step != null) {
    if (!steps) return { error: 'This decision has no steps: leave step out.' };
    if (!Number.isInteger(a.step) || /** @type {number} */ (a.step) < 1 || /** @type {number} */ (a.step) > steps) return { error: `step is a number from 1 to ${steps}.` };
    step = /** @type {number} */ (a.step);
  }
  const deviations = (Array.isArray(a.deviations) ? a.deviations : []).slice(0, MAX_ITEMS).map(d => {
    const x = record(d);
    return { what: line(x.what, MAX_ITEM), why: line(x.why, MAX_ITEM) };
  }).filter(d => d.what);
  const tests = (Array.isArray(a.tests) ? a.tests : []).slice(0, MAX_ITEMS).map(t => {
    const x = record(t);
    return { check: line(x.check, MAX_ITEM), result: oneOf(x.result, RESULTS) || 'skipped' };
  }).filter(t => t.check);
  // A path in the repo, shown as text: never opened or trusted from here.
  const rec = line(a.record, 260);
  return { outcome: { followed: a.followed, summary, deviations, tests, ...(rec ? { record: rec } : {}), ...(step ? { step } : {}) } };
}

/** `amend_decision`'s arguments -> { amendment: { add, why } } | { error } */
function readAmendment(args) {
  const a = record(args);
  const scope = readScope(a.add_scope, 'add_scope');
  if (scope.error) return { error: scope.error };
  const why = para(a.why, MAX_TEXT);
  if (!why) return { error: 'Say why the work needs them (why).' };
  return { amendment: { add: scope.paths, why } };
}

/** `spike`'s arguments -> { spike: { question, plan } } | { error } */
function readSpike(args) {
  const a = record(args);
  const question = named(a.question);
  if (!question) return { error: 'Say what the spike will find out (question).' };
  const plan = para(a.plan, MAX_TEXT);
  if (!plan) return { error: 'Say what you will try (plan).' };
  return { spike: { question, plan } };
}

/** `end_spike`'s arguments -> { findings, answer? } | { error } */
function readFindings(args) {
  const a = record(args);
  const findings = para(a.findings, MAX_TEXT);
  if (!findings) return { error: 'Say what the spike showed (findings).' };
  const answer = line(a.answer, MAX_ITEM);
  return { findings, ...(answer ? { answer } : {}) };
}

/** A decision's file name under RECORD_DIR, without its number: a slug of the title. */
function recordSlug(title) {
  return line(title, MAX_TITLE).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'decision';
}

/** The scope as it stands: the decision's, and every amendment you approved. Pure. */
const scopeOf = d => [...(d?.scope || []), ...(d?.amendments || []).filter(m => m.phase === 'approved').flatMap(m => m.add)];
/** The amendment waiting on the card, if any. */
const pendingAmendment = d => (d?.amendments || []).find(m => m.phase === 'proposed') || null;

// ------------------------------------------------------------------ the card

/** The transcript item for a decision: the card in the feed, and how History remembers it. */
function view(d) {
  return {
    kind: 'engineer', id: d.id, phase: d.phase, title: d.title, goal: d.goal,
    constraints: d.constraints, options: d.options, choice: d.choice, why: d.why,
    scope: d.scope, testPlan: d.testPlan, risks: d.risks,
    steps: d.steps || [], related: d.related || [], critique: d.critique || [],
    ...(d.supersedes ? { supersedes: d.supersedes } : {}),
    ...(d.confidence ? { confidence: d.confidence } : {}),
    ...(d.reversibility ? { reversibility: d.reversibility } : {}),
    ...(d.amendments?.length ? { amendments: d.amendments } : {}),
    ...(d.progress?.length ? { progress: d.progress } : {}),
    ...(Number.isInteger(d.picked) ? { picked: d.picked } : {}),
    ...(d.note ? { note: d.note } : {}),
    ...(d.asked ? { asked: d.asked } : {}),
    ...(d.outcome ? { outcome: d.outcome } : {}),
    ...(d.root ? { root: d.root } : {}),
    ...(d.touched ? { touched: d.touched } : {}),
    ...(d.audit ? { audit: d.audit } : {}),
    ...(d.auditPending ? { auditPending: true } : {}),
    ...(d.verify ? { verify: d.verify } : {}),
    ...(d.spike ? { spike: d.spike } : {}),
  };
}

/** A path list read back from History: strings, in the repo, clipped. */
const paths = (v, max) => (Array.isArray(v) ? v : []).map(scopePath).filter(Boolean).slice(0, max);

/**
 * What Shellby's diff check found, read back from History. unseen: some turn's
 * snapshots couldn't be taken (or the folder isn't a git repo); unavailable:
 * Shellby closed before it could compare.
 */
function reviveAudit(a) {
  const x = record(a);
  if (!Array.isArray(x.unplanned)) return null;
  return {
    files: Math.max(0, Math.min(100000, Number(x.files) || 0)), unplanned: paths(x.unplanned, MAX_TOUCHED),
    ...(x.unseen === true ? { unseen: true } : {}), ...(x.unavailable === true ? { unavailable: true } : {}),
  };
}

/** Shellby's run of the test plan's commands, read back from History. One still running then was cut short. */
function reviveVerify(v) {
  const x = record(v);
  const was = oneOf(x.status, ['running', 'done', 'declined', 'none', 'cancelled', 'error']);
  if (!was) return null;
  const status = was === 'running' ? 'cancelled' : was;
  const results = (Array.isArray(x.results) ? x.results : []).slice(0, MAX_ITEMS).map(r => {
    const o = record(r);
    const cmd = line(o.cmd, 100);
    return checks.isSafeCommand(cmd) ? { cmd, status: oneOf(o.status, checks.STATUSES) || 'error', tail: para(o.tail, 4000) } : null;
  }).filter(Boolean);
  return { status, results };
}

/**
 * A decision read back from History, checked again as if Claude had just sent
 * it (History is a file on disk). -> the decision, or null when it doesn't hold up
 * @param {Record<string, any>} i
 */
function revive(i) {
  const options = Array.isArray(i.options) ? i.options : [];
  // Older cards kept the plan as plain strings and had no scope: open scope ('**') for those.
  const scope = Array.isArray(i.scope) && i.scope.length ? i.scope : ['**'];
  const r = readDecision({
    title: i.title, goal: i.goal, constraints: i.constraints, options, choice: options[i.choice]?.name, why: i.why,
    scope, test_plan: i.testPlan, risks: i.risks, steps: i.steps, related: i.related, supersedes: i.supersedes,
    confidence: i.confidence, reversibility: i.reversibility, critique: i.critique,
  });
  if (!r.decision) return null;
  const steps = r.decision.steps.length;
  const outcome = i.outcome ? readOutcome(i.outcome, steps).outcome : null;
  const progress = (Array.isArray(i.progress) ? i.progress : []).map(p => readOutcome(p, steps).outcome).filter(p => p?.step).slice(0, MAX_ITEMS);
  const amendments = (Array.isArray(i.amendments) ? i.amendments : []).slice(0, MAX_ITEMS).map(m => {
    const x = record(m);
    const a = readAmendment({ add_scope: x.add, why: x.why }).amendment;
    const phase = oneOf(x.phase, AMEND_PHASES);
    return a && phase && typeof x.id === 'string' ? { id: x.id.slice(0, 64), phase, ...a } : null;
  }).filter(Boolean);
  // A check that was still to come when Shellby closed never will: the card says so rather than waiting for ever.
  const audit = i.audit ? reviveAudit(i.audit) : i.auditPending === true ? { files: 0, unplanned: [], unavailable: true } : null;
  const verify = i.verify ? reviveVerify(i.verify) : null;
  const sp = i.spike ? readSpike(i.spike).spike : null;
  const found = sp && i.spike.findings ? readFindings(i.spike) : null;
  return {
    id: i.id, phase: i.phase, ...r.decision,
    ...(Number.isInteger(i.picked) && r.decision.options[i.picked] ? { picked: i.picked } : {}),
    ...(typeof i.note === 'string' && i.note ? { note: i.note.slice(0, MAX_NOTE) } : {}),
    ...(i.asked === 'critic' || i.asked === 'spike-first' ? { asked: i.asked } : {}),
    ...(outcome ? { outcome } : {}),
    ...(progress.length ? { progress } : {}),
    ...(amendments.length ? { amendments } : {}),
    ...(typeof i.root === 'string' && i.root.length < 400 ? { root: i.root } : {}),
    ...(Array.isArray(i.touched) ? { touched: paths(i.touched, MAX_TOUCHED) } : {}),
    ...(audit ? { audit } : {}),
    ...(verify ? { verify } : {}),
    ...(sp && found && !found.error ? { spike: { question: sp.question, ...found } } : {}),
  };
}

/**
 * The latest decision in a conversation's History, for a reopened one. -> the decision or null
 * @param {unknown} transcript
 * @returns {Record<string, any> | null}
 */
function latestFrom(transcript) {
  /** @type {Record<string, any> | null} */
  let last = null;
  for (const i of Array.isArray(transcript) ? transcript : []) if (i?.kind === 'engineer' && typeof i.id === 'string' && PHASES.includes(i.phase)) last = i;
  return last ? revive(last) : null;
}

// ------------------------------------------------------------------ the spike's card

/** The transcript item for a spike. refs: each turn's diff while it ran, to put back. */
function spikeView(s) {
  return {
    kind: 'engineer-spike', id: s.id, phase: s.phase, question: s.question, plan: s.plan,
    ...(s.findings ? { findings: s.findings } : {}),
    ...(s.answer ? { answer: s.answer } : {}),
    ...(s.root ? { root: s.root } : {}),
    ...(s.refs?.length ? { refs: s.refs } : {}),
    ...(s.restored ? { restored: s.restored } : {}),
    ...(s.note ? { note: s.note } : {}),
    ...(s.used ? { used: true } : {}),
  };
}

const TREE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** A spike read back from History. -> the spike or null */
function reviveSpike(i) {
  const r = readSpike({ question: i.question, plan: i.plan });
  if (!r.spike || typeof i.id !== 'string' || !SPIKE_PHASES.includes(i.phase)) return null;
  const f = i.findings ? readFindings({ findings: i.findings, answer: i.answer }) : null;
  const refs = (Array.isArray(i.refs) ? i.refs : []).slice(0, 200).map(x => {
    const o = record(x);
    if (typeof o.root !== 'string' || !TREE.test(String(o.before)) || !TREE.test(String(o.after))) return null;
    return { root: o.root, before: o.before, after: o.after, ...(Array.isArray(o.paths) ? { paths: o.paths.filter(p => typeof p === 'string').slice(0, 100) } : {}) };
  }).filter(Boolean);
  const rs = record(i.restored);
  return {
    id: i.id.slice(0, 64), phase: i.phase, ...r.spike,
    // Checked against the conversation's own folders by wiring/engineer.js before it's used.
    ...(typeof i.root === 'string' && i.root.length < 400 ? { root: i.root } : {}),
    ...(f && !f.error ? f : {}),
    ...(refs.length ? { refs } : {}),
    ...(i.restored ? { restored: { ok: rs.ok === true, files: Math.max(0, Number(rs.files) || 0), ...(rs.error ? { error: line(rs.error, MAX_ITEM) } : {}) } } : {}),
    ...(typeof i.note === 'string' && i.note ? { note: i.note.slice(0, MAX_NOTE) } : {}),
    ...(i.used === true ? { used: true } : {}),
  };
}

/** The latest spike in a transcript, for a reopened conversation. */
function latestSpikeFrom(transcript) {
  let last = null;
  for (const i of Array.isArray(transcript) ? transcript : []) if (i?.kind === 'engineer-spike' && typeof i.id === 'string') last = i;
  return last ? reviveSpike(last) : null;
}

module.exports = {
  DECIDE, CHECK, AMEND, SPIKE, END_SPIKE, TOOL_NAMES, TOOLS, PHASES, SPIKE_PHASES, RESULTS, LEVELS, REVERSIBILITY, RECORD_DIR, MAX_NOTE, MAX_TOUCHED,
  line, para, named, scopePath, readScope, readDecision, readOutcome, readAmendment, readSpike, readFindings, recordSlug,
  scopeOf, pendingAmendment, worthASpike, view, latestFrom, spikeView, latestSpikeFrom,
};
