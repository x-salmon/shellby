// HTML for one setting: its label, its control, and its reset button once it
// has moved off the default. Pure functions of the item and the current state.
(function (PAH) {
  'use strict';
  const { SKINS } = PAH;

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SEG_ROOM = 18; // characters of options that still fit beside a label

  const isChanged = (item, state) => 'def' in item && state[item.id] !== item.def;
  const isOff = (item, state) => item.type === 'tog' && !state[item.id];
  const shown = (item, state) => !item.show || item.show(state);
  const showDefault = v => (v === true ? 'on' : v === false ? 'off' : v === '' ? 'empty' : v);

  function control(item, v) {
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

  const PATH_ROOM = 24; // label characters that still leave a path and its button room
  const wide = item => item.type === 'actions' || (item.type === 'seg' && item.options.join('').length > SEG_ROOM) || (item.type === 'path' && item.label.length > PATH_ROOM);

  function resetBtn(item) {
    return `<button type="button" class="undo" data-reset-one="${item.id}" title="Back to ${esc(showDefault(item.def))}" aria-label="Reset ${esc(item.label)} to ${esc(showDefault(item.def))}">↺</button>`;
  }

  function choices(item, state, cls) {
    return `<div class="choices${cls}" data-row="${item.id}" role="radiogroup" aria-label="${esc(item.label)}">${item.choices.map(([name, sub]) =>
      `<button type="button" class="choice${name === 'Autonomous' ? ' risky' : ''}" role="radio" data-id="${item.id}" data-v="${esc(name)}" aria-checked="${state[item.id] === name}"><b>${esc(name)}${name === 'Ask first' ? ' <span class="pill">Recommended</span>' : ''}${name === 'Autonomous' ? ' <span class="pill coral">Risky</span>' : ''}</b><span>${esc(sub)}</span></button>`).join('')}</div>`;
  }

  function skins(item, state, cls, changed) {
    return `<div class="row stack${cls}" data-row="${item.id}"><span class="t${changed ? ' changed' : ''}">${esc(item.label)}</span>
      <div class="swatches" role="group" aria-label="Skin">${Object.entries(SKINS).map(([id, s]) =>
        `<button type="button" class="swatch" data-id="skin" data-v="${id}" aria-pressed="${state.skin === id}"><span data-portrait="${id}"></span>${esc(s.name)}</button>`).join('')}</div></div>`;
  }

  // crumb: the "Area › Group" line shown above a search result.
  function row(item, state, { crumb = '', enter = false, flash = false } = {}) {
    const changed = isChanged(item, state);
    const cls = `${enter ? ' enter' : ''}${flash ? ' flash' : ''}`;
    if (item.type === 'choice') return choices(item, state, cls);
    if (item.type === 'skins') return skins(item, state, cls, changed);
    const help = item.help ? `<small>${esc(item.help)}</small>` : '';
    const reads = item.reads ? `<span class="reads">${esc(item.reads)}</span>` : '';
    const where = crumb ? `<button type="button" class="crumb" data-find="${item.id}">${crumb}</button>` : '';
    return `<div class="row${wide(item) ? ' stack' : ''}${cls}" data-row="${item.id}"><span class="t">${where}<span class="${changed ? 'changed' : ''}">${esc(item.label)}</span>${changed ? resetBtn(item) : ''}${help}${reads}</span>${control(item, state[item.id])}</div>`;
  }

  PAH.ui = { esc, row, isChanged, isOff, shown, showDefault };
})(window.PAH);
