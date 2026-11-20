/* Shellby panel — Engineer mode's cards (engineer.js puts them in the feed and
 * answers their buttons; docs/ENGINEER.md says what each part means).
 *
 * The decision card: the goal, what limits it, what a spike found, a critic's
 * points, the options weighed, the pick and why, the scope, the steps, the
 * test plan (the commands Shellby runs itself marked), the risks, the records
 * it builds on, any amendment asking for more scope, and once the work is
 * done how it went: Claude's word, the files the diff really touched, and
 * Shellby's own run of the plan.
 *
 * The spike card: what Claude wants to find out and how, what it found, and
 * whether the files were put back.
 *
 * Everything Claude wrote goes in as text, never markup. */
'use strict';
(function () {
  const { h } = SB;

  const PILL = { proposed: 'waiting for you', approved: 'approved', returned: 'sent back', checked: 'done', closed: 'closed' };
  const RESULT = { passed: '✓ passed', failed: '✗ failed', skipped: '– skipped' };
  const RAN = { pass: '✓ passed', fail: '✗ failed', error: '! wouldn’t run', timeout: '⏱ timed out' };
  const LEVEL = { low: 'Low confidence', medium: 'Medium confidence', high: 'High confidence' };
  const UNDO = { easy: 'Easy to undo', moderate: 'Some work to undo', hard: 'Hard to undo' };
  const SPIKE_PILL = { asked: 'waiting for you', running: 'trying it', ending: 'putting it back', done: 'put back', refused: 'not tried', failed: 'not put back' };
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  const list = (cls, title, rows) => (rows?.length
    ? h('div', { class: `eng-block ${cls}` }, h('h4', { class: 'eng-label', text: title }), h('ul', { class: 'eng-list' }, rows.map(t => h('li', { text: t }))))
    : null);
  const paths = (cls, title, rows) => (rows?.length
    ? h('div', { class: `eng-block ${cls}` }, h('h4', { class: 'eng-label', text: title }), h('ul', { class: 'eng-paths' }, rows.map(p => h('li', {}, h('code', { text: p })))))
    : null);
  const btn = (label, onclick, { ghost = true, title = '', cls = '' } = {}) =>
    h('button', { type: 'button', class: `btn ${ghost ? 'ghost ' : ''}slim-btn ${cls}`.trim(), ...(title ? { title } : {}), onclick }, label);

  // ------------------------------------------------------------ the decision

  function optionEl(v, o, i, open, on) {
    const picked = Number.isInteger(v.picked) ? v.picked : null;
    const mine = i === v.choice;
    const tags = [
      mine ? h('span', { class: 'eng-tag claude', text: "Claude's pick" }) : null,
      picked === i && !mine ? h('span', { class: 'eng-tag yours', text: 'Your pick' }) : null,
      picked === i && mine ? h('span', { class: 'eng-tag yours', text: 'Approved' }) : null,
    ];
    return h('li', { class: `eng-option${(picked ?? v.choice) === i ? ' chosen' : ''}` },
      h('div', { class: 'eng-option-head' }, h('span', { class: 'eng-option-name', text: o.name }), ...tags),
      o.summary ? h('p', { class: 'eng-option-summary', text: o.summary }) : null,
      o.pros.length || o.cons.length ? h('ul', { class: 'eng-tradeoffs' },
        o.pros.map(p => h('li', { class: 'pro' }, h('span', { 'aria-label': 'Pro', text: '+' }), ` ${p}`)),
        o.cons.map(c => h('li', { class: 'con' }, h('span', { 'aria-label': 'Con', text: '−' }), ` ${c}`))) : null,
      open && !mine ? btn(`Go with ${o.name} instead`, e => on.answer('pick', e.currentTarget, i), { cls: 'eng-pick' }) : null);
  }

  function tagsEl(v) {
    const tags = [
      v.confidence ? h('span', { class: `eng-tag level-${v.confidence}`, text: LEVEL[v.confidence] }) : null,
      v.reversibility ? h('span', { class: `eng-tag undo-${v.reversibility}`, text: UNDO[v.reversibility] }) : null,
    ].filter(Boolean);
    return tags.length ? h('div', { class: 'eng-tags' }, tags) : null;
  }

  function planEl(v) {
    if (!v.testPlan?.length) return null;
    return h('div', { class: 'eng-block eng-plan' },
      h('h4', { class: 'eng-label', text: 'How we’ll know it works' }),
      h('ul', { class: 'eng-list' }, v.testPlan.map(t => {
        const item = typeof t === 'string' ? { check: t } : t;
        return h('li', {}, item.check, item.command
          ? h('span', { class: 'eng-runs', title: 'Shellby runs this itself once the work is done' }, ' · Shellby runs ', h('code', { text: item.command }))
          : null);
      })));
  }

  function stepsEl(v) {
    if (!v.steps?.length) return null;
    const done = new Map((v.progress || []).map(p => [p.step, p]));
    return h('div', { class: 'eng-block eng-steps' },
      h('h4', { class: 'eng-label', text: `Steps${done.size ? ` · ${done.size} of ${v.steps.length} done` : ''}` }),
      h('ol', { class: 'eng-step-list' }, v.steps.map((s, i) => {
        const p = done.get(i + 1);
        return h('li', { class: `eng-step${p ? (p.followed ? ' done' : ' drifted') : ''}` },
          h('span', { class: 'eng-step-mark', 'aria-hidden': 'true', text: p ? (p.followed ? '✓' : '↷') : '·' }),
          h('span', {}, s, p ? h('span', { class: 'eng-step-note', text: ` — ${p.summary}` }) : null));
      })));
  }

  function recordsEl(v) {
    if (!v.related?.length && !v.supersedes) return null;
    return h('div', { class: 'eng-block eng-records' },
      h('h4', { class: 'eng-label', text: 'Earlier decisions' }),
      v.supersedes ? h('p', { class: 'eng-supersedes' }, 'Replaces ', h('code', { text: v.supersedes })) : null,
      v.related?.length ? h('ul', { class: 'eng-paths' }, v.related.map(r => h('li', {}, 'Builds on ', h('code', { text: r })))) : null);
  }

  function spikeFoundEl(s) {
    if (!s) return null;
    return h('div', { class: 'eng-block eng-found' },
      h('h4', { class: 'eng-label', text: `What the spike found · ${s.question}` }),
      s.answer ? h('p', { class: 'eng-summary', text: s.answer }) : null,
      h('p', { class: 'eng-found-text', text: s.findings }));
  }

  function amendmentsEl(v, on) {
    if (!v.amendments?.length) return null;
    return h('div', { class: 'eng-block eng-amendments' },
      h('h4', { class: 'eng-label', text: 'Asked for more scope' }),
      h('ul', { class: 'eng-amend-list' }, v.amendments.map(m => {
        const open = m.phase === 'proposed' && v.phase === 'approved';
        return h('li', { class: `eng-amend ${m.phase}` },
          h('div', {}, m.add.map(p => h('code', { text: p })), h('span', { class: 'eng-amend-state', text: open ? ' waiting for you' : m.phase === 'approved' ? ' added' : ' turned down' })),
          h('p', { class: 'eng-amend-why', text: m.why }),
          open ? h('div', { class: 'eng-actions' },
            btn(`Allow ${m.add.length === 1 ? 'it' : 'them'}`, e => on.amend(m.id, 'amend-yes', e.currentTarget), { ghost: false }),
            btn('Keep to the scope', e => on.amend(m.id, 'amend-no', e.currentTarget))) : null);
      })));
  }

  function auditEl(v) {
    const a = v.audit;
    if (!a) return v.outcome && v.phase === 'checked' ? h('p', { class: 'small muted eng-audit', text: 'Comparing with the files the work changed…' }) : null;
    if (!a.files) return h('p', { class: 'small muted eng-audit', text: 'The diff shows no file changes for this decision.' });
    if (!a.unplanned.length) return h('p', { class: 'small eng-audit ok' }, h('b', { text: '✓ ' }), `All ${plural(a.files, 'file')} the work changed are inside the scope.`);
    return h('div', { class: 'eng-audit drift' },
      h('p', { class: 'small' }, h('b', { text: `${plural(a.unplanned.length, 'file')} changed outside the scope ` }), `(of ${plural(a.files, 'file')} in all):`),
      h('ul', { class: 'eng-paths' }, a.unplanned.slice(0, 12).map(p => h('li', {}, h('code', { text: p })))),
      a.unplanned.length > 12 ? h('p', { class: 'small muted', text: `and ${a.unplanned.length - 12} more` }) : null);
  }

  function verifyEl(v) {
    const r = v.verify;
    if (!r) return null;
    const head = h('h4', { class: 'eng-label', text: 'Shellby ran the test plan' });
    if (r.status === 'running') return h('div', { class: 'eng-verify' }, head, h('p', { class: 'small muted', text: 'Running the plan’s commands…' }));
    if (r.status !== 'done') {
      const why = { declined: 'You chose not to run this project’s tests, so only Claude’s word stands.', cancelled: 'Stopped before it finished: Claude started on something new.', none: 'Nothing to run here.', error: 'The commands couldn’t be run.' }[r.status];
      return h('div', { class: 'eng-verify' }, head, h('p', { class: 'small muted', text: why }));
    }
    return h('div', { class: 'eng-verify' }, head,
      h('ul', { class: 'eng-tests' }, r.results.map(x => h('li', { class: `eng-test ${x.status === 'pass' ? 'passed' : 'failed'}` },
        h('span', { class: 'eng-result', text: RAN[x.status] || x.status }), h('code', { text: x.cmd })))),
      r.results.filter(x => x.status !== 'pass' && x.tail).slice(0, 2).map(x => h('details', { class: 'eng-tail' },
        h('summary', { text: `What ${x.cmd} said` }), h('pre', { text: x.tail }))));
  }

  function outcomeEl(o, title) {
    if (!o) return null;
    return h('div', { class: `eng-outcome ${o.followed ? 'followed' : 'drifted'}` },
      h('h4', { class: 'eng-label', text: title || (o.followed ? 'Built as decided' : 'Changed course') }),
      h('p', { class: 'eng-summary', text: o.summary }),
      o.deviations?.length ? h('ul', { class: 'eng-list eng-deviations' }, o.deviations.map(d => h('li', {}, h('b', { text: d.what }), d.why ? `: ${d.why}` : ''))) : null,
      o.tests?.length ? h('ul', { class: 'eng-tests' }, o.tests.map(t => h('li', { class: `eng-test ${t.result}` },
        h('span', { class: 'eng-result', text: RESULT[t.result] || t.result }), h('span', { text: t.check })))) : null,
      o.record ? h('p', { class: 'small muted' }, 'Written down in ', h('code', { text: o.record })) : null);
  }

  function statusText(v) {
    if (v.phase === 'checked') return v.outcome?.followed && !v.audit?.unplanned?.length ? 'done' : 'changed course';
    if (v.phase === 'approved' && v.amendments?.some(m => m.phase === 'proposed')) return 'needs you';
    return PILL[v.phase] || v.phase;
  }

  function sentBackText(v) {
    if (v.asked === 'critic') return 'A critic is looking at it. Claude will send a new card with what it found.';
    if (v.asked === 'spike-first') return 'Claude will ask to try it out first.';
    return 'Sent back. Claude is rethinking it, and a new card will follow.';
  }

  /**
   * The decision card. on: { answer(what, button, option?), amend(id, what, button) }
   */
  function decisionEl(v, on) {
    const open = v.phase === 'proposed';
    const choiceName = v.options[v.choice]?.name || '';
    const options = h('ol', { class: 'eng-options' }, v.options.map((o, i) => optionEl(v, o, i, open, on)));
    // Once answered, the weighing folds away: what was decided, and how it went, stay in view.
    const weighed = open ? options : h('details', { class: 'eng-weighed' },
      h('summary', { text: `${plural(v.options.length, 'option')} weighed` }), options);
    const worthASpike = open && v.confidence === 'low' && v.reversibility === 'hard';
    const steps = v.steps?.length || 0;
    return h('section', { class: `eng-card phase-${v.phase}`, dataset: { decision: v.id }, 'aria-label': `Decision: ${v.title}` },
      h('div', { class: 'eng-head' },
        h('span', { class: 'chg-icon', 'aria-hidden': 'true', text: '📐' }),
        h('span', { class: 'eng-title', text: `Decision: ${v.title}` }),
        h('span', { class: 'kind-pill eng-status', text: statusText(v) })),
      tagsEl(v),
      h('p', { class: 'eng-goal' }, h('b', { text: 'Goal ' }), v.goal),
      list('eng-constraints', 'What limits it', v.constraints),
      spikeFoundEl(v.spike),
      list('eng-critique', 'What a critic said', v.critique),
      weighed,
      h('p', { class: 'eng-why' }, h('b', { text: `Why ${choiceName}: ` }), v.why),
      paths('eng-scope', 'Changes only', v.scope),
      stepsEl(v),
      planEl(v),
      list('eng-risks', 'Risks', v.risks),
      recordsEl(v),
      worthASpike ? h('p', { class: 'small eng-hint' }, h('b', { text: 'Low confidence, hard to undo. ' }), 'Trying it first may be worth it.') : null,
      v.note && !open ? h('p', { class: 'small eng-your-note' }, h('b', { text: 'Your note: ' }), v.note) : null,
      v.phase === 'returned' ? h('p', { class: 'small muted', text: sentBackText(v) }) : null,
      amendmentsEl(v, on),
      v.phase === 'approved' ? h('div', { class: 'eng-building' },
        h('p', { class: 'small muted', text: steps ? 'Claude is building it, step by step. Each step shows here as it’s done.' : 'Claude is building it. This card says how it went when the work is done.' }),
        h('div', { class: 'eng-actions' }, btn('Close this decision', e => on.answer('close', e.currentTarget), { title: 'Changes need a new decision from here on' }))) : null,
      v.phase === 'closed' ? h('p', { class: 'small muted', text: 'Closed before the work was checked. The next change needs a new decision.' }) : null,
      outcomeEl(v.outcome),
      auditEl(v),
      verifyEl(v),
      open ? h('div', { class: 'eng-answer' },
        h('textarea', { class: 'field eng-note-input', rows: 2, maxlength: 2000, placeholder: 'A note for Claude (needed to send it back)', 'aria-label': 'A note for Claude about this decision' }),
        h('div', { class: 'eng-actions' },
          btn(`Approve ${choiceName}`, e => on.answer('approve', e.currentTarget), { ghost: false }),
          btn('Send it back', e => on.answer('return', e.currentTarget)),
          btn('Ask a critic', e => on.answer('critic', e.currentTarget), { title: 'A helper argues against Claude’s pick before you decide. Uses some of your plan.' }),
          btn('Spike it first', e => on.answer('spike-first', e.currentTarget), { title: 'Claude tries it out first; every change is put back after', cls: worthASpike ? 'eng-suggested' : '' }))) : null);
  }

  // ------------------------------------------------------------ the spike

  function restoredText(s) {
    const r = s.restored;
    if (!r) return null;
    if (r.ok) return h('p', { class: 'small eng-audit ok' }, h('b', { text: '✓ ' }), r.files ? `Put back: ${plural(r.files, 'file')} as they were before the spike.` : 'The spike changed no files.');
    return h('p', { class: 'small eng-audit drift' }, h('b', { text: 'Not all put back. ' }), r.error || '', ' Use Undo on the spike’s turns, or Rewind.');
  }

  /** The spike card. on: { spike(what, button) } */
  function spikeEl(s, on) {
    return h('section', { class: `eng-card eng-spike phase-${s.phase}`, dataset: { spike: s.id }, 'aria-label': `Spike: ${s.question}` },
      h('div', { class: 'eng-head' },
        h('span', { class: 'chg-icon', 'aria-hidden': 'true', text: '🧪' }),
        h('span', { class: 'eng-title', text: `Spike: ${s.question}` }),
        h('span', { class: 'kind-pill eng-status', text: SPIKE_PILL[s.phase] || s.phase })),
      h('p', { class: 'eng-goal' }, h('b', { text: 'Plan ' }), s.plan),
      s.phase === 'asked' ? h('p', { class: 'small muted', text: 'Claude may change any file in the project while it tries this, and every file it changes there is put back when it’s done. Commits, pushes and publishing are held back, but code it runs can still reach beyond the project, so your permission mode still applies.' }) : null,
      s.findings ? h('div', { class: 'eng-outcome followed' },
        h('h4', { class: 'eng-label', text: 'What it found' }),
        s.answer ? h('p', { class: 'eng-summary', text: s.answer }) : null,
        h('p', { class: 'eng-found-text', text: s.findings })) : null,
      restoredText(s),
      s.note ? h('p', { class: 'small eng-your-note' }, h('b', { text: 'Note: ' }), s.note) : null,
      s.phase === 'asked' ? h('div', { class: 'eng-answer' },
        h('textarea', { class: 'field eng-note-input', rows: 1, maxlength: 2000, placeholder: 'A note for Claude (optional)', 'aria-label': 'A note for Claude about this spike' }),
        h('div', { class: 'eng-actions' },
          btn('Let it try', e => on.spike('spike-yes', e.currentTarget), { ghost: false }),
          btn('Decide without it', e => on.spike('spike-no', e.currentTarget)))) : null,
      s.phase === 'running' ? h('div', { class: 'eng-actions' },
        btn('Stop and put it back', e => on.spike('spike-stop', e.currentTarget), { title: 'Ends the spike now and puts every file it changed back' })) : null);
  }

  SB.engineerCard = { decisionEl, spikeEl };
})();
