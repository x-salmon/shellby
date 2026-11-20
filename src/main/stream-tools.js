// A tool call as the panel sees it (stream.js toolItem): its verb and detail in
// words, what it writes and where it reads, Claude's to-dos, a review's findings
// and a question's options. Pure: no Electron, no I/O (test/stream.test.js).

const { editsOf } = require('../renderer/shared/diff');
const plainWords = require('./plain-words');
const { toolFacts } = require('./turnwatch');

const TOOL_VERBS = {
  Bash: 'Ran', PowerShell: 'Ran', Read: 'Read', Write: 'Created', Edit: 'Edited',
  MultiEdit: 'Edited', NotebookEdit: 'Edited', Glob: 'Searched files', Grep: 'Searched for',
  WebFetch: 'Fetched', WebSearch: 'Searched the web', Task: 'Delegated', Agent: 'Delegated',
  TodoWrite: 'Updated plan', ExitPlanMode: 'Proposed a plan', Skill: 'Used skill',
  AskUserQuestion: 'Asked you', EnterPlanMode: 'Started planning',
  TaskCreate: 'Added a to-do', TaskUpdate: 'Updated a to-do', TaskList: 'Checked the to-dos', TaskGet: 'Read a to-do',
  TaskStop: 'Stopped a background task', TaskOutput: 'Checked a background task', Monitor: 'Watching',
  SendMessage: 'Messaged', RemoteTrigger: 'Cloud routines', ReportFindings: 'Reported findings',
  PushNotification: 'Notified you', EnterWorktree: 'Moved into a worktree', ExitWorktree: 'Left the worktree',
  ScheduleWakeup: 'Will pick this up again', CronCreate: 'Scheduled', CronDelete: 'Cancelled a schedule', CronList: 'Checked its schedules',
};

// When Claude comes back by itself (/loop's ScheduleWakeup, CronCreate), in
// words: "in 20 min", "every day at 09:00". A cron it can't word stays as it is.
const pad2 = n => String(n).padStart(2, '0');
function inWords(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 90) return `in ${s} s`;
  if (s < 3600) return `in ${Math.round(s / 60)} min`;
  const h = s / 3600;
  return `in ${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}
const CRON_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function cronWords(cron) {
  const f = String(cron || '').trim().split(/\s+/);
  if (f.length !== 5) return String(cron || '').slice(0, 60);
  const [min, hour, dom, mon, dow] = f;
  const isMin = v => /^\d{1,2}$/.test(v) && Number(v) < 60;
  const isHour = v => /^\d{1,2}$/.test(v) && Number(v) < 24;
  const every = /^\*\/(\d{1,2})$/.exec(min);
  if (every && Number(every[1]) > 0 && hour === '*' && dom === '*' && mon === '*' && dow === '*') return `every ${Number(every[1])} min`;
  if (isMin(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') return `every hour at :${pad2(min)}`;
  if (isMin(min) && isHour(hour) && dom === '*' && mon === '*') {
    const at = `${pad2(hour)}:${pad2(min)}`;
    if (dow === '*') return `every day at ${at}`;
    if (dow === '1-5') return `weekdays at ${at}`;
    if (/^[0-6]$/.test(dow)) return `${CRON_DAYS[Number(dow)]}s at ${at}`;
  }
  return `cron ${f.join(' ')}`;
}

// To-do statuses Claude Code uses (TaskUpdate, TodoWrite); 'deleted' drops one.
const TODO_STATUSES = new Set(['pending', 'in_progress', 'completed']);
const TODO_TEXT = 300;
const todoText = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, TODO_TEXT) : '');
const todoStatus = v => (TODO_STATUSES.has(v) ? v : v === 'deleted' ? 'deleted' : null);

/**
 * What a to-do tool call does to Claude's list, or null. TodoWrite replaces the
 * whole list; TaskCreate adds one (its id comes back in the result, see
 * todoIdOf); TaskUpdate changes one by id. Checked against Claude Code 2.1.293.
 */
function todoOf(name, input) {
  const i = input || {};
  if (name === 'TodoWrite' && Array.isArray(i.todos)) {
    return {
      op: 'set',
      items: i.todos.slice(0, 100).filter(t => t && todoText(t.content))
        .map(t => ({ subject: todoText(t.content), status: TODO_STATUSES.has(t.status) ? t.status : 'pending', activeForm: todoText(t.activeForm) })),
    };
  }
  if (name === 'TaskCreate' && todoText(i.subject)) return { op: 'create', subject: todoText(i.subject), activeForm: todoText(i.activeForm) };
  if (name === 'TaskUpdate' && (typeof i.taskId === 'string' || Number.isFinite(i.taskId))) {
    const t = { op: 'update', id: String(i.taskId).slice(0, 40) };
    const status = todoStatus(i.status);
    if (status) t.status = status;
    if (todoText(i.subject)) t.subject = todoText(i.subject);
    if (todoText(i.activeForm)) t.activeForm = todoText(i.activeForm);
    return t;
  }
  return null;
}

/** The id TaskCreate gave a new to-do: from its result's data, or its words ("Task #3 created…"). */
function todoIdOf(ev, text) {
  const id = ev?.tool_use_result?.task?.id;
  if (typeof id === 'string' || Number.isFinite(id)) return String(id).slice(0, 40);
  const m = /^Task #([\w-]{1,40}) created/.exec(text || '');
  return m ? m[1] : null;
}

const STATUS_WORDS = { pending: 'to do', in_progress: 'started', completed: 'done', deleted: 'dropped' };

// The crab's own tools, as served to Shellby's conversations (crabmcp.js):
// verb, and which input field is worth showing.
const SHELLBY_TOOLS = {
  say: ['Shellby said', 'text'], celebrate: ['Celebrated', 'reason'], wear: ['Dressed Shellby', 'item'],
  status: ['Checked on Shellby', null], suggest: ['Suggested', 'feature'], note: ['Noted', 'text'],
};

/**
 * Claude's AskUserQuestion input, cleaned up for the question card:
 * [{ question, header, multiSelect, options: [{ label, description }] }]
 */
function questionsOf(input) {
  const list = Array.isArray(input?.questions) ? input.questions : [];
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  return list.slice(0, 6).filter(q => q && typeof q.question === 'string' && q.question.trim()).map(q => ({
    question: str(q.question, 500),
    header: str(q.header, 40),
    multiSelect: !!q.multiSelect,
    options: (Array.isArray(q.options) ? q.options : []).slice(0, 8)
      .filter(o => o && typeof o.label === 'string' && o.label.trim())
      .map(o => ({ label: str(o.label, 120), description: str(o.description, 300) })),
  }));
}

function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n) + `\n… (${s.length - n} more characters)` : s;
}

function describeTool(name = '', input = {}) {
  const i = input || {};
  if (name === 'AskUserQuestion') {
    const qs = questionsOf(i);
    return { label: TOOL_VERBS.AskUserQuestion, detail: qs.map(q => q.question).join(' · ').slice(0, 400) || 'a question' };
  }
  if (name === 'TodoWrite') {
    const n = Array.isArray(i.todos) ? i.todos.length : 0;
    return { label: TOOL_VERBS.TodoWrite, detail: `${n} to-do${n === 1 ? '' : 's'}` };
  }
  if (name === 'TaskUpdate' && i.taskId != null) {
    const what = [todoText(i.subject), STATUS_WORDS[i.status]].filter(Boolean).join(' → ');
    return { label: TOOL_VERBS.TaskUpdate, detail: `#${String(i.taskId).slice(0, 40)}${what ? ` ${what}` : ''}` };
  }
  if (name === 'TaskCreate') return { label: TOOL_VERBS.TaskCreate, detail: todoText(i.subject) };
  if (name === 'SendMessage') {
    const to = todoText(i.to ?? i.recipient);
    const text = todoText(i.message ?? i.content ?? i.summary);
    return { label: TOOL_VERBS.SendMessage, detail: [to, text].filter(Boolean).join(': ') };
  }
  const own = /^mcp__shellby__(\w+)$/.exec(name);
  if (own && SHELLBY_TOOLS[own[1]]) {
    const [label, field] = SHELLBY_TOOLS[own[1]];
    return { label, detail: field && typeof i[field] === 'string' ? i[field].replace(/\s+/g, ' ').trim().slice(0, 400) : '' };
  }
  if (name === 'ReportFindings') {
    const n = Array.isArray(i.findings) ? i.findings.length : 0;
    return { label: TOOL_VERBS.ReportFindings, detail: n === 1 ? '1 finding' : `${n} findings` };
  }
  if (name === 'PushNotification') return { label: TOOL_VERBS.PushNotification, detail: String(i.message ?? '').replace(/\s+/g, ' ').trim().slice(0, 400) };
  if (name === 'EnterWorktree') return { label: TOOL_VERBS.EnterWorktree, detail: typeof i.name === 'string' ? i.name.slice(0, 120) : '' };
  if (name === 'ExitWorktree') return { label: TOOL_VERBS.ExitWorktree, detail: i.action === 'remove' ? 'and removed it' : '' };
  if (name === 'ScheduleWakeup') {
    if (i.stop) return { label: 'Ended the loop', detail: '' };
    return { label: TOOL_VERBS.ScheduleWakeup, detail: [inWords(i.delaySeconds), todoText(i.reason)].filter(Boolean).join(': ') };
  }
  if (name === 'CronCreate') {
    const when = `${cronWords(i.cron)}${i.recurring === false ? ', once' : ''}${i.durable ? ', kept across restarts' : ''}`;
    return { label: TOOL_VERBS.CronCreate, detail: [when, todoText(i.prompt)].filter(Boolean).join(': ') };
  }
  if (name === 'CronDelete') return { label: TOOL_VERBS.CronDelete, detail: todoText(i.id) };
  let detail =
    i.command ?? i.file_path ?? i.notebook_path ??
    (i.pattern != null ? `${i.pattern}${i.path ? ` in ${i.path}` : ''}` : null) ??
    i.path ?? i.url ?? i.query ?? i.description ?? i.skill ?? i.prompt ?? null;
  if (detail == null) {
    const json = JSON.stringify(i);
    detail = json === '{}' ? '' : json;
  }
  const mcp = name.match(/^mcp__(.+?)__(.+)$/);
  const label = TOOL_VERBS[name] || (mcp ? `${mcp[2]} (${mcp[1]})` : name);
  return { label, detail: String(detail).replace(/\s+/g, ' ').trim().slice(0, 400) };
}

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const AGENT_TOOLS = new Set(['Agent', 'Task']);
// The Agent tool's isolation and effort values (Claude Code 2.1.303).
const AGENT_ISOLATION = new Set(['worktree', 'remote']);
const AGENT_EFFORT = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

function writtenPath(name, input) {
  if (!WRITE_TOOLS.has(name) || !input) return null;
  const p = input.file_path ?? input.notebook_path;
  return typeof p === 'string' ? p : null;
}

/**
 * A read's file and the lines it asked for, or a search's folder and pattern.
 * -> { path, lines?: [from, to] } | { path?, pattern, mode? } | null
 */
const TARGET_PATH = 1000;
function targetOf(name, input) {
  if (!input || typeof input !== 'object') return null;
  const str = v => (typeof v === 'string' && v.trim() ? v.slice(0, TARGET_PATH) : null);
  if (name === 'Read' || name === 'NotebookRead') {
    const path = str(input.file_path ?? input.notebook_path);
    if (!path) return null;
    const from = Number.isInteger(input.offset) && input.offset > 0 ? input.offset : 1;
    const many = Number.isInteger(input.limit) && input.limit > 0 ? input.limit : null;
    return { path, ...(many || from > 1 ? { lines: [from, many ? from + many - 1 : null] } : {}) };
  }
  if (name === 'Grep' || name === 'Glob') {
    const pattern = str(input.pattern);
    if (!pattern) return null;
    const path = str(input.path);
    // How Grep lists what it found: its content lines have the path first, or none (one file).
    const mode = name === 'Grep' && ['content', 'count', 'files_with_matches'].includes(input.output_mode) ? input.output_mode : null;
    return { pattern: pattern.slice(0, 200), ...(path ? { path } : {}), ...(mode ? { mode } : {}) };
  }
  return null;
}

/** How much text a write tool is about to put on disk (0 for anything else). */
function writeChars(name, input) {
  if (!WRITE_TOOLS.has(name) || !input) return 0;
  if (name === 'MultiEdit') {
    const edits = Array.isArray(input.edits) ? input.edits : [];
    return edits.reduce((n, e) => n + String(e?.new_string ?? '').length, 0);
  }
  const text = input.content ?? input.new_string ?? input.new_source;
  return typeof text === 'string' ? text.length : 0;
}

const MAX_FINDINGS = 32;
const FINDING_TEXT = 1200;

// A code review's findings (ReportFindings): { level, list: [{ file, line,
// summary, short, scenario, verdict, category }] }, or null when there are none.
function findingsOf(input) {
  if (!Array.isArray(input?.findings)) return null;
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const list = input.findings.filter(x => x && typeof x === 'object').slice(0, MAX_FINDINGS).map(x => ({
    file: str(x.file, 500),
    line: Number.isInteger(x.line) && x.line > 0 ? x.line : null,
    summary: str(x.summary, FINDING_TEXT),
    short: str(x.short_summary, 120),
    scenario: str(x.failure_scenario, FINDING_TEXT),
    verdict: /^(CONFIRMED|PLAUSIBLE)$/.test(x.verdict) ? x.verdict : null,
    category: str(x.category, 40),
  })).filter(x => x.summary || x.short);
  return { level: str(input.level, 12), list };
}

// Where EnterWorktree put the session ({ entered, branch }), or where
// ExitWorktree took it back to ({ left, removed }); null for anything else.
function worktreeOf(r) {
  if (!r || typeof r !== 'object') return null;
  if (typeof r.restoredCwd === 'string' && r.restoredCwd) return { left: r.restoredCwd, removed: r.action === 'remove' };
  if (typeof r.worktreePath === 'string' && r.worktreePath && typeof r.worktreeBranch === 'string') return { entered: r.worktreePath, branch: r.worktreeBranch.slice(0, 200) };
  return null;
}

function toolItem(b, sub) {
  const input = b.input || {};
  // What the turn's notes need from its input (turnwatch.js): a whole-file read, a helper's brief, a commit.
  const item = { kind: 'tool', id: b.id, name: b.name, ...describeTool(b.name, input), ...toolFacts(b.name, input), ...sub };
  if (b.name === 'ExitPlanMode') item.plan = input.plan;
  if (b.name === 'ReportFindings') {
    const findings = findingsOf(input);
    if (findings) item.findings = findings;
  }
  const todo = todoOf(b.name, input);
  if (todo) item.todo = todo;
  // A skill Claude reached for by itself: which one (feed.js says what it's for).
  if (b.name === 'Skill' && typeof input.skill === 'string') item.skill = input.skill.slice(0, 200);
  // One agent writing to another (SendMessage): who to, and what it said.
  if (b.name === 'SendMessage') {
    const to = input.to ?? input.recipient;
    const text = input.message ?? input.content;
    if (typeof to === 'string' && to) item.message = { to: to.slice(0, 120), text: typeof text === 'string' ? text.slice(0, 2000) : '', summary: todoText(input.summary) };
  }
  // What it's doing, in plain words, for the Working bar (plain-words.js).
  const plain = plainWords.describe(b.name, input);
  if (plain) item.doing = plain.doing;
  // Its result only says it started: not a finished run (flaky/index.js).
  if ((b.name === 'Bash' || b.name === 'PowerShell') && input.run_in_background === true) item.background = true;
  const fp = writtenPath(b.name, input);
  if (fp) { item.filePath = fp; item.writeChars = writeChars(b.name, input); item.edits = editsOf(b.name, input); }
  // Where a read or a search went, whole: the detail is cut short and flattened (the trail, shared/trail.js).
  const target = targetOf(b.name, input);
  if (target) item.target = target;
  if (AGENT_TOOLS.has(b.name)) {
    item.agent = {
      type: typeof input.subagent_type === 'string' ? input.subagent_type : 'general-purpose',
      description: typeof input.description === 'string' ? input.description : '',
      background: !!input.run_in_background,
    };
    // The name other agents write to it by (SendMessage { to }).
    if (typeof input.name === 'string' && input.name.trim()) item.agent.name = input.name.trim().slice(0, 80);
    // A fork carries on with the whole conversation and Claude's own model, not a fresh specialist.
    if (item.agent.type === 'fork') item.agent.fork = true;
    // Where it works: its own copy of the repo, or a cloud session.
    if (AGENT_ISOLATION.has(input.isolation)) item.agent.isolation = input.isolation;
    // A model or effort Claude picked for it (forks always use Claude's own).
    if (typeof input.model === 'string' && input.model.trim() && !item.agent.fork) item.agent.model = input.model.trim().slice(0, 40);
    if (AGENT_EFFORT.has(input.effort)) item.agent.effort = input.effort;
  }
  return item;
}

module.exports = { TOOL_VERBS, inWords, cronWords, todoOf, todoIdOf, todoText, questionsOf, truncate, describeTool, WRITE_TOOLS, AGENT_TOOLS, writtenPath, targetOf, writeChars, findingsOf, worktreeOf, toolItem };
