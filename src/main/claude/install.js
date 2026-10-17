// Installing Claude Code from the first-run screen, so someone new never has to
// open a terminal: Anthropic's own Windows installer (the one the setup guide
// gives), run in a hidden PowerShell by its full path, as the remote path runs
// install.sh over ssh (remote/ssh.js installScript). Pure: ipc/panel.js runs it.
// See test/claude-install.test.js.
const { POWERSHELL } = require('../system32');

const INSTALLER_URL = 'https://claude.ai/install.ps1';
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const TAIL_LINES = 3;

/** The program and arguments that install Claude Code. */
function installCommand() {
  return {
    exe: POWERSHELL,
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `irm ${INSTALLER_URL} | iex`],
  };
}

/** What to tell the panel when the installer didn't finish. */
function installFailure({ code, timedOut, stderr }) {
  if (timedOut) return 'The installer took more than 10 minutes, so Shellby stopped it. Check your connection and try again.';
  const said = String(stderr || '');
  if (/could not be resolved|unable to connect|no such host|remote name/i.test(said)) return "The installer couldn't reach claude.ai. Check your connection and try again.";
  const tail = said.trim().split(/\r?\n/).filter(Boolean).slice(-TAIL_LINES).join(' ');
  return tail ? `The installer stopped (exit ${code}): ${tail}` : `The installer stopped (exit ${code}).`;
}

module.exports = { INSTALLER_URL, INSTALL_TIMEOUT_MS, installCommand, installFailure };
