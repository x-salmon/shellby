# The community: news, the crab contest and credits

Shellby has no servers, and running its community doesn't change that. The news is a static file on the gallery's site, the contest runs in GitHub Discussions, and the credits ship in each release. This page is how it all works, and the maintainer's month that keeps it going (about an hour).

## Community news

A small feed, `news.json`, sits on the gallery's site beside `index.json` and `catalog.json`: `https://x-salmon.github.io/shellby-packs/news.json`. It's built from `news/*.json` in [`x-salmon/shellby-packs`](https://github.com/x-salmon/shellby-packs), so adding an item is a pull request there, and the gallery's own Pages build publishes it.

Shellby reads it 30 seconds after it starts and then at most once a day, with nothing about you in the request. What's current shows as one quiet card at the top of the **Us** page and on **Settings → About**, with ✕ to put it away for good (synced with Sync on). Never a toast, a notification or anything on the desktop. **Settings → Shellby → Community news** off fetches nothing at all.

### An item

```jsonc
{
  "id": "contest-2026-11",              // [a-z0-9-], at most 60, unique forever
  "kind": "contest",                    // contest | winner | event | featured | note
  "title": "November contest: Frozen crabs",                 // at most 60
  "body": "Paint a crab who just came in from the cold.",     // at most 200, plain text
  "url": "https://github.com/x-salmon/shellby/discussions/123",
  "from": "2026-11-01", "until": "2026-11-21",                // local dates, both included
  "contest": { "month": "2026-11", "theme": "frozen", "kinds": ["skin"] },  // contest only
  "pack": "skin-frosty"                                       // winner and featured only
}
```

The feed is `{ "format": 1, "items": [...] }`, at most 64 KB. Shellby checks every item (`src/main/news.js`) and drops a bad one alone; the gallery's Pack check refuses it at PR time with the same rules:

- `kind` is one of the five; `from` and `until` are real days, `until` not before `from`.
- `url` is optional and only ever `https://github.com/x-salmon/…`, `https://getshellby.com/…` or `https://x-salmon.github.io/…`.
- `contest` only on a contest item: `month` is `YYYY-MM`, `theme` 1 to 40 characters, `kinds` some of `skin`, `accessory`, `effect`, `voice`, `scene`, `decor`.
- `pack` only on a winner or featured item, a gallery pack id. It's what **Get it** installs, through the usual `shellby://install` path with its checksum and the "Install pack?" question.
- Text is plain: no HTML, no Markdown. Long text is cut.

Several items at once show one at a time: a contest first, then a winner, an event, a featured pack, a note. The current contest is also what the Painter offers to enter, even after its card is closed.

The feed isn't signed. It's data only, served from a repository the maintainer controls, and the worst a bad item can do is show a wrong line that links to one of the allowed sites. A signature would be a key to keep safe for no more than that.

## The monthly crab contest

**The rules** (pinned in **🎨 Crab contest**, and linked from every contest item):

- One theme a month, announced on the 1st. Entries until the 21st, votes until the end of the month, the winner announced in the first days of the next.
- An entry is a pack published to the gallery with a `contest` field naming the month, so it passes the Pack check and is CC BY 4.0. Skins to start with; the theme's `kinds` can open it to more.
- Votes are upvotes on the entry's discussion. **Votes guide, the maintainer decides** among the top three, so a brigade can't buy a win.
- One entry per person per month. Please don't count your own vote.
- The winning skin **ships in the next release, open to everyone**, with "🏆 by you, November 2026" on its tile and your name in the CHANGELOG. You also get the 🏆 *Contest Champion* trophy and its golden shell trim.

**Where it lives:** two Discussions categories on `x-salmon/shellby`: **🎨 Crab contest** (the maintainer's post for each month) and **🦀 Contest entries** (anyone posts, with Upvote voting).

**Entering from the app:** while a contest is on, the Painter's **Share** has **Enter the November contest** ticked. Publishing adds `"contest": "2026-11"` to the pack, and once the pull request is open Shellby opens a new discussion in the browser, filled in with the skin's name, the PR and its `shellby://install?pack=` link. You add the card and post it yourself. Shellby never posts for you.

### Templates

The month's post, in 🎨 Crab contest:

> **🎨 November 2026: Frozen crabs**
>
> Paint a crab who just came in from the cold. Entries until **November 21st**, votes until the 30th.
>
> 1. Paint your crab in Shellby's Painter (or by hand, see SKINS.md).
> 2. Share it with **Enter the November contest** ticked. It goes to the gallery as a pull request.
> 3. Post it in 🦀 Contest entries (the Painter opens the post for you) with its card.
>
> Upvote the ones you love. Votes guide, the maintainer picks among the top three, and the winner ships with Shellby for everyone. One entry each, and please don't upvote your own. The rules: (link)

The winner's post:

> **🏆 November's winner: Frosty, by @crabfan**
>
> Thank you to everyone who entered: (links to the top three). Frosty is in the gallery now (**Get it** on Shellby's Us page), and ships built in with the next release. December's theme: *frozen*. See you on the 1st.

No entries:

> **November's contest had no entries.** No worries: the theme rolls over to December, so anything you started still counts.

## Credits

`src/community/credits.json` lists everyone who has made Shellby, and ships in each release. **Settings → About → Made by** shows it: contest winners, pack makers and code, each name a link to their GitHub profile.

```jsonc
{ "format": 1, "people": [
  { "login": "crabfan", "for": ["contest-2026-11"], "packs": ["skin-frosty"] },
  { "login": "octo",    "for": ["code"], "packs": [] }
] }
```

- `npm run release:cut` adds the authors of pull requests merged since the last tag (from merge commits, squash merges' PR numbers through the GitHub API with `GITHUB_TOKEN` or `gh`'s token, and GitHub noreply addresses in commits and `Co-authored-by` trailers) and the gallery's pack makers (its `index.json` carries `by`, the login of the pull request that added each pack). It never takes anyone off.
- `npm run contest:ship` adds a contest winner.

**Trophies for making Shellby.** Each unlocks when the GitHub account you're signed in with is credited for it, in `credits.json` or in the gallery's index:

| Trophy | For | Reward |
|---|---|---|
| 🪸 **Reef Builder** | a pack of yours in the gallery | Coral Crown (hat) |
| 🔧 **Shipwright** | a pull request merged into Shellby | Tiny Wrench (held) |
| 🏆 **Contest Champion** | a contest win (its line says which months) | Golden Shell Trim |
| 🎨 **Contestant** | a gallery pack of yours with a `contest` field | Paint Splat (effect) |

Shellby checks when it starts and when you sign in, and reads the gallery's index at most once a day while you're signed in and Community news is on. Without a sign-in it can't know, so the trophies say **Sign in to GitHub to claim**. The login comes from the GitHub sign-in itself, never from anything typed. Once earned, a trophy stays, even if you sign out.

## The maintainer's month

| Day | What | Where |
|---|---|---|
| ~25th of the month before | Pick next month's theme. Follow the calendar where one fits: October *haunted*, December *frozen*, so a contest and a tide event feel like one thing | |
| 1st | Post the contest in 🎨 Crab contest; add `news/contest-<month>.json` (until the 21st) | Discussions; `shellby-packs` PR |
| 1st–21st | Merge entry packs as they pass the Pack check (they get a `contest-<month>` label) | `shellby-packs` |
| 22nd | Close entries: edit the post. The news item's `until` has already passed | Discussions |
| End of month | `npm run contest:tally -- 2026-11`, then pick the winner among the top three | here |
| 1st–3rd of next | Announce in Discussions; add `news/winner-<month>.json` with `"pack"` so people can **Get it** | Discussions; `shellby-packs` PR |
| Next release | `npm run contest:ship -- <pack-id> <month>` on a branch, merge, then `release:cut` | here |
| January | `news/wrapped-<year>.json` (an `event` from Jan 2 to 8) linking a "Show your Wrapped" post | `shellby-packs` PR; Discussions |

`contest:tally` reads the month's entries from Discussions (GraphQL, with `GITHUB_TOKEN` or `gh`'s token), finds each one's pack by its `shellby://install?pack=` link, and joins it to the gallery's packs with that `contest` month. It drops, with the reason, a post with no pack link, a pack that didn't merge for that month, someone else's pack, a post after the 21st, and a second entry from the same person. It's a script, not CI, because the decision is a person's.

`contest:ship` fetches the winning pack from the gallery (checked against the index's sha256), copies its skin into `src/wardrobe/contest.json` as `contest-<month>` with `"won": "<month>"` and no lock, adds the winner to `credits.json` (the login from the index's `by`, or `--login`), and writes `changes/contest-<month>.md`. Use `--skin <id>` when the pack has several skins, and `--dry-run` to look first.

If a month gets no entries, say so kindly and roll the theme over. If entries stay thin for three months, go to every other month. The cadence should follow the people, not the calendar.

## Wrapped week and Molt Day

Two more dates belong to the community: **Wrapped week**, January 2nd to 8th, when friends compare their years ([WRAPPED.md](WRAPPED.md#wrapped-week-january-2nd-to-8th)), and **🎂 Molt Day**, Shellby's birthday on September 30th, with a party hat for anyone there ([TIDES.md](TIDES.md#-molt-day)).
