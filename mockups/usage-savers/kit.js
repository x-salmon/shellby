/* Panel chrome for the usage-saver mockups: the tab strip, the subbar, the
   turn footer and the composer, drawn from data so every concept shows the
   same Shellby. A concept puts <div data-kit="subbar" data-opts='{...}'></div>
   where the piece goes and calls kit.mount() at the end. */
(() => {
  const folder = '<svg viewBox="0 0 16 16"><path d="M1.8 4.2c0-.7.5-1.2 1.2-1.2h3l1.4 1.5H13c.7 0 1.2.5 1.2 1.2v6.1c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z"/></svg>';
  const I = {
    plus: '<svg viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9"/></svg>',
    folder,
    branch: '<svg viewBox="0 0 16 16"><path d="M4.5 2.5v11M4.5 10.5c0-3 7-2.5 7-6.5M11.5 2.5v1.5"/><circle cx="4.5" cy="12.6" r="1.4"/><circle cx="11.5" cy="3.2" r="1.4"/></svg>',
    effort: '<svg viewBox="0 0 16 16"><path d="M1.8 12A6.2 6.2 0 0 1 14.2 12"/><path d="M8 12 4.8 7.8"/><circle cx="8" cy="12" r="1.5"/></svg>',
    tier: '<svg class="tier" viewBox="0 0 13 12"><rect x="0" y="8" width="3" height="4" rx=".5"/><rect x="5" y="4" width="3" height="8" rx=".5"/><rect x="10" y="0" width="3" height="12" rx=".5"/></svg>',
    tierLow: '<svg class="tier" viewBox="0 0 13 12"><rect x="0" y="8" width="3" height="4" rx=".5"/><rect x="5" y="4" width="3" height="8" rx=".5" opacity=".3"/><rect x="10" y="0" width="3" height="12" rx=".5" opacity=".3"/></svg>',
    split: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M8 3v10"/></svg>',
    pop: '<svg viewBox="0 0 16 16"><path d="M9.5 2.5h4v4M13.5 2.5 8 8M12 9.5v3.2c0 .4-.4.8-.8.8H3.3c-.4 0-.8-.4-.8-.8V4.8c0-.4.4-.8.8-.8h3.2"/></svg>',
    attach: '<svg viewBox="0 0 16 16"><path d="M13 7.6 8.1 12.5a3.2 3.2 0 0 1-4.6-4.6l5.3-5.3a2.1 2.1 0 0 1 3 3L6.6 10.8a1 1 0 0 1-1.5-1.5l4.6-4.6"/></svg>',
    send: '<svg viewBox="0 0 16 16"><path d="M8 13V3.5M3.8 7.5 8 3.3l4.2 4.2"/></svg>',
    bolt: '<svg viewBox="0 0 10 14"><path d="M6 1 1.5 8H5l-1 5 4.5-7H5l1-5Z"/></svg>',
    warm: '<svg viewBox="0 0 16 16"><path d="M2.8 7.2h8v3.3a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3zM10.8 8.2h1.1a1.6 1.6 0 0 1 0 3.2h-1.1M5.3 2.4c-.6.8.6 1.5 0 2.4M8.3 2.4c-.6.8.6 1.5 0 2.4"/></svg>',
  };

  const TABS = [
    { name: 'queue races', on: true },
    { name: 'Lean tab cache rate' },
    { name: 'release 0.98.2', busy: true },
  ];

  const pips = (lit, of = 5) => `<span class="pips">${Array.from({ length: of }, (_, i) => `<i class="${i < lit ? 'on' : ''}"></i>`).join('')}</span>`;

  function tabs(o = {}) {
    const list = o.tabs || TABS;
    return `<div class="tabstrip">${list.map(t => `<span class="tab${t.on ? ' on' : ''}${t.busy ? ' busy' : ''}">${t.html || `<span class="dot"></span>${t.name}${t.small ? ` <small>${t.small}</small>` : ''}`}</span>`).join('')}
      <span class="tab-add">${I.plus}</span><span class="spacer"></span>
      <span class="ibtn" title="Keep warm while you're away">${I.warm}</span></div>`;
  }

  function subbar(o = {}) {
    const ctx = o.ctx ?? 23;
    const p5 = o.p5 ?? 54, p7 = o.p7 ?? 31;
    const model = o.model || { label: 'Opus' };
    return `<div class="subbar">
      <span class="chip">${I.folder}shellby</span>
      <span class="chip">${I.branch}fix/queue-races</span>
      <span class="chip">${I.effort}${o.effort || 'auto · medium'}</span>
      <span class="chip${model.lit ? ' lit' : ''}" id="modelChip">${model.low ? I.tierLow : I.tier}${model.label}${model.badge || ''}</span>
      <span class="chip"><span class="meter"><span>ctx</span><span class="track"><span class="fill" style="--p:${ctx}%${ctx >= 60 ? ';background:var(--amber)' : ''}"></span></span><span class="num">${ctx}%</span></span></span>
      <span class="spacer"></span>
      ${o.usage || `<span class="chip" id="usageChip"><span class="meter${p5 >= 80 ? ' warn' : ''}"><span>5h</span><span class="track"><span class="fill" style="--p:${p5}%"></span></span><span class="num">${p5}%</span><span class="when">resets 4:15</span></span>
      <span class="meter" style="margin-left:14px"><span>7d</span><span class="track"><span class="fill" style="--p:${p7}%"></span></span><span class="num">${p7}%</span></span></span>`}
      <span class="ibtn">${I.folder}</span><span class="ibtn">${I.split}</span><span class="ibtn">${I.pop}</span>
    </div>`;
  }

  // The tide line under a reply: earlier replies, this one, and the words.
  function foot(o = {}) {
    const past = o.past ?? 12, added = o.added ?? 11;
    const warn = past + added >= 60;
    return `<div class="foot${warn ? ' warn' : ''}">
      <div class="tf-bar" style="--past:${past}%;--added:${added}%"><i class="past"></i><i class="added"></i><i class="mark"></i></div>
      <div class="tf-line"><span class="state">${o.state || 'Done'}</span><span>${o.time || '2m 14s'}</span><span>${o.steps ?? 9} steps</span>${pips(o.effort ?? 3)}${o.extra || ''}
        <span class="room"><b>${past + added}% full</b> +${added} · ${o.tokens || '96k'}</span></div>
    </div>`;
  }

  // The box: what's stacked above it, the input row, the hint line.
  function composer(o = {}) {
    const text = o.text ? `${o.text}<span class="caret"></span>` : `<span class="empty">Give Shellby a task… (/ for commands, @ for files, ! to run one yourself)</span>`;
    const send = o.send ? `<span class="ibtn send wide">${o.send}${I.send}</span>` : `<span class="ibtn send">${I.send}</span>`;
    return `<footer class="composer"><div class="col">
      ${o.before || ''}
      <div class="input-row"><span class="ibtn">${I.attach}</span><div class="text${o.text ? '' : ' empty'}">${text}</div>${send}</div>
      <div class="input-hint"><span class="ultra${o.ultra ? ' on' : ''}">${I.bolt}${o.ultraLabel || 'Ultracode'}</span>${o.hint || ''}<span class="send-hint">Enter to send · Shift+Enter new line</span></div>
      ${o.after || ''}
    </div></footer>`;
  }

  // The conversation every chat concept sits in: a quick question, then the fix.
  function thread(o = {}) {
    return `${o.first === false ? '' : `<div class="msg you">Which part holds a message while Claude is still busy with the last one, the queue in main or the composer?</div>
    <div class="msg claude"><p>Main. The composer hands the message over at once; <code>src/main/queue.js</code> holds it per tab until the running turn ends, then sends it. The panel only mirrors the queue so the "Queued" row can show it.</p></div>
    ${foot({ past: 4, added: 8, time: '31s', steps: 2, effort: 1, tokens: '14k' })}`}
    <div class="msg you">The queue drops a message when two tabs send within the same tick. <code>test/queue.test.js</code> has a repro, <code>drops the second of two sends</code>.</div>
    <div class="steps">
      <div class="step"><i class="read">R</i>Read <code>src/main/queue.js</code><span class="tok">3.1k</span></div>
      <div class="step"><i class="run">$</i>node --test test/queue.test.js<span class="tok">1.4k</span></div>
      <div class="step"><i class="edit">E</i>Edit <code>src/main/queue.js</code> · 2 changes</div>
      <div class="step"><i class="run">$</i>node --test test/queue.test.js<span class="tok">0.6k</span></div>
    </div>
    <div class="msg claude"><p>Found it. <code>enqueue()</code> reads <code>pending.length</code> before the earlier call's push has landed, so the second send gets the same slot and overwrites the first. Each tab now has its own lock in <code>src/main/queue.js</code>, and sends land in order.</p><p>The repro passes, and so do the other 14 queue tests. Three files changed: the queue, its test, and a line in <code>docs/DEVELOPMENT.md</code> about the lock.</p></div>
    ${o.foot === false ? '' : foot({ past: 12, added: 11, ...(o.footOpts || {}) })}
    ${o.more ? `<div class="msg you">The Queued row in the panel still shows the old order for a tick after the fix. Cosmetic, but can it mirror the lock?</div>
    <div class="steps">
      <div class="step"><i class="read">R</i>Read <code>src/renderer/panel/feed-lanes.js</code><span class="tok">6.4k</span></div>
      <div class="step"><i class="read">R</i>Read <code>src/renderer/panel/feed.js</code><span class="tok">11.2k</span></div>
      <div class="step"><i class="edit">E</i>Edit <code>src/renderer/panel/feed-lanes.js</code> · 1 change</div>
      <div class="step"><i class="run">$</i>npm test<span class="tok loud">6.1k</span></div>
    </div>
    <div class="msg claude"><p>It was redrawing from the panel's own copy before main's summary arrived. The row now waits for the summary, so the order is right from the first paint. Tests pass; nothing else touched.</p></div>
    ${foot({ past: 23, added: 25, time: '1m 48s', steps: 6, effort: 2, tokens: '71k' })}
    <div class="msg you">Commit it on fix/queue-races, and note in changes/ that two quick sends no longer lose one.</div>
    <div class="steps">
      <div class="step"><i class="edit">E</i>Write <code>changes/queue-races.md</code></div>
      <div class="step"><i class="run">$</i>git add -A &amp;&amp; git commit<span class="tok">0.4k</span></div>
      <div class="step"><i class="run">$</i>git log<span class="tok loud">2.8k</span></div>
    </div>
    <div class="msg claude"><p>Committed as <code>fix: two sends in one tick no longer lose one</code> on <code>fix/queue-races</code>, with the note under <code>### Fixed</code>. Not pushed.</p></div>
    ${foot({ past: 48, added: 23, time: '52s', steps: 3, effort: 1, tokens: '38k' })}` : ''}`;
  }

  const parts = { tabs, subbar, foot, composer, thread };
  function mount() {
    document.querySelectorAll('[data-kit]').forEach(el => {
      const opts = el.dataset.opts ? JSON.parse(el.dataset.opts) : {};
      el.outerHTML = parts[el.dataset.kit](opts);
    });
  }
  window.kit = { I, pips, tabs, subbar, foot, composer, thread, mount };
})();
