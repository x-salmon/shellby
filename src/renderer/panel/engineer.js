/* Shellby panel — Engineer mode (src/main/wiring/engineer.js, docs/ENGINEER.md).
 *
 * The chip under the box turns it on for one conversation: Claude decides
 * before it builds. Its decision arrives as a card (engineer-card.js): approve
 * it, go with another option, send it back with a note, ask a critic, or have
 * Claude try it first. Nothing changes a file until you approve one, and then
 * only the files it named; asking for more shows on the same card. A spike
 * has its own card. When the work is done, the decision card says how it went:
 * Claude's word, the files the diff touched, and Shellby's own run of the plan.
 *
 * With the chip on, the note above the box has the project's settings: on for
 * every new conversation there, and the commands Claude may run before a
 * decision. Cards are transcript items, moved to the end of the conversation
 * at each step (debug mode's way). Every message to Claude goes from a button here. */
'use strict';
(function () {
  const { api, $ } = SB;

  const cards = tab => [...tab.el.querySelectorAll('.eng-card')];
  const MAX_ALLOW = 12;

  // ------------------------------------------------------------ the chip and its note

  let shownFor = null; // the tab the project's settings were last read for

  async function loadProject(tab) {
    shownFor = tab.id;
    const r = await api.engineer.project(tab.id).catch(() => null);
    if (shownFor !== tab.id) return; // switched tabs meanwhile
    $('engProject').hidden = !r?.ok;
    if (!r?.ok) { $('engAllow').hidden = true; return; }
    $('engProjectName').textContent = r.name;
    $('engProjectOn').checked = !!r.on;
    $('engAllowInput').value = (r.allow || []).join('\n');
    $('engAllowChecks').textContent = r.checks?.length
      ? `The project's own checks are allowed already: ${r.checks.join(', ')}.`
      : 'Shellby found no checks of its own to allow here.';
  }

  SB.renderEngineerChip = tab => {
    const on = !!tab?.engineer;
    $('engChip').classList.toggle('on', on);
    $('engChip').setAttribute('aria-pressed', String(on));
    $('engNote').hidden = !on;
    if (on && shownFor !== tab.id) loadProject(tab);
    if (!on) { shownFor = null; $('engAllow').hidden = true; $('engAllowBtn').setAttribute('aria-expanded', 'false'); }
  };

  $('engChip').addEventListener('click', async () => {
    const tab = SB.activeTab();
    if (!tab) return;
    const on = !tab.engineer;
    const r = await api.engineer.set(tab.id, on).catch(() => null);
    if (!r?.ok) { SB.toast(r?.error || "Couldn't change Engineer mode.", { ms: 7000 }); return; }
    tab.engineer = on; // until the next summary says so too
    shownFor = null;
    SB.renderEngineerChip(tab);
    $('input').focus();
  });

  $('engProjectOn').addEventListener('change', async e => {
    const tab = SB.activeTab();
    if (!tab) return;
    const r = await api.engineer.setProject(tab.id, { on: e.target.checked }).catch(() => null);
    if (!r?.ok) { e.target.checked = !e.target.checked; SB.toast(r?.error || "Couldn't save that for the project."); return; }
    SB.toast(r.on ? `New conversations in ${r.name} start with Engineer mode on.` : `New conversations in ${r.name} start with it off.`);
  });

  $('engAllowBtn').addEventListener('click', () => {
    const open = $('engAllow').hidden;
    $('engAllow').hidden = !open;
    $('engAllowBtn').setAttribute('aria-expanded', String(open));
    if (open) $('engAllowInput').focus();
  });

  $('engAllowSave').addEventListener('click', async () => {
    const tab = SB.activeTab();
    if (!tab) return;
    const allow = $('engAllowInput').value.split('\n').map(l => l.trim()).filter(Boolean);
    if (allow.length > MAX_ALLOW) { SB.toast(`At most ${MAX_ALLOW} commands.`); return; }
    if (allow.some(c => c.length > 200)) { SB.toast('Keep each command under 200 characters.'); return; }
    const r = await api.engineer.setProject(tab.id, { allow }).catch(() => null);
    if (!r?.ok) { SB.toast(r?.error || "Couldn't save the commands."); return; }
    $('engAllowInput').value = r.allow.join('\n');
    $('engAllowSaved').textContent = r.allow.length ? `Saved. From the next message, Claude may run ${r.allow.length === 1 ? 'it' : 'them'} before deciding.` : 'Saved: none beyond the checks.';
  });

  // ------------------------------------------------------------ answering a card

  /** Sends what a button says; the card's buttons wait until it's answered. */
  async function send(tab, id, what, button, extra = {}) {
    const card = button.closest('.eng-card');
    const note = card?.querySelector('.eng-note-input')?.value.trim() || '';
    if (what === 'return' && !note) {
      SB.toast('Say what should change in the note, then send it back.');
      card?.querySelector('.eng-note-input')?.focus();
      return;
    }
    const buttons = card ? [...card.querySelectorAll('.eng-actions button, .eng-pick')] : [button];
    for (const b of buttons) b.disabled = true;
    const r = await api.engineer.act(tab.id, id, { what, ...extra, ...(note ? { note } : {}) }).catch(() => null);
    if (!r?.ok) {
      for (const b of buttons) b.disabled = false;
      SB.toast(r?.error || "Couldn't send that to Claude.");
    }
  }

  // Only the newest card of each kind can be answered: an older one was answered elsewhere since.
  function settle(tab, el, attr) {
    for (const older of cards(tab)) {
      if (older === el || !older.dataset[attr]) continue;
      for (const b of older.querySelectorAll('.eng-actions button, .eng-pick')) b.disabled = true;
    }
  }

  // A newer card for the same decision goes to the end, where you'll see it.
  // A decision's card, or a spike's (kind 'engineer-spike').
  SB.renderEngineer = (tab, item) => {
    if (item.kind === 'engineer-spike') return renderSpike(tab, item);
    for (const was of cards(tab)) if (was.dataset.decision === item.id) was.remove();
    const el = SB.engineerCard.decisionEl(item, {
      answer: (what, button, option) => send(tab, item.id, what, button, Number.isInteger(option) ? { option } : {}),
      amend: (id, what, button) => send(tab, id, what, button),
    });
    tab.append(el);
    settle(tab, el, 'decision');
    return el;
  };

  function renderSpike(tab, item) {
    for (const was of cards(tab)) if (was.dataset.spike === item.id) was.remove();
    const el = SB.engineerCard.spikeEl(item, { spike: (what, button) => send(tab, item.id, what, button) });
    tab.append(el);
    settle(tab, el, 'spike');
    return el;
  }
})();
