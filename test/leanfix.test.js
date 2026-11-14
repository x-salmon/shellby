// One-tap fixes for repeated big reads and loud commands (src/main/leanfix.js):
// which files are generated, the CLAUDE.md line drafted from a file's first
// lines, where it goes in the file, the deny rule and the settings it makes,
// the quieter way to run a loud command, and the fixes drafted from a report.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const lf = require('../src/main/leanfix');

// ---- generated files

test('lockfiles, build output and minified or generated files are read whole for nothing', () => {
  for (const rel of ['package-lock.json', 'sub/yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock', 'poetry.lock', 'uv.lock', 'go.sum', 'Gemfile.lock', 'composer.lock',
    'dist/app.js', 'build/index.html', 'coverage/lcov.info', '.next/server/x.js', 'target/debug/foo', 'node_modules/x/index.js',
    'vendor.min.js', 'styles.min.css', 'app.js.map', 'api.generated.ts', 'src/__generated__/schema.ts', 'proto/x.pb.go', 'test/__snapshots__/a.snap']) {
    assert.ok(lf.isGenerated(rel), rel);
  }
  for (const rel of ['src/lock.js', 'docs/build.md', 'package.json', 'src/main/dist.js', 'targets.md', 'README.md', 'test/lockfile.test.js']) {
    assert.ok(!lf.isGenerated(rel), rel);
  }
});

// ---- a line about a file

test('a summary from a file\'s first lines: the leading comment, in one sentence', () => {
  const js = "// Lean Shell, the main-process side (efficiency.js has the rules). Keeps the\n// prompt-cache ledger, each project's setup weight and what Claude Code has\n// used lately, and answers the Toolbox's Lean tab.\n//\n// The only change it ever makes is turning a plugin off.\nconst fs = require('fs');\n";
  assert.equal(lf.summaryOf(js, 'src/main/lean.js'), 'Lean Shell, the main-process side (efficiency.js has the rules).');
  const block = "#!/usr/bin/env node\n'use strict';\n/**\n * Builds panel.html from the pieces in html/.\n * @param {string} x\n */\nfunction build() {}\n";
  assert.equal(lf.summaryOf(block, 'scripts/panel-html.js'), 'Builds panel.html from the pieces in html/.');
  const py = '# Reads the sensors and writes a CSV\n# every minute.\nimport os\n';
  assert.equal(lf.summaryOf(py, 'tools/log.py'), 'Reads the sensors and writes a CSV every minute.');
  const html = '<!-- The confirm window: one question, its own preload. -->\n<!doctype html>\n';
  assert.equal(lf.summaryOf(html, 'dialog.html'), 'The confirm window: one question, its own preload.');
  // A licence header is not a description.
  const licensed = '// Copyright 2026 Someone. Licensed under GPL-3.0.\n// SPDX-License-Identifier: GPL-3.0\n// Draws the crab as SVG, one part per group.\nexport function draw() {}\n';
  assert.equal(lf.summaryOf(licensed, 'sprite.js'), 'Draws the crab as SVG, one part per group.');
});

test('a summary from a markdown heading, a package manifest, or the names a file defines', () => {
  assert.equal(lf.summaryOf('# Developing Shellby\n\nHow to build Shellby, how he drives Claude Code, and a map of the code. More words here.\n', 'docs/DEVELOPMENT.md'),
    'Developing Shellby: How to build Shellby, how he drives Claude Code, and a map of the code.');
  assert.equal(lf.summaryOf('{\n  "name": "shellby",\n  "version": "0.98.1",\n  "description": "A pixel hermit crab for Claude Code",\n  "scripts": {\n', 'package.json'),
    'Package manifest for shellby: A pixel hermit crab for Claude Code.');
  assert.equal(lf.summaryOf('{\n  "compilerOptions": {\n    "target": "es2023"\n  },\n  "include": [],\n  "exclude": []\n}\n', 'jsconfig.json'), 'JSON with compilerOptions, include and exclude.');
  const code = "const fs = require('fs');\nfunction scanHotFiles() {}\nasync function readTranscript() {}\nclass Tally {}\nmodule.exports = { scanHotFiles };\n";
  assert.equal(lf.summaryOf(code, 'src/x.js'), 'Defines scanHotFiles, readTranscript and Tally.');
  assert.equal(lf.summaryOf('export const A = 1;\nexport default function main() {}\n', 'a.ts'), 'Defines A and main.');
  assert.equal(lf.summaryOf('def load():\n    pass\n\nclass Reader:\n    pass\n', 'r.py'), 'Defines load and Reader.');
  assert.equal(lf.summaryOf('', 'empty.js'), null);
  assert.equal(lf.summaryOf('x = 1\ny = 2\n', 'data.txt'), null, 'nothing worth saying is no line');
});

test('a summary is one clean line, cut at a word, with no backticks or control characters', () => {
  const long = `// ${'word '.repeat(60)}\n`;
  const s = lf.summaryOf(long, 'a.js');
  assert.ok(s.length <= 141 && s.endsWith('…'), s);
  assert.ok(!/\s…$/.test(s), 'cut at a word, no space before the ellipsis');
  assert.equal(lf.summaryOf('// Uses `fs` and\tnot\u0007 `path`.\nlet a;\n', 'b.js'), 'Uses fs and not path.');
  // Characters that look like nothing, or reorder what's shown, go too: the preview has to be all there is.
  assert.equal(lf.summaryOf('// Runs​ the‮ tests﻿ first.\nlet a;\n', 'c.js'), 'Runs the tests first.');
});

test('the CLAUDE.md line names the path in code and ends in a full stop', () => {
  assert.equal(lf.claudeLine('src/main/lean.js', 'Lean Shell, the main-process side.'), '- `src/main/lean.js`: Lean Shell, the main-process side.');
  assert.equal(lf.claudeLine('src/x.js', 'Defines a and b'), '- `src/x.js`: Defines a and b.');
  assert.equal(lf.claudeLine('bad\npath', 'x'), null);
  assert.equal(lf.claudeLine('src/a​.js', 'x'), null, 'a zero-width character in the path');
  assert.equal(lf.claudeLine('src/a.js`', 'x'), null);
});

test('the line goes under "Where things live": a new section at the end, or after the last bullet of one that is there', () => {
  const fresh = lf.appendUnder('# Shop\n\nBuild with npm.\n', '- `src/a.js`: A.');
  assert.equal(fresh.text, '# Shop\n\nBuild with npm.\n\n## Where things live\n\n- `src/a.js`: A.\n');
  assert.equal(fresh.added, '\n## Where things live\n\n- `src/a.js`: A.\n');
  assert.equal(lf.appendUnder('', '- x').text, '## Where things live\n\n- x\n');
  const more = lf.appendUnder(fresh.text + '\n## Testing\n\nRun npm test.\n', '- `src/b.js`: B.');
  assert.equal(more.text, '# Shop\n\nBuild with npm.\n\n## Where things live\n\n- `src/a.js`: A.\n- `src/b.js`: B.\n\n## Testing\n\nRun npm test.\n');
  assert.equal(more.added, '- `src/b.js`: B.\n');
  assert.equal(lf.appendUnder('## where things LIVE\n', '- x').text, '## where things LIVE\n\n- x\n', 'the heading is matched whatever its case');
});

test('a file CLAUDE.md already talks about needs no line', () => {
  assert.ok(lf.mentions('See `src/main/lean.js` for the rules.', 'src/main/lean.js'));
  assert.ok(lf.mentions('See src\\main\\lean.js for the rules.', 'src/main/lean.js'), 'backslashes count');
  assert.ok(!lf.mentions('See lean.js for the rules.', 'src/main/lean.js'), 'the bare name is not the path');
  assert.ok(!lf.mentions('', 'src/main/lean.js'));
});

// ---- a deny rule

test('a deny rule for a project file, and none for a path that could reach outside or has glob characters', () => {
  assert.equal(lf.denyRule('package-lock.json'), 'Read(./package-lock.json)');
  assert.equal(lf.denyRule('dist/app.js'), 'Read(./dist/app.js)');
  assert.equal(lf.denyRule('../other/x.lock'), null);
  assert.equal(lf.denyRule('/abs/x.lock'), null);
  assert.equal(lf.denyRule('C:/x/y.lock'), null);
  assert.equal(lf.denyRule('a/../b.lock'), null);
  assert.equal(lf.denyRule('weird*.lock'), null);
  assert.equal(lf.denyRule('a\nb.lock'), null);
  assert.equal(lf.denyRule(''), null);
  // The rule's own brackets, a comment mark, an edge space or a hidden character would read as something else.
  assert.equal(lf.denyRule('a(b).lock'), null);
  assert.equal(lf.denyRule('#x.lock'), null);
  assert.equal(lf.denyRule('dist/ x.js'), null);
  assert.equal(lf.denyRule('dist/x.js '), null);
  assert.equal(lf.denyRule('dist/x​.js'), null);
  assert.equal(lf.denyRule('dist/x‮.js'), null);
});

test('the rule joins the deny list of the settings, keeping everything else, and is not added twice', () => {
  const p = lf.denyPlan('{\n  "permissions": {\n    "allow": ["Bash(npm test:*)"]\n  },\n  "hooks": {}\n}\n', 'Read(./package-lock.json)');
  assert.equal(p.ok, true);
  assert.deepEqual(JSON.parse(p.text), { permissions: { allow: ['Bash(npm test:*)'], deny: ['Read(./package-lock.json)'] }, hooks: {} });
  assert.ok(p.text.endsWith('\n'));
  assert.deepEqual(JSON.parse(lf.denyPlan('', 'Read(./x)').text), { permissions: { deny: ['Read(./x)'] } }, 'a settings file that is not there yet');
  assert.deepEqual(JSON.parse(lf.denyPlan('\uFEFF{}', 'Read(./x)').text), { permissions: { deny: ['Read(./x)'] } }, 'a BOM is no obstacle');
  assert.equal(lf.denyPlan('{"permissions":{"deny":["Read(./x)"]}}', 'Read(./x)').ok, false);
  assert.equal(lf.denyPlan('{"permissions":{"deny":["Read(./x)"]}}', 'Read(./x)').already, true);
  assert.equal(lf.denyPlan('not json', 'Read(./x)').ok, false);
  assert.equal(lf.denyPlan('[]', 'Read(./x)').ok, false);
  // A deny list, or permissions, that isn't the shape Claude Code reads is left alone rather than replaced.
  assert.equal(lf.denyPlan('{"permissions":{"deny":"Read(./y)"}}', 'Read(./x)').ok, false);
  assert.equal(lf.denyPlan('{"permissions":["x"]}', 'Read(./x)').ok, false);
  assert.deepEqual(JSON.parse(lf.denyPlan('{"permissions":null}', 'Read(./x)').text), { permissions: { deny: ['Read(./x)'] } });
});

// ---- a quieter command

test('a quieter way to run each kind of loud command, and a plain one for the rest', () => {
  assert.match(lf.quietSuggestion('npm test'), /reporter|tail/);
  assert.match(lf.quietSuggestion('npx vitest'), /--reporter=dot/);
  assert.match(lf.quietSuggestion('git log'), /--oneline/);
  assert.match(lf.quietSuggestion('git diff'), /--stat/);
  assert.match(lf.quietSuggestion('git status'), /--short/);
  assert.match(lf.quietSuggestion('cat'), /Read tool|deny rule/);
  assert.match(lf.quietSuggestion('ls'), /Glob/);
  assert.match(lf.quietSuggestion('rg'), /-l|files_with_matches/);
  assert.match(lf.quietSuggestion('cargo test'), /-q/);
  assert.match(lf.quietSuggestion('pytest'), /-q/);
  assert.match(lf.quietSuggestion('go test'), /tail/);
  assert.match(lf.quietSuggestion('dotnet build'), /quiet/);
  assert.match(lf.quietSuggestion('docker build'), /--quiet|-q/);
  assert.match(lf.quietSuggestion('npm install'), /--silent|--no-audit/);
  assert.match(lf.quietSuggestion('curl'), /-s|head/);
  assert.match(lf.quietSuggestion('node scripts/measure.js'), /tail|summary/);
  assert.match(lf.quietSuggestion('npm run e2e:ci'), /tail|summary/);
  assert.match(lf.quietSuggestion('some-tool'), /tail -n 60/);
  assert.equal(lf.quietSuggestion(42), null);
});

// ---- the fixes drafted from a report

const HOT = {
  files: [
    { rel: 'package-lock.json', reads: 6, edits: 0, sessions: 5, tokens: 48000 },
    { rel: 'src/main/lean.js', reads: 9, edits: 2, sessions: 7, tokens: 4200 },
    { rel: 'README.md', reads: 4, edits: 0, sessions: 4, tokens: 1800 },
    { rel: 'src/odd.bin', reads: 3, edits: 0, sessions: 3, tokens: null },
    { rel: 'src/out.js', reads: 0, edits: 5, sessions: 3, tokens: 900 },
  ],
  loud: [{ key: 'npm test', runs: 12, sessions: 6, tokens: 5200, total: 62400 }],
};
const HEADS = {
  'src/main/lean.js': '// Lean Shell, the main-process side. Keeps the ledger.\nconst fs = 1;\n',
  'README.md': '# Shellby\n\nA pixel hermit crab for Claude Code.\n',
  'src/odd.bin': '\u0000\u0001\u0002',
};

test('fixes from a report: a deny rule for the lockfile, a CLAUDE.md line for a described file, advice for a loud command', () => {
  const fixes = lf.draftFixes({ hot: HOT, md: '# Shop\n\nSee README.md first.\n', mdFile: 'C:\\code\\shop\\CLAUDE.md', settingsRaw: '', settingsFile: 'C:\\code\\shop\\.claude\\settings.json', headOf: rel => HEADS[rel] ?? null });
  assert.deepEqual(fixes.map(f => [f.kind, f.id]), [
    ['deny-read', 'deny:package-lock.json'],
    ['claude-line', 'line:src/main/lean.js'],
    ['quiet', 'quiet:npm test'],
  ]);
  const deny = fixes[0];
  assert.equal(deny.file, 'C:\\code\\shop\\.claude\\settings.json');
  assert.equal(deny.rule, 'Read(./package-lock.json)');
  assert.deepEqual(JSON.parse(deny.after), { permissions: { deny: ['Read(./package-lock.json)'] } });
  assert.equal(deny.before, '');
  assert.match(deny.why, /6×.*5 conversations.*48k tokens/);
  assert.equal(deny.saves, 48000 * 6);
  const line = fixes[1];
  assert.equal(line.file, 'C:\\code\\shop\\CLAUDE.md');
  assert.equal(line.line, '- `src/main/lean.js`: Lean Shell, the main-process side.');
  assert.equal(line.after, '# Shop\n\nSee README.md first.\n\n## Where things live\n\n- `src/main/lean.js`: Lean Shell, the main-process side.\n');
  assert.equal(line.added, '\n## Where things live\n\n- `src/main/lean.js`: Lean Shell, the main-process side.\n');
  assert.match(line.why, /9×.*7 conversations/);
  const quiet = fixes[2];
  assert.equal(quiet.key, 'npm test');
  assert.match(quiet.suggestion, /reporter|tail/);
  assert.match(quiet.why, /5\.2k tokens a run.*12 runs/);
  assert.equal(quiet.after, undefined, 'advice only: nothing to apply');
});

test('no fixes without the pieces: an unreadable settings file, a CLAUDE.md that cannot be read, an empty report', () => {
  const noSettings = lf.draftFixes({ hot: HOT, md: '', mdFile: 'm', settingsRaw: null, settingsFile: 's', headOf: () => null });
  assert.ok(!noSettings.some(f => f.kind === 'deny-read'), 'a settings file Shellby cannot parse is left alone');
  const noMd = lf.draftFixes({ hot: HOT, md: null, mdFile: 'm', settingsRaw: '', settingsFile: 's', headOf: rel => HEADS[rel] ?? null });
  assert.ok(!noMd.some(f => f.kind === 'claude-line'));
  assert.deepEqual(lf.draftFixes({ hot: null, md: '', mdFile: 'm', settingsRaw: '', settingsFile: 's', headOf: () => null }), []);
  assert.deepEqual(lf.draftFixes({ hot: { files: [], loud: [] }, md: '', mdFile: 'm', settingsRaw: '', settingsFile: 's', headOf: () => null }), []);
});
