/* Shellby panel — Settings: On your phone. Shellby's phone app over your
   tailnet (wiring/pocket.js): the steps to get there, the switch (which asks
   in the confirmation window), the address as a QR code, pairing a phone with
   a code from this screen, the phones paired (each with its rights), which
   notifications they get, and the quiet hours.
   settings-text.js decides what each step and status line says. */
'use strict';
(function () {
  const { h, api, state, $ } = SB;
  const T = window.ShellbySettingsText;

  let view = null;
  let codeTimer = null;
  const forgetting = new Set(); // phones whose Forget was pressed once

  const MARK = { ok: '✓', todo: '○', bad: '!', busy: '…' };

  // The address as pixel art, as the ntfy one is drawn (settings-channels.js).
  function drawQr(rows) {
    const canvas = $('pocketQrCanvas');
    const n = rows.length + 8;
    const scale = 4;
    canvas.width = canvas.height = n * scale;
    const g = canvas.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    g.fillStyle = css.getPropertyValue('--sand').trim() || '#f3e6cc';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = css.getPropertyValue('--ink').trim() || '#0c1719';
    rows.forEach((row, y) => [...row].forEach((bit, x) => {
      if (bit === '1') g.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale);
    }));
  }

  const ago = at => (at ? T.minutesAgo(at) : 'never');
  const RIGHTS_LABEL = { full: 'Full', readonly: 'Read only' };

  // What this phone may do (pocket/rights.js): full, or looking only.
  function rightsPick(dv) {
    const sel = h('select', { class: 'field slim pocket-rights', 'aria-label': `What ${dv.name} may do` },
      ...(view?.rightsLevels || Object.keys(RIGHTS_LABEL)).map(r => h('option', { value: r, text: RIGHTS_LABEL[r] || r })));
    sel.value = dv.rights || 'full';
    sel.addEventListener('change', async () => {
      sel.disabled = true;
      try {
        const v = await api.setPocket({ device: { id: dv.id, rights: sel.value } });
        render(v);
        if (v.error) SB.toast(v.error, { ms: 5000 });
        else SB.toast(sel.value === 'readonly' ? `${dv.name} can only look now.` : `${dv.name} can do everything again.`, { ms: 4000 });
      } finally { sel.disabled = false; }
    });
    return sel;
  }

  function deviceRow(dv) {
    const sure = forgetting.has(dv.id);
    return h('li', { class: 'pocket-device' },
      h('span', { class: `pocket-dot${dv.recent ? ' on' : ''}`, 'aria-hidden': 'true' }),
      h('span', { class: 'pocket-device-name' },
        h('b', { text: dv.name }),
        h('span', { class: 'small muted', text: ` · ${dv.recent ? 'looking now' : `seen ${ago(dv.lastSeenAt)}`}${dv.push ? ' · notifications on' : ''}` })),
      rightsPick(dv),
      h('button', {
        type: 'button', class: `btn ghost slim-btn${sure ? ' danger' : ''}`, text: sure ? 'Forget it?' : 'Forget',
        'aria-label': sure ? `Forget ${dv.name}: press again to be sure` : `Forget ${dv.name}`,
        onclick: () => forget(dv),
      }));
  }

  async function forget(dv) {
    if (!forgetting.has(dv.id)) {
      forgetting.add(dv.id);
      render(view);
      setTimeout(() => { if (forgetting.delete(dv.id) && view) render(view); }, 4000);
      return;
    }
    forgetting.delete(dv.id);
    const v = await api.forgetPocketDevice(dv.id);
    render(v);
    if (!v.error) SB.toast(`${dv.name} is forgotten. It can pair again with a new code.`, { ms: 5000 });
  }

  function showCode(v) {
    clearInterval(codeTimer);
    codeTimer = null;
    $('pocketCode').hidden = !v.code;
    if (!v.code) return;
    $('pocketCodeText').textContent = v.code.text;
    const tick = () => {
      if (Date.now() > v.code.expiresAt) {
        clearInterval(codeTimer);
        $('pocketCode').hidden = true;
        $('pocketPair').textContent = 'Pair a phone';
        return;
      }
      $('pocketCodeHint').textContent = T.pocketCodeHint(v.code);
    };
    tick();
    codeTimer = setInterval(tick, 1000);
  }

  function render(v) {
    if (!v) return;
    view = v;
    $('pocketSteps').replaceChildren(...T.pocketSteps(v).map(s => h('li', { class: `rc-step ${s.state}` },
      h('span', { class: 'rc-mark', 'aria-hidden': 'true', text: MARK[s.state] || '' }),
      h('span', { class: 'rc-text', text: s.text }),
      s.link ? h('button', { type: 'button', class: 'btn ghost slim-btn', text: s.linkText || 'Open', onclick: () => api.openExternal(s.link) }) : null)));
    $('pocketEnabled').checked = !!v.enabled;
    const said = T.pocketStatus(v);
    $('pocketStatus').textContent = said.text;
    $('pocketStatus').className = `small ext-status ${said.tone}`;
    const live = v.enabled && v.server?.status === 'listening';
    $('pocketBody').hidden = !live;
    $('pocketQr').hidden = !v.qr;
    if (v.qr && $('pocketQrCanvas').dataset.url !== v.url) { drawQr(v.qr); $('pocketQrCanvas').dataset.url = v.url; }
    $('pocketUrlRow').hidden = !v.url;
    $('pocketUrl').textContent = v.url || '—';
    $('pocketPair').textContent = v.code ? 'New code' : 'Pair a phone';
    showCode(v);
    $('pocketDevices').replaceChildren(...(v.devices || []).map(deviceRow));
    const n = v.notify || {};
    if (document.activeElement?.closest?.('#pocketEvents') == null) {
      $('pocketEvents').replaceChildren(...Object.entries(v.eventLabels || {}).map(([key, label]) => h('label', { class: 'toggle' },
        h('input', { type: 'checkbox', 'data-event': key, ...(n.events?.[key] ? { checked: 'checked' } : {}) }),
        h('span', { class: 'switch' }), label)));
    }
    $('pocketWhileFocused').checked = !!n.whileFocused;
    $('pocketWorking').checked = !!n.working;
    const q = v.quiet || {};
    $('pocketQuiet').checked = !!q.enabled;
    $('pocketQuietRow').hidden = !q.enabled;
    // Not while a time is being typed: the PC answers each change with the view.
    if (document.activeElement !== $('pocketQuietFrom')) $('pocketQuietFrom').value = q.from || '22:00';
    if (document.activeElement !== $('pocketQuietTo')) $('pocketQuietTo').value = q.to || '07:00';
    for (const el of $('pocketAllow').querySelectorAll('input[data-allow]')) el.checked = !!v.allow?.[el.dataset.allow];
    $('pocketTest').disabled = !(v.devices || []).some(dv => dv.push);
  }

  $('pocketEnabled').addEventListener('change', async e => {
    const want = e.target.checked;
    e.target.disabled = true;
    try {
      const v = await api.setPocket({ enabled: want });
      render(v);
      if (v.error) SB.toast(v.error, { ms: 7000 });
    } finally { e.target.disabled = false; }
  });
  $('pocketPair').addEventListener('click', async () => {
    const v = await api.newPocketCode();
    render(v);
    if (v.error) SB.toast(v.error, { ms: 5000 });
  });
  $('pocketEvents').addEventListener('change', async e => {
    const key = e.target.dataset.event;
    if (key) render(await api.setPocket({ notify: { events: { [key]: e.target.checked } } }));
  });
  $('pocketWhileFocused').addEventListener('change', async e => render(await api.setPocket({ notify: { whileFocused: e.target.checked } })));
  $('pocketWorking').addEventListener('change', async e => render(await api.setPocket({ notify: { working: e.target.checked } })));
  // Quiet hours: the switch, and each time as it's changed (a bad one is said and put back).
  async function setQuiet(patch) {
    const v = await api.setPocket({ quiet: patch });
    render(v);
    if (v.error) SB.toast(v.error, { ms: 5000 });
  }
  $('pocketQuiet').addEventListener('change', e => setQuiet({ enabled: e.target.checked }));
  $('pocketQuietFrom').addEventListener('change', e => { if (e.target.value) setQuiet({ from: e.target.value }); });
  $('pocketQuietTo').addEventListener('change', e => { if (e.target.value) setQuiet({ to: e.target.value }); });
  $('pocketAllow').addEventListener('change', async e => {
    const key = e.target.dataset.allow;
    if (key) render(await api.setPocket({ allow: { [key]: e.target.checked } }));
  });
  $('pocketTest').addEventListener('click', async e => {
    e.target.disabled = true;
    $('pocketTestStatus').textContent = 'Sending…';
    try {
      const r = await api.testPocketPush();
      $('pocketTestStatus').textContent = r.ok ? 'Sent. It should be on your phone in a moment.' : r.error;
      $('pocketTestStatus').className = `small ext-status ${r.ok ? 'ok' : 'warn'}`;
    } finally { e.target.disabled = false; }
  });

  api.onPocket(v => { if (state.view === 'settings') render(v); });
  SB.onSettingsOpen(() => { api.getPocket().then(render); });
})();
