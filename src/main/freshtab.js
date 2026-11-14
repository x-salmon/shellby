// A fresh tab with a summary Shellby writes himself. When a conversation's
// context is well filled and what you're typing reads like a new topic, the
// panel offers to carry on in a new tab that starts with a summary of this one:
// its title, the files it changed, its commits, the to-dos still open and the
// last few things you asked. Built here from the transcript alone, no model
// call, so it costs nothing and you can edit it before it goes. Unlike "Start
// fresh with a summary" (context.js), which has Claude write the handoff in
// the same tab, this one keeps the old conversation as it was.
//
// "New topic" is a cheap heuristic: few of the message's words appear in the
// last few turns, and none of the files it names were touched here.
// Pure functions: no Electron, no I/O — see test/freshtab.test.js.

const todos = require('../renderer/shared/todos');

// Past this the context is "well filled": worth a fresh tab for a new topic.
const HANDOFF_PCT = 60;
const MIN_WORDS = 3;        // a message with fewer content words is a follow-up, not a topic
const OVERLAP_MAX = 0.2;    // this share of the message's words seen lately, or fewer, reads as new
const RECENT_TURNS = 4;     // the asks (and the replies after them) that count as "lately"
const REPLY_CHARS = 2000;   // of each reply
const MAX_ASKS = 4;         // the asks the summary quotes, newest last
const ASK_CHARS = 200;
const MAX_FILES = 20;
const MAX_COMMITS = 10;
const MAX_TODOS = 15;
const MAX_SUMMARY = 6000;   // characters: a summary is for carrying on, not for reading the whole thing again
const CHARS_PER_TOKEN = 4;

// Words that say nothing about the topic.
const STOP = new Set(('the a an and or but of to in on at for with from by as is are was were be been being it its this that these those i you we they he she '
  + 'them us me my your our their his her do does did done can could should would will shall may might must have has had having not no yes please just also '
  + 'then than so if when where what which who whom how why all any some more most much many few each every very really about into over under again further '
  + 'once here there up down out off own same too only now new let make use using used want need like get go see look take put add set change fix run try '
  + 'thing things way still back one two first last next sure ok okay thanks thank right good great fine').split(/\s+/));

const EXT = 'js|ts|tsx|jsx|mjs|cjs|json|md|css|scss|html|py|rs|go|java|kt|cs|rb|php|yml|yaml|toml|sh|ps1|sql|txt|xml|svg|png|c|h|cpp|hpp|vue|svelte';
// A path (something with a separator in it) or a file name with a familiar extension (routines.test.js too).
const FILE_RE = new RegExp(`(?:^|[\\s"'\`(\\[@])((?:[\\w.-]+[\\\\/])+[\\w.-]+|[\\w.-]+\\.(?:${EXT}))(?=$|[\\s"'\`)\\],:;!?]|\\.(?:\\s|$))`, 'g');
const PATH_CHARS = 200;     // of a path in the summary

const str = v => (typeof v === 'string' ? v : '');
const oneLine = (s, n) => {
  const t = str(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/** The content words of a text: lowercase, three letters or more, not a stop word, not a number. */
function words(text) {
  const out = new Set();
  for (const w of str(text).toLowerCase().split(/[^\p{L}\p{N}_]+/u)) {
    if (w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)) out.add(w);
  }
  return out;
}

/** The files a message names: paths and file names, as written. */
function filesIn(text) {
  const out = [];
  for (const m of str(text).slice(0, 10000).matchAll(FILE_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

const norm = p => str(p).replace(/\\/g, '/').toLowerCase().replace(/^\.\//, '');
const base = p => norm(p).split('/').pop() || '';

/** Where the conversation Claude has now began: after the last fresh start or /clear. */
function sinceBoundary(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const at = list.findLastIndex(i => i.kind === 'fresh' || i.kind === 'cleared');
  return list.slice(at + 1);
}

/** A tool item's file, if it has one: an edit's, a whole read's, or what describeTool named. */
const toolFile = i => str(i.editPath || i.readPath || i.file);

/**
 * What the conversation has been about lately, for looksNewTopic: the last few
 * asks with the replies after them, and every file touched since it began.
 * -> { asks: string[], replies: string[], files: string[] }
 */
function recentOf(items) {
  const list = sinceBoundary(items);
  const asks = [];
  const replies = [];
  const files = new Set();
  for (const i of list) {
    if (i.kind === 'user' && !i.routine && !i.workflow) {
      asks.push(str(i.text));
      replies.push('');
    } else if (i.kind === 'text' && !i.sub && replies.length) {
      replies[replies.length - 1] += `\n${str(i.text).slice(0, REPLY_CHARS)}`;
    } else if (i.kind === 'changes') {
      for (const f of i.files || []) if (f?.path) files.add(f.path);
    } else if (i.kind === 'tool' && toolFile(i)) {
      files.add(toolFile(i));
    }
  }
  return { asks: asks.slice(-RECENT_TURNS), replies: replies.slice(-RECENT_TURNS), files: [...files] };
}

const TITLE_CHARS = 60;

/** The new tab's name: what was asked, on one line, or where it came from when nothing was. */
function titleFor(ask, from) {
  const t = oneLine(ask, TITLE_CHARS);
  return t || `Fresh: ${oneLine(from, TITLE_CHARS - 7) || 'a conversation'}`;
}

/**
 * Does a message read like a new topic? -> { fresh, why, overlap, files }
 * why: 'short' (too few words to say), 'files' (it names a file this
 * conversation touched), 'same' (too many of its words came up lately) or 'new'.
 * @param {string} text
 * @param {{ asks?: string[], replies?: string[], files?: string[] }} recent
 */
function looksNewTopic(text, recent) {
  const mine = words(text);
  if (mine.size < MIN_WORDS) return { fresh: false, why: 'short', overlap: null, files: [] };
  const touched = (recent?.files || []).map(norm);
  const names = new Set(touched.map(p => p.split('/').pop()));
  const hit = filesIn(text).filter(f => touched.includes(norm(f)) || touched.some(t => t.endsWith(`/${norm(f)}`)) || names.has(base(f)));
  if (hit.length) return { fresh: false, why: 'files', overlap: null, files: hit };
  const seen = words([...(recent?.asks || []), ...(recent?.replies || []), ...touched.map(base)].join(' '));
  let shared = 0;
  for (const w of mine) if (seen.has(w)) shared++;
  const overlap = shared / mine.size;
  return { fresh: overlap <= OVERLAP_MAX, why: overlap <= OVERLAP_MAX ? 'new' : 'same', overlap: Math.round(overlap * 100) / 100, files: [] };
}

/** Offer a fresh tab? Only past HANDOFF_PCT, and only for what reads as a new topic. */
const shouldOffer = ({ pct, topic }) => Number.isFinite(pct) && pct >= HANDOFF_PCT && !!topic?.fresh;

const tokensOf = text => Math.ceil(str(text).length / CHARS_PER_TOKEN);

/**
 * The summary, from the transcript: { text, tokens, counts: { asks, files,
 * commits, todos } }. Everything since the conversation Claude has now began.
 * @param {any[]} items
 * @param {{ title?: string }} [opts]
 */
function summarize(items, { title = '' } = {}) {
  const list = sinceBoundary(items);
  const asks = [];
  const files = new Map(); // path -> { added, removed }
  const commits = [];
  for (const i of list) {
    if (i.kind === 'user' && !i.routine && !i.workflow && str(i.text).trim()) asks.push(oneLine(i.text, ASK_CHARS));
    else if (i.kind === 'changes') {
      for (const f of i.files || []) {
        if (!f?.path) continue;
        const cur = files.get(f.path) || { added: 0, removed: 0 };
        files.set(f.path, { added: cur.added + (Number(f.added) || 0), removed: cur.removed + (Number(f.removed) || 0) });
      }
    } else if (i.kind === 'tool' && i.commits) {
      const subject = oneLine(i.commitSubject, 120);
      if (subject && !commits.includes(subject)) commits.push(subject);
    }
  }
  const open = todos.fromItems(list).items.filter(t => t.status !== 'completed');
  const lines = [`# Handoff: ${oneLine(title, 120) || 'a conversation'}`, 'Written by Shellby from what he saw in the conversation, not by Claude.'];
  const section = (head, rows) => { if (rows.length) lines.push('', `## ${head}`, ...rows); };
  section('Asked lately', asks.slice(-MAX_ASKS).map(a => `- ${a}`));
  const changed = [...files.entries()].slice(-MAX_FILES);
  section(`Files changed${files.size > changed.length ? ` (${changed.length} of ${files.size})` : ''}`, changed.map(([p, c]) => `- ${oneLine(p, PATH_CHARS)} (+${c.added} −${c.removed})`));
  section('Commits', commits.slice(-MAX_COMMITS).map(c => `- ${c}`));
  section('Open to-dos', open.slice(0, MAX_TODOS).map(t => `- [${t.status === 'in_progress' ? '~' : ' '}] ${oneLine(t.subject, 160)}`));
  if (!asks.length && !files.size && !commits.length && !open.length) lines.push('', 'Nothing was asked, changed or committed in it yet.');
  let text = lines.join('\n');
  if (text.length > MAX_SUMMARY) text = `${text.slice(0, MAX_SUMMARY - 1).trimEnd()}…`;
  return { text, tokens: tokensOf(text), counts: { asks: asks.length, files: files.size, commits: commits.length, todos: open.length } };
}

/**
 * Tokens a message to the new tab saves over one to this conversation: the
 * context Claude re-reads each turn, less the summary. Null without a reading.
 */
function saved(contextTokens, summaryTokens) {
  if (!Number.isFinite(contextTokens) || contextTokens <= 0) return null;
  return Math.max(0, Math.round(contextTokens - (Number.isFinite(summaryTokens) ? summaryTokens : 0)));
}

/** The new tab's first message: the summary (as edited), then what you were about to ask. */
function firstMessage(summary, ask) {
  const s = str(summary).trim();
  const a = str(ask).trim();
  return [
    'Shellby started this tab fresh to save context. His summary of the conversation so far (he wrote it from what he saw; Claude did not):',
    s || '(nothing to carry over)',
    a ? `---\n\n${a}` : 'Pick up from there, and wait for what is next.',
  ].join('\n\n');
}

module.exports = {
  words, filesIn, recentOf, looksNewTopic, shouldOffer, summarize, saved, firstMessage, titleFor, tokensOf,
  HANDOFF_PCT, MIN_WORDS, OVERLAP_MAX, RECENT_TURNS, MAX_ASKS, MAX_FILES, MAX_COMMITS, MAX_TODOS, MAX_SUMMARY, CHARS_PER_TOKEN, TITLE_CHARS,
};
