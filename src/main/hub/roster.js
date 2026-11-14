// The hub's roster (docs/HUB.md): one row per PC, from the view each one
// serves (pocket/view.js phoneView) and how the line to it is doing
// (hub/link.js). This PC's own row comes from the same view, made here.
//
// A PC the hub can't reach keeps its last known agents and projects, faded,
// with when it was last seen: asleep and gone look the same from here, so the
// row says "not reachable", never guesses which.
//
// Everything from another PC is untrusted: only plain objects are read,
// strings are cut short, numbers checked, and a row that can't be made from
// what a PC sent becomes a row that says so, never a roster that won't draw.
//
// Pure: `now` is passed in. test/hub-roster.test.js.

const MAX_PROJECTS = 6;
const MAX_TABS = 12;
const AGENT_NAMES = { claude: 'Claude Code', gemini: 'Gemini CLI', opencode: 'OpenCode', codex: 'Codex' };

const num = v => (Number.isFinite(v) ? v : null);
const str = (v, n = 120) => (typeof v === 'string' ? v.slice(0, n) : '');
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const objs = (v, max) => (Array.isArray(v) ? v.slice(0, max).filter(isObj) : []);

/** Memory as { usedGb, totalGb } (hub/host.js) or { pct } (Health's reading), numbers only. */
function ramOf(host, machine) {
  if (isObj(host?.ram) && Number.isFinite(host.ram.totalGb)) return { usedGb: num(host.ram.usedGb), totalGb: host.ram.totalGb };
  return Number.isFinite(machine?.ram) ? { pct: machine.ram } : null;
}

const MAX_PROMPTS = 20;
const MAX_PLAN = 20000;

/**
 * A prompt waiting on you there (pocket/view.js phonePrompt), rebuilt from the
 * fields the hub draws. deskOnly: why it can only be answered at that PC.
 */
function promptOf(p) {
  const questions = objs(p.questions, 4).map(q => ({
    question: str(q.question, 300), header: str(q.header, 40), multiSelect: q.multiSelect === true,
    options: objs(q.options, 8).map(o => ({ label: str(o.label, 200), description: str(o.description, 300) })).filter(o => o.label),
  })).filter(q => q.question && q.options.length);
  return {
    tabId: str(p.tabId, 100), requestId: str(p.requestId, 100), title: str(p.title, 120) || 'Untitled',
    toolName: str(p.toolName, 60), label: str(p.label, 120), detail: str(p.detail, 400), ask: str(p.ask, 200),
    warnings: (Array.isArray(p.warnings) ? p.warnings.slice(0, 4) : []).map(w => str(w, 140)).filter(Boolean),
    helper: str(p.helper, 80), deskOnly: str(p.deskOnly, 200), always: str(p.always, 60),
    questions, plan: str(p.plan, 120), planText: str(p.planText, MAX_PLAN),
  };
}

/** "plugged in", "charging, 80%", "battery 64%", or null when the PC has no battery reading. */
function powerOf(machine) {
  const b = machine?.battery;
  if (!b || !Number.isFinite(b.level)) return machine ? 'plugged in' : null;
  return b.charging ? `charging, ${b.level}%` : `battery ${b.level}%`;
}

/**
 * One PC's row.
 * @param {{ id: string, name: string, kind: 'this' | 'pc', state: string, error?: string | null, seenAt?: number | null, view?: any }} e
 * @param {number} now
 */
function rowOf(e, now) {
  const v = isObj(e.view) ? e.view : null;
  const live = e.kind === 'this' || e.state === 'online';
  const tabs = objs(v?.tabs, 200);
  const machine = isObj(v?.machine) ? v.machine : null;
  const host = isObj(v?.host) ? v.host : null;
  const projects = objs(v?.projects, 200);
  return {
    id: e.id,
    name: str(e.name, 40) || str(v?.pc, 40) || 'A PC',
    kind: e.kind,
    state: e.kind === 'this' ? 'online' : e.state,
    error: live ? null : str(e.error, 200) || null,
    seenAt: e.kind === 'this' ? now : num(e.seenAt),
    live,
    // What it's doing: only while the line is up. Gone quiet, it's unknown, not zero.
    working: live ? tabs.filter(t => t.busy).length : null,
    waiting: live ? (Array.isArray(v?.prompts) ? Math.min(v.prompts.length, 999) : 0) : null,
    cpu: live ? num(machine?.cpu?.load) : null,
    gpu: live && isObj(machine?.gpu) ? { load: num(machine.gpu.load), temp: num(machine.gpu.temp) } : null,
    hot: live && (machine?.hot === 'warn' || machine?.hot === 'critical') ? machine.hot : null,
    ram: live ? ramOf(host, machine) : null,
    diskFreeGb: live ? num(host?.diskFreeGb) : null,
    power: live ? powerOf(machine) : null,
    os: str(host?.os, 30) || null,
    version: str(host?.version, 20) || null,
    agents: (Array.isArray(host?.agents) ? host.agents.slice(0, 8) : []).filter(a => typeof a === 'string' && Object.hasOwn(AGENT_NAMES, a)).map(a => ({ id: a, name: AGENT_NAMES[a] })),
    projects: projects.slice(0, MAX_PROJECTS).map(p => ({ key: str(p.key, 600), name: str(p.name, 80) })).filter(p => p.key),
    moreProjects: Math.max(0, projects.length - MAX_PROJECTS),
    tabs: tabs.slice(0, MAX_TABS).map(t => ({
      id: str(t.id, 100), title: str(t.title, 120), folder: str(t.folder, 80), standing: str(t.standing, 20),
      busy: !!t.busy, pending: Number.isFinite(t.pending) ? t.pending : 0, agent: AGENT_NAMES[t.harness] || null,
      mode: str(t.mode, 20), canReply: t.canReply === true,
    })),
    // Waiting on you there, oldest first: answered from the hub through that PC's own answer rules.
    prompts: live ? objs(v?.prompts, MAX_PROMPTS).map(promptOf).filter(p => p.tabId && p.requestId) : [],
    // What a new task there may run in: that PC's own limits, as its phone app shows them.
    limits: isObj(v?.limits) ? { atOnce: num(v.limits.atOnce), open: num(v.limits.open) } : null,
  };
}

/**
 * Every row: this PC first, then the ones online, then the rest, each by name.
 * @param {Array<Parameters<typeof rowOf>[0]>} entries
 * @param {number} now
 */
function roster(entries, now) {
  const rows = (Array.isArray(entries) ? entries : []).map(e => {
    // One PC whose report can't be read never stops the others from showing.
    try { return rowOf(e, now); } catch {
      return rowOf({ id: e.id, name: e.name, kind: e.kind, state: 'offline', error: "What it sent couldn't be read.", seenAt: e.seenAt }, now);
    }
  });
  const rank = r => (r.kind === 'this' ? 0 : r.live ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The line under the title: "4 PCs, 3 awake, 4 working". */
function summaryOf(rows) {
  const awake = rows.filter(r => r.live).length;
  const working = rows.reduce((n, r) => n + (r.working || 0), 0);
  const waiting = rows.reduce((n, r) => n + (r.waiting || 0), 0);
  const pcs = `${rows.length} PC${rows.length === 1 ? '' : 's'}`;
  return [pcs, `${awake} reachable`, `${working} working`, ...(waiting ? [`${waiting} waiting on you`] : [])].join(', ');
}

module.exports = { AGENT_NAMES, powerOf, promptOf, rowOf, roster, summaryOf };
