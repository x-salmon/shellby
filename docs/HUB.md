# Your PCs: Shellby as a hub for your other computers

One PC shows them all: this one and every other PC you run Shellby on, each with what it's doing, how it's holding up, and what it can run, and you can start a task on any of them from here. Open it with <kbd>Ctrl</kbd>+<kbd>K</kbd> → **Your PCs**. Back to [Out in the world](CONNECTIONS.md).

## What you need

- **Shellby on each PC**, and **Tailscale on each**, all signed in to the same Tailscale account. The hub reaches your other PCs over your own tailnet, as your phone does: nothing goes through a server of ours.
- **Shellby on your phone turned on, on each PC you add** ([PHONE.md](PHONE.md)). It's what puts that PC on your tailnet, and the hub pairs with it the way a phone does.

## Adding a PC

1. On the PC you're adding: **Settings → Alerts → On your phone**, turn it on, and press **Pair a phone**. It shows its address (`laptop.your-tailnet.ts.net`) and an eight-character code.
2. On the hub: **Your PCs → Add a PC**, type that address and the code, and give it a name if you like.

The code lasts five minutes and works once, as a phone's does. Only an address on your tailnet (`something.ts.net`) is ever accepted. The hub keeps that PC's token encrypted by Windows, and the other PC lists the hub among its paired devices (as *Desk PC (Shellby hub)*), where it can take its access away at any time with **Forget**.

## The roster

One row per PC: this one first, then the ones it can reach, then the rest.

| Column | What it shows |
|---|---|
| **Working** | conversations running there now |
| **Waiting on you** | permission prompts and questions waiting |
| **CPU**, **GPU** | load, and the GPU's heat (amber when it runs hot), from that PC's Health |
| **Memory**, **Disk** | memory in use, and free space on its system drive |
| **Power** | plugged in, charging, or on battery |
| **Agents** | Claude Code, Gemini CLI, OpenCode, Codex: what it can run |
| **Projects** | the projects Shellby there knows |

In the narrow panel it keeps **PC**, **Working**, **Waiting on you**, **CPU** and **Agents**, and the rest are in the detail under it. Widen or maximise the panel for the whole table.

A PC that's asleep, off or offline can't be told apart from here, so its row says **Not reachable** and when it was last seen, and keeps what it could run, faded. The hub tries it again by itself (more slowly the longer it's gone), and at once when you open Your PCs. A PC whose Health is off shows no load, heat or power.

## Doing things there

Select a PC for its conversations, its details, and **Start a task**: pick one of its projects, say what to do and how it may work (Ask first, Smart, Auto-edit or Plan only), and it starts there, in its own copy, under that PC's own rules for tasks from a phone: at most 10 at once and 30 an hour, held for the usage reset when you're at the limit. Its permission prompts come up on that PC's desk and on your phone. **Rename** changes what the hub calls it; **Remove** takes it off the hub and asks it to forget the hub too (one that's asleep can't hear that: forget the hub in its own Settings → Alerts → On your phone later).

This PC's own row starts a conversation in Chat, as ever.

## Not yet

Answering another PC's permission prompts from the hub, opening its conversations here, Linux machines over ssh in the roster, and Your PCs in the dock are next.
