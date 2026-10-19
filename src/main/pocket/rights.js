// Shellby on your phone: what each paired phone may do (docs/PHONE.md).
//
// A phone's rights are set at the desk, in Settings → On your phone, beside
// Forget:
//   full      everything the app offers (what every phone had before this)
//   readonly  sees everything, changes nothing: no answers, tasks, replies,
//             stops, undos, bring-homes, pushes, routines, focus or wardrobe.
//             It may still forget itself and turn its own notifications on or
//             off, and give him a pat.
//
// pairing.js keeps the level on the device record; wiring/pocket.js asks here
// before every action and every upload. Pure.
const RIGHTS = ['full', 'readonly'];
const DEFAULT_RIGHTS = 'full';

// The one list of what a read-only phone may still ask for: looking (the
// lists past the beach, a conversation's files), its own notifications, a pat,
// and leaving. Anything not here is refused.
const READ_ONLY_ACTIONS = ['forget', 'push', 'routines', 'notes', 'wardrobe', 'files', 'file', 'pet'];

const READ_ONLY_SAYS = 'This phone can only look. Change what it may do on your PC, in Settings → On your phone.';

const normalizeRights = r => (RIGHTS.includes(r) ? r : DEFAULT_RIGHTS);

/** A device record's level, with old records (no level yet) as full. */
const rightsOf = device => normalizeRights(device?.rights);

/** Why a phone may not do this action, or null when it may. */
function refuse(device, action) {
  if (rightsOf(device) === 'full') return null;
  return READ_ONLY_ACTIONS.includes(action) ? null : READ_ONLY_SAYS;
}

/** A picture is only ever for a task, so a read-only phone sends none. */
const refuseUpload = device => (rightsOf(device) === 'full' ? null : READ_ONLY_SAYS);

module.exports = { DEFAULT_RIGHTS, READ_ONLY_ACTIONS, READ_ONLY_SAYS, RIGHTS, normalizeRights, refuse, refuseUpload, rightsOf };
