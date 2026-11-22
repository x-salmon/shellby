# Everything Shellby can do

The whole tour. Back to the [README](../README.md).

- [Gets things done with Claude Code](#-he-gets-things-done-with-claude-code)
- [Every PC, every agent](#️-every-pc-and-every-agent)
- [Runs your dev day](#️-he-runs-your-dev-day)
- [Gets out more](#-he-gets-out-more): terminal, phone, stream, GitHub
- [You stay in control](#-you-stay-in-control)
- [The crab](#-and-a-crab-who-does-the-work)
- [How it works](#how-it-works)

## Which screens you start with

Already use Claude Code on this PC? The tool screens are on the bar from the start: **History**, **Projects**, **Notes**, **Health**, the **Toolbox** and **Automate**. New to it, you start with just him, a chat box and **First steps**: open a project, give Claude a task, see what he changed, and say hi to the crab. Each step ticks itself off when you really do it, and any of them can be skipped. The tool screens open as he works: History, Projects and Notes after his first task, Health and the Toolbox after his third, Automate after his fifth. The game side (Finds, the Bugdex, Us and the Tank on his screen, the Sticker Book on Outfits, the Crew over the Toolbox's Agents, a project's Reef and Review mastery) waits until First steps are done or he reaches level 3, then opens as tasks earn it, each with a "new" on its door. Can't wait? **More → Show every screen**, or **Settings → System → Screens → Show everything now**, puts them all out, and [Work mode](DESKTOP.md#work-mode) starts with every one of them. If you used Shellby before First steps existed, nothing changes for you.

## ⚡ He gets things done with Claude Code

<table>
<tr>
<td width="50%"><img src="img/screenshot-crew.png" alt="Three helper agents in crew lanes; one asks to run a script it wrote"></td>
<td width="50%"><img src="img/screenshot-lean.png" alt="Toolbox → Lean: every new conversation carries about 24k tokens; plugins priced, with two marked idle"></td>
</tr>
<tr>
<td align="center"><sub>Helpers work in parallel, each in its own lane</sub></td>
<td align="center"><sub>Lean Shell shows what every conversation carries</sub></td>
</tr>
</table>

**Work in parallel**

<img src="img/screenshot-panes.png" alt="Four Claude conversations in a 2x2 grid: fixing a login bug, writing tests, reviewing a PR and updating the README">
<p align="center"><sub>Drag a tab into the chat to split it: up to twelve conversations side by side, or pop one out into its own window</sub></p>

- **Helper crabs:** every subagent gets a lane in the panel and a crab on your desktop, and each kind levels up into a named crew member.
- **Tabs on their own branches:** with copies on (**Settings → Code → Copies of a project**), each one works in its own copy of the repo. **Bring it home** merges it back, never with a force-push.
- **Up to twelve side by side,** or branch from any turn to **try it another way**.

**Keep your code safe**
- **Undo any turn,** or any step within one, including what a script or `npm install` did.
- **Run checks** stamps your test results on a turn, with before and after pictures.
- **Comment on the diff,** line by line, and send all your comments back as one follow-up.
- **Review a whole branch** in the file viewer: comment on any line, see the words that changed inside a line, tick files as viewed, hide whitespace-only changes, and <kbd>Ctrl</kbd>+<kbd>F</kbd> / <kbd>Ctrl</kbd>+<kbd>G</kbd> to find and jump.
- **Engineer mode:** Claude weighs the options and puts its decision on a card before it builds anything. Approve it, pick another option, send it back, ask a critic, or have Claude try it out first (every change put back). Your files stay untouched until you approve, then only the files it named are changed. Shellby checks the result itself: the diff against the plan, and the test plan's commands, run by Shellby. Each decision is written into `docs/decisions` for whoever comes next.
- **Learns from your corrections:** correct Claude the same way twice and he offers to add it to `CLAUDE.md` as a rule.

**See what it costs**
- Every turn shows its tokens and its share of your 5-hour window, and **Lean Shell** shows what each new conversation carries before you type, plus the files, commands and hooks that keep filling it. [What it covers](CLAUDE-CODE.md#lean-shell-more-out-of-your-plan)
- **Spend less on helpers and small asks:** run the helpers Claude sends out on Sonnet, start a quick question on Sonnet, and get a word before a cold cache or a pile of screenshots makes a message expensive.
- **Messages typed close together go as one turn:** three quick Enters become one message, and messages that pile up behind a running turn go together when it ends. Every turn saved is usage kept.
- **The cost of a big run before it starts:** with Ultracode on, or a message that asks for several helpers, the box says what runs like it have taken of your 5-hour window and offers to run it after the reset instead. Routines wait for the reset by themselves when the window is nearly full.
- **Switch models mid-conversation** from the model chip or with `/model`, like in the terminal.
- **Keep warm while you're away:** press the mug in the tab strip before lunch. Each conversation of 200k tokens or more gets one tiny message just before its cache's hour runs out, so your first message back reads the conversation from the cache instead of writing it all again. It turns itself off when you're back, or after 3 hours.

**Work your way**
- <kbd>Ctrl</kbd>+<kbd>K</kbd> for everything, every slash command, and push-to-talk.
- **All files** (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>): the whole project beside the chat, each file with its git mark, lit up as Claude reads, writes and commits. Click a file and it goes along with your messages, so "this" means that file.
- A **Toolbox** for your skills, agents, MCP servers and hooks.
- Hand a conversation to the terminal and back, or run Claude Code on another computer over ssh.
- **Conversations that work together:** Claude can read the other conversations open in the project and hand one of them, or a new one, a brief. You see the brief as a card first, and nothing is sent until you say so.

**[Everything he does with Claude Code →](CLAUDE-CODE.md)** · **[Already use Claude Code in a terminal or editor? Here's what he adds →](WHY-SHELLBY.md)**

## 🖥️ Every PC and every agent

<table>
<tr>
<td width="50%"><img src="img/screenshot-pcs.png" alt="Your PCs: Desk PC, Build box, Laptop and Den PC, with how many tasks each is working on, one waiting on you on the laptop, CPU load and the agents each can run"></td>
<td width="50%"><img src="img/screenshot-agents.png" alt="A conversation run by Gemini CLI: a note that Gemini CLI runs it with its own model, tools and sign-in, then it reads the CHANGELOG and edits the README"></td>
</tr>
<tr>
<td align="center"><sub>Every PC you run Shellby on, and what's waiting on you there</sub></td>
<td align="center"><sub>A conversation on Gemini CLI, in a tab like any other</sub></td>
</tr>
</table>

- **Your PCs** (<kbd>Ctrl</kbd>+<kbd>K</kbd> → Your PCs): this PC and every other one you run Shellby on, each with what it's doing, what's waiting on you, its load and heat, memory, disk, power and the agents it can run. Add a PC with the code it shows under **On your phone**, then start a task on it here, under that PC's own rules.
- **Answer your other PCs from this one:** allow, always allow or deny a prompt, pick an answer to a question, or read a plan to its end and approve it. Open any of their conversations to watch it live and reply.
- **Conversations on Gemini CLI, OpenCode or Codex:** <kbd>Ctrl</kbd>+<kbd>K</kbd> → New conversation in… gives you a tab like any other, with the reply as it's written, each tool it runs, its plan as the to-do list and its permission prompts as cards, using that agent's own model and sign-in.
- **A local model on this PC:** point Settings → Claude → Local model at Ollama or LM Studio (or let Claude set one up for you). It can write Shellby's small drafts, answer a question Claude declines, or run whole conversations with every Claude Code tool, spending nothing from your plan and sending nothing away.

<img src="img/screenshot-pcs-wide.png" alt="Your PCs at full screen: four PCs in one table with working, waiting on you, CPU, GPU, memory, disk, power, agents and projects, and the picked PC's conversations, facts and a New conversation button below">
<p align="center"><sub>Your PCs at full screen: the full table, and the picked PC's conversations beside its facts</sub></p>

<p align="center"><img src="img/screenshot-local-model.png" width="460" alt="Settings → Local model: drafts go to qwen3:8b on 127.0.0.1 first, with a switch and a model for each job it writes: learned rules, routine, hook and workflow drafts, and writing up your day"></p>
<p align="center"><sub>The local model, and the jobs it does before Claude</sub></p>

**[Your PCs and other agents →](HUB.md)**

## 🗂️ He runs your dev day

<table>
<tr>
<td width="50%"><img src="img/screenshot-projects.png" alt="The Projects page: five repos, one with a dev server up on :5173 and one down"></td>
<td width="50%"><img src="img/screenshot-devserver.png" alt="A crashed dev server: npm run dev crashed 3 minutes ago, exit code 1, with the error lines marked in red"></td>
</tr>
<tr>
<td align="center"><sub>Every repo you work in, and its dev servers</sub></td>
<td align="center"><sub>A crash, with what to send Claude a click away</sub></td>
</tr>
</table>

- **Projects:** the repos you work in, here and on GitHub, with their branches and unpushed work. **Start** a dev server and a `:5173` pill sits by the crab.
- **When a server crashes** he holds up a red sign. The card marks the error lines and shows exactly what would go to Claude, and nothing is sent until you say so.
- **Point at it:** a running dev server's card opens your site in a Shellby window. Click the part you want changed (<kbd>Shift</kbd>+click for up to five), say what should change, and it goes to Claude in that project with a picture of it. <kbd>F2</kbd> points again, and in a draft page what you point at goes to the conversation building it.

<img src="img/screenshot-point.png" alt="Pointing at a dev server's page: a tide-forecast site with its See today's tides button and a Moss Landing station card outlined and numbered 1 and 2, and under them a box reading Match the button to the cards' teal, with Send to Claude">
<p align="center"><sub>Point at the parts you want changed and say how</sub></p>
- **Start from where the work is:** **Fix this build** on a red pull request sends Claude the failing step's log, **Address the review** quotes the comments still open (a new review comment offers it on its notification), and **Next up** ranks what to work on in each project (your tasks, your notes, its GitHub issues and milestones, the TODOs in its code), each with **Do this**: a conversation in a copy on its own branch, the prompt waiting for you to send.
- **Notes for later:** jot an idea on a project's Notes, or ask Claude to note it from the chat. **Plan**, **Build** or **Ask** turns one into a conversation, Plan and Build in a copy of their own. Pick a note to read Claude's answer beside it, and **Plan Claude's version** when it said to do it differently.
- **Time on each project:** hours worked out from what he already sees, a month at a time on a calendar where you fix any day's hours and timesheet lines, clients and rates, a PDF or CSV timesheet, and a day at a time to Toggl, Clockify or Harvest when you send it. Off until you turn it on.
- **Flaky tests** caught and fixed for real, **dependencies** checked weekly with a pull request to bump them, and **Is it safe to leave?** before you lock up or shut down.
- **He knows your limits:** when you'll hit your 5-hour window, and a message held for after the reset goes by itself.
- **Run it when my limit resets:** queue heavy tasks ("refactor X", "write tests for Y") on the Routines page, for when the window resets or for tonight. They start by themselves, overnight too, one after another, with the PC kept awake. Each result goes to your phone, and a task that runs out of usage partway carries on after the next reset.
- **Workflows and routines:** a schedule, a red build, a release or a file landing in a folder starts a list of steps: Claude, commands, web requests, a question for you. [Workflows](WORKFLOWS.md).
- **Your MCP servers in them:** tick the servers a step may use and Claude files the Linear issue or posts to Slack without stopping to ask, or call one tool directly with no Claude turn at all. Pair it with [n8n](N8N.md) for everything else.

<img src="img/screenshot-time-wide.png" alt="History → Time at full screen: a month on a calendar, each day darker the longer you worked, 54 hours and $5,640 billable this month, and the picked day open beside it with a line per project and Write up the day">
<p align="center"><sub>Time at full screen: a month of hours, and any day open beside it to fix or write up</sub></p>

<img src="img/screenshot-projects-wide.png" alt="Projects at full screen: the repo list on the left and 3d-rack open beside it, with Next up, Pulse, Health, Helpers, a standup report and its dev server side by side">
<p align="center"><sub>Projects at full screen: the list on the left, the one you pick beside it with its cards side by side</sub></p>

**[Projects, time, tests and dependencies →](PROJECTS.md)**

## 🌊 He gets out more

<table>
<tr>
<td width="50%" valign="top">

```powershell
shellby do "tidy my Downloads"
shellby do @review
shellby say "all green"
shellby status
shellby time last-week
```

**From any terminal,** and Claude can drive him too, through the plugin's MCP server: have him say what a skill is up to, or celebrate when a release lands. It can't start tasks of its own.

</td>
<td width="50%" valign="top">

<img src="img/screenshot-away.png" alt="Settings → Alerts → Tell me when I'm away: ntfy selected, a QR code to scan with your phone, and a topic Shellby picked">

</td>
</tr>
</table>

- **📱 Your phone:** a permission prompt, a finished run or a red build can reach it. ntfy is one QR scan, and Telegram finds your chat by itself. Answer Allow or Deny from it if you like.
- **🦀 Shellby on your phone:** the whole thing as an app on your phone, served by your own PC over [Tailscale](https://tailscale.com): every conversation live, Allow and Deny, new tasks, diffs, Undo and Bring it home, with notifications that open the right card. No account of ours, no server in the middle. **[Shellby on your phone →](PHONE.md)**
- **🎥 On stream:** an OBS browser source on a transparent background. **💡 On your desk:** OpenRGB lighting that follows his mood. **🎛️ On a Stream Deck:** Allow, Deny, Stop, Bring it home and Ready to review as hardware keys, each showing what's waiting. **🎮 On Discord:** his level and what he's up to on your profile.
- **✅ CI on your pull requests:** a ✗ sign when a build goes red, a dance when it's fixed, and **Fix this build** to hand Claude the failing log.
- **Sync and visiting crabs,** with an optional GitHub sign-in that only asks for what you turn on.

**[Phone, stream, lights and GitHub →](CONNECTIONS.md)**

## 🔒 You stay in control

- **Permission cards:** **Allow**, **Always allow** or **Deny**, with <kbd>Y</kbd> / <kbd>A</kbd> / <kbd>N</kbd>. The card warns you when a command runs a script Claude wrote, or an edit touches Claude Code's own setup.
- **Five permission modes,** from Ask first to a fenced-off Autonomous. See [Permission modes](../README.md#permission-modes).
- **Spending guard:** routines and workflows stop before they use the share of your 5-hour window you keep for yourself.
- **Your sign-in, your PC:** your own Claude plan or API key, no telemetry, and your history stays on your PC.

---

## 🦀 And a crab who does the work

<p align="center"><img src="img/lineup-life.png" width="860" alt="Five Shellbys: one saying 'fingers crossed', one in a focus helmet with 18 minutes left, one holding up a red CI sign, one sweating at 83 degrees, and one asleep in his shell"></p>

He's how you see the work without opening anything. He scuttles while Claude works, raises a claw when it needs you, sends a helper crab out for every subagent, holds up a red sign when a build breaks or a dev server crashes, and says *"all green!"* when the tests pass. He lives on the wallpaper layer, behind every window, and there's nothing to look after.

The rest is there if you want it, and none of it needs Claude or an account:

- **A desk pet with a life of his own:** a voice and a temperament (chipper, fussy, cocky or sleepy), little scenes when nothing's happening, finds he digs up, hide and seek and fetch, a bond that grows, a tank to decorate, and a beach with a sandcastle for every project you ship. [On your desktop →](DESKTOP.md) · [His tank →](TANK.md)
- **Dress him up:** 175 accessories, 45 effects and 19 crabs, 148 trophies and 99 levels, a sticker for every repo you ship, and the [Bugdex](BUGDEX.md), where every kind of bug Claude fixes is a creature he scoops into a jar. More from other people in the **[community gallery](https://getshellby.com/community/)**. [Outfits, trophies and stickers →](WARDROBE.md)
- **He watches your PC:** he sweats when the GPU runs hot, gets dizzy when memory's full and overstuffs his shell when a drive fills up, with live vitals, what's hogging it, what starts with Windows and the developer clutter you can clear. A warning says what's behind it ("Running hot because of Cyberpunk2077"), how it got there and what would help. [How Health works →](HEALTH.md)
- **Things to try:** throw him at a title bar and he rides the window, fling him at the edge of the screen and he climbs it, rub the mouse over him to pet him. Pals, typing along and pranks stay off until you turn them on. [All of it →](DESKTOP.md)

<img src="img/screenshot-health-wide.png" alt="Health at full screen: Running hot because of Cyberpunk2077 in large type, then how it got there (88% of the GPU, 83°C against an 80°C line, for under a minute), what would help (close it, see everything running, move your line), what's hogging the GPU, and the vitals in a column beside it">
<p align="center"><sub>Health at full screen: the verdict, how it got there and what would help, with the vitals beside it</sub></p>

**Work mode** keeps him to himself: your tools lead the bar, he only speaks up about the work, and the climbing, pals, pranks and confetti take the day off. Turning it off puts every setting back as it was. [Work mode →](DESKTOP.md#work-mode)

<p align="center"><img src="img/beach-card.png" width="700" alt="A pixel beach at night: fourteen sandcastles of different sizes with flags and lit windows, finds washed up along a line of seaweed, plots with buckets and spades, and Shellby by the newest castle"></p>

## How it works

```mermaid
flowchart LR
    C["🦀 Critter window<br/><sub>desktop layer, click / drag / drop</sub>"] -- click --> P["Panel<br/><sub>chat, approvals, settings</sub>"]
    P <-- "IPC (preload bridge)" --> M["Electron main"]
    M -- "stdin: user turns,<br/>permission answers, interrupt, mode" --> CLI["claude -p<br/>stream-json"]
    CLI -- "stdout: events,<br/>can_use_tool requests, usage" --> M
    CLI --> S[("Your Claude<br/>subscription")]
    T["⌨️ shellby CLI ·<br/>🔌 plugin hooks + MCP"] -- "127.0.0.1" --> M
    M -. "OBS overlay · OpenRGB ·<br/>phone notifications" .-> O["Out in the world"]
```

Shellby doesn't talk to any AI API itself. Each conversation is one long-lived, official Claude Code process that you signed in to yourself, driven over the same stream-json host protocol the Claude Agent SDK uses. Shellby never sees your Claude sign-in, and usage counts against your plan's normal limits, exactly as if you'd typed the task into a terminal. The protocol, billing safety and how he stays on the desktop layer are in [DEVELOPMENT.md](DEVELOPMENT.md#how-shellby-drives-claude-code).
