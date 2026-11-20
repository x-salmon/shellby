// Turns Claude Code stream-json events into a small set of UI items.
// Pure functions: no Electron, no I/O — see test/stream.test.js.

const { editsOf } = require('../renderer/shared/diff');
const { headlessReply } = require('./cli-commands');
const { MAX_RESULT_CHARS, inWords, cronWords, todoOf, todoIdOf, questionsOf, truncate, describeTool, resultText, resultImages, usageFrom, tokensOf, spendFrom, WRITE_TOOLS, AGENT_TOOLS, strings, writtenPath, writeChars, findingsOf, worktreeOf } = require('./stream-tools');
const { toolItem, taskItem, workflowOf, workflowLaunchOf, MOD_UI, MAX_COMMANDS, COMMAND_NAME, oneLine, modItem, goalOf, tokenCount, contextUsageOf, partialOf, nextPromptOf, compactingOf, retryOf, hookRunningOf, hookFailedOf, modeOf, denialsOf } = require('./stream-items');

// Returns an array of UI items for one parsed stream-json event.
function toItems(ev) {
  if (!ev || typeof ev !== 'object') return [];
  // Messages produced inside a subagent point at the Agent tool call that spawned it.
  const sub = ev.parent_tool_use_id ? { sub: true, parent: ev.parent_tool_use_id } : {};
  switch (ev.type) {
    case 'system':
      if (ev.subtype === 'init') {
        return [{
          kind: 'init', sessionId: ev.session_id, model: ev.model || null, cwd: ev.cwd || null,
          toolbox: {
            skills: strings(ev.skills), agents: strings(ev.agents), slash_commands: strings(ev.slash_commands),
            mcp_servers: Array.isArray(ev.mcp_servers) ? ev.mcp_servers.filter(s => s && typeof s.name === 'string') : [],
            plugins: Array.isArray(ev.plugins) ? ev.plugins.filter(p => p && typeof p.name === 'string' && typeof p.path === 'string') : [],
          },
        }, ...modeOf(ev)];
      }
      if (/^task_(started|progress|updated|notification)$/.test(ev.subtype)) return [taskItem(ev)];
      // /compact, or Claude Code doing it by itself when the window is nearly full.
      if (ev.subtype === 'compact_boundary') {
        const m = ev.compact_metadata || {};
        return [{ kind: 'compacted', trigger: m.trigger === 'auto' ? 'auto' : 'manual', preTokens: Number.isFinite(m.pre_tokens) ? m.pre_tokens : null }];
      }
      if (ev.subtype === 'status') return [...compactingOf(ev), ...modeOf(ev)];
      if (ev.subtype === 'api_retry') return retryOf(ev);
      if (ev.subtype === 'hook_started' || ev.subtype === 'hook_progress') return hookRunningOf(ev);
      if (ev.subtype === 'hook_response') return hookFailedOf(ev);
      if (MOD_UI[ev.subtype]) return modItem(ev);
      // The API's safety check stopped the reply (stop_reason "refusal") and no
      // fallback model retried it. The panel can offer your local model instead.
      if (ev.subtype === 'model_refusal_no_fallback') return [{ kind: 'refusal', category: oneLine(ev.api_refusal_category, 40) || null }];
      // Every command the conversation has now, with what each one does: how a
      // command a mod registers after the session started becomes known.
      if (ev.subtype === 'commands_changed') {
        const commands = (Array.isArray(ev.commands) ? ev.commands : []).slice(0, MAX_COMMANDS)
          .filter(c => c && typeof c.name === 'string' && COMMAND_NAME.test(c.name))
          .map(c => ({ name: c.name, description: oneLine(c.description, 300) }));
        return [{ kind: 'commands', commands }];
      }
      return [];
    case 'assistant': {
      const out = [];
      // Claude Code's own notes come as replies of its own making, not the model's.
      const own = ev.message?.model === '<synthetic>' && !ev.parent_tool_use_id;
      for (const b of ev.message?.content || []) {
        const goal = own && b.type === 'text' ? goalOf(b.text) : null;
        if (goal) out.push(goal);
        // /context's table becomes a bar of what fills the window (native-more.js), the table folded under it.
        const usage = own && b.type === 'text' ? contextUsageOf(b.text) : null;
        if (usage) out.push(usage);
        else if (b.type === 'text' && b.text?.trim()) out.push({ kind: 'text', text: b.text.trim(), ...sub });
        // Its text, when Claude Code passes it on: it often sends the block empty, signature only.
        else if (b.type === 'thinking') out.push({ kind: 'thinking', ...(b.thinking?.trim() ? { text: b.thinking.trim() } : {}), ...sub });
        else if (b.type === 'tool_use') out.push(toolItem(b, sub));
      }
      return out;
    }
    case 'user': {
      const content = ev.message?.content;
      if (!Array.isArray(content)) return [];
      return content.filter(b => b.type === 'tool_result').map(b => {
        const full = resultText(b.content);
        /**
         * @type {{ kind: string, id: unknown, isError: boolean, text: string, chars: number, sub?: boolean, parent?: unknown,
         *   tail?: string, images?: ReturnType<typeof resultImages>, todoId?: string, outputFile?: string,
         *   worktree?: ReturnType<typeof worktreeOf>, workflowLaunch?: ReturnType<typeof workflowLaunchOf>,
         *   agentStats?: { durationMs: unknown, tokens: unknown, toolUses: unknown } }}
         */
        const item = {
          kind: 'tool_result', id: b.tool_use_id, isError: !!b.is_error,
          text: truncate(full, MAX_RESULT_CHARS), chars: full.length, ...sub,
        };
        // Test runners print their failures last: main reads the end of a
        // long result for the flaky test detective (flaky/index.js), then drops it.
        if (full.length > MAX_RESULT_CHARS) item.tail = full.slice(-MAX_RESULT_CHARS);
        // Pictures are saved apart and named on the item instead (sessions.js).
        const images = resultImages(b.content);
        if (images.length) item.images = images;
        // TaskCreate's result names the new to-do's id.
        const todoId = item.isError ? null : todoIdOf(ev, full);
        if (todoId) item.todoId = todoId;
        // A command sent to the background says where its output is going.
        const out = /^Command running in background with ID: [\w-]+\. Output is being written to: (.+?\.output)\./.exec(full);
        if (out) item.outputFile = out[1];
        // Subagent results carry run stats alongside the text.
        const r = ev.tool_use_result;
        // Claude moving itself into a worktree of its own (EnterWorktree), or back out (ExitWorktree).
        const wt = item.isError ? null : worktreeOf(r);
        if (wt) item.worktree = wt;
        // An ultracode run going off in the background (the Workflow tool).
        const launch = workflowLaunchOf(r);
        if (launch) item.workflowLaunch = launch;
        if (r && typeof r === 'object' && r.agentId) {
          item.agentStats = { durationMs: r.totalDurationMs ?? null, tokens: r.totalTokens ?? null, toolUses: r.totalToolUseCount ?? null };
        }
        return item;
      });
    }
    case 'result': {
      // A command print mode can't run ends the turn with only this: say so plainly.
      const said = headlessReply(ev.result) || headlessReply((ev.errors || []).join('\n'));
      const denials = denialsOf(ev.permission_denials);
      return [...(said ? [{ kind: 'text', text: said }] : []), {
        kind: 'result', ok: !ev.is_error, subtype: ev.subtype || null,
        // The last reply ended in a refusal (the API's safety check, not Claude's own words).
        ...(ev.stop_reason === 'refusal' ? { refused: true } : {}),
        durationMs: ev.duration_ms ?? null, turns: ev.num_turns ?? null,
        error: ev.is_error ? (ev.result || (ev.errors || []).join('\n') || null) : null,
        sessionId: ev.session_id || null,
        // What the whole turn used, for the per-turn ledger (usage/ledger.js).
        tokens: tokensOf(ev.usage),
        costUsd: Number.isFinite(ev.total_cost_usd) ? ev.total_cost_usd : null,
        // How much of what Claude wrote was thinking (turncost.js shows it beside the effort).
        thinkingTokens: Number.isFinite(ev.usage?.output_tokens_details?.thinking_tokens) ? ev.usage.output_tokens_details.thinking_tokens : null,
        // Every tool call the turn was refused (you, a rule or a hook), when there were any.
        ...(denials.length ? { denials } : {}),
      }];
    }
    case 'rate_limit_event':
      return [usageFrom(ev)];
    case 'stream_event':
      return partialOf(ev);
    case 'prompt_suggestion':
      return nextPromptOf(ev);
    case 'control_request':
      if (ev.request?.subtype === 'can_use_tool') {
        const r = ev.request;
        return [{
          kind: 'permission', requestId: ev.request_id, toolName: r.tool_name, toolUseId: r.tool_use_id,
          agentId: r.agent_id || null, filePath: writtenPath(r.tool_name, r.input), edits: editsOf(r.tool_name, r.input),
          input: r.input, description: r.description || null,
          suggestions: Array.isArray(r.permission_suggestions) ? r.permission_suggestions : [],
          ...describeTool(r.tool_name, r.input),
          plan: r.tool_name === 'ExitPlanMode' ? r.input?.plan : undefined,
          questions: r.tool_name === 'AskUserQuestion' ? questionsOf(r.input) : undefined,
        }];
      }
      return [];
    default:
      return [];
  }
}

// The events Shellby knows, including the ones it reads past on purpose. Anything
// else is new from Claude Code: session/ logs it once, and the nightly CLI
// check (cli-contract.js, scripts/cli-compat.js) flags it before a user meets it.
const KNOWN = Object.freeze({
  // control_response is read by session/ (answers to Shellby's own requests).
  // stream_event: the reply as it's written (only its words become items); prompt_suggestion: what you might ask next.
  types: new Set(['system', 'assistant', 'user', 'result', 'rate_limit_event', 'control_request', 'control_response', 'stream_event', 'prompt_suggestion']),
  // init, task_*, compact_boundary, a compacting or mode status, api_retry, hook_started, hook_progress,
  // hook_response, a mod's ui_* and commands_changed become items; the rest is progress chatter.
  system: new Set(['init', 'task_started', 'task_progress', 'task_updated', 'task_notification', 'compact_boundary',
    'ui_log', 'ui_toast', 'ui_status', 'commands_changed',
    'hook_started', 'hook_progress', 'hook_response', 'status', 'api_retry', 'thinking_tokens',
    // The conversation's name (--name) taken: Shellby set it, so there's nothing to show.
    'session_title_changed',
    // The whole list of what runs in the background: task_* says the same a task at a time.
    'background_tasks_changed']),
  // can_use_tool becomes a permission card; hook_callback is answered by session/.
  control: new Set(['can_use_tool', 'hook_callback']),
});

// Line-oriented parser: feed raw stdout lines, get items back.
function parseLine(line) {
  const t = line.trim();
  if (!t) return { event: null, items: [] };
  let ev;
  try { ev = JSON.parse(t); } catch { return { event: null, items: [{ kind: 'log', text: t }] }; }
  return { event: ev, items: toItems(ev) };
}
module.exports = { workflowOf, workflowLaunchOf, worktreeOf, findingsOf, questionsOf, todoOf, todoIdOf, goalOf, contextUsageOf, tokenCount, cronWords, inWords, toItems, parseLine, describeTool, resultText, resultImages, truncate, usageFrom, spendFrom, writtenPath, writeChars, WRITE_TOOLS, AGENT_TOOLS, KNOWN };
