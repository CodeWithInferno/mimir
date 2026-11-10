/**
 * Triangle-mesh queries for the solids library: bounds, closedness, inside test (ray parity), distance and a
 * signed-distance approximation. A small bounding-volume hierarchy is built once per mesh object and cached,
 * so treat a `MeshData` as immutable after its first query (make a new object when the geometry changes).
 */
import type { Box3, Vec3 } from '../types.ts'

/** Indexed triangle mesh: flat xyz `positions` and flat triangle `indices` (three.js BufferGeometry layout). */
export interface MeshData { positions: ArrayLike<number>; indices: ArrayLike<number> }

interface Accel {
  triCount: number
  /** 9 numbers per triangle (ax ay az bx by bz cx cy cz), in hierarchy order. */
  tri: Float64Array
  /** 6 numbers per node: min xyz, max xyz. */
  box: Float64Array
  /** internal node: left child index; leaf: index of its first triangle. */
  a: Int32Array
  /** internal node: right child index; leaf: -(triangle count). */
  b: Int32Array
  bounds: Box3
  closed: boolean
  area: number
  volume: number
  /** cumulative triangle areas, built on first sampling. */
  cdf: Float64Array | null
}

const cache = new WeakMap<object, Accel>()
const LEAF = 4
const stack: number[] = []
// closest-point scratch (written by closestOnTriangle / nearestInAccel)
let cx = 0, cy = 0, cz = 0
let bestX = 0, bestY = 0, bestZ = 0

/** Three fixed, non-axis-aligned ray directions (unit length) used for the parity vote. */
const RAYS: readonly number[] = (() => {
  const raw = [0.61537, 0.492962, 0.614833, -0.371391, 0.557086, -0.742781, 0.137713, -0.839247, 0.526014]
  for (let i = 0; i < 9; i += 3) {
    const len = Math.hypot(raw[i]!, raw[i + 1]!, raw[i + 2]!)
    raw[i]! /= len; raw[i + 1]! /= len; raw[i + 2]! /= len
  }
  return raw
})()

/** Builds a `MeshData` from flat arrays or from arrays of `[x, y, z]` / `[a, b, c]` triples. */
export function meshData(
  positions: ArrayLike<number> | ArrayLike<ArrayLike<number>>,
  indices: ArrayLike<number> | ArrayLike<ArrayLike<number>>,
): MeshData {
  return { positions: flatten(positions), indices: flatten(indices) }
}

function flatten(a: ArrayLike<number> | ArrayLike<ArrayLike<number>>): ArrayLike<number> {
  if (a.length === 0 || typeof a[0] === 'number') return a as ArrayLike<number>
  const nested = a as ArrayLike<ArrayLike<number>>
  const out: number[] = []
  for (let i = 0; i < nested.length; i++) {
    const row = nested[i]!
    for (let j = 0; j < row.length; j++) out.push(row[j]!)
  }
  return out
}

function accel(mesh: MeshData): Accel {
  let acc = cache.get(mesh)
  if (!acc) { acc = build(mesh); cache.set(mesh, acc) }
  return acc
}

function build(mesh: MeshData): Accel {
  const pos = mesh.positions, idx = mesh.indices
  const vertexCount = Math.floor(pos.length / 3)
  const rawCount = Math.floor(idx.length / 3)
  // keep only triangles with valid indices and finite coordinates
  const src = new Float64Array(rawCount * 9)
  const corner = new Int32Array(rawCount * 3)
  let n = 0
  for (let t = 0; t < rawCount; t++) {
    let ok = true
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k]!
      if (!(v >= 0 && v < vertexCount && Number.isInteger(v))) { ok = false; break }
      const x = pos[v * 3]!, y = pos[v * 3 + 1]!, z = pos[v * 3 + 2]!
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { ok = false; break }
      src[n * 9 + k * 3] = x; src[n * 9 + k * 3 + 1] = y; src[n * 9 + k * 3 + 2] = z
      corner[n * 3 + k] = v
    }
    if (ok) n++
  }

  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]
  const cent = new Float64Array(n * 3)
  let area = 0, volume = 0
  for (let t = 0; t < n; t++) {
    const o = t * 9
    const ax = src[o]!, ay = src[o + 1]!, az = src[o + 2]!, bx = src[o + 3]!, by = src[o + 4]!, bz = src[o + 5]!
    const qx = src[o + 6]!, qy = src[o + 7]!, qz = src[o + 8]!
    for (let k = 0; k < 9; k += 3) {
      for (let d = 0; d < 3; d++) {
        const v = src[o + k + d]!
        if (v < min[d]!) min[d] = v
        if (v > max[d]!) max[d] = v
      }
    }
    cent[t * 3] = (ax + bx + qx) / 3; cent[t * 3 + 1] = (ay + by + qy) / 3; cent[t * 3 + 2] = (az + bz + qz) / 3
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = qx - ax, vy = qy - ay, vz = qz - az
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    area += 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz)
    volume += (ax * nx + ay * ny + az * nz) / 6
  }
  if (n === 0) { min[0] = min[1] = min[2] = 0; max[0] = max[1] = max[2] = 0 }

  const order = new Int32Array(n)
  for (let i = 0; i < n; i++) order[i] = i
  const maxNodes = Math.max(1, 2 * n)
  const box = new Float64Array(maxNodes * 6)
  const na = new Int32Array(maxNodes), nb = new Int32Array(maxNodes)
  let nodeCount = 0

  const make = (start: number, end: number): number => {
    const node = nodeCount++
    const o = node * 6
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
    let c0x = Infinity, c0y = Infinity, c0z = Infinity, c1x = -Infinity, c1y = -Infinity, c1z = -Infinity
    for (let i = start; i < end; i++) {
      const t = order[i]!, s = t * 9
      for (let k = 0; k < 9; k += 3) {
        const x = src[s + k]!, y = src[s + k + 1]!, z = src[s + k + 2]!
        if (x < x0) x0 = x; if (x > x1) x1 = x
        if (y < y0) y0 = y; if (y > y1) y1 = y
        if (z < z0) z0 = z; if (z > z1) z1 = z
      }
      const mx = cent[t * 3]!, my = cent[t * 3 + 1]!, mz = cent[t * 3 + 2]!
      if (mx < c0x) c0x = mx; if (mx > c1x) c1x = mx
      if (my < c0y) c0y = my; if (my > c1y) c1y = my
      if (mz < c0z) c0z = mz; if (mz > c1z) c1z = mz
    }
    box[o] = x0; box[o + 1] = y0; box[o + 2] = z0; box[o + 3] = x1; box[o + 4] = y1; box[o + 5] = z1
    if (end - start <= LEAF) { na[node] = start; nb[node] = -(end - start); return node }
    const ex = c1x - c0x, ey = c1y - c0y, ez = c1z - c0z
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2
    const split = axis === 0 ? (c0x + c1x) * 0.5 : axis === 1 ? (c0y + c1y) * 0.5 : (c0z + c1z) * 0.5
    let i = start, j = end - 1
    while (i <= j) {
      if (cent[order[i]! * 3 + axis]! < split) i++
      else { const tmp = order[i]!; order[i] = order[j]!; order[j] = tmp; j-- }
    }
    let mid = i
    if (mid === start || mid === end) mid = (start + end) >> 1
    na[node] = make(start, mid)
    nb[node] = make(mid, end)
    return node
  }
  if (n > 0) make(0, n)
  else { na[0] = 0; nb[0] = 0 }

  const tri = new Float64Array(n * 9)
  for (let i = 0; i < n; i++) {
    const s = order[i]! * 9
    for (let k = 0; k < 9; k++) tri[i * 9 + k] = src[s + k]!
  }

  return {
    triCount: n, tri, box, a: na, b: nb, bounds: { min, max },
    closed: n > 0 && isWatertight(pos, corner, n, min, max), area, volume: Math.abs(volume), cdf: null,
  }
}

/** True when every edge (after welding coincident vertices) is shared by an even number >= 2 of triangles. */
function isWatertight(pos: ArrayLike<number>, corner: Int32Array, n: number, min: Vec3, max: Vec3): boolean {
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2])
  const cell = Math.max(diag * 1e-6, 1e-12)
  const welded = new Map<string, number>()
  const remap = new Map<number, number>()
  const id = (v: number): number => {
    let w = remap.get(v)
    if (w === undefined) {
      const key = `${Math.round(pos[v * 3]! / cell + 0.3183)},${Math.round(pos[v * 3 + 1]! / cell + 0.3183)},${Math.round(pos[v * 3 + 2]! / cell + 0.3183)}`
      w = welded.get(key)
      if (w === undefined) { w = welded.size; welded.set(key, w) }
      remap.set(v, w)
    }
    return w
  }
  const edges = new Map<number, number>()
  const big = 67108864 // 2^26 welded vertices is far beyond any proxy mesh
  const add = (p: number, q: number): void => {
    const key = p < q ? p * big + q : q * big + p
    edges.set(key, (edges.get(key) ?? 0) + 1)
  }
  let used = 0
  for (let t = 0; t < n; t++) {
    const p = id(corner[t * 3]!), q = id(corner[t * 3 + 1]!), r = id(corner[t * 3 + 2]!)
    if (p === q || q === r || r === p) continue // degenerate sliver: contributes no surface
    add(p, q); add(q, r); add(r, p); used++
  }
  if (used === 0) return false
  for (const count of edges.values()) if (count < 2 || (count & 1) === 1) return false
  return true
}

/** Squared distance from p to triangle `t` of `acc`; writes the closest point into cx, cy, cz. */
function closestOnTriangle(tri: Float64Array, o: number, px: number, py: number, pz: number): number {
  const ax = tri[o]!, ay = tri[o + 1]!, az = tri[o + 2]!
  const bx = tri[o + 3]!, by = tri[o + 4]!, bz = tri[o + 5]!
  const qx = tri[o + 6]!, qy = tri[o + 7]!, qz = tri[o + 8]!
  const abx = bx - ax, aby = by - ay, abz = bz - az
  const acx = qx - ax, acy = qy - ay, acz = qz - az
  const apx = px - ax, apy = py - ay, apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  if (d1 <= 0 && d2 <= 0) { cx = ax; cy = ay; cz = az } else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz
    const d3 = abx * bpx + aby * bpy + abz * bpz
    const d4 = acx * bpx + acy * bpy + acz * bpz
    if (d3 >= 0 && d4 <= d3) { cx = bx; cy = by; cz = bz } else {
      const vc = d1 * d4 - d3 * d2
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 - d3 !== 0 ? d1 / (d1 - d3) : 0
        cx = ax + abx * v; cy = ay + aby * v; cz = az + abz * v
      } else {
        const cpx = px - qx, cpy = py - qy, cpz = pz - qz
        const d5 = abx * cpx + aby * cpy + abz * cpz
        const d6 = acx * cpx + acy * cpy + acz * cpz
        if (d6 >= 0 && d5 <= d6) { cx = qx; cy = qy; cz = qz } else {
          const vb = d5 * d2 - d1 * d6
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 - d6 !== 0 ? d2 / (d2 - d6) : 0
            cx = ax + acx * w; cy = ay + acy * w; cz = az + acz * w
          } else {
            const va = d3 * d6 - d5 * d4
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const denom = d4 - d3 + (d5 - d6)
              const w = denom !== 0 ? (d4 - d3) / denom : 0
              cx = bx + (qx - bx) * w; cy = by + (qy - by) * w; cz = bz + (qz - bz) * w
            } else {
              const sum = va + vb + vc
              if (sum !== 0) {
                const v = vb / sum, w = vc / sum
                cx = ax + abx * v + acx * w; cy = ay + aby * v + acy * w; cz = az + abz * v + acz * w
              } else { cx = ax; cy = ay; cz = az }
            }
          }
        }
      }
    }
  }
  const dx = px - cx, dy = py - cy, dz = pz - cz
  return dx * dx + dy * dy + dz * dz
}

function boxDist2(box: Float64Array, node: number, px: number, py: number, pz: number): number {
  const o = node * 6
  const dx = px < box[o]! ? box[o]! - px : px > box[o + 3]! ? px - box[o + 3]! : 0
  const dy = py < box[o + 1]! ? box[o + 1]! - py : py > box[o + 4]! ? py - box[o + 4]! : 0
  const dz = pz < box[o + 2]! ? box[o + 2]! - pz : pz > box[o + 5]! ? pz - box[o + 5]! : 0
  return dx * dx + dy * dy + dz * dz
}

/** Squared distance to the nearest triangle; writes the closest point into bestX, bestY, bestZ. */
function nearestInAccel(acc: Accel, px: number, py: number, pz: number): number {
  if (acc.triCount === 0) { bestX = px; bestY = py; bestZ = pz; return Infinity }
  const { tri, box, a, b } = acc
  let best = Infinity
  let sp = 0
  stack[sp++] = 0
  while (sp > 0) {
    const node = stack[--sp]!
    if (boxDist2(box, node, px, py, pz) >= best) continue
    const right = b[node]!
    if (right < 0) {
      const first = a[node]!, count = -right
      for (let i = first; i < first + count; i++) {
        const d = closestOnTriangle(tri, i * 9, px, py, pz)
        if (d < best) { best = d; bestX = cx; bestY = cy; bestZ = cz }
      }
    } else {
      const left = a[node]!
      const dl = boxDist2(box, left, px, py, pz), dr = boxDist2(box, right, px, py, pz)
      if (dl < dr) { if (dr < best) stack[sp++] = right; if (dl < best) stack[sp++] = left } else { if (dl < best) stack[sp++] = left; if (dr < best) stack[sp++] = right }
    }
  }
  return best
}

/** Number of triangles crossed by the ray p + t*d, t > 0. */
function crossings(acc: Accel, px: number, py: number, pz: number, dx: number, dy: number, dz: number): number {
  if (acc.triCount === 0) return 0
  const { tri, box, a, b } = acc
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz
  let hits = 0
  let sp = 0
  stack[sp++] = 0
  while (sp > 0) {
    const node = stack[--sp]!
    const o = node * 6
    let t0 = (box[o]! - px) * ix, t1 = (box[o + 3]! - px) * ix
    let lo = t0 < t1 ? t0 : t1, hi = t0 < t1 ? t1 : t0
    t0 = (box[o + 1]! - py) * iy; t1 = (box[o + 4]! - py) * iy
    lo = Math.max(lo, t0 < t1 ? t0 : t1); hi = Math.min(hi, t0 < t1 ? t1 : t0)
    t0 = (box[o + 2]! - pz) * iz; t1 = (box[o + 5]! - pz) * iz
    lo = Math.max(lo, t0 < t1 ? t0 : t1); hi = Math.min(hi, t0 < t1 ? t1 : t0)
    if (hi < 0 || lo > hi) continue
    const right = b[node]!
    if (right >= 0) { stack[sp++] = a[node]!; stack[sp++] = right; continue }
    const first = a[node]!, count = -right
    for (let i = first; i < first + count; i++) {
      const s = i * 9
      const ax = tri[s]!, ay = tri[s + 1]!, az = tri[s + 2]!
      const e1x = tri[s + 3]! - ax, e1y = tri[s + 4]! - ay, e1z = tri[s + 5]! - az
      const e2x = tri[s + 6]! - ax, e2y = tri[s + 7]! - ay, e2z = tri[s + 8]! - az
      const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x
      const det = e1x * hx + e1y * hy + e1z * hz
      if (det === 0) continue
      const inv = 1 / det
      const sx = px - ax, sy = py - ay, sz = pz - az
      const u = (sx * hx + sy * hy + sz * hz) * inv
      if (u < 0 || u > 1) continue
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x
      const v = (dx * qx + dy * qy + dz * qz) * inv
      if (v < 0 || u + v > 1) continue
      if ((e2x * qx + e2y * qy + e2z * qz) * inv > 0) hits++
    }
  }
  return hits
}

function insideAccel(acc: Accel, px: number, py: number, pz: number): boolean {
  const lo = acc.bounds.min, hi = acc.bounds.max
  if (px < lo[0] || px > hi[0] || py < lo[1] || py > hi[1] || pz < lo[2] || pz > hi[2]) return false
  const hits = crossings(acc, px, py, pz, RAYS[0]!, RAYS[1]!, RAYS[2]!)
  if (hits === 0) return false // a ray from inside a closed mesh always crosses it at least once
  const first = hits & 1
  const second = crossings(acc, px, py, pz, RAYS[3]!, RAYS[4]!, RAYS[5]!) & 1
  if (first === second) return first === 1
  return (crossings(acc, px, py, pz, RAYS[6]!, RAYS[7]!, RAYS[8]!) & 1) === 1
}

/** Local bounding box of a mesh (all zeros for an empty mesh). */
export function meshBounds(mesh: MeshData): Box3 {
  const b = accel(mesh).bounds
  return { min: [b.min[0], b.min[1], b.min[2]], max: [b.max[0], b.max[1], b.max[2]] }
}

/** True when the mesh is watertight (coincident vertices are welded first), i.e. inside/outside is well defined. */
export function meshIsClosed(mesh: MeshData): boolean {
  return accel(mesh).closed
}

/** Total surface area of a mesh. */
export function meshArea(mesh: MeshData): number {
  return accel(mesh).area
}

/** Enclosed volume of a closed mesh (absolute value of the signed sum; meaningless for open meshes). */
export function meshVolume(mesh: MeshData): number {
  return accel(mesh).volume
}

/** True when `p` is inside a CLOSED mesh: ray parity along fixed jittered directions, best two of three. */
export function pointInMesh(mesh: MeshData, p: Vec3): boolean {
  return insideAccel(accel(mesh), p[0], p[1], p[2])
}

/** Unsigned distance from `p` to the mesh surface; when `closestOut` is given it receives the nearest surface point. */
export function meshDistance(mesh: MeshData, p: Vec3, closestOut?: Vec3): number {
  const d2 = nearestInAccel(accel(mesh), p[0], p[1], p[2])
  if (closestOut) { closestOut[0] = bestX; closestOut[1] = bestY; closestOut[2] = bestZ }
  return Math.sqrt(d2)
}

/** Signed distance from `p` to a mesh: exact distance to the nearest triangle, negative inside a closed mesh (unsigned for open meshes). */
export function meshSignedDistance(mesh: MeshData, p: Vec3, closestOut?: Vec3): number {
  const acc = accel(mesh)
  const d = Math.sqrt(nearestInAccel(acc, p[0], p[1], p[2]))
  if (closestOut) { closestOut[0] = bestX; closestOut[1] = bestY; closestOut[2] = bestZ }
  return acc.closed && insideAccel(acc, p[0], p[1], p[2]) ? -d : d
}

/** Returns a local-space signed distance function for a mesh (see `meshSignedDistance`). */
export function meshSdf(mesh: MeshData): (pLocal: Vec3) => number {
  return p => meshSignedDistance(mesh, p)
}

/** Fills `out` (3 numbers per point) with `n` area-weighted, stratified surface points of the mesh; returns the count written. */
export function meshSurfacePoints(mesh: MeshData, n: number, random: () => number, out: Float64Array): number {
  const acc = accel(mesh)
  const count = acc.triCount
  if (count === 0 || !(acc.area > 0) || n <= 0) return 0
  let cdf = acc.cdf
  if (!cdf) {
    cdf = new Float64Array(count)
    let sum = 0
    for (let t = 0; t < count; t++) {
      const o = t * 9, tri = acc.tri
      const ux = tri[o + 3]! - tri[o]!, uy = tri[o + 4]! - tri[o + 1]!, uz = tri[o + 5]! - tri[o + 2]!
      const vx = tri[o + 6]! - tri[o]!, vy = tri[o + 7]! - tri[o + 1]!, vz = tri[o + 8]! - tri[o + 2]!
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
      sum += 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz)
      cdf[t] = sum
    }
    acc.cdf = cdf
  }
  const total = cdf[count - 1]!
  const tri = acc.tri
  for (let i = 0; i < n; i++) {
    const target = ((i + random()) / n) * total
    let lo = 0, hi = count - 1
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid]! < target) lo = mid + 1; else hi = mid }
    const o = lo * 9
    const s = Math.sqrt(random()), r = random()
    const wa = 1 - s, wb = s * (1 - r), wc = s * r
    out[i * 3] = tri[o]! * wa + tri[o + 3]! * wb + tri[o + 6]! * wc
    out[i * 3 + 1] = tri[o + 1]! * wa + tri[o + 4]! * wb + tri[o + 7]! * wc
    out[i * 3 + 2] = tri[o + 2]! * wa + tri[o + 5]! * wb + tri[o + 8]! * wc
  }
  return n
}
