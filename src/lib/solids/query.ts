/**
 * Pair queries between collision proxies: signed distance, gap, penetration depth, containment and overlap (IoU).
 *
 * Method (the project research notes): the signed distance field of one proxy is sampled on the
 * surface of the other, in both directions; the best samples are then slid along the surface (projected gradient
 * descent) so the answer does not depend on where the samples happened to land. Hollow parts work because their
 * distance field is hollow. Everything is deterministic; all distances are WORLD units.
 */
import type { Vec3 } from '../types.ts'
import { mat4Invert } from './mat4.ts'
import { type MeshData, meshDistance, meshIsClosed, meshSignedDistance } from './mesh.ts'
import type { Proxy } from './proxy.ts'
import { DEFAULT_SAMPLES, localSamples } from './sample.ts'
import { sdfBox } from './sdf.ts'

/** Options shared by the pair queries. */
export interface QueryOptions {
  /** Surface samples per proxy (default 64). More samples = finer coverage of small features. */
  samples?: number
  /** Seed of the deterministic sample pattern (default 1). */
  seed?: number
  /** World distance treated as "touching" / numerical noise (default 1e-4 of the smaller proxy's bounds diagonal). */
  tolerance?: number
}

/** Result of `penetration(a, b)`. */
export interface Penetration {
  /** How deep the solids overlap, world units: the largest depth of a surface point of one inside the other. */
  depth: number
  /** World position of that deepest surface point. */
  point: Vec3
  /** Fraction of a's surface samples that are inside b (1 = a is swallowed by b). */
  fractionInside: number
  /** Fraction of b's surface samples that are inside a. */
  fractionInsideOther: number
}

/** Result of `nearest(a, b)`. */
export interface Nearest {
  /** Signed world distance between the two surfaces: positive = gap, negative = penetration depth. */
  distance: number
  /** Closest (or deepest) point on a's surface, world space. */
  pointA: Vec3
  /** Matching point on b's surface, world space. `pointB - pointA` is the direction from a towards b when separated. */
  pointB: Vec3
}

// ───────────────────────────────────────────── prepared proxies ─────────────────────────────────────────────

/** A proxy with its inverse matrix, world bounds and distance function resolved once. */
export interface Prepared {
  proxy: Proxy
  valid: boolean
  m: number[]
  inv: number[]
  uniform: boolean
  scale: number
  minScale: number
  x0: number; y0: number; z0: number; x1: number; y1: number; z1: number
  diag: number
  raw: (p: Vec3) => number
  /** set only when distance comes from the mesh (no sdf given). */
  mesh: MeshData | null
  closed: boolean
  hollow: boolean
  halfWall: number
  /** finite-difference step in local units. */
  h: number
  sdfRef: unknown
  meshRef: unknown
  wallRef: number
  hollowRef: boolean
  lb: number[]
  sampleN: number
  sampleSeed: number
  samples: Float64Array
  sampleCount: number
}

const preparedCache = new WeakMap<Proxy, Prepared>()
const EMPTY = new Float64Array(0)

function isCurrent(P: Prepared, proxy: Proxy): boolean {
  const w = proxy.world, m = P.m
  if (!w || w.length < 16) return false
  for (let i = 0; i < 16; i++) if (w[i] !== m[i]) return false
  if (proxy.sdf !== P.sdfRef || proxy.mesh !== P.meshRef) return false
  if ((proxy.hollow === true) !== P.hollowRef || (proxy.wall ?? 0) !== P.wallRef) return false
  const lo = proxy.localBounds.min, hi = proxy.localBounds.max, lb = P.lb
  return lo[0] === lb[0] && lo[1] === lb[1] && lo[2] === lb[2] && hi[0] === lb[3] && hi[1] === lb[4] && hi[2] === lb[5]
}

/** Resolves a proxy for repeated queries (cached per proxy object; re-resolved automatically when its matrix changes). */
export function prepare(proxy: Proxy): Prepared {
  const cached = preparedCache.get(proxy)
  if (cached && isCurrent(cached, proxy)) return cached
  const P = build(proxy)
  preparedCache.set(proxy, P)
  return P
}

function build(proxy: Proxy): Prepared {
  const m = new Array<number>(16)
  const src = proxy.world
  let valid = !!src && src.length >= 16
  for (let i = 0; i < 16; i++) { m[i] = valid ? src[i]! : (i % 5 === 0 ? 1 : 0); if (!Number.isFinite(m[i]!)) valid = false }
  const inverse = valid ? mat4Invert(m) : null
  if (!inverse) valid = false
  const inv = inverse ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const lo = proxy.localBounds.min, hi = proxy.localBounds.max
  const lb = [lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]]
  for (const v of lb) if (!Number.isFinite(v)) valid = false

  const sx = Math.hypot(m[0]!, m[1]!, m[2]!), sy = Math.hypot(m[4]!, m[5]!, m[6]!), sz = Math.hypot(m[8]!, m[9]!, m[10]!)
  const maxScale = Math.max(sx, sy, sz), minScale = Math.min(sx, sy, sz)
  // uniform = a similarity transform: equal column lengths and mutually perpendicular columns
  const d01 = m[0]! * m[4]! + m[1]! * m[5]! + m[2]! * m[6]!, d02 = m[0]! * m[8]! + m[1]! * m[9]! + m[2]! * m[10]!
  const d12 = m[4]! * m[8]! + m[5]! * m[9]! + m[6]! * m[10]!
  const skew = Math.max(Math.abs(d01), Math.abs(d02), Math.abs(d12))
  const uniform = maxScale - minScale <= 1e-9 * maxScale && skew <= 1e-9 * maxScale * maxScale

  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? lb[3]! : lb[0]!, y = i & 2 ? lb[4]! : lb[1]!, z = i & 4 ? lb[5]! : lb[2]!
    const wx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!
    const wy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!
    const wz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!
    if (wx < x0) x0 = wx; if (wx > x1) x1 = wx
    if (wy < y0) y0 = wy; if (wy > y1) y1 = wy
    if (wz < z0) z0 = wz; if (wz > z1) z1 = wz
  }
  const diag = Math.hypot(x1 - x0, y1 - y0, z1 - z0)
  if (!Number.isFinite(diag)) valid = false
  const localDiag = Math.hypot(lb[3]! - lb[0]!, lb[4]! - lb[1]!, lb[5]! - lb[2]!)

  let raw: (p: Vec3) => number
  let mesh: MeshData | null = null
  let closed = true
  if (proxy.sdf) raw = proxy.sdf
  else if (proxy.mesh) {
    const data = proxy.mesh
    mesh = data
    closed = meshIsClosed(data)
    raw = p => meshSignedDistance(data, p)
  } else {
    const cx = (lb[0]! + lb[3]!) / 2, cy = (lb[1]! + lb[4]!) / 2, cz = (lb[2]! + lb[5]!) / 2
    const w = lb[3]! - lb[0]!, h = lb[4]! - lb[1]!, d = lb[5]! - lb[2]!
    const q: Vec3 = [0, 0, 0]
    raw = p => { q[0] = p[0] - cx; q[1] = p[1] - cy; q[2] = p[2] - cz; return sdfBox(q, w, h, d) }
  }

  return {
    proxy, valid, m, inv, uniform, scale: uniform ? sx : Math.cbrt(sx * sy * sz), minScale,
    x0, y0, z0, x1, y1, z1, diag, raw, mesh, closed,
    hollow: proxy.hollow === true, halfWall: Math.max(0, proxy.wall ?? 0) / 2,
    h: Math.max(localDiag * 1e-5, 1e-12),
    sdfRef: proxy.sdf, meshRef: proxy.mesh, wallRef: proxy.wall ?? 0, hollowRef: proxy.hollow === true, lb,
    sampleN: -1, sampleSeed: 0, samples: EMPTY, sampleCount: 0,
  }
}

/** World-space surface samples of a prepared proxy (flat xyz), cached for the last (n, seed). */
function worldSamples(P: Prepared, n: number, seed: number): number {
  if (P.sampleN === n && P.sampleSeed === seed) return P.sampleCount
  const local = localSamples(P.proxy, n, seed)
  const count = local.count, data = local.data, m = P.m
  const out = P.samples.length >= count * 3 ? P.samples : new Float64Array(count * 3)
  for (let i = 0; i < count; i++) {
    const x = data[i * 3]!, y = data[i * 3 + 1]!, z = data[i * 3 + 2]!
    out[i * 3] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!
    out[i * 3 + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!
    out[i * 3 + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!
  }
  P.samples = out; P.sampleCount = count; P.sampleN = n; P.sampleSeed = seed
  return count
}

// ───────────────────────────────────────────── distance field ───────────────────────────────────────────────

const lp: Vec3 = [0, 0, 0]
const cp: Vec3 = [0, 0, 0]
let gx = 0, gy = 0, gz = 0 // gradient scratch (local or world, unit length)
let qx = 0, qy = 0, qz = 0 // projection scratch (world)

/** Local signed distance including the hollow rule. */
function localDistance(P: Prepared, x: number, y: number, z: number): number {
  lp[0] = x; lp[1] = y; lp[2] = z
  const d = P.raw(lp)
  return P.hollow ? Math.abs(d + P.halfWall) - P.halfWall : d
}

function rawDistance(P: Prepared, x: number, y: number, z: number): number {
  lp[0] = x; lp[1] = y; lp[2] = z
  return P.raw(lp)
}

/** Unit gradient of the local distance at a local point into gx, gy, gz; false when it is undefined there. */
function localGradient(P: Prepared, x: number, y: number, z: number, solid: boolean): boolean {
  if (P.mesh) {
    lp[0] = x; lp[1] = y; lp[2] = z
    const d = meshSignedDistance(P.mesh, lp, cp)
    const vx = x - cp[0], vy = y - cp[1], vz = z - cp[2]
    const len = Math.sqrt(vx * vx + vy * vy + vz * vz)
    if (len > P.h) {
      let s = d < 0 ? -1 : 1
      if (!solid && P.hollow && d + P.halfWall < 0) s = -s
      s /= len
      gx = vx * s; gy = vy * s; gz = vz * s
      return true
    }
  }
  const h = P.h
  const f = solid ? rawDistance : localDistance
  const a = f(P, x + h, y - h, z - h), b = f(P, x - h, y - h, z + h), c = f(P, x - h, y + h, z - h), e = f(P, x + h, y + h, z + h)
  const ax = a - b - c + e, ay = -a - b + c + e, az = -a + b - c + e
  const len = Math.sqrt(ax * ax + ay * ay + az * az)
  if (!(len > 0)) return false
  gx = ax / len; gy = ay / len; gz = az / len
  return true
}

let gradientLength = 0

/** Value of the proxy's local distance at a world point; its unit WORLD gradient goes to gx, gy, gz and the gradient length to gradientLength (0 = undefined). */
function fieldAt(P: Prepared, wx: number, wy: number, wz: number): number {
  const inv = P.inv
  const x = inv[0]! * wx + inv[4]! * wy + inv[8]! * wz + inv[12]!
  const y = inv[1]! * wx + inv[5]! * wy + inv[9]! * wz + inv[13]!
  const z = inv[2]! * wx + inv[6]! * wy + inv[10]! * wz + inv[14]!
  const d = localDistance(P, x, y, z)
  gradientLength = 0
  if (!localGradient(P, x, y, z, false)) return d
  const ax = inv[0]! * gx + inv[1]! * gy + inv[2]! * gz
  const ay = inv[4]! * gx + inv[5]! * gy + inv[6]! * gz
  const az = inv[8]! * gx + inv[9]! * gy + inv[10]! * gz
  const len = Math.sqrt(ax * ax + ay * ay + az * az)
  if (!(len > 0)) return d
  gx = ax / len; gy = ay / len; gz = az / len
  gradientLength = len
  return d
}

let footX = 0, footY = 0, footZ = 0

/** Newton iteration from a world point onto the proxy's surface along the world gradient; result in footX..Z, its unit normal in gx, gy, gz. */
function newtonToSurface(P: Prepared, x: number, y: number, z: number): boolean {
  const done = 1e-9 * P.diag
  let ok = false
  for (let it = 0; it < 6; it++) {
    const f = fieldAt(P, x, y, z)
    if (gradientLength === 0) { ok = false; break }
    const k = f / gradientLength
    ok = true
    if (!(Math.abs(k) > done)) break
    x -= k * gx; y -= k * gy; z -= k * gz
  }
  footX = x; footY = y; footZ = z
  return ok
}

/**
 * World distance under non-uniform scale, where the local distance is no longer a distance: find the nearest
 * surface point in world space (Newton onto the surface, then tangential steps towards the query point that are
 * kept only when they get closer) and measure the straight line to it. Signed by inside/outside.
 */
function footDistance(P: Prepared, wx: number, wy: number, wz: number): number {
  const d0 = fieldAt(P, wx, wy, wz)
  if (gradientLength === 0 || !newtonToSurface(P, wx, wy, wz)) return d0 * P.minScale
  let x = footX, y = footY, z = footZ
  let nx = gx, ny = gy, nz = gz
  let best = Math.sqrt((wx - x) * (wx - x) + (wy - y) * (wy - y) + (wz - z) * (wz - z))
  let alpha = 1
  for (let round = 0; round < 6; round++) {
    const vx = wx - x, vy = wy - y, vz = wz - z
    const along = vx * nx + vy * ny + vz * nz
    const tx = vx - along * nx, ty = vy - along * ny, tz = vz - along * nz
    if (tx * tx + ty * ty + tz * tz <= 1e-8 * best * best) break
    if (!newtonToSurface(P, x + alpha * tx, y + alpha * ty, z + alpha * tz)) break
    const d = Math.sqrt((wx - footX) * (wx - footX) + (wy - footY) * (wy - footY) + (wz - footZ) * (wz - footZ))
    if (d < best) { best = d; x = footX; y = footY; z = footZ; nx = gx; ny = gy; nz = gz } else {
      alpha *= 0.5
      if (alpha < 0.1) break
    }
  }
  return d0 < 0 ? -best : best
}

/** Signed world distance from a world point to a prepared proxy. */
function worldDistance(P: Prepared, wx: number, wy: number, wz: number): number {
  const inv = P.inv
  if (!P.uniform) return footDistance(P, wx, wy, wz)
  const x = inv[0]! * wx + inv[4]! * wy + inv[8]! * wz + inv[12]!
  const y = inv[1]! * wx + inv[5]! * wy + inv[9]! * wz + inv[13]!
  const z = inv[2]! * wx + inv[6]! * wy + inv[10]! * wz + inv[14]!
  return localDistance(P, x, y, z) * P.scale
}

/** Unit world gradient of the proxy's distance field at a world point into gx, gy, gz. */
function worldGradient(P: Prepared, wx: number, wy: number, wz: number): boolean {
  const inv = P.inv
  const x = inv[0]! * wx + inv[4]! * wy + inv[8]! * wz + inv[12]!
  const y = inv[1]! * wx + inv[5]! * wy + inv[9]! * wz + inv[13]!
  const z = inv[2]! * wx + inv[6]! * wy + inv[10]! * wz + inv[14]!
  if (!localGradient(P, x, y, z, false)) return false
  const ax = inv[0]! * gx + inv[1]! * gy + inv[2]! * gz
  const ay = inv[4]! * gx + inv[5]! * gy + inv[6]! * gz
  const az = inv[8]! * gx + inv[9]! * gy + inv[10]! * gz
  const len = Math.sqrt(ax * ax + ay * ay + az * az)
  if (!(len > 0)) return false
  gx = ax / len; gy = ay / len; gz = az / len
  return true
}

/** Moves a world point onto the proxy's surface (nearest point in local space) into qx, qy, qz. */
function projectToSurface(P: Prepared, wx: number, wy: number, wz: number): void {
  const inv = P.inv, m = P.m
  let x = inv[0]! * wx + inv[4]! * wy + inv[8]! * wz + inv[12]!
  let y = inv[1]! * wx + inv[5]! * wy + inv[9]! * wz + inv[13]!
  let z = inv[2]! * wx + inv[6]! * wy + inv[10]! * wz + inv[14]!
  if (P.mesh) {
    lp[0] = x; lp[1] = y; lp[2] = z
    meshDistance(P.mesh, lp, cp)
    x = cp[0]; y = cp[1]; z = cp[2]
  } else {
    const done = P.h * 1e-2
    for (let it = 0; it < 4; it++) {
      const d = rawDistance(P, x, y, z)
      if (!(Math.abs(d) > done)) break
      if (!localGradient(P, x, y, z, true)) break
      x -= d * gx; y -= d * gy; z -= d * gz
    }
  }
  qx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!
  qy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!
  qz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!
}

/** Signed world distance from a world point to a proxy: negative inside the solid (hollow proxies are solid only at their wall). */
export function signedDistance(proxy: Proxy, pWorld: Vec3): number {
  const P = prepare(proxy)
  if (!P.valid) return Infinity
  return worldDistance(P, pWorld[0], pWorld[1], pWorld[2])
}

/** Nearest point on the proxy's surface to a world point, in world space. */
export function closestSurfacePoint(proxy: Proxy, pWorld: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
  const P = prepare(proxy)
  if (!P.valid) { out[0] = pWorld[0]; out[1] = pWorld[1]; out[2] = pWorld[2]; return out }
  projectToSurface(P, pWorld[0], pWorld[1], pWorld[2])
  out[0] = qx; out[1] = qy; out[2] = qz
  return out
}

// ───────────────────────────────────────────── bounds helpers ───────────────────────────────────────────────

function pointBoxDistance(B: Prepared, x: number, y: number, z: number): number {
  const dx = x < B.x0 ? B.x0 - x : x > B.x1 ? x - B.x1 : 0
  const dy = y < B.y0 ? B.y0 - y : y > B.y1 ? y - B.y1 : 0
  const dz = z < B.z0 ? B.z0 - z : z > B.z1 ? z - B.z1 : 0
  return dx === 0 && dy === 0 && dz === 0 ? 0 : Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** Distance between the world bounding boxes of two prepared proxies (0 when they overlap). */
export function boundsGap(A: Prepared, B: Prepared): number {
  const dx = A.x0 > B.x1 ? A.x0 - B.x1 : B.x0 > A.x1 ? B.x0 - A.x1 : 0
  const dy = A.y0 > B.y1 ? A.y0 - B.y1 : B.y0 > A.y1 ? B.y0 - A.y1 : 0
  const dz = A.z0 > B.z1 ? A.z0 - B.z1 : B.z0 > A.z1 ? B.z0 - A.z1 : 0
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// ───────────────────────────────────────────── directional scan ─────────────────────────────────────────────

let values = new Float64Array(256)
let exact = new Uint8Array(256)
// scan outputs
let outValue = Infinity, outX = 0, outY = 0, outZ = 0, outInside = 0, outCount = 0

const REFINE_STARTS = 2
const REFINE_STEPS = 24

/**
 * Slides a point over A's surface to a local extreme of B's distance field.
 * sign = +1 minimises the distance (closest / deepest point), sign = -1 maximises it. Result in outValue, outX..Z.
 *
 * Each round probes one step along B's gradient, pulled back onto A. Where the surface turns most of the step
 * back (sliding along a rim or an edge) the same surface direction is stretched to a full step. When the probe
 * overshoots, the extreme is bracketed and two interpolations are tried: the crossing of the two linear models
 * (exact on creases: a box edge, the mid-plane of a slab, the axis of a rod) and the secant of the two slopes
 * (exact on smooth valleys). The step halves after every overshoot.
 */
function refine(A: Prepared, B: Prepared, x: number, y: number, z: number, value: number, sign: number, step0: number, stop: number): void {
  let f = sign * value
  let step = step0
  const minStep = step0 / 128
  for (let it = 0; it < REFINE_STEPS; it++) {
    if (f <= stop) break
    if (!worldGradient(B, x, y, z)) break
    const g0x = gx, g0y = gy, g0z = gz
    const noise = 1e-12 * (1 + Math.abs(f))
    projectToSurface(A, x - sign * step * g0x, y - sign * step * g0y, z - sign * step * g0z)
    let ux = qx, uy = qy, uz = qz
    let fu = sign * worldDistance(B, ux, uy, uz)
    // the short probe, kept as a fallback when the stretched one overshoots
    let sx = x, sy = y, sz = z, fs = f
    let ex = ux - x, ey = uy - y, ez = uz - z
    let length = Math.sqrt(ex * ex + ey * ey + ez * ez)
    if (length > 1e-9 * step && length < 0.5 * step) {
      if (fu < f) { sx = ux; sy = uy; sz = uz; fs = fu }
      const k = step / length
      projectToSurface(A, x + ex * k, y + ey * k, z + ez * k)
      ux = qx; uy = qy; uz = qz
      fu = sign * worldDistance(B, ux, uy, uz)
      ex = ux - x; ey = uy - y; ez = uz - z
      length = Math.sqrt(ex * ex + ey * ey + ez * ez)
    }
    if (fu < f - noise && fu <= fs) { x = ux; y = uy; z = uz; f = fu; continue }
    // overshoot: the extreme lies between the current point and the probe
    let bx = sx, by = sy, bz = sz, fb = fs
    let g1x = g0x, g1y = g0y, g1z = g0z
    if (length > 0 && worldGradient(B, ux, uy, uz)) {
      g1x = gx; g1y = gy; g1z = gz
      const slope0 = (sign * (g0x * ex + g0y * ey + g0z * ez)) / length
      const slope1 = (sign * (g1x * ex + g1y * ey + g1z * ez)) / length
      const bend = slope1 - slope0
      if (slope0 < 0 && bend > 1e-9) {
        let crease = (f - fu + slope1 * length) / bend
        crease = crease < 0 ? 0 : crease > length ? length : crease
        let k = crease / length
        projectToSurface(A, x + ex * k, y + ey * k, z + ez * k)
        const cx = qx, cy = qy, cz = qz
        const fc = sign * worldDistance(B, cx, cy, cz)
        if (fc < fb) { bx = cx; by = cy; bz = cz; fb = fc }
        const valley = (-slope0 * length) / bend
        if (valley > 0 && valley < length && Math.abs(valley - crease) > 1e-3 * length) {
          k = valley / length
          projectToSurface(A, x + ex * k, y + ey * k, z + ez * k)
          const vx = qx, vy = qy, vz = qz
          const fv = sign * worldDistance(B, vx, vy, vz)
          if (fv < fb) { bx = vx; by = vy; bz = vz; fb = fv }
        }
      }
    }
    if (fb < f - noise) { x = bx; y = by; z = bz; f = fb }
    // on a crease the two gradients disagree; the shortest vector between them points ALONG the crease
    // (the steepest direction of a kinked field), so a ridge can be followed instead of zig-zagging across it
    const dx = g1x - g0x, dy = g1y - g0y, dz = g1z - g0z
    const spread = dx * dx + dy * dy + dz * dz
    if (spread > 0.1) {
      let t = (g1x * dx + g1y * dy + g1z * dz) / spread
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const mx = g1x - t * dx, my = g1y - t * dy, mz = g1z - t * dz
      const norm = Math.sqrt(mx * mx + my * my + mz * mz)
      if (norm > 1e-3) {
        const k = (sign * step) / norm
        projectToSurface(A, x - k * mx, y - k * my, z - k * mz)
        const wx = qx, wy = qy, wz = qz
        const fw = sign * worldDistance(B, wx, wy, wz)
        if (fw < f - noise) { x = wx; y = wy; z = wz; f = fw; continue }
      }
    }
    step *= 0.5
    if (step < minStep) break
  }
  outValue = sign * f; outX = x; outY = y; outZ = z
}

/**
 * Minimum of B's signed distance over A's surface.
 * `stop`: return as soon as a value <= stop is found (use -Infinity to always finish).
 * `reach`: skip the refinement when the samples already prove the minimum cannot get down to `reach`.
 * Outputs: outValue (min signed distance), outX..Z (where, on A), outInside / outCount (samples of A inside B).
 */
function scan(A: Prepared, B: Prepared, n: number, seed: number, stop: number, reach: number): void {
  const count = worldSamples(A, n, seed)
  const pts = A.samples
  outValue = Infinity; outX = outY = outZ = 0; outInside = 0; outCount = count
  if (count === 0) return
  if (values.length < count) { values = new Float64Array(count * 2); exact = new Uint8Array(count * 2) }
  let best = Infinity, bestIndex = -1, inside = 0
  for (let i = 0; i < count; i++) {
    const x = pts[i * 3]!, y = pts[i * 3 + 1]!, z = pts[i * 3 + 2]!
    const bound = pointBoxDistance(B, x, y, z)
    if (bound > 0 && bound > best) { values[i] = bound; exact[i] = 0; continue }
    const v = worldDistance(B, x, y, z)
    values[i] = v; exact[i] = 1
    if (v < 0) inside++
    if (v < best) {
      best = v; bestIndex = i
      if (v <= stop) { outValue = v; outX = x; outY = y; outZ = z; outInside = inside; return }
    }
  }
  outInside = inside
  if (bestIndex < 0) return // every distance was non-finite: nothing measurable (outValue stays Infinity)
  const step0 = A.diag / Math.sqrt(count)
  let resultValue = best
  let rx = pts[bestIndex * 3]!, ry = pts[bestIndex * 3 + 1]!, rz = pts[bestIndex * 3 + 2]!
  if (!(best - 2 * step0 > reach) && step0 > 0) {
    const apart = 2.25 * step0 * step0
    let firstX = 0, firstY = 0, firstZ = 0
    for (let k = 0; k < REFINE_STARTS; k++) {
      let pick = -1, pickValue = Infinity
      for (let i = 0; i < count; i++) {
        const v = values[i]!
        if (!(v < pickValue)) continue
        if (k > 0) {
          const dx = pts[i * 3]! - firstX, dy = pts[i * 3 + 1]! - firstY, dz = pts[i * 3 + 2]! - firstZ
          if (dx * dx + dy * dy + dz * dz < apart) continue
        }
        pick = i; pickValue = v
      }
      if (pick < 0) break
      const x = pts[pick * 3]!, y = pts[pick * 3 + 1]!, z = pts[pick * 3 + 2]!
      if (k === 0) { firstX = x; firstY = y; firstZ = z }
      if (exact[pick] === 0) pickValue = worldDistance(B, x, y, z)
      if (!Number.isFinite(pickValue)) continue
      refine(A, B, x, y, z, pickValue, 1, step0, stop)
      if (outValue < resultValue) { resultValue = outValue; rx = outX; ry = outY; rz = outZ }
      if (resultValue <= stop) break
    }
  }
  outValue = resultValue; outX = rx; outY = ry; outZ = rz; outInside = inside; outCount = count
}

function sampleCount(options: QueryOptions | undefined): number {
  const n = options?.samples
  return n !== undefined && Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_SAMPLES
}

function defaultTolerance(A: Prepared, B: Prepared, options: QueryOptions | undefined): number {
  const t = options?.tolerance
  return t !== undefined && t >= 0 ? t : 1e-4 * Math.min(A.diag, B.diag)
}

// ───────────────────────────────────────────── public queries ───────────────────────────────────────────────

/** Signed distance between two proxies with the closest (or deepest) point pair: positive = gap, negative = overlap depth. */
export function nearest(a: Proxy, b: Proxy, options?: QueryOptions): Nearest {
  const A = prepare(a), B = prepare(b)
  if (!A.valid || !B.valid) return { distance: Infinity, pointA: [0, 0, 0], pointB: [0, 0, 0] }
  const n = sampleCount(options), seed = options?.seed ?? 1
  scan(A, B, n, seed, -Infinity, Infinity)
  const dAB = outValue, ax = outX, ay = outY, az = outZ
  scan(B, A, n, seed, -Infinity, Infinity)
  const dBA = outValue, bx = outX, by = outY, bz = outZ
  if (!(dAB < Infinity) && !(dBA < Infinity)) return { distance: Infinity, pointA: [0, 0, 0], pointB: [0, 0, 0] }
  if (dAB <= dBA) {
    projectToSurface(B, ax, ay, az)
    return { distance: dAB, pointA: [ax, ay, az], pointB: [qx, qy, qz] }
  }
  projectToSurface(A, bx, by, bz)
  return { distance: dBA, pointA: [qx, qy, qz], pointB: [bx, by, bz] }
}

/** Clearance between two proxies in world units: 0 when they touch (within tolerance) or overlap. */
export function gap(a: Proxy, b: Proxy, options?: QueryOptions): number {
  const A = prepare(a), B = prepare(b)
  if (!A.valid || !B.valid) return Infinity
  const n = sampleCount(options), seed = options?.seed ?? 1, tolerance = defaultTolerance(A, B, options)
  scan(A, B, n, seed, tolerance, Infinity)
  let d = outValue
  if (d > tolerance) { scan(B, A, n, seed, tolerance, Infinity); if (outValue < d) d = outValue }
  return d <= tolerance ? 0 : d
}

/** Overlap of two solids: depth, where, and how much of each surface is inside the other; null when they do not overlap (beyond tolerance). */
export function penetration(a: Proxy, b: Proxy, options?: QueryOptions): Penetration | null {
  const A = prepare(a), B = prepare(b)
  if (!A.valid || !B.valid) return null
  if (A.x0 > B.x1 || B.x0 > A.x1 || A.y0 > B.y1 || B.y0 > A.y1 || A.z0 > B.z1 || B.z0 > A.z1) return null
  const n = sampleCount(options), seed = options?.seed ?? 1, tolerance = defaultTolerance(A, B, options)
  scan(A, B, n, seed, -Infinity, -tolerance)
  const dAB = outValue, ax = outX, ay = outY, az = outZ
  const fractionA = outCount > 0 ? outInside / outCount : 0
  scan(B, A, n, seed, -Infinity, -tolerance)
  const dBA = outValue
  const fractionB = outCount > 0 ? outInside / outCount : 0
  const d = Math.min(dAB, dBA)
  if (!(d < -tolerance)) return null
  const point: Vec3 = dAB <= dBA ? [ax, ay, az] : [outX, outY, outZ]
  return { depth: -d, point, fractionInside: fractionA, fractionInsideOther: fractionB }
}

/** True when two proxies touch or overlap: their surfaces come within `tolerance` world units. Stops at the first proof. */
export function touching(a: Proxy, b: Proxy, tolerance: number, options?: QueryOptions): boolean {
  return preparedTouching(prepare(a), prepare(b), tolerance, sampleCount(options), options?.seed ?? 1)
}

/** `touching` on prepared proxies (used by the contact graph). */
export function preparedTouching(A: Prepared, B: Prepared, tolerance: number, n: number = DEFAULT_SAMPLES, seed = 1): boolean {
  if (!A.valid || !B.valid) return false
  if (boundsGap(A, B) > tolerance) return false
  scan(A, B, n, seed, tolerance, tolerance)
  if (outValue <= tolerance) return true
  scan(B, A, n, seed, tolerance, tolerance)
  return outValue <= tolerance
}

/** True when solid `a` is entirely inside solid `b` (every surface point of a is strictly inside b, so a can never be seen). */
export function contained(a: Proxy, b: Proxy, options?: QueryOptions): boolean {
  const A = prepare(a), B = prepare(b)
  if (!A.valid || !B.valid) return false
  if (A.x0 > B.x1 || B.x0 > A.x1 || A.y0 > B.y1 || B.y0 > A.y1 || A.z0 > B.z1 || B.z0 > A.z1) return false
  const n = sampleCount(options), seed = options?.seed ?? 1
  const tolerance = options?.tolerance !== undefined && options.tolerance >= 0 ? options.tolerance : 1e-9 * Math.min(A.diag, B.diag)
  const count = worldSamples(A, n, seed)
  if (count === 0) return false
  const pts = A.samples
  let worst = -Infinity, wx = 0, wy = 0, wz = 0
  for (let i = 0; i < count; i++) {
    const x = pts[i * 3]!, y = pts[i * 3 + 1]!, z = pts[i * 3 + 2]!
    if (pointBoxDistance(B, x, y, z) > 0) return false
    const v = worldDistance(B, x, y, z)
    if (!(v < -tolerance)) return false
    if (v > worst) { worst = v; wx = x; wy = y; wz = z }
  }
  // push the least-inside sample outward along a's surface: a corner poking out between samples is still caught
  refine(A, B, wx, wy, wz, worst, -1, A.diag / Math.sqrt(count), -Infinity)
  return outValue < -tolerance
}

const R3A = 0.8191725133961645, R3B = 0.6710436067037893, R3C = 0.5497004779019703

function isInside(P: Prepared, wx: number, wy: number, wz: number): boolean {
  const inv = P.inv
  return rawDistance(P,
    inv[0]! * wx + inv[4]! * wy + inv[8]! * wz + inv[12]!,
    inv[1]! * wx + inv[5]! * wy + inv[9]! * wz + inv[13]!,
    inv[2]! * wx + inv[6]! * wy + inv[10]! * wz + inv[14]!) < 0
}

function determinant3(m: number[]): number {
  return m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) - m[4]! * (m[1]! * m[10]! - m[2]! * m[9]!) + m[8]! * (m[1]! * m[6]! - m[2]! * m[5]!)
}

/** Volume overlap of two proxies as intersection-over-union in [0, 1] (1 = same solid in the same place). Hollow flags are ignored: the outer solids are compared. */
export function iou(a: Proxy, b: Proxy, options?: QueryOptions): number {
  const A = prepare(a), B = prepare(b)
  if (!A.valid || !B.valid) return 0
  const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0), oz = Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0)
  if (ox < 0 || oy < 0 || oz < 0) return 0
  if (!A.closed || !B.closed) {
    // an open surface has no volume: compare the world bounding boxes instead
    const inter = ox * oy * oz
    const union = (A.x1 - A.x0) * (A.y1 - A.y0) * (A.z1 - A.z0) + (B.x1 - B.x0) * (B.y1 - B.y0) * (B.z1 - B.z0) - inter
    return union > 0 ? inter / union : 0
  }
  const seedShift = ((options?.seed ?? 1) * 0.6180339887498949) % 1
  const base = options?.samples !== undefined && options.samples >= 1 ? Math.floor(options.samples) : 512
  let inA = 0, inAB = 0, inB = 0, inBA = 0, done = 0
  let target = base
  const la = A.lb, lb = B.lb
  // sample each solid's own local bounding box (tight even when rotated); refine while either solid is thinly hit
  for (let round = 0; round < 4; round++) {
    for (let i = done; i < target; i++) {
      let u = seedShift + (i + 0.5) * R3A, v = seedShift + (i + 0.5) * R3B, w = seedShift + (i + 0.5) * R3C
      u -= Math.floor(u); v -= Math.floor(v); w -= Math.floor(w)
      let x = la[0]! + u * (la[3]! - la[0]!), y = la[1]! + v * (la[4]! - la[1]!), z = la[2]! + w * (la[5]! - la[2]!)
      if (rawDistance(A, x, y, z) < 0) {
        inA++
        const m = A.m
        if (isInside(B, m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!)) inAB++
      }
      x = lb[0]! + u * (lb[3]! - lb[0]!); y = lb[1]! + v * (lb[4]! - lb[1]!); z = lb[2]! + w * (lb[5]! - lb[2]!)
      if (rawDistance(B, x, y, z) < 0) {
        inB++
        const m = B.m
        if (isInside(A, m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!)) inBA++
      }
    }
    done = target
    if (Math.min(inA, inB) >= 48 || (inAB === 0 && inBA === 0 && round >= 1)) break
    target *= 2
  }
  if (inA === 0 || inB === 0) return 0
  const boxA = (la[3]! - la[0]!) * (la[4]! - la[1]!) * (la[5]! - la[2]!) * Math.abs(determinant3(A.m))
  const boxB = (lb[3]! - lb[0]!) * (lb[4]! - lb[1]!) * (lb[5]! - lb[2]!) * Math.abs(determinant3(B.m))
  const volumeA = (inA / done) * boxA, volumeB = (inB / done) * boxB
  const inter = 0.5 * ((inAB / done) * boxA + (inBA / done) * boxB)
  const union = volumeA + volumeB - inter
  if (!(union > 0)) return 0
  const value = inter / union
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** True when two proxies are (nearly) the same solid in the same place: IoU above `threshold` (COINCIDENT uses 0.9). */
export function coincident(a: Proxy, b: Proxy, threshold = 0.9, options?: QueryOptions): boolean {
  return iou(a, b, options) > threshold
}
