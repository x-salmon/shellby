// Every ipcMain.handle/on in src/main, read from the code rather than from a
// running app: which channel, whether its handler takes arguments from the
// renderer, and whether those arguments have a schema (ipc-args.js) in front of
// them. test/ipc-args.test.js holds the list of ones without.
const fs = require('fs');
const path = require('path');
const espree = require('espree');

const METHODS = new Set(['handle', 'on']);
const isFn = n => n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression';

/** The first parameter is Electron's event; anything after it came from a renderer. A named function may take anything. */
function takesArgs(fn) {
  if (!isFn(fn)) return true;
  return fn.params.length > 1 || fn.params[0]?.type === 'RestElement';
}

function isRegistration(n) {
  return n.type === 'CallExpression'
    && n.callee.type === 'MemberExpression'
    && n.callee.object.type === 'Identifier' && n.callee.object.name === 'ipcMain'
    && !n.callee.computed && METHODS.has(n.callee.property.name)
    && n.arguments.length >= 2;
}

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

/** The registrations in one file's source. */
function scanSource(source, file) {
  const ast = espree.parse(source, { ecmaVersion: 'latest', sourceType: 'commonjs', range: true });
  const found = [];
  walk(ast, n => {
    if (!isRegistration(n)) return;
    const [channel, fn, schema] = n.arguments;
    found.push({
      file,
      channel: channel.type === 'Literal' ? channel.value : null,
      takesArgs: takesArgs(fn),
      // An empty list or a variable could check nothing, so only a written-out list counts.
      hasSchema: schema?.type === 'ArrayExpression' && schema.elements.length > 0,
      source: source.slice(...fn.range),
    });
  });
  return found;
}

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

/** Every registration under src/main, in a stable order. */
function scanMain(root) {
  const main = path.join(root, 'src', 'main');
  return jsFiles(main)
    .flatMap(file => {
      const source = fs.readFileSync(file, 'utf8');
      if (!/ipcMain\.(handle|on)\(/.test(source)) return [];
      return scanSource(source, path.relative(root, file).replaceAll('\\', '/'));
    })
    .sort((a, b) => String(a.channel).localeCompare(String(b.channel)));
}

module.exports = { scanSource, scanMain };
