/* Shellby panel — the effort and model chips under the message box, and the
   /effort and /model commands that drive them (composer.js runLocal). Each
   conversation has its own effort and model (main's sessions.js); the chips
   show the one you're in, their menus switch it, and new conversations' defaults
   are a line away in each. A local model (Settings → Local model) is picked
   here too, before a conversation's first message settles it. */
'use strict';
(function () {
  const { h, api, state, $ } = SB;

  // ------------------------------------------------------------ effort chip

  const EFFORTS = [
    { id: '', title: 'Auto', sub: 'Claude Code decides how hard to think' },
    { id: 'low', title: 'Low', sub: 'Quick answers, the least thinking' },
    { id: 'medium', title: 'Medium', sub: 'A balance of speed and care' },
    { id: 'high', title: 'High', sub: 'Thinks things through' },
    { id: 'xhigh', title: 'Extra high', sub: 'For hard problems' },
    { id: 'max', title: 'Max', sub: 'Thinks the longest. Uses your limits fastest' },
  ];
  const effortName = id => (EFFORTS.find(x => x.id === (id || '')) || EFFORTS[0]).title;
  SB.EFFORTS = EFFORTS; // the palette's Effort entries (nav.js)

  // Each conversation has its own effort (main's sessions.js). New ones start
  // on the default; on Auto with picking on, Shellby sizes each from its first
  // message (effort-pick.js), so a quick question doesn't think and fill its
  // context like a build.
  const picking = () => !state.settings?.effort && state.settings?.effortPick !== false;
  const tabEffort = tab => (tab && typeof tab.effort === 'string' ? tab.effort : state.settings?.effort || '');

  function effortItems() {
    const tab = SB.activeTab();
    const cur = tabEffort(tab);
    const pick = picking();
    return [
      h('div', { class: 'menu-label', text: 'How hard Claude thinks here' }),
      ...EFFORTS.map(x => h('button', { class: 'menu-item', role: 'menuitemradio', 'aria-checked': String(cur === x.id), onclick: () => { SB.closeMenus(); SB.chooseEffort(x.id); } },
        h('span', { class: 'mi-check', text: cur === x.id ? '●' : '' }),
        h('span', {}, h('div', { class: 'mi-title', text: x.title }), h('div', { class: 'mi-sub', text: x.sub })))),
      h('div', { class: 'menu-sep' }),
      h('div', { class: 'menu-label', text: 'New conversations' }),
      h('button', { class: 'menu-item', role: 'menuitemcheckbox', 'aria-checked': String(pick), onclick: () => { SB.closeMenus(); SB.chooseNewEffort(!pick); } },
        h('span', { class: 'mi-check', text: pick ? '✓' : '' }),
        h('span', {}, h('div', { class: 'mi-title', text: 'Pick to fit each one' }),
          h('div', { class: 'mi-sub', text: pick ? 'Low for a quick question, high for a big job, from its first message'
            : `Off: they start on ${effortName(state.settings?.effort).toLowerCase()}` }))),
    ];
  }

  SB.applyEffort = () => {
    const tab = SB.activeTab();
    const id = tabEffort(tab);
    const by = tab?.effortBy || null;
    const waiting = !by && !id && picking();
    $('effortLabel').textContent = id ? effortName(id).toLowerCase() : waiting ? 'fits' : 'auto';
    $('effortChip').classList.toggle('on', !!id);
    $('effortChip').dataset.level = String(Math.max(0, EFFORTS.findIndex(x => x.id === id))); // the dial (composer.css)
    $('effortChip').title = waiting
      ? 'Effort: picked from your first message, to fit the job. Click to choose it yourself (/effort)'
      : `Effort: ${effortName(id)}${by === 'picked' ? ', picked to fit your first message' : ''}. How hard Claude thinks in this conversation (/effort)`;
  };

  // /effort [new] <level|auto|pick>, or /effort alone for the menu (composer.js LOCAL).
  SB.effortCommand = (arg) => {
    const fresh = /^new\s+/i.test(arg);
    const want = arg.replace(/^new\s+/i, '').toLowerCase().replace(/^extra[\s-]?high$/, 'xhigh').replace(/^(auto|default)$/, '');
    if (fresh && want === 'pick') return SB.chooseNewEffort(true);
    if (arg && EFFORTS.some(x => x.id === want)) return fresh ? SB.chooseNewEffort(false, want) : SB.chooseEffort(want);
    if (arg) return SB.toast(fresh ? 'New conversations take: pick, auto, low, medium, high, xhigh or max.' : 'Effort is one of: auto, low, medium, high, xhigh, max.');
    SB.openMenu($('effortMenu'), $('effortChip'), effortItems);
  };

  // This conversation only. With none open yet, it's what new ones start on.
  SB.chooseEffort = async (id) => {
    const tab = SB.activeTab();
    if (!tab) return SB.chooseNewEffort(false, id);
    const r = await api.setTabEffort(tab.id, id);
    if (!r?.ok) return SB.toast(r?.error || "Couldn't change the effort.");
    Object.assign(tab, { effort: id, effortBy: 'you' }); // main's next summary says the same
    SB.applyEffort();
    SB.toast(`Effort: ${effortName(id)}, for this conversation`);
  };

  // pick: size each new conversation from its first message (on Auto).
  // Otherwise they start on `id` ('' is Auto), or the default as it is.
  SB.chooseNewEffort = async (pick, id = state.settings?.effort || '') => {
    const r = await api.setSettings(pick ? { effortPick: true, effort: '' } : { effortPick: false, effort: id });
    state.settings = r.settings;
    SB.applyEffort();
    SB.toast(pick ? 'New conversations get an effort picked to fit their first message.' : `New conversations start on ${effortName(state.settings.effort).toLowerCase()} effort.`);
  };

  $('effortChip').addEventListener('click', () => SB.openMenu($('effortMenu'), $('effortChip'), effortItems));

  // ------------------------------------------------------------ model chip

  // The model chip: what this conversation runs. Claude Code reports full ids
  // ('claude-opus-4-1-20250805'), which the picker may not list, so read the id itself.
  const MODEL_DATE = /-\d{8}$/;
  function modelName(id) {
    const listed = (state.models || []).find(m => m.id === id);
    if (listed) return listed.label;
    const [family, ...version] = id.replace(/^claude-/, '').replace(/\[.*\]$/, '').replace(MODEL_DATE, '').split('-');
    return family ? `${family[0].toUpperCase()}${family.slice(1)}${version.length ? ` ${version.join('.')}` : ''}` : id;
  }

  // Claude Code's default depends on your plan and isn't told before a
  // conversation runs, so the last one a conversation on the default reported
  // is kept, to name it ("default (Opus 5.5)") before the next one starts.
  // Only a Claude model names the default: a conversation on a local model
  // (main's local/agent.js) asks for none and reports the local one.
  const DEFAULT_SEEN = 'shellby.defaultModelSeen';
  const isClaude = id => typeof id === 'string' && (/^claude-/.test(id) || (state.models || []).some(m => m.id === id));
  const askedOf = tab => (typeof tab?.modelAsked === 'string' ? tab.modelAsked : state.settings?.model || '');
  function defaultSeen(tab) {
    const mine = !tab?.local && askedOf(tab) === '' && isClaude(tab?.model) ? tab.model : null;
    const kept = SB.pref(DEFAULT_SEEN);
    return mine || (isClaude(kept) ? kept : null);
  }
  function defaultName(tab) {
    const seen = defaultSeen(tab);
    return seen ? `default (${modelName(seen)})` : 'default';
  }

  // The chip's tier bars: how heavy the model is, one bar for Haiku to three
  // for Opus and Fable (the same top tier as routines.js TOP_MODEL). A local
  // model, or one Shellby can't place, lights none.
  /** @type {[RegExp, number][]} */
  const MODEL_TIERS = [[/haiku/i, 1], [/sonnet/i, 2], [/opus|fable/i, 3]];
  const tierOf = name => MODEL_TIERS.find(([re]) => re.test(name))?.[1] || 0;
  function showTier(n) {
    $('modelTier').querySelectorAll('rect').forEach((bar, i) => bar.classList.toggle('lit', i < n));
  }
  // "Opus 5.5" → a bold "Opus", the version beside it, then a tag ("default",
  // "local"). In a narrow panel only the name stays (panel.css @container subbar).
  function chipLabel(name, tag, local = false) {
    const [family, ...rest] = name.split(' ');
    const version = rest.join(' ').replace(/^\((.*)\)$/, '$1'); // "(latest)" → "latest"
    $('modelLabel').replaceChildren(
      h('b', { class: 'model-name', text: family }),
      version && h('span', { class: 'model-ver', text: version }),
      tag && h('span', { class: local ? 'model-tag local' : 'model-tag', text: tag }));
  }

  SB.applyModel = () => {
    const tab = SB.activeTab();
    const asked = askedOf(tab);
    if (tab && !tab.local && asked === '' && isClaude(tab.model)) SB.pref.set(DEFAULT_SEEN, tab.model);
    const chip = $('modelChip');
    chip.hidden = !tab;
    chip.classList.toggle('local', !!tab?.local);
    if (tab?.local) {
      chipLabel(tab.local, 'local', true);
      showTier(0);
      chip.classList.add('on');
      chip.setAttribute('aria-label', `Model: ${tab.local}, on this PC`);
      chip.title = `Model: ${tab.local}, on this PC. ${tab.canLocal ? 'Click to switch it before its first message' : 'It stays on this PC for good'} (/model)`;
      return;
    }
    const id = asked === '' ? '' : tab?.model || asked;
    const seen = id ? null : defaultSeen(tab);
    const name = id ? modelName(id) : seen ? modelName(seen) : 'default';
    chipLabel(name, !id && seen ? 'default' : '');
    showTier(tierOf(`${name} ${id || seen || ''}`)); // the id too: a listed label may not name its family
    chip.classList.toggle('on', !!id);
    chip.title = `Model: ${id || `${defaultName(tab)}, what Claude Code picks for your plan`}. Click to switch this conversation (/model)`;
    // A narrow panel hides the version and the "default" tag; the button's name keeps them.
    chip.setAttribute('aria-label', `Model: ${id ? name : defaultName(tab)}`);
  };

  // The local server's models (main's local/model.js listModels), asked for
  // each time the menu opens; until it answers, the ones Settings names.
  let localFound = { url: '', models: /** @type {string[]} */ ([]) };
  let findSeq = 0;
  function localNames(tab) {
    const lm = state.settings?.localModel;
    if (!lm?.url) return tab?.local ? [tab.local] : [];
    const found = localFound.url === lm.url ? localFound.models : [];
    return [...new Set([tab?.local, lm.agent?.model, lm.model, ...found].filter(Boolean))];
  }
  async function findLocal() {
    const url = state.settings?.localModel?.url;
    if (!url) return;
    const seq = ++findSeq;
    const r = await api.localModels(url).catch(() => null);
    if (seq !== findSeq || !r?.ok || !Array.isArray(r.models)) return; // a later look, or nothing there
    const tab = SB.activeTab();
    const before = localNames(tab).join('\n');
    localFound = { url, models: r.models };
    const menu = $('modelMenu');
    // Only when the list grew, so the menu you're moving through isn't rebuilt under you.
    if (menu.hidden || localNames(tab).join('\n') === before) return;
    menu.replaceChildren(...modelItems().filter(Boolean));
    /** @type {HTMLElement | null} */ (menu.querySelector('.menu-item:not([disabled])'))?.focus();
  }

  function modelItems() {
    const tab = SB.activeTab();
    const local = tab?.local || null;
    const cur = local ? null : askedOf(tab);
    const started = !!tab?.saved;
    // Local or Claude is decided for good at its first message (main's sessions.js canMoveLocal).
    const fixed = !!tab && !tab.canLocal;
    const radio = (on, disabled, title, sub, pick) => h('button', { class: 'menu-item', role: 'menuitemradio', 'aria-checked': String(on), disabled, onclick: () => { SB.closeMenus(); pick(); } },
      h('span', { class: 'mi-check', text: on ? '●' : '' }),
      h('span', {}, h('div', { class: 'mi-title', text: title }), sub ? h('div', { class: 'mi-sub', text: sub }) : null));
    const item = (id, title, sub) => radio(cur === id, fixed && !!local, title, sub, () => SB.chooseModel(id));
    const models = state.models || [];
    const names = tab ? localNames(tab) : [];
    return [
      h('div', { class: 'menu-label', text: started ? 'Model for this conversation, from its next turn' : 'Model for this conversation' }),
      item('', defaultName(tab).replace(/^d/, 'D'), 'What Claude Code picks for your plan'),
      ...[...new Set(models.map(m => m.group))].flatMap(g => [
        h('div', { class: 'menu-sep' }),
        ...models.filter(m => m.group === g).map(m => item(m.id, m.label)),
      ]),
      ...(names.length ? [
        h('div', { class: 'menu-sep' }),
        h('div', { class: 'menu-label', text: 'On this PC' }),
        ...names.map((n, i) => radio(local === n, fixed && local !== n, n,
          i === 0 ? (fixed ? (local ? 'Stays on this PC for good' : 'Only before a conversation starts') : 'Free, and nothing leaves this PC') : null,
          () => SB.chooseLocal(n))),
      ] : []),
      ...(local && started ? [
        h('div', { class: 'menu-sep' }),
        h('button', { class: 'menu-item', role: 'menuitem', onclick: () => { SB.closeMenus(); SB.continueOnClaude(); } },
          h('span', { class: 'mi-check', text: '' }),
          h('span', {}, h('div', { class: 'mi-title', text: 'Continue on Claude…' }),
            h('div', { class: 'mi-sub', text: 'A new conversation reads this one and carries on. Uses your plan' }))),
      ] : []),
      h('div', { class: 'menu-sep' }),
      h('button', { class: 'menu-item', role: 'menuitem', onclick: () => { SB.closeMenus(); SB.showSetting?.('modelSelect'); } },
        h('span', { class: 'mi-check', text: '' }),
        h('span', {}, h('div', { class: 'mi-title', text: 'New conversations…' }),
          h('div', { class: 'mi-sub', text: `Start on ${state.settings?.model ? modelName(state.settings.model) : 'the default'}. Change it in Settings` }))),
    ];
  }

  // As in the terminal: /model opens the picker, /model sonnet (or an id, a label, default) switches (composer.js LOCAL).
  SB.modelCommand = (arg) => {
    if (!arg) return SB.openMenu($('modelMenu'), $('modelChip'), modelItems);
    const want = arg.toLowerCase().trim();
    if (want === 'default') return SB.chooseModel('');
    const hit = (state.models || []).find(m => m.id === want || m.label.toLowerCase() === want);
    if (!hit) return SB.toast(`Shellby doesn't know "${arg}". Try /model opus, sonnet, haiku, default, or /model to pick.`, { ms: 6000 });
    SB.chooseModel(hit.id);
  };

  // This conversation only, as the terminal's /model. One that has started
  // reads everything again on its next turn: each model keeps its own cache.
  SB.chooseModel = async (id) => {
    const tab = SB.activeTab();
    if (!tab) return SB.showSetting?.('modelSelect');
    const r = await api.setTabModel(tab.id, id).catch(() => null);
    if (!r?.ok) return SB.toast(r?.error || "Couldn't change its model.", { ms: 6000 });
    Object.assign(tab, { modelAsked: id, model: id, local: null }); // main's next summary says the same
    SB.applyModel();
    const name = id ? modelName(id) : defaultName(tab);
    SB.toast(r.started ? `Switched to ${name}. Its next turn re-reads the conversation, so it costs more once.` : `This conversation starts on ${name}.`, { ms: 5000 });
  };

  // A local model instead of Claude, before its first message (main's sessions.js setTabLocal).
  SB.chooseLocal = async (name) => {
    const tab = SB.activeTab();
    if (!tab) return;
    const r = await api.setTabLocal(tab.id, name).catch(() => null);
    if (!r?.ok) return SB.toast(r?.error || "Couldn't put it on that model.", { ms: 6000 });
    Object.assign(tab, { local: name, model: name, modelAsked: '' }); // main's next summary says the same
    SB.applyModel();
    SB.toast(`This conversation runs on ${name}, on this PC. Its first message settles it for good.`, { ms: 5000 });
  };

  // A new Claude conversation that reads this local one's record (main's local/tab.js continuePrompt).
  // Drafted, not sent: spending the plan is your call. This one stays as it was.
  SB.continueOnClaude = async () => {
    const tab = SB.activeTab();
    if (!tab?.local) return;
    const r = await api.continueOnClaude(tab.id).catch(() => null);
    if (!r?.ok) return SB.toast(r?.error || "Couldn't read this conversation.", { ms: 6000 });
    await SB.newTabIn({ cwd: r.cwd, draft: r.prompt });
    const fresh = SB.activeTab();
    if (!fresh || fresh.id === tab.id) return;
    // On Claude even with Local mode on for new conversations.
    const m = await api.setTabModel(fresh.id, '').catch(() => null);
    if (m?.ok) { Object.assign(fresh, { local: null, modelAsked: '', model: '' }); SB.applyModel(); }
  };

  $('modelChip').addEventListener('click', () => {
    SB.openMenu($('modelMenu'), $('modelChip'), modelItems);
    if (!$('modelMenu').hidden) findLocal();
  });
})();
