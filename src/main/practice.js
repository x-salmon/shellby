// A practice folder for First steps: someone new with no project to hand gets a
// tiny one, with a typo to fix, so their first task is safe and shows a real
// change. Written once under Shellby's own data folder; files already there
// (from an earlier try, or edited since) are left alone.
// See test/practice.test.js.
const fs = require('fs');
const path = require('path');

const FOLDER = 'practice-reef';
const FIRST_TASK = 'Fix the typo in README.md, then tell me what tide.js does.';

const FILES = Object.freeze({
  'README.md': [
    '# Practice reef',
    '',
    'A tiny project for trying Shellby out. Nothing here matters, so let Claude',
    'change anything.',
    '',
    'Ther is a typo in this sentence for Claude to fix.',
    '',
  ].join('\n'),
  'tide.js': [
    '// Whether the tide is in, from the hour of the day (0-23).',
    'function tideIsIn(hour) {',
    '  return Math.floor(hour / 6) % 2 === 0;',
    '}',
    '',
    'module.exports = { tideIsIn };',
    '',
  ].join('\n'),
});

/** Makes the practice folder under `root` (once) and returns its path. */
function ensurePracticeFolder(root, io = fs) {
  const dir = path.join(root, FOLDER);
  io.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(FILES)) {
    const file = path.join(dir, name);
    if (!io.existsSync(file)) io.writeFileSync(file, text, 'utf8');
  }
  return dir;
}

module.exports = { FOLDER, FILES, FIRST_TASK, ensurePracticeFolder };
