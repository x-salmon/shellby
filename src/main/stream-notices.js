// What Claude Code says about itself, as items (stream.js toItems): helper tasks
// and workflow runs, a mod's lines, /goal, /context, compacting, a retry, hooks,
// the permission mode and the turn's refusals. Pure: no Electron, no I/O.

const { clean } = require('./mods');
const { truncate, describeTool } = require('./stream-tools');

// task_* system events describe subagent lifecycles. task_id is the id that
// permission requests from that subagent carry as agent_id; tool_use_id is the
// Agent tool call it belongs to (= parent_tool_use_id of its messages).
function taskItem(ev) {
  const phase = { task_started: 'started', task_progress: 'progress', task_updated: 'updated', task_notification: 'done' }[ev.subtype];
  const u = ev.usage || {};
  const item = { kind: 'task', phase, taskId: ev.task_id || null, toolUseId: ev.tool_use_id || null };
  if (ev.description) item.description = String(ev.description).slice(0, 200);
  if (ev.subagent_type) item.subagentType = ev.subagent_type;
  // local_agent is a helper; local_bash a command or a Monitor left running in the background.
  if (typeof ev.task_type === 'string') item.taskType = ev.task_type.slice(0, 40);
  if (phase === 'started') { item.background = !!ev.is_backgrounded; item.depth = ev.spawn_depth ?? 1; }
  if (ev.last_tool_name) item.lastTool = ev.last_tool_name;
  if (ev.usage) item.usage = { tokens: u.total_tokens ?? null, toolUses: u.tool_uses ?? null, durationMs: u.duration_ms ?? null };
  const status = ev.status ?? ev.patch?.status;
  if (status) item.status = status;
  if (ev.summary) item.summary = truncate(ev.summary, 4000);
  // An ultracode run (task_type 'local_workflow'): its script's meta.name, and on
  // task_progress the run's phases and agents so far (ultracode.js).
  if (typeof ev.workflow_name === 'string' && ev.workflow_name.trim()) item.workflowName = clean(ev.workflow_name, 120);
  if (Array.isArray(ev.workflow_progress)) item.workflow = workflowOf(ev.workflow_progress);
  return item;
}

// The phases and agents a task_progress carries for a workflow run, checked
// against Claude Code 2.1.299: a snapshot of every phase and agent so far
// (workflow_log lines are left out), sent at most every few seconds.
//   { type: 'workflow_phase', index, title }
//   { type: 'workflow_agent', index, label, phaseIndex, phaseTitle, agentType?, model?,
//     state: 'start' | 'progress' | 'done' | 'error', tokens?, toolCalls?, error? }
const MAX_WORKFLOW_ENTRIES = 400;
const AGENT_STATES = new Set(['start', 'progress', 'done', 'error']);
const count = v => (Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
function workflowOf(list) {
  const phases = [], agents = [];
  for (const e of list.slice(0, MAX_WORKFLOW_ENTRIES)) {
    if (!e || typeof e !== 'object' || !Number.isInteger(e.index) || e.index < 0) continue;
    if (e.type === 'workflow_phase') phases.push({ index: e.index, title: clean(e.title, 120) || `Phase ${e.index + 1}` });
    else if (e.type === 'workflow_agent') {
      agents.push({
        index: e.index,
        label: clean(e.label, 160) || `Agent ${e.index}`,
        phase: Number.isInteger(e.phaseIndex) ? e.phaseIndex : null,
        state: AGENT_STATES.has(e.state) ? e.state : 'start',
        type: clean(e.agentType, 80) || null,
        model: clean(e.model, 80) || null,
        tokens: count(e.tokens),
        tools: count(e.toolCalls),
        ...(e.state === 'error' && e.error ? { error: clean(e.error, 200) } : {}),
      });
    }
  }
  return { phases, agents };
}

// The Workflow tool's own result (tool_use_result): which task the run is, the
// run id Claude resumes it by, and the script's name. A syntax error says so.
function workflowLaunchOf(r) {
  if (!r || typeof r !== 'object' || typeof r.taskId !== 'string') return null;
  if (r.taskType !== 'local_workflow' && !(typeof r.runId === 'string' && r.status === 'async_launched')) return null;
  return {
    taskId: r.taskId.slice(0, 120),
    runId: typeof r.runId === 'string' ? r.runId.slice(0, 120) : null,
    name: clean(r.workflowName, 120) || null,
    ...(typeof r.error === 'string' && r.error ? { error: clean(r.error, 300) } : {}),
  };
}

// What a mod shows (mods.js): $.ui.log is a line in the conversation, $.ui.toast
// a toast, $.ui.status its line under the box (empty clears it). Claude Code
// sends each with the plugin's name, which is shown with it, so a mod can't
// pass its words off as Claude's or Shellby's.
const MOD_UI = { ui_log: 'modlog', ui_toast: 'modtoast', ui_status: 'modstatus' };
const MAX_MOD_TEXT = 500;
const MAX_COMMANDS = 1000;
// What the / menu can show as a command: no spaces, no line breaks, nothing that hides.
const COMMAND_NAME = /^[\w:.-]{1,120}$/;
// One line: no control, bidi-override or zero-width characters (mods.js).
const oneLine = clean;

function modItem(ev) {
  const plugin = oneLine(ev.plugin, 80);
  if (!plugin) return [];
  const text = oneLine(ev.text, MAX_MOD_TEXT);
  const kind = MOD_UI[ev.subtype];
  if (kind === 'modstatus') return [{ kind, plugin, text: text || null }];
  if (!text) return [];
  if (kind === 'modtoast') return [{ kind, plugin, text, ms: Number.isFinite(ev.timeout_ms) ? Math.min(Math.max(ev.timeout_ms, 1500), 15000) : 4000 }];
  return [{ kind, plugin, text }];
}

// Every command the conversation has now, with what each one does: how a
// command a mod registers after the session started becomes known.
function commandsOf(ev) {
  const commands = (Array.isArray(ev.commands) ? ev.commands : []).slice(0, MAX_COMMANDS)
    .filter(c => c && typeof c.name === 'string' && COMMAND_NAME.test(c.name))
    .map(c => ({ name: c.name, description: oneLine(c.description, 300) }));
  return [{ kind: 'commands', commands }];
}

// Claude Code's own notes about a goal (/goal), as the synthetic replies it
// writes for them: set, cleared, or met. Checked against Claude Code 2.1.296.
const GOAL_TEXT = 500;
function goalOf(text) {
  const t = String(text || '').trim();
  const set = /^Goal set:\s*(.+)$/s.exec(t);
  if (set) return { kind: 'goal', text: set[1].replace(/\s+/g, ' ').trim().slice(0, GOAL_TEXT) };
  if (/^Goal cleared\b/.test(t)) return { kind: 'goal', text: null };
  if (/^Goal achieved\b/.test(t)) return { kind: 'goal', text: null, met: true };
  return null;
}

// /context's answer, a synthetic reply in Markdown: the total, then a table of
// what's using the window by category. Checked against Claude Code 2.1.310:
//   ## Context Usage / **Model:** m / **Tokens:** 23.6k / 1m (2%) /
//   ### Estimated usage by category / | System prompt | 2.5k | 0.3% | …
// The rest (MCP tools one by one, memory files, skills) stays in `text`.
const CONTEXT_TEXT = 20000;
const CONTEXT_CATEGORIES = 20;
const SCALE = { k: 1e3, m: 1e6 };
/** '2.5k' -> 2500, '1m' -> 1000000, '820' -> 820; null if it isn't one. */
function tokenCount(s) {
  const m = /^([\d.,]+)\s*([km])?$/i.exec(String(s).trim());
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * (SCALE[(m[2] || '').toLowerCase()] || 1)) : null;
}
function contextUsageOf(text) {
  const t = String(text || '');
  if (!/^## Context Usage\b/.test(t.trim())) return null;
  const total = /\*\*Tokens:\*\*\s*([\d.,]+[km]?)\s*\/\s*([\d.,]+[km]?)\s*\((\d+(?:\.\d+)?)%\)/i.exec(t);
  if (!total) return null;
  const model = /\*\*Model:\*\*\s*([^\s*]+)/.exec(t)?.[1] || null;
  // Only the first table: the one under "by category".
  const section = t.split(/^### /m).find(s => /^Estimated usage by category/i.test(s)) || '';
  const categories = section.split('\n')
    // A share too small to print comes as "<0.1%": kept, at the bound it names.
    .map(line => /^\|\s*([^|]+?)\s*\|\s*([\d.,]+[km]?)\s*\|\s*<?\s*(\d+(?:\.\d+)?)%\s*\|\s*$/i.exec(line))
    .filter(Boolean)
    .map((/** @type {RegExpExecArray} */ m) => ({ name: m[1].slice(0, 80), tokens: tokenCount(m[2]), pct: Number(m[3]) }))
    .filter(c => c.tokens !== null)
    .slice(0, CONTEXT_CATEGORIES);
  return {
    kind: 'context-usage', model, used: tokenCount(total[1]), window: tokenCount(total[2]), pct: Number(total[3]),
    categories, text: t.length > CONTEXT_TEXT ? `${t.slice(0, CONTEXT_TEXT)}\n\n…` : t,
  };
}

// A piece of the reply as Claude writes it (--include-partial-messages): only
// the main thread's words, which the panel shows until the whole block arrives.
function partialOf(ev) {
  const e = ev.event;
  if (ev.parent_tool_use_id || e?.type !== 'content_block_delta' || e.delta?.type !== 'text_delta') return [];
  if (typeof e.delta.text !== 'string' || !e.delta.text) return [];
  return [{ kind: 'partial', text: e.delta.text }];
}

// What Claude Code thinks you'll ask next (prompt suggestions), one line.
const SUGGESTION_TEXT = 300;
function nextPromptOf(ev) {
  const text = typeof ev.suggestion === 'string' ? ev.suggestion.replace(/\s+/g, ' ').trim().slice(0, SUGGESTION_TEXT) : '';
  return text ? [{ kind: 'next', text }] : [];
}

// Compacting as it happens: Claude Code says 'compacting' when it starts (and
// every 30 s after), then null with how it went. How much of the summary is
// written so far comes only with automatic ones, never a typed /compact.
// Checked against Claude Code 2.1.299.
function compactingOf(ev) {
  if (ev.parent_tool_use_id) return [];
  if (ev.status === 'compacting') {
    return [{ kind: 'compacting', on: true, chars: Number.isFinite(ev.compact_output_chars) ? ev.compact_output_chars : null }];
  }
  if (ev.compact_result) {
    return [{ kind: 'compacting', on: false, ok: ev.compact_result !== 'failed', error: oneLine(ev.compact_error, 300) || null }];
  }
  return [];
}

// The API refused or failed a request and Claude Code is trying it again, which
// otherwise looks like Shellby froze. Only the main thread's: a helper's retries
// show in its own lane soon enough.
const num = v => (Number.isFinite(v) ? v : null);
function retryOf(ev) {
  if (ev.parent_tool_use_id) return [];
  return [{
    kind: 'retrying', attempt: num(ev.attempt), max: num(ev.max_retries),
    delayMs: num(ev.retry_delay_ms), status: num(ev.error_status),
  }];
}

const hookName = ev => oneLine(ev.hook_name, 120) || oneLine(ev.hook_event, 120) || 'a hook';

// A hook running (hook_started, and hook_progress every few seconds while it
// prints): the working line names it, so a slow hook doesn't read as Claude
// stuck. Only the main thread's. Checked against Claude Code 2.1.303.
function hookRunningOf(ev) {
  if (ev.parent_tool_use_id) return [];
  return [{ kind: 'hook', on: true, name: hookName(ev) }];
}

// A hook done (hook_response): the working line goes back to Working…, and one
// that failed or was cancelled leaves a note too, since without it Claude only
// changes course with no reason shown.
function hookFailedOf(ev) {
  if (ev.parent_tool_use_id) return [];
  const done = { kind: 'hook', on: false, name: hookName(ev) };
  if (!ev.outcome || ev.outcome === 'success') return [done];
  return [done, {
    kind: 'hook-failed', name: hookName(ev),
    outcome: ev.outcome === 'cancelled' ? 'cancelled' : 'error', exitCode: num(ev.exit_code),
    text: oneLine(ev.stderr, 300) || oneLine(ev.output, 300) || null,
  }];
}

// Claude Code's permission modes, as Shellby names them (config.js CLI_MODE the
// other way). dontAsk has no Shellby mode, and anything new is left alone.
const SHELLBY_MODE = Object.freeze({ default: 'ask', auto: 'smart', acceptEdits: 'acceptEdits', plan: 'plan', bypassPermissions: 'autonomous' });

// The permission mode the conversation is in, from init and from the status
// Claude Code sends when it changes (an approved plan's "auto-accept edits", say),
// so the mode chip and planning follow. Checked against Claude Code 2.1.303.
function modeOf(ev) {
  if (ev.parent_tool_use_id) return [];
  const mode = SHELLBY_MODE[ev.permissionMode];
  return mode ? [{ kind: 'mode', mode }] : [];
}

// What the turn was refused: Claude Code's own record of every tool call denied,
// by you, a rule or a hook (result.permission_denials). [{ toolName, toolUseId, summary, target? }].
// target: the whole path, command or address it reached for, which the panel
// matches against your deny rules (feed-logic.js blockingRule).
const MAX_DENIALS = 20;
const MAX_TARGET = 1000;
function denialTarget(input) {
  const i = input && typeof input === 'object' ? input : {};
  const t = [i.file_path, i.notebook_path, i.command, i.url, i.path].find(v => typeof v === 'string' && v.trim());
  return t ? oneLine(t, MAX_TARGET) : '';
}
function denialsOf(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_DENIALS).filter(d => d && typeof d.tool_name === 'string').map(d => {
    const target = denialTarget(d.tool_input);
    return {
      toolName: d.tool_name, toolUseId: typeof d.tool_use_id === 'string' ? d.tool_use_id : null,
      summary: oneLine(describeTool(d.tool_name, d.tool_input).detail, 80),
      ...(target ? { target } : {}),
    };
  });
}

module.exports = { taskItem, workflowOf, workflowLaunchOf, MOD_UI, modItem, commandsOf, oneLine, goalOf, contextUsageOf, tokenCount, partialOf, nextPromptOf, compactingOf, retryOf, hookRunningOf, hookFailedOf, modeOf, denialsOf };
