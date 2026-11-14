// ci: queued messages: queue, edit, drain as one turn, stop, error pauses, the merge window
// End-to-end check of queued messages against the dev app over CDP, driven by
// the fake Claude CLI (test/fixtures/fake-claude.js): no account, no usage.
// Type while Shellby works -> messages queue -> they go together as one turn
// when it ends. Stop hands the queue back; an error pauses it. Typed while
// idle, a message waits a moment for company (queue-turns.js): two Enters make
// one turn, Ctrl+Enter sends now, a /command keeps its own, the setting turns
// the wait off.
//   node scripts/e2e-queue.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MERGE_WINDOW_MS } = require('../src/renderer/panel/queue-turns');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_CDP_PORT) || 9350;
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let fails = 0;
  const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), [ROOT, `--remote-debugging-port=${PORT}`], {
    stdio: 'ignore',
    env: { ...process.env, SHELLBY_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-test-')), SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'), SHELLBY_HOOK_PORT: process.env.E2E_HOOK_PORT || '47996' },
  });
  try {
    let list = [];
    for (let i = 0; i < 40 && !list.some(t => t.url.endsWith('panel.html')); i++) {
      try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { /* starting */ }
      await wait(500);
    }
    const ws = new WebSocket(list.find(t => t.url.endsWith('panel.html')).webSocketDebuggerUrl);
    await new Promise(r => { ws.onopen = r; });
    let id = 0; const p = new Map();
    ws.onmessage = e => { const m = JSON.parse(e.data); p.get(m.id)?.(m); };
    const ev = expr => new Promise(r => { const i = ++id; p.set(i, m => r(m.result?.result?.value)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } })); });
    const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await wait(150); } return false; };
    // now: Ctrl+Enter, which sends without waiting a moment for company.
    const type = async (text, { now = false } = {}) => ev(`(i => { i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: ${now}, bubbles: true })); })(SB.$('input'))`);
    const users = () => ev("JSON.stringify([...SB.activeTab().el.querySelectorAll('.msg.user')].map((e => { const c = e.cloneNode(true); c.querySelectorAll('.routine-tag').forEach(t => t.remove()); return c.textContent.trim(); })))").then(JSON.parse);
    // The first tab opens once bootstrap answers, which can take more than 3 s.
    await until('!!SB.activeTab?.()', 15000);
    await ev("shellby.setSettings({ onboarded: true }).then(r => { SB.state.settings = r.settings; SB.setView('chat'); })");
    await wait(500);

    // 1. Queue two messages behind a slow turn.
    await type('wait 2500 first');
    check(await until('SB.activeTab().busy'), 'first message is running');
    check(await ev("!document.getElementById('sendBtn').disabled"), 'send button stays usable while busy');
    check(/queue/i.test(await ev("document.getElementById('sendHint').textContent")), `hint says Enter queues ("${await ev("document.getElementById('sendHint').textContent")}")`);
    await type('wait 300 second');
    await type('wait 300 third');
    check(await ev('SB.activeTab().queue.length') === 2, 'two messages queued');
    check(await ev("document.querySelectorAll('#queued .queue-item').length") === 2, 'two queue chips shown');
    check(/2 queued/.test(await ev("document.getElementById('statusText').textContent")), 'status shows "2 queued"');
    check(await ev("SB.$('input').value") === '', 'the box is cleared after queueing');

    // 2. Up arrow pulls the last one back for editing; Enter re-queues it.
    await ev("SB.$('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))");
    check(await ev("SB.$('input').value") === 'wait 300 third', 'Up arrow pulls back the last queued message');
    check(await ev('SB.activeTab().queue.length') === 1, '...and takes it out of the queue');
    await type('wait 300 third (edited)');
    check(await ev('SB.activeTab().queue.length') === 2, 'edited message re-queued');

    // 3. When the turn ends, what's queued goes as one turn: both messages, in order, each its own paragraph.
    check(await until("!SB.activeTab().busy && SB.activeTab().queue.length === 0 && document.querySelectorAll('.msg.user').length === 2", 15000), 'the queue went as one turn after the first');
    const sent = await users();
    check(sent.length === 2 && sent[0] === 'wait 2500 first' && /^wait 300 second\s*wait 300 third \(edited\)$/.test(sent[1]), `both queued messages in one turn, in order: ${sent.join(' | ')}`);
    check(await ev("/wait 300 second[\\s\\S]*wait 300 third \\(edited\\)/.test([...SB.activeTab().el.querySelectorAll('.msg.assistant')].at(-1)?.textContent || '')"), 'Claude got both in the one message');
    check(await ev("document.getElementById('queued').hidden"), 'queue chips gone');

    // 4. Stop hands the queue back instead of firing it.
    await type('slow job');
    await until('SB.activeTab().busy');
    await type('after stop');
    await ev("document.getElementById('stopBtn').click()");
    check(await until('!SB.activeTab().busy'), 'Stop ends the turn');
    await wait(500);
    check(await ev("SB.$('input').value") === 'after stop', 'queued message is back in the box');
    check(await ev('SB.activeTab().queue.length') === 0, 'nothing was sent automatically');

    // 5. An error pauses the queue until you say so.
    await ev("SB.$('input').value = ''");
    await type('fail 1500');
    await until('SB.activeTab().busy');
    await type('wait 100 after error');
    check(await until("!SB.activeTab().busy && SB.activeTab().queuePaused"), 'error pauses the queue');
    check(await ev("!!document.querySelector('#queued .queue-paused')"), 'paused notice with a "Send next now" button');
    await ev("document.querySelector('#queued .queue-paused button').click()");
    check(await until("SB.activeTab().queue.length === 0 && [...document.querySelectorAll('.msg.user')].some(e => e.textContent.includes('after error'))"), '"Send next now" sends it');

    // 6. Steering: queued while a tool runs, it goes in at Claude's next step,
    // in the same turn, like Claude Code. A /command waits for the turn to end.
    await until('!SB.activeTab().busy');
    await type('steps 6 500');
    await until('SB.activeTab().busy');
    await type('use tabs');
    await type('/compact');
    check(await ev('SB.activeTab().queue.length') === 2, 'both queued, as chips');
    check(await until("[...document.querySelectorAll('.msg.assistant')].some(e => e.textContent.includes('steered: use tabs'))"), 'Claude read it in the same turn');
    check(await until("!SB.activeTab().busy && SB.activeTab().queue.length === 0"), 'the /command waited, and went once the turn ended');
    // The feed from the prompt on: the steer sits inside the turn (no "done" line
    // before it), right after the step it went in at, with Claude's reply next.
    const turn = JSON.parse(await ev(`JSON.stringify((els => els.slice(els.findIndex(e => e.textContent.trim() === 'steps 6 500')))([...SB.activeTab().el.querySelectorAll('.msg.user, .msg.assistant, .meta, details.tool')]).map(e => e.matches('.meta') ? 'meta' : e.matches('details.tool') ? 'tool' : (e => { const c = e.cloneNode(true); c.querySelectorAll('.routine-tag').forEach(t => t.remove()); return c.textContent.trim(); })(e)))`));
    check(JSON.stringify(turn.slice(0, 4)) === JSON.stringify(['steps 6 500', 'tool', 'use tabs', 'steered: use tabs']) && turn[4] === 'meta', `the steer went in mid-turn: ${turn.slice(0, 5).join(' | ')}`);
    const tail = (await users()).slice(-3);
    check(await ev("[...SB.activeTab().el.querySelectorAll('.msg.user')].some(e => e.querySelector('.routine-tag')?.textContent.includes('sent mid-turn'))"), 'the steer says it was sent mid-turn');
    check(JSON.stringify(tail) === JSON.stringify(['steps 6 500', 'use tabs', '/compact']), `in order: ${tail.join(' | ')}`);

    // 7. Typed while idle, a message waits a moment for company, and says so: two Enters, one turn.
    await until('!SB.activeTab().busy');
    const before = (await users()).length;
    await type('first thought');
    check(await ev("!!document.querySelector('#queued .queue-merging') && /Send now/.test(document.querySelector('#queued .queue-merging button')?.textContent || '')"), 'a chip says it is waiting a moment, with Send now');
    check(/Ctrl\+Enter sends now/.test(await ev("document.getElementById('sendHint').textContent")), 'the hint says Ctrl+Enter sends now');
    check(!(await ev('SB.activeTab().busy')) && await ev("SB.$('input').value === ''"), 'nothing has gone yet, and the box is clear');
    await type('second thought');
    check(await ev('SB.activeTab().queue.length') === 2, 'the second joins it');
    check(await until(`document.querySelectorAll('.msg.user').length === ${before + 1}`, MERGE_WINDOW_MS * 4), 'a moment later they go by themselves');
    const merged = (await users()).at(-1);
    check(/^first thought\s*second thought$/.test(merged), `as one message with both, in order: ${JSON.stringify(merged)}`);
    check(await ev("!document.querySelector('#queued .queue-merging')"), 'the chip is gone');
    check(await until(`!SB.activeTab().busy && document.querySelectorAll('.msg.user').length === ${before + 1}`), 'and it was one turn');

    // 8. Ctrl+Enter sends now.
    await type('right away', { now: true });
    check(await ev('SB.activeTab().queue.length === 0 && (SB.activeTab().draining || SB.activeTab().busy)'), 'Ctrl+Enter sends at once: nothing left waiting');
    check(await until('SB.activeTab().busy'), '...and the turn starts');

    // 9. A /command typed while one waits: what's waiting goes now, and the command after it, on its own.
    await until('!SB.activeTab().busy');
    const n = (await users()).length;
    await type('plain words');
    await type('/compact');
    check(await until('SB.activeTab().busy'), 'the plain message goes at once');
    check(await ev("SB.activeTab().queue.length === 1 && SB.activeTab().queue[0].text === '/compact'"), 'the command waits behind it');
    check(await until(`!SB.activeTab().busy && SB.activeTab().queue.length === 0 && document.querySelectorAll('.msg.user').length === ${n + 2}`, 15000), 'then goes in a turn of its own');
    const twoTurns = (await users()).slice(-2);
    check(JSON.stringify(twoTurns) === JSON.stringify(['plain words', '/compact']), `two turns: ${twoTurns.join(' | ')}`);

    // 10. The setting turns the wait off: a message typed while idle goes at once.
    await ev("shellby.setSettings({ mergeSends: false }).then(r => { SB.state.settings = r.settings; })");
    await type('no waiting');
    check(await ev("SB.activeTab().queue.length === 0 && !document.querySelector('#queued .queue-merging')"), 'with the setting off, nothing waits');
    check(await until('SB.activeTab().busy'), '...it just goes');
    await ev("shellby.setSettings({ mergeSends: true }).then(r => { SB.state.settings = r.settings; })");
  } catch (e) {
    check(false, e.message);
  } finally {
    app.kill();
  }
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
