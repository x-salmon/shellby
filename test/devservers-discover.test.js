// Servers Shellby didn't start (src/main/devservers/discover.js, discover-io.js):
// the PowerShell listing parsed, listeners matched to a project through the
// process tree, Shellby's own servers and everything that isn't a dev server
// left out, the script read from the command line, and a Stop that only ever
// acts on a pid just listed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const discover = require('../src/main/devservers/discover');
const { Discovery, SCRIPT } = require('../src/main/devservers/discover-io');

const ROOT = 'C:\\code\\site';
const OTHER = 'C:\\code\\other';

// A terminal: cmd -> npm (node) -> vite (node), the way `npm run dev` looks on Windows.
const procs = [
  { ProcessId: 4, ParentProcessId: 0, Name: 'System', CommandLine: null },
  { ProcessId: 900, ParentProcessId: 4, Name: 'WindowsTerminal.exe', CommandLine: 'C:\\Program Files\\WindowsApps\\wt.exe' },
  { ProcessId: 1000, ParentProcessId: 900, Name: 'cmd.exe', CommandLine: '"C:\\WINDOWS\\system32\\cmd.exe"' },
  { ProcessId: 1001, ParentProcessId: 1000, Name: 'node.exe', CommandLine: 'node  "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" run dev' },
  { ProcessId: 1002, ParentProcessId: 1001, Name: 'node.exe', CommandLine: 'node  C:\\code\\site\\node_modules\\.bin\\..\\vite\\bin\\vite.js' },
  // A browser holding a port: never a dev server.
  { ProcessId: 2000, ParentProcessId: 900, Name: 'chrome.exe', CommandLine: '"C:\\Program Files\\Google\\Chrome\\chrome.exe" C:\\code\\site' },
  // Shellby's own server: cmd (the pid Shellby holds) -> npm -> next.
  { ProcessId: 3000, ParentProcessId: 1, Name: 'cmd.exe', CommandLine: '"C:\\WINDOWS\\system32\\cmd.exe" /d /s /c "npm run dev & echo(& call echo [shellby-exit %^errorlevel%]"' },
  { ProcessId: 3001, ParentProcessId: 3000, Name: 'node.exe', CommandLine: 'node npm-cli.js run dev' },
  { ProcessId: 3002, ParentProcessId: 3001, Name: 'node.exe', CommandLine: 'node C:\\code\\other\\node_modules\\next\\dist\\bin\\next dev' },
  // A python server with the folder on its own line, started with pnpm.
  { ProcessId: 4000, ParentProcessId: 900, Name: 'pnpm.cmd', CommandLine: 'pnpm dev' },
  { ProcessId: 4001, ParentProcessId: 4000, Name: 'python.exe', CommandLine: 'python c:/code/site/manage.py runserver' },
  // A node process in a folder the page doesn't list.
  { ProcessId: 5000, ParentProcessId: 900, Name: 'node.exe', CommandLine: 'node C:\\elsewhere\\server.js' },
];
const listen = [
  { LocalAddress: '::', LocalPort: 5173, OwningProcess: 1002 },
  { LocalAddress: '127.0.0.1', LocalPort: 5174, OwningProcess: 1002 }, // vite's HMR: the same process, the lower port shows
  { LocalAddress: '0.0.0.0', LocalPort: 9222, OwningProcess: 2000 },
  { LocalAddress: '::', LocalPort: 3000, OwningProcess: 3002 },
  { LocalAddress: '127.0.0.1', LocalPort: 8000, OwningProcess: 4001 },
  { LocalAddress: '0.0.0.0', LocalPort: 4000, OwningProcess: 5000 },
  { LocalAddress: '192.168.1.5', LocalPort: 5555, OwningProcess: 1002 }, // open to the network: not counted
  { LocalAddress: '0.0.0.0', LocalPort: 135, OwningProcess: 4 },        // a system port
];
const text = JSON.stringify({ listen, procs });
const roots = [{ root: ROOT, project: 'site' }, { root: OTHER, project: 'other' }];

test('the listing is parsed, and garbage is nothing', () => {
  const l = discover.parseListing(text);
  assert.equal(l.listeners.length, 8);
  assert.equal(l.procs.get(1002).parent, 1001);
  assert.equal(l.procs.get(1002).name, 'node.exe');
  assert.deepEqual(discover.parseListing('not json'), { listeners: [], procs: new Map() });
  assert.deepEqual(discover.parseListing(''), { listeners: [], procs: new Map() });
  // ConvertTo-Json gives one object, not a list, for a single record.
  const one = discover.parseListing(JSON.stringify({ listen: { LocalAddress: '::', LocalPort: 3000, OwningProcess: 7 }, procs: { ProcessId: 7, Name: 'node.exe' } }));
  assert.equal(one.listeners.length, 1);
  assert.equal(one.procs.size, 1);
});

test('listeners matched to projects through their parents; browsers, system ports, other folders and the network left out', () => {
  const out = discover.found(discover.parseListing(text), { roots, ownPids: new Set() });
  assert.deepEqual(out.map(f => [f.pid, f.port, f.program, f.root, f.project, f.script]), [
    [3002, 3000, 'node', OTHER, 'other', 'dev'],
    [1002, 5173, 'node', ROOT, 'site', 'dev'],
    [4001, 8000, 'python', ROOT, 'site', 'dev'],
  ]);
});

test("Shellby's own servers (by their cmd pid) and its own processes are never found", () => {
  const out = discover.found(discover.parseListing(text), { roots, ownPids: new Set([3000]) });
  assert.deepEqual(out.map(f => f.pid), [1002, 4001]);
  assert.deepEqual(discover.found(discover.parseListing(text), { roots, ownPids: new Set([1002, 4001, 3002]) }), []);
});

test('no roots, nothing found; the root entry travels with the find', () => {
  assert.deepEqual(discover.found(discover.parseListing(text), { roots: [] }), []);
  const out = discover.found(discover.parseListing(text), { roots: [{ root: ROOT, project: 'site', listed: 'c:\\CODE\\site' }] });
  assert.equal(out[0].listed, 'c:\\CODE\\site');
  assert.equal(out[0].key, undefined);
});

test('the script from the command line: only a name scripts.js would run', () => {
  const chain = lines => lines.map((commandLine, i) => ({ pid: i + 1, parent: i + 2, name: 'node.exe', commandLine }));
  assert.equal(discover.scriptOf(chain(['node vite.js', 'node npm-cli.js run dev'])), 'dev');
  assert.equal(discover.scriptOf(chain(['node npm-cli.js run-script start:web'])), 'start:web');
  assert.equal(discover.scriptOf(chain(['node npm-cli.js run --silent serve'])), 'serve');
  assert.equal(discover.scriptOf(chain(['C:\\Users\\me\\AppData\\Roaming\\npm\\pnpm.cmd dev'])), 'dev');
  assert.equal(discover.scriptOf(chain(['yarn start'])), 'start');
  assert.equal(discover.scriptOf(chain(['node server.js'])), null);
  // Never an install, and nothing a shell would read.
  assert.equal(discover.scriptOf(chain(['npm run install'])), null);
  assert.equal(discover.scriptOf(chain(['npm run "dev && calc"'])), null);
});

test('a folder is matched as a whole path part, and the listener\'s own line beats its parents\'', () => {
  const key = discover.folderKey(ROOT);
  assert.equal(discover.namesFolder(discover.folderKey('node C:\\code\\site\\node_modules\\vite\\bin\\vite.js'), key), true);
  assert.equal(discover.namesFolder(discover.folderKey('node "C:\\code\\site" --watch'), key), true);
  assert.equal(discover.namesFolder(discover.folderKey('cd C:\\code\\site'), key), true, 'at the end of the line');
  assert.equal(discover.namesFolder(discover.folderKey('node c:/code/site/server.js'), key), true, 'either slash');
  assert.equal(discover.namesFolder(discover.folderKey('node C:\\code\\site2\\server.js'), key), false, 'a longer name with the same start');
  assert.equal(discover.namesFolder(discover.folderKey('node C:\\code\\site-old\\server.js'), key), false);
  assert.equal(discover.namesFolder(discover.folderKey('node C:\\code\\sitecore'), key), false);
  // The listener names one clone, its parent another: the listener's own line decides.
  const sites = [{ root: ROOT, project: 'site', key }, { root: OTHER, project: 'other', key: discover.folderKey(OTHER) }];
  const chain = [
    { pid: 2, parent: 1, name: 'node.exe', commandLine: 'node C:\\code\\other\\node_modules\\vite\\bin\\vite.js' },
    { pid: 1, parent: 0, name: 'cmd.exe', commandLine: 'cmd /c cd C:\\code\\site && npm run dev' },
  ];
  assert.equal(discover.rootOf(chain, sites).root, OTHER);
  // Two clones named on one line, one inside the other: the deeper one.
  const nested = [{ root: 'C:\\code', project: 'code', key: discover.folderKey('C:\\code') }, ...sites];
  assert.equal(discover.rootOf([chain[0]], nested).root, OTHER);
  assert.equal(discover.rootOf([{ pid: 1, parent: 0, name: 'node.exe', commandLine: 'node C:\\code\\server.js' }], nested).root, 'C:\\code');
  assert.equal(discover.rootOf([{ pid: 1, parent: 0, name: 'node.exe', commandLine: 'node C:\\codex\\server.js' }], nested), null);
});

test('a process tree with a loop ends', () => {
  const l = discover.parseListing(JSON.stringify({
    listen: [{ LocalAddress: '::', LocalPort: 3000, OwningProcess: 1 }],
    procs: [{ ProcessId: 1, ParentProcessId: 2, Name: 'node.exe', CommandLine: 'node x' }, { ProcessId: 2, ParentProcessId: 1, Name: 'cmd.exe', CommandLine: `cmd ${ROOT}` }],
  }));
  assert.equal(discover.chainOf(l.procs, 1).length, 2);
  assert.equal(discover.found(l, { roots }).length, 1);
});

test('the reader is throttled, remembers what it listed, and a Stop needs the same process', () => {
  let now = 1_000_000;
  let reads = 0;
  const alive = new Map([[1002, { alive: true, createdAt: 500 }], [4001, { alive: true, createdAt: 600 }]]);
  const disc = new Discovery({
    roots: () => roots, ownPids: () => new Set([3000]),
    info: pid => alive.get(pid) || { alive: false, createdAt: null },
    read: async () => { reads++; return text; },
    now: () => now,
  });
  return (async () => {
    const first = await disc.look();
    assert.equal(reads, 1);
    assert.deepEqual(first.map(f => f.pid), [1002, 4001]);
    assert.equal(first[0].createdAt, undefined, 'the start time stays in main');
    await disc.look();
    assert.equal(reads, 1, 'within 10 s: the same answer');
    now += 11_000;
    await disc.look();
    assert.equal(reads, 2);
    await disc.look({ force: true });
    assert.equal(reads, 2, 'a refresh straight after a read is the same read');
    now += 2_500;
    await disc.look({ force: true });
    assert.equal(reads, 3, 'a refresh waits at least 2 s');
    // Two at once share one read.
    now += 11_000;
    await Promise.all([disc.look(), disc.look()]);
    assert.equal(reads, 4);

    assert.equal(disc.listed(1002).port, 5173);
    assert.match(disc.listed(9999).error, /isn't on the list/);
    // Gone, or a new process with the same pid.
    alive.set(1002, { alive: true, createdAt: 99_000 });
    assert.match(disc.listed(1002).error, /already stopped/);
    alive.set(4001, { alive: false, createdAt: null });
    assert.match(disc.listed(4001).error, /already stopped/);
    disc.forget(1002);
    assert.deepEqual(disc.view().map(f => f.pid), [4001]);
  })();
});

test('no start time, no entry; and listed() says no whenever Windows cannot vouch for the process', async () => {
  const info = new Map([[1002, { alive: true, createdAt: 500 }], [4001, { alive: true, createdAt: null }]]);
  const disc = new Discovery({ roots: () => roots, ownPids: () => new Set([3000]), info: pid => info.get(pid) ?? null, read: async () => text });
  assert.deepEqual((await disc.look()).map(f => f.pid), [1002], 'the one with no start time is dropped at listing time');
  assert.equal(disc.listed(1002).pid, 1002);
  // Windows can't be asked (no koffi): closed, not open.
  info.set(1002, null);
  assert.match(disc.listed(1002).error, /already stopped/);
  info.set(1002, undefined);
  assert.match(disc.listed(1002).error, /already stopped/);
  // Alive but with no start time now: the same.
  info.set(1002, { alive: true, createdAt: null });
  assert.match(disc.listed(1002).error, /already stopped/);
  info.set(1002, { alive: false, createdAt: 500 });
  assert.match(disc.listed(1002).error, /already stopped/);
  info.set(1002, { alive: true, createdAt: 2_000 });
  assert.equal(disc.listed(1002).pid, 1002, 'within the slack: the same process');
  // A reader with no info() at all lists nothing it could later be asked to stop.
  const blind = new Discovery({ roots: () => roots, ownPids: () => new Set(), read: async () => text });
  assert.deepEqual(await blind.look(), []);
});

test('a failed read is an empty list, never a throw', async () => {
  const disc = new Discovery({ roots: () => roots, ownPids: () => new Set(), read: async () => { throw new Error('no powershell'); } });
  assert.deepEqual(await disc.look(), []);
  const bad = new Discovery({ roots: () => roots, ownPids: () => new Set(), read: async () => '' });
  assert.deepEqual(await bad.look(), []);
});

test('the PowerShell text is fixed and asks for nothing but the four fields', () => {
  assert.match(SCRIPT, /Get-NetTCPConnection -State Listen/);
  assert.match(SCRIPT, /Win32_Process/);
  assert.doesNotMatch(SCRIPT, /\$\(|Invoke-Expression|Stop-Process|taskkill/i);
});
