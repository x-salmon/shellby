// Ship it: a conversation's copy, from finished work to a pull request in one
// go. The steps already exist on their own (Run checks, the secret scan before
// a push, Bring it home's commit, the issue flow's pull request); this runs
// them in order and stops at the first one that isn't right, saying what
// would fix it:
//
//   1. the copy has something to ship, and he isn't working in it
//   2. its tests pass (wiring/checks.js gateHome, always on here, asking once
//      per project as Run checks does); red stops unless you say "anyway"
//   3. what's left is committed, named the way Bring it home names it
//   4. the commits are looked over for secrets, the copy's own branch is
//      pushed (never --force) and a pull request is opened against the branch
//      the copy came from (github/pullrequest.js)
//
// The pull request's words come from the work itself: the conversation's
// title, Claude's last reply, the commits, the files and how the checks went.
// Shipping again from the same copy pushes the new commits to the same pull
// request.
//
// Everything that touches git, GitHub or the tab comes in as deps, so
// test/ship.test.js runs it against a real repository and a pretend GitHub.
const checks = require('./checks');
const secretscan = require('./secretscan');

const TITLE_MAX = 120;
const SUMMARY_MAX = 3000;
const MAX_COMMITS = 20;
const MAX_FILES = 30;
const REF = /^(?!-)(?!.*\.\.)[\w./-]{1,200}$/; // as github/pullrequest.js checks a base

const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
// Nobody gets pinged by a pull request Shellby writes: a zero-width joiner after each @.
const noMentions = s => String(s ?? '').replace(/@(?=[\w-])/g, '@‍');
// A file name or commit subject in Markdown: as code, so nothing in it formats.
const asCode = s => `\`${String(s).replace(/`/g, "'")}\``;
// Claude's reply can quote a key it read. One flagged line may be the start of
// more (a private key runs on for lines the scan can't tell apart), so a reply
// with any of it is left out whole.
function summaryOf(reply) {
  const kind = String(reply ?? '').split('\n').map(line => secretscan.lineSecret(line)).find(Boolean);
  return kind ? `(Claude's reply is left out: it had something that looks like ${kind}.)` : reply;
}
// Anything else that slips through: a line the secret scan flags never reaches GitHub.
const scrub =s => String(s ?? '').split('\n').map(line => {
  const kind = secretscan.lineSecret(line);
  return kind ? `(a line left out: it looked like ${kind})` : line;
}).join('\n');
const plural =(n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
const seconds = ms => `${Math.max(1, Math.round((ms || 0) / 1000))}s`;

/**
 * The pull request's title: the conversation's own name when it has a real
 * one, else the only commit's subject, else a plain fallback.
 * @param {string | null | undefined} title  the conversation's title
 * @param {string[]} commits  the copy's commit subjects, newest first
 * @param {string} branch
 */
function prTitle(title, commits, branch) {
  const named = oneLine(title);
  if (named && !/^(untitled|new conversation)$/i.test(named)) return clip(noMentions(named), TITLE_MAX);
  if (commits.length === 1 && oneLine(commits[0])) return clip(noMentions(oneLine(commits[0])), TITLE_MAX);
  return `Work from ${branch}`;
}

/**
 * How the checks went, as a line for the body.
 * @param {any} verdict  checks.js buildVerdict's, or null when none ran
 */
function checksLine(verdict) {
  if (!verdict?.commands?.length) return 'No checks ran: Shellby found no tests in this project.';
  const ran = verdict.commands.map(c => `${asCode(c.cmd)} ${c.ok ? 'passed' : c.timedOut ? 'ran out of time' : 'failed'} (${seconds(c.durationMs)})`);
  // gatePasses also lets through a run that couldn't start for want of its
  // environment (pytest outside its virtualenv): that isn't a pass to claim.
  const head = verdict.status === 'pass' ? '✅ Checks passed'
    : checks.gatePasses(verdict) ? "⚠️ The checks couldn't run on this PC"
      : `❌ ${checks.redHeadline({ status: verdict.status, ...checks.failingOf(verdict) })}, shipped anyway`;
  return `${head}: ${ran.join(', ')}.`;
}

/**
 * The pull request's body, in Markdown.
 * @param {{ summary?: string | null, commits: string[], files: { path: string, added: number | null, removed: number | null }[],
 *   moreFiles?: number, verdict?: any, forced?: boolean }} work
 */
function prBody({ summary, commits, files, moreFiles = 0, verdict = null, forced = false }) {
  const out = [];
  const said = String(summary ?? '').trim();
  if (said) out.push('## Summary', '', noMentions(clip(said, SUMMARY_MAX)), '');
  if (commits.length) {
    out.push('## Commits', '');
    for (const c of commits.slice(0, MAX_COMMITS)) out.push(`- ${asCode(noMentions(oneLine(c)))}`);
    if (commits.length > MAX_COMMITS) out.push(`- …and ${commits.length - MAX_COMMITS} more`);
    out.push('');
  }
  if (files.length) {
    out.push('## Files', '');
    for (const f of files.slice(0, MAX_FILES)) {
      const counts = f.added == null ? 'binary' : `+${f.added} −${f.removed}`;
      out.push(`- ${asCode(f.path)} ${counts}`);
    }
    const more = moreFiles + Math.max(0, files.length - MAX_FILES);
    if (more > 0) out.push(`- …and ${plural(more, 'more file')}`);
    out.push('');
  }
  // Forced is "Ship it anyway", offered only once the checks came back red.
  out.push('## Checks', '', forced && !verdict ? '⚠️ Shipped anyway, past checks that failed.' : checksLine(verdict));
  return out.join('\n').trim();
}

/**
 * `git diff --numstat` -> files with their line counts (null for binary).
 * @param {string} out
 */
function parseNumstat(out) {
  return String(out || '').split('\n').filter(Boolean).map(line => {
    const [a, r, ...rest] = line.split('\t');
    const file = rest.join('\t');
    return { path: file, added: a === '-' ? null : Number(a) || 0, removed: r === '-' ? null : Number(r) || 0 };
  }).filter(f => f.path);
}

/**
 * The copy's work as its branch has it: commit subjects (newest first) and the
 * files changed since it left its base.
 * @param {any} w  the copy (worktrees/index.js)
 * @param {(cwd: string, args: string[], opts?: any) => Promise<{ ok: boolean, out: string, error?: string }>} git
 */
async function describe(w, git) {
  const [log, stat] = await Promise.all([
    git(w.root, ['log', '--format=%s', `${w.base}..${w.branch}`], { timeout: 15000 }),
    git(w.root, ['-c', 'core.quotePath=false', 'diff', '--numstat', `${w.base}...${w.branch}`], { timeout: 15000 }),
  ]);
  const commits = log.ok ? log.out.split('\n').map(oneLine).filter(Boolean) : [];
  const files = stat.ok ? parseNumstat(stat.out) : [];
  return { commits, files };
}

/**
 * Ship a conversation's copy.
 * @param {string} tabId
 * @param {{ draft?: boolean, force?: boolean }} opts  force: past red checks ("Ship it anyway")
 * @param {{
 *   worktreeOf: (tabId: string) => any,
 *   isBusy: (tabId: string) => boolean,
 *   canPr: () => { ok: boolean, error?: string },
 *   status: (w: any) => Promise<any>,
 *   gate: (tabId: string, w: any, o: { check: boolean, force: boolean }) => Promise<any>,
 *   commit: (w: any) => Promise<{ ok: boolean, error?: string }>,
 *   git: (cwd: string, args: string[], opts?: any) => Promise<{ ok: boolean, out: string, error?: string }>,
 *   openPr: (req: { folder: string, title: string, body: string, draft: boolean, base: string }) => Promise<any>,
 *   title: (tabId: string) => string | null | undefined,
 *   reply: (tabId: string) => string | null | undefined,
 *   note: (tabId: string, item: any) => void,
 * }} deps
 * -> { ok: true, url, number, repo, base, branch, draft, existing, green } | { ok: false, error, red?, checks?, fix?, nothing? }
 */
async function shipCopy(tabId, { draft = false, force = false } = {}, deps) {
  const w = deps.worktreeOf(tabId);
  if (!w) return { ok: false, error: 'Ship it works on a conversation with a copy of its own.' };
  // Both go to git as revisions: never as something it could read as an option (History can be edited by hand).
  if (!REF.test(String(w.base)) || !REF.test(String(w.branch))) return { ok: false, error: "That copy's branches have names git can't be trusted with." };
  if (deps.isBusy(tabId)) return { ok: false, error: 'Let him finish first.' };
  const can = deps.canPr();
  if (!can.ok) return { ...can, ok: false };
  const s = await deps.status(w);
  if (!s.ok) return { ok: false, error: s.error };
  if (!s.ahead && !s.uncommitted) return { ok: false, nothing: true, error: `Nothing to ship yet: this copy has no changes that ${w.base} doesn't have.` };

  // The tests, in the copy as it is now. A verdict for exactly these files is reused.
  const gate = await deps.gate(tabId, w, { check: true, force });
  if (!gate.ok) {
    if (!gate.red) return { ok: false, error: gate.error };
    return {
      ok: false, red: true, checks: gate.checks, fix: gate.fix,
      error: `${checks.redHeadline(gate.checks)} on this branch, so nothing was pushed.`,
    };
  }
  // He may have started on something while the tests ran: what passed isn't what would ship.
  if (deps.isBusy(tabId)) return { ok: false, error: 'He started on something new while the tests ran, so nothing was pushed. Ship it once he has finished.' };

  const committed = await deps.commit(w);
  if (!committed.ok) return { ok: false, error: committed.error };
  const { commits, files } = await describe(w, deps.git);
  if (!commits.length) return { ok: false, nothing: true, error: `Nothing to ship yet: this copy has no changes that ${w.base} doesn't have.` };

  const r = await deps.openPr({
    folder: w.path,
    title: scrub(prTitle(deps.title(tabId), commits, w.branch)),
    body: scrub(prBody({ summary: summaryOf(deps.reply(tabId)), commits, files, verdict: gate.verdict || null, forced: force })),
    draft: !!draft,
    base: w.base,
  });
  if (!r.ok) return r;
  const green = gate.verdict?.status === 'pass';
  deps.note(tabId, { kind: 'shipped', url: r.url, number: r.number, repo: r.repo, base: r.base, draft: !!r.draft, existing: !!r.existing, green });
  return { ...r, green };
}

module.exports = { shipCopy, prTitle, prBody, checksLine, parseNumstat, describe, SUMMARY_MAX, MAX_COMMITS, MAX_FILES };
