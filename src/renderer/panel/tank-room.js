/* Shellby panel — the room round his tank (docs/TANK.md). The tank fills the
   view in the dark; the controls sit on the glass and wake when the mouse moves
   (they stay up in a narrow panel, while you decorate, and while the keyboard
   is on them); under it are the time, what he's up to and your readings, and
   with "Readings on the glass" on, the thermometer, lighthouse and chest say
   what they read. Everything else about the tank is in the sheet (Settings,
   Layouts). tank.js calls in: fit() for the room it has, render() when the tank
   or the draft changes, doing() when he starts something, placePicked() for the
   picked piece's tools. Loaded before tank.js; tank.js copes without it. */
'use strict';
(function () {
  const { h, $, state } = SB;
  const IDLE_MS = 3000;          // without the mouse, the controls go back to sleep
  const NARROW = 760;            // css px: below this the controls stay up, above the glass
  const CLOCK_MS = 15000;
  const PINS_KEY = 'shellby.tank.pins';
  const GAP = 8;                 // css px between a piece and its tools

  const room = $('tkRoom'), stage = $('tkStage'), glass = $('tkGlass'), bar = $('tkBar'), sheet = $('tkSheet');
  if (!room || !stage || !bar || !sheet) return;

  /** @type {{ editing: boolean, u: number, pieces: any[] } | null} */
  let last = null;               // what render() was last given, for readings that arrive later
  let idle = 0;
  /** @type {HTMLElement | null} */
  let opener = null;             // the button that opened the sheet, to go back to
  let pinsOn = SB.pref(PINS_KEY, '1') !== '0';

  const narrow = () => room.classList.contains('narrow');
  const editing = () => room.classList.contains('editing');

  // ------------------------------------------------------------ the room it has

  /** CSS px the tank can take: the stage, less the controls when they sit above the glass. */
  function fit() {
    const cs = getComputedStyle(stage);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) || 0;
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) || 0;
    const above = narrow() || editing() ? bar.offsetHeight + GAP : 0;
    return { w: Math.max(96, stage.clientWidth - padX), h: Math.max(56, stage.clientHeight - padY - above) };
  }

  new ResizeObserver(() => room.classList.toggle('narrow', room.clientWidth < NARROW)).observe(room);
  room.classList.toggle('narrow', room.clientWidth < NARROW);

  // ------------------------------------------------------------ the controls wake and sleep

  const keepAwake = () => editing() || !sheet.hidden || bar.contains(document.activeElement) || bar.matches(':hover');
  function wake() {
    room.classList.add('awake');
    clearTimeout(idle);
    idle = setTimeout(sleep, IDLE_MS);
  }
  function sleep() {
    if (keepAwake() && state.view === 'tank') { idle = setTimeout(sleep, IDLE_MS); return; }
    room.classList.remove('awake');
  }
  room.addEventListener('pointermove', wake);
  room.addEventListener('pointerdown', wake);
  room.addEventListener('focusin', wake);

  // ------------------------------------------------------------ the sheet

  function openSheet(btn, section) {
    opener = btn;
    sheet.hidden = false;
    room.classList.add('sheet-open');
    for (const id of ['tkOpenSheet', 'tkOpenLayouts']) $(id).setAttribute('aria-expanded', String($(id) === btn));
    const target = section ? $(section) : null;
    if (target) {
      target.scrollIntoView({ block: 'start' });
      const heading = target.querySelector('h4');
      heading?.setAttribute('tabindex', '-1');
      heading?.focus({ preventScroll: true });
    } else {
      sheet.scrollTop = 0;
      $('tkSheetClose').focus();
    }
  }
  function closeSheet() {
    if (sheet.hidden) return;
    sheet.hidden = true;
    room.classList.remove('sheet-open');
    for (const id of ['tkOpenSheet', 'tkOpenLayouts']) $(id).setAttribute('aria-expanded', 'false');
    (opener?.isConnected ? opener : $('tkDecorate')).focus({ preventScroll: true });
    opener = null;
    wake();
  }
  $('tkOpenSheet').addEventListener('click', e => (sheet.hidden || opener !== e.currentTarget ? openSheet(e.currentTarget, null) : closeSheet()));
  $('tkOpenLayouts').addEventListener('click', e => (sheet.hidden || opener !== e.currentTarget ? openSheet(e.currentTarget, 'tkLayoutsSec') : closeSheet()));
  $('tkSheetClose').addEventListener('click', closeSheet);
  // Esc puts it away from anywhere in the room, not just from inside it.
  room.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) { e.stopPropagation(); closeSheet(); } });

  // ------------------------------------------------------------ readings: under the tank, and on the glass

  const gauges = () => SB.tankGauges?.current() || null;

  function readsOf(g) {
    const out = [];
    if (g?.thermometer) out.push({ v: `${g.thermometer.value}°`, k: g.thermometer.of === 'gpu' ? 'GPU' : 'CPU', hot: g.thermometer.hot });
    if (g?.tide) out.push({ v: `${g.tide.left}%`, k: 'of your 5-hour window left', hot: g.tide.left < 20 });
    if (g?.lighthouse?.lit) out.push({ v: g.lighthouse.blink ? 'Down' : 'Up', k: 'dev server', hot: g.lighthouse.blink });
    return out;
  }

  function renderReads() {
    const reads = readsOf(gauges());
    $('tkReads').replaceChildren(...reads.map(r => h('div', { class: r.hot ? 'hot' : null }, h('dd', { text: r.v }), h('dt', { text: r.k }))));
    $('tkReads').hidden = !reads.length;
  }

  // What a piece reads, in a word or two over it.
  function pinOf(p, g) {
    if (p.ref === 'glass-thermometer' && g?.thermometer) return { text: `${g.thermometer.value}° ${g.thermometer.of === 'gpu' ? 'GPU' : 'CPU'}`, hot: g.thermometer.hot };
    if (p.ref === 'lighthouse' && g?.lighthouse?.lit) return { text: g.lighthouse.blink ? 'Dev server down' : 'Dev server up', hot: g.lighthouse.blink };
    if (p.ref === 'sunken-chest' && g?.chest) return { text: 'Pull request merged', hot: false };
    return null;
  }

  function renderPins() {
    const el = $('tkPins');
    $('tkPinsOn').setAttribute('aria-pressed', String(pinsOn));
    if (!last || !pinsOn || last.editing) { el.replaceChildren(); return; }
    const g = gauges();
    const { u, pieces } = last;
    const frame = $('tkCanvas').parentElement; // the pins sit on the glass, outside the frame's clip
    el.replaceChildren(...pieces.flatMap(p => {
      const pin = pinOf(p, g);
      return pin ? [h('span', { class: `tk-pin${pin.hot ? ' hot' : ''}`, text: pin.text, style: `left:${frame.offsetLeft + (p.x + p.w / 2) * u}px;top:${frame.offsetTop + (p.y - p.h) * u}px` })] : [];
    }));
  }
  $('tkPinsOn').addEventListener('click', () => {
    pinsOn = !pinsOn;
    SB.pref.set(PINS_KEY, pinsOn ? '1' : '0');
    renderPins();
  });
  document.addEventListener('sb:tank-gauges', () => { if (state.view === 'tank') { renderReads(); renderPins(); } });

  // ------------------------------------------------------------ the time, and what he's up to

  const clock = () => { $('tkClock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  setInterval(() => { if (state.view === 'tank' && !document.hidden) clock(); }, CLOCK_MS);

  function doing(text) { $('tkDoing').textContent = text || ''; }

  // ------------------------------------------------------------ the picked piece's tools, just above it

  function placePicked(btn) {
    const tools = $('tkPicked');
    if (!btn || tools.hidden) return;
    const frame = btn.closest('.tk-frame');
    const x = frame.offsetLeft + parseFloat(btn.style.left) + parseFloat(btn.style.width) / 2;
    const top = frame.offsetTop + parseFloat(btn.style.top);
    const half = tools.offsetWidth / 2;
    const below = top - tools.offsetHeight - GAP < 0;
    tools.style.left = `${Math.max(half, Math.min(glass.clientWidth - half, x))}px`;
    tools.style.top = `${below ? top + parseFloat(btn.style.height) + GAP : top - tools.offsetHeight - GAP}px`;
  }

  // ------------------------------------------------------------ tank.js calls in

  /** @param {{ editing: boolean, u: number, pieces: any[] }} next */
  function render(next) {
    last = next;
    room.classList.toggle('editing', next.editing);
    $('tkHud').hidden = next.editing;
    if (next.editing) closeSheet();
    clock();
    renderReads();
    renderPins();
  }

  function open() {
    wake(); // up for a moment, so you can see what's there
    clock();
    if (!$('tkDoing').textContent) doing(SB.tankLife?.describe(null)); // until he starts something
  }

  SB.tankRoom = { fit, render, doing, placePicked, open, wake };
})();
