/* Shellby on your phone — the permission card: one prompt from the PC (a
   command, an edit, a plan, a question or a helper's ask) with a glimpse of
   what it would do, Allow, Deny and Always where the desk offers them, and no
   button a read-only phone can't press. The beach, a conversation
   (pocket-tab.js) and the prompt screen (pocket-phone.js) all draw it.
   pocket.js hands in what it shares with the other screens. */
'use strict';
(function (root) {
  root.PocketAsk = ({ S, L, D, h, icon, go, buzz, act, actButton, canAct, lookOnly, refresh, openSheet, questionSheet, planSheet }) => {
    // A prompt from another of your PCs (pcId) is answered through this one (main's pocket/actions.js pcs-answer).
    const answerAct = (p, body, o) => (p.pcId ? act('pcs-answer', { pcId: p.pcId, ...body }, o) : act('answer', body, o));
    // after(): what happens once an answer went (the prompt screen goes back to the beach).
    // Only ever a page on your tailnet, as the PC switcher (pocket-wide.js) checks.
    const TAILNET = /^https:\/\/[a-z0-9.-]+\.ts\.net(:\d+)?$/;
    // Its conversation: here, or on its own PC's page for one from another PC.
    const seeIt = p => (p.pcId ? (TAILNET.test(p.pcUrl || "") ? location.assign(`${p.pcUrl}/#/tab/${encodeURIComponent(p.tabId)}`) : undefined) : go(`#/tab/${encodeURIComponent(p.tabId)}`));
    function promptCard(p, /** @type {{ inTab?: boolean, after?: (() => void) | null }} */ { inTab = false, after = null } = {}) {
      const sending = S.answering.get(p.requestId);
      const card = h('article', { class: `ask${p.deskOnly ? ' desk' : ''}${sending ? ' sending' : ''}`, 'aria-label': `${p.title}: ${p.ask || p.label}` });
      card.append(h('div', { class: 'ask-head' },
        D.crab({ px: 1.6, state: 'asking', label: '' }),
        h('div', { class: 'ask-what' },
          h('p', { class: 'ask-title', text: p.deskOnly ? 'One for the desk' : p.plan ? 'Here’s my plan' : p.question ? 'I’ve a question' : p.helper ? 'A helper wants to do this' : 'Can I do this?' }),
          h('p', { class: 'ask-where', text: p.helper ? `${p.title} · ${p.helper}` : p.title }))));
      // Why it can't be answered here comes first: no buttons below would otherwise read as broken.
      if (p.deskOnly) card.append(h('p', { class: 'desk-only' }, icon('eye'), h('span', { text: p.deskOnly })));
      card.append(h('p', { class: 'ask-plain', text: p.question || p.plan || p.ask || [p.label, p.detail].filter(Boolean).join(' ') }));
      const pv = p.preview;
      // The desk shows it in full, so here a glimpse is enough.
      if (pv?.kind === 'command') card.append(h('pre', { class: `cmd${p.deskOnly ? ' peek' : ''}`, text: pv.command }));
      // Edits and writes in full on the beach too, in boxes that scroll: Allow sits right under them.
      else if (pv?.kind === 'edit') card.append(editPreview(pv));
      else if (pv?.kind === 'write') card.append(h('div', { class: 'cmd-file', text: pv.file }), h('pre', { class: 'cmd write', text: pv.content }));
      else if (pv?.kind === 'url') card.append(h('pre', { class: 'cmd', text: pv.url }));
      else if (pv?.file) card.append(h('div', { class: 'cmd-file', text: shortPath(pv.file) }));
      for (const w of p.warnings || []) card.append(h('p', { class: 'flag' }, icon('warn'), h('span', { text: `Heads up: ${w}` })));
      const answer = decision => actButton({
        label: decision === 'always' ? p.always : decision === 'allow' ? (sending === 'allow' ? 'Allowing…' : 'Allow') : (sending === 'deny' ? 'Denying…' : 'Deny'),
        cls: decision === 'allow' ? 'allow big' : decision === 'always' ? 'always' : 'big',
        run: async () => {
          S.answering.set(p.requestId, decision);
          const r = await answerAct(p, { tabId: p.tabId, requestId: p.requestId, decision });
          if (!r.ok) S.answering.delete(p.requestId);
          else buzz(decision === 'deny' ? 12 : [6, 30, 6]);
          refresh();
          if (r.ok) after?.();
        },
      });
      // A phone that may only look sees the prompt, and no way to answer it.
      if (!canAct()) {
        card.append(lookOnly());
        if (!inTab) card.append(h('button', { type: 'button', class: 'btn ghost', text: 'See the conversation', onclick: () => seeIt(p) }));
        return card;
      }
      // Only the desk can say yes, but a no from here lets the conversation get on without it.
      if (p.deskOnly) {
        card.append(h('div', { class: 'btns' }, answer('deny'),
          inTab ? null : h('button', { type: 'button', class: 'btn ghost', text: 'See the conversation', onclick: () => seeIt(p) })));
        return card;
      }
      // In a sheet: the beach redraws its cards as things change, and a half-picked answer mustn't go.
      if (p.questions) {
        card.append(h('button', { type: 'button', class: 'btn go big', text: p.questions.length > 1 ? 'Answer them' : 'Answer it', onclick: () => openSheet(questionSheet(p, after)) }));
        return card;
      }
      if (p.planText) {
        card.append(h('button', { type: 'button', class: 'btn go big', text: 'Read the plan', onclick: () => openSheet(planSheet(p, after)) }));
        return card;
      }
      card.append(h('div', { class: 'btns' }, answer('deny'), answer('allow')));
      if (p.always) card.append(answer('always'));
      return card;
    }

    function editPreview(pv) {
      const box = h('div', { class: 'edit-pv' }, h('div', { class: 'cmd-file', text: pv.file }));
      // Every line of every edit, in a box that scrolls: the phone may allow it, so nothing is left out.
      const lines = (text, kind) => String(text || '').split('\n').map(l => h('div', { class: `diff-row ${kind}` }, h('span', { class: 'diff-sign', text: kind === 'add' ? '+' : '−' }), h('span', { class: 'diff-text', text: l || ' ' })));
      const edits = Array.isArray(pv.edits) && pv.edits.length ? pv.edits : [{ old: pv.old, new: pv.new }];
      const gap = () => h('div', { class: 'diff-row gap' }, h('span', { class: 'diff-text', text: '⋯' }));
      box.append(h('div', { class: 'diff compact' }, ...edits.flatMap((e, n) => [...(n ? [gap()] : []), ...lines(e.old, 'del'), ...lines(e.new, 'add')])));
      if (edits.length > 1) box.append(h('p', { class: 'muted small', text: `${L.plural(edits.length, 'edit')} to the same file, all shown above.` }));
      return box;
    }

    const shortPath = p => {
      const parts = String(p || '').split(/[\\/]/).filter(Boolean);
      return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : parts.join('/');
    };

    return { promptCard, shortPath };
  };
})(window);
