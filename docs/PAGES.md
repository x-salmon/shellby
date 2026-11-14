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

## On your phone

With [Shellby on your phone](PHONE.md) set up, the app has a **Pages** tab,
after the Beach. It's the same shelf as the desk's, in the same order, pinned
pages first, and your pinned pages are a row on the Beach too.

- **A page made for a phone opens full screen**, in the same sandbox as at the
  desk. Its data is live from your PC: a write at the desk or from an agent
  shows on the phone straight away. Every call it makes goes back to your PC
  and is checked there, so a page can't do more from the sofa than at the desk.
  Ask Claude to "make it fit a phone" and Claude marks it `"phone": true`.
- **A page built for the desk** shows on the shelf greyed, with **Change with
  Claude** to make it fit a phone. That starts as a task on your PC, in Ask
  first.
- **When a page asks Claude something**, the phone shows its own task sheet
  with the question in full. You pick Ask first or Plan only, and it counts as
  one of the phone's tasks for the hour. A page never starts anything itself.
- **A page's notifications** reach the phone too, named after the page, at
  most one a minute.
- **When your PC is asleep**, a page you've opened on the phone shows how it
  last looked, dated and read-only. Nothing runs from that copy.
- **A read-only phone** can open pages and read their data, and nothing else.
- **A page that reads from your PC** (your usage, git, your conversations)
  opens at the desk only, for now. On a phone, one of the sandbox's layers is
  missing until it's been checked on real phones, and these pages have the
  most worth keeping in.

## Limits

A page has at most:

- 20 files, 512 KB together
- 1 MB of data in 200 keys
- its last 20 versions kept
- 20 fetches a minute

Shellby keeps 100 pages and 20 drafts.

## Where they live

Pages live in `%APPDATA%\Shellby\pages\<id>\`:

- `v\<n>\`: each version's files.
- `data.json`: the page's data.
- `activity.json`: who wrote what.
- `state.json`: on or off, what you agreed to, pinned.
