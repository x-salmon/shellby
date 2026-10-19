const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sweepTmp, STALE_MS } = require('../src/main/tmp-sweep');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-sweep-'));
const age = (file, ms) => { const t = new Date(Date.now() - ms); fs.utimesSync(file, t, t); };

test('removes old leftovers of names Shellby makes', async () => {
  const dir = tmp();
  try {
    const old = ['shellby-index-0123456789ab', 'shellby-index-0123456789ab.lock', 'shellby-mcp-12345678-1234-1234-1234-123456789abc.json', 'shellby-no-hooks-AbC123'];
    for (const n of old) { const f = path.join(dir, n); if (n.includes('no-hooks')) fs.mkdirSync(f); else fs.writeFileSync(f, ''); age(f, STALE_MS + 60000); }
    assert.strictEqual(await sweepTmp({ dir }), old.length);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('keeps fresh leftovers and names it does not make', async () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, 'shellby-index-abcdefabcdef'), '');
    for (const n of ['shellby-no-hooks', 'shellby-mcp-home-x', 'shellby-status.txt', 'other.txt']) {
      const f = path.join(dir, n); fs.writeFileSync(f, ''); age(f, STALE_MS * 2);
    }
    assert.strictEqual(await sweepTmp({ dir }), 0);
    assert.strictEqual(fs.readdirSync(dir).length, 5);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a temp folder it cannot read removes nothing', async () => {
  assert.strictEqual(await sweepTmp({ dir: path.join(os.tmpdir(), 'shellby-sweep-missing-x') }), 0);
});
