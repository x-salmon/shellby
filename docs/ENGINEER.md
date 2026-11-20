# Engineer mode

The difference between engineering and "just do it" is when the decisions get
made. Engineer mode makes Claude make them first, in the open, and waits for
your yes before anything is built. Then it holds the work to what was decided,
and checks the result for itself instead of taking Claude's word for it. It's
for anyone: someone learning sees the questions an engineer asks every time,
and someone experienced gets a decision record without writing one.

Code: `src/main/engineer.js` (the tools and what each accepts, pure),
`src/main/engineer-gate.js` (the gate and the diff check, pure),
`src/main/engineer-prompts.js` (what Claude is told, pure),
`src/main/wiring/engineer.js` (the conversation's side), `src/main/ipc/engineer.js`,
and `src/renderer/panel/engineer.js` with `engineer-card.js` (the chip, the
note above the box, and the cards).

## How it goes

1. **The chip.** **Engineer** under the box turns it on for one conversation.
   History keeps it, so a reopened conversation still has it on. It needs
   **Settings → Claude → Tell Claude it's running in Shellby**, which gives
   Claude the crab's tools. With the chip on, the note above the box can turn
   it on for **every new conversation in the project**.
2. **Decide.** Each message gets one `[Shellby: …]` line saying what Claude must
   do next. Claude explores, reading earlier records in `docs/decisions` first,
   then calls the crab's `decide` tool with:
   - the goal and what constrains it,
   - the options it weighed (each with pros and cons), its pick and why,
   - its **scope**: the files and folders it will change, relative to the repo
     root (`src/cache/`, `src/prices.js`, `test/*.test.js`),
   - the test plan, each check with the project's own command where there is
     one (`npm run test`, `cargo test`, ...),
   - the risks,
   - and, when they apply: **steps** for work too big for one go, **related**
     records it builds on, the record it **supersedes**, how sure it is
     (**confidence**) and how hard it would be to undo (**reversibility**).

   Then it ends its turn. Questions that change nothing are answered as usual.
3. **The card.** The decision shows up as a card in the conversation. You can:
   - **Approve** Claude's pick,
   - **Go with another option** instead,
   - **Send it back** with a note on what should change,
   - **Ask a critic**: Claude starts a helper whose only job is to argue
     against its pick, then sends a new card with the critic's strongest
     points in it (and a changed decision where the critic was right). It
     uses some of your plan, which is why it's a button and not the default.
   - **Spike it first**: Claude asks to try something out before deciding (see
     below). A decision marked low confidence and hard to undo says so, and
     the button is picked out.

   An optional note goes along with any of these.
4. **Build.** Approving sends Claude a message: write the decision down (see
   below), keep to the scope, do the work (step by step, reporting each, when
   there are steps), and run the test plan.
5. **Amend.** When the work needs a file outside the scope, the gate stops the
   edit and tells Claude to call `amend_decision` with the files and why. That
   shows on the same card; **Allow** widens the scope, **Keep to the scope**
   tells Claude to manage without (or come back with a new decision).
6. **Check.** Claude finishes with `check_decision`: whether the work followed
   the decision, what it did, where it left the decision and why, and each
   check in the test plan with passed, failed or skipped. With steps, each
   step is reported the same way (`step: 2`) and shows on the card as it
   lands; the last one closes it. Then **Shellby checks for itself** when that
   turn ends:
   - **The diff.** Every turn's diff while the decision was being built (the
     same per-turn snapshots Undo uses) is compared with the scope. Files
     changed outside it are listed on the card, whoever wrote them: an edit,
     a script, an install. The decision record's folder never counts.
   - **The test plan.** Each check that came with one of the project's own
     commands, Shellby runs itself, in the conversation's folder, with the
     same rules as turn checks (`checks.js`): only command lines Shellby builds
     (`checks.isSafeCommand`), the first run in a project asks you first, and
     a pared-down environment. A command Claude wrote that isn't one of those
     stays Claude's word only, and the card shows which is which.

   The next change needs a new decision.

## Spikes

Some choices depend on something only trying will show: does the library do
X, how slow is Y. Before deciding, Claude can call `spike` with the question
and its plan. That's a card too: **Let it try** or **Decide without it**.

While a spike runs, Claude may change any file in the project. Every turn's
diff is kept, and when Claude calls `end_spike` with what it found, Shellby
puts every file the spike changed back (newest turn first, with the same undo
that refuses to overwrite a file changed again since) once that turn ends.
What it found goes on the spike's card, and on the next decision's card.

A spike can't leave anything behind that the undo wouldn't catch, so while it
runs the gate holds back commits, pushes, branch changes, stashes, publishing,
requests that change something elsewhere (`curl -X POST`, `gh`, cloud CLIs),
other MCP servers' tools, and edits outside the project. **Stop and put it
back** on the card ends it at once; so does turning the chip off. A spike needs
the project to be a git repo, since the snapshots are git trees.

## The gate

Telling Claude to decide first isn't enough on its own, so Shellby enforces it.
With Engineer mode on, Shellby's work hook (`PreToolUse`) matches every tool,
not only the ones that edit files (`initHooks({ everyTool })`). It asks
Engineer mode first (`session.gate`, before `beforeWork`). The hook also runs
for helpers' tools, so a subagent can't get around it. If the gate itself
throws, the step is held back, not let through.

**With nothing approved**, it lets through only what looks around:

- reading, searching, fetching, asking and planning tools (`LOOKS` in
  `engineer-gate.js`),
- the crab's tools that change nothing in the project,
- shell commands that only read (`worktrees/looks.js`),
- the project's own checks (its test, typecheck and lint scripts, as
  `checks.js` finds them), so Claude's trade-offs come from what it measured.
  **Settings → Claude → Let Claude run the project's checks before deciding**
  turns this off.
- the commands you allowed for the project, exactly as written, from
  **Commands before deciding** in the note above the box (at most 12).

Everything else is denied with the reason, including another MCP server's
tools, handing work to another conversation and starting a workflow.

Deciding whether a shell command only reads is a judgment call, so the rule
is strict: anything not known to be read-only counts as a change. Each command
is split into words the way the shell would (quoted text stays one word, and
quotes and escapes come out), and anything that could read differently to the
shell than to the check counts as a change: script blocks and subexpressions,
curly quotes, `$'...'`, comments, an unclosed quote. Read-only commands that
can write or run something with one flag count too, e.g. `git diff --output`
(or any start of it git would accept, like `--outp`), `git -c`, `rg --pre`,
`fd -x`, `find -fls`, `sed` with `w` or `e`, and a lone `&`.

**Once a decision is approved**, file edits (Edit, Write, MultiEdit,
NotebookEdit) go through only inside the scope and any amendments you allowed.
Paths are measured from the repo root, whichever copy of it the conversation
is in. Outside the project, only Claude's own places are allowed (the temp
folder and `~/.claude`). Shell commands run, since what they'll write can't be
known beforehand: the diff check catches anything they wrote outside the
scope. An approval lasts until `check_decision` (the last step's, with steps),
until you press **Close this decision** on the card, or until the chip goes
off. Turning the chip back on doesn't bring an old approval back. The gate is
on only while Claude has the tools to get past it. If Settings takes the
crab's tools away, Engineer mode stops holding changes back.

The gate makes Claude decide first. It doesn't replace the permission modes:
in Ask first, every edit and command still asks you too.

## Decision records

With **Settings → Claude → Write Engineer decisions into the repo** on (the
default), approving a decision asks Claude to write it to
`docs/decisions/NNNN-<title>.md` before it starts. The record has a context,
the options considered, the decision, the scope, the test plan and the risks.
If the folder already has records, Claude follows their style. It links the
records the decision builds on, and a decision that supersedes an earlier one
sets that record's status to "Superseded by NNNN". Claude writes the record,
not Shellby, so it goes through the same permission prompts and the same copy
of the repo as the rest of the work, and it ends up in the same diff.
`check_decision` can name the file, and the card links it.

Records or not, the cards stay in the conversation's History.

## What it costs

- **The tools.** `decide`, `check_decision`, `amend_decision`, `spike` and
  `end_spike` are listed only in conversations with Engineer mode on. Every
  listed tool costs tokens on every turn, so others don't carry them. A
  process's tools are fixed while it runs, so turning the chip on or off lets
  the process go (as Safe mode does). The next message starts it again,
  resumed. That one message reads the conversation without the cache.
- **The line.** Each message carries one short line. It goes in the message,
  not the system prompt, so it never breaks the cache.
- **Shellby's checks.** The diff check reads snapshots Shellby takes anyway.
  Running the test plan costs no usage, only the time the commands take on
  this PC.
- **A critic** is a helper agent, so it uses your plan. Only when you ask.

## Why it's built like this

- **The card answers with a message, not by holding the tool call.** `decide`
  returns at once and Claude ends its turn. Your answer is a new message. That
  avoids MCP timeouts, works from the phone and after a restart, and leaves the
  conversation's History reading like a review: proposal, answer, work.
- **A chip, not a sixth permission mode.** The modes say how much Claude may
  do without asking. Engineer mode says when it has to think. They combine:
  Engineer with Auto-edit is a common pair.
- **Scope on edits, the diff for the rest.** A file edit names its file, so
  the gate can hold it to the scope. A shell command doesn't, and guessing
  from its text would be both leaky and annoying, so commands run and the
  diff, which sees everything, says what they touched.
- **Shellby runs only what it would build itself.** A test plan is Claude's
  text, so its commands go through the same allow-list as turn checks: the
  project's own scripts by name, or a fixed few (`cargo test`, `go test`,
  pytest). Anything else stays a check Claude reports on.
- **A spike is undone from snapshots, not trusted to clean up after itself.**
  The per-turn snapshots already see everything a turn did, scripts and
  installs included, so putting them back is the same Undo you'd press, and it
  stops rather than overwrite a file changed again since.
