// Your Anthropic API key, for "Bill to: my API key" in Settings.
//
// Kept the way the GitHub sign-in is: one file sealed by Windows (Electron
// safeStorage, DPAPI), readable only by your Windows account, never in
// settings.json, never synced, and never sent to the panel. The panel only
// ever sees whether one is saved and its last four characters. It's opened
// each time Claude Code starts (claude/cli.js claudeEnv), not kept in memory.
const { TokenStore } = require('../github/auth');

// What an Anthropic API key looks like: sk-ant-<kind>-<base64url>. Anything
// else is refused before it's sealed, so a pasted sentence or a stray newline
// never ends up in Claude Code's environment.
const KEY_RE = /^sk-ant-[A-Za-z0-9_-]{20,250}$/;
const HINT_CHARS = 4;

/** The key as typed, trimmed; or null when it isn't one. @param {unknown} raw */
function cleanKey(raw) {
  if (typeof raw !== 'string') return null;
  const key = raw.trim();
  return KEY_RE.test(key) ? key : null;
}

/** What the panel may know: the last few characters. @param {string} key */
const hintOf = key => `sk-ant-…${key.slice(-HINT_CHARS)}`;

/**
 * file: where the sealed key lives (userData). crypto: Electron's safeStorage,
 * or a stand-in in tests.
 * @param {string} file
 * @param {{ isEncryptionAvailable(): boolean, encryptString(s: string): Buffer, decryptString(b: Buffer): string }} crypto
 */
function createApiKeyStore(file, crypto) {
  const store = new TokenStore(file, crypto);
  const read = () => cleanKey(store.load()?.token) || '';
  return {
    /** The key in the clear, for Claude Code's environment only. */
    read,
    /** { saved, hint, canEncrypt }: all the panel ever gets. */
    view() {
      const key = read();
      return { saved: !!key, hint: key ? hintOf(key) : null, canEncrypt: store.available };
    },
    /** @param {unknown} raw @returns {{ ok: boolean, error?: string }} */
    save(raw) {
      const key = cleanKey(raw);
      if (!key) return { ok: false, error: "That doesn't look like an Anthropic API key. It starts with sk-ant-." };
      if (!store.available) return { ok: false, error: "Windows can't encrypt the key on this PC, so Shellby won't store it." };
      try { store.save({ token: key }); } catch { return { ok: false, error: "Couldn't save the key." }; }
      return { ok: true };
    },
    clear() { store.clear(); },
  };
}

module.exports = { createApiKeyStore, cleanKey, hintOf, KEY_RE };
