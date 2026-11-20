### Fixed

- Making a copy of a project no longer runs the repository's own git hooks, so a pull request from a fork can't run code on your PC by adding a `post-checkout` hook.
- `shellby do` without `--mode` no longer starts an Autonomous conversation when Shellby is set to Autonomous: it uses Smart instead. Pass `--mode` to choose another mode.
- The `shellby` command in cmd and PowerShell no longer runs a `node.exe` sitting in the folder you ran it from.
- The OBS overlay only answers requests addressed to this PC, so a web page can't read the crab's speech or project names through DNS rebinding.
- File links to `.rdp`, `.appinstaller`, Excel web-query, SYLK, `.mht` and Excel add-in files now show the file in its folder instead of opening it.
