// The Mac version's pure parts. They run on every platform; the ones that need
// a real Mac (posix-job.test.js's sweep) skip elsewhere.
const test = require('node:test');
const assert = require('node:assert');
const { menuTemplate } = require('../src/main/mac-app');
const { keyText, macWords } = require('../src/renderer/shared/mac-ui');
const { macKeyOf } = require('../src/main/desktop/native-mac');
const { mergePath, pick } = require('../src/main/shell-env');
const { terminalScript, sshScript, shQuote } = require('../src/main/handoff-mac');
const clipath = require('../src/main/clipath');
const { keychainTime } = require('../src/main/claude/cli');
const { parsePsProcesses } = require('../src/main/health/hogs');
const { Dictation, friendlyError, holdKeyOf } = require('../src/main/dictation');
const { macScript } = require('../src/main/media');
const { editorCandidates } = require('../src/main/editor');

test('the Mac menu has Edit (so Cmd+C works) and quits through Shellby', () => {
  let quit = 0;
  const noop = () => {};
  const menu = menuTemplate({ name: 'Shellby', showPanel: noop, openSettings: noop, newConversation: noop, help: noop, quit: () => quit++ });
  const edit = menu.find(m => m.label === 'Edit');
  assert.ok(edit);
  const roles = /** @type {any[]} */ (edit.submenu).map(i => i.role).filter(Boolean);
  for (const r of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) assert.ok(roles.includes(r), r);
  const app = /** @type {any[]} */ (menu[0].submenu);
  const q = app.find(i => i.accelerator === 'Cmd+Q');
  q.click();
  assert.equal(quit, 1);
  assert.ok(!JSON.stringify(menu).includes('Cmd+W'), 'Cmd+W is the panel\'s: close a conversation');
});

test('keys read the Mac way only on a Mac', () => {
  assert.equal(keyText('Ctrl+Shift+D', true), '⌘⇧D');
  assert.equal(keyText('Ctrl+Alt+Enter or Alt+J', true), '⌘⌥Enter or ⌥J');
  assert.equal(keyText('Press Ctrl+K to jump', true), 'Press ⌘K to jump');
  assert.equal(keyText('Ctrl+K', false), 'Ctrl+K');
  assert.equal(keyText('Control panel', true), 'Control panel');
});

test('push-to-talk keys map to the Mac key codes', () => {
  assert.equal(macKeyOf(holdKeyOf('Control+Alt+Space')), 0x31);
  assert.equal(macKeyOf(holdKeyOf('Alt+A')), 0x00);
  assert.equal(macKeyOf(holdKeyOf('Alt+0')), 0x1D);
  assert.equal(macKeyOf(holdKeyOf('Alt+F1')), 0x7A);
  assert.equal(macKeyOf(holdKeyOf('Alt+F20')), 0x5A);
  assert.equal(macKeyOf(null), null);
  assert.equal(macKeyOf(0x07), null);
});

test('the shell PATH is added after ours, absolute folders once each', () => {
  assert.equal(pick('Welcome!\n__SHELLBY_PATH_START__/a:/b__SHELLBY_PATH_END__'), '/a:/b');
  assert.equal(pick('no markers'), '');
  assert.equal(mergePath('/usr/bin:/bin', '/opt/homebrew/bin:/usr/bin:relative:~/x', ['/usr/local/bin']), '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin');
});

test('the terminal script quotes every word and deletes itself', () => {
  assert.equal(shQuote("it's"), "'it'\\''s'");
  const s = terminalScript({ exe: '/opt/homebrew/bin/claude', cwd: "/Users/me/my 'repo'", args: ['--resume', 'x; rm -rf ~'], scrub: ['ANTHROPIC_API_KEY', 'bad name'] });
  assert.match(s, /^#!\/bin\/bash\n/);
  assert.ok(s.includes('rm -f -- "$0"'));
  assert.ok(s.includes('unset SHELLBY_OWNED ANTHROPIC_API_KEY\n'));
  assert.ok(s.includes(`cd -- '/Users/me/my '\\''repo'\\''' || exit 1`));
  assert.ok(s.includes(`exec '/opt/homebrew/bin/claude' '--resume' 'x; rm -rf ~'`));
  assert.ok(sshScript('/usr/bin/ssh', ['-t', 'box']).includes("exec '/usr/bin/ssh' '-t' 'box'"));
});

test('the shellby command goes on a Mac PATH with one marked line, and comes off exactly', () => {
  const dir = '/Users/a b/Library/Application Support/Shellby/bin';
  const before = 'eval "$(/opt/homebrew/bin/brew shellenv)"';
  const added = clipath.profileWith(before, dir);
  assert.equal(added, `${before}\nexport PATH="$PATH":'${dir}'  ${clipath.PROFILE_MARK}\n`);
  assert.equal(clipath.profileWith(added, dir), added);
  assert.equal(clipath.profileWithout(added), `${before}\n`);
  assert.equal(clipath.profileWith('', dir).split('\n').length, 2);
});

test('the keychain item\'s change time is read, never its secret', () => {
  const out = 'keychain: "/Users/me/Library/Keychains/login.keychain-db"\nattributes:\n    "mdat"<timedate>=0x32303236313132323130303030305A00  "20261122100000Z\\000"\n';
  assert.equal(keychainTime(out), Date.UTC(2026, 10, 22, 10, 0, 0));
  assert.equal(keychainTime('security: The specified item could not be found'), 0);
});

test('a Mac\'s busiest processes come from ps, per machine not per core', () => {
  const list = parsePsProcesses('  412  80.0  204800 /Applications/Arc.app/Contents/MacOS/Arc\n    1   0.1   1024 /sbin/launchd\nnonsense\n', 4);
  assert.deepEqual(list, [{ pid: 412, name: 'Arc', cpu: 20, mem: 204800 * 1024, gpu: null }]);
});

test('dictation on a Mac says what to do in System Settings', () => {
  assert.match(friendlyError('not-allowed', 'darwin'), /Privacy & Security/);
  assert.match(friendlyError('no-recognizer', 'darwin'), /Language & Region/);
  assert.match(friendlyError('no-recognizer', 'win32'), /Windows Settings/);
  assert.equal(new Dictation({ platform: 'linux' }).available, false);
});

test('the Mac media watcher only asks apps that are already open, and ends with Shellby', () => {
  const s = macScript(3000, 4242);
  assert.ok(s.includes('Application(id).running()'));
  assert.ok(s.includes('$.getppid() !== 4242'));
  assert.ok(s.includes('delay(3)'));
});

test('VS Code is looked for in Applications, then on PATH', () => {
  const list = editorCandidates({ HOME: '/Users/me', PATH: '/usr/local/bin:relative' }, () => true, 'darwin');
  assert.equal(list[0], '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code');
  assert.ok(list.includes('/Users/me/Applications/Cursor.app/Contents/Resources/app/bin/cursor'));
  assert.ok(list.includes('/usr/local/bin/code'));
  assert.ok(!list.some(p => p.startsWith('relative')));
});

test('the panel reads as a Mac\'s: this Mac, Open at login, Terminal', () => {
  assert.equal(macWords('Start with Windows', true), 'Open at login');
  assert.equal(macWords('Kept on this PC, encrypted by Windows.', true), 'Kept on this Mac, kept in your keychain.');
  assert.equal(macWords("Turn on Windows' ssh agent", true), 'Turn on the ssh agent');
  assert.equal(macWords('Lock the PC', true), 'Lock the Mac');
  assert.equal(macWords('Windows only for now.', true), 'Not on a Mac yet.');
  assert.equal(macWords('Windows Terminal, claude --resume', true), 'Terminal, claude --resume');
  assert.equal(macWords('He perches on windows', true), 'He perches on windows');
  assert.equal(macWords('Start with Windows', false), 'Start with Windows');
});
