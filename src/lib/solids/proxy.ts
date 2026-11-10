/**
 * Collision proxies: the plain-data stand-in for a part that the 3D checks measure.
 * A proxy is a local-space solid (analytic sdf and/or triangle mesh) plus a world matrix.
 */
import type { Box3, Vec3 } from '../types.ts'
import { type Mat4, mat4Identity } from './mat4.ts'
import { type MeshData, meshBounds, meshIsClosed } from './mesh.ts'
import { type Shape, shapeBounds, shapeSdf } from './sdf.ts'

/**
 * Collision proxy of one part.
 * Distance comes from `sdf` when present, else from `mesh`, else the proxy is the box `localBounds`.
 * Surface samples come from `shape` (analytic), else `mesh` (area-weighted), else by projecting onto `sdf`.
 */
export interface Proxy {
  /** Part id (used in results). */
  id: string
  /** Signed distance in LOCAL space: negative inside. The argument is a scratch vector, do not keep it. */
  sdf?: (pLocal: Vec3) => number
  /** Triangle mesh in LOCAL space. */
  mesh?: MeshData
  /** Local-space bounding box of the solid. */
  localBounds: Box3
  /** Local-to-world matrix (column-major 16 numbers); may contain non-uniform scale. */
  world: Mat4
  /** True for a shell/housing: only the surface is solid, the interior is empty space (nothing can be "inside" it). */
  hollow?: boolean
  /** Wall thickness of a hollow proxy, measured inward from the surface in local units (default 0 = a thin skin). */
  wall?: number
  /** Primitive description; enables exact analytic surface sampling. Set by `primitiveProxy`. */
  shape?: Shape
}

/** Optional flags shared by the proxy constructors. */
export interface ProxyOptions { hollow?: boolean; wall?: number }

/** Proxy for a primitive solid (box, sphere, cylinder, cone, torus, tube, capsule) with exact sdf, bounds and sampling. */
export function primitiveProxy(id: string, shape: Shape, world: Mat4 = mat4Identity(), options: ProxyOptions = {}): Proxy {
  const proxy: Proxy = { id, sdf: shapeSdf(shape), localBounds: shapeBounds(shape), world, shape }
  if (options.hollow !== undefined) proxy.hollow = options.hollow
  if (options.wall !== undefined) proxy.wall = options.wall
  return proxy
}

/** Proxy for a triangle mesh; `hollow` defaults to true when the mesh is not watertight (an open surface has no inside). */
export function meshProxy(id: string, mesh: MeshData, world: Mat4 = mat4Identity(), options: ProxyOptions = {}): Proxy {
  const proxy: Proxy = { id, mesh, localBounds: meshBounds(mesh), world, hollow: options.hollow ?? !meshIsClosed(mesh) }
  if (options.wall !== undefined) proxy.wall = options.wall
  return proxy
}

/** Proxy for a custom local-space signed distance function (e.g. a composed kit part); `localBounds` must enclose the solid. */
export function sdfProxy(id: string, sdf: (pLocal: Vec3) => number, localBounds: Box3, world: Mat4 = mat4Identity(), options: ProxyOptions = {}): Proxy {
  const proxy: Proxy = { id, sdf, localBounds, world }
  if (options.hollow !== undefined) proxy.hollow = options.hollow
  if (options.wall !== undefined) proxy.wall = options.wall
  return proxy
}

/** Returns a copy of `proxy` at a new world matrix (cheap: geometry and its caches are shared). */
export function withWorld(proxy: Proxy, world: Mat4): Proxy {
  return { ...proxy, world }
}

/** World-space axis-aligned bounds of a proxy: the 8 corners of `localBounds` transformed (conservative when rotated). */
export function worldBounds(proxy: Proxy): Box3 {
  const m = proxy.world, lo = proxy.localBounds.min, hi = proxy.localBounds.max
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? hi[0] : lo[0], y = i & 2 ? hi[1] : lo[1], z = i & 4 ? hi[2] : lo[2]
    const wx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!
    const wy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!
    const wz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!
    if (wx < min[0]) min[0] = wx; if (wx > max[0]) max[0] = wx
    if (wy < min[1]) min[1] = wy; if (wy > max[1]) max[1] = wy
    if (wz < min[2]) min[2] = wz; if (wz > max[2]) max[2] = wz
  }
  return { min, max }
}

/** Union of the world bounds of several proxies (all zeros for an empty list). */
export function unionBounds(proxies: readonly Proxy[]): Box3 {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const proxy of proxies) {
    const b = worldBounds(proxy)
    for (let d = 0; d < 3; d++) {
      if (b.min[d]! < min[d]!) min[d] = b.min[d]!
      if (b.max[d]! > max[d]!) max[d] = b.max[d]!
    }
  }
  if (!(min[0] <= max[0])) return { min: [0, 0, 0], max: [0, 0, 0] }
  return { min, max }
}

/** Span of a set of proxies: the diagonal length of their combined world bounds (the "model size" for relative thresholds). */
export function span(proxies: readonly Proxy[]): number {
  const b = unionBounds(proxies)
  const s = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])
  return Number.isFinite(s) ? s : 0
}

/** Smallest world-space extent of a proxy's bounds (its "thinnest" size; the INTERPENETRATE limit is 2% of this). */
export function minExtent(proxy: Proxy): number {
  const b = worldBounds(proxy)
  return Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])
}

/** World distance between two anchor points given in each part's local space (the mate residual for MECH-OPEN). */
export function mateResidual(worldA: Mat4, anchorA: Vec3, worldB: Mat4, anchorB: Vec3): number {
  const ax = worldA[0]! * anchorA[0] + worldA[4]! * anchorA[1] + worldA[8]! * anchorA[2] + worldA[12]!
  const ay = worldA[1]! * anchorA[0] + worldA[5]! * anchorA[1] + worldA[9]! * anchorA[2] + worldA[13]!
  const az = worldA[2]! * anchorA[0] + worldA[6]! * anchorA[1] + worldA[10]! * anchorA[2] + worldA[14]!
  const bx = worldB[0]! * anchorB[0] + worldB[4]! * anchorB[1] + worldB[8]! * anchorB[2] + worldB[12]!
  const by = worldB[1]! * anchorB[0] + worldB[5]! * anchorB[1] + worldB[9]! * anchorB[2] + worldB[13]!
  const bz = worldB[2]! * anchorB[0] + worldB[6]! * anchorB[1] + worldB[10]! * anchorB[2] + worldB[14]!
  return Math.hypot(ax - bx, ay - by, az - bz)
}
