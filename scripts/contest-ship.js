// Ship a crab contest's winner (docs/COMMUNITY.md): the winning skin goes from
// the community gallery into src/wardrobe/contest.json, the built-in pack of
// every winner, open to everyone with no unlock, marked `won: "YYYY-MM"` so its
// tile says "🏆 by <author>, November 2026". The winner goes into
// src/community/credits.json (src/main/credits.js), which unlocks their 🏆
// Contest Champion trophy, and a change note names them in the next CHANGELOG.
// CC BY 4.0 asks for attribution: the tile, the credits and the CHANGELOG are it.
//
//   npm run contest:ship -- <pack-id> <YYYY-MM> [--skin <id>] [--login <github login>] [--dry-run]
//
// The pack is fetched the way Shellby installs one (registry.js: only from the
// gallery, checked against the index's sha256) and checked as a pack. The
// login comes from the index's `by` (the pull request that added it) unless
// --login names one. Run it on a branch before release:cut; nothing is pushed.
const fs = require('fs');
const path = require('path');
const { fetchRegistryPack, fetchRegistryIndex, REGISTRY_URL } = require('../src/main/registry');
const { validatePack } = require('../src/main/wardrobe/catalog');
const { KNOWN_ACHIEVEMENTS } = require('../src/main/wardrobe/achievements');
const { KNOWN_SEASONS } = require('../src/main/wardrobe/seasons');
const credits = require('../src/main/credits');

const ROOT = path.join(__dirname, '..');
const CONTEST = path.join(ROOT, 'src', 'wardrobe', 'contest.json');
const CREDITS = path.join(ROOT, 'src', 'community', 'credits.json');
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const SKIN_FIELDS = ['name', 'author', 'description', 'palette', 'parts', 'pixels', 'anchors'];

/** argv -> { packId, month, skin, login, dryRun }. Pure. */
function parseArgs(argv) {
  const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] || null : null; };
  const words = argv.filter((a, i) => !a.startsWith('--') && !['--skin', '--login'].includes(argv[i - 1]));
  return { packId: words[0] || null, month: words[1] || null, skin: opt('--skin'), login: opt('--login'), dryRun: argv.includes('--dry-run') };
}

/**
 * The winner, into the contest pack, the credits and a change note. Pure.
 *   contestJson: src/wardrobe/contest.json as parsed; creditsJson: credits.json as parsed
 *   packJson: the winning pack as parsed (already checked against the registry's sha256)
 * -> { ok: true, contest, credits, note, skin } | { ok: false, error }
 */
function ship({ contestJson, creditsJson, packJson, packId, month, skinId = null, login = null }) {
  if (!MONTH_RE.test(month || '')) return { ok: false, error: 'Give the contest month as YYYY-MM, like 2026-11.' };
  if (!credits.LOGIN_RE.test(login || '')) return { ok: false, error: "Couldn't tell the winner's GitHub login: the gallery's index has no `by` for it. Pass --login <login>." };
  const { pack, errors } = validatePack(packJson, { source: 'user', knownAchievements: KNOWN_ACHIEVEMENTS, knownSeasons: KNOWN_SEASONS });
  if (!pack) return { ok: false, error: `That pack doesn't pass the pack check: ${errors.join('; ')}` };
  const good = new Set(pack.skins.map(s => s.id.split('/').pop()));
  const raw = (packJson.skins || []).filter(s => good.has(s.id));
  const pick = skinId ? raw.find(s => s.id === skinId) : raw[0];
  if (!pick) return { ok: false, error: skinId ? `${packId} has no skin called ${skinId}.` : `${packId} has no skins.` };
  if (!skinId && raw.length > 1) return { ok: false, error: `${packId} has ${raw.length} skins (${raw.map(s => s.id).join(', ')}). Say which won with --skin <id>.` };

  const id = `contest-${month}`;
  const skins = Array.isArray(contestJson.skins) ? contestJson.skins : [];
  if (skins.some(s => s.id === id || s.won === month)) return { ok: false, error: `The ${credits.monthName(month)} winner is already in contest.json.` };
  const skin = { id };
  for (const k of SKIN_FIELDS) if (pick[k] !== undefined) skin[k] = pick[k];
  skin.author = String(pick.author || packJson.author || login).slice(0, 40);
  skin.description = `Crab contest winner, ${credits.monthName(month)}. ${String(pick.description || '').trim()}`.trim().slice(0, 120);
  skin.won = month;
  const contest = { ...contestJson, skins: [...skins, skin].sort((a, b) => (a.won < b.won ? -1 : 1)) };
  const next = credits.add(creditsJson, login, `contest-${month}`, [packId]);
  const note = `### New\n- **${credits.monthName(month)}'s crab contest winner ships with Shellby.** ${skin.name || id} by @${login} is in the Wardrobe for everyone, no unlock needed. Thank you!\n`;
  return { ok: true, contest, credits: next, note, skin };
}

const pretty = json => `${JSON.stringify(json, null, 2)}\n`;

async function main(argv) {
  const { packId, month, skin, login: asked, dryRun } = parseArgs(argv);
  if (!packId || !month) throw new Error('Usage: npm run contest:ship -- <pack-id> <YYYY-MM> [--skin <id>] [--login <login>] [--dry-run]');
  const base = process.env.SHELLBY_REGISTRY_URL || REGISTRY_URL;
  const got = await fetchRegistryPack(packId, { baseUrl: base });
  if (!got.ok) throw new Error(got.errors[0]);
  const index = await fetchRegistryIndex({ baseUrl: base });
  const entry = index.ok ? index.packs.find(p => p.id === packId) : null;
  if (entry?.contest && entry.contest !== month) console.log(`Note: the gallery has ${packId} entered for ${entry.contest}, not ${month}.`);
  const r = ship({
    contestJson: JSON.parse(fs.readFileSync(CONTEST, 'utf8')), creditsJson: JSON.parse(fs.readFileSync(CREDITS, 'utf8')),
    packJson: JSON.parse(got.text), packId, month, skinId: skin, login: asked || entry?.by || null,
  });
  if (!r.ok) throw new Error(r.error);
  const noteFile = path.join(ROOT, 'changes', `contest-${month}.md`);
  console.log(`${r.skin.name} (${r.skin.id}) by @${asked || entry?.by}, the ${credits.monthName(month)} winner.`);
  if (dryRun) { console.log('\nDry run: nothing written.'); return; }
  fs.writeFileSync(CONTEST, pretty(r.contest));
  fs.writeFileSync(CREDITS, credits.toText(r.credits, JSON.parse(fs.readFileSync(CREDITS, 'utf8')).note));
  fs.writeFileSync(noteFile, r.note);
  console.log(`Wrote src/wardrobe/contest.json, src/community/credits.json and changes/${path.basename(noteFile)}. Check the skin in the Wardrobe, commit, then release:cut.`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(e => {
    console.error(`Not shipped: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, ship };
