// Keeping the model picker current (models.js): the models the installed
// Claude Code knows (claude/models-scan.js), read at boot and after each
// Claude Code update, so a new release shows up without a Shellby release.
const { scanModels } = require('../claude/models-scan');
const { models, setFound } = require('../models');

/** @param d  what main shares with its wiring (main.js shared) */
function wireModels(d, { scan = scanModels } = {}) {
  // Screenshots and the fake CLI keep the built-in list: nothing real to read.
  const off = () => d.CAPTURE || d.FAKE_CLI;
  let scanning = null;

  // Last time's answer straight away, so a model picked from it is still
  // accepted before the scan below has finished.
  if (!off()) setFound(d.config.get('cliModels')?.ids);

  /** Read the CLI Shellby last found. Resolves when done; never throws. */
  function refreshModels() {
    if (off()) return Promise.resolve();
    if (scanning) return scanning;
    const cache = d.config.get('cliModels');
    scanning = scan(d.claudeStatus?.exe || null, cache)
      .then(found => {
        if (!found) return;
        if (found !== cache) d.config.set({ cliModels: found });
        if (setFound(found.ids)) d.send(d.panel, 'models:changed', models());
      })
      .catch(err => d.log?.warn?.("Couldn't read the models Claude Code knows", err?.message || String(err)))
      .finally(() => { scanning = null; });
    return scanning;
  }

  return { refreshModels };
}

module.exports = { wireModels };
