# Cards

Shellby makes a picture of something that really happened, for you to post if
you want to. He never posts by himself and never asks you to share: the 📸 is
on the moment, and nothing leaves your PC until you paste it somewhere or press
**Post to Discord**.

Every card is drawn in the panel on a canvas (`src/renderer/panel/card.js`,
`SB.cardKit`), saved by main to `Pictures\Shellby` (`card:save` in
`src/main/ipc/surroundings.js`), copied to the clipboard and shown in the share
sheet.

## Every card

| Card | Where its 📸 is | What it shows | File |
|---|---|---|---|
| Crab | Outfits, Trophies, Stickers | Him as he's dressed, in his tank, your best trophy, tasks, trophies, what you shipped, the trophy shelf, your outfit code | `shellby-crab-…` |
| Tank | The Tank's header | The crab card, saved as his tank card (it finishes "Share the tank") | `shellby-tank-…` |
| Week | Trophies, and Friday's "your week" | The last seven days: hours, tasks, fixes, streak, his class, top project, trophies, what shipped | `shellby-week-…` |
| Wrapped | The Wrapped sheet | A year's biggest numbers, its nemesis bug and molts | `shellby-wrapped-…` |
| Beach | Us | A snapshot of the whole beach | `shellby-beach-…` |
| Sparkly find | The sparkly reveal | The find or bug, its odds | `shellby-shiny-…` |
| Medal | A tide event's finish, the Us page | The year's medal | `shellby-medal-…` |
| Friends' board | The Bugdex | This month's board | `shellby-board-…` |
| Egg | Us | An egg and its code, or a baby that hatched | `shellby-egg-…` |
| Trophy | A trophy's celebration, any done trophy on Trophies | The trophy big with its reward, how many you have, his level, days together | `shellby-trophy-…` |
| Level | Every fifth level and every new rank, and the ceremonies | Him with his level's ribbon, his title, XP, days together, trophies, his top bug | `shellby-level-…` |
| Molt | The Molt sheet, once he's molted | The shell he left on the shelf beside his new one, molts, stickers carried over | `shellby-molt-…` |
| Sticker | A new sticker and each tier up | The sticker big in its finish (paper, vinyl, holo, foil), ships, tier | `shellby-sticker-…` |
| Rare catch | A new rare or legendary bug | Its portrait, rarity, how many caught, Bugdex progress | `shellby-catch-…` |
| Streak | 7, 30, 100 and 365 days in a row | Him under a flame with the count, longest streak, days active | `shellby-streak-…` |
| Skin | The Crab Painter (`SB.momentCard.share('skin', { skin, name, author })`) | The skin big, four poses (idle, waving, asleep, scuttling) | `shellby-skin-…` |

Moment cards (`src/renderer/panel/moment-card.js`) all share one layout: art on
a halo, eyebrow, title, sub, badge, up to four tiles, footer. The first four
kinds are drawn from a moment their caller puts together; the rest are built
(`FROM`) from what the celebration already has, so a celebration passes
`card: { kind, m }` to `SB.celebrate` and its 📸 shares that card. Without one,
the 📸 shares the crab card.

**What a card can show:** your crab, his level, numbers, bug and find art,
sticker art, and never code or anything from a conversation. Project names are
only on the week card and on a sticker's card when the Sticker Book is set to
**Shell and names**; a project you hide is on none of them, and gets no sticker
card.

## Sizes

The sheet's switch picks **Wide** (1200×630: X, Bluesky, LinkedIn) or
**Square** (1080×1080: Discord, Mastodon, Instagram), remembered per kind of
card on this PC. A square card is saved as `shellby-<kind>-square-…`. Moment
cards put the art on top in Square, with the tiles two to a row; the crab, week
and Wrapped cards put his tank across the top. The beach is one size, as wide
as the beach. Switching sizes saves the card again but doesn't count as another
share.

## Getting it into a post

- **Post on X / Post on Bluesky** open the post with its words in your browser;
  the card is on the clipboard (copied again first if the first copy didn't
  take), and the sheet says to press Ctrl+V.
- **Copy alt text** copies the card's description, for the image description
  X and Bluesky ask for.
- **Post to Discord**, when you've set up a Discord webhook for phone
  notifications: main uploads the saved file (never bytes from the panel) with
  its words and `allowed_mentions: { parse: [] }`, after asking once per
  webhook.

Each post is in his voice, names the moment, and ends with `#Shellby` and the
link (`POST_TEXT`, always under 200 characters).

## Clips

The sparkly reveal and the molt have **🎞 Clip**: four seconds at 30 fps of the
card with its art moving (`src/renderer/panel/moment-clip.js`), recorded from the
canvas with `MediaRecorder`. It asks for `video/mp4;codecs=avc1`, which
Electron 44 records, and falls back to WebM. `card:save` checks the container's
magic number (`ftyp`, or EBML for WebM) and a 5 MB cap. Video can't go on the
clipboard, so the sheet shows **Show file** first; with motion turned down the
preview waits on its first frame with a play button.

## Not nagging

A share is offered, never pushed: the 📸 on a celebration, and the sheet when
you press it. No pop-up asks you to share. **Settings → Shellby → Share buttons
on celebrations** (on by default) hides every 📸 on celebrations; a trophy's
card stays on the Trophies page.

`card-shared` is the one stat for the Show-Off trophy. Each save also counts
`card-shared:<kind>` (`stats.cardsByKind`), and `cardKinds` is how many kinds
you've shared, for trophies that ask for variety. Counted locally like every
stat.

## Checks

`npm test` (`test/moment-card.test.js`, `test/ipc-surroundings.test.js`) and
`node scripts/e2e-card.js`, which draws every kind in both sizes and checks each
PNG's size from its IHDR, and records one clip.
