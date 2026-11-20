// A friend's crab visiting (life.js): the hellos, the chat between what they do together, the goodbye.
const gifts = require('./gifts');
const banter = require('./banter');

/**
 * @param {any} d the same deps createLife takes
 * @param {any} h life.js's own: now, temperament, getBond, getFinds, chatter, grow, remember, st
 */
function createVisit(d, { now, temperament, getBond, getFinds, chatter, grow, remember, st }) {
  /** @type {NodeJS.Timeout[]} */
  let visitTimers = [];
  /** @type {string[]} */
  let visitUsed = [];

  /**
   * A visit started (v) or ended (null). The two of them say hello, chat between
   * the things they do together, and say goodbye before the visitor walks off.
   *   v: { login, card, until, signed }; ctx: what there is to talk about
   * @param {any} v
   * @param {{ visitMs?: number, togetherAt?: number[], myCard?: any }} [ctx]
   */
  function visit(v, { visitMs = 0, togetherAt = [], myCard = {} } = {}) {
    visitTimers.forEach(clearTimeout);
    visitTimers = [];
    if (!v) return;
    visitUsed = [];
    const who = { me: temperament(), them: v.card?.temperament };
    const first = !getBond().journal.some(e => e.kind === 'visitor' && e.data.login === v.login);
    if (v.signed) {
      grow('visit');
      if (first) remember('visitor', { login: v.login });
    }
    const ctxFor = () => ({
      firstVisit: first, myStickers: myCard.stickers?.length || 0, theirStickers: v.card?.stickers?.length || 0,
      myLevel: myCard.level || 1, theirLevel: v.card?.level || 1,
      myFind: gifts.favourite(getFinds())?.name || null, theirFind: gifts.findById(v.card?.find)?.name || null,
      music: !!d.music(), hour: new Date(now()).getHours(), seasons: d.seasons(),
    });
    const talk = (at, phase) => visitTimers.push(setTimeout(() => {
      // Only work, a call or your focus stops them: a trophy going off mid-visit doesn't.
      if (d.working() || st.onCall || d.guarding() || chatter() === 'quiet') return;
      const lines = banter.conversation(phase, who, ctxFor(), Math.random, visitUsed);
      if (!lines.length) return;
      if (phase === 'chat') visitUsed.push(lines[0].text);
      let t = 0;
      for (const l of lines) {
        const ms = banter.lineMs(l.text);
        visitTimers.push(setTimeout(() => {
          if (l.who === 'me') d.say(l.text, ms, 'banter');
          else d.toCrab('critter:visitor-say', { text: l.text, ms });
        }, t));
        t += ms + 250;
      }
      if (phase === 'chat') { d.stat('banter'); grow('banter'); }
    }, at));
    talk(4500, 'hello'); // after his "@friend dropped by!"
    // Chat in the gaps between the things they do together.
    const gaps = togetherAt.map(t => t + 6500).filter(t => t < visitMs - 20000);
    for (const t of gaps.slice(0, 3)) talk(t, 'chat');
    talk(visitMs - 9000, 'bye');
  }

  return { visit };
}

module.exports = { createVisit };
