/* Mockups 4–6. Shares helpers from views.js. */
'use strict';

/* ======================================================= 4. Tide chart */
function viewTide() {
  const N = 28;
  const dayLabel = (i) => {
    const d = new Date(2026, 10, 13 - (N - 1 - i));
    return d.getDay() === 1 ? `${d.getMonth() + 1}/${d.getDate()}` : '';
  };
  const active = PROJECTS.filter((p) => !p.notProject).sort((a, b) => a.lastSort - b.lastSort);
  const total = active.reduce((s, p) => s + hours(p), 0);
  const cell = (v, i) => `<i class="t t${Math.min(4, Math.ceil(v / 2))}${i === N - 1 ? ' now' : ''}" title="${v}h"></i>`;
  const marks = (p) => {
    const m = [];
    if (p.ci === 'fail') m.push('<span class="mark bad" style="--at:24">Build failed</span>');
    if (p.server?.state === 'up') m.push('<span class="mark ok" style="--at:27">Up on :3000</span>');
    return m.join('');
  };
  const row = (p) => `
    <li class="trow ${p.lastSort > 20 ? 'quiet' : ''}">
      <span class="tname">${badge(p, 'sm')}<b>${esc(p.name)}</b></span>
      <span class="tcells">${p.tide.map(cell).join('')}${marks(p)}</span>
      <span class="tlast">${esc(p.last)}</span>
      <span class="tact">${p.lastSort > 20 ? btn('Nudge me', 'small ghost') + btn('Archive', 'small ghost') : btn('New conversation', 'small ghost')}</span>
    </li>`;
  const split = active.filter((p) => hours(p) > 0);
  return `
  <div class="v-tide">
    <header class="pagehead">
      <div><h1>Projects</h1><p class="lede">Four weeks of where your time went. Brighter is more hours; the right edge is today.</p></div>
      <div class="head-tools"><div class="seg"><button>2 weeks</button><button class="on">4 weeks</button><button>Quarter</button></div>${btn('Refresh', 'ghost')}</div>
    </header>
    <section class="week" aria-label="This week">
      <div class="weekhead"><b>${total}h</b> this week across ${split.length} projects</div>
      <div class="stack">${split.map((p) => `<span style="--hue:${p.hue};flex:${hours(p)}"><b>${esc(p.name)}</b> ${hours(p)}h</span>`).join('')}</div>
    </section>
    <div class="tgrid-wrap">
      <ol class="tgrid">
        <li class="trow axis" aria-hidden="true"><span class="tname"></span><span class="tcells">${Array.from({ length: N }, (_, i) => `<i class="lbl">${dayLabel(i)}</i>`).join('')}</span><span class="tlast">Last</span><span class="tact"></span></li>
        ${active.map(row).join('')}
      </ol>
      <aside class="drift">
        <h2>Going quiet</h2>
        <p>No commits or conversations in three weeks. Archive hides a project until it changes; nothing on disk moves.</p>
        <ul>
          <li>${badge(PROJECTS[9], 'sm')}<span><b>line-logic</b><small>Quiet 6 weeks. Clean, CI green, nothing unpushed.</small></span>${btn('Archive', 'small solid')}</li>
          <li>${badge(PROJECTS[8], 'sm')}<span><b>ivsr-tmcs-parser</b><small>Quiet 23 days. Clean.</small></span>${btn('Archive', 'small solid')}</li>
          <li>${badge(PROJECTS[6], 'sm')}<span><b>helm</b><small>Quiet 11 days. Its audit can't run without a lockfile.</small></span>${btn('Make a lockfile', 'small solid')}</li>
        </ul>
        <h2 class="mt">Heating up</h2>
        <ul><li>${badge(PROJECTS[0], 'sm')}<span><b>shellby</b><small>${hours(PROJECTS[0])}h this week, up from 19h. 56 commits waiting to push.</small></span>${btn('Push 56', 'small solid')}</li></ul>
      </aside>
    </div>
  </div>`;
}

/* ======================================================= 5. Today */
function viewToday() {
  const p = PROJECTS[0];
  const also = [
    { p: PROJECTS[1], why: 'Build failed on PR #14 "Add proof sheets": lint, 3 errors', act: 'Fix this build', tone: 'bad' },
    { p: PROJECTS[3], why: 'dana-k asked for your review on #31 "Bulk relabel from a CSV", 3h ago', act: 'Read it with Claude', tone: 'warn' },
    { p: PROJECTS[2], why: '2 high vulnerabilities, worst in next 14.2.3. Dev server is up on :3000.', act: 'Bump & open a PR', tone: 'bad' },
  ];
  const shelf = PROJECTS.filter((q) => q !== p && !q.notProject);
  return `
  <div class="v-today">
    <section class="hero" aria-labelledby="h-resume">
      <div class="hero-crab">${crab(9)}<p class="bubble">Pick up shellby? You stopped mid-mockup.</p></div>
      <div class="hero-main">
        <p class="kicker">Where you left off, 2 hours ago</p>
        <h1 id="h-resume">${badge(p, 'md')} ${esc(p.name)}</h1>
        <p class="hero-what">${esc(p.leftOff)}</p>
        <div class="hero-act">${btn('Resume that conversation', 'primary big')}${btn('New conversation here', 'solid big')}${btn(`Start ${p.server.script}`, 'ghost big')}</div>
        <ul class="hero-facts">
          <li><b>${p.ahead}</b> commits only on this PC <button class="link">Push them</button></li>
          <li><b>${p.todo}</b> to do, next: ${esc(p.next)}</li>
          <li><b>${hours(p)}h</b> this week ${spark(p.week, { w: 70, h: 16 })}</li>
          <li>${esc(p.release)} <button class="link">Draft v0.98.0</button></li>
        </ul>
      </div>
    </section>
    <section class="also" aria-labelledby="h-also">
      <h2 id="h-also">Also waiting on you</h2>
      <div class="also-row">${also.map((a) => `<article class="acard ${a.tone}"><header>${badge(a.p, 'sm')}<b>${esc(a.p.name)}</b></header><p>${esc(a.why)}</p>${btn(a.act, 'solid')}</article>`).join('')}
        <article class="acard sweep"><header><b>3 quick tidy-ups</b></header><p>A merged branch on 3d-rack, an empty copy of shellby, and Documents, which isn't a project.</p>${btn('Review and clear', 'ghost')}</article>
      </div>
    </section>
    <section class="shelf" aria-labelledby="h-shelf">
      <header><h2 id="h-shelf">Everything else</h2><label class="search"><input placeholder="Find a project" aria-label="Find a project">${kbd('Ctrl F')}</label></header>
      <div class="shelf-grid">${shelf.map((q) => `<button class="stile ${severity(q) >= 2 ? 'hot' : ''}">${badge(q, 'sm')}<span><b>${esc(q.name)}</b><small>${esc(issues(q)[0]?.kind ?? `Last touched ${q.last}`)}</small></span>${spark(q.week, { w: 48, h: 14 })}</button>`).join('')}</div>
    </section>
  </div>`;
}

/* ======================================================= 6. Command */
function viewCommand() {
  const p = PROJECTS[2];
  const acts = [
    ['Bump & open a PR', '4 vulnerable, 2 high', 'B', true],
    ['New conversation here', 'In ~\\…\\spoolandsteel', 'Enter'],
    ['Open localhost:3000', 'Dev server is up', 'O'],
    ['Restart dev', 'npm run dev', 'R'],
    ['Tidy up 2 changed files…', 'checkout.ts, rates.ts', 'T'],
    ['Open on GitHub', 'x-salmon/spoolandsteel', 'G'],
    ['Open folder', 'Explorer', 'E'],
  ];
  const others = [PROJECTS[1], PROJECTS[0]];
  return `
  <div class="v-command">
    <aside class="facets" aria-label="Narrow it down">
      <h2>Narrow it down</h2>
      ${[['Needs you', 6], ['Vulnerable', 3], ['Unpushed', 1], ['Running', 1], ['On this PC', 10], ['GitHub only', 0]].map(([l, n]) => `<button class="facet"><span>${l}</span><b>${n}</b></button>`).join('')}
      <h2 class="mt">Recent</h2>
      ${PROJECTS.slice(0, 5).map((q) => `<button class="facet">${badge(q, 'xs')}<span>${esc(q.name)}</span></button>`).join('')}
    </aside>
    <section class="cmd">
      <label class="cmdbar"><span class="caret">›</span><input value="spool" aria-label="Type a project or an action"><span class="cmdhint">${kbd('Ctrl K')} anywhere</span></label>
      <div class="results" role="listbox">
        <div class="hit on" role="option" aria-selected="true">
          <header>${badge(p, 'md')}<span><span><b>spool</b>andsteel</span><small class="mono">${esc(p.where)}</small></span>${depsChip(p.deps)}<span class="up">Up on :3000</span></header>
          <ul class="acts">${acts.map(([a, s, k, hot], i) => `<li class="${i === 0 ? 'cur' : ''}"><span class="a ${hot ? 'hot' : ''}">${esc(a)}</span><small>${esc(s)}</small>${kbd(k)}</li>`).join('')}</ul>
        </div>
        <p class="also-match">Also matching "spool" in other projects</p>
        ${others.map((q) => `<div class="hit" role="option" aria-selected="false"><header>${badge(q, 'sm')}<span>${esc(q.name)}<small>${q.id === 'shellby' ? 'To-do: "spool size picker for the 3D printer card"' : 'Commit 9d2f1a3 "spool weight label"'}</small></span></header></div>`).join('')}
      </div>
      <h2 class="usual-h">What you usually do from here</h2>
      <div class="usual">${[[PROJECTS[0], 'Resume where you left off'], [PROJECTS[2], 'Open localhost:3000'], [PROJECTS[1], 'Fix this build'], [PROJECTS[3], 'Read #31 with Claude']].map(([q, a]) => `<button class="stile">${badge(q, 'sm')}<span><b>${esc(a)}</b><small>${esc(q.name)}</small></span></button>`).join('')}</div>
      <p class="keys">${kbd('↑')} ${kbd('↓')} move ${kbd('Tab')} actions ${kbd('Enter')} do it ${kbd('Esc')} clear. Letters run an action without the mouse.</p>
    </section>
    <aside class="preview" aria-label="spoolandsteel">
      <h2>${esc(p.name)}</h2>
      <dl>
        <dt>Branch</dt><dd class="mono">main, 2 changed</dd>
        <dt>CI</dt><dd>${ciMark(p)} ${esc(p.ciNote)}</dd>
        <dt>Dev server</dt><dd>npm run dev, up on <a>:3000</a> for 2h 14m</dd>
        <dt>This week</dt><dd>${hours(p)}h ${spark(p.week, { w: 84, h: 18 })}</dd>
        <dt>Next up</dt><dd>${esc(p.next)}</dd>
      </dl>
      <h3>Server log, last lines</h3>
      <pre class="log">▲ Next.js 14.2.3
- Local: http://localhost:3000
✓ Ready in 2.1s
○ Compiling /checkout ...
✓ Compiled /checkout in 812ms</pre>
    </aside>
  </div>`;
}
