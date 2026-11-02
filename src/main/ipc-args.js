// What a renderer may send on a channel, in one line beside the handler:
//
//   ipcMain.handle('bg:stop', (_e, id) => d.bgSessions.stop(id), [ID]);
//
// One check per argument, read by ipc-guard.js before the handler runs. These
// say the shape of a request and bound its size; whether it's allowed at all
// (a listed plugin, a path inside the project) stays with the handler. Written
// by hand because this file loads on every start: zod took about 140 ms to
// require, for checks this size.
//
// Most values come from the panel's own code, so a refusal means a bug or a
// compromised page. Arguments past the schema are ignored, as a handler ignores them.

/** @typedef {(value: unknown) => boolean} Check */

const MAX_STRING = 10_000;
const MAX_LIST = 1_000;

/** A non-empty string. @param {{ max?: number, re?: RegExp }} [o] @returns {Check} */
const str = ({ max = MAX_STRING, re } = {}) => v => typeof v === 'string' && v.length > 0 && v.length <= max && (!re || re.test(v));

/** Any string, empty too: text someone typed. @param {number} max @returns {Check} */
const text = max => v => typeof v === 'string' && v.length <= max;

/** @type {Check} */
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);

/** An object, with checks for the fields that have them; other fields pass. @param {Record<string, Check>} [fields] @returns {Check} */
const obj = (fields = {}) => v => plain(v) && Object.entries(fields).every(([key, check]) => check(/** @type {Record<string, unknown>} */ (v)[key]));

/** @param {Check} check @param {number} [max] @returns {Check} */
const list = (check, max = MAX_LIST) => v => Array.isArray(v) && v.length <= max && v.every(check);

/** Left out, or a value that passes. @param {Check} check @returns {Check} */
const opt = check => v => v === undefined || v === null || check(v);

/** Any of these. @param {...Check} checks @returns {Check} */
const either = (...checks) => v => checks.some(check => check(v));

/** The ids the panel passes around: a tab, a session, a plugin, a pack. */
const ID = str({ max: 300 });
/** Absolute paths and repo-relative ones. Windows' long-path limit is 32,767. */
const PATH = str({ max: 32_767 });

/** Whether args pass a schema (one Check per argument). @param {Check[]} schema @param {unknown[]} args */
const matches = (schema, args) => schema.every((check, i) => check(args[i]));

module.exports = { ID, PATH, MAX_STRING, either, list, matches, obj, opt, str, text };
