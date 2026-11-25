// npm test: node:test over test/*.test.js, in a temp folder of its own that is
// removed afterwards (see lib/scratch-tmp.js). On CI a TAP copy of the run
// turns each failed test into an annotation (lib/tap-failures.js).
//
//   npm test                          every test
//   npm test -- test/shells.test.js   just these files
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { scratchTmp } = require('./lib/scratch-tmp');
const { tapAnnotations } = require('./lib/tap-failures');

const args = process.argv.slice(2);
const files = args.some(a => !a.startsWith('-')) ? [] : ['test/*.test.js'];
const tmp = scratchTmp('shellby-tests-');
const onCi = !!process.env.GITHUB_ACTIONS;
const tapFile = path.join(tmp.dir, 'run.tap');
const reporters = onCi
  ? ['--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=tap', `--test-reporter-destination=${tapFile}`]
  : ['--test-reporter=spec'];
const r = spawnSync(process.execPath, [
  '--test', ...reporters, '--test-concurrency=4', '--test-timeout=120000', ...files, ...args,
], { stdio: 'inherit', env: { ...process.env, ...tmp.env } });
if (onCi && r.status) {
  try { for (const a of tapAnnotations(fs.readFileSync(tapFile, 'utf8'))) console.log(a); } catch (e) { console.error(`no TAP to annotate from: ${e.message}`); }
}
tmp.remove();
if (r.error) console.error(r.error.message);
process.exit(r.status ?? 1);
