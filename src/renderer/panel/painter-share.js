/* Shellby panel — saving and sharing in the Painter (painter.js makes it):
   Save (a skin to the skins folder, anything else as a pack of yours), Save and
   wear, and Share to the community gallery, or a pack file and an outfit code
   when there's no GitHub. Main checks it all again (src/main/wiring/painter.js). */
'use strict';
(function () {
  const { h, api, state, $ } = SB;
  const G = window.ShellbyPixelGrid;
  const KIND_WORD = { skin: 'him', accessory: 'it', effect: 'it', decor: 'it' };

  /**
   * x: what painter.js shares: { cur(), doc(), settings(), meta(), checksNow(),
   * showMe(check), forgetDraft(id), pendingDraft(), contestNow(kind),
   * statusOf(kind, id), shared(result), login(), fill(el, ...kids) }.
   */
  SB.paintShare = x => {
    const { doc, settings, meta, checksNow, showMe, pendingDraft, contestNow, statusOf, login, fill } = x;
    const cur = x.cur;
    let shareOpen = false;

    // ------------------------------------------------------------ saving

    /** Save it (a skin to the skins folder, anything else as a pack of yours). -> true when saved. */
    async function save({ andWear = false } = {}) {
      if (!cur()) return false;
      const list = checksNow();
      const block = list.find(c => c.blocks === 'save');
      if (block) { if (block.cells.length) showMe(block); SB.toast(block.text); return false; }
      if (!cur().name.trim()) { $('ptName').focus(); SB.toast(cur().mode === 'skin' ? 'Give him a name first.' : 'Give it a name first.'); return false; }
      const r = cur().mode === 'skin'
        ? await api.saveSkin(G.toSkin(doc(), meta()), { replace: cur().saved }).catch(() => null)
        : await api.saveItem(cur().mode, G.toItem(doc(), meta(), settings()), { replace: cur().saved }).catch(() => null);
      if (!r?.ok) { SB.toast(r?.error || "Couldn't save it."); return false; }
      cur().saved = true;
      await x.forgetDraft(cur().id);
      if (r.skins) { state.skins = r.skins; SB.renderSkins?.(); }
      if (andWear) await wearIt(r);
      else SB.toast(cur().mode === 'skin' ? `Saved ${cur().name}. He's in Settings → Look, and under Colors.` : `Saved ${cur().name}. It's in the Wardrobe${cur().mode === 'decor' ? ' and his tank\'s tray' : ''}.`, { ms: 5000 });
      if (cur().mode === 'skin' && !cur().author.trim()) SB.toast('Saved. Add who made him before you share him.', { ms: 5000 });
      return true;
    }

    async function wearIt(r) {
      if (cur().mode === 'skin') {
        const s = await api.setSettings({ skin: r.id });
        state.settings = s.settings;
        SB.toast(`He's wearing ${cur().name}.`);
        return;
      }
      const patch = cur().mode === 'effect' ? { effect: r.key } : { [settings().slot]: r.key };
      const w = await api.setOutfit(patch).catch(() => null);
      if (w?.view) SB.applyWardrobe?.(w.view);
      SB.toast(w?.ok === false ? w.error : `He's wearing ${cur().name}.`);
    }

    $('ptSave').addEventListener('click', () => save());
    $('ptSaveWear').addEventListener('click', () => save({ andWear: true }));

    // ------------------------------------------------------------ sharing

    function renderShare() {
      const box = $('ptShare');
      box.hidden = !shareOpen;
      if (!shareOpen) return;
      const list = checksNow();
      const blockers = list.filter(c => c.blocks === 'share' || c.blocks === 'save');
      const word = KIND_WORD[cur().mode];
      const contest = contestNow(cur().mode);
      const listed = statusOf(cur().mode, cur().id) === 'gallery';
      const close = h('button', { type: 'button', class: 'btn ghost slim-btn', onclick: () => { shareOpen = false; renderShare(); } }, 'Close');
      if (!SB.canPublish?.()) {
        fill(box,
          h('h4', { text: 'Share it with everyone' }),
          h('p', { text: state.github?.signedIn
            ? 'Sharing opens a pull request to the community gallery from your GitHub account. Turn on "Publish Wardrobe packs" in Settings → GitHub, and Share does it in one click.'
            : 'Sharing opens a pull request to the community gallery from your GitHub account. Sign in to GitHub in Settings and turn on "Publish Wardrobe packs", and Share does it in one click.' }),
          h('p', { text: 'Or save it as a pack file and open the pull request yourself (docs/ADDONS.md says how).' }),
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn slim-btn', onclick: () => { shareOpen = false; renderShare(); SB.setView('settings'); setTimeout(() => SB.$('githubGroup')?.scrollIntoView({ block: 'start' }), 80); } }, 'Set up GitHub'),
            h('button', { type: 'button', class: 'btn ghost slim-btn', onclick: saveAFile }, 'Save a file'),
            listed ? h('button', { type: 'button', class: 'btn ghost slim-btn', onclick: copyCode }, 'Copy outfit code') : null,
            close));
        return;
      }
      const check = contest ? h('input', { type: 'checkbox', id: 'ptContestBox', checked: true }) : null;
      fill(box,
        h('h4', { text: `Share ${word} with everyone` }),
        h('p', { text: `Opens a pull request to the community gallery as @${state.github.login}. Once it's reviewed and merged, anyone can add ${word} to their Shellby. Shared under CC BY 4.0, credited to "${cur().author || state.github.login}".` }),
        blockers.length ? h('div', {}, h('p', { text: 'First:' }), h('ul', {}, blockers.map(c => h('li', { text: c.text })))) : null,
        cur().wish ? h('p', { text: `For pack wish #${cur().wish.number} (${cur().wish.title}): the pull request says so, and Shellby offers to tell the wish.` }) : null,
        contest ? h('label', { class: 'toggle' }, check, h('span', { class: 'switch' }), `Enter the ${contest.monthName} contest${contest.theme ? ` (${contest.theme})` : ''}`) : null,
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn primary slim-btn', id: 'ptShareGo', disabled: blockers.length ? true : null, onclick: e => shareNow(e.currentTarget, contest && check.checked ? contest.month : null) }, cur().saved && !pendingDraft() ? 'Share' : 'Save and share'),
          h('button', { type: 'button', class: 'btn ghost slim-btn', onclick: saveAFile }, 'Save a file'),
          listed ? h('button', { type: 'button', class: 'btn ghost slim-btn', onclick: copyCode }, 'Copy outfit code') : null,
          close));
    }

    async function shareNow(btn, contestMonth) {
      btn.disabled = true;
      btn.textContent = 'Sharing…';
      try {
        if (!cur().saved || pendingDraft()) { if (!(await save())) return; }
        const r = await api.sharePainted(cur().mode, cur().id, { contest: contestMonth, wish: cur().wish?.number || null }).catch(() => null);
        if (r?.ok) {
          shareOpen = false;
          x.shared(r);
          renderShare();
          SB.toast(`Pull request opened for ${cur().name}. The gallery's Pack check reviews it next.${r.contestUrl ? ' Your contest entry is open in the browser: add the card and post it.' : ''}`, { action: 'View', onAction: () => api.openExternal(r.url), ms: 9000 });
        } else if (r?.needsGitHub) renderShare();
        else if (!r?.canceled) SB.toast(r?.error || "Couldn't share it.", { ms: 7000 });
      } finally {
        if (btn.isConnected) { btn.disabled = false; renderShare(); }
      }
    }

    async function saveAFile() {
      if (!cur().saved || pendingDraft()) { if (!(await save())) return; }
      const r = await api.exportPainted(cur().mode, cur().id).catch(() => null);
      if (r?.ok) SB.toast('Saved the pack file. Open a pull request with it to github.com/x-salmon/shellby-packs.', { ms: 7000 });
      else if (!r?.canceled) SB.toast(r?.error || "Couldn't save the file.");
    }

    async function copyCode() {
      const r = await api.paintedCode(cur().mode, cur().id).catch(() => null);
      if (!r?.ok) return SB.toast("It isn't in the gallery yet.");
      await navigator.clipboard.writeText(r.code).catch(() => {});
      SB.toast(`Copied ${r.code}. Anyone with Shellby can wear him from it.`);
    }

    $('ptShareBtn').addEventListener('click', () => { shareOpen = !shareOpen; renderShare(); });

    // A picture to post: the moment card for a skin (moment-card.js draws it).
    $('ptCard').addEventListener('click', async () => {
      const skin = G.toSkin(doc(), meta());
      try { await SB.momentCard?.share('skin', { skin, name: cur().name || 'My crab', author: cur().author || login() }); } catch { SB.toast("Couldn't make the picture."); }
    });

    return {
      save, renderShare,
      /** A new drawing, or the start screen: the sheet goes. */
      close() { shareOpen = false; renderShare(); },
      get open() { return shareOpen; },
    };
  };
})();
