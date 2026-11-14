/* One model for every mockup: each repo is one project, and its dependency
   audit, CI, dev server and git state hang off it (today the page keeps the
   audit as a second, longer list). Placeholder content, shaped like the real
   page's data. */
'use strict';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** @typedef {'pass'|'fail'|'run'|'none'} Ci */
const PROJECTS = [
  {
    id: 'shellby', name: 'shellby', hue: '#ffc15e', where: '~\\Documents\\GitHub\\shellby', gh: 'x-salmon/shellby', kind: 'Electron',
    branch: 'main', dirty: 0, ahead: 56, stale: [], ci: 'pass', ciNote: 'CI passed on main 41m ago',
    deps: { state: 'fresh', outdated: 1, vulns: 0, checked: '9d ago' }, flaky: 1,
    server: { script: 'dev:crab', state: 'stopped' }, week: [4.5, 6, 5, 7.5, 3, 0, 0], last: '2m ago', lastSort: 0,
    pinned: true, todo: 6, convs: 3, next: 'Pick a Projects page redesign',
    leftOff: 'Settings redesign mockups: ten ways to sort them, committed as af4b864c',
    release: 'v0.97.0 went out 2 days ago, 23 commits since',
    tide: [3, 4, 2, 5, 6, 4, 3, 5, 6, 7, 5, 4, 6, 7, 5, 6, 4, 5, 6, 7, 8, 6, 7, 5, 6, 4, 2, 1],
  },
  {
    id: 'signwright', name: 'signwright', hue: '#ff7a5c', where: '~\\Documents\\GitHub\\signwright', gh: 'x-salmon/signwright', kind: 'Vite',
    branch: 'add-proofs', dirty: 0, ahead: 0, stale: [], ci: 'fail', ciNote: 'Build failed on PR #14 "Add proof sheets": lint, 3 errors',
    deps: { state: 'vulnerable', outdated: 3, vulns: 2, high: 1, checked: '28d ago' }, flaky: 0,
    server: { script: 'dev', state: 'stopped' }, week: [0, 2.5, 1, 0, 0, 0, 0], last: '4d ago', lastSort: 4,
    todo: 2, convs: 1, next: 'Fix the lint errors on PR #14',
    tide: [0, 0, 1, 0, 0, 2, 3, 1, 0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 1, 0, 0, 2, 1, 0, 0, 0, 0],
  },
  {
    id: 'spoolandsteel', name: 'spoolandsteel', hue: '#7fd6c2', where: '~\\Documents\\GitHub\\spoolandsteel', gh: 'x-salmon/spoolandsteel', kind: 'Next.js',
    branch: 'main', dirty: 2, ahead: 0, stale: [], ci: 'pass', ciNote: 'CI passed 3d ago',
    deps: { state: 'vulnerable', outdated: 6, vulns: 4, high: 2, checked: '9d ago', top: 'next 14.2.3 (high: cache poisoning)' }, flaky: 0,
    server: { script: 'dev', state: 'up', port: 3000 }, week: [0, 1.5, 2, 0, 0, 0, 0], last: '3d ago', lastSort: 3,
    todo: 4, convs: 2, next: 'Shipping rates for Canada at checkout',
    tide: [2, 1, 0, 0, 3, 2, 1, 0, 0, 0, 2, 3, 4, 1, 0, 0, 1, 2, 0, 0, 0, 1, 2, 2, 0, 0, 0, 0],
  },
  {
    id: 'atlassian-cloud-rebuilds', name: 'atlassian-cloud-rebuilds', hue: '#8fb4ff', where: '~\\Documents\\GitHub\\atlassian-cloud-rebuilds', gh: 'harbor-tree/atlassian-cloud-rebuilds', kind: 'Forge',
    branch: 'main', dirty: 0, ahead: 0, stale: [], ci: 'pass', ciNote: 'CI passed 1d ago',
    review: { pr: '#31', title: 'Bulk relabel from a CSV', who: 'dana-k', when: '3h ago' },
    deps: { state: 'fresh', outdated: 0, vulns: 0, checked: '1d ago' }, flaky: 0,
    server: { script: 'tunnel', state: 'stopped' }, week: [3, 2, 4, 1.5, 0, 0, 0], last: '1d ago', lastSort: 1,
    todo: 3, convs: 2, next: 'Owner step: approve the Marketplace listing',
    tide: [1, 2, 3, 2, 0, 0, 0, 2, 3, 4, 2, 1, 0, 0, 3, 4, 2, 3, 0, 0, 0, 2, 3, 4, 2, 0, 0, 0],
  },
  {
    id: '3d-rack', name: '3d-rack', hue: '#c98bff', where: '~\\Documents\\GitHub\\3d-rack', gh: 'x-salmon/3d-rack', kind: 'Node',
    branch: 'main', dirty: 3, ahead: 0, stale: [{ name: 'rail-clips', why: 'merged', last: '4/23/2026' }], ci: 'none', ciNote: 'No CI',
    deps: { state: 'unchecked' }, flaky: 0,
    server: null, week: [0, 0, 1, 0, 1.5, 0, 0], last: 'yesterday', lastSort: 1,
    todo: 1, convs: 1, next: 'Print orientation for the 2U blank',
    tide: [0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 1, 0],
  },
  {
    id: 'home-4bc8fd', name: 'home-4bc8fd', hue: '#9ad06b', where: '~\\Documents\\GitHub\\home-4bc8fd', gh: null, kind: 'npm',
    branch: 'main', dirty: 0, ahead: 0, stale: [], ci: 'none', ciNote: 'No CI',
    deps: { state: 'vulnerable', outdated: 9, vulns: 7, high: 3, checked: '11d ago' }, flaky: 0,
    server: { script: 'start', state: 'stopped' }, week: [0, 0, 0, 0, 0, 0, 0], last: '11/2', lastSort: 11,
    todo: 0, convs: 0, next: 'Bump 7 vulnerable packages',
    tide: [1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'helm', name: 'helm', hue: '#5ec8e0', where: '~\\Documents\\GitHub\\helm', gh: 'x-salmon/helm', kind: 'npm',
    branch: 'main', dirty: 0, ahead: 0, stale: [], ci: 'pass', ciNote: 'CI passed 11d ago',
    deps: { state: 'unreadable', why: 'npm audit needs a package-lock.json, and helm has none', checked: '11d ago' }, flaky: 0,
    server: { script: 'dev', state: 'stopped' }, week: [0, 0, 0, 0, 0, 0, 0], last: '11/2', lastSort: 11,
    todo: 0, convs: 0, next: 'Make a lockfile so audits can run',
    tide: [0, 0, 0, 0, 2, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'harbor', name: 'harbor', hue: '#e0a35e', where: '~\\Documents\\GitHub\\harbor', gh: 'harbor-tree/harbor', kind: 'npm',
    branch: 'main', dirty: 0, ahead: 0, stale: [], ci: 'pass', ciNote: 'CI passed 12d ago',
    deps: { state: 'unreadable', why: 'npm audit timed out after 60s (registry slow)', checked: '11d ago' }, flaky: 0,
    server: { script: 'dev', state: 'stopped' }, week: [0, 0, 0, 0, 0, 0, 0], last: '11/1', lastSort: 12,
    todo: 1, convs: 0, next: 'Check dependencies again',
    tide: [0, 0, 0, 0, 0, 3, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'ivsr-tmcs-parser', name: 'ivsr-tmcs-parser', hue: '#ff8fb4', where: '~\\Documents\\GitHub\\ivsr-tmcs-parser', gh: 'x-salmon/ivsr-tmcs-parser', kind: 'Ruby',
    branch: 'main', dirty: 0, ahead: 0, stale: [], ci: 'pass', ciNote: 'CI passed 23d ago',
    deps: { state: 'fresh', outdated: 0, vulns: 0, checked: '23d ago' }, flaky: 0,
    server: null, week: [0, 0, 0, 0, 0, 0, 0], last: '10/21', lastSort: 23,
    todo: 0, convs: 0, next: '',
    tide: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'line-logic', name: 'line-logic', hue: '#6bd09a', where: '~\\Documents\\GitHub\\line-logic', gh: 'x-salmon/line-logic', kind: 'Python',
    branch: 'main', dirty: 0, ahead: 0, stale: [], ci: 'pass', ciNote: 'CI passed 10/1',
    deps: { state: 'fresh', outdated: 0, vulns: 0, checked: '43d ago' }, flaky: 0,
    server: null, week: [0, 0, 0, 0, 0, 0, 0], last: '10/1', lastSort: 43, quiet: '6 weeks',
    todo: 0, convs: 0, next: '',
    tide: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'documents', name: 'Documents', hue: '#7d7566', where: '~\\Documents', gh: null, kind: 'npm',
    notProject: 'Has a package.json, but no git: probably a stray npm install, not a project',
    branch: null, dirty: 0, ahead: 0, stale: [], ci: 'none', ciNote: '',
    deps: { state: 'outdated', outdated: 8, vulns: 0, checked: '1d ago' }, flaky: 0,
    server: null, week: [0, 0, 0, 0, 0, 0, 0], last: '1d ago', lastSort: 1,
    todo: 0, convs: 0, next: '',
    tide: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
];

const COPIES = [
  { project: 'shellby', name: 'fix-share-card-stat-numbers', why: 'empty, untouched 3 days' },
];

/** Severity drives every view's ordering: 3 broken, 2 waiting on you, 1 tidy-up, 0 calm. */
function severity(p) {
  if (p.ci === 'fail' || p.deps.high) return 3;
  if (p.review || p.ahead || p.dirty || p.server?.state === 'crashed') return 2;
  if (p.stale.length || p.deps.state === 'unreadable' || p.deps.vulns || p.notProject || p.flaky) return 1;
  return 0;
}

const hours = (p) => p.week.reduce((a, b) => a + b, 0);
