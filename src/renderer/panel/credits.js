/* Shellby panel — About → Made by (src/main/credits.js): everyone who has made
   Shellby, grouped (contest winners, pack makers, code), each name a link to
   their GitHub profile. You're marked when you're signed in. Main sends the
   list (credits:get); nothing here is ever put in as HTML. */
'use strict';
(function () {
  const { h, api, $ } = SB;
  const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

  function person(p) {
    if (!LOGIN_RE.test(p.login || '')) return null;
    return h('li', { class: p.me ? 'me' : null },
      h('button', { type: 'button', class: 'link-btn', title: `github.com/${p.login}`, onclick: () => api.openExternal(`https://github.com/${p.login}`) }, `@${p.login}`),
      p.note ? h('span', { class: 'mb-note', text: ` ${p.note}` }) : null);
  }

  function render(v) {
    const groups = v?.groups || [];
    $('madeByGroups').replaceChildren(...groups.map(g => h('section', { class: 'mb-group', dataset: { group: g.id } },
      h('h4', { text: g.title }),
      h('ul', { class: 'mb-list' }, ...g.people.map(person)))));
    const m = v?.mine;
    const yours = m && [m.wins.length ? `🏆 ${m.wins.join(', ')}` : null, m.packs ? `🪸 ${m.packs === 1 ? 'a pack' : `${m.packs} packs`} in the gallery` : null, m.code ? '🔧 code' : null].filter(Boolean);
    $('madeByMine').hidden = !v;
    $('madeByMine').textContent = !v?.signedIn
      ? 'Made something for Shellby? Sign in to GitHub (Settings → GitHub) and its trophies are yours.'
      : yours?.length ? `You're in here, @${m.login}: ${yours.join(' · ')}. Thank you.` : `Nothing under @${m?.login} yet. A pack in the gallery or a merged pull request puts you here.`;
  }

  async function toggle() {
    const box = $('madeBy');
    const open = box.hidden;
    box.hidden = !open;
    $('madeByBtn').setAttribute('aria-expanded', String(open));
    if (open) render(await api.getCredits().catch(() => null));
  }

  $('madeByBtn')?.addEventListener('click', toggle);
  SB.credits = { open: () => { if ($('madeBy').hidden) return toggle(); return api.getCredits().then(render); } };
})();
