// npm test: node:test over test/*.test.js, in a temp folder of its own that is
// removed afterwards (see lib/scratch-tmp.js).
//
//   npm test                          every test
//   npm test -- test/shells.test.js   just these files
const { spawnSync } = require('child_process');
const { scratchTmp } = require('./lib/scratch-tmp');

const args = process.argv.slice(2);
const files = args.some(a => !a.startsWith('-')) ? [] : ['test/*.test.js'];
const tmp = scratchTmp('shellby-tests-');
const r = spawnSync(process.execPath, [
  '--test', '--test-reporter=spec', '--test-concurrency=4', '--test-timeout=120000', ...files, ...args,
], { stdio: 'inherit', env: { ...process.env, ...tmp.env } });
tmp.remove();
if (r.error) console.error(r.error.message);
process.exit(r.status ?? 1);
