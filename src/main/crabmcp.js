// The crab's tools, served from inside the app to Shellby's own conversations.
//
// The plugin's MCP server (claude-plugin/mcp/server.js) is a separate process
// that reaches the app over a local port, for Claude Code running anywhere.
// Shellby's own `claude -p` processes don't need that: Claude Code can host an
// MCP server in the app that started it, over the same stdin/stdout control
// channel permission prompts use (an `mcp_message` control request carrying the
// JSON-RPC). So there is no extra process, no port, and every call arrives
// knowing which conversation made it.
//
// Every tool schema is sent to the model on every turn, so descriptions are as
// short as they can be and still be used well.
//
// Pure: handle() takes the JSON-RPC message and a `call` callback that does the
// work; see test/crabmcp.test.js.

const { MOODS, MAX_TEXT, MAX_ITEM, MAX_ROUTINE_PROMPT } = require('./crabtools');
const { FEATURE_IDS, FOCUS_MINUTES } = require('./selfaware');
const { MAX_TEXT: MAX_NOTE } = require('./notes');
const { MODES } = require('./config');

// The longest one wait_for_tasks call waits; an agent calls again to wait longer.
const MAX_WAIT_SECONDS = 300;

const SERVER = 'shellby';
const VERSION = '1.0.0';
const PROTOCOL = '2025-06-18';

const obj = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });

const CRAB_TOOLS = [
  {
    name: 'say',
    description: "Put one short line in the crab's speech bubble on the desktop.",
    inputSchema: obj({ text: { type: 'string', maxLength: MAX_TEXT }, mood: { type: 'string', enum: MOODS } }, ['text']),
  },
  {
    name: 'celebrate',
    description: 'Confetti on the desktop for a real milestone: a release out, a red build green, a long job done.',
    inputSchema: obj({ reason: { type: 'string', maxLength: MAX_TEXT } }),
  },
  {
    name: 'wear',
    description: 'Put an unlocked accessory on the crab by name, like "party hat".',
    inputSchema: obj({ item: { type: 'string', maxLength: MAX_ITEM } }, ['item']),
  },
  {
    name: 'status',
    description: "The crab's level and what he's doing, plus this PC's temperatures, memory and disk space if Health is on. Worth a look before a heavy build.",
    inputSchema: obj({}),
  },
  {
    name: 'note',
    description: "Put an idea on the user's Notes list for this project, to plan, build or ask about later. Only when they ask you to note something.",
    inputSchema: obj({ text: { type: 'string', maxLength: MAX_NOTE } }, ['text']),
  },
  // Routines are served here too, so asking for one puts up Shellby's confirm
  // window even when the plugin is missing or too old to show the crab token.
  // The plugin's copy has nested schedule objects; this one takes the same
  // short schedule string `suggest` does, to keep the schema small.
  {
    name: 'add_routine',
    description: 'Propose a routine: a prompt Shellby runs on a schedule, saved only if the user says yes. A taken name replaces that one. Runs start fresh: make the prompt self-contained.',
    inputSchema: obj({
      name: { type: 'string', maxLength: 60 },
      prompt: { type: 'string', maxLength: MAX_ROUTINE_PROMPT },
      schedule: { type: 'string', description: '"daily 08:30", "weekly mon,fri 17:00" or "every 4h"' },
      folder: { type: 'string', description: 'Absolute path' },
      mode: { type: 'string', enum: MODES.filter(m => m !== 'autonomous') },
      model: { type: 'string' },
      catchUp: { type: 'boolean' },
    }, ['name', 'prompt', 'schedule']),
  },
  {
    name: 'list_routines',
    description: "The user's routines.",
    inputSchema: obj({}),
  },
];

// The task board (taskboard/board.js): Shellby's conversations handing each
// other work in a project. ids look like "b-k3j9x0". Four tools, kept terse:
// their schemas ride along on every turn of every conversation, so lengths and
// counts are left to board.js, which cuts and checks everything it's given.
const STR = { type: 'string' };
const IDS = { type: 'array', items: STR };
const BOARD_TOOLS = [
  {
    name: 'post_task',
    description: "Post a task on this project's board for another conversation. detail must stand alone. start: true starts a helper on it.",
    inputSchema: obj({ title: STR, detail: STR, needs: IDS, start: { type: 'boolean' } }, ['title']),
  },
  {
    name: 'list_tasks',
    description: "This project's task board.",
    inputSchema: obj({ status: { type: 'string', enum: ['active', 'ready', 'done', 'all'] } }),
  },
  {
    name: 'update_task',
    description: 'claim a ready task; then done or failed with a result for the poster (what changed, which branch), or release it. cancel one you posted.',
    inputSchema: obj({ id: STR, action: { type: 'string', enum: ['claim', 'done', 'failed', 'release', 'cancel'] }, result: STR }, ['id', 'action']),
  },
  {
    name: 'wait_for_tasks',
    description: `Wait until these tasks finish (or timeout_seconds, at most ${MAX_WAIT_SECONDS}), then get their results.`,
    inputSchema: obj({ ids: IDS, timeout_seconds: { type: 'integer' } }, ['ids']),
  },
];
const BOARD_TOOL_NAMES = BOARD_TOOLS.map(t => t.name);

const SUGGEST_TOOL = {
  name: 'suggest',
  description: 'Offer the user a Shellby feature as a card they can tap. Nothing happens unless they tap it. The reply says whether it was shown.',
  inputSchema: obj({
    feature: { type: 'string', enum: FEATURE_IDS },
    why: { type: 'string', maxLength: 120, description: 'Why it helps here, in a few words.' },
    name: { type: 'string', description: 'routine: a short name' },
    prompt: { type: 'string', description: 'routine: the task it runs' },
    schedule: { type: 'string', description: 'routine: "daily 08:30", "weekly mon,fri 17:00" or "every 4h"' },
    minutes: { type: 'integer', enum: FOCUS_MINUTES, description: 'focus' },
  }, ['feature', 'why']),
};

/** The tools a conversation gets: the crab's, the task board's when it's on, and `suggest` when suggestions are on. */
function toolsFor({ suggestions = true, board = true } = {}) {
  return [...CRAB_TOOLS, ...(board ? BOARD_TOOLS : []), ...(suggestions ? [SUGGEST_TOOL] : [])];
}

/** The mcpServers entry for the one server Shellby hosts itself. */
function servers() {
  return { [SERVER]: { type: 'sdk', name: SERVER } };
}

const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/**
 * One JSON-RPC message from Claude Code -> the response to send back.
 *   tools: what tools/list answers with
 *   call(name, args) -> Promise<{ text, isError? }>; only ever called with a listed tool
 * Notifications have no id and get an empty result, which is what Claude Code
 * expects in the control response that carries them.
 */
async function handle(message, { tools, call }) {
  const m = message && typeof message === 'object' ? message : {};
  const id = m.id ?? null;
  switch (m.method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: typeof m.params?.protocolVersion === 'string' ? m.params.protocolVersion : PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER, version: VERSION },
      });
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools });
    case 'tools/call': {
      const name = m.params?.name;
      if (!tools.some(t => t.name === name)) return reply(id, { content: [{ type: 'text', text: `Unknown tool: ${String(name).slice(0, 40)}` }], isError: true });
      const args = m.params?.arguments && typeof m.params.arguments === 'object' ? m.params.arguments : {};
      let out;
      try { out = await call(name, args); } catch (err) { out = { text: `Shellby couldn't do that: ${err.message}`, isError: true }; }
      return reply(id, { content: [{ type: 'text', text: String(out?.text || 'Done.') }], ...(out?.isError ? { isError: true } : {}) });
    }
    default:
      if (id === null) return { jsonrpc: '2.0', id: 0, result: {} };  // a notification
      return fail(id, -32601, `Method not found: ${String(m.method).slice(0, 40)}`);
  }
}

module.exports = { SERVER, BOARD_TOOL_NAMES, MAX_WAIT_SECONDS, toolsFor, servers, handle };
