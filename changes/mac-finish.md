### Fixed

- On an Apple silicon Mac, Local model setup counts the memory its GPU shares, so a 16 GB or bigger Mac is offered a coding model instead of being told it runs on the CPU.
- On a Mac, a dev server whose port is taken names the program holding it and offers to stop it, as on Windows. AirPlay Receiver, the usual holder of :5000, is never offered.
- On a Mac, Health and the crab read memory in use as Activity Monitor does. macOS keeps spare memory full of cache, which read as nearly full, so he looked dizzy on most Macs.
- On a Mac, ssh to another computer asks for your key's passphrase or password in Shellby, as on Windows. Before, it couldn't ask at all.
- On a Mac, a workflow's run steps get their values. Every {{ value }} came out empty there.
- On a Mac, "Alt text" on the share card stays as words instead of turning into ⌥.
- Split and Show beside the chat work when the panel is already as tall as the screen allows (a small display, or the Dock on a Mac). They said there was no room.
- On a Mac, the `shellby` command reaches the running app (it looked for its token only where Windows and Linux keep it), so `shellby next` and the rest work there.
- The Toolbox lists your own skills, agents and commands from CLAUDE_CONFIG_DIR when it's set, as Claude Code does, rather than always from ~/.claude.
- A project's Next up list shows to-dos added or ticked off from a terminal or by Claude straight away. An add and a tick-off close together could leave it showing the old list.
- Picking a Local mode preset while a model finishes downloading keeps your pick, rather than the download's re-pick undoing it.
- Helpers like Check the docs open their conversation with the prompt waiting in the box every time. On a busy machine it sometimes opened empty.

### Changed

- On a Mac, a workflow's run steps run in dash rather than your own shell, and a command with a {{ value }} keeps to plain words and quotes ($HOME rather than ${HOME}, no [ ] or { }, no builtins that take a variable's name). The editor says what to change, so a value from a trigger can never run as code.
