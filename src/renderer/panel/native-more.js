/* Shellby panel — more of Claude Code's own commands, drawn instead of printed:
   /context as a bar of what fills the window (its table folded under it), the
   /insights report a button away, and /mobile's QR code to scan. Shellby makes
   none of it: the numbers, the report and the link are all Claude Code's.
   feed.js and builtin-commands.js call in here. */
'use strict';
(function () {
  const { h, api } = SB;
  const F = window.ShellbyFeedLogic;

  const LEGEND_MAX = 6; // categories named under the bar; the rest are in the table
  const QR_SCALE = 5;   // screen pixels per QR module
  const QR_QUIET = 4;   // modules of plain margin round the code, as scanners want

  // ------------------------------------------------------------ /context

  const pctText = p => `${p < 1 && p > 0 ? p.toFixed(1) : Math.round(p)}%`;

  /** item: stream.js contextUsageOf's { model, used, window, pct, categories, text }. */
  SB.renderContextUsage = (tab, item) => {
    const segs = F.contextSegments(item.categories);
    const used = segs.filter(s => s.tone === 'used');
    // A colour per category, the same in the bar and the legend; past the legend's few they share the last.
    const tint = s => ` n${Math.min(used.indexOf(s), LEGEND_MAX - 1)}`;
    const title = `Context ${pctText(item.pct)} full · ${SB.compact(item.used)} of ${SB.compact(item.window)} tokens`;
    const bar = h('div', { class: 'ctxu-bar', role: 'img', 'aria-label': `${title}. ${used.slice(0, LEGEND_MAX).map(s => `${s.name} ${pctText(s.pct)}`).join(', ')}` },
      segs.filter(s => s.pct > 0).map(s => {
        const el = h('span', { class: `ctxu-seg ${s.tone}${s.tone === 'used' ? tint(s) : ''}`, title: `${s.name}: ${SB.compact(s.tokens)} tokens (${pctText(s.pct)})` });
        el.style.width = `${s.pct}%`;
        return el;
      }));
    const more = used.length - LEGEND_MAX;
    const legend = h('ul', { class: 'ctxu-legend' }, used.slice(0, LEGEND_MAX).map(s => h('li', {},
      h('span', { class: `ctxu-dot used${tint(s)}`, 'aria-hidden': 'true' }),
      h('span', { class: 'ctxu-name', text: s.name }),
      h('span', { class: 'ctxu-num', text: `${SB.compact(s.tokens)} · ${pctText(s.pct)}` }))),
    more > 0 ? h('li', { class: 'muted', text: `and ${more} more, in the breakdown` }) : null);
    const table = SB.renderMarkdownInto(h('div', { class: 'msg assistant ctxu-table' }), item.text || '');
    const el = h('div', { class: 'ctxu-card', role: 'group', 'aria-label': "What's using the context window" },
      h('div', { class: 'ctxu-head' }, h('b', { text: title }), item.model ? h('span', { class: 'muted small', text: item.model }) : null),
      bar,
      used.length ? legend : null,
      h('details', { class: 'ctxu-more' }, h('summary', { text: "Claude Code's full breakdown" }), table));
    return tab.append(el);
  };

  // ------------------------------------------------------------ /insights

  async function openInsights(btn) {
    btn.disabled = true;
    const r = await api.openInsights().catch(() => null);
    btn.disabled = false;
    if (!r?.ok) SB.toast(r?.error || "Couldn't open the report.", { ms: 6000 });
  }

  /** A reply's element, once drawn: a report link gets a button that opens it in the browser. */
  SB.decorateReply = (el, text) => {
    if (!F.insightsReportIn(text)) return;
    el.append(h('div', { class: 'ctxu-actions' },
      h('button', { type: 'button', class: 'btn slim-btn', onclick: e => openInsights(e.currentTarget) }, 'Open the latest insights report')));
  };

  // ------------------------------------------------------------ /mobile

  let sheet = null;
  let returnTo = null;

  function drawQr(canvas, rows) {
    const n = rows.length + QR_QUIET * 2;
    canvas.width = canvas.height = n * QR_SCALE;
    const g = canvas.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    g.fillStyle = css.getPropertyValue('--sand').trim() || '#f3e6cc';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = css.getPropertyValue('--ink').trim() || '#0c1719';
    rows.forEach((row, y) => [...row].forEach((bit, x) => {
      if (bit === '1') g.fillRect((x + QR_QUIET) * QR_SCALE, (y + QR_QUIET) * QR_SCALE, QR_SCALE, QR_SCALE);
    }));
  }

  function closeMobile() {
    if (!sheet) return;
    sheet.remove();
    sheet = null;
    if (returnTo?.isConnected) returnTo.focus();
    returnTo = null;
  }

  SB.showMobileQr = async () => {
    const r = await api.mobileQr().catch(() => null);
    if (!r?.qr) return SB.toast('Get the Claude app from claude.ai/mobile.', { ms: 6000, action: 'Open', onAction: () => api.openExternal(r?.url || 'https://claude.ai/mobile') });
    closeMobile();
    returnTo = document.activeElement;
    const canvas = h('canvas', { class: 'mobile-qr', role: 'img', 'aria-label': `QR code for ${r.url}` });
    drawQr(canvas, r.qr);
    const close = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', title: 'Close (Esc)', onclick: closeMobile, text: '✕' });
    sheet = h('div', { class: 'card-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mobileTitle' },
      h('div', { class: 'card-box mobile-box' },
        h('div', { class: 'card-head' }, h('h2', { id: 'mobileTitle', text: 'Claude on your phone' }), close),
        canvas,
        h('p', { class: 'small muted', text: "Scan it with your phone's camera to get the Claude app. To follow these conversations on your phone as well: Settings → Connections → Put Shellby on my phone." }),
        h('p', { class: 'small' }, h('button', { type: 'button', class: 'link-btn', text: r.url, onclick: () => api.openExternal(r.url) }))));
    sheet.addEventListener('click', e => { if (e.target === sheet) closeMobile(); });
    sheet.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeMobile(); } });
    document.body.append(sheet);
    close.focus();
  };
})();
