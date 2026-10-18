// Cut a release from a terminal, the same way the Releases card on a project's
// page does it (src/main/projects/release-git.js): the change notes in
// changes/ gathered into the CHANGELOG (or the commits since the last tag when
// there are none), package.json and the lock bumped, one "X.Y.Z: Title" commit
// and an annotated tag. All on this PC: nothing is pushed.
//
//   npm run release:cut -- [X.Y.Z] "Title"   cut it (the version defaults to the suggested one)
//   npm run release:cut -- --dry-run         say what it would write, change nothing
//   --wait      wait for CI on the pushed branch to finish (stops at the first red job)
//   --skip-ci   cut without CI's word (GitHub unreachable); the release runs every check itself
//   --no-credits  leave src/community/credits.json as it is (normally it gains the
//               authors of merged pull requests since the last tag and the gallery's
//               pack makers, through the GitHub API with GITHUB_TOKEN or gh's token)
//
// It only cuts over code CI has passed: push main first, and it waits for CI
// there (--wait). The release commit only bumps the version and the CHANGELOG,
// so CI's pass on the commit before it counts for it: push main and the tag
// together, and the release builds without rerunning the checks. See CONTRIBUTING.md.
const fs = require('fs');
const path = require('path');
const rg = require('../src/main/projects/release-git');
const credits = require('../src/main/credits');
const gatherCredits = require('./lib/credits-gather');
const R = require('../src/main/projects/releases');
const { git } = require('../src/main/worktrees');
const guard = require('./release-guard');

const ROOT = path.join(__dirname, '..');
const CREDITS = 'src/community/credits.json';

/** argv -> { version, title, dryRun, wait, skipCi }. Pure. */
function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const words = argv.filter(a => !a.startsWith('--'));
  const version = R.isVersion(words[0]) ? words.shift() : null;
  return { version, title: words.join(' ').trim(), dryRun, wait: argv.includes('--wait'), skipCi: argv.includes('--skip-ci') };
}

/**
 * What stops a cut until CI has passed on everything it releases, or null.
 * 0.78.0 was cut over 49 merged commits CI had never run together, and took
 * three CI rounds to ship. state: readRelease's. ci: guard.waitForCi's. Pure.
 */
function ciGate(state, ci) {
  const up = state.upstream;
  if (!up) return 'This branch has no upstream, so CI has never run on it. Push it (git push -u origin <branch>), then cut once CI is green.';
  if (up.ahead) return `${up.ahead} commit${up.ahead === 1 ? '' : 's'} on this branch aren't pushed, so CI hasn't checked ${up.ahead === 1 ? 'it' : 'them'}. git push, then cut with --wait to wait for CI.`;
  if (ci?.state === 'green') return null;
  if (ci?.state === 'running' || ci?.state === 'missing') return `${ci.problem} Cut with --wait to wait for it.`;
  return ci?.problem || "Couldn't tell whether CI passed.";
}

/**
 * The credits.json this release ships: what's there, plus merged pull
 * requests' authors since `tag` and the gallery's pack makers (lib/credits-gather.js).
 * -> [{ name, text }] for cutRelease's `extra`, empty when nobody is new.
 */
async function creditsFile(tag, { dryRun = false, skip = false } = {}) {
  if (skip) return [];
  const file = path.join(ROOT, CREDITS);
  const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
  const g = await gatherCredits.gather(existing, gatherCredits.logSince(ROOT, tag));
  for (const n of g.notes) console.log(n);
  if (!g.added.length) { console.log('Credits: nobody new.\n'); return []; }
  console.log(`Credits${dryRun ? ' (it would add)' : ''}: ${g.added.map(a => `@${a.login} (${a.for.join(', ')})`).join(', ')}\n`);
  return [{ name: CREDITS, text: credits.toText(g.credits, existing.note) }];
}

async function main(argv) {
  const { version: asked, title, dryRun, wait, skipCi } = parseArgs(argv);
  const state = await rg.readRelease(ROOT, { git });
  if (!state.ok) throw new Error(state.error);
  const blocked = rg.blocker(state);
  if (blocked && !dryRun) throw new Error(blocked);
  if (!dryRun && !skipCi) {
    const ci = state.upstream && !state.upstream.ahead
      ? await guard.waitForCi(state.head, { wait }).catch(e => ({ state: 'unknown', problem: `${e.message} Cut with --skip-ci to go without it.` }))
      : null;
    const stop = ciGate(state, ci);
    if (stop) throw new Error(stop);
  }
  const version = asked || state.next.suggested;
  const from = state.notes.length ? `${state.notes.length} change note${state.notes.length === 1 ? '' : 's'}` : `${state.total} commit${state.total === 1 ? '' : 's'} (no change notes)`;
  console.log(`${version} (${state.next.bump}: ${state.next.why}), from ${from} since ${state.last?.tag || 'the start'}.\n`);
  if (state.changelog.hasEntry && version === state.next.suggested) console.log(`${state.changelog.name} already has an entry for ${version}; it goes in as it is.\n`);
  else console.log(`${R.entryText({ style: state.changelog.style, version, title, date: state.draft.date, notes: state.draft.notes })}`);
  if (dryRun && blocked) console.log(`For real, it would stop here: ${blocked}`);
  if (!dryRun && !title && state.changelog.style === 'titled') throw new Error('Give the release a title: npm run release:cut -- X.Y.Z "Title"');

  // Who made it: merged pull requests' authors and the gallery's pack makers, into credits.json (src/main/credits.js).
  const extra = await creditsFile(state.last?.tag || null, { dryRun, skip: argv.includes('--no-credits') });
  if (dryRun) return;
  const r = await rg.cutRelease(ROOT, { version, title, notes: state.draft.notes, head: state.head, push: false, extra }, { git });
  if (!r.ok) throw new Error(r.error);
  console.log(`Committed and tagged ${r.tag} at ${r.commit.slice(0, 7)}. Next, the branch and the tag together:`);
  console.log(`  git push --atomic origin ${state.branch} ${r.tag}`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(e => {
    console.error(`Not cut: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, ciGate };
