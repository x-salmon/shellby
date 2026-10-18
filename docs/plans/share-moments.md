# Moments worth sharing: a card for every one, in every size

> Status: **built.** What shipped is in [CARDS.md](../CARDS.md); the open questions at the end are still open.

The card kit is already good. `card.js` (`SB.cardKit`) draws 1200×630 cards on
a canvas; `present()` saves the PNG to `Pictures\Shellby`, copies it, and
offers **Post on X**, **Post on Bluesky**, **Copy again** and **Show file**.
Sparklies, medals, the board, eggs, Wrapped, the week, the beach and the crab
card all use it ([viral.md](viral.md), [WRAPPED.md](../WRAPPED.md)).

What's missing:

- **Many big moments have no card of their own.** A trophy, a level up below
  the legend tier, a finished molt, a new sticker, a rare catch and a streak
  all end on the generic `SB.celebrate` card, whose 📸 opens the *crab* card,
  not the moment.
- **One size.** 1200×630 suits X and Bluesky. Discord, Mastodon and Instagram
  crop it or show it small. There's no square.
- **The picture never reaches the post.** The X and Bluesky intents carry text
  only; the user has to know to paste. Nothing goes to Discord.
- **Nothing moves.** The moments people screenshot most (a sparkly reveal, a
  molt) are animations, and the card is a still.

The rule from viral.md stays: a card only ever celebrates something that really
happened, Shellby never posts by itself, and it never nags.

The order below is the build order.

## 0. Fix what's there first (small, ship right away)

- **Privacy: the week card can name a hidden project.** Its TOP PROJECT row
  draws `w.topProject.name` (`week-card.js:98-100`). `topProjectOf`
  (`main/weekly.js:270`) picks from all your work and never checks the
  projects you keep off your cards. The SHIPPED row filters them
  (`week-card.js:264`), the top project doesn't. Fix it in main: give
  `weekSummary` the hidden set and skip hidden repos in `topProjectOf`, falling
  back to the next one, then to "Nothing yet". A test in `test/weekly.test.js`
  with a hidden top project. This is a `### Fixed` note on its own.
- **`CARD_KINDS`** (`ipc/surroundings.js:209`) is missing `crab` and
  `wrapped`, so those save as `shellby-card-*.png`. Add them (and every kind
  below as it lands). `test/ipc-surroundings.test.js` checks the file names.
- **The Tank has no Share button**, but the quest "Share the tank"
  (`quests/chapters.js:165`) tells you to press one. Add 📸 to the Tank
  header: the crab card already draws the tank, so it opens that.
- **`PRIVACY.md:85`** lists only crab and week cards in `Pictures\Shellby`.
  Make it "the cards you make", and list what a card can show: your crab, his
  level, numbers, bug and find art, sticker art, never code, and a project
  name only where you chose to show names.
- **Output tests for the moment cards.** `scripts/e2e-card.js` checks the
  crab card's PNG size from its IHDR. Do the same for `shiny`, `medal`,
  `board`, `egg` and the beach, in one loop over the kinds (the count comes
  from source, as CLAUDE.md asks: a `MOMENT_KINDS` list exported by
  `moment-card.js`).

## 1. A card for every big moment

Each new card is a `moment-card.js` kind, so it gets the same layout (art on a
halo, eyebrow, title, sub, badge, up to four tiles, footer) and the same
`present()` sheet.

| Moment | Kind | Art | Title / sub | Tiles | When to offer it |
|---|---|---|---|---|---|
| Trophy unlocked | `trophy` | the trophy's icon at 8×, its reward item beside it | "Unlocked: Tide Turner" / the trophy's line | rarity (how many trophies you have / total), level, days together | every trophy; the toast's 📸 opens it |
| Level up | `level` | your crab as he's dressed, with the level's ribbon | "Level 25" / his new title | XP, days together, trophies, top bug | every 5th level and every tier change; other levels keep the toast |
| Molt finished | `molt` | the old shell on the shelf beside the new one | "He molted!" / shell name | molts so far, stickers carried over, level | every molt |
| New sticker | `sticker` | the sticker big, tier finish (paper, vinyl, holo, foil) | "A new sticker" / tier | ships, tier, stickers on his shell | first sticker of a repo and each tier up |
| Rare catch | `catch` | the bug's portrait | species name / habitat | rarity, catches of that kind, Bugdex progress | rare and legendary only; ordinary catches stay quiet |
| Streak | `streak` | your crab with a flame count | "30 days in a row" | longest streak, active days this year, level | 7, 30, 100, 365 days |
| Skin made | `skin` | the skin big, four poses as tiles | skin name / "by <author>" | (poses) | from the Painter ([crab-painter.md](crab-painter.md)) |

**Privacy on the sticker card.** The sticker art comes from the repo, and its
name only shows if your Sticker Book is set to **Shell and names**, the same
rule the calling card uses. A hidden project never gets a sticker card.

**Wiring.** `SB.celebrate(opts)` gains `card: { kind, m }`. When it's there,
the celebration's 📸 calls `SB.momentCard.share(kind, m, …)` instead of opening
the crab card; when it's not, nothing changes. Each place that celebrates
(`xp.js:180`, `levels-ui.js:118`, `molt.js:124`, `stickers.js:317`,
`bugdex.js:464`, the trophy toast) passes its moment. The data each card needs
is already in the panel when it celebrates, so no new IPC.

**The post text** is per kind, in a `POST_TEXT` table in `moment-card.js`, in
the crab's voice and always naming what happened ("Shellby just molted into a
Barnacle Shell 🦀"), then the link. One hashtag, `#Shellby`, so posts can be
found. The link stays the one the footer already shows.

## 2. Two sizes: Wide and Square

`present()` gets a size switch above the preview: **Wide** (1200×630, X,
Bluesky, LinkedIn) and **Square** (1080×1080, Discord, Mastodon, Instagram).
The last one you picked is remembered per kind in `localStorage`, defaulting
to Wide.

- **The kit stops assuming one size.** `K.W` / `K.H` become per-canvas:
  `K.newCanvas(size)` returns `{ canvas, ctx, w, h }`, and `drawWater`,
  `drawTiles` and `drawFooter` read the size from it. The existing callers pass
  nothing and get 1200×630, so they don't change until they opt in.
- **Moment cards reflow.** Wide is art left, text right (today's layout).
  Square is art on top (60% of the height), then eyebrow, title and sub, then
  tiles in a 2×2 grid, then the footer. One layout function per size in
  `moment-card.js`, sharing every drawing helper.
- **The crab, week and Wrapped cards** get Square after the moment cards, one
  at a time, since each has its own layout.
- `card:save` takes the size and puts it in the file name
  (`shellby-trophy-square-<stamp>.png`).
- e2e checks both sizes' IHDR for every kind.

## 3. Getting the picture into the post

Intents can't carry an image, so the sheet makes the paste obvious and adds
the one place Shellby can post a picture itself.

- **Say it on the button.** After **Post on X** or **Post on Bluesky** opens
  the browser, the sheet shows "Your card is on the clipboard: press Ctrl+V in
  the post." for 10 seconds. If the clipboard copy failed (`copied: false`),
  the post buttons copy again first.
- **Alt text.** Every card already has alt text (it's on the preview). Add
  **Copy alt text** to the sheet, since X and Bluesky let you add it when you
  attach the image, and say so in the hint.
- **Post to Discord.** If you've set up a Discord webhook for phone
  notifications (`channels/index.js`, `discord`), the sheet shows **Post to
  Discord**, naming the channel's label. It posts the PNG as a file upload
  (`multipart/form-data`, `payload_json` with the post text and
  `allowed_mentions: { parse: [] }`, the same no-ping rule the notifications
  use) from main, through a new `card:post-discord` IPC that takes the saved
  file's path from the earlier `card:save`, never bytes from the panel. Asks
  once per webhook before the first post ("Post your cards to #shellby-wins?").
  Without a webhook the button isn't there; the sheet's hint says "Copy, then
  paste it in Discord".
- `test/ipc-surroundings.test.js`: the Discord post refuses a path outside
  `Pictures\Shellby`, sends no mentions, and shows the error a webhook returns.

## 4. Moments that move

For the two moments that are animations by nature, the sparkly reveal and the
molt, the sheet gets **🎞 Clip** beside the size switch.

- **Recording.** The card's canvas is already drawn in the panel. A small
  animator (`moment-clip.js`) redraws it over 4 seconds at 30 fps (the glint
  sweeping, the card flipping from dark to the sparkly art; the old shell
  sliding off and the new one dropping on) and records it with
  `canvas.captureStream()` and `MediaRecorder`. It asks for
  `video/mp4;codecs=avc1` and falls back to `video/webm` when
  `MediaRecorder.isTypeSupported` says no. X and Bluesky take MP4, Discord
  takes both. Check Electron 44's Chromium before building (CLAUDE.md: check
  `electron.d.ts`, don't trust memory).
- **Size.** Wide or Square as picked, under 5 MB (a 4-second canvas clip is
  far below that). `card:save` takes `.mp4` / `.webm` with the same size cap
  and a magic-number check (`ftyp` / EBML).
- **Clipboard.** Video can't go on the clipboard, so a clip's sheet shows
  **Show file** first and says "Drag it into your post".
- **Reduced motion.** With motion turned down, Clip is still offered (it's a
  file, not motion on screen), but its preview shows the first frame and a
  play button.
- **Later:** the same recorder for a level-up ceremony and a tide event medal.

## 5. Not nagging

- A share is **offered**, never pushed: the 📸 on a celebration, and the sheet
  when you press it. No pop-up asks you to share.
- At most **one** "share this?" nudge a day, and only for the rarest moments
  (a sparkly, a legendary catch, a molt, a medal). Today's celebrations already
  carry the 📸, so the nudge is the celebration itself; this rule is about not
  adding more.
- Settings → Shellby → **Share buttons on celebrations** (on by default). Off
  hides every 📸 on celebrations; the cards stay reachable from Trophies.
- `card-shared` stays the one stat for Show-Off. Add `card-shared:<kind>` as
  a sub-stat so later trophies can ask for variety ("share 5 kinds of card"),
  counted locally like every stat.

## Docs and notes

- `PRIVACY.md` as in phase 0, plus the Discord post (it goes only to the
  webhook you set up, only when you press it).
- `docs/WARDROBE.md` (or a new short `docs/CARDS.md`): every card, what it
  shows, sizes, clips.
- Change notes: `### Fixed` for phase 0's privacy fix; `### New` for each
  phase after it.

## Tests

- `test/weekly.test.js`: hidden top project (phase 0).
- `test/ipc-surroundings.test.js`: new kinds, sizes in file names, video
  checks, Discord post.
- `test/moment-card.test.js`: `POST_TEXT` has an entry for every kind in
  `MOMENT_KINDS`, every entry is under 200 characters with the link, and the
  celebrate → card mapping covers each moment in the table.
- `scripts/e2e-card.js`: every kind, both sizes, by IHDR; one clip, by its
  container's magic number and a non-zero duration.

## Open questions

- **A Bluesky post with the image attached** would need the user's app
  password and Shellby posting through the AT Protocol API. It's the one place
  a real one-click post is possible, but it means storing a credential. Worth
  it only if people ask.
- **Should the card link carry `?ref=card`?** It would tell you which cards
  bring people to the site, but it's a small step towards tracking, which the
  README promises Shellby doesn't do. The plan leaves it out.
