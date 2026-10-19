// Shellby on your phone: what each phone keeps for itself. Its push
// subscription, the quiet hours (from the phone or from Settings) and the
// rights a phone has, set at the desk. wiring/pocket.js hands in the store.
const pairing = require('./pairing');
const push = require('./push');
const quiet = require('./quiet');

const ok = extra => ({ ok: true, ...extra });
const no = error => ({ ok: false, error });

/**
 * d: what main shares. o: { devices, saveDevices, settings, save, vapidKeys,
 * changed() (Settings is told), resend() (every phone gets the view again) }
 */
function createPocketDevices(d, { devices, saveDevices, settings, save, vapidKeys, changed, resend }) {
  function setPush(device, { subscription }) {
    if (subscription == null) {
      saveDevices(devices().map(dv => (dv.id === device.id ? { ...dv, push: null } : dv)));
      changed();
      return ok({ push: false });
    }
    if (!vapidKeys()) return no("Windows can't keep the notification key safe on this PC, so notifications are off.");
    const sub = push.normalizeSubscription(subscription);
    if (!sub) return no("That browser's push service isn't one Shellby knows.");
    saveDevices(devices().map(dv => (dv.id === device.id ? { ...dv, push: sub } : dv)));
    changed();
    return ok({ push: true });
  }

  // The same check at the door wherever it's set from (pocket/quiet.js).
  function setQuiet(patch) {
    const r = quiet.checkQuiet(patch, settings().quiet);
    if (r.error) return no(r.error);
    save({ quiet: r.quiet });
    resend();
    changed();
    return ok({ quiet: r.quiet });
  }

  // From Settings. Its streams get the view again, with the new level on it.
  function setDeviceRights({ id, rights: level }) {
    const list = pairing.setRights(devices(), typeof id === 'string' ? id : '', level);
    if (!list) return no('That phone has already gone.');
    saveDevices(list);
    d.log.info(`pocket: ${list.find(dv => dv.id === id).name} is ${level === 'readonly' ? 'read-only' : 'full'} now`);
    resend();
    return ok();
  }

  return { setPush, setQuiet, setDeviceRights };
}

module.exports = { createPocketDevices };
