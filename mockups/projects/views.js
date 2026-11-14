/* Helpers and the first three mockups. Everything here renders from
   PROJECTS in data.js, which is static placeholder text, but esc() still
   guards every interpolated string. */
'use strict';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const badge = (p, size = '') => `<i class="badge ${size}" style="--hue:${p.hue}">${esc(p.name[0].toUpperCase())}</i>`;

/** Pixel crab, drawn on a 12×9 grid so it stays crisp at any scale. */
function crab(px = 3) {
  const rows = ['.CC......CC.', 'C.C......C.C', '.CC.SSSS.CC.', '..CSSSSSSC..', '..SSSSSSSS..', '.CCCCCCCCCC.', 'C.CEC..CEC.C', '..C.C..C.C..', '.C..C..C..C.'];
  const fill = { C: 'var(--coral)', S: '#e0a35e', E: 'var(--abyss)' };
  const rects = rows.flatMap((r, y) => [...r].map((ch, x) => (fill[ch] ? `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill[ch]}"/>` : ''))).join('');
  return `<svg class="crab" width="${12 * px}" height="${9 * px}" viewBox="0 0 12 9" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

/** Bars for the week; today is the last bar. */
function spark(week, { w = 84, h = 22, today = 4, stretch = false } = {}) {
  const max = Math.max(8, ...week);
  const bw = w / week.length;
  const bars = week.map((v, i) => {
    const bh = Math.max(v ? 2 : 1, (v / max) * h);
    const cls = i === today ? 'b today' : v ? 'b' : 'b zero';
    return `<rect class="${cls}" x="${(i * bw + 1).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${bh.toFixed(1)}" rx="1"/>`;
  }).join('');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"${stretch ? ' preserveAspectRatio="none"' : ''} role="img" aria-label="${hours({ week })} hours this week">${bars}</svg>`;
}

const CI_TEXT = { pass: 'Passing', fail: 'Failing', run: 'Running', none: 'No CI' };
const ciMark = (p) => `<span class="ci ci-${p.ci}" title="${esc(p.ciNote)}">${CI_TEXT[p.ci]}</span>`;

function depsChip(d) {
  if (d.state === 'vulnerable') return `<span class="chip bad">${d.vulns} vulnerable${d.high ? `, ${d.high} high` : ''}</span>`;
  if (d.state === 'unreadable') return '<span class="chip warn">Couldn\'t check</span>';
  if (d.state === 'unchecked') return '<span class="chip">Never checked</span>';
  if (d.outdated) return `<span class="chip">${d.outdated} outdated</span>`;
  return '<span class="chip ok">Fresh</span>';
}

/** Everything a person could act on, each with the button that does it. */
function issues(p) {
  const out = [];
  if (p.ci === 'fail') out.push({ lane: 3, kind: 'CI', text: p.ciNote, act: 'Fix this build', alt: 'Ask why' });
  if (p.deps.high) out.push({ lane: 3, kind: 'Dependencies', text: `${p.deps.vulns} vulnerable packages, ${p.deps.high} high${p.deps.top ? `. Worst: ${p.deps.top}` : ''}`, act: 'Bump & open a PR', alt: 'See them' });
  if (p.review) out.push({ lane: 2, kind: 'Review', text: `${p.review.who} asked for your review on ${p.review.pr} "${p.review.title}", ${p.review.when}`, act: 'Read it with Claude', alt: 'Open' });
  if (p.ahead) out.push({ lane: 2, kind: 'Unpushed', text: `${p.ahead} commits are only on this PC. ${p.ciNote}.`, act: `Push ${p.ahead}`, alt: 'What\'s in them?' });
  if (p.dirty) out.push({ lane: 2, kind: 'Uncommitted', text: `${p.dirty} files changed on ${p.branch}, not committed`, act: 'Tidy up…', alt: 'Show changes' });
  p.stale.forEach((b) => out.push({ lane: 1, kind: 'Branch', text: `${b.name} is ${b.why}, last commit ${b.last}. Deleting it loses nothing.`, act: 'Delete', alt: 'Keep' }));
  if (p.deps.state === 'unreadable') out.push({ lane: 1, kind: 'Dependencies', text: `Couldn't check: ${p.deps.why}`, act: p.id === 'helm' ? 'Make a lockfile' : 'Check again', alt: 'Ignore' });
  if (p.notProject) out.push({ lane: 1, kind: 'Not a project?', text: p.notProject, act: 'Stop checking it', alt: 'It\'s a project' });
  if (p.flaky) out.push({ lane: 1, kind: 'Flaky test', text: 'e2e-voice failed 2 of the last 20 runs', act: 'Fix it', alt: 'Quarantine' });
  COPIES.filter((c) => c.project === p.id).forEach((c) => out.push({ lane: 1, kind: 'Copy', text: `Copy ${c.name} is ${c.why}`, act: 'Remove', alt: 'Keep' }));
  return out;
}

const btn = (label, cls = '') => `<button class="btn ${cls}">${esc(label)}</button>`;
const kbd = (k) => `<kbd>${esc(k)}</kbd>`;

/* ======================================================= 1. Triage lanes */
function viewTriage() {
  const lanes = [
    { n: 3, title: 'Broken', hint: 'Red builds and serious vulnerabilities', batch: '' },
    { n: 2, title: 'Waiting on you', hint: 'Reviews and work that\'s only on this PC', batch: '' },
    { n: 1, title: 'Tidy up', hint: 'Safe to clear in one pass', batch: 'Clear the safe ones' },
  ];
  const all = PROJECTS.flatMap((p) => issues(p).map((i) => ({ ...i, p })));
  const calm = PROJECTS.filter((p) => !issues(p).length);
  const n = (lane) => all.filter((i) => i.lane === lane).length;
  const card = (i) => `
    <article class="tcard sev${i.lane}">
      <header>${badge(i.p, 'sm')}<b>${esc(i.p.name)}</b><span class="tkind">${esc(i.kind)}</span></header>
      <p>${esc(i.text)}</p>
      <footer>${btn(i.act, i.lane === 3 ? 'primary' : 'solid')}${btn(i.alt, 'ghost')}</footer>
    </article>`;
  const lane = (l) => {
    const items = all.filter((i) => i.lane === l.n);
    return `<section class="lane lane${l.n}" aria-label="${l.title}">
      <header><h2>${l.title} <span class="count">${items.length}</span></h2><p>${l.hint}</p>${l.batch ? btn(l.batch, 'small') : ''}</header>
      <div class="lane-body">${items.map(card).join('')}</div>
    </section>`;
  };
  return `
  <div class="v-triage">
    <header class="pagehead">
      <div><h1>Projects</h1><p class="lede">${n(3)} broken, ${n(2)} waiting on you, and ${n(1)} you can clear in a minute. ${calm.length} projects are calm.</p></div>
      <div class="head-tools"><label class="search"><input placeholder="Find a project or a problem" aria-label="Find a project or a problem">${kbd('Ctrl F')}</label>${btn('Add a repo…', 'ghost')}${btn('Refresh', 'ghost')}</div>
    </header>
    <div class="lanes">
      ${lanes.map(lane).join('')}
      <section class="lane lane0" aria-label="Calm">
        <header><h2>Calm <span class="count">${calm.length}</span></h2><p>Nothing to do. Newest first.</p></header>
        <ul class="calm">${calm.map((p) => `<li>${badge(p, 'sm')}<span><b>${esc(p.name)}</b><small>${p.quiet ? `Quiet for ${p.quiet}` : `Last touched ${p.last}`}</small></span>${spark(p.week, { w: 56, h: 14 })}</li>`).join('')}</ul>
        <div class="calm-foot"><b>Running</b><p>${badge(PROJECTS[2], 'sm')} spoolandsteel is up on <a>:3000</a></p></div>
      </section>
    </div>
  </div>`;
}

/* ======================================================= 2. Cockpit */
function viewCockpit() {
  const sorted = [...PROJECTS].sort((a, b) => (b.pinned - a.pinned) || (severity(b) - severity(a)) || (a.lastSort - b.lastSort));
  const p = PROJECTS[0];
  const row = (q) => {
    const top = issues(q)[0];
    return `<li class="${q.id === p.id ? 'sel' : ''}" aria-selected="${q.id === p.id}">
      ${badge(q, 'sm')}<span class="nm"><b>${esc(q.name)}</b><small>${top ? esc(top.kind === 'Unpushed' ? `${q.ahead} unpushed` : top.kind) : `Last touched ${q.last}`}</small></span>
      <span class="dots"><i class="d ci-${q.ci}" title="CI"></i><i class="d ${q.deps.high ? 'bad' : q.deps.state === 'unreadable' ? 'warn' : 'ok'}" title="Dependencies"></i><i class="d ${q.ahead || q.dirty ? 'warn' : 'ok'}" title="Git"></i></span>
    </li>`;
  };
  const todos = ['Pick a Projects page redesign', 'Settings rail: wire the search to every pane', 'Share card: show the level badge at 2x', 'Flaky e2e-voice: pin the mic off', 'Winget PR #446825: answer the bot', 'Write the 0.98 changelog intro'];
  return `
  <div class="v-cockpit">
    <nav class="pane-list" aria-label="Projects">
      <label class="search"><input placeholder="Filter" aria-label="Filter projects">${kbd('/')}</label>
      <div class="seg" role="tablist"><button class="on">Needs you first</button><button>Recent</button><button>A–Z</button></div>
      <ul>${sorted.map(row).join('')}</ul>
      <p class="keys">${kbd('J')} ${kbd('K')} move ${kbd('Enter')} new conversation ${kbd('S')} start server</p>
    </nav>
    <article class="pane-main">
      <header class="phead">
        ${badge(p, 'lg')}
        <div><h1>${esc(p.name)} <span class="pin" title="Pinned">Pinned</span></h1><p class="mono">${esc(p.where)} on <b>${p.branch}</b> · <a>github.com/${p.gh}</a></p></div>
        <div class="phead-act">${btn('New conversation here', 'primary')}${btn('Resume where you left off', 'solid')}${btn(`Start ${p.server.script}`, 'ghost')}${btn('⋯', 'ghost icon')}</div>
      </header>
      <div class="needs"><b>Needs you</b> ${p.ahead} commits are only on this PC, and CI hasn't seen them. ${btn('Push them first', 'small')} ${btn('What\'s in them?', 'small ghost')}</div>
      <div class="pgrid">
        <section class="box nextup"><h2>Next up <span class="count">${p.todo}</span></h2>
          <ol>${todos.map((t, i) => `<li><span>${esc(t)}</span>${i === 0 ? '<small>To-do · added today</small>' : i === 3 ? '<small>Flaky test</small>' : i === 4 ? '<small>GitHub issue #212</small>' : '<small>To-do</small>'}${btn('Do this', 'small ghost')}</li>`).join('')}</ol>
        </section>
        <section class="box pulse"><h2>Pulse</h2>
          <div class="big"><b>${hours(p)}h</b> this week, most on Thursday</div>
          ${spark(p.week, { w: 520, h: 120, stretch: true })}
          <div class="daylbl">${DAYS.map((d) => `<span>${d}</span>`).join('')}</div>
          <dl><dt>Last commit</dt><dd>af4b864c feat: settings redesign mockups, 2h ago</dd><dt>Left off</dt><dd>${esc(p.leftOff)}</dd></dl>
        </section>
        <section class="box health"><h2>Health</h2>
          <ul class="checks">
            <li><i class="d ci-pass"></i><span><b>CI</b> passed on main 41m ago</span></li>
            <li><i class="d ok"></i><span><b>Dependencies</b> fresh, 1 outdated (electron-builder 26.1 → 26.2)</span>${btn('Bump & open a PR', 'small ghost')}</li>
            <li><i class="d warn"></i><span><b>Flaky test</b> e2e-voice, 2 of the last 20 runs</span>${btn('Fix it', 'small ghost')}${btn('Quarantine', 'small ghost')}</li>
          </ul>
        </section>
        <section class="box release"><h2>Releases</h2>
          <p>${esc(p.release)}. CI passed on the commit you'd release.</p>
          <div class="rgroups"><span><b>9</b> New</span><span><b>11</b> Fixed</span><span><b>1</b> Faster</span><span><b>2</b> Changed</span></div>
          ${btn('Draft v0.98.0', 'solid')}${btn('Write it with Claude', 'ghost')}
        </section>
        <section class="box convs"><h2>Conversations</h2>
          <ul>${['Settings redesign mockups|2h ago|copy: settings-rail', 'Share card stat tiles show big numbers whole|5h ago|merged home', 'Keep the split view saved through updates|yesterday|merged home'].map((c) => { const [t, w, s] = c.split('|'); return `<li><b>${esc(t)}</b><small>${w} · ${s}</small></li>`; }).join('')}</ul>
          ${btn('Where did we leave off?', 'ghost')}
        </section>
      </div>
    </article>
    <aside class="pane-side" aria-label="Across every project">
      <h2>Across every project</h2>
      ${PROJECTS.flatMap((q) => issues(q).filter((i) => q.id !== p.id && i.lane >= 2).map((i) => `<div class="side-item sev${i.lane}"><span>${badge(q, 'xs')} <b>${esc(q.name)}</b></span><p>${esc(i.text)}</p>${btn(i.act, 'small solid')}</div>`)).join('')}
      <h2 class="mt">Today</h2>
      <ol class="feed">
        <li><time>11:02</time> spoolandsteel dev server up on :3000</li>
        <li><time>10:41</time> shellby CI passed on main</li>
        <li><time>09:58</time> signwright build failed on PR #14</li>
        <li><time>09:15</time> dana-k asked for your review on atlassian-cloud-rebuilds #31</li>
      </ol>
    </aside>
  </div>`;
}

/* ======================================================= 3. Ledger */
function viewLedger() {
  const sorted = [...PROJECTS].sort((a, b) => (severity(b) - severity(a)) || (a.lastSort - b.lastSort));
  const filters = [['All', PROJECTS.length, true], ['Needs you', PROJECTS.filter((p) => severity(p) >= 2).length], ['Vulnerable', PROJECTS.filter((p) => p.deps.vulns).length], ['Unpushed', PROJECTS.filter((p) => p.ahead).length], ['Running', 1], ['Quiet 30d+', 2], ['GitHub only', 0]];
  const gitCell = (p) => {
    if (p.notProject) return '<span class="muted">No git</span>';
    const parts = [];
    if (p.ahead) parts.push(`<span class="chip warn">${p.ahead} unpushed</span>`);
    if (p.dirty) parts.push(`<span class="chip warn">${p.dirty} changed</span>`);
    if (p.stale.length) parts.push(`<span class="chip">${p.stale.length} stale branch</span>`);
    return parts.join(' ') || '<span class="muted">Clean</span>';
  };
  const serverCell = (p) => {
    if (!p.server) return '<span class="muted">None</span>';
    return p.server.state === 'up' ? `<span class="up">Up on <a>:${p.server.port}</a></span>` : `<button class="link">Start</button> <span class="mono muted">${esc(p.server.script)}</span>`;
  };
  const row = (p) => {
    const sel = ['home-4bc8fd', 'spoolandsteel', 'signwright'].includes(p.id);
    const open = p.id === 'spoolandsteel';
    const main = `<tr class="${sel ? 'sel' : ''} ${open ? 'open' : ''}">
      <td><input type="checkbox" ${sel ? 'checked' : ''} aria-label="Select ${esc(p.name)}"></td>
      <th scope="row">${badge(p, 'sm')}<span><b>${esc(p.name)}</b><small class="mono">${esc(p.where)}</small></span></th>
      <td class="mono">${esc(p.branch ?? '')}</td>
      <td>${gitCell(p)}</td>
      <td>${ciMark(p)}</td>
      <td>${depsChip(p.deps)}<small class="muted"> ${esc(p.deps.checked ?? '')}</small></td>
      <td>${p.flaky ? `<span class="chip warn">${p.flaky} flaky</span>` : '<span class="muted">0</span>'}</td>
      <td>${serverCell(p)}</td>
      <td class="num">${spark(p.week, { w: 70, h: 16 })}<span>${hours(p) || '·'}</span></td>
      <td>${esc(p.last)}</td>
      <td class="next">${esc(p.next)}</td>
    </tr>`;
    if (!open) return main;
    return `${main}<tr class="drawer"><td></td><td colspan="10">
      <div class="drawer-in">
        <div><h3>4 vulnerable packages</h3><ul class="vulns"><li><b>next</b> 14.2.3 → 14.2.18 <span class="chip bad">high</span> cache poisoning</li><li><b>sharp</b> 0.32.1 → 0.33.5 <span class="chip bad">high</span> libvips heap overflow</li><li><b>postcss</b> 8.4.21 → 8.4.47 <span class="chip">moderate</span></li><li><b>cookie</b> 0.5.0 → 0.7.2 <span class="chip">low</span></li></ul></div>
        <div><h3>What bumping does</h3><p>Claude updates these four in a copy of spoolandsteel, runs your tests, and opens a pull request. Your dev server on :3000 keeps running.</p>${btn('Bump & open a PR', 'primary')}${btn('Ask Claude first', 'ghost')}</div>
      </div></td></tr>`;
  };
  const cols = ['', 'Project, worst first', 'Branch', 'Git', 'CI', 'Dependencies', 'Tests', 'Dev server', 'This week', 'Last touched', 'Next up'];
  return `
  <div class="v-ledger">
    <header class="pagehead">
      <div><h1>Projects</h1><p class="lede">${PROJECTS.length} projects, one row each. Click a column to sort, tick rows to act on several at once.</p></div>
      <div class="head-tools"><label class="search"><input value="" placeholder="Filter rows" aria-label="Filter rows">${kbd('Ctrl F')}</label>${btn('Check every audit', 'ghost')}${btn('Add a repo…', 'ghost')}</div>
    </header>
    <div class="filters" role="tablist">${filters.map(([l, n, on]) => `<button class="${on ? 'on' : ''}" role="tab" aria-selected="${!!on}">${l} <span>${n}</span></button>`).join('')}<span class="sp"></span><button class="link">Columns…</button></div>
    <div class="bulk" role="region" aria-label="3 selected"><b>3 selected</b>${btn('Check dependencies again', 'small solid')}${btn('Bump & open PRs (13 packages)', 'small solid')}${btn('Open in terminal', 'small ghost')}${btn('Clear', 'small ghost')}</div>
    <div class="tablewrap"><table>
      <thead><tr>${cols.map((c, i) => `<th scope="col" ${i === 1 ? 'aria-sort="descending" class="sorted"' : ''}>${c}${i === 1 ? ' <span aria-hidden="true">▾</span>' : ''}</th>`).join('')}</tr></thead>
      <tbody>${sorted.map(row).join('')}</tbody>
    </table></div>
  </div>`;
}
