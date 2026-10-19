// Rule files written for a language or framework this project doesn't use: a
// rules/react/ folder in ~/.claude loads into every conversation, in a plain
// JS app with no React too. Read from the rule's own path (the folder it sits
// in names what it's for) and a few files at the project's root that say what
// it's built with. Only a folder named for something Shellby knows how to
// spot counts, so a rule it can't place is never called a misfit.
//
// Pure apart from projectSignals, which reads the root (test/rulefit.test.js).
const fs = require('fs');
const path = require('path');

// What each kind of rule folder is for, and what in a project shows it's there:
// files at the root (a name, or a pattern for one) or a package.json dependency.
const KINDS = {
  typescript: { files: ['tsconfig.json'], deps: ['typescript'] },
  react: { deps: ['react', 'react-native', 'next'] },
  nextjs: { deps: ['next'] },
  vue: { deps: ['vue', 'nuxt'] },
  angular: { files: ['angular.json'], deps: ['@angular/core'] },
  svelte: { deps: ['svelte'] },
  python: { files: ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'] },
  django: { files: ['manage.py'] },
  go: { files: ['go.mod'] },
  golang: { files: ['go.mod'] },
  rust: { files: ['Cargo.toml'] },
  java: { files: ['pom.xml', 'build.gradle', 'build.gradle.kts'] },
  kotlin: { files: ['build.gradle.kts'] },
  csharp: { files: [/\.(csproj|sln)$/i] },
  dotnet: { files: [/\.(csproj|sln|fsproj)$/i] },
  ruby: { files: ['Gemfile'] },
  rails: { files: ['Gemfile'] },
  php: { files: ['composer.json'] },
  laravel: { files: ['artisan'] },
  swift: { files: ['Package.swift', /\.xcodeproj$/i] },
  cpp: { files: ['CMakeLists.txt'] },
};

/** The kind a rule file's folder names ('react' for ~/.claude/rules/ecc/react/hooks.md), or null. */
function kindOf(file) {
  if (typeof file !== 'string') return null;
  const parts = file.split(/[\\/]/).map(p => p.toLowerCase());
  const at = parts.lastIndexOf('rules');
  if (at < 0) return null;
  const folders = parts.slice(at + 1, -1);
  for (let i = folders.length - 1; i >= 0; i--) if (Object.hasOwn(KINDS, folders[i])) return folders[i];
  return null;
}

/**
 * What the project at its root shows it's built with: { files, deps } as
 * lowercased names. Unreadable bits are left out.
 */
function projectSignals(root) {
  let files = [];
  try { files = fs.readdirSync(root); } catch { /* nothing to go on */ }
  let deps = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    deps = ['dependencies', 'devDependencies', 'peerDependencies'].flatMap(k => Object.keys(pkg?.[k] || {}));
  } catch { /* no package.json, or not JSON */ }
  return { files, deps: deps.map(d => d.toLowerCase()) };
}

/** Does the project show this kind? */
function uses(kind, { files = [], deps = [] } = {}) {
  const k = KINDS[kind];
  const fileHit = (k.files || []).some(f => files.some(n => (typeof f === 'string' ? n.toLowerCase() === f.toLowerCase() : f.test(n))));
  return fileHit || (k.deps || []).some(d => deps.includes(d));
}

/**
 * The kind a rule is for when this project shows none of it, else null.
 * signals: projectSignals'. With nothing to go on (no files read), nothing is a misfit.
 */
function misfit(file, signals) {
  const kind = kindOf(file);
  if (!kind || !signals?.files?.length) return null;
  return uses(kind, signals) ? null : kind;
}

module.exports = { kindOf, projectSignals, uses, misfit, KINDS };
