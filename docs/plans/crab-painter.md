# The Crab Painter: paint a crab, see him move, share him

> Status: **plan.** Nothing here is built yet.

Today a skin is a JSON pixel grid typed by hand ([SKINS.md](../SKINS.md)), and
the only way to see it is Reload in Settings. The web Pack Studio
(getshellby.com/community/studio/) previews packs, but nothing in the app links
to it, and it doesn't paint. Publishing works (`github/publish.js`), but only for
a Wardrobe pack that's already installed, so a loose skin has to be wrapped in a
pack by hand first.

The Painter closes that loop inside the app: **start from a crab, paint, watch
him do every pose, save, wear, share**, with no JSON and no text editor. It's
the biggest single lever for the community gallery, so it comes first among the
three plans (after the small fixes in [share-moments.md](share-moments.md)
phase 0).

The order below is the build order. Each phase ships alone.

## What exists to build on

| Need | Already there |
|---|---|
| Draw a skin as the crab | `src/renderer/shared/sprite.js` `build(skin, opts)`, `components()` (leg shapes), `inkRings` |
| Validate | `src/main/skins.js` `validate()`; the stricter `docs/addon.schema.json` (skin at :142-170); `catalog.js` `validatePackSkin` (anchors) |
| Paint pixels on a canvas | `tank-paint.js`, `beach-paint.js` (art pixels at an integer scale) |
| Undo and drafts | the Tank editor's draft and undo (`tank.js`, `tank-layouts`) |
| Try on with an outfit | the Wardrobe stage (`wardrobe.js:59-75`) and its mood buttons |
| Every pose | `work-pose.js` `POSES`, animated by `critter.css:147-250` (crab window only) |
| Load and broadcast | `skins:reload` (`ipc/wardrobe.js:39`), `broadcastSkin()` (`wiring/critter.js:79-86`) |
| Publish | `publishPack()` (`github/publish.js:44-88`), `confirmAndPublishPack` (`wiring/github.js:529-557`) |

## 1. The Painter screen

A new tab on the Shellby screen, **🎨 Paint**, next to Wardrobe
(`html/wardrobe.html:5-16` `data-goto`). New files:
`src/renderer/panel/html/painter.html`, `painter.js`, `painter.css`, and the pure
grid logic in `src/renderer/shared/pixel-grid.js` so node tests can load it.

**Starting a crab.** The empty state offers every skin you have (built-in, loose
and pack skins you've unlocked) as **Start from this one**, plus a blank 22×13
grid with classic's outline faintly behind it. A locked pack skin can't be a
starting point (it would hand out the unlock). The copy gets a new id
(`<name>-<4 random>`), `author` from your GitHub login if you're signed in,
else empty and asked for at save.

**The canvas.**

- The grid at the skin's size (up to 40 columns × 32 rows, the validator's
  limits), drawn at the biggest integer scale that fits, with a 1-pixel grid
  line from 8× up. Transparent cells show a soft checker.
- **Tools:** pencil, eraser, fill (4-way flood fill), eyedropper (right-click
  is always the eyedropper), line, and **Move** (nudge the whole drawing one
  pixel, for re-centring). Keys: `B` `E` `G` `I` `L` `M`, `[` `]` brush 1/2,
  `Ctrl+Z` / `Ctrl+Y`.
- **Resize** adds or trims a row or column on any edge, never scaling.
- **Undo** keeps 200 steps of whole-grid snapshots (a 40×32 grid is 1,280
  characters, so snapshots are cheap and simpler than diffs).

**The palette is the parts map.** Each colour swatch carries the body part it
belongs to (`shell`, `body`, `claw`, `eyes`, `stalks`, `legs`, `extra`), shown
as a small label and a part colour on the swatch's edge. Adding a colour asks
which part it is, defaulting to the part of the swatch you had selected. That
way people never meet the `palette` / `parts` / `pixels` split: they paint a
colour, and the colour knows what moves. The palette character is picked for
them (the next free one of `A-Za-z0-9`; `.` is reserved for transparent).

**Part view.** A toggle tints every pixel by its part instead of its colour, so
"why doesn't his claw wave?" is answered by looking.

**Drafts.** Every change saves a draft to
`%APPDATA%\Shellby\painter\drafts\<id>.json` (debounced 1 s), so closing the
panel or a crash loses nothing. The empty state lists drafts first. A draft is
not a skin until you save it.

## 2. Seeing him move

The preview is the reason to paint in the app instead of a text editor.

- **Move the part animations into a shared stylesheet.** The `.part-*`
  keyframes for states and work poses move from `critter.css:147-250` into
  `src/renderer/shared/crab-anim.css`, included by both the crab window and the
  panel. The crab window looks exactly the same (an e2e screenshot comparison
  pins that). The Wardrobe stage's simplified copies (`wardrobe.css:60-70`) are
  then replaced by the shared ones too, so there's one set of animations.
- **The preview pane** beside the canvas draws the live grid with
  `sprite.build()` at 4×, updated on every stroke (an SVG rebuild of a 40×32
  sprite is well under a frame). Under it, a row of pose chips: idle, working,
  asking, sleeping, then every `POSES` entry. Picking one plays it in a loop.
  With reduced motion on, the chip shows the pose's held frame and a
  **Play once** button.
- **Wear your outfit** toggles your current hat, held item, shell and effect
  on the preview, placed with the skin's anchors. This is where a non-classic
  shape shows a hat floating off its head.
- **Anchors.** With **Wear your outfit** on, the five anchors (head, face,
  neck, claw, shellTop) show as draggable dots on the preview. Dragging snaps
  to whole pixels inside the validator's range (-16 to 48). Skins whose anchors
  were never moved leave `anchors` out of the file, so they keep tracking any
  future change to the defaults.
- **Try him on the desk** sends the draft to the real crab for 60 seconds
  (`critter:skin` with a `preview: true` flag), then puts your skin back. That
  catches what the panel can't: size on the real desktop, his outline at 1×.

## 3. Checks while you paint

The editor validates against the **strict** rules, so a skin that saves is a
skin the gallery's Pack check accepts. Today `skins.validate()` is looser than
`addon.schema.json` (no palette cap, unknown parts dropped silently). So:

- Add `validate(skin, { strict: true })` to `skins.js`, matching the schema:
  palette size cap, unknown part is an error, not a drop. Loose skins loaded
  from the folder keep the lenient path, so nobody's existing skin breaks.
- A test (`test/skins-strict.test.js`) runs every built-in skin and every skin
  in `src/wardrobe/*.json` through strict mode, and checks strict mode agrees
  with `addon.schema.json` on a table of good and bad skins, so the two can't
  drift again.

A **checks strip** under the canvas shows each problem with **Show me**, which
flashes the pixels involved:

| Check | Kind | Why |
|---|---|---|
| A colour has no part | blocks saving | it wouldn't animate |
| No `eyes` pixels, or no `legs` | warning | he'd look odd in half the poses |
| A leg pixel touches another leg (`sprite.components` finds fewer than 2 leg shapes) | warning | the walk alternates `legs-a` / `legs-b` per connected shape |
| Anchor outside the drawing by more than 4 px | warning | hats float |
| Name or author missing | blocks publishing, not saving | the gallery needs them |
| Bigger than classic by 50% in either direction | note | he'll be big on the desk |

Publishing refuses a pack with warnings (`confirmAndPublishPack`), so the strip
says which warnings will block **Share**, and each warning has **That's on
purpose** for the ones that don't block saving (stored in the draft, never in
the skin).

## 4. Save and wear

New IPC in `src/main/ipc/wardrobe.js`, through `ipc-guard` (panel only), with
preload entries and `test/ipc-surface.test.js` updated:

- `skins:save(skin)`: strict-validates in main (never trust the panel), checks
  the id against `[\w-]{1,40}`, refuses an id that belongs to a built-in or a
  pack skin, writes `userSkinsDir()/<id>.json` atomically (temp file, then
  rename), then runs the same steps as `skins:reload` and broadcasts. Returns
  `{ ok, id, warnings }`.
- `skins:read(id)`: the JSON of a loose or built-in skin, for **Start from this
  one** and for **Edit** on your own skins.
- `painter:drafts` / `painter:draft-save` / `painter:draft-delete`, under
  `%APPDATA%\Shellby\painter\drafts`, with the same id check.

**Save** writes the skin. **Save and wear** also selects it. Your own skins get
**Edit** on their tile in Settings → Look, and the tile shows `by <author>`
(today the skin's author is shown nowhere, `settings.js:33,39`).

## 5. Share it (one click to the gallery)

**Share** on a saved skin:

1. Wraps it in a pack with a new pure helper, `wrapSkin(skin, { login, prev })`
   in `src/main/wardrobe/wrap.js`: `format: 1`, `id: skin-<skin id>`, `name`
   and `author` from the skin, `description` from the skin's, and `version`
   `1.0.0`, or the published version with its patch bumped when `prev` (the
   registry's entry for that id) exists. This is the version helper publish is
   missing today.
2. Installs the wrapped pack to the wardrobe dir (so it's a user pack, which is
   what publish takes), replacing an earlier wrap of the same skin.
3. Hands it to the existing `confirmAndPublishPack`, so the confirm dialog, the
   CC BY 4.0 agreement in the PR body and the "identical / same version"
   refusals are the ones already there.
4. Afterwards, a toast with the PR link, and the skin's tile shows
   **In review** until the registry lists it (checked when the Wardrobe opens,
   at most hourly), then **In the gallery**.

Not signed in, or the `publish` feature off: **Share** explains and offers
**Save a file** instead (the pack JSON, for a manual PR as in ADDONS.md) and
**Copy outfit code** if the skin is already in the gallery.

**A picture to post.** Next to Share, **📸 Card** draws a moment card (kind
`skin`, through `moment-card.js`): the skin big on the halo, its name, "by
<author>", and four small poses as tiles. See
[share-moments.md](share-moments.md) for the card kit changes.

## 6. Pack wishes

The `pack wish` issues are people saying what they'd like someone to make.

- The empty state of the Painter shows up to three open `pack wish` issues of
  kind *skin* (public GitHub API, no sign-in, cached a day, off when the app is
  offline), each with **Make this**. It starts a blank crab with the issue's
  title as the name and remembers the issue number in the draft.
- When a skin made from a wish is shared, the PR body says
  `For x-salmon/shellby#<n>`, and the PR link is posted to the wish as a
  comment by the sharer's own GitHub account, after asking. The maintainer
  closes the wish when the pack merges (a PR in `shellby-packs` can't close an
  issue in `shellby` by itself unless its merger can, so this stays a manual
  step).

## 7. Later: the rest of the Wardrobe

The canvas, palette, undo, drafts and checks are not crab-specific. Once skins
work, the same screen paints:

- **Accessories** (up to 16×16, one anchor slot), previewed on your crab.
- **Effects** (up to 8×8).
- **Tank decor** (up to 32×32, with frames).

Each is a mode with its own limits read from `catalog.js`, and **Share** wraps
it the way `wrapSkin` does. Packs that mix several kinds are still assembled by
hand or in the web Pack Studio; the app links to it from the Painter's menu.

## Docs and notes

- `docs/SKINS.md`: lead with the Painter; the hand-written JSON becomes "the
  format, for the curious". Fix **Sharing** (it still says to open a PR to
  `src/skins/` in this repo).
- `docs/ADDONS.md`: describe the in-app **Publish** button beside the manual PR.
- A change note, `changes/crab-painter.md`, under `### New`.

## Tests

- `test/pixel-grid.test.js`: flood fill (edges, same colour, holes), line,
  move, resize, undo and redo limits, palette character allocation.
- `test/skins-strict.test.js`: as above.
- `test/wrap.test.js`: `wrapSkin` ids, versions with and without `prev`, and
  that the result passes `validatePack` with no warnings.
- `test/ipc-skins-save.test.js`: id checks, refusing built-in and pack ids,
  strict validation in main, atomic write, the broadcast.
- `scripts/e2e-painter.js` (`// ci: painter`): start from classic, paint a
  pixel, see the preview change, pick a pose, save, see it in Settings → Look,
  wear it, see the crab window's skin change. Publishing runs against
  `test/fixtures/mock-github.js` as `e2e-github.js` does.
- `scripts/e2e-crab-anim.js`: the crab window's poses look the same before and
  after the stylesheet move (screenshots through `scripts/lib/shot.js`).

## Open questions

- **Does the Painter need its own room unlock** (`rooms.js`), or is it open
  from the start? Open from the start is simpler, and a hermit crab's own
  painter is a good first-day surprise.
- **Should a skin made from someone else's gallery skin say so?** CC BY 4.0
  asks for attribution. A `basedOn: "<pack id>"` field, shown as "based on X by
  Y", would cover it.
