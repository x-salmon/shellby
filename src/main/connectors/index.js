// One-key connectors, kept and handed out (connectors/gateway.js says what and why).
//
// The gateway's URL and key are sealed by Windows in one file of their own (the
// way the API key is: claude/api-key.js), never in settings.json, never synced,
// never sent to the panel. settings.json only has the switches (connectors:
// { on, claude, agents }), which stay on this PC too.
const { TokenStore } = require('../github/auth');
const gateway = require('./gateway');
const { listTools } = require('../mcpclient');

const TEST_TIMEOUT_MS = 20 * 1000;

/**
 * @param {{
 *   file: string,
 *   crypto: { isEncryptionAvailable(): boolean, encryptString(s: string): Buffer, decryptString(b: Buffer): string },
 *   switches: () => any,
 *   list?: typeof listTools,
 * }} deps
 */
function createConnectors({ file, crypto, switches, list = listTools }) {
  const store = new TokenStore(file, crypto);

  /** The saved gateway, checked again (it's read from a file), or null. */
  function setup() {
    let raw;
    try { raw = JSON.parse(store.load()?.token || 'null'); } catch { return null; }
    const s = raw ? gateway.cleanSetup(raw) : null;
    return s && !('error' in s) ? s : null;
  }

  /** Whether conversations of this kind get the gateway now. @param {'claude' | 'agents'} kind */
  function active(kind) {
    const sw = gateway.cleanSwitches(switches());
    return sw.on && sw[kind] ? setup() : null;
  }

  return {
    /** Claude Code's extra --mcp-config servers, or null. */
    claudeServers() { const s = active('claude'); return s ? gateway.claudeServers(s) : null; },
    /** An ACP agent's session/new mcpServers. @param {any} caps its initialize's mcpCapabilities */
    acpServers(caps) { const s = active('agents'); return s ? gateway.acpServers(s, caps) : []; },
    /** All the panel ever gets. */
    view() {
      return { ...gateway.view(setup()), ...gateway.cleanSwitches(switches()), canEncrypt: store.available, presets: gateway.PRESETS };
    },
    /** @param {unknown} raw @returns {{ ok: boolean, error?: string }} */
    save(raw) {
      const s = gateway.cleanSetup(raw);
      if ('error' in s) return { ok: false, error: s.error };
      if (!store.available) return { ok: false, error: "Windows can't encrypt it on this PC, so Shellby won't store it." };
      try { store.save({ token: JSON.stringify(s) }); } catch { return { ok: false, error: "Couldn't save it." }; }
      return { ok: true };
    },
    clear() { store.clear(); },
    /**
     * Connect and list its tools, so you know it works before a conversation
     * leans on it. Nothing from your environment goes along (env: {}).
     * @returns {Promise<{ ok: true, tools: number, names: string[] } | { ok: false, error: string }>}
     */
    async test() {
      const s = setup();
      if (!s) return { ok: false, error: 'Save a gateway first.' };
      try {
        const tools = await list({ type: 'http', url: s.url, headers: gateway.authHeaders(s) }, { timeoutMs: TEST_TIMEOUT_MS, env: {} });
        return { ok: true, tools: tools.length, names: tools.slice(0, 8).map(t => t.name) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        // mcpclient's words for a 401 are about workflow steps; here it's the key.
        if (/sign in/.test(msg)) return { ok: false, error: 'It turned the key down. Check the key, and the header it goes in.' };
        return { ok: false, error: msg || "Couldn't reach it." };
      }
    },
  };
}

module.exports = { createConnectors, TEST_TIMEOUT_MS };
