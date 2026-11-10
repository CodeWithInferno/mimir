/**
 * Internal cubic-bezier maths for src/lib/path. Not part of the public surface (import from ./index.ts).
 * Every function works on a flat coordinate array: the cubic that starts at index i is
 * [x0, y0, c1x, c1y, c2x, c2y, x1, y1] = c[i .. i + 7].
 */
import type { Vec2 } from '../types.ts'

/** One continuous piece of a path as absolute cubic beziers, flattened to
 *  [x0, y0,  c1x, c1y, c2x, c2y, x1, y1,  c1x, c1y, c2x, c2y, x2, y2, …] (2 + 6·n numbers for n curves).
 *  A closed subpath always ends exactly on its first point. Straight lines keep their handles at 1/3 and 2/3. */
export interface Subpath { coords: number[]; closed: boolean }

/** Degrees → radians. */
export const RAD = Math.PI / 180
/** Radians → degrees. */
export const DEG = 180 / Math.PI

/** Number of cubic curves in a subpath. */
export function segmentCount(subpath: Subpath): number {
  const n = subpath.coords.length
  return n < 8 ? 0 : ((n - 2) / 6) | 0
}

/** The subpaths that are usable (an object with a coords array of at least one point); anything else is dropped. */
export function usable(subpaths: unknown): Subpath[] {
  if (!Array.isArray(subpaths)) return []
  for (let k = 0; k < subpaths.length; k++) {
    const sp = subpaths[k]
    if (!sp || !Array.isArray(sp.coords) || sp.coords.length < 2) {
      return subpaths.filter((q) => q && Array.isArray(q.coords) && q.coords.length >= 2)
    }
  }
  return subpaths
}

/** A finite number, or the fallback. */
export function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && value === value && value !== Infinity && value !== -Infinity ? value : fallback
}

/** Cosine of an angle in degrees, exact at multiples of 90. */
export function cosDeg(deg: number): number {
  const q = ((deg % 360) + 360) % 360
  return q === 0 ? 1 : q === 90 || q === 270 ? 0 : q === 180 ? -1 : Math.cos(q * RAD)
}

/** Sine of an angle in degrees, exact at multiples of 90. */
export function sinDeg(deg: number): number {
  const q = ((deg % 360) + 360) % 360
  return q === 0 || q === 180 ? 0 : q === 90 ? 1 : q === 270 ? -1 : Math.sin(q * RAD)
}

/** Point on the cubic at parameter t, written into out. */
export function cubicPoint(c: ArrayLike<number>, i: number, t: number, out: Vec2): Vec2 {
  const s = 1 - t
  const b0 = s * s * s, b1 = 3 * s * s * t, b2 = 3 * s * t * t, b3 = t * t * t
  out[0] = b0 * c[i] + b1 * c[i + 2] + b2 * c[i + 4] + b3 * c[i + 6]
  out[1] = b0 * c[i + 1] + b1 * c[i + 3] + b2 * c[i + 5] + b3 * c[i + 7]
  return out
}

/** First derivative of the cubic at parameter t, written into out. */
export function cubicDerivative(c: ArrayLike<number>, i: number, t: number, out: Vec2): Vec2 {
  const s = 1 - t
  const a = 3 * s * s, b = 6 * s * t, d = 3 * t * t
  out[0] = a * (c[i + 2] - c[i]) + b * (c[i + 4] - c[i + 2]) + d * (c[i + 6] - c[i + 4])
  out[1] = a * (c[i + 3] - c[i + 1]) + b * (c[i + 5] - c[i + 3]) + d * (c[i + 7] - c[i + 5])
  return out
}

/** Speed |B'(t)| of the cubic at parameter t. */
export function cubicSpeed(c: ArrayLike<number>, i: number, t: number): number {
  const s = 1 - t
  const a = 3 * s * s, b = 6 * s * t, d = 3 * t * t
  const dx = a * (c[i + 2] - c[i]) + b * (c[i + 4] - c[i + 2]) + d * (c[i + 6] - c[i + 4])
  const dy = a * (c[i + 3] - c[i + 1]) + b * (c[i + 5] - c[i + 3]) + d * (c[i + 7] - c[i + 5])
  return Math.sqrt(dx * dx + dy * dy)
}

// 5-point Gauss–Legendre nodes and weights on [-1, 1] (exact for polynomials up to degree 9).
const GX1 = 0.5384693101056831, GX2 = 0.906179845938664
const GW0 = 0.5688888888888889, GW1 = 0.47862867049936647, GW2 = 0.23692688505618908

function gauss5(c: ArrayLike<number>, i: number, t0: number, t1: number): number {
  const h = (t1 - t0) / 2, m = (t0 + t1) / 2
  return h * (
    GW0 * cubicSpeed(c, i, m)
    + GW1 * (cubicSpeed(c, i, m - h * GX1) + cubicSpeed(c, i, m + h * GX1))
    + GW2 * (cubicSpeed(c, i, m - h * GX2) + cubicSpeed(c, i, m + h * GX2))
  )
}

function refine(c: ArrayLike<number>, i: number, t0: number, t1: number, whole: number, depth: number): number {
  const m = (t0 + t1) / 2
  const left = gauss5(c, i, t0, m), right = gauss5(c, i, m, t1)
  const sum = left + right
  if (depth <= 0 || sum !== sum || Math.abs(sum - whole) <= 1e-10 * sum) return sum
  return refine(c, i, t0, m, left, depth - 1) + refine(c, i, m, t1, right, depth - 1)
}

/** Arc length of the cubic between parameters t0 and t1 (adaptive quadrature, relative error about 1e-10). */
export function cubicLength(c: ArrayLike<number>, i: number, t0 = 0, t1 = 1): number {
  if (!(t1 > t0)) return 0
  return refine(c, i, t0, t1, gauss5(c, i, t0, t1), 14)
}

/** Parameter t at which the cubic has covered arc length s (length = the cubic's full length). */
export function cubicParamAtLength(c: ArrayLike<number>, i: number, s: number, length: number): number {
  if (!(s > 0) || !(length > 0)) return 0
  if (s >= length) return 1
  const tolerance = 1e-9 * length
  let lo = 0, hi = 1, t = s / length
  for (let iteration = 0; iteration < 40; iteration++) {
    const f = cubicLength(c, i, 0, t) - s
    if (Math.abs(f) <= tolerance) break
    if (f > 0) hi = t; else lo = t
    const speed = cubicSpeed(c, i, t)
    let next = speed > 1e-12 * length ? t - f / speed : (lo + hi) / 2
    if (!(next > lo && next < hi)) next = (lo + hi) / 2
    t = next
  }
  return t
}

function blossom(p0: number, p1: number, p2: number, p3: number, u: number, v: number, w: number): number {
  const a = (1 - u) * p0 + u * p1, b = (1 - u) * p1 + u * p2, d = (1 - u) * p2 + u * p3
  return (1 - w) * ((1 - v) * a + v * b) + w * ((1 - v) * b + v * d)
}

/** Append the piece of the cubic between t0 and t1 to out as [c1x, c1y, c2x, c2y, x, y] (start point not written). */
export function appendSubCubic(c: ArrayLike<number>, i: number, t0: number, t1: number, out: number[]): void {
  const x0 = c[i], y0 = c[i + 1], x1 = c[i + 2], y1 = c[i + 3], x2 = c[i + 4], y2 = c[i + 5], x3 = c[i + 6], y3 = c[i + 7]
  out.push(
    blossom(x0, x1, x2, x3, t0, t0, t1), blossom(y0, y1, y2, y3, t0, t0, t1),
    blossom(x0, x1, x2, x3, t0, t1, t1), blossom(y0, y1, y2, y3, t0, t1, t1),
    blossom(x0, x1, x2, x3, t1, t1, t1), blossom(y0, y1, y2, y3, t1, t1, t1),
  )
}

/** Append a straight line from (x0, y0) to (x1, y1) as a cubic with handles at 1/3 and 2/3. */
export function appendLine(out: number[], x0: number, y0: number, x1: number, y1: number): void {
  out.push(x0 + (x1 - x0) / 3, y0 + (y1 - y0) / 3, x0 + ((x1 - x0) * 2) / 3, y0 + ((y1 - y0) * 2) / 3, x1, y1)
}

/** True when the cubic is a straight line with handles at 1/3 and 2/3 (what appendLine writes). */
export function isLine(c: ArrayLike<number>, i: number): boolean {
  const x0 = c[i], y0 = c[i + 1], dx = c[i + 6] - x0, dy = c[i + 7] - y0
  const tolerance = 1e-9 * (1 + Math.abs(dx) + Math.abs(dy))
  return Math.abs(c[i + 2] - x0 - dx / 3) <= tolerance && Math.abs(c[i + 3] - y0 - dy / 3) <= tolerance
    && Math.abs(c[i + 4] - x0 - (dx * 2) / 3) <= tolerance && Math.abs(c[i + 5] - y0 - (dy * 2) / 3) <= tolerance
}

/**
 * Append an elliptical arc as cubics (each at most 90°). The arc starts at angle theta (radians, measured on the
 * unrotated ellipse) and sweeps delta radians; rotation is the ellipse's x-axis rotation in radians.
 * The start point is not written. Returns the number of cubics appended.
 */
export function appendArc(
  out: number[], cx: number, cy: number, rx: number, ry: number, rotation: number, theta: number, delta: number,
): number {
  const count = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9))
  const step = delta / count
  const k = (4 / 3) * Math.tan(step / 4)
  const cosR = Math.cos(rotation), sinR = Math.sin(rotation)
  let cosA = Math.cos(theta), sinA = Math.sin(theta)
  for (let j = 1; j <= count; j++) {
    const b = theta + step * j
    const cosB = Math.cos(b), sinB = Math.sin(b)
    // unrotated handle and end points
    const ux1 = rx * (cosA - k * sinA), uy1 = ry * (sinA + k * cosA)
    const ux2 = rx * (cosB + k * sinB), uy2 = ry * (sinB - k * cosB)
    const ux3 = rx * cosB, uy3 = ry * sinB
    out.push(
      cx + cosR * ux1 - sinR * uy1, cy + sinR * ux1 + cosR * uy1,
      cx + cosR * ux2 - sinR * uy2, cy + sinR * ux2 + cosR * uy2,
      cx + cosR * ux3 - sinR * uy3, cy + sinR * ux3 + cosR * uy3,
    )
    cosA = cosB; sinA = sinB
  }
  return count
}

/** Grow [minX, minY, maxX, maxY] in box to include the cubic exactly (extrema, not the control hull). */
export function growBoundsByCubic(c: ArrayLike<number>, i: number, box: number[]): void {
  for (let axis = 0; axis < 2; axis++) {
    const p0 = c[i + axis], p1 = c[i + 2 + axis], p2 = c[i + 4 + axis], p3 = c[i + 6 + axis]
    let lo = p0 < p3 ? p0 : p3, hi = p0 < p3 ? p3 : p0
    if (p1 < lo || p1 > hi || p2 < lo || p2 > hi) {
      // derivative / 3 = a t² + b t + d
      const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), d = p1 - p0
      for (let root = 0; root < 2; root++) {
        let t: number
        if (Math.abs(a) < 1e-14 * (Math.abs(b) + Math.abs(d) + 1e-300)) {
          if (root === 1 || b === 0) continue
          t = -d / b
        } else {
          const disc = b * b - 4 * a * d
          if (disc < 0) continue
          t = (-b + (root === 0 ? 1 : -1) * Math.sqrt(disc)) / (2 * a)
        }
        if (t > 0 && t < 1) {
          const s = 1 - t
          const v = s * s * s * p0 + 3 * s * s * t * p1 + 3 * s * t * t * p2 + t * t * t * p3
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
      }
    }
    if (lo < box[axis]) box[axis] = lo
    if (hi > box[axis + 2]) box[axis + 2] = hi
  }
}
