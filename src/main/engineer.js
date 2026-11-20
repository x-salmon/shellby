// Engineer mode (docs/ENGINEER.md): decide before you build.
//
// With the Engineer chip on, Claude looks around, then puts its decision on a
// card through the crab's `decide` tool: the goal, what constrains it, the
// options it weighed with their trade-offs, which one it picks and why, how
// it'll be tested, and the risks. Nothing that changes a file runs until you
// approve one (the gate below, on the work hook). When the work is done,
// `check_decision` says how it went against what was decided.
//
// Pure: the tools, their checks, the card's view, the line each message gets
// and the gate. The conversation's side is wiring/engineer.js.

const DECIDE = 'decide';
const CHECK = 'check_decision';
const TOOL_NAMES = Object.freeze([DECIDE, CHECK]);

const MAX_TITLE = 80;
const MAX_TEXT = 1200;
const MAX_ITEM = 300;
const MAX_ITEMS = 8;
const MAX_OPTIONS = 4;
const MAX_NOTE = 2000;
const RESULTS = Object.freeze(['passed', 'failed', 'skipped']);
// Where an approved decision is written down in the repo (when Settings keeps them).
const RECORD_DIR = 'docs/decisions';

// proposed: on the card, waiting for you. approved: the work is under way.
// returned: you sent it back. checked: the work's done and compared with it.
// closed: you closed it (or turned the chip off) before it was checked.
const PHASES = Object.freeze(['proposed', 'approved', 'returned', 'checked', 'closed']);

// What Claude may still use with no decision approved, once the gate sees
// every tool (session/args.js initHooks): reading, searching, asking, planning,
// and the crab's tools that change nothing in the project. Anything else, an
// MCP server's included, waits for an approval. Bash and PowerShell go by what
// the command does (worktrees.startsWork). Helpers' own tools pass the gate too.
const LOOKS = new Set([
  'Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch', 'TodoWrite', 'TodoRead', 'Task', 'Agent',
  'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'ToolSearch', 'Skill', 'ListMcpResourcesTool', 'ReadMcpResourceTool',
  'BashOutput', 'TaskOutput', 'TaskStop', 'KillShell', 'Monitor', 'Bash', 'PowerShell',
]);
const CRAB = 'mcp__shellby__';
const CRAB_LOOKS = new Set([
  DECIDE, CHECK, 'say', 'celebrate', 'wear', 'status', 'note', 'suggest',
  'list_routines', 'list_tasks', 'wait_for_tasks', 'list_chats', 'read_chat', 'list_pages', 'read_page',
]);

const STR = { type: 'string' };
const LIST = { type: 'array', items: STR };
const obj = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });

const TOOLS = Object.freeze([
  {
    name: DECIDE,
    description: 'Only while Shellby\'s Engineer mode is on: put your decision before the user, as a card, before changing any file. '
      + 'Explore first. Give the real options you weighed (two or more where there are; one only when nothing else is sane, and say why) with honest trade-offs, '
      + 'pick one, and say how you will know it works. Then end your turn: their answer arrives as their next message, and file changes are blocked until they approve.',
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
      test_plan: { ...LIST, description: 'How you will check it works' },
      risks: { ...LIST, description: 'What could go wrong, and what would change your mind' },
    }, ['title', 'goal', 'options', 'choice', 'why', 'test_plan']),
  },
  {
    name: CHECK,
    description: 'Only while Shellby\'s Engineer mode is on: once the approved work is done, say how it went against the decision. '
      + 'Run the test plan first and report each check truthfully. Further file changes need a new decision.',
    inputSchema: obj({
      followed: { type: 'boolean', description: 'Whether the work did what was decided' },
      summary: { type: 'string', description: 'What was done, in a sentence or two' },
      deviations: { type: 'array', items: obj({ what: STR, why: STR }, ['what', 'why']), description: 'Where the work left the decision, and why' },
      tests: { type: 'array', items: obj({ check: STR, result: { type: 'string', enum: RESULTS } }, ['check', 'result']) },
      record: { type: 'string', description: 'The decision record file you wrote, if you wrote one' },
    }, ['followed', 'summary']),
  },
]);

// One line, control characters and runs of blanks gone, cut to n.
const line = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
// Several lines kept as they are (a goal can be a short paragraph), the rest cleaned.
const para = (v, n) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
const items = (v, n = MAX_ITEM) => (Array.isArray(v) ? v : []).map(x => line(x, n)).filter(Boolean).slice(0, MAX_ITEMS);
// A title or an option's name: it goes inside Shellby's own bracketed lines to
// Claude, so no brackets or quotes that could pass for the end of one.
const named = v => line(String(v ?? '').replace(/[[\]"`]/g, ''), MAX_TITLE);

/**
 * `decide`'s arguments -> { decision } | { error }. The decision is what the
 * card shows and History keeps: everything clipped, nothing trusted as markup.
 * @param {unknown} args
 */
function readDecision(args) {
  const a = args && typeof args === 'object' ? /** @type {Record<string, unknown>} */ (args) : {};
  const title = named(a.title);
  const goal = para(a.goal, MAX_TEXT);
  const why = para(a.why, MAX_TEXT);
  if (!title) return { error: 'Give the decision a title.' };
  if (!goal) return { error: 'Say what done means (goal).' };
  const options = (Array.isArray(a.options) ? a.options : []).slice(0, MAX_OPTIONS).map(o => {
    const x = o && typeof o === 'object' ? /** @type {Record<string, unknown>} */ (o) : {};
    return { name: named(x.name), summary: para(x.summary, MAX_TEXT), pros: items(x.pros), cons: items(x.cons) };
  }).filter(o => o.name);
  if (!options.length) return { error: 'List the options you weighed, each with a name and a summary.' };
  const names = options.map(o => o.name.toLowerCase());
  if (new Set(names).size !== names.length) return { error: 'Give each option its own name.' };
  const choice = options.findIndex(o => o.name.toLowerCase() === named(a.choice).toLowerCase());
  if (choice < 0) return { error: `choice must be one of the options' names: ${options.map(o => o.name).join(', ')}.` };
  if (!why) return { error: 'Say why you picked it (why).' };
  const testPlan = items(a.test_plan);
  if (!testPlan.length) return { error: 'Say how you will check it works (test_plan).' };
  return {
    decision: { title, goal, constraints: items(a.constraints), options, choice, why, testPlan, risks: items(a.risks) },
  };
}

/**
 * `check_decision`'s arguments -> { outcome } | { error }.
 * @param {unknown} args
 */
function readOutcome(args) {
  const a = args && typeof args === 'object' ? /** @type {Record<string, unknown>} */ (args) : {};
  if (typeof a.followed !== 'boolean') return { error: 'Say whether the work followed the decision (followed: true or false).' };
  const summary = para(a.summary, MAX_TEXT);
  if (!summary) return { error: 'Say what was done (summary).' };
  const deviations = (Array.isArray(a.deviations) ? a.deviations : []).slice(0, MAX_ITEMS).map(d => {
    const x = d && typeof d === 'object' ? /** @type {Record<string, unknown>} */ (d) : {};
    return { what: line(x.what, MAX_ITEM), why: line(x.why, MAX_ITEM) };
  }).filter(d => d.what);
  const tests = (Array.isArray(a.tests) ? a.tests : []).slice(0, MAX_ITEMS).map(t => {
    const x = t && typeof t === 'object' ? /** @type {Record<string, unknown>} */ (t) : {};
    return { check: line(x.check, MAX_ITEM), result: RESULTS.includes(/** @type {string} */ (x.result)) ? x.result : 'skipped' };
  }).filter(t => t.check);
  // A path in the repo, shown as text: never opened or trusted from here.
  const record = line(a.record, 260);
  return { outcome: { followed: a.followed, summary, deviations, tests, ...(record ? { record } : {}) } };
}

/** A decision's file name under RECORD_DIR, without its number: a slug of the title. */
function recordSlug(title) {
  return line(title, MAX_TITLE).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'decision';
}

// ------------------------------------------------------------------ the line each message gets

/**
 * The bracketed line a message carries while Engineer mode is on (selfaware's
 * "[Shellby:" convention), or '' when it needs none. state: the conversation's
 * engineer state (wiring/engineer.js), { phase } of its latest decision or null.
 */
function turnNote(state) {
  const phase = state?.decision?.phase;
  if (phase === 'approved') {
    return `[Shellby: Engineer mode is on. The approved decision "${state.decision.title}" covers this work. If this message asks for something it doesn't cover, call mcp__shellby__decide again first.]`;
  }
  if (phase === 'proposed') {
    return '[Shellby: Engineer mode is on. Your decision is waiting on the user\'s card. Answer what they ask, but change no files until they approve it; if this message changes what is needed, call mcp__shellby__decide again with the new decision.]';
  }
  return '[Shellby: Engineer mode is on. Before changing any file, explore, then call mcp__shellby__decide with your decision and end your turn. File changes are blocked until the user approves one. Questions that need no changes can be answered directly.]';
}

/** Appends the line to a prompt (a string, or content blocks when pictures go with it). */
function withNote(prompt, note) {
  if (!note) return prompt;
  if (Array.isArray(prompt)) return [...prompt, { type: 'text', text: note }];
  return `${prompt}\n\n${note}`;
}

// ------------------------------------------------------------------ what you answer

/**
 * What Claude is told when you press a button on the card. what: 'approve' |
 * 'pick' (another option, by index) | 'return'. keepRecords: Settings' "keep
 * decision records in the repo". -> { prompt, shown } | { error }
 */
function answerPrompt(decision, { what, option = -1, note = '', keepRecords = true }) {
  const said = para(note, MAX_NOTE);
  const theirs = said ? `\nTheir note: ${said}` : '';
  if (what === 'return') {
    if (!said) return { error: 'Say what should change, then send it back.' };
    return {
      prompt: `[Shellby: The user sent the decision "${decision.title}" back without approving it.${theirs}\nRethink it, then call mcp__shellby__decide again. File changes stay blocked until they approve one.]`,
      shown: `Sent back: ${line(said, 200)}`,
    };
  }
  const picked = what === 'pick' ? option : decision.choice;
  const chosen = decision.options[picked];
  if (!chosen) return { error: 'That option is gone. Look at the card again.' };
  const instead = picked !== decision.choice ? ` They chose "${chosen.name}" rather than your pick, "${decision.options[decision.choice].name}".` : '';
  const record = keepRecords
    ? `\nFirst write the decision down: ${RECORD_DIR}/NNNN-${recordSlug(decision.title)}.md, with NNNN the next free four-digit number there, in this shape: # NNNN. Title; Status: Accepted; Date; ## Context (goal and constraints); ## Options considered (each with its trade-offs); ## Decision (the chosen option and why); ## Test plan; ## Risks. Follow the house style if the folder already has records.`
    : '';
  return {
    prompt: `[Shellby: The user approved the decision "${decision.title}".${instead}${theirs}\nFile changes are unblocked for this work.${record}\nThen do the work, run the test plan, and finish with mcp__shellby__check_decision.]`,
    shown: picked !== decision.choice ? `Go with "${chosen.name}"${said ? `: ${line(said, 160)}` : ''}` : `Approved: ${decision.title}${said ? `: ${line(said, 160)}` : ''}`,
    picked,
  };
}

// ------------------------------------------------------------------ the gate

/** Whether a tool call may run with no decision approved: it only looks around. */
function looks(toolName, toolInput, startsWork) {
  const tool = String(toolName || '');
  if (startsWork(tool, toolInput)) return false;
  if (tool.startsWith(CRAB)) return CRAB_LOOKS.has(tool.slice(CRAB.length));
  return LOOKS.has(tool);
}

/** The hook output that holds a tool call back, saying why. */
const deny = why => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } });

/**
 * The work hook's answer while Engineer mode is on: deny anything but looking
 * around until a decision is approved. startsWork(tool, input): whether the
 * call changes files (worktrees.startsWork). -> hook output, or null to let it through.
 */
function gate(state, toolName, toolInput, startsWork) {
  if (!state?.on || state.decision?.phase === 'approved') return null;
  if (looks(toolName, toolInput, startsWork)) return null;
  const why = state.decision?.phase === 'proposed'
    ? 'Engineer mode: the decision is still waiting on the user\'s card. End your turn and wait for their answer before changing anything.'
    : 'Engineer mode: no approved decision covers this step. Call mcp__shellby__decide with your decision, end your turn, and wait for the user to approve it.';
  return deny(why);
}

/** What the hook answers when the gate itself failed: no, rather than a step nobody checked. */
const gateFailed = () => deny('Engineer mode could not check this step, so it was held back. Try it again; if it keeps happening, the user can turn Engineer mode off.');

// ------------------------------------------------------------------ the card

/** The transcript item for a decision: the card in the feed, and how History remembers it. */
function view(d) {
  return {
    kind: 'engineer', id: d.id, phase: d.phase, title: d.title, goal: d.goal,
    constraints: d.constraints, options: d.options, choice: d.choice, why: d.why,
    testPlan: d.testPlan, risks: d.risks,
    ...(Number.isInteger(d.picked) ? { picked: d.picked } : {}),
    ...(d.note ? { note: d.note } : {}),
    ...(d.outcome ? { outcome: d.outcome } : {}),
  };
}

/**
 * A decision read back from History, checked again as if Claude had just sent
 * it (History is a file on disk). -> the decision, or null when it doesn't hold up
 * @param {Record<string, any>} i
 */
function revive(i) {
  const options = Array.isArray(i.options) ? i.options : [];
  const r = readDecision({ title: i.title, goal: i.goal, constraints: i.constraints, options, choice: options[i.choice]?.name, why: i.why, test_plan: i.testPlan, risks: i.risks });
  if (!r.decision) return null;
  const outcome = i.outcome ? readOutcome(i.outcome).outcome : null;
  return {
    id: i.id, phase: i.phase, ...r.decision,
    ...(Number.isInteger(i.picked) && r.decision.options[i.picked] ? { picked: i.picked } : {}),
    ...(typeof i.note === 'string' && i.note ? { note: i.note.slice(0, MAX_NOTE) } : {}),
    ...(outcome ? { outcome } : {}),
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

module.exports = {
  DECIDE, CHECK, TOOL_NAMES, TOOLS, PHASES, RESULTS, RECORD_DIR, MAX_NOTE,
  readDecision, readOutcome, recordSlug, turnNote, withNote, answerPrompt, gate, gateFailed, looks, view, latestFrom,
};
