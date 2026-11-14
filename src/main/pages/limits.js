// The limits a page lives inside (docs/plans/shellby-pages.md). The copy on
// the Pages screens quotes these numbers, so they live in one place.
const LIMITS = Object.freeze({
  FILES_BYTES: 512 * 1024,     // all of a page's files together
  FILE_COUNT: 20,              // flat: no folders
  DATA_BYTES: 1024 * 1024,     // page data, as JSON
  DATA_KEYS: 200,
  VALUE_BYTES: 256 * 1024,     // one key's value, as JSON
  LIST_ITEMS: 2000,            // what append keeps; the oldest go first
  VERSIONS: 20,
  PAGES: 100,
  DRAFTS: 20,
  ACTIVITY: 200,               // writes kept in the activity list
  MESSAGE_BYTES: 256 * 1024,   // one bridge message, either way
  NAME: 60,
  DESCRIPTION: 200,
  WHY: 200,
  WEB_HOSTS: 10,
  FETCH_BYTES: 1024 * 1024,
  FETCH_MS: 15_000,
  FETCHES_PER_MINUTE: 20,
  NOTIFY_PER_MINUTE: 1,
  SAYS_PER_MINUTE: 4,
  ASK_PROMPT: 2000,
  READY_MS: 5000,              // no "ready" by then: the page didn't load
  OPEN_PAGES: 5,               // frames kept alive at once
  SYNC_BYTES: 2 * 1024 * 1024, // what every page together may take in the sync gist (sync/pages.js)
  SYNC_THUMB_BYTES: 64 * 1024, // a tile's miniature travels only up to this
});

module.exports = { LIMITS };
