// Engineer mode's words to Claude (docs/ENGINEER.md): the line each message
// carries while it's on, and the message each button on a card sends. Pure.
//
// Every one is a "[Shellby: …]" line (selfaware.js's convention). Anything
// Claude wrote that goes back inside one (a title, an option's name, a path)
// was stripped of brackets and quotes when it was read (engineer.js named,
// scopePath), so it can't pass for the end of one.
const { RECORD_DIR, MAX_NOTE, para, line, recordSlug, scopeOf } = require('./engineer');

const list = (xs, n = 6) => {
  const shown = xs.slice(0, n).join(', ');
  return xs.length > n ? `${shown} and ${xs.length - n} more` : shown;
};
const noteOf = note => para(note, MAX_NOTE);
const theirs = said => (said ? `\nTheir note: ${said}` : '');

// ------------------------------------------------------------------ the line each message gets

/**
 * The bracketed line a message carries while Engineer mode is on, or '' when
 * it needs none. state: { decision, spike } (wiring/engineer.js). before: the
 * commands allowed before a decision in this project.
 */
function turnNote(state, { before = [] } = {}) {
  const d = state?.decision;
  const s = state?.spike;
  if (s?.phase === 'running') {
    return `[Shellby: Engineer mode: a spike is running to find out "${s.question}". Try things in the project's files freely: every change is put back when you call mcp__shellby__end_spike. No commits, pushes, publishing or requests that change things elsewhere. Once you know, call end_spike with what you found, then mcp__shellby__decide.]`;
  }
  if (s?.phase === 'asked') {
    return '[Shellby: Engineer mode is on. Your spike is waiting on the user\'s card. Answer what they ask, but change no files until they answer.]';
  }
  if (d?.phase === 'approved') {
    const steps = d.steps?.length ? ` Its steps: report each with mcp__shellby__check_decision({ step }) as you finish it (${(d.progress || []).length} of ${d.steps.length} done).` : '';
    return `[Shellby: Engineer mode is on. The approved decision "${d.title}" covers this work, within: ${list(scopeOf(d))}. Editing outside that needs mcp__shellby__amend_decision first. If this message asks for something it doesn't cover, call mcp__shellby__decide again.${steps}]`;
  }
  if (d?.phase === 'proposed') {
    return '[Shellby: Engineer mode is on. Your decision is waiting on the user\'s card. Answer what they ask, but change no files until they approve it; if this message changes what is needed, call mcp__shellby__decide again with the new decision.]';
  }
  const found = s?.phase === 'done' && !s.used && s.findings ? ` Your spike "${s.question}" found: ${line(s.answer || s.findings, 300)}. Use it.` : '';
  const may = before.length ? ` Before deciding you may also run: ${list(before, 4)}.` : '';
  return `[Shellby: Engineer mode is on. Before changing any file, explore (read ${RECORD_DIR} for earlier decisions first), then call mcp__shellby__decide with your decision and its scope, and end your turn. File changes are blocked until the user approves one. If the right choice depends on something only trying will show, call mcp__shellby__spike instead. Questions that need no changes can be answered directly.${may}${found}]`;
}

/** Appends the line to a prompt (a string, or content blocks when pictures go with it). */
function withNote(prompt, note) {
  if (!note) return prompt;
  if (Array.isArray(prompt)) return [...prompt, { type: 'text', text: note }];
  return `${prompt}\n\n${note}`;
}

// ------------------------------------------------------------------ what you answer on a decision

/** What approving tells Claude to do, beyond building it. */
function buildSteps(decision, keepRecords) {
  const out = [];
  if (keepRecords) {
    out.push(`First write the decision down: ${RECORD_DIR}/NNNN-${recordSlug(decision.title)}.md, with NNNN the next free four-digit number there, in this shape: # NNNN. Title; Status: Accepted; Date; ## Context (goal and constraints); ## Options considered (each with its trade-offs); ## Decision (the chosen option and why); ## Scope; ## Test plan; ## Risks. Follow the house style if the folder already has records.`);
    if (decision.related?.length) out.push(`Link the records it builds on: ${list(decision.related)}.`);
    if (decision.supersedes) out.push(`Set the Status of ${decision.supersedes} to "Superseded by NNNN" (the new record's number), and link the two.`);
  }
  out.push(`Edits are held to the scope: ${list(scopeOf(decision))}.`);
  if (decision.steps?.length) out.push(`Work through the steps in order (${decision.steps.map((s, i) => `${i + 1}. ${s}`).join('; ')}), and report each with mcp__shellby__check_decision({ step }) as you finish it.`);
  const runs = decision.testPlan.filter(t => t.command).map(t => t.command);
  if (runs.length) out.push(`After your check_decision, Shellby runs ${list([...new Set(runs)])} itself and shows the result beside yours.`);
  return out.join('\n');
}

/**
 * What Claude is told when you press a button on the card. what: 'approve' |
 * 'pick' (another option, by index) | 'return' | 'critic' | 'spike-first'.
 * keepRecords: Settings' "keep decision records in the repo".
 * -> { prompt, shown, picked? } | { error }
 */
function answerPrompt(decision, { what, option = -1, note = '', keepRecords = true }) {
  const said = noteOf(note);
  if (what === 'return') {
    if (!said) return { error: 'Say what should change, then send it back.' };
    return {
      prompt: `[Shellby: The user sent the decision "${decision.title}" back without approving it.${theirs(said)}\nRethink it, then call mcp__shellby__decide again. File changes stay blocked until they approve one.]`,
      shown: `Sent back: ${line(said, 200)}`,
    };
  }
  if (what === 'critic') {
    return {
      prompt: `[Shellby: Before deciding on "${decision.title}", the user wants a critic's view.${theirs(said)}\nStart one helper (the Agent tool) whose only job is to argue against your pick: what it costs, what it breaks, what you missed, and which option it would choose and why. It only reads. Then call mcp__shellby__decide again with its strongest points in critique, and change the decision where the critic is right. File changes stay blocked.]`,
      shown: `Ask a critic${said ? `: ${line(said, 160)}` : ''}`,
    };
  }
  if (what === 'spike-first') {
    return {
      prompt: `[Shellby: Before deciding on "${decision.title}", the user wants you to try it first.${theirs(said)}\nCall mcp__shellby__spike with what to find out and how, then end your turn.]`,
      shown: `Spike it first${said ? `: ${line(said, 160)}` : ''}`,
    };
  }
  const picked = what === 'pick' ? option : decision.choice;
  const chosen = decision.options[picked];
  if (!chosen) return { error: 'That option is gone. Look at the card again.' };
  const instead = picked !== decision.choice ? ` They chose "${chosen.name}" rather than your pick, "${decision.options[decision.choice].name}".` : '';
  return {
    prompt: `[Shellby: The user approved the decision "${decision.title}".${instead}${theirs(said)}\nFile changes are unblocked for this work.\n${buildSteps(decision, keepRecords)}\nThen do the work, run the test plan, and finish with mcp__shellby__check_decision.]`,
    shown: picked !== decision.choice ? `Go with "${chosen.name}"${said ? `: ${line(said, 160)}` : ''}` : `Approved: ${decision.title}${said ? `: ${line(said, 160)}` : ''}`,
    picked,
  };
}

/** Your answer to an amendment. what: 'yes' | 'no'. -> { prompt, shown } */
function amendPrompt(decision, amendment, { what, note = '' }) {
  const said = noteOf(note);
  if (what === 'yes') {
    return {
      prompt: `[Shellby: The user approved adding ${list(amendment.add)} to the scope of "${decision.title}".${theirs(said)}\nCarry on with the work.]`,
      shown: `Scope widened: ${list(amendment.add, 3)}`,
    };
  }
  return {
    prompt: `[Shellby: The user turned down adding ${list(amendment.add)} to the scope of "${decision.title}".${theirs(said)}\nKeep to the scope (${list(decision.scope)}). If the work can't be done within it, say so and call mcp__shellby__decide with a new decision.]`,
    shown: `Kept to the scope${said ? `: ${line(said, 160)}` : ''}`,
  };
}

/** Your answer to a spike. what: 'yes' | 'no'. -> { prompt, shown } */
function spikePrompt(spike, { what, note = '' }) {
  const said = noteOf(note);
  if (what === 'yes') {
    return {
      prompt: `[Shellby: The user allowed the spike "${spike.question}".${theirs(said)}\nTry it: every file change is put back when you call mcp__shellby__end_spike. No commits, pushes, publishing or requests that change things elsewhere. When you know, call end_spike with what you found, then mcp__shellby__decide.]`,
      shown: `Try it: ${spike.question}`,
    };
  }
  return {
    prompt: `[Shellby: The user said no to the spike "${spike.question}".${theirs(said)}\nDecide without it: call mcp__shellby__decide.]`,
    shown: `No spike${said ? `: ${line(said, 160)}` : ''}`,
  };
}

module.exports = { turnNote, withNote, answerPrompt, amendPrompt, spikePrompt };
