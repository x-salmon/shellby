// Which windows hear what main says to the panel, once conversations are out in
// windows of their own (popouts.js). Everything else main says to the panel is
// the panel's alone: celebrations, toasts and banners show once, not once a window.

// What every window draws its screens from.
const SHARED = new Set([
  'backlog:changed', 'bg-sessions', 'bugdex', 'bugdex:battles', 'checkups', 'ci', 'clashes', 'claude:status', 'claude:update',
  'crew', 'deck', 'depwatch', 'discord', 'events', 'external', 'flaky', 'focus', 'friends', 'game', 'github',
  'health', 'health:log', 'home:places', 'homes', 'hub:changed', 'keepwarm', 'lanes:train', 'life', 'local:pull', 'models:changed',
  'news', 'notes', 'nowplaying', 'obs', 'pages:changed', 'pocket', 'pr-badge', 'projects:changed', 'projects:clone-progress',
  'quests', 'rooms', 'routines', 'routines:test-run', 'servers:changed', 'sessions:synced', 'settings', 'skin', 'snippets', 'social',
  'stickers', 'streaks', 'tank:gauges', 'taskboard:changed', 'team', 'time:now', 'toolbox', 'updates', 'viewer:stale', 'wardrobe',
  'weather', 'workflows', 'workflows:run-changed', 'xp',
]);

// Somewhere to go, or an answer: the window that asked goes there (asking.js).
const TO_ASKER = new Set([
  'bugdex:focus', 'code-health:focus', 'github:error', 'github:signed-in', 'panel:attach', 'panel:focus-input', 'panel:jump',
  'panel:view', 'projects:show', 'social:focus', 'social:prefill', 'startfrom:open', 'tab:new-in', 'workflows:open-run',
]);

// About one conversation: the window it's in.
const OF_TAB = new Set(['backlog:offer-tick', 'mcp:needs-auth', 'tab:opened']);

/**
 * What the other windows get of a shared message: the view without the moment
 * that came with it, which the panel marks. undefined: nothing at all. Pure.
 * @param {string} channel
 * @param {any} payload
 */
function quiet(channel, payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (channel === 'rooms') return { ...payload, opened: [] };
  if (channel === 'quests') return { view: payload.view };
  if (channel === 'game') return { what: payload.what, view: payload.view };
  if (channel === 'social') return { ...payload, notice: null };
  if (channel === 'clashes') return { ...payload, fresh: [] };
  if (channel === 'pages:changed' && payload.kind === 'open') return undefined; // a notification's click: one window goes there
  return payload;
}

/**
 * Where a message to the panel goes. Pure.
 * -> [[window, payload]]
 * @param {string} channel
 * @param {any} payload
 * @param {{ panel: any, others: any[], asker: any, tabWindow: (tabId: string) => any }} at
 * @returns {[any, any][]}
 */
function routes(channel, payload, { panel, others, asker, tabWindow }) {
  if (OF_TAB.has(channel) && payload?.tabId) return [[tabWindow(payload.tabId), payload]];
  if (TO_ASKER.has(channel)) return [[asker || panel, payload]];
  if (!SHARED.has(channel)) return [[panel, payload]];
  /** @type {[any, any][]} */
  const out = [[panel, payload]];
  const rest = quiet(channel, payload);
  if (rest !== undefined) for (const win of others) out.push([win, rest]);
  return out;
}

module.exports = { routes, quiet, SHARED, TO_ASKER, OF_TAB };
