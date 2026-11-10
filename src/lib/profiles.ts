/**
 * 2D / 3D profiles for a parametric parts kit: gear and rack outlines, cam lobes, lathe profiles, paths.
 *
 * Pure maths. No DOM, no three.js, no runtime APIs. Angles are in DEGREES, counter-clockwise positive.
 *
 * Conventions
 * - Closed polygons (`Vec2[]`) are counter-clockwise and do NOT repeat the first point.
 * - Lathe profiles are polylines of [radius, height] revolved about the vertical axis. The lowest point is at
 *   height 0. They run counter-clockwise in the (radius, height) plane (up the outside), which gives outward
 *   normals in a standard lathe. Solid parts start and end on the axis (radius 0). Ring-shaped parts (bearing
 *   races, a pulley with a bore) are closed loops and DO repeat the first point so the surface closes.
 * - Nothing throws. Non-finite or non-positive sizes give an empty array.
 */
import type { Vec2, Vec3 } from './types.ts'

const RAD = Math.PI / 180
const TAU = Math.PI * 2
/** Arcs inside generated outlines get a point at least every this many degrees. */
const ARC_STEP = 6

type Point = Vec2 | Vec3

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function count(value: number | undefined, fallback: number, least: number): number {
  return Math.max(least, Math.round(finite(value, fallback)))
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value
}

/** Drop consecutive points that coincide (and a last point equal to the first when `closed`). */
function dedupe<P extends number[]>(points: P[], closed: boolean): P[] {
  const out: P[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last === undefined || !samePoint(last, p)) out.push(p)
  }
  if (closed) while (out.length > 1 && samePoint(out[0] as P, out[out.length - 1] as P)) out.pop()
  return out
}

function samePoint(a: readonly number[], b: readonly number[]): boolean {
  let d2 = 0
  let scale = 1
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] as number) - (b[i] as number)
    d2 += d * d
    scale = Math.max(scale, Math.abs(a[i] as number))
  }
  return d2 <= 1e-20 * scale * scale
}

/** Append points of a circular arc from angle a0 to a1 (radians), end points included or not. */
function pushArc(
  out: Vec2[],
  cx: number,
  cy: number,
  radius: number,
  a0: number,
  a1: number,
  segments: number,
  includeStart: boolean,
  includeEnd: boolean,
): void {
  const first = includeStart ? 0 : 1
  const last = includeEnd ? segments : segments - 1
  for (let i = first; i <= last; i++) {
    const a = a0 + ((a1 - a0) * i) / segments
    out.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)])
  }
}

function arcSegments(spanRadians: number, perTurn: number): number {
  return Math.max(1, Math.ceil((Math.abs(spanRadians) / TAU) * perTurn - 1e-9))
}

/** An even segment count, so a symmetric arc has a point exactly on its axis of symmetry. */
function evenSegments(spanRadians: number, perTurn: number): number {
  return 2 * Math.ceil(0.5 * arcSegments(spanRadians, perTurn))
}

// ── polygons ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Signed area of a polygon: positive when counter-clockwise. */
export function polygonArea(points: readonly Vec2[]): number {
  const n = points.length
  let twice = 0
  for (let i = 0; i < n; i++) {
    const a = points[i] as Vec2
    const b = points[(i + 1) % n] as Vec2
    twice += a[0] * b[1] - b[0] * a[1]
  }
  return 0.5 * twice
}

/** Winding of a polygon: 1 counter-clockwise, −1 clockwise, 0 degenerate. */
export function polygonWinding(points: readonly Vec2[]): 1 | -1 | 0 {
  const area = polygonArea(points)
  return area > 0 ? 1 : area < 0 ? -1 : 0
}

/** Area centroid of a polygon (average of the points when the area is zero). */
export function polygonCentroid(points: readonly Vec2[]): Vec2 {
  const n = points.length
  if (n === 0) return [0, 0]
  let twice = 0
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  for (let i = 0; i < n; i++) {
    const a = points[i] as Vec2
    const b = points[(i + 1) % n] as Vec2
    const w = a[0] * b[1] - b[0] * a[1]
    twice += w
    cx += (a[0] + b[0]) * w
    cy += (a[1] + b[1]) * w
    sx += a[0]
    sy += a[1]
  }
  if (Math.abs(twice) < 1e-300) return [sx / n, sy / n]
  return [cx / (3 * twice), cy / (3 * twice)]
}

/** The same polygon wound counter-clockwise (returns the input array itself when it already is). */
export function counterClockwise(points: Vec2[]): Vec2[] {
  return polygonArea(points) < 0 ? points.slice().reverse() : points
}

/** true when the point is inside the polygon (even-odd rule; points exactly on the edge are unspecified). */
export function pointInPolygon(point: Vec2, polygon: readonly Vec2[]): boolean {
  const n = polygon.length
  const x = point[0]
  const y = point[1]
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = polygon[i] as Vec2
    const b = polygon[j] as Vec2
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

function cross(o: Vec2, a: Vec2, b: Vec2): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

function withinBox(a: Vec2, b: Vec2, p: Vec2): boolean {
  return (
    p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1])
  )
}

function segmentsTouch(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  if (d1 === 0 && withinBox(c, d, a)) return true
  if (d2 === 0 && withinBox(c, d, b)) return true
  if (d3 === 0 && withinBox(a, b, c)) return true
  if (d4 === 0 && withinBox(a, b, d)) return true
  return false
}

/** true when no two edges of the polygon touch or cross (apart from neighbours sharing a corner). O(n²). */
export function isSimplePolygon(points: readonly Vec2[]): boolean {
  const n = points.length
  if (n < 3) return false
  for (let i = 0; i < n; i++) {
    const a = points[i] as Vec2
    const b = points[(i + 1) % n] as Vec2
    if (a[0] === b[0] && a[1] === b[1]) return false
    // the next edge must not fold straight back over this one
    const next = points[(i + 2) % n] as Vec2
    if (cross(a, b, next) === 0 && (a[0] - b[0]) * (next[0] - b[0]) + (a[1] - b[1]) * (next[1] - b[1]) > 0) return false
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      if (segmentsTouch(a, b, points[j] as Vec2, points[(j + 1) % n] as Vec2)) return false
    }
  }
  return true
}

/** Largest projection of the points on a direction (degrees): the support function a flat cam follower rides on. */
export function supportDistance(points: readonly Vec2[], angle: number): number {
  const ux = Math.cos(angle * RAD)
  const uy = Math.sin(angle * RAD)
  let best = -Infinity
  for (const p of points) {
    const s = p[0] * ux + p[1] * uy
    if (s > best) best = s
  }
  return points.length > 0 ? best : 0
}

// ── circles, arcs, rectangles ────────────────────────────────────────────────────────────────────────────────

/** Points along a circular arc from angle `from` to `to` (degrees), both ends included. */
export function arcPoints({
  radius,
  from,
  to,
  center = [0, 0],
  samples,
}: {
  radius: number
  from: number
  to: number
  center?: Vec2
  samples?: number
}): Vec2[] {
  if (!Number.isFinite(radius) || !Number.isFinite(from) || !Number.isFinite(to)) return []
  const n = samples === undefined ? Math.max(2, Math.ceil(Math.abs(to - from) / ARC_STEP) + 1) : count(samples, 2, 2)
  const out: Vec2[] = []
  pushArc(out, center[0], center[1], radius, from * RAD, to * RAD, n - 1, true, true)
  return out
}

/** A circle as a closed counter-clockwise polygon starting at angle 0. */
export function circleProfile({ radius, center = [0, 0], samples = 48 }: { radius: number; center?: Vec2; samples?: number }): Vec2[] {
  if (!(radius > 0) || !Number.isFinite(radius)) return []
  const n = count(samples, 48, 3)
  const out: Vec2[] = []
  pushArc(out, center[0], center[1], radius, 0, TAU, n, true, false)
  return out
}

/** A rectangle with rounded corners, centred on `center`, as a closed counter-clockwise polygon. */
export function roundedRect({
  width,
  height,
  radius = 0,
  center = [0, 0],
  samples = 6,
}: {
  width: number
  height: number
  radius?: number
  center?: Vec2
  samples?: number
}): Vec2[] {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return []
  const hw = 0.5 * width
  const hh = 0.5 * height
  const r = clamp(finite(radius, 0), 0, Math.min(hw, hh))
  const cx = center[0]
  const cy = center[1]
  if (r <= 0) {
    return [
      [cx + hw, cy - hh],
      [cx + hw, cy + hh],
      [cx - hw, cy + hh],
      [cx - hw, cy - hh],
    ]
  }
  const n = count(samples, 6, 1)
  const out: Vec2[] = []
  const quarter = 0.5 * Math.PI
  pushArc(out, cx + hw - r, cy - hh + r, r, -quarter, 0, n, true, true)
  pushArc(out, cx + hw - r, cy + hh - r, r, 0, quarter, n, true, true)
  pushArc(out, cx - hw + r, cy + hh - r, r, quarter, 2 * quarter, n, true, true)
  pushArc(out, cx - hw + r, cy - hh + r, r, 2 * quarter, 3 * quarter, n, true, true)
  return dedupe(out, true)
}

/** The circle through three points, or null when they are on one line. */
export function circleThrough(a: Vec2, b: Vec2, c: Vec2): { center: Vec2; radius: number } | null {
  const bx = b[0] - a[0]
  const by = b[1] - a[1]
  const cx = c[0] - a[0]
  const cy = c[1] - a[1]
  const d = 2 * (bx * cy - by * cx)
  const scale = Math.max(Math.abs(bx), Math.abs(by), Math.abs(cx), Math.abs(cy))
  if (!(Math.abs(d) > 1e-12 * scale * scale)) return null
  const b2 = bx * bx + by * by
  const c2 = cx * cx + cy * cy
  const ux = (cy * b2 - by * c2) / d
  const uy = (bx * c2 - cx * b2) / d
  return { center: [a[0] + ux, a[1] + uy], radius: Math.hypot(ux, uy) }
}

// ── paths ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Cumulative length at each point of a path, starting with 0 (one extra entry for the closing edge when closed). */
export function pathLengths(path: readonly Point[], closed = false): number[] {
  const n = path.length
  const out: number[] = n > 0 ? [0] : []
  let total = 0
  const edges = closed && n > 1 ? n : n - 1
  for (let i = 0; i < edges; i++) {
    const a = path[i] as Point
    const b = path[(i + 1) % n] as Point
    let d2 = 0
    for (let k = 0; k < a.length; k++) {
      const d = (b[k] as number) - (a[k] as number)
      d2 += d * d
    }
    total += Math.sqrt(d2)
    out.push(total)
  }
  return out
}

/** Total length of a path of 2D or 3D points. */
export function pathLength(path: readonly Point[], closed = false): number {
  const lengths = pathLengths(path, closed)
  return lengths.length > 0 ? (lengths[lengths.length - 1] as number) : 0
}

/**
 * Point and unit tangent at fraction u (0 = start, 1 = end) of a path's length. u is clamped (wrapped when closed).
 * Pass `lengths` from pathLengths(path, closed) when sampling the same path many times.
 */
export function pointAlong<P extends Point>(
  path: readonly P[],
  u: number,
  options?: { closed?: boolean; lengths?: readonly number[] },
): { point: P; tangent: P } {
  const n = path.length
  const dimension = n > 0 ? (path[0] as P).length : 2
  const forward = (): P => {
    const axis = new Array<number>(dimension).fill(0)
    axis[0] = 1
    return axis as P
  }
  if (n === 0) return { point: new Array<number>(dimension).fill(0) as P, tangent: forward() }
  const closed = options?.closed === true
  const lengths = options?.lengths ?? pathLengths(path, closed)
  const edges = lengths.length - 1
  const total = edges > 0 ? (lengths[edges] as number) : 0
  if (n === 1 || !(total > 0)) return { point: (path[0] as P).slice() as P, tangent: forward() }
  let f = Number.isFinite(u) ? u : 0
  if (closed) {
    f -= Math.floor(f)
  } else {
    f = clamp(f, 0, 1)
  }
  const s = f * total
  let low = 0
  let high = edges - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if ((lengths[mid] as number) <= s) low = mid
    else high = mid - 1
  }
  while (low < edges - 1 && !((lengths[low + 1] as number) > (lengths[low] as number))) low++
  while (low > 0 && !((lengths[low + 1] as number) > (lengths[low] as number))) low--
  const a = path[low % n] as P
  const b = path[(low + 1) % n] as P
  const span = (lengths[low + 1] as number) - (lengths[low] as number)
  const t = span > 0 ? clamp((s - (lengths[low] as number)) / span, 0, 1) : 0
  const point = new Array<number>(dimension)
  const tangent = new Array<number>(dimension)
  for (let k = 0; k < dimension; k++) {
    const d = (b[k] as number) - (a[k] as number)
    point[k] = (a[k] as number) + d * t
    tangent[k] = span > 0 ? d / span : k === 0 ? 1 : 0
  }
  return { point: point as P, tangent: tangent as P }
}

/**
 * Round the corners of a polyline with circular arcs (pipes, wires). `radius` shrinks automatically where a
 * segment is too short. `samples` = segments per corner. Works for 2D and 3D points; `closed` rounds every corner.
 */
export function smoothPath<P extends Point>(
  points: readonly P[],
  { radius, samples = 6, closed = false }: { radius: number; samples?: number; closed?: boolean },
): P[] {
  const n = points.length
  const copy = (p: P): P => p.slice() as P
  if (n < 3 || !(radius > 0) || !Number.isFinite(radius)) return dedupe(points.map(copy), closed)
  const segments = count(samples, 6, 1)
  const dimension = (points[0] as P).length
  const out: P[] = []
  const u = new Array<number>(dimension)
  const v = new Array<number>(dimension)
  for (let i = 0; i < n; i++) {
    const current = points[i] as P
    if (!closed && (i === 0 || i === n - 1)) {
      out.push(copy(current))
      continue
    }
    const before = points[(i - 1 + n) % n] as P
    const after = points[(i + 1) % n] as P
    let lengthU = 0
    let lengthV = 0
    for (let k = 0; k < dimension; k++) {
      u[k] = (before[k] as number) - (current[k] as number)
      v[k] = (after[k] as number) - (current[k] as number)
      lengthU += (u[k] as number) * (u[k] as number)
      lengthV += (v[k] as number) * (v[k] as number)
    }
    lengthU = Math.sqrt(lengthU)
    lengthV = Math.sqrt(lengthV)
    if (!(lengthU > 0) || !(lengthV > 0)) {
      out.push(copy(current))
      continue
    }
    let cosine = 0
    for (let k = 0; k < dimension; k++) {
      u[k] = (u[k] as number) / lengthU
      v[k] = (v[k] as number) / lengthV
      cosine += (u[k] as number) * (v[k] as number)
    }
    if (!(Math.abs(cosine) < 1 - 1e-9)) {
      out.push(copy(current)) // straight through, or a full reversal: nothing to round
      continue
    }
    const half = 0.5 * Math.acos(cosine) // half the angle between the two legs
    // a leg shared with another rounded corner can give up only half of its length
    const roomU = !closed && i === 1 ? lengthU : 0.5 * lengthU
    const roomV = !closed && i === n - 2 ? lengthV : 0.5 * lengthV
    const cut = Math.min(radius / Math.tan(half), roomU, roomV)
    const fillet = cut * Math.tan(half)
    const toCenter = fillet / Math.sin(half)
    let bisector = 0
    for (let k = 0; k < dimension; k++) bisector += ((u[k] as number) + (v[k] as number)) ** 2
    bisector = Math.sqrt(bisector)
    const sweep = Math.PI - 2 * half
    const sinSweep = Math.sin(sweep)
    for (let j = 0; j <= segments; j++) {
      const t = j / segments
      const wa = Math.sin((1 - t) * sweep) / sinSweep
      const wb = Math.sin(t * sweep) / sinSweep
      const p = new Array<number>(dimension)
      for (let k = 0; k < dimension; k++) {
        const c = (current[k] as number) + (((u[k] as number) + (v[k] as number)) / bisector) * toCenter
        const start = (current[k] as number) + (u[k] as number) * cut - c
        const end = (current[k] as number) + (v[k] as number) * cut - c
        p[k] = c + wa * start + wb * end
      }
      out.push(p as P)
    }
  }
  return dedupe(out, closed)
}

/** A helix around the vertical (+y) axis from y = 0 to y = length, right-handed, as 3D points (springs, coils). */
export function helixPath({
  radius,
  turns,
  length,
  samples,
  startAngle = 0,
  endRadius,
}: {
  radius: number
  turns: number
  length: number
  samples?: number
  startAngle?: number
  endRadius?: number
}): Vec3[] {
  if (!Number.isFinite(radius) || !Number.isFinite(turns) || !Number.isFinite(length)) return []
  const n = samples === undefined ? Math.max(2, Math.ceil(Math.abs(turns) * 24) + 1) : count(samples, 2, 2)
  const r1 = finite(endRadius, radius)
  const a0 = finite(startAngle, 0) * RAD
  const out: Vec3[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const a = a0 + turns * TAU * t
    const r = radius + (r1 - radius) * t
    out.push([r * Math.cos(a), length * t, -r * Math.sin(a)])
  }
  return out
}

// ── gears ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Options shared by gearProfile and gearDimensions. Lengths are in the units of `module`. */
export interface GearOptions {
  /** Number of teeth (rounded, at least 3). */
  teeth: number
  /** Tooth size: pitch diameter / teeth. Two gears mesh only if their modules are equal. */
  module: number
  /** Pressure angle in degrees (default 20; clamped to 5–35). */
  pressureAngle?: number
  /** Gap left between meshing teeth, measured along the pitch circle; thins this gear's teeth (default 0). */
  backlash?: number
  /** true for a ring gear: the outline is the HOLE (use it as the hole of a disc); teeth point inward. */
  internal?: boolean
  /** Tooth height above the pitch circle, in modules (default 1). */
  addendum?: number
  /** Tooth depth below the pitch circle, in modules (default 1.25). */
  dedendum?: number
  /** Points per involute flank (default 6). */
  samples?: number
}

/** Key radii of a gear. For a ring gear (`internal`) the tip radius is the smaller one. */
export interface GearDimensions {
  teeth: number
  module: number
  pressureAngle: number
  /** module × teeth / 2: the radius two meshing gears roll on. */
  pitchRadius: number
  /** pitchRadius × cos(pressureAngle): where the involute starts. */
  baseRadius: number
  /** Radius of the tooth tips. */
  tipRadius: number
  /** Radius of the bottom of the tooth spaces. */
  rootRadius: number
  /** Distance between neighbouring teeth along the pitch circle: π × module. */
  circularPitch: number
  /** Tooth thickness along the pitch circle: half the circular pitch minus the backlash. */
  toothThickness: number
  /** false when teeth or module are not usable numbers (gearProfile then returns []). */
  valid: boolean
}

/** Pitch, base, tip and root radii of a gear, with the same options (and clamping) as gearProfile. */
export function gearDimensions(options: GearOptions): GearDimensions {
  const valid = Number.isFinite(options.teeth) && options.teeth > 0 && Number.isFinite(options.module) && options.module > 0
  const teeth = valid ? Math.max(3, Math.round(options.teeth)) : 3
  const module = valid ? options.module : 0
  const pressureAngle = clamp(finite(options.pressureAngle, 20), 5, 35)
  const pitchRadius = 0.5 * module * teeth
  const addendum = positive(options.addendum, 1) * module
  const dedendum = positive(options.dedendum, 1.25) * module
  const internal = options.internal === true
  const low = 0.1 * pitchRadius
  const tipRadius = internal ? Math.max(pitchRadius - addendum, low) : pitchRadius + addendum
  const rootRadius = internal ? pitchRadius + dedendum : Math.max(pitchRadius - dedendum, low)
  const circularPitch = Math.PI * module
  const toothThickness = clamp(0.5 * circularPitch - finite(options.backlash, 0), 0.05 * circularPitch, 0.95 * circularPitch)
  return {
    teeth,
    module,
    pressureAngle,
    pitchRadius,
    baseRadius: pitchRadius * Math.cos(pressureAngle * RAD),
    tipRadius,
    rootRadius,
    circularPitch,
    toothThickness,
    valid,
  }
}

/**
 * Involute gear outline centred on the origin with a tooth centred on +x (closed, counter-clockwise).
 * Flanks are true involutes above the base circle and radial below it (no undercut). With `internal: true`
 * the outline is the hole of a ring gear with a ring tooth centred on +x. Pair with meshAngle to place a mate.
 */
export function gearProfile(options: GearOptions): Vec2[] {
  const g = gearDimensions(options)
  if (!g.valid) return []
  const internal = options.internal === true
  const n = g.teeth
  const r = g.pitchRadius
  const rb = g.baseRadius
  const alpha = g.pressureAngle * RAD
  const flankPoints = count(options.samples, 6, 2)
  const pitchAngle = TAU / n
  // The "lobe" is the tooth of an external gear, or the tooth SPACE of a ring gear: the same involute shape.
  const lobeThickness = internal ? g.circularPitch - g.toothThickness : g.toothThickness
  const inner = internal ? g.tipRadius : g.rootRadius
  let outer = internal ? g.rootRadius : g.tipRadius
  const halfAtPitch = lobeThickness / (2 * r)
  const involuteAtPitch = Math.tan(alpha) - alpha
  /** half-angle of the lobe at a given radius */
  const halfAt = (radius: number): number => {
    if (radius <= rb) return halfAtPitch + involuteAtPitch
    const roll = Math.sqrt((radius / rb) * (radius / rb) - 1)
    return halfAtPitch + involuteAtPitch - (roll - Math.atan(roll))
  }
  // A lobe that would come to a point before `outer` is cut off there, leaving a small flat.
  const leastTip = Math.min(0.04 * pitchAngle, 0.5 * halfAtPitch)
  if (halfAt(outer) < leastTip) {
    let low = Math.max(rb, inner)
    let high = outer
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (low + high)
      if (halfAt(mid) > leastTip) low = mid
      else high = mid
    }
    outer = low
  }
  const widest = 0.48 * pitchAngle // neighbouring lobes never touch at the root
  const flank: Vec2[] = [] // [radius, half-angle], root → tip
  if (inner < rb) flank.push([inner, Math.min(halfAt(rb), widest)])
  const rollStart = inner < rb ? 0 : Math.sqrt((inner / rb) * (inner / rb) - 1)
  const rollEnd = outer > rb ? Math.sqrt((outer / rb) * (outer / rb) - 1) : 0
  if (rollEnd > rollStart) {
    for (let i = 0; i < flankPoints; i++) {
      const roll = rollStart + ((rollEnd - rollStart) * i) / (flankPoints - 1)
      const radius = i === flankPoints - 1 ? outer : rb * Math.sqrt(1 + roll * roll)
      flank.push([radius, Math.min(halfAtPitch + involuteAtPitch - (roll - Math.atan(roll)), widest)])
    }
  } else {
    flank.push([outer, Math.min(halfAt(outer), widest)])
  }
  const rootHalf = (flank[0] as Vec2)[1]
  const tipHalf = (flank[flank.length - 1] as Vec2)[1]
  // one lobe centred on angle 0, counter-clockwise: right flank up, tip arc, left flank down, root arc
  const lobe: Vec2[] = []
  for (const [radius, half] of flank) lobe.push([radius * Math.cos(half), -radius * Math.sin(half)])
  pushArc(lobe, 0, 0, outer, -tipHalf, tipHalf, arcSegments(2 * tipHalf, 360 / ARC_STEP), false, false)
  for (let i = flank.length - 1; i >= 0; i--) {
    const [radius, half] = flank[i] as Vec2
    lobe.push([radius * Math.cos(half), radius * Math.sin(half)])
  }
  const rootSpan = pitchAngle - 2 * rootHalf
  pushArc(lobe, 0, 0, inner, rootHalf, rootHalf + rootSpan, arcSegments(rootSpan, 360 / ARC_STEP), false, false)
  const out: Vec2[] = []
  const phase = internal ? 0.5 * pitchAngle : 0
  for (let k = 0; k < n; k++) {
    const c = Math.cos(phase + k * pitchAngle)
    const s = Math.sin(phase + k * pitchAngle)
    for (const p of lobe) out.push([p[0] * c - p[1] * s, p[0] * s + p[1] * c])
  }
  return out
}

/**
 * Straight rack outline (closed, counter-clockwise): teeth point +y, pitch line on y = 0, tooth k centred on
 * x = k × π × module for k = 0 … teeth − 1, body `height` thick below the tooth roots. Pair with rackMesh.
 */
export function rackProfile({
  teeth,
  module,
  pressureAngle = 20,
  backlash = 0,
  height,
  addendum = 1,
  dedendum = 1.25,
}: {
  teeth: number
  module: number
  pressureAngle?: number
  backlash?: number
  height?: number
  addendum?: number
  dedendum?: number
}): Vec2[] {
  if (!(teeth > 0) || !(module > 0) || !Number.isFinite(teeth) || !Number.isFinite(module)) return []
  const n = Math.max(1, Math.round(teeth))
  const pitch = Math.PI * module
  const slope = Math.tan(clamp(finite(pressureAngle, 20), 5, 35) * RAD)
  const tipY = positive(addendum, 1) * module
  const rootY = -positive(dedendum, 1.25) * module
  const halfAtPitch = clamp(0.25 * pitch - 0.5 * finite(backlash, 0), 0.025 * pitch, 0.475 * pitch)
  const tipHalf = Math.max(halfAtPitch - tipY * slope, 0.01 * pitch)
  const rootHalf = Math.min(halfAtPitch - rootY * slope, 0.49 * pitch)
  const bottomY = rootY - positive(height, 2 * module)
  const left = -0.5 * pitch
  const right = (n - 0.5) * pitch
  const out: Vec2[] = [
    [left, bottomY],
    [right, bottomY],
    [right, rootY],
  ]
  for (let k = n - 1; k >= 0; k--) {
    const x = k * pitch
    out.push([x + rootHalf, rootY], [x + tipHalf, tipY], [x - tipHalf, tipY], [x - rootHalf, rootY])
  }
  out.push([left, rootY])
  return out
}

// ── cams and belts (convex hull of two circles) ──────────────────────────────────────────────────────────────

function twoCircleHull(ax: number, ay: number, ra: number, bx: number, by: number, rbRadius: number, samples: number): Vec2[] {
  const out: Vec2[] = []
  const d = Math.hypot(bx - ax, by - ay)
  if (!(ra >= 0) || !(rbRadius >= 0) || !Number.isFinite(d + ra + rbRadius)) return out
  if (d + rbRadius <= ra) {
    if (ra > 0) pushArc(out, ax, ay, ra, 0, TAU, samples, true, false)
    return out
  }
  if (d + ra <= rbRadius) {
    pushArc(out, bx, by, rbRadius, 0, TAU, samples, true, false)
    return out
  }
  const toward = Math.atan2(by - ay, bx - ax)
  const spread = Math.acos(clamp((ra - rbRadius) / d, -1, 1)) // direction of the tangent normals, from the centre line
  const onB = clamp(Math.round((samples * spread) / Math.PI), 2, Math.max(2, samples - 2))
  const onA = Math.max(2, samples - onB)
  if (rbRadius > 0) pushArc(out, bx, by, rbRadius, toward - spread, toward + spread, onB - 1, true, true)
  else out.push([bx, by])
  if (ra > 0) pushArc(out, ax, ay, ra, toward + spread, toward - spread + TAU, onA - 1, true, true)
  else out.push([ax, ay])
  return out
}

/**
 * Two-circle ("egg") cam lobe: base circle on the origin, nose circle `distance` along +x, joined by straight
 * flanks (closed, counter-clockwise). camLift gives the exact flat-follower lift for the same three numbers.
 */
export function camProfile({
  baseRadius,
  noseRadius,
  distance,
  samples = 72,
}: {
  baseRadius: number
  noseRadius: number
  distance: number
  samples?: number
}): Vec2[] {
  if (!(baseRadius > 0)) return []
  return twoCircleHull(0, 0, baseRadius, Math.abs(finite(distance, 0)), 0, Math.max(0, finite(noseRadius, 0)), count(samples, 72, 8))
}

/** Outline of an open belt or chain wrapped round two pulleys (closed, counter-clockwise). */
export function beltPath({
  centerA,
  radiusA,
  centerB,
  radiusB,
  samples = 64,
}: {
  centerA: Vec2
  radiusA: number
  centerB: Vec2
  radiusB: number
  samples?: number
}): Vec2[] {
  return twoCircleHull(centerA[0], centerA[1], radiusA, centerB[0], centerB[1], radiusB, count(samples, 64, 8))
}

// ── lathe profiles: [radius, height] ─────────────────────────────────────────────────────────────────────────

/**
 * Piston as a lathe profile, skirt bottom at height 0, crown at `height`. Ring grooves near the top.
 * `crown` > 0 domes the top by that much, < 0 dishes it. `wall` > 0 hollows the underside (open skirt).
 * Typical: height ≈ 1.2 × radius; the pin axis sits about 0.42 × height above the bottom.
 */
export function pistonProfile({
  radius,
  height,
  rings = 3,
  ringWidth,
  ringDepth,
  crown = 0,
  wall = 0,
  chamfer,
  samples = 8,
}: {
  radius: number
  height?: number
  rings?: number
  ringWidth?: number
  ringDepth?: number
  crown?: number
  wall?: number
  chamfer?: number
  samples?: number
}): Vec2[] {
  if (!(radius > 0) || !Number.isFinite(radius)) return []
  const h = positive(height, 1.2 * radius)
  const shell = clamp(finite(wall, 0), 0, 0.8 * radius)
  let bevel = clamp(finite(chamfer, 0.03 * radius), 0, 0.2 * Math.min(radius, h))
  if (shell > 0) bevel = Math.min(bevel, 0.5 * shell)
  const grooves = count(rings, 3, 0)
  const land = Math.max(0.08 * h, 2 * bevel) // from the crown down to the first groove
  const grooveWidth = clamp(finite(ringWidth, 0.045 * h), 0, h)
  const grooveGap = 1.2 * grooveWidth
  let grooveDepth = clamp(finite(ringDepth, 0.07 * radius), 0, 0.5 * radius)
  if (shell > 0) grooveDepth = Math.min(grooveDepth, 0.6 * shell)
  const out: Vec2[] = []
  const lift = clamp(finite(crown, 0), -0.5 * h, radius - bevel)
  if (shell > 0) {
    const roof = h - Math.min(1.6 * shell + Math.max(0, -lift), 0.9 * h)
    out.push([0, roof], [radius - shell, roof], [radius - shell, 0])
  } else {
    out.push([0, 0])
  }
  out.push([radius - bevel, 0], [radius, bevel])
  for (let k = grooves - 1; k >= 0; k--) {
    const top = h - land - k * (grooveWidth + grooveGap)
    const bottom = top - grooveWidth
    if (!(grooveWidth > 0) || !(grooveDepth > 0) || bottom <= bevel + 0.02 * h) continue
    out.push([radius, bottom], [radius - grooveDepth, bottom], [radius - grooveDepth, top], [radius, top])
  }
  out.push([radius, h - bevel], [radius - bevel, h])
  if (lift !== 0) {
    // spherical cap over the crown: dome (lift > 0) or dish (lift < 0, with a flat rim)
    const reach = lift > 0 ? radius - bevel : 0.8 * (radius - bevel)
    const sag = Math.abs(lift)
    const sphere = (reach * reach + sag * sag) / (2 * sag)
    const widest = Math.asin(clamp(reach / sphere, -1, 1))
    const steps = count(samples, 8, 2)
    for (let i = lift > 0 ? 1 : 0; i < steps; i++) {
      const a = widest * (1 - i / steps)
      const drop = sphere * Math.cos(a) - (sphere - sag)
      out.push([sphere * Math.sin(a), lift > 0 ? h + drop : h - drop])
    }
    out.push([0, h + lift])
  } else {
    out.push([0, h])
  }
  return dedupe(out, false)
}

/**
 * Poppet valve as a lathe profile: flat face at height 0, 45° seat, tulip blending into the stem, tip at `length`.
 * Typical: stemRadius ≈ 0.16 × headRadius, length ≈ 6 × headRadius.
 */
export function valveProfile({
  headRadius,
  stemRadius,
  length,
  headHeight,
  seatAngle = 45,
  samples = 8,
}: {
  headRadius: number
  stemRadius?: number
  length?: number
  headHeight?: number
  seatAngle?: number
  samples?: number
}): Vec2[] {
  if (!(headRadius > 0) || !Number.isFinite(headRadius)) return []
  const stem = clamp(positive(stemRadius, 0.16 * headRadius), 0.02 * headRadius, 0.7 * headRadius)
  const total = Math.max(positive(length, 6 * headRadius), 1.5 * headRadius)
  const margin = Math.min(0.06 * headRadius, 0.1 * total)
  const seatWidth = Math.min(0.12 * headRadius, 0.5 * (headRadius - stem))
  const seatTop = margin + seatWidth * Math.tan(clamp(finite(seatAngle, 45), 10, 80) * RAD)
  const tip = Math.min(0.25 * stem, 0.05 * total)
  const neck = clamp(positive(headHeight, 0.9 * headRadius), seatTop + 0.05 * headRadius, Math.max(seatTop + 0.05 * headRadius, total - 2 * tip))
  const out: Vec2[] = [
    [0, 0],
    [headRadius, 0],
    [headRadius, margin],
    [headRadius - seatWidth, seatTop],
  ]
  // tulip: quadratic curve from the top of the seat to the stem, leaving almost flat and arriving vertical
  const x0 = headRadius - seatWidth
  const controlX = stem
  const controlY = seatTop + 0.12 * (neck - seatTop)
  const steps = count(samples, 8, 2)
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const w0 = (1 - t) * (1 - t)
    const w1 = 2 * (1 - t) * t
    const w2 = t * t
    out.push([w0 * x0 + w1 * controlX + w2 * stem, w0 * seatTop + w1 * controlY + w2 * neck])
  }
  out.push([stem, total - tip], [stem - tip, total], [0, total])
  return dedupe(out, false)
}

interface BearingGeometry {
  ball: number
  pitch: number
  groove: number
  width: number
  outerLand: number
  innerLand: number
  bevel: number
}

function bearingGeometry(innerRadius: number, outerRadius: number, width: number | undefined): BearingGeometry | null {
  if (!(innerRadius > 0) || !(outerRadius > innerRadius) || !Number.isFinite(outerRadius)) return null
  const section = outerRadius - innerRadius
  const w = positive(width, section)
  const ball = Math.min(0.3 * section, 0.45 * w)
  const pitch = 0.5 * (innerRadius + outerRadius)
  return {
    ball,
    pitch,
    groove: 1.04 * ball,
    width: w,
    outerLand: pitch + 0.6 * ball,
    innerLand: pitch - 0.6 * ball,
    bevel: Math.min(0.06 * section, 0.1 * w),
  }
}

/**
 * One race of a ball bearing as a closed lathe loop (first point repeated), from height 0 to `width`, with the
 * ball groove cut in. Call once with race 'outer' and once with 'inner'; bearingBalls gives the balls.
 */
export function bearingProfile({
  innerRadius,
  outerRadius,
  width,
  race = 'outer',
  samples = 8,
}: {
  innerRadius: number
  outerRadius: number
  width?: number
  race?: 'outer' | 'inner'
  samples?: number
}): Vec2[] {
  const g = bearingGeometry(innerRadius, outerRadius, width)
  if (g === null) return []
  const steps = count(samples, 8, 2)
  const mid = 0.5 * g.width
  const out: Vec2[] = []
  if (race === 'inner') {
    const centre = g.pitch - g.ball + g.groove
    const open = Math.acos(clamp((centre - g.innerLand) / g.groove, -1, 1))
    out.push([innerRadius + g.bevel, 0], [g.innerLand, 0])
    pushArc(out, centre, mid, g.groove, Math.PI + open, Math.PI - open, steps, true, true)
    out.push([g.innerLand, g.width], [innerRadius + g.bevel, g.width], [innerRadius, g.width - g.bevel], [innerRadius, g.bevel])
  } else {
    const centre = g.pitch + g.ball - g.groove
    const open = Math.acos(clamp((g.outerLand - centre) / g.groove, -1, 1))
    out.push([g.outerLand, 0], [outerRadius - g.bevel, 0], [outerRadius, g.bevel], [outerRadius, g.width - g.bevel])
    out.push([outerRadius - g.bevel, g.width], [g.outerLand, g.width])
    pushArc(out, centre, mid, g.groove, open, -open, steps, true, true)
  }
  const loop = dedupe(out, true)
  const first = loop[0] as Vec2
  loop.push([first[0], first[1]])
  return loop
}

/** Size and placement of the balls that fit bearingProfile: ball radius, radius of the circle of ball centres, their height, how many. */
export function bearingBalls({
  innerRadius,
  outerRadius,
  width,
  count: wanted,
}: {
  innerRadius: number
  outerRadius: number
  width?: number
  count?: number
}): { radius: number; pitchRadius: number; height: number; count: number } {
  const g = bearingGeometry(innerRadius, outerRadius, width)
  if (g === null) return { radius: 0, pitchRadius: 0, height: 0, count: 0 }
  const most = Math.max(1, Math.floor(Math.PI / Math.asin(Math.min(1, g.ball / g.pitch)) - 1e-9)) // touching balls
  const natural = Math.max(3, Math.floor((TAU * g.pitch) / (3 * g.ball)))
  return { radius: g.ball, pitchRadius: g.pitch, height: 0.5 * g.width, count: clamp(count(wanted, natural, 1), 1, most) }
}

/** Stepped shaft as a lathe profile: sections stacked from height 0 upward, with chamfered ends. */
export function shaftProfile({
  sections,
  chamfer,
}: {
  sections: readonly { radius: number; length: number }[]
  chamfer?: number
}): Vec2[] {
  const usable = sections.filter((s) => s.radius > 0 && s.length > 0 && Number.isFinite(s.radius) && Number.isFinite(s.length))
  if (usable.length === 0) return []
  const first = usable[0] as { radius: number; length: number }
  const last = usable[usable.length - 1] as { radius: number; length: number }
  const bevelFor = (s: { radius: number; length: number }): number =>
    clamp(finite(chamfer, 0.1 * s.radius), 0, Math.min(0.5 * s.radius, 0.25 * s.length))
  const out: Vec2[] = [[0, 0]]
  let y = 0
  for (let i = 0; i < usable.length; i++) {
    const s = usable[i] as { radius: number; length: number }
    const startBevel = i === 0 ? bevelFor(first) : 0
    const endBevel = i === usable.length - 1 ? bevelFor(last) : 0
    out.push([s.radius - startBevel, y], [s.radius, y + startBevel], [s.radius, y + s.length - endBevel], [s.radius - endBevel, y + s.length])
    y += s.length
  }
  out.push([0, y])
  return dedupe(out, false)
}

/**
 * V-belt pulley as a lathe profile from height 0 to `width`. With `boreRadius` > 0 it is a closed loop
 * (first point repeated) around the bore; otherwise it starts and ends on the axis.
 */
export function pulleyProfile({
  radius,
  width,
  grooveDepth,
  grooveAngle = 38,
  boreRadius = 0,
}: {
  radius: number
  width: number
  grooveDepth?: number
  grooveAngle?: number
  boreRadius?: number
}): Vec2[] {
  if (!(radius > 0) || !(width > 0) || !Number.isFinite(radius) || !Number.isFinite(width)) return []
  const bore = clamp(finite(boreRadius, 0), 0, 0.8 * radius)
  const lip = 0.12 * width
  const mouth = 0.5 * width - lip // half-width of the groove at the rim
  const depth = clamp(finite(grooveDepth, 0.18 * radius), 0, 0.9 * (radius - bore))
  const floor = Math.max(0, mouth - depth * Math.tan(0.5 * clamp(finite(grooveAngle, 38), 0, 170) * RAD))
  const mid = 0.5 * width
  const out: Vec2[] = [[bore, 0], [radius, 0], [radius, lip]]
  if (depth > 0) out.push([radius - depth, mid - floor], [radius - depth, mid + floor])
  out.push([radius, width - lip], [radius, width], [bore, width])
  const profile = dedupe(out, false)
  if (bore > 0) profile.push([bore, 0])
  return profile
}

// ── flat outlines to extrude ─────────────────────────────────────────────────────────────────────────────────

/**
 * Connecting-rod outline (closed, counter-clockwise): big-end eye on the origin, small-end eye at [0, length],
 * joined by a tapered beam. Radii are the OUTER radii of the eyes; add the bores as holes with circleProfile.
 */
export function conRodProfile({
  length,
  bigEndRadius,
  smallEndRadius,
  beamWidth,
  taper = 1.4,
  samples = 48,
}: {
  length: number
  bigEndRadius: number
  smallEndRadius: number
  beamWidth?: number
  taper?: number
  samples?: number
}): Vec2[] {
  if (!(length > 0) || !(bigEndRadius > 0) || !(smallEndRadius > 0)) return []
  if (!Number.isFinite(length + bigEndRadius + smallEndRadius)) return []
  const perTurn = count(samples, 48, 8)
  const smallHalf = clamp(0.5 * positive(beamWidth, smallEndRadius), 0.02 * smallEndRadius, 0.9 * smallEndRadius)
  const bigHalf = clamp(smallHalf * positive(taper, 1.4), 0.02 * bigEndRadius, 0.9 * bigEndRadius)
  const bigJoin = Math.sqrt(bigEndRadius * bigEndRadius - bigHalf * bigHalf)
  const smallJoin = length - Math.sqrt(smallEndRadius * smallEndRadius - smallHalf * smallHalf)
  if (!(smallJoin > bigJoin)) return twoCircleHull(0, 0, bigEndRadius, 0, length, smallEndRadius, perTurn)
  const bigOpen = Math.asin(bigHalf / bigEndRadius)
  const smallOpen = Math.asin(smallHalf / smallEndRadius)
  const quarter = 0.5 * Math.PI
  const out: Vec2[] = []
  const bigSpan = TAU - 2 * bigOpen
  pushArc(out, 0, 0, bigEndRadius, quarter + bigOpen, quarter + bigOpen + bigSpan, evenSegments(bigSpan, perTurn), true, true)
  const smallSpan = TAU - 2 * smallOpen
  pushArc(out, 0, length, smallEndRadius, -quarter + smallOpen, -quarter + smallOpen + smallSpan, evenSegments(smallSpan, perTurn), true, true)
  return out
}

/**
 * Crank web with counterweight (closed, counter-clockwise): main journal on the origin, crank pin at [0, throw],
 * counterweight fanning out on the opposite side. Add the journal and pin as holes or separate cylinders.
 */
export function crankWebProfile({
  throw: reach,
  journalRadius,
  pinRadius,
  counterweightRadius,
  counterweightAngle = 120,
  samples = 60,
}: {
  throw: number
  journalRadius: number
  pinRadius: number
  counterweightRadius?: number
  counterweightAngle?: number
  samples?: number
}): Vec2[] {
  if (!(reach > 0) || !(journalRadius > 0) || !(pinRadius > 0)) return []
  if (!Number.isFinite(reach + journalRadius + pinRadius)) return []
  const perTurn = count(samples, 60, 8)
  const mainBoss = 1.35 * journalRadius
  const pinBoss = 1.35 * pinRadius
  const weight = positive(counterweightRadius, 1.5 * reach)
  const quarter = 0.5 * Math.PI
  const joined = reach + pinBoss > mainBoss // otherwise the pin boss is swallowed by the main boss
  const spread = joined ? Math.acos(clamp((mainBoss - pinBoss) / reach, -1, 1)) : 0
  const fan = Math.min(0.5 * clamp(finite(counterweightAngle, 120), 0, 300) * RAD, Math.PI - spread - 2 * RAD)
  const hasWeight = weight > mainBoss && fan > 0
  const out: Vec2[] = []
  if (joined) pushArc(out, 0, reach, pinBoss, quarter - spread, quarter + spread, evenSegments(2 * spread, perTurn), true, true)
  const mainStart = quarter + spread
  const mainEnd = quarter - spread + TAU
  if (!hasWeight) {
    pushArc(out, 0, 0, mainBoss, mainStart, mainEnd, arcSegments(mainEnd - mainStart, perTurn), true, joined)
    return dedupe(out, true)
  }
  const down = 3 * quarter
  pushArc(out, 0, 0, mainBoss, mainStart, down - fan, arcSegments(down - fan - mainStart, perTurn), true, true)
  pushArc(out, 0, 0, weight, down - fan, down + fan, evenSegments(2 * fan, perTurn), true, true)
  pushArc(out, 0, 0, mainBoss, down + fan, mainEnd, arcSegments(mainEnd - down - fan, perTurn), true, joined)
  return dedupe(out, true)
}
