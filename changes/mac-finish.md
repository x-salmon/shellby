### Fixed

- On an Apple silicon Mac, Local model setup counts the memory its GPU shares, so a 16 GB or bigger Mac is offered a coding model instead of being told it runs on the CPU.
- On a Mac, a dev server whose port is taken names the program holding it and offers to stop it, as on Windows. AirPlay Receiver, the usual holder of :5000, is never offered.
- On a Mac, Health and the crab read memory in use as Activity Monitor does. macOS keeps spare memory full of cache, which read as nearly full, so he looked dizzy on most Macs.
- On a Mac, ssh to another computer asks for your key's passphrase or password in Shellby, as on Windows. Before, it couldn't ask at all.
- On a Mac, a workflow's run steps get their values. Every {{ value }} came out empty there.
- On a Mac, "Alt text" on the share card stays as words instead of turning into ⌥.
- Split and Show beside the chat work when the panel is already as tall as the screen allows (a small display, or the Dock on a Mac). They said there was no room.

### Changed

- On a Mac, a workflow's run steps run in dash rather than your own shell, and a command with a {{ value }} keeps to plain words and quotes ($HOME rather than ${HOME}, no [ ] or { }, no builtins that take a variable's name). The editor says what to change, so a value from a trigger can never run as code.
