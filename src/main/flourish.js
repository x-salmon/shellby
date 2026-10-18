// How he takes a finished turn (pure): not the same hop every time. Which
// flourish plays on 'success' or 'error', from his temperament (voice.js) and
// how the turn went. One body class per flourish in critter.css
// (.flourish-<name>); null is the one he always had (the double jump, the oof).
//   success
//     big      a long turn done: a jump with a spin and both claws up
//     phew     green after two or more misses in a row: slumps with relief, then hops
//     dance    a little side-to-side shuffle, claw going
//     spin     a hop with a twirl
//     pump     a claw pump and a firm nod
//   error
//     facepalm claw over his eyes
//     huff     a stamp and a shake of the shell
//     slump    sags right down
//     shrug    claw out, a tilt: these things happen
// See test/flourish.test.js.

const SUCCESS = Object.freeze(['dance', 'spin', 'pump']);
const ERROR = Object.freeze(['facepalm', 'huff', 'slump', 'shrug']);
const NAMES = Object.freeze(['big', 'phew', ...SUCCESS, ...ERROR]);
// A long turn: past this, finishing it is worth more than the usual hop.
const BIG_TURN_MS = 8 * 60 * 1000;
// Misses in a row before a green turn is a comeback.
const COMEBACK_AFTER = 2;

// What suits each temperament (voice.js temperamentOf). null is his old move,
// in every list so the familiar one still comes round.
const SUITS = Object.freeze({
  chipper: { success: [null, 'dance', 'spin'], error: [null, 'shrug'] },
  fussy: { success: [null, 'pump'], error: ['huff', 'facepalm'] },
  cocky: { success: ['pump', 'spin', null], error: ['shrug', null] },
  sleepy: { success: [null, 'dance'], error: ['slump', null] },
});
const ANY = { success: [null, ...SUCCESS], error: [null, ...ERROR] };

/**
 * pick(state, { temperament, durationMs, missesBefore, rand }) -> a flourish
 * name, or null for his usual move (and for any state but success and error).
 * missesBefore: failed turns in a row on that conversation before this one.
 */
function pick(state, { temperament = null, durationMs = 0, missesBefore = 0, rand = Math.random } = {}) {
  if (state !== 'success' && state !== 'error') return null;
  if (state === 'success' && missesBefore >= COMEBACK_AFTER) return 'phew';
  if (state === 'success' && durationMs >= BIG_TURN_MS) return 'big';
  const list = (Object.hasOwn(SUITS, temperament) ? SUITS[temperament] : ANY)[state];
  return list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
}

module.exports = { pick, NAMES, BIG_TURN_MS, COMEBACK_AFTER };
