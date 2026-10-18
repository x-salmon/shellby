/* Shellby panel — Settings: On your phone. Shellby's phone app over your
   tailnet (wiring/pocket.js): the steps to get there, the switch (which asks
   in the confirmation window), the address as a QR code, pairing a phone with
   a code from this screen, the phones paired, and which notifications they get.
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

  function deviceRow(dv) {
    const sure = forgetting.has(dv.id);
    return h('li', { class: 'pocket-device' },
      h('span', { class: `pocket-dot${dv.recent ? ' on' : ''}`, 'aria-hidden': 'true' }),
      h('span', { class: 'pocket-device-name' },
        h('b', { text: dv.name }),
        h('span', { class: 'small muted', text: ` · ${dv.recent ? 'looking now' : `seen ${ago(dv.lastSeenAt)}`}${dv.push ? ' · notifications on' : ''}` })),
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
