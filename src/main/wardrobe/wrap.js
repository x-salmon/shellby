// One thing you painted, wrapped in a pack of its own, so it can go to the
// community gallery the way any pack does (github/publish.js). Pure: the
// Painter's Share (wiring/painter.js) installs and publishes what this makes.
//
// A pack is named for what's in it: skin-<id>, acc-<id>, fx-<id> or decor-<id>.
// Its version is 1.0.0 the first time, then the gallery's version with the
// patch number raised, so sharing again after a change is an update, not a clash.
const { VERSION_RE, PACK_ID_RE, CONTEST_RE, MAX_FILE_BYTES } = require('./catalog');
const { validate: validateSkin } = require('../skins');
const { mdText, titleText } = require('../github/publish');

const KINDS = {
  skin: { field: 'skins', prefix: 'skin' },
  accessory: { field: 'accessories', prefix: 'acc' },
  effect: { field: 'effects', prefix: 'fx' },
  decor: { field: 'decor', prefix: 'decor' },
};

const GALLERY_REPO = 'x-salmon/shellby';
const DISCUSSIONS = `https://github.com/${GALLERY_REPO}/discussions/new`;

/** The pack id a thing of this kind and id goes out as, or null if it can't be one. */
function packIdFor(kind, id) {
  const k = KINDS[kind];
  if (!k || typeof id !== 'string') return null;
  const pid = `${k.prefix}-${id}`.slice(0, 40).replace(/-+$/, '');
  return PACK_ID_RE.test(pid) ? pid : null;
}

/** The next version after the gallery's: 1.0.0 when there isn't one, else the patch raised. */
function nextVersion(prev) {
  const v = typeof prev?.version === 'string' && VERSION_RE.test(prev.version) ? prev.version : null;
  if (!v) return '1.0.0';
  const [a, b, c] = v.split('.').map(Number);
  return `${a}.${b}.${c + 1}`;
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const pick = (o, keys) => Object.fromEntries(keys.filter(k => isObj(o) && o[k] !== undefined).map(k => [k, o[k]]));

// The fields an item of each kind may carry: what catalog.js validatePack reads,
// and nothing else, so a panel's extra fields never reach the disk or the gallery.
const ITEM_FIELDS = {
  accessory: ['id', 'name', 'description', 'rarity', 'slot', 'anchor', 'follows', 'pivot', 'palette', 'pixels', 'unlock'],
  effect: ['id', 'name', 'description', 'rarity', 'motion', 'count', 'speed', 'ink', 'fps', 'sprites', 'unlock'],
  decor: ['id', 'name', 'description', 'rarity', 'category', 'layer', 'palette', 'pixels', 'frames', 'fps', 'spots', 'unlock'],
};

/** One item trimmed to its kind's fields (a skin to what skins.js keeps), or null. */
function itemFields(kind, item) {
  if (!isObj(item)) return null;
  if (kind === 'skin') {
    const { skin } = validateSkin(item);
    if (!skin) return null;
    const { description, ...rest } = skin;
    return { ...rest, id: item.id, ...(description ? { description } : {}), ...(item.unlock !== undefined ? { unlock: item.unlock } : {}) };
  }
  if (!ITEM_FIELDS[kind]) return null;
  const out = pick(item, ITEM_FIELDS[kind]);
  if (Array.isArray(out.sprites)) out.sprites = out.sprites.map(sp => pick(sp, ['palette', 'pixels', 'frames']));
  if (Array.isArray(out.spots)) out.spots = out.spots.map(sp => pick(sp, ['kind', 'at']));
  return out;
}

/**
 * Wrap one item in a pack.
 *   kind: 'skin' | 'accessory' | 'effect' | 'decor'
 *   item: the skin (as skins.js saves it) or the pack item (pixel-grid toItem)
 *   opts: { login: the GitHub login, the author when the item has none;
 *           prev: the registry's entry for this pack id, if it's been shared before;
 *           contest: 'YYYY-MM' to enter that month's crab contest }
 * -> the pack JSON, or null for a kind this doesn't wrap.
 */
function wrapItem(kind, item, { login = '', prev = null, contest = null } = {}) {
  const k = KINDS[kind];
  const id = packIdFor(kind, item?.id);
  if (!k || !id) return null;
  const name = text(item.name, 60) || item.id;
  const author = text(item.author, 60) || text(login, 60) || 'unknown';
  const description = text(item.description, 240);
  const entry = itemFields(kind, item);
  if (!entry) return null;
  if (kind === 'skin') {
    entry.name = text(item.name, 40) || item.id;
    entry.author = author.slice(0, 40);
    if (!entry.description) delete entry.description;
  } else {
    delete entry.author;
  }
  return {
    format: 1,
    id, name, author,
    ...(description ? { description } : {}),
    version: nextVersion(prev),
    ...(typeof contest === 'string' && CONTEST_RE.test(contest) ? { contest } : {}),
    [k.field]: [entry],
  };
}

/**
 * A wrap as it's written and published: the pack's own fields and its one
 * item's, nothing more (wrapItem's shape, checked again whoever built it), and
 * no bigger than a pack may be. -> { pack, text } | { error }
 */
function packFile(pack) {
  const k = isObj(pack) && Object.values(KINDS).find(x => Array.isArray(pack[x.field]));
  const kind = k && Object.keys(KINDS).find(n => KINDS[n] === k);
  const item = kind && pack[k.field].length === 1 ? itemFields(kind, pack[k.field][0]) : null;
  if (!item) return { error: 'it isn’t one thing wrapped as a pack' };
  const out = {
    format: pack.format, id: pack.id, name: pack.name, author: pack.author,
    ...(pack.description ? { description: pack.description } : {}),
    version: pack.version,
    ...(pack.contest ? { contest: pack.contest } : {}),
    [k.field]: [item],
  };
  const body = JSON.stringify(out, null, 2);
  if (Buffer.byteLength(body) > MAX_FILE_BYTES) return { error: `it’s too big for a pack (${MAX_FILE_BYTES / 1024} KB at most)` };
  return { pack: out, text: body };
}

/** wrapItem for a skin: the helper Share uses (docs/plans/crab-painter.md §5). */
const wrapSkin = (skin, opts) => wrapItem('skin', skin, opts);

/**
 * The prefilled "new discussion" link for a contest entry. GitHub fills the
 * category, title and body from the URL; the entrant adds the card and posts
 * it themselves, as their own account. Shellby never posts to Discussions.
 */
function contestEntryUrl({ name, packId, month, prUrl }) {
  const body = [
    `My entry for the ${month} crab contest: **${mdText(name)}**.`,
    '',
    `Pull request: ${prUrl}`,
    `Add it to Shellby once it's in the gallery: shellby://install?pack=${packId}`,
    '',
    '<!-- A line about it, and drop the picture from 📸 Card here. -->',
  ].join('\n');
  const q = new URLSearchParams({ category: 'contest-entries', title: titleText(name), body });
  return `${DISCUSSIONS}?${q.toString()}`;
}

/** The line a pull request carries for a pack made from a wish: "For x-salmon/shellby#12". */
const wishLine = number => (Number.isInteger(number) && number > 0 ? `For ${GALLERY_REPO}#${number}` : '');

module.exports = { KINDS, GALLERY_REPO, packIdFor, nextVersion, wrapItem, wrapSkin, packFile, contestEntryUrl, wishLine };
