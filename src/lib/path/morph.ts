/**
 * Path morphing (manim's Transform) on real cubics.
 *
 * manim pairs point i with point i and never picks a start point or a direction, so closed shapes twist.
 * Here both shapes are cut at one shared set of knots in NORMALISED ARC LENGTH: every anchor of either shape
 * (so corners stay sharp and u = 0 / u = 1 reproduce the inputs exactly: cutting a cubic does not change it),
 * plus even cuts so no span is longer than 1 / detail. Before that the target's direction and start point are
 * chosen to minimise travel. Ported from an earlier probe (which worked on polylines).
 */
import { RAD, appendSubCubic, cubicLength, cubicParamAtLength, cubicPoint, segmentCount, usable } from './cubic.ts'
import type { Subpath } from './cubic.ts'
import type { Vec2 } from '../types.ts'

/** Options of morphPlan(). */
export interface MorphOptions {
  /** Choose the direction and start point that minimise travel (default true). false = match as authored, like manim. */
  align?: boolean
  /** Each matched pair is cut into at least this many pieces, evenly by arc length (default 24). */
  detail?: number
}

/** One matched pair of subpaths with identical layouts: coords of the same length, interpolated number by number. */
export interface MorphPair { from: number[]; to: number[]; closed: boolean }

/** Precomputed morph between two paths, from morphPlan(); plain data, safe to cache. */
export interface MorphPlan { pairs: MorphPair[] }

/** Samples per subpath used to choose direction and start point. */
const SAMPLES = 64
/** Knots closer than this (as a fraction of the length) are one knot. */
const KNOT_EPS = 1e-9

interface Measured { sp: Subpath; cum: number[]; total: number }

function measure(sp: Subpath): Measured {
  const n = segmentCount(sp)
  const cum = new Array<number>(n + 1)
  cum[0] = 0
  for (let j = 0; j < n; j++) cum[j + 1] = cum[j] + cubicLength(sp.coords, 6 * j)
  return { sp, cum, total: cum[n] }
}

/** Longest first; lengths within 1e-9 of each other keep their authored order. */
function byLength(subpaths: Subpath[]): Measured[] {
  const list: Measured[] = []
  for (const sp of usable(subpaths)) list.push(measure(sp))
  return list.sort((p, q) => (Math.abs(p.total - q.total) <= 1e-9 * Math.max(p.total, q.total) ? 0 : q.total - p.total))
}

const scratch: Vec2 = [0, 0]

/** count points evenly spaced by arc length, as [x, y, …]: fractions j / count when cyclic, j / (count - 1) otherwise. */
function sample(m: Measured, count: number, cyclic: boolean): Float64Array {
  const out = new Float64Array(2 * count)
  const c = m.sp.coords, cum = m.cum, last = cum.length - 2
  let seg = 0
  for (let j = 0; j < count; j++) {
    const s = (cyclic ? j / count : j / (count - 1)) * m.total
    while (seg < last && cum[seg + 1] < s) seg++
    const t = cubicParamAtLength(c, 6 * seg, s - cum[seg], cum[seg + 1] - cum[seg])
    cubicPoint(c, 6 * seg, t, scratch)
    out[2 * j] = scratch[0]
    out[2 * j + 1] = scratch[1]
  }
  return out
}

/** Subtract the mean in place; returns the sum of squared norms. */
function centre(p: Float64Array): number {
  const n = p.length / 2
  let mx = 0, my = 0
  for (let i = 0; i < n; i++) { mx += p[2 * i]; my += p[2 * i + 1] }
  mx /= n; my /= n
  let energy = 0
  for (let i = 0; i < n; i++) {
    p[2 * i] -= mx; p[2 * i + 1] -= my
    energy += p[2 * i] * p[2 * i] + p[2 * i + 1] * p[2 * i + 1]
  }
  return energy
}

function signedArea(p: Float64Array): number {
  const n = p.length / 2
  let area = 0
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1
    area += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]
  }
  return area / 2
}

/** Candidate start offsets in order of increasing rotation: 0, 1, n-1, 2, n-2, … */
const nearestFirst = (j: number, n: number): number => (j === 0 ? 0 : j & 1 ? (j + 1) >> 1 : n - (j >> 1))

// Result slots of the alignment searches.
let bestShift = 0, bestDirection = 1, bestScore = 0

/** Cyclic shift and direction of ring b that best match ring a (largest centred correlation); ties keep the smallest rotation. */
function alignRings(a: Float64Array, b: Float64Array, directions: number, margin: number): void {
  const n = a.length / 2
  bestShift = 0; bestDirection = 1; bestScore = -Infinity
  for (let pass = 0; pass < 2; pass++) {
    const direction = pass === 0 ? 1 : -1
    if (directions !== 0 && directions !== direction) continue
    for (let j = 0; j < n; j++) {
      const k = nearestFirst(j, n)
      let score = 0
      let q = k
      for (let i = 0; i < n; i++) {
        score += a[2 * i] * b[2 * q] + a[2 * i + 1] * b[2 * q + 1]
        q += direction
        if (q === n) q = 0; else if (q < 0) q = n - 1
      }
      if (score > bestScore + margin) { bestScore = score; bestShift = k; bestDirection = direction }
    }
  }
}

/** Where to open ring (n points) and which way to walk it so it best matches the open line (n + 1 points). */
function alignRingToLine(ring: Float64Array, line: Float64Array, margin: number): void {
  const n = ring.length / 2
  bestShift = 0; bestDirection = 1; bestScore = -Infinity
  for (let pass = 0; pass < 2; pass++) {
    const direction = pass === 0 ? 1 : -1
    for (let j = 0; j < n; j++) {
      const k = nearestFirst(j, n)
      let score = 0
      let q = k
      for (let i = 0; i <= n; i++) {
        score += line[2 * i] * ring[2 * q] + line[2 * i + 1] * ring[2 * q + 1]
        q += direction
        if (q === n) q = 0; else if (q < 0) q = n - 1
      }
      if (score > bestScore + margin) { bestScore = score; bestShift = k; bestDirection = direction }
    }
  }
}

/** The same curve walked the other way (a closed subpath keeps its start point). */
function reversed(sp: Subpath): Subpath {
  const c = sp.coords, n = c.length
  const coords = new Array<number>(n)
  for (let i = 0; i < n; i += 2) {
    coords[i] = c[n - 2 - i]
    coords[i + 1] = c[n - 1 - i]
  }
  return { coords, closed: sp.closed }
}

/** A closed subpath restarted at the given fraction of its length (snapped to an anchor closer than `snap`). */
function restarted(m: Measured, fraction: number, snap: number): Subpath {
  const { sp, cum, total } = m
  const c = sp.coords, n = cum.length - 1
  let anchor = -1, nearest = snap
  for (let j = 0; j <= n; j++) {
    const gap = Math.abs(cum[j] / total - fraction)
    if (gap <= nearest) { nearest = gap; anchor = j }
  }
  if (anchor === 0 || anchor === n) return sp
  const coords: number[] = []
  if (anchor > 0) {
    for (let i = 6 * anchor; i < c.length; i++) coords.push(c[i])
    for (let i = 2; i < 6 * anchor + 2; i++) coords.push(c[i])
    return { coords, closed: true }
  }
  const s = fraction * total
  let seg = 0
  while (seg < n - 1 && cum[seg + 1] <= s) seg++
  const t = cubicParamAtLength(c, 6 * seg, s - cum[seg], cum[seg + 1] - cum[seg])
  cubicPoint(c, 6 * seg, t, scratch)
  coords.push(scratch[0], scratch[1])
  appendSubCubic(c, 6 * seg, t, 1, coords)
  for (let i = 6 * seg + 8; i < c.length; i++) coords.push(c[i])
  for (let i = 2; i < 6 * seg + 2; i++) coords.push(c[i])
  appendSubCubic(c, 6 * seg, 0, t, coords)
  coords[coords.length - 2] = coords[0]
  coords[coords.length - 1] = coords[1]
  return { coords, closed: true }
}

/** Re-open and/or reverse one of the two subpaths so that matching them by arc length moves points the least. */
function orient(a: Measured, b: Measured): [Measured, Measured] {
  const snap = 0.5 / SAMPLES
  if (a.sp.closed && b.sp.closed) {
    const pa = sample(a, SAMPLES, true), pb = sample(b, SAMPLES, true)
    const areaA = signedArea(pa), areaB = signedArea(pb)
    const flat = 1e-9 * Math.max(a.total * a.total, b.total * b.total)
    // same winding when both have one; a shape without area (a line traced there and back) may go either way
    const directions = Math.abs(areaA) > flat && Math.abs(areaB) > flat ? (areaA > 0 === areaB > 0 ? 1 : -1) : 0
    const margin = 1e-9 * (centre(pa) + centre(pb))
    alignRings(pa, pb, directions, margin)
    let sp = bestShift === 0 ? b.sp : restarted(b, bestShift / SAMPLES, snap)
    if (bestDirection < 0) sp = reversed(sp)
    return [a, sp === b.sp ? b : measure(sp)]
  }
  if (a.sp.closed !== b.sp.closed) {
    const ring = a.sp.closed ? a : b, line = a.sp.closed ? b : a
    const pr = sample(ring, SAMPLES, true), pl = sample(line, SAMPLES + 1, false)
    const margin = 1e-9 * (centre(pr) + centre(pl))
    alignRingToLine(pr, pl, margin)
    let sp = bestShift === 0 ? ring.sp : restarted(ring, bestShift / SAMPLES, snap)
    if (bestDirection < 0) sp = reversed(sp)
    const turned = sp === ring.sp ? ring : measure(sp)
    return a.sp.closed ? [turned, b] : [a, turned]
  }
  const pa = sample(a, SAMPLES, false), pb = sample(b, SAMPLES, false)
  const margin = 1e-9 * (centre(pa) + centre(pb))
  let forward = 0, backward = 0
  for (let i = 0; i < SAMPLES; i++) {
    const r = SAMPLES - 1 - i
    forward += pa[2 * i] * pb[2 * i] + pa[2 * i + 1] * pb[2 * i + 1]
    backward += pa[2 * i] * pb[2 * r] + pa[2 * i + 1] * pb[2 * r + 1]
  }
  return backward > forward + margin ? [a, measure(reversed(b.sp))] : [a, b]
}

/** Shared knots in [0, 1]: every anchor of both subpaths, then even cuts so no span exceeds 1 / detail. */
function sharedKnots(a: Measured, b: Measured, detail: number): number[] {
  const raw: number[] = []
  for (const m of [a, b]) if (m.total > 0) for (let j = 0; j < m.cum.length; j++) raw.push(m.cum[j] / m.total)
  raw.push(0, 1)
  raw.sort((p, q) => p - q)
  const anchors: number[] = [0]
  for (let i = 1; i < raw.length; i++) if (raw[i] - anchors[anchors.length - 1] > KNOT_EPS) anchors.push(raw[i])
  anchors[anchors.length - 1] = 1
  const knots: number[] = [0]
  for (let i = 1; i < anchors.length; i++) {
    const u0 = anchors[i - 1], u1 = anchors[i]
    const pieces = Math.max(1, Math.ceil((u1 - u0) * detail - 1e-9))
    for (let q = 1; q < pieces; q++) knots.push(u0 + ((u1 - u0) * q) / pieces)
    knots.push(u1)
  }
  return knots
}

/** The subpath cut at every knot: exactly knots.length - 1 cubics tracing the same curve. */
function cutAtKnots(m: Measured, knots: number[]): number[] {
  const { sp, cum, total } = m
  const c = sp.coords, n = cum.length - 1, last = knots.length - 1
  const out: number[] = [c[0], c[1]]
  if (!(total > 0)) {
    for (let k = 0; k < last; k++) out.push(c[0], c[1], c[0], c[1], c[0], c[1])
    return out
  }
  let k = 0
  for (let j = 0; j < n; j++) {
    const i = 6 * j
    let end = k
    if (j === n - 1) end = last
    else {
      const fraction = cum[j + 1] / total
      while (end < last && knots[end + 1] <= fraction) end++
    }
    const pieces = end - k
    if (pieces === 1) out.push(c[i + 2], c[i + 3], c[i + 4], c[i + 5], c[i + 6], c[i + 7])
    else if (pieces > 1) {
      const length = cum[j + 1] - cum[j]
      let t0 = 0
      for (let q = k + 1; q < end; q++) {
        const t1 = cubicParamAtLength(c, i, knots[q] * total - cum[j], length)
        appendSubCubic(c, i, t0, t1, out)
        t0 = t1
      }
      appendSubCubic(c, i, t0, 1, out)
    }
    k = end
  }
  if (sp.closed) {
    out[out.length - 2] = out[0]
    out[out.length - 1] = out[1]
  }
  return out
}

/** The mean of evenly spaced points on the subpath, repeated to fill `length` numbers. */
function collapsed(m: Measured, length: number): number[] {
  let x = m.sp.coords[0], y = m.sp.coords[1]
  if (m.total > 0) {
    const p = sample(m, SAMPLES, true)
    x = 0; y = 0
    for (let i = 0; i < SAMPLES; i++) { x += p[2 * i]; y += p[2 * i + 1] }
    x /= SAMPLES; y /= SAMPLES
  }
  const out = new Array<number>(length)
  for (let i = 0; i < length; i += 2) { out[i] = x; out[i + 1] = y }
  return out
}

function planPair(a: Measured | undefined, b: Measured | undefined, align: boolean, detail: number): MorphPair {
  // an unmatched subpath grows from, or shrinks to, its own centre
  if (!a || !b) {
    const only = (a ?? b) as Measured
    const whole = only.sp.coords.slice()
    const point = collapsed(only, whole.length)
    return a ? { from: whole, to: point, closed: only.sp.closed } : { from: point, to: whole, closed: only.sp.closed }
  }
  if (align && a.total > 0 && b.total > 0) [a, b] = orient(a, b)
  const knots = sharedKnots(a, b, detail)
  return { from: cutAtKnots(a, knots), to: cutAtKnots(b, knots), closed: a.sp.closed && b.sp.closed }
}

/** Plan a morph between two paths: pair subpaths longest-first, align direction and start point to minimise travel, and cut both at shared arc-length knots (all anchors of both, so corners stay sharp). */
export function morphPlan(from: Subpath[], to: Subpath[], options: MorphOptions = {}): MorphPlan {
  const align = options?.align !== false
  const requested = options?.detail
  const detail = typeof requested === 'number' && requested >= 1 ? Math.min(Math.round(requested), 512) : 24
  const a = byLength(from), b = byLength(to)
  const pairs: MorphPair[] = []
  const count = Math.max(a.length, b.length)
  for (let k = 0; k < count; k++) pairs.push(planPair(a[k], b[k], align, detail))
  return { pairs }
}

/**
 * The morph at progress u (already eased; 0 = from, 1 = to, values outside extrapolate). pathArcDeg bends every
 * point's route into a circular arc of that angle (manim's path_arc); pass `out` (a previous result) to reuse it.
 */
export function morphAt(plan: MorphPlan, u: number, pathArcDeg = 0, out: Subpath[] = []): Subpath[] {
  if (!Array.isArray(out)) out = []
  const t = u === u ? u : 0
  const pairs = plan && Array.isArray(plan.pairs) ? plan.pairs : []
  const theta = pathArcDeg === pathArcDeg ? pathArcDeg * RAD : 0
  const straight = Math.abs(theta) < 1e-6 || t === 0 || t === 1
  const s = 1 - t
  let cotHalf = 0, cosT = 1, sinT = 0
  if (!straight) {
    cotHalf = 1 / Math.tan(theta / 2)
    cosT = Math.cos(t * theta)
    sinT = Math.sin(t * theta)
  }
  out.length = pairs.length
  for (let k = 0; k < pairs.length; k++) {
    const pair = pairs[k], a = pair.from, b = pair.to
    const n = a.length
    let target = out[k]
    if (!target || !Array.isArray(target.coords)) target = out[k] = { coords: new Array<number>(n), closed: pair.closed }
    else target.closed = pair.closed
    const o = target.coords
    if (o.length !== n) o.length = n
    if (straight) {
      for (let i = 0; i < n; i++) o[i] = s * a[i] + t * b[i]
    } else {
      for (let i = 0; i < n; i += 2) {
        const ax = a[i], ay = a[i + 1]
        const hx = (b[i] - ax) / 2, hy = (b[i + 1] - ay) / 2
        const cx = ax + hx - hy * cotHalf, cy = ay + hy + hx * cotHalf // centre of this point's arc
        const rx = ax - cx, ry = ay - cy
        o[i] = cx + cosT * rx - sinT * ry
        o[i + 1] = cy + cosT * ry + sinT * rx
      }
    }
  }
  return out
}
