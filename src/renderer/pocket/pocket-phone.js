/* Shellby on your phone — what a notification tap and the Phone screen need
   past pocket.js: one permission prompt on its own (#/prompt/<id>/<r>), and
   the quiet hours card. pocket.js hands in what it shares with the other screens. */
'use strict';
(function (root) {
  root.PocketPhone = ({ S, L, D, h, ios, standalone, icon, live, tabOf, go, toast, act, topbar, offlineBanner, promptCard, canAct }) => {
    // ---------------------------------------------------------------- one prompt, from its notification

    // An iPhone puts no buttons on a web app's notification, so a tap opens
    // here instead: just this prompt, big Allow and Deny, then the beach. The
    // prompt is only ever the PC's own (view.prompts): the address names it,
    // and the PC says whether it's still waiting.
    function promptScreen(tabId, requestId) {
      const body = h('div', { class: 'prompt-body' });
      const el = h('div', { class: 'screen prompt-screen' }, topbar({ back: '#/' }), h('div', { class: 'offline-slot' }), body);
      let seen = false;     // it was waiting at some point while this was open
      let drawnFor = null;  // the prompt the card on screen is for
      const beach = () => go('#/');
      function update() {
        el.replaceChild(topbar({ back: '#/' }), el.firstChild);
        el.querySelector('.offline-slot').replaceChildren(offlineBanner() || '');
        const v = S.view;
        const p = v?.prompts?.find(x => x.tabId === tabId && x.requestId === requestId) || null;
        if (p) {
          seen = true;
          // The card is kept while it's the same prompt, so a button mid-press isn't replaced under a thumb.
          if (drawnFor === p.requestId && !S.answering.has(requestId)) return;
          drawnFor = p.requestId;
          body.replaceChildren(promptCard(p, { after: () => { toast(S.answering.get(requestId) === 'deny' ? 'Denied.' : 'Allowed. On he goes.', { tone: 'ok' }); beach(); } }));
          return;
        }
        drawnFor = null;
        if (!v) { body.replaceChildren(h('div', { class: 'loading' }, D.crab({ px: 4, state: 'working' }), h('p', { text: 'Finding your PC…' }))); return; }
        // Gone after it was here: answered (here, or at the desk), so back to the beach.
        if (seen && live()) { beach(); return; }
        const t = tabOf(tabId);
        body.replaceChildren(h('div', { class: 'empty prompt-gone' },
          D.crab({ px: 4, state: live() ? 'idle' : 'sleeping', label: '' }),
          h('h2', { class: 'tide-title', text: live() ? 'That one’s been answered' : 'Can’t ask your PC yet' }),
          h('p', { text: live() ? `Nothing is waiting on you${t ? ` in “${t.title}”` : ''} for that any more.` : 'The prompt shows once your PC answers. It may be asleep.' }),
          t ? h('button', { type: 'button', class: 'btn ghost', text: 'See the conversation', onclick: () => go(`#/tab/${encodeURIComponent(tabId)}`) }) : null,
          h('button', { type: 'button', class: 'btn go big', text: 'Back to the beach', onclick: beach })));
      }
      update();
      return { el, update, title: 'Permission' };
    }

    // ---------------------------------------------------------------- quiet hours

    // Quiet hours (pocket/quiet.js): on or off, and from when to when, in the PC's own time.
    function quietCard() {
      const q = S.view?.quiet || { enabled: false, from: '22:00', to: '07:00' };
      const may = canAct();
      const box = h('div', { class: 'card' });
      const toggle = h('input', { type: 'checkbox', 'aria-label': 'Quiet hours on', ...(q.enabled ? { checked: 'checked' } : {}), ...(may ? {} : { disabled: 'disabled' }) });
      const from = h('input', { type: 'time', class: 'time-in', 'aria-label': 'Quiet from', value: q.from, ...(may ? {} : { disabled: 'disabled' }) });
      const to = h('input', { type: 'time', class: 'time-in', 'aria-label': 'Quiet until', value: q.to, ...(may ? {} : { disabled: 'disabled' }) });
      const set = async patch => {
        const r = await act('quiet', patch, { okText: 'enabled' in patch ? (patch.enabled ? 'Quiet hours are on.' : 'Quiet hours are off.') : 'Saved.' });
        if (!r.ok) { toggle.checked = q.enabled; from.value = q.from; to.value = q.to; }
      };
      toggle.addEventListener('change', () => set({ enabled: toggle.checked }));
      from.addEventListener('change', () => { if (from.value) set({ from: from.value }); });
      to.addEventListener('change', () => { if (to.value) set({ to: to.value }); });
      box.append(
        h('div', { class: 'card-t' }, h('span', { class: 'card-title' }, icon('moon'), ' Quiet hours'), h('label', { class: 'switch-row' }, toggle, h('span', { class: 'switch' }))),
        h('p', { class: 'muted', text: q.enabled ? `From ${q.from} to ${q.to}, nothing buzzes. A permission prompt still arrives quietly, so the badge counts it; the rest waits for the morning.` : 'Hold his notifications back overnight. A permission prompt still arrives quietly, so the badge counts it.' }),
        h('div', { class: 'time-row' }, h('label', { class: 'time-field' }, h('span', { text: 'From' }), from), h('label', { class: 'time-field' }, h('span', { text: 'To' }), to)),
        h('p', { class: 'fine left', text: `In ${S.view?.pc || 'your PC'}’s time, for every phone paired with it.` }));
      return box;
    }

    // ---------------------------------------------------------------- notifications on this phone

    async function pushState() {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { can: false, why: ios && !standalone() ? 'Add Shellby to your Home Screen first: iPhones only send notifications to apps there.' : 'This browser can’t get notifications.' };
      if (Notification.permission === 'denied') return { can: false, why: 'Notifications are turned off for Shellby. Turn them on in your phone’s Settings.' };
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        return { can: true, on: !!sub && Notification.permission === 'granted' };
      } catch {
        return { can: false, why: 'Notifications aren’t ready yet. Try again in a moment.' };
      }
    }

    async function turnOnPush() {
      const key = S.view?.pushKey;
      if (!key) { toast("Your PC can't send notifications yet.", { tone: 'warn' }); return false; }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('Notifications stay off. You can turn them on later here.', { ms: 4000 }); return false; }
      try {
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (sub && !sameKey(sub, key)) { await sub.unsubscribe(); sub = null; }
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: L.keyBytes(key) });
        const r = await act('push', { subscription: sub.toJSON() });
        if (r.ok) toast("Notifications are on. He'll buzz when he needs you.", { tone: 'ok' });
        return r.ok;
      } catch (err) {
        toast(`Notifications didn't turn on: ${err.message || err}`, { tone: 'warn', ms: 5000 });
        return false;
      }
    }

    function sameKey(sub, key) {
      try {
        const have = new Uint8Array(sub.options?.applicationServerKey || []);
        const want = L.keyBytes(key);
        return have.length === want.length && have.every((b, i) => b === want[i]);
      } catch { return true; }
    }

    async function turnOffPush() {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        await sub?.unsubscribe();
      } catch { /* already gone */ }
      await act('push', { subscription: null }, { okText: 'Notifications are off.' });
    }

      return { promptScreen, quietCard, pushState, turnOnPush, turnOffPush };
  };
})(window);
