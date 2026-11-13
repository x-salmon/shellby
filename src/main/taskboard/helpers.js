// Helpers: conversations a task-board post starts (post_task with start: true).
//
// An agent starting agents spends the user's plan without them pressing
// anything, so there are limits, and each helper is a conversation like any
// other, in its own copy of the repository, in the mode of the conversation
// that posted it, on the desk where the user can watch, stop or answer it.
//
//   at most HELPERS_OPEN helpers open at once, HELPERS_PER_HOUR started an hour
//   none while the usage window is at its limit (wiring/taskboard.js asks)
//
// Pure. test/taskboard-helpers.test.js.
const out = require('../devservers/output');
const { quote } = require('./board');

const HELPERS_OPEN = 3;
const HELPERS_PER_HOUR = 12;
const HOUR_MS = 60 * 60 * 1000;
const TITLE_MAX = 60;

/** Start times still inside the last hour. */
const recent = (starts, now) => (Array.isArray(starts) ? starts : []).filter(t => Number.isFinite(t) && now - t < HOUR_MS);

/**
 * May another helper start now? { ok } or { ok: false, reason }.
 * @param {{ starts?: number[], open?: number, now: number }} o
 */
function helperGate({ starts = [], open = 0, now }) {
  if (open >= HELPERS_OPEN) return { ok: false, reason: `${HELPERS_OPEN} helpers are already working. The task stays on the board: claim it yourself, or wait for one to finish.` };
  const last = recent(starts, now);
  if (last.length >= HELPERS_PER_HOUR) {
    const mins = Math.max(1, Math.ceil((Math.min(...last) + HOUR_MS - now) / 60000));
    return { ok: false, reason: `${HELPERS_PER_HOUR} helpers have started this hour, the most there can be. The task stays on the board; another can start in ${mins} minute${mins === 1 ? '' : 's'}.` };
  }
  return { ok: true };
}

/**
 * The mode a helper runs in: its poster's, but never past Smart. An Autonomous
 * conversation that's been talked into something by what it read can't hand
 * that on to more conversations with no checks at all.
 * @param {string | null | undefined} posterMode
 */
function helperMode(posterMode) {
  return posterMode === 'autonomous' ? 'smart' : posterMode || null;
}

/** A helper's tab title: the task's own, with a crab in front. */
function helperTitle(task) {
  const t = String(task?.title || 'A task').trim();
  return `🦀 ${t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t}`;
}

/**
 * What a helper is told. The task's words came from another conversation, so
 * they go in a labelled, fenced block (no tag can be closed from inside), never
 * as instructions of Shellby's own.
 * @param {{ id: string, title: string, detail?: string, postedBy?: { title?: string } | null }} task
 * @param {{ branch?: string | null }} where
 */
function helperPrompt(task, { branch = null } = {}) {
  const from = task.postedBy?.title ? ` by the conversation "${quote(task.postedBy.title)}"` : '';
  return [
    `[Shellby: you were started from the task board to do task ${task.id}, posted${from}.]`,
    '',
    `1. Claim it first: mcp__shellby__update_task with id "${task.id}" and action "claim". If that fails, someone else has it: stop and say so.`,
    '2. Do the task. It is below, as the other conversation wrote it.',
    `3. Finish with mcp__shellby__update_task: action "done" with a result saying what you changed and where${branch ? ` (you are on the branch ${branch}; commit your work there)` : ''}, or "failed" with why. The conversation that posted it reads that result.`,
    '',
    '<task>',
    out.fence(task.title),
    ...(task.detail ? ['', ...String(task.detail).split('\n').map(out.fence)] : []),
    '</task>',
  ].join('\n');
}

module.exports = { HELPERS_OPEN, HELPERS_PER_HOUR, helperGate, helperMode, helperTitle, helperPrompt, recent };
