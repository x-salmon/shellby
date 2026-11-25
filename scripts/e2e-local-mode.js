// ci: Local mode: the setup card, a preset, getting a missing model, the fit check and a 32K copy
// End-to-end check of Settings → Claude → Local model's Local mode against the
// dev app over CDP, with a stand-in Ollama on a loopback port (its native
// /api/version, /api/tags, /api/show, /api/pull and /api/create, and the
// OpenAI-compatible /v1/models the model list reads):
//   - running with no models: the setup card recommends models for this PC
//   - Coding with nothing installed names what's missing, each with a Get button
//   - Get streams progress, then the preset picks the model it brought
//   - every model in use gets a fit row; a short context offers Make a 32K copy,
//     which makes <model>-32k and puts it where the original was
//   node scripts/e2e-local-mode.js [screenshotDir]
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { panelBooted } = require('./lib/boot');
const { savePng } = require('./lib/shot');
const { PRESETS } = require('../src/main/local/presets');
const { listenOpen } = require('./lib/open-port');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_CDP_PORT) || 9489;
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-local-mode-'));
const QUICK = PRESETS.coding.quick[0];
const MAIN = PRESETS.coding.main[0];
const GB = 1024 ** 3;
const wait = ms => new Promise(r => setTimeout(r, ms));

/** A stand-in Ollama. `models`: name -> { size, ctx } (ctx null: no num_ctx set). */
function ollama() {
  const models = new Map();
  const asked = [];
  const json = (res, o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      asked.push(`${req.method} ${req.url}`);
      const q = body ? JSON.parse(body) : {};
      if (req.url === '/api/version') return json(res, { version: '0.14.3' });
      if (req.url === '/v1/models') return json(res, { object: 'list', data: [...models.keys()].map(id => ({ id, object: 'model' })) });
      if (req.url === '/api/tags') return json(res, { models: [...models].map(([name, m]) => ({ name, size: m.size })) });
      if (req.url === '/api/show') return json(res, { parameters: models.get(q.model)?.ctx ? `num_ctx ${models.get(q.model).ctx}` : 'temperature 0.7' });
      if (req.url === '/api/create') { models.set(q.model, { ...models.get(q.from), ctx: q.parameters?.num_ctx }); return json(res, { status: 'success' }); }
      if (req.url === '/api/pull') {
        res.setHeader('content-type', 'application/x-ndjson');
        const total = 2 * GB;
        for (const done of [0.25, 0.5, 0.75, 1]) { res.write(JSON.stringify({ status: 'pulling', completed: total * done, total }) + '\n'); await wait(300); }
        models.set(q.model, { size: total, ctx: null });
        res.end(JSON.stringify({ status: 'success' }) + '\n');
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  return listenOpen(server).then(port => ({ server, models, asked, url: `http://127.0.0.1:${port}` }));
}

(async () => {
  let fails = 0;
  const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };
  const fake = await ollama();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-test-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ onboarded: true, notifications: false, localModel: { on: false, url: fake.url, model: '' } }));
  const app = spawn(require('electron') /* its binary, on any platform */, [ROOT, `--remote-debugging-port=${PORT}`], {
    stdio: 'ignore',
    // The machine the recommendations below expect (16 GB, no GPU), whatever the runner has.
    env: { ...process.env, SHELLBY_FAKE_HARDWARE: JSON.stringify({ ramGb: 16, vramGb: null }), SHELLBY_USER_DATA: userData, SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'), SHELLBY_HOOK_PORT: process.env.E2E_HOOK_PORT || '47995' },
  });
  try {
    let list = [];
    for (let i = 0; i < 40 && !list.some(t => t.url.endsWith('panel.html')); i++) {
      try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { /* starting */ }
      await wait(500);
    }
    const ws = new WebSocket(list.find(t => t.url.endsWith('panel.html')).webSocketDebuggerUrl);
    await new Promise(r => { ws.onopen = r; });
    let id = 0; const pending = new Map();
    ws.onmessage = e => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); };
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, m => r(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = expr => send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(res => res?.result?.value);
    const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await wait(150); } return false; };
    const saved = () => ev('JSON.stringify(SB.state.settings.localModel)').then(JSON.parse);
    const text = elId => ev(`document.getElementById('${elId}').textContent`);
    const shot = async name => { await ev("document.getElementById('localModelGroup').scrollIntoView({ block: 'start' })"); await savePng(send, path.join(OUT, name)); };
    fs.mkdirSync(OUT, { recursive: true });

    await panelBooted(ev);
    await ev("SB.setView('settings'); document.getElementById('setTab-claude').click()");
    check(await until("document.getElementById('localModelGroup')?.offsetParent !== null"), 'the Local model section is on the Claude tab');

    // Running, nothing installed: the setup card, with a recommendation for this PC
    check(await until("!document.getElementById('localSetupCard').hidden", 15000), 'with Ollama running and no models, the setup card shows');
    check(/Now a model/.test(await text('localSetupTitle')), `...asking for a model ("${await text('localSetupTitle')}")`);
    check(/For this (PC|Mac):/.test(await text('localSetupText')) && (await text('localSetupText')).includes(QUICK), `...recommending ${QUICK} among others ("${await text('localSetupText')}")`);
    check(await ev("document.querySelector('#localPreset [data-preset=\"custom\"]').getAttribute('aria-checked') === 'true'"), 'settings saved before presets read as Custom');
    await shot('local-mode-setup.png');

    // Coding with nothing installed: both slots missing, each with a Get button
    await ev("document.querySelector('#localPreset [data-preset=\"coding\"]').click()");
    check(await until("document.querySelectorAll('#localPull .local-pull-row').length === 2"), 'Coding names the two models it needs');
    check(await ev(`!!document.querySelector('#localPull [data-model="${MAIN}"] button')?.textContent.includes('GB')`), '...each Get button with its size');
    check((await saved()).preset === 'coding', 'Coding is saved');

    // Get the quick one: progress, then the preset picks it
    await ev(`document.querySelector('#localPull [data-model="${QUICK}"] button').click()`);
    check(await until(`!document.querySelector('#localPull [data-model="${QUICK}"] progress')?.hidden`), 'Get shows a progress bar');
    check(await ev(`document.querySelector('#localPull [data-model="${MAIN}"] button').disabled`), '...and one download at a time');
    await shot('local-mode-pulling.png');
    check(await until(`SB.state.settings.localModel.model === ${JSON.stringify(QUICK)}`, 15000), 'once it lands, Coding puts it on drafts');
    check(await until("document.querySelectorAll('#localPull .local-pull-row').length === 1"), '...and only the main model is still missing');
    check(fake.asked.includes('POST /api/pull'), 'it was fetched through Ollama\'s /api/pull');

    // The main one appears (pulled by hand): Coding again fills every role
    fake.models.set(MAIN, { size: 18 * GB, ctx: null });
    await ev("document.querySelector('#localPreset [data-preset=\"custom\"]').click()");
    await until("SB.state.settings.localModel.preset === 'custom'");
    await ev("document.querySelector('#localPreset [data-preset=\"coding\"]').click()");
    check(await until(`SB.state.settings.localModel.agent.model === ${JSON.stringify(MAIN)}`), 'Coding puts the main model on conversations');
    const lm = await saved();
    check(lm.agent.on === true && lm.agent.quick === QUICK && lm.models.quiz === MAIN, `...quick tasks on ${QUICK} and the quiz on ${MAIN} (${JSON.stringify(lm.agent)})`);
    check(await until("document.getElementById('localPull').hidden"), '...and nothing is missing now');
    check(await until("document.getElementById('localSetupCard').hidden"), 'with models in, the setup card goes away');

    // Fit check: a row per model in use, short contexts flagged with a fix
    check(await until("document.querySelectorAll('#localFit li').length === 2"), 'the fit check lists both models in use');
    check(await ev("[...document.querySelectorAll('#localFit .fit-chip')].some(c => /Short context/.test(c.textContent))"), '...flagging a short context');
    await shot('local-mode-fit.png');
    await ev(`[...document.querySelectorAll('#localFit li')].find(li => li.textContent.startsWith(${JSON.stringify(MAIN)}))?.querySelector('button')?.click()`);
    check(await until(`SB.state.settings.localModel.agent.model === ${JSON.stringify(`${MAIN}-32k`)}`), 'Make a 32K copy makes the copy and puts it on conversations');
    check((await saved()).models.quiz === `${MAIN}-32k` && (await saved()).preset === 'custom', '...the quiz too, and it is Custom now');
    check(await until(`[...document.querySelectorAll('#localFit li')].some(li => li.textContent.startsWith(${JSON.stringify(`${MAIN}-32k`)}) && !/Short context/.test(li.textContent))`), '...and the copy has no short-context chip');
    await shot('local-mode-copied.png');
  } catch (err) {
    check(false, `crashed: ${err.stack || err}`);
  } finally {
    app.kill();
    fake.server.close();
    await wait(500);
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* still held by the exiting app */ }
  }
  console.log(`\nscreenshots in ${OUT}`);
  console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})();
