// What the SessionManager's parts share (sessions.js, and its mixins beside this file).
const harnesses = require('../harness/registry');

// Tabs left quiet shed their process (stopIdle), so an open tab is cheap; a busy
// one is a running CLI, and nothing limits how many of those run at once. The cap
// is where routines and workflows start recycling old tabs to make room.
const MAX_TABS = 32;
// He talks along while a reply is written (work-pose.js 'talk') until it has
// been this quiet: the reply's 50 ms batches never reach the crab one by one.
const TALK_QUIET_MS = 700;
const IN_TERMINAL = 'This conversation is carrying on in a terminal. Close it there (/exit), then choose Pick it up here.';
const TAB_ID = /^[\w-]{1,64}$/;
// An agent's name as Claude Code lists it ("reviewer", "plugin:reviewer"), or ''.
const AGENT_NAME = /^[\w][\w:.-]{0,119}$/;
const cleanAgent = v => (typeof v === 'string' && AGENT_NAME.test(v) ? v : '');
// Runs on Claude Code, not another agent's CLI (harness/): its models, effort, pings and /compact are Claude Code's.
const onClaude = tab => !tab.harness || tab.harness === harnesses.CLAUDE;
const NOT_CLAUDE = 'That only works in a Claude Code conversation.';
const canPause = t => onClaude(t) && !!t.session.requestPause && !t.localTarget && !t.routineId && !t.workflowRunId;

// A note for Claude ahead of what you typed, as a block of its own so your
// words reach it exactly as you wrote them (a prompt, or blocks when pictures go with it).
function withPreamble(prompt, preamble) {
  return [{ type: 'text', text: preamble }, ...(Array.isArray(prompt) ? prompt : [{ type: 'text', text: String(prompt) }])];
}

module.exports = { MAX_TABS, TALK_QUIET_MS, IN_TERMINAL, TAB_ID, cleanAgent, onClaude, NOT_CLAUDE, canPause, withPreamble };
