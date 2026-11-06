// ci: the local model: Settings finds a server's models, refuses an address off this PC, and a routine draft is written locally
// End-to-end check of Settings → Claude → Local model against the dev app over
// CDP, with a stand-in model server on a loopback port (Ollama's
// OpenAI-compatible /v1/models and /v1/chat/completions):
//   - Find models lists what the server has, and picking one turns it on
//   - an address off this PC is refused and the saved one stays
//   - a routine draft is then answered by the local model, not Claude
//   - with the server gone, the draft falls back to Claude (the fake CLI)
//   node scripts/e2e-local-model.js [screenshotDir]
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { panelBooted } = require('./lib/boot');
const { savePng } = require('./lib/shot');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_CDP_PORT) || 9489;
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-local-model-'));
const MODELS = ['qwen3:8b', 'llama3.2:3b'];
const DRAFT = {
  name: 'Morning PR check', prompt: 'List my open pull requests and what each is waiting on.',
  schedule: { type: 'daily', time: '09:00' }, mode: 'plan', folder: '', model: '', needs_workflow: false, why: '',
};
const wait = ms => new Promise(r => setTimeout(r, ms));

/** A stand-in Ollama: lists MODELS and answers every chat with DRAFT. Records what it was asked. */
function modelServer() {
  const asked = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && req.url === '/v1/models') return res.end(JSON.stringify({ object: 'list', data: MODELS.map(id => ({ id, object: 'model' })) }));
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        asked.push(JSON.parse(body));
        return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(DRAFT) } }] }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, asked, url: `http://127.0.0.1:${server.address().port}` })));
}

(async () => {
  let fails = 0;
  const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };
  const fake = await modelServer();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-test-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ onboarded: true, notifications: false, localModel: { on: false, url: 'http://10.0.0.5:11434', model: '' } })); // off this PC, as a hand-edited file could have
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), [ROOT, `--remote-debugging-port=${PORT}`], {
    stdio: 'ignore',
    env: { ...process.env, SHELLBY_USER_DATA: userData, SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'), SHELLBY_HOOK_PORT: process.env.E2E_HOOK_PORT || '47995' },
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
    const saved = () => ev('JSON.stringify(SB.state.settings.localModel)').then(JSON.parse); // what main saved, as settings:set returned it
    const setUrl = url => ev(`(i => { i.focus(); i.value = ${JSON.stringify(url)}; i.dispatchEvent(new Event('change')); i.blur(); })(document.getElementById('localModelUrl'))`);
    const status = () => ev("document.getElementById('localModelStatus').textContent");

    await panelBooted(ev);
    await ev("SB.setView('settings'); document.getElementById('setTab-claude').click()");
    check(await until("document.getElementById('localModelGroup')?.offsetParent !== null"), 'the Local model section is on the Claude tab');
    check(await ev("document.getElementById('localModelUrl').value") === 'http://127.0.0.1:11434', 'a saved address off this PC shows as the default');
    check(await ev("document.getElementById('localModelToggle').disabled && !document.getElementById('localModelToggle').checked"), 'it starts off, and can\'t be turned on before a model is picked');
    check(/Find models, then pick one/.test(await status()), `it says what to do first ("${await status()}")`);

    // No model yet: Claude can set one up, in a task of its own that waits for you to send it
    check(await ev("!document.getElementById('localModelSetup').hidden"), 'with no model, Let Claude set it up is offered');
    await ev("document.getElementById('localModelSetup').click()");
    check(await until("SB.state.view === 'chat' && /install Ollama/.test(document.getElementById('input').value)"), 'it fills in a task asking Claude to install Ollama and a model');
    check(await ev("SB.activeTab()?.busy !== true"), '...without sending it');
    await ev("document.getElementById('input').value = ''; SB.setView('settings'); document.getElementById('setTab-claude').click()");
    await until("document.getElementById('localModelGroup')?.offsetParent !== null");

    // Find models against the stand-in server
    await setUrl(fake.url);
    await ev("document.getElementById('localModelFind').click()");
    check(await until("document.querySelectorAll('#localModelSelect option[value]:not([value=\"\"])').length === 2"), 'Find models lists the server\'s models');
    check(/2 models found/.test(await status()), `...and says how many ("${await status()}")`);
    check((await saved()).url === fake.url, 'the address is saved');

    const pick = model => ev(`(s => { s.value = ${JSON.stringify(model)}; s.dispatchEvent(new Event('change')); })(document.getElementById('localModelSelect'))`);
    const toggle = on => ev(`(t => { t.checked = ${on}; t.dispatchEvent(new Event('change')); })(document.getElementById('localModelToggle'))`);
    await pick(MODELS[0]);
    check(await until("!document.getElementById('localModelToggle').disabled"), 'picking a model lets the switch be used');
    check(await ev("document.getElementById('localModelSetup').hidden"), '...and Let Claude set it up steps aside');
    check((await saved()).on === false && /Turn it on/.test(await status()), `...but leaves it off until you turn it on ("${await status()}")`);
    await toggle(true);
    check(await until('SB.state.settings.localModel.on === true'), 'the switch turns it on');
    const on = await saved();
    check(on.on === true && on.model === MODELS[0], `saved on, with ${MODELS[0]} (${JSON.stringify(on)})`);

    fs.mkdirSync(OUT, { recursive: true });
    await ev("document.getElementById('localModelGroup').scrollIntoView({ block: 'start' })");
    await wait(400); // the switch's slide, so the shot shows where it settled
    await savePng(send, path.join(OUT, 'local-model-on.png'));

    // an address off this PC is refused
    await setUrl('http://192.168.1.50:11434');
    check(await until("document.getElementById('localModelUrl').value !== 'http://192.168.1.50:11434'"), 'an address off this PC is put back');
    check(/on this PC/.test(await status()), `...with a reason ("${await status()}")`);
    check((await saved()).url === fake.url, '...and the saved address is unchanged');
    // ...and so is one on this PC with a path of its own: requests only ever go to /v1/...
    await setUrl(`${fake.url}/admin`);
    check(await until(`document.getElementById('localModelUrl').value === ${JSON.stringify(fake.url)}`), 'an address with a path of its own is put back too');
    check((await saved()).url === fake.url, '...and the saved address is still unchanged');

    // a routine draft goes to the local model
    const draft = await ev("shellby.draftRoutine('check my pull requests every morning at 9').then(r => JSON.stringify(r))").then(JSON.parse);
    check(fake.asked.length === 1, `the local model was asked once (${fake.asked.length})`);
    check(fake.asked[0]?.model === MODELS[0] && fake.asked[0]?.response_format?.type === 'json_schema', 'with the picked model and the draft\'s schema');
    check(draft.ok && draft.draft?.name === DRAFT.name, `the draft is the local model's (${JSON.stringify(draft).slice(0, 120)})`);
    check(draft.by === MODELS[0], `...and says which model wrote it (${draft.by})`);

    // the Routines page's own Draft it: the toast credits the local model
    await ev("SB.setView('routines')");
    await until("document.getElementById('routineAskText')?.offsetParent !== null");
    await ev("(i => { i.value = 'check my pull requests every morning at 9'; document.getElementById('routineAsk').requestSubmit(); })(document.getElementById('routineAskText'))");
    check(await until(`/Drafted by ${MODELS[0].replace(/[.]/g, '\\.')}/.test(SB.$('toast').textContent)`), `the toast says ${MODELS[0]} drafted it ("${await ev("SB.$('toast').textContent")}")`);
    check(fake.asked.length === 2, `the local model was asked for that one too (${fake.asked.length})`);
    await ev("document.getElementById('routineCancel')?.click(); SB.setView('settings')");

    // with the server gone, Claude (the fake CLI) writes it instead
    await new Promise(r => fake.server.close(r));
    fake.server.closeAllConnections?.();
    const fallback = await ev("shellby.draftRoutine('check my pull requests every morning at 9').then(r => JSON.stringify(r))").then(JSON.parse);
    check(fake.asked.length === 2, 'nothing more reached the stopped server');
    check(fallback?.ok && fallback.draft?.name === 'Morning summary', `with the server gone, Claude answers instead (${JSON.stringify(fallback).slice(0, 120)})`);

    // another server: the old one's model doesn't come with it
    await setUrl('http://localhost:1234');
    check(await until("SB.state.settings.localModel.url === 'http://localhost:1234'"), 'another address on this PC is saved');
    const moved = await saved();
    check(moved.model === '' && moved.on === false, `...and the old server's model is let go (${JSON.stringify(moved)})`);

    // back to the stand-in's address (stopped now), a model, on, then the switch turns it off
    await setUrl(fake.url);
    await until(`SB.state.settings.localModel.url === ${JSON.stringify(fake.url)}`);
    await ev(`(s => { s.replaceChildren(new Option(${JSON.stringify(MODELS[1])}, ${JSON.stringify(MODELS[1])})); })(document.getElementById('localModelSelect'))`);
    await pick(MODELS[1]);
    await until(`SB.state.settings.localModel.model === ${JSON.stringify(MODELS[1])}`);
    await toggle(true);
    await until('SB.state.settings.localModel.on === true');
    await toggle(false);
    check(await until('SB.state.settings.localModel.on === false'), 'the switch turns it off');
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
