# Launch: first users, then Show HN

Two parts, in this order: watch a handful of people use Shellby, fix what they trip on,
then post. Nothing here is user-facing; it's a working plan.

## Part 1: first-user sessions

**Who:** 5 to 10 people who already use Claude Code on Windows and have never seen
Shellby. At least two of them sitting with you or on a screen share. The rest can try
it alone and send the answers to the five questions at the end.

**Ground rules for you (the hardest part):**

- Don't explain, don't help, don't defend. When they're stuck, count to ten silently,
  then ask "what are you looking for?" Help only once they'd give up.
- Ask them to think out loud. Write down their exact words, especially "huh", "oh"
  and "wait, why...".
- Use their own repo and a real task they meant to do anyway, not a demo project.

**Script (about 30 minutes):**

1. **Before (2 min).** "How do you use Claude Code today? What annoys you about it?"
   Write the answer down: it's the pitch you should be making.
2. **Install (5 min).** Send only the README link. Watch: do they find the download,
   what does SmartScreen do to them, which setup option do they pick and why?
3. **First task (10 min).** "Open your project and give it something you'd normally
   give Claude Code." Don't mention any feature. Note what they click first.
4. **Two at once (5 min).** "Start a second task while that one runs." Do they find
   copies / branches on their own? Do they understand Bring it home?
5. **Undo (3 min).** "Pretend you didn't like that last change. Get rid of it."
6. **The crab (2 min).** Don't prompt. Just note: do they smile, ignore him, or ask
   how to turn him off?
7. **After (3 min).** The five questions below.

**The five questions:**

1. In one sentence, what is Shellby?
2. What would you tell a friend it's for?
3. Which part would you miss if it disappeared tomorrow?
4. What confused you or got in the way?
5. Will you keep it installed? (Check a week later whether they did.)

**What to do with it:** answers to 1 to 3 that repeat across people become the README
headline and the Show HN title. Every answer to 4 that appears twice is a bug to fix
before launch. If nobody would miss anything (question 3), don't launch yet: find out
why first.

## Part 2: Show HN

Post once the session fixes are shipped (don't wait for winget's review), Tuesday to
Thursday, about 8 to 10am US Eastern. Stay in the thread for the first three hours and
answer every comment. Swap the headline for what users said in question 1 if it beats
this one.

**Title (80 characters max):**

> Show HN: Shellby – parallel Claude Code tasks, undo per turn, and a pixel crab

**Link:** https://github.com/x-salmon/shellby

**Text** (first comment, in your own voice; edit freely):

> I started this as a desktop pet: a pixel hermit crab who walks around my taskbar and
> reacts when Claude Code is working. Seven weeks later it's the way I use Claude Code
> every day, so I'm sharing it.
>
> It drives the official `claude` CLI you've already signed in to, over the same
> stream-json protocol the Agent SDK uses, signed in however you already are, with
> your existing skills, hooks, MCP servers and CLAUDE.md. What it adds is the stuff I
> kept scripting around the CLI:
>
> - Several tasks at once, each in its own git worktree on its own branch, merged back
>   with one button (no force-pushes; it stops if the merge would clash).
> - Undo for any turn, or one step of a turn, including files a script or
>   `npm install` changed.
> - A queue that starts heavy work when your 5-hour limit resets, keeps the PC awake,
>   and resumes after the next reset if it runs out.
> - Permission prompts on your phone, so you can leave it running.
>
> Every subagent also walks out as a little helper crab, which is silly, but it turned
> out to be the fastest way to see what's running at a glance.
>
> Windows 10/11 only for now, Electron, GPL-3.0, no telemetry, no servers of its own.
> It's not affiliated with Anthropic.
>
> I'd especially like to hear where it gets in the way, and whether a Mac build would
> make you try it.

**Answers to have ready:**

- *"Why not Anthropic's own Claude Code desktop app?"* Answer this from a real
  side-by-side, not from memory: install it, run the same three tasks in both, and
  write down what each does that the other doesn't. Put the result in
  `docs/WHY-SHELLBY.md` before posting. This is the comment most likely to come first.
- *"Is this allowed with a Pro/Max plan?"* It runs the unmodified CLI you installed
  and signed in to yourself. Link "Is it allowed?" in WHY-SHELLBY.md, which quotes
  Anthropic's terms, and recheck them the day before. An API key works too.
- *"Electron for a desk pet?"* Link the idle-cost numbers in DEVELOPMENT.md.
- *"Mac/Linux?"* Honest answer and a rough date, or "tell me if you'd use it".

## Part 3: after HN

Same post, adjusted for each place, a day or two apart: r/ClaudeAI, r/ClaudeCode, and a
30-second clip of the helper crabs on X / Bluesky (the demo MP4 already works). On
Reddit lead with the GIF and the personal story; links in the body, not the title.
