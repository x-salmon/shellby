// Draws the phone app's icons (assets/pocket/) from the Classic skin's own
// pixel grid: the Home Screen icon, Android's maskable one, and the
// one-colour badge Android shows in the status bar. No image library: a PNG
// is a few zlib'd rows and three CRCs.
//
//   node scripts/pocket-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'pocket');
const skin = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'skins', 'classic.json'), 'utf8'));

const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const ABYSS = hex('#071012');
const REEF = hex('#11232a');

// CRC-32, as PNG wants it.
const TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const grid = skin.pixels;
const cols = Math.max(...grid.map(r => r.length));
const rows = grid.length;
const colourAt = (gx, gy) => {
  const ch = (grid[gy] || '')[gx];
  const c = ch && skin.palette[ch];
  return c && /^#[0-9a-f]{6}$/i.test(c) ? hex(c) : null;
};

/**
 * One icon: the crab centred at `fill` of the width, on the abyss with a soft
 * reef glow, or (badge) white on nothing.
 */
function icon(size, { fill = 0.72, badge = false, round = false } = {}) {
  const scale = Math.floor((size * fill) / cols);
  const w = cols * scale, hgt = rows * scale;
  const ox = Math.floor((size - w) / 2), oy = Math.floor((size - hgt) / 2) + Math.round(scale * 0.5);
  return png(size, (x, y) => {
    const gx = Math.floor((x - ox) / scale), gy = Math.floor((y - oy) / scale);
    const c = x >= ox && y >= oy && gx < cols && gy < rows ? colourAt(gx, gy) : null;
    if (badge) return c ? [255, 255, 255, 255] : [0, 0, 0, 0];
    if (c) return [...c, 255];
    // A glow behind him, brightest just above centre.
    const dx = (x - size / 2) / size, dy = (y - size * 0.45) / size;
    const t = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 2.1);
    const bg = ABYSS.map((v, i) => Math.round(v + (REEF[i] - v) * t * 1.2));
    if (round) {
      const r = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5);
      if (r > size / 2) return [0, 0, 0, 0];
    }
    return [...bg, 255];
  });
}

fs.mkdirSync(OUT, { recursive: true });
const files = {
  'icon-180.png': icon(180, { fill: 0.74 }),
  'icon-192.png': icon(192, { fill: 0.74 }),
  'icon-512.png': icon(512, { fill: 0.74 }),
  // Android crops a maskable icon to a circle or squircle: he stays in the middle 60%.
  'icon-maskable-512.png': icon(512, { fill: 0.58 }),
  'badge-96.png': icon(96, { fill: 0.86, badge: true }),
};
for (const [name, data] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), data);
  console.log(`${name}: ${data.length} bytes`);
}
