// How much of src/ the unit tests run, with Node's own coverage, against a
// floor. The floor only moves up: when the number climbs, raise it in
// scripts/coverage-floor.json so the gain can't quietly be lost again. Node
// counts only files a test loaded, and renderer and wiring code is covered by
// the e2e checks, which this can't see. So the number says how well the tested
// files are tested. It is not how much of the app has tests.
//
//   npm run coverage           the tests, the total, and the floor checked
//   npm run coverage -- --md file   also the total as markdown, for CI's summary
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { scratchTmp } = require('./lib/scratch-tmp');

const ROOT = path.join(__dirname, '..');
const LCOV = path.join(ROOT, 'coverage', 'lcov.info');
const FLOOR = path.join(__dirname, 'coverage-floor.json');
// A test that runs a line only sometimes moves the total by a little.
const SLACK = 0.5;

/** The percent of lines an lcov report says ran, to one decimal, and the counts behind it. */
function summarize(lcov) {
  let found = 0;
  let hit = 0;
  for (const line of String(lcov || '').split('\n')) {
    const m = line.match(/^(LF|LH):(\d+)/);
    if (!m) continue;
    if (m[1] === 'LF') found += Number(m[2]);
    else hit += Number(m[2]);
  }
  return { found, hit, percent: found ? Math.round((hit / found) * 1000) / 10 : 0 };
}

/** Whether a percent has fallen below the floor by more than a test's wobble. */
const belowFloor = (percent, floor) => percent < floor - SLACK;

function runTests() {
  fs.mkdirSync(path.dirname(LCOV), { recursive: true });
  const tmp = scratchTmp('shellby-coverage-');
  const r = spawnSync(process.execPath, [
    '--test', '--test-concurrency=4', '--test-timeout=240000',
    '--experimental-test-coverage', '--test-coverage-include=src/**/*.js',
    '--test-reporter=dot', '--test-reporter-destination=stdout',
    '--test-reporter=lcov', `--test-reporter-destination=${LCOV}`,
    'test/*.test.js',
  ], { stdio: 'inherit', cwd: ROOT, env: { ...process.env, ...tmp.env } });
  tmp.remove();
  if (r.error) throw r.error;
  return r.status ?? 1;
}

function main(args) {
  const status = runTests();
  const { found, hit, percent } = summarize(fs.readFileSync(LCOV, 'utf8'));
  const { lines: floor } = JSON.parse(fs.readFileSync(FLOOR, 'utf8'));
  const line = `Unit tests run ${percent}% of the src/ files they load (${hit} of ${found} lines); the floor is ${floor}%.`;
  console.log(`\n${line}`);
  const md = args[args.indexOf('--md') + 1];
  if (args.includes('--md') && md) fs.writeFileSync(md, `### Coverage\n\n${line}\n`);
  if (status) return status;
  if (belowFloor(percent, floor)) {
    console.error('Coverage fell below the floor: add tests for what changed.');
    return 1;
  }
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { belowFloor, summarize };
