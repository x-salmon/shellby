// native-windows.js for macOS: the same functions, over Core Graphics and
// Electron's own window ordering, so perching, the desktop layer, push-to-talk
// and the rest read one interface on both.
//
// A "handle" here is a Core Graphics window number. Other apps' windows come
// from CGWindowListCopyWindowInfo, which needs no permission for where a window
// is and whose it is (only its title needs Screen Recording, and is '' without).
// His own windows are Electron's: ordering one above an app's window is
// BrowserWindow.moveAbove, which takes any window number, and "the desktop"
// is the level just under ordinary windows. macOS has no owned windows, so
// while he's on one a light watch puts him back above it when it's raised.
//
// Rects come back as native-windows' { left, top, right, bottom }, in points
// from the top-left of the main screen: the same units as Electron's DIPs.
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

/** @type {any} */ // FFI module, untyped
let koffi = null;
// @ts-ignore koffi's types aren't in the program (jsconfig's noResolve)
try { koffi = require('koffi'); } catch { /* nothing native: every read below says "nothing there" */ }

const CG = '/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics';
const CF = '/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation';
const LOGIN = '/System/Library/PrivateFrameworks/login.framework/Versions/Current/login';
const UTF8 = 0x08000100;
const CF_SINT64 = 4, CF_DOUBLE = 13;
const ON_SCREEN_ONLY = 1, INCLUDING_WINDOW = 8, EXCLUDE_DESKTOP = 16;
const SESSION_STATE = 0; // kCGEventSourceStateCombinedSessionState
const NORMAL_LAYER = 0;
const DESKTOP = -1;      // desktopHost(): "the desktop" is a level, not a window
const FOLLOW_MS = 250;
const INFO_TTL_MS = 1000;

// Windows' virtual-key codes (what dictation.js holdKeyOf gives) -> the Mac's.
const LETTERS = { A: 0x00, S: 0x01, D: 0x02, F: 0x03, H: 0x04, G: 0x05, Z: 0x06, X: 0x07, C: 0x08, V: 0x09, B: 0x0B, Q: 0x0C, W: 0x0D, E: 0x0E, R: 0x0F, Y: 0x10, T: 0x11, O: 0x1F, U: 0x20, I: 0x22, P: 0x23, L: 0x25, J: 0x26, K: 0x28, N: 0x2D, M: 0x2E };
const DIGITS = [0x1D, 0x12, 0x13, 0x14, 0x15, 0x17, 0x16, 0x1A, 0x1C, 0x19];
const F_KEYS = [0x7A, 0x78, 0x63, 0x76, 0x60, 0x61, 0x62, 0x64, 0x65, 0x6D, 0x67, 0x6F, 0x69, 0x6B, 0x71, 0x6A, 0x40, 0x4F, 0x50, 0x5A];
const MOUSE = { 0x01: 0, 0x02: 1, 0x04: 2 };

/** A Windows virtual-key code -> the Mac's key code, or null. Pure. @param {number | null | undefined} vk */
function macKeyOf(vk) {
  if (typeof vk !== 'number') return null;
  if (vk === 0x20) return 0x31;
  if (vk >= 0x41 && vk <= 0x5A) return LETTERS[String.fromCharCode(vk)] ?? null;
  if (vk >= 0x30 && vk <= 0x39) return DIGITS[vk - 0x30];
  if (vk >= 0x70 && vk < 0x70 + F_KEYS.length) return F_KEYS[vk - 0x70];
  return null;
}

/** @type {any} */
let api = null;
let tried = false;
function load() {
  if (api || tried || !koffi || process.platform !== 'darwin') return api;
  tried = true;
  try {
    const cg = koffi.load(CG);
    const cf = koffi.load(CF);
    koffi.struct('SHELLBY_CGRECT', { x: 'double', y: 'double', w: 'double', h: 'double' });
    koffi.struct('SHELLBY_CGPOINT', { x: 'double', y: 'double' });
    const a = {
      list: cg.func('void *CGWindowListCopyWindowInfo(uint32_t option, uint32_t relativeTo)'),
      rectOf: cg.func('bool CGRectMakeWithDictionaryRepresentation(void *dict, _Out_ SHELLBY_CGRECT *rect)'),
      keyState: cg.func('bool CGEventSourceKeyState(int32_t state, uint16_t key)'),
      buttonState: cg.func('bool CGEventSourceButtonState(int32_t state, uint32_t button)'),
      warp: cg.func('int32_t CGWarpMouseCursorPosition(SHELLBY_CGPOINT point)'),
      count: cf.func('long CFArrayGetCount(void *array)'),
      at: cf.func('void *CFArrayGetValueAtIndex(void *array, long i)'),
      get: cf.func('void *CFDictionaryGetValue(void *dict, void *key)'),
      number: cf.func('bool CFNumberGetValue(void *n, long type, _Out_ int64_t *out)'),
      real: cf.func('bool CFNumberGetValue(void *n, long type, _Out_ double *out)'),
      bool: cf.func('bool CFBooleanGetValue(void *b)'),
      text: cf.func('bool CFStringGetCString(void *s, _Out_ uint8_t *buf, long size, uint32_t encoding)'),
      makeText: cf.func('void *CFStringCreateWithCString(void *alloc, const char *s, uint32_t encoding)'),
      release: cf.func('void CFRelease(void *ref)'),
    };
    const key = name => a.makeText(null, name, UTF8); // kept for good: a dozen tiny strings
    a.keys = {
      number: key('kCGWindowNumber'), pid: key('kCGWindowOwnerPID'), layer: key('kCGWindowLayer'),
      bounds: key('kCGWindowBounds'), owner: key('kCGWindowOwnerName'), name: key('kCGWindowName'),
      alpha: key('kCGWindowAlpha'), onScreen: key('kCGWindowIsOnscreen'),
    };
    try {
      a.lock = koffi.load(LOGIN).func('int32_t SACLockScreenImmediate()');
    } catch { a.lock = null; }
    api = a;
  } catch (e) {
    console.warn('[shellby] window tracking unavailable:', e.message);
    api = null;
  }
  return api;
}

const available = () => !!load();

function safe(fn, fallback) {
  const a = load();
  if (!a) return fallback;
  try { return fn(a); } catch { return fallback; }
}

// ---------------------------------------------------------------- reading windows

function num(a, dict, key, type = CF_SINT64) {
  const v = a.get(dict, key);
  if (!v) return null;
  const out = [0];
  return (type === CF_DOUBLE ? a.real(v, CF_DOUBLE, out) : a.number(v, CF_SINT64, out)) ? Number(out[0]) : null;
}

function str(a, dict, key) {
  const v = a.get(dict, key);
  if (!v) return '';
  const buf = Buffer.alloc(1024);
  return a.text(v, buf, buf.length, UTF8) ? buf.toString('utf8', 0, buf.indexOf(0)) : '';
}

/** One entry of a window list -> a plain object. */
function entryOf(a, dict) {
  const r = {};
  const b = a.get(dict, a.keys.bounds);
  const has = b && a.rectOf(b, r);
  const on = a.get(dict, a.keys.onScreen);
  return {
    id: num(a, dict, a.keys.number) || 0,
    pid: num(a, dict, a.keys.pid) || 0,
    layer: num(a, dict, a.keys.layer) ?? 0,
    alpha: num(a, dict, a.keys.alpha, CF_DOUBLE) ?? 1,
    owner: str(a, dict, a.keys.owner),
    title: str(a, dict, a.keys.name),
    onScreen: !!on && a.bool(on),
    frame: has ? { left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h } : null,
  };
}

/** The window list, front to back: every window on screen, or just `id`. */
function windows(option, id = 0) {
  return safe(a => {
    const list = a.list(option, id);
    if (!list) return [];
    try {
      const out = [];
      for (let i = 0, n = a.count(list); i < n; i++) out.push(entryOf(a, a.at(list, i)));
      return out;
    } finally { a.release(list); }
  }, []);
}
const onScreen = () => windows(ON_SCREEN_ONLY | EXCLUDE_DESKTOP);
const one = h => (h ? windows(INCLUDING_WINDOW, h)[0] || null : null);

/** Ordinary app windows on screen, front to back. */
function topLevelWindows() {
  return onScreen().filter(w => w.layer === NORMAL_LAYER && w.frame).map(w => w.id);
}

/** native-windows' quick(): the cheap read, every frame while he rides a window. */
function quick(h) {
  const w = one(h);
  if (!w || !w.frame) return { gone: true };
  // Minimized or on another Space it's off screen: perch.js treats that as hidden.
  return { gone: false, frame: w.frame, visible: w.onScreen, minimized: false, maximized: false, cloaked: false, hung: false };
}

/** native-windows' describe(): everything perch.js judges a window by. */
function describe(h) {
  const w = one(h);
  if (!w || !w.frame) return null;
  const image = imageOf(w.pid);
  return {
    hwnd: h, pid: w.pid,
    // The app's name, as perch's "Not on <app>" and the ignore list show it.
    exe: (w.owner || image.name).toLowerCase(), path: image.full, cls: '',
    rect: w.frame, ...quick(h),
    captioned: w.layer === NORMAL_LAYER, child: false, tool: false,
    topmost: w.layer > NORMAL_LAYER, noActivate: false, clickThrough: w.alpha === 0, owned: false,
  };
}

/** The front app's frontmost window. */
const foreground = () => topLevelWindows()[0] || 0;

/** The window in front for the time tracker. Its title needs Screen Recording; '' without. */
function frontWindow() {
  const w = onScreen().find(x => x.layer === NORMAL_LAYER && x.frame);
  return w ? { hwnd: w.id, pid: w.pid, exe: w.owner.toLowerCase(), title: w.title } : null;
}

const isWindow = h => !!one(h);
const isVisible = h => !!one(h)?.onScreen;

// ---------------------------------------------------------------- his own windows

/** @type {Map<number, any>} window number -> his BrowserWindow */
const mine = new Map();
/** @type {Map<number, number>} his window -> the one he's ordered above (or DESKTOP) */
const owners = new Map();
/** @type {Map<number, NodeJS.Timeout>} */
const follows = new Map();

/** native-windows' hwndOf(): his window's number, remembered so the calls below can find it. */
function hwndOf(win) {
  const id = Number(/^window:(\d+):/.exec(win.getMediaSourceId())?.[1]) || 0;
  if (id && !mine.has(id)) {
    mine.set(id, win);
    win.once('closed', () => { mine.delete(id); owners.delete(id); stopFollowing(id); });
  }
  return id;
}

const winOf = h => {
  const w = mine.get(h);
  return w && !w.isDestroyed() ? w : null;
};

function stopFollowing(self) {
  clearInterval(follows.get(self));
  follows.delete(self);
}

/** Is `self` still drawn just above `owner`? (Something of yours may sit between: not him.) */
function above(self, owner) {
  const order = onScreen().map(w => w.id);
  const s = order.indexOf(self), o = order.indexOf(owner);
  return s !== -1 && o !== -1 && s < o;
}

/** Keep him above `owner` when it's clicked to the front. */
function follow(self, owner) {
  stopFollowing(self);
  const timer = setInterval(() => {
    const win = winOf(self);
    if (!win || owners.get(self) !== owner) return stopFollowing(self);
    if (!above(self, owner)) try { win.moveAbove(`window:${owner}:0`); } catch { /* gone: perching notices */ }
  }, FOLLOW_MS);
  timer.unref?.();
  follows.set(self, timer);
}

const desktopHost = () => DESKTOP;
const ownerOf = h => owners.get(h) || 0;

/**
 * native-windows' ownBy(): onto the desktop's level, or just above an app's
 * window and kept there. False when there's no such window to go above.
 */
function ownBy(self, owner) {
  const win = winOf(self);
  if (!win || !owner) return false;
  try {
    if (owner === DESKTOP) {
      stopFollowing(self);
      win.setAlwaysOnTop(true, 'normal', -1); // the level under every app's windows, over the desktop's icons
    } else {
      if (!one(owner)) return false;
      win.setAlwaysOnTop(false);
      win.moveAbove(`window:${owner}:0`);
      follow(self, owner);
    }
    owners.set(self, owner);
    return true;
  } catch {
    return false;
  }
}

function raiseAbove(self, owner) {
  const win = winOf(self);
  if (!win || !owner || owner === DESKTOP) return false;
  try { win.moveAbove(`window:${owner}:0`); return true; } catch { return false; }
}

const ownByDesktop = self => ownBy(self, DESKTOP);

/** In the air: over the ordinary windows, nobody's. Never takes focus. */
function float(self) {
  const win = winOf(self);
  if (!win) return false;
  stopFollowing(self);
  owners.delete(self);
  win.setAlwaysOnTop(false);
  win.moveTop();
  return true;
}

/**
 * desktop-layer.js's restacking, given Windows' SetWindowPos "insert after":
 * 1 the bottom (the desktop's level), -1 topmost, -2 not topmost, 0 the top of
 * the ordinary windows, or one of his own windows to go just under.
 */
function restack(self, after) {
  const win = winOf(self);
  if (!win) return false;
  if (after === 1) return ownBy(self, DESKTOP);
  if (after === -2) { win.setAlwaysOnTop(false); return true; }
  if (after === -1 || after === 0) { win.moveTop(); return true; }
  const top = winOf(after);
  if (!top) return false;
  win.moveAbove(`window:${after}:0`); // then the one he's under goes back over him
  top.moveAbove(`window:${self}:0`);
  return true;
}

// ---------------------------------------------------------------- input

const keyDown = vk => safe(a => {
  const key = macKeyOf(vk);
  return key != null && a.keyState(SESSION_STATE, key);
}, false);
const mouseDown = () => safe(a => Object.values(MOUSE).some(b => a.buttonState(SESSION_STATE, b)), false);
const setCursor = (x, y) => safe(a => a.warp({ x, y }) === 0, false);

// ---------------------------------------------------------------- processes

/** @type {Map<number, { at: number, info: { alive: boolean, createdAt: number | null }, comm: string }>} */
const procCache = new Map();
function psOf(pid) {
  const hit = procCache.get(pid);
  if (hit && Date.now() - hit.at < INFO_TTL_MS) return hit;
  const r = spawnSync('/bin/ps', ['-o', 'lstart=,comm=', '-p', String(pid)], { encoding: 'utf8', timeout: 3000, env: { LC_ALL: 'C' } });
  const m = /^\s*(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/.exec(String(r.stdout || '').trim());
  const createdAt = m ? Date.parse(m[1].replace(/^\w{3}\s+/, '')) || null : null;
  const entry = { at: Date.now(), info: { alive: !!m, createdAt }, comm: m ? m[2].trim() : '' };
  if (procCache.size > 200) procCache.clear();
  procCache.set(pid, entry);
  return entry;
}

/** native-windows' processInfo(): running, and since when (to the second). */
function processInfo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return { alive: false, createdAt: null };
  return psOf(pid).info;
}

/** native-windows' imageOf(): the program's name (lower case) and full path. */
function imageOf(pid) {
  if (!pid) return { name: '', full: '' };
  const full = psOf(pid).comm;
  return { name: path.posix.basename(full).toLowerCase(), full };
}

// ---------------------------------------------------------------- the rest

/** What the system says about interrupting you: a fullscreen app has a Space of its own, out of his. */
const QUNS = Object.freeze({ BUSY: 2, D3D_FULL_SCREEN: 3, PRESENTATION: 4 });
const notificationState = () => 0;

const lockScreen = () => safe(a => !!a.lock && a.lock() === 0, false);
// Windows-only ideas: the shutdown-reason line, the registry, DPI awareness, and driving others' windows.
const blockShutdown = () => false;
const unblockShutdown = () => false;
const regQwords = () => null;
const dpiAware = () => false;
const focus = () => false;
const minimize = () => false;
const restore = () => false;
const close = () => false;
const move = () => false;

module.exports = {
  regQwords,
  load, available, hwndOf, topLevelWindows, describe, quick, foreground, frontWindow, isWindow, keyDown, mouseDown, setCursor, isVisible, ownerOf,
  QUNS, notificationState, desktopHost, ownBy, ownByDesktop, raiseAbove, float, focus, minimize, restore, close, move, dpiAware,
  lockScreen, blockShutdown, unblockShutdown, processInfo, imageOf,
  restack, macKeyOf, DESKTOP,
};
