/* Shellby panel — Settings: Connectors. One MCP gateway (Composio, Pipedream,
   Zapier MCP, Smithery or another) handed to every conversation (main's
   connectors/). The address and key go to main once and never come back: the
   panel only sees the gateway's host, the key's last four and the switches. */
'use strict';
(function () {
  const { h, api, $ } = SB;

  /** @type {any} */
  let view = null; // main's connectors view (connectors/index.js view)
  let replacing = false;

  /** @param {string} text @param {'ok' | 'warn' | ''} [kind] */
  const say = (text, kind = '') => { $('connectorsStatus').textContent = text; $('connectorsStatus').className = `small ext-status ${kind}`; };
  const presetOf = id => view?.presets?.find(p => p.id === id) || view?.presets?.[view.presets.length - 1] || null;

  function fillPresets() {
    const sel = /** @type {HTMLSelectElement} */ ($('connectorsPreset'));
    if (sel.options.length || !view?.presets?.length) return;
    sel.replaceChildren(...view.presets.map(p => h('option', { value: p.id, text: p.name })));
    sel.value = 'composio';
    pickPreset();
  }

  // The site to get an address from, and the header that gateway usually wants the key in.
  function pickPreset() {
    const p = presetOf(/** @type {HTMLSelectElement} */ ($('connectorsPreset')).value);
    const site = $('connectorsSite');
    site.hidden = !p?.site;
    site.title = p?.site || '';
    /** @type {HTMLInputElement} */ ($('connectorsHeader')).value = p?.header || 'Authorization';
  }

  /** @param {any} v */
  function render(v) {
    view = v;
    fillPresets();
    const saved = !!v?.saved;
    $('connectorsSaved').hidden = !saved || replacing;
    $('connectorsForm').hidden = saved && !replacing;
    $('connectorsCancel').hidden = !saved;
    if (saved) {
      const name = presetOf(v.preset)?.name || 'A gateway';
      $('connectorsSavedText').textContent = `${name} at ${v.host}${v.hint ? `, key ${v.hint}` : ', no key'}.`;
    }
    for (const [id, key] of [['connectorsToggle', 'on'], ['connectorsClaude', 'claude'], ['connectorsAgents', 'agents']]) {
      const box = /** @type {HTMLInputElement} */ ($(id));
      box.checked = !!v?.[key];
      box.disabled = !saved || (key !== 'on' && !v?.on);
    }
    if (!v?.canEncrypt) say("Windows can't encrypt secrets on this PC, so connectors can't be saved here.", 'warn');
  }

  function clearForm() {
    for (const id of ['connectorsUrl', 'connectorsKey']) /** @type {HTMLInputElement} */ ($(id)).value = '';
  }

  $('connectorsPreset').addEventListener('change', pickPreset);
  $('connectorsSite').addEventListener('click', () => {
    const site = presetOf(/** @type {HTMLSelectElement} */ ($('connectorsPreset')).value)?.site;
    if (site) api.openExternal(site);
  });

  $('connectorsForm').addEventListener('submit', async e => {
    e.preventDefault();
    const req = {
      preset: /** @type {HTMLSelectElement} */ ($('connectorsPreset')).value,
      url: /** @type {HTMLInputElement} */ ($('connectorsUrl')).value.trim(),
      key: /** @type {HTMLInputElement} */ ($('connectorsKey')).value.trim(),
      header: /** @type {HTMLInputElement} */ ($('connectorsHeader')).value.trim(),
    };
    $('connectorsSave').disabled = true;
    try {
      const r = await api.saveConnectors(req);
      if (!r.ok) { say(r.error, 'warn'); return; }
      replacing = false;
      clearForm();
      render(r.view);
      say(r.view.on ? 'Saved. New conversations use it.' : 'Saved. Testing it…', 'ok');
      await test();
    } catch { say("Couldn't save that.", 'warn'); } finally { $('connectorsSave').disabled = false; }
  });

  async function test() {
    $('connectorsTest').disabled = true;
    try {
      const r = await api.testConnectors();
      if (!r.ok) { say(`It didn't answer: ${r.error}`, 'warn'); return; }
      const some = r.names.length ? ` (${r.names.slice(0, 4).join(', ')}${r.tools > 4 ? ', …' : ''})` : '';
      say(r.tools ? `It works: ${r.tools} tool${r.tools === 1 ? '' : 's'}${some}.` : 'It answered, but has no tools yet: connect some apps at the gateway.', r.tools ? 'ok' : 'warn');
    } catch { say("Couldn't test it.", 'warn'); } finally { $('connectorsTest').disabled = false; }
  }
  $('connectorsTest').addEventListener('click', test);

  $('connectorsReplace').addEventListener('click', () => { replacing = true; render(view); $('connectorsUrl').focus(); });
  $('connectorsCancel').addEventListener('click', () => { replacing = false; clearForm(); render(view); });
  $('connectorsRemove').addEventListener('click', async () => {
    try { const r = await api.clearConnectors(); render(r.view); say('Removed. New conversations start without it.'); } catch { say("Couldn't remove it.", 'warn'); }
  });

  for (const [id, key] of [['connectorsToggle', 'on'], ['connectorsClaude', 'claude'], ['connectorsAgents', 'agents']]) {
    $(id).addEventListener('change', async e => {
      try {
        const r = await api.setConnectorSwitches({ [key]: /** @type {HTMLInputElement} */ (e.target).checked });
        render(r.view);
        if (!r.ok) say(r.error, 'warn');
        else if (key === 'on') say(r.view.on ? 'On for new conversations.' : 'Off. New conversations start without it.');
      } catch { say("Couldn't save that.", 'warn'); }
    });
  }

  SB.onSettingsOpen(() => api.connectorsView().then(render).catch(() => {}));
})();
