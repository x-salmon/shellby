const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const rf = require('../src/main/rulefit');

test('kindOf: the nearest folder under rules/ that names a kind', () => {
  assert.equal(rf.kindOf('C:\\Users\\me\\.claude\\rules\\ecc\\react\\hooks.md'), 'react');
  assert.equal(rf.kindOf('/home/me/.claude/rules/python/style.md'), 'python');
  assert.equal(rf.kindOf('/home/me/.claude/rules/ecc/common/standards.md'), null);
  assert.equal(rf.kindOf('/proj/CLAUDE.md'), null);
  assert.equal(rf.kindOf('/proj/react/CLAUDE.md'), null, 'only folders under rules/');
  assert.equal(rf.kindOf(null), null);
});

test('misfit: a rule for something the project shows none of', () => {
  const js = { files: ['package.json', 'src'], deps: ['electron'] };
  assert.equal(rf.misfit('/u/.claude/rules/ecc/react/hooks.md', js), 'react');
  assert.equal(rf.misfit('/u/.claude/rules/ecc/react/hooks.md', { ...js, deps: ['react'] }), null);
  assert.equal(rf.misfit('/u/.claude/rules/typescript/x.md', { files: ['tsconfig.json'], deps: [] }), null);
  assert.equal(rf.misfit('/u/.claude/rules/csharp/x.md', { files: ['App.csproj'], deps: [] }), null);
  assert.equal(rf.misfit('/u/.claude/rules/go/x.md', js), 'go');
  assert.equal(rf.misfit('/u/.claude/rules/common/x.md', js), null);
  assert.equal(rf.misfit('/u/.claude/rules/go/x.md', { files: [], deps: [] }), null, 'nothing read: say nothing');
});

test('projectSignals: root files and package.json dependencies', () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-rulefit-')));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { React: '1' }, devDependencies: { typescript: '5' } }));
    const s = rf.projectSignals(dir);
    assert.deepEqual(s.files, ['package.json']);
    assert.deepEqual(s.deps, ['react', 'typescript']);
    assert.deepEqual(rf.projectSignals(path.join(dir, 'missing')), { files: [], deps: [] });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
