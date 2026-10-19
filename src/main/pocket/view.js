// What the phone is told (Shellby on your phone, pocket/server.js).
//
// The panel gets everything main knows; the phone gets a smaller, flatter copy
// made here: the conversations in the panel's own order, the prompts waiting
// on you, the crab, the usage window and the reset queue. A conversation the
// phone has open also gets its transcript, item by item, cut down to what a
// phone screen shows (phoneItem).
//
// Everything is clipped, and nothing here is a path the phone could hand back:
// a diff, an undo or a bring-home names a conversation and a turn, and main
// finds the rest itself (wiring/pocket.js).
//
// Pure: wiring/pocket.js gathers the inputs.
const path = require('path');
const { standing } = require('../../renderer/panel/tab-sort');
const { appDeskOnlyReason } = require('../channels/replies');

const VERSION = 1;
const MAX_TABS = 40;
const MAX_ITEMS = 300;          // a transcript's tail, when the phone opens it
const MAX_TEXT = 8000;          // Claude's reply, per item
const MAX_FILES = 60;
const MAX_PROJECTS = 60;
const MAX_QUESTIONS = 4;
const MAX_PLAN = 30000;
const STANDINGS = ['asking', 'review', 'finished', 'working', 'quiet'];

const clip = (s, n) => {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
// One line: no control characters, runs of space squeezed.
const line = (s, n) => clip(String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim(), n);
const num = v => (Number.isFinite(v) ? v : null);
const base = p => (typeof p === 'string' && p ? path.win32.basename(p) : '');

/** One conversation, for the beach and its header. */
function phoneTab(t, extra = {}) {
  const ready = t.ready && !t.ready.reviewed ? {
    after: line(t.ready.after, 80), files: num(t.ready.files) || 0, added: num(t.ready.added) || 0, removed: num(t.ready.removed) || 0,
    at: num(t.ready.at), paths: (t.ready.paths || []).slice(0, 5).map(p => line(p, 160)),
  } : null;
  return {
    id: t.id,
    title: line(t.title, 120) || 'Untitled',
    folder: line(base(t.worktree?.originalCwd || t.cwd), 80),
    standing: standing(t),
    busy: !!t.busy, busySince: num(t.busySince), pending: t.pending || 0, crew: t.crew || 0,
    outcome: t.outcome || null, unread: !!t.unread,
    copy: t.worktree ? { branch: line(t.worktree.branch, 120), base: line(t.worktree.base, 120) } : null,
    ready,
    checks: t.checks ? { status: line(t.checks.status, 20), after: line(t.checks.after, 80) } : null,
    todos: t.todos ? { total: t.todos.total || 0, done: t.todos.done || 0, current: line(t.todos.current, 140) || null } : null,
    tokens: num(t.turnTokens),
    planning: !!t.planning,
    mode: extra.mode || null,
    fromPhone: !!extra.fromPhone,
    canReply: !!extra.canReply,
    effort: typeof extra.effort === 'string' ? line(extra.effort, 10) : '',
    // Replies typed on the phone while he worked, waiting for the turn to end (pocket/talk.js).
    queued: Array.isArray(extra.queued) ? extra.queued.slice(0, 5) : [],
  };
}

/** The file a prompt is about, and what it does to it: the phone shows the edit before you say yes. */
function preview(p) {
  const i = p.input && typeof p.input === 'object' ? p.input : {};
  if (typeof i.command === 'string') return { kind: 'command', command: clip(i.command, 2000) };
  if (p.toolName === 'Edit' && typeof i.file_path === 'string') {
    return { kind: 'edit', file: line(i.file_path, 300), old: clip(i.old_string, 1500), new: clip(i.new_string, 1500) };
  }
  if (p.toolName === 'MultiEdit' && Array.isArray(i.edits)) {
    return { kind: 'edit', file: line(i.file_path, 300), old: clip(i.edits[0]?.old_string, 1500), new: clip(i.edits[0]?.new_string, 1500), more: Math.max(0, i.edits.length - 1) };
  }
  if (p.toolName === 'Write' && typeof i.file_path === 'string') return { kind: 'write', file: line(i.file_path, 300), content: clip(i.content, 1500) };
  if (typeof i.url === 'string') return { kind: 'url', url: line(i.url, 500) };
  return null;
}

/** Claude's questions, options and all, as the desk's question card shows them. */
function phoneQuestions(p) {
  if (p.toolName !== 'AskUserQuestion' || !Array.isArray(p.input?.questions)) return null;
  return p.input.questions.slice(0, MAX_QUESTIONS).map(q => ({
    question: clip(q?.question, 500),
    header: line(q?.header, 40) || null,
    multiSelect: !!q?.multiSelect,
    options: (Array.isArray(q?.options) ? q.options : []).slice(0, 8).map(o => ({ label: clip(o?.label, 200), description: line(o?.description, 300) || null })),
  }));
}

/** The desk's "always" button for Claude Code's first suggestion (panel/feed-logic.js suggestionLabel), or null. */
function alwaysLabel(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.type === 'setMode') return s.mode === 'acceptEdits' ? 'Allow all edits' : `Switch to ${line(s.mode, 20)}`;
  const r = s.type === 'addRules' ? s.rules?.[0] : null;
  if (r) return line(r.ruleContent ? `Always allow ${r.toolName}(${r.ruleContent.length > 24 ? r.ruleContent.slice(0, 22) + '…' : r.ruleContent})` : `Always allow ${r.toolName}`, 60);
  if (s.type === 'addDirectories') return 'Always allow this folder';
  return 'Always allow';
}

/** A permission prompt waiting on you. deskOnly: why the phone may only look (channels/replies.js). */
function phonePrompt(p, titleOf) {
  const deskOnly = appDeskOnlyReason(p);
  const suggestion = Array.isArray(p.suggestions) ? p.suggestions[0] : null;
  return {
    tabId: p.tabId,
    requestId: line(p.requestId, 100),
    title: line(titleOf(p.tabId), 120) || 'Untitled',
    toolName: line(p.toolName, 60),
    label: line(p.label, 120),
    detail: line(p.detail, 400),
    ask: line(p.plain?.ask, 200) || null,
    warnings: (p.warnings || []).slice(0, 4).map(w => line(w, 140)),
    helper: p.agent ? line(p.agent.description || p.agent.type, 80) : null,
    preview: preview(p),
    question: p.toolName === 'AskUserQuestion' ? line(p.questions?.[0]?.question, 300) : null,
    plan: p.toolName === 'ExitPlanMode' ? line(p.planSummary, 120) || 'A plan' : null,
    questions: phoneQuestions(p),
    // The whole plan, to be read before it's approved (the phone keeps Approve shut until you reach the end).
    planText: p.toolName === 'ExitPlanMode' ? clip(p.plan ?? p.input?.plan, MAX_PLAN) || null : null,
    deskOnly,
    // Questions and plans are answered on their own sheets: no always-allow there.
    always: deskOnly || ['AskUserQuestion', 'ExitPlanMode'].includes(p.toolName) ? null : alwaysLabel(suggestion),
  };
}

/** The usage window, as the meter shows it. */
function phoneUsage(lastUsage, outlook, now) {
  const f = lastUsage?.fiveHour;
  const resetsAt = num(f?.resetsAt);
  return {
    pct: Number.isFinite(f?.pct) && (!resetsAt || resetsAt > now) ? Math.max(0, Math.min(100, Math.round(f.pct))) : null,
    resetsAt: resetsAt && resetsAt > now ? resetsAt : null,
    limit: outlook?.limit ? { name: line(outlook.limit.name, 40), resetsAt: num(outlook.limit.resetsAt), at: line(outlook.limit.at, 20) } : null,
    warning: outlook?.warning ? line(outlook.warning.text, 200) : null,
  };
}

/**
 * The rest of the Usage screen: the weekly window, the pace, and what the
 * spending guard keeps back of the 5-hour one (guard.js settingsOf).
 */
function usageDetail(lastUsage, outlook, guard, now) {
  const s = lastUsage?.sevenDay;
  const weekResets = num(s?.resetsAt);
  const live = weekResets == null || weekResets > now;
  const pace = outlook?.pace;
  return {
    weekPct: live && Number.isFinite(s?.pct) ? Math.max(0, Math.min(100, Math.round(s.pct))) : null,
    weekResetsAt: live ? weekResets : null,
    pace: pace && Number.isFinite(pace.pct) ? { perHour: num(pace.perHour), hitText: line(pace.hitText, 60) || null, warn: !!pace.warn } : null,
    guard: guard?.on ? { reserve: num(guard.reserve) || 0, ceiling: 100 - (num(guard.reserve) || 0) } : null,
    readAt: num(lastUsage?.at),
  };
}

/** Guard my focus, as the phone shows it and starts it. */
function phoneFocus(f, now) {
  if (!f?.phase || !num(f.endsAt) || f.endsAt <= now) return { phase: null, endsAt: null, minutes: null };
  return { phase: f.phase === 'break' ? 'break' : 'focus', endsAt: f.endsAt, minutes: num(f.minutes) };
}

function phoneHeld(h) {
  if (h.kind === 'routine') return { id: h.id, kind: 'routine', name: line(h.name, 120), atText: line(h.atText, 20) };
  if (h.kind === 'message') return { id: h.id, kind: 'message', name: line(h.text, 120), atText: line(h.atText, 20) };
  return { id: h.id, kind: 'task', name: line(h.name || h.prompt, 120), folder: line(h.folder, 80), atText: line(h.atText, 20), running: !!h.running };
}

/**
 * The whole phone view.
 *   tabs:     sessions.js summary
 *   prompts:  waiting prompts, oldest first, each with its tabId
 *   crab:     { state, work, say, crew: [{ label, type }] }
 *   extras:   tabId -> { mode, fromPhone, canReply }
 *   outlook:  usage/service.js outlookView()
 *   lastUsage, held (heldViews), projects ([{ key, name }]), skin, limits, pushKey
 */
/** @param {Record<string, any>} [input] */
function phoneView({ pc = '', tabs = [], prompts = [], crab = null, extras = {}, outlook = null, lastUsage = null, held = [], projects = [], skin = null, limits = null, pushKey = null, allow = null, focus = null, guard = null, now = Date.now() } = {}) {
  const titleOf = id => tabs.find(t => t.id === id)?.title;
  const order = id => STANDINGS.indexOf(id);
  const shown = tabs.slice(0, MAX_TABS).map(t => phoneTab(t, extras[t.id] || {}));
  // The panel's order: what's waiting on you first, then what's ready to look at.
  const sorted = shown.map((t, i) => ({ t, i })).sort((a, b) => (order(a.t.standing) - order(b.t.standing)) || (a.i - b.i)).map(x => x.t);
  return {
    v: VERSION,
    at: now,
    pc: line(pc, 80),
    crab: crab ? {
      state: line(crab.state, 20) || 'idle',
      work: crab.work ? line(crab.work, 20) : null,
      say: crab.say?.text ? line(crab.say.text, 60) : null,
      crew: (crab.crew || []).slice(0, 6).map(c => ({ label: line(c.label, 60), type: line(c.type, 40) })),
    } : { state: 'idle', work: null, say: null, crew: [] },
    tabs: sorted,
    prompts: prompts.slice(0, 20).map(p => phonePrompt(p, titleOf)),
    usage: { ...phoneUsage(lastUsage, outlook, now), ...usageDetail(lastUsage, outlook, guard, now) },
    focus: phoneFocus(focus, now),
    allow: allow ? { push: !!allow.push, files: !!allow.files } : { push: false, files: false },
    held: (held || []).slice(0, 20).map(phoneHeld),
    projects: (projects || []).slice(0, MAX_PROJECTS).map(p => ({ key: line(p.key, 600), name: line(p.name, 80) })),
    skin: skin || null,
    limits: limits || null,
    pushKey: typeof pushKey === 'string' ? pushKey : null, // the PC's VAPID key, for pushManager.subscribe
  };
}

/**
 * One transcript item, as the phone draws it, or null for what it doesn't show
 * (thinking, usage, the toolbox, mod chatter).
 */
function phoneItem(item) {
  if (!item || typeof item !== 'object') return null;
  const sub = item.sub ? { sub: true, parent: line(item.parent, 100) } : {};
  switch (item.kind) {
    case 'user': return { k: 'user', text: clip(item.text, 4000), turnId: line(item.turnId, 80) || null };
    case 'text': return { k: 'text', text: clip(item.text, MAX_TEXT), ...sub };
    case 'partial': return item.sub ? null : { k: 'partial', text: clip(item.text, MAX_TEXT) };
    case 'tool': {
      /** @type {Record<string, any>} */
      const out = { k: 'tool', id: line(item.id, 100), name: line(item.name, 60), label: line(item.label, 80), detail: line(item.detail, 300), ...sub };
      if (item.agent) out.agent = { type: line(item.agent.type, 60), description: line(item.agent.description, 160) };
      return out;
    }
    case 'tool_result': return { k: 'done', id: line(item.id, 100), error: !!item.isError, ...(item.isError ? { text: line(item.text, 300) } : {}), ...sub };
    case 'task': return {
      k: 'task', phase: line(item.phase, 20), taskId: line(item.taskId, 100), toolUseId: line(item.toolUseId, 100),
      description: line(item.description, 160), type: line(item.subagentType, 60), taskType: line(item.taskType, 30),
      status: line(item.status, 30), summary: line(item.summary, 300),
    };
    case 'permission': return { k: 'asked', requestId: line(item.requestId, 100), label: line(item.label, 80), detail: line(item.detail, 300), ...sub };
    case 'decision': return { k: 'decision', requestId: line(item.requestId, 100), decision: line(item.decision, 20), via: line(item.via, 20) || null };
    case 'result': return {
      k: 'end', ok: !!item.ok, interrupted: !!item.interrupted, error: item.ok ? null : line(item.trouble?.message || item.error, 300) || null,
      seconds: Number.isFinite(item.durationMs) ? Math.round(item.durationMs / 1000) : null, tokens: num(item.tokens),
      share: num(item.cost?.share), line: line(item.cost?.line, 120) || null,
    };
    case 'changes': return {
      k: 'changes', after: line(item.after, 80), turnId: line(item.turnId, 80) || null,
      added: num(item.added) || 0, removed: num(item.removed) || 0, more: num(item.more) || 0,
      files: (item.files || []).slice(0, MAX_FILES).map(f => ({ path: line(f.path, 300), status: line(f.status, 12), added: num(f.added) || 0, removed: num(f.removed) || 0, binary: !!f.binary })),
    };
    case 'undone': return { k: 'undone', after: line(item.after, 80) };
    case 'home': return { k: 'note', what: 'home', text: `Brought home to ${line(item.base, 80) || 'its branch'}${item.commits ? `, ${item.commits} commit${item.commits === 1 ? '' : 's'}` : ''}.` };
    case 'moved': return { k: 'note', what: 'moved', text: `In its own copy, on ${line(item.branch, 120)}.` };
    case 'phone': return { k: 'note', what: 'phone', text: 'Started from your phone.' };
    case 'pushed': return { k: 'note', what: 'pushed', text: 'Pushed.' };
    case 'checks': return { k: 'checks', status: line(item.status, 20), summary: line(item.summary || item.line, 200) || null, after: line(item.after, 80) || null };
    case 'error': return { k: 'note', what: 'error', text: line(item.trouble?.message || item.text, 300) };
    case 'compacted': return { k: 'note', what: 'compacted', text: 'Tidied the conversation up to make room.' };
    default: return null;
  }
}

/** A transcript's tail, as phone items. */
function phoneItems(items) {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    const p = phoneItem(it);
    // A partial is only ever on its way to being a text; the saved transcript has the text.
    if (p && p.k !== 'partial') out.push(p);
  }
  return out.slice(-MAX_ITEMS);
}

module.exports = { MAX_ITEMS, STANDINGS, VERSION, clip, line, phoneHeld, phoneItem, phoneItems, phonePrompt, phoneTab, phoneUsage, phoneView, preview };
