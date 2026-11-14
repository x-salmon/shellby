// 4. Pegboard: the toolbox opens on what you reach for. Pinned tools hang on
// a bench with number keys, the crew sits on a shelf with their records, and
// a "reach for" box finds a tool by what you want done, not by its name.
(function () {
  'use strict';
  const T = window.TB;
  const { esc, ago, total, glyph, KINDS } = T;

  const BENCH = ['code-reviewer', 'sn-review', 'frontend-design', 'commit-push-pr', 'Explore', 'rename-screenshots'];
  const STOP = new Set(['a', 'an', 'the', 'to', 'i', 'my', 'and', 'of', 'for', 'in', 'on', 'it', 'this', 'that', 'want', 'with', 'some', 'up', 'do', 'make']);
  const ALIAS = { spreadsheet: 'xlsx', excel: 'xlsx', word: 'docx', slides: 'pptx', deck: 'pptx', bug: 'debugger', error: 'debugger', crash: 'debugger', photos: 'screenshots', images: 'screenshots', ui: 'design', page: 'design', ship: 'pull', pr: 'pull', docs: 'library' };

  const words = s => s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w));

  function reach(items, market, q) {
    const qs = words(q).flatMap(w => (ALIAS[w] ? [w, ALIAS[w]] : [w]));
    if (!qs.length) return null;
    const score = it => {
      const hay = words(`${it.name} ${it.desc}`);
      const hits = qs.filter(w => hay.some(h => h.startsWith(w) || w.startsWith(h) && h.length > 3));
      return { it, hits, s: hits.length + (hits.some(h => it.name.includes(h)) ? 1 : 0) };
    };
    const mine = items.map(score).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3);
    const more = market.filter(m => !m.installed).map(score).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 2);
    return { mine, more };
  }

  function mount(phone) {
    const d = T.clone();
    const usable = d.items.filter(i => ['skill', 'agent', 'command', 'snippet'].includes(i.kind));
    const st = { bench: [...BENCH], crab: null, q: '', drag: null };
    const byId = id => d.items.find(i => i.id === id);

    phone.innerHTML = `
      <div class="bar"><h3>Toolbox</h3><button type="button" class="btn quiet" data-act="browse">Browse all ${d.items.length}</button></div>
      <div class="pg scroll">
        <div class="pg-reach">
          <label for="pgReach">Reach for something</label>
          <input id="pgReach" class="field" placeholder="Say what you want done, like “tidy a csv” or “find the bug”" autocomplete="off">
          <div class="pg-found" aria-live="polite"></div>
        </div>
        <section class="pg-bench" aria-labelledby="pgBenchH">
          <div class="pg-h"><h4 id="pgBenchH">Your bench</h4><span class="muted">Press a number to use one. Drag to rearrange.</span></div>
          <ol class="pg-board"></ol>
        </section>
        <section class="pg-crew" aria-labelledby="pgCrewH">
          <div class="pg-h"><h4 id="pgCrewH">Crew</h4><span class="muted pg-crew-sum"></span></div>
          <div class="pg-shelf" role="list"></div>
          <div class="pg-record" aria-live="polite"></div>
        </section>
        <section class="pg-lately" aria-labelledby="pgLateH">
          <div class="pg-h"><h4 id="pgLateH">Lately</h4></div>
          <ul class="pg-late"></ul>
        </section>
        <section class="pg-rest">
          <div class="pg-kinds"></div>
          <p class="pg-dust"></p>
        </section>
      </div>`;
    const $ = s => phone.querySelector(s);

    function bench() {
      const tiles = st.bench.map((id, i) => {
        const it = byId(id);
        const k = KINDS[it.kind];
        const week = Array.isArray(it.uses) ? it.uses[5] : 0;
        const c = it.kind === 'agent' ? d.crew.find(x => x.agent === it.id) : null;
        return `<li class="pg-tile" draggable="true" data-id="${esc(id)}" style="--k:${k.color}">
          <button type="button" class="pg-use" data-act="use" data-id="${esc(id)}" aria-keyshortcuts="${i + 1}">
            <span class="pg-key">${i + 1}</span>
            ${c ? T.crab(3, c.tint) : glyph(it.kind, 28)}
            <b>${esc(it.name)}</b>
            <small>${esc(it.desc)}</small>
            <span class="pg-meta">${week ? `${week}× this week` : `last ${ago(it.lastUsed)}`}${c ? `, ${esc(c.name)} Lv ${c.level}` : ''}</span>
          </button>
          <button type="button" class="pg-unpin" data-act="unpin" data-id="${esc(id)}" aria-label="Take ${esc(it.name)} off the bench" title="Take off the bench">✕</button>
        </li>`;
      });
      const free = 8 - st.bench.length;
      if (free > 0) tiles.push(`<li class="pg-tile empty"><button type="button" class="pg-use" data-act="suggest">+ Hang another<small>We’d suggest ${esc(suggest()?.name || 'something you use')}</small></button></li>`);
      $('.pg-board').innerHTML = tiles.join('');
    }

    function suggest() {
      return usable.filter(i => !st.bench.includes(i.id) && Array.isArray(i.uses)).sort((a, b) => total(b.uses) - total(a.uses))[0];
    }

    function crew() {
      const runs = total(d.crew.map(c => c.runs));
      const acted = total(d.crew.map(c => c.acted));
      $('.pg-crew-sum').textContent = `${d.crew.length} crabs, ${runs} runs, ${Math.round((acted / runs) * 100)}% acted on`;
      $('.pg-shelf').innerHTML = d.crew.map(c => `<button type="button" role="listitem" class="pg-crab${st.crab === c.agent ? ' on' : ''}" data-act="crab" data-id="${esc(c.agent)}">
        ${T.crab(4, c.tint, `${c.name}, the ${c.agent} crab`)}<b>${esc(c.name)}</b><small>Lv ${c.level}</small></button>`).join('');
      const c = d.crew.find(x => x.agent === st.crab);
      $('.pg-record').innerHTML = c ? `<div class="pg-rec" style="--k:${c.tint}">
        <div class="pg-rec-h">${T.crab(6, c.tint)}<div><b>${esc(c.name)}</b><span class="muted">${esc(c.agent)}, out last ${esc(c.last)}</span>
          <div class="pg-xp" role="img" aria-label="${Math.round(c.xp * 100)}% of the way to level ${c.level + 1}"><i style="width:${c.xp * 100}%"></i></div><small class="muted">Level ${c.level}, ${Math.round(c.xp * 100)}% of the way to ${c.level + 1}</small></div></div>
        <dl><div><dt>Runs</dt><dd>${c.runs}</dd></div><div><dt>Acted on</dt><dd>${c.acted}</dd></div><div><dt>Hit rate</dt><dd>${Math.round((c.acted / Math.max(1, c.runs)) * 100)}%</dd></div><div><dt>Tokens</dt><dd>${esc(c.tokens)}</dd></div></dl>
        <div class="pg-rec-a"><button type="button" class="btn primary" data-act="chat" data-id="${esc(c.agent)}">Chat as ${esc(c.name)}</button><button type="button" class="btn quiet" data-act="hat">Pick a hat</button></div></div>` : '';
    }

    function lately() {
      const recent = usable.filter(i => i.lastUsed != null && i.lastUsed <= 2 && Array.isArray(i.uses)).sort((a, b) => a.lastUsed - b.lastUsed || b.uses[5] - a.uses[5]).slice(0, 6);
      $('.pg-late').innerHTML = recent.map(i => `<li>${glyph(i.kind, 20)}<span><b>${esc(i.name)}</b> <span class="muted">${i.uses[5]}× this week</span></span><span class="muted">${ago(i.lastUsed)}</span>
        ${st.bench.includes(i.id) ? '<span class="pg-on" title="On your bench">★</span>' : `<button type="button" class="btn quiet" data-act="pin" data-id="${esc(i.id)}">Hang it</button>`}</li>`).join('');
    }

    function rest() {
      const counts = ['skill', 'agent', 'command', 'mcp', 'snippet', 'mod'].map(k => [k, d.items.filter(i => i.kind === k).length]);
      $('.pg-kinds').innerHTML = counts.map(([k, n]) => `<button type="button" class="pg-kind" data-act="browse" style="--k:${KINDS[k].color}">${glyph(k, 20)}<b>${n}</b> ${KINDS[k].many}</button>`).join('');
      const dust = d.items.filter(i => T.isIdle(i, d.IDLE_DAYS));
      $('.pg-dust').innerHTML = `<b>${dust.length} things gathering dust.</b> They haven’t been used in three weeks. <button type="button" class="link" data-act="dust">Sort them out</button>`;
    }

    function found() {
      const r = reach(usable, d.market, st.q);
      const box = $('.pg-found');
      if (!r) { box.innerHTML = ''; return; }
      const hit = x => `<li><button type="button" class="pg-hit" data-act="use" data-id="${esc(x.it.id)}">${glyph(x.it.kind, 24)}<span><b>${esc(x.it.name)}</b><small>${esc(x.it.desc)}</small><em>Matched “${esc(x.hits.join('”, “'))}”</em></span><span class="btn primary">Use</span></button></li>`;
      const shop = x => `<li><div class="pg-hit shop"><span class="kg" style="--k:var(--sand-dim);--s:24px">+</span><span><b>${esc(x.it.name)}</b><small>${esc(x.it.desc)}</small><em>${esc(x.it.kinds)}, from ${esc(x.it.market)}</em></span><button type="button" class="btn" data-act="install" data-id="${esc(x.it.id)}">Install</button></div></li>`;
      box.innerHTML = r.mine.length
        ? `<ul>${r.mine.map(hit).join('')}</ul>${r.more.length ? `<p class="muted">Also in the marketplaces:</p><ul>${r.more.map(shop).join('')}</ul>` : ''}`
        : r.more.length ? `<p>Nothing you have does that. ${r.more.length === 1 ? 'One plugin' : `${r.more.length} plugins`} might:</p><ul>${r.more.map(shop).join('')}</ul>`
          : `<p>Nothing you have does that, and no marketplace plugin matches. <button type="button" class="link" data-act="make">Have Claude make a skill for it</button></p>`;
    }

    function all() { bench(); crew(); lately(); rest(); found(); }

    phone.addEventListener('click', e => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      const it = byId(t.dataset.id);
      switch (t.dataset.act) {
        case 'use': T.toast(phone, it.kind === 'agent' ? `Started a conversation that hands off to ${it.name}` : `Opened a new conversation with ${it.name}`); break;
        case 'unpin': { const at = st.bench.indexOf(it.id); st.bench.splice(at, 1); all(); T.toast(phone, `Took ${it.name} off the bench`, () => { st.bench.splice(at, 0, it.id); all(); }); break; }
        case 'pin': if (st.bench.length < 9) { st.bench.push(it.id); all(); T.toast(phone, `Hung ${it.name} on the bench, key ${st.bench.length}`); } break;
        case 'suggest': { const s = suggest(); if (s) { st.bench.push(s.id); all(); T.toast(phone, `Hung ${s.name}: you used it ${total(s.uses)} times in six weeks`); } break; }
        case 'crab': st.crab = st.crab === t.dataset.id ? null : t.dataset.id; crew(); break;
        case 'chat': T.toast(phone, `Opened a conversation as ${d.crew.find(c => c.agent === t.dataset.id).name}`); break;
        case 'hat': T.toast(phone, 'The hat rack opens here: three unlocked at this level'); break;
        case 'install': { const m = d.market.find(x => x.id === t.dataset.id); t.textContent = 'Installing…'; t.disabled = true; setTimeout(() => { t.textContent = 'Installed'; T.toast(phone, `Installed ${m.name}. It’s ready in new conversations.`); }, 900); break; }
        case 'browse': T.toast(phone, 'Browse all opens the full list (mockup 1 or 5)'); break;
        case 'dust': T.toast(phone, 'Opens Triage on the Dead weight corner (mockup 2)'); break;
        case 'make': T.toast(phone, 'A new tab opened with Claude, ready to write the skill'); break;
      }
    });
    $('#pgReach').addEventListener('input', e => { st.q = e.target.value; found(); });

    // Number keys use a bench tile, unless you're typing.
    const onKey = e => {
      if (e.target.matches('input, textarea') || e.ctrlKey || e.altKey || e.metaKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= st.bench.length) {
        const tile = phone.querySelectorAll('.pg-tile:not(.empty) .pg-use')[n - 1];
        tile.classList.add('pressed');
        setTimeout(() => tile.classList.remove('pressed'), 180);
        tile.click();
      }
    };
    addEventListener('keydown', onKey);

    // Drag to rearrange the bench.
    const board = $('.pg-board');
    board.addEventListener('dragstart', e => { const li = e.target.closest('.pg-tile'); if (!li) return; st.drag = li.dataset.id; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    board.addEventListener('dragend', () => { st.drag = null; board.querySelectorAll('.dragging,.over').forEach(x => x.classList.remove('dragging', 'over')); });
    board.addEventListener('dragover', e => { const li = e.target.closest('.pg-tile:not(.empty)'); if (!li || !st.drag) return; e.preventDefault(); board.querySelectorAll('.over').forEach(x => x.classList.remove('over')); li.classList.add('over'); });
    board.addEventListener('drop', e => {
      const li = e.target.closest('.pg-tile:not(.empty)');
      if (!li || !st.drag || li.dataset.id === st.drag) return;
      e.preventDefault();
      const next = st.bench.filter(id => id !== st.drag);
      next.splice(next.indexOf(li.dataset.id) + (st.bench.indexOf(st.drag) < st.bench.indexOf(li.dataset.id) ? 1 : 0), 0, st.drag);
      st.bench = next;
      all();
    });

    all();
    return () => removeEventListener('keydown', onKey);
  }

  T.register({
    id: 'pegboard',
    name: 'Pegboard',
    line: 'Opens on what you reach for',
    mount,
    notes: {
      pitch: [
        'Most visits to the toolbox are to use something. This one opens on a bench of the tools you pin, each a key press away, with how often you’ve used it this week. Everything else is a count you can open.',
        'The crew stops hiding behind the Agents chip and sits on a shelf on the first screen. An agent hung on the bench shows its crab and level. A box at the top finds a tool by what you want done, and offers a marketplace plugin when nothing you have fits.',
      ],
      tryIt: [
        'Press <b>1</b> to <b>6</b> to use a bench tool. Drag tiles to reorder them, ✕ to take one down.',
        'Type “<b>tidy a csv</b>”, “<b>find the bug</b>” or “<b>make a spreadsheet</b>”. Then try “<b>kubernetes</b>”, which you don’t have, and install it.',
        'Click a crab on the shelf for its record and “Chat as”.',
        'In <b>Lately</b>, press <b>Hang it</b> on something you use but haven’t pinned.',
        'Switch to <b>Window</b>: the bench gets four across, with the crew and Lately beside it.',
      ],
      map: [
        ['Tools', 'Pinned and recent on the bench. The full list is one press away (“Browse all”).'],
        ['Snippets', 'Hang on the bench like anything else: /review is key 2.'],
        ['Crew', 'A shelf on the first screen, each record one click away.'],
        ['Lean', 'One line, “13 things gathering dust”, which opens Triage.'],
        ['Get more', 'Comes up in “Reach for” when nothing you have fits.'],
        ['Setup, Team', 'Not here. This view is for using things, so it pairs with mockup 3 for Setup.'],
      ],
      tradeoff: 'It’s the most welcoming of the five and the least complete: cleaning up and configuring live a level down. Good as the toolbox’s front door, with mockup 1 or 5 as the “Browse all” behind it.',
    },
  });
})();
