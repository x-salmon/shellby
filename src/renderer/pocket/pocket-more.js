/* Shellby on your phone — the screens past the beach:

     #/more              Guard my focus, and the way to everything below
     #/routines          routines (Run now, on/off) and workflows (Run now)
     #/notes             a project's Notes: read, add, tick off
     #/wardrobe          what he can wear, and a pat on the head
     #/files/<id>/<path> a conversation's folder, read-only, when allowed

   Each asks the PC when it opens (and after a change), rather than riding the
   stream: they're looked at now and then, not watched. pocket.js hands in
   what it shares with the other screens. */
'use strict';
(function (root) {
  root.PocketMore = ({ S, L, D, N, h, icon, live, go, toast, buzz, act, actButton, topbar, offlineBanner, dock, confirmSheet, canAct, lookOnly }) => {
    const FOCUS = [15, 25, 50];

    // A screen that loads from the PC: draw(data) once it answers, a crab while it doesn't.
    function loaded({ title, active = 'more', back = '#/more', backLabel = 'More', name, body = {}, draw }) {
      const scroll = h('div', { class: 'scroll' });
      const el = h('div', { class: 'screen' }, topbar({ back, backLabel }), h('div', { class: 'offline-slot' }), scroll, dock(active));
      let data = null;
      let asked = false;
      async function load() {
        asked = true;
        const r = await N.post(name, body);
        if (r.ok) data = r; else if (!data) data = { error: r.error || 'Your PC didn’t answer.' };
        paint();
      }
      function paint() {
        el.querySelector('.offline-slot').replaceChildren(offlineBanner() || '');
        if (!data) { scroll.replaceChildren(h('h2', { class: 'screen-title', text: title }), h('div', { class: 'loading' }, D.crab({ px: 3, state: 'working' }))); return; }
        if (data.error) { scroll.replaceChildren(h('h2', { class: 'screen-title', text: title }), h('div', { class: 'empty' }, h('p', { text: data.error }))); return; }
        scroll.replaceChildren(h('h2', { class: 'screen-title', text: title }), ...draw(data, load));
      }
      paint();
      if (live()) load();
      return { el, title, update: () => { if (!asked && live()) load(); else paint(); } };
    }

    // ---------------------------------------------------------------- more

    function focusCard() {
      const f = S.view?.focus || {};
      const on = f.phase && f.endsAt > Date.now();
      return h('div', { class: 'card' },
        h('div', { class: 'card-t' }, h('span', { class: 'card-title' }, icon('focus'), ' Guard my focus'),
          h('span', { class: `pill ${on ? '' : 'dim'}`, text: on ? (f.phase === 'break' ? 'on a break' : `until ${L.clock(f.endsAt)}`) : 'off' })),
        h('p', { class: 'muted', text: on ? 'He holds notifications back until it ends.' : 'Hold his notifications back while you get something done.' }),
        !canAct() ? lookOnly()
          : on
            ? actButton({ label: 'Stop it', cls: 'ghost slim', run: () => act('focus', { stop: true }, { okText: 'Focus stopped.' }) })
            : h('div', { class: 'btns' }, ...FOCUS.map(m => actButton({ label: `${m} min`, cls: 'slim', run: () => act('focus', { minutes: m }, { okText: `Guarding your focus for ${m} minutes.` }) }))));
    }

    function moreScreen() {
      const scroll = h('div', { class: 'scroll' });
      const el = h('div', { class: 'screen' }, topbar(), h('div', { class: 'offline-slot' }), scroll, dock('more'));
      const link = (hash, name, label, sub) => h('a', { href: hash, class: 'card link-card' },
        h('span', { class: 'card-t' }, h('span', { class: 'card-title' }, icon(name), ` ${label}`), icon('chevron')),
        h('span', { class: 'card-m', text: sub }));
      function update() {
        el.replaceChild(topbar(), el.firstChild);
        el.querySelector('.offline-slot').replaceChildren(offlineBanner() || '');
        scroll.replaceChildren(
          h('h2', { class: 'screen-title', text: 'More' }),
          focusCard(),
          link('#/routines', 'queue', 'Routines and workflows', 'Run one now, or turn a routine on or off.'),
          link('#/notes', 'note', 'Notes', 'Jot an idea down for a project.'),
          link('#/history', 'history', 'History', 'Pick up a conversation you closed.'),
          link('#/wardrobe', 'shirt', 'Wardrobe', 'Dress him up, or give him a pat.'));
      }
      update();
      return { el, update, title: 'More' };
    }

    // ---------------------------------------------------------------- routines

    function routinesScreen() {
      return loaded({
        title: 'Routines', name: 'routines',
        draw: (d, reload) => {
          const parts = [];
          const may = canAct();
          if (!d.routines.length && !d.workflows.length) parts.push(h('div', { class: 'empty' }, h('p', { text: 'No routines or workflows yet. Make them on your PC’s Routines screen.' })));
          else if (!may) parts.push(lookOnly());
          if (d.routines.length) parts.push(h('h3', { class: 'sect' }, h('span', { text: 'Routines' }), h('b', { text: d.routines.length })));
          for (const r of d.routines) {
            const toggle = h('input', { type: 'checkbox', 'aria-label': `${r.name} on`, ...(r.enabled ? { checked: 'checked' } : {}), ...(may ? {} : { disabled: 'disabled' }) });
            toggle.addEventListener('change', async () => {
              const res = await act('routine-toggle', { id: r.id, enabled: toggle.checked }, { okText: toggle.checked ? 'On.' : 'Off.' });
              if (!res.ok) toggle.checked = !toggle.checked;
            });
            parts.push(h('div', { class: 'card' },
              h('div', { class: 'card-t' }, h('span', { class: 'card-title', text: r.name }), h('label', { class: 'switch-row' }, toggle, h('span', { class: 'switch' }))),
              h('div', { class: 'card-m' },
                r.running ? h('span', { class: 'pill', text: 'running' }) : null,
                r.scheduleText ? h('span', { text: r.scheduleText }) : null,
                r.enabled && r.next ? h('span', { class: 'muted', text: `next ${L.clock(r.next)}` }) : null,
                r.folder ? h('span', { class: 'muted', text: r.folder }) : null),
              may ? actButton({
                label: 'Run now', cls: 'ghost slim',
                run: () => confirmSheet({ title: `Run “${r.name}” now?`, text: 'It runs as you set it up on your PC, in its own mode.', yes: 'Run it', then: async () => {
                  const res = await act('routine-run', { id: r.id }, { okText: 'Started.' });
                  if (res.ok && res.tabId) go(`#/tab/${encodeURIComponent(res.tabId)}`); else reload();
                } }),
              }) : null));
          }
          if (d.workflows.length) parts.push(h('h3', { class: 'sect' }, h('span', { text: 'Workflows' }), h('b', { text: d.workflows.length })));
          for (const w of d.workflows) {
            parts.push(h('div', { class: 'card' },
              h('div', { class: 'card-t' }, h('span', { class: 'card-title', text: w.name }), w.running ? h('span', { class: 'pill', text: 'running' }) : !w.enabled ? h('span', { class: 'pill dim', text: 'paused' }) : null),
              w.description ? h('p', { class: 'muted small', text: w.description }) : null,
              !may ? null
                : w.needsInputs
                  ? h('p', { class: 'muted small', text: 'It needs inputs, so it runs from the desk.' })
                  : actButton({ label: 'Run now', cls: 'ghost slim', run: () => confirmSheet({ title: `Run “${w.name}” now?`, yes: 'Run it', then: async () => { await act('workflow-run', { id: w.id }, { okText: 'Started.' }); reload(); } }) })));
          }
          return parts;
        },
      });
    }

    // ---------------------------------------------------------------- notes

    function notesScreen() {
      let project = N.store.get('shellby.pocket.notes') || null;
      const box = h('textarea', { class: 'task-in', rows: '2', maxlength: '2000', placeholder: 'An idea for later…', 'aria-label': 'New note' });
      const screen = loaded({
        title: 'Notes', name: 'notes', body: { project },
        draw: (d, reload) => {
          project = d.key;
          const pick = h('div', { class: 'projects', role: 'radiogroup', 'aria-label': 'Which list' }, ...d.lists.map(l => h('button', {
            type: 'button', role: 'radio', 'aria-checked': l.key === d.key ? 'true' : 'false', class: `proj${l.key === d.key ? ' on' : ''}`,
            text: l.open ? `${l.name} · ${l.open}` : l.name,
            onclick: () => { N.store.set('shellby.pocket.notes', l.key); go('#/notes'); },
          })));
          const add = actButton({
            label: 'Add it', cls: 'go',
            run: async () => {
              if (!box.value.trim()) { box.focus(); return; }
              const r = await act('note-add', { project: d.key, text: box.value }, { okText: 'Noted.' });
              if (r.ok) { box.value = ''; reload(); }
            },
          });
          const open = d.notes.filter(n => !n.done);
          const done = d.notes.filter(n => n.done);
          const may = canAct();
          const row = n => {
            const tick = h('input', { type: 'checkbox', 'aria-label': n.done ? 'Not done' : 'Done', ...(n.done ? { checked: 'checked' } : {}), ...(may ? {} : { disabled: 'disabled' }) });
            tick.addEventListener('change', async () => { const r = await act('note-tick', { project: d.key, id: n.id, done: tick.checked }); if (r.ok) { buzz(6); reload(); } else tick.checked = !tick.checked; });
            return h('label', { class: `note${n.done ? ' done' : ''}` }, tick, h('span', { class: 'note-text', text: n.text }), n.from === 'claude' ? h('span', { class: 'pill dim', text: 'Claude' }) : null);
          };
          return [pick, may ? h('div', { class: 'card note-add' }, box, add) : lookOnly(),
            ...(open.length ? open.map(row) : [h('p', { class: 'muted pad', text: 'Nothing on this list yet.' })]),
            ...(done.length ? [h('h3', { class: 'sect' }, h('span', { text: 'Done' }), h('b', { text: done.length })), ...done.slice(0, 20).map(row)] : [])];
        },
      });
      return screen;
    }

    // ---------------------------------------------------------------- wardrobe

    function wardrobeScreen() {
      return loaded({
        title: 'Wardrobe', name: 'wardrobe',
        draw: (d, reload) => {
          const pat = h('button', { type: 'button', class: 'card hello pat', 'aria-label': 'Give him a pat' }, D.crab({ px: 4, state: 'idle', label: '' }), h('div', {}, h('b', { text: 'Give him a pat' }), h('p', { class: 'muted', text: 'He feels it on your desktop.' })));
          pat.addEventListener('click', async () => {
            const r = await act('pet', {});
            if (!r.ok) return;
            buzz([6, 40, 6]);
            pat.replaceChild(D.crab({ px: 4, state: 'success', label: '' }), pat.firstChild);
            toast(r.again ? 'He’s still glowing from the last one.' : 'He loved that.', { tone: 'ok' });
          });
          const bySlot = new Map();
          for (const it of d.items) bySlot.set(it.slot, [...(bySlot.get(it.slot) || []), it]);
          const parts = [pat];
          const may = canAct();
          if (!d.items.length) parts.push(h('p', { class: 'muted pad', text: 'Nothing unlocked to wear yet. He earns things as you work.' }));
          else if (!may) parts.push(lookOnly());
          for (const [slot, items] of bySlot) {
            parts.push(h('h3', { class: 'sect' }, h('span', { text: slot[0].toUpperCase() + slot.slice(1) })));
            parts.push(h('div', { class: 'projects' }, ...items.map(it => h('button', {
              type: 'button', class: `proj${it.on ? ' on' : ''}`, 'aria-pressed': it.on ? 'true' : 'false', text: it.name, ...(may ? {} : { disabled: 'disabled' }),
              onclick: async () => { const r = await act('wear', { key: it.key, off: it.on }, { okText: it.on ? 'Taken off.' : `He’s wearing the ${it.name}.` }); if (r.ok) reload(); },
            }))));
          }
          return parts;
        },
      });
    }

    // ---------------------------------------------------------------- files

    function filesScreen(tabId, rel) {
      const t = S.view?.tabs?.find(x => x.id === tabId);
      const back = `#/tab/${encodeURIComponent(tabId)}`;
      const isFile = rel && !rel.endsWith('/');
      const at = rel.replace(/\/$/, '');
      const hashOf = (p, dir) => `#/files/${encodeURIComponent(tabId)}/${p.split('/').map(encodeURIComponent).join('/')}${dir ? '/' : ''}`;
      return loaded({
        title: isFile ? at.split('/').pop() : (at || t?.folder || 'Files'), active: 'beach', back, backLabel: 'Conversation',
        name: isFile ? 'file' : 'files', body: isFile ? { tabId, file: at } : { tabId, dir: at },
        draw: d => {
          const crumbs = h('p', { class: 'crumbs mono small' }, h('a', { href: hashOf('', true), text: d.root || 'folder' }),
            ...at.split('/').filter(Boolean).flatMap((p, i, all) => [' / ', i === all.length - 1 ? h('span', { text: p }) : h('a', { href: hashOf(all.slice(0, i + 1).join('/'), true), text: p })]));
          if (isFile) {
            return [crumbs, d.truncated ? h('p', { class: 'muted small', text: 'It’s long: this is the first 200 KB. The rest is at the desk.' }) : null,
              h('pre', { class: 'file-text' }, ...String(d.text).split('\n').map((l, i) => h('span', { class: 'file-line' }, h('i', { text: i + 1 }), h('span', { text: l || ' ' }))))].filter(Boolean);
          }
          const rows = d.entries.map(e => h('a', { class: `file-row${e.dir ? ' dir' : ''}`, href: hashOf(at ? `${at}/${e.name}` : e.name, e.dir) }, icon(e.dir ? 'folder' : 'files'), h('span', { text: e.name })));
          return [crumbs, ...(rows.length ? rows : [h('p', { class: 'muted pad', text: 'Nothing here.' })]), d.more ? h('p', { class: 'muted small pad', text: `And ${d.more} more.` }) : null].filter(Boolean);
        },
      });
    }

    // ---------------------------------------------------------------- history

    // Conversations closed on the PC or here: one opens again, where it left off.
    function historyScreen() {
      return loaded({
        title: 'History', name: 'history',
        draw: d => {
          if (!d.list.length) return [h('div', { class: 'empty' }, h('p', { text: 'Nothing closed yet. Conversations you close show up here.' }))];
          return d.list.map(e => h('button', {
            type: 'button', class: 'card link-card history-row',
            onclick: async () => {
              const r = await act('resume', { id: e.id });
              if (r.ok) go(`#/tab/${encodeURIComponent(r.tabId)}`);
            },
          },
          h('span', { class: 'card-t' }, h('span', { class: 'card-title', text: e.title }), icon('chevron')),
          h('span', { class: 'card-m', text: [e.folder, e.at ? L.ago(e.at) : ''].filter(Boolean).join(' · ') })));
        },
      });
    }

    return { moreScreen, routinesScreen, notesScreen, wardrobeScreen, filesScreen, historyScreen, loaded };
  };
})(window);
