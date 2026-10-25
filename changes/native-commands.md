### New
- **/context draws a bar.** Instead of a long table, you see how full the context window is and what's filling it, biggest first, with Claude Code's full breakdown folded underneath.
- **/ultraplan from the box.** Type `/ultraplan` and what to plan, or pick "Plan what's in the box in the cloud" in the palette. Claude Code opens in a terminal, asks before the cloud session starts, and the plan comes back there for you to edit and approve.
- **/subtask sends a helper off with the whole conversation.** A forked helper crab takes the task in the background while Claude carries on, and its result comes back to the conversation.
- **/mobile shows a QR code** for the Claude app, to scan with your phone.
- **The /insights report is a click away.** When Claude Code finishes the report, an "Open the insights report" button opens it in your browser.

### Fixed
- **Bring it home from your phone no longer leaves you stuck when it clashes.** If the branch it started from has moved on in ways that clash, the phone now offers "Ask him to sort it out", as the desk does: he merges the branch in, sorts out the clashes, runs the tests, and tells you when it's ready to bring home.

### Changed
- **Seven more of Claude Code's commands work here instead of sending you to a terminal.** `/tasks` shows the background tray above the box, `/workflows` jumps to this conversation's Ultracode runs, `/autofix-pr` opens Fix this build on your failing pull request, `/loops` and `/daemon` open Routines, `/wellbeing` opens Time for a focus session, and `/chrome` opens its setting.
- **Claude's schedules read in plain words.** When Claude sets itself a wake-up or a schedule, the step says when ("in 20 min: watching CI", "weekdays at 09:00") instead of showing raw settings.
