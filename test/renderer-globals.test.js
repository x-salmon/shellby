// src/renderer/globals.d.ts is written by scripts/renderer-globals.js from the
// panel's own files: what each one sets on SB and window. The renderer's
// typecheck reads it, so an SB member used but set nowhere fails there. A
// stale copy would hide exactly that.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { render, OUT } = require('../scripts/renderer-globals');

test('globals.d.ts matches the renderer files (npm run renderer:globals)', () => {
  assert.equal(fs.readFileSync(OUT, 'utf8'), render(), 'stale: run npm run renderer:globals');
});
