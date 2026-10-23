// The reading behind discover.js: one PowerShell call, by full path with
// fixed text, for every listening port and every process's name, parent and
// command line. Never throws; a failed read is an empty list.
//
// Polled by the panel while a project's page is open (servers:found), never
// on Shellby's own clock: looking costs a second of PowerShell, and nobody is
// looking at the answer when the page is closed. Reads are throttled here so
// a busy page can't ask more often than LOOK_EVERY_MS.
const { execFile } = require('child_process');
const { POWERSHELL } = require('../system32');
const discover = require('./discover');

const LOOK_EVERY_MS = 10 * 1000;
const READ_TIMEOUT_MS = 15 * 1000;
const START_SLACK_MS = 3000;

// Fixed text, nothing of the caller's in it. Select-Object trims each record
// to the four fields used; ConvertTo-Json -Depth 3 makes one object of the two lists.
const SCRIPT = [
  '$l = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess)',
  '$p = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Select-Object ProcessId,ParentProcessId,Name,CommandLine)',
  '@{ listen = $l; procs = $p } | ConvertTo-Json -Compress -Depth 3',
].join('; ');

/** The raw listing text, or '' when PowerShell couldn't be asked. */
function readListing({ run = execFile } = {}) {
  return new Promise(resolve => {
    run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], { windowsHide: true, timeout: READ_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => resolve(err && !stdout ? '' : String(stdout || '')));
  });
}

/**
 * What's running in your projects that Shellby didn't start, remembered
 * between looks so a Stop only ever acts on something just listed.
 * deps: {
 *   roots() -> [{ root, project }]      every clone on the Projects page (realpath'd)
 *   ownPids() -> Set                    Shellby's processes and its own servers' cmd pids
 *   info(pid) -> { alive, createdAt }   native-windows.processInfo
 *   read?() -> Promise<string>          the listing text (tests)
 *   now?()
 * }
 */
class Discovery {
  constructor(deps) {
    this.deps = deps;
    this.now = deps.now || Date.now;
    this.read = deps.read || readListing;
    this.at = 0;
    this.found = []; // [{ pid, port, program, root, project, script, createdAt }]
    this.looking = null;
  }

  /** The list, read again if the last look is older than LOOK_EVERY_MS. -> the public list */
  async look({ force = false } = {}) {
    if (this.looking) return this.looking;
    if (!force && this.at && this.now() - this.at < LOOK_EVERY_MS) return this.view();
    this.looking = (async () => {
      const text = await this.read();
      const list = discover.found(discover.parseListing(text), { roots: this.deps.roots(), ownPids: this.deps.ownPids() });
      this.found = list.map(f => ({ ...f, createdAt: this.deps.info?.(f.pid)?.createdAt || null }));
      this.at = this.now();
      return this.view();
    })().catch(() => this.view()).finally(() => { this.looking = null; });
    return this.looking;
  }

  view() {
    return this.found.map(({ createdAt: _c, ...rest }) => rest);
  }

  /**
   * One from the last listing, if it's still the same process (same pid, a
   * start time within a few seconds of the one recorded). -> the entry, or
   * { error } when it has gone or was never listed.
   */
  listed(pid) {
    const f = this.found.find(x => x.pid === pid);
    if (!f) return { error: "Look again: that server isn't on the list any more." };
    const now = this.deps.info?.(pid);
    if (now && (!now.alive || (f.createdAt && now.createdAt && Math.abs(now.createdAt - f.createdAt) > START_SLACK_MS))) {
      return { error: 'That server has already stopped.' };
    }
    return f;
  }

  forget(pid) {
    this.found = this.found.filter(x => x.pid !== pid);
  }
}

module.exports = { Discovery, readListing, SCRIPT, LOOK_EVERY_MS };
