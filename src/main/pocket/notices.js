// Shellby on your phone: the notifications a paired phone gets, through its
// own push service (pocket/push.js signs and encrypts them). wiring/pocket.js
// hands in its settings and its list of phones.
const channels = require('../channels');
const focus = require('../focus');
const { composeMessage } = require('../channels/messages');
const push = require('./push');

const PUSH_SUBJECT = 'https://getshellby.com/';

const ok = extra => ({ ok: true, ...extra });
const no = error => ({ ok: false, error });

/**
 * settings(), devices(), saveDevices(list), vapidKeys(), waitingPrompts():
 * as wiring/pocket.js keeps them. changed(): a phone's notifications went, for Settings.
 */
function createPocketNotices(d, { settings, devices, saveDevices, vapidKeys, waitingPrompts, changed }) {
  // The app icon's count: the prompts waiting. Only sent with a notification,
  // since a push that shows nothing is one iOS stops allowing.
  let promptsWaiting = 0;
  function badge(n) { promptsWaiting = n; }

  /**
   * One event from tellChannel (wiring/channels.js), to every paired phone that
   * asked for notifications. Its own settings, the same rules: Guard my focus,
   * the quick-task cut-off, and "always" for what the phone itself started.
   */
  function notify(event, { always = false } = {}) {
    const s = settings();
    if (!s.enabled || !d.config) return false;
    const targets = devices().filter(dv => dv.push);
    if (!targets.length) return false;
    const tab = event?.tabId ? d.manager?.tabs.get(event.tabId) : null;
    const forced = always || !!tab?.fromPocket;
    if (!channels.shouldSend(event, s.notify, { focused: focus.guarding(d.config.get('focus'), Date.now()), always: forced })) return false;
    const keys = vapidKeys();
    if (!keys) return false;
    const m = composeMessage(event);
    const prompts = event.kind === 'asking' ? Math.max(promptsWaiting, waitingPrompts().length) : waitingPrompts().length;
    const payload = {
      title: m.title, body: m.body,
      tag: event.tabId ? `${event.kind === 'asking' ? 'ask' : 'tab'}-${event.tabId}` : `shellby-${event.kind}`,
      url: event.tabId ? `/#/tab/${encodeURIComponent(event.tabId)}` : '/',
      badge: prompts,
      at: Date.now(),
    };
    sendToPhones(targets, payload, { keys, ttl: event.kind === 'asking' ? 30 * 60 : 6 * 3600, urgency: m.priority === 'high' ? 'high' : 'normal' });
    return true;
  }

  function sendToPhones(targets, payload, { keys, ttl, urgency }) {
    for (const dv of targets) {
      const built = push.buildPushRequest(dv.push, payload, { keys, subject: PUSH_SUBJECT, ttl, urgency });
      if (built.error) { d.log.info(`pocket push: ${built.error}`); continue; }
      push.sendPush(built).then(r => {
        if (r.gone) {
          // The phone dropped it (notifications turned off, app removed): forget it, quietly,
          // unless it subscribed again while this was on its way.
          saveDevices(devices().map(x => (x.id === dv.id && x.push?.endpoint === dv.push.endpoint ? { ...x, push: null } : x)));
          changed();
        } else if (!r.ok) d.log.info(`pocket push: ${r.error || r.status}`);
      }).catch(err => d.log.info(`pocket push: ${err.message}`));
    }
  }

  // "Working on it", quietly, for a task the phone started, when Settings asks
  // for it: the "done" for the same conversation (same tag) takes its place.
  const working = new Set();
  function noticeWork() {
    const s = settings();
    for (const [id, tab] of d.manager?.tabs || []) {
      const busy = d.manager.isBusy(id);
      if (!busy) { working.delete(id); continue; }
      if (working.has(id) || !(tab.fromPocket || tab.fromPhone)) continue;
      working.add(id);
      if (!s.enabled || !s.notify.enabled || !s.notify.working) continue;
      const targets = devices().filter(dv => dv.push);
      const keys = targets.length ? vapidKeys() : null;
      if (!keys) continue;
      sendToPhones(targets, {
        title: String(tab.title || 'Shellby').slice(0, 120), body: 'He’s working on it…', silent: true,
        tag: `tab-${id}`, url: `/#/tab/${encodeURIComponent(id)}`, badge: waitingPrompts().length, at: Date.now(),
      }, { keys, ttl: 30 * 60, urgency: 'low' });
    }
  }

  async function testPush() {
    const targets = devices().filter(dv => dv.push);
    if (!targets.length) return no('No paired phone has notifications on yet. Turn them on in the app.');
    const keys = vapidKeys();
    if (!keys) return no("Windows can't keep the notification key safe on this PC.");
    const results = await Promise.all(targets.map(dv => {
      const built = push.buildPushRequest(dv.push, { title: 'Shellby', body: "That's me, on your phone. 🦀", tag: 'shellby-test', url: '/', badge: waitingPrompts().length }, { keys, subject: PUSH_SUBJECT, ttl: 600 });
      return built.error ? { ok: false, error: built.error } : push.sendPush(built);
    }));
    const bad = results.find(r => !r.ok);
    return bad ? no(bad.gone ? 'That phone has turned notifications off.' : `It didn't go: ${bad.error || bad.status}`) : ok();
  }

  return { notify, noticeWork, testPush, badge };
}

module.exports = { createPocketNotices, PUSH_SUBJECT };
