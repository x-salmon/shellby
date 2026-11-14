# Pages: small apps you build with Claude, on every screen you use

**Phase 1 is built** on this branch (2026-11-14): the screens for this PC, the
five MCP tools in the app and the plugin, and docs/PAGES.md for users. Phases
2 (phone) and 3 (other PCs) wait for the multi-PC hub branch to reach main.
Where the build went another way than this plan, see "Built" under Phases.

Mockups for every feature are in [pages-mockups/](pages-mockups/index.html):
open `index.html` in a browser (it uses Shellby's own tokens and fonts).

## What it is

A **page** is a small app that lives in Shellby: a print queue, a release
radar, a reading list, a board where your agents post what they found. You
describe it, Claude builds it, and it sits on the **Pages** screen beside your
conversations. You can open it beside a chat, on your phone and on your other
PCs, and Claude and your agents can read and write it as they work.

Why: Claude Code is good at making a small tool in a minute, and there's
nowhere to keep one. It ends up as a loose HTML file in Downloads, or a
script nobody runs twice. Shellby already has the frame that's missing:
somewhere it's always open, a phone app, a sync between PCs, and an MCP
server every conversation can reach.

**Agents get a shared place to write.** A page has its own data, and every
conversation (Shellby's tabs, a terminal, a routine at 3am) can add to it
through MCP. A routine that checks your dependencies can post to a "Dependency
radar" page. Three helper crabs can tick items off one checklist. What they
write is waiting on the page when you look, on any screen.

## Words

- **Page**: one small app. A folder of HTML, JS and CSS plus its `page.json`.
- **Shelf**: the Pages screen, where every page lives.
- **Page data**: the page's own storage, a JSON object of keys. The page,
  you and your agents all read and write it.
- **Access**: what a page asks for beyond its own data: reading Shellby's
  state, starting a turn with Claude, notifications, named web addresses.
  Shown in full, and agreed to, before the page first runs.

In the UI it's "page" and "Pages", never "app", "widget" or "mini-app". The
phone app is already "the app".

## The features

Each feature has its mockups in its own file.

### 1. The shelf ([mockups](pages-mockups/1-shelf.html))

A **Pages** screen on the bottom bar, after Workflows. A room in `rooms.js`, so
someone new sees it once they've made one page or opened the screen from More.

- Pages as tiles with a live miniature of each (a screenshot taken when it
  last closed, `capturePage` into `pages/<id>/thumb.png`), the name, and one
  line of what changed last ("Claude added 2 rows, 4 min ago").
- **Pinned** pages come first, and up to three can pin to the Beach as a
  strip, so a page you check daily is on the first screen.
- Search by name or what's on the page (the data's text, indexed like History).
- A tile shows its state: off, came from another PC, needs your OK for new
  access, failed to load, being built.
- The right-click menu: Open, Open beside the chat, Change with Claude,
  Pin, Show its data, History, Turn off, Delete.
- Ctrl+K finds pages by name and opens them.
- Empty: three starters to build in one click, and a box to describe your own.

### 2. Running a page ([mockups](pages-mockups/2-running.html))

A page opens full-screen in the panel, under a slim header: back, its name,
a dot for live data, **Change with Claude**, and the menu.

- **Beside the chat:** a page is a new tool kind in `shared/panes.js`
  (`page:<id>`), so it can sit in a split pane next to a conversation. The
  natural use: Claude works on the left, the board it's updating is on the right.
- **Its data:** a drawer that shows the page data as a tree, editable, with
  who changed each key last (you, the page, or which conversation).
- **History:** every save of the page's files is a version (the last 20, in
  `pages/<id>/.versions/`). Each one says who made it and why, with **Go back
  to this one**. Going back makes a new version from the old one, so nothing is
  lost (it counts towards the 20). Page data isn't versioned: only the files.
- **Who changed each key** is kept beside the data (`data.json` holds
  `{ values, by }`, where `by[key]` is `{ who, at }`), because the activity
  list only keeps the last 200 writes.
- **When it breaks:** an uncaught error or a blank page after 5 seconds shows
  a card with the error, **Fix it with Claude** (sends the error, the file and
  the line), and **Go back to the last version**.
- **When it asks for something:** a call to `shellby.ask()` shows a card in
  the header, never a dialog the page draws itself.

### 3. Building a page with Claude ([mockups](pages-mockups/3-building.html))

**New page** opens a sheet: a box to describe it, starter ideas, and which
project it belongs to (or none). Pressing **Build it** starts a conversation
with the page-authoring skill loaded and a live preview beside it.

- The skill (`claude-plugin/skills/page-authoring/`) holds the format, the
  bridge API and its limits, and Shellby's tokens so a page can match the app
  if you want it to. It writes through `create_page` and `update_page`, never
  by raw file edits, so every save is checked and versioned.
- The preview reloads on each `update_page`. Claude's draft is only a draft
  until you press **Save to my pages**. A draft lives in its conversation: it
  isn't on the shelf or in `list_pages`, agents can't write to it, and it
  doesn't sync. Its preview runs with **no access** (calls get a "draft"
  refusal it can show), and the access sheet comes with Save to my pages.
  `create_page` from a conversation you started in Shellby makes a draft
  without a confirmation window, because saving it is the confirmation.
- Starters are prompts, not files: pressing one fills the box. That way a
  starter is never code that needs its own review.
- **Change with Claude** on any page opens the same conversation, with
  "point at it" mode: click part of the page to name it in your message
  (like line comments in the viewer).
- Checks on every save: total size, the file list, no remote scripts or
  styles, no `eval` or inline handlers that the CSP would block anyway (so the
  failure says why instead of the page going blank), and access that matches
  what the code calls. A failed check goes back to Claude as the tool's error.
- Saving it the first time celebrates (the crab's real-milestone celebrate).

### 4. Agents and pages ([mockups](pages-mockups/4-agents.html))

MCP tools in `crabmcp.js` (Shellby's tabs) and the plugin's server (any
Claude Code). Descriptions are short: every tool schema goes to the model on
every turn.

| Tool | Arguments | What it does |
|---|---|---|
| `list_pages` | none | Each page's id, name, one-line description and data keys. |
| `read_page` | `id`, `keys?` | The page data, or just those keys. |
| `write_page` | `id`, `set?`, `remove?`, `append?` | Changes keys. `append` adds to a list key without reading it first, so two agents don't overwrite each other. |
| `create_page` | `name`, `description`, `files`, `access?` | A new page. Opens the confirmation window. |
| `update_page` | `id`, `files`, `why` | New version of its files. Confirmation only when access grows. |

- A page's **Agents** setting: who may write. Any conversation (the default),
  only Shellby's own tabs, or nobody (read-only to agents).
- A write shows on the page and in the conversation as a tool row: "Added 2
  rows to **Print queue**", which opens the page. Shellby pulses the dot in the
  page's header; marking the new rows is the page's own job, from
  `shellby.data.onChange` (the sandbox keeps Shellby out of its DOM, and the
  skill tells Claude to do it).
- Each page keeps an **activity** list: the last 200 writes, each with who
  (the conversation's title, or "a terminal in shellby", or a routine's name).
- A write to a page you're not looking at can toast, if the page asks to
  (`notify` access), and on the phone it's a notification.
- `create_page` from a conversation you didn't start in Shellby (a routine, a
  terminal) needs the confirmation window like `add_routine` does: **Add page**
  or **Not now**. Nobody answers at 3am, so a window still open when the
  routine's turn ends closes, and the page lands on the shelf switched off,
  "Wants to be added", like a page from another PC.
- "Only Shellby's own" means calls through `crabmcp.js`: Shellby's tabs, their
  helpers and routines. "Any conversation" adds the plugin's server: terminals
  and editors.
- `notify` is access the page asks for. Each page also has **Tell me when it
  changes**, on by default when it has that access, so you can quiet one
  without taking the access away.

### 5. Access and safety ([mockups](pages-mockups/5-access.html))

A page is code a model wrote, running in Shellby. It's the first such thing:
wardrobe packs are data only on purpose. The boundary:

- It runs in `<iframe sandbox="allow-scripts">`, never `allow-same-origin`,
  so it has an opaque origin: no cookies, no storage of Shellby's, no access
  to the panel's DOM, preload or IPC. Its files come from a
  `shellby-page://<id>/` protocol (`protocol.handle`) with
  `Content-Security-Policy: default-src 'none'; script-src 'self';
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
  font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'`.
  **Spike done (2026-11-13, Electron 45.2.3, Chrome 156):**
  `scripts/spikes/pages-sandbox/` runs 44 escape attempts from a hostile page
  against a local canary (HTTP, WebSocket, UDP, TCP), three times each.
  - `'self'` works: the page's own scripts, styles and images load from
    `shellby-page://<id>/`. Another page's files don't, and neither do
    inline script, `eval` or workers.
  - Shellby's DOM, its preload, storage, cookies, pop-ups and modals are all
    out of reach. Every network route CSP covers is blocked, and so is a
    page navigating its own frame away, which the panel's `frame-src`
    stops.
  - **WebRTC is the one way out CSP doesn't cover.** STUN over UDP and TURN
    over TCP both reached the canary. `setWebRTCIPHandlingPolicy(
    'disable_non_proxied_udp')` stops UDP but not TCP. The fix is a
    `guard.js` that Shellby serves first in every page and that deletes
    every `RTC*` global: 44/44 three times. A fresh window to borrow them
    back from is blocked too (`window.open`, an `about:blank` child). Ship
    both the guard and the policy. Shellby uses no WebRTC itself.
  - The panel's CSP has to add `frame-src shellby-page:`. Today
    `default-src 'none'` blocks every iframe.
  - A page runs in its own process, so one stuck in a loop for 1.5 s held
    up the panel's timers by about 21 ms.
  - The bridge naming the page by `event.source`, and the 256 KB message
    cap, both held: a page claiming another page's id got its own data.
  - If the guard ever proves leaky, the fallback is a page in its own
    `WebContentsView` on a session whose proxy goes nowhere.
  - Not tested: Safari on the phone (phase 2).
- Everything else goes through `postMessage` to the frame (`pages/bridge.js`
  in the renderer, `pages/rights.js` in main), and every call is checked
  against the page's agreed access in main, not in the renderer.
- **Access** a page can ask for, in `page.json`:
  - `read`: `usage`, `conversations`, `projects`, `health`, `routines`,
    `git` (per project). Read-only snapshots, each its own entry.
  - `ask`: start a turn with Claude. Always shows a card with the prompt and
    the mode; Ask first unless you pick otherwise; never Autonomous.
  - `notify`: toasts at the desk and notifications on the phone, at most
    one a minute.
  - `web`: a list of `https:` hosts. `shellby.fetch()` goes through main,
    which allows only those hosts, GET and POST, no cookies, 1 MB, 15 seconds,
    20 a minute. The iframe itself still can't reach the network.
- First run, and any version that asks for more, shows the access sheet: what
  each entry lets it do, in plain words, with **Let it** and **Not now**. A
  page from another PC or a routine always shows it.
- **Settings → Pages:** every page's access in one list, and **Turn every page
  off**.
- A call it wasn't given fails in the page with a clear error, and shows once
  in the page's header ("It tried to reach api.example.com, which it didn't ask
  for"), with **Let it** as a shortcut to the access sheet. The save check
  catches hosts written into the code, so this happens for an address built
  while it runs. **Let it** adds the host to the page's access marked "added by
  you", which keeps it separate from what Claude declared.
- Limits: 512 KB of files, 1 MB of data, 200 keys, 20 versions, 100 pages.

### 6. On your phone ([mockups](pages-mockups/6-phone.html))

A **Pages** tab in the phone app (`src/renderer/pocket/`).

- A page marked `"phone": true` opens full-screen in a sandboxed iframe,
  served by the phone server at `/pages/<id>/<file>` with the same CSP and the
  `sandbox` directive in the header. Bridge calls go through the phone server's
  device-token API to `pages/rights.js` on the PC, the same checks as the desk.
- A page not marked for the phone says so ("Built for the desk: ask Claude to
  make it fit a phone"), with **Change with Claude** starting that as a task.
- `ask` from the phone obeys the phone's own rules (mode chosen on the phone,
  Ask first by default, the 30-an-hour limit).
- Pinned pages show on the beach as a row, and Android's long-press menu gets
  the first pinned page.
- When the PC is asleep, the phone shows the page's last snapshot read-only
  (kept by the service worker), with when it was taken. A snapshot is a
  captured picture plus the data's text for search, not the page's code, so
  nothing runs and the bridge needs no offline mode.
- **Pages** is the phone's fifth tab, after Beach. A page's header on a phone
  holds back, its name, the dot and ⋯; Change with Claude, its data and History
  are in the menu, because the page needs the width.
- Android's long-press shortcut to the first pinned page lags behind pin
  changes (the browser refetches the manifest when it chooses). That's
  accepted: the phone's beach row is always right.

### 7. On your other PCs ([mockups](pages-mockups/7-sync.html))

Through the same private gist, in its own file `shellby-pages.json` (the main
file's 512 KB cap is already budgeted). `sync/pages.js`, pure, like
`sync/plans.js`.

- Each page goes on its own and follows whichever PC changed it last.
  Its data merges key by key, with `append` lists merged item by item.
- A page that arrives comes **switched off** with its access not agreed, and
  the shelf says "2 pages came from your laptop". It runs once you look and say
  **Turn it on**. **Not on this PC** leaves this PC's copy off and quiet until
  the page next changes on another PC.
- A page that arrives **changed** keeps running the version you agreed to here.
  The new one waits on its tile ("A new version from your laptop") until you
  look. Otherwise every Change with Claude on the laptop would switch the page
  off at the desk.
- History doesn't travel. Each PC keeps its own versions, so when a page was
  changed on two PCs, the one that loses is kept in History only on the PC
  that had it.
- Pages travel in the order they were last opened. Those past the budget stay
  on their PC (one page is at most 1.5 MB, so it's always a combination that
  overflows).
- A page can be **This PC only** (a page about one PC's drives makes no sense
  elsewhere). Its data can be too, separately.
- What doesn't fit the budget (2 MB across all pages) stays on its PC, and its
  tile says so, rather than stopping the whole sync.
- The gist is untrusted input: every page is checked again by the same rules
  as `create_page`.

## The format

```
%APPDATA%\Shellby\pages\<id>\
  page.json       name, description, icon, access, phone, project, version
  index.html      the entry point
  *.js *.css      flat: no folders, at most 20 files
  data.json       the page data (written by main only)
  activity.json   the last 200 writes
  thumb.png       for the shelf
  .versions\      the last 20 versions of the files
```

```json
{
  "format": 1,
  "id": "print-queue",
  "name": "Print queue",
  "description": "What's next on the printer, and what failed.",
  "icon": "🖨️",
  "phone": true,
  "project": null,
  "access": { "read": ["usage"], "ask": true, "notify": true, "web": [] },
  "agents": "any"
}
```

`docs/page.schema.json` checks it, like `addon.schema.json` does packs.

## The bridge

`shellby-page://<id>/shellby.js` is served to every page (the page includes
it; the skill tells Claude to). Every call is a promise over `postMessage`
with an id, answered or refused by main.

```js
shellby.data.get(key?)          // the page data, or one key
shellby.data.set({ key: value }) // changes keys
shellby.data.append(key, item)   // adds to a list
shellby.data.onChange(fn)        // after any write: yours, an agent's, another PC's
shellby.read('usage')            // a snapshot, if the access allows
shellby.ask('Summarise the failed prints', { mode: 'ask' }) // a card first
shellby.notify('Print done', 'Benchy finished in 42 min')
shellby.fetch('https://api.example.com/x', { method: 'GET' })
shellby.say('Queue is empty!')   // the crab says it
shellby.theme                    // Shellby's tokens, to match the app or not
```

Shellby can't see into the frame, so `shellby.js` also does what the panel
would otherwise do from outside, without the page calling anything:

- **Errors**: it sets `window.onerror` and `unhandledrejection` and posts the
  message, file and line. That's where "When it breaks" gets its card.
- **Ready**: it posts `ready` after the page's first paint. No `ready` within 5
  seconds means the page didn't load.
- **Point at it**: when the panel turns the mode on, it swallows the page's own
  clicks, outlines what's under the pointer, and posts the clicked element's
  text and a short selector. The panel's **Point at it / Use it** switch
  turns it off again.
- A page that leaves out `shellby.js` gets none of this, and its tile says so.
  The save check requires it.

## Where it goes

- `src/main/pages/`: `store.js` (files, versions, data, limits; pure where
  possible), `rights.js` (the access checks), `protocol.js`, `fetch.js`,
  `service.js` (events, thumbnails), `checks.js` (save checks).
- `src/main/ipc/pages.js`, with schemas in `ipc-args.js`.
- `src/main/crabmcp.js` and `claude-plugin/mcp/server.js`: the five tools.
  Bump the plugin's version with `PLUGIN_VERSION` and the marketplace entry.
- `src/main/sync/pages.js`, and `github/sync.js` reads the second file.
- `src/main/pocket/`: routes for `/pages/`, and `rights.js` for the bridge.
- `src/renderer/panel/html/pages.html`, `pages.js`, `pages-bridge.js`,
  `pages.css`; a `page:` kind in `shared/panes.js` and `tool-tabs.js`.
- `src/renderer/pocket/pocket-pages.js`.
- `claude-plugin/skills/page-authoring/`.
- `docs/PAGES.md` for users, a threat-model row ("Page → Shellby").

## Tests

- `test/pages-store.test.js`: limits, versions, data merge, bad files.
- `test/pages-rights.test.js`: every bridge call allowed and refused.
- `test/pages-checks.test.js`: each save check.
- `test/sync-pages.test.js`: last-writer per page, per key, append lists,
  arrivals switched off, budget overflow, a hostile gist.
- `test/pocket-pages.test.js`: the phone routes, token required, CSP header.
- `scripts/e2e-pages.js`: build a page with the fake CLI, open it, write to it
  over MCP, see the row arrive, open it beside a chat, break it and go back a
  version. A page that tries `fetch`, `top.location`, `parent.document` and
  `localStorage` directly, and fails at each.

## Phases

Screens are numbered as in
[pages-mockups/full/index.html](pages-mockups/full/index.html). **All 49 are in
scope** (chosen 2026-11-13): the 30 marked Core, plus every extra:
5, 6, 7, 10, 14, 18, 20, 21, 24, 26, 27, 34, 38, 39, 41, 42, 45, 48 and 49.

1. **Pages on this PC: screens 1–35.** The spike on the CSP and sandbox is
   done (section 5). Next come the format, store, protocol and bridge, then
   the shelf, running a page, building it with Claude, the MCP tools, access,
   and the threat-model row.
   **Built**, with these departures from the plan above:
   - Pages sits at the end of the bar (Ctrl+9), not after Automate, so
     nobody's Ctrl+number shortcuts move.
   - The format lives in the build and change prompts (`pages/prompts.js`),
     not a plugin skill, so it's always the one this Shellby checks against.
   - A page's files are kept per version (`v\<n>\`); the shelf's miniature is
     `thumb.jpg`, taken after the page loads and after its data settles.
   - Settings › Pages is a section of Settings › Claude.
   - Page scripts load in CORS mode (the scheme has `corsEnabled`), so an
     error keeps its message, file and line for Fix it with Claude.
   - Pinned pages (screen 6) went into the open-conversations list
     (Ctrl+Shift+A), after "Waiting for your OK": the desk has no list-like
     Beach, and that list is where what needs you is sorted.
2. **On the phone: screens 36–42.**
   **Built** (`pocket/pages.js`, `renderer/pocket/pocket-pages.js`), with
   these departures:
   - The phone app frames a page from its own origin, at
     `/pages/<cap>/<file>`: an iframe can't send the device token, so the app
     trades it for a capability (32 random bytes, bound to one phone and one
     page, a few minutes long). Each response carries the desk's page CSP
     with `sandbox allow-scripts` and `frame-ancestors 'self'`.
   - A conversation a page starts keeps Ask first (or Plan) only until its
     first answer, as at the desk (`sessions.js` `modeToStart`).
   - The asleep snapshot is the miniature and the data as text, kept in the
     service worker's cache when the page was last open.
   - Android's long-press shortcut to the first pinned page isn't built.
3. **On your other PCs: screens 43–49.**
4. **Sharing** (later, maybe): a page to the community gallery as a pack,
   which needs review like skins do, since it's code.

## Words on the buttons

One action, one name, everywhere it appears (desk, phone, toasts):

| Moment | Yes | No |
|---|---|---|
| Agreeing to access (first run, more access, a refused call) | **Let it** | **Not now** |
| A page's `ask()` | **Ask Claude** | **Not now** |
| `create_page` from a routine or terminal | **Add page** | **Not now** |
| A page from another PC | **Turn it on** | **Not on this PC** |
| A draft | **Save to my pages** | **Keep changing it** |
| A broken page | **Fix it with Claude** | **Go back to the last version** |
| A version in History | **Go back to this one** | |
| Settings | **Turn every page off** | |

The limits the copy quotes (512 KB of files, 1 MB and 200 keys of data, 20
versions, 100 pages, web calls at 1 MB, 15 seconds and 20 a minute, a 2 MB sync
budget) live as named constants in `src/main/pages/limits.js`. The checks and
the words read them from there.

## Decided (2026-11-13)

- **Code, not blocks.** Pages run real JS in the sandbox, because custom apps
  are the point. Blocks (lists, tables, charts, forms) may come later as a
  starter kit inside JS pages. The sandbox spike (section 5) backs this.
- **A page belongs to you**, with an optional project tag. Pages kept in a repo
  (`.shellby/pages/`) could come later, under the same arrives-switched-off
  rule, since they'd arrive with code you cloned.
- **At most 5 pages open at once.** Each open page is a renderer frame in its
  own process. Opening a sixth closes the oldest one that's off screen.
- **One look for the Agents' checklist**: the dark task board, in every mockup.
