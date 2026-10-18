// How he works (pure): which working animation the crab plays, from the tool
// Claude has running. One body class per pose in critter.css (.work-<pose>),
// and most of them have something in his claw (renderer/shared/workposes.js);
// 'busy', the scuttle in place, is the one he had before there were others.
//   think   no tool running: Claude is thinking, so he taps his chin
//   read    reading files: leans in over a scroll, eyes running along the lines
//   write   editing: scribbling away with a pencil
//   run     a shell command: digging in, turning a wrench
//   test    tests, lint or a typecheck: a stopwatch up, holding his breath, a foot tapping
//   git     a commit, a push, a merge: sealing an envelope and stamping it
//   install installing packages: hauling a crate that's too big for him
//   build   a build: hammering away
//   search  grep and glob: swivelling about with a magnifying glass, stalks up
//   web     the web: a spyglass to his eye, on tiptoe, looking far off
//   plan    a to-do list or a plan: ticking off a checklist
//   crew    a subagent: waving the helpers on
//   skill   a skill: thumbing through a little recipe book
//   mcp     an MCP server's tool: a tin-can phone to his ear, calling out
//   talk    words of the reply coming out between tools: chattering away, claw going
//   compact the conversation being compacted: stuffing papers into his shell
//   busy    anything else: the scuttle
const { commandKind, gate } = require('./bugdex/detect');

const TOOLS = {
  read: ['Read', 'NotebookRead', 'LS'],
  write: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
  run: ['Bash', 'PowerShell', 'BashOutput', 'KillShell', 'KillBash'],
  search: ['Grep', 'Glob', 'ToolSearch'],
  web: ['WebFetch', 'WebSearch'],
  plan: ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'EnterPlanMode', 'ExitPlanMode'],
  crew: ['Agent', 'Task'],
  skill: ['Skill'],
};
const POSE_OF = new Map(Object.entries(TOOLS).flatMap(([pose, names]) => names.map(n => [n, pose])));
// The shell tools whose command says more about what he's doing than "a command".
const SHELLS = new Set(['Bash', 'PowerShell']);
// A command's kind (bugdex/detect.js commandKind) -> the pose it gets instead of 'run'.
const COMMAND_POSE = Object.freeze({ tests: 'test', lint: 'test', typecheck: 'test', install: 'install', build: 'build', git: 'git' });
const POSES = ['think', ...Object.keys(TOOLS), ...new Set(Object.values(COMMAND_POSE)), 'mcp', 'talk', 'compact', 'busy'];

/**
 * What a tool call is doing, beyond its name, for its pose: for a shell
 * command, which sort it is ('test' | 'git' | 'install' | 'build'), else null.
 * A git command that only reads (status, log, diff) is just a command.
 */
function kindOf(tool, input) {
  if (!SHELLS.has(tool)) return null;
  const cmd = typeof input?.command === 'string' ? input.command.slice(0, 2000) : '';
  if (!cmd) return null;
  const pose = COMMAND_POSE[commandKind(cmd)] || null;
  if (pose === 'git' && gate(cmd) === 'reader') return null;
  return pose;
}

/** A tool name (or null between tools), and its kind from kindOf -> one of POSES. */
function poseOf(tool, kind = null) {
  if (!tool) return 'think';
  if (kind && SHELLS.has(tool) && Object.values(COMMAND_POSE).includes(kind)) return kind;
  if (tool.startsWith('mcp__')) return 'mcp';
  return POSE_OF.get(tool) || 'busy';
}

/**
 * The pose for right now: the tool that moved last ({ tool, kind } or null),
 * and whether a conversation is compacting or writing its reply. Compacting
 * beats everything (nothing else happens while it runs); words of the reply
 * only show between tools, where he would otherwise be thinking.
 */
function poseNow(moved, { compacting = false, talking = false } = {}) {
  if (compacting) return 'compact';
  const pose = poseOf(moved?.tool || null, moved?.kind || null);
  return pose === 'think' && talking ? 'talk' : pose;
}

/**
 * Of several { tool, toolAt, kind? } (tabs, outside sessions), the one whose tool
 * started or finished last, or null when none has run one yet.
 */
function latest(list) {
  let best = null;
  for (const s of list) if (s && Number.isFinite(s.toolAt) && (!best || s.toolAt > best.toolAt)) best = s;
  return best;
}

module.exports = { POSES, poseOf, poseNow, kindOf, latest };
