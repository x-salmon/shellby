// src/main/health/mac-memory.js: a Mac's memory in use, as Activity Monitor counts it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { usedFromVmStat, createMacMemory } = require('../src/main/health/mac-memory');

// vm_stat on an 8 GB Apple silicon Mac: little is "free", most of the rest is cache.
const VM_STAT = [
  'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
  'Pages free:                                3285.',
  'Pages active:                            180000.',
  'Pages inactive:                          175000.',
  'Pages speculative:                         2000.',
  'Pages wired down:                         60000.',
  'Pages purgeable:                          10000.',
  'File-backed pages:                       150000.',
  'Anonymous pages:                         200000.',
  'Pages occupied by compressor:             20000.',
].join('\n');

test('in use is app memory (anonymous less purgeable) + wired + compressed', () => {
  assert.equal(usedFromVmStat(VM_STAT), (190000 + 60000 + 20000) * 16384);
});

test('vm_stat that cannot be read is no answer', () => {
  assert.equal(usedFromVmStat(''), null);
  assert.equal(usedFromVmStat('Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free: 1.'), null);
});

test('the first read waits for vm_stat; later ones answer at once and refresh behind', () => {
  let syncCalls = 0;
  /** @type {Function[]} */
  const pending = [];
  const usedBytes = createMacMemory({
    runSync: () => { syncCalls++; return { stdout: VM_STAT }; },
    run: (_exe, _args, _opts, cb) => { pending.push(cb); },
  });
  const first = usedBytes();
  assert.equal(first, usedFromVmStat(VM_STAT));
  assert.equal(usedBytes(), first, 'the last count, without waiting');
  assert.equal(usedBytes(), first);
  assert.equal(syncCalls, 1);
  assert.equal(pending.length, 1, 'one refresh at a time');
  pending[0](null, VM_STAT.replace('Pages wired down:                         60000.', 'Pages wired down:                         70000.'));
  assert.equal(usedBytes(), (190000 + 70000 + 20000) * 16384);
});
