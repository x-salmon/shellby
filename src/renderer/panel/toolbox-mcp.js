/* Shellby panel — Toolbox → MCP: servers Claude Code connects to, added,
   removed, reconnected, signed in and turned on or off here (/mcp). toolbox.js
   draws the rows and calls in for a server's buttons and the Add form above
   them; init gives this file its render. */
'use strict';
(function () {
  const { h, api, state } = SB;
  const busy = new Set();
  /** @type {any} */
  let form = null; // { name, transport, target, scope, env, headers, error } while the Add form is open
  let render = () => {};

  async function call(name, fn, done) {
    if (busy.has(name)) return;
    busy.add(name);
    render();
    let r;
    try { r = await fn(); } catch { r = { ok: false, error: "Shellby couldn't do that." }; }
    busy.delete(name);
    if (r?.ok) { if (done) SB.toast(done); } else if (!r?.cancelled) SB.toast(r?.error || "Couldn't do that.", { ms: 8000 });
    state.toolbox = await api.getToolbox();
    render();
    return r;
  }

  // A server's buttons with its row closed: sign in, reconnect, on or off.
  function actions(t) {
    const tabId = state.activeTab;
    const isBusy = busy.has(t.name);
    const off = t.status === 'disabled';
    const broken = /failed|needs-auth|pending/.test(t.status || '');
    const signIn = async () => {
      const r = await call(t.name, () => api.signInMcp(tabId, t.name), null);
      if (!r?.ok) return;
      if (r.done) SB.toast(`${t.name} is signed in`);
      else if (r.connector) SB.toast(`Finish signing in to ${t.name} in your browser, then press Reconnect.`, { ms: 10000 });
      else SB.toast(`Finish signing in to ${t.name} in your browser. Shellby connects it when you're done.`, { ms: 10000 });
    };
    return [
      t.status === 'needs-auth' ? h('button', { class: 'btn primary slim-btn', type: 'button', disabled: isBusy, onclick: signIn }, isBusy ? '…' : 'Sign in') : null,
      broken || isBusy ? h('button', { class: 'btn slim-btn', type: 'button', disabled: isBusy, onclick: () => call(t.name, () => api.reconnectMcp(tabId, t.name), `Reconnected ${t.name}`) }, isBusy ? '…' : 'Reconnect') : null,
      h('button', { class: 'btn ghost slim-btn', type: 'button', disabled: isBusy, title: off ? 'Turn it on for open conversations' : 'Turn it off for open conversations',
        onclick: () => call(t.name, () => api.toggleMcp(tabId, t.name, off), `${t.name} turned ${off ? 'on' : 'off'}`) }, off ? 'Turn on' : 'Turn off'),
    ];
  }

  const remove = t => call(t.name, () => api.removeMcp(state.activeTab, t.name), `Removed ${t.name}. New conversations won't have it.`);

  // The bar over the list, and the Add form under it while it's open.
  function pane() {
    const bar = h('div', { class: 'mcp-bar' },
      h('span', { class: 'muted small', text: 'Servers Claude Code connects to. Statuses come from a running conversation.' }),
      h('button', { class: 'btn ghost slim-btn', type: 'button', onclick: () => call('*', () => api.refreshMcp(state.activeTab), 'Statuses refreshed') }, 'Refresh'),
      h('button', { class: 'btn primary slim-btn', type: 'button', onclick: () => { form = form ? null : { transport: 'stdio', scope: 'local' }; render(); } }, form ? 'Close' : 'Add server'));
    if (!form) return [bar];
    const f = form;
    const bind = (el, key) => { el.value = f[key] || ''; el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => { f[key] = el.value; if (key === 'transport') render(); }); return el; };
    const stdio = (f.transport || 'stdio') === 'stdio';
    const add = async () => {
      const r = await call(f.name || 'new', () => api.addMcp({ ...f, tabId: state.activeTab }), null);
      if (r?.ok) { form = null; SB.toast(`Added ${r.name}. ${r.note}`, { ms: 8000 }); render(); } else if (r && !r.cancelled) { f.error = r.error; render(); }
    };
    return [bar, h('div', { class: 'mcp-form' },
      h('div', { class: 'row2' },
        bind(h('input', { class: 'field slim', type: 'text', spellcheck: 'false', placeholder: 'Name, like github', 'aria-label': 'Server name' }), 'name'),
        bind(h('select', { class: 'field slim', 'aria-label': 'How it connects' }, [['stdio', 'Runs a program'], ['http', 'HTTP URL'], ['sse', 'SSE URL']].map(([v, t]) => h('option', { value: v, text: t }))), 'transport'),
        bind(h('select', { class: 'field slim', 'aria-label': 'Who gets it' }, [['local', 'Just me, here'], ['project', 'This project (shared)'], ['user', 'Me, everywhere']].map(([v, t]) => h('option', { value: v, text: t }))), 'scope')),
      bind(h('input', { class: 'field mono slim', type: 'text', spellcheck: 'false', placeholder: stdio ? 'npx -y @modelcontextprotocol/server-github' : 'https://mcp.example.com/mcp', 'aria-label': stdio ? 'Command' : 'URL' }), 'target'),
      bind(h('textarea', { class: 'field', spellcheck: 'false', placeholder: stdio ? 'Environment, one per line: GITHUB_TOKEN=…' : 'Headers, one per line: Authorization: Bearer …', 'aria-label': stdio ? 'Environment variables' : 'Headers' }), stdio ? 'env' : 'headers'),
      h('p', { class: `setup-status${f.error ? ' err' : ''}`, role: 'status', text: f.error || 'Shellby asks you to confirm before Claude Code adds it.' }),
      h('div', {}, h('button', { class: 'btn primary slim-btn', type: 'button', onclick: add }, 'Add it')))];
  }

  // Rebuilt only when the form itself changes, so a toolbox update can't
  // take the cursor out of a field you're typing in.
  const paneKey = () => `mcp:${form ? `${form.transport}:${form.error || ''}` : 'closed'}`;

  SB.toolboxMcp = { init: r => { render = r; }, actions, remove, pane, paneKey, isBusy: name => busy.has(name) };
})();
