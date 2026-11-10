/**
 * Shape builders. All shapes are in a y-up frame, centred on `center` (default the origin), and are traced
 * counter-clockwise like manim's (a circle starts at 0° on the right, a rectangle at its upper-right corner),
 * which is the order a draw-on animation follows.
 */
import type { Vec2 } from '../types.ts'
import { RAD, appendArc, appendLine, cosDeg, finite, sinDeg } from './cubic.ts'
import type { Subpath } from './cubic.ts'
import { measurePath, pointAt, trimPath } from './measure.ts'

/** Handle length of a 90° circular arc of radius 1: 4/3·tan(22.5°). */
const KAPPA = 0.5522847498307936

/** Options of rectPath(). */
export interface RectPathOptions { width: number; height: number; radius?: number; center?: Vec2 }
/** Options of circlePath(). */
export interface CirclePathOptions { radius: number; center?: Vec2 }
/** Options of ellipsePath(). */
export interface EllipsePathOptions { rx: number; ry: number; center?: Vec2 }
/** Options of arcPath(): angles in degrees, counter-clockwise from the +x axis. */
export interface ArcPathOptions { radius: number; from: number; to: number; center?: Vec2 }
/** Options of arrowPath(): bend is the shaft's arc angle in degrees (positive curves counter-clockwise, like manim's path_arc); head is the head length (0 = none). */
export interface ArrowPathOptions { from: Vec2; to: Vec2; bend?: number; head?: number; headWidth?: number }
/** Result of arrowPath(): stroke the shaft, fill the head. */
export interface ArrowPath { shaft: Subpath[]; head: Subpath[] }

const centerOf = (center: Vec2 | undefined): Vec2 =>
  Array.isArray(center) ? [finite(center[0], 0), finite(center[1], 0)] : [0, 0]

const pointOf = (p: unknown): Vec2 | null =>
  Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number' && p[0] - p[0] === 0 && p[1] - p[1] === 0
    ? [p[0], p[1]]
    : null

function ellipse(cx: number, cy: number, rx: number, ry: number): Subpath[] {
  const kx = KAPPA * rx, ky = KAPPA * ry
  return [{
    closed: true,
    coords: [
      cx + rx, cy,
      cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry,
      cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy,
      cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry,
      cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy,
    ],
  }]
}

/** Rectangle (optionally with rounded corners) centred on `center`, starting at the upper-right and going counter-clockwise. */
export function rectPath(options: RectPathOptions): Subpath[] {
  const w = Math.abs(finite(options?.width, 0)) / 2, h = Math.abs(finite(options?.height, 0)) / 2
  const [cx, cy] = centerOf(options?.center)
  const r = Math.min(Math.max(finite(options?.radius, 0), 0), w, h)
  if (r === 0) {
    const coords = [cx + w, cy + h]
    appendLine(coords, cx + w, cy + h, cx - w, cy + h)
    appendLine(coords, cx - w, cy + h, cx - w, cy - h)
    appendLine(coords, cx - w, cy - h, cx + w, cy - h)
    appendLine(coords, cx + w, cy - h, cx + w, cy + h)
    return [{ coords, closed: true }]
  }
  const k = KAPPA * r
  const left = cx - w, right = cx + w, top = cy + h, bottom = cy - h
  const coords = [right - r, top]
  let x = right - r, y = top
  const line = (nx: number, ny: number): void => {
    if (nx !== x || ny !== y) appendLine(coords, x, y, nx, ny)
    x = nx; y = ny
  }
  const corner = (c1x: number, c1y: number, c2x: number, c2y: number, nx: number, ny: number): void => {
    coords.push(c1x, c1y, c2x, c2y, nx, ny)
    x = nx; y = ny
  }
  line(left + r, top)
  corner(left + r - k, top, left, top - r + k, left, top - r)
  line(left, bottom + r)
  corner(left, bottom + r - k, left + r - k, bottom, left + r, bottom)
  line(right - r, bottom)
  corner(right - r + k, bottom, right, bottom + r - k, right, bottom + r)
  line(right, top - r)
  corner(right, top - r + k, right - r + k, top, right - r, top)
  return [{ coords, closed: true }]
}

/** Circle of the given radius: four cubics, starting at 0° (right) and going counter-clockwise. */
export function circlePath(options: CirclePathOptions): Subpath[] {
  const r = Math.abs(finite(options?.radius, 0))
  const [cx, cy] = centerOf(options?.center)
  return ellipse(cx, cy, r, r)
}

/** Axis-aligned ellipse with radii rx and ry, starting at 0° (right) and going counter-clockwise. */
export function ellipsePath(options: EllipsePathOptions): Subpath[] {
  const [cx, cy] = centerOf(options?.center)
  return ellipse(cx, cy, Math.abs(finite(options?.rx, 0)), Math.abs(finite(options?.ry, 0)))
}

function pointsPath(points: Vec2[], closed: boolean): Subpath[] {
  if (!Array.isArray(points)) return []
  let coords: number[] | null = null
  let x = 0, y = 0
  for (let i = 0; i < points.length; i++) {
    const p = pointOf(points[i])
    if (!p) continue
    if (!coords) coords = [p[0], p[1]]
    else if (p[0] !== x || p[1] !== y) appendLine(coords, x, y, p[0], p[1])
    x = p[0]; y = p[1]
  }
  if (!coords) return []
  if (closed && coords.length > 2 && (x !== coords[0] || y !== coords[1])) appendLine(coords, x, y, coords[0], coords[1])
  return [{ coords, closed: closed && coords.length > 2 }]
}

/** Closed polygon through the points (the closing edge is added). */
export function polygonPath(points: Vec2[]): Subpath[] {
  return pointsPath(points, true)
}

/** Open polyline through the points. */
export function polylinePath(points: Vec2[]): Subpath[] {
  return pointsPath(points, false)
}

/** Open circular arc from angle `from` to angle `to` in degrees (counter-clockwise when to > from; at most one full turn). */
export function arcPath(options: ArcPathOptions): Subpath[] {
  const r = Math.abs(finite(options?.radius, 0))
  const [cx, cy] = centerOf(options?.center)
  const from = finite(options?.from, 0)
  const sweep = Math.max(-360, Math.min(360, finite(options?.to, 0) - from))
  const coords = [cx + r * cosDeg(from), cy + r * sinDeg(from)]
  if (sweep !== 0 && r > 0) {
    appendArc(coords, cx, cy, r, r, 0, from * RAD, sweep * RAD)
    coords[coords.length - 2] = cx + r * cosDeg(from + sweep)
    coords[coords.length - 1] = cy + r * sinDeg(from + sweep)
  }
  return [{ coords, closed: false }]
}

/** Arrow from `from` to `to`: an open shaft (straight, or a circular arc of `bend` degrees) that stops at the base of a closed triangular head whose tip is exactly on `to`. */
export function arrowPath(options: ArrowPathOptions): ArrowPath {
  const a = pointOf(options?.from), b = pointOf(options?.to)
  if (!a || !b) return { shaft: [], head: [] }
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const chord = Math.sqrt(dx * dx + dy * dy)
  if (!(chord > 0)) return { shaft: [], head: [] }
  const bend = Math.max(-340, Math.min(340, finite(options?.bend, 0)))
  const coords = [a[0], a[1]]
  if (Math.abs(bend) < 1e-6) appendLine(coords, a[0], a[1], b[0], b[1])
  else {
    // centre sits on the left normal of a→b at (chord / 2) / tan(bend / 2); the arc then sweeps `bend` from a to b
    const half = (bend * RAD) / 2
    const offset = chord / 2 / Math.tan(half)
    const cx = (a[0] + b[0]) / 2 - (dy / chord) * offset, cy = (a[1] + b[1]) / 2 + (dx / chord) * offset
    const radius = chord / 2 / Math.abs(Math.sin(half))
    appendArc(coords, cx, cy, radius, radius, 0, Math.atan2(a[1] - cy, a[0] - cx), bend * RAD)
    coords[coords.length - 2] = b[0]
    coords[coords.length - 1] = b[1]
  }
  const full: Subpath[] = [{ coords, closed: false }]
  const measure = measurePath(full)
  const headLength = Math.min(Math.max(finite(options?.head, 0.25), 0), measure.length / 2)
  if (!(headLength > 0)) return { shaft: full, head: [] }
  const headWidth = Math.max(finite(options?.headWidth, headLength * 0.9), 0)
  const cut = 1 - headLength / measure.length
  const base = pointAt(measure, cut).point
  // the head's axis runs from the point where the shaft stops to the tip, so the head sits on a bent shaft
  let ax = b[0] - base[0], ay = b[1] - base[1]
  const axis = Math.sqrt(ax * ax + ay * ay)
  ax /= axis; ay /= axis
  const px = (-ay * headWidth) / 2, py = (ax * headWidth) / 2
  const head: number[] = [b[0], b[1]]
  appendLine(head, b[0], b[1], base[0] + px, base[1] + py)
  appendLine(head, base[0] + px, base[1] + py, base[0] - px, base[1] - py)
  appendLine(head, base[0] - px, base[1] - py, b[0], b[1])
  return { shaft: trimPath(measure, 0, cut), head: [{ coords: head, closed: true }] }
}
