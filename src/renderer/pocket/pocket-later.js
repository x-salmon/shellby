/* Shellby on your phone — what keeps for later:

     the outbox      a task or a reply written while the PC is asleep, kept on
                     the phone and sent, in order, the moment the PC answers
     saved prompts   your own one-tap starters on New task, kept on this phone
     read aloud      a conversation's replies read out as they land, for when
                     you're walking and can't look

   The outbox only holds what the PC would take from this phone anyway: each
   one goes through the same call, with a key, so one that did reach the PC
   before the answer was lost isn't done twice. pocket.js hands in what it shares. */
'use strict';
(function (root) {
  root.PocketLater = ({ S, L, N, h, icon, toast, buzz, live }) => {
    // ---------------------------------------------------------------- the outbox

    const OUTBOX_KEY = 'shellby.pocket.outbox';
    const RETRY_MS = 15000; // the stream can think the PC is there for a while after it went
    let flushing = false;
    let retry = null;
    const listeners = new Set();

    function outbox() {
      try { return L.outboxOf(JSON.parse(N.store.get(OUTBOX_KEY) || '[]')); } catch { return []; }
    }
    function saveOutbox(list) {
      N.store.set(OUTBOX_KEY, list.length ? JSON.stringify(list) : null);
      for (const fn of listeners) fn();
    }

    /** Kept to send when the PC answers. -> whether it was kept. */
    function keep(name, body, label) {
      const r = L.outboxPut(outbox(), { key: body.key, name, body, label, at: Date.now() });
      if (r.error) { toast(r.error, { tone: 'warn', ms: 4800 }); return false; }
      saveOutbox(r.list);
      later();
      buzz(8);
      toast('Your PC isn’t answering. It goes the moment it does.', { ms: 4200 });
      return true;
    }

    /**
     * A task or a reply: sent now, or kept for when the PC answers. -> the PC's
     * answer, or { ok: true, kept: true } when it waits on the phone.
     */
    async function send(name, body, { label, timeoutMs } = {}) {
      const withKey = { ...body, key: body.key || L.newKey() };
      // Pictures wait on the PC for a little while only, so a message with them isn't kept.
      const kept = () => (body.photos?.length
        ? { ok: false, error: 'Your PC isn’t answering. Send it again once it does: pictures need it there.' }
        : keep(name, withKey, label) ? { ok: true, kept: true } : { ok: false });
      if (!live()) return kept();
      const r = await N.post(name, withKey, timeoutMs ? { timeoutMs } : undefined);
      return r.offline ? kept() : r;
    }

    // Another go a little later, while anything waits: the stream may not have noticed the PC go and come back.
    function later() {
      clearTimeout(retry);
      retry = outbox().length ? setTimeout(() => { retry = null; flush().finally(later); }, RETRY_MS) : null;
    }

    /** Everything kept, oldest first, until one can't reach the PC. */
    async function flush() {
      if (flushing || !live() || !N.token()) return;
      flushing = true;
      let sent = 0;
      try {
        // Read again each time: one added or let go meanwhile counts.
        for (let e = outbox()[0]; e; e = outbox()[0]) {
          const r = await N.post(e.name, e.body, { timeoutMs: 180000 });
          // Still away, or asked to slow down: it stays, for the next go.
          if (r.offline || r.retry) break;
          if (r.unpaired) return;
          saveOutbox(L.outboxDrop(outbox(), e.key));
          if (r.ok) sent++;
          else toast(`“${e.label}” didn’t go: ${r.error || 'your PC turned it down.'}`, { tone: 'warn', ms: 6000 });
        }
      } finally { flushing = false; }
      if (sent) { buzz([6, 30, 6]); toast(sent === 1 ? 'Sent what you wrote while your PC was away.' : `Sent the ${sent} you wrote while your PC was away.`, { tone: 'ok', ms: 4200 }); }
    }

    /** The beach's card: what's waiting to go, each with Don't send. null when nothing is. */
    function outboxCard() {
      const list = outbox();
      if (!list.length) return null;
      const row = e => h('div', { class: 'out-row' },
        h('span', { class: 'out-what' }, h('b', { text: e.name === 'task' ? 'Task' : 'Reply' }), h('span', { text: ` ${e.label}` })),
        h('button', { type: 'button', class: 'btn ghost slim', text: 'Don’t send', onclick: () => saveOutbox(L.outboxDrop(outbox(), e.key)) }));
      return h('section', { class: 'card outbox', 'aria-label': 'Waiting to send' },
        h('div', { class: 'card-t' }, h('span', { class: 'card-title' }, icon('send'), ` ${L.plural(list.length, 'message')} waiting to send`)),
        h('p', { class: 'muted small', text: live() ? 'Sending now…' : `They go the moment ${S.view?.pc || 'your PC'} answers.` }),
        h('div', { class: 'out-list' }, ...list.map(row)));
    }

    /** fn() whenever the outbox changes (the beach redraws its card). -> stop */
    function onOutbox(fn) { listeners.add(fn); return () => listeners.delete(fn); }

    // ---------------------------------------------------------------- saved prompts

    const SAVED_KEY = 'shellby.pocket.saved';
    function saved() {
      try { return L.savedOf(JSON.parse(N.store.get(SAVED_KEY) || '[]')); } catch { return []; }
    }
    const saveSaved = list => N.store.set(SAVED_KEY, list.length ? JSON.stringify(list) : null);

    /** The chips above New task's box: tap one to fill the box, Save this for what's typed. */
    function savedRow(text) {
      const box = h('div', { class: 'saved', 'aria-label': 'Saved tasks' });
      let editing = false;
      function draw() {
        const list = saved();
        const chips = list.map(p => editing
          ? h('button', { type: 'button', class: 'proj saved-chip editing', 'aria-label': `Remove ${L.promptChip(p.text)}`, onclick: () => { saveSaved(L.dropPrompt(saved(), p.text)); draw(); } }, h('span', { text: L.promptChip(p.text) }), h('b', { 'aria-hidden': 'true', text: ' ×' }))
          : h('button', { type: 'button', class: 'proj saved-chip', title: p.text, onclick: () => { text.value = p.text; text.dispatchEvent(new Event('input')); text.focus(); } }, h('span', { text: L.promptChip(p.text) })));
        const save = h('button', { type: 'button', class: 'link', text: 'Save this', onclick: () => {
          const r = L.savePrompt(saved(), text.value);
          if (r.error) { toast(r.error); return; }
          saveSaved(r.list);
          toast('Saved. It’s a chip above the box now.', { tone: 'ok' });
          draw();
        } });
        const manage = list.length ? h('button', { type: 'button', class: 'link', text: editing ? 'Done' : 'Edit', onclick: () => { editing = !editing; draw(); } }) : null;
        box.replaceChildren(list.length ? h('span', { class: 'saved-label', text: 'Saved' }) : '', h('div', { class: 'projects saved-chips' }, ...chips), h('div', { class: 'saved-tools' }, save, manage));
      }
      draw();
      return box;
    }

    // ---------------------------------------------------------------- read aloud

    const SPEAK_KEY = 'shellby.pocket.speak';
    const synth = root.speechSynthesis;
    const canSpeak = () => !!synth && typeof root.SpeechSynthesisUtterance === 'function';
    const speaking = () => N.store.get(SPEAK_KEY) === '1';

    function say(md) {
      const words = L.spokenText(md);
      if (!words || !canSpeak()) return;
      const u = new root.SpeechSynthesisUtterance(words);
      u.rate = 1.05;
      synth.speak(u);
    }

    function hush() { try { synth?.cancel(); } catch { /* nothing playing */ } }

    /** A new item in the conversation that's open: his reply, read out when Read aloud is on. */
    function heard(tabId, item) {
      if (!speaking() || S.screen?.tabId !== tabId || item?.k !== 'text' || item.sub) return;
      say(item.text);
    }

    /** The conversation's Read aloud button: on, it reads his last reply and every one after. */
    function speakButton(tabId) {
      if (!canSpeak()) return null;
      const b = h('button', { type: 'button', class: 'btn ghost slim', 'aria-pressed': speaking() ? 'true' : 'false' }, icon('speak'), h('span', { class: 'btn-label', text: 'Read aloud' }));
      b.addEventListener('click', () => {
        const on = !speaking();
        N.store.set(SPEAK_KEY, on ? '1' : null);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        hush();
        if (!on) { toast('He stops reading aloud.'); return; }
        const last = [...(S.feeds.get(tabId)?.items || [])].reverse().find(i => i.k === 'text' && !i.sub);
        if (last) say(last.text);
        toast('He reads his replies aloud while a conversation is open.');
      });
      return b;
    }

    if (outbox().length) later();

    return { send, flush, outboxCard, onOutbox, outboxCount: () => outbox().length, savedRow, speakButton, heard, hush };
  };
})(window);
