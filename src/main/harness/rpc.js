// JSON-RPC 2.0 over newline-delimited JSON: how Shellby talks to an agent CLI
// that speaks the Agent Client Protocol (gemini --acp, opencode acp, codex-acp).
//
// One message per line, both ways. Either side can send a request (with an id,
// answered once), a response, or a notification (no id). The agent asks us
// things too: a permission prompt is a request from it.
//
//   const peer = createPeer({ write: line => proc.stdin.write(line) });
//   proc.stdout -> readline -> peer.receive(line)
//   await peer.request('session/new', {...})
//   peer.onRequest = async (method, params) => result   (throw to answer an error)
//   peer.onNotification = (method, params) => {}
//
// Pure: the transport is injected, so test/harness-rpc.test.js needs no process.

const MAX_LINE = 8 * 1024 * 1024;     // one message; a line past this is dropped, not parsed
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

class RpcError extends Error {
  constructor(message, code = INTERNAL_ERROR, data = undefined) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

/**
 * @param {{ write: (line: string) => void, timeoutMs?: number, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} o
 */
function createPeer({ write, timeoutMs = DEFAULT_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let nextId = 1;
  /** @type {string | null} the reason, once closed */
  let closed = null;
  /** @type {Map<number, { resolve: Function, reject: Function, timer: any, method: string }>} */
  const waiting = new Map();

  const peer = {
    /** @type {(method: string, params: any) => any} */
    onRequest: async method => { throw new RpcError(`Method not found: ${method}`, METHOD_NOT_FOUND); },
    /** @type {(method: string, params: any) => void} */
    onNotification: () => {},
    /** @type {(line: string) => void} a line that wasn't JSON-RPC (an agent's stray log) */
    onOther: () => {},

    request(method, params = {}, { timeout = timeoutMs } = {}) {
      if (closed) return Promise.reject(new RpcError(closed));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = timeout > 0 ? setTimer(() => {
          waiting.delete(id);
          reject(new RpcError(`${method} got no answer in ${Math.round(timeout / 1000)}s`));
        }, timeout) : null;
        waiting.set(id, { resolve, reject, timer, method });
        send({ jsonrpc: '2.0', id, method, params });
      });
    },

    notify(method, params = {}) {
      if (!closed) send({ jsonrpc: '2.0', method, params });
    },

    /** One line from the agent's stdout. */
    receive(line) {
      if (typeof line !== 'string' || !line.trim()) return;
      if (line.length > MAX_LINE) { peer.onOther('(a message too long to read was dropped)'); return; }
      let msg;
      try { msg = JSON.parse(line); } catch { peer.onOther(line); return; }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) { peer.onOther(line); return; }
      if (typeof msg.method === 'string') {
        if (msg.id === undefined || msg.id === null) {
          try { peer.onNotification(msg.method, msg.params ?? {}); } catch { /* a listener's own bug is not the agent's */ }
        } else answer(msg.id, msg.method, msg.params ?? {});
        return;
      }
      if (msg.id === undefined) { peer.onOther(line); return; }
      // Ours are numbers; an agent that echoes one back as a string still means it.
      const key = typeof msg.id === 'string' && /^\d+$/.test(msg.id) ? Number(msg.id) : msg.id;
      const w = waiting.get(key);
      if (!w) return; // timed out already, or not ours
      waiting.delete(key);
      if (w.timer) clearTimer(w.timer);
      if (msg.error) w.reject(new RpcError(String(msg.error.message || 'error'), msg.error.code, msg.error.data));
      else w.resolve(msg.result);
    },

    /** The process is gone: everything still waiting fails with this reason. */
    close(reason = 'the agent stopped') {
      if (closed) return;
      closed = reason;
      for (const [, w] of waiting) {
        if (w.timer) clearTimer(w.timer);
        w.reject(new RpcError(reason));
      }
      waiting.clear();
    },

    get pending() { return waiting.size; },
    get closed() { return !!closed; },
  };

  function send(obj) {
    try { write(`${JSON.stringify(obj)}\n`); } catch (e) { peer.close(`could not write to the agent: ${e.message}`); }
  }

  async function answer(id, method, params) {
    try {
      const result = await peer.onRequest(method, params);
      send({ jsonrpc: '2.0', id, result: result ?? null });
    } catch (e) {
      const err = e instanceof RpcError ? e : new RpcError(e?.message || 'failed');
      send({ jsonrpc: '2.0', id, error: { code: err.code, message: err.message, ...(err.data !== undefined ? { data: err.data } : {}) } });
    }
  }

  return peer;
}

module.exports = { createPeer, RpcError, METHOD_NOT_FOUND, INTERNAL_ERROR, MAX_LINE };
