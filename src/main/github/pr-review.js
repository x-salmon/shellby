// Line comments and the pull request a copy shipped (ship.js): your comments
// waiting in Shellby posted to it as one review, and the threads on it nobody
// has resolved brought back as comments waiting for Claude.
//
// GitHub takes a review comment only on a line its diff shows, so each comment
// is placed first (placeComments): one on such a line goes on it, the rest are
// listed in the review's body under their file and line rather than lost.
// Nothing Shellby posts pings anyone (a zero-width joiner after each @), and a
// line the secret scan flags never reaches GitHub, as with ship.js.
//
// gh is a GitHubApi (or a stand-in in tests: test/pr-review.test.js).
const secretscan = require('../secretscan');
const { reviewThreads } = require('./prwork');
const { openThreads } = require('../startfrom');

const REPO_RE = /^(?!\.{1,2}\/)[A-Za-z0-9_.-]{1,100}\/(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const MAX_COMMENTS = 50;
const MAX_BODY = 4000;
const MAX_PULLED = 30;
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const noMentions = s => String(s ?? '').replace(/@(?=[\w-])/g, '@‍');
const scrub = s => String(s ?? '').split('\n').map(line => {
  const kind = secretscan.lineSecret(line);
  return kind ? `(a line left out: it looked like ${kind})` : line;
}).join('\n');
const clean = s => noMentions(scrub(String(s ?? '').replace(/\r\n?/g, '\n').trim())).slice(0, MAX_BODY);

/**
 * The lines a file's patch (as GitHub's pulls/:n/files gives it) shows, on each side:
 * { RIGHT: Set(new line numbers), LEFT: Set(old line numbers) }. Context lines are on both.
 */
function diffLines(patch) {
  const right = new Set();
  const left = new Set();
  let a = 0, b = 0;
  for (const l of String(patch || '').split('\n')) {
    const h = HUNK.exec(l);
    if (h) { a = Number(h[1]); b = Number(h[3]); continue; }
    if (!a && !b) continue;
    if (l.startsWith('+')) right.add(b++);
    else if (l.startsWith('-')) left.add(a++);
    else if (!l.startsWith('\\')) { right.add(b++); left.add(a++); }
  }
  return { RIGHT: right, LEFT: left };
}

/**
 * Comments ({ file, side: 'new' | 'old', start, end, body }) against a pull request's files
 * ([{ filename, patch }]) -> { inline: [{ path, line, side, start_line?, start_side?, body }], rest }.
 * One whose lines the diff shows goes on them; the rest go in the review's body.
 */
function placeComments(files, comments) {
  const shown = new Map((files || []).filter(f => typeof f?.filename === 'string').map(f => [f.filename, diffLines(f.patch)]));
  const inline = [];
  const rest = [];
  for (const c of (comments || []).slice(0, MAX_COMMENTS)) {
    const body = clean(c?.body);
    if (!body || typeof c.file !== 'string') continue;
    const side = c.side === 'old' ? 'LEFT' : 'RIGHT';
    const lines = shown.get(c.file)?.[side];
    const start = Number.isInteger(c.start) ? c.start : null;
    const end = Number.isInteger(c.end) ? c.end : start;
    if (!lines || !start || !end || !lines.has(end)) { rest.push({ ...c, body }); continue; }
    const multi = start < end && lines.has(start);
    inline.push({ path: c.file, line: end, side, ...(multi ? { start_line: start, start_side: side } : {}), body });
  }
  return { inline, rest };
}

/** The review's own words: a line, and the comments GitHub won't put on a line, under their places. */
function reviewBody(rest, note = '') {
  const lines = [clean(note) || 'Review comments from Shellby.'];
  if (rest.length) {
    lines.push('', 'On lines this pull request doesn\'t show:');
    for (const c of rest) {
      const where = `${c.file}:${c.start}${c.end && c.end !== c.start ? `-${c.end}` : ''}${c.side === 'old' ? ' (removed)' : ''}`;
      lines.push('', `**\`${String(where).replace(/`/g, "'")}\`**`, c.body);
    }
  }
  return lines.join('\n').slice(0, 60000);
}

/**
 * Post comments to a pull request as one review (event COMMENT: no approval, no changes asked).
 *   -> { ok: true, url, inline, inBody } | { ok: false, error }
 */
async function postReview(gh, { repo, number, comments, note = '' }) {
  if (!REPO_RE.test(String(repo)) || !Number.isInteger(number) || number < 1) return { ok: false, error: 'Which pull request?' };
  if (!Array.isArray(comments) || !comments.length) return { ok: false, error: 'There are no comments to post.' };
  const base = `/repos/${repo}/pulls/${number}`;
  let pull, files;
  try {
    [pull, files] = await Promise.all([gh.get(base), gh.get(`${base}/files?per_page=100`)]);
  } catch (e) {
    return { ok: false, error: e?.status === 404 ? "GitHub can't find that pull request, or won't show it to Shellby." : "Couldn't read the pull request." };
  }
  const sha = pull?.head?.sha;
  if (!SHA_RE.test(String(sha))) return { ok: false, error: "GitHub didn't say which commit that pull request is on." };
  const { inline, rest } = placeComments(Array.isArray(files) ? files : [], comments);
  if (!inline.length && !rest.length) return { ok: false, error: 'There are no comments to post.' };
  const post = (onLines, inBody) => gh.post(`${base}/reviews`, { commit_id: sha, event: 'COMMENT', body: reviewBody(inBody, note), comments: onLines });
  const urlOf = r => (typeof r?.html_url === 'string' ? r.html_url : null);
  try {
    const r = await post(inline, rest);
    return { ok: true, url: urlOf(r), inline: inline.length, inBody: rest.length };
  } catch (e) {
    // A line GitHub wouldn't take after all (the pull request moved on): all of them in the body instead.
    if (e?.status !== 422 || !inline.length) return { ok: false, error: e?.status === 403 || e?.status === 404 ? "GitHub won't let Shellby comment there. Check Settings → GitHub." : "Couldn't post the review." };
    const back = c => ({ file: c.path, start: c.start_line || c.line, end: c.line, side: c.side === 'LEFT' ? 'old' : 'new', body: c.body });
    try {
      const r = await post([], [...rest, ...inline.map(back)]);
      return { ok: true, url: urlOf(r), inline: 0, inBody: inline.length + rest.length };
    } catch {
      return { ok: false, error: "Couldn't post the review." };
    }
  }
}

/**
 * The threads on a pull request nobody has resolved, as comments waiting for Claude:
 * [{ file, side: 'new', start, end, body }], each one's words quoted and said to be whose.
 *   -> { ok: true, comments } | { ok: false, error }
 */
async function pullThreads(gh, { repo, number }) {
  const r = await reviewThreads(gh, { repo, number });
  if (r.error) return { ok: false, error: r.error };
  const comments = openThreads(r.threads).filter(t => t.path && t.line && !t.outdated).slice(0, MAX_PULLED).map(t => ({
    file: t.path, side: 'new', start: t.line, end: t.line,
    body: [
      `From the pull request review${r.resolvedKnown ? '' : ' (GitHub didn\'t say whether it was resolved)'}:`,
      ...t.comments.flatMap(c => [`@${c.author} wrote:`, ...c.body.split('\n').map(l => `> ${l}`)]),
    ].join('\n').slice(0, MAX_BODY),
  }));
  return { ok: true, comments };
}

module.exports = { diffLines, placeComments, reviewBody, postReview, pullThreads, MAX_COMMENTS };
