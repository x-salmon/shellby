// The failed tests in node:test's TAP output, as GitHub error annotations. CI's
// log needs a sign-in to read; annotations don't, so a red `test` job says which.
const MAX_FAILURES = 20;
const DETAIL_LINES = 12;
const DETAIL_KEYS = /^(location|error|expected|actual|code|failureType):/;

/** -> [{ name, detail }] for each `not ok` in `tap`, with its location and error. */
function tapFailures(tap) {
  const lines = String(tap || '').split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length && out.length < MAX_FAILURES; i++) {
    const m = /^\s*not ok \d+ - (.*)$/.exec(lines[i]);
    if (!m) continue;
    const detail = [];
    for (let j = i + 1; j < lines.length && detail.length < DETAIL_LINES; j++) {
      const l = lines[j].trim();
      if (l === '...' || /^(not )?ok \d+/.test(l)) break;
      if (DETAIL_KEYS.test(l)) detail.push(l);
    }
    out.push({ name: m[1].trim(), detail: detail.join('\n') });
  }
  return out;
}

const esc = s => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

/** `::error` workflow commands for the failures in `tap`. */
function tapAnnotations(tap) {
  return tapFailures(tap).map(f => `::error title=${esc(f.name).replace(/[,:]/g, ' ').slice(0, 200)}::${esc(f.detail || f.name)}`);
}

module.exports = { tapFailures, tapAnnotations };
