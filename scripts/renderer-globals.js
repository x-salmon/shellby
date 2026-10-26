// Writes src/renderer/globals.d.ts: what the renderer's classic scripts share
// through `window` and the panel's `SB`, so `npm run typecheck` can check them
// (jsconfig.renderer.json). Every name is read from source, so a member that's
// used but never set (a typo, or one that was renamed) fails the typecheck.
//
//   npm run renderer:globals          rewrite it
//   npm run renderer:globals -- --check   fail if it's stale (test/renderer-globals.test.js)
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const OUT = path.join(RENDERER, 'globals.d.ts');

// What the preloads expose (src/preload/*.js), and the browser's own extras.
const PRELOADED = ['shellby', 'shellbyDialog', 'floor', 'note', 'toy'];
const BROWSER = ['webkitSpeechRecognition', 'SpeechRecognition'];

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return jsFiles(p);
    return e.name.endsWith('.js') ? [p] : [];
  }).sort();
}

/** Every `root.ShellbyX = ` / `window.PocketY = ` a renderer file sets. */
function windowGlobals(files) {
  const names = new Set();
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/\b(?:root|window)\.((?:Shellby|Pocket)[A-Za-z]+)\s*=[^=]/g)) names.add(m[1]);
  }
  return [...names].sort();
}

/** The panel's SB members, each with the first file (by name) that sets it. */
function sbMembers(files) {
  const byName = new Map();
  for (const f of files.filter(p => path.dirname(p) === path.join(RENDERER, 'panel'))) {
    if (path.basename(f) === 'core.js') continue; // core.js's literal is typed where it's written
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/\bSB\.([A-Za-z_$][\w$]*)\s*=(?![=>])/g)) {
      if (!byName.has(m[1])) byName.set(m[1], path.basename(f));
    }
  }
  return byName;
}

/** Members core.js sets after its literal (`SB.$ = …`). */
function coreAssigned() {
  const src = fs.readFileSync(path.join(RENDERER, 'panel', 'core.js'), 'utf8');
  return new Set([...src.matchAll(/^SB\.([A-Za-z_$][\w$]*)\s*=(?![=>])/gm)].map(m => m[1]));
}

function render() {
  const files = jsFiles(RENDERER);
  const globals = windowGlobals(files);
  const members = sbMembers(files);
  for (const name of coreAssigned()) if (!members.has(name)) members.set(name, 'core.js');
  const byFile = new Map();
  for (const [name, file] of [...members].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(name);
  }
  const lines = [
    '// Written by scripts/renderer-globals.js (npm run renderer:globals). Don\'t edit by hand.',
    '// What the renderer\'s classic scripts share: the preloads\' APIs and each',
    '// shared file\'s `window.ShellbyX`, and the members panel files hang on `SB`.',
    '',
    'declare var module: any;',
    '',
    'interface Window {',
    '  SB: ShellbyPanel;',
    ...PRELOADED.map(n => `  ${n}: any;`),
    ...BROWSER.map(n => `  ${n}: any;`),
    ...globals.map(n => `  ${n}: any;`),
    '}',
    '',
    '/** SB beyond core.js\'s own literal, by the panel file that sets each member. */',
    'interface ShellbyPanelExtras {',
  ];
  for (const file of [...byFile.keys()].sort()) {
    lines.push(`  // ${file}`);
    for (const name of byFile.get(file)) lines.push(`  ${name}: any;`);
  }
  lines.push('}', '');
  return lines.join('\n');
}

if (require.main === module) {
  const text = render();
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (now !== text) {
      console.error('src/renderer/globals.d.ts is stale: run npm run renderer:globals');
      process.exit(1);
    }
  } else {
    fs.writeFileSync(OUT, text);
    console.log(`wrote ${path.relative(ROOT, OUT)}`);
  }
}

module.exports = { render, OUT };
