// Line diffs for Claude's file edits: what an Edit, MultiEdit, Write or
// NotebookEdit is about to change, as red and green lines.
// Pure, no DOM: the panel draws the rows, main uses editsOf() to keep a compact
// copy on each tool item. Works in the browser and in Node (for tests).
(function (root) {
  const MAX_TEXT = 20000;        // per side; past this the diff is cut short
  const MAX_CELLS = 2000000;     // LCS table size before falling back to "all removed, all added"

  const clip = s => (typeof s === 'string' ? s.slice(0, MAX_TEXT) : '');
  const str = v => typeof v === 'string';

  /**
   * The text changes a write tool makes: [{ old, new }]. `old` is null for a
   * whole-file Write, where the previous contents aren't part of the call.
   * Anything else (or a malformed input) is [].
   */
  function editsOf(name, input) {
    const i = input || {};
    if (name === 'Edit' && str(i.new_string)) return [{ old: clip(i.old_string), new: clip(i.new_string) }];
    if (name === 'MultiEdit' && Array.isArray(i.edits)) {
      return i.edits.filter(e => e && str(e.new_string)).slice(0, 50).map(e => ({ old: clip(e.old_string), new: clip(e.new_string) }));
    }
    if (name === 'Write' && str(i.content)) return [{ old: null, new: clip(i.content) }];
    if (name === 'NotebookEdit') {
      if (i.edit_mode === 'delete') return [{ old: '(this cell)', new: '' }];
      if (str(i.new_source)) return [{ old: i.edit_mode === 'insert' ? '' : null, new: clip(i.new_source) }];
    }
    return [];
  }

  const split = s => (s ? s.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n') : []);

  /** Line-by-line diff: [{ t: ' ' | '-' | '+', s }]. */
  function diffLines(a, b) {
    const A = split(a), B = split(b);
    let pre = 0;
    while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
    let suf = 0;
    while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
    const a2 = A.slice(pre, A.length - suf), b2 = B.slice(pre, B.length - suf);
    const out = A.slice(0, pre).map(s => ({ t: ' ', s }));
    if (a2.length * b2.length > MAX_CELLS) {
      for (const s of a2) out.push({ t: '-', s });
      for (const s of b2) out.push({ t: '+', s });
    } else {
      // Classic LCS table, walked forwards so removals come before additions.
      const n = a2.length, m = b2.length;
      const w = m + 1;
      const L = new Uint32Array((n + 1) * w);
      for (let x = n - 1; x >= 0; x--) {
        for (let y = m - 1; y >= 0; y--) {
          L[x * w + y] = a2[x] === b2[y] ? L[(x + 1) * w + y + 1] + 1 : Math.max(L[(x + 1) * w + y], L[x * w + y + 1]);
        }
      }
      let x = 0, y = 0;
      while (x < n && y < m) {
        if (a2[x] === b2[y]) { out.push({ t: ' ', s: a2[x] }); x++; y++; }
        else if (L[(x + 1) * w + y] >= L[x * w + y + 1]) out.push({ t: '-', s: a2[x++] });
        else out.push({ t: '+', s: b2[y++] });
      }
      while (x < n) out.push({ t: '-', s: a2[x++] });
      while (y < m) out.push({ t: '+', s: b2[y++] });
    }
    for (const s of A.slice(A.length - suf)) out.push({ t: ' ', s });
    return out;
  }

  /**
   * Rows to draw for one edit, with line numbers when we know where it starts
   * (`line`: the old text's first line in the file). Long unchanged runs fold
   * into { t: '…', n } so a one-line change in a big block stays one screen.
   *   [{ t, s, a?, b? }]  a = old line number, b = new line number
   */
  function rows(edit, { line = null, context = 3 } = {}) {
    const lines = edit.old == null ? split(edit.new).map(s => ({ t: '+', s })) : diffLines(edit.old, edit.new);
    let a = line, b = line;
    const numbered = lines.map(r => {
      const row = { ...r };
      if (a != null) {
        if (r.t !== '+') row.a = a++;
        if (r.t !== '-') row.b = b++;
      }
      return row;
    });
    const out = [];
    for (let i = 0; i < numbered.length;) {
      if (numbered[i].t !== ' ') { out.push(numbered[i++]); continue; }
      let j = i;
      while (j < numbered.length && numbered[j].t === ' ') j++;
      const run = numbered.slice(i, j);
      const head = i === 0 ? 0 : context;              // keep context after a change
      const tail = j === numbered.length ? 0 : context; // and before the next one
      if (run.length > head + tail + 1) {
        out.push(...run.slice(0, head), { t: '…', n: run.length - head - tail }, ...run.slice(run.length - tail));
      } else out.push(...run);
      i = j;
    }
    return out;
  }

  /** { added, removed } line counts across edits. */
  function stats(edits) {
    let added = 0, removed = 0;
    for (const e of edits || []) {
      if (e.old == null) { added += split(e.new).length; continue; }
      for (const r of diffLines(e.old, e.new)) {
        if (r.t === '+') added++;
        else if (r.t === '-') removed++;
      }
    }
    return { added, removed };
  }

  /** The 1-based line `needle` starts on in `text`, or null if it isn't there. */
  function lineOf(text, needle) {
    if (!str(text) || !str(needle) || !needle) return null;
    const at = text.indexOf(needle);
    if (at < 0) return null;
    let n = 1;
    for (let i = text.indexOf('\n'); i !== -1 && i < at; i = text.indexOf('\n', i + 1)) n++;
    return n;
  }

  // ---- what changed inside a changed line

  // Words, runs of spaces, and each other character on its own: a changed argument
  // is marked, not the whole call around it.
  const WORD = /[\p{L}\p{N}_$]+|\s+|[^\p{L}\p{N}_$\s]/gu;
  const MAX_WORD_CELLS = 40000;   // tokens × tokens in one pair, past which nothing is marked
  const MIN_SAME = 0.4;           // lines sharing less than this much aren't one line edited

  // [[from, to]] character ranges over a token list's marked tokens, a lone space between two joined.
  function spans(tokens, changed) {
    const out = [];
    let at = 0;
    tokens.forEach((t, i) => {
      const end = at + t.length;
      const bridge = !changed[i] && /^\s+$/.test(t) && changed[i - 1] && changed[i + 1];
      if (changed[i] || bridge) {
        const last = out[out.length - 1];
        if (last && last[1] === at) last[1] = end; else out.push([at, end]);
      }
      at = end;
    });
    return out;
  }

  /**
   * What changed between a removed line and the added line that replaced it, as
   * character ranges on each: { a: [[from, to]], b: [[from, to]] }. null when the
   * two have too little in common to be one line edited (then the whole line is
   * the change), or are too long to compare.
   */
  function wordDiff(a, b) {
    const A = String(a ?? '').match(WORD) || [];
    const B = String(b ?? '').match(WORD) || [];
    if (!A.length || !B.length || A.length * B.length > MAX_WORD_CELLS) return null;
    const n = A.length, m = B.length, w = m + 1;
    const L = new Uint16Array((n + 1) * w);
    for (let x = n - 1; x >= 0; x--) {
      for (let y = m - 1; y >= 0; y--) {
        L[x * w + y] = A[x] === B[y] ? L[(x + 1) * w + y + 1] + 1 : Math.max(L[(x + 1) * w + y], L[x * w + y + 1]);
      }
    }
    const inA = new Array(n).fill(true), inB = new Array(m).fill(true);
    let x = 0, y = 0;
    while (x < n && y < m) {
      if (A[x] === B[y]) { inA[x++] = false; inB[y++] = false; }
      else if (L[(x + 1) * w + y] >= L[x * w + y + 1]) x++;
      else y++;
    }
    const solid = (toks, keep) => toks.reduce((s, t, i) => s + (keep(i) && /\S/.test(t) ? t.length : 0), 0);
    const same = solid(A, i => !inA[i]);
    const most = Math.max(solid(A, () => true), solid(B, () => true));
    if (!most || same / most < MIN_SAME) return null;
    const ra = spans(A, inA), rb = spans(B, inB);
    return ra.length || rb.length ? { a: ra, b: rb } : null;
  }

  /**
   * Which characters to mark in a diff's rows: each run of removed lines faces the
   * run of added lines after it, one to one (as Side by side lays them out).
   * rows: [{ kind: 'del' | 'add' | anything else, text }] (text without its +/−).
   *   -> Map(row index -> [[from, to]])
   */
  function wordMarks(rows) {
    const out = new Map();
    const list = rows || [];
    for (let i = 0; i < list.length;) {
      if (list[i]?.kind !== 'del') { i++; continue; }
      const dels = [];
      const adds = [];
      while (i < list.length && list[i]?.kind === 'del') dels.push(i++);
      while (i < list.length && list[i]?.kind === 'add') adds.push(i++);
      for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
        const d = wordDiff(list[dels[k]].text, list[adds[k]].text);
        if (!d) continue;
        if (d.a.length) out.set(dels[k], d.a);
        if (d.b.length) out.set(adds[k], d.b);
      }
    }
    return out;
  }

  const api = { editsOf, diffLines, rows, stats, lineOf, wordDiff, wordMarks, MAX_TEXT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShellbyDiff = api;
})(typeof window !== 'undefined' ? window : globalThis);
