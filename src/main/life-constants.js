// The clock his life runs on (life.js): how often he looks around, how long a moment lasts.
const SECOND = 1000;
const MINUTE = 60 * SECOND;

const WATCH_MS = 15 * SECOND;       // what's in front, the day, the special days
const TANK_REMARK_GAP = 47 * 60 * SECOND; // how often he even thinks of mentioning his tank
const MIC_MS = 20 * SECOND;         // who has the microphone (a `reg query`)
const LOOK_MS = 280;                // where your cursor is, for his eyes
const HERE_IDLE_S = 90;             // input within this long: you're at your PC, so he's awake
const SCENE_EVERY = { normal: 6 * MINUTE, chatty: 2.5 * MINUTE };
const SCENE_CHANCE = 0.45;          // of an idle habit, once a scene is due, being a scene instead
const RECALL_CHANCE = 0.12;         // of an idle habit bringing up a memory
const NAP_CHECK_MS = 12 * MINUTE;
const NAP_MS = [3 * MINUTE, 6 * MINUTE];
const PRESENT_MS = 2800;            // holding up a find
const DIG_MS = 2600;                // voice.js BITS run this long (critter.js BIT_MS)
const CLUMSY_MS = 1700;             // a trip or a stuck claw, before he owns up to it
const NEAR_PX = 380;                // the cursor counts as "near him" within this

module.exports = { SECOND, MINUTE, WATCH_MS, TANK_REMARK_GAP, MIC_MS, LOOK_MS, HERE_IDLE_S, SCENE_EVERY, SCENE_CHANCE, RECALL_CHANCE, NAP_CHECK_MS, NAP_MS, PRESENT_MS, DIG_MS, CLUMSY_MS, NEAR_PX };
