/**
 * Shapes from maths: an outline is a formula, sampled into points. With these a profile is written the way it is
 * defined (the epitrochoid of a rotary housing, the lobe of a cam, a wall that is the same curve a little further
 * out), instead of a loop that pushes numbers into a list.
 *
 * Pure maths. No DOM, no three.js, no runtime APIs. Nothing throws: a formula that fails, or gives a value that is
 * not finite, leaves that point out; what is then drawn from too few points says so itself.
 *
 * The parameter of a formula is the author's own. It runs from `from` to `to`, and the default is one full turn in
 * RADIANS (0 to 2π): what Math.cos and Math.sin take. Angles that the ENGINE takes (`turn`, a joint, a rotation)
 * are degrees, as everywhere else.
 */
import { polygonArea } from './profiles.ts'
import type { Vec2 } from './types.ts'

/** one full turn, in radians: the default range of a formula's parameter */
export const FULL_TURN = 2 * Math.PI
/** points a formula is sampled at when nobody says */
export const CURVE_SAMPLES = 120
/** a corner of an outline that is grown is moved at most this many times the distance (a sharp corner would shoot out) */
export const OUTSET_MITER = 4

export interface CurveOptions {
  /** where the parameter starts and ends (default 0 and 2π) */
  from?: number
  to?: number
  /** how many points (default CURVE_SAMPLES) */
  samples?: number
  /** true = an outline: the last point is not the first one again. Default: true for one full turn, else false. */
  closed?: boolean
}

type PointsIn = readonly (readonly number[])[]

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const pointOf = (v: unknown): Vec2 | null => {
  if (Array.isArray(v) && finite(v[0]) && finite(v[1])) return [v[0], v[1]]
  if (v !== null && typeof v === 'object' && finite((v as { x?: unknown }).x) && finite((v as { y?: unknown }).y)) return [(v as { x: number }).x, (v as { y: number }).y]
  return null
}
const clean = (points: unknown): Vec2[] => (Array.isArray(points) ? points.map(pointOf).filter((p): p is Vec2 => p !== null) : [])

/** The values of the parameter a formula is sampled at. */
export function parameters(o: CurveOptions = {}): { values: number[]; closed: boolean } {
  const from = finite(o.from) ? o.from : 0
  const to = finite(o.to) ? o.to : from + FULL_TURN
  const closed = typeof o.closed === 'boolean' ? o.closed : Math.abs(Math.abs(to - from) - FULL_TURN) < 1e-9
  const n = finite(o.samples) && o.samples >= 2 ? Math.round(o.samples) : CURVE_SAMPLES
  const last = closed ? n : n - 1
  return { values: Array.from({ length: n }, (_, i) => from + ((to - from) * i) / last), closed }
}

/**
 * A curve from its formula: `curve((t) => [x, y])`. One full turn of `t` (0 to 2π) by default, which closes it:
 * `curve((t) => [R * Math.cos(t) + e * Math.cos(3 * t), R * Math.sin(t) + e * Math.sin(3 * t)])` is an epitrochoid.
 * An open stretch names its ends: `curve((x) => [x, Math.sin(x)], { from: 0, to: 10 })`.
 */
export function curve(formula: (t: number) => readonly number[] | { x: number; y: number }, opts: CurveOptions = {}): Vec2[] {
  if (typeof formula !== 'function') return []
  const out: Vec2[] = []
  for (const t of parameters(opts).values) {
    let p: Vec2 | null = null
    try { p = pointOf(formula(t)) } catch { p = null }
    if (p) out.push(p)
  }
  return out
}

/**
 * An outline from its radius at every angle: `polar((a) => 1 + 0.2 * Math.cos(3 * a))` is a rounded triangle.
 * `a` is in radians and makes one full turn by default.
 */
export function polar(radius: (angle: number) => number, opts: CurveOptions = {}): Vec2[] {
  if (typeof radius !== 'function') return []
  return curve((a) => { const r = radius(a); return [r * Math.cos(a), r * Math.sin(a)] }, opts)
}

/**
 * The same outline, `distance` further out all the way round (further in when it is negative): the wall of a
 * casing is `extrude(outset(chamber, 0.3), { holes: [chamber] })`. The points stay in their order.
 */
export function outset(points: PointsIn, distance: number): Vec2[] {
  const p = clean(points)
  const n = p.length
  if (n < 3 || !finite(distance) || distance === 0) return p
  // outward is to the right of the way round for a counter-clockwise outline, to the left for a clockwise one
  const side = polygonArea(p) >= 0 ? 1 : -1
  const normal = (a: Vec2, b: Vec2): Vec2 | null => { const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy); return len > 1e-12 ? [(side * dy) / len, (-side * dx) / len] : null }
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const here = p[i]!
    // the edges that meet here (a point that repeats has no edge of its own: look further)
    let before: Vec2 | null = null, after: Vec2 | null = null
    for (let k = 1; k < n && !before; k++) before = normal(p[(i - k + n) % n]!, here)
    for (let k = 1; k < n && !after; k++) after = normal(here, p[(i + k) % n]!)
    if (!before || !after) { out.push([here[0], here[1]]); continue }
    // both edges move out by `distance`: the corner goes along their bisector, further the sharper it is
    const reach = Math.max(1 / OUTSET_MITER, 1 + before[0] * after[0] + before[1] * after[1])
    out.push([here[0] + (distance * (before[0] + after[0])) / reach, here[1] + (distance * (before[1] + after[1])) / reach])
  }
  return out
}

/**
 * An outline where a pose puts it: turned by `turn` DEGREES (counter-clockwise, about the origin of the outline),
 * then moved to `at`. A pose is what a 'follows' joint answers, so the outline of a part can be asked for at any
 * value of a control: `moved(rotor, pose(c))`.
 */
export function moved(points: PointsIn, pose: { at?: readonly number[]; turn?: number } = {}): Vec2[] {
  const a = ((finite(pose?.turn) ? pose.turn : 0) * Math.PI) / 180
  const cos = Math.cos(a), sin = Math.sin(a)
  const at = pointOf(pose?.at) ?? [0, 0]
  return clean(points).map(([x, y]) => [at[0] + x * cos - y * sin, at[1] + x * sin + y * cos])
}

/** The area an outline encloses (never negative, whichever way round it is drawn). */
export function areaOf(points: PointsIn): number {
  const p = clean(points)
  return p.length < 3 ? 0 : Math.abs(polygonArea(p))
}

/**
 * The area between two stretches of curve that run from one meeting point to the other (the chamber between a wall
 * and a flank). Either may be drawn in either direction: they are joined the way that closes with the smaller gap.
 */
export function areaBetween(a: PointsIn, b: PointsIn): number {
  const p = clean(a), q = clean(b)
  if (p.length < 2 || q.length < 2) return 0
  const gap = (u: Vec2, v: Vec2): number => Math.hypot(u[0] - v[0], u[1] - v[1])
  const first = p[0]!, last = p[p.length - 1]!
  const turned = gap(last, q[q.length - 1]!) + gap(q[0]!, first) <= gap(last, q[0]!) + gap(q[q.length - 1]!, first)
  return areaOf([...p, ...(turned ? q.slice().reverse() : q)])
}

/** The length of a curve; `closed: true` adds the way back to its start (the perimeter of an outline). */
export function lengthOf(points: PointsIn, closed = false): number {
  const p = clean(points)
  let total = 0
  for (let i = 1; i < p.length; i++) total += Math.hypot(p[i]![0] - p[i - 1]![0], p[i]![1] - p[i - 1]![1])
  if (closed && p.length > 2) total += Math.hypot(p[0]![0] - p[p.length - 1]![0], p[0]![1] - p[p.length - 1]![1])
  return total
}
