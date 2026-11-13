// The settings panel under the beach: the list of areas, one area's settings,
// and search. Every change goes to the scene so he shows it at once.
(function (PAH) {
  'use strict';
  const { scene, sound, AREAS, SCHEMA, ITEMS, DEFAULTS, GREETINGS, SKINS } = PAH;
  const ORDER = scene.ORDER;
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FAST_BURST = Object.freeze({ chars: 12, ms: 1600 });
  const TALK_SAMPLES = Object.freeze({
    Quiet: '•', 'About work': 'Tests passed.', Normal: 'Done! That took about four minutes.',
    Chatty: "Done! Want me to tidy the imports while I'm in there?",
  });

  // Under reduced motion he stays put until you switch strolling on, as the app does.
  const state = { ...DEFAULTS, stroll: REDUCED ? false : DEFAULTS.stroll };
  const ui = { area: null, query: '', pendingPower: false, flash: null, heard: false };

  const $ = sel => document.querySelector(sel);
  const panel = $('#panel');
  const stage = $('#stage');
  const tag = $('#tag');
  const toastEl = $('#toast');
  const q = $('#q');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const byId = Object.fromEntries(ITEMS.map(i => [i.id, i]));

  PAH.areaLabel = key => `${AREAS[key].name}: ${AREAS[key].what}`;

  // ---------------------------------------------------------------- what's in force
  // Work mode holds his pals, pranks and climbing, and puts them back after.
  function effective() {
    if (!state.workMode) return state;
    return { ...state, pals: 'Just him', mischief: 'Off', climbWin: 'Never', climbEdge: 'Never', talk: state.talk === 'Chatty' || state.talk === 'Normal' ? 'About work' : state.talk };
  }

  const palCount = v => (v === 'Just him' ? 0 : Number(v));
  const changedIn = area => ITEMS.filter(i => i.area === area && 'def' in i && !i.preview && state[i.id] !== i.def);

  function sync() {
    const e = effective();
    scene.setSkin(SKINS[e.skin]);
    scene.setSize(e.size);
    scene.setWalking(e.stroll);
    scene.setPals(palCount(e.pals));
    scene.setKit({ phones: e.music && e.musicPhones, shades: e.weather && e.sky === 'Sun', keys: e.typing });
    scene.setWeather(e.weather ? e.sky : 'Clear');
    scene.setWindow(e.climbWin !== 'Never');
    scene.setClaw(e.power);
    scene.setBug(e.bugdex);
    scene.flags.mischief = e.mischief !== 'Off';
    scene.flags.pinch = e.pinch;
    scene.flags.prints = e.mischief !== 'Off' && e.prints;
    if (ui.heard) { sound.setVolume(e.volume); sound.setBackground(e.background); }
    for (const key of ORDER) scene.setChanged(key, changedIn(key).length > 0);
  }

  // He speaks as much as you've asked him to: a mark when Quiet, only work in Work.
  function speak(text, { work = false, force = false } = {}) {
    const talk = effective().talk;
    let line = text;
    if (!force && talk === 'Quiet') line = '•';
    else if (!force && talk === 'About work' && !work) return;
    scene.say(line);
    if (state.chirp && line !== '•') sound.chirp();
  }

  // ---------------------------------------------------------------- reacting to a change
  function react(id, value) {
    const say = byId[id]?.say;
    if (say && value === true) speak(say);
    switch (id) {
      case 'size': if (ui.area) scene.select(ui.area); speak({ Small: 'Smaller!', Medium: 'Just right.', Large: 'Bigger!', Huge: 'HUGE.' }[value]); break;
      case 'skin': speak('New look!'); scene.burst('✦', 'spark', 4); break;
      case 'helpers': scene.helpers(value); break;
      case 'music': if (value) scene.burst('♪', 'note', 3); break;
      case 'sky': speak({ Clear: 'Nice and clear.', Rain: 'Brr, wet.', Snow: 'Snow!', Sun: 'Shades on.' }[value]); break;
      case 'workMode': speak(value ? 'Heads down.' : 'Back to normal.', { force: true }); break;
      case 'talk': speak(TALK_SAMPLES[value], { force: true }); break;
      case 'chirp': if (value) sound.chirp(); break;
      case 'steps': if (value) { sound.step(); setTimeout(sound.step, 140); } break;
      case 'volume': sound.chirp(); break;
      case 'mischief': speak({ Off: "I'll behave.", Cheeky: 'Hehe.', Gremlin: 'Mwahaha.' }[value]); if (value !== 'Off') scene.snap(); break;
      case 'power': scene.snap(); speak({ 'Ask first': "I'll ask first.", Smart: "I'll ask about the risky ones.", 'Auto-edit': "I'll edit files and ask about the rest.", 'Plan only': "Plans first. I won't touch a thing.", Autonomous: 'No more asking. Careful.' }[value], { work: true }); break;
      case 'appMode': if (value === 'Just the crab') speak('Just me, then.', { force: true }); break;
      case 'model': speak(value === 'Claude Code default' ? 'Whatever Claude Code picks.' : `${value} it is.`, { work: true }); break;
      case 'climbWin': if (value !== 'Never') { scene.hop(); speak('Up I go!'); } break;
      case 'climbEdge': if (value !== 'Never') scene.hop(); break;
      case 'pals': if (value !== 'Just him') speak('Friends!'); break;
      case 'bugdex': speak(value ? 'Bugs!' : "My jar's empty."); break;
      default: break;
    }
  }

  function set(id, value, { confirmed = false } = {}) {
    if (id === 'power' && value === 'Autonomous' && !confirmed && state.power !== 'Autonomous') { ui.pendingPower = true; render(); return; }
    state[id] = value;
    // The Mode switch and the Work mode toggle are one setting seen from two places.
    if (id === 'appMode') state.workMode = value === 'Work mode';
    if (id === 'workMode') state.appMode = value ? 'Work mode' : 'Claude Code';
    ui.heard = true;
    sync();
    react(id, value);
    render();
  }

  // ---------------------------------------------------------------- rendering
  function summary(key) {
    const e = effective();
    const yes = (v, a, b) => (v ? a : b);
    switch (key) {
      case 'shell': { const also = [e.discord && 'Discord', e.obs && 'OBS', e.deck && 'Stream Deck', e.rgb && 'your lights'].filter(Boolean); return `${e.size}, ${SKINS[e.skin].name} skin${also.length ? `, also on ${also.join(', ')}` : ''}`; }
      case 'eyes': {
        const seen = [e.music && 'music', e.typing && 'your typing', e.weather && 'the weather'].filter(Boolean);
        return seen.length ? `Notices ${seen.join(' and ').replace(' and ', seen.length > 2 ? ', ' : ' and ')}` : 'Not noticing anything yet';
      }
      case 'body': return e.workMode ? 'Work mode is on' : `${{ Quiet: 'Quiet', 'About work': 'Talks about work', Normal: 'Talks normally', Chatty: 'Chatty' }[e.talk]}, ${e.mischief === 'Off' ? 'behaves' : e.mischief.toLowerCase()}`;
      case 'claw': return `${e.power}, ${e.model === 'Claude Code default' ? 'default model' : e.model}${e.local ? ', local drafts' : ''}`;
      case 'bucket': return `${yes(e.copies, 'Own copy per conversation', 'Works in your checkout')}, tests ${yes(e.tests, 'after turns', 'off')}`;
      case 'legs': return `${yes(e.stroll, 'Strolls', 'Stays put')}, climbs windows ${e.climbWin.toLowerCase()}`;
      case 'bottle': return `Desktop ${yes(e.notify, 'on', 'off')}, phone alerts ${yes(e.away, 'on', 'off')}, phone app ${yes(e.pocket, 'on', 'off')}`;
      case 'jar': return `Bugdex ${yes(e.bugdex, 'on', 'off')}, tide events ${yes(e.tides, 'on', 'off')}`;
      case 'buoy': return `GitHub signed in${e.gitlab ? ', GitLab watched' : ''}${e.friends ? ', friends visit' : ''}`;
      case 'sign': return `${yes(e.startWin, 'Starts with Windows', 'Starts when you open it')}, version 0.98.1`;
      default: return '';
    }
  }

  function control(item) {
    const v = state[item.id];
    const label = esc(item.label);
    switch (item.type) {
      case 'tog': return `<input type="checkbox" class="tog" data-id="${item.id}" ${v ? 'checked' : ''} aria-label="${label}">`;
      case 'seg': return `<span class="seg" role="group" aria-label="${label}">${item.options.map(o =>
        `<button type="button" data-id="${item.id}" data-v="${esc(o)}" aria-pressed="${o === v}">${esc(o)}</button>`).join('')}</span>`;
      case 'select': return `<select class="sel" data-id="${item.id}" aria-label="${label}">${item.options.map(o =>
        `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      case 'text': return `<span class="inline"><input class="field" type="${item.input || 'text'}" data-id="${item.id}" value="${esc(v)}" placeholder="${esc(item.placeholder || '')}" aria-label="${label}" spellcheck="false">${item.button ? `<button type="button" class="btn" data-action="${item.id}">${esc(item.button)}</button>` : ''}</span>`;
      case 'button': return `<button type="button" class="btn" data-action="${item.id}">${esc(item.text)}</button>`;
      case 'path': return `<span class="inline"><code class="path">${esc(item.text)}</code><button type="button" class="btn" data-action="${item.id}">${esc(item.button)}</button></span>`;
      case 'actions': return `<span class="inline many">${item.buttons.map(([text], i) => `<button type="button" class="btn" data-action="${item.id}" data-i="${i}">${esc(text)}</button>`).join('')}</span>`;
      case 'status': return `<span class="pill">${esc(item.text)}</span>`;
      default: return '';
    }
  }

  // Controls too wide to sit beside their label go under it instead.
  const SEG_ROOM = 26; // characters of options that still fit beside a label
  function wide(item) {
    if (item.type === 'actions') return true;
    if (item.type === 'seg') return item.options.join('').length > SEG_ROOM;
    return false;
  }

  function row(item, crumb) {
    const changed = 'def' in item && !item.preview && state[item.id] !== item.def;
    const help = item.help ? `<small>${esc(item.help)}</small>` : '';
    const reads = item.reads ? `<span class="reads">${esc(item.reads)}</span>` : '';
    const where = crumb ? `<button type="button" class="crumb" data-go="${item.area}">${esc(AREAS[item.area].name)}${item.group ? ` › ${esc(item.group)}` : ''}</button>` : '';
    const flash = ui.flash === item.id ? ' flash' : '';
    if (item.type === 'choice') {
      return `<div class="choices${flash}" data-row="${item.id}" role="radiogroup" aria-label="${esc(item.label)}">${where ? `<div class="choice-where">${where}</div>` : ''}${item.choices.map(([name, sub]) =>
        `<button type="button" class="choice${name === 'Autonomous' ? ' risky' : ''}" role="radio" data-id="${item.id}" data-v="${esc(name)}" aria-checked="${state[item.id] === name}"><b>${esc(name)}${name === 'Ask first' ? ' <span class="pill">Recommended</span>' : ''}${name === 'Autonomous' ? ' <span class="pill coral">Risky</span>' : ''}</b><span>${esc(sub)}</span></button>`).join('')}</div>`;
    }
    if (item.type === 'skins') {
      return `<div class="row stack${flash}" data-row="${item.id}">${where}<span class="t${changed ? ' changed' : ''}">${esc(item.label)}</span>
        <div class="swatches" role="group" aria-label="Skin">${Object.entries(SKINS).map(([id, s]) =>
          `<button type="button" class="swatch" data-id="skin" data-v="${id}" aria-pressed="${state.skin === id}"><span data-portrait="${id}"></span>${esc(s.name)}</button>`).join('')}</div></div>`;
    }
    const stack = wide(item) ? ' stack' : '';
    return `<div class="row${stack}${flash}" data-row="${item.id}"><span class="t${changed ? ' changed' : ''}">${where}${esc(item.label)}${help}${reads}</span>${control(item)}</div>`;
  }

  const visible = item => !item.show || item.show(state);

  function powerWarning() {
    return `<div class="warn" role="alert"><b>Autonomous mode skips every permission check.</b>
      <p>Shellby and his helper agents can edit, run or delete anything your Windows account can, without asking. That includes running scripts it writes for itself.</p>
      <div class="warn-actions"><button type="button" class="btn danger" data-power="yes">I understand, enable it</button><button type="button" class="btn" data-power="no">Cancel</button></div></div>`;
  }

  function renderHome() {
    return `<p class="hint">All ${ITEMS.length} settings live on the beach. Point at any part of him or anything on the sand, or pick from the rail.</p>
      <div class="card">${ORDER.map(key => {
        const n = changedIn(key).length;
        return `<button type="button" class="area-row" data-go="${key}">
          <span class="ico" data-icon="${key}"></span>
          <span class="t"><b>${esc(AREAS[key].name)}</b><span class="what">${esc(AREAS[key].what)}</span><span class="sum">${esc(summary(key))}</span></span>
          ${n ? `<span class="pill coral" title="${n} changed from the default">${n}</span>` : ''}<span class="chev" aria-hidden="true">›</span></button>`;
      }).join('')}</div>`;
  }

  function renderArea(key) {
    const i = ORDER.indexOf(key);
    const prev = ORDER[(i - 1 + ORDER.length) % ORDER.length];
    const next = ORDER[(i + 1) % ORDER.length];
    const n = changedIn(key).length;
    const work = key === 'body' && state.workMode
      ? '<p class="note">Work mode is holding his pals, mischief and climbing. They come back when you switch it off.</p>' : '';
    const titled = SCHEMA[key].filter(g => g.title && g.items.some(visible));
    const jumps = titled.length >= 4
      ? `<nav class="jumps" aria-label="Jump to">${titled.map(g => `<button type="button" class="jump" data-jump="${esc(g.title)}">${esc(g.title)}</button>`).join('')}</nav>` : '';
    const groups = SCHEMA[key].map(g => {
      const items = g.items.filter(visible);
      if (!items.length) return '';
      const rows = items.map(it => row(it) + (it.id === 'power' && ui.pendingPower ? powerWarning() : '')).join('');
      return `${g.title ? `<h4 class="grp" data-grp="${esc(g.title)}">${esc(g.title)}</h4>` : ''}<div class="card">${rows}</div>`;
    }).join('');
    return `<div class="area-head">
        <button type="button" class="back" data-go="home">‹ All of him</button>
        ${n ? `<span class="changes"><span class="pill coral">${n} changed</span><button type="button" class="link" data-reset="${key}">Reset</button></span>` : ''}
      </div>
      <div class="area-title"><span class="ico big" data-icon="${key}"></span><div><h3>${esc(AREAS[key].name)}</h3><p>${esc(AREAS[key].what)}</p></div></div>
      ${jumps}${work}${groups}
      <div class="area-foot"><button type="button" class="link" data-go="${prev}">‹ ${esc(AREAS[prev].name)}</button><button type="button" class="link" data-go="${next}">${esc(AREAS[next].name)} ›</button></div>`;
  }

  function matches(query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return ITEMS.filter(it => {
      const hay = `${it.label} ${it.help || ''} ${it.kw || ''} ${it.group} ${AREAS[it.area].name} ${AREAS[it.area].what}`.toLowerCase();
      const tokens = hay.split(/[^a-z0-9%]+/).filter(Boolean);
      return words.every(w => tokens.some(t => t.startsWith(w) || (t.length >= 4 && w.startsWith(t))));
    });
  }

  function renderSearch() {
    const found = matches(ui.query);
    scene.setMatches([...new Set(found.map(f => f.area))]);
    if (!found.length) return `<p class="hint">Nothing matches "${esc(ui.query)}". Try a word for what you want him to do, like "quieter", "phone" or "climb".</p>`;
    return `<p class="hint">${found.length} setting${found.length === 1 ? '' : 's'}, lit up on him.</p>
      <div class="card">${found.map(it => row(it, true)).join('')}</div>
      ${/quiet|calm|focus/.test(ui.query) && !state.workMode ? '<p class="note">Work mode turns most of these down at once. <button type="button" class="link" data-quick="workMode">Turn on Work mode</button></p>' : ''}`;
  }

  // ---------------------------------------------------------------- the rail
  // Every area down the side, so nothing is ever more than one click away.
  const RAIL_NAMES = Object.freeze({ shell: 'Shell', eyes: 'Eyes', body: 'Body', claw: 'Claw', legs: 'Legs', bucket: 'Bucket', bottle: 'Bottle', jar: 'Bug jar', buoy: 'Buoy', sign: 'Signpost' });
  const HIS_PARTS = 5; // ORDER starts with his five parts, then the five things on the sand
  const rail = $('#rail');
  let railSkin = null;

  function buildRail() {
    const btn = key => `<button type="button" class="rail-btn" data-rail="${key}" tabindex="-1"><span class="ico" data-rail-ico="${key}"></span><span>${key === 'home' ? 'All' : RAIL_NAMES[key]}</span><span class="rail-n" hidden></span></button>`;
    const sep = '<span class="rail-sep" aria-hidden="true"></span>';
    rail.innerHTML = `<span class="rail-mark" aria-hidden="true"></span>${btn('home')}${sep}${ORDER.slice(0, HIS_PARTS).map(btn).join('')}${sep}${ORDER.slice(HIS_PARTS).map(btn).join('')}`;
  }

  function renderRail() {
    if (railSkin !== state.skin) {
      railSkin = state.skin;
      rail.querySelectorAll('[data-rail-ico]').forEach(el => el.replaceChildren(el.dataset.railIco === 'home'
        ? scene.portrait(SKINS[state.skin]) : scene.icon(el.dataset.railIco, SKINS[state.skin])));
    }
    const current = ui.query ? null : ui.area || 'home';
    const lit = ui.query ? new Set(matches(ui.query).map(f => f.area)) : new Set();
    for (const b of rail.querySelectorAll('.rail-btn')) {
      const key = b.dataset.rail;
      const n = key === 'home' ? 0 : changedIn(key).length;
      const name = key === 'home' ? 'All settings' : AREAS[key].name;
      if (key === current) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      b.tabIndex = key === (current || 'home') ? 0 : -1;
      b.classList.toggle('match', lit.has(key));
      b.setAttribute('aria-label', n ? `${name}, ${n} changed` : name);
      const badge = b.querySelector('.rail-n');
      badge.hidden = !n;
      badge.textContent = n;
    }
    const mark = rail.querySelector('.rail-mark');
    const on = current && rail.querySelector(`[data-rail="${current}"]`);
    mark.hidden = !on;
    if (on) { mark.style.height = `${on.offsetHeight}px`; mark.style.transform = `translateY(${on.offsetTop}px)`; }
  }

  // Pointing at him lights the rail, and pointing at the rail lights him.
  const railHover = key => rail.querySelectorAll('.rail-btn').forEach(b => b.classList.toggle('hover', b.dataset.rail === key));

  rail.addEventListener('click', e => {
    const b = e.target.closest('.rail-btn');
    if (b) open(b.dataset.rail);
  });
  rail.addEventListener('pointerover', e => {
    const b = e.target.closest('.rail-btn');
    scene.highlight(b && b.dataset.rail !== 'home' ? b.dataset.rail : null);
  });
  rail.addEventListener('pointerleave', () => scene.highlight(null));
  rail.addEventListener('focusin', e => { const k = e.target.dataset.rail; scene.highlight(k && k !== 'home' ? k : null); });
  rail.addEventListener('focusout', () => scene.highlight(null));
  rail.addEventListener('keydown', e => {
    const btns = [...rail.querySelectorAll('.rail-btn')];
    const i = btns.indexOf(document.activeElement);
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: btns.length - 1 }[e.key];
    if (i < 0 || to === undefined) return;
    e.preventDefault();
    btns[(to + btns.length) % btns.length].focus();
  });

  function render() {
    renderRail();
    const focus = document.activeElement;
    const keep = panel.contains(focus) ? { id: focus.dataset.id, v: focus.dataset.v, go: focus.dataset.go, action: focus.dataset.action } : null;
    const scroll = panel.scrollTop;
    if (ui.query) panel.innerHTML = renderSearch();
    else { scene.setMatches([]); panel.innerHTML = ui.area ? renderArea(ui.area) : renderHome(); }
    panel.querySelectorAll('[data-icon]').forEach(el => el.appendChild(scene.icon(el.dataset.icon, SKINS[state.skin])));
    panel.querySelectorAll('[data-portrait]').forEach(el => el.appendChild(scene.portrait(SKINS[el.dataset.portrait])));
    panel.scrollTop = scroll;
    if (keep) {
      const sel = keep.id ? `[data-id="${keep.id}"]${keep.v ? `[data-v="${CSS.escape(keep.v)}"]` : ''}` : keep.go ? `[data-go="${keep.go}"]` : keep.action ? `[data-action="${keep.action}"]` : null;
      panel.querySelector(sel)?.focus({ preventScroll: true });
    }
  }

  // ---------------------------------------------------------------- moving around
  function open(key) {
    ui.area = key === 'home' ? null : key;
    ui.pendingPower = false;
    if (ui.query) { ui.query = ''; q.value = ''; }
    scene.select(ui.area);
    panel.scrollTop = 0;
    render();
    if (ui.area) speak(GREETINGS[ui.area]);
  }

  function showSetting(id) {
    const it = byId[id];
    open(it.area);
    ui.flash = id;
    render();
    const el = panel.querySelector(`[data-row="${id}"]`);
    el?.scrollIntoView({ block: 'center', behavior: REDUCED ? 'auto' : 'smooth' });
    setTimeout(() => { ui.flash = null; }, 1500);
  }

  let toastT = 0;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('on'), 2200);
  }

  // ---------------------------------------------------------------- events
  panel.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.go) {
      if (t.classList.contains('crumb')) { showSetting(t.closest('[data-row]').dataset.row); return; }
      open(t.dataset.go);
    } else if (t.dataset.id && t.dataset.v !== undefined) set(t.dataset.id, t.dataset.v);
    else if (t.dataset.action) {
      const it = byId[t.dataset.action];
      if (it.bob) scene.bob(it.bob);
      toast(it.buttons ? it.buttons[+t.dataset.i][1] : it.toast);
    } else if (t.dataset.reset) {
      for (const it of changedIn(t.dataset.reset)) state[it.id] = it.def;
      sync(); speak('Back how I was.'); render();
    } else if (t.dataset.power) {
      ui.pendingPower = false;
      if (t.dataset.power === 'yes') set('power', 'Autonomous', { confirmed: true }); else render();
    } else if (t.dataset.quick) set(t.dataset.quick, true);
    else if (t.dataset.jump) {
      const h = [...panel.querySelectorAll('[data-grp]')].find(el => el.dataset.grp === t.dataset.jump);
      h?.scrollIntoView({ block: 'start', behavior: REDUCED ? 'auto' : 'smooth' });
    }
  });
  panel.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('.tog')) set(t.dataset.id, t.checked);
    else if (t.matches('.sel')) set(t.dataset.id, t.value);
  });
  panel.addEventListener('input', e => {
    const t = e.target;
    if (t.matches('.field')) { state[t.dataset.id] = t.value; typed(); }
  });
  panel.addEventListener('focusout', e => { if (e.target.matches('.field')) render(); });
  panel.addEventListener('pointerover', e => { const r = e.target.closest('.area-row'); scene.highlight(r ? r.dataset.go : null); });
  panel.addEventListener('pointerleave', () => scene.highlight(null));

  // Typing along: he taps for every key, and notices a fast burst.
  const burst = [];
  function typed() {
    const e = effective();
    if (!e.typing) return;
    scene.tap();
    const now = performance.now();
    burst.push(now);
    while (burst.length && now - burst[0] > FAST_BURST.ms) burst.shift();
    if (burst.length >= FAST_BURST.chars && e.typingSpeed) {
      burst.length = 0;
      scene.burst('★', 'star', 3);
      speak("That's quick!");
    }
  }

  q.addEventListener('input', () => {
    ui.query = q.value.trim();
    typed();
    if (ui.query && ui.area) { ui.area = null; scene.select(null); }
    render();
  });

  document.querySelector('.phone').addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (ui.query) { ui.query = ''; q.value = ''; render(); return; }
    if (ui.pendingPower) { ui.pendingPower = false; render(); return; }
    if (ui.area) { const was = ui.area; open('home'); scene.focus(was); }
  });

  // The floating name tag while you point at him.
  function moveTag(key, evt) {
    const r = stage.getBoundingClientRect();
    tag.innerHTML = `<b>${esc(AREAS[key].name)}</b>${esc(AREAS[key].what)}`;
    tag.hidden = false;
    const x = Math.min(r.width - 150, Math.max(4, evt.clientX - r.left + 14));
    const y = Math.max(4, evt.clientY - r.top - 40);
    tag.style.transform = `translate(${x}px, ${y}px)`;
  }

  scene.init($('#beach'), $('#overlay'), {
    select: key => open(ui.area === key ? 'home' : key),
    hover: key => { if (!key) tag.hidden = true; railHover(key); },
    tagMove: moveTag,
    step: () => { if (ui.heard && effective().steps) sound.step(); },
    pet: () => speak('♥', { force: true }),
    pinch: () => { if (ui.heard) sound.snip(); speak('Snip!'); },
  });
  // A new size moves the rail's marker; the beach re-measures itself.
  let resizeT = 0;
  addEventListener('resize', () => { cancelAnimationFrame(resizeT); resizeT = requestAnimationFrame(() => { scene.select(ui.area); render(); }); });

  buildRail();
  sync();
  render();
  setTimeout(() => speak("Point at me. Anywhere's fine.", { force: true }), 700);
})(window.PAH);
