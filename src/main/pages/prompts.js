// What a conversation that builds or changes a page starts with. The format
// rides along here rather than in a plugin skill, so it's always the one this
// version of Shellby checks against. Kept short: it's read on the first turn.
// Pure: test/pages-prompts.test.js.
const { LIMITS } = require('./limits');
const { READS } = require('./format');

const MAX_FILES_IN_PROMPT = 60 * 1024;

const FORMAT = [
  'How a Shellby page works:',
  `- Files are flat text (.html .js .css .svg .json), ${LIMITS.FILE_COUNT} at most, ${LIMITS.FILES_BYTES / 1024} KB together, with an index.html.`,
  '- index.html loads <script src="shellby.js"></script> before its own scripts. No inline <script>, no onclick="", no eval, nothing from the web (scripts, styles, fonts, images): put everything in the page\'s own files, images as SVG or data: URLs.',
  '- It runs sandboxed with no network. Its data: await shellby.data.get(key?), shellby.data.set({ k: v }), shellby.data.append(key, item), shellby.data.remove(key), shellby.data.onChange(fn) (agents write too; refresh and mark what\'s new).',
  `- Only if needed, and declared in access: shellby.read(${READS.map(r => `'${r}'`).join('|')}) with access.read, shellby.ask(prompt) with access.ask, shellby.notify(title, body) with access.notify, shellby.fetch(url) for https hosts listed in access.web. shellby.say(text) makes the crab talk.`,
  '- shellby.theme has Shellby\'s colours (bg, text, accent...) if the page wants to match; any look is fine. It should fit a narrow panel and a wide screen.',
  '- Agents fill it through write_page, so keep data in plain keys (lists of objects work well with append).',
].join('\n');

/** A new page from what you described. */
function buildPrompt(describe) {
  return [
    `[Shellby: build a page] ${String(describe).trim().slice(0, 2000)}`,
    '',
    'Build it as a Shellby page with create_page (name, description, files, and access only if it needs more than its own data). It opens as a draft beside this chat; change it with update_page until I save it.',
    '',
    FORMAT,
  ].join('\n');
}

/** Changing a page you have: its files come along, unless they're big. */
function changePrompt(page, files, ask, pointed) {
  const total = Object.values(files || {}).reduce((n, s) => n + s.length, 0);
  const listing = total <= MAX_FILES_IN_PROMPT
    ? Object.entries(files || {}).map(([name, text]) => `--- ${name}\n${text}`).join('\n')
    : `(Its files are ${Math.ceil(total / 1024)} KB, too big to include: ${Object.keys(files || {}).join(', ')}.)`;
  return [
    `[Shellby: change a page] ${ask ? String(ask).trim().slice(0, 2000) : `Let's change my page "${page.name}".`}`,
    ...(pointed ? ['', `I'm pointing at: ${String(pointed.text || '').slice(0, 200)} (${String(pointed.selector || '').slice(0, 200)})`] : []),
    '',
    `It's "${page.name}" (id: ${page.id}). Change it with update_page (all its files each time, and why). read_page shows its data.`,
    '',
    FORMAT,
    '',
    'Its files now:',
    listing,
  ].join('\n');
}

/** "Fix it with Claude" on a page that broke. */
function fixPrompt(page, files, error) {
  return changePrompt(page, files, `My page "${page.name}" broke: ${String(error || 'it did not finish loading').slice(0, 500)}. Please fix it.`);
}

module.exports = { FORMAT, buildPrompt, changePrompt, fixPrompt };
