// What you say to a conversation from the phone, and what you do to it
// (wiring/pocket.js): a reply, with photos; one typed while he works, which
// waits for the turn to end; its name, its effort, closing it, and bringing an
// old one back from History.
//
// The desk's queue lives in its panel and steers into the running turn. The
// phone's waits here instead and goes when the turn ends, so the two never
// write over each other's list (sessions.js steer).
const path = require('path');
const pt = require('../channels/phone-tasks');
const { EFFORTS } = require('../cli-contract');
const { closeTab } = require('../ipc/tabs');
const { line } = require('./view');

const MAX_QUEUED = 5;
const MAX_HISTORY = 30;
const MAX_TITLE = 120;
// Claude Code's own commands that only look at or tidy the conversation. Any
// other / command, and every ! one, runs at the desk.
const PHONE_COMMANDS = ['compact', 'context', 'goal'];

const ok = extra => ({ ok: true, ...extra });
const no = error => ({ ok: false, error });
const str = (v, n = 200) => (typeof v === 'string' && v.length > 0 && v.length <= n ? v : null);

/** Why a reply can't go from the phone, or null when it can. */
function commandProblem(said) {
  if (said.startsWith('!')) return 'Shell commands (!) only run at the desk.';
  if (!said.startsWith('/')) return null;
  const name = said.slice(1).split(/\s/)[0].toLowerCase();
  if (PHONE_COMMANDS.includes(name)) return null;
  return `From your phone, ${PHONE_COMMANDS.map(c => `/${c}`).join(', ')} run. Other commands run at the desk.`;
}

/**
 * @param d  main's shared deps
 * @param o  modeOf: the phone's mode, checked against the desk's list;
 *   takePhotos: photo ids (POST /upload) -> their paths, each used once;
 *   onSent(tabId, sendToTab's answer): the desk and the phone hear of it;
 *   pushView: the view changed
 */
function createPocketTalk(d, { modeOf, takePhotos, onSent, pushView }) {
  const queued = new Map(); // tabId -> [{ id, text, mode, files }]
  let count = 0;

  function open(tabId) {
    const tab = str(tabId) && d.manager.tabs.get(tabId);
    if (!tab) return { error: 'That conversation has closed.' };
    if (tab.inTerminal) return { error: "It's in a terminal on your PC now. Reply there." };
    return { tab };
  }

  function send(tabId, { text, mode, files }) {
    const tab = d.manager.tabs.get(tabId);
    // The mode the phone picked, or Ask: kept when the desk's mode changes.
    const runAs = modeOf(mode);
    if (tab.session.mode !== runAs) tab.session.setMode(runAs);
    tab.pinnedMode = true;
    const r = d.sendToTab(tabId, text, files);
    if (!r.ok) return no(r.error);
    onSent(tabId, r);
    return ok({ turnId: r.turnId });
  }

  function reply({ tabId, text, mode, photos }) {
    const { tab, error } = open(tabId);
    if (!tab) return no(error);
    const said = pt.cleanText(typeof text === 'string' ? text : '').slice(0, pt.MAX_TEXT).trim();
    const pictures = Array.isArray(photos) ? photos : [];
    if (!said && !pictures.length) return no('Type something first.');
    const problem = commandProblem(said);
    if (problem) return no(problem);
    const busy = d.manager.isBusy(tabId);
    const list = queued.get(tabId) || [];
    if (busy && list.length >= MAX_QUEUED) return no(`${MAX_QUEUED} are waiting already. Let him get to those first.`);
    const files = takePhotos(pictures);
    if (!said && !files.length) return no('Those photos have gone. Add them again.');
    if (!busy) return send(tabId, { text: said, mode, files });
    // He's working: this goes when the turn ends, after any already waiting.
    queued.set(tabId, [...list, { id: `q${++count}`, text: said, mode, files }]);
    pushView();
    return ok({ queued: true });
  }

  // A waiting reply taken back, or sent now (after a Stop, nothing sends them by itself).
  function unqueue({ tabId, id, send: now }) {
    const list = queued.get(tabId) || [];
    const m = list.find(x => x.id === id);
    if (!m) return no('That one has gone already.');
    if (now && d.manager.isBusy(tabId)) return no("He's still on it. It goes when this turn ends.");
    const rest = list.filter(x => x.id !== id);
    if (rest.length) queued.set(tabId, rest); else queued.delete(tabId);
    pushView();
    if (!now) return ok();
    if (!open(tabId).tab) return no('That conversation has closed.');
    return send(tabId, m);
  }

  // A turn ended: the first waiting reply goes, unless it was stopped. The desk's
  // own queue may start the next turn first, and then this waits for that one.
  function turnEnded(tabId, item) {
    if (!queued.get(tabId)?.length || item?.interrupted) return;
    setTimeout(() => {
      const list = queued.get(tabId);
      const tab = d.manager.tabs.get(tabId);
      if (!list?.length || !tab || d.manager.isBusy(tabId) || tab.session.pending.size) return;
      const [next, ...rest] = list;
      if (rest.length) queued.set(tabId, rest); else queued.delete(tabId);
      const r = open(tabId).tab ? send(tabId, next) : no('It moved to a terminal.');
      if (!r.ok) {
        d.log.warn('pocket: a waiting reply could not go', r.error);
        d.pocket?.item(tabId, { k: 'note', what: 'error', text: line(`Your waiting reply couldn't go: ${r.error}`, 300) });
      }
      pushView();
    }, 0);
  }

  /** What the phone shows of a conversation's waiting replies. */
  function queuedOf(tabId) {
    return (queued.get(tabId) || []).map(m => ({ id: m.id, text: line(m.text, 200), photos: m.files.length }));
  }

  function rename({ tabId, title }) {
    const t = typeof title === 'string' ? title.trim().slice(0, MAX_TITLE) : '';
    if (!t) return no('Give it a name first.');
    if (!str(tabId) || !d.manager.rename(tabId, t)) return no('That conversation has closed.');
    pushView();
    return ok();
  }

  function effort({ tabId, effort: e }) {
    if (!str(tabId) || !d.manager.tabs.has(tabId)) return no('That conversation has closed.');
    if (e !== '' && !EFFORTS.includes(e)) return no("Claude Code doesn't have that effort.");
    d.manager.setTabEffort(tabId, e);
    pushView();
    return ok();
  }

  function close({ tabId }) {
    if (!str(tabId) || !d.manager.tabs.has(tabId)) return no('That conversation has closed already.');
    closeTab(d, tabId);
    queued.delete(tabId);
    pushView();
    return ok();
  }

  // The latest conversations in History that aren't open, to bring one back.
  function history() {
    const open = d.manager.tabs;
    const list = (d.history.list() || [])
      .filter(e => e && !open.has(e.id))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, MAX_HISTORY)
      .map(e => ({ id: e.id, title: line(e.title, MAX_TITLE) || 'Untitled', folder: line(e.cwd ? path.win32.basename(e.cwd) : '', 80), at: e.updatedAt || null }));
    return ok({ list });
  }

  function resume({ id }) {
    const entry = str(id, 100) && d.history.get(id);
    if (!entry) return no("That conversation isn't in History any more.");
    if (!d.manager.tabs.has(id)) {
      try { d.openTab({ tabId: id, historyEntry: entry }); } catch (err) { return no(err.message); }
    }
    pushView();
    return ok({ tabId: id });
  }

  const actions = { reply, unqueue, rename, effort, close, history, resume };
  return { actions, turnEnded, queuedOf };
}

module.exports = { createPocketTalk, commandProblem, MAX_QUEUED, PHONE_COMMANDS };
