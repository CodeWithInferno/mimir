/**
 * Signed distance functions for the primitive solids, in each primitive's LOCAL space.
 * Conventions (match the authoring API in docs/DESIGN.md section 5):
 *  - every primitive is centred on the origin;
 *  - width = x, height = y, depth = z;
 *  - revolved primitives (cylinder, cone, torus, tube, capsule) have their axis along +Y
 *    (use `mat4AlignY(axis)` in the proxy's world matrix for another axis).
 * Negative inside, positive outside, zero on the surface. All are exact Euclidean distances.
 */
import type { Box3, Vec3 } from '../types.ts'

/** Signed distance to a box of full size width x height x depth. */
export function sdfBox(p: Vec3, width: number, height: number, depth: number): number {
  const qx = Math.abs(p[0]) - width * 0.5, qy = Math.abs(p[1]) - height * 0.5, qz = Math.abs(p[2]) - depth * 0.5
  const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0, oz = qz > 0 ? qz : 0
  const inside = Math.max(qx, qy, qz)
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + (inside < 0 ? inside : 0)
}

/** Signed distance to a sphere. */
export function sdfSphere(p: Vec3, radius: number): number {
  return Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]) - radius
}

/** Signed distance to a solid cylinder (axis Y, total height `height`). */
export function sdfCylinder(p: Vec3, radius: number, height: number): number {
  const qr = Math.sqrt(p[0] * p[0] + p[2] * p[2]) - radius, qy = Math.abs(p[1]) - height * 0.5
  const or = qr > 0 ? qr : 0, oy = qy > 0 ? qy : 0
  const inside = qr > qy ? qr : qy
  return Math.sqrt(or * or + oy * oy) + (inside < 0 ? inside : 0)
}

/** Signed distance to a cone (axis Y): `radius` at the base y = -height/2, `topRadius` (default 0 = apex) at y = +height/2. */
export function sdfCone(p: Vec3, radius: number, height: number, topRadius = 0): number {
  const h = height * 0.5, r1 = radius, r2 = topRadius
  const qx = Math.sqrt(p[0] * p[0] + p[2] * p[2]), qy = p[1]
  const k2x = r2 - r1, k2y = 2 * h
  const cax = qx - Math.min(qx, qy < 0 ? r1 : r2), cay = Math.abs(qy) - h
  const kk = k2x * k2x + k2y * k2y
  let t = kk > 0 ? ((r2 - qx) * k2x + (h - qy) * k2y) / kk : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const cbx = qx - r2 + k2x * t, cby = qy - h + k2y * t
  const s = cbx < 0 && cay < 0 ? -1 : 1
  return s * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby))
}

/** Signed distance to a torus (ring in the XZ plane, axis Y): `radius` = centre-line radius, `tube` = tube radius. */
export function sdfTorus(p: Vec3, radius: number, tube: number): number {
  const qx = Math.sqrt(p[0] * p[0] + p[2] * p[2]) - radius
  return Math.sqrt(qx * qx + p[1] * p[1]) - tube
}

/** Signed distance to a tube = hollow cylinder (axis Y): OUTER `radius`, wall `thickness` (bore radius = radius - thickness). */
export function sdfTube(p: Vec3, radius: number, thickness: number, height: number): number {
  if (thickness >= radius) return sdfCylinder(p, radius, height) // no bore left: a solid cylinder
  const half = thickness * 0.5
  const qr = Math.abs(Math.sqrt(p[0] * p[0] + p[2] * p[2]) - (radius - half)) - half, qy = Math.abs(p[1]) - height * 0.5
  const or = qr > 0 ? qr : 0, oy = qy > 0 ? qy : 0
  const inside = qr > qy ? qr : qy
  return Math.sqrt(or * or + oy * oy) + (inside < 0 ? inside : 0)
}

/** Signed distance to a capsule (axis Y): `height` is the TOTAL end-to-end height including both round caps. */
export function sdfCapsule(p: Vec3, radius: number, height: number): number {
  const half = Math.max(0, height * 0.5 - radius)
  const y = p[1] > half ? p[1] - half : p[1] < -half ? p[1] + half : 0
  return Math.sqrt(p[0] * p[0] + y * y + p[2] * p[2]) - radius
}

/** Plain-data description of a primitive solid; option names match the authoring API. */
export type Shape =
  | { kind: 'box'; width: number; height: number; depth: number }
  | { kind: 'sphere'; radius: number }
  | { kind: 'cylinder'; radius: number; height: number }
  | { kind: 'cone'; radius: number; height: number; topRadius?: number }
  | { kind: 'torus'; radius: number; tube: number }
  | { kind: 'tube'; radius: number; thickness: number; height: number }
  | { kind: 'capsule'; radius: number; height: number }

/** Returns the local-space signed distance function of a primitive shape. */
export function shapeSdf(shape: Shape): (pLocal: Vec3) => number {
  switch (shape.kind) {
    case 'box': { const w = shape.width, h = shape.height, d = shape.depth; return p => sdfBox(p, w, h, d) }
    case 'sphere': { const r = shape.radius; return p => sdfSphere(p, r) }
    case 'cylinder': { const r = shape.radius, h = shape.height; return p => sdfCylinder(p, r, h) }
    case 'cone': { const r = shape.radius, h = shape.height, t = shape.topRadius ?? 0; return p => sdfCone(p, r, h, t) }
    case 'torus': { const r = shape.radius, t = shape.tube; return p => sdfTorus(p, r, t) }
    case 'tube': { const r = shape.radius, t = shape.thickness, h = shape.height; return p => sdfTube(p, r, t, h) }
    case 'capsule': { const r = shape.radius, h = shape.height; return p => sdfCapsule(p, r, h) }
  }
}

/** Tight local-space bounding box of a primitive shape. */
export function shapeBounds(shape: Shape): Box3 {
  let x: number, y: number, z: number
  switch (shape.kind) {
    case 'box': x = shape.width * 0.5; y = shape.height * 0.5; z = shape.depth * 0.5; break
    case 'sphere': x = y = z = shape.radius; break
    case 'cylinder': x = z = shape.radius; y = shape.height * 0.5; break
    case 'cone': x = z = Math.max(shape.radius, shape.topRadius ?? 0); y = shape.height * 0.5; break
    case 'torus': x = z = shape.radius + shape.tube; y = shape.tube; break
    case 'tube': x = z = shape.radius; y = shape.height * 0.5; break
    case 'capsule': x = z = shape.radius; y = Math.max(shape.height * 0.5, shape.radius); break
  }
  return { min: [-x, -y, -z], max: [x, y, z] }
}

/** Exact volume of a primitive shape (local units cubed). */
export function shapeVolume(shape: Shape): number {
  switch (shape.kind) {
    case 'box': return shape.width * shape.height * shape.depth
    case 'sphere': return (4 / 3) * Math.PI * shape.radius ** 3
    case 'cylinder': return Math.PI * shape.radius ** 2 * shape.height
    case 'cone': { const a = shape.radius, b = shape.topRadius ?? 0; return (Math.PI * shape.height * (a * a + a * b + b * b)) / 3 }
    case 'torus': return 2 * Math.PI * Math.PI * shape.radius * shape.tube ** 2
    case 'tube': { const inner = Math.max(0, shape.radius - shape.thickness); return Math.PI * (shape.radius ** 2 - inner ** 2) * shape.height }
    case 'capsule': { const r = shape.radius, len = Math.max(0, shape.height - 2 * r); return Math.PI * r * r * len + (4 / 3) * Math.PI * r ** 3 }
  }
}

/** Smallest of the shape's three bounding extents (the "thinnest" size, used for relative depth thresholds). */
export function shapeMinExtent(shape: Shape): number {
  const b = shapeBounds(shape)
  return 2 * Math.min(b.max[0], b.max[1], b.max[2])
}
