/* Shellby panel — what a Toolbox row opens to (toolbox.js), and editing your own.
   The detail under a skill, agent, command or server: where it comes from, its
   use and cost (toolbox-usage.js), the hint on a skill Claude never reaches for,
   the copies a same-named one hides, and Show file, Edit and Remove. Your own
   (in your Claude folder or the project's) open in an editor in place of the
   list: Ctrl+S saves, Reload when the file changed under you, and Remove sends
   one to the Recycle Bin (skillremove.js). toolbox.js hands in its render and
   the list's state at init. */
'use strict';
(function () {
  const { h, api, state, $ } = SB;
  const U = SB.toolboxUsage;
  /** @type {any} What toolbox.js hands in: render(), choose(kind), focusRow(key, sel), kind(), forget(key), listKey, merged. */
  let deps = null;

  const LIST_NAME = { tool: 'All tools', skill: 'Skills', agent: 'Agents', command: 'Commands' };
  const isMerged = t => deps.merged.includes(t.kind); // a skill, agent or command: the kinds listed together under All
  const ownTool = t => isMerged(t) && (t.source === 'user' || t.source === 'project') && !!t.path;
  const removing = new Set();

  function sourceLabel(src) {
    if (!src) return '';
    if (src.startsWith('plugin:')) return src.slice(7);
    return { user: 'yours', project: 'this project', cli: 'built in' }[src] || src;
  }

  async function removeTool(t) {
    const key = `${t.kind}:${t.name}`;
    if (removing.has(key)) return;
    removing.add(key);
    deps.render();
    let r;
    try { r = await api.removeTool(t.kind, t.name); } catch { r = { ok: false, error: "Shellby couldn't do that." }; }
    removing.delete(key);
    if (r?.ok) {
      if (r.toolbox) state.toolbox = r.toolbox;
      if (toolEd?.path === t.path) toolEd = null;
      deps.forget(key);
      state.pinned = (state.pinned || []).filter(p => !(p.kind === t.kind && p.name === t.name));
      SB.refreshEmptyStates();
      SB.toast(`Moved ${t.kind === 'agent' ? t.name : `/${t.name}`} to the Recycle Bin. Restore it from there if you change your mind.`, { ms: 8000 });
    } else if (!r?.cancelled) SB.toast(r?.error || "Couldn't remove that.", { ms: 8000 });
    deps.render();
  }

  // ------------------------------------------------------------ editing your own

  // One open editor, kept while you look at other tabs. Named by its file: saving a
  // new name: in the frontmatter renames the tool but not the file. It belongs to
  // the list it was opened from (view), which may be All rather than its own kind.
  /** @type {any} */
  let toolEd = null; // { kind, view, path, name, original, text, mtimeMs, error, conflict, leaving }

  async function openTool(t, view = deps.kind()) {
    // Another file open with unsaved changes: back to it, rather than losing them.
    if (toolEd && toolEd.path !== t.path && toolEd.text !== toolEd.original) {
      SB.toast(`Save or discard your changes to ${toolEd.kind === 'agent' ? toolEd.name : `/${toolEd.name}`} first.`, { ms: 6000 });
      deps.choose(toolEd.view);
      return;
    }
    let r;
    try { r = await api.readTool(t.kind, t.path); } catch { r = null; }
    if (!r?.ok) { SB.toast(r?.error || "Couldn't open that file.", { ms: 8000 }); return; }
    toolEd = { kind: t.kind, view, path: t.path, name: t.name, original: r.text, text: r.text, mtimeMs: r.mtimeMs, error: '', conflict: false, leaving: false };
    $('setupPane').dataset.mounted = '';
    deps.render();
    if (deps.kind() === view) $('setupPane').querySelector('.mem-text')?.focus();
  }

  function toolEditor(ed) {
    const area = h('textarea', { class: 'field area mono mem-text', spellcheck: 'false', 'aria-label': `Edit ${ed.path}` });
    area.value = ed.text;
    const dirty = () => ed.text !== ed.original;
    const saveable = () => dirty() && !ed.gone;
    const hint = () => ed.error || 'The name and description at the top are what Claude sees in every conversation. Ctrl+S saves.';
    const status = h('p', { class: `setup-status${ed.error ? ' err' : ''}`, role: 'status', text: hint() });
    const save = h('button', { class: 'btn primary slim-btn', type: 'button', disabled: !saveable() }, 'Save');
    const back = h('button', { class: 'back-btn', type: 'button' }, `← ${LIST_NAME[ed.view]}`);
    const reloadBtn = h('button', { class: 'btn ghost slim-btn', type: 'button', hidden: !ed.conflict, onclick: () => openTool(ed, ed.view) }, 'Reload');
    const setStatus = (text, err) => { status.textContent = text; status.classList.toggle('err', !!err); };

    async function doSave() {
      if (!saveable() || save.disabled) return;
      save.disabled = true;
      let r;
      try { r = await api.writeTool(ed.kind, ed.path, ed.text, ed.mtimeMs); } catch { r = null; }
      if (r?.ok) {
        if (r.toolbox) state.toolbox = r.toolbox;
        const now = state.toolbox?.[deps.listKey[ed.kind]]?.find(t => t.path === ed.path);
        Object.assign(ed, { original: ed.text, mtimeMs: r.mtimeMs, error: '', conflict: false, name: now?.name || ed.name });
        setStatus(hint());
        SB.toast(`Saved ${ed.kind === 'agent' ? ed.name : `/${ed.name}`}. New conversations use this version.`);
      } else {
        Object.assign(ed, { error: r?.error || "Couldn't save that file.", conflict: !!r?.conflict });
        setStatus(ed.error, true);
        reloadBtn.hidden = !ed.conflict;
      }
      save.disabled = !saveable();
    }

    area.addEventListener('input', () => {
      ed.text = area.value;
      save.disabled = !saveable();
      if (ed.leaving) { ed.leaving = false; back.textContent = back.dataset.label; }
    });
    area.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(); }
    });
    save.addEventListener('click', doSave);
    // Leaving with unsaved text takes a second click, as in Memory.
    back.dataset.label = back.textContent;
    back.addEventListener('click', () => {
      if (dirty() && !ed.leaving) { ed.leaving = true; back.textContent = 'Discard changes?'; return; }
      toolEd = null;
      deps.render();
      deps.focusRow(`${ed.kind}:${ed.name}`, '.tool-toggle');
    });

    return h('div', { class: 'setup-form mem-editor' },
      h('div', { class: 'setup-head' },
        back,
        h('strong', { text: `${ed.kind === 'agent' ? ed.name : `/${ed.name}`}` }),
        h('code', { class: 'mem-path', text: SB.shortPath(ed.path, 46), title: ed.path }),
        h('button', { class: 'icon-btn', type: 'button', title: 'Show file', 'aria-label': 'Show file', onclick: () => api.revealTool(ed.path) },
          SB.icon(SB.ICONS.folder, { width: 1.3 }))),
      area,
      h('div', { class: 'row setup-actions' }, status, reloadBtn, save));
  }

  // The editor takes the page while a file opened from this list is being edited:
  // true when it did. Rebuilt only for another file, so a toolbox update can't take
  // the cursor out of it, or once to say the file has gone (your text stays, to copy somewhere).
  function showEditor(kind, tb) {
    if (!toolEd || toolEd.view !== kind) return false;
    const pane = $('setupPane');
    const gone = !!tb && !(tb[deps.listKey[toolEd.kind]] || []).some(t => t.path === toolEd.path);
    if (gone && !toolEd.gone) {
      Object.assign(toolEd, { gone: true, error: 'This file was moved or removed outside Shellby, so it can\'t be saved here. Copy your text if you need it.' });
      pane.dataset.mounted = '';
    }
    const key = `tool:${toolEd.path}`;
    pane.hidden = false;
    $('toolList').hidden = true;
    if (pane.dataset.mounted !== key) { pane.replaceChildren(toolEditor(toolEd)); pane.dataset.mounted = key; }
    return true;
  }

  // ------------------------------------------------------------ what a row opens to

  const WHERE_FROM = {
    user: 'Yours: it\'s in your own Claude folder, so every project has it.',
    project: 'This project\'s: it\'s in the repo, so anyone working here has it too.',
    cli: 'Built into Claude Code.',
  };
  const MCP_SAYS = {
    connected: 'Connected.',
    failed: 'Couldn\'t connect. Reconnect to try again.',
    'needs-auth': 'Waiting for you to sign in. Sign in opens its page in your browser.',
    pending: 'Still connecting.',
    disabled: 'Turned off for open conversations.',
  };
  function whereFrom(t) {
    if (t.kind === 'mcp') return MCP_SAYS[t.status] || null;
    if ((t.source || '').startsWith('plugin:')) return `Comes with the ${t.source.slice(7)} plugin. Turn it off or remove it in Get more.`;
    return WHERE_FROM[t.source] || null;
  }

  // A skill Claude never reaches for: Claude Code picks skills by their
  // description alone, so one that doesn't say when to use it sits idle. Yours
  // can be sharpened by Claude; a plugin's can only be noted.
  function skillHint(t) {
    if (t.kind !== 'skill' || !U.isIdle(U.usageOf(t))) return null;
    const own = ownTool(t);
    return h('div', { class: 'tool-hint' },
      h('p', { text: own
        ? "Claude hasn't reached for this lately. It decides from the description alone, so one that says plainly when to use it (in the words you'd use) gets used."
        : "Claude hasn't reached for this lately. It decides from the description alone; if you never need it, turning its plugin off saves room in every conversation." }),
      own ? h('button', { class: 'btn ghost slim-btn', type: 'button', onclick: () => SB.prefillNew(
        `Look at my skill "${t.name}" in ${t.path}. Claude Code decides whether to use a skill from its description alone, and it hasn't used this one lately. `
        + "Rewrite the description in its frontmatter so it says plainly what the skill does and when to reach for it, in the words I'd use when I need it. "
        + 'Keep it under 1024 characters, leave the rest of the file alone, and show me the change before you save it.') }, 'Sharpen its description with Claude') : null);
  }

  const actBtn = (icon, label, attrs) => h('button', { class: 'btn ghost slim-btn tool-act', type: 'button', ...attrs },
    SB.icon(icon, { width: 1.4 }), label);

  function toolDetail(t, id) {
    const own = isMerged(t) && (t.source === 'user' || t.source === 'project');
    const acts = t.kind === 'mcp'
      ? [actBtn(SB.ICONS.trash, 'Remove', { class: 'btn ghost slim-btn tool-act danger-hover', 'aria-label': `Remove ${t.name}`, disabled: SB.toolboxMcp.isBusy(t.name),
        onclick: () => SB.toolboxMcp.remove(t) })]
      : [
        t.path ? actBtn(SB.ICONS.folder, 'Show file', { onclick: () => api.revealTool(t.path) }) : null,
        ownTool(t) ? actBtn(SB.ICONS.edit, 'Edit', { 'aria-label': `Edit ${t.name}`, onclick: () => openTool(t) }) : null,
        own ? actBtn(SB.ICONS.trash, 'Remove', { class: 'btn ghost slim-btn tool-act danger-hover', 'aria-label': `Remove ${t.name}`,
          title: 'Shellby asks first, and it goes to the Recycle Bin', disabled: removing.has(`${t.kind}:${t.name}`), onclick: () => removeTool(t) }) : null,
      ].filter(Boolean);
    const where = whereFrom(t);
    return h('div', { class: 'tool-detail', id },
      where ? h('p', { class: 'tool-where', text: where }) : null,
      t.kind === 'mcp' ? null : U.statsLine(t),
      skillHint(t),
      t.path ? h('code', { class: 'tool-path', text: SB.shortPath(t.path, 64), title: t.path }) : null,
      hiddenCopies(t),
      acts.length ? h('div', { class: 'tool-detail-actions' }, acts) : null);
  }

  // The same name where Claude Code looks first wins: say which copy loads, and where the others are.
  function hiddenCopies(t) {
    if (!t.hides?.length) return null;
    const others = t.hides.length === 1 ? 'Another copy hides' : `${t.hides.length} other copies hide`;
    return h('div', { class: 'tool-hint' },
      h('p', { text: `Only this copy (${sourceLabel(t.source)}) loads. ${others} behind it; remove the one you don't want, so there's no doubt which Claude gets.` }),
      ...t.hides.map(x => h('div', { class: 'tool-hidden-copy' },
        h('span', { class: 'src-pill', text: sourceLabel(x.source) }),
        x.path ? h('code', { class: 'tool-path', text: SB.shortPath(x.path, 52), title: x.path }) : null,
        x.path ? actBtn(SB.ICONS.folder, 'Show file', { onclick: () => api.revealTool(x.path) }) : null)));
  }

  SB.toolboxDetail = {
    init: d => { deps = d; },
    toolDetail, openTool, removeTool, ownTool, sourceLabel, showEditor,
    editing: kind => !!toolEd && toolEd.view === kind, // a file from this list is open in the editor
  };
})();
