// Tools > All for a heavy user: 171 skills, agents and commands, in the same
// proportions as a real toolbox (132 skills, 26 agents, 13 commands), most of
// them brought by plugins. Shapes follow src/main/toolbox.js and lean.js:
// source is 'user', 'project', 'cli' or 'plugin:<name>'; uses is how often
// Claude used it in the last LOOKBACK days; lastUsed is days ago (null: not
// in that history); listTokens is what its name and description cost in every
// conversation; useTokens what reading the whole file costs each use.
// Your own ones carry generic names: this repo is public.
(function () {
  'use strict';

  const LOOKBACK = 30;

  // [name, description] per source and kind. An empty description is a real
  // case the health line counts.
  const SKILLS = {
    user: [
      ['accessibility-audit', 'Audit a page against WCAG with severity ratings and fixes.'],
      ['agent-browser', 'Drive a real browser: open pages, fill forms, click, screenshot.'],
      ['brand-voice', 'Write a tone-of-voice guide and brand files for decks and docs.'],
      ['contract-review', 'Clause-by-clause risks in a services contract before you sign.'],
      ['devops-troubleshooter', 'Rapid incident response: logs, metrics, the likely cause first.'],
      ['documentation', 'Write READMEs, runbooks and API docs in plain words.'],
      ['decision-records', 'Record an architecture decision and why, for whoever comes next.'],
      ['excalidraw-diagram', 'Draw a workflow or architecture as an Excalidraw file.'],
      ['find-skills', 'Find and install a skill when you ask how to do something.'],
      ['frontend-design', 'Distinctive, intentional visual design when building or reshaping UI.'],
      ['mcp-builder', 'Build an MCP server that wraps an API well.'],
      ['mcp-client', 'Call any MCP server without loading all its tools.'],
      ['motion-design', 'Timing, easing and choreography for UI animation.'],
      ['network-engineer', 'Cloud networking, DNS, TLS and firewall problems.'],
      ['remotion-videos', 'Make and edit videos in Remotion.'],
      ['responsive-design', 'Layouts that work from phone to 4K: grids, container queries.'],
      ['schematic-prep', 'Make a dense schematic PDF legible: tiles, text layer, OCR.'],
      ['security-review', 'Review code for injection, XSS, auth and crypto mistakes.'],
      ['seo', 'Meta tags, schema markup, sitemaps: get a site found.'],
      ['pentest', 'White-box security assessment of a web app you own.'],
      ['sop-creator', 'Turn a process into a runbook someone else can follow.'],
      ['taste', 'Anti-template frontend: audit first, then a real direction.'],
      ['tdd', 'Red, green, refactor: the test first.'],
      ['theme-factory', 'Apply one of ten themes to a deck, doc or page.'],
      ['ui-ux-pro-max', 'Palettes, type pairings and UX rules for any stack.'],
      ['web-research', 'Search the web, papers and filings with citations.'],
      ['website-rebuild', 'Rebuild a business site from its old pages and photos.'],
      ['writing-guidelines', 'Check docs against the writing handbook.'],
      ['design-taste', 'Strict taste rules for high-agency frontend work.'],
      ['rename-screenshots', 'Rename screenshots to YYYY-MM-DD_HH-MM from their EXIF time, and file them by month.'],
      ['csv-cleaner', ''],
      ['meeting-notes', 'Turn a transcript into decisions, owners and dates.'],
      ['invoice', 'Draft an invoice from hours logged in a project.'],
      ['photo-sorter', 'Sort a folder of photos into albums by date and place.'],
      ['dependency-audit', 'List outdated and vulnerable packages, safest upgrades first.'],
      ['regex-explain', 'Explain a regex piece by piece and test it on examples.'],
      ['sql-review', 'Spot slow queries and missing indexes.'],
      ['commit-message', 'Write a commit message in the repo’s own style.'],
      ['bug-report', 'Turn a vague complaint into steps, expected and actual.'],
      ['release-checklist', 'Walk a release through its checks before it ships.'],
      ['image-optimize', ''],
      ['color-contrast', 'Check text and UI colours against WCAG contrast.'],
      ['api-docs', 'Document an HTTP API from its routes.'],
      ['shell-explain', 'Explain what a shell command will do before you run it.'],
    ],
    project: [
      ['release-notes', 'Write a changes/ note in the CHANGELOG’s own voice.'],
      ['e2e-check', 'Run the e2e checks for what this branch touched.'],
      ['panel-html', 'Rebuild panel.html after editing a screen’s pieces.'],
      ['ipc-schema', 'Add an argument schema for a new IPC handler.'],
    ],
    cli: [
      ['update-config', 'Change Claude Code’s settings.json: hooks, permissions, env.'],
      ['keybindings-help', 'Rebind keyboard shortcuts.'],
      ['simplify', 'Review changed code for reuse and simpler shapes, then apply.'],
      ['fewer-permission-prompts', 'Allowlist the read-only commands you keep approving.'],
      ['loop', 'Run a prompt on a recurring interval.'],
      ['schedule', 'Create and manage scheduled cloud agents.'],
      ['claude-api', 'Reference for the Claude API and SDKs.'],
      ['init', 'Write a CLAUDE.md for this codebase.'],
      ['run', 'Launch the project’s app and see a change working.'],
      ['plugin-authoring', 'Make a mod: a panel, band, command or hook.'],
      ['workflow-authoring', 'Reference for writing a workflow script.'],
      ['claude-in-chrome', 'Automate your Chrome browser.'],
    ],
    'plugin:anthropic-skills': [
      ['built-in-browser', 'Browse inside the app.'], ['canvas-design', 'Posters and art as PNG and PDF.'],
      ['chrome-browser', 'Use Chrome with your logins.'], ['computer-use', 'Operate the desktop with screenshots and clicks.'],
      ['deep-research', 'Multi-step research with sources.'], ['docs', 'Read and write Google Docs.'],
      ['docx', 'Produce and edit Word documents.'], ['board-analyzer', 'Analyse a circuit board report.'],
      ['google-workspace', 'Gmail, Calendar and Drive.'], ['import-memory', 'Bring memory over from another assistant.'],
      ['internal-comms', 'Status updates and announcements.'], ['morning', 'A morning briefing from your calendar and mail.'],
      ['obsidian-coder', 'Code notes into an Obsidian vault.'], ['obsidian-planner', 'Plans in an Obsidian vault.'],
      ['obsidian-writer', 'Long-form writing in Obsidian.'], ['pdf', 'Read, fill and produce PDF files.'],
      ['pptx', 'Produce and edit slide decks.'], ['skill-creator', 'Write a new skill and test it.'],
      ['theme-factory', 'Theme a document or deck.'], ['xlsx', 'Produce and edit spreadsheets, with formulas kept live.'],
    ],
    'plugin:example-skills': [
      ['algorithmic-art', 'Generative art with p5.js.'], ['brand-guidelines', 'Apply a brand’s colours and type to an artifact.'],
      ['canvas-design', 'Visual art in PNG and PDF.'], ['doc-coauthoring', 'Write a spec or proposal together, section by section.'],
      ['frontend-design', 'Distinctive, intentional visual design when building UI.'], ['internal-comms', 'Write internal updates.'],
      ['mcp-builder', 'Build an MCP server.'], ['skill-creator', 'Create and evaluate skills.'],
      ['slack-gif-creator', 'Animated GIFs sized for Slack.'], ['theme-factory', 'Ten themes for artifacts.'],
      ['web-artifacts-builder', 'Multi-component HTML artifacts.'], ['webapp-testing', 'Drive a local web app with Playwright to check it works.'],
    ],
    'plugin:ui-ux-kit': [
      ['design-motion-principles', 'Motion audits and purposeful micro-interactions.'], ['design-principles', 'Principles that settle design trade-offs.'],
      ['design-qa-checklist', 'Check a build against its design.'], ['design-sprint', 'A five-day sprint to test an idea.'],
      ['design-system-generator', 'A DESIGN.md for a project.'], ['design-token', 'Name and organise colour, type and spacing tokens.'],
      ['layout-grid', 'Columns, gutters and breakpoints.'], ['typography-scale', 'A modular type scale.'],
      ['ux-heuristics', 'Nielsen’s heuristics, with severity.'], ['refactoring-ui', 'Fix hierarchy, spacing and colour.'],
      ['hooked-ux', 'Habit loops, ethically.'], ['ios-hig-design', 'Native iOS by Apple’s guidelines.'],
    ],
    'plugin:vercel': [
      ['deploy-to-vercel', 'Deploy and get the link.'], ['vercel-cli-with-tokens', 'Use the Vercel CLI with a token.'],
      ['composition-patterns', 'React composition that scales.'], ['vercel-optimize', 'Cut cost and speed up routes.'],
      ['react-best-practices', 'React and Next.js performance rules.'], ['react-native-skills', 'React Native and Expo.'],
      ['view-transitions', 'React view transitions.'], ['web-design-guidelines', 'Review UI against web guidelines.'],
      ['web-performance', 'Core Web Vitals and bundle budgets.'], ['vercel-sandbox', 'Run code in a Vercel sandbox.'],
    ],
    'plugin:ruflo-core': [
      ['ruflo-status', 'Ruflo health and active agents.'], ['witness', 'Check the signed fix manifest.'],
      ['ruflo-doctor', 'Diagnose a Ruflo install.'], ['init-project', 'Set Ruflo up in a project.'],
      ['discover-plugins', 'Find Ruflo plugins.'], ['swarm-patterns', 'Coordinate many agents at once.'],
    ],
    'plugin:planetscale': [
      ['mysql', 'MySQL schema, indexes and slow queries.'], ['postgres', 'Postgres tuning and connections.'],
      ['vitess', 'Sharded MySQL on Vitess.'], ['neki', 'Sharded Postgres.'], ['pscale-cli', 'The PlanetScale CLI.'],
    ],
    'plugin:ansible': [
      ['ansible-docs', 'Ansible answers from the official docs.'], ['ansible-good-practices', 'Review roles against good practice.'],
      ['ansible-zen', 'The Zen of Ansible.'],
    ],
    'plugin:claude-md-management': [['claude-md-improver', 'Tighten a CLAUDE.md.']],
    'plugin:dataviz': [['dataviz', 'Charts that read as one system, light and dark.']],
    'plugin:feature-dev': [['feature-dev', 'Plan and build a feature end to end.']],
    'plugin:impeccable': [['impeccable', 'Design, critique, polish and harden a frontend.']],
  };

  const AGENTS = {
    user: [
      ['claude', 'Catch-all for anything without a better agent.'],
      ['code-reviewer', 'Catches bugs, unclear naming and missing error handling before you commit.'],
      ['codebase-explorer', 'Answers “where does X live” with a focused map.'],
      ['debugger', 'Forms a hypothesis from an error, narrows it down, proposes a fix.'],
      ['ecc-code-reviewer', 'An in-depth review of a large change.'],
      ['planner', 'Plans a feature or spec without editing code.'],
      ['react-reviewer', 'Hooks, render cost and accessibility in React.'],
      ['refactorer', 'Refactors with a plan first.'],
      ['security-reviewer', 'Finds secrets, injection and unsafe crypto.'],
      ['test-writer', 'Writes tests that match the project’s framework and mocking style.'],
      ['web-fetch', 'Reads a web page and answers from it.'],
    ],
    cli: [
      ['Explore', 'Read-only search across many files. Comes back with the answer, not the dumps.'],
      ['general-purpose', 'Researches and runs multi-step tasks.'],
      ['Plan', 'Designs an implementation plan.'],
      ['statusline-setup', 'Sets up the status line.'],
    ],
    'plugin:feature-dev': [
      ['code-architect', 'Blueprints a feature from the codebase’s patterns.'],
      ['code-explorer', 'Traces how an existing feature works.'],
      ['code-reviewer', 'High-confidence bugs only.'],
    ],
    'plugin:ruflo-core': [
      ['coder', 'Writes code in the project’s patterns.'], ['researcher', 'Surfaces prior art in memory and code.'],
      ['reviewer', 'Quality and security review.'], ['witness-curator', 'Maintains the signed fix manifest.'],
    ],
    'plugin:impeccable': [
      ['asset-producer', 'Clean raster assets from an approved mock.'], ['documenter', 'Writes DESIGN.md from a finished build.'],
      ['finish-reviewer', 'Reviews a build against its direction.'], ['manual-edit-applier', 'Applies copy edits to source.'],
    ],
  };

  const COMMANDS = {
    user: [['handoff', 'Write down where this conversation got to, for the next one.']],
    cli: [['pr-comments', 'Fetch a pull request’s comments.'], ['security-review', 'Review pending changes for security.'], ['insights', 'A report on how you use Claude Code.']],
    'plugin:claude-md-management': [['revise-claude-md', 'Update CLAUDE.md with what this session learned.']],
    'plugin:code-review': [['code-review', 'Review a pull request.']],
    'plugin:commit-commands': [['clean_gone', 'Delete branches whose remote is gone.'], ['commit-push-pr', 'Commit, push and open a pull request in one go.'], ['commit', 'Commit with a message in the repo’s style.']],
    'plugin:feature-dev': [['feature-dev', 'Guided feature development.']],
    'plugin:ruflo-core': [['discover-plugins', 'Browse Ruflo plugins.'], ['init-project', 'Set Ruflo up here.']],
    'plugin:shellby': [['statusline', 'Put Shellby’s status line in the terminal.']],
  };

  // Uses in the last LOOKBACK days, and days since the last one, for the ones Claude reaches for.
  const USED = {
    'agent:Explore': [64, 0], 'agent:code-reviewer@user': [36, 0], 'agent:general-purpose': [22, 1], 'agent:Plan': [8, 2],
    'agent:debugger': [5, 4], 'agent:test-writer': [5, 9], 'agent:codebase-explorer': [3, 6], 'agent:security-reviewer': [2, 12],
    'agent:code-architect': [1, 19], 'agent:web-fetch': [4, 3],
    'skill:frontend-design@user': [17, 0], 'skill:impeccable': [12, 0], 'skill:code-review': [0, null], 'skill:agent-browser': [6, 2],
    'skill:ui-ux-pro-max': [5, 1], 'skill:tdd': [4, 5], 'skill:security-review': [3, 8], 'skill:release-notes': [5, 3],
    'skill:e2e-check': [9, 0], 'skill:panel-html': [6, 1], 'skill:simplify': [2, 6], 'skill:loop': [1, 22], 'skill:init': [1, 27],
    'skill:pdf': [2, 11], 'skill:deep-research': [3, 4], 'skill:docx': [1, 25], 'skill:seo': [2, 14], 'skill:webapp-testing': [1, 18],
    'skill:rename-screenshots': [4, 0], 'skill:dataviz': [2, 7], 'skill:design-motion-principles': [1, 16], 'skill:web-research': [3, 2],
    'skill:commit-message': [2, 5], 'skill:deploy-to-vercel': [1, 9], 'skill:documentation': [1, 20],
    'command:commit-push-pr': [21, 0], 'command:commit': [9, 1], 'command:handoff': [7, 1], 'command:code-review': [4, 3],
    'command:revise-claude-md': [1, 13], 'command:statusline': [1, 29],
  };

  const NEW = new Set(['skill:rename-screenshots@user', 'skill:ipc-schema@project']);
  const PINNED = new Set(['agent:code-reviewer@user', 'command:commit-push-pr', 'skill:frontend-design@user', 'agent:Explore']);

  // A deterministic spread for what reading each file costs.
  const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const HOME = 'C:\\Users\\you\\.claude';
  function pathOf(kind, name, source) {
    const dir = { skill: 'skills', agent: 'agents', command: 'commands' }[kind];
    const file = kind === 'skill' ? `${name}\\SKILL.md` : `${name}.md`;
    if (source === 'user') return `${HOME}\\${dir}\\${file}`;
    if (source === 'project') return `C:\\code\\shellby\\.claude\\${dir}\\${file}`;
    if (source.startsWith('plugin:')) return `${HOME}\\plugins\\cache\\${source.slice(7)}\\${dir}\\${file}`;
    return null;
  }

  const items = [];
  const add = (kind, table) => {
    for (const [source, rows] of Object.entries(table)) {
      for (const [name, desc] of rows) {
        const id = `${kind}:${name}@${source}`;
        const hit = USED[`${id}`] || (source === 'user' || !USED[`${kind}:${name}@user`] ? USED[`${kind}:${name}`] : null);
        const [uses, lastUsed] = hit || [0, null];
        const h = hash(id);
        items.push(Object.freeze({
          id, kind, name, source, desc,
          uses, lastUsed,
          listTokens: Math.round(((name.length + (desc || name).length) / 3.6) + 9 + (h % 18)),
          useTokens: 900 + (h % 80) * 110,
          isNew: NEW.has(id),
          pinned: PINNED.has(id) || PINNED.has(`${kind}:${name}`),
          path: pathOf(kind, name, source),
          hides: [],
        }));
      }
    }
  };
  add('skill', SKILLS);
  add('agent', AGENTS);
  add('command', COMMANDS);

  // Your security-review skill shares its name with the project's copy, and
  // Claude Code loads yours: the project's is hidden behind it.
  const sec = items.findIndex(t => t.id === 'skill:security-review@user');
  items[sec] = Object.freeze({ ...items[sec], hides: [{ source: 'project', path: 'C:\\code\\shellby\\.claude\\skills\\security-review\\SKILL.md' }] });

  // Turned off and kept by Shellby: listed under Parked with Restore.
  const parked = [
    { id: 'p1', kind: 'skill', name: 'csv-to-json', desc: 'Convert a CSV to JSON with typed columns.', at: 6 },
    { id: 'p2', kind: 'agent', name: 'old-reviewer', desc: 'The first code reviewer, before code-reviewer.', at: 20 },
    { id: 'p3', kind: 'command', name: 'standup', desc: 'Summarise yesterday’s commits for standup.', at: 41 },
  ];

  const counts = items.reduce((n, t) => ({ ...n, [t.kind]: (n[t.kind] || 0) + 1 }), {});
  if (counts.skill !== 132 || counts.agent !== 26 || counts.command !== 13) {
    throw new Error(`tools-all data: expected 132/26/13, got ${counts.skill}/${counts.agent}/${counts.command}`);
  }

  window.TB_DATA = Object.freeze({
    items, parked, LOOKBACK,
    mcpDown: 1, // one MCP server waiting for sign-in: the health line links to the MCP tab
    tabs: { all: items.length, skill: counts.skill, agent: counts.agent, command: counts.command, mcp: 5, mod: 1, snippet: 5 },
  });
})();
