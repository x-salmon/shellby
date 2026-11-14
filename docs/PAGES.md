# Pages

A page is a small app that lives in Shellby: a print queue, a reading list, a
board your helper crabs post to. You describe it, Claude builds it, and it stays
on the **Pages** screen (Ctrl+9) with data of its own that you, the page and
your agents can all read and add to.

## Making one

**New page** on the Pages screen asks what it's for, or offers a starter.
**Build it** starts a conversation that knows how pages work. Claude makes the
page with `create_page`, and it opens as a draft beside the chat, reloading
each time Claude changes it. A draft isn't on your shelf, and agents can't
write to it, until you press **Save to my pages**.

To change a page later, press **Change with Claude** in its header. **Point at
it** lets you click part of the page first, so Claude knows which part you
mean.

## Agents and your pages

Shellby's conversations, routines and helpers, and Claude Code in a terminal or
editor (through the Shellby plugin), have five tools:

| Tool | What it does |
|---|---|
| `list_pages` | Your pages, with their data keys |
| `read_page` | A page's data |
| `write_page` | Changes keys, or appends to a list without overwriting anyone |
| `create_page` | A new page: a draft beside the chat, or switched off until you add it when it comes from a routine or a terminal |
| `update_page` | New files for a page, with why, for its History |

Each page's **Settings** say who may write: any conversation, only Shellby's
own, or nobody. Its **Activity** shows the last 200 writes and who made each
one.

## What a page can do

Every page keeps its own data. Anything more it has to ask for, and you see it
in plain words before it first runs, with **Let it** and **Not now**:

- **Read** your usage, conversations, projects, PC health, routines or git state.
- **Ask Claude** something. You see the request on a card and press Ask Claude
  yourself. It never runs in Autonomous.
- **Notify** you, at most once a minute.
- **Fetch** from the web addresses it names: `https` only, through Shellby, never
  this PC or your local network.

A newer version that asks for more waits for your OK and keeps running with
what it had until then. **Settings › Claude › Pages** lists everything every
page can do, and has **Turn every page off**.

## The sandbox

A page is code a model wrote, so it runs in a sandboxed frame with no way out
but a message channel to Shellby:

- It has no network of its own and can't reach Shellby's window, your files,
  other pages or your cookies.
- WebRTC is taken away.
- Every call it makes is checked by Shellby against what you agreed to.

The full picture is the "Page → Shellby" row in
[THREAT-MODEL.md](THREAT-MODEL.md).

## On your other PCs

With **Sync between PCs** on (Settings › Accounts › GitHub), your pages follow
you through the same private gist, in a file of their own. **Settings › Claude ›
Pages › On your other PCs** has its own switch, so your crab's progress can sync
while pages stay home, and shows how much of the 2 MB your pages share is used,
when they last synced, and which pages travel.

- **A page that arrives is switched off**, with its access not agreed, even if
  you wrote it yourself yesterday on your laptop: it's code from a file on the
  internet. The Pages screen says "2 pages came from your laptop" with **Look at
  them**. Looking shows what it is, where it came from and what it asks for,
  with its miniature behind glass (a picture, not the code). **Turn it on** is
  the same agreement as Let it; **Not on this PC** leaves this PC's copy off and
  quiet until the page next changes elsewhere.
- **A page that changed on another PC keeps running the version you agreed to
  here.** The new one waits on its tile ("New version from your laptop") until
  you look, so a Change with Claude on the laptop never switches the desk's page
  off. It's in History either way.
- **Each page follows whichever PC changed it last.** History doesn't travel:
  when a page was changed on two PCs, the later save wins, and the PC whose
  version lost keeps it as a version in History ("Kept from this PC"), one press
  from coming back.
- **Data merges key by key.** Each key follows the PC that wrote it last, a
  removed key stays removed, and a list both PCs appended to keeps both PCs'
  items. Data that arrives shows in the page at once, exactly like an agent's
  write: the header's dot pulses and a strip says "2 added to rows from your
  laptop".
- **Where it goes**, in a page's menu: the page **Everywhere** or **This PC
  only**, and its data **Goes with it** or **Stays on this PC** (a dependency
  radar can go everywhere while what it found about this PC's projects stays).
- **The budget** is 2 MB across all your pages, spent in the order you last
  opened them. A page that doesn't fit stays on its PC and its page says so,
  with the bar; every other page still goes. Change with Claude is right there
  to make it smaller.
- **Deleting a page deletes it on your other PCs too**, the way a routine
  deleted on one PC goes on the others; the confirmation says so.

Every arriving page is checked again by the same rules as a new one, and
nothing from the gist runs before you've said so on this PC.

## Limits

A page has at most:

- 20 files, 512 KB together
- 1 MB of data in 200 keys
- its last 20 versions kept
- 20 fetches a minute

Shellby keeps 100 pages and 20 drafts, and 2 MB of pages travel between PCs.

## Where they live

Pages live in `%APPDATA%\Shellby\pages\<id>\`:

- `v\<n>\`: each version's files.
- `data.json`: the page's data, who wrote each key, and which keys were removed.
- `activity.json`: who wrote what.
- `state.json`: on or off, what you agreed to, pinned, and how it syncs (where it
  goes, a version waiting from another PC).
