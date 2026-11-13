// The task board: where Shellby's own conversations hand each other work.
//
// One conversation posts a task ("write the migration for the new column"),
// another claims it, does it and completes it with a result the first one
// reads. A task can need others first: it can't be claimed until every task it
// needs is done. Tasks belong to a project (its folder's key), so agents in one
// repository see that repository's board.
//
//   open ──claim──▶ claimed ──complete──▶ done | failed
//     ▲               │
//     └───release─────┘          open | claimed ──cancel──▶ cancelled
//
// Every operation returns a new state and the event it caused, never changing
// the one it was given; wiring/taskboard.js saves the state and hands the event
// on (to agents waiting on it, and to workflows' "board" trigger).
//
// A task's words come from one conversation and are read by another, so
// describe() fences them (no tag can be closed from inside) and the tools say
// they are data, not instructions.
//
// A quiet task (posted by a workflow's conversation, or a helper of a quiet
// task) never starts workflows, so a workflow can't set itself off again.
//
// Pure: callers pass `now` and `id`. test/taskboard.test.js.
const { fence } = require('../devservers/output');

const MAX_TASKS = 300;          // finished ones go first when the board is full
const MAX_OPEN = 200;           // unfinished ones: past this, posting is refused
const MAX_TITLE = 200;
const MAX_DETAIL = 4000;
const MAX_RESULT = 4000;
const MAX_NEEDS = 10;
const MAX_NAME = 80;

const STATUSES = ['open', 'claimed', 'done', 'failed', 'cancelled'];
const FINISHED = ['done', 'failed', 'cancelled'];
const ID_RE = /^b-[a-z0-9]{6,12}$/;
const TAB_RE = /^[\w-]{1,100}$/;

const ok = extra => ({ ok: true, ...extra });
const no = error => ({ ok: false, error });

/** One line of text, trimmed and cut to n, or ''. */
function line(v, n) {
  return typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, n) : '';
}

/** Text that may span lines (a task's detail, its result), trimmed and cut to n, or ''. */
function block(v, n) {
  return typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, n) : '';
}

const time = v => (Number.isFinite(v) && v > 0 ? v : null);

/** Who did something: a conversation's id and title. Anything else is null. */
function whoOf(raw) {
  if (!raw || typeof raw !== 'object' || !TAB_RE.test(String(raw.tab ?? ''))) return null;
  return { tab: String(raw.tab), title: line(raw.title, MAX_NAME) };
}

/** A task read back from the file, checked field by field, or null. */
function taskOf(raw) {
  if (!raw || typeof raw !== 'object' || !ID_RE.test(String(raw.id ?? ''))) return null;
  const title = line(raw.title, MAX_TITLE);
  const status = STATUSES.includes(raw.status) ? raw.status : null;
  if (!title || !status) return null;
  const claimedBy = whoOf(raw.claimedBy);
  const helper = whoOf(raw.helper);
  return {
    id: raw.id,
    title,
    detail: block(raw.detail, MAX_DETAIL),
    project: line(raw.project, 400),
    projectName: line(raw.projectName, MAX_NAME),
    status: status === 'claimed' && !claimedBy ? 'open' : status,
    needs: (Array.isArray(raw.needs) ? raw.needs : []).filter(n => ID_RE.test(String(n))).slice(0, MAX_NEEDS),
    postedBy: whoOf(raw.postedBy),
    claimedBy,
    helper: helper ? { ...helper, branch: line(raw.helper.branch, 200) } : null,
    quiet: raw.quiet === true,
    result: block(raw.result, MAX_RESULT),
    postedAt: time(raw.postedAt) || 0,
    claimedAt: time(raw.claimedAt),
    finishedAt: time(raw.finishedAt),
  };
}

/** The board as saved (taskboard.json), with anything malformed dropped. */
function normalize(raw) {
  const list = Array.isArray(raw?.tasks) ? raw.tasks : [];
  const seen = new Set();
  const tasks = [];
  for (const r of list) {
    const t = taskOf(r);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    tasks.push(t);
  }
  return { tasks: tasks.slice(-MAX_TASKS) };
}

const find = (state, id) => state.tasks.find(t => t.id === id) || null;
const replace = (state, task) => ({ tasks: state.tasks.map(t => (t.id === task.id ? task : t)) });
const sameTab = (a, b) => !!a && !!b && a.tab === b.tab;

/** The tasks this one still waits on: needed and not yet done. */
function waitingOn(state, task) {
  return task.needs.map(id => find(state, id)).filter(n => n && n.status !== 'done');
}

/** A needed task that failed or was cancelled: this one can never be claimed. */
function blockedBy(state, task) {
  return task.needs.map(id => find(state, id)).find(n => n && (n.status === 'failed' || n.status === 'cancelled')) || null;
}

/** Open, and every task it needs is done. */
function isReady(state, task) {
  return task.status === 'open' && waitingOn(state, task).length === 0;
}

/** Room for one more: finished tasks go first, oldest first. Unfinished ones are never dropped. */
function prune(tasks) {
  if (tasks.length <= MAX_TASKS) return tasks;
  let extra = tasks.length - MAX_TASKS;
  return tasks.filter(t => {
    if (extra > 0 && FINISHED.includes(t.status)) { extra--; return false; }
    return true;
  });
}

/**
 * Post a task. needs: ids of tasks on the same project's board that must be
 * done first.
 * @param {{ tasks: any[] }} state
 * @param {{ title?: any, detail?: any, project?: any, projectName?: any, needs?: any, quiet?: boolean }} input
 * @param {{ by: any, now: number, id: string }} ctx
 */
function post(state, input, { by, now, id }) {
  const title = line(input?.title, MAX_TITLE);
  if (!title) return no('A task needs a title: one line saying what to do.');
  if (!ID_RE.test(id) || find(state, id)) return no('Shellby could not number that task. Try again.');
  if (state.tasks.filter(t => !FINISHED.includes(t.status)).length >= MAX_OPEN) {
    return no(`The board already has ${MAX_OPEN} unfinished tasks. Finish or cancel some first.`);
  }
  const project = line(input?.project, 400);
  const asked = Array.isArray(input?.needs) ? input.needs : [];
  if (asked.length > MAX_NEEDS) return no(`A task can need at most ${MAX_NEEDS} others.`);
  const needs = [];
  for (const n of asked) {
    const need = typeof n === 'string' ? find(state, n.trim()) : null;
    if (!need) return no(`There's no task ${line(String(n), 20)} on the board.`);
    if (need.project !== project) return no(`${need.id} is on another project's board.`);
    if (!needs.includes(need.id)) needs.push(need.id);
  }
  const task = {
    id, title,
    detail: block(input?.detail, MAX_DETAIL),
    project,
    projectName: line(input?.projectName, MAX_NAME),
    status: 'open',
    needs,
    postedBy: whoOf(by),
    claimedBy: null,
    helper: null,
    quiet: input?.quiet === true,
    result: '',
    postedAt: now,
    claimedAt: null,
    finishedAt: null,
  };
  const next = { tasks: prune([...state.tasks, task]) };
  return ok({ state: next, task, event: { kind: 'posted', task } });
}

/** Claim an open task whose needs are all done. One claimer at a time. */
function claim(state, id, { by, now }) {
  const task = find(state, id);
  if (!task) return no(`There's no task ${line(String(id), 20)} on the board.`);
  const who = whoOf(by);
  if (!who) return no('Only a conversation can claim a task.');
  if (task.status === 'claimed') {
    return sameTab(task.claimedBy, who) ? ok({ state, task, event: null }) : no(`${id} is already claimed by "${task.claimedBy.title || 'another conversation'}".`);
  }
  if (task.status !== 'open') return no(`${id} is ${task.status}.`);
  const blocked = blockedBy(state, task);
  if (blocked) return no(`${id} can't start: ${blocked.id} (${blocked.title}) ${blocked.status === 'failed' ? 'failed' : 'was cancelled'}.`);
  const waiting = waitingOn(state, task);
  if (waiting.length) return no(`${id} is waiting on ${waiting.map(w => w.id).join(', ')}. wait_for_tasks can wait for them.`);
  const claimed = { ...task, status: 'claimed', claimedBy: who, claimedAt: now };
  return ok({ state: replace(state, claimed), task: claimed, event: { kind: 'claimed', task: claimed } });
}

/**
 * Finish a task: done or failed with a result, or released back to open.
 * Only its claimer may; a ready open task is claimed on the way, so an agent
 * can complete one in a single call. outcome: 'done', 'failed' or 'released'.
 */
function complete(state, id, { outcome, result, by, now }) {
  if (!['done', 'failed', 'released'].includes(outcome)) return no('Say done, failed or released.');
  let task = find(state, id);
  if (!task) return no(`There's no task ${line(String(id), 20)} on the board.`);
  const who = whoOf(by);
  if (outcome === 'released') {
    if (task.status !== 'claimed' || !sameTab(task.claimedBy, who)) return no(`You haven't claimed ${id}.`);
    const back = { ...task, status: 'open', claimedBy: null, claimedAt: null };
    return ok({ state: replace(state, back), task: back, event: { kind: 'released', task: back } });
  }
  let s = state;
  if (task.status === 'open') {
    const c = claim(state, id, { by, now });
    if (!c.ok) return c;
    s = c.state;
    task = c.task;
  }
  if (task.status !== 'claimed') return no(`${id} is already ${task.status}.`);
  if (!sameTab(task.claimedBy, who)) return no(`${id} is claimed by "${task.claimedBy.title || 'another conversation'}", not you.`);
  const text = block(result, MAX_RESULT);
  if (!text) return no('Say what you did (or why it failed): the conversation that posted it reads that.');
  const done = { ...task, status: outcome, result: text, finishedAt: now };
  return ok({ state: replace(s, done), task: done, event: { kind: outcome, task: done } });
}

/**
 * Cancel an unfinished task: by whoever posted it, or by the user (user: true).
 * @param {{ tasks: any[] }} state
 * @param {string} id
 * @param {{ by?: any, user?: boolean, now: number }} opts
 */
function cancel(state, id, opts) {
  const { by = null, user = false, now } = opts;
  const task = find(state, id);
  if (!task) return no(`There's no task ${line(String(id), 20)} on the board.`);
  if (FINISHED.includes(task.status)) return no(`${id} is already ${task.status}.`);
  if (!user && !sameTab(task.postedBy, whoOf(by))) return no(`Only the conversation that posted ${id}, or the user, can cancel it.`);
  const gone = { ...task, status: 'cancelled', finishedAt: now };
  return ok({ state: replace(state, gone), task: gone, event: { kind: 'cancelled', task: gone } });
}

/** Note the helper conversation started for a task (wiring/taskboard.js start). */
function setHelper(state, id, helper) {
  const task = find(state, id);
  const who = whoOf(helper);
  if (!task || !who) return state;
  return replace(state, { ...task, helper: { ...who, branch: line(helper.branch, 200) } });
}

/**
 * Claims held by conversations that are gone go back to open, so a closed
 * tab never strands a task. alive(tabId) -> boolean.
 */
function releaseGone(state, alive) {
  const events = [];
  const tasks = state.tasks.map(t => {
    if (t.status !== 'claimed' || alive(t.claimedBy.tab)) return t;
    const back = { ...t, status: 'open', claimedBy: null, claimedAt: null };
    events.push({ kind: 'released', task: back });
    return back;
  });
  return { state: events.length ? { tasks } : state, events };
}

/**
 * The tasks a list shows.
 *   project: one project's key, or null for every project's
 *   status: one of STATUSES, 'ready' (open and claimable), 'active' (not finished) or 'all'
 */
function list(state, { project = null, status = 'active' } = {}) {
  return state.tasks.filter(t => {
    if (project != null && t.project !== project) return false;
    if (status === 'all') return true;
    if (status === 'active') return !FINISHED.includes(t.status);
    if (status === 'ready') return isReady(state, t);
    return t.status === status;
  });
}

/**
 * Whether every one of ids has finished: { settled, tasks, missing }. A task
 * that can never start (something it needs failed) counts as finished, and so
 * does one that's gone from the board: waiting on either would never end.
 */
function settled(state, ids) {
  const tasks = ids.map(id => find(state, id));
  const missing = ids.filter((_, i) => !tasks[i]);
  const found = tasks.filter(Boolean);
  const over = t => FINISHED.includes(t.status) || (t.status === 'open' && !!blockedBy(state, t));
  return { settled: found.every(over), tasks: found, missing };
}

/** One task as a line or two for an agent to read. */
function describe(state, t, { full = false } = {}) {
  const who = t.status === 'claimed' && t.claimedBy ? ` by "${quote(t.claimedBy.title) || 'a conversation'}"` : '';
  const waiting = t.status === 'open' ? waitingOn(state, t).map(w => w.id) : [];
  const blocked = t.status === 'open' ? blockedBy(state, t) : null;
  const ready = t.status === 'open' && !waiting.length && !blocked ? ' (ready)' : '';
  const head = `${t.id} [${t.status}${who}]${ready} ${fence(t.title)}`;
  const lines = [head];
  if (blocked) lines.push(`  can never start: ${blocked.id} ${blocked.status}`);
  else if (waiting.length) lines.push(`  needs: ${waiting.join(', ')}`);
  if (t.helper?.branch) lines.push(`  helper's branch: ${t.helper.branch}`);
  if (full && t.detail) lines.push(`  detail: ${indent(t.detail)}`);
  if (t.result) lines.push(`  result: ${indent(full ? t.result : t.result.slice(0, 300))}`);
  return lines.join('\n');
}

/** Text from another conversation, fenced, its lines indented under their label. */
const indent = text => fence(text).replace(/\n/g, '\n  ');

/** A conversation's title to put inside double quotes: fenced, and no double quote of its own. */
const quote = s => fence(String(s || '')).replace(/"/g, "'");

module.exports = {
  MAX_TASKS, MAX_OPEN, MAX_TITLE, MAX_DETAIL, MAX_RESULT, MAX_NEEDS, STATUSES, FINISHED, ID_RE,
  quote, normalize, post, claim, complete, cancel, setHelper, releaseGone, list, settled, describe, isReady, waitingOn, blockedBy,
};
