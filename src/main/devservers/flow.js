// Dev servers in workflows (docs/plans/workflows.md): what a server event
// hands a `server` trigger, and the `server` step (start, stop, restart) that
// workflows/steps.js calls. Only projects on the Projects page, and only their
// package.json scripts: the same doors the page's own buttons go through.
// Everything with a side effect comes in through deps, so the tests drive it
// with fakes.
const path = require('path');

const LIVE = new Set(['starting', 'up']);
const caseKey = p => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const newest = list => [...list].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0];

/** A DevServers 'up', 'crashed' or 'stopped' event -> the trigger's data (trigger.*). */
function serverEvent(event, s) {
  return {
    event, project: s.project, script: s.script, port: s.port ?? null, url: s.url ?? null,
    exitCode: Number.isInteger(s.exitCode) ? s.exitCode : null, root: s.root, framework: s.framework || null,
  };
}

const answer = (s, status = s.status) => ({ ok: true, status, port: s.port ?? null, url: s.url ?? null, project: s.project, script: s.script });

/**
 * The step. deps: {
 *   resolve({ project }) -> { project } | { error }      (projects/service.js resolve)
 *   servers: DevServers (start, stop, restart, settled, view, lastScript)
 *   readScripts(root) -> { scripts: [{ name, likely }] } | null   (devservers/scripts.js read)
 * }
 * args: { action: 'start'|'stop'|'restart', project, script?, signal? }
 * -> { ok, status, port, url, project, script } | { ok: false, error }
 */
async function serverStep(deps, { action, project, script = '', signal = null }) {
  const found = await deps.resolve({ project });
  if (!found.project) return { ok: false, error: found.error || `No project called "${project}".` };
  const p = found.project;
  const roots = (p.local || []).map(c => c.root);
  if (!roots.length) return { ok: false, error: `${p.name} isn't cloned on this PC, so it has no dev server to ${action}.` };
  const keys = new Set(roots.map(caseKey));
  // Its servers Shellby knows, this script's when one is named.
  const mine = deps.servers.view().servers.filter(s => s.kind === 'server' && keys.has(caseKey(s.root)) && (!script || sameName(s.script, script)));
  const live = mine.filter(s => LIVE.has(s.status));

  if (action === 'stop') {
    if (!live.length) return { ok: true, status: 'stopped', port: null, url: null, project: p.name, script: script || mine[0]?.script || null };
    for (const s of live) {
      const r = await deps.servers.stop(s.id);
      if (!r.ok) return r;
    }
    return answer({ ...live[0], port: null, url: null }, 'stopped');
  }

  if (action === 'restart' && mine.length) {
    const s = newest(live.length ? live : mine);
    const r = await deps.servers.restart(s.id);
    if (!r.ok) return r;
    return settle(deps, r.server.id, signal);
  }

  // start (or a restart with nothing to restart): the script named, else the
  // one last run in its main clone, else the likeliest in package.json.
  const root = roots[0];
  const name = script || deps.servers.lastScript(root) || (deps.readScripts(root)?.scripts || []).find(s => s.likely)?.name;
  if (!name) return { ok: false, error: `${p.name} has no dev script in its package.json. Name one in the step.` };
  const r = deps.servers.start({ root, script: name, project: p.name });
  if (!r.ok) return r;
  return settle(deps, r.server.id, signal);
}

// Started: wait until it's up, or say how it fell over.
async function settle(deps, id, signal) {
  const s = await deps.servers.settled(id, { signal });
  if (!s) return { ok: false, error: 'The dev server went away before it was up.' };
  if (s.status === 'crashed') return { ok: false, error: `${s.project}'s dev server ${s.neverUp ? "didn't start" : 'crashed'}${Number.isInteger(s.exitCode) ? ` (exit code ${s.exitCode})` : ''}. Its card on the Projects page has the log.` };
  return answer(s);
}

module.exports = { serverEvent, serverStep };
