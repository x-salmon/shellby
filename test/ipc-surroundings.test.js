// The surroundings' IPC (src/main/ipc/surroundings.js): links only open over
// https, the crab card is checked to be a PNG before it's saved, and only the
// card main saved itself is shown in Explorer.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installFakeElectron, createFakeIpc, fakeConfig, recorder, isStr } = require('./helpers/fake-ipc');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-surroundings-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const electron = installFakeElectron({ userData: path.join(root, 'userData'), pictures: path.join(root, 'Pictures') });
const { registerSurroundingsIpc, MAX_COPY_CHARS, CARD_KINDS, CLIP_MAX_BYTES } = require('../src/main/ipc/surroundings');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CARD_MAX_BYTES = 64;
const png = (extra = 8) => new Uint8Array(Buffer.concat([PNG_SIGNATURE, Buffer.alloc(extra, 1)]));

function setup(extra = {}, initial = {}) {
  const ipc = createFakeIpc();
  const config = fakeConfig(initial);
  const rec = recorder();
  const d = {
    config, isStr, PNG_SIGNATURE, CARD_MAX_BYTES,
    log: { warn: rec.fn('log.warn') },
    stat: rec.fn('stat'),
    questDone: rec.fn('questDone'),
    health: {
      view: () => ({ view: true }),
      setSettings: rec.fn('health.setSettings', p => p),
      ask: rec.fn('health.ask', () => ({ ok: true })),
      endTask: rec.fn('health.endTask', pid => ({ pid })),
      endGroup: rec.fn('health.endGroup', name => ({ name })),
      hogs: rec.fn('health.hogs', m => ({ m })),
      setStartup: rec.fn('health.setStartup', (id, off) => ({ id, off })),
    },
    obsSettings: () => config.get('obs') || { enabled: false, port: 4455 },
    obsView: () => ({ obs: config.get('obs') }),
    obsServer: { port: 0, start: rec.fn('obs.start'), stop: rec.fn('obs.stop') },
    weatherSvc: { set: rec.fn('weather.set'), search: rec.fn('weather.search', q => q) },
    weatherView: () => ({}),
    broadcastWardrobe: rec.fn('broadcastWardrobe'),
    typingSettings: () => ({ enabled: false, remarks: true }),
    typing: { sync: rec.fn('typing.sync'), view: () => config.get('typing') },
    presenceSettings: () => ({ enabled: config.get('discord')?.enabled === true, task: config.get('discord')?.task === true }),
    presenceView: () => ({ discord: config.get('discord') }),
    presence: { start: rec.fn('presence.start'), stop: rec.fn('presence.stop') },
    updatePresence: rec.fn('updatePresence'),
    ...extra,
  };
  registerSurroundingsIpc(ipc.ipcMain, d);
  return { ipc, config, rec };
}

const opened = () => electron.callsOf('shell.openExternal').map(([url]) => url);
const revealed = () => electron.callsOf('shell.showItemInFolder').map(([p]) => p);

test('open-external opens an https link', () => {
  const { ipc } = setup();
  const before = opened().length;

  ipc.send('open-external', 'https://github.com/x-salmon/shellby');

  assert.deepEqual(opened().slice(before), ['https://github.com/x-salmon/shellby']);
});

test('open-external ignores anything that is not https', () => {
  const { ipc } = setup();
  const before = opened().length;

  for (const url of ['http://example.com', 'file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)',
    'ms-settings:privacy', 'smb://server/share', 'not a url', '', null, 42, { href: 'https://x.y' }]) {
    ipc.send('open-external', url);
  }

  assert.deepEqual(opened().slice(before), []);
});

test('open-external sent from the crab window is dropped by the guard', () => {
  const { ipc } = setup();
  const before = opened().length;

  ipc.sendAs(ipc.senders.critter, 'open-external', 'https://example.com');

  assert.deepEqual(opened().slice(before), []);
  assert.deepEqual(ipc.refused, ['open-external']);
});

test('clipboard:text copies a string, long prompts included, and nothing else', () => {
  const { ipc } = setup();
  const before = electron.callsOf('clipboard.writeText').length;
  const longPrompt = 'x'.repeat(50000);

  ipc.send('clipboard:text', 'hello');
  ipc.send('clipboard:text', longPrompt);
  ipc.send('clipboard:text', 'x'.repeat(MAX_COPY_CHARS + 1));
  ipc.send('clipboard:text', { text: 'hi' });
  ipc.send('clipboard:text', '');

  assert.deepEqual(electron.callsOf('clipboard.writeText').slice(before), [['hello'], [longPrompt]]);
});

test('card:save refuses bytes that are not a PNG, too big, or not bytes at all', async () => {
  const { ipc } = setup();

  for (const bad of [new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), png(CARD_MAX_BYTES), 'iVBORw0KGgo=', [137, 80, 78, 71], null, PNG_SIGNATURE.buffer]) {
    const r = await ipc.invoke('card:save', bad, 'card');
    assert.equal(r.ok, false, String(bad));
  }
});

test('card:save writes the PNG under Pictures/Shellby, copies it, and card:reveal shows that file', async () => {
  const { ipc, rec } = setup();
  const writesBefore = electron.callsOf('clipboard.write').length;

  const r = await ipc.invoke('card:save', png(), 'week');

  assert.equal(r.ok, true);
  assert.equal(r.copied, true);
  assert.match(r.name, /^Pictures[\\/]Shellby[\\/]shellby-week-\d{8}-\d{6}\.png$/);
  const saved = path.join(root, 'Pictures', 'Shellby', path.basename(r.name));
  assert.deepEqual([...fs.readFileSync(saved)], [...png()]);
  const [items] = electron.callsOf('clipboard.write').slice(writesBefore)[0];
  assert.deepEqual(items[0].types, ['image/png'], 'copied as a PNG ClipboardItem (Electron 44 clipboard)');
  assert.deepEqual(rec.of('stat'), [['card-shared'], ['card-shared:week']]);

  ipc.send('card:reveal');
  assert.equal(revealed().at(-1), saved);
});

test('card:save names an unknown kind "card" rather than putting the renderer\'s text in the path', async () => {
  const { ipc } = setup();

  const r = await ipc.invoke('card:save', png(), '..\\..\\evil');

  assert.match(path.basename(r.name), /^shellby-card-/);
});

test('card:save names each card after its kind, and the tank card finishes "Share the tank"', async () => {
  const { ipc, rec } = setup();

  for (const kind of CARD_KINDS) {
    const r = await ipc.invoke('card:save', png(), kind);
    assert.match(path.basename(r.name), new RegExp(`^shellby-${kind}-\\d{8}-\\d{6}\\.png$`), kind);
  }
  assert.deepEqual(rec.of('questDone'), [['tank-share']]);
});

test('card:save puts a square card\'s size in its name, and the same card again in another size isn\'t another share', async () => {
  const { ipc, rec } = setup();

  const wide = await ipc.invoke('card:save', png(), 'trophy', { size: 'wide' });
  const square = await ipc.invoke('card:save', png(), 'trophy', { size: 'square', again: true });
  const odd = await ipc.invoke('card:save', png(), 'trophy', { size: '../../x' });

  assert.match(path.basename(wide.name), /^shellby-trophy-\d{8}-\d{6}\.png$/);
  assert.match(path.basename(square.name), /^shellby-trophy-square-\d{8}-\d{6}\.png$/);
  assert.match(path.basename(odd.name), /^shellby-trophy-\d{8}-\d{6}\.png$/, 'an unknown size is just wide');
  assert.deepEqual(rec.of('stat'), [['card-shared'], ['card-shared:trophy'], ['card-shared'], ['card-shared:trophy']]);
});

// ---- a moment's clip: MP4 or WebM, checked by its magic number and size, never on the clipboard
const mp4 = (n = 64) => new Uint8Array(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(n, 2)]));
const webm = (n = 64) => new Uint8Array(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(n, 3)]));

test('card:save keeps a clip as the container it is, and never puts it on the clipboard', async () => {
  const { ipc } = setup();
  const writesBefore = electron.callsOf('clipboard.write').length;

  const a = await ipc.invoke('card:save', mp4(), 'shiny', { video: 'mp4', again: true });
  const b = await ipc.invoke('card:save', webm(), 'molt', { video: 'webm', size: 'square', again: true });

  assert.equal(a.ok, true);
  assert.equal(a.video, true);
  assert.equal(a.copied, undefined, 'not copied, not "couldn\'t copy" either');
  assert.match(path.basename(a.name), /^shellby-shiny-\d{8}-\d{6}\.mp4$/);
  assert.match(path.basename(b.name), /^shellby-molt-square-\d{8}-\d{6}\.webm$/);
  assert.deepEqual([...fs.readFileSync(b.path)], [...webm()]);
  assert.equal(electron.callsOf('clipboard.write').length, writesBefore);
});

test('card:save refuses a clip that isn\'t the container it says, or is too big', async () => {
  const { ipc } = setup();
  for (const [bytes, video] of [[webm(), 'mp4'], [mp4(), 'webm'], [png(), 'mp4'], [mp4(CLIP_MAX_BYTES), 'mp4'], [new Uint8Array(8), 'webm'], ['ftyp', 'mp4']]) {
    const r = await ipc.invoke('card:save', bytes, 'shiny', { video });
    assert.equal(r.ok, false, `${video}: ${bytes.length}`);
  }
  // A video type it doesn't know is a picture, and an MP4 isn't one.
  assert.equal((await ipc.invoke('card:save', mp4(), 'shiny', { video: 'gif' })).ok, false);
});

// ---- Post to Discord: the webhook your notifications use, a saved card, never a ping.
const WEBHOOK = 'https://discord.com/api/webhooks/123/abc-token';
const DISCORD = { channels: { provider: 'discord', target: WEBHOOK, enabled: true } };
// A fake fetch: the webhook's own GET answers with its name; a POST answers `post`.
function fakeDiscord(post = { ok: true, status: 200 }) {
  const sent = [];
  const fetchImpl = async (url, opts = {}) => {
    if (!opts.method) return { ok: true, json: async () => ({ name: 'shellby-wins' }) };
    sent.push({ url, opts });
    return { ok: post.ok, status: post.status, headers: { get: () => null }, text: async () => post.body || '' };
  };
  return { sent, fetchImpl };
}

test('card:save offers Post to Discord only when a Discord webhook is set up', async () => {
  assert.equal((await setup().ipc.invoke('card:save', png(), 'crab')).discord, false);
  assert.equal((await setup({}, { channels: { provider: 'ntfy', target: 'shellby-abc' } }).ipc.invoke('card:save', png(), 'crab')).discord, false);
  const r = await setup({}, DISCORD).ipc.invoke('card:save', png(), 'crab');
  assert.equal(r.discord, true);
  assert.equal(path.dirname(r.path), path.join(root, 'Pictures', 'Shellby'), 'and says where the card is, for the post');
});

test('card:post-discord sends only a card Shellby saved, from Pictures/Shellby', async () => {
  const net = fakeDiscord();
  const { ipc, rec } = setup({ fetchImpl: net.fetchImpl, askOnce: async () => 0 }, DISCORD);
  const saved = await ipc.invoke('card:save', png(), 'trophy');
  const outside = path.join(root, 'shellby-trophy-20260101-120000.png');
  fs.writeFileSync(outside, Buffer.from(png()));
  const notACard = path.join(root, 'Pictures', 'Shellby', 'notes.png');
  fs.writeFileSync(notACard, Buffer.from(png()));

  for (const bad of [outside, notACard, path.join(path.dirname(saved.path), '..', '..', 'shellby-trophy-20260101-120000.png'),
    path.join(path.dirname(saved.path), 'shellby-trophy-19990101-000000.png'), 'C:\\Windows\\win.ini', '', null, 42, { path: saved.path }]) {
    const r = await ipc.invoke('card:post-discord', bad, 'hi');
    assert.equal(r.ok, false, String(bad));
  }
  assert.equal(net.sent.length, 0, 'nothing went anywhere');
  assert.deepEqual(rec.of('log.warn'), []);
});

test('card:post-discord uploads the file with its words and no mentions, and asks once per webhook', async () => {
  const net = fakeDiscord();
  const asked = [];
  const { ipc, config } = setup({ fetchImpl: net.fetchImpl, askOnce: async spec => { asked.push(spec); return 0; } }, DISCORD);
  const saved = await ipc.invoke('card:save', png(), 'molt', { size: 'square' });

  assert.deepEqual(await ipc.invoke('card:post-discord', saved.path, '🐚 Shellby just molted @everyone #Shellby'), { ok: true });
  assert.deepEqual(await ipc.invoke('card:post-discord', saved.path, 'again'), { ok: true });

  assert.equal(asked.length, 1, 'asked before the first post only');
  assert.match(asked[0].title, /shellby-wins/, 'naming the webhook');
  assert.equal(net.sent.length, 2);
  const { url, opts } = net.sent[0];
  assert.equal(url, `${WEBHOOK}?wait=true`);
  const payload = JSON.parse(opts.body.get('payload_json'));
  assert.deepEqual(payload.allowed_mentions, { parse: [] }, 'never a ping, @everyone or not');
  assert.equal(payload.content, '🐚 Shellby just molted @everyone #Shellby');
  const file = opts.body.get('files[0]');
  assert.equal(file.name, path.basename(saved.path));
  assert.equal(file.type, 'image/png');
  assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [...png()]);
  assert.match(config.get('cardDiscordOk'), /^[0-9a-f]{16}$/, 'the yes is kept, as a hash and not the webhook again');

  // A new webhook asks again.
  config.set({ channels: { ...DISCORD.channels, target: 'https://discord.com/api/webhooks/456/other' } });
  await ipc.invoke('card:post-discord', saved.path, 'x');
  assert.equal(asked.length, 2);
});

test('card:post-discord: Cancel sends nothing, and a webhook\'s error is shown in its own words', async () => {
  const net = fakeDiscord({ ok: false, status: 404, body: '{"message": "Unknown Webhook", "code": 10015}' });
  let answer = 1;
  const { ipc } = setup({ fetchImpl: net.fetchImpl, askOnce: async () => answer }, DISCORD);
  const saved = await ipc.invoke('card:save', png(), 'streak');

  assert.deepEqual(await ipc.invoke('card:post-discord', saved.path, 'x'), { ok: false, canceled: true });
  assert.equal(net.sent.length, 0);

  answer = 0;
  const r = await ipc.invoke('card:post-discord', saved.path, 'x');
  assert.deepEqual(r, { ok: false, error: 'Discord said no: Unknown Webhook.' });

  const quiet = fakeDiscord({ ok: false, status: 429, body: '<html>too many</html>' });
  const again = setup({ fetchImpl: quiet.fetchImpl, askOnce: async () => 0 }, DISCORD);
  const card = await again.ipc.invoke('card:save', png(), 'streak');
  assert.equal((await again.ipc.invoke('card:post-discord', card.path, 'x')).error, 'Discord said too many, too fast.');
});

test('card:post-discord uploads a clip as a video', async () => {
  const net = fakeDiscord();
  const { ipc } = setup({ fetchImpl: net.fetchImpl, askOnce: async () => 0 }, DISCORD);
  const saved = await ipc.invoke('card:save', mp4(), 'molt', { video: 'mp4', again: true });
  assert.deepEqual(await ipc.invoke('card:post-discord', saved.path, 'x'), { ok: true });
  assert.equal(net.sent[0].opts.body.get('files[0]').type, 'video/mp4');
});

test('card:post-discord with no Discord webhook says where to set one up', async () => {
  const { ipc } = setup({ askOnce: async () => 0 });
  const saved = await ipc.invoke('card:save', png(), 'crab');
  assert.match((await ipc.invoke('card:post-discord', saved.path, 'x')).error, /Settings → Connections/);
});

test('every moment card has a file name of its own (moment-card.js MOMENT_KINDS)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'panel', 'moment-card.js'), 'utf8');
  const moments = JSON.parse(/const MOMENT_KINDS = Object\.freeze\((\[[^\]]+\])\)/.exec(src)[1].replace(/'/g, '"'));
  assert.ok(moments.length > 4);
  for (const kind of moments) assert.ok(CARD_KINDS.includes(kind), kind);
  for (const kind of ['crab', 'tank', 'week', 'wrapped', 'beach']) assert.ok(CARD_KINDS.includes(kind), kind);
});

test('card:save still reports the save when the clipboard is busy', async () => {
  const { ipc, rec } = setup();
  const realWrite = electron.clipboard.write;
  electron.clipboard.write = async () => { throw new Error('clipboard locked'); };
  try {
    const r = await ipc.invoke('card:save', png(), 'beach');

    assert.equal(r.ok, true);
    assert.equal(r.copied, false);
    assert.equal(rec.of('log.warn').length, 1);
  } finally { electron.clipboard.write = realWrite; }
});

test('card:reveal shows nothing before a card was saved, whatever it is sent', () => {
  const { ipc } = setup();
  const before = revealed().length;

  ipc.send('card:reveal', 'C:\\Windows\\System32');

  assert.equal(revealed().length, before);
});

test('card:copy is ok only for a real PNG', async () => {
  const { ipc } = setup();

  assert.deepEqual(await ipc.invoke('card:copy', png()), { ok: true });
  assert.deepEqual(await ipc.invoke('card:copy', 'png'), { ok: false });
});

test('health handlers pass on only the types they expect', async () => {
  const { ipc, rec } = setup();

  await ipc.invoke('health:end-task', '1234');
  await ipc.invoke('health:end-task', 1234);
  await ipc.invoke('health:end-group', { name: 'chrome' });
  await ipc.invoke('health:set-startup', 7, 'yes');
  await ipc.invoke('health:set', 'all-off');
  const asked = await ipc.invoke('health:ask', 99);

  assert.deepEqual(rec.of('health.endTask'), [[null], [1234]]);
  assert.deepEqual(rec.of('health.endGroup'), [[null]]);
  assert.deepEqual(rec.of('health.setStartup'), [[null, false]]);
  assert.deepEqual(rec.of('health.setSettings'), [[{}]]);
  assert.deepEqual(asked, { ok: false, error: 'Unknown reading.' });
  assert.deepEqual(rec.of('health.ask'), []);
});

test('obs:set keeps the port to 1024-65535 integers', async () => {
  const { ipc, config } = setup();

  for (const port of [80, 70000, 4455.5, 'abc']) await ipc.invoke('obs:set', { port });
  assert.equal(config.get('obs').port, 4455);

  await ipc.invoke('obs:set', { enabled: 1, port: '8080' });
  assert.deepEqual(config.get('obs'), { enabled: true, port: 8080 });
});

test('typing:set and weather:set ignore a payload that is not an object', async () => {
  const { ipc, config, rec } = setup();

  await ipc.invoke('typing:set', 'enabled');
  await ipc.invoke('weather:set', null);
  await ipc.invoke('weather:search', { q: 'Oslo' });

  assert.deepEqual(config.get('typing'), { enabled: false, remarks: true });
  assert.deepEqual(rec.of('weather.set'), [[{}]]);
  assert.deepEqual(rec.of('weather.search'), [['']]);
});

test('discord:set takes only a real true, and starts and stops on the switch alone', async () => {
  const { ipc, config, rec } = setup();

  await ipc.invoke('discord:set', { enabled: 'yes', task: 1 });
  assert.deepEqual(config.get('discord'), { enabled: false, task: false });
  assert.equal(rec.of('presence.start').length, 0);

  await ipc.invoke('discord:set', { enabled: true });
  await ipc.invoke('discord:set', { task: true });
  assert.deepEqual(config.get('discord'), { enabled: true, task: true });
  assert.equal(rec.of('presence.start').length, 1, 'sharing the task is a repaint, not a reconnect');

  await ipc.invoke('discord:set', 'enabled');
  assert.deepEqual(config.get('discord'), { enabled: true, task: true }, 'a payload that is not an object changes nothing');

  await ipc.invoke('discord:set', { enabled: false });
  assert.equal(rec.of('presence.stop').length, 1);
  assert.equal(rec.of('updatePresence').length, 5, 'every call repaints, even one that changed nothing');
});
