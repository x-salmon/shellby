// One conversation with an agent that speaks the Agent Client Protocol: Gemini
// CLI (gemini --acp), OpenCode (opencode acp), Codex (codex-acp). The
// counterpart of ClaudeSession (session/index.js) for the tab manager
// (sessions.js), with the same events and the parts of its surface the rest
// of Shellby reads; what only Claude Code can do (rewinding into its
// transcript, its background jobs and helper crabs, MCP admin requests) is
// empty here or refused in plain words.
//
//   initialize -> session/new (or session/load to resume) -> session/prompt per message
//   session/update notifications -> acp-translate.js -> stream.js items
//   session/request_permission -> a permission card -> respond() answers it
//   session/cancel stops a turn
//
// Shellby offers the agent no file system or terminal of its own: the agent
// reads, writes and runs with its own tools, as it does in a terminal, and
// asks first through request_permission when its mode says to.
//
// deps are injected (spawn, kill) so test/harness-session.test.js runs it
// against a fake agent.
const { spawn: realSpawn, execFile } = require('child_process');
const fs = require('fs');
const readline = require('readline');
const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');
const { toItems } = require('../stream');
const { troubleOf } = require('../trouble');
const { annotatePermission } = require('../safety');
const { plainPermission } = require('../plain-words');
const { TASKKILL } = require('../system32');
const { createPeer } = require('./rpc');
const acp = require('./acp-translate');
const todos = require('../../renderer/shared/todos');

const PROTOCOL_VERSION = 1;
const START_TIMEOUT_MS = 60 * 1000;     // initialize and session/new: a first run may be slow to sign in
const PARTIAL_MS = 50;                  // as ClaudeSession: the reply as it's written, at most this often
const CLOSE_KILL_MS = 3000;
const SETTING_TIMEOUT_MS = 15 * 1000;   // set_mode and set_model: a hung one mustn't hold the turn
const INTERRUPT_KILL_MS = 8000;         // Stop asked and the agent hasn't wound down: end it
const MODE_WORDS = { ask: 'Ask first', smart: 'Smart', acceptEdits: 'Auto-edit', plan: 'Plan only', autonomous: 'Autonomous' };
const MAX_STDERR = 4000;
const NOT_HERE = name => `${name} isn't something this agent can do in Shellby yet.`;

class AcpSession extends EventEmitter {
  /**
   * @param {{
   *   harness: { id: string, name: string, modes?: Record<string, string[]> },
   *   command: () => ({ file: string, prefix: string[] } | null),
   *   args?: string[], cwd: string, mode?: string, model?: string | null,
   *   resumeId?: string | null, env?: () => Record<string, string>,
   *   spawn?: typeof realSpawn, kill?: (proc: any) => void,
   * }} o
   */
  constructor(o) {
    super();
    this.harness = o.harness;
    this.command = o.command;
    this.extraArgs = o.args || [];
    this.cwd = o.cwd;
    this.mode = o.mode || 'ask';
    this.model = o.model || null;
    this.sessionId = o.resumeId || null;
    this.env = o.env || (() => ({}));
    this.spawnFn = o.spawn || realSpawn;
    this.killFn = o.kill || (proc => execFile(TASKKILL, ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => {}));

    // What the manager and the panel read, as ClaudeSession has them.
    this.busy = false;
    this.busySince = null;
    this.proc = null;
    this.pending = new Map();    // requestId -> the card's item (what it shows)
    this.context = null;
    this.cache = null;
    this.turn = null;
    this.tool = null;
    this.toolKind = null;
    this.toolAt = null;
    this.planning = false;
    this.todos = todos.create();   // its plan, as Claude's to-do list (shared/todos.js)
    this.plan = null;
    this.lastModel = null;
    this.initModel = null;
    this.modelSwitched = false;
    this.effort = '';
    this.outputStyle = '';
    this.agent = null;
    this.safeMode = false;
    this.resumeAt = null;
    this.crew = [];
    this.tasks = new Map();
    this.jobs = { byId: new Map() };
    this.growths = [];
    this.argsPrefix = [];
    this.createdFiles = new Set();
    // Set by sessions.js, as on ClaudeSession: whether it works in its own copy, and the checkout that copy came from.
    /** @type {(() => boolean) | null} */
    this.inCopy = null;
    /** @type {(() => string | null) | null} */
    this.copyOf = null;

    /** @type {ReturnType<typeof createPeer> | null} */
    this.peer = null;
    this.ready = null;          // the handshake and session, once started
    this.modes = [];            // the session modes the agent offers
    this.translator = acp.createTranslator();
    this.answers = new Map();   // requestId -> { options, resolve } for request_permission
    this.partial = null;
    this.stderr = '';
    this.stopping = false;
    this.turnStarted = 0;
    this.loading = false;       // session/load under way: its replay is read past
    /** @type {string | null} the mode last said not to be the agent's, so it's said once */
    this.unsetMode = null;
  }

  // ---- what ClaudeSession has that an ACP agent doesn't

  runningCrew() { return []; }
  hiddenCrew() { return []; }
  jobView() { return []; }
  remote() { return null; }
  exePath() { return this.command()?.file || null; }
  setEffort() { return false; }
  rewindTo() { throw new Error(NOT_HERE('Rewinding')); }
  stopJob() { return false; }
  stopRun() { return false; }
  runView() { return null; }
  runModel() { return null; }
  /** Claude Code's control requests (MCP admin and the like): answered as a refusal, never thrown. */
  request() { return Promise.resolve({ ok: false, error: NOT_HERE('That') }); }

  // ---- the process

  start() {
    if (this.ready) return this.ready;
    // Neither of these is kept: installing the CLI, or the folder coming back, lets the next message try again.
    if (!fs.existsSync(this.cwd)) return Promise.reject(new Error(`This conversation's folder isn't there any more: ${this.cwd}`));
    const cmd = this.command();
    if (!cmd) return Promise.reject(new Error(`Shellby can't find ${this.harness.name} on this PC.`));
    this.stopping = false;
    this.stderr = '';
    const proc = this.spawnFn(cmd.file, [...cmd.prefix, ...this.extraArgs], {
      cwd: this.cwd, env: { ...process.env, ...this.env(), SHELLBY_OWNED: '1' }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;
    // It can go between the writable check and the write (EPIPE): close says so, not an uncaught error in main.
    proc.stdin.on('error', () => {});
    const peer = createPeer({ write: line => { if (proc.stdin.writable) proc.stdin.write(line); } });
    this.peer = peer;
    peer.onNotification = (method, params) => { if (method === 'session/update') this.onUpdate(params); };
    peer.onRequest = (method, params) => this.onAgentRequest(method, params);
    peer.onOther = line => this.noteStderr(line);
    readline.createInterface({ input: proc.stdout }).on('line', line => peer.receive(line));
    proc.stderr.on('data', d => this.noteStderr(String(d)));
    proc.on('error', (/** @type {NodeJS.ErrnoException} */ err) => this.ended(null, err.code === 'ENOENT' ? `Shellby can't find ${this.harness.name} on this PC.` : err.message));
    proc.on('close', code => this.ended(code));
    // A handshake that fails takes its process with it, so the next message starts clean.
    const ready = this.handshake().catch(err => {
      if (this.ready === ready) this.ready = null;
      if (this.proc === proc) { this.stopping = true; this.killFn(proc); }
      throw err;
    });
    ready.catch(() => {}); // a failure is reported by whoever awaits it
    this.ready = ready;
    return ready;
  }

  async handshake() {
    const peer = this.peer;
    if (!peer) throw new Error(`${this.harness.name} isn't running.`);
    const init = await peer.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'shellby', title: 'Shellby', version: '1' },
    }, { timeout: START_TIMEOUT_MS });
    const canLoad = !!init?.agentCapabilities?.loadSession;
    /** @type {{ sessionId?: string, modes?: { availableModes?: Array<{ id?: string }> }, models?: { currentModelId?: string } } | null} what the agent says of the session */
    let s = null;
    if (this.sessionId && !canLoad) {
      this.emitItem({ kind: 'error', text: `${this.harness.name} can't pick up a session it started before, so this carries on in a fresh one: it won't remember what came earlier.` });
    }
    if (this.sessionId && canLoad) {
      // Loading replays the whole conversation as updates: the panel already has
      // it, so they're read past until the load is done (onUpdate).
      this.loading = true;
      try {
        s = await peer.request('session/load', { sessionId: this.sessionId, cwd: this.cwd, mcpServers: [] }, { timeout: START_TIMEOUT_MS });
        s = { sessionId: this.sessionId, ...(s || {}) };
      } catch (e) {
        this.emitItem({ kind: 'error', text: `${this.harness.name} couldn't pick up where it left off (${e.message}), so this carries on in a fresh session.` });
      } finally {
        this.loading = false;
      }
    }
    if (!s) s = await peer.request('session/new', { cwd: this.cwd, mcpServers: [] }, { timeout: START_TIMEOUT_MS });
    if (!s?.sessionId) throw new Error(`${this.harness.name} didn't start a session.`);
    this.sessionId = s.sessionId;
    this.modes = Array.isArray(s.modes?.availableModes) ? s.modes.availableModes.map(m => m?.id).filter(Boolean) : [];
    this.initModel = s.models?.currentModelId || this.model || null;
    this.emitItem({ kind: 'init', sessionId: this.sessionId, model: this.initModel, cwd: this.cwd, harness: this.harness.id });
    await this.applyMode();
    if (this.model && s.models?.currentModelId !== this.model) {
      await peer.request('session/set_model', { sessionId: this.sessionId, modelId: this.model }, { timeout: SETTING_TIMEOUT_MS }).catch(() => {});
    }
    return s;
  }

  /** The agent's own mode for Shellby's, from the harness's list of names for it, if it offers one. */
  agentMode(mode = this.mode) {
    const wanted = this.harness.modes?.[mode] || [];
    return wanted.find(id => this.modes.includes(id)) || null;
  }

  /**
   * Put the agent in its own mode for Shellby's. One it doesn't offer, or
   * refuses, is said in the conversation once, and planning is only claimed
   * when the agent really is in its plan mode.
   */
  async applyMode() {
    const id = this.agentMode();
    let applied = false;
    if (id && this.sessionId && this.peer) {
      applied = await this.peer.request('session/set_mode', { sessionId: this.sessionId, modeId: id }, { timeout: SETTING_TIMEOUT_MS }).then(() => true, () => false);
    }
    const planning = applied && id === this.agentMode('plan');
    if (planning !== this.planning) { this.planning = planning; this.emit('planning', planning); }
    if (!applied && this.mode !== 'ask' && this.unsetMode !== this.mode) {
      this.unsetMode = this.mode;
      this.emitItem({ kind: 'error', text: `${this.harness.name} has no mode Shellby could match to ${MODE_WORDS[this.mode] || this.mode}, so it runs in its own default mode and asks as that mode says.` });
    }
  }

  setMode(mode) {
    this.mode = mode;
    if (this.peer && !this.peer.closed && this.sessionId) this.applyMode();
    return true;
  }

  setModel(model) {
    this.model = model || null;
    this.modelSwitched = true;
    if (this.peer && !this.peer.closed && this.sessionId && this.model) {
      this.peer.request('session/set_model', { sessionId: this.sessionId, modelId: this.model }, { timeout: SETTING_TIMEOUT_MS }).catch(() => {});
    }
    return true;
  }

  noteStderr(text) {
    this.stderr = (this.stderr + text).slice(-MAX_STDERR);
  }

  // ---- a turn

  send(content, ready = null) {
    if (this.busy) throw new Error('Shellby is still working on the last task.');
    this.setBusy(true);
    const turn = { tokens: 0, before: this.context?.tokens ?? null, effort: '', cancelled: false };
    this.turn = turn;
    this.turnStarted = Date.now();
    this.translator = acp.createTranslator();
    Promise.resolve(ready).catch(() => {}).then(() => this.runTurn(content, turn));
  }

  async runTurn(content, turn) {
    /** @type {{ stopReason?: string, usage?: any } | null} session/prompt's answer */
    let answer = null;
    let error = null;
    try {
      await this.start();
      if (!this.peer) throw new Error(`${this.harness.name} stopped before it read the message.`);
      // Stopped while the agent was starting: the message never goes.
      if (turn.cancelled) answer = { stopReason: 'cancelled' };
      else answer = await this.peer.request('session/prompt', { sessionId: this.sessionId, prompt: this.promptBlocks(content) }, { timeout: 0 });
    } catch (e) {
      if (turn.cancelled) answer = { stopReason: 'cancelled' };
      else error = this.stderrHint(e.message);
    }
    if (!this.busy || this.turn !== turn) return; // ended() has already closed this turn
    for (const ev of this.translator.end(answer, { sessionId: this.sessionId, error, durationMs: Date.now() - this.turnStarted })) this.emitEvent(ev);
  }

  /**
   * The message as ACP content blocks: text, and pictures as images. No note
   * about Shellby goes with it: that one describes Claude Code and the crab's
   * tools, which an ACP agent doesn't have here.
   */
  promptBlocks(content) {
    const blocks = [];
    if (typeof content === 'string') blocks.push({ type: 'text', text: content });
    else for (const b of Array.isArray(content) ? content : []) {
      if (b?.type === 'text' && typeof b.text === 'string') blocks.push({ type: 'text', text: b.text });
      else if (b?.type === 'image' && b.source?.type === 'base64') blocks.push({ type: 'image', mimeType: b.source.media_type, data: b.source.data });
    }
    return blocks;
  }

  /** An error, with the last thing the agent said on stderr when that's all there is to go on. */
  stderrHint(message) {
    const tail = this.stderr.trim().split('\n').slice(-3).join('\n').trim();
    return tail && !message.includes(tail) ? `${message}\n${tail}` : message;
  }

  onUpdate(params) {
    if (params?.sessionId && params.sessionId !== this.sessionId) return;
    const u = params?.update;
    // A session being loaded replays what was said before: the panel has all of that already.
    if (this.loading && u?.sessionUpdate !== 'usage_update' && u?.sessionUpdate !== 'current_mode_update') return;
    if (u?.sessionUpdate === 'usage_update' && Number.isFinite(u.used)) {
      const before = this.context?.tokens ?? null;
      this.context = { tokens: u.used, window: Number.isFinite(u.size) ? u.size : null };
      this.emit('context', this.context, before);
      return;
    }
    if (u?.sessionUpdate === 'current_mode_update' && typeof u.currentModeId === 'string') {
      this.planning = u.currentModeId === this.agentMode('plan');
      this.emit('planning', this.planning);
      return;
    }
    for (const ev of this.translator.update(u)) this.emitEvent(ev);
  }

  async onAgentRequest(method, params) {
    if (method !== 'session/request_permission') throw Object.assign(new Error(`Shellby doesn't offer ${method}.`), { code: -32601 });
    const requestId = randomUUID();
    const answered = new Promise(resolve => this.answers.set(requestId, { options: params?.options || [], resolve }));
    this.emitEvent(acp.permissionEvent(params, requestId));
    return answered;
  }

  /** The card's answer. decision: 'allow' | 'always' | 'deny'. Same arguments as ClaudeSession's. */
  respond(requestId, decision, _message, _answers, via) {
    const item = this.pending.get(requestId);
    const waiting = this.answers.get(requestId);
    if (!item || !waiting) return false;
    this.pending.delete(requestId);
    this.answers.delete(requestId);
    waiting.resolve(acp.permissionOutcome(waiting.options, { decision: decision === 'deny' ? 'deny' : 'allow', always: decision === 'always' }));
    this.emitItem({ kind: 'decision', requestId, decision, toolName: item.toolName, ...(via === 'phone' || via === 'deck' ? { via } : {}) });
    return true;
  }

  cancelPending() {
    for (const w of this.answers.values()) w.resolve({ outcome: { outcome: 'cancelled' } });
    this.answers.clear();
    for (const id of this.pending.keys()) this.emitItem({ kind: 'decision', requestId: id, decision: 'cancelled' });
    this.pending.clear();
  }

  /**
   * Stop the turn: session/cancel, as ACP has it. Still starting: the message
   * isn't sent at all (runTurn). An agent that doesn't wind down in killMs is
   * ended; its session can be picked up again.
   */
  interrupt(killMs = INTERRUPT_KILL_MS) {
    if (!this.busy) return;
    const turn = this.turn;
    if (turn) turn.cancelled = true;
    this.cancelPending();
    if (this.peer && !this.peer.closed && this.sessionId) this.peer.notify('session/cancel', { sessionId: this.sessionId });
    const proc = this.proc;
    if (!proc) return;
    const timer = setTimeout(() => { if (this.busy && this.turn === turn && this.proc === proc) this.kill(); }, killMs);
    timer.unref?.();
  }

  /**
   * End the process, as ClaudeSession's stop() does: a tab left idle sheds it
   * (sessions.js stopIdle), and "Start fresh" clears sessionId after it so the
   * next message opens a new session. Resolves once it has gone (or timeoutMs).
   */
  stop(timeoutMs = 8000) {
    const proc = this.proc;
    if (!proc || proc.exitCode !== null) return Promise.resolve();
    if (!this.stopping) this.close();
    return new Promise((/** @type {(v?: void) => void} */ resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      timer.unref?.();
      proc.once('close', () => { clearTimeout(timer); resolve(); });
    });
  }

  /** No helpers or background commands of Shellby's to wait for: the agent's own are its business. */
  hasBackgroundWork() { return false; }

  /** As ClaudeSession's: what's in the context window now (0 after Start fresh). */
  setContext(tokens) {
    const before = this.context;
    this.context = tokens > 0 ? { tokens, window: before?.window ?? null } : null;
    if (before?.tokens !== this.context?.tokens) this.emit('context', this.context, before);
  }

  // ---- items

  /** A Claude-shaped event -> its items, as ClaudeSession's handle() does with the CLI's. */
  emitEvent(ev) {
    for (const item of toItems(ev)) this.handle(item);
  }

  handle(item) {
    if (item.kind === 'partial') return this.bufferPartial(item.text);
    this.flushPartial();
    switch (item.kind) {
      case 'tool':
        if (item.filePath) this.createdFiles.add(item.filePath);
        if (todos.apply(this.todos, item)) this.emit('todos', todos.summary(this.todos));
        this.tool = item.name;
        this.toolAt = Date.now();
        this.emit('tool', item.name);
        break;
      case 'tool_result':
        this.tool = null;
        this.emit('tool', null);
        break;
      case 'permission':
        Object.assign(item, annotatePermission(item, { createdFiles: this.createdFiles, tasks: this.tasks }));
        Object.assign(item, plainPermission(item, { cwd: this.cwd, inCopy: !!this.inCopy?.(), originalCwd: this.copyOf?.() || null }));
        this.pending.set(item.requestId, item);
        break;
      case 'result':
        if (!item.ok && item.error) item.trouble = troubleOf(item.error);
        if (item.subtype === 'interrupted') { item.interrupted = true; item.ok = false; item.error = null; }
        this.emitItem(item);
        this.turn = null;
        this.setBusy(false);
        return;
      default:
        break;
    }
    this.emitItem(item);
  }

  bufferPartial(text) {
    if (!this.partial) {
      const timer = setTimeout(() => this.flushPartial(), PARTIAL_MS);
      timer.unref?.();
      this.partial = { text: '', timer };
    }
    this.partial.text += text;
  }

  flushPartial() {
    const p = this.partial;
    if (!p) return;
    clearTimeout(p.timer);
    this.partial = null;
    if (p.text) this.emitItem({ kind: 'partial', text: p.text });
  }

  emitItem(item) { this.emit('item', item); }

  setBusy(b) {
    if (this.busy === b) return;
    this.busy = b;
    this.busySince = b ? Date.now() : null;
    this.tool = null;
    this.emit('busy', b);
  }

  // ---- ending

  /**
   * The process has gone: whatever was waiting on it fails, and a turn under way ends with why.
   * @param {number | null} code
   * @param {string | null} [why]
   */
  ended(code, why = null) {
    if (!this.proc) return;
    this.proc = null;
    this.ready = null;
    const peer = this.peer;
    this.peer = null;
    const reason = why || (this.stopping ? 'it was closed' : `${this.harness.name} stopped (exit code ${code ?? '?'})`);
    peer?.close(reason);
    this.cancelPending();
    // A turn under way ends here: stopped by you (Stop had to end the agent), or with why it went.
    if (this.busy && this.turn?.cancelled) {
      for (const ev of this.translator.end({ stopReason: 'cancelled' }, { sessionId: this.sessionId })) this.emitEvent(ev);
    } else if (this.busy && !this.stopping) {
      for (const ev of this.translator.end(null, { sessionId: this.sessionId, error: this.stderrHint(reason) })) this.emitEvent(ev);
    }
    this.setBusy(false);
    this.emit('exit', code);
  }

  close() {
    const proc = this.proc;
    if (!proc) return;
    this.stopping = true;
    this.cancelPending();
    try { proc.stdin.end(); } catch { /* already closed */ }
    const timer = setTimeout(() => { if (proc.exitCode === null) this.killFn(proc); }, CLOSE_KILL_MS);
    timer.unref?.();
  }

  kill() {
    if (!this.proc) return;
    this.stopping = true;
    this.killFn(this.proc);
  }
}

module.exports = { AcpSession, PROTOCOL_VERSION };
