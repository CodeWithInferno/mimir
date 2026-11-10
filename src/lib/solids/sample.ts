/**
 * Deterministic surface sampling of proxies.
 *  - primitives (`proxy.shape`): analytic, area-uniform, low-discrepancy points on every face;
 *  - meshes: triangle-area-weighted, stratified;
 *  - custom sdf only: points inside the local bounds projected onto the zero level set (covers bores and pockets).
 * The same (geometry, n, seed) always gives the same points. Results are cached per geometry object.
 */
import type { Vec3 } from '../types.ts'
import { meshSurfacePoints } from './mesh.ts'
import type { Proxy } from './proxy.ts'
import type { Shape } from './sdf.ts'

/** Default number of surface samples per proxy used by the pair queries. */
export const DEFAULT_SAMPLES = 64

const TAU = Math.PI * 2
const R2A = 0.7548776662466927, R2B = 0.5698402909980532
const R3A = 0.8191725133961645, R3B = 0.6710436067037893, R3C = 0.5497004779019703

/** Small seeded generator (mulberry32) returning floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = (Math.floor(seed) | 0) + 0x9e3779b9
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Face { area: number; put: (u: number, v: number, out: Float64Array, o: number) => void }

function disc(y: number, inner: number, outer: number): Face {
  return {
    area: Math.PI * (outer * outer - inner * inner),
    put: (u, v, out, o) => {
      const r = Math.sqrt(inner * inner + u * (outer * outer - inner * inner)), a = TAU * v
      out[o] = r * Math.cos(a); out[o + 1] = y; out[o + 2] = r * Math.sin(a)
    },
  }
}

function wall(radius: number, height: number): Face {
  return {
    area: TAU * radius * height,
    put: (u, v, out, o) => {
      const a = TAU * u
      out[o] = radius * Math.cos(a); out[o + 1] = (v - 0.5) * height; out[o + 2] = radius * Math.sin(a)
    },
  }
}

function rectFace(axis: 0 | 1 | 2, at: number, sizeU: number, sizeV: number): Face {
  const iu = (axis + 1) % 3, iv = (axis + 2) % 3
  return {
    area: sizeU * sizeV,
    put: (u, v, out, o) => { out[o + axis] = at; out[o + iu] = (u - 0.5) * sizeU; out[o + iv] = (v - 0.5) * sizeV },
  }
}

function shapeFaces(shape: Shape): Face[] {
  switch (shape.kind) {
    case 'box': {
      const w = Math.abs(shape.width), h = Math.abs(shape.height), d = Math.abs(shape.depth)
      return [
        rectFace(0, w / 2, h, d), rectFace(0, -w / 2, h, d),
        rectFace(1, h / 2, d, w), rectFace(1, -h / 2, d, w),
        rectFace(2, d / 2, w, h), rectFace(2, -d / 2, w, h),
      ]
    }
    case 'sphere': {
      const r = Math.abs(shape.radius)
      return [{
        area: 2 * TAU * r * r,
        put: (u, v, out, o) => {
          const y = 1 - 2 * u, s = Math.sqrt(Math.max(0, 1 - y * y)), a = TAU * v
          out[o] = r * s * Math.cos(a); out[o + 1] = r * y; out[o + 2] = r * s * Math.sin(a)
        },
      }]
    }
    case 'cylinder': {
      const r = Math.abs(shape.radius), h = Math.abs(shape.height)
      return [wall(r, h), disc(h / 2, 0, r), disc(-h / 2, 0, r)]
    }
    case 'cone': {
      const r1 = Math.abs(shape.radius), r2 = Math.abs(shape.topRadius ?? 0), h = Math.abs(shape.height)
      const faces: Face[] = [{
        area: Math.PI * (r1 + r2) * Math.hypot(h, r1 - r2),
        put: (u, v, out, o) => {
          const r = Math.sqrt(r2 * r2 + u * (r1 * r1 - r2 * r2))
          const t = r1 !== r2 ? (r1 - r) / (r1 - r2) : u, a = TAU * v
          out[o] = r * Math.cos(a); out[o + 1] = (t - 0.5) * h; out[o + 2] = r * Math.sin(a)
        },
      }, disc(-h / 2, 0, r1)]
      if (r2 > 0) faces.push(disc(h / 2, 0, r2))
      return faces
    }
    case 'torus': {
      const R = Math.abs(shape.radius), r = Math.abs(shape.tube)
      return [{
        area: TAU * TAU * R * r,
        put: (u, v, out, o) => {
          // tube angle with density proportional to (R + r cos phi): invert the CDF with a few Newton steps
          let phi = TAU * v
          if (R > r) for (let i = 0; i < 4; i++) phi -= (R * phi + r * Math.sin(phi) - TAU * R * v) / (R + r * Math.cos(phi))
          const ring = R + r * Math.cos(phi), a = TAU * u
          out[o] = ring * Math.cos(a); out[o + 1] = r * Math.sin(phi); out[o + 2] = ring * Math.sin(a)
        },
      }]
    }
    case 'tube': {
      const outer = Math.abs(shape.radius), h = Math.abs(shape.height)
      const inner = Math.max(0, outer - Math.abs(shape.thickness))
      const faces: Face[] = [wall(outer, h), disc(h / 2, inner, outer), disc(-h / 2, inner, outer)]
      if (inner > 0) faces.push(wall(inner, h))
      return faces
    }
    case 'capsule': {
      const r = Math.abs(shape.radius), half = Math.max(0, Math.abs(shape.height) / 2 - r)
      const cap = (dir: 1 | -1): Face => ({
        area: TAU * r * r,
        put: (u, v, out, o) => {
          const s = Math.sqrt(Math.max(0, 1 - u * u)), a = TAU * v
          out[o] = r * s * Math.cos(a); out[o + 1] = dir * (half + r * u); out[o + 2] = r * s * Math.sin(a)
        },
      })
      const faces: Face[] = [cap(1), cap(-1)]
      if (half > 0) faces.push(wall(r, half * 2))
      return faces
    }
  }
}

/** Distributes n points over faces by area (largest remainder, at least one per non-empty face when n allows). */
function facePoints(faces: Face[], n: number, seed: number, out: Float64Array): number {
  let total = 0
  const live: Face[] = []
  for (const f of faces) if (f.area > 0 && Number.isFinite(f.area)) { live.push(f); total += f.area }
  if (live.length === 0 || n <= 0) return 0
  const counts = new Array<number>(live.length).fill(0)
  const rest = new Array<number>(live.length).fill(0)
  let used = 0
  for (let i = 0; i < live.length; i++) {
    const exact = (n * live[i]!.area) / total
    counts[i] = Math.floor(exact); rest[i] = exact - counts[i]!; used += counts[i]!
  }
  while (used < n) {
    let best = 0
    for (let i = 1; i < live.length; i++) if (rest[i]! > rest[best]!) best = i
    counts[best]!++; rest[best] = -1; used++
  }
  if (n >= live.length) {
    for (let i = 0; i < live.length; i++) {
      if (counts[i]! > 0) continue
      let rich = 0
      for (let j = 1; j < live.length; j++) if (counts[j]! > counts[rich]!) rich = j
      counts[rich]!--; counts[i] = 1
    }
  }
  const random = mulberry32(seed)
  const offsetU = random(), offsetV = random()
  let o = 0
  for (let f = 0; f < live.length; f++) {
    const face = live[f]!
    for (let i = 0; i < counts[f]!; i++) {
      let u = offsetU + f * 0.411 + (i + 0.5) * R2A, v = offsetV + f * 0.733 + (i + 0.5) * R2B
      u -= Math.floor(u); v -= Math.floor(v)
      face.put(u, v, out, o)
      o += 3
    }
  }
  return o / 3
}

const scratch: Vec3 = [0, 0, 0]

/** Projects points spread through the local bounds onto the zero level set of a custom sdf. */
function sdfPoints(proxy: Proxy, sdf: (p: Vec3) => number, n: number, seed: number, out: Float64Array): number {
  const lo = proxy.localBounds.min, hi = proxy.localBounds.max
  const sx = hi[0] - lo[0], sy = hi[1] - lo[1], sz = hi[2] - lo[2]
  const diag = Math.hypot(sx, sy, sz)
  if (!(diag > 0) || !Number.isFinite(diag)) return 0
  const h = diag * 1e-4, accept = diag * 1e-4
  const random = mulberry32(seed)
  const o1 = random(), o2 = random(), o3 = random()
  const p = scratch
  let count = 0
  for (let i = 0; i < n * 4 && count < n; i++) {
    let u = o1 + (i + 0.5) * R3A, v = o2 + (i + 0.5) * R3B, w = o3 + (i + 0.5) * R3C
    u -= Math.floor(u); v -= Math.floor(v); w -= Math.floor(w)
    let x = lo[0] + u * sx, y = lo[1] + v * sy, z = lo[2] + w * sz
    let d = 0
    for (let it = 0; it < 12; it++) {
      p[0] = x; p[1] = y; p[2] = z
      d = sdf(p)
      if (!(Math.abs(d) > accept * 0.1)) break
      // tetrahedral finite-difference gradient
      p[0] = x + h; p[1] = y - h; p[2] = z - h; const a = sdf(p)
      p[0] = x - h; p[1] = y - h; p[2] = z + h; const b = sdf(p)
      p[0] = x - h; p[1] = y + h; p[2] = z - h; const c = sdf(p)
      p[0] = x + h; p[1] = y + h; p[2] = z + h; const e = sdf(p)
      let gx = a - b - c + e, gy = -a - b + c + e, gz = -a + b - c + e
      const len = Math.hypot(gx, gy, gz)
      if (!(len > 0)) break
      gx /= len; gy /= len; gz /= len
      x -= d * gx; y -= d * gy; z -= d * gz
    }
    if (Math.abs(d) <= accept) { out[count * 3] = x; out[count * 3 + 1] = y; out[count * 3 + 2] = z; count++ }
  }
  return count
}

interface Samples { data: Float64Array; count: number }
const cache = new WeakMap<object, Map<string, Samples>>()

function shapeKey(shape: Shape): string {
  switch (shape.kind) {
    case 'box': return `b${shape.width},${shape.height},${shape.depth}`
    case 'sphere': return `s${shape.radius}`
    case 'cylinder': return `c${shape.radius},${shape.height}`
    case 'cone': return `k${shape.radius},${shape.height},${shape.topRadius ?? 0}`
    case 'torus': return `o${shape.radius},${shape.tube}`
    case 'tube': return `t${shape.radius},${shape.thickness},${shape.height}`
    case 'capsule': return `p${shape.radius},${shape.height}`
  }
}

/** Local-space surface samples as a flat array (3 numbers per point) plus the number of points; cached, do not mutate. */
export function localSamples(proxy: Proxy, n: number = DEFAULT_SAMPLES, seed = 1): Samples {
  n = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
  const lo = proxy.localBounds.min, hi = proxy.localBounds.max
  const owner: object = proxy.shape ?? proxy.mesh ?? proxy.sdf ?? proxy.localBounds
  const key = proxy.shape ? `${n}|${seed}|${shapeKey(proxy.shape)}`
    : proxy.mesh ? `${n}|${seed}`
      : `${n}|${seed}|${lo[0]},${lo[1]},${lo[2]},${hi[0]},${hi[1]},${hi[2]}`
  let byKey = cache.get(owner)
  if (!byKey) { byKey = new Map(); cache.set(owner, byKey) }
  let hit = byKey.get(key)
  if (hit) return hit
  const data = new Float64Array(n * 3)
  let count = 0
  if (proxy.shape) count = facePoints(shapeFaces(proxy.shape), n, seed, data)
  else if (proxy.mesh) count = meshSurfacePoints(proxy.mesh, n, mulberry32(seed), data)
  else if (proxy.sdf) count = sdfPoints(proxy, proxy.sdf, n, seed, data)
  else {
    // bounds-only proxy: sample the bounding box itself
    const w = hi[0] - lo[0], h = hi[1] - lo[1], d = hi[2] - lo[2]
    count = facePoints(shapeFaces({ kind: 'box', width: w, height: h, depth: d }), n, seed, data)
    const mx = (lo[0] + hi[0]) / 2, my = (lo[1] + hi[1]) / 2, mz = (lo[2] + hi[2]) / 2
    for (let i = 0; i < count; i++) { data[i * 3]! += mx; data[i * 3 + 1]! += my; data[i * 3 + 2]! += mz }
  }
  for (let i = 0; i < count * 3; i++) if (!Number.isFinite(data[i]!)) { count = 0; break }
  hit = { data, count }
  if (byKey.size > 16) byKey.clear()
  byKey.set(key, hit)
  return hit
}

/** `n` deterministic points on the proxy's surface in LOCAL space (custom-sdf proxies may return fewer). */
export function localSurfaceSamples(proxy: Proxy, n: number = DEFAULT_SAMPLES, seed = 1): Vec3[] {
  const { data, count } = localSamples(proxy, n, seed)
  const out: Vec3[] = new Array<Vec3>(count)
  for (let i = 0; i < count; i++) out[i] = [data[i * 3]!, data[i * 3 + 1]!, data[i * 3 + 2]!]
  return out
}

/** `n` deterministic points on the proxy's surface in WORLD space (analytic for primitives, area-weighted for meshes). */
export function surfaceSamples(proxy: Proxy, n: number = DEFAULT_SAMPLES, seed = 1): Vec3[] {
  const { data, count } = localSamples(proxy, n, seed)
  const m = proxy.world
  const out: Vec3[] = new Array<Vec3>(count)
  for (let i = 0; i < count; i++) {
    const x = data[i * 3]!, y = data[i * 3 + 1]!, z = data[i * 3 + 2]!
    out[i] = [
      m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
      m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
      m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
    ]
  }
  return out
}
