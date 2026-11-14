/* Switcher: 1–6 pick a mockup, N toggles the notes. The choice lives in the
   URL hash so a reload (or a link) lands on the same one. */
'use strict';

const TODAY_PAGE = [
  'At 2560px wide the page is still the 460px panel stretched: 3 projects take 3 thin rows and the audit list fills the rest.',
  'Two lists that disagree: 3 projects, but 19 audited. "Documents" is audited as if it were a project.',
  'Nothing says what to do first. "1 needs you" doesn\'t say which one, or why.',
  'Row actions only appear on hover, about 1,900px from the project\'s name.',
  'The inbox line "main, 3d-rack · merged" puts the branch where the project name should be.',
  '"Couldn\'t read the result" ends there, with no reason and no fix.',
];

const VIEWS = [
  { key: 'triage', title: 'Triage lanes', render: viewTriage,
    pitch: 'Every problem in every project, sorted into four lanes by how much it matters. Each card names the problem and carries the button that fixes it.',
    fixes: 'Answers "what do I do first?" without opening anything. The audit list is gone: a vulnerable package is just a card in Broken.',
    best: 'Starting the day, or after a week away.',
    cost: 'Projects with nothing wrong shrink to a short Calm column, so it\'s a poor launcher.' },
  { key: 'cockpit', title: 'Three-pane cockpit', render: viewCockpit,
    pitch: 'The list on the left, the whole project page in the middle, and what\'s waiting in every other project on the right. J and K walk the list; the middle updates without a page change.',
    fixes: 'Uses the width a 4K screen has. Today\'s two-step (list, then project page, then back) becomes zero steps.',
    best: 'Living in one project while keeping an eye on the rest.',
    cost: 'Needs about 1,800px. Below that the right column folds under the page.' },
  { key: 'ledger', title: 'Ledger', render: viewLedger,
    pitch: 'One row per project, one column per thing Shellby knows. Sort by any column, filter with the chips, tick rows and act on them together. A row opens in place.',
    fixes: 'Folds the 19-row dependency list into a column, so there\'s one list. Bulk actions turn "Check again" × 19 into one press.',
    best: 'Anyone with 10+ repos who thinks in spreadsheets.',
    cost: 'Dense. The least crab-like of the six; leans on colour for trouble, so the chip text has to carry it too.' },
  { key: 'tide', title: 'Tide chart', render: viewTide,
    pitch: 'Four weeks of hours as a heat strip per project, with this week\'s split on top. Builds and servers sit on the strip where they happened. Quiet projects drift to the bottom with Archive and Nudge me.',
    fixes: 'Shows what the list can\'t: where your time goes, and what\'s quietly going stale. Gives the History → Time data a home.',
    best: 'The Monday look-back, and deciding what to drop.',
    cost: 'Not a to-do list. Pair it with Triage, or make it a tab.' },
  { key: 'today', title: 'Today', render: viewToday,
    pitch: 'One big answer: the project you were in, what you were doing, and Resume. Under it, the three things most worth your time elsewhere, then everything else as small tiles.',
    fixes: 'Opening Projects usually means "get back to work". This makes that one click, and Shellby gets to speak.',
    best: 'Single-focus days. Feels the most like Shellby.',
    cost: 'Picks for you. If the pick is wrong, the list is a scroll away.' },
  { key: 'command', title: 'Command first', render: viewCommand,
    pitch: 'The page is a search box. Type a few letters, and the match shows its actions with a letter each; a preview on the right shows its server log, CI and branch.',
    fixes: 'Mouse travel on a 4K screen. Every action from every row menu is two keys away, and hover-only buttons go.',
    best: 'Keyboard people. Ctrl K opens it from any screen, so it doubles as a launcher.',
    cost: 'Hides what you didn\'t search for. The facets on the left are the only overview.' },
];

const tabs = document.getElementById('tabs');
const stage = document.getElementById('stage');
const notes = document.getElementById('notes');
const notesBtn = document.getElementById('notesBtn');
document.getElementById('railCrab').innerHTML = crab(4);

function renderNotes(v, i) {
  notes.innerHTML = `
    <p class="n-num">${i + 1} of ${VIEWS.length}</p>
    <h2>${esc(v.title)}</h2>
    <p>${esc(v.pitch)}</p>
    <dl><dt>Fixes</dt><dd>${esc(v.fixes)}</dd><dt>Best for</dt><dd>${esc(v.best)}</dd><dt>Costs</dt><dd>${esc(v.cost)}</dd></dl>
    <details><summary>What today's page gets wrong</summary><ul>${TODAY_PAGE.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></details>`;
}

function show(i) {
  const v = VIEWS[i];
  stage.innerHTML = v.render();
  stage.scrollTop = 0;
  renderNotes(v, i);
  [...tabs.children].forEach((t, j) => t.setAttribute('aria-selected', String(j === i)));
  history.replaceState(null, '', `#${v.key}`);
}

tabs.innerHTML = VIEWS.map((v, i) => `<button role="tab" aria-selected="false"><kbd>${i + 1}</kbd> ${esc(v.title)}</button>`).join('');
[...tabs.children].forEach((t, i) => t.addEventListener('click', () => show(i)));

function toggleNotes() {
  notes.hidden = !notes.hidden;
  notesBtn.setAttribute('aria-pressed', String(!notes.hidden));
}
notesBtn.addEventListener('click', toggleNotes);

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
  const n = Number(e.key);
  if (n >= 1 && n <= VIEWS.length) show(n - 1);
  else if (e.key.toLowerCase() === 'n') toggleNotes();
});

const start = VIEWS.findIndex((v) => `#${v.key}` === location.hash);
show(start < 0 ? 0 : start);
