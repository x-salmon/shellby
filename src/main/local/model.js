// A local model (Ollama, LM Studio) for Shellby's own small drafts, so they
// don't spend the user's Claude plan. Only callers that ask for it
// (runClaudeOnce's `local: true`) and only tool-less, schema-shaped
// `claude -p` calls are sent here; anything else, and any local failure, goes
// to Claude Code as before.
//
// The reply is dressed as `claude -p --output-format json` would print it
// ({ result, is_error, structured_output }), so every caller's parse() reads
// it unchanged.
//
// Both servers speak OpenAI's /v1/chat/completions with a JSON schema in
// response_format. Only loopback addresses are taken: "local" stays local.
//
// Pure apart from ask(), which uses the fetch it's handed.

const LOCAL_MAX_MS = 60000;   // a local try never takes more than this...
const LOCAL_SHARE = 0.5;      // ...or more than half the caller's budget, so Claude still has time after it
const MAX_MODEL_NAME = 200;
const MODEL_NAME = /^[\w.:/@+-]+$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The saved setting -> { url, model } to use, or null when it's off or unusable.
 * @param {any} saved { on, url, model }
 */
function checkSettings(saved) {
  if (!saved || typeof saved !== 'object' || saved.on !== true) return null;
  const model = typeof saved.model === 'string' ? saved.model.trim() : '';
  if (!model || model.length > MAX_MODEL_NAME || !MODEL_NAME.test(model)) return null;
  const url = baseUrl(saved.url);
  return url ? { url, model } : null;
}

/** A server address -> its base (no trailing slash or /v1), or null unless it's http(s) on this PC. */
function baseUrl(raw) {
  if (typeof raw !== 'string') return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!LOOPBACK.has(u.hostname) || u.username || u.password) return null;
  const path = u.pathname.replace(/\/+$/, '').replace(/\/v1$/, '');
  return `${u.protocol}//${u.host}${path}`;
}

/** The value after a flag, or null. */
function flagValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? String(args[i + 1]) : null;
}

/**
 * A `claude -p` call -> { system, prompt, schema } for a local model, or null
 * when it isn't one a local model can stand in for: it must have no tools
 * (`--tools ''`), no MCP config and no session to resume, and ask for a schema.
 * @param {string[]} args
 * @param {string | null} [input] what goes on stdin
 */
function requestFrom(args, input = null) {
  if (!Array.isArray(args) || !args.includes('-p')) return null;
  if (flagValue(args, '--tools') !== '') return null;
  if (['--mcp-config', '--resume', '--continue', '-c', '-r'].some(f => args.includes(f))) return null;
  let schema;
  try { schema = JSON.parse(flagValue(args, '--json-schema') || ''); } catch { return null; }
  if (!schema || typeof schema !== 'object') return null;
  const after = flagValue(args, '-p');
  const inline = after && !after.startsWith('-') ? after : '';
  const prompt = [inline, typeof input === 'string' ? input : ''].filter(Boolean).join('\n\n').trim();
  if (!prompt) return null;
  const system = flagValue(args, '--system-prompt') || flagValue(args, '--append-system-prompt') || '';
  return { system, prompt, schema };
}

/** The request body for /v1/chat/completions. */
function body(req, model) {
  const rule = 'Reply with one JSON object that matches the given schema, and nothing else.';
  return {
    model,
    stream: false,
    temperature: 0,
    messages: [
      { role: 'system', content: req.system ? `${req.system}\n\n${rule}` : rule },
      { role: 'user', content: req.prompt },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'reply', strict: true, schema: req.schema } },
  };
}

const TYPE_CHECKS = {
  string: v => typeof v === 'string',
  boolean: v => typeof v === 'boolean',
  number: v => typeof v === 'number' && Number.isFinite(v),
  integer: v => Number.isInteger(v),
  array: v => Array.isArray(v),
  object: v => !!v && typeof v === 'object' && !Array.isArray(v),
};

/**
 * Whether a reply has the schema's required fields, each top-level field of
 * the type it names. Not full JSON Schema: enough that a small model's `{}` or
 * wrong shape goes to Claude instead of reaching the caller as an answer.
 */
function fitsSchema(out, schema) {
  const props = schema?.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const required = Array.isArray(schema?.required) ? schema.required : [];
  if (required.some(k => !(k in out))) return false;
  return Object.entries(out).every(([k, v]) => {
    const check = TYPE_CHECKS[props[k]?.type];
    return !check || check(v);
  });
}

/**
 * The server's reply -> `claude -p` JSON on stdout, or { error } when it
 * didn't give one object that fits the schema.
 * @param {any} json
 * @param {any} [schema]
 * @returns {{ stdout: string, error?: undefined } | { error: string, stdout?: undefined }}
 */
function replyFrom(json, schema = null) {
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) return { error: 'no reply' };
  let out;
  try { out = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return { error: 'reply was not JSON' }; }
  if (!TYPE_CHECKS.object(out)) return { error: 'reply was not a JSON object' };
  if (schema && !fitsSchema(out, schema)) return { error: 'reply did not fit the schema' };
  // No `result`: the model's raw text is never handed on as if Claude wrote it.
  return { stdout: JSON.stringify({ type: 'result', is_error: false, structured_output: out, local: true }) };
}

/**
 * One request to the local server, shaped like claude/cli.js run()'s result.
 * @param {{ system: string, prompt: string, schema: object }} req
 * @param {{ url: string, model: string }} settings
 * @param {number} timeoutMs
 * @param {typeof fetch} fetchFn
 */
async function ask(req, settings, timeoutMs, fetchFn) {
  const fail = (/** @type {string} */ why, timedOut = false) => ({ ok: false, stdout: '', stderr: why, err: new Error(why), timedOut });
  let res;
  try {
    res = await fetchFn(`${settings.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body(req, settings.model)),
      // A redirect could send the prompt off this PC: refuse it, and Claude answers instead.
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError';
    return fail(timedOut ? 'timed out' : `couldn't reach ${settings.url} (${err?.message || err})`, timedOut);
  }
  if (!res.ok) return fail(`${settings.url} answered ${res.status}`);
  let json;
  try { json = await res.json(); } catch { return fail('the server\'s answer was not JSON'); }
  const reply = replyFrom(json, req.schema);
  return reply.error ? fail(reply.error) : { ok: true, stdout: reply.stdout, stderr: '', err: null, timedOut: false };
}

/**
 * runClaude with a local model in front of it. A call that passes
 * `local: true` and fits requestFrom() tries the local model first; if that
 * fails, Claude Code gets the call with what's left of the time budget.
 * @param {(args: string[], timeoutMs: number, opts?: any) => Promise<any>} runClaude
 * @param {{ settings: () => any, fetchFn?: typeof fetch, log?: any, now?: () => number }} deps
 */
function withLocal(runClaude, { settings, fetchFn = globalThis.fetch, log = null, now = Date.now }) {
  /** @param {string[]} args @param {number} timeoutMs @param {{ local?: boolean, input?: string | null, [k: string]: any }} [opts] */
  return async (args, timeoutMs, opts = {}) => {
    const { local = false, ...rest } = opts || {};
    /** @type {{ url: string, model: string } | null} */
    let s = null;
    try { s = local ? checkSettings(settings()) : null; } catch (err) { log?.warn?.(`local model settings: ${err?.message || err}`); }
    const req = s ? requestFrom(args, rest.input) : null;
    if (!s || !req) return runClaude(args, timeoutMs, rest);
    const started = now();
    const res = await ask(req, s, Math.min(LOCAL_MAX_MS, timeoutMs * LOCAL_SHARE), fetchFn);
    if (res.ok) return res;
    log?.info?.(`local model ${s.model}: ${res.stderr}; asking Claude instead`);
    return runClaude(args, Math.max(timeoutMs - (now() - started), timeoutMs * (1 - LOCAL_SHARE)), rest);
  };
}

module.exports = { checkSettings, baseUrl, requestFrom, body, fitsSchema, replyFrom, ask, withLocal, LOCAL_MAX_MS, LOCAL_SHARE };
