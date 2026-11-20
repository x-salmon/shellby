// One-key connectors: a single remote MCP gateway (Composio, Pipedream, Zapier
// MCP, Smithery, or any other that serves MCP over HTTP) handed to every
// conversation, so every agent can reach the apps you've connected there.
//
// You paste the gateway's MCP URL and, if it gave you one, a key. Gateways
// differ in where the secret goes (Zapier's and Smithery's URLs carry it, others
// want a header), so both are kept sealed (connectors/store.js) and neither is
// ever shown again or put on a command line.
//
// What goes where:
//   - Claude Code: one more server in the conversation's --mcp-config file
//     (session/args.js), which lives in the temp folder for the life of the
//     process. Its tools ask like any other MCP tool's.
//   - Gemini CLI, OpenCode, Codex: an http entry in ACP's session/new
//     mcpServers, only for an agent that says it takes http servers.
//   - Never a conversation on a local model ("nothing leaves this PC"), nor one
//     in a folder on another computer (the secret stays on this one).
//
// Pure (test/connectors-gateway.test.js).

const SERVER = 'shellby-connectors'; // its tools are mcp__shellby-connectors__*
const MAX_URL = 2000;
const MAX_KEY = 4000;
const HEADER_RE = /^[A-Za-z0-9-]{1,64}$/;
const DEFAULT_HEADER = 'Authorization';

// Where to get a URL. Shellby only knows each one's name and site: what you
// paste is what's used, so a gateway changing its URLs never breaks this.
const PRESETS = Object.freeze([
  { id: 'composio', name: 'Composio', site: 'https://composio.dev', header: 'x-api-key' },
  { id: 'pipedream', name: 'Pipedream', site: 'https://pipedream.com', header: DEFAULT_HEADER },
  { id: 'zapier', name: 'Zapier MCP', site: 'https://zapier.com/mcp', header: DEFAULT_HEADER },
  { id: 'smithery', name: 'Smithery', site: 'https://smithery.ai', header: DEFAULT_HEADER },
  { id: 'custom', name: 'Another gateway', site: null, header: DEFAULT_HEADER },
].map(p => Object.freeze(p)));
const presetOf = id => PRESETS.find(p => p.id === id) || PRESETS[PRESETS.length - 1];

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * A gateway as pasted -> { url, key, header, preset } or { error }. https only
 * (plain http just for a gateway on this PC); no ${VAR}, which Claude Code
 * would fill from your environment and send to the gateway.
 * @param {any} raw { url, key?, header?, preset? }
 * @returns {{ url: string, key: string, header: string, preset: string } | { error: string }}
 */
function cleanSetup(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const text = typeof src.url === 'string' ? src.url.trim() : '';
  const key = typeof src.key === 'string' ? src.key.trim() : '';
  const preset = presetOf(src.preset).id;
  const header = typeof src.header === 'string' && src.header.trim() ? src.header.trim() : presetOf(preset).header;
  if (!text) return { error: 'Paste the MCP URL your gateway gave you.' };
  if (text.length > MAX_URL || key.length > MAX_KEY) return { error: 'That is longer than any gateway address or key.' };
  if (/\$\{/.test(text) || /\$\{/.test(key)) return { error: 'Leave out ${...}: Claude Code would fill it in from your environment.' };
  if (/[\s\u0000-\u001f]/.test(key)) return { error: 'The key has a space or a line break in it.' };
  if (!HEADER_RE.test(header)) return { error: 'The header name can only have letters, numbers and dashes.' };
  let url;
  try { url = new URL(text); } catch { return { error: "That isn't a web address." }; }
  if (url.username || url.password) return { error: 'Put the key in the key box, not in the address.' };
  const local = url.protocol === 'http:' && LOOPBACK.has(url.hostname);
  if (url.protocol !== 'https:' && !local) return { error: 'The address must start with https://.' };
  url.hash = '';
  return { url: url.toString(), key, header, preset };
}

/** The header that carries the key, if there is one. @param {{ key: string, header: string }} s */
function authHeaders(s) {
  if (!s.key) return {};
  const value = s.header.toLowerCase() === 'authorization' && !/^\w+\s/.test(s.key) ? `Bearer ${s.key}` : s.key;
  return { [s.header]: value };
}

/** Claude Code's --mcp-config entry. @param {{ url: string, key: string, header: string }} s */
function claudeServers(s) {
  return { [SERVER]: { type: 'http', url: s.url, headers: authHeaders(s) } };
}

/**
 * ACP's session/new mcpServers: an http server, for an agent whose
 * initialize said mcpCapabilities.http; none otherwise.
 * @param {{ url: string, key: string, header: string }} s
 * @param {any} caps the agent's mcpCapabilities
 */
function acpServers(s, caps) {
  if (caps?.http !== true) return [];
  const headers = Object.entries(authHeaders(s)).map(([name, value]) => ({ name, value }));
  return [{ type: 'http', name: SERVER, url: s.url, headers }];
}

/**
 * What the panel may see of a saved gateway: its site's host and the key's
 * last four. Never the path or query, which can carry the secret.
 * @param {{ url: string, key: string, preset: string } | null} s
 */
function view(s) {
  if (!s) return { saved: false, host: null, hint: null, preset: null };
  /** @type {string | null} */
  let host = null;
  try { host = new URL(s.url).host; } catch { /* a saved one always parses */ }
  return { saved: true, host, hint: s.key ? `…${s.key.slice(-4)}` : null, preset: presetOf(s.preset).id };
}

/** Settings → Connectors' switches: { on, claude, agents }. @param {any} raw */
function cleanSwitches(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return { on: src.on === true, claude: src.claude !== false, agents: src.agents !== false };
}

module.exports = { SERVER, PRESETS, cleanSetup, authHeaders, claudeServers, acpServers, view, cleanSwitches, presetOf };
