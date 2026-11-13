// Pure bits of a tab's summary (sessions.js): what its helpers are saying and its to-do list.
const { TALK_MS } = require('./session');
const todos = require('../renderer/shared/todos');

// What a helper is saying, or was just told, for a few seconds (session/crew.js noteMessage): null when quiet.
function talkOf(c, now = Date.now()) {
  const said = c.said && now - c.said.at < TALK_MS ? c.said : null;
  const heard = c.heard && now - c.heard.at < TALK_MS ? c.heard : null;
  const last = said && (!heard || said.at >= heard.at) ? 'said' : heard ? 'heard' : null;
  if (last === 'said') return { kind: 'said', text: said.text.slice(0, 80), to: said.to };
  if (last === 'heard') return { kind: 'heard', text: heard.text.slice(0, 80), from: heard.from };
  return null;
}

// A tab's to-do list in the summary: the counts and what Claude is on, or null with none.
function todoGlance(list) {
  const s = todos.summary(list);
  return s.total ? { total: s.total, done: s.done, current: s.current } : null;
}

module.exports = { talkOf, todoGlance };
