/** Arc-length queries on paths: length, point + tangent at a fraction, trimming, bounds, flattening, transforms. */
import type { Rect, Vec2 } from '../types.ts'
import {
  DEG, appendSubCubic, cubicDerivative, cubicLength, cubicParamAtLength, cubicPoint, growBoundsByCubic, segmentCount,
  usable,
} from './cubic.ts'
import type { Subpath } from './cubic.ts'

/** A path with its arc-length table, from measurePath(); pass it instead of the subpaths to skip re-measuring. */
export interface PathMeasure {
  /** The measured subpaths (not copied: measure again after changing them). */
  subpaths: Subpath[]
  /** Total length of all subpaths. */
  length: number
  /** Cumulative length at the end of every curve, all subpaths concatenated. */
  ends: number[]
  /** Index into `ends` of each subpath's first curve, plus one final entry equal to ends.length. */
  offsets: number[]
}

/** Result of pointAt(): a position and the direction of travel there, in degrees (atan2(dy, dx)). */
export interface PathPoint { point: Vec2; tangentDeg: number }

/** 2D affine matrix in SVG order: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix2D = [a: number, b: number, c: number, d: number, e: number, f: number]

/** Measure a path once so repeated pathLength / pointAt / trimPath calls are cheap. */
export function measurePath(path: Subpath[]): PathMeasure {
  const subpaths = usable(path)
  const ends: number[] = []
  const offsets: number[] = []
  let total = 0
  for (let k = 0; k < subpaths.length; k++) {
    const c = subpaths[k].coords
    const n = segmentCount(subpaths[k])
    offsets.push(ends.length)
    for (let j = 0; j < n; j++) {
      total += cubicLength(c, 6 * j)
      ends.push(total)
    }
  }
  offsets.push(ends.length)
  return { subpaths, length: total, ends, offsets }
}

const measured = (path: Subpath[] | PathMeasure): PathMeasure =>
  path && !Array.isArray(path) && Array.isArray(path.ends) && Array.isArray(path.offsets) ? path : measurePath(path as Subpath[])

/** Total arc length of a path. */
export function pathLength(path: Subpath[] | PathMeasure): number {
  return measured(path).length
}

// Result slots of locate(): which subpath, which curve in it, and the parameter on that curve.
let locSubpath = 0, locSegment = 0, locT = 0

/** Find the curve and parameter at arc length s. Returns false when the path has no length. */
function locate(m: PathMeasure, s: number): boolean {
  const ends = m.ends
  const count = ends.length
  if (!(m.length > 0)) return false
  // lowest g with ends[g] > s
  let lo = 0, hi = count
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ends[mid] > s) hi = mid; else lo = mid + 1
  }
  let g = lo
  if (g >= count) {
    g = count - 1
    while (g > 0 && ends[g] - ends[g - 1] <= 0) g--
  }
  const before = g > 0 ? ends[g - 1] : 0
  // subpath that owns curve g: last k with offsets[k] <= g
  const offsets = m.offsets
  let a = 0, b = offsets.length - 1
  while (b - a > 1) {
    const mid = (a + b) >> 1
    if (offsets[mid] <= g) a = mid; else b = mid
  }
  locSubpath = a
  locSegment = g - offsets[a]
  locT = cubicParamAtLength(m.subpaths[a].coords, 6 * locSegment, s - before, ends[g] - before)
  return true
}

const clamp01 = (u: number): number => (u > 0 ? (u < 1 ? u : 1) : 0)

/** Point and direction of travel at fraction u (0…1) of a path's total length. */
export function pointAt(path: Subpath[] | PathMeasure, u: number): PathPoint {
  const m = measured(path)
  const point: Vec2 = [0, 0]
  if (!locate(m, clamp01(u) * m.length)) {
    if (m.subpaths.length > 0) { point[0] = m.subpaths[0].coords[0]; point[1] = m.subpaths[0].coords[1] }
    return { point, tangentDeg: 0 }
  }
  const c = m.subpaths[locSubpath].coords, i = 6 * locSegment, t = locT
  cubicPoint(c, i, t, point)
  const d: Vec2 = [0, 0]
  cubicDerivative(c, i, t, d)
  const scale = Math.abs(c[i + 6] - c[i]) + Math.abs(c[i + 7] - c[i + 1]) + Math.abs(c[i + 2] - c[i]) + Math.abs(c[i + 3] - c[i + 1])
    + Math.abs(c[i + 4] - c[i + 6]) + Math.abs(c[i + 5] - c[i + 7])
  if (Math.abs(d[0]) + Math.abs(d[1]) <= 1e-9 * scale) {
    // a handle sits on its anchor: take the direction across a short span instead
    const t0 = t - 1e-3 < 0 ? 0 : t - 1e-3, t1 = t + 1e-3 > 1 ? 1 : t + 1e-3
    const p0: Vec2 = [0, 0]
    cubicPoint(c, i, t0, p0)
    cubicPoint(c, i, t1, d)
    d[0] -= p0[0]; d[1] -= p0[1]
  }
  const deg = Math.atan2(d[1], d[0]) * DEG
  return { point, tangentDeg: deg === 0 ? 0 : deg }
}

/** The part of a path between fractions a and b (0…1, clamped, no wrap-around) of its total length: draw-on is trimPath(p, 0, u), a passing flash is trimPath(p, u - w, u). */
export function trimPath(path: Subpath[] | PathMeasure, a: number, b: number): Subpath[] {
  const m = measured(path)
  const out: Subpath[] = []
  let ua = clamp01(a), ub = clamp01(b)
  if (ua > ub) { const swap = ua; ua = ub; ub = swap }
  const total = m.length
  const s0 = ua * total, s1 = ub * total
  if (!(s1 > s0)) return out
  const { subpaths, ends, offsets } = m
  for (let k = 0; k < subpaths.length; k++) {
    const first = offsets[k], last = offsets[k + 1]
    if (last === first) continue
    const start = first > 0 ? ends[first - 1] : 0, end = ends[last - 1]
    const from = s0 > start ? s0 : start, to = s1 < end ? s1 : end
    if (!(to > from)) continue
    const sp = subpaths[k], c = sp.coords
    if (from === start && to === end) { out.push({ coords: c.slice(), closed: sp.closed }); continue }
    locate(m, from)
    let seg0 = locSegment, t0 = locT
    if (locSubpath !== k) { seg0 = 0; t0 = 0 }
    // the end of the range belongs to the curve that ends at or after it
    let seg1 = seg0
    while (first + seg1 < last - 1 && ends[first + seg1] < to) seg1++
    const before = first + seg1 > 0 ? ends[first + seg1 - 1] : 0
    const t1 = cubicParamAtLength(c, 6 * seg1, to - before, ends[first + seg1] - before)
    const p: Vec2 = [0, 0]
    cubicPoint(c, 6 * seg0, t0, p)
    const coords: number[] = [p[0], p[1]]
    if (seg0 === seg1) appendSubCubic(c, 6 * seg0, t0, t1, coords)
    else {
      appendSubCubic(c, 6 * seg0, t0, 1, coords)
      for (let j = seg0 + 1; j < seg1; j++) for (let q = 6 * j + 2; q < 6 * j + 8; q++) coords.push(c[q])
      appendSubCubic(c, 6 * seg1, 0, t1, coords)
    }
    out.push({ coords, closed: false })
  }
  return out
}

/** Exact axis-aligned bounding box of a path (curve extrema, not control points); x, y is the min corner. */
export function bounds(path: Subpath[]): Rect {
  const subpaths = usable(path)
  const box = [Infinity, Infinity, -Infinity, -Infinity]
  for (let k = 0; k < subpaths.length; k++) {
    const c = subpaths[k].coords
    const n = segmentCount(subpaths[k])
    if (n === 0) {
      if (c[0] < box[0]) box[0] = c[0]
      if (c[0] > box[2]) box[2] = c[0]
      if (c[1] < box[1]) box[1] = c[1]
      if (c[1] > box[3]) box[3] = c[1]
    }
    for (let j = 0; j < n; j++) growBoundsByCubic(c, 6 * j, box)
  }
  if (!(box[2] >= box[0]) || !(box[3] >= box[1])) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: box[0], y: box[1], width: box[2] - box[0], height: box[3] - box[1] }
}

/** Flatten each subpath to a polyline that stays within `tolerance` of the curve; closed subpaths repeat their first point at the end. */
export function flattenPath(path: Subpath[], tolerance = 0.01): Vec2[][] {
  const subpaths = usable(path)
  const tol = tolerance > 1e-9 ? tolerance : 1e-9
  const out: Vec2[][] = []
  for (let k = 0; k < subpaths.length; k++) {
    const c = subpaths[k].coords
    const n = segmentCount(subpaths[k])
    const line: Vec2[] = [[c[0], c[1]]]
    for (let j = 0; j < n; j++) {
      const i = 6 * j
      // |B''| <= 6·max second difference; chord error of n even steps <= |B''| / (8 n²)
      const ax = c[i] - 2 * c[i + 2] + c[i + 4], ay = c[i + 1] - 2 * c[i + 3] + c[i + 5]
      const bx = c[i + 2] - 2 * c[i + 4] + c[i + 6], by = c[i + 3] - 2 * c[i + 5] + c[i + 7]
      const bend = Math.sqrt(Math.max(ax * ax + ay * ay, bx * bx + by * by))
      const steps = Math.min(1024, Math.max(1, Math.ceil(Math.sqrt((0.75 * bend) / tol))))
      for (let q = 1; q < steps; q++) line.push(cubicPoint(c, i, q / steps, [0, 0]))
      line.push([c[i + 6], c[i + 7]])
    }
    out.push(line)
  }
  return out
}

/** A copy of the path with every point mapped through a 2D affine matrix [a, b, c, d, e, f] (SVG order). */
export function transformPath(path: Subpath[], matrix: Matrix2D): Subpath[] {
  const subpaths = usable(path)
  const [a, b, c, d, e, f] = Array.isArray(matrix) ? matrix : [1, 0, 0, 1, 0, 0]
  const out: Subpath[] = []
  for (let k = 0; k < subpaths.length; k++) {
    const src = subpaths[k].coords
    const coords = new Array<number>(src.length)
    for (let i = 0; i + 1 < src.length; i += 2) {
      const x = src[i], y = src[i + 1]
      coords[i] = a * x + c * y + e
      coords[i + 1] = b * x + d * y + f
    }
    out.push({ coords, closed: subpaths[k].closed })
  }
  return out
}
