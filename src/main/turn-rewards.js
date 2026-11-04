// What a turn earned, kept in the conversation. Finds, catches, stickers,
// trophies, quests and levels used to show only as a toast or in their own
// rooms, so anyone who lives in Chat never saw them. Every one of them already
// goes to the panel on its own channel; `entryOf` reads those payloads, the
// ledger gathers them under the turn that was running, and at the turn's end
// one "rewards" card goes into the transcript (wiring/turn-rewards.js), kept by
// History like a surprise. XP on its own makes no card: every turn pays some.
// Pure: no I/O. See test/turn-rewards.test.js.

// The most a card lists; the rest is "and N more".
const MAX_ITEMS = 6;
const text = (v, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * One reward as the card shows it, from a channel and its payload, or null
 * when the channel isn't a reward. kind: xp | level | class | find | catch |
 * sticker | trophy | quest. `go` is the screen it opens; a catch with a battle
 * carries its id so the card can replay it.
 */
function entryOf(channel, p) {
  if (!p || typeof p !== 'object') return null;
  switch (channel) {
    case 'critter:xp': {
      const n = Math.floor(Number(p.amount) || 0);
      return n > 0 ? { kind: 'xp', amount: n } : null;
    }
    case 'xp:levelup': {
      const level = Math.floor(Number(p.level) || 0);
      return level > 0 ? { kind: 'level', icon: '⭐', title: `Level ${level}`, text: text(p.title), go: 'trophies' } : null;
    }
    case 'xp:class':
      return text(p.name) ? { kind: 'class', icon: text(p.icon, 8) || '🦀', title: `New class: ${text(p.name)}`, go: 'trophies' } : null;
    case 'life:found':
      return text(p.name) ? { kind: 'find', id: text(p.id), icon: p.shiny ? '✨' : '🪨', title: `Dug up ${text(p.name)}`, text: [p.isNew ? 'new' : '', text(p.rarityLabel, 20)].filter(Boolean).join(', '), go: 'finds' } : null;
    case 'bugdex:caught':
      return text(p.name) ? { kind: 'catch', id: text(p.id), icon: '🐛', title: `Caught ${text(p.name)}`, text: p.isNew ? 'new to the Bugdex' : '', go: 'bugdex', battle: text(p.battle, 120) || null } : null;
    case 'stickers:new':
      return text(p.name) ? { kind: 'sticker', id: text(p.id), icon: '🏷️', title: `Sticker: ${text(p.name)}`, text: 'on his shell', go: 'stickers' } : null;
    case 'wardrobe:unlocked': {
      const a = p.achievement;
      if (!a || !text(a.name)) return null;
      const got = Array.isArray(p.rewards) ? p.rewards.map(r => text(r?.name, 40)).filter(Boolean).join(' + ') : '';
      return { kind: 'trophy', id: text(a.id), icon: text(a.icon, 8) || '🏆', title: `Trophy: ${text(a.name)}`, text: got ? `unlocked ${got}` : '', go: 'trophies' };
    }
    case 'quests':
      return p.done && text(p.done.title) ? { kind: 'quest', id: text(p.done.id), icon: text(p.done.icon, 8) || '📜', title: `Quest done: ${text(p.done.title)}`, go: 'trophies' } : null;
    default:
      return null;
  }
}

/**
 * Which turns are going and what each has earned. Each turn is its own entry
 * (a token from begin), so a follow-up turn in the same tab never takes over
 * one still settling its card. A reward rarely knows its tab, so it's only
 * kept when exactly one live turn could have earned it: one still running
 * (`live(tabId)` says its tab is busy), or one whose result is in but whose
 * card isn't written yet (a level-up the turn's own XP brings lands after the
 * result). With none, or more than one, it isn't kept: the toast still showed
 * it, and a guess would put it under the wrong conversation for good.
 */
function createLedger() {
  /** @type {Map<number, { tabId: string, ending: boolean, entries: any[] }>} */
  const turns = new Map();
  let seq = 0;

  /** A turn starts in this tab. -> its token. One that never ended goes. */
  function begin(tabId) {
    for (const [k, t] of turns) if (t.tabId === tabId && !t.ending) turns.delete(k);
    turns.set(++seq, { tabId, ending: false, entries: [] });
    return seq;
  }

  /**
   * A reward seen now. -> the token of the turn it went to, or null.
   * @param {any} entry
   * @param {(tabId: string) => boolean} [live]
   */
  function add(entry, live = () => true) {
    if (!entry) return null;
    const could = [...turns].filter(([, t]) => t.ending || live(t.tabId));
    if (could.length !== 1) return null;
    const [k, t] = could[0];
    t.entries.push(entry);
    return k;
  }

  /** The tab's turn has its result: rewards it brings still count until close(). -> its token, or null. */
  function ending(tabId) {
    for (const [k, t] of turns) {
      if (t.tabId === tabId && !t.ending) { t.ending = true; return k; }
    }
    return null;
  }

  /** The turn is over. -> its card, or null when it earned nothing but XP. */
  function close(token, now = 0) {
    const t = turns.get(token);
    turns.delete(token);
    return t ? cardOf(t.entries, now) : null;
  }

  /** A tab closed: every turn of its goes, card unwritten. */
  function forget(tabId) {
    for (const [k, t] of turns) if (t.tabId === tabId) turns.delete(k);
  }

  /** How many rewards the turn has, to tell a quiet spell. */
  const count = token => turns.get(token)?.entries.length ?? 0;

  return { begin, add, ending, close, forget, count, open: () => turns.size };
}

/** The card for a turn's rewards, or null when there's nothing past XP to show. */
function cardOf(entries, now = 0) {
  const list = Array.isArray(entries) ? entries : [];
  const xp = list.filter(e => e?.kind === 'xp').reduce((n, e) => n + e.amount, 0);
  const seen = new Set();
  const items = [];
  for (const e of list) {
    if (!e || e.kind === 'xp') continue;
    const key = `${e.kind}:${e.id || e.title}`; // the same find twice, a level told twice
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(e);
  }
  if (!items.length) return null;
  return { kind: 'rewards', xp, items: items.slice(0, MAX_ITEMS), more: Math.max(0, items.length - MAX_ITEMS), at: now };
}

module.exports = { entryOf, createLedger, cardOf, MAX_ITEMS };
