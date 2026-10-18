// Skins are JSON pixel grids. Built-ins ship in src/skins; users can drop their
// own into %APPDATA%/Shellby/skins, or paint them in the Painter. Everything is
// validated before it reaches the renderer.
const fs = require('fs');
const path = require('path');

const BUILTIN_DIR = path.join(__dirname, '..', 'skins');
const PARTS = new Set(['shell', 'body', 'claw', 'eyes', 'stalks', 'legs', 'extra']);
const HEX = /^#[0-9a-f]{6}$/i;
// The strict rules match docs/addon.schema.json's skin (test/skins-strict.test.js
// keeps the two in step): what a skin needs for the gallery's Pack check to take it.
const ITEM_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PACK_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const ANCHORS = ['head', 'face', 'neck', 'claw', 'shellTop'];
const FIELDS = new Set(['id', 'name', 'author', 'description', 'palette', 'parts', 'pixels', 'unlock', 'anchors', 'basedOn']);
const LIMITS = Object.freeze({ rows: 32, cols: 40, palette: 32, name: 40, author: 40, description: 120, anchorMin: -16, anchorMax: 48 });
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const q = v => JSON.stringify(v);

// [x, y] whole numbers in the validator's range, or null.
const anchorPoint = v => (Array.isArray(v) && v.length === 2 && v.every(n => Number.isInteger(n) && n >= LIMITS.anchorMin && n <= LIMITS.anchorMax) ? [v[0], v[1]] : null);

// What docs/addon.schema.json refuses that the lenient path lets through or cleans up.
function strictErrors(skin) {
  const errors = [];
  for (const k of Object.keys(skin)) if (!FIELDS.has(k)) errors.push(`unknown field ${q(k)}`);
  if (typeof skin.id !== 'string' || !ITEM_ID.test(skin.id)) errors.push('id must be 1–40 lowercase letters, digits and dashes');
  for (const k of ['name', 'author', 'description']) {
    if (skin[k] !== undefined && (typeof skin[k] !== 'string' || skin[k].length > LIMITS[k])) errors.push(`${k} must be text of at most ${LIMITS[k]} characters`);
  }
  if (!Array.isArray(skin.pixels) || skin.pixels.some(r => typeof r !== 'string')) errors.push('pixels must be rows of text');
  if (!isObj(skin.palette)) errors.push('palette must be an object');
  else {
    const keys = Object.keys(skin.palette);
    if (!keys.length) errors.push('palette needs at least one colour');
    if (keys.length > LIMITS.palette) errors.push(`palette has more than ${LIMITS.palette} colours`);
    if (keys.includes('.')) errors.push('"." is see-through, so it can\'t be a colour');
  }
  if (skin.parts !== undefined && !isObj(skin.parts)) errors.push('parts must be an object');
  for (const [ch, part] of Object.entries(isObj(skin.parts) ? skin.parts : {})) {
    if (ch.length !== 1) errors.push(`bad parts key ${q(ch)}`);
    else if (!PARTS.has(part)) errors.push(`unknown part ${q(part)} for ${q(ch)}`);
  }
  if (skin.anchors !== undefined) {
    if (!isObj(skin.anchors)) errors.push('anchors must be an object');
    else for (const [k, v] of Object.entries(skin.anchors)) {
      if (!ANCHORS.includes(k)) errors.push(`unknown anchor ${q(k)}`);
      else if (!anchorPoint(v)) errors.push(`anchor ${k} must be [x, y] whole numbers in ${LIMITS.anchorMin}..${LIMITS.anchorMax}`);
    }
  }
  if (skin.unlock !== undefined && (!isObj(skin.unlock) || Object.keys(skin.unlock).length !== 1)) errors.push('unlock must be an object with one way to earn it');
  if (skin.basedOn !== undefined && (typeof skin.basedOn !== 'string' || !PACK_ID.test(skin.basedOn))) errors.push('basedOn must be a pack id');
  return errors;
}

/**
 * Check a skin and return the clean copy the renderer gets.
 *   validate(skin, fallbackId)  or  validate(skin, { fallbackId, strict })
 * Lenient (skins dropped in the folder by hand, and pack skins): a bad palette
 * entry or grid is an error, anything else is cleaned up quietly (unknown
 * parts dropped, long text cut), so nobody's existing skin breaks. Strict (the
 * Painter, and anything that will be shared): whatever docs/addon.schema.json
 * refuses is an error too, so a skin that passes is one the gallery accepts.
 * -> { skin, errors: [] } | { errors: [string] }
 */
function validate(skin, opts) {
  const { fallbackId, strict = false } = isObj(opts) ? opts : { fallbackId: opts };
  if (!isObj(skin)) return { errors: ['not an object'] };
  const errors = strict ? strictErrors(skin) : [];
  const pixels = Array.isArray(skin.pixels) ? skin.pixels.filter(r => typeof r === 'string') : [];
  if (!pixels.length || pixels.length > LIMITS.rows) errors.push(`pixels must be 1–${LIMITS.rows} rows of strings`);
  if (pixels.some(r => r.length > LIMITS.cols)) errors.push(`rows must be at most ${LIMITS.cols} characters`);
  const palette = {};
  for (const [ch, color] of Object.entries(isObj(skin.palette) ? skin.palette : {})) {
    if (ch.length === 1 && HEX.test(color)) palette[ch] = color;
    else errors.push(`bad palette entry ${q(ch)}`);
  }
  const parts = {};
  for (const [ch, part] of Object.entries(isObj(skin.parts) ? skin.parts : {})) {
    if (ch.length === 1 && PARTS.has(part)) parts[ch] = part;
  }
  const id = String(skin.id || fallbackId || '').replace(/[^\w-]/g, '').slice(0, 40);
  if (!id) errors.push('missing id');
  if (errors.length) return { errors: [...new Set(errors)] };
  // Where his head, face, neck, claw tip and shell top are on a shape that
  // isn't classic's: the good ones kept, sprite.js uses the defaults for the rest.
  const anchors = {};
  for (const k of ANCHORS) {
    const pt = isObj(skin.anchors) ? anchorPoint(skin.anchors[k]) : null;
    if (pt) anchors[k] = pt;
  }
  return {
    skin: {
      id, pixels, palette, parts,
      name: String(skin.name || id).slice(0, LIMITS.name),
      author: String(skin.author || 'unknown').slice(0, LIMITS.author),
      description: String(skin.description || '').slice(0, LIMITS.description),
      ...(Object.keys(anchors).length ? { anchors } : {}),
      // Painted from a gallery skin: CC BY 4.0 asks for the credit (docs/SKINS.md).
      ...(typeof skin.basedOn === 'string' && PACK_ID.test(skin.basedOn) ? { basedOn: skin.basedOn } : {}),
    },
    errors: [],
  };
}

function loadDir(dir, source) {
  let files;
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const f of files) {
    try {
      const { skin, errors } = validate(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), path.basename(f, '.json'));
      if (skin) out.push({ ...skin, source });
      else console.warn(`[shellby] skipped skin ${f}: ${errors.join('; ')}`);
    } catch (e) {
      console.warn(`[shellby] skipped skin ${f}: ${e.message}`);
    }
  }
  return out;
}

function loadSkins(userDir) {
  const byId = new Map();
  for (const s of loadDir(BUILTIN_DIR, 'builtin')) byId.set(s.id, s);
  for (const s of loadDir(userDir, 'user')) byId.set(s.id, s);
  return [...byId.values()];
}

/**
 * Write a skin (already strictly validated) to `${dir}/${id}.json`: to a
 * temporary file first, then renamed over, so a crash never leaves half a
 * skin. Refuses an id that would land outside the folder. -> the path written.
 */
function saveSkin(dir, skin) {
  if (typeof skin?.id !== 'string' || !/^[\w-]{1,40}$/.test(skin.id)) throw new Error('bad skin id');
  const root = path.resolve(dir);
  const dest = path.join(root, `${skin.id}.json`);
  if (path.dirname(dest) !== root) throw new Error('bad skin id');
  fs.mkdirSync(root, { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(skin, null, 2)}\n`);
  fs.renameSync(tmp, dest);
  return dest;
}

module.exports = { loadSkins, validate, saveSkin, BUILTIN_DIR, PARTS, ANCHORS, LIMITS };
