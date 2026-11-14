// Usage that plans itself: each turn's cost goes in a small ledger as it ends
// (usageLedger.js), and the panel asks what a message usually costs while you
// type it. Kept out of main.js, which only wires it up. Nothing here leaves
// the PC, and the prompt itself is never kept, only its category.
const guard = require('../guard');
const { coldResend, modelSwitch } = require('../cachebreak');
const usageLedger = require('../usage/ledger');
const runcost = require('../usage/runcost');
const { clockTime } = require('../usage/service');
const { headBranch } = require('../gitinfo');

const SAVE_DELAY_MS = 5000;   // turns end in bursts (a workflow's steps); one write when they settle

/** d: what main shares (main.js `shared`). */
function wireUsagePlan(d) {
  let ledger = null;
  let saveTimer = null;
  // tabId -> the turn being measured: { turnId, startedAt, category, size, weight, rise, sawUsage }
  const open = new Map();
  // The last 5-hour reading from any conversation: each new one's rise is put
  // down to the conversation that reported it (as recap.js does).
  let lastReading;

  const rows = () => (ledger ??= usageLedger.normalize(d.config.get('turnCosts'), Date.now()));

  /** A turn is starting (sessions prepareTurn): note what kind of ask it is. */
  function beginTurn(tab) {
    if (d.CAPTURE || !tab?.turnId) return;
    const text = typeof tab.turnText === 'string' ? tab.turnText : '';
    tab.turnText = null; // the category is all that's kept
    // "Start fresh with a summary" goes on under the turn that asked for it, which has been counted.
    if (tab.costedTurn === tab.turnId || open.get(tab.id)?.turnId === tab.turnId) return;
    open.set(tab.id, {
      turnId: tab.turnId, startedAt: Date.now(),
      category: usageLedger.classify(text), size: usageLedger.sizeOf(text),
      weight: 0, rise: 0, sawUsage: false,
    });
  }

  /** One API call's model-weighted spend (spend.js weightOf). */
  function onSpend(tab, weight) {
    const t = tab && open.get(tab.id);
    if (t && Number.isFinite(weight) && weight > 0) t.weight += weight;
  }

  /** A usage reading from a conversation (stream.js usageFrom). */
  function onUsage(tabId, item) {
    const w = item?.fiveHour;
    if (!w || !Number.isFinite(w.pct)) return;
    if (lastReading === undefined) lastReading = d.config.get('lastUsage')?.fiveHour || null;
    const rise = usageLedger.riseOf(lastReading, w);
    lastReading = { pct: w.pct, resetsAt: w.resetsAt };
    const t = open.get(tabId);
    if (t && rise !== null) {
      t.rise += rise;
      t.sawUsage = true;
    }
  }

  /** The turn ended (timetrack onResult): its row goes in the ledger. A stopped turn is left out. */
  function endTurn(tab, result) {
    const t = open.get(tab.id);
    open.delete(tab.id);
    if (!t || t.turnId !== tab.turnId) return;
    tab.costedTurn = t.turnId;
    if (result?.interrupted || d.CAPTURE) return;
    const src = d.spendSource(tab);
    ledger = usageLedger.record(rows(), {
      pk: src.pk, project: src.project, kind: src.kind, rid: tab.routineId || null,
      // A workflow step's run and workflow, so past runs of it can be added up (usage/runcost.js); and the helpers the turn sent.
      run: tab.workflowRunId || null, wf: tab.workflowRunId ? d.workflows?.workflowOfRun(tab.workflowRunId) : null,
      helpers: Array.isArray(result?.cost?.helpers) ? result.cost.helpers.length : 0,
      // The branch the work was on: a copy's own, Claude's worktree's, or what the folder has checked out.
      branch: tab.worktree?.branch || tab.claudeWorktree?.branch || headBranch(tab.session?.cwd),
      model: modelOf(tab),
      category: t.category, size: t.size,
      weight: t.weight, pctRise: t.sawUsage ? t.rise : null,
      durationMs: Number.isFinite(result?.durationMs) ? result.durationMs : Date.now() - t.startedAt,
      turns: result?.turns, tokens: result?.tokens, ok: !!result?.ok,
    }, Date.now());
    if (!saveTimer) saveTimer = setTimeout(save, SAVE_DELAY_MS);
  }

  const modelOf = tab => tab?.session?.lastModel || tab?.session?.model || d.config.get('model') || '';

  /**
   * An Ultracode run ended (session/ultra.js 'run'): a row of its own, so the
   * next one can be guessed at. Its agents' spend is what the meters got for it.
   */
  function endRun(tab, run) {
    if (d.CAPTURE || !tab || !run || !(run.weight > 0)) return;
    const src = d.spendSource(tab);
    ledger = usageLedger.record(rows(), {
      pk: src.pk, project: src.project, kind: 'ultracode', run: run.id, model: modelOf(tab),
      category: 'other', size: 's', weight: run.weight, pctRise: null, durationMs: run.durationMs, ok: run.ok,
    }, Date.now());
    if (!saveTimer) saveTimer = setTimeout(save, SAVE_DELAY_MS);
  }

  /**
   * What a run like this usually costs, before it starts (usage/runcost.js):
   * kind 'ultracode', 'workflow' (with its id) or 'fanout' (a turn asking for
   * several helpers). -> the view the panel shows, words included, or null.
   */
  function estimateRunFor({ kind, workflowId = null } = {}) {
    const now = Date.now();
    const all = rows();
    const wf = kind === 'workflow' ? d.workflows?.get(workflowId) : null;
    if (kind === 'workflow' && !wf) return null;
    const est = runcost.estimateRun(all, { kind, key: wf?.id || null, ratio: usageLedger.ratioOf(all), now });
    if (!est) return null;
    const settings = guard.settingsOf(k => d.config.get(k));
    const advice = usageLedger.advise(est, d.config.get('lastUsage'), settings, now);
    return runcost.view(est, advice, { name: wf?.name || null, resetText: advice.resetsAt ? clockTime(advice.resetsAt) : null, guardOn: settings.on });
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (ledger && d.config) d.config.set({ turnCosts: ledger });
  }

  /** Clear all history: the ledger goes with it. */
  function clear() {
    clearTimeout(saveTimer);
    saveTimer = null;
    ledger = [];
    open.clear();
    d.config.set({ turnCosts: [] });
  }

  /**
   * What a message usually costs, for the composer: the estimate (usageLedger.js)
   * plus whether it would cross the line and whether to hold it for you.
   * -> { pct, low, high, samples, basis, category, project, over, line, nowPct,
   *      left, guardOn, resetsAt, hold, cold, suggest, run }, or for a /command only { rebuild }
   * rebuild: a /model switch that throws a warm cache away (cachebreak.js modelSwitch);
   * cold: a short message into a big conversation whose cache has gone cold
   * (cachebreak.js coldResend); suggest: Sonnet for a conversation that hasn't
   * started, when this kind of ask usually suits it (ledger.js modelSuggestion);
   * run: what the run this message starts usually costs (estimateRunFor), with
   * Ultracode on for the tab (opts.ultracode) or a message that asks for several helpers.
   */
  function estimateFor(tabId, text, { ultracode = false } = {}) {
    const now = Date.now();
    const tab = tabId ? d.manager?.tabs.get(tabId) : null;
    const src = tab ? d.spendSource(tab) : d.projectKeyOf(d.currentCwd());
    // A /command isn't a task to estimate: only whether it throws a warm cache away.
    if (String(text || '').trim().startsWith('/')) {
      return { basis: 'none', samples: 0, over: false, hold: false, rebuild: tab ? modelSwitch({ cache: tab.session?.cache, tokens: tab.session?.context?.tokens, text, now }) : null, cold: null, suggest: null, run: null };
    }
    const model = modelOf(tab);
    const category = usageLedger.classify(text);
    const est = usageLedger.estimate(rows(), { pk: src.pk, category, model, now });
    const settings = guard.settingsOf(k => d.config.get(k));
    const advice = usageLedger.advise(est, d.config.get('lastUsage'), settings, now);
    const kind = tab?.routineId ? 'routine' : tab?.workflowRunId ? 'workflow' : 'tab';
    const runKind = ultracode ? 'ultracode' : runcost.fanout(text) ? 'fanout' : null;
    return {
      ...est, category, project: src.project,
      over: advice.over, line: advice.line, nowPct: advice.now, left: advice.left, guardOn: settings.on, resetsAt: advice.resetsAt,
      hold: usageLedger.shouldHold({ enabled: d.config.get('holdBigTasks') === true, estimate: est, advice, kind }),
      cold: tab && kind === 'tab' ? coldResend({ cache: tab.session?.cache, tokens: tab.session?.context?.tokens, text, now }) : null,
      suggest: tab && kind === 'tab' && !tab.session?.proc && !tab.session?.sessionId && !tab.ownModel
        ? usageLedger.modelSuggestion(rows(), { pk: src.pk, category, model, now }) : null,
      run: runKind && kind === 'tab' ? estimateRunFor({ kind: runKind }) : null,
    };
  }

  /** A suggestion for the routine editor: 'sonnet' when its runs are small for the model it's on, else null. */
  function routineSuggestion(routine) {
    return usageLedger.routineSuggestion(rows(), routine, d.config.get('model') || '', Date.now());
  }

  /** What each branch of the project at cwd cost this week (ledger.js byBranch), for the Lean tab. */
  function branchCosts(cwd) {
    return cwd ? usageLedger.byBranch(rows(), { pk: d.projectKeyOf(cwd).pk, now: Date.now() }) : [];
  }

  return { beginTurn, onSpend, onUsage, endTurn, endRun, save, clear, estimateFor, estimateRunFor, routineSuggestion, branchCosts };
}

module.exports = { wireUsagePlan };
