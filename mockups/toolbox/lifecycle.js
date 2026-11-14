// 3. A conversation's life: Setup laid out along one turn, from the memory
// that loads before you type to the sound when Claude's done. Every hook and
// rule sits at the moment it acts. "Play a turn" walks a real-looking one.
(function () {
  'use strict';
  const T = window.TB;
  const { esc, tok, total, glyph } = T;

  const STOPS = [
    { id: 'start', title: 'Before your first word', blurb: 'What every conversation loads and carries.' },
    { id: 'send', title: 'You send a message', blurb: 'Hooks here can add context to what you wrote.', event: 'UserPromptSubmit' },
    { id: 'tool', title: 'Claude reaches for a tool', blurb: 'Rules decide whether it runs, asks or is refused. Hooks here can stop it.', event: 'PreToolUse' },
    { id: 'after', title: 'A tool finishes', blurb: 'Hooks here can tidy what changed or trim what came back.', event: 'PostToolUse' },
    { id: 'ask', title: 'Claude needs you', blurb: 'When Claude stops to ask permission or a question.', event: 'Notification' },
    { id: 'done', title: 'Claude’s done', blurb: 'Hooks here can check the work, or send Claude back to it.', event: 'Stop' },
  ];

  // One turn, step by step: which stop lights, which items fire, what you'd see.
  const TURN = [
    { stop: 'start', fire: ['mem-user', 'mem-project', 'mem-auto'], who: 'shellby', text: 'Loaded 3 memory files and 5 MCP servers.' },
    { stop: 'send', fire: ['git-context'], who: 'you', text: 'Fix the login redirect and push it.', aside: 'git-context added: on fix-login-redirect, 3 files changed.' },
    { stop: 'tool', fire: ['guard-secrets', 'r7'], who: 'claude', text: 'Read .env.local', verdict: 'deny', aside: 'Refused. Claude reads .env.example instead.' },
    { stop: 'tool', fire: ['r1'], who: 'claude', text: 'npm test', verdict: 'allow', aside: 'Allowed without asking.' },
    { stop: 'after', fire: ['quiet-output'], who: 'shellby', text: '1,912 lines of test output trimmed to the 14 that failed.' },
    { stop: 'after', fire: ['prettier'], who: 'claude', text: 'Edit src/auth/redirect.js', aside: 'prettier formatted the file.' },
    { stop: 'tool', fire: ['guard-git'], who: 'claude', text: 'git push --force', verdict: 'deny', aside: 'Blocked: force pushes are off. Claude pushes normally.' },
    { stop: 'tool', fire: ['r5'], who: 'claude', text: 'git push origin fix-login-redirect', verdict: 'ask', aside: 'This rule says ask first.' },
    { stop: 'ask', fire: ['sound-ask'], who: 'shellby', text: '♪ Claude is asking to push. You press Allow.' },
    { stop: 'done', fire: ['tests-pass', 'sound-done'], who: 'shellby', text: '♪ Done. Shellby plays the finish sound.' },
  ];
  const STEP_MS = 1500;

  // Claude Code's order: deny wins, then ask, then allow; nothing matching means ask.
  function judge(rules, hooks, input) {
    const raw = input.trim();
    if (!raw) return null;
    const read = raw.match(/^(read|open|cat)\s+(.+)$/i);
    const tool = read ? 'Read' : 'Bash';
    const arg = read ? read[2] : raw;
    const live = hooks.filter(h => !h.paused);
    if (tool === 'Bash' && /git\s+(push\b.*(--force|-f\b)|reset\s+--hard)/.test(arg) && live.some(h => h.id === 'guard-git')) {
      return { verdict: 'deny', why: 'The guard-git hook stops force pushes and hard resets before any rule is checked.', by: 'guard-git' };
    }
    if (/\.env|id_rsa|\.pem$/.test(arg) && live.some(h => h.id === 'guard-secrets')) {
      return { verdict: 'deny', why: 'The guard-secrets hook keeps Claude out of .env and key files.', by: 'guard-secrets' };
    }
    const matches = rules.filter(r => {
      const m = r.rule.match(/^(\w+)\((.*)\)$/);
      if (!m || m[1] !== tool) return false;
      let pat = m[2];
      if (tool === 'Read') { pat = pat.replace(/^\.\//, ''); const a = arg.replace(/^\.\//, ''); return pat.endsWith('*') ? a.startsWith(pat.slice(0, -1)) : a === pat; }
      return pat.endsWith(':*') ? arg === pat.slice(0, -2) || arg.startsWith(`${pat.slice(0, -2)} `) : arg === pat;
    });
    for (const list of ['deny', 'ask', 'allow']) {
      const r = matches.find(x => x.list === list);
      if (r) return { verdict: list, by: r.id, why: `${r.rule}, in ${r.source === 'project' ? 'this project’s settings' : 'your settings'}.` };
    }
    return { verdict: 'ask', why: 'No rule matches, so Claude asks you first. That’s the default.', by: null };
  }
  const VERDICT = { allow: 'Runs without asking', ask: 'Claude asks you first', deny: 'Refused' };

  function mount(phone) {
    const d = T.clone();
    const st = { open: new Set(['tool']), adding: null, step: -1, timer: null, test: 'git push origin main', fresh: null };
    const carried = d.BASELINE.tokens + total(d.memory.map(m => m.tokens)) + total(d.items.map(i => i.tokens));
    TURN[0] = { ...TURN[0], text: `Loaded ${d.memory.filter(m => !m.scoped).length} memory files and ${d.items.filter(i => i.kind === 'mcp').length} MCP servers: ${tok(carried)} tokens before a word.` };
    const listed = d.items.filter(i => ['skill', 'agent', 'command'].includes(i.kind));
    const servers = d.items.filter(i => i.kind === 'mcp');

    phone.innerHTML = `
      <div class="bar"><h3>Setup</h3><button type="button" class="btn primary lc-play" data-act="play">▶ Play a turn</button></div>
      <div class="lc">
        <div class="lc-line scroll"><ol class="lc-stops"></ol></div>
        <aside class="lc-feed" aria-label="The turn" aria-live="polite"></aside>
      </div>`;
    const $ = s => phone.querySelector(s);

    const hookRow = h => `<li class="lc-item${h.paused ? ' paused' : ''}${st.fresh === h.id ? ' fresh' : ''}" data-item="${esc(h.id)}">
      ${glyph('hook', 22)}<span class="lc-t"><b>${esc(h.name)}</b><small>${h.matcher ? `on ${esc(h.matcher.replace(/\|/g, ', '))}, ` : ''}${h.source === 'project' ? 'this project' : 'yours'}${h.adds ? `, adds ~${h.adds} tokens a message` : ''}</small></span>
      <button type="button" class="btn quiet" data-act="pause" data-id="${esc(h.id)}">${h.paused ? 'Resume' : 'Pause'}</button></li>`;

    function stopBody(s) {
      const hooks = d.hooks.filter(h => h.event === s.event);
      let html = '';
      if (s.id === 'start') {
        html += `<p class="lc-carry"><b>${tok(carried)}</b> tokens, ${Math.round((carried / d.WINDOW) * 100)}% of the window</p><ul class="lc-items">`;
        html += d.memory.map(m => `<li class="lc-item" data-item="${esc(m.id)}">${glyph('memory', 22)}<span class="lc-t"><b>${esc(m.name)}</b><small>${esc(m.loads)}, ${tok(m.tokens)} tokens</small></span><button type="button" class="btn quiet" data-act="edit" data-id="${esc(m.id)}">Edit</button></li>`).join('');
        html += `<li class="lc-item">${glyph('mcp', 22)}<span class="lc-t"><b>${servers.length} MCP servers</b><small>${tok(total(servers.map(x => x.tokens)))} tokens of tool listings</small></span></li>`;
        html += `<li class="lc-item">${glyph('skill', 22)}<span class="lc-t"><b>${listed.length} skills, agents and commands</b><small>${tok(total(listed.map(x => x.tokens)))} tokens of descriptions</small></span></li></ul>`;
        return html;
      }
      if (s.id === 'tool') {
        const r = judge(d.rules, d.hooks, st.test);
        html += `<div class="lc-test"><label for="lcTest">Would Claude be allowed to run</label>
          <input id="lcTest" class="field mono" value="${esc(st.test)}" spellcheck="false" autocomplete="off">
          <p class="lc-verdict v-${r ? r.verdict : 'none'}">${r ? `<b>${VERDICT[r.verdict]}.</b> ${esc(r.why)}` : 'Type a command, or “read” and a path.'}</p></div>`;
        const groups = ['allow', 'ask', 'deny'].map(list => {
          const these = d.rules.filter(x => x.list === list);
          return `<div class="lc-rules"><span class="lc-rl l-${list}">${{ allow: 'Runs', ask: 'Asks', deny: 'Refused' }[list]}</span>${these.map(x => `<span class="lc-rule${r && r.by === x.id ? ' hit' : ''}" data-item="${esc(x.id)}" title="${x.source === 'project' ? 'This project' : 'Yours'}">${esc(x.rule)}</span>`).join('')}</div>`;
        }).join('');
        html += groups;
      }
      if (hooks.length) html += `<ul class="lc-items">${hooks.map(hookRow).join('')}</ul>`;
      else if (s.event) html += '<p class="muted lc-none">Nothing runs here yet.</p>';
      if (s.event) {
        const recipes = d.recipes.filter(x => x.event === s.event && !d.hooks.some(h => h.recipe === x.id));
        html += st.adding === s.id
          ? `<div class="lc-add"><p>Add at this moment:</p>${recipes.map(x => `<button type="button" class="btn" data-act="recipe" data-id="${esc(x.id)}">${esc(x.name)}</button>`).join('')}<button type="button" class="btn quiet" data-act="ask-claude">Describe one for Claude to write</button></div>`
          : `<button type="button" class="lc-plus" data-act="add" data-stop="${s.id}">+ Add something here</button>`;
      }
      return html;
    }

    function render() {
      const cur = st.step >= 0 ? TURN[st.step] : null;
      $('.lc-stops').innerHTML = STOPS.map(s => {
        const n = s.id === 'start' ? d.memory.length : s.id === 'tool' ? d.rules.length + d.hooks.filter(h => h.event === s.event).length : d.hooks.filter(h => h.event === s.event).length;
        const open = st.open.has(s.id) || (cur && cur.stop === s.id);
        return `<li class="lc-stop${open ? ' open' : ''}${cur && cur.stop === s.id ? ' live' : ''}" data-stop="${s.id}">
          <button type="button" class="lc-head" data-act="toggle" data-stop="${s.id}" aria-expanded="${open}">
            <span class="lc-dot" aria-hidden="true"></span><span class="lc-ht"><b>${s.title}</b><small>${s.blurb}</small></span><span class="lc-n">${n || ''}</span></button>
          ${open ? `<div class="lc-body">${stopBody(s)}</div>` : ''}</li>`;
      }).join('');
      if (cur) cur.fire.forEach(id => phone.querySelectorAll(`[data-item="${CSS.escape(id)}"]`).forEach(el => el.classList.add(isPaused(id) ? 'skipped' : 'firing')));
      feed();
    }

    const isPaused = id => Boolean(d.hooks.find(h => h.id === id)?.paused);
    const pausedIn = x => x.fire.filter(isPaused).map(id => d.hooks.find(h => h.id === id).name);

    function feed() {
      const shown = TURN.slice(0, st.step + 1);
      $('.lc-feed').innerHTML = st.step < 0
        ? `<div class="lc-feed-empty">${T.crab(4)}<p>Press <b>Play a turn</b> to watch one message go through your setup: what loads, what’s allowed, what gets blocked, and what plays when it’s done.</p></div>`
        : `<ol>${shown.map((x, i) => `<li class="who-${x.who}${i === st.step ? ' now' : ''}">
            <span class="lc-who">${x.who === 'you' ? 'You' : x.who === 'claude' ? 'Claude' : 'Shellby'}</span>
            <span class="${x.who === 'claude' ? 'mono' : ''}">${esc(x.text)}</span>
            ${x.verdict ? `<span class="lc-v v-${x.verdict}">${VERDICT[x.verdict]}</span>` : ''}
            ${x.aside ? `<small>${esc(x.aside)}</small>` : ''}
            ${pausedIn(x).length ? `<small class="lc-skip">Paused, so skipped: ${esc(pausedIn(x).join(', '))}</small>` : ''}</li>`).join('')}</ol>`;
      const now = $('.lc-feed li.now');
      if (now) now.scrollIntoView({ block: 'nearest' });
    }

    function play() {
      clearTimeout(st.timer);
      st.step = 0;
      const tick = () => {
        render();
        phone.querySelector('.lc-stop.live')?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        if (st.step < TURN.length - 1) st.timer = setTimeout(() => { st.step += 1; tick(); }, STEP_MS);
        else $('.lc-play').textContent = '▶ Play again';
      };
      $('.lc-play').textContent = 'Playing…';
      tick();
    }

    phone.addEventListener('click', e => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      const id = t.dataset.id;
      switch (t.dataset.act) {
        case 'play': play(); break;
        case 'toggle': { const s = t.dataset.stop; st.open.has(s) ? st.open.delete(s) : st.open.add(s); if (st.adding === s) st.adding = null; render(); break; }
        case 'add': st.adding = t.dataset.stop; render(); break;
        case 'pause': { const h = d.hooks.find(x => x.id === id); h.paused = !h.paused; render(); T.toast(phone, h.paused ? `Paused. Claude Code skips it until you resume.` : 'Resumed'); break; }
        case 'recipe': {
          const r = d.recipes.find(x => x.id === id);
          d.hooks.push({ id: r.id, recipe: r.id, event: r.event, name: r.name, matcher: r.event === 'PreToolUse' ? 'Bash' : '', source: 'yours' });
          st.adding = null; st.fresh = r.id; render();
          T.toast(phone, `Added: ${r.name}`, () => { d.hooks = d.hooks.filter(x => x.id !== r.id); render(); });
          break;
        }
        case 'ask-claude': T.toast(phone, 'A new tab opened with Claude, ready to write the hook'); break;
        case 'edit': T.toast(phone, 'Opened in the editor'); break;
      }
    });
    phone.addEventListener('input', e => {
      if (e.target.id !== 'lcTest') return;
      st.test = e.target.value;
      const r = judge(d.rules, d.hooks, st.test);
      const v = $('.lc-verdict');
      v.className = `lc-verdict v-${r ? r.verdict : 'none'}`;
      v.innerHTML = r ? `<b>${VERDICT[r.verdict]}.</b> ${esc(r.why)}` : 'Type a command, or “read” and a path.';
      phone.querySelectorAll('.lc-rule').forEach(x => x.classList.toggle('hit', Boolean(r && r.by === x.dataset.item)));
    });

    render();
    return () => clearTimeout(st.timer);
  }

  T.register({
    id: 'lifecycle',
    name: 'A conversation’s life',
    line: 'Setup as the moments of one turn',
    mount,
    notes: {
      pitch: [
        'Hooks, rules and memory are hard to follow because they’re listed by type, while what they do depends on when they act. This puts them on the timeline of one turn: what loads first, what runs when you send, what decides whether a command runs, and what plays at the end.',
        'Adding something happens at a moment, not in a form. “+ Add something here” under “A tool finishes” offers only the recipes that make sense there.',
      ],
      tryIt: [
        'Press <b>▶ Play a turn</b>. One message runs through this setup: a .env read refused, tests allowed, a force push blocked, a sound when it’s done.',
        'In the rule tester, type <b>npm test</b>, <b>git push --force</b>, <b>read .env.local</b> or <b>rm -rf dist</b>. The rule that decides it lights up.',
        'Pause <b>prettier</b>, then play again.',
        'Open <b>A tool finishes</b> and add “Keep a log of every command”. Undo is in the toast.',
        'Switch to <b>Window</b>: the turn plays in a transcript column beside the timeline.',
      ],
      map: [
        ['Setup › Hooks', 'Each hook sits at the moment it runs, in plain words.'],
        ['Setup › Rules', 'Under “Claude reaches for a tool”, as Runs, Asks and Refused, with a tester.'],
        ['Setup › Memory', 'Under “Before your first word”, with its token cost.'],
        ['MCP', 'Summed under “Before your first word”. Managing servers stays in Tools.'],
        ['Team', 'A pack’s hooks and rules would land at their moments with a team mark.'],
      ],
      tradeoff: 'This is for understanding and tuning your setup, not browsing skills. It replaces the Setup tab and leaves Tools to one of the others.',
    },
  });
})();
