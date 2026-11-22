/* Shellby panel — onboarding: the first-run screens. */
'use strict';
(function () {
  const { h, api, state, $ } = SB;

  // ------------------------------------------------------------ onboarding

  SB.needsOnboarding = () => {
    const s = state.status || {};
    if (!state.settings.onboarded) return true;
    // Claude Code only on another computer: this PC never needs it (the remote path below).
    return !state.settings.crabOnly && !state.settings.claudeElsewhere && (!s.installed || !s.loggedIn);
  };

  // The remote path lends Settings' Other computers section to this screen,
  // and gives it back on the way out (core.js setView calls leave).
  /** @type {Comment | null} */
  let lentFrom = null;
  function lendRemote(on) {
    const group = $('remoteGroup');
    if (on && !lentFrom) {
      lentFrom = document.createComment('remoteGroup');
      group.before(lentFrom);
      $('onboardRemote').append(group);
      SB.remoteRefresh?.();
    } else if (!on && lentFrom) {
      lentFrom.replaceWith(group);
      lentFrom = null;
    }
  }

  // Where the remote path stands, and whether Let's go can go.
  function renderRemote() {
    const L = window.ShellbyRemoteLogic;
    const computers = SB.remoteNow?.()?.computers || [];
    const anchor = L.readyFolder(computers);
    const place = anchor ? computers.flatMap(c => c.folders).find(f => f.anchor === anchor)?.label : null;
    $('onboardRemoteHint').textContent = place
      ? `Ready. Conversations start in ${place}.`
      : computers.some(L.ready)
        ? 'Claude Code is signed in there. Now add a folder there to work in.'
        : 'Add the computer you ssh to. Shellby walks you through the rest: signing in, then Claude Code installed and signed in over there.';
    $('letsGoBtn').disabled = !anchor;
  }
  SB.remoteChanged = () => { if (state.view === 'onboarding' && SB.onboardPath === 'remote') renderRemote(); };

  // Signing in with an API key instead of a Claude plan: the same sealed key and
  // the same confirm window as Settings → Claude → Use my API key instead.
  let keyOpen = false;
  const keyInput = h('input', { type: 'password', class: 'field slim', id: 'onboardKeyInput', placeholder: 'sk-ant-…', 'aria-label': 'Anthropic API key', spellcheck: 'false', autocomplete: 'off', maxlength: '300' });
  const keySave = h('button', { type: 'submit', class: 'btn primary slim-btn' }, 'Use this key');
  const keyForm = h('form', { class: 'api-key-row', id: 'onboardKeyForm', autocomplete: 'off', onsubmit: saveKey }, keyInput, keySave);
  function toggleKeyForm() {
    keyOpen = !keyOpen;
    renderOnboarding();
    (keyOpen ? keyInput : $('onboardKeyBtn')).focus();
  }
  async function saveKey(e) {
    e.preventDefault();
    const value = keyInput.value;
    if (!value.trim()) return;
    keyInput.value = ''; // it goes to main once, to be sealed, and nothing hands it back
    keySave.disabled = true;
    try {
      // Billing is asked about first: saying no leaves a key saved earlier as it was.
      const { apiKeyBilling: wasOn, planOnly: wasPlanOnly } = state.settings;
      state.settings = (await api.setSettings({ apiKeyBilling: true })).settings;
      if (!state.settings.apiKeyBilling) return SB.toast('Nothing saved. You can still sign in with your Claude account.');
      let r;
      try { r = await api.saveApiKey(value); } catch { r = { ok: false }; }
      if (!r.ok) {
        // Choosing the key turned "Always use my Claude plan" off (ipc/settings.js): back to whichever it was.
        if (!wasOn) state.settings = (await api.setSettings(wasPlanOnly ? { planOnly: true } : { apiKeyBilling: false })).settings;
        return SB.toast(r.error || "Couldn't save the key.", { ms: 6000 });
      }
      state.apiKey = r.key;
      state.status = await api.claudeStatus();
      keyOpen = false;
      renderOnboarding();
      SB.toast('Conversations will bill your API key. Settings → Claude changes it.', { ms: 5000 });
    } catch {
      SB.toast('Something went wrong. Settings → Claude shows what Shellby will bill.', { ms: 6000 });
    } finally { keySave.disabled = false; }
  }
  const signedInAs = s => (s.apiKeyBilling && s.authMethod === 'api_key'
    ? 'Your API key, billed per token'
    : `${s.email || 'Signed in'} · ${s.subscriptionType ? s.subscriptionType.toUpperCase() + ' plan' : 'claude.ai'}`);

  function renderOnboarding() {
    const s = state.status || {};
    // Four paths: the Claude Code setup steps with a lively crab or Work mode's
    // quiet one (workmode.js), Claude Code over ssh, or just the crab (no account).
    // Claude Code already here: Work mode says it's made for you, but stays a choice.
    $('workPathTag').hidden = !s.installed;
    const path = SB.onboardPath || null;
    $('onboardPaths').querySelectorAll('.path').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.path === path)));
    $('claudeSetup').hidden = !['claude', 'work', 'remote'].includes(path);
    const remote = path === 'remote';
    $('steps').hidden = remote;
    $('onboardRemote').hidden = !remote;
    lendRemote(remote);
    const step = (n, done, title, sub, actions) => h('li', { class: `step ${done ? 'done' : 'todo'}` },
      h('span', { class: 'step-badge', text: done ? '✓' : n }),
      h('div', {}, h('div', { class: 'step-title', text: title }), sub ? h('div', { class: 'step-sub' }, sub) : null, !done && actions ? h('div', { class: 'row' }, actions) : null));
    const recheck = () => h('button', { class: 'btn ghost', type: 'button', onclick: recheckStatus }, 'Check again');
    const installed = !!s.installed;
    const signedIn = installed && s.loggedIn;
    $('steps').replaceChildren(
      step(1, installed, 'Install Claude Code',
        installed
          ? `Found v${s.version || '?'}${s.picked ? ' where you pointed' : ''}`
          : installing
            ? 'Installing with Anthropic’s own installer. This takes a minute or two…'
            : 'Not on this PC yet. Shellby can run Anthropic’s official installer for you, no terminal needed.',
        [h('button', { class: 'btn primary', type: 'button', disabled: installing, onclick: installClaude }, installing ? 'Installing…' : 'Install it for me'),
         h('button', { class: 'btn ghost', type: 'button', onclick: () => api.openExternal('https://docs.claude.com/en/docs/claude-code/setup') }, 'Install guide'),
         recheck(),
         // Already installed somewhere Shellby can't guess (portable copy,
         // another drive, a locked-down company image)? Point at it.
         h('button', { class: 'btn ghost', type: 'button', title: 'If it is already installed somewhere unusual', onclick: locateClaude }, 'Find it myself…')]),
      step(2, signedIn && !s.warning, 'Sign in to Claude Code',
        signedIn
          ? (s.warning ? h('span', { class: 'warn', text: s.warning }) : signedInAs(s))
          : 'With your Claude account, in the browser, or with an Anthropic API key, which is billed per token. Shellby never sees your Claude sign-in.',
        installed ? [h('button', { class: 'btn primary', type: 'button', onclick: async () => { await api.claudeLogin(); SB.toast('Finish signing in in the window that opened. Shellby notices when you’re done.', { ms: 6000 }); } }, 'Sign in'),
          h('button', { class: 'btn ghost', type: 'button', id: 'onboardKeyBtn', 'aria-expanded': String(keyOpen), 'aria-controls': 'onboardKeyForm', onclick: toggleKeyForm }, 'Use an API key'),
          recheck()] : null),
    );
    // Kept from one render to the next (a status check mustn't empty it), under its step.
    keyForm.hidden = !keyOpen || !installed || (signedIn && !s.warning);
    $('steps').lastElementChild.lastElementChild.append(keyForm);
    SB.renderModeCards($('onboardModeCards'), pickMode);
    if (remote) renderRemote();
    else $('letsGoBtn').disabled = !(installed && signedIn);
  }
  // Autonomous asks once, right here, as it does in Settings.
  async function pickMode(mode) {
    const confirm = mode === 'autonomous' && !state.settings.autonomousAcknowledged;
    $('onboardAutonomousConfirm').hidden = !confirm;
    if (confirm) return $('onboardAutonomousConfirm').scrollIntoView({ behavior: 'smooth', block: 'center' });
    const r = await api.setSettings({ mode });
    state.settings = r.settings;
    SB.applyMode(state.settings.mode);
    SB.renderModeCards($('onboardModeCards'), pickMode);
  }
  $('onboardAutonomousYes').addEventListener('click', async () => {
    const r = await api.setSettings({ autonomousAcknowledged: true, mode: 'autonomous' });
    state.settings = r.settings;
    SB.applyMode(state.settings.mode);
    $('onboardAutonomousConfirm').hidden = true;
    SB.renderModeCards($('onboardModeCards'), pickMode);
  });
  $('onboardAutonomousNo').addEventListener('click', () => { $('onboardAutonomousConfirm').hidden = true; });
  async function recheckStatus() {
    state.status = await api.claudeStatus();
    renderOnboarding();
    SB.toast(state.status.loggedIn ? 'All set!' : state.status.installed ? 'Not signed in yet.' : 'Claude Code not found yet.');
  }
  // No terminal: main runs Anthropic's installer hidden, then checks again.
  let installing = false;
  async function installClaude() {
    installing = true;
    renderOnboarding();
    let r;
    try { r = await api.installClaude(); } catch { r = { ok: false, error: 'The installer couldn’t start.' }; }
    installing = false;
    if (r.status) state.status = r.status;
    renderOnboarding();
    SB.toast(r.ok ? `Claude Code v${r.status?.version || '?'} is installed. Now sign in.` : r.error, { ms: r.ok ? 4000 : 8000 });
  }
  // The file picker runs the chosen program once to check it really is Claude
  // Code, so the answer to a wrong pick arrives immediately.
  async function locateClaude() {
    const r = await api.locateClaude();
    if (r.cancelled) return;
    if (r.status) state.status = r.status;
    renderOnboarding();
    SB.toast(r.ok ? `Found Claude Code v${r.status?.version || '?'}.` : r.error || "That isn't Claude Code.", { ms: r.ok ? 3000 : 6000 });
  }
  $('letsGoBtn').addEventListener('click', async () => {
    if (SB.onboardPath === 'work') return SB.chooseWorkMode();
    if (SB.onboardPath === 'remote') return chooseRemote();
    // firstTour: the first New task offers Show me around (feed.js), once.
    const r = await api.setSettings({ onboarded: true, firstTour: true, crabOnly: false, workMode: false });
    state.settings = r.settings;
    SB.onboardPath = null;
    SB.applyCrabOnly();
    SB.refreshEmptyStates();
    SB.setView('chat');
  });
  // Done with Claude Code over there: start in its folder, and never ask for it here.
  async function chooseRemote() {
    const anchor = window.ShellbyRemoteLogic.readyFolder(SB.remoteNow?.()?.computers);
    if (!anchor) return;
    const r = await api.setSettings({ onboarded: true, firstTour: true, crabOnly: false, workMode: false, claudeElsewhere: true });
    state.settings = r.settings;
    SB.onboardPath = null;
    SB.applyCrabOnly();
    SB.refreshEmptyStates();
    SB.setView('chat');
    await SB.folderChanged(await api.remoteWorkHere(anchor));
  }
  $('onboardPaths').addEventListener('click', e => {
    const b = e.target.closest('.path');
    if (!b) return;
    if (b.dataset.path === 'crab') return SB.chooseCrabOnly();
    SB.onboardPath = ['work', 'remote'].includes(b.dataset.path) ? b.dataset.path : 'claude';
    renderOnboarding();
    $('claudeSetup').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('crabInsteadBtn').addEventListener('click', () => SB.chooseCrabOnly());

  SB.views.onboarding = { render: renderOnboarding, leave: () => lendRemote(false) };
})();
