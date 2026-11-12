// What "Look over my changes" can look for, by name: the panel's menu and main's
// prompts (src/main/review.js) both read this list, so the two can't drift.
// goal needs a conversation's first message to compare with, so a project's
// shield leaves it out. Pure. Works in the browser and in Node.
(function (root) {
  const REVIEW_LENSES = Object.freeze([
    Object.freeze({ id: 'security', label: 'Security', sub: 'Holes someone could use' }),
    Object.freeze({ id: 'correctness', label: 'Bugs', sub: 'What breaks when it runs' }),
    Object.freeze({ id: 'tests', label: 'Missing tests', sub: 'What could break unnoticed' }),
    Object.freeze({ id: 'goal', label: 'Does it do what I asked?', sub: 'Checked against your first message' }),
  ]);

  /** The lenses a menu offers: goal only where there's a request to compare with. */
  const lensesFor = ({ goal = false } = {}) => REVIEW_LENSES.filter(l => goal || l.id !== 'goal');

  const api = { REVIEW_LENSES, lensesFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShellbyReviewLenses = api;
})(typeof window !== 'undefined' ? window : globalThis);
