// CI's check that the packaged Mac app starts: launch Shellby.app's binary with
// a profile of its own and the fake Claude CLI, wait for main's "starting" line
// in its log, then quit it. Catches what unit tests can't: a module that fails
// to load inside the asar, koffi's native part missing for the chip, a crash
// before the first window.
//
//   node scripts/mac-smoke.js dist/mac-arm64/Shellby.app
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TIMEOUT_MS = 60000;
const app = process.argv[2];
if (!app) { console.error('usage: node scripts/mac-smoke.js <Shellby.app>'); process.exit(2); }
const exe = path.join(app, 'Contents', 'MacOS', 'Shellby');
if (!fs.existsSync(exe)) { console.error(`no app binary at ${exe}`); process.exit(1); }

// The packaged app keeps its profile in Application Support; a temp HOME keeps this run's apart.
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-smoke-')));
const logDir = path.join(home, 'Library', 'Application Support', 'Shellby', 'logs');
const child = spawn(exe, [], {
  env: { ...process.env, HOME: home, SHELLBY_E2E: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', d => { output += d; });
child.stderr.on('data', d => { output += d; });

function logText() {
  try {
    return fs.readdirSync(logDir).map(f => fs.readFileSync(path.join(logDir, f), 'utf8')).join('\n');
  } catch { return ''; }
}

const started = Date.now();
const timer = setInterval(() => {
  const log = logText();
  const ok = /Shellby \S+ starting/.test(log) || /Shellby \S+ starting/.test(output);
  const exited = child.exitCode !== null;
  if (!ok && !exited && Date.now() - started < TIMEOUT_MS) return;
  clearInterval(timer);
  if (!exited) child.kill('SIGTERM');
  if (ok) {
    console.log(`Shellby started in ${Math.round((Date.now() - started) / 1000)} s`);
    // Anything main logged as an error on the way up is worth seeing, but the start is the check.
    for (const line of log.split('\n').filter(l => /\berror\b/i.test(l)).slice(0, 20)) console.log(`  log: ${line}`);
    process.exit(0);
  }
  console.error(exited ? `Shellby exited (code ${child.exitCode}) before starting` : `Shellby didn't start within ${TIMEOUT_MS / 1000} s`);
  console.error(output.slice(-4000));
  console.error(log.slice(-4000));
  process.exit(1);
}, 500);
