/* Shellby on your phone — pieces pocket.js shows but keeps out of its own
   file: Claude's questions and plans answered from the phone, the usage
   detail, a moment to share, speaking or snapping a new task, what another
   app shared, and keeping the screen on while you watch. */
'use strict';
(function (root) {
  root.PocketBits = ({ S, L, D, N, h, icon, toast, buzz, act, actButton }) => {
    // after(): once an answer went (the prompt screen goes back to the beach).
    function questionSheet(p, after = null) {
      return { label: 'Question', tall: true, build: close => {
        const done = () => { close(); after?.(); };
        const el = h('div', { class: 'qa-sheet' }, h('h2', { class: 'sheet-title', text: p.questions.length > 1 ? `${p.questions.length} quick questions` : 'Quick question' }), h('p', { class: 'ask-where', text: p.title }), questionForm(p, done));
        const watch = () => { if (!S.view?.prompts?.some(x => x.requestId === p.requestId)) close(); };
        return { el, update: watch };
      } };
    }

    // Claude's questions: tap an option (or several), or type your own, then Send. Skip lets him carry on.
    function questionForm(p, close) {
      const chosen = p.questions.map(() => new Set());
      const other = p.questions.map(() => '');
      const answerOf = i => [...chosen[i], ...(other[i].trim() ? [other[i].trim()] : [])].join(', ');
      const ready = () => p.questions.every((_, i) => answerOf(i));
      const send = actButton({
        label: p.questions.length > 1 ? 'Send answers' : 'Send answer', cls: 'allow big',
        run: async () => {
          if (!ready()) { toast('Answer each question first.'); return; }
          const answers = Object.fromEntries(p.questions.map((q, i) => [q.question, answerOf(i)]));
          S.answering.set(p.requestId, 'allow');
          const r = await act('answer', { tabId: p.tabId, requestId: p.requestId, decision: 'allow', answers }, { okText: 'Sent.' });
          if (!r.ok) S.answering.delete(p.requestId);
          else close();
        },
      });
      const skip = actButton({
        label: 'Skip', cls: 'big',
        run: async () => { const r = await act('answer', { tabId: p.tabId, requestId: p.requestId, decision: 'deny' }); if (r.ok) close(); },
      });
      const blocks = p.questions.map((q, i) => {
        const opts = q.options.map(o => {
          const b = h('button', { type: 'button', class: 'qa-opt', 'aria-pressed': 'false' }, h('span', { class: 'qa-label', text: o.label }), o.description ? h('span', { class: 'qa-desc', text: o.description }) : null);
          b.addEventListener('click', () => {
            if (q.multiSelect) { if (chosen[i].has(o.label)) chosen[i].delete(o.label); else chosen[i].add(o.label); } else { chosen[i].clear(); chosen[i].add(o.label); }
            for (const [j, ob] of [...block.querySelectorAll('.qa-opt')].entries()) ob.setAttribute('aria-pressed', String(chosen[i].has(q.options[j].label)));
            buzz(6);
          });
          return b;
        });
        const own = h('input', { type: 'text', class: 'qa-other', maxlength: '500', placeholder: q.options.length ? 'Or type your own…' : 'Your answer…', 'aria-label': `Your own answer to: ${q.question}` });
        own.addEventListener('input', () => { other[i] = own.value; });
        const block = h('fieldset', { class: 'qa' },
          h('legend', {}, q.header ? h('span', { class: 'pill', text: q.header }) : null, h('span', { class: 'qa-q', text: q.question })),
          q.multiSelect ? h('p', { class: 'muted small', text: 'Pick any that apply.' }) : null,
          h('div', { class: 'qa-opts' }, ...opts), own);
        return block;
      });
      return h('div', { class: 'qa-form' }, ...blocks, h('div', { class: 'btns' }, skip, send));
    }

    // A plan, in full. Approve stays shut until you've scrolled to the end; Keep planning sends your notes.
    function planSheet(p, after = null) {
      return { label: 'The plan', tall: true, build: closeSheet => {
        const close = () => { closeSheet(); after?.(); };
        const body = h('div', { class: 'plan-body', tabindex: '0', 'aria-label': 'The plan' }, h('pre', { class: 'plan-text', text: p.planText }));
        const notes = h('textarea', { class: 'task-in', rows: '3', maxlength: '2000', placeholder: 'What should change? (optional)', 'aria-label': 'Notes on the plan' });
        let read = false;
        const approve = actButton({
          label: 'Approve', cls: 'allow big',
          run: async () => {
            if (!read) { toast('Read it to the end first.'); return; }
            const r = await act('answer', { tabId: p.tabId, requestId: p.requestId, decision: 'allow', read: true }, { okText: 'Approved. On to the work.' });
            if (r.ok) close();
          },
        });
        approve.setAttribute('aria-disabled', 'true');
        approve.classList.add('locked');
        const reached = () => {
          if (read || body.scrollTop + body.clientHeight < body.scrollHeight - 24) return;
          read = true;
          approve.removeAttribute('aria-disabled');
          approve.classList.remove('locked');
          hint.textContent = 'You’ve read it all.';
        };
        body.addEventListener('scroll', reached, { passive: true });
        requestAnimationFrame(reached); // a short plan fits without scrolling
        const keep = actButton({
          label: 'Keep planning', cls: 'big',
          run: async () => {
            const r = await act('answer', { tabId: p.tabId, requestId: p.requestId, decision: 'deny', notes: notes.value }, { okText: 'Sent back to keep planning.' });
            if (r.ok) close();
          },
        });
        const hint = h('p', { class: 'muted small', role: 'status', text: 'Scroll to the end to approve it.' });
        const el = h('div', { class: 'plan-sheet' }, h('h2', { class: 'sheet-title', text: 'Here’s my plan' }), h('p', { class: 'ask-where', text: p.title }), body, hint, notes, h('div', { class: 'btns' }, keep, approve));
        const watch = () => { if (!S.view?.prompts?.some(x => x.requestId === p.requestId)) closeSheet(); };
        return { el, update: watch };
      } };
    }


    // ---------------------------------------------------------------- usage

    // The weekly window, the pace, and what the spending guard keeps back.
    function usageDetail(u) {
      const out = [];
      if (u.weekPct != null) {
        out.push(h('p', { class: 'usage-row' }, h('b', { text: `${u.weekPct}% of your week used.` }), u.weekResetsAt ? ` Resets ${L.day(u.weekResetsAt)}.` : ''),
          h('div', { class: 'bar' }, h('i', { class: `w${Math.min(100, Math.round(u.weekPct / 5) * 5)} ${u.weekPct >= 85 ? 'hot' : u.weekPct >= 60 ? 'warm' : ''}` })));
      }
      if (u.pace?.hitText) out.push(h('p', { class: `usage-row${u.pace.warn ? ' warn' : ''}`, text: `At this pace you reach the limit ${u.pace.hitText}.` }));
      if (u.guard) out.push(h('p', { class: 'usage-row muted', text: `The spending guard keeps ${u.guard.reserve}% for you: routines and queued work stop at ${u.guard.ceiling}%.` }));
      if (u.readAt) out.push(h('p', { class: 'fine', text: `Read at ${L.clock(u.readAt)}.` }));
      return out;
    }

    // ---------------------------------------------------------------- sharing a moment

    // A picture of him with what landed, through the phone's own share sheet.
    async function momentPicture(t) {
      const svg = D.crab({ px: 8, state: 'success', label: '' }).querySelector('svg');
      if (!svg) return null;
      const W = 1080, H = 1080;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      g.fillStyle = '#071012'; g.fillRect(0, 0, W, H);
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
      await img.decode();
      const scale = Math.min(520 / img.width, 420 / img.height);
      g.imageSmoothingEnabled = false;
      g.drawImage(img, (W - img.width * scale) / 2, 170, img.width * scale, img.height * scale);
      g.fillStyle = '#ff7a5c'; g.textAlign = 'center';
      g.font = '700 64px "Pixelify Sans", monospace';
      g.fillText('Nailed it', W / 2, 700);
      g.fillStyle = '#f3e9d7'; g.font = '40px "Atkinson Hyperlegible", sans-serif';
      g.fillText(String(t.title).slice(0, 44), W / 2, 780);
      if (t.ready) { g.fillStyle = '#9fdcc9'; g.font = '36px "Martian Mono", monospace'; g.fillText(`+${t.ready.added} −${t.ready.removed} · ${L.plural(t.ready.files, 'file')}`, W / 2, 850); }
      g.fillStyle = '#7d8f8c'; g.font = '28px "Atkinson Hyperlegible", sans-serif';
      g.fillText('Shellby', W / 2, 1010);
      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      return blob ? new File([blob], 'shellby.png', { type: 'image/png' }) : null;
    }

    async function shareTurn(t) {
      const text = t.ready ? `Shellby landed “${t.title}”: +${t.ready.added} −${t.ready.removed} across ${L.plural(t.ready.files, 'file')}.` : `Shellby finished “${t.title}”.`;
      const file = await momentPicture(t).catch(() => null);
      const withFile = file && navigator.canShare?.({ files: [file] }) ? { files: [file] } : {};
      try {
        if (navigator.share) { await navigator.share({ text, ...withFile }); return; }
        await navigator.clipboard?.writeText(text);
        toast('Copied, ready to paste.', { tone: 'ok' });
      } catch (err) {
        if (err?.name !== 'AbortError') toast('It didn’t share.', { tone: 'warn' });
      }
    }


    function voiceButton(box) {
      const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Rec) return null;
      let rec = null;
      const b = h('button', { type: 'button', class: 'btn ghost slim', 'aria-pressed': 'false' }, icon('mic'), h('span', { class: 'btn-label', text: 'Speak' }));
      const done = () => { rec = null; b.setAttribute('aria-pressed', 'false'); b.querySelector('.btn-label').textContent = 'Speak'; };
      b.addEventListener('click', () => {
        if (rec) { rec.stop(); return; }
        rec = new Rec();
        rec.lang = navigator.language || 'en-GB';
        rec.interimResults = true;
        rec.continuous = false;
        const before = box.value ? `${box.value.trimEnd()} ` : '';
        rec.onresult = e => {
          box.value = before + [...e.results].map(r => r[0].transcript).join('');
          box.dispatchEvent(new Event('input'));
        };
        rec.onerror = e => { if (e.error === 'not-allowed') toast('Let Shellby use the microphone in your phone’s Settings.', { tone: 'warn', ms: 4800 }); };
        rec.onend = done;
        try { rec.start(); buzz(8); b.setAttribute('aria-pressed', 'true'); b.querySelector('.btn-label').textContent = 'Listening…'; } catch { done(); }
      });
      return b;
    }

    const PHOTO_MAX = 2000; // px on the long side, as the desk keeps a pasted picture

    // A picture as a JPEG no bigger than the desk would keep: HEIC and huge camera shots never leave the phone.
    async function shrink(file) {
      const bmp = await window.createImageBitmap(file);
      const scale = Math.min(1, PHOTO_MAX / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close?.();
      return new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
    }

    // given: pictures to start with (shared from another app), each sent as if picked.
    function photoButton(photos, strip, { given = [] } = {}) {
      const pick = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', 'aria-hidden': 'true', tabindex: '-1' });
      const draw = () => strip.replaceChildren(...photos.map((p, i) => h('span', { class: `photo${p.id ? '' : ' sending'}` },
        h('img', { src: p.url, alt: `Picture ${i + 1}` }),
        h('button', { type: 'button', class: 'photo-x', 'aria-label': 'Take it out', text: '×', onclick: () => { URL.revokeObjectURL(p.url); photos.splice(photos.indexOf(p), 1); draw(); } }))));
      pick.addEventListener('change', () => {
        const file = pick.files?.[0];
        pick.value = '';
        if (file) add(file);
      });
      // In the order they were shared, one after another.
      given.slice(0, 4).reduce((p, file) => p.then(() => add(file)), Promise.resolve());
      async function add(file) {
        if (photos.length >= 4) { toast('Four pictures at most.'); return; }
        let blob;
        try { blob = await shrink(file); } catch { blob = null; }
        if (!blob) { toast('That picture couldn’t be read.', { tone: 'warn' }); return; }
        const p = { id: null, url: URL.createObjectURL(blob) };
        photos.push(p);
        draw();
        const r = await N.upload(blob);
        if (r.ok) p.id = r.id;
        else {
          toast(r.error || 'It didn’t send.', { tone: 'warn' });
          // Taken out with × while it was on its way: already gone.
          const at = photos.indexOf(p);
          if (at >= 0) photos.splice(at, 1);
          URL.revokeObjectURL(p.url);
        }
        draw();
      }
      const b = h('button', { type: 'button', class: 'btn ghost slim', onclick: () => pick.click() }, icon('camera'), h('span', { class: 'btn-label', text: 'Picture' }));
      return h('span', {}, b, pick);
    }


    // ---------------------------------------------------------------- shared from another app

    const SHARED = 'shellby-pocket-shared';
    const SHARED_FRESH_MS = 10 * 60 * 1000;

    /** What sw.js kept from a share, once: { text, photos: [Blob] }, or null. */
    async function takeShared() {
      try {
        const kept = await window.caches.open(SHARED);
        const res = await kept.match('/__shared');
        if (!res) return null;
        const meta = await res.json();
        const photos = [];
        for (let i = 0; i < Math.min(4, Number(meta.photos) || 0); i++) {
          const r = await kept.match(`/__shared/${i}`);
          if (r) photos.push(await r.blob());
        }
        for (const k of await kept.keys()) await kept.delete(k);
        if (!Number.isFinite(meta.at) || Date.now() - meta.at > SHARED_FRESH_MS) return null;
        return { text: String(meta.text || '').slice(0, 4000), photos };
      } catch { return null; }
    }

    // ---------------------------------------------------------------- keeping the screen on

    // Keep awake: while a conversation is open and the app is in front, the screen
    // stays on (the browser's Wake Lock), when you've asked and the phone can.
    // The browser lets it go whenever the app goes to the back; sync() takes it again.
    const AWAKE_KEY = 'shellby.pocket.awake';
    // A lock that arrives once it's no longer wanted (the conversation closed,
    // the app went to the back) is let go at once, and only one is ever asked for at a time.
    const wake = {
      lock: null,
      asking: null,
      can: () => 'wakeLock' in navigator,
      wanted: () => N.store.get(AWAKE_KEY) === '1',
      still: () => wake.wanted() && document.visibilityState === 'visible' && !!S.screen?.tabId,
      async sync(watching) {
        if (!(watching && wake.still())) {
          const lock = wake.lock;
          wake.lock = null;
          if (lock) { try { await lock.release(); } catch { /* already gone */ } }
          return;
        }
        if (wake.lock) return;
        if (!wake.asking) wake.asking = navigator.wakeLock.request('screen').catch(() => null).finally(() => { wake.asking = null; });
        const lock = await wake.asking;
        if (!lock || wake.lock === lock) return;
        if (!wake.still() || wake.lock) { try { await lock.release(); } catch { /* already gone */ } return; }
        wake.lock = lock;
        lock.addEventListener('release', () => { if (wake.lock === lock) wake.lock = null; });
      },
      async set(on, watching) {
        N.store.set(AWAKE_KEY, on ? '1' : null);
        await wake.sync(watching);
        return !!wake.lock === on;
      },
    };

    return { questionSheet, planSheet, usageDetail, shareTurn, voiceButton, photoButton, takeShared, wake };
  };
})(window);
