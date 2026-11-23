# Installing Shellby

Back to the [README](../README.md).

**Just the crab:** download **Shellby-Setup-x.y.z.exe** (or the portable build) from [Releases](https://github.com/x-salmon/shellby/releases/latest), run it, and pick **Just the crab**. That's it: Health, the Wardrobe, his voice, trophies and crab cards, no account. You can add Claude Code later from Settings.

**Crab + Claude Code:**

1. **Install Claude Code** with Anthropic's installer (the one Shellby's first screen runs for you if you skip this) and sign in with your Claude account:
   ```powershell
   irm https://claude.ai/install.ps1 | iex
   claude auth login
   ```
   `npm install -g @anthropic-ai/claude-code` works too. Rather use an Anthropic API key, billed per token? Skip the sign-in and give it to Shellby's first screen: Windows (or your Mac's keychain) encrypts it and it stays on that computer.
2. Download **Shellby-Setup-x.y.z.exe** (or the portable build) from [Releases](https://github.com/x-salmon/shellby/releases/latest) and run it.
3. Shellby walks you through a two-step check (Claude Code found ✓, signed in ✓) and asks how much freedom he gets.

**From a package manager:** instead of downloading the installer,

```powershell
scoop bucket add shellby https://github.com/x-salmon/shellby
scoop install shellby/shellby
```

Scoop keeps him up to date with `scoop update shellby` (the in-app updater stands aside). He isn't on winget yet.

**Updating:** the installed version updates itself. He checks GitHub Releases, downloads in the background, and puts a dot on the ⚙ gear when an update is ready. Click **Restart and update** in **Settings → System → About**, or **Update to x.y.z and restart** in the tray menu, or just quit and it installs on the way out. Your settings live in `%APPDATA%\Shellby`, so they carry over. The portable build can't update itself: download the new `Shellby-Portable-x.y.z.exe` from [Releases](https://github.com/x-salmon/shellby/releases/latest) and replace the old one.

**Keeping Claude Code current:** Claude Code checks for its own updates only in an interactive terminal session, and the sessions Shellby starts aren't interactive, so a copy that only ever runs under Shellby would stay on the version you installed. Once a day Shellby asks the npm registry which version is newest and, if yours is older, says so once and puts an **Update** button in **Settings → System → About**, beside Shellby's own. It runs Claude Code's own `claude update`. Pick **Update it for me** there and he does it himself, only while no conversation is running; **Leave it to me** and he never asks the registry.

**Requirements:** Windows 10 or 11 (x64), or macOS 12 or later (Apple silicon or Intel). For the Claude side: Claude Code 2.1+, signed in with a Claude plan or an Anthropic API key.

## On a Mac

1. From [Releases](https://github.com/x-salmon/shellby/releases/latest), download **Shellby-x.y.z-arm64.dmg** for Apple silicon (M1 and later) or **Shellby-x.y.z-x64.dmg** for an Intel Mac. Not sure? Apple menu › About This Mac: "Chip" means Apple silicon, "Processor" means Intel.
2. Open it and drag Shellby to Applications.
3. Open him from Applications. The Mac version isn't signed by Apple yet, so the first time macOS says it can't check him: click **Done**, then open **System Settings › Privacy & Security**, scroll down to the line about Shellby and click **Open Anyway**. You only do this once.
4. The first screen installs Claude Code for you (Anthropic's `install.sh`) if it isn't there, then signs you in. Or install it yourself first:
   ```bash
   curl -fsSL https://claude.ai/install.sh | bash
   claude auth login
   ```

What's different on a Mac: he lives on your desktop under your windows and follows you across Spaces, and **Cmd** does what Ctrl does. Push-to-talk uses Apple's own recognizer, on your Mac, so macOS asks once for the microphone and speech recognition. "Continue in terminal" opens Terminal. Your settings live in `~/Library/Application Support/Shellby`. Until the Mac build is signed, it can't update itself: download the new DMG from Releases. What isn't on a Mac yet (temperatures, startup apps, desk lighting) is listed in [Shellby on a Mac](MAC.md).

## "Windows protected your PC"?

That's Microsoft SmartScreen. It shows for any app that few people have downloaded yet, even a signed one, and it goes away as more people install him. Two clicks:

1. Click **More info**.
2. Check the publisher says **Jacob Barford**, then click **Run anyway**.

A different publisher, or "Unknown publisher", isn't Shellby: delete it. Installing with Scoop usually skips this, because the warning comes from the mark a browser puts on a download.

**To check you got the real file:** every release is built by [GitHub Actions](https://github.com/x-salmon/shellby/actions/workflows/release.yml) from the tagged commit, and each one lists SHA-256 checksums in `SHA256SUMS.txt`. Compare them with `Get-FileHash .\Shellby-Setup-x.y.z.exe`, or check its signed build provenance with `gh attestation verify .\Shellby-Setup-x.y.z.exe -R x-salmon/shellby`.

## Code signing policy

Releases are signed with [Azure Artifact Signing](https://learn.microsoft.com/azure/artifact-signing/), under the maintainer's verified name, **Jacob Barford**. Releases before the first signed one were unsigned.

Only Shellby's own files are signed, and only when GitHub Actions builds them from a tagged commit in this repository ([release workflow](../.github/workflows/release.yml)). The signing key stays in Microsoft's hardware and is never on a PC. Before publishing, the workflow checks that every exe is validly signed by the expected publisher. Before building, it checks that the publisher will match the last release's, so installed copies keep updating. How it works: [docs/SIGNING.md](SIGNING.md).

- **Committers and reviewers:** [x-salmon](https://github.com/x-salmon). Pull requests from anyone else are reviewed before they're merged.
- **Release and signing:** [x-salmon](https://github.com/x-salmon)

Everyone in these roles uses two-factor authentication on GitHub and Azure.

**Privacy:** see the [privacy policy](../PRIVACY.md) for everything Shellby sends over the network, and when. It has no telemetry.
