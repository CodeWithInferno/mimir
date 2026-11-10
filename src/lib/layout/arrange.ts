/**
 * Closed-form arrangements: row, column, grid, ring, nextTo, fitInto.
 * Sizes come in as numbers; every result is a centre point. Frame space (y up) is the default: "top" and "up"
 * mean larger y. Pass `yDown: true` when working in screen space, where they mean smaller y.
 */
import type { Rect, Vec2 } from '../types.ts'
import type { Size } from './rect.ts'

/** Which edge of the items lines up: top / bottom for a row, left / right for a column. */
export type Align = 'center' | 'left' | 'right' | 'top' | 'bottom'

/** A direction name or a vector such as [1, 0]; only the sign of each component is used. */
export type Direction = 'left' | 'right' | 'up' | 'down' | readonly number[]

/** Result of an arrange call: one centre per input size (same order) and the box that holds them all. */
export interface Arrangement { positions: Vec2[]; bounds: Rect }

/** Options of arrangeRow and arrangeColumn. */
export interface ArrangeOptions {
  /** Space between neighbours (default 0.25). */
  gap?: number
  /** Edge to line up (default 'center'). */
  align?: Align
  /** True in screen space, where y grows downwards. */
  yDown?: boolean
}

/** Options of arrangeGrid. */
export interface GridOptions {
  /** Number of columns (default: the smallest square that holds everything). */
  cols?: number
  /** Space between cells, one number or [horizontal, vertical] (default 0.25). */
  gap?: number | readonly [number, number]
  /** Where each item sits inside its cell (default 'center'). */
  align?: Align
  /** True in screen space, where y grows downwards. */
  yDown?: boolean
}

/** Options of arrangeRing. */
export interface RingOptions {
  /** Circle radius; when omitted it is the smallest radius at which neighbours stay `gap` apart. */
  radius?: number
  /** Minimum space between neighbours when the radius is automatic (default 0.25). */
  gap?: number
  /** Angle of the first item in degrees, 0 = right, 90 = top (default 90). */
  startAngle?: number
  /** Direction the items run in (default true: clockwise as seen on screen). */
  clockwise?: boolean
  /** True in screen space, where y grows downwards. */
  yDown?: boolean
}

const DEFAULT_GAP = 0.25

function num(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Items left to right, centred on the origin. `align` = 'top' | 'center' | 'bottom'. */
export function arrangeRow(sizes: readonly Size[], options: ArrangeOptions = {}): Arrangement {
  const gap = num(options.gap, DEFAULT_GAP)
  const up = options.yDown ? -1 : 1
  const n = sizes.length
  let total = 0, tallest = 0
  for (const s of sizes) { total += s.width; if (s.height > tallest) tallest = s.height }
  total += gap * Math.max(0, n - 1)
  const edge = options.align === 'top' ? 1 : options.align === 'bottom' ? -1 : 0
  const positions: Vec2[] = new Array(n)
  let cursor = -total / 2
  for (let i = 0; i < n; i++) {
    const s = sizes[i]!
    positions[i] = [cursor + s.width / 2, up * edge * (tallest - s.height) / 2]
    cursor += s.width + gap
  }
  return { positions, bounds: { x: -total / 2, y: -tallest / 2, width: total, height: tallest } }
}

/** Items top to bottom (first item on top), centred on the origin. `align` = 'left' | 'center' | 'right'. */
export function arrangeColumn(sizes: readonly Size[], options: ArrangeOptions = {}): Arrangement {
  const gap = num(options.gap, DEFAULT_GAP)
  const up = options.yDown ? -1 : 1
  const n = sizes.length
  let total = 0, widest = 0
  for (const s of sizes) { total += s.height; if (s.width > widest) widest = s.width }
  total += gap * Math.max(0, n - 1)
  const edge = options.align === 'right' ? 1 : options.align === 'left' ? -1 : 0
  const positions: Vec2[] = new Array(n)
  let cursor = total / 2                       // distance of the running top edge above the centre
  for (let i = 0; i < n; i++) {
    const s = sizes[i]!
    positions[i] = [edge * (widest - s.width) / 2, up * (cursor - s.height / 2)]
    cursor -= s.height + gap
  }
  return { positions, bounds: { x: -widest / 2, y: -total / 2, width: widest, height: total } }
}

/** Items in reading order (left to right, then the next row below), centred on the origin. Each column is as
 *  wide as its widest item and each row as tall as its tallest. */
export function arrangeGrid(sizes: readonly Size[], options: GridOptions = {}): Arrangement {
  const n = sizes.length
  const g = options.gap
  const gapX = typeof g === 'number' ? num(g, DEFAULT_GAP) : g ? num(g[0], DEFAULT_GAP) : DEFAULT_GAP
  const gapY = typeof g === 'number' ? num(g, DEFAULT_GAP) : g ? num(g[1], DEFAULT_GAP) : DEFAULT_GAP
  const up = options.yDown ? -1 : 1
  const wanted = Math.floor(num(options.cols, 0))
  const cols = Math.max(1, Math.min(Math.max(n, 1), wanted > 0 ? wanted : Math.ceil(Math.sqrt(n))))
  const rows = Math.ceil(n / cols)
  const colWidth = new Array<number>(cols).fill(0), rowHeight = new Array<number>(rows).fill(0)
  for (let i = 0; i < n; i++) {
    const s = sizes[i]!, c = i % cols, r = (i - c) / cols
    if (s.width > colWidth[c]!) colWidth[c] = s.width
    if (s.height > rowHeight[r]!) rowHeight[r] = s.height
  }
  let width = gapX * (cols - 1), height = gapY * Math.max(0, rows - 1)
  for (const w of colWidth) width += w
  for (const h of rowHeight) height += h
  const colCenter = new Array<number>(cols), rowCenter = new Array<number>(rows)
  let cursor = -width / 2
  for (let c = 0; c < cols; c++) { colCenter[c] = cursor + colWidth[c]! / 2; cursor += colWidth[c]! + gapX }
  cursor = height / 2
  for (let r = 0; r < rows; r++) { rowCenter[r] = cursor - rowHeight[r]! / 2; cursor -= rowHeight[r]! + gapY }
  const ax = options.align === 'left' ? -1 : options.align === 'right' ? 1 : 0
  const ay = options.align === 'top' ? 1 : options.align === 'bottom' ? -1 : 0
  const positions: Vec2[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const s = sizes[i]!, c = i % cols, r = (i - c) / cols
    positions[i] = [
      colCenter[c]! + ax * (colWidth[c]! - s.width) / 2,
      up * (rowCenter[r]! + ay * (rowHeight[r]! - s.height) / 2),
    ]
  }
  return { positions, bounds: { x: -width / 2, y: -height / 2, width, height } }
}

/** Items evenly spaced on a circle around the origin, the first one at the top, running clockwise. */
export function arrangeRing(sizes: readonly Size[], options: RingOptions = {}): Arrangement {
  const n = sizes.length
  const up = options.yDown ? -1 : 1
  const gap = num(options.gap, DEFAULT_GAP)
  let radius = num(options.radius, NaN)
  if (!(radius >= 0)) {
    // Neighbours sit a chord 2R·sin(π/n) apart; keep that chord longer than the largest item diagonal.
    let reach = 0
    for (const s of sizes) reach = Math.max(reach, Math.hypot(s.width, s.height))
    radius = n < 2 ? 0 : (reach + gap) / (2 * Math.sin(Math.PI / n))
  }
  const start = num(options.startAngle, 90) * Math.PI / 180
  const turn = (options.clockwise === false ? 1 : -1) * 2 * Math.PI / Math.max(n, 1)
  const positions: Vec2[] = new Array(n)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < n; i++) {
    const s = sizes[i]!, a = start + turn * i
    const x = snap(radius * Math.cos(a)), y = snap(up * radius * Math.sin(a))
    positions[i] = [x, y]
    x0 = Math.min(x0, x - s.width / 2); x1 = Math.max(x1, x + s.width / 2)
    y0 = Math.min(y0, y - s.height / 2); y1 = Math.max(y1, y + s.height / 2)
  }
  if (n === 0) return { positions, bounds: { x: 0, y: 0, width: 0, height: 0 } }
  return { positions, bounds: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } }
}

/** Removes the 1e-16 noise that cos/sin leave at the quarter turns, so "top" is exactly x = 0. */
function snap(v: number): number {
  return Math.abs(v) < 1e-12 ? 0 : v
}

/**
 * Centre for a box of `size` placed beside `target`: flush against it plus `gap`, like manim's next_to.
 * `dir` is the side to sit on (a name or a vector; diagonals such as [1, 1] sit at a corner).
 * `align` lines up an edge instead of the centres: 'top' | 'bottom' when beside, 'left' | 'right' when above
 * or below.
 */
export function nextTo(
  target: Rect, size: Size, dir: Direction = 'right', gap = DEFAULT_GAP, align: Align = 'center', yDown = false,
): Vec2 {
  const up = yDown ? -1 : 1
  let dx = 0, dy = 0
  if (typeof dir === 'string') {
    if (dir === 'left') dx = -1
    else if (dir === 'up') dy = up
    else if (dir === 'down') dy = -up
    else dx = 1
  } else {
    dx = Math.sign(num(dir[0], 0)); dy = Math.sign(num(dir[1], 0))
    if (dx === 0 && dy === 0) dx = 1
  }
  const g = num(gap, DEFAULT_GAP)
  const cx = target.x + target.width / 2, cy = target.y + target.height / 2
  let x = cx, y = cy
  if (dx !== 0) x = cx + dx * (target.width / 2 + size.width / 2 + g)
  else if (align === 'left') x = target.x + size.width / 2
  else if (align === 'right') x = target.x + target.width - size.width / 2
  if (dy !== 0) y = cy + dy * (target.height / 2 + size.height / 2 + g)
  else if (align === 'top' || align === 'bottom') {
    const high = (align === 'top') !== yDown        // true when the edge to line up is the larger-y one
    y = high ? target.y + target.height - size.height / 2 : target.y + size.height / 2
  }
  return [x, y]
}

/** Options of fitInto. */
export interface FitOptions {
  /** Space kept free inside the rect on every side (default 0). */
  padding?: number
  /** Largest allowed scale; pass 1 to only ever shrink (default: no limit). */
  maxScale?: number
}

/** Uniform scale and offset that centre `content` inside `rect` as large as it fits. */
export interface Fit { scale: number; offset: Vec2 }

/**
 * Fits content into a rect, keeping its aspect ratio: a content point p ends up at p * scale + offset.
 * `content` is a Size (taken as centred on the origin, which is what the arrange functions return) or a Rect.
 */
export function fitInto(rect: Rect, content: Size | Rect, options: FitOptions = {}): Fit {
  const padding = Math.max(0, num(options.padding, 0))
  const availableWidth = Math.max(0, rect.width - 2 * padding)
  const availableHeight = Math.max(0, rect.height - 2 * padding)
  let scale = Infinity
  if (content.width > 0) scale = Math.min(scale, availableWidth / content.width)
  if (content.height > 0) scale = Math.min(scale, availableHeight / content.height)
  const maxScale = num(options.maxScale, Infinity)
  if (maxScale > 0 && scale > maxScale) scale = maxScale
  if (!Number.isFinite(scale)) scale = 1
  const box = content as Partial<Rect>
  const cx = typeof box.x === 'number' ? box.x + content.width / 2 : 0
  const cy = typeof box.y === 'number' ? box.y + content.height / 2 : 0
  return { scale, offset: [rect.x + rect.width / 2 - cx * scale, rect.y + rect.height / 2 - cy * scale] }
}
