/** Test-only geometry helpers for the path library (independent of the code under test where it matters). */
import type { Vec2 } from '../../../../src/lib/types.ts'
import { flattenPath } from '../../../../src/lib/path/index.ts'
import type { Subpath } from '../../../../src/lib/path/index.ts'

/** Seeded PRNG (mulberry32) so fuzz cases are the same on every run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1])

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b[0] - a[0], vy = b[1] - a[1]
  const l2 = vx * vx + vy * vy
  let t = l2 === 0 ? 0 : ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy)
}

/** Distance from a point to the nearest of several polylines. */
export function distanceToPolylines(p: Vec2, lines: Vec2[][]): number {
  let best = Infinity
  for (const line of lines) {
    if (line.length === 1) best = Math.min(best, dist(p, line[0]))
    for (let i = 0; i + 1 < line.length; i++) best = Math.min(best, segmentDistance(p, line[i], line[i + 1]))
  }
  return best
}

/** Evaluate every cubic of a path at `per` parameters (brute force, straight from the control points). */
export function samplePoints(subpaths: Subpath[], per = 8): Vec2[] {
  const out: Vec2[] = []
  for (const sp of subpaths) {
    const c = sp.coords
    if (c.length >= 2) out.push([c[0], c[1]])
    for (let i = 0; i + 7 < c.length; i += 6) {
      for (let q = 1; q <= per; q++) {
        const t = q / per, s = 1 - t
        out.push([
          s * s * s * c[i] + 3 * s * s * t * c[i + 2] + 3 * s * t * t * c[i + 4] + t * t * t * c[i + 6],
          s * s * s * c[i + 1] + 3 * s * s * t * c[i + 3] + 3 * s * t * t * c[i + 5] + t * t * t * c[i + 7],
        ])
      }
    }
  }
  return out
}

/** Symmetric (Hausdorff-style) distance between the curves of two paths, good to about `fine`. */
export function curveDistance(a: Subpath[], b: Subpath[], fine = 1e-6): number {
  const la = flattenPath(a, fine), lb = flattenPath(b, fine)
  let worst = 0
  for (const p of samplePoints(a)) worst = Math.max(worst, distanceToPolylines(p, lb))
  for (const p of samplePoints(b)) worst = Math.max(worst, distanceToPolylines(p, la))
  return worst
}

/** Brute-force length: the sum of `steps` chords per cubic. */
export function bruteLength(subpaths: Subpath[], steps = 4000): number {
  let total = 0
  for (const sp of subpaths) {
    const pts = samplePoints([{ coords: sp.coords, closed: false }], steps)
    for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i])
  }
  return total
}

const orient = (a: Vec2, b: Vec2, c: Vec2): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

/** True when a closed polyline (first point repeated at the end) never crosses itself. */
export function isSimpleLoop(line: Vec2[]): boolean {
  const n = line.length - 1
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue // neighbours through the closing point
      const a = line[i], b = line[i + 1], c = line[j], d = line[j + 1]
      const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b)
      if (o1 * o2 < 0 && o3 * o4 < 0) return false
    }
  }
  return true
}

/** Signed area of a closed polyline (positive = counter-clockwise in a y-up frame). */
export function signedArea(line: Vec2[]): number {
  let area = 0
  for (let i = 0; i + 1 < line.length; i++) area += line[i][0] * line[i + 1][1] - line[i + 1][0] * line[i][1]
  return area / 2
}

/** Anchors (curve end points) of a subpath. */
export function anchors(sp: Subpath): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i + 1 < sp.coords.length; i += 6) out.push([sp.coords[i], sp.coords[i + 1]])
  return out
}

/** Regular star with `points` tips, as a closed polygon point list. */
export function starPoints(points = 5, outer = 1, inner = 0.45): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer, a = Math.PI / 2 + (Math.PI * i) / points
    out.push([r * Math.cos(a), r * Math.sin(a)])
  }
  return out
}
