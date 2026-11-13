// Pure bits of a tab's summary (sessions.js): what its helpers are saying, its to-do list, and the crab's state from them all.
const { TALK_MS } = require('./session');
const todos = require('../renderer/shared/todos');
const workPose = require('./work-pose');

const CREW_ENDED_MS = 4000; // how long a finished helper's outcome rides along to the crab window

// What a helper is saying, or was just told, for a few seconds (session/crew.js noteMessage): null when quiet.
function talkOf(c, now = Date.now()) {
  const said = c.said && now - c.said.at < TALK_MS ? c.said : null;
  const heard = c.heard && now - c.heard.at < TALK_MS ? c.heard : null;
  const last = said && (!heard || said.at >= heard.at) ? 'said' : heard ? 'heard' : null;
  if (last === 'said') return { kind: 'said', text: said.text.slice(0, 80), to: said.to };
  if (last === 'heard') return { kind: 'heard', text: heard.text.slice(0, 80), from: heard.from };
  return null;
}

// A tab's to-do list in the summary: the counts and what Claude is on, or null with none.
function todoGlance(list) {
  const s = todos.summary(list);
  return s.total ? { total: s.total, done: s.done, current: s.current } : null;
}

// One state for the critter from every tab (sessions.js aggregate): asking beats working beats idle.
function aggregateOf(tabs, now = Date.now()) {
  let pending = 0, busy = 0, planning = 0, plans = 0, hiddenCrew = 0, compacting = 0, talking = 0, red = 0;
  const crew = [], tools = [], jobs = [], crewEnded = [];
  for (const t of tabs) {
    pending += t.session.pending.size;
    if (t.redTests) red++; // its last test run or check failed (work-signs.js)
    // A keep-warm ping is nobody's work: no crab at work, no "running" in the tray, no
    // Multitasker. What else the tab has going (its jobs, its helpers) still shows.
    const working = t.session.busy && !t.pinging;
    if (working) {
      busy++;
      tools.push({ tool: t.session.tool, toolAt: t.session.toolAt, kind: t.session.toolKind });
      if (t.compacting) compacting++;
      if (t.talking && !t.session.tool) talking++; // words between tools, not a tool's own chatter
    }
    if (working && t.session.planning) planning++;
    for (const p of t.session.pending.values()) if (p.toolName === 'ExitPlanMode') plans++;
    for (const j of t.session.jobView()) if (j.status === 'running') jobs.push({ ...j, tabId: t.id });
    for (const c of t.session.runningCrew()) {
      crew.push({ id: c.taskId, tabId: t.id, label: c.activity || c.description || c.subagentType || 'helper', type: c.subagentType || 'general-purpose', bubble: talkOf(c), startedAt: c.startedAt }); // Claude Code's own default
    }
    hiddenCrew += t.session.hiddenCrew?.() || 0; // an ultracode run's agents past the few out as crabs
    // Helpers that just finished, and how: one that did its job walks home with it, one that failed slumps.
    for (const c of t.session.crew) if (c.endedAt && now - c.endedAt < CREW_ENDED_MS) crewEnded.push({ id: c.taskId, ok: c.status === 'completed' });
  }
  // What the busy tab that moved last is doing, for how the crab works (work-pose.js).
  const latest = workPose.latest(tools);
  return { state: pending ? 'asking' : (busy || crew.length) ? 'working' : 'idle', pending, busy, crew, hiddenCrew, crewEnded, jobs, planning, plans, tool: latest?.tool || null, kind: latest?.kind || null, toolAt: latest?.toolAt || null, compacting: compacting > 0, talking: talking > 0, red };
}

module.exports = { talkOf, todoGlance, aggregateOf };
