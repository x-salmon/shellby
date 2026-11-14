/* Shellby panel — Notes, the pure part: where a note stands, how the list
   groups and filters, the note's story so far, and the buttons the open note
   offers (which one is the next step). No DOM. Works in the browser and in
   Node (test/notes-logic.test.js). The page is notes.js and notes-detail.js. */
'use strict';
(function (root) {
  const VERDICT = { do: 'Do it', differently: 'Do it differently', skip: 'Skip it' };
  const DID = { plan: 'Planned', build: 'Built', ask: 'Asked Claude' };

  const runsOf = n => (Array.isArray(n?.runs) ? n.runs : []);
  const hasReply = r => r.kind === 'ask' && !!(r.verdict || r.answer);

  /** The newest Ask that Claude answered (a verdict, its words, or both), or null. */
  const lastAnswer = n => runsOf(n).find(hasReply) || null;

  /**
   * Where a note stands:
   *   'new'      never handed to Claude
   *   'answered' Claude's reply to an Ask is the latest thing that happened
   *   'started'  planned or built since, or asked and still waiting on the reply
   */
  function stageOf(n) {
    const last = runsOf(n)[0];
    if (!last) return 'new';
    return hasReply(last) ? 'answered' : 'started';
  }

  const GROUPS = [
    { key: 'pinned', label: 'Pinned' },
    { key: 'answered', label: 'Claude answered. Your move' },
    { key: 'started', label: 'Under way' },
    { key: 'new', label: 'Not started' },
  ];

  /** Open notes in groups, each keeping the order it was given; empty groups drop out. */
  function grouped(notes) {
    const open = (notes || []).filter(n => !n.done);
    const keyOf = n => (n.pinned ? 'pinned' : stageOf(n));
    return GROUPS.map(g => ({ ...g, notes: open.filter(n => keyOf(n) === g.key) })).filter(g => g.notes.length);
  }

  const SHOWS = [
    { key: 'open', label: 'Open', test: () => true },
    { key: 'answered', label: 'Claude answered', test: n => stageOf(n) === 'answered' },
    { key: 'new', label: 'Not started', test: n => stageOf(n) === 'new' },
    { key: 'claude', label: 'From Claude', test: n => n.from === 'claude' },
  ];

  /** The chips over the list, counting open notes. Open always shows; the rest only with something in them. */
  function chips(notes) {
    const open = (notes || []).filter(n => !n.done);
    return SHOWS.map(s => ({ key: s.key, label: s.label, count: open.filter(s.test).length }))
      .filter(c => c.key === 'open' || c.count > 0);
  }

  /** The open notes a chip shows (an unknown chip shows them all). */
  function shown(notes, key) {
    const s = SHOWS.find(x => x.key === key) || SHOWS[0];
    return (notes || []).filter(n => !n.done && s.test(n));
  }

  /** What's happened to a note, oldest first: [{ label, at, tabId?, kind? }]. */
  function story(n) {
    const first = { label: n.from === 'claude' ? 'Claude noted it' : 'Noted', at: n.createdAt };
    const runs = [...runsOf(n)].reverse().map(r => ({
      label: r.kind === 'ask' && r.verdict ? `${DID.ask}: ${VERDICT[r.verdict]}` : DID[r.kind],
      at: r.at, tabId: r.tabId || null, kind: r.kind,
    }));
    return [first, ...runs];
  }

  /** The step the note is waiting on: 'ask' | 'plan' | 'plan-claude' | 'build' | 'done' | null. */
  function nextStep(n) {
    if (n.done) return null;
    const last = runsOf(n)[0];
    if (!last) return 'ask';
    if (last.kind === 'build') return 'done';
    if (last.kind === 'plan') return 'build';
    if (!hasReply(last)) return null;   // asked; the reply hasn't come
    if (last.verdict === 'skip') return 'done';
    return last.verdict === 'differently' && last.answer ? 'plan-claude' : 'plan';
  }

  /**
   * The open note's buttons, in order: [{ id, kind, version?, label, primary? }].
   * Claude's version comes first once Claude said to do it differently (and its
   * words were kept); the next step is primary; Mark as done joins when it's next.
   */
  function actions(n) {
    const answer = lastAnswer(n);
    const theirs = answer?.verdict === 'differently' && !!answer.answer;
    const asked = runsOf(n).some(r => r.kind === 'ask');
    const next = nextStep(n);
    /** @type {{ id: string, kind: string | null, version?: string, label: string, primary?: boolean }[]} */
    const list = [];
    if (theirs) list.push({ id: 'plan-claude', kind: 'plan', version: 'claude', label: "Plan Claude's version" });
    list.push(
      { id: 'plan', kind: 'plan', label: theirs ? 'Plan mine as written' : 'Plan' },
      { id: 'build', kind: 'build', label: 'Build' },
      { id: 'ask', kind: 'ask', label: asked ? 'Ask again' : 'Ask' });
    if (next === 'done') list.push({ id: 'done', kind: null, label: 'Mark as done' });
    return list.map(a => (a.id === next ? { ...a, primary: true } : a));
  }

  /**
   * An answer as the page shows it, under its verdict heading: without the
   * verdict line it led with ("**Do it differently**"), which the heading says
   * already. A first line that goes on past the verdict stays.
   */
  function answerBody(text, verdict) {
    if (typeof text !== 'string') return '';
    const lines = text.split('\n');
    const first = lines.findIndex(l => l.trim());
    if (first < 0) return '';
    const bare = lines[first].replace(/[*_`#>"“”.:!]/g, '').replace(/^\s*verdict\s*/i, '').trim().toLowerCase();
    const said = verdict && VERDICT[verdict] ? VERDICT[verdict].toLowerCase() : null;
    return (said && bare === said ? lines.slice(first + 1) : lines.slice(first)).join('\n').trim();
  }

  /** The note to open after this one leaves the list: the next one down, else the one above. */
  function neighbour(ids, id) {
    const i = ids.indexOf(id);
    if (i < 0) return ids[0] ?? null;
    return ids[i + 1] ?? ids[i - 1] ?? null;
  }

  const api = { VERDICT, GROUPS, stageOf, lastAnswer, grouped, chips, shown, story, nextStep, actions, answerBody, neighbour };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShellbyNotesLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
