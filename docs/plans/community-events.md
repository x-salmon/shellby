# Community events: a reason to come back, on a calendar

> Status: **plan.** Nothing here is built yet.

Shellby already has a year of things that come round: six seasons with
limited items you keep (`wardrobe/seasons.js`), six tide events of ten days or
so with a medal stamped with the year (`events.js`, [TIDES.md](../TIDES.md)),
the monthly friends' board, and Wrapped on January 2nd. So this plan is less
about new events than about the three things they lack:

1. **Nothing can be said without a release.** Every event is hard-coded, and
   there's no feed. "The November contest is open" can't reach anyone.
2. **Nothing is made *with* the community.** There's no contest, no voting,
   no credit beyond a pack's `author` field, and no reward for contributing.
3. **Wrapped is a day, not a week,** and it's private: you can't see a friend's
   year next to yours.

Shellby has no servers, and this plan keeps it that way: the feed is a static
file on the GitHub Pages site the pack gallery already uses, contests run in
GitHub Discussions, and credits ship in the release.

The order below is the build order.

## 1. The year at a glance

| When | What | Kind | New? |
|---|---|---|---|
| Every month, 1st–21st | **Crab contest**: a theme, entries, votes | contest | new (§3) |
| Every month, 22nd–end | Contest votes counted, winner announced | contest | new |
| Jan 2–8 | **Wrapped week** | Wrapped | new (§5) |
| Feb 9–15 | 💌 Pen Pal Week | tide event | exists |
| Mar 22–Apr 2 | 🌸 Spring Clean | tide event | exists |
| Jul 10–21 | 🌊 Low Tide | tide event | exists |
| Oct 1–9 | 🌾 Harvest Moon | tide event | exists |
| Oct 24–Nov 1 | 🎃 The Haunting | tide event | exists |
| Dec 18–Jan 1 | ❄️ Frostbite | tide event | exists |
| Shellby's birthday | 🎂 **Molt Day** (a one-day party, his age on a hat) | one-off per year | new (§6), date to pick |

Contest themes follow the calendar where one fits (October: *haunted*,
December: *frozen*), so a contest month and a tide event feel like one thing.
They never collide in code: a contest is feed data, not an event, so
`activeEvent`'s no-overlap rule is untouched.

## 2. Community news (a feed, no server)

**Where.** `news.json` on the gallery's site, beside `index.json` and
`catalog.json`: `https://x-salmon.github.io/shellby-packs/news.json`. It's
built from `news/*.json` in the `shellby-packs` repo, so the maintainer adds an
item with a PR there, and the gallery's own Pages build publishes it. (That
repo isn't this one; its side is listed in §8.)

**Format.** Data only, no HTML, no code:

```jsonc
{
  "format": 1,
  "items": [
    {
      "id": "contest-2026-11",          // [a-z0-9-], unique forever
      "kind": "contest",                // contest | winner | event | featured | note
      "title": "November contest: Frozen crabs",   // ≤ 60
      "body": "Paint a crab who just came in from the cold.",  // ≤ 200, plain text
      "url": "https://github.com/x-salmon/shellby/discussions/123",
      "from": "2026-11-01", "until": "2026-11-21",  // local dates, inclusive
      "contest": { "month": "2026-11", "theme": "frozen", "kinds": ["skin"] }, // contest only
      "pack": "skin-frosty"             // featured / winner only: a registry pack id
    }
  ]
}
```

**In the app.** A new pure module, `src/main/news.js` (validate, pick what's
current for a date, merge "seen"), and `wiring/news.js` (fetch, cache,
broadcast):

- Fetched at boot +30 s and then **at most once a day**, through the same
  fetch path as `registry.js` (timeouts, size cap: 64 KB). A failed fetch keeps
  yesterday's copy.
- **Strict validation**: unknown `kind` dropped, every string clipped, `url`
  allowed only for `https://github.com/x-salmon/…`, `https://getshellby.com/…`
  and `https://x-salmon.github.io/…`, `pack` must match the registry's id rule.
  An item that fails is dropped alone.
- **Shown quietly**: a dim card at the top of the Us page and in What's new,
  one item at a time, with **✕** (stored as seen, synced). Never a toast,
  never a notification, never on the desktop. A `contest` item also shows in
  the Painter. A `featured` or `winner` item with a `pack` gets **Get it**
  (the existing `shellby://install?pack=` path, with its sha256 check).
- **Off switch**: Settings → Shellby → **Community news** (on by default).
  Off means no fetch at all. Crab-only mode follows the same switch.
- `SHELLBY_TODAY` already sets "today" for every season and event; the news
  picker reads the same `d.today()`, and `SHELLBY_NEWS_URL` (dev and tests
  only, refused when packaged) points the fetch at a fixture.
- `PRIVACY.md`: one more GET to the gallery site, once a day, with no
  identifiers, and the switch that stops it.

## 3. The monthly crab contest

**The rules** (on the Discussions category's pinned post, and linked from
every contest item):

- One theme a month, announced on the 1st, entries until the 21st, votes until
  the end of the month, winner announced in the first days of the next.
- An entry is a pack published to the gallery (so it passes the Pack check and
  is CC BY 4.0) with a `contest` field naming the month. Skins to start with;
  the `kinds` list can open it to accessories and decor once the Painter
  paints them.
- Votes are upvotes on the entry's discussion. **Votes guide, the maintainer
  decides** among the top three, so a brigade can't buy a win; the rules say
  so up front.
- One entry per person per month. Your own vote doesn't count.

**Where it lives.** GitHub Discussions on `x-salmon/shellby`, a category
**🎨 Crab contest** (announcement-only posts by the maintainer for each month),
and a category **🦀 Contest entries** (anyone posts), with the "Upvote" voting
that Discussions already has. Nothing to host.

**Entering from the app** (needs [crab-painter.md](crab-painter.md) §5):

1. While a `contest` item is current, the Painter's **Share** has
   **Enter the November contest** ticked when the skin's kind is allowed.
2. `wrapSkin` adds `"contest": "2026-11"` to the pack. `validatePack` learns
   the optional field (`YYYY-MM`, nothing else), and `addon.schema.json` too.
3. After the PR opens, Shellby opens a **new discussion** in the browser,
   prefilled through the URL GitHub supports
   (`/discussions/new?category=contest-entries&title=…&body=…`): the title is
   the skin's name, the body has the PR link, the `shellby://install?pack=`
   link and a line for the entrant to fill. The entrant attaches the card
   ([share-moments.md](share-moments.md) kind `skin`) and posts it themselves,
   as their own account. Shellby never posts to Discussions.

**Counting.** `scripts/contest-tally.js` (maintainer-only, runs with
`GITHUB_TOKEN`, not shipped in the app) reads the month's entries from the
Discussions GraphQL API, joins them to the registry's packs with that
`contest` month, drops entries whose pack didn't merge or whose author entered
twice, and prints the top ten by upvotes with links. It's a script, not CI,
because the decision is a person's.

**The prize: the winner ships in the next release.**

- `npm run contest:ship -- <pack-id> 2026-11` copies the winning skin from the
  registry into `src/wardrobe/contest.json`, a built-in pack of every winner,
  each with `author`, `contest: "2026-11"` and the credit line "Crab contest
  winner, November 2026". It adds the winner to `src/community/credits.json`
  (§4) and writes `changes/contest-2026-11.md` under `### New`, naming them.
  CC BY 4.0 asks for attribution, and the item's credit line and the
  CHANGELOG are it.
- Winners' skins are **open to everyone** once shipped (no lock), so the
  winner sees thousands of crabs wearing their work. That is the prize.
- The winner also gets a 🏆 cosmetic of their own (§4).

**In the app after the vote.** A `winner` news item shows the winning skin with
**Get it** straight from the gallery, a month before it ships built in.

## 4. Credits and contributor cosmetics

**`src/community/credits.json`**, shipped in each release:

```jsonc
{ "format": 1, "people": [
  { "login": "crabfan", "for": ["contest-2026-11"], "packs": ["skin-frosty"] },
  { "login": "octo",    "for": ["code"] }
] }
```

- Filled by `release:cut`: it already gathers notes; it also adds the GitHub
  logins of merged PR authors since the last tag (from `git log` trailers and
  the merge commits' PR numbers, through the GitHub API with the maintainer's
  token) and of packs merged into the gallery since then (from the registry
  index, once it carries `by`, see §8). It never removes anyone.
- **Credits screen**: About → **Made by** lists everyone, grouped (Contest
  winners, Pack makers, Code), each a link to their GitHub profile. A
  skin from the contest pack shows "🏆 by <author>, November 2026" on its tile.

**Cosmetics you get for contributing.** New trophies in
`wardrobe/achievements.js`, each unlocked when **the GitHub login you're signed
in with** appears in `credits.json` for that reason:

| Trophy | For | Reward |
|---|---|---|
| 🪸 **Reef Builder** | a pack merged into the gallery | a coral crown (hat) |
| 🔧 **Shipwright** | a PR merged into Shellby | a tiny wrench (held) |
| 🏆 **Contest Champion** | a contest win | a golden shell trim with the month, stamped like a medal |

- The check runs at boot and when you sign in. Without a sign-in it can't
  know, so the trophies' locked text says "Sign in to GitHub to claim".
- The login comes from the device-flow sign-in (`github/auth.js`), not from
  anything typed, so it can't simply be claimed. A determined person could
  patch their own copy to unlock a hat, and that's fine: it's a hat.
- Once unlocked, a trophy stays (as every trophy does), even if you sign out.

**Entering counts too**, but without a server Shellby can only see entries
that merged into the gallery: 🎨 **Contestant** (a gallery pack of yours with a
`contest` field) unlocks a paint-splat effect, checked against the registry
index's `by` login (§8).

## 5. Wrapped week (January 2–8)

Wrapped stays a January 2nd moment ([WRAPPED.md](../WRAPPED.md)). The week after
it becomes the time to compare and share.

- **The window.** `yearbook.js` gains `wrappedWeek(today)`: January 2nd to 8th
  local, for the year just ended. Outside it, nothing in this section shows.
- **The banner.** The Us page and Trophies show a 🎁 banner, like a tide
  event's: "Wrapped week: share your year", with **Open Wrapped** and the
  count of friends who've shared theirs.
- **Your year on your calling card** (opt-in, off by default, a tick on the
  Wrapped card's sheet: **Show my year to friends**): the calling card gets
  `wrapped: { year, xp, days, levels, bugs, nemesis }`, numbers and a species
  id only, never a project name (the Wrapped card's own rule). `github/card.js`
  cleans it like `month`; a card from a previous year counts as nothing.
- **Friends' years.** A new slide, after the card, shows only during Wrapped
  week and only with friends who shared: you and up to five friends side by
  side, tiles for days together, XP and bugs, each friend's nemesis portrait,
  and fun superlatives ("Most days together: Pip"). Its own 📸 makes a
  moment card (kind `wrapped-friends`).
- **A limited item.** 🎆 **Wrapped Week <year>**: share your Wrapped card
  (the `card-shared:wrapped` sub-stat from
  [share-moments.md](share-moments.md) §5) during the week, and a
  confetti-shell trim stamped with the year unlocks. Like a medal, a year's
  item never comes back.
- **A thread.** The news feed's January item links to a Discussions post
  "Show your Wrapped", where people post their cards themselves.

## 6. Making events cheaper to add

Adding a tide event today touches about ten places, including three
hard-coded copies in the renderer. One-off events (a birthday, a contest
finale) need dates that belong to one year. So:

- **One source for the renderer.** `bugdex.js:31` (the `EVENTS` name map),
  `friends.js:8` (`MEDAL_EMOJI`) and `tide.css:15-20` (per-event colours)
  read from main's event list, sent once with the wardrobe state
  (`events.view()` gains `{ id, name, emoji, colour }` for every event). The
  colour moves into the `EVENTS` entry as `colour: '#rrggbb'` and is applied as
  a CSS variable. Adding an event no longer touches the renderer.
- **One-off events.** An `EVENTS` entry may have `year: 2027`: it only runs
  that year, `activeEvent` skips it otherwise, and "Back next October" isn't
  shown for its bug. `test/events.test.js` checks one-offs don't overlap
  anything in their year.
- **🎂 Molt Day**, the first one-off: Shellby's birthday, one day, his age as a
  number on a party hat that anyone who opens Shellby that day keeps (a
  season-style unlock, no goals), plus a line on the desktop. Pick the date
  from the first release's tag.
- **Packs can be event-limited.** `catalog.js:97-100` allows
  `unlock: { season }`. Add `unlock: { event: '<id>' }`, valid only for
  built-in event ids, and collected the same way season items are (yours to
  keep once the event has been on). The gallery's Pack check learns it too.
  That lets the community make Haunting outfits that only appear in the
  Haunting.
- `docs/TIDES.md` gets a short "Adding an event" checklist, the one in this
  plan minus the three renderer steps.

## 7. Running it (the maintainer's month)

| Day | What | Where |
|---|---|---|
| ~25th of the month before | Pick next month's theme | |
| 1st | Post the contest in 🎨 Crab contest; add `news/contest-<month>.json` | Discussions; `shellby-packs` PR |
| 1st–21st | Merge entry packs as they pass the Pack check | `shellby-packs` |
| 22nd | Close entries (edit the post); news item's `until` has already passed | Discussions |
| End of month | `node scripts/contest-tally.js 2026-11`, pick the winner | here |
| 1st–3rd of next | Announce in Discussions; add `news/winner-<month>.json` | Discussions; `shellby-packs` PR |
| Next release | `npm run contest:ship -- <pack> <month>` before `release:cut` | here |

About an hour a month. `docs/COMMUNITY.md` (new) holds this table, the rules,
and the templates for the posts.

If a month gets no entries, the winner post says so kindly and the theme
rolls over. If entries stay thin for three months, go to every other month.
The cadence should follow the people, not the calendar.

## 8. Outside this repo (`x-salmon/shellby-packs`)

- **`news/` folder** and its build into `news.json`, with the same schema
  check as in the app (copy `src/main/news.js`'s rules into the Pack check).
- **`by` in `index.json`**: the GitHub login of the PR author who added each
  pack version, taken from the merged PR at build time. It's what lets
  credits and the 🎨 Contestant trophy trust who made a pack, since `author`
  is free text.
- **The Pack check** learns the `contest` field and `unlock: { event }`.
- **A label** `contest-<month>` added automatically to a pack PR with a
  `contest` field, so the maintainer can see the month's entries at a glance.

## Docs and notes

- `docs/COMMUNITY.md` (new), linked from the README's Contributing section
  and CONTRIBUTING.md.
- `PRIVACY.md`: the news fetch; the Wrapped share on the calling card.
- `docs/WRAPPED.md`: Wrapped week. `docs/TIDES.md`: one-offs and the checklist.
- Change notes per phase: `### New` (news, Wrapped week, credits, Molt Day).

## Tests

- `test/news.test.js`: validation (bad kinds, long strings, foreign URLs, bad
  pack ids dropped one by one), date picking with wrap and `SHELLBY_TODAY`,
  seen-merge for Sync.
- `test/credits.test.js`: the trophies unlock from a fixture `credits.json` for
  the signed-in login and not otherwise; never lock again on sign-out.
- `test/events.test.js`: one-off years, colours present, no renderer copies
  left (a test greps the renderer for event ids outside the shared list).
- `test/catalog.test.js`: `unlock: { event }` accepted for built-in ids,
  refused otherwise; `contest` field shape.
- `test/yearbook.test.js`: `wrappedWeek` edges (Jan 1, Jan 2, Jan 8, Jan 9) and
  the calling card's `wrapped` cleaning.
- `scripts/e2e-news.js` (`// ci: news`): a fixture feed through
  `SHELLBY_NEWS_URL`, a contest item on the Us page and in the Painter, ✕
  hides it after a restart.
- `scripts/e2e-wrapped.js`: with `SHELLBY_TODAY=2027-01-04` and two fixture
  friends, the friends' slide and its card.

## Open questions

- **Should the news feed be signed?** It's data only and strictly validated,
  and it's served from a repo the maintainer controls, so a bad item can at
  worst show a wrong line linking to an allowed site. Signing would add a key
  to keep safe. The plan leaves it unsigned and says why in the code.
- **A Discord server.** This plan uses Discussions because it needs no
  moderation tooling and keeps votes next to the code. A server would be
  where regulars hang out; if one starts, the news feed's `url` allowlist
  would need its invite link.
