# Making a Shellby skin

The easiest way is the **Painter**: open Shellby's screen (**Shellby** in the bar
at the bottom of the panel) and pick **🎨 Paint**. No JSON, no text editor.

## Paint one

1. **Start from a crab you have.** Every skin you've got is there (built in,
   your own, and pack skins you've unlocked), plus a blank crab with classic's
   outline faintly behind it. Your own skins say **Edit**; anyone else's
   becomes a copy of your own. Drafts you were in the middle of come first.
2. **Paint.** Pencil (`B`), eraser (`E`), fill (`G`), eyedropper (`I`, or
   right-click anywhere), line (`L`) and move (`M`, to nudge the whole drawing
   one pixel at a time and re-centre him). `[` and `]` pick a 1- or 2-pixel
   brush, `Ctrl+Z` and `Ctrl+Y` undo and redo. **⤢** adds or trims a row or
   column on any edge (up to 40 × 32), and never scales.
3. **Each colour knows what moves.** A swatch's label is the body part it
   belongs to (shell, body, claw, eyes, stalks, legs or extra), so painting
   his claw in a claw colour is all it takes for it to wave. A new colour asks
   which part it is. **Parts** colours every pixel by its part instead, so
   "why doesn't his claw wave?" is answered by looking.
4. **Watch him move.** Beside the grid he does every mood (idle, working,
   asking, sleeping) and every way he works (thinking, reading, editing,
   running, searching, on the web, planning, waving the crew on), in your
   colours, with the same moves as on your desk. With the motion turned down
   in Windows, a pose holds still and **Play once** plays it.
5. **Wear your outfit** puts your hat, held item, shell and effect on him. If
   your crab isn't classic's shape, drag the five dots (head, face, neck, claw
   tip and shell top) to where they belong on him, so a hat sits on his head
   and not in the air. **Try him on the desk** puts your drawing on the real
   crab for a minute.
6. **Save** puts him in Settings → Look (and under Colors in the Wardrobe);
   **Save and wear** puts him on. Every change is kept as a draft as you go,
   so closing the panel loses nothing.

The strip under the grid says what's worth fixing, and **Show me** points at
the pixels. A colour with no part stops Save (it wouldn't move). No eyes, no
legs, or an anchor well off his body stops Share until you fix it or say
**That's on purpose**. Legs that touch, even at a corner, step together rather
than taking turns; that's only a note, since classic's do too.

The same screen paints **accessories** (up to 16 × 16, with a pivot: the pixel
that sits on its spot), **effects** (up to 8 × 8) and **tank decor** (up to
32 × 32), each with up to four pictures to flip between where that kind can
have them. They're saved as a pack of your own, so they're in the Wardrobe and
his tank's tray straight away.

## Sharing

**Share** sends what you painted to the community gallery
([getshellby.com/community](https://getshellby.com/community/)) as a pull
request from your GitHub account, so anyone can add it to their Shellby once
it's reviewed. You need to be signed in to GitHub with **Publish Wardrobe
packs** on (Settings → GitHub). It wraps your skin in a pack of its own
(`skin-<id>`), checks it the way the gallery's Pack check will, and shows the
same confirm window as any pack you publish. Afterwards the skin says **In
review** until the gallery lists it, then **In the gallery**. Sharing again
after a change is an update (the version goes up by itself, and the confirm
window says **Update**). If the gallery already has a pack with that name from
someone else, Share says so: save yours under another name and share that.

- Made from a [pack wish](https://github.com/x-salmon/shellby/issues?q=is%3Aopen+label%3A%22pack+wish%22)?
  The Painter lists a few open ones with **Make this**. The pull request says
  which wish it answers, and Shellby offers to comment on the wish for you.
- When a monthly crab contest is on, Share can enter it: the pack gets the
  month, and a new contest discussion opens in your browser, filled in, for
  you to add the picture and post.
- **📸** makes a picture of him to post anywhere.
- Not signed in? **Save a file** gives you the pack to open a pull request
  with by hand ([ADDONS.md](ADDONS.md#publishing-to-the-community-gallery)).

Original designs only, please: no copyrighted characters or logos. What you
share is yours, published under CC BY 4.0 with your name on it. A skin painted
from someone else's gallery skin says so (`basedOn`), as that licence asks.

## The format, for the curious

A skin is one JSON file in `%APPDATA%\Shellby\skins`: a pixel grid, a palette,
and a map that says which body part each colour belongs to. The Painter writes
these for you; you can also write one by hand:

1. Right-click Shellby → **Data folder**, then open `skins/` (or **Settings → Look → Open skins folder**).
2. Copy [`src/skins/classic.json`](../src/skins/classic.json) in, rename it `my-crab.json`, and change `"id"` to `"my-crab"`.
3. Change some colours, then hit **Reload** in Settings and pick your skin.

```jsonc
{
  "id": "my-crab",              // lowercase letters, numbers and - (the filename if left out); one with a built-in's id replaces it
  "name": "My Crab",
  "author": "you",
  "description": "One line shown on hover.",
  "palette": {                   // one character → one #rrggbb colour, up to 32; "." is see-through
    "S": "#1d5f5a",
    "b": "#ff7a5c",
    "e": "#16201f"
  },
  "parts": {                     // which animated part each character belongs to
    "S": "shell",
    "b": "body",
    "e": "eyes"
  },
  "pixels": [                    // up to 32 rows × 40 columns; "." (or any unmapped char) is transparent
    "..SSSS....",
    ".SSSSSbb.e",
    "..SSSSbbbb"
  ],
  "anchors": {                   // optional: where his head, face, neck, claw tip and shell top are, as [x, y]
    "head": [7, -1]              // (-16..48); leave it out on classic's shape
  }
}
```

The gallery takes the strict version of this, the skin in
[`addon.schema.json`](addon.schema.json): no fields beyond these (and
`basedOn`), parts only from the list below, ids in lowercase. A skin you drop
in the folder by hand is read more leniently (an unknown part is ignored), so
it still loads; the Painter saves only skins the gallery would take.

### Parts and what they do

| Part | Animation |
|---|---|
| `shell` | Stays put. Rocks gently while Shellby naps. |
| `body` | Tucks into the shell when he sleeps. |
| `claw` | Snaps while working, raised while asking, waves on hover. Rotates from its left edge. |
| `eyes` | Blink when idle, scan while working. |
| `stalks` | Move with the eyes. |
| `legs` | Split automatically into alternating groups that scuttle while working. Each leg that doesn't touch another (not even at a corner) is its own group. |
| `extra` | Decorations (hats!). No animation. |

### Tips

- Keep the classic proportions (22×13) and he'll sit nicely in the window at every size setting.
- Face right: the panel's permission card crops him on that assumption.
- `python scripts/make-icons.py my-crab --preview out.png` renders a big preview (needs the file in `src/skins/` and Pillow).
- Shellby validates skins on load. Bad colours or oversized grids are skipped with a console warning, so a broken skin can't break the app.
