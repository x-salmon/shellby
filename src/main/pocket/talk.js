// What you say to a conversation from the phone, and what you do to it
// (wiring/pocket.js): a reply, with photos, which joins the desk's queue while
// he works; its name, its effort, closing it, and bringing an old one back
// from History.
const path = require('path');
const pt = require('../channels/phone-tasks');
const { EFFORTS } = require('../cli-contract');
const { closeTab } = require('../ipc/tabs');
const { line } = require('./view');

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
 *   queue(tabId, text, files): into the desk's queue, mid-turn;
 *   onSent(tabId, sendToTab's answer): the desk and the phone hear of it;
 *   pushView: the view changed
 */
function createPocketTalk(d, { modeOf, takePhotos, queue, onSent, pushView }) {
  function reply({ tabId, text, mode, photos }) {
    const tab = str(tabId) && d.manager.tabs.get(tabId);
    if (!tab) return no('That conversation has closed.');
    if (tab.inTerminal) return no("It's in a terminal on your PC now. Reply there.");
    const said = pt.cleanText(typeof text === 'string' ? text : '').slice(0, pt.MAX_TEXT).trim();
    const pictures = Array.isArray(photos) ? photos : [];
    if (!said && !pictures.length) return no('Type something first.');
    const problem = commandProblem(said);
    if (problem) return no(problem);
    const busy = d.manager.isBusy(tabId);
    // A command starts a turn of its own, so it can't join one that's running.
    if (busy && said.startsWith('/')) return no("He's on a turn. Send the command when he's done, or at the desk.");
    const files = takePhotos(pictures);
    if (!said && !files.length) return no('Those photos have gone. Add them again.');
    // Mid-turn: the desk's queue hands it to Claude at his next step, or sends it
    // once the turn ends. The mode stays: a change now would reach the running turn.
    if (busy) {
      queue(tabId, said, files);
      return ok({ queued: true });
    }
    // The mode the phone picked, or Ask: kept when the desk's mode changes.
    const runAs = modeOf(mode);
    if (tab.session.mode !== runAs) tab.session.setMode(runAs);
    tab.pinnedMode = true;
    const r = d.sendToTab(tabId, said, files);
    if (!r.ok) return no(r.error);
    onSent(tabId, r);
    return ok({ turnId: r.turnId });
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

  const actions = { reply, rename, effort, close, history, resume };
  return { actions };
}

module.exports = { createPocketTalk, commandProblem, PHONE_COMMANDS };
