// Ending a tab's Claude Code process while the tab stays open (sessions.js).
// session.stop() ends the process, not the conversation: the tab's next message
// starts a new one and resumes it. It is only ever asked of a tab with nothing
// in flight: a turn stopped partway never sends its result, and the tab would
// stay busy for good (session/index.js ended()).

/** Nothing going in it that ending the process would cut off or leave hanging. */
function isFree(s) {
  return !s.busy && !s.pending.size && !s.waiting && !s.hasBackgroundWork();
}

/**
 * Claude Code reads its sign-in once, as it starts. A process that started
 * before the tab's sign-in last changed (tab.signInAt: a sign-out, an account
 * switch, or a turn turned down as signed out) still holds the old one, and
 * every message to it fails "Not logged in" until it's replaced.
 */
function onOldSignIn(tab) {
  const s = tab.session;
  return !!tab.signInAt && !!s.proc && (s.procStartedAt || 0) <= tab.signInAt;
}

/**
 * Stop the process of every tab that has sat quiet for idleMs. Each one holds
 * a claude process and a full set of MCP servers (dozens of processes, over a
 * GB) for nothing. Not a tab that's working, waiting on you, or has something
 * running in the background. keep(id): true for a tab Keep warm still keeps
 * (keepwarm-service.js isKept). One on an old sign-in goes as soon as it's free,
 * however recently it was used. -> the ids of the tabs stopped.
 * @param {Iterable<any>} tabs @param {number} idleMs @param {number} now @param {(id: string) => boolean} keep
 */
function stopIdle(tabs, idleMs, now, keep) {
  const stopped = [];
  for (const tab of tabs) {
    const s = tab.session;
    if (!s.proc || !isFree(s)) continue;
    if (!onOldSignIn(tab) && (now - tab.activeAt < idleMs || keep(tab.id))) continue; // keep: Keep warm still needs its process
    s.stop().catch(() => {});
    stopped.push(tab.id);
  }
  return stopped;
}

/**
 * The sign-in changed (a sign-out, a switch, a new sign-in): every Claude Code
 * tab on this PC is marked, and the ones with nothing in flight are stopped
 * now. The rest are replaced once free: stopIdle() on its next pass, or
 * beforeSend() when you write to it first. A conversation on another computer
 * (ssh) signs in there, and another agent's CLI isn't Claude's sign-in.
 * -> the ids of the tabs stopped now.
 * @param {Iterable<any>} tabs @param {(tab: any) => boolean} onClaude @param {number} now
 */
function stopForSignIn(tabs, onClaude, now) {
  const stopped = [];
  for (const tab of tabs) {
    const s = tab.session;
    if (!onClaude(tab) || !s.proc || s.remoteHost) continue;
    tab.signInAt = now;
    if (!isFree(s)) continue;
    s.stop().catch(() => {});
    stopped.push(tab.id);
  }
  return stopped;
}

/**
 * Just before a message goes to a tab on an old sign-in: its process is asked to
 * stop, and session.send() waits for it to close and starts a fresh one. Not
 * while something runs in the background (a dev server): that message fails as
 * signed out instead, which says so. -> whether it was stopped.
 */
function beforeSend(tab) {
  const s = tab.session;
  if (!onOldSignIn(tab) || s.busy || s.pending.size || s.waiting || s.hasBackgroundWork()) return false;
  s.stop().catch(() => {});
  return true;
}

module.exports = { stopIdle, stopForSignIn, beforeSend, onOldSignIn };
