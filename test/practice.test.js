// First steps' practice folder (src/main/practice.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../src/main/practice');

const tmp = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-practice-')));

test('makes the folder with a typo to fix and a file to explain', () => {
  const root = tmp();
  try {
    const dir = P.ensurePracticeFolder(root);
    assert.equal(dir, path.join(root, P.FOLDER));
    assert.match(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), /Ther is a typo/);
    assert.ok(fs.existsSync(path.join(dir, 'tide.js')));
    assert.match(P.FIRST_TASK, /README\.md/);
    assert.match(P.FIRST_TASK, /tide\.js/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('leaves files from an earlier try alone', () => {
  const root = tmp();
  try {
    const dir = P.ensurePracticeFolder(root);
    fs.writeFileSync(path.join(dir, 'README.md'), 'fixed by Claude\n');
    fs.rmSync(path.join(dir, 'tide.js'));
    P.ensurePracticeFolder(root);
    assert.equal(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), 'fixed by Claude\n');
    assert.ok(fs.existsSync(path.join(dir, 'tide.js')), 'a missing file comes back');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
