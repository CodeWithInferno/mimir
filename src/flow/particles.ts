// The maths of every particle effect (part of the lazy chunk 'flow'; never imported by index.ts). Pure: no DOM, no
// three.js, no clock, no randomness except the seeded stream of src/lib/sim. Each function maps the inputs of one
// frame to what is drawn in that frame, so a particle is a function of (seed, index, phase) and has no history.
import { rng } from '../lib/sim/index.ts'
import type { Vec3 } from '../lib/types.ts'

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (x: number): number => { const t = clamp01(x); return t * t * (3 - 2 * t) }
const fract = (x: number): number => x - Math.floor(x)
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (a: Vec3, fallback: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : fallback }
const mixv = (a: Vec3, b: Vec3, u: number): Vec3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]

// ── a path with a frame along it ──────────────────────────────────────────────────────────────────────
/** A point of a curve: position, unit direction of travel, and two unit vectors across it. */
export interface CurvePoint { p: Vec3; dir: Vec3; side: Vec3; up: Vec3 }
/** A polyline parametrised by arc length, with a frame that does not twist. */
export interface Curve { length: number; closed: boolean; /** u = share of the length, 0..1 */ at(u: number): CurvePoint }

/**
 * A curve through points. In a plane z = 0 `side` is the left normal and `up` is +z; in space the frame is carried
 * along the line without twisting (rotation minimising), so particles beside the centre line keep their lane.
 * `side` at a corner is the bisector of the two segments, so lanes bend round corners instead of jumping.
 */
export function curveThrough(points: readonly Vec3[], closed = false): Curve {
  const pts: Vec3[] = []
  for (const p of points) {
    if (!(Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]))) continue
    const last = pts[pts.length - 1]
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) < 1e-9) continue
    pts.push([p[0], p[1], p[2]])
  }
  if (closed && pts.length > 2) pts.push([...pts[0]!] as Vec3)
  const n = pts.length
  if (n < 2) {
    const p: Vec3 = pts[0] ?? [0, 0, 0]
    return { length: 0, closed: false, at: () => ({ p, dir: [1, 0, 0], side: [0, 1, 0], up: [0, 0, 1] }) }
  }
  const cum = [0]
  const dirs: Vec3[] = []
  for (let i = 1; i < n; i++) { cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1], pts[i]![2] - pts[i - 1]![2])); dirs.push(unit(sub(pts[i]!, pts[i - 1]!), [1, 0, 0])) }
  const length = cum[n - 1]!
  const planar = pts.every((p) => p[2] === 0)
  // one `side` per segment: the left normal in a plane, else carried from segment to segment by the smallest turn
  const sides: Vec3[] = []
  if (planar) for (const d of dirs) sides.push([-d[1], d[0], 0])
  else {
    const d0 = dirs[0]!
    const ref: Vec3 = Math.abs(d0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
    let side = unit(cross(ref, d0), [0, 0, 1])
    sides.push(side)
    for (let i = 1; i < dirs.length; i++) {
      const d = dirs[i]!
      // remove the part along the new direction: the frame turns with the line and never spins about it
      const k = dot(side, d)
      side = unit([side[0] - d[0] * k, side[1] - d[1] * k, side[2] - d[2] * k], side)
      sides.push(side)
    }
  }
  // the frame at each vertex: the bisector of its two segments (the end segments of an open line keep their own)
  const wraps = closed && n > 3
  const vdir: Vec3[] = [], vside: Vec3[] = []
  for (let i = 0; i < n; i++) {
    const a = i > 0 ? i - 1 : wraps ? dirs.length - 1 : 0
    const b = i < dirs.length ? i : wraps ? 0 : dirs.length - 1
    vdir.push(unit(mixv(dirs[a]!, dirs[b]!, 0.5), dirs[b]!))
    vside.push(unit(mixv(sides[a]!, sides[b]!, 0.5), sides[b]!))
  }
  let hint = 1
  return {
    length, closed: wraps,
    at(u) {
      const s = clamp01(u) * length
      // particles ask in no particular order: start from the last answer, fall back to a binary search
      let i = hint
      if (!(cum[i - 1]! <= s && s <= cum[i]!)) {
        let lo = 1, hi = n - 1
        while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid]! < s) lo = mid + 1; else hi = mid }
        i = lo
        hint = i
      }
      const span = cum[i]! - cum[i - 1]!
      const k = span > 0 ? (s - cum[i - 1]!) / span : 0
      const dir = dirs[i - 1]!
      let side = unit(mixv(vside[i - 1]!, vside[i]!, k), sides[i - 1]!)
      // keep the frame square to the direction of the segment it is on
      const along = dot(side, dir)
      side = unit([side[0] - dir[0] * along, side[1] - dir[1] * along, side[2] - dir[2] * along], sides[i - 1]!)
      return { p: mixv(pts[i - 1]!, pts[i]!, k), dir, side, up: planar ? [0, 0, 1] : unit(cross(dir, side), [0, 0, 1]) }
    },
  }
}

// ── seeds ─────────────────────────────────────────────────────────────────────────────────────────────
/**
 * What makes particle i itself. `offset` and `lane` are a pair that fills the unit square evenly (where it starts
 * along a flat stream, and where it sits across it); `start`, `a`, `b` are a triple that fills the unit cube evenly
 * (the same for a round stream or a volume); `file` is its place in a single file; `size` and `spin` are its own
 * size factor and a spare number.
 */
export interface Seed { offset: number; lane: number; start: number; a: number; b: number; /** where it starts along a stream that has no width: evenly spaced, a little uneven */ file: number; size: number; spin: number }
const seedCache = new Map<string, Seed[]>()
// Kronecker sequences on the generalised golden ratios (the roots of x³ = x + 1 and x⁴ = x + 1): point i is
// fract(shift + i·α). They cover the square / the cube evenly at every count, with no visible lattice and no clumps,
// which independent random numbers do not.
const PLANE = [0.7548776662466927, 0.5698402909980532]
const SPACE = [0.8191725133961645, 0.6710436067037893, 0.5497004779019703]
/** how far a point is moved off the sequence, in mean spacings */
const JITTER = 0.5
/** the same for particles in single file, in spacings */
const FILE_JITTER = 0.18
/** `count` particles from a seed: the seed shifts the whole pattern, so another seed is another arrangement. */
export function seedsFor(seed: number | string, count: number): Seed[] {
  const n = Math.max(0, Math.min(20000, Math.floor(Number.isFinite(count) ? count : 0)))
  const key = `${typeof seed}:${String(seed)}:${n}`
  const hit = seedCache.get(key)
  if (hit) return hit
  const r = rng(typeof seed === 'number' || typeof seed === 'string' ? seed : 1)
  const shift = [r.next(), r.next(), r.next(), r.next(), r.next()]
  // each point is then moved by up to half the mean spacing: the rows of the sequence disappear, its evenness stays
  const j2 = JITTER / Math.sqrt(Math.max(1, n)), j3 = JITTER / Math.cbrt(Math.max(1, n))
  const out: Seed[] = []
  for (let i = 0; i < n; i++) {
    out.push({
      offset: fract(shift[0]! + (i + 1) * PLANE[0]! + r.range(-j2, j2)), lane: fract(shift[1]! + (i + 1) * PLANE[1]! + r.range(-j2, j2)),
      start: fract(shift[2]! + (i + 1) * SPACE[0]! + r.range(-j3, j3)), a: fract(shift[3]! + (i + 1) * SPACE[1]! + r.range(-j3, j3)), b: fract(shift[4]! + (i + 1) * SPACE[2]! + r.range(-j3, j3)),
      file: (i + 0.5 + r.range(-FILE_JITTER, FILE_JITTER)) / n, size: r.range(0.8, 1.2), spin: r.next(),
    })
  }
  if (seedCache.size > 64) seedCache.clear()
  seedCache.set(key, out)
  return out
}
/** A point of the unit square → the unit disc, keeping areas and neighbours (concentric map). */
export function toDisc(a: number, b: number): [number, number] {
  const x = 2 * a - 1, y = 2 * b - 1
  if (x === 0 && y === 0) return [0, 0]
  let radius: number, angle: number
  if (Math.abs(x) > Math.abs(y)) { radius = x; angle = (Math.PI / 4) * (y / x) } else { radius = y; angle = Math.PI / 2 - (Math.PI / 4) * (x / y) }
  return [radius * Math.cos(angle), radius * Math.sin(angle)]
}

// ── a stream of particles along a curve ───────────────────────────────────────────────────────────────
export interface StreamSpec {
  count: number
  seed: number | string
  /** seconds the stream has been running */
  time: number
  /** when given: how many whole transits the stream has made (replaces time) */
  phase: number | null
  /** path units per second at a share of the length 0..1 */
  speedAt(u: number): number
  /** half width of the stream at a share of the length */
  spreadAt(u: number): number
  /** share of an open path over which particles appear and vanish */
  fade: number
  /** 0..1: the whole stream's strength */
  active: number
  /** points the speed is sampled at */
  samples: number
  /** true in 3D: lanes fill a disc across the path; false: a band in the plane */
  round: boolean
}
export interface Particle { p: Vec3; dir: Vec3; /** share of the length it is at, 0..1 */ u: number; /** path units per second it moves at there */ speed: number; /** 0..1 */ alpha: number; /** size factor around 1 */ size: number; index: number }
export interface Stream { particles: Particle[]; /** seconds one particle takes from one end to the other (Infinity when nothing moves) */ transit: number }

/**
 * Where every particle of a stream is. A particle moves at speedAt(u), so particles are evenly spread in TIME: they
 * bunch up where the stream is slow and thin out where it is fast, as a steady flow does. Its place is a function of
 * (its seed, phase): nothing is integrated, nothing is remembered.
 */
export function stream(curve: Curve, spec: StreamSpec): Stream {
  const m = Math.max(2, Math.min(1024, Math.floor(spec.samples)))
  // time to reach each sample point: the integral of ds / v
  const speeds = new Array<number>(m + 1)
  let top = 0
  for (let k = 0; k <= m; k++) { const v = spec.speedAt(k / m); speeds[k] = Number.isFinite(v) && v > 0 ? v : 0; if (speeds[k]! > top) top = speeds[k]! }
  const floor = top * 1e-3 // a stream that stops somewhere would never get past that point
  const reach = new Array<number>(m + 1)
  reach[0] = 0
  const ds = curve.length / m
  for (let k = 1; k <= m; k++) {
    const a = Math.max(speeds[k - 1]!, floor), b = Math.max(speeds[k]!, floor)
    reach[k] = reach[k - 1]! + (top > 0 ? ds * 0.5 * (1 / a + 1 / b) : 1 / m)
  }
  const total = reach[m]!
  const transit = top > 0 && curve.length > 0 ? total : Infinity
  const turns = spec.phase !== null && Number.isFinite(spec.phase) ? spec.phase : Number.isFinite(transit) && transit > 0 ? spec.time / transit : 0
  const seeds = seedsFor(spec.seed, spec.count)
  const fade = curve.closed ? 0 : clamp01(spec.fade)
  const active = clamp01(spec.active)
  /** where a particle with seed `s` is when it is at share `u` of the path: on the centre line, moved across it by its lane */
  const place = (u: number, s: Seed): Vec3 => {
    const c = curve.at(u)
    const half = spec.spreadAt(u)
    if (!(Number.isFinite(half) && half > 0)) return c.p
    if (spec.round) { const [x, y] = toDisc(s.a, s.b); return [c.p[0] + (c.side[0] * x + c.up[0] * y) * half, c.p[1] + (c.side[1] * x + c.up[1] * y) * half, c.p[2] + (c.side[2] * x + c.up[2] * y) * half] }
    const x = (2 * s.lane - 1) * half
    return [c.p[0] + c.side[0] * x, c.p[1] + c.side[1] * x, c.p[2] + c.side[2] * x]
  }
  const step = 0.25 / m
  // a stream with no width is a single file: its particles are spaced along it, not scattered over an area
  let single = true
  for (let k = 0; k <= 8 && single; k++) { const half = spec.spreadAt(k / 8); if (Number.isFinite(half) && half > 0) single = false }
  const particles: Particle[] = []
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i]!
    const q = fract((single ? s.file : spec.round ? s.start : s.offset) + turns) * total
    // the sample interval that holds time q
    let lo = 0, hi = m
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (reach[mid]! <= q) lo = mid; else hi = mid }
    const span = reach[hi]! - reach[lo]!
    const k = span > 0 ? (q - reach[lo]!) / span : 0
    const u = (lo + k) / m
    const p = place(u, s)
    // the direction it really moves in: lanes converge and spread with the stream, so it is not just the path's direction
    const ahead = place(Math.min(1, u + step), s), behind = place(Math.max(0, u - step), s)
    const dir = unit(sub(ahead, behind), curve.at(u).dir)
    const alpha = active * (fade > 0 ? smooth(u / fade) * smooth((1 - u) / fade) : 1)
    particles.push({ p, dir, u, speed: speeds[lo]! + (speeds[hi]! - speeds[lo]!) * k, alpha, size: s.size, index: i })
  }
  return { particles, transit }
}

// ── a burst from a point ──────────────────────────────────────────────────────────────────────────────
/** The shape of a burst's life: it appears over the first `appear` of its progress, starts to fade at `fadeFrom`, its sparks reach between `nearest` × radius and the radius, and shrink by `shrink` of their size. */
export const BURST = { appear: 0.06, fadeFrom: 0.25, nearest: 0.45, shrink: 0.45 }
export interface BurstSpec { count: number; seed: number | string; /** 0..1 through its life */ progress: number; radius: number; /** true: directions on a sphere; false: on a circle in the plane */ round: boolean; direction: Vec3 | null; /** full opening angle in degrees, 360 = every direction */ cone: number }
export interface Spark { /** offset from the origin of the burst */ p: Vec3; dir: Vec3; alpha: number; size: number }
/**
 * The particles of a burst: thrown out fast, slowing as they go (1 − (1 − p)³), fading and shrinking. Directions are
 * evenly spread over the circle / sphere (or the cone about `direction`), each with its own reach.
 */
export function burstParticles(spec: BurstSpec): Spark[] {
  const p = clamp01(spec.progress)
  const seeds = seedsFor(spec.seed, spec.count)
  const travel = 1 - (1 - p) ** 3
  const alpha = (1 - smooth((p - BURST.fadeFrom) / (1 - BURST.fadeFrom))) * smooth(p / BURST.appear)
  const cone = (Math.min(360, Math.max(0, Number.isFinite(spec.cone) ? spec.cone : 360)) * Math.PI) / 180
  const axis = spec.direction ? unit(spec.direction, [0, 1, 0]) : ([0, 1, 0] as Vec3)
  // a frame about the axis
  const ref: Vec3 = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const e1 = unit(cross(ref, axis), [1, 0, 0]), e2 = cross(axis, e1)
  const base = Math.atan2(axis[1], axis[0])
  const out: Spark[] = []
  for (const s of seeds) {
    let dir: Vec3
    if (spec.round) {
      // even on the cap of the sphere inside the cone: uniform in the cosine of the angle from the axis
      const cosMax = Math.cos(cone / 2)
      const cz = 1 - s.a * (1 - cosMax), sz = Math.sqrt(Math.max(0, 1 - cz * cz)), turn = 2 * Math.PI * s.b
      dir = [axis[0] * cz + (e1[0] * Math.cos(turn) + e2[0] * Math.sin(turn)) * sz, axis[1] * cz + (e1[1] * Math.cos(turn) + e2[1] * Math.sin(turn)) * sz, axis[2] * cz + (e1[2] * Math.cos(turn) + e2[2] * Math.sin(turn)) * sz]
    } else {
      const angle = (spec.direction ? base : 0) + (s.lane - 0.5) * cone
      dir = [Math.cos(angle), Math.sin(angle), 0]
    }
    const reach = spec.radius * (BURST.nearest + (1 - BURST.nearest) * s.spin) * travel
    out.push({ p: [dir[0] * reach, dir[1] * reach, dir[2] * reach], dir, alpha, size: s.size * (1 - BURST.shrink * p) })
  }
  return out
}

// ── particles inside a volume ─────────────────────────────────────────────────────────────────────────
/** How fast a gas particle wanders about its home: the range of its three rates, radians per second. */
export const GAS_RATES: [number, number] = [1.7, 3.1]
export interface GasSpec { count: number; seed: number | string; time: number; /** half size of the volume on each axis */ half: Vec3; /** the volume is round about y */ round: boolean; /** how far a particle wanders, as a share of the half size */ agitation: number }
/**
 * Positions of the particles of a gas, about the centre of the volume. Each has a home given as a share of the
 * volume, so squeezing the volume squeezes the gas; around it the particle wanders on three sines of its own.
 */
export function gasParticles(spec: GasSpec): Vec3[] {
  const seeds = seedsFor(spec.seed, spec.count)
  const amp = Math.max(0, spec.agitation)
  const room = 1 - Math.min(0.5, amp)
  const out: Vec3[] = []
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i]!
    // three phases and three rates from the particle's own numbers
    const [slow, fast] = GAS_RATES
    const f1 = slow + (fast - slow) * s.spin, f2 = slow + (fast - slow) * fract(s.spin * 7.13 + 0.31), f3 = slow + (fast - slow) * fract(s.spin * 13.7 + 0.77)
    const jx = Math.sin(spec.time * f1 + 6.283 * s.lane) * amp, jy = Math.sin(spec.time * f2 + 6.283 * s.offset) * amp, jz = Math.sin(spec.time * f3 + 6.283 * s.size) * amp
    let x: number, z: number
    if (spec.round) [x, z] = toDisc(s.a, s.b)
    else { x = 2 * s.a - 1; z = 2 * s.b - 1 }
    const y = 2 * s.start - 1
    out.push([(x * room + jx) * spec.half[0], (y * room + jy) * spec.half[1], (z * room + jz) * spec.half[2]])
  }
  return out
}

// ── arrows of a vector field ──────────────────────────────────────────────────────────────────────────
export interface FieldSpec { x: number; y: number; width: number; height: number; /** arrows per unit */ density: number; /** units of length per unit of the field; null = the strongest arrow is `reach` of the spacing */ scale: number | null; reach: number; vector(x: number, y: number): readonly number[] | null }
export interface FieldArrow { x: number; y: number; dx: number; dy: number; /** strength relative to the strongest arrow of this frame, 0..1 */ strength: number }
/** One arrow per cell of a grid over the region, centred on its cell, as long as the field is strong there. */
export function fieldArrows(spec: FieldSpec): FieldArrow[] {
  const nx = Math.max(1, Math.min(96, Math.round(spec.width * spec.density))), ny = Math.max(1, Math.min(96, Math.round(spec.height * spec.density)))
  const cell = Math.min(spec.width / nx, spec.height / ny)
  const raw: { x: number; y: number; vx: number; vy: number; m: number }[] = []
  let top = 0
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = spec.x + ((i + 0.5) / nx) * spec.width, y = spec.y + ((j + 0.5) / ny) * spec.height
    const v = spec.vector(x, y)
    const vx = v && Number.isFinite(v[0]) ? (v[0] as number) : 0, vy = v && Number.isFinite(v[1]) ? (v[1] as number) : 0
    const m = Math.hypot(vx, vy)
    if (m > top) top = m
    raw.push({ x, y, vx, vy, m })
  }
  const longest = cell * spec.reach
  const k = spec.scale !== null && spec.scale > 0 ? spec.scale : top > 0 ? longest / top : 0
  return raw.map((a) => {
    const len = Math.min(a.m * k, longest)
    const f = a.m > 0 ? len / a.m : 0
    return { x: a.x, y: a.y, dx: a.vx * f, dy: a.vy * f, strength: top > 0 ? a.m / top : 0 }
  })
}
