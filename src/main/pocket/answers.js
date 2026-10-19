// Shellby on your phone: what goes with an answer to a question or a plan
// (wiring/pocket.js answer). A question needs an answer to each of its
// questions; a plan is only approved once the phone says it was read to the
// end, and a no carries your notes. Your own words into a conversation (a
// typed answer, notes on a plan) go only where a reply could: anywhere but a
// terminal (mayWrite). Pure.

// As the desk's Skip says it (feed-asks.js).
const SKIPPED_QUESTION = "The user skipped the question. Continue with your best judgement, or ask in plain text if you're stuck.";
const MAX_WORDS = 2000;

/**
 * -> { answers } | { message } | {} for answerPermission, or { error } for the phone.
 * @param {any} item the pending prompt
 * @param {{ decision: string, answers?: any, notes?: any, read?: any, mayWrite: boolean }} given
 */
function answerExtra(item, { decision, answers, notes, read, mayWrite }) {
  if (item.toolName === 'AskUserQuestion') {
    if (decision === 'deny') return { message: SKIPPED_QUESTION };
    const asked = (item.input?.questions || []).map(q => q?.question).filter(q => typeof q === 'string');
    const given = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
    const clean = Object.fromEntries(asked.map(q => [q, typeof given[q] === 'string' ? given[q].trim().slice(0, MAX_WORDS) : '']));
    if (!asked.length || Object.values(clean).some(a => !a)) return { error: 'Answer each question first.' };
    if (!mayWrite) {
      // Only the options offered, then: a typed answer to a desk conversation is a reply.
      const offered = q => new Set(((item.input.questions || []).find(x => x?.question === q)?.options || []).map(o => o?.label));
      if (Object.entries(clean).some(([q, a]) => a.split(', ').some(part => !offered(q).has(part)))) return { error: 'Pick from the options: typed answers to this one go from the desk.' };
    }
    return { answers: clean };
  }
  if (item.toolName === 'ExitPlanMode') {
    if (decision === 'allow') return read === true ? {} : { error: 'Read the plan to the end first.' };
    const said = typeof notes === 'string' ? notes.trim().slice(0, MAX_WORDS) : '';
    if (said && !mayWrite) return { error: 'Notes on this plan go from the desk. Send it back without them, or write them there.' };
    return said ? { message: `The user read your plan and wants it revised before anything changes. Their notes:\n${said}` } : {};
  }
  return {};
}

module.exports = { SKIPPED_QUESTION, answerExtra };
