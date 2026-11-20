// What a copy is called (worktrees/index.js): its branch from a task's title or
// the name Claude suggested, and the commit subject that takes its work home.
// Pure: no git, no disk.
const crypto = require('crypto');
const path = require('path');

/** A branch name from a task's title: "Fix the login bug!" -> "shellby/fix-the-login-bug-1a2b3c". Pure. */
function branchName(title, suffix = crypto.randomBytes(3).toString('hex')) {
  const slug = String(title || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'task';
  return `shellby/${slug}-${suffix}`;
}

/** The branch name Claude suggested ("Branch: fix-login-redirect"), as a slug, or null. Pure. */
function suggestedName(text) {
  const m = /branch\s*:[\s`*"']*([a-z0-9][a-z0-9/_-]{1,60})/i.exec(String(text || ''));
  const slug = m && m[1].toLowerCase().replace(/^shellby\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || null;
}

// The commits that take a copy's work home. Their subject comes from the branch
// name Claude chose for the work ("fix-tall-menu-overflow"), which says what
// changed, or else from the files that changed. Never from the conversation:
// the tab's title is the start of your prompt, and a commit is public wherever
// the repository is. A copy only counts as named when Claude named it
// (`named` on the copy): otherwise its branch was made from that same title.
// Release drafts group commits by their type, and an untyped subject lands
// under "Changed" word for word.
const TYPE_WORDS = new Map([
  ['feat', 'feat'], ['feature', 'feat'], ['fix', 'fix'], ['bugfix', 'fix'], ['hotfix', 'fix'],
  ['perf', 'perf'], ['refactor', 'refactor'], ['docs', 'docs'], ['doc', 'docs'],
  ['test', 'test'], ['tests', 'test'], ['chore', 'chore'], ['ci', 'ci'],
]);
const FIX_WORDS = /^(bug|bugs|broken|crash|crashes|regression|typo)$/;
const FEAT_WORDS = /^(add|adds|new|support|implement)$/;
const SUBJECT_MAX = 72;

/** "update a.js, b.js and 3 more files", in at most `room` characters. Pure. */
function changedFiles(files, room) {
  const names = [...new Set((files || []).map(f => path.posix.basename(String(f).replace(/\\/g, '/'))).filter(Boolean))];
  if (!names.length) return 'work from Shellby';
  const say = k => {
    const shown = names.slice(0, k);
    const more = names.length - k;
    if (!more) return `update ${shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown[0]}`;
    return `update ${shown.join(', ')} and ${more} more file${more > 1 ? 's' : ''}`;
  };
  for (let k = Math.min(names.length, 3); k > 0; k--) if (say(k).length <= room) return say(k);
  return `update ${names.length} file${names.length > 1 ? 's' : ''}`;
}

/**
 * w: the copy ({ branch, named }). files: the paths the commit changes.
 * -> "fix: tall menu overflow", or "Update a.js and b.js" for a copy Claude
 * didn't name. Typed only when the name says which type ("Next up backlog"
 * otherwise): a wrong "feat" would have the release card suggest a minor
 * version for a tweak. Pure.
 */
function workMessage(w, files = []) {
  const m = w?.named ? /^shellby\/(.+)-[0-9a-f]{6}$/.exec(String(w.branch || '')) : null;
  const words = m ? m[1].split('-').filter(Boolean) : [];
  const named = TYPE_WORDS.get(words[0]);
  const type = named || (words.some(x => FIX_WORDS.test(x)) ? 'fix' : FEAT_WORDS.test(words[0] || '') ? 'feat' : '');
  const rest = (named ? words.slice(1) : words).join(' ');
  const room = SUBJECT_MAX - (type ? type.length + 2 : 0);
  const what = (rest || changedFiles(files, room)).slice(0, room).trim();
  return type ? `${type}: ${what}` : what[0].toUpperCase() + what.slice(1);
}

module.exports = { branchName, suggestedName, workMessage, changedFiles };
