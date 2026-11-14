// A believable toolbox for one developer on one repo. Shapes follow what
// src/main/toolbox.js and src/main/lean.js really return: tokens are the
// listing cost carried by every conversation, uses are weekly counts over the
// last six weeks (oldest first), lastUsed is days ago (null: never seen).
(function () {
  'use strict';

  const W = (...n) => n;
  const NONE = W(0, 0, 0, 0, 0, 0);

  const items = [
    // Skills
    { id: 'rename-screenshots', kind: 'skill', name: 'rename-screenshots', source: 'yours', isNew: true, tokens: 74, useTokens: 1900, uses: W(0, 0, 0, 0, 1, 3), lastUsed: 0, desc: 'Rename screenshots to YYYY-MM-DD_HH-MM from their EXIF time, and file them by month.' },
    { id: 'csv-cleaner', kind: 'skill', name: 'csv-cleaner', source: 'yours', tokens: 61, useTokens: 1400, uses: NONE, lastUsed: null, desc: 'Data helper.' },
    { id: 'frontend-design', kind: 'skill', name: 'frontend-design', source: 'example-skills', tokens: 180, useTokens: 4200, uses: W(2, 3, 1, 4, 2, 5), lastUsed: 1, desc: 'Distinctive, intentional visual design when building or reshaping UI.' },
    { id: 'code-review', kind: 'skill', name: 'code-review', source: 'code-review', tokens: 160, useTokens: 3100, uses: W(3, 4, 2, 5, 3, 4), lastUsed: 0, desc: 'Review changes since a commit for standards and for what the issue asked.' },
    { id: 'release-notes', kind: 'skill', name: 'release-notes', source: 'project', tokens: 90, useTokens: 1600, uses: W(0, 1, 1, 0, 2, 1), lastUsed: 3, desc: 'Write a changes/ note in the CHANGELOG’s own voice.' },
    { id: 'pdf', kind: 'skill', name: 'pdf', source: 'anthropic-skills', tokens: 210, useTokens: 5200, uses: W(1, 0, 0, 1, 0, 0), lastUsed: 30, desc: 'Read, fill and produce PDF files.' },
    { id: 'docx', kind: 'skill', name: 'docx', source: 'anthropic-skills', tokens: 230, useTokens: 5600, uses: NONE, lastUsed: null, desc: 'Produce and edit Word documents.' },
    { id: 'xlsx', kind: 'skill', name: 'xlsx', source: 'anthropic-skills', tokens: 240, useTokens: 5900, uses: NONE, lastUsed: null, desc: 'Produce and edit spreadsheets, with formulas kept live.' },
    { id: 'pptx', kind: 'skill', name: 'pptx', source: 'anthropic-skills', tokens: 220, useTokens: 6100, uses: NONE, lastUsed: null, desc: 'Produce and edit slide decks.' },
    { id: 'webapp-testing', kind: 'skill', name: 'webapp-testing', source: 'example-skills', tokens: 140, useTokens: 2800, uses: W(0, 1, 0, 0, 0, 0), lastUsed: 33, desc: 'Drive a local web app with Playwright to check it works.' },
    { id: 'algorithmic-art', kind: 'skill', name: 'algorithmic-art', source: 'example-skills', tokens: 120, useTokens: 2600, uses: NONE, lastUsed: null, desc: 'Generative art with p5.js.' },
    { id: 'brand-guidelines', kind: 'skill', name: 'brand-guidelines', source: 'example-skills', tokens: 170, useTokens: 2300, uses: NONE, lastUsed: null, desc: 'Apply a brand’s colours and type to an artifact.' },

    // Agents
    { id: 'Explore', kind: 'agent', name: 'Explore', source: 'built in', tokens: 95, useTokens: 8400, uses: W(9, 11, 8, 12, 10, 14), lastUsed: 0, desc: 'Read-only search across many files. Comes back with the answer, not the dumps.' },
    { id: 'code-reviewer', kind: 'agent', name: 'code-reviewer', source: 'yours', tokens: 130, useTokens: 9100, uses: W(5, 6, 4, 7, 6, 8), lastUsed: 0, desc: 'Catches bugs, unclear naming and missing error handling before you commit.' },
    { id: 'test-writer', kind: 'agent', name: 'test-writer', source: 'yours', tokens: 105, useTokens: 7700, uses: W(2, 1, 0, 1, 1, 0), lastUsed: 9, desc: 'Writes tests that match the project’s framework and mocking style.' },
    { id: 'debugger', kind: 'agent', name: 'debugger', source: 'yours', tokens: 110, useTokens: 8800, uses: W(1, 0, 2, 1, 0, 1), lastUsed: 4, desc: 'Forms a hypothesis from an error, narrows it down, proposes a fix.' },
    { id: 'folder-auditor', kind: 'agent', name: 'folder-auditor', source: 'yours', isNew: true, tokens: 88, useTokens: 5200, uses: W(0, 0, 0, 0, 0, 1), lastUsed: 1, desc: 'Audits one folder: size, file types, duplicates and junk.' },
    { id: 'security-reviewer', kind: 'agent', name: 'security-reviewer', source: 'yours', tokens: 140, useTokens: 9900, uses: NONE, lastUsed: 52, desc: 'Flags secrets, injection, SSRF and unsafe crypto in a change.' },

    // Commands
    { id: 'commit-push-pr', kind: 'command', name: '/commit-push-pr', source: 'commit-commands', tokens: 70, useTokens: 900, uses: W(3, 2, 4, 3, 5, 4), lastUsed: 0, desc: 'Commit, push and open a pull request in one go.' },
    { id: 'handoff', kind: 'command', name: '/handoff', source: 'shellby', tokens: 40, useTokens: 700, uses: W(1, 2, 1, 1, 0, 2), lastUsed: 2, desc: 'Write down where this conversation got to, for the next one.' },
    { id: 'leftoff', kind: 'command', name: '/leftoff', source: 'shellby', tokens: 38, useTokens: 600, uses: W(0, 1, 0, 1, 1, 0), lastUsed: 6, desc: 'Pick up from the last handoff.' },
    { id: 'deploy', kind: 'command', name: '/deploy', source: 'project', tokens: 55, useTokens: 1100, uses: W(1, 0, 1, 1, 0, 1), lastUsed: 5, desc: 'Build, sign and stage a release candidate.' },
    { id: 'statusline', kind: 'command', name: '/statusline', source: 'shellby', tokens: 42, useTokens: 500, uses: NONE, lastUsed: 60, desc: 'Put Shellby’s status line under Claude Code.' },
    { id: 'clean_gone', kind: 'command', name: '/clean_gone', source: 'commit-commands', tokens: 48, useTokens: 400, uses: NONE, lastUsed: null, desc: 'Delete local branches whose remote is gone.' },

    // MCP servers: tokens are the tool listings they add
    { id: 'shellby-mcp', kind: 'mcp', name: 'shellby', source: 'shellby', status: 'connected', tokens: 1400, useTokens: 300, uses: W(12, 15, 9, 14, 11, 16), lastUsed: 0, desc: 'Lets Claude make the crab talk, add notes and propose routines.' },
    { id: 'github', kind: 'mcp', name: 'github', source: 'yours', status: 'connected', tokens: 3900, useTokens: 2400, uses: W(4, 6, 3, 5, 2, 7), lastUsed: 0, desc: 'Issues, pull requests and reviews on GitHub.' },
    { id: 'context7', kind: 'mcp', name: 'context7', source: 'yours', status: 'connected', tokens: 820, useTokens: 3800, uses: W(2, 1, 3, 0, 2, 1), lastUsed: 1, desc: 'Current library docs, so Claude stops guessing at APIs.' },
    { id: 'claude-in-chrome', kind: 'mcp', name: 'claude-in-chrome', source: 'yours', status: 'connected', tokens: 5200, useTokens: 1800, uses: W(0, 0, 1, 0, 0, 0), lastUsed: 29, desc: 'Drive your Chrome: click, type, read pages and the console.' },
    { id: 'linear', kind: 'mcp', name: 'linear', source: 'project', status: 'needs-auth', tokens: 2100, useTokens: 900, uses: NONE, lastUsed: null, desc: 'Linear issues and cycles for this repo.' },

    // Mods: no use counts exist for these
    { id: 'quiet-npm', kind: 'mod', name: 'quiet-npm', source: 'yours', on: true, tokens: 0, uses: null, lastUsed: null, desc: 'Trims npm install output down to the errors.' },
    { id: 'task-pane', kind: 'mod', name: 'task-pane', source: 'yours', on: true, isNew: true, tokens: 0, uses: null, lastUsed: null, desc: 'A pane beside the chat with the current task list.' },

    // Snippets: cost nothing until run
    { id: 'sn-review', kind: 'snippet', name: '/review', source: 'yours', tokens: 0, uses: W(2, 3, 2, 4, 3, 3), lastUsed: 0, desc: 'Review what changed on this branch and list anything risky.' },
    { id: 'sn-tests', kind: 'snippet', name: '/tests', source: 'yours', tokens: 0, uses: W(1, 1, 2, 0, 1, 2), lastUsed: 1, desc: 'Write tests for <file>, then run them.', hint: '<file>' },
    { id: 'sn-explain', kind: 'snippet', name: '/explain', source: 'yours', tokens: 0, uses: W(0, 1, 0, 0, 1, 0), lastUsed: 8, desc: 'Explain <path> as if I’d never seen it.', hint: '<path>' },
  ];

  const memory = [
    { id: 'mem-user', kind: 'memory', name: 'Your memory', path: '~/.claude/CLAUDE.md', source: 'yours', tokens: 1450, loads: 'Every conversation, every project', edited: 2 },
    { id: 'mem-project', kind: 'memory', name: 'Project memory', path: './CLAUDE.md', source: 'project', tokens: 2800, loads: 'Every conversation in this repo', edited: 0 },
    { id: 'mem-auto', kind: 'memory', name: 'Auto-memory', path: 'memory/MEMORY.md', source: 'yours', tokens: 900, loads: 'Every conversation in this repo', edited: 0 },
    { id: 'mem-e2e', kind: 'memory', name: 'e2e rules', path: '.claude/rules/e2e.md', source: 'project', tokens: 640, loads: 'Only when Claude opens scripts/e2e-*', edited: 11, scoped: true },
  ];

  // Hooks, by the moment they run in a turn
  const hooks = [
    { id: 'git-context', recipe: 'git-context', event: 'UserPromptSubmit', name: 'Tell Claude the branch and changed files', matcher: '', source: 'yours', adds: 120 },
    { id: 'guard-git', recipe: 'guard-git', event: 'PreToolUse', name: 'Stop force pushes and hard resets', matcher: 'Bash', source: 'yours' },
    { id: 'guard-secrets', recipe: 'guard-secrets', event: 'PreToolUse', name: 'Keep Claude out of .env and key files', matcher: 'Read|Edit|Write', source: 'project' },
    { id: 'prettier', recipe: 'prettier', event: 'PostToolUse', name: 'Format files after Claude edits them', matcher: 'Edit|Write', source: 'project' },
    { id: 'quiet-output', recipe: 'quiet-output', event: 'PostToolUse', name: 'Trim long command output', matcher: 'Bash', source: 'yours' },
    { id: 'tests-pass', recipe: 'tests-pass', event: 'Stop', name: 'Don’t let Claude stop while tests fail', matcher: '', source: 'project', paused: true },
    { id: 'sound-done', recipe: 'sound-done', event: 'Stop', name: 'Play a sound when Claude finishes', matcher: '', source: 'yours' },
    { id: 'sound-ask', recipe: 'sound-ask', event: 'Notification', name: 'Play a sound when Claude needs you', matcher: '', source: 'yours' },
  ];

  const rules = [
    { id: 'r1', list: 'allow', rule: 'Bash(npm test:*)', source: 'project' },
    { id: 'r2', list: 'allow', rule: 'Bash(npm run lint)', source: 'project' },
    { id: 'r3', list: 'allow', rule: 'Bash(git status)', source: 'yours' },
    { id: 'r4', list: 'allow', rule: 'Bash(git diff:*)', source: 'yours' },
    { id: 'r5', list: 'ask', rule: 'Bash(git push:*)', source: 'yours' },
    { id: 'r6', list: 'deny', rule: 'Bash(rm -rf:*)', source: 'yours' },
    { id: 'r7', list: 'deny', rule: 'Read(./.env*)', source: 'project' },
    { id: 'r8', list: 'allow', rule: 'WebFetch(domain:docs.github.com)', source: 'yours' },
  ];

  const recipes = [
    { id: 'sound-done', event: 'Stop', name: 'Play a sound when Claude finishes' },
    { id: 'sound-ask', event: 'Notification', name: 'Play a sound when Claude needs you' },
    { id: 'guard-git', event: 'PreToolUse', name: 'Stop force pushes and hard resets' },
    { id: 'guard-secrets', event: 'PreToolUse', name: 'Keep Claude out of .env and key files' },
    { id: 'log-commands', event: 'PreToolUse', name: 'Keep a log of every command Claude runs' },
    { id: 'prettier', event: 'PostToolUse', name: 'Format files after Claude edits them' },
    { id: 'quiet-output', event: 'PostToolUse', name: 'Trim long command output' },
    { id: 'tests-pass', event: 'Stop', name: 'Don’t let Claude stop while tests fail' },
    { id: 'git-context', event: 'UserPromptSubmit', name: 'Tell Claude the branch and changed files' },
    { id: 'reminder', event: 'UserPromptSubmit', name: 'Remind Claude of a rule on every prompt' },
  ];

  const crew = [
    { agent: 'Explore', name: 'Scout', level: 9, xp: 0.62, runs: 142, acted: 88, tokens: '1.1M', tint: '#7fd6c2', last: 'today' },
    { agent: 'code-reviewer', name: 'Nitpick', level: 6, xp: 0.35, runs: 61, acted: 40, tokens: '540k', tint: '#ff7a5c', last: 'today' },
    { agent: 'general-purpose', name: 'Barnacle', level: 5, xp: 0.8, runs: 38, acted: 20, tokens: '610k', tint: '#ffc15e', last: 'yesterday' },
    { agent: 'test-writer', name: 'Tidepool', level: 4, xp: 0.2, runs: 22, acted: 17, tokens: '170k', tint: '#b3a6ff', last: '9 days ago' },
    { agent: 'debugger', name: 'Pinch', level: 3, xp: 0.55, runs: 14, acted: 9, tokens: '120k', tint: '#8fc7ff', last: '4 days ago' },
    { agent: 'folder-auditor', name: 'Dusty', level: 1, xp: 0.1, runs: 1, acted: 0, tokens: '5k', tint: '#e8b4d8', last: 'yesterday' },
  ];

  const market = [
    { id: 'k8s', name: 'kubernetes-helper', market: 'claude-code-plugins', kinds: '2 skills, 1 agent', desc: 'Write and check Kubernetes manifests, and explain a failing pod.' },
    { id: 'sentry', name: 'sentry', market: 'claude-code-plugins', kinds: 'MCP server', desc: 'Read Sentry issues and stack traces from the conversation.' },
    { id: 'playwright', name: 'playwright-skill', market: 'community', kinds: '1 skill', desc: 'Write and run Playwright end-to-end tests against a local server.' },
    { id: 'changelog', name: 'changelog-writer', market: 'community', kinds: '1 skill, 1 command', desc: 'Turn merged pull requests into release notes.' },
    { id: 'sql', name: 'sql-review', market: 'claude-code-plugins', kinds: '1 agent', desc: 'Review migrations and queries for locking and missing indexes.' },
    { id: 'notion', name: 'notion', market: 'claude-code-plugins', kinds: 'MCP server', desc: 'Search and edit Notion pages.' },
    { id: 'figma', name: 'figma-to-code', market: 'community', kinds: '1 skill', desc: 'Build a component from a Figma frame link.' },
    { id: 'pdf-installed', name: 'anthropic-skills', market: 'anthropic', kinds: '4 skills', desc: 'pdf, docx, xlsx and pptx.', installed: true },
  ];

  // .shellby/team.json for this repo
  const team = [
    { id: 't1', kind: 'snippet', name: '/pr', have: true, note: 'Open a PR with a test plan' },
    { id: 't2', kind: 'snippet', name: '/tests', have: true, note: 'Write and run tests for a file' },
    { id: 't3', kind: 'snippet', name: '/triage', have: false, note: 'Sort new issues by area and size' },
    { id: 't4', kind: 'hook', name: 'Keep Claude out of .env and key files', have: true },
    { id: 't5', kind: 'hook', name: 'Don’t let Claude stop while tests fail', have: false },
    { id: 't6', kind: 'rule', name: 'deny Read(./.env*)', have: true },
    { id: 't7', kind: 'mcp', name: 'linear', have: false, note: 'Needs your Linear API key' },
    { id: 't8', kind: 'workflow', name: 'Nightly e2e', have: false, note: 'Runs the e2e suite at 2am and files failures' },
  ];

  // What Claude Code itself carries before any of yours.
  const BASELINE = { label: 'Claude Code itself', tokens: 12600 };
  const WINDOW = 200000;
  const IDLE_DAYS = 21;

  window.TB_DATA = Object.freeze({ items, memory, hooks, rules, recipes, crew, market, team, BASELINE, WINDOW, IDLE_DAYS });
})();
