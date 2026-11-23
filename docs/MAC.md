# Shellby on a Mac

Shellby runs on macOS 12 and later, on Apple silicon and Intel, from the same
code as the Windows app. This page covers what's different on a Mac, how each
Windows-only piece was carried over, and what's still left.

## How each part works on a Mac

| Area | Windows | Mac |
|---|---|---|
| Ending what Claude started | Job objects (`process-job.js`) | `posix-job.js`: a `ps` look every 3 s while a task runs remembers its processes by pid and start time, so an orphaned MCP server is still found and a reused pid is never taken for it. Same calls, so nothing above it changed. |
| Ending a process tree | `taskkill /T` | `proc-tree.js` `killTree`, both platforms |
| Shells | cmd, PowerShell | `shells.js`: `/bin/sh` for commands Shellby makes, your own zsh or bash for `!` commands |
| Finding Claude Code | `%APPDATA%`, `.local\bin` | `~/.local/bin`, `~/.claude/local`, Homebrew, then PATH |
| PATH | The user's | An app opened from Finder gets launchd's bare PATH, so `shell-env.js` reads your login shell's once at start |
| Sign-in watch | `.credentials.json`'s time | The Keychain item's change time (`security`, never the secret) |
| Installing Claude Code | `install.ps1` | `install.sh`, downloaded whole before it runs |
| The desktop layer | Owned by the desktop's window | The window level just under every app's (`native-mac.js`) |
| Perching | Win32 window list, owned windows | `CGWindowListCopyWindowInfo` (no permission needed) and `moveAbove`, with a light watch that keeps him above the window when it's raised |
| Spaces | n/a | His windows are on every Space, but not over a fullscreen app's |
| Shortcuts | Ctrl | Cmd: `shared/mac-ui.js` hands a Cmd press to the panel as its Ctrl one. Settings still store `Ctrl+…`, so your keys sync between the two |
| Words | "this PC", "Windows" | Read as "this Mac", "macOS", "Open at login" in the panel's own text, never in the conversation |
| Menu bar, Dock | Tray only | An app menu (Edit is what makes Cmd+C work), the Dock icon opens the panel, `shellby://` links arrive as `open-url` |
| Push-to-talk | System.Speech | `packaging/mac/ear`, a small Swift helper using Apple's recognizer, on the Mac only |
| Now playing | Windows' media session | Music and Spotify, asked only while they're already open |
| Health | LHM, nvidia-smi, PowerShell | CPU, memory, the startup disk and the busiest processes from `ps`. No temperatures |
| Continue in terminal | Windows Terminal | A `.command` script of Shellby's own, opened in Terminal (or your default for them), that deletes itself |
| Open in VS Code | `code.cmd` | The launcher inside VS Code, Insiders or Cursor's app |
| The `shellby` command | User PATH in the registry | One marked line in `~/.zprofile` (and `~/.bash_profile` if you have one) |
| ssh | Windows' OpenSSH and its agent service | `/usr/bin/ssh`, macOS's own agent, keys kept in the Keychain |
| Dev servers | `CreateProcessW`, hidden console | `/bin/sh` in a session of its own, so it outlives Shellby the same way |

## Not on a Mac (yet)

Hidden on a Mac rather than shown broken (`.win-only`):

- **Temperatures and fans.** Apple silicon has no public sensor interface. CPU, memory and disk still work.
- **Startup apps** in Health, **Developer clutter** cleanup, and **OpenRGB** lighting.
- **Holding up a shutdown** while work is unpushed (macOS has no shutdown-reason line). "Is it safe to leave?" still works.
- **Giving way to a game.** A fullscreen game on a Mac has a Space of its own, out of his.
- **Typing along** (the global keyboard hook) needs Input Monitoring. It's off until that's built.

## Building

On a Mac with Xcode's command line tools:

```bash
npm ci
bash packaging/mac/build-ear.sh       # the dictation helper, both architectures
npx electron-builder --mac dir        # Shellby.app in dist/, unsigned
npm run dist:mac                      # both, then a DMG and zip for each architecture
```

`npm test` runs on a Mac as it does on Windows. The checks that need a real Mac
(the sweep in `test/posix-job.test.js`) skip on Windows.

## CI

- **mac** (in CI): the unit tests on macOS, the dictation helper compiled, the app
  packaged, and `scripts/mac-smoke.js` checking the packaged app starts.
- **e2e-mac**: the whole UI suite on macOS, in three shards. It has
  `continue-on-error` until it's green there; take that off once it is.
- **Release**: the `mac` job builds and uploads the DMGs, zips and
  `latest-mac.yml` to the draft before the Windows job publishes, and
  `release-guard.js` won't publish without them. Signed and notarized once the
  Apple secrets are set (see [SIGNING.md](SIGNING.md#mac-developer-id)).
