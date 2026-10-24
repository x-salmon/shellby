/* Shellby on your phone — starting things: the mode and model pickers, the
   New task sheet (plain, from a note's Start it, or with what another app
   shared), and Look over my changes. pocket.js hands in what it shares. */
'use strict';
(function (root) {
  root.PocketNew = ({ S, L, N, h, icon, go, toast, act, actButton, voiceButton, photoButton, later }) => {
    // ---------------------------------------------------------------- the mode a message runs in

    const MODE_NAME = { ask: 'Ask first', smart: 'Smart', acceptEdits: 'Auto-edit', plan: 'Plan only', autonomous: 'Autonomous' };
    const MODE_KEY = 'shellby.pocket.mode';

    /** A picker for the desk's modes; value() is what's picked. */
    function modePicker(start) {
      const sel = h('select', { class: 'mode-pick', 'aria-label': 'Mode' },
        ...Object.entries(MODE_NAME).map(([id, name]) => h('option', { value: id, text: name })));
      sel.value = MODE_NAME[start] ? start : 'ask';
      return sel;
    }

    // ---------------------------------------------------------------- the model a new task starts on

    /** The PC's models, with "as on your PC" first, where each new task starts; value is '' for that. */
    function modelPicker() {
      const models = S.view?.models || [];
      const desk = models.find(m => m.id === S.view?.model);
      const sel = h('select', { class: 'mode-pick', 'aria-label': 'Model' },
        h('option', { value: '', text: desk ? `As on your PC: ${desk.label}` : 'As on your PC' }),
        ...models.map(m => h('option', { value: m.id, text: m.label })));
      sel.value = '';
      return sel;
    }

    // ---------------------------------------------------------------- when it starts

    // Now, or into the queue: after the 5-hour window resets, or tonight at 1am (queue-when.js).
    const WHEN = [['', 'Now'], ['reset', 'After the reset'], ['tonight', 'Tonight']];
    function whenPicker() {
      const sel = h('select', { class: 'mode-pick', 'aria-label': 'When' }, ...WHEN.map(([value, text]) => h('option', { value, text })));
      sel.value = '';
      return sel;
    }

    // ---------------------------------------------------------------- a new task

    // prefill: { text, photos, project, shared } from a note's Start it or another app's share.
    function newTaskSheet(prefill = {}) {
      return { label: 'New task', tall: true, build: close => {
        const projects = S.view?.projects || [];
        // A note's own project when it's one the phone can start in (keys differ in case only on Windows).
        const want = prefill.project ? projects.find(p => p.key.toLowerCase() === String(prefill.project).toLowerCase())?.key : null;
        let picked = want || N.store.get('shellby.pocket.project');
        if (!projects.some(p => p.key === picked)) picked = projects[0]?.key || null;
        const text = h('textarea', { class: 'task-in', rows: '4', placeholder: 'Fix the flaky upload test…', 'aria-label': 'The task', maxlength: '4000', enterkeyhint: 'enter' });
        // What was handed in wins over a draft, which stays for next time.
        const given = typeof prefill.text === 'string' && prefill.text.trim() ? prefill.text : null;
        const draft = N.store.get('shellby.pocket.draft');
        if (given) text.value = given; else if (draft) text.value = draft;
        if (!given) text.addEventListener('input', () => N.store.set('shellby.pocket.draft', text.value || null));
        const chips = h('div', { class: 'projects', role: 'radiogroup', 'aria-label': 'Which project' });
        const drawChips = () => chips.replaceChildren(...projects.map(p => h('button', {
          type: 'button', role: 'radio', 'aria-checked': p.key === picked ? 'true' : 'false', class: `proj${p.key === picked ? ' on' : ''}`, text: p.name,
          onclick: () => { picked = p.key; N.store.set('shellby.pocket.project', picked); drawChips(); },
        })));
        drawChips();
        // The desk's mode, as a task typed there gets; the last pick here when the PC doesn't say.
        const mode = modePicker(S.view?.mode || N.store.get(MODE_KEY));
        mode.addEventListener('change', () => N.store.set(MODE_KEY, mode.value));
        const model = modelPicker();
        const when = whenPicker();
        const lim = S.view?.limits;
        // Pictures for the task: each goes to the PC as it's picked, and the task names them.
        const photos = [];
        const strip = h('div', { class: 'photo-strip', 'aria-label': 'Pictures' });
        // One key per task, kept until it's started: sent again after a slow answer, it's the same task.
        let key = L.newKey();
        // Offline too: it waits on the phone and goes when the PC answers (pocket-later.js).
        const send = actButton({
          label: 'Send him off', cls: 'go big', offlineOk: true,
          run: async () => {
            const said = text.value.trim();
            if (!said) { text.focus(); toast('Say what you want done first.'); return; }
            if (!picked) { toast('Pick a project first.'); return; }
            if (photos.some(p => !p.id)) { toast('A picture is still on its way. One moment.'); return; }
            if (when.value && photos.length) { toast('Pictures only go with a task that starts now.'); return; }
            const body = { project: picked, text: said, key, mode: mode.value, model: model.value, photos: photos.map(p => p.id), ...(when.value ? { when: when.value } : {}) };
            const r = await later.send('task', body, { label: L.promptChip(said), timeoutMs: 180000 });
            if (!r.ok) { if (r.error) toast(r.error, { tone: 'warn', ms: 4800 }); return; }
            key = L.newKey();
            if (!given) N.store.set('shellby.pocket.draft', null);
            photos.length = 0;
            close();
            if (r.kept) return;
            if (r.held && r.when) toast(`Queued. It starts ${r.when === 'tonight' ? 'tonight' : 'after the reset'}, at ${r.atText}.`, { tone: 'ok', ms: 5200 });
            else if (r.held) toast(`At your limit, so it waits for the reset and starts at ${r.atText}.`, { ms: 5200 });
            else { toast('Claws out. He’s on it.', { tone: 'ok' }); if (r.tabId) go(`#/tab/${encodeURIComponent(r.tabId)}`); }
          },
        });
        // Shared from another app: it might be an idea for later rather than a job for now.
        const keep = prefill.shared ? actButton({
          label: 'Keep it as a note', cls: 'ghost',
          run: async () => {
            const said = text.value.trim();
            if (!said) { text.focus(); toast('There’s nothing to note yet.'); return; }
            if (!picked) { toast('Pick a project first.'); return; }
            const r = await act('note-add', { project: picked, text: said }, { okText: photos.length ? 'Noted. Pictures only go with a task.' : 'Noted.' });
            if (r.ok) close();
          },
        }) : null;
        const el = h('div', { class: 'new-task' },
          h('h2', { class: 'sheet-title', text: 'What should I do?' }),
          projects.length ? chips : h('p', { class: 'warn', text: 'Shellby doesn’t know any projects yet. Open one on your PC first.' }),
          later.savedRow(text),
          prefill.shared ? h('p', { class: 'flag' }, icon('warn'), h('span', { text: 'Shared from another app. Read it through before you send him off with it.' })) : null,
          text,
          h('div', { class: 'task-tools' }, voiceButton(text), photoButton(photos, strip, { given: prefill.photos || [] })),
          strip,
          h('label', { class: 'mode-row' }, h('span', { text: 'Mode' }), mode),
          (S.view?.models || []).length ? h('label', { class: 'mode-row' }, h('span', { text: 'Model' }), model) : null,
          h('label', { class: 'mode-row' }, h('span', { text: 'When' }), when),
          h('p', { class: 'rule' }, icon('shield'), h('span', { text: `Runs in its own copy when it can.${lim ? ` ${lim.open} of ${lim.atOnce} phone tasks open.` : ''}` })),
          send, keep);
        setTimeout(() => text.focus(), 260);
        return { el };
      } };
    }

    // ---------------------------------------------------------------- look over my changes

    // The desk's shield: a read-only security review of what's pending in one
    // project, uncommitted and unpushed. It runs in Ask first, whatever the desk's mode.
    function lookOverSheet() {
      return { label: 'Look over my changes', build: close => {
        const projects = S.view?.projects || [];
        let picked = N.store.get('shellby.pocket.project');
        if (!projects.some(p => p.key === picked)) picked = projects[0]?.key || null;
        const chips = h('div', { class: 'projects', role: 'radiogroup', 'aria-label': 'Which project' });
        const drawChips = () => chips.replaceChildren(...projects.map(p => h('button', {
          type: 'button', role: 'radio', 'aria-checked': p.key === picked ? 'true' : 'false', class: `proj${p.key === picked ? ' on' : ''}`, text: p.name,
          onclick: () => { picked = p.key; drawChips(); },
        })));
        drawChips();
        // As a task's: asked again after a slow answer, it starts once.
        const key = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
        const go1 = actButton({
          label: 'Look it over', cls: 'go big',
          run: async () => {
            if (!picked) { toast('Pick a project first.'); return; }
            const r = await act('look-over', { project: picked, key }, { okText: 'He’s reading it over.', timeoutMs: 60000 });
            if (r.ok) { close(); if (r.tabId) go(`#/tab/${encodeURIComponent(r.tabId)}`); }
          },
        });
        return { el: h('div', { class: 'new-task' },
          h('h2', { class: 'sheet-title', text: 'Look over my changes' }),
          h('p', { class: 'muted', text: 'He reads what’s uncommitted and unpushed for security problems, and reports. He changes nothing.' }),
          projects.length ? chips : h('p', { class: 'warn', text: 'Shellby doesn’t know any projects yet. Open one on your PC first.' }),
          h('p', { class: 'rule' }, icon('shield'), h('span', { text: 'Runs in Ask first, so anything he wants to run still waits for your yes.' })),
          go1) };
      } };
    }

    return { modePicker, newTaskSheet, lookOverSheet };
  };
})(window);
