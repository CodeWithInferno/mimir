// Small vector / quaternion / box toolkit for the core. Plain arrays, no classes, no dependencies.
// Angles are DEGREES at every public boundary; radians only inside this file.

export type Vec2 = [number, number]
export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number] // x, y, z, w
/** Axis-aligned rectangle: x, y is the MIN corner (left, bottom in frame space; left, top in screen space). */
export interface Rect { x: number; y: number; width: number; height: number }
export interface Box3 { min: Vec3; max: Vec3 }
/** Rigid transform with a uniform scale: world = p + q * (s * local). */
export interface TRS { p: Vec3; q: Quat; s: number }

export const DEG = Math.PI / 180
export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x)
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
export const lerp = (a: number, b: number, u: number): number => a + (b - a) * u

export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z]
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
export const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
export const norm = (a: Vec3): Vec3 => {
  const l = len(a)
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]
}
export const lerp3 = (a: Vec3, b: Vec3, u: number): Vec3 => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)]
export const finite3 = (a: readonly number[]): boolean => Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2] ?? 0)

/** Anything array-like with 2 or 3 numbers → Vec3 (z defaults to 0). Returns null when it is not a vector. */
export function toVec3(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || v.length < 2 || v.length > 3) return null
  const x = v[0], y = v[1], z = v.length === 3 ? v[2] : 0
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null
  return [x, y, z]
}

// ── quaternions ────────────────────────────────────────────────────────────────────────────────────
export const QID: Quat = [0, 0, 0, 1]
export const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
]
export function qAxisDeg(axis: Vec3, deg: number): Quat {
  const n = norm(axis)
  const h = (deg * DEG) / 2
  const s = Math.sin(h)
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(h)]
}
export function qrot(q: Quat, v: Vec3): Vec3 {
  // v + 2 * cross(q.xyz, cross(q.xyz, v) + q.w * v)
  const x = q[0], y = q[1], z = q[2], w = q[3]
  const cx = y * v[2] - z * v[1] + w * v[0]
  const cy = z * v[0] - x * v[2] + w * v[1]
  const cz = x * v[1] - y * v[0] + w * v[2]
  return [v[0] + 2 * (y * cz - z * cy), v[1] + 2 * (z * cx - x * cz), v[2] + 2 * (x * cy - y * cx)]
}
export const qconj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]]
export function qnorm(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3])
  return l > 1e-12 ? [q[0] / l, q[1] / l, q[2] / l, q[3] / l] : [0, 0, 0, 1]
}
/** Shortest rotation that takes unit vector `from` onto unit vector `to`. */
export function qFromTo(from: Vec3, to: Vec3): Quat {
  const a = norm(from), b = norm(to)
  const d = dot(a, b)
  if (d > 1 - 1e-10) return [0, 0, 0, 1]
  if (d < -1 + 1e-10) {
    // opposite: any axis perpendicular to a
    const ax = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 0, 1])
    return qAxisDeg(ax, 180)
  }
  const c = cross(a, b)
  return qnorm([c[0], c[1], c[2], 1 + d])
}
export function qslerp(a: Quat, b: Quat, u: number): Quat {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  let bb = b
  if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]] }
  if (d > 0.9995) return qnorm([lerp(a[0], bb[0], u), lerp(a[1], bb[1], u), lerp(a[2], bb[2], u), lerp(a[3], bb[3], u)])
  const th = Math.acos(d), s = Math.sin(th)
  const ka = Math.sin((1 - u) * th) / s, kb = Math.sin(u * th) / s
  return [a[0] * ka + bb[0] * kb, a[1] * ka + bb[1] * kb, a[2] * ka + bb[2] * kb, a[3] * ka + bb[3] * kb]
}
/** Rotation about the z axis (2D), degrees, counter-clockwise. */
export const qz = (deg: number): Quat => qAxisDeg([0, 0, 1], deg)
/** Angle about z of a quaternion that is a pure z rotation, in degrees. */
export const qzDeg = (q: Quat): number => (2 * Math.atan2(q[2], q[3])) / DEG

// ── transforms ─────────────────────────────────────────────────────────────────────────────────────
export const TID: TRS = { p: [0, 0, 0], q: [0, 0, 0, 1], s: 1 }
export const apply = (t: TRS, v: Vec3): Vec3 => add(t.p, qrot(t.q, mul(v, t.s)))
export const applyDir = (t: TRS, v: Vec3): Vec3 => qrot(t.q, v)
export const compose = (parent: TRS, local: TRS): TRS => ({ p: apply(parent, local.p), q: qmul(parent.q, local.q), s: parent.s * local.s })
export const finiteTRS = (t: TRS): boolean => finite3(t.p) && t.q.every(Number.isFinite) && Number.isFinite(t.s)

// ── boxes ──────────────────────────────────────────────────────────────────────────────────────────
export const boxOf = (hx: number, hy: number, hz: number): Box3 => ({ min: [-hx, -hy, -hz], max: [hx, hy, hz] })
export const emptyBox = (): Box3 => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] })
export const isEmptyBox = (b: Box3): boolean => !(b.min[0] <= b.max[0])
export function expand(b: Box3, p: Vec3): Box3 {
  for (let i = 0; i < 3; i++) {
    if (p[i]! < b.min[i]!) b.min[i] = p[i]!
    if (p[i]! > b.max[i]!) b.max[i] = p[i]!
  }
  return b
}
export function union(a: Box3, b: Box3): Box3 {
  if (isEmptyBox(b)) return a
  expand(a, b.min)
  expand(a, b.max)
  return a
}
export const boxCenter = (b: Box3): Vec3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]
export const boxSize = (b: Box3): Vec3 => [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]
export function boxCorners(b: Box3): Vec3[] {
  const out: Vec3[] = []
  for (let i = 0; i < 8; i++) out.push([i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]])
  return out
}
/** Axis-aligned box of a local box under a transform. */
export function transformBox(b: Box3, t: TRS): Box3 {
  const out = emptyBox()
  if (isEmptyBox(b)) return out
  for (const c of boxCorners(b)) expand(out, apply(t, c))
  return out
}
/** The point of a box in a direction: each axis picks min, centre or max by the sign of that component. */
export function boxPoint(b: Box3, dir: Vec3): Vec3 {
  const c = boxCenter(b)
  const pick = (i: 0 | 1 | 2): number => (dir[i] > 1e-9 ? b.max[i] : dir[i] < -1e-9 ? b.min[i] : c[i])
  return [pick(0), pick(1), pick(2)]
}

// ── deterministic randomness ───────────────────────────────────────────────────────────────────────
export interface Rng {
  (): number
  /** uniform in [a, b) */
  range(a: number, b: number): number
  /** integer in [a, b] */
  int(a: number, b: number): number
  pick<T>(items: readonly T[]): T
}
/** mulberry32. The ONLY source of randomness a scene may use. */
export function makeRng(seed: number | string = 1): Rng {
  let a = 0
  if (typeof seed === 'string') { for (let i = 0; i < seed.length; i++) a = (Math.imul(a, 31) + seed.charCodeAt(i)) | 0 } else a = Math.floor(Number.isFinite(seed) ? seed : 1) | 0
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const rng = next as Rng
  rng.range = (lo, hi) => lo + (hi - lo) * next()
  rng.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * next())
  rng.pick = (items) => items[Math.floor(next() * items.length)]!
  return rng
}

/** FNV-1a over a string → 8 hex chars. Used for state signatures. */
export function hashString(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16).padStart(8, '0')
}
