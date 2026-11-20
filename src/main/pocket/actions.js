// Shellby on your phone: what each tap on the phone does, under the phone's
// rules (docs/PHONE.md). onAction is the door every call comes through; behind
// it Allow and Deny, a task (now, or for later), Stop, Undo, a turn's diff,
// Bring it home, Reviewed, a photo for a task, the phone's own settings and
// leaving, and the pieces each hands on to (pocket/talk.js, later.js,
// look-over.js, devices.js, pages.js). wiring/pocket.js makes it, with the
// server's settings and view.
const pt = require('../channels/phone-tasks');
const { appDeskOnlyReason, appCaution } = require('../channels/replies');
const { MODES: PHONE_MODES } = require('../config');
const { isModel } = require('../models');
const guard = require('../guard');
const view = require('./view');
const { answerExtra } = require('./answers');
const rights = require('./rights');
const { createPocketDevices } = require('./devices');
const { createPocketTalk } = require('./talk');
const { createLookOver } = require('./look-over');
const { createPocketLater } = require('./later');
const { createPocketPages } = require('./pages'); // pages on your phone: the shelf, a page's files by capability, its bridge

// The app is paired to this PC, so it gets more room than Telegram or ntfy (pt.MAX_OPEN).
const APP_MAX_OPEN = 10;
const APP_STARTS_PER_HOUR = 30;
// Autonomous only once it's been turned on at the desk, as for routines and held tasks.
const AUTONOMOUS_OFF = 'Turn on Autonomous in Settings on your PC first.';
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

const ok = extra => ({ ok: true, ...extra });
const no = error => ({ ok: false, error });
const str = (v, n = 200) => (typeof v === 'string' && v.length > 0 && v.length <= n ? v : null);

/**
 * d: what main shares. o: { settings(), save(patch), devices(), saveDevices(list), vapidKeys(),
 * extra (pocket/extras.js), review (pocket/review.js), locals (pocket/locals.js), projects()
 * (the ones a phone may start a task in), lastTurn (watched tab -> the turn the phone has),
 * pushView() (every phone gets the view), changed() (Settings is told), resend() (every
 * phone gets the view again, whatever it looked like), notifyPage (pocket/notices.js) }
 */
function createPocketActions(d, { settings, save, devices, saveDevices, vapidKeys, extra, review, locals, projects, lastTurn, pushView, changed, resend, notifyPage }) {
  // "3 at once" counts every task a phone started, from this app or from
  // Telegram or ntfy, working or waiting on you, plus any on their way to starting.
  let starting = 0;
  function openCount() {
    let n = starting;
    for (const [id, tab] of d.manager?.tabs || []) {
      if ((tab.fromPocket || tab.fromPhone) && (d.manager.isBusy(id) || tab.session.pending.size)) n++;
    }
    return n;
  }
  /** @type {number[]} */ let starts = [];
  // A task the phone sent again (its answer was slow, so it tried once more) is the same task.
  const sent = new Map(); // key -> the promise of its answer

  async function onAction(device, name, body) {
    if (!settings().enabled) return no('Shellby on your phone is off.');
    // A read-only phone may look, and little else (pocket/rights.js): checked
    // on the phone's record as it is now, not as it was when it connected.
    const why = rights.refuse(devices().find(dv => dv.id === device.id), name);
    if (why) return no(why);
    switch (name) {
      case 'answer': return answer(body);
      case 'task': return task(body);
      case 'stop': return stop(body);
      case 'undo': return undo(body);
      case 'home': return home(body);
      case 'reviewed': return reviewed(body);
      case 'push': return setPush(device, body);
      case 'forget': return forget(device.id, 'You forgot this phone.');
      case 'quiet': return setQuiet(body);
      case 'look-over': return lookOver(body || {});
      case 'reply': return once('reply', body, b => talk.actions.reply(b || {})); // sent again from the outbox: once
      default: {
        if (Object.prototype.hasOwnProperty.call(talk.actions, name)) return talk.actions[name](body || {});
        const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
        const fn = [extra.actions, review.actions, later.actions, pocketPages.actions].map(a => (own(a, name) ? a[name] : null)).find(Boolean) || null;
        if (!fn) return no('unknown');
        const r = await fn(body || {}, device);
        if (r.ok && ['focus', 'routine-toggle'].includes(name)) pushView();
        return r;
      }
    }
  }

  function answer({ tabId, requestId, decision, answers, notes, read }) {
    if (!str(tabId) || !str(requestId) || !['allow', 'always', 'deny'].includes(decision)) return no('That answer is not one the phone can give.');
    const pendingItem = d.manager.tabs.get(tabId)?.session.pending.get(requestId);
    if (!pendingItem) return no('That was already answered.');
    // One the card warns about (appCaution) is allowed once, never always.
    if (decision === 'always' && (!pendingItem.suggestions?.length || ['AskUserQuestion', 'ExitPlanMode'].includes(pendingItem.toolName) || appCaution(pendingItem))) return no('That one has no always-allow. Allow it this once.');
    const why = appDeskOnlyReason(pendingItem); // a no is always safe, even to one the phone can't answer
    if (why && decision !== 'deny') return no(why);
    const extra = answerExtra(pendingItem, { decision, answers, notes, read, mayWrite: mayWriteTo(d.manager.tabs.get(tabId)) });
    if (extra.error) return no(extra.error);
    d.log.info(`pocket: ${decision} for ${pendingItem.toolName}`);
    return d.answerPermission(tabId, requestId, decision, { via: 'pocket', ...extra }) ? ok() : no('That was already answered.');
  }

  // Your own words into a conversation (a typed answer, notes on a plan) go
  // only where a reply could: anywhere but a terminal (pocket/answers.js).
  const mayWriteTo = tab => !tab?.inTerminal;

  // A task or a look-over asked again with the same key gets the first one's answer.
  function once(kind, body, start) {
    const key = typeof body?.key === 'string' && KEY.test(body.key) ? `${kind}-${body.key}` : null;
    if (key && sent.has(key)) return sent.get(key);
    const answer = start(body);
    if (key) sent.set(key, Promise.resolve(answer).then(r => { if (!r?.ok) sent.delete(key); return r; })); // a no (busy, say) may be a yes later
    while (sent.size > 50) sent.delete(sent.keys().next().value);
    return answer;
  }
  const task = body => once('task', body, startTask);

  async function startTask({ project, text, mode, photos, model, local, when }) {
    const runAs = modeOf(mode);
    if (modeBlocked(runAs)) return no(AUTONOMOUS_OFF);
    // A Claude model (models.js), a local one (the desk's "On this PC"), or neither: the desk's own.
    const { on, onPc, runOn, error } = locals.pick({ model, local, when }, isModel);
    if (error) return no(error);
    const prompt =pt.cleanText(typeof text === 'string' ? text : '').slice(0, pt.MAX_TEXT).trim();
    if (!prompt) return no('Say what you want done first.');
    if (/^[/!]/.test(prompt)) return no('Commands that start with / or ! only run at the desk.');
    const target = projects().find(p => p.key === project);
    if (!target) return no("That project isn't one Shellby knows. Pick one from the list.");
    // For later: after the reset or tonight, in the queue, as the Routines page's Queue it does.
    if (when === 'reset' || when === 'tonight') return later.queueForLater({ prompt, cwd: target.key, mode: runAs, model: on, when, photos });
    const now = Date.now();
    const gate = claimStart(now);
    if (!gate.ok) return no(gate.reply);
    // At the limit, or past what you keep for yourself: it waits for the reset. Not on a local model, which spends none of it.
    const w = d.usageService?.limitWait();
    if (!onPc && (w || guard.holdBeforeStart(guard.settingsOf(k => d.config.get(k)), d.config.get('lastUsage'), now))) {
      const held = d.holdForReset({ kind: 'task', prompt, cwd: target.key, mode: runAs, fromPhone: true, ...(on ? { model: on } : {}) });
      if (!held.ok) return no(`Couldn't queue it: ${held.error}`);
      d.sendOutlook?.();
      pushView();
      return ok({ held: true, atText: held.atText });
    }
    const title = pt.titleFor(prompt);
    // Pictures the phone sent first (POST /upload), each used once.
    const files = extra.takePhotos(photos);
    // Its place is kept while the copy is made, so two at once can't both slip under the cap.
    starting++;
    let r;
    try {
      r = await d.startTaskInCopy(target.key, title, () => prompt, { mode: runAs, ...runOn, ...(files.length ? { attachments: () => files } : {}) });
      if (!r.ok && r.noCopy) r = d.startTask(files.length && d.composePrompt ? d.composePrompt(prompt, files) : prompt, title, { mode: runAs, cwd: target.key, ...runOn });
      if (r.ok) adopt(r.tabId);
    } finally { starting--; }
    if (!r.ok) return no(r.error || "Couldn't start it.");
    d.log.info('pocket: started a task in', target.name);
    pushView();
    return ok({ tabId: r.tabId });
  }

  // A place under the phone's limits, taken: { ok } or { ok: false, reply }.
  function claimStart(now = Date.now(), { open = openCount() } = {}) {
    const gate = pt.startGate({ starts, open, now, maxOpen: APP_MAX_OPEN, perHour: APP_STARTS_PER_HOUR });
    if (gate.ok) starts = [...pt.recent(starts, now), now];
    return gate;
  }

  // The queue, tasks for later, checks again and branching (pocket/later.js); Look over my changes (pocket/look-over.js).
  const later = createPocketLater(d, { adopt: id => adopt(id), pushView: () => pushView(), claimStart: opts => claimStart(Date.now(), opts), once });
  const startLookOver = createLookOver(d, { projects: () => projects(), claimStart, adopt: id => adopt(id), pushView: () => pushView() });
  const lookOver = body => once('look', body, startLookOver);

  // What the phone picked, from the desk's own list; anything else is Ask (pt.MODE).
  const modeOf = m => (PHONE_MODES.includes(m) ? m : pt.MODE);
  const modeBlocked = m => m === 'autonomous' && !d.config.get('autonomousAcknowledged');

  function adopt(tabId) {
    const tab = d.manager.tabs.get(tabId);
    if (tab) tab.fromPocket = true;
    d.manager.note(tabId, { kind: 'phone' });
    d.history.update(tabId, { fromPhone: true });
  }

  // A reply, one into the desk's queue mid-turn, and the conversation's name,
  // effort, closing and History (pocket/talk.js).
  const talk = createPocketTalk(d, {
    modeOf,
    blocked: m => (modeBlocked(m) ? AUTONOMOUS_OFF : ''),
    takePhotos: ids => extra.takePhotos(ids),
    // Mid-turn: into the desk's own queue (tab-queue.js), which hands it to Claude
    // at his next step or sends it once the turn ends. The panel keeps the only
    // list main steers from, so it goes there rather than in beside it.
    queue(tabId, text, files) {
      const win = d.tabWindow?.(tabId) || d.panel;
      d.send(win, 'tab:queue', { tabId, text, ...(files.length ? { files } : {}) });
    },
    onSent(tabId, r) {
      // The desk's panel draws a message it didn't send itself from this.
      d.send(d.tabWindow?.(tabId) || d.panel, 'tab:sent', { tabId, item: r.item });
      lastTurn.set(tabId, r.turnId);
      d.pocket?.item(tabId, view.phoneItem(r.item));
    },
    pushView: () => pushView(),
  });

  function stop({ tabId }) {
    if (!str(tabId) || !d.manager.isBusy(tabId)) return no("He's not working on that one.");
    d.manager.interrupt(tabId);
    return ok();
  }

  // A turn's changes, as History has them: the phone names the turn, main finds the rest.
  function changesOf(tabId, after) {
    if (!str(tabId) || !str(after, 100) || !d.manager.tabs.has(tabId)) return null;
    return [...d.history.load(tabId)].reverse().find(i => i?.kind === 'changes' && i.after === after) || null;
  }

  async function undo({ tabId, after }) {
    const c = changesOf(tabId, after);
    if (!c) return no("That isn't a change from this conversation.");
    const r = await d.undoChanges({ tabId, root: c.root, before: c.before, after: c.after });
    return r.ok ? ok({ restored: r.restored }) : no(r.error || "Couldn't undo it.");
  }

  async function onDiff(device, { tab, after, file }) {
    const c = changesOf(tab, after);
    if (!c) return no("That isn't a change from this conversation.");
    if (file && !(c.files || []).some(f => f.path === file)) return no("That file isn't in that change.");
    const r = await d.diffChanges({ tabId: tab, root: c.root, before: c.before, after: c.after, ...(file ? { file } : {}) });
    if (r?.error) return no(r.error);
    // A phone needs a page or two, not a whole refactor.
    const patch = String(r?.patch || '');
    return ok({ patch: patch.slice(0, 200000), truncated: !!r?.truncated || patch.length > 200000 });
  }

  // The desk's "Bring it home and finish", so it moves to Done. push: and push the branch it lands on,
  // when Settings allows it. The desk's own checks go first (the secret scan, other people's commits).
  async function home({ tabId, force, push: andPush }) {
    if (!str(tabId)) return no('That conversation has closed.');
    if (andPush === true && !settings().allow.push) return no('Pushing from your phone is off. Turn it on in Settings → On your phone.');
    if (andPush === true && force === true) return no('Red checks and a push together only happen at the desk.');
    const r = await d.bringTabHome(tabId, { force: force === true, finish: true, ...(andPush === true ? { push: true } : {}) });
    if (r.red || r.conflict) return { ok: false, ...(r.red ? { red: true } : { conflict: true }), error: r.error }; // red checks: ask; a clash: offer to have him sort it out
    const pushed = r.push;
    return r.ok ? ok({ merged: !!r.merged, commits: r.commits || 0, base: r.base || null, ...(andPush === true ? { pushed: !!pushed?.ok, pushError: pushed && !pushed.ok ? String(pushed.error || '') : null } : {}) }) : no(r.error || "Couldn't bring it home.");
  }

  function reviewed({ tabId, after }) {
    if (!str(tabId)) return no('That conversation has closed.');
    return d.manager.setReviewed(tabId, true, str(after, 100)) ? ok() : no('Nothing to mark.');
  }

  // Its push subscription, the quiet hours and a phone's rights (pocket/devices.js).
  const { setPush, setQuiet, setDeviceRights } = createPocketDevices(d, { devices, saveDevices, settings, save, vapidKeys, changed, resend });

  function forget(deviceId, reason = 'This phone was forgotten.') {
    const list = devices();
    const gone = list.find(dv => dv.id === deviceId);
    if (!gone) return no('That phone has already gone.');
    saveDevices(list.filter(dv => dv.id !== deviceId));
    d.pocket?.dropDevice(deviceId, reason);
    d.log.info(`pocket: forgot ${gone.name}`);
    changed();
    return ok();
  }

  // A photo for a task (POST /upload), kept until a task names it.
  function onUpload(device, bytes) {
    if (!settings().enabled) return no('Shellby on your phone is off.');
    const why = rights.refuseUpload(devices().find(dv => dv.id === device.id));
    return why ? no(why) : extra.savePhoto(bytes);
  }

  const pocketPages = createPocketPages(d, { devices, claimStart: () => claimStart(), adopt, pushView, once, notifyPage, server: () => d.pocket });

  return {
    onAction, onDiff, onUpload, onPage: pocketPages.serve,
    openCount, forget, setQuiet, setDeviceRights,
    reply: body => talk.actions.reply(body), // pocket/review.js's Fix it goes in as a reply
  };
}

module.exports = { createPocketActions, APP_MAX_OPEN, APP_STARTS_PER_HOUR };
