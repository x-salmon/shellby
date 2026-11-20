/* Shellby panel — Engineer mode (src/main/wiring/engineer.js, docs/ENGINEER.md).
 *
 * The chip under the box turns it on for one conversation: Claude decides
 * before it builds. Its decision arrives as a card: the goal, what constrains
 * it, the options it weighed with their trade-offs, its pick and why, the test
 * plan and the risks. Approve it, go with another option, or send it back with
 * a note; nothing changes a file until you approve one. When the work is done,
 * the same card says how it went against what was decided.
 *
 * The card is a transcript item, moved to the end of the conversation at each
 * step (debug mode's way). Every message to Claude goes from a button here. */
'use strict';
(function () {
  const { h, api, $ } = SB;

  const PILL = { proposed: 'waiting for you', approved: 'approved', returned: 'sent back', checked: 'done', closed: 'closed' };
  const RESULT = { passed: '✓ passed', failed: '✗ failed', skipped: '– skipped' };
  const cards = tab => [...tab.el.querySelectorAll('.eng-card')];

  // ------------------------------------------------------------ the chip

  SB.renderEngineerChip = tab => {
    const on = !!tab?.engineer;
    $('engChip').classList.toggle('on', on);
    $('engChip').setAttribute('aria-pressed', String(on));
    $('engNote').hidden = !on;
  };

  $('engChip').addEventListener('click', async () => {
    const tab = SB.activeTab();
    if (!tab) return;
    const on = !tab.engineer;
    const r = await api.engineer.set(tab.id, on).catch(() => null);
    if (!r?.ok) { SB.toast(r?.error || "Couldn't change Engineer mode.", { ms: 7000 }); return; }
    tab.engineer = on; // until the next summary says so too
    SB.renderEngineerChip(tab);
    $('input').focus();
  });

  // ------------------------------------------------------------ the card

  async function answer(tab, v, what, button, option) {
    const card = button.closest('.eng-card');
    const note = card?.querySelector('.eng-note-input')?.value.trim() || '';
    if (what === 'return' && !note) {
      SB.toast('Say what should change in the note, then send it back.');
      card?.querySelector('.eng-note-input')?.focus();
      return;
    }
    const buttons = card ? [...card.querySelectorAll('.eng-actions button, .eng-pick')] : [button];
    for (const b of buttons) b.disabled = true;
    const r = await api.engineer.act(tab.id, v.id, { what, ...(Number.isInteger(option) ? { option } : {}), ...(note ? { note } : {}) }).catch(() => null);
    if (!r?.ok) {
      for (const b of buttons) b.disabled = false;
      SB.toast(r?.error || "Couldn't send that to Claude.");
    }
  }

  const list = (cls, title, rows) => (rows?.length
    ? h('div', { class: `eng-block ${cls}` }, h('h4', { class: 'eng-label', text: title }), h('ul', { class: 'eng-list' }, rows.map(t => h('li', { text: t }))))
    : null);

  function optionEl(tab, v, o, i, open) {
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
      open && !mine ? h('button', { type: 'button', class: 'btn ghost slim-btn eng-pick', onclick: e => answer(tab, v, 'pick', e.currentTarget, i) }, `Go with ${o.name} instead`) : null);
  }

  function outcomeEl(o) {
    if (!o) return null;
    return h('div', { class: `eng-outcome ${o.followed ? 'followed' : 'drifted'}` },
      h('h4', { class: 'eng-label', text: o.followed ? 'Built as decided' : 'Changed course' }),
      h('p', { class: 'eng-summary', text: o.summary }),
      o.deviations?.length ? h('ul', { class: 'eng-list eng-deviations' }, o.deviations.map(d => h('li', {}, h('b', { text: d.what }), d.why ? `: ${d.why}` : ''))) : null,
      o.tests?.length ? h('ul', { class: 'eng-tests' }, o.tests.map(t => h('li', { class: `eng-test ${t.result}` },
        h('span', { class: 'eng-result', text: RESULT[t.result] || t.result }), h('span', { text: t.check })))) : null,
      o.record ? h('p', { class: 'small muted' }, 'Written down in ', h('code', { text: o.record })) : null);
  }

  function cardEl(tab, v) {
    const open = v.phase === 'proposed';
    const choiceName = v.options[v.choice]?.name || '';
    const options = h('ol', { class: 'eng-options' }, v.options.map((o, i) => optionEl(tab, v, o, i, open)));
    // Once answered, the weighing folds away: what was decided, and how it went, stay in view.
    const weighed = open ? options : h('details', { class: 'eng-weighed' },
      h('summary', { text: `${v.options.length} option${v.options.length === 1 ? '' : 's'} weighed` }), options);
    return h('section', { class: `eng-card phase-${v.phase}`, dataset: { decision: v.id }, 'aria-label': `Decision: ${v.title}` },
      h('div', { class: 'eng-head' },
        h('span', { class: 'chg-icon', 'aria-hidden': 'true', text: '📐' }),
        h('span', { class: 'eng-title', text: `Decision: ${v.title}` }),
        h('span', { class: 'kind-pill eng-status', text: v.phase === 'checked' && !v.outcome?.followed ? 'changed course' : PILL[v.phase] || v.phase })),
      h('p', { class: 'eng-goal' }, h('b', { text: 'Goal ' }), v.goal),
      list('eng-constraints', 'What limits it', v.constraints),
      weighed,
      h('p', { class: 'eng-why' }, h('b', { text: `Why ${choiceName}: ` }), v.why),
      list('eng-plan', 'How we’ll know it works', v.testPlan),
      list('eng-risks', 'Risks', v.risks),
      v.note && !open ? h('p', { class: 'small eng-your-note' }, h('b', { text: 'Your note: ' }), v.note) : null,
      v.phase === 'returned' ? h('p', { class: 'small muted', text: 'Sent back. Claude is rethinking it, and a new card will follow.' }) : null,
      v.phase === 'approved' ? h('div', { class: 'eng-building' },
        h('p', { class: 'small muted', text: 'Claude is building it. This card says how it went when the work is done.' }),
        h('div', { class: 'eng-actions' }, h('button', { type: 'button', class: 'btn ghost slim-btn', title: 'Changes need a new decision from here on', onclick: e => answer(tab, v, 'close', e.currentTarget) }, 'Close this decision'))) : null,
      v.phase === 'closed' ? h('p', { class: 'small muted', text: 'Closed before the work was checked. The next change needs a new decision.' }) : null,
      outcomeEl(v.outcome),
      open ? h('div', { class: 'eng-answer' },
        h('textarea', { class: 'field eng-note-input', rows: 2, maxlength: 2000, placeholder: 'A note for Claude (needed to send it back)', 'aria-label': 'A note for Claude about this decision' }),
        h('div', { class: 'eng-actions' },
          h('button', { type: 'button', class: 'btn slim-btn', onclick: e => answer(tab, v, 'approve', e.currentTarget) }, `Approve ${choiceName}`),
          h('button', { type: 'button', class: 'btn ghost slim-btn', onclick: e => answer(tab, v, 'return', e.currentTarget) }, 'Send it back'))) : null);
  }

  // A newer card for the same decision goes to the end, where you'll see it.
  SB.renderEngineer = (tab, item) => {
    for (const was of cards(tab)) if (was.dataset.decision === item.id) was.remove();
    const el = cardEl(tab, item);
    tab.append(el);
    // Answered elsewhere since (a newer decision came in): only the latest one can be answered.
    for (const older of cards(tab)) if (older !== el) for (const b of older.querySelectorAll('.eng-actions button, .eng-pick')) b.disabled = true;
    return el;
  };
})();
