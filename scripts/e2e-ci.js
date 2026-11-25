// The end-to-end checks that CI can run: no Claude account, no GitHub sign-in,
// no network. Each one drives the real app over CDP with the fake Claude CLI,
// so this is the only automated coverage the renderer and main's wiring get.
//
//   node scripts/e2e-ci.js              all of them
//   node scripts/e2e-ci.js queue voice  just the ones whose name contains these
//   node scripts/e2e-ci.js --shard=2/6  the second of six shards that take about as long
//
// They run one at a time on purpose: each launches its own Electron and some
// share hook ports. CI splits them across machines with --shard instead.
//
// A script is one of these checks when its first line says what it covers:
// `// ci: queued messages: queue, edit, drain, stop`. Each check names itself,
// so adding one touches no shared list that every branch would merge over.
// Everything else in scripts/ needs a real Claude account, a real GitHub or the
// live registry, and stays a manual check (see docs/DEVELOPMENT.md).
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { scratchTmp } = require('./lib/scratch-tmp');

const CI_MARK = /^\/\/ ci: \S/;

/** The checks in `dir`: scripts whose first line is a `// ci:` mark, by name. Sorted, so every machine shards alike. */
function discover(dir = __dirname) {
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.js') && f !== path.basename(__filename))
    .filter(f => CI_MARK.test(fs.readFileSync(path.join(dir, f), 'utf8').split('\n', 1)[0]))
    .map(f => f.slice(0, -3))
    .sort();
}
const SUITE = discover();

const TIMEOUT_MS = 5 * 60 * 1000;

// Seconds each check took on CI (scripts/e2e-times.js writes it), to split the
// shards by time: by name, one ran 7.2 minutes while another was done in 3.6.
const TIMES = (() => { try { return require('./e2e-times.json'); } catch { return {}; } })();

/**
 * Splits checks into n shards that take about as long: the slowest first, each
 * onto the shard with the least so far. A check with no time yet counts as a
 * typical one. Ties go by name, so every machine splits alike. Pure.
 */
function balance(checks, n, times = TIMES) {
  const known = checks.map(c => times[c]).filter(Number.isFinite).sort((a, b) => a - b);
  const typical = known.length ? known[Math.floor(known.length / 2)] : 1;
  const secs = c => (Number.isFinite(times[c]) ? times[c] : typical);
  const shards = Array.from({ length: n }, () => ({ checks: [], secs: 0 }));
  for (const c of [...checks].sort((a, b) => secs(b) - secs(a) || (a < b ? -1 : a > b ? 1 : 0))) {
    const s = shards.reduce((min, x) => (x.secs < min.secs ? x : min));
    s.checks.push(c);
    s.secs += secs(c);
  }
  return shards.map(s => s.checks.sort());
}

/**
 * The checks to run: those whose name contains a word asked for (all, with
 * none), then, with --shard=i/n, the ith of n shards balanced by how long each
 * check takes on CI (balance).
 * -> { suite } | { error }. Pure.
 */
function pick(all, args, times = TIMES) {
  const wanted = args.filter(a => !a.startsWith('-'));
  const shardArg = args.find(a => a.startsWith('--shard'));
  const m = shardArg && /^--shard=(\d+)\/(\d+)$/.exec(shardArg);
  if (shardArg && (!m || +m[1] < 1 || +m[1] > +m[2])) return { error: `${shardArg}: use --shard=i/n, with i from 1 to n` };
  const matched = wanted.length ? all.filter(s => wanted.some(w => s.includes(w))) : all;
  if (!matched.length) return { error: `No checks match ${wanted.join(', ')}. Known: ${all.join(', ')}` };
  const suite = m ? balance(matched, +m[2], times)[+m[1] - 1] : matched;
  // Green with nothing run would read as a pass.
  if (!suite.length) return { error: `${shardArg} of ${matched.length} check${matched.length === 1 ? '' : 's'} leaves this shard none to run` };
  return { suite };
}

/**
 * PowerShell that stops what a check left running: every process descended
 * from the check's own (`rootPid`, gone by now), started since `sinceMs`. A
 * check that times out is killed alone, and its Electron and helpers carry on,
 * dozens of them by the end of a run. Windows keeps an orphan's parent pid, so
 * the tree can still be walked; the start time keeps most reused pids out of
 * it. In case one gets in anyway, a process is only stopped if it's also this
 * checkout's: its program is in the checkout (Electron, in node_modules), or
 * it's node running one of the checkout's files (the fake Claude CLI). Prints
 * the pids it stopped. Pure.
 */
function reapScript({ rootPid, sinceMs, root = path.join(__dirname, '..') }) {
  const q = s => `'${String(s).replace(/'/g, "''")}'`;
  return [
    `$since = [DateTimeOffset]::FromUnixTimeMilliseconds(${Number(sinceMs)}).LocalDateTime`,
    `$root = ${q(path.resolve(root) + path.sep)}`,
    '$all = @(Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -ge $since })',
    '$keep = New-Object System.Collections.Generic.HashSet[int]',
    `[void]$keep.Add(${Number(rootPid)})`,
    'for ($i = 0; $i -lt 8; $i++) { foreach ($p in $all) { if ($keep.Contains([int]$p.ParentProcessId)) { [void]$keep.Add([int]$p.ProcessId) } } }',
    `[void]$keep.Remove(${Number(rootPid)})`,
    '$ours = { param($p) ($p.ExecutablePath -and $p.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) -or',
    '  ($p.Name -eq \'node.exe\' -and $p.CommandLine -and $p.CommandLine.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0) }',
    'foreach ($p in $all) { if ($keep.Contains([int]$p.ProcessId) -and (& $ours $p)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; $p.ProcessId } }',
  ].join('\n');
}

/**
 * What a check's runs add up to: 'pass' when every run passed, 'fail' when
 * none did, 'flaky' when it went both ways on the same code. Pure.
 */
function verdict(oks) {
  if (!oks.length) return 'fail';
  if (oks.every(Boolean)) return 'pass';
  return oks.some(Boolean) ? 'flaky' : 'fail';
}

/** --repeat=N: run each check N times to find flaky ones (1, with none). -> { repeat } | { error }. Pure. */
function repeatOf(args) {
  const a = args.find(x => x.startsWith('--repeat'));
  if (!a) return { repeat: 1 };
  const m = /^--repeat=(\d+)$/.exec(a);
  if (!m || +m[1] < 1 || +m[1] > MAX_REPEAT) return { error: `${a}: use --repeat=N, with N from 1 to ${MAX_REPEAT}` };
  return { repeat: +m[1] };
}
const MAX_REPEAT = 20;

// Each check gets free ports fetch can reach (E2E_CDP_PORT, E2E_HOOK_PORT,
// E2E_SPARE_PORT; lib/open-port.js), so two runs at once (two worktrees, two agents) never meet
// on a check's fixed port. A check run by hand falls back to its own.
const PORT_ENVS = ['E2E_CDP_PORT', 'E2E_HOOK_PORT', 'E2E_SPARE_PORT'];
const OPEN_PORT_JS = path.join(__dirname, 'lib', 'open-port.js');

/** Distinct free ports, one per PORT_ENVS name, as env. {} when they can't be had (the checks' own ports then). */
function freePortEnv() {
  const r = spawnSync(process.execPath, [OPEN_PORT_JS, String(PORT_ENVS.length)], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  const ports = String(r.stdout || '').trim().split(/\s+/).map(Number);
  if (ports.length !== PORT_ENVS.length || !ports.every(p => Number.isInteger(p) && p > 0)) return {};
  return Object.fromEntries(PORT_ENVS.map((k, i) => [k, String(ports[i])]));
}

/** Stop what a check (its pid, and when it started) left behind. -> how many. */
function reap(rootPid, sinceMs) {
  if (process.platform !== 'win32' || !Number.isInteger(rootPid)) return 0;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', reapScript({ rootPid, sinceMs })], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  return String(r.stdout || '').split(/\s+/).filter(s => /^\d+$/.test(s)).length;
}

// A failing check's last lines, as a GitHub error annotation. Annotations are
// readable without signing in (the job's log isn't), so a red shard says why.
const ANNOTATION_FAILS = 15; // its FAIL lines first, wherever they were
const ANNOTATION_LINES = 15; // then how it ended
const ANNOTATION_CHARS = 4000;

/** `::error` workflow command for a failed check: its FAIL lines and last lines, escaped. */
function failureAnnotation(name, output) {
  const lines = String(output || '').split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean);
  const end = lines.slice(-ANNOTATION_LINES);
  const fails = lines.slice(0, -ANNOTATION_LINES).filter(l => /^\s*FAIL\s/.test(l)).slice(0, ANNOTATION_FAILS);
  const tail = [...fails, ...(fails.length ? ['...'] : []), ...end].join('\n').slice(-ANNOTATION_CHARS);
  const esc = s => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const title = name.replace(/[,:%\r\n]/g, ' ');
  return `::error title=e2e ${title} failed::${esc(tail || '(no output)')}`;
}

if (require.main !== module) {
  module.exports = { SUITE, PORT_ENVS, discover, pick, balance, reap, reapScript, verdict, repeatOf, freePortEnv, failureAnnotation };
  return;
}

const args = process.argv.slice(2);
const picked = pick(SUITE, args.filter(a => !a.startsWith('--repeat') && !a.startsWith('--report')));
const repeated = repeatOf(args);
if (picked.error || repeated.error) {
  console.error(picked.error || repeated.error);
  process.exit(2);
}
const { suite } = picked;
const { repeat } = repeated;
// --report=file.json: each check's verdict and runs, for the nightly flaky hunt.
const reportArg = args.find(a => a.startsWith('--report='));
const reportFile = reportArg && reportArg.slice('--report='.length);

// Each check launches and kills its own Electron, and Windows takes a moment to
// let go of the profile, the ports and the GPU cache. Without a gap, a later
// check occasionally finds no window and sits there until its timeout.
//
// Synchronous on purpose (this script is a spawnSync pipeline, not async), and
// Atomics.wait rather than a spin loop so the gap is idle rather than a busy core.
const sleep = ms => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

const SETTLE_MS = 2000;   // after the last Electron goes
const MAX_WAIT_MS = 20000; // ...but never hang on someone else's Electron
const CI_OUTPUT_MAX = 64 * 1024 * 1024; // a check's caught output on CI, well past any real one

// Wait for the Electrons to actually be gone rather than guessing at a duration.
// Capped, because another window on the machine (a dev run, another session's
// checks) is not ours to wait for.
function settle() {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const r = process.platform === 'win32'
      ? spawnSync('tasklist', ['/FI', 'IMAGENAME eq electron.exe', '/NH'], { encoding: 'utf8' })
      : spawnSync('/usr/bin/pgrep', ['-x', 'Electron'], { encoding: 'utf8' });
    if (!/electron\.exe|^\d+/im.test(r.stdout || '')) break;
    sleep(1000);
  }
  sleep(SETTLE_MS);
}

const run = (name, attempt) => {
  const script = path.join(__dirname, `${name}.js`);
  console.log(`\n${'='.repeat(70)}\n  ${name}${attempt > 1 ? `  (attempt ${attempt})` : ''}\n${'='.repeat(70)}`);
  const started = Date.now();
  const tmp = scratchTmp('shellby-e2e-');
  const env = { ...process.env, ...freePortEnv(), ...tmp.env, SHELLBY_E2E: '1' }; // SHELLBY_E2E: see src/main/test-desktop.js
  // On CI the output is caught (then printed) so a failure can be annotated;
  // run by hand it streams as it comes.
  const onCi = !!process.env.GITHUB_ACTIONS;
  const r = spawnSync(process.execPath, [script], onCi
    ? { stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: CI_OUTPUT_MAX, timeout: TIMEOUT_MS, env }
    : { stdio: 'inherit', timeout: TIMEOUT_MS, env });
  if (onCi) { process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || ''); }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const ok = !r.error && r.status === 0;
  const why = r.error ? r.error.message : r.status === null ? `killed (${r.signal})` : `exit ${r.status}`;
  // How it ended goes last: a check killed at the timeout on a Mac loses what it
  // printed (its pipe writes are async), so that may be all there is to say.
  if (onCi && !ok) console.log(failureAnnotation(`${name}${attempt > 1 ? ` (attempt ${attempt})` : ''}`, `${r.stdout || ''}\n${r.stderr || ''}\n[${why} after ${secs}s]`));
  console.log(`\n--- ${name}: ${ok ? 'PASS' : 'FAIL'} in ${secs}s`);
  const left = reap(r.pid, started);
  if (left) console.log(`--- ${name} left ${left} process${left === 1 ? '' : 'es'} running; stopped them`);
  tmp.remove(); // after the reap: a leftover Electron holds files in it
  return { ok, secs, why };
};

/**
 * One check, once: one retry, reported as such. These drive a real UI, and a
 * check that only passes on the second go is a problem of its own, but not a
 * reason to fail the build, and hiding it entirely would be worse than naming it.
 */
function once(name) {
  let r = run(name, 1);
  const runs = [r.ok];
  if (!r.ok) {
    settle();
    const again = run(name, 2);
    runs.push(again.ok);
    if (again.ok) r = again;
  }
  settle();
  return { name, ...r, runs, flaky: verdict(runs) === 'flaky' };
}

/**
 * --repeat=N, the flaky hunt: every check runs N times on the same code, with
 * no retry, so any mix of pass and fail is a flake. Fails if any flaked.
 */
function hunt(name) {
  const all = [];
  for (let i = 1; i <= repeat; i++) { all.push(run(name, i)); settle(); }
  const runs = all.map(r => r.ok);
  const v = verdict(runs);
  const last = all.findLast(r => !r.ok) || all[all.length - 1];
  return { name, ...last, ok: v === 'pass', runs, flaky: v === 'flaky' };
}

const results = suite.map(name => (repeat > 1 ? hunt(name) : once(name)));

console.log(`\n${'='.repeat(70)}`);
const passes = r => `${r.runs.filter(Boolean).length}/${r.runs.length} passed`;
for (const r of results) {
  const mark = r.flaky ? 'FLAKY' : r.ok ? 'PASS ' : 'FAIL ';
  const note = r.flaky ? `  (${repeat > 1 ? passes(r) : 'failed once, passed on retry'})` : r.ok ? '' : `  (${r.why})`;
  console.log(`  ${mark} ${r.name.padEnd(18)} ${r.secs}s${note}`);
}
const failed = results.filter(r => !r.ok);
const flaky = results.filter(r => r.flaky);
console.log('='.repeat(70));
if (flaky.length) console.log(`${flaky.length} flaky: ${flaky.map(f => `${f.name} (${passes(f)})`).join(', ')}`);
// A pass on the second go keeps the build green, so say so where a PR shows it.
if (process.env.GITHUB_ACTIONS) for (const f of flaky) console.log(`::warning title=Flaky e2e check::${f.name} (${passes(f)})`);
console.log(failed.length ? `${failed.length} of ${results.length} FAILED: ${failed.map(f => f.name).join(', ')}` : `all ${results.length} passed`);
if (reportFile) {
  const report = results.map(r => ({ name: r.name, verdict: r.flaky ? 'flaky' : r.ok ? 'pass' : 'fail', runs: r.runs, why: r.ok ? null : r.why }));
  fs.writeFileSync(reportFile, JSON.stringify({ repeat, results: report }, null, 2) + '\n');
}
process.exit(failed.length ? 1 : 0);
