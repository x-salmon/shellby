// How a release reaches people: a share of installs at first, more as it ages.
// latest.yml's stagingPercentage is what electron-updater reads, and the
// Rollout workflow (scripts/rollout.js step) raises it on this schedule. GitHub
// skips scheduled runs when it's busy, so the app also works the stage out for
// itself from the release's age (latest.yml's releaseDate) and never waits on
// a run that didn't happen. The file still has the last word on stopping one:
//   no stagingPercentage   everyone (a finished rollout, and every older release)
//   0                      halted, for everyone, whatever its age
//   anything else          at least that much, more once the schedule says so
// No Electron imports: scripts/rollout.js and the tests load it in plain Node.

const HOUR = 60 * 60 * 1000;
const STAGES = [{ after: 0, percent: 10 }, { after: 6, percent: 50 }, { after: 24, percent: 100 }];

/** The stage a release this many hours old should be at. */
function dueAt(hours) {
  let due = STAGES[0].percent;
  for (const s of STAGES) if (hours >= s.after) due = s.percent;
  return due;
}

/**
 * The share of installs a release is out to now. -> a whole percent, or null
 * for everyone. A release date that can't be read leaves the file's number.
 */
function rolloutPercent(info, now = Date.now()) {
  const raw = info?.stagingPercentage;
  if (raw === undefined || raw === null) return null;
  const set = parseInt(raw, 10);
  if (!Number.isFinite(set)) return null; // electron-updater treats a garbled one as everyone, too
  if (set <= 0) return 0;
  const released = Date.parse(info.releaseDate);
  if (!Number.isFinite(released)) return Math.min(set, 100);
  const due = dueAt(Math.max(0, now - released) / HOUR);
  return Math.min(Math.max(set, due), 100);
}

module.exports = { HOUR, STAGES, dueAt, rolloutPercent };
