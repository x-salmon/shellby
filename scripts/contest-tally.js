// Count a month's crab contest (docs/COMMUNITY.md). Maintainer only, not
// shipped in the app, and not CI: votes guide, the maintainer decides among
// the top three, so this only prints.
//
//   GITHUB_TOKEN=... node scripts/contest-tally.js 2026-11      (or npm run contest:tally -- 2026-11)
//
// It reads the month's posts in the "Contest entries" Discussions category on
// x-salmon/shellby (GraphQL, with GITHUB_TOKEN or the gh CLI's token), finds
// each one's pack by its shellby://install?pack= link, and joins it to the
// gallery's index (registry.js fetchRegistryIndex: the pack's `contest` month
// and `by`). Dropped, with the reason: a post with no pack link, a pack that
// didn't merge into the gallery for that month, someone else's pack, a post
// after the 21st, and a second entry from the same person (the first counts).
// What's left is ranked by upvotes, ties to the earlier post, top ten shown.
// GitHub doesn't say who upvoted, so the rules ask entrants not to count their
// own, and the maintainer's pick among the top three settles it.
const { fetchRegistryIndex, REGISTRY_URL } = require('../src/main/registry');
const { token } = require('./lib/credits-gather');
const { monthName } = require('../src/main/credits');

const OWNER = 'x-salmon';
const NAME = 'shellby';
const CATEGORY = 'contest-entries';
const LAST_ENTRY_DAY = 21;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const PACK_LINK_RE = /shellby:(?:\/\/)?install\?pack=([a-z0-9][a-z0-9-]{1,39})\b/;
const TOP = 10;

/**
 * The month's entries, checked and ranked. Pure.
 *   discussions: [{ number, title, url, upvoteCount, createdAt, body, author: { login } }]
 *   packs: the index's entries, [{ id, name, by, contest }]
 * -> { ranked: [{ number, title, url, votes, login, pack, packName }], dropped: [{ number, url, why }] }
 */
function tally(discussions, packs, month) {
  const m = MONTH_RE.exec(month || '');
  if (!m) throw new Error('Give the month as YYYY-MM, like 2026-11.');
  const from = Date.UTC(Number(m[1]), Number(m[2]) - 1, 1);
  const lastDay = Date.UTC(Number(m[1]), Number(m[2]) - 1, LAST_ENTRY_DAY, 23, 59, 59, 999);
  const byPack = new Map((packs || []).map(p => [p.id, p]));
  const ranked = [], dropped = [];
  const seen = new Map(); // login -> the entry that counts
  const posts = (discussions || []).filter(d => Date.parse(d.createdAt) >= from).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const d of posts) {
    const at = Date.parse(d.createdAt);
    const login = d.author?.login || null;
    const drop = why => dropped.push({ number: d.number, url: d.url, why });
    if (at > Date.UTC(Number(m[1]), Number(m[2]), 1)) continue; // next month's
    if (at > lastDay) { drop(`posted after the ${LAST_ENTRY_DAY}st`); continue; }
    if (!login) { drop('no author (a deleted account)'); continue; }
    const id = PACK_LINK_RE.exec(d.body || '')?.[1];
    if (!id) { drop('no shellby://install?pack= link'); continue; }
    const pack = byPack.get(id);
    if (!pack || pack.contest !== month) { drop(`${id} isn't in the gallery for ${month} (not merged, or no contest field)`); continue; }
    if (pack.by && pack.by.toLowerCase() !== login.toLowerCase()) { drop(`${id} was added by @${pack.by}, not @${login}`); continue; }
    const key = login.toLowerCase();
    if (seen.has(key)) { drop(`@${login}'s second entry (#${seen.get(key)} counts)`); continue; }
    seen.set(key, d.number);
    ranked.push({ number: d.number, title: d.title, url: d.url, votes: Number(d.upvoteCount) || 0, login, pack: id, packName: pack.name || id, at });
  }
  ranked.sort((a, b) => b.votes - a.votes || a.at - b.at);
  return { ranked: ranked.map(({ at: _at, ...r }) => r), dropped };
}

/** The report, as printed. Pure. */
function report(month, { ranked, dropped }) {
  const lines = [`Crab contest, ${monthName(month)}: ${ranked.length} entr${ranked.length === 1 ? 'y' : 'ies'} counted, ${dropped.length} dropped.`, ''];
  if (!ranked.length) lines.push('No entries. The winner post says so kindly, and the theme rolls over (docs/COMMUNITY.md).');
  ranked.slice(0, TOP).forEach((r, i) => lines.push(`${String(i + 1).padStart(2)}. ${String(r.votes).padStart(3)} ▲  ${r.packName} (${r.pack}) by @${r.login}  ${r.url}`));
  if (ranked.length) lines.push('', `Pick among the top three, then: npm run contest:ship -- <pack-id> ${month}`);
  if (dropped.length) lines.push('', 'Dropped:', ...dropped.map(d => `  #${d.number}: ${d.why}  ${d.url}`));
  return lines.join('\n');
}

async function graphql(query, variables, auth) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json', accept: 'application/vnd.github+json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.errors?.length) throw new Error(json?.errors?.[0]?.message || `GitHub answered ${res.status}`);
  return json.data;
}

/** Every post in the entries category since `month` began, newest first until older than that. */
async function entries(month, auth) {
  const cat = await graphql('query($o:String!,$n:String!,$s:String!){repository(owner:$o,name:$n){discussionCategory(slug:$s){id}}}', { o: OWNER, n: NAME, s: CATEGORY }, auth);
  const id = cat?.repository?.discussionCategory?.id;
  if (!id) throw new Error(`No "${CATEGORY}" Discussions category on ${OWNER}/${NAME}.`);
  const [y, m] = month.split('-').map(Number);
  const since = Date.UTC(y, m - 1, 1);
  const out = [];
  let after = null;
  for (let page = 0; page < 20; page++) {
    const q = `query($o:String!,$n:String!,$c:ID!,$a:String){repository(owner:$o,name:$n){discussions(first:100,after:$a,categoryId:$c,orderBy:{field:CREATED_AT,direction:DESC}){
      pageInfo{hasNextPage endCursor} nodes{number title url upvoteCount createdAt body author{login}}}}}`;
    const d = (await graphql(q, { o: OWNER, n: NAME, c: id, a: after }, auth)).repository.discussions;
    out.push(...d.nodes);
    if (!d.pageInfo.hasNextPage || d.nodes.some(x => Date.parse(x.createdAt) < since)) break;
    after = d.pageInfo.endCursor;
  }
  return out;
}

async function main(argv) {
  const month = argv.find(a => MONTH_RE.test(a));
  if (!month) throw new Error('Usage: node scripts/contest-tally.js YYYY-MM');
  const auth = token();
  if (!auth) throw new Error('Needs a GitHub token: set GITHUB_TOKEN, or sign in with gh auth login.');
  const index = await fetchRegistryIndex({ baseUrl: process.env.SHELLBY_REGISTRY_URL || REGISTRY_URL });
  if (!index.ok) throw new Error(index.errors[0]);
  console.log(report(month, tally(await entries(month, auth), index.packs, month)));
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(e => {
    console.error(`Not counted: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { tally, report };
