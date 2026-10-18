// Who made this release, for src/community/credits.json (src/main/credits.js):
// the GitHub logins of merged pull requests' authors since the last tag, and
// the makers of packs in the gallery. `npm run release:cut` runs it before it
// writes the release commit; it only ever adds people.
//
// Where the logins come from, in order of trust:
//   - a merge commit's subject, "Merge pull request #12 from octo/branch": octo
//   - a squash merge's "(#12)": the pull request's author, from the GitHub API
//     with the maintainer's token (GITHUB_TOKEN, or `gh auth token`)
//   - authors and Co-authored-by trailers with a GitHub noreply address
//     (12345+octo@users.noreply.github.com)
//   - the gallery's index.json, whose optional `by` is the login of the pull
//     request that added each pack (registry.js fetchRegistryIndex)
// Bots ([bot]) never count.
const { execFileSync } = require('child_process');
const credits = require('../../src/main/credits');
const { fetchRegistryIndex, REGISTRY_URL } = require('../../src/main/registry');

const REPO = 'x-salmon/shellby';
const LOGIN_RE = credits.LOGIN_RE;
const NOREPLY_RE = /^(?:\d+\+)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))@users\.noreply\.github\.com$/i;
const MERGE_RE = /^Merge pull request #(\d+) from ([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\//;
const SQUASH_RE = /\(#(\d+)\)\s*$/;
const TRAILER_RE = /^co-authored-by:.*<([^>]+)>\s*$/gim;
const MAX_LOOKUPS = 200;

const isBot = login => /\[bot\]$|-bot$|^dependabot$|^github-actions$/i.test(login);

/**
 * `git log` with %H %s %ae %b split by \x1f, commits by \x1e, into what it
 * says about who wrote them. Pure.
 * -> { logins: [login], prs: [number] }  (prs: squash merges still to look up)
 */
function fromLog(out) {
  const logins = new Set();
  const prs = new Set();
  for (const rec of String(out || '').split('\x1e')) {
    const [sha, subject = '', email = '', body = ''] = rec.replace(/^\s+/, '').split('\x1f');
    if (!sha) continue;
    const merged = MERGE_RE.exec(subject);
    if (merged) { logins.add(merged[2]); continue; }
    const squash = SQUASH_RE.exec(subject);
    if (squash) prs.add(Number(squash[1]));
    const own = NOREPLY_RE.exec(email.trim());
    if (own) logins.add(own[1]);
    for (const m of body.matchAll(TRAILER_RE)) { const co = NOREPLY_RE.exec(m[1].trim()); if (co) logins.add(co[1]); }
  }
  return { logins: [...logins].filter(l => LOGIN_RE.test(l) && !isBot(l)).sort(), prs: [...prs].sort((a, b) => a - b) };
}

/** The maintainer's token: GITHUB_TOKEN, or the gh CLI's. Null without one. */
function token(env = process.env) {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}

/** The authors of these pull requests, from the GitHub API. Unreadable ones are skipped. */
async function prAuthors(prs, { fetchImpl = globalThis.fetch, auth = token(), api = 'https://api.github.com' } = {}) {
  const out = new Set();
  for (const n of prs.slice(0, MAX_LOOKUPS)) {
    try {
      const res = await fetchImpl(`${api}/repos/${REPO}/pulls/${n}`, { headers: { accept: 'application/vnd.github+json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) } });
      if (!res.ok) continue;
      const pr = await res.json();
      const login = pr?.user?.login;
      if (pr?.merged_at && typeof login === 'string' && LOGIN_RE.test(login) && !isBot(login)) out.add(login);
    } catch { /* offline: that one waits for the next release */ }
  }
  return [...out].sort();
}

/** The gallery's pack makers, from the index's `by`: [{ login, packs }]. */
async function packMakers({ baseUrl = REGISTRY_URL, fetchImpl = globalThis.fetch } = {}) {
  const r = await fetchRegistryIndex({ baseUrl, fetchImpl });
  if (!r.ok) return { ok: false, makers: [], error: r.errors[0] };
  const by = new Map();
  for (const p of r.packs) if (p.by && !isBot(p.by)) by.set(p.by.toLowerCase(), { login: p.by, packs: [...(by.get(p.by.toLowerCase())?.packs || []), p.id] });
  return { ok: true, makers: [...by.values()] };
}

/**
 * Everything together, onto what credits.json already has. Never removes.
 *   log: git log output (see fromLog); deps: { prAuthors, packMakers } for tests
 * -> { credits, added: [{ login, for }], notes: [string] }
 */
async function gather(existing, log, deps = {}) {
  const notes = [];
  const fromGit = fromLog(log);
  const lookedUp = fromGit.prs.length ? await (deps.prAuthors || prAuthors)(fromGit.prs) : [];
  const packs = await (deps.packMakers || packMakers)();
  if (!packs.ok) notes.push(`The gallery's index couldn't be read (${packs.error}), so no pack makers were added.`);
  let next = credits.normalize(existing);
  for (const login of [...fromGit.logins, ...lookedUp]) next = credits.add(next, login, 'code');
  for (const m of packs.makers) next = credits.add(next, m.login, 'pack', m.packs);
  const before = new Map(credits.normalize(existing).people.map(p => [p.login.toLowerCase(), p]));
  const added = next.people.filter(p => JSON.stringify(before.get(p.login.toLowerCase())) !== JSON.stringify(p))
    .map(p => ({ login: p.login, for: [...p.for.filter(r => !(before.get(p.login.toLowerCase())?.for || []).includes(r)), ...p.packs.filter(id => !(before.get(p.login.toLowerCase())?.packs || []).includes(id)).map(id => `pack ${id}`)] }));
  return { credits: next, added, notes };
}

/** git log since `tag` (or everything), in fromLog's shape. */
function logSince(root, tag) {
  const range = tag ? [`refs/tags/${tag}..HEAD`] : ['HEAD'];
  return execFileSync('git', ['log', '--format=%H%x1f%s%x1f%ae%x1f%b%x1e', ...range], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

module.exports = { fromLog, prAuthors, packMakers, gather, logSince, token, isBot };
