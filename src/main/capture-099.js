// `npm run screenshots`, 0.98–0.99: Your PCs with made-up PCs, and a conversation
// run by Gemini CLI. Called from capture.js; every name and number here is fake.
const path = require('path');
const { roster, summaryOf } = require('./hub/roster');
const { hostFacts } = require('./hub/host');

const GB = 1024 ** 3;
const HOME = 'C:\\Users\\you';

/** One PC's phone view, as hub/roster.js reads it. */
/** @param {{ pc: string, tabs: object[], prompts?: object[], machine: object, host: object, projects: object[] }} v */
function pcView({ pc, tabs, prompts = [], machine, host, projects }) {
  return { pc, tabs, prompts, machine, host: hostFacts({ platform: 'win32', version: '0.99.1', ...host }), projects, limits: { perHour: 30, atOnce: 10, open: tabs.length } };
}

const DESK = pcView({
  pc: 'desk',
  tabs: [
    { id: 'd1', title: 'Fix the login redirect loop', folder: 'tidepool', standing: 'working', busy: true, pending: 0 },
    { id: 'd2', title: 'Write the README for 0.99', folder: 'shellby', standing: 'working', busy: true, pending: 0, harness: 'gemini' },
  ],
  machine: { cpu: { load: 34, temp: 58 }, gpu: { load: 12, temp: 44 }, ram: 52, battery: null, hot: null },
  host: { release: '10.0.22631', totalmem: 64 * GB, freemem: 31 * GB, diskFree: 812 * GB, agents: ['claude', 'gemini', 'codex'] },
  projects: [{ key: `${HOME}\\code\\tidepool`, name: 'tidepool' }, { key: `${HOME}\\code\\shellby`, name: 'shellby' }],
});

const LAPTOP = pcView({
  pc: 'laptop',
  tabs: [
    { id: 'l1', title: 'Migrate the orders table', folder: 'reef-api', standing: 'asking', busy: true, pending: 1 },
    { id: 'l2', title: 'Bump the test deps', folder: 'reef-api', standing: 'quiet', busy: false },
  ],
  prompts: [{
    tabId: 'l1', requestId: 'demo-hub-1', title: 'Migrate the orders table', toolName: 'Bash', label: 'Run',
    detail: 'npm run db:migrate -- --to 0042_split_orders', ask: 'Run the migration on the dev database?', always: 'npm run db:migrate',
  }],
  machine: { cpu: { load: 61, temp: 74 }, gpu: null, ram: 71, battery: { level: 64, charging: false }, hot: null },
  host: { release: '10.0.22631', totalmem: 16 * GB, freemem: 4.6 * GB, diskFree: 140 * GB, agents: ['claude', 'opencode'] },
  projects: [{ key: `${HOME}\\code\\reef-api`, name: 'reef-api' }],
});

const BOX = pcView({
  pc: 'build-box',
  tabs: [{ id: 'b1', title: 'Nightly: run the full e2e suite', folder: 'tidepool', standing: 'working', busy: true, pending: 0 }],
  machine: { cpu: { load: 88, temp: 69 }, gpu: { load: 3, temp: 38 }, ram: 44, battery: null, hot: null },
  host: { release: '10.0.19045', totalmem: 32 * GB, freemem: 18 * GB, diskFree: 1430 * GB, agents: ['claude'] },
  projects: [{ key: 'D:\\ci\\tidepool', name: 'tidepool' }],
});

function demoHub(now) {
  const rows = roster([
    { id: 'this', name: 'Desk PC', kind: 'this', state: 'online', view: DESK },
    { id: 'p-laptop', name: 'Laptop', kind: 'pc', state: 'online', seenAt: now - 2000, view: LAPTOP },
    { id: 'p-box', name: 'Build box', kind: 'pc', state: 'online', seenAt: now - 4000, view: BOX },
    { id: 'p-den', name: 'Den PC', kind: 'pc', state: 'offline', error: 'Not reachable: it may be asleep or offline.', seenAt: now - 5 * 3600e3, view: null },
  ], now);
  return { rows, summary: summaryOf(rows), usage: null };
}

/** A conversation Gemini CLI runs, in a Shellby tab like any other. */
const GEMINI_TAB = {
  id: 'demo-gemini', title: 'Write the README for 0.99', cwd: `${HOME}\\code\\shellby`, harness: 'gemini', busy: true, status: 'Editing README.md…',
  items: [
    { kind: 'harness', name: 'Gemini CLI' },
    { kind: 'user', text: 'Read the CHANGELOG since 0.95 and add the new features to the README, each with a short line and a link.' },
    { kind: 'tool', id: 'g1', name: 'Read', label: 'Read', detail: 'CHANGELOG.md' },
    { kind: 'tool_result', id: 'g1', text: '412 lines' },
    { kind: 'text', text: 'Five releases since 0.95. The big ones: **Your PCs**, **conversations on other agents**, and **a local model**. Adding a section for each.' },
    { kind: 'tool', id: 'g2', name: 'Edit', label: 'Edited', detail: 'README.md', filePath: `${HOME}\\code\\shellby\\README.md` },
    { kind: 'tool_result', id: 'g2', text: '+38 −4' },
  ],
};

const wait = ms => new Promise(r => setTimeout(r, ms));

/**
 * @param {{ panel: any, send: Function, out: string, base: object, shot: Function, tabs: Array<{ id: string }> }} d
 */
async function capture099({ panel, send, out, base, shot, tabs }) {
  const { ipcMain } = require('electron');
  const hub = demoHub(Date.now());
  ipcMain.removeHandler('hub:view');
  ipcMain.handle('hub:view', () => hub);
  ipcMain.removeHandler('harness:list');
  ipcMain.handle('harness:list', () => [{ id: 'gemini', name: 'Gemini CLI' }, { id: 'opencode', name: 'OpenCode' }, { id: 'codex', name: 'Codex' }]);

  send(panel, 'demo', { ...base, tabs: [GEMINI_TAB, ...tabs], active: 'demo-gemini' });
  await wait(1400);
  await panel.webContents.executeJavaScript('document.activeElement?.blur(); 1');
  await shot(panel, path.join(out, 'screenshot-agents.png'));

  send(panel, 'demo', { ...base, tabs, active: tabs[0].id, view: 'pcs' });
  await wait(1400);
  await shot(panel, path.join(out, 'screenshot-pcs.png'));
}

module.exports = { capture099, demoHub, GEMINI_TAB };
