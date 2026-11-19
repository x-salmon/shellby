// Local mode's presets: Off, Coding and Chat fill every local model picker at
// once (drafts, the quiz, and a local conversation's main work, helper crabs and
// quick tasks), so running locally is something you switch on, not assemble.
// Custom is whatever the user set by hand; changing a picker switches to it.
//
// Each slot lists acceptable models, best first for an 8-16 GB GPU. Applying a
// preset picks the first one installed and names the slots with none, so
// Settings can offer to get them. Pure: takes the cleaned settings and the
// installed names, returns new settings.

// Bump when the lists change, so a later release can tell an old pick from a new one.
const PRESETS_VERSION = 1;
const PRESET_NAMES = Object.freeze(['off', 'coding', 'chat', 'custom']);

const QUICK = ['qwen3:4b', 'qwen3:8b', 'llama3.2'];
const PRESETS = Object.freeze({
  coding: { main: ['qwen3-coder:30b', 'devstral', 'gpt-oss:20b', 'qwen2.5-coder:7b'], quick: QUICK },
  chat: { main: ['gpt-oss:20b', 'qwen3:30b-a3b', 'qwen3:8b'], quick: QUICK },
});

// Download sizes in GB, as Ollama's library lists them (it has no size query
// before a pull). Only these can be fetched from Settings (pull.js).
const SIZES = Object.freeze({
  'qwen3-coder:30b': 19, 'devstral': 14, 'gpt-oss:20b': 14, 'qwen2.5-coder:7b': 4.7,
  'qwen3:30b-a3b': 19, 'qwen3:8b': 5.2, 'qwen3:4b': 2.5, 'llama3.2': 2,
});

// When the recommendation table was last checked against Ollama's library. A
// test fails once it's over six months old, so new models get looked at.
const RECOMMEND_CHECKED = '2026-11-19';
const DISK_SPARE_GB = 10;

/**
 * What to get on this PC: a main model and a quick one, with a reason.
 * vramGb is null when it can't be read (no NVIDIA GPU): RAM decides then.
 * @param {{ vramGb: number | null, ramGb: number, freeGb: number | null }} hw
 * @returns {{ main: string, quick: string, note: string }}
 */
function recommend({ vramGb, ramGb, freeGb }) {
  const quick = 'qwen3:4b';
  const fits = m => freeGb == null || freeGb >= SIZES[m] + (m === quick ? 0 : SIZES[quick]) + DISK_SPARE_GB;
  let main = '';
  let note;
  if ((vramGb == null || vramGb < 6) && ramGb < 16) note = 'This PC suits small drafts. Local conversations need more memory.';
  else if (vramGb == null || vramGb < 6) { main = 'qwen3:30b-a3b'; note = vramGb == null ? 'Runs mostly on the CPU: slow but usable. Your GPU may manage more.' : 'Runs mostly on the CPU: slow but usable.'; }
  else if (vramGb < 12) { main = ramGb >= 32 ? 'qwen3-coder:30b' : 'qwen2.5-coder:7b'; note = ramGb >= 32 ? 'Part runs in RAM; fine for this kind of model.' : 'Sized for your GPU.'; }
  else if (vramGb < 24) { main = 'qwen3-coder:30b'; note = 'A strong coder that fits this PC well.'; }
  else { main = 'qwen3-coder:30b'; note = 'Fits entirely on your GPU, with room for a bigger one.'; }
  if (main && !fits(main)) {
    const smaller = 'qwen2.5-coder:7b';
    main = fits(smaller) ? smaller : '';
    note = main ? 'A smaller pick: your drive is short of space for the bigger one.' : 'Your drive is short of space for a coding model.';
  }
  return { main, quick, note };
}

/** The saved preset name, or 'custom' for anything else. */
function cleanPreset(raw) {
  return typeof raw === 'string' && PRESET_NAMES.includes(raw) ? raw : 'custom';
}

/** The installed name for a wanted model: itself, or its ':latest' tag when it has none. */
function installedAs(want, installed) {
  if (installed.includes(want)) return want;
  return !want.includes(':') && installed.includes(`${want}:latest`) ? `${want}:latest` : '';
}

/** -> the first wanted model installed, or ''. */
function firstInstalled(list, installed) {
  for (const want of list) {
    const got = installedAs(want, installed);
    if (got) return got;
  }
  return '';
}

/**
 * Settings with a preset applied.
 * @param {any} lm localModel, cleaned
 * @param {string} name a preset name
 * @param {string[]} installed the server's models
 * @returns {{ settings: any, missing: { slot: 'main' | 'quick', model: string, sizeGb: number }[] }}
 */
function applyPreset(lm, name, installed) {
  const preset = cleanPreset(name);
  if (preset === 'custom') return { settings: { ...lm, preset }, missing: [] };
  if (preset === 'off') {
    return { settings: { ...lm, preset, on: false, answers: { ...lm.answers, on: false }, agent: { ...lm.agent, on: false } }, missing: [] };
  }
  const lists = PRESETS[preset];
  const main = firstInstalled(lists.main, installed);
  const quick = firstInstalled(lists.quick, installed) || main;
  const drafts = quick || lm.model;
  const missing = [
    ...(main ? [] : [{ slot: /** @type {'main'} */ ('main'), model: lists.main[0], sizeGb: SIZES[lists.main[0]] }]),
    ...(firstInstalled(lists.quick, installed) ? [] : [{ slot: /** @type {'quick'} */ ('quick'), model: lists.quick[0], sizeGb: SIZES[lists.quick[0]] }]),
  ];
  const models = { ...lm.models, quiz: main || lm.models?.quiz || '' };
  if (!models.quiz) delete models.quiz;
  return {
    settings: {
      ...lm,
      preset,
      on: !!drafts,
      model: drafts,
      models,
      agent: { ...lm.agent, on: !!main, model: main, helpers: '', quick: quick === main ? '' : quick },
    },
    missing,
  };
}

module.exports = { SIZES, recommend, RECOMMEND_CHECKED, applyPreset, cleanPreset, PRESETS, PRESET_NAMES, PRESETS_VERSION };
