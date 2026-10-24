### New

- **What Claude was blocked from.** When a permission rule or a hook refuses a tool call, the turn ends with a quiet line naming each one, with what it was reaching for ("Claude was blocked from: Bash (rm -rf dist)"). A No you clicked yourself is already a card, so it isn't repeated.
- **The mode chip follows Claude Code.** When a conversation's permission mode changes on Claude Code's side (an approved plan going on with edits allowed, say), the chip and the crab's planning follow, instead of showing the mode you set last.
- **Hooks you can see running.** While one of your hooks runs, the working line says which ("Running hook PreToolUse:Bash…") until it's done, so a slow hook never reads as Claude stuck.
