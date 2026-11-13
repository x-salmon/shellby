// What an ACP agent says, as the events Claude Code would have sent.
//
// Shellby already turns Claude Code's stream-json into what the panel shows
// (stream.js toItems): tool rows, permission cards with their diffs and plain
// words, to-do lists, the turn's result. An ACP agent (Gemini CLI, OpenCode,
// Codex through codex-acp) reports the same things in its own words, so this
// rewrites each into the Claude-shaped event that means the same, and
// stream.js does the rest. A shell command becomes Bash, an edit with a diff
// becomes Edit (or Write for a new file), a read becomes Read, a plan becomes
// TodoWrite. What has no Claude counterpart keeps the agent's own title.
//
// Text arrives in chunks: each is shown as it comes (a partial), and the whole
// reply is one text block once the agent moves on (a tool call, the turn's end).
//
// Pure: createTranslator() keeps that little state. test/harness-acp.test.js.

const MAX_TEXT = 200_000;
const MAX_RESULT = 50_000;

const str = (v, n = 4000) => (typeof v === 'string' ? v.slice(0, n) : '');

/** Plain text out of ACP content: a block, a list of blocks, or tool-call content entries. */
function textOf(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(textOf).filter(Boolean).join('\n');
  if (content.type === 'text') return str(content.text, MAX_RESULT);
  if (content.type === 'content') return textOf(content.content);
  if (content.type === 'diff') return `${content.path || 'a file'} changed`;
  if (content.type === 'resource') return str(content.resource?.text, MAX_RESULT);
  if (content.type === 'resource_link') return str(content.uri, 2000);
  return '';
}

/** An argv list as one command line, each part quoted when it holds a space or a quote, so it reads as what runs. */
function argvText(argv) {
  return argv.map(a => {
    const s = String(a ?? '');
    return /[\s"']/.test(s) || !s ? `"${s.replace(/"/g, '\\"')}"` : s;
  }).join(' ').slice(0, MAX_TEXT);
}

/** Every file a tool call says it touches: its diffs and its locations. */
function pathsOf(call) {
  const out = [...(Array.isArray(call?.content) ? call.content : []).filter(c => c?.type === 'diff').map(c => c.path),
    ...(Array.isArray(call?.locations) ? call.locations : []).map(l => l?.path)];
  return [...new Set(out.filter(p => typeof p === 'string' && p))].slice(0, 200);
}

const diffsOf = call => (Array.isArray(call?.content) ? call.content.filter(c => c?.type === 'diff' && typeof c.path === 'string') : []);
const firstPath = call => str(call?.locations?.find?.(l => typeof l?.path === 'string')?.path, 2000);

/**
 * An ACP tool call -> { name, input } as Claude Code would name it.
 * @param {any} call  a tool_call / tool_call_update, or request_permission's toolCall
 */
function toolOf(call) {
  const raw = call?.rawInput && typeof call.rawInput === 'object' ? call.rawInput : {};
  const title = str(call?.title, 400);
  const mcp = call?._meta?.['gemini-cli']?.mcp;
  if (mcp && typeof mcp.server_name === 'string' && typeof mcp.tool_name === 'string') {
    return { name: `mcp__${mcp.server_name}__${mcp.tool_name}`.slice(0, 200), input: raw };
  }
  switch (call?.kind) {
    case 'execute': {
      // The command itself, whole, never the title in its place: a card that
      // reads "run tests" over a command nobody can see would be a lie.
      const cmd = Array.isArray(raw.command) ? argvText(raw.command) : str(raw.command, MAX_TEXT) || str(raw.cmd, MAX_TEXT);
      if (!cmd) return { name: 'Run a command', input: { description: title }, unseen: true };
      return { name: 'Bash', input: { command: cmd, description: title } };
    }
    case 'edit': {
      const d = diffsOf(call)[0];
      const file = d?.path || str(raw.file_path) || str(raw.path) || str(raw.filePath) || firstPath(call);
      if (d && (d.oldText == null || d.oldText === '')) return { name: 'Write', input: { file_path: file, content: str(d.newText, MAX_TEXT) } };
      if (d) return { name: 'Edit', input: { file_path: file, old_string: str(d.oldText, MAX_TEXT), new_string: str(d.newText, MAX_TEXT) } };
      return { name: 'Edit', input: { file_path: file, old_string: '', new_string: '' } };
    }
    case 'read': return { name: 'Read', input: { file_path: str(raw.file_path) || str(raw.path) || str(raw.absolute_path) || firstPath(call) || title } };
    case 'search': return { name: 'Grep', input: { pattern: str(raw.pattern) || str(raw.query) || title, ...(raw.path ? { path: str(raw.path) } : {}) } };
    case 'fetch': return { name: 'WebFetch', input: { url: str(raw.url) || title, prompt: title } };
    case 'delete': return { name: title || 'Delete', input: { file_path: firstPath(call) } };
    case 'move': return { name: title || 'Move', input: raw };
    default: return { name: title || call?.kind || 'Tool', input: raw };
  }
}

/** An ACP plan's entries as TodoWrite's todos. */
function todosOf(entries) {
  const STATUS = { pending: 'pending', in_progress: 'in_progress', completed: 'completed' };
  return (Array.isArray(entries) ? entries : []).slice(0, 100)
    .map(e => ({ content: str(e?.content, 500), status: STATUS[e?.status] || 'pending', activeForm: str(e?.content, 500) }))
    .filter(t => t.content);
}

/** ACP's usage (prompt result or usage_update) as Claude's usage object. */
function usageOf(u) {
  if (!u || typeof u !== 'object') return null;
  const n = v => (Number.isFinite(v) && v > 0 ? v : 0);
  return {
    input_tokens: n(u.inputTokens), output_tokens: n(u.outputTokens),
    cache_read_input_tokens: n(u.cachedReadTokens), cache_creation_input_tokens: n(u.cachedWriteTokens),
    ...(Number.isFinite(u.thoughtTokens) ? { output_tokens_details: { thinking_tokens: u.thoughtTokens } } : {}),
  };
}

function createTranslator() {
  let reply = '';
  let thought = '';
  const tools = new Map(); // toolCallId -> what's known of it, merged across updates
  const done = new Set();  // tool calls whose result has been sent

  const assistant = content => ({ type: 'assistant', message: { content } });

  /** The reply and thinking so far, as blocks: sent before anything that follows them. */
  function flush() {
    const out = [];
    if (thought.trim()) out.push(assistant([{ type: 'thinking', thinking: thought.trim() }]));
    if (reply.trim()) out.push(assistant([{ type: 'text', text: reply.trim() }]));
    reply = '';
    thought = '';
    return out;
  }

  function result(id, call) {
    if (done.has(id)) return [];
    done.add(id);
    const failed = call.status === 'failed';
    const text = textOf(call.content) || str(typeof call.rawOutput === 'string' ? call.rawOutput : call.rawOutput?.output, MAX_RESULT) || (failed ? 'Failed.' : 'Done.');
    return [{ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: failed }] } }];
  }

  /** One session/update -> Claude-shaped events, in order. */
  function update(u) {
    switch (u?.sessionUpdate) {
      case 'agent_message_chunk': {
        const t = textOf(u.content);
        if (!t) return [];
        reply = (reply + t).slice(-MAX_TEXT);
        return [{ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } } }];
      }
      case 'agent_thought_chunk': {
        thought = (thought + textOf(u.content)).slice(-MAX_TEXT);
        return [];
      }
      case 'tool_call': {
        const id = str(u.toolCallId, 200);
        if (!id) return [];
        tools.set(id, { ...u });
        const { name, input } = toolOf(u);
        const out = [...flush(), assistant([{ type: 'tool_use', id, name, input }])];
        if (u.status === 'completed' || u.status === 'failed') out.push(...result(id, u));
        return out;
      }
      case 'tool_call_update': {
        const id = str(u.toolCallId, 200);
        if (!id) return [];
        const known = tools.has(id);
        const merged = { ...(tools.get(id) || {}), ...Object.fromEntries(Object.entries(u).filter(([, v]) => v != null)) };
        tools.set(id, merged);
        // A tool we never heard start: say it started, so its result has a row to land in.
        const { name, input } = toolOf(merged);
        const start = known ? [] : [...flush(), assistant([{ type: 'tool_use', id, name, input }])];
        if (merged.status !== 'completed' && merged.status !== 'failed') return start;
        return [...start, ...result(id, merged)];
      }
      case 'plan':
        return [...flush(), assistant([{ type: 'tool_use', id: `plan-${Date.now()}`, name: 'TodoWrite', input: { todos: todosOf(u.entries) } }])];
      default:
        return []; // user_message_chunk (a replay), available_commands_update, current_mode_update, usage_update: the session reads those itself
    }
  }

  /**
   * The turn's end: session/prompt's answer -> the reply left, then Claude's result event.
   * @param {{ stopReason?: string, usage?: any } | null} answer
   * @param {{ sessionId?: string | null, error?: string | null, durationMs?: number | null }} o
   */
  function end(answer, { sessionId = null, error = null, durationMs = null } = {}) {
    const stop = answer?.stopReason;
    const ok = !error && (stop === 'end_turn' || stop === 'cancelled' || stop === 'max_turn_requests');
    const why = error || (stop === 'refusal' ? 'The model refused to go on.' : stop === 'max_tokens' ? 'The reply hit its length limit.' : null);
    tools.clear();
    done.clear();
    return [...flush(), {
      type: 'result', subtype: stop === 'cancelled' ? 'interrupted' : ok ? 'success' : 'error',
      is_error: !ok, result: why, session_id: sessionId,
      ...(stop === 'refusal' ? { stop_reason: 'refusal' } : {}),
      duration_ms: durationMs, usage: usageOf(answer?.usage),
    }];
  }

  return { update, end, flush };
}

/**
 * A permission request -> the can_use_tool control request Claude Code sends,
 * which stream.js makes into the card. requestId is Shellby's own.
 */
function permissionEvent(params, requestId) {
  const call = params?.toolCall || {};
  const { name, input } = toolOf(call);
  const files = diffsOf(call).length;
  const description = files > 1 ? `${str(call.title, 300) || 'An edit'} (changes ${files} files)` : str(call.title, 400) || null;
  return { type: 'control_request', request_id: requestId, request: { subtype: 'can_use_tool', tool_name: name, tool_use_id: str(call.toolCallId, 200) || null, input, description } };
}

/**
 * What a card can't show of a request, as the reason to answer it only at the
 * desk (channels/replies.js deskOnly), or null: a command Shellby can't read,
 * or an edit to more files than the card's one diff.
 */
function unseenOf(params) {
  const call = params?.toolCall || {};
  if (toolOf(call).unseen) return "Shellby can't see the command it would run: check it at the desk.";
  const files = diffsOf(call).length;
  if (files > 1) return `It changes ${files} files and the card shows one: check it at the desk.`;
  return null;
}

/**
 * The card's answer -> the option the agent offered that means it.
 * decision: 'allow' | 'deny'; always: allow from now on (the card's Always allow).
 * Never more than was asked: a plain Allow is only ever allow_once, so with no
 * such option it's cancelled; Always allow falls back to once, never the other way.
 * -> ACP's outcome.
 */
function permissionOutcome(options, { decision, always = false }) {
  const list = Array.isArray(options) ? options : [];
  const pick = kinds => list.find(o => kinds.includes(o?.kind));
  const opt = decision === 'allow'
    ? (always ? pick(['allow_always']) || pick(['allow_once']) : pick(['allow_once']))
    : pick(['reject_once']) || pick(['reject_always']);
  return opt ? { outcome: { outcome: 'selected', optionId: opt.optionId } } : { outcome: { outcome: 'cancelled' } };
}

module.exports = { createTranslator, toolOf, todosOf, usageOf, textOf, pathsOf, argvText, permissionEvent, permissionOutcome, unseenOf };
