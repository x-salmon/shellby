# Engineer mode

The difference between engineering and "just do it" is when the decisions get
made. Engineer mode makes Claude make them first, in the open, and waits for
your yes before anything is built. It's for anyone: someone learning sees the
questions an engineer asks every time, and someone experienced gets a decision
record without writing one.

Code: `src/main/engineer.js` (the rules, pure), `src/main/wiring/engineer.js`
(the conversation's side), `src/main/ipc/engineer.js`, and
`src/renderer/panel/engineer.js` (the chip and the card).

## How it goes

1. **The chip.** **Engineer** under the box turns it on for one conversation.
   History keeps it, so a reopened conversation still has it on. It needs
   **Settings → Claude → Tell Claude it's running in Shellby**, which gives
   Claude the crab's tools.
2. **Decide.** Each message gets one `[Shellby: …]` line saying what Claude must
   do next. Claude explores, then calls the crab's `decide` tool with:
   the goal, what constrains it, the options it weighed (each with pros and
   cons), its pick and why, the test plan, and the risks. Then it ends its turn.
   Questions that change nothing are answered as usual.
3. **The card.** The decision shows up as a card in the conversation. You can:
   - **Approve** Claude's pick,
   - **Go with another option** instead,
   - or **Send it back** with a note on what should change. Claude rethinks
     it and a new card follows.
   An optional note goes along with any of these.
4. **Build.** Approving sends Claude a message: write the decision down (see
   below), do the work, run the test plan.
5. **Check.** Claude finishes with `check_decision`: whether the work followed
   the decision, what it did, where it left the decision and why, and each check
   in the test plan with passed, failed or skipped. That shows up on the same
   card, which moves to the end of the conversation. The next change needs a
   new decision.

## The gate

Telling Claude to decide first isn't enough on its own, so Shellby enforces it.
With Engineer mode on, Shellby's work hook (`PreToolUse`) matches every tool,
not only the ones that edit files (`initHooks({ everyTool })`). It asks
Engineer mode first (`session.gate`, before `beforeWork`). Until a decision is
approved, it lets through only what looks around:

- reading, searching, fetching, asking and planning tools (`LOOKS` in
  `engineer.js`),
- the crab's tools that change nothing in the project,
- shell commands that only read (`worktrees.startsWork`).

Everything else is denied with the reason, including another MCP server's
tools, handing work to another conversation and starting a workflow.
The hook also runs for helpers' tools, so a subagent can't get around it.
If the gate itself throws, the step is held back, not let through.

Deciding whether a shell command only reads is a judgment call, so the rule
is strict: anything not known to be read-only counts as a change. Read-only
commands that can write or run something with one flag count too, e.g.
`git diff --output`, `rg --pre`, `find -fls`, `sed` with `w` or `e`, and a
lone `&`.

An approval lasts until `check_decision`, until you press **Close this
decision** on the card, or until the chip goes off. Turning the chip back on
doesn't bring an old approval back. The gate is on only while Claude has the
tools to get past it. If Settings takes the crab's tools away, Engineer mode
stops holding changes back.

The gate makes Claude decide first. It doesn't replace the permission modes:
in Ask first, every edit and command still asks you too.

## Decision records

With **Settings → Claude → Write Engineer decisions into the repo** on (the
default), approving a decision asks Claude to write it to
`docs/decisions/NNNN-<title>.md` before it starts. The record has a context,
the options considered, the decision, the test plan and the risks. If the
folder already has records, Claude follows their style. Claude writes the
record, not Shellby, so it goes through the same permission prompts and the
same copy of the repo as the rest of the work, and it ends up in the same diff.
`check_decision` can name the file, and the card links it.

Records or not, the card stays in the conversation's History.

## What it costs

- **The tools.** `decide` and `check_decision` are listed only in conversations
  with Engineer mode on. Every listed tool costs tokens on every turn, so
  others don't carry them. A process's tools are fixed while it runs, so
  turning the chip on or off lets the process go (as Safe mode does). The next
  message starts it again, resumed. That one message reads the conversation
  without the cache.
- **The line.** Each message carries one short line. It goes in the message,
  not the system prompt, so it never breaks the cache.

## Why it's built like this

- **The card answers with a message, not by holding the tool call.** `decide`
  returns at once and Claude ends its turn. Your answer is a new message. That
  avoids MCP timeouts, works from the phone and after a restart, and leaves the
  conversation's History reading like a review: proposal, answer, work.
- **A chip, not a sixth permission mode.** The modes say how much Claude may
  do without asking. Engineer mode says when it has to think. They combine:
  Engineer with Auto-edit is a common pair.
