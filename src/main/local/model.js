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
// Replies are read up to these sizes and no further: anything can listen on a
// port on this PC, and one that never stops sending would fill main's memory.
const MAX_REPLY_BYTES = 512 * 1024;
const MAX_LIST_BYTES = 1024 * 1024;
const PROXY_VARS = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy'];

/**
 * Whether Node is set to send fetches through a proxy (NODE_USE_ENV_PROXY with
 * a proxy set). The proxy would then reach "localhost" from wherever it runs,
 * and the prompts would leave this PC, so no local model is used at all.
 * @param {NodeJS.ProcessEnv} [env]
 */
function proxied(env = process.env) {
  return /^(1|true)$/i.test(String(env.NODE_USE_ENV_PROXY || '').trim()) && PROXY_VARS.some(k => !!env[k]);
}

/**
 * The saved setting -> { url, model } to use, or null when it's off or unusable.
 * @param {any} saved { on, url, model }
 * @param {NodeJS.ProcessEnv} [env]
 */
function checkSettings(saved, env = process.env) {
  if (!saved || typeof saved !== 'object' || saved.on !== true || proxied(env)) return null;
  const model = typeof saved.model === 'string' ? saved.model.trim() : '';
  if (!model || model.length > MAX_MODEL_NAME || !MODEL_NAME.test(model)) return null;
  const url = baseUrl(saved.url);
  return url ? { url, model } : null;
}

/**
 * A server address -> its base, or null unless it's http(s) on this PC. Only
 * the server itself (or its /v1): requests always go to /v1/models and
 * /v1/chat/completions, never to a path someone else picked.
 */
function baseUrl(raw) {
  if (typeof raw !== 'string') return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!LOOPBACK.has(u.hostname) || u.username || u.password) return null;
  if (u.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')) return null;
  return `${u.protocol}//${u.host}`;
}

/**
 * A reply's JSON, read no further than `max` bytes.
 * -> { json } or { error: 'too large' | 'not JSON' }.
 * @param {any} res a fetch Response
 * @param {number} max
 * @returns {Promise<{ json?: any, error?: 'too large' | 'not JSON' }>}
 */
async function readJson(res, max) {
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > max) return { error: 'too large' };
  let text;
  if (res.body?.getReader) {
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { reader.cancel().catch(() => { /* already closed */ }); return { error: 'too large' }; }
      chunks.push(value);
    }
    text = Buffer.concat(chunks).toString('utf8');
  } else {
    try { text = await res.text(); } catch { return { error: 'not JSON' }; }
    if (Buffer.byteLength(text) > max) return { error: 'too large' };
  }
  try { return { json: JSON.parse(text) }; } catch { return { error: 'not JSON' }; }
}

/**
 * What Settings sends -> the setting to save, or null to refuse the change
 * (an address off this PC, a model name that can't be one). It only stays on
 * with a model picked.
 * @param {any} raw { on, url, model }
 * @returns {{ on: boolean, url: string, model: string } | null}
 */
function cleanSettings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const url = baseUrl(raw.url);
  const model = typeof raw.model === 'string' ? raw.model.trim() : '';
  if (!url) return null;
  if (model && (model.length > MAX_MODEL_NAME || !MODEL_NAME.test(model))) return null;
  return { on: raw.on === true && !!model, url, model };
}

const LIST_TIMEOUT_MS = 5000;
const MAX_MODELS = 200;
const DEFAULT_URL = 'http://127.0.0.1:11434'; // not "localhost", which can mean ::1 first, where Ollama isn't
let listing = false; // one search at a time: the panel never needs two, and a scan would

/**
 * The models a local server has, for Settings' Find models.
 * -> { ok: true, models: string[] } or { ok: false, error } in words for the panel.
 * @param {unknown} rawUrl
 * @param {typeof fetch} [fetchFn]
 * @param {NodeJS.ProcessEnv} [env]
 */
async function listModels(rawUrl, fetchFn = globalThis.fetch, env = process.env) {
  if (proxied(env)) return { ok: false, error: 'Shellby is set to send web requests through a proxy (NODE_USE_ENV_PROXY), so it won\'t use a local model.' };
  const url = baseUrl(rawUrl);
  if (!url) return { ok: false, error: `Use the address of a server on this PC, like ${DEFAULT_URL}.` };
  if (listing) return { ok: false, error: 'Still looking. Give it a moment.' };
  listing = true;
  try { return await listFrom(url, fetchFn); } finally { listing = false; }
}

/** @param {string} url @param {typeof fetch} fetchFn */
async function listFrom(url, fetchFn) {
  let res;
  try {
    res = await fetchFn(`${url}/v1/models`, { redirect: 'error', signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
  } catch (err) {
    return { ok: false, error: err?.name === 'TimeoutError' ? `${url} didn't answer in time.` : `Nothing answered at ${url}. Is Ollama or LM Studio running?` };
  }
  if (!res.ok) return { ok: false, error: `${url} answered ${res.status}. Check the address.` };
  const read = await readJson(res, MAX_LIST_BYTES);
  if (read.error) return { ok: false, error: `${url} isn't a model server Shellby knows.` };
  const json = read.json;
  const ids = Array.isArray(json?.data) ? json.data.map((/** @type {any} */ m) => m?.id) : [];
  const models = [...new Set(ids.filter(id => typeof id === 'string' && id.length <= MAX_MODEL_NAME && MODEL_NAME.test(id)))].slice(0, MAX_MODELS);
  return models.length ? { ok: true, models } : { ok: false, error: 'The server has no models yet. Pull one first, e.g. ollama pull qwen3:8b.' };
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
      signal: AbortSignal.timeout(Math.max(1, Math.floor(Number(timeoutMs) || 0))), // it throws on NaN or a negative
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError';
    return fail(timedOut ? 'timed out' : `couldn't reach ${settings.url} (${err?.message || err})`, timedOut);
  }
  if (!res.ok) return fail(`${settings.url} answered ${res.status}`);
  const read = await readJson(res, MAX_REPLY_BYTES).catch(() => /** @type {{ json?: any, error?: 'not JSON' }} */ ({ error: 'not JSON' }));
  if (read.error) return fail(read.error === 'too large' ? 'the server\'s answer was too large' : 'the server\'s answer was not JSON');
  const reply = replyFrom(read.json, req.schema);
  return reply.error ? fail(reply.error) : { ok: true, stdout: reply.stdout, stderr: '', err: null, timedOut: false };
}

// A model that keeps failing is left out for a while, so every draft doesn't
// wait on it first. A slow failure (it ran out of time, or took long to get it
// wrong) counts at once; quick ones (the server isn't running) only once they
// pile up, since those cost nothing. Any change to the server or model, or an
// answer that works, starts afresh.
const SLOW_FAIL_MS = 10000;
const QUICK_FAILS = 3;
const REST_MS = 10 * 60 * 1000;

/**
 * runClaude with a local model in front of it. A call that passes
 * `local: true` and fits requestFrom() tries the local model first; if that
 * fails, Claude Code gets the call with what's left of the time budget. A
 * local answer comes back with `by`: the model that wrote it.
 * @param {(args: string[], timeoutMs: number, opts?: any) => Promise<any>} runClaude
 * @param {{ settings: () => any, fetchFn?: typeof fetch, log?: any, now?: () => number }} deps
 */
function withLocal(runClaude, { settings, fetchFn = globalThis.fetch, log = null, now = Date.now }) {
  const rest = { key: '', fails: 0, until: 0 }; // the model being rested, and until when
  /** @param {string[]} args @param {number} timeoutMs @param {{ local?: boolean, input?: string | null, [k: string]: any }} [opts] */
  return async (args, timeoutMs, opts = {}) => {
    const { local = false, ...cli } = opts || {};
    /** @type {{ url: string, model: string } | null} */
    let s = null;
    try { s = local ? checkSettings(settings()) : null; } catch (err) { log?.warn?.(`local model settings: ${err?.message || err}`); }
    const req = s ? requestFrom(args, cli.input) : null;
    if (!s || !req) return runClaude(args, timeoutMs, cli);
    const key = `${s.url} ${s.model}`;
    if (rest.key !== key) Object.assign(rest, { key, fails: 0, until: 0 });
    if (now() < rest.until) return runClaude(args, timeoutMs, cli);
    const started = now();
    const res = await ask(req, s, Math.min(LOCAL_MAX_MS, timeoutMs * LOCAL_SHARE), fetchFn);
    if (res.ok) { rest.fails = 0; return { ...res, by: s.model }; }
    const took = now() - started;
    rest.fails++;
    if (took >= SLOW_FAIL_MS || rest.fails >= QUICK_FAILS) {
      rest.until = now() + REST_MS;
      rest.fails = 0;
      log?.info?.(`local model ${s.model}: ${res.stderr}; asking Claude instead, and leaving it out for ${REST_MS / 60000} minutes`);
    } else {
      log?.info?.(`local model ${s.model}: ${res.stderr}; asking Claude instead`);
    }
    return runClaude(args, Math.max(timeoutMs - took, timeoutMs * (1 - LOCAL_SHARE)), cli);
  };
}

module.exports = {
  checkSettings, cleanSettings, listModels, baseUrl, proxied, readJson, requestFrom, body, fitsSchema, replyFrom, ask, withLocal,
  DEFAULT_URL, LOCAL_MAX_MS, LOCAL_SHARE, SLOW_FAIL_MS, QUICK_FAILS, REST_MS, MAX_REPLY_BYTES, MAX_LIST_BYTES,
};
