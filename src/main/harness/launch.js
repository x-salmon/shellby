// Finding an agent CLI on this PC and how to start it without a shell.
//
// npm installs a CLI on Windows as a .cmd shim in its global folder
// (%APPDATA%\npm\gemini.cmd). Node won't spawn a .cmd without a shell, and a
// shell would read the prompt and paths on the command line as its own syntax.
// So the shim is read, never run: it names the real program, either a native
// .exe ("%dp0%\node_modules\...\codex.exe" %*) or a script that npm runs with
// Node ("%_prog%" "%dp0%\node_modules\...\cli.js" %*). That one is started
// directly: the .exe as it is, the script with node.exe.
//
// A plain .exe on PATH (aider's, a standalone opencode) is used as it is.
//
// Pure apart from the injected fs: test/harness-launch.test.js.
const path = require('path');

const SCRIPT_EXT = /\.(c|m)?js$/i;
const EXE_EXT = /\.exe$/i;
// "%dp0%\node_modules\..." or "%~dp0\..." quoted, as npm's cmd-shim writes them.
const SHIM_TARGET = /"%(?:~)?dp0%?\\([^"%]+)"/g;

/**
 * What a .cmd shim runs. text: its contents; dir: the folder it sits in.
 * -> { kind: 'exe' | 'script', file } or null when it isn't an npm shim.
 */
function resolveShim(text, dir) {
  const targets = [...String(text || '').matchAll(SHIM_TARGET)].map(m => m[1]).filter(t => !/^node(\.exe)?$/i.test(path.basename(t)));
  const last = targets.at(-1);
  if (!last) return null;
  const file = path.join(dir, last);
  // Inside the shim's own folder only: a shim can't send us anywhere else.
  if (!file.toLowerCase().startsWith(path.join(dir, path.sep).toLowerCase())) return null;
  if (EXE_EXT.test(file)) return { kind: 'exe', file };
  if (SCRIPT_EXT.test(file) || !path.extname(file)) return { kind: 'script', file };
  return null;
}

/** The folders on PATH, then npm's global one (where `npm i -g` puts shims even when PATH lacks it). */
function searchDirs(env) {
  const list = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  if (env.APPDATA) list.push(path.join(env.APPDATA, 'npm'));
  return [...new Set(list)];
}

/**
 * Where a command is and how to start it: { file, prefix } where the process is
 * spawn(file, [...prefix, ...args]). node: the node.exe to run scripts with.
 * -> null when it isn't installed (or only as something Shellby won't run).
 * @param {string} name   'gemini', 'opencode', 'codex-acp', 'aider'
 * @param {{ env: Record<string, string | undefined>, exists: (p: string) => boolean, read: (p: string) => string, node?: string | null }} o
 */
function findCommand(name, { env, exists, read, node = null }) {
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(name)) return null;
  for (const dir of searchDirs(env)) {
    const exe = path.join(dir, `${name}.exe`);
    if (exists(exe)) return { file: exe, prefix: [] };
    const cmd = path.join(dir, `${name}.cmd`);
    if (!exists(cmd)) continue;
    /** @type {{ kind: string, file: string } | null} */
    let shim = null;
    try { shim = resolveShim(read(cmd), dir); } catch { /* unreadable: keep looking */ }
    if (!shim || !exists(shim.file)) continue;
    if (shim.kind === 'exe') return { file: shim.file, prefix: [] };
    // A script needs Node: the one beside the shim if npm put one there, else PATH's.
    const local = path.join(dir, 'node.exe');
    const nodeExe = exists(local) ? local : node || findNode({ env, exists });
    if (nodeExe) return { file: nodeExe, prefix: [shim.file] };
  }
  return null;
}

/** node.exe on PATH, or null. */
function findNode({ env, exists }) {
  for (const dir of String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) {
    const f = path.join(dir, 'node.exe');
    if (exists(f)) return f;
  }
  return null;
}

module.exports = { resolveShim, findCommand, findNode, searchDirs };
