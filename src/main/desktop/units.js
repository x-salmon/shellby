// Screen pixels and DIPs. Windows reports other windows in physical pixels, and
// Electron converts with screen.screenToDipRect. macOS reports them in points,
// which already are DIPs, and Electron has no converter there.
'use strict';

const IS_WINDOWS = process.platform === 'win32';

/** A native rect ({ left, top, right, bottom }) as a DIP rect ({ x, y, width, height }). @param {any} screen @param {{ left: number, top: number, right: number, bottom: number }} r */
function toDipRect(screen, r) {
  const rect = { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
  return IS_WINDOWS ? screen.screenToDipRect(null, rect) : rect;
}

/** A DIP rect in screen pixels. @param {any} screen @param {Electron.Rectangle} rect */
const toScreenRect = (screen, rect) => (IS_WINDOWS ? screen.dipToScreenRect(null, rect) : rect);

/** A DIP point in screen pixels. @param {any} screen @param {Electron.Point} point */
const toScreenPoint = (screen, point) => (IS_WINDOWS ? screen.dipToScreenPoint(point) : point);

module.exports = { toDipRect, toScreenRect, toScreenPoint };
