// How much of the world gets a release, and when. electron-updater reads
// stagingPercentage from latest.yml and lets that share of installs update, so
// a bad release reaches some people, not everyone, and setting it to 0 stops it.
//
// A new release starts at the first of STAGES (src/main/rollout-stages.js) and
// climbs on its own (the Rollout workflow steps it every 15 minutes), because a
// release nobody remembered to promote would leave most people behind. Shellby
// itself also works the stage out from the release's age (since 0.96.1's
// successor), so a run GitHub skipped only holds back versions older than that. 0 is a halt: the step leaves it alone
// until someone sets a number by hand. No field at all means everyone, which is
// how a finished rollout ends and what every older release already says.
//
//   node scripts/rollout.js start <latest.yml>   the release workflow, before publishing
//   node scripts/rollout.js set <percent> [tag]  by hand: 0 halts, 100 finishes
//   node scripts/rollout.js step                 every 15 minutes: the next stage, if it's due
//
// The pure parts are tested in test/rollout.test.js. set and step need gh.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The schedule lives with the app, which works the stage out for itself too.
const { HOUR, STAGES, dueAt } = require('../src/main/rollout-stages');

const FIELD = /^stagingPercentage:.*(\r?\n|$)/m;
const UPLOAD_TRIES = 3;

/** The percent latest.yml says, or null when it has none (everyone). */
function percentOf(text) {
  const m = String(text || '').match(/^stagingPercentage:\s*['"]?(\d+)/m);
  return m ? Number(m[1]) : null;
}

/** latest.yml at this percent. 100 drops the field, so finished looks like every older release. */
function withPercent(text, percent) {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error(`A rollout is 0 to 100, not ${percent}.`);
  const bare = String(text || '').replace(FIELD, '');
  if (!/^version:/m.test(bare)) throw new Error("That isn't a latest.yml: it names no version.");
  if (percent === 100) return bare;
  return `${bare.replace(/\s*$/, '')}\nstagingPercentage: ${percent}\n`;
}

/** The percent to move to, or null to leave it: finished, halted, or not due. It never goes down. */
function nextPercent(current, hours) {
  if (current === null || current === 0) return null;
  const due = dueAt(hours);
  return due > current ? due : null;
}

const gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

function readRemote(tag) {
  return gh(['release', 'download', tag, '--pattern', 'latest.yml', '--output', '-']);
}

function upload(tag, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-rollout-'));
  try {
    const file = path.join(dir, 'latest.yml');
    fs.writeFileSync(file, text);
    gh(['release', 'upload', tag, file, '--clobber']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * --clobber deletes before it uploads, and a release with no latest.yml fails
 * every update check, so a failed upload can't just stop there: try again, then
 * put back what was there. Reading it back catches an upload that said it worked.
 *   io: { put(text), get() -> text }
 */
function replaceSafely(io, text, previous, tries = UPLOAD_TRIES) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      io.put(text);
      if (io.get() === text) return;
      last = new Error("what's on the release isn't what was uploaded");
    } catch (e) {
      last = e;
    }
  }
  io.put(previous); // if this throws too, the run goes red with the release's file at risk
  throw new Error(`latest.yml put back as it was, the change didn't land: ${last.message}`);
}

function writeRemote(tag, text, previous) {
  replaceSafely({ put: t => upload(tag, t), get: () => readRemote(tag) }, text, previous);
}

function latestRelease() {
  return JSON.parse(gh(['release', 'view', '--json', 'tagName,publishedAt']));
}

function start(file) {
  fs.writeFileSync(file, withPercent(fs.readFileSync(file, 'utf8'), STAGES[0].percent));
  console.log(`${file}: rollout starts at ${STAGES[0].percent}%`);
}

/** A percent as typed. Strict, because Number(' ') is 0, and 0 halts a release. */
function parsePercent(text) {
  if (!/^\d{1,3}$/.test(String(text))) throw new Error(`A rollout is 0 to 100, not "${text}".`);
  return Number(text);
}

function set(percentText, tagArg) {
  const percent = parsePercent(percentText);
  const tag = tagArg || latestRelease().tagName;
  const text = readRemote(tag);
  writeRemote(tag, withPercent(text, percent), text);
  console.log(`${tag}: rollout set to ${percent}%`);
}

function step() {
  const { tagName, publishedAt } = latestRelease();
  const text = readRemote(tagName);
  const current = percentOf(text);
  const hours = (Date.now() - new Date(publishedAt).getTime()) / HOUR;
  const next = nextPercent(current, hours);
  if (next === null) return console.log(`${tagName}: staying at ${current === null ? '100' : current}% (${hours.toFixed(1)} h old)`);
  writeRemote(tagName, withPercent(text, next), text);
  console.log(`${tagName}: rollout moved from ${current}% to ${next}%`);
}

function main([command, a, b]) {
  if (command === 'start' && a) return start(a);
  if (command === 'set' && a) return set(a, b);
  if (command === 'step') return step();
  throw new Error('Use: rollout.js start <latest.yml> | set <percent> [tag] | step');
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`rollout: ${e.message}`);
    process.exit(1);
  }
}

module.exports = { STAGES, percentOf, withPercent, dueAt, nextPercent, parsePercent, replaceSafely };
