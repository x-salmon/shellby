// The fixed cost of every turn (src/main/fixedcost.js): which output style is
// on and where it's set, each item sent before your first word with its share,
// the one-line summary, and the suggestions made from them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('../src/main/fixedcost');

const MEMORY = [
  { path: 'C:\\Users\\me\\.claude\\CLAUDE.md', scope: 'user', tokens: 1600, onDemand: false },
  { path: 'C:\\code\\shop\\CLAUDE.md', scope: 'project', tokens: 900, onDemand: false },
  { path: 'C:\\Users\\me\\.claude\\rules\\ts.md', scope: 'user-rule', tokens: 300, onDemand: true },
];
const PLUGINS = [
  { id: 'vercel@m', name: 'vercel', tokens: 2100, idle: true, background: false },
  { id: 'github@m', name: 'github', tokens: 900, idle: false, background: false },
  { id: 'quiet@m', name: 'quiet', tokens: null, idle: false, background: true },
];
const SKILLS = [{ kind: 'skill', name: 'a', listTokens: 140 }, { kind: 'agent', name: 'b', listTokens: 60 }];
const MCP = [{ name: 'sqlite', status: 'connected' }];
const HOOKS = [
  { event: 'SessionStart', name: 'start.sh', runs: 10, sessions: 10, tokens: 400, perConversation: 400 },
  { event: 'UserPromptSubmit', name: 'remind.js', runs: 40, sessions: 10, tokens: 250, perConversation: 1000 },
  { event: 'PostToolUse', name: 'lint.sh', runs: 90, sessions: 10, tokens: 300, perConversation: 2700 },
];

// ---- the output style

test('the active output style: Shellby\'s own choice first, then the nearest settings file, and none when all say Default', () => {
  const files = [
    { scope: 'local', file: 'C:\\code\\shop\\.claude\\settings.local.json', data: {} },
    { scope: 'project', file: 'C:\\code\\shop\\.claude\\settings.json', data: { outputStyle: 'Learning' } },
    { scope: 'user', file: 'C:\\Users\\me\\.claude\\settings.json', data: { outputStyle: 'Explanatory' } },
  ];
  assert.deepEqual(fc.activeStyle({ shellby: 'Explanatory', files }), { name: 'Explanatory', source: 'shellby', file: null });
  assert.deepEqual(fc.activeStyle({ shellby: '', files }), { name: 'Learning', source: 'project', file: 'C:\\code\\shop\\.claude\\settings.json' });
  assert.deepEqual(fc.activeStyle({ shellby: '', files: files.slice(2) }), { name: 'Explanatory', source: 'user', file: 'C:\\Users\\me\\.claude\\settings.json' });
  assert.equal(fc.activeStyle({ shellby: '', files: [{ scope: 'user', file: 'x', data: { outputStyle: 'default' } }] }), null);
  assert.equal(fc.activeStyle({ shellby: '', files: [{ scope: 'user', file: 'x', data: { outputStyle: 42 } }, { scope: 'project', file: 'y', data: null }] }), null);
  assert.equal(fc.activeStyle({}), null);
});

test('a style\'s size: a rough figure for the built-in ones, the file\'s size for your own, unknown otherwise', () => {
  assert.deepEqual(fc.styleTokens({ name: 'Explanatory' }), { tokens: 500, estimate: 'rough' });
  assert.deepEqual(fc.styleTokens({ name: 'learning' }), { tokens: 1000, estimate: 'rough' });
  assert.deepEqual(fc.styleTokens({ name: 'terse', chars: 2000 }), { tokens: 500, estimate: 'size' });
  assert.deepEqual(fc.styleTokens({ name: 'terse' }), { tokens: null, estimate: null });
});

// ---- the items

test('every item sent with a turn, its share of the measured setup, and the rest Claude Code itself takes', () => {
  const r = fc.fixedCost({ setup: { tokens: 20000 }, memory: MEMORY, plugins: PLUGINS, skills: SKILLS, mcp: MCP, hooks: HOOKS, style: { name: 'Explanatory', source: 'shellby', file: null } });
  assert.equal(r.measured, true);
  // The measured setup plus what each message's hooks add.
  assert.equal(r.total, 20250);
  assert.equal(r.line, 'setup ~20k/turn');
  const keys = r.items.map(i => i.key);
  assert.deepEqual(keys.slice(0, 2), ['plugin:vercel@m', 'memory:C:\\Users\\me\\.claude\\CLAUDE.md'], 'biggest first');
  assert.deepEqual(keys.slice(-2), ['plugin:quiet@m', 'mcp:sqlite'], 'what can\'t be sized comes last');
  assert.ok(!keys.some(k => k.includes('rules\\ts.md')), 'a rule for matching files only is not sent with every turn');
  const style = r.items.find(i => i.kind === 'style');
  assert.equal(style.tokens, 500);
  assert.equal(style.estimate, 'rough');
  assert.equal(style.label, 'Output style "Explanatory"');
  const skills = r.items.find(i => i.kind === 'skills');
  assert.equal(skills.tokens, 200);
  assert.equal(skills.count, 2);
  const mcp = r.items.find(i => i.kind === 'mcp');
  assert.equal(mcp.tokens, null, 'an MCP server\'s tool list is not sized');
  assert.equal(mcp.share, null);
  const start = r.items.find(i => i.key === 'hook:SessionStart:start.sh');
  assert.equal(start.tokens, 400);
  assert.equal(start.when, 'start');
  const msg = r.items.find(i => i.key === 'hook:UserPromptSubmit:remind.js');
  assert.equal(msg.tokens, 250);
  assert.equal(msg.when, 'message');
  assert.ok(!r.items.some(i => i.key.startsWith('hook:PostToolUse')), 'a hook after a tool is not a fixed cost');
  assert.equal(r.items.find(i => i.key === 'plugin:quiet@m').tokens, null);
  assert.equal(r.items.find(i => i.key === 'plugin:vercel@m').share, 2100 / 20250);
  // 2100 + 900 + 1600 + 900 + 200 + 400 + 250 + 500 sized; the rest is Claude Code's prompt and tools.
  assert.equal(r.known, 6850);
  assert.equal(r.rest, 20250 - 6850);
});

test('with no measured setup the items add up to the total, and nothing at all gives no line', () => {
  const r = fc.fixedCost({ setup: null, memory: MEMORY, plugins: PLUGINS, skills: [], mcp: [], hooks: [], style: null });
  assert.equal(r.measured, false);
  assert.equal(r.total, 2100 + 900 + 1600 + 900);
  assert.equal(r.rest, 0);
  assert.equal(r.line, 'setup ~5.5k/turn');
  const none = fc.fixedCost({});
  assert.equal(none.total, 0);
  assert.equal(none.line, null);
  assert.deepEqual(none.items, []);
});

test('the line reads like the chip: hundreds plain, thousands with a k', () => {
  assert.equal(fc.compactTokens(950), '950');
  assert.equal(fc.compactTokens(1500), '1.5k');
  assert.equal(fc.compactTokens(14300), '14k');
  assert.equal(fc.compactTokens(1200000), '1.2M');
});

// ---- sections of a CLAUDE.md

const GLOBAL_MD = [
  '# Global Defaults', '', 'Do the task directly.', '',
  '## Routing', '', 'Harbor Tree client routing lives in Harbor_Tree/.claude/CLAUDE.md and loads only there.', '',
  '## Shop deploys', '', ...Array(12).fill('Deploy the shop with `npm run deploy` from the shop repo, after the shop tests pass.'), '',
  '## Everything', '', 'Both shop and rack-builder use pnpm.', '',
].join('\n');

test('sections of a memory file, by their headings, each sized', () => {
  const s = fc.sectionsOf(GLOBAL_MD);
  assert.deepEqual(s.map(x => x.heading), ['Global Defaults', 'Routing', 'Shop deploys', 'Everything']);
  assert.ok(s[2].tokens > s[1].tokens);
  assert.equal(s[1].line, 5);
  assert.deepEqual(fc.sectionsOf(''), []);
  assert.equal(fc.sectionsOf('no headings here\n')[0].heading, '');
});

test('a section that names one project and nothing else is one to move there', () => {
  const found = fc.projectOnlySections(GLOBAL_MD, ['shop', 'rack-builder', 'Harbor_Tree'], { minTokens: 40 });
  assert.deepEqual(found.map(f => [f.heading, f.project]), [['Shop deploys', 'shop']]);
  // Smaller: the routing note names one project too, but is too short to be worth a move.
  const all = fc.projectOnlySections(GLOBAL_MD, ['shop', 'rack-builder', 'Harbor_Tree'], { minTokens: 1 });
  assert.deepEqual(all.map(f => f.heading), ['Routing', 'Shop deploys']);
  assert.deepEqual(fc.projectOnlySections(GLOBAL_MD, []), []);
  assert.deepEqual(fc.projectOnlySections(GLOBAL_MD, ['sh']), [], 'two-letter names match everything, so they never count');
});

// ---- suggestions

test('suggestions, biggest saving first: the style can be switched off, an idle plugin turned off, a section moved by hand', () => {
  const r = fc.fixedCost({ setup: { tokens: 20000 }, memory: MEMORY, plugins: PLUGINS, skills: SKILLS, mcp: MCP, hooks: HOOKS, style: { name: 'Explanatory', source: 'user', file: 'C:\\Users\\me\\.claude\\settings.json' },
    globalMd: { path: 'C:\\Users\\me\\.claude\\CLAUDE.md', text: GLOBAL_MD }, projects: ['shop', 'rack-builder'], idleDays: 21 });
  const s = r.suggestions;
  assert.deepEqual(s.map(x => x.kind).sort(), ['hook', 'move', 'plugin', 'style']);
  assert.deepEqual(s.map(x => x.saves), [...s.map(x => x.saves)].sort((a, b) => b - a), 'biggest saving first');
  const by = kind => s.find(x => x.kind === kind);
  assert.equal(s[0], by('plugin'));
  assert.deepEqual(by('plugin').action, { type: 'plugin-off', id: 'vercel@m' });
  assert.match(by('plugin').text, /vercel.*idle.*21 days.*2\.1k tokens/);
  assert.deepEqual(by('style').action, { type: 'style-off' });
  assert.match(by('style').text, /Output style "Explanatory" adds ~500 tokens to every turn/);
  assert.match(by('style').text, /settings\.json/, 'says where it is set');
  assert.equal(by('style').saves, 500);
  assert.equal(by('hook').action, null);
  assert.match(by('hook').text, /remind\.js.*every message/);
  assert.equal(by('move').action, null, 'moving a section is never automatic');
  assert.match(by('move').text, /"Shop deploys".*shop/);
  assert.equal(by('move').path, 'C:\\Users\\me\\.claude\\CLAUDE.md');
  assert.ok(by('move').saves > 0);
});

test('no suggestions when there is nothing to suggest', () => {
  const r = fc.fixedCost({ setup: { tokens: 9000 }, memory: MEMORY.slice(1), plugins: [PLUGINS[1]], skills: [], mcp: [], hooks: [], style: null, globalMd: null, projects: ['shop'] });
  assert.deepEqual(r.suggestions, []);
});
