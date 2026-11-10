// Geometry builders of the kit (part of the lazy chunk 'kit'; imported only by ./kit.chunk.ts and by tests).
// Every builder returns a triangle soup: a flat list of positions, three vertices per triangle, counter-clockwise seen
// from outside. Solids are closed (watertight), so section caps and the closed-mesh test of the look hold.
// The builders work in "turning space": the axis of a lathe and the direction of an extrusion are +z. `upright()`
// turns a soup so that this axis becomes +y (pistons, valves, liners).
import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from 'three'
import { qFromTo, qrot, type Quat, type Vec3 } from '../core/index.ts'
import type { Vec2 } from '../lib/types.ts'

export type Soup = number[]
const TAU = 2 * Math.PI

const tri = (out: Soup, a: readonly number[], b: readonly number[], c: readonly number[]): void => { out.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!) }
const quad = (out: Soup, a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]): void => { tri(out, a, b, c); tri(out, a, c, d) }
const area2 = (p: readonly Vec2[]): number => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i]!, b = p[(i + 1) % p.length]!; s += a[0] * b[1] - b[0] * a[1] } return s / 2 }

/** Triangles of a polygon with holes (indices into [...outline, ...holes.flat()]), each counter-clockwise. */
export function triangulate(outline: readonly Vec2[], holes: readonly (readonly Vec2[])[] = []): { points: Vec2[]; faces: [number, number, number][] } {
  const points: Vec2[] = [...outline, ...holes.flat()].map((p) => [p[0], p[1]] as Vec2)
  if (outline.length < 3) return { points, faces: [] }
  const v = (list: readonly Vec2[]): Vector2[] => list.map((p) => new Vector2(p[0], p[1]))
  const raw = ShapeUtils.triangulateShape(v(outline), holes.map(v)) as number[][]
  const faces: [number, number, number][] = []
  for (const f of raw) {
    const a = points[f[0]!]!, b = points[f[1]!]!, c = points[f[2]!]!
    const ccw = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    if (Math.abs(ccw) < 1e-14) continue
    faces.push(ccw > 0 ? [f[0]!, f[1]!, f[2]!] : [f[0]!, f[2]!, f[1]!])
  }
  return { points, faces }
}

/**
 * A prism: `outline` (and `holes`) in the x-y plane, from z0 up to z1. The outline may wind either way; so may the
 * holes. Closed.
 */
export function extrude(outline: readonly Vec2[], holes: readonly (readonly Vec2[])[], z0: number, z1: number): Soup {
  const out: Soup = []
  if (outline.length < 3 || !(z1 > z0)) return out
  const outer = area2(outline) < 0 ? [...outline].reverse() : outline
  const inner = holes.filter((h) => h.length >= 3).map((h) => (area2(h) > 0 ? [...h].reverse() : h))
  // walls: the outside of a counter-clockwise loop is on its right, and a hole runs clockwise
  for (const loop of [outer, ...inner]) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!, b = loop[(i + 1) % loop.length]!
      quad(out, [a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1])
    }
  }
  const { points, faces } = triangulate(outer, inner)
  for (const [a, b, c] of faces) {
    const pa = points[a]!, pb = points[b]!, pc = points[c]!
    tri(out, [pa[0], pa[1], z1], [pb[0], pb[1], z1], [pc[0], pc[1], z1])
    tri(out, [pa[0], pa[1], z0], [pc[0], pc[1], z0], [pb[0], pb[1], z0])
  }
  return out
}

/**
 * A solid of revolution about +z. `profile` is a polyline of [radius, height] that runs counter-clockwise in the
 * (radius, height) half-plane: out along the bottom, up the outside, back in along the top. It starts and ends on
 * the axis, or is a closed loop (first point repeated) for a ring. `sweep` < 360 leaves a wedge out (a cutaway),
 * starting at angle `from`; the two cut faces are capped.
 */
export function lathe(profile: readonly Vec2[], o: { segments: number; from?: number; sweep?: number }): Soup {
  const out: Soup = []
  if (profile.length < 2) return out
  const sweep = Math.min(360, Math.max(1, o.sweep ?? 360)), full = sweep >= 360
  const n = Math.max(3, Math.round((o.segments * sweep) / 360))
  const a0 = ((o.from ?? 0) * Math.PI) / 180, da = ((sweep * Math.PI) / 180) / n
  const at = (p: Vec2, k: number): Vec3 => { const a = a0 + (full ? k % n : k) * da; return [p[0] * Math.cos(a), p[0] * Math.sin(a), p[1]] }
  for (let i = 0; i + 1 < profile.length; i++) {
    const p = profile[i]!, q = profile[i + 1]!
    if (p[0] <= 1e-12 && q[0] <= 1e-12) continue
    for (let k = 0; k < n; k++) {
      const a = at(p, k), b = at(p, k + 1), c = at(q, k + 1), d = at(q, k)
      if (p[0] <= 1e-12) tri(out, a, c, d)
      else if (q[0] <= 1e-12) tri(out, a, b, c)
      else quad(out, a, b, c, d)
    }
  }
  if (!full) {
    const first = profile[0]!, last = profile[profile.length - 1]!
    const loop = (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-12 ? profile.slice(0, -1) : profile) as Vec2[]
    const { points, faces } = triangulate(area2(loop) < 0 ? [...loop].reverse() : loop)
    // a counter-clockwise polygon in (radius, height) faces against the direction of turning: that is the start face
    for (const [a, b, c] of faces) {
      tri(out, at(points[a]!, 0), at(points[b]!, 0), at(points[c]!, 0))
      tri(out, at(points[a]!, n), at(points[c]!, n), at(points[b]!, n))
    }
  }
  return out
}

/**
 * A skin over a row of rings (each a closed loop with the same number of points, running counter-clockwise when
 * the direction of travel points at the viewer). Capped at both ends unless told otherwise; `inside` turns it
 * inside out (the bore of a pipe).
 */
export function loft(rings: readonly (readonly Vec3[])[], o: { caps?: boolean; inside?: boolean } = {}): Soup {
  const out: Soup = []
  const n = rings[0]?.length ?? 0
  if (rings.length < 2 || n < 3) return out
  const flip = o.inside === true
  for (let i = 0; i + 1 < rings.length; i++) {
    const r0 = rings[i]!, r1 = rings[i + 1]!
    for (let j = 0; j < n; j++) {
      const a = r0[j]!, b = r0[(j + 1) % n]!, c = r1[(j + 1) % n]!, d = r1[j]!
      if (flip) quad(out, a, d, c, b)
      else quad(out, a, b, c, d)
    }
  }
  if (o.caps !== false && !flip) {
    const mid = (ring: readonly Vec3[]): Vec3 => { const c: Vec3 = [0, 0, 0]; for (const p of ring) { c[0] += p[0] / n; c[1] += p[1] / n; c[2] += p[2] / n } return c }
    const first = rings[0]!, last = rings[rings.length - 1]!, c0 = mid(first), c1 = mid(last)
    for (let j = 0; j < n; j++) {
      tri(out, c0, first[(j + 1) % n]!, first[j]!)
      tri(out, c1, last[j]!, last[(j + 1) % n]!)
    }
  }
  return out
}

/** Unit tangents of a polyline (the average of the two segments at each inner point). */
function tangents(path: readonly Vec3[]): Vec3[] {
  const dir = (a: Vec3, b: Vec3): Vec3 => { const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(d[0], d[1], d[2]) || 1; return [d[0] / l, d[1] / l, d[2] / l] }
  return path.map((_, i) => {
    const a = dir(path[Math.max(0, i - 1)]!, path[i]!), b = dir(path[i]!, path[Math.min(path.length - 1, i + 1)]!)
    const t: Vec3 = i === 0 ? b : i === path.length - 1 ? a : [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
    const l = Math.hypot(t[0], t[1], t[2]) || 1
    return [t[0] / l, t[1] / l, t[2] / l]
  })
}
/** Circles of `sides` points round every point of a path, carried along it without twisting. */
export function ringsAlong(path: readonly Vec3[], radius: number | ((i: number) => number), sides: number): Vec3[][] {
  if (path.length < 2) return []
  const t = tangents(path)
  // a first normal that does not depend on anything but the path: the world axis the path leans on least
  const t0 = t[0]!, ax = Math.abs(t0[0]), ay = Math.abs(t0[1]), az = Math.abs(t0[2])
  const pick: Vec3 = ay <= ax && ay <= az ? [0, 1, 0] : ax <= az ? [1, 0, 0] : [0, 0, 1]
  const k = pick[0] * t0[0] + pick[1] * t0[1] + pick[2] * t0[2]
  let normal: Vec3 = [pick[0] - k * t0[0], pick[1] - k * t0[1], pick[2] - k * t0[2]]
  const len = Math.hypot(normal[0], normal[1], normal[2]) || 1
  normal = [normal[0] / len, normal[1] / len, normal[2] / len]
  const out: Vec3[][] = []
  for (let i = 0; i < path.length; i++) {
    const ti = t[i]!
    if (i > 0) { const q: Quat = qFromTo(t[i - 1]!, ti); normal = qrot(q, normal) }
    const side: Vec3 = [ti[1] * normal[2] - ti[2] * normal[1], ti[2] * normal[0] - ti[0] * normal[2], ti[0] * normal[1] - ti[1] * normal[0]]
    const r = typeof radius === 'number' ? radius : radius(i), p = path[i]!
    out.push(Array.from({ length: sides }, (_, j) => { const a = (j / sides) * TAU, c = Math.cos(a) * r, s = Math.sin(a) * r; return [p[0] + normal[0] * c + side[0] * s, p[1] + normal[1] * c + side[1] * s, p[2] + normal[2] * c + side[2] * s] as Vec3 }))
  }
  return out
}
/** A round wire along a path, ends capped. */
export const wire = (path: readonly Vec3[], radius: number, sides: number): Soup => loft(ringsAlong(path, radius, sides))
/** A pipe along a path with a real wall: outside, bore, and a flat ring at each end. A bore of 0 gives a solid rod. */
export function tubeAlong(path: readonly Vec3[], radius: number, bore: number, sides: number): Soup {
  const outer = ringsAlong(path, radius, sides)
  if (!(bore > 0) || bore >= radius) return loft(outer)
  const inner = ringsAlong(path, bore, sides)
  const out = [...loft(outer, { caps: false }), ...loft(inner, { inside: true })]
  const o0 = outer[0]!, i0 = inner[0]!, o1 = outer[outer.length - 1]!, i1 = inner[inner.length - 1]!
  for (let j = 0; j < sides; j++) {
    const k = (j + 1) % sides
    quad(out, i0[j]!, i0[k]!, o0[k]!, o0[j]!)
    quad(out, i1[j]!, o1[j]!, o1[k]!, i1[k]!)
  }
  return out
}

// ── moving soups ─────────────────────────────────────────────────────────────────────────────────────
/** Turn a soup so that its +z axis becomes +y (and +y becomes −z): a proper rotation, so the winding is kept. */
export function upright(s: Soup): Soup { for (let i = 0; i < s.length; i += 3) { const y = s[i + 1]!; s[i + 1] = s[i + 2]!; s[i + 2] = -y } return s }
export function translate(s: Soup, x: number, y: number, z: number): Soup { for (let i = 0; i < s.length; i += 3) { s[i]! += x; s[i + 1]! += y; s[i + 2]! += z } return s }
/** Turn a soup about +z by degrees. */
export function turn(s: Soup, deg: number): Soup {
  const c = Math.cos((deg * Math.PI) / 180), n = Math.sin((deg * Math.PI) / 180)
  for (let i = 0; i < s.length; i += 3) { const x = s[i]!, y = s[i + 1]!; s[i] = x * c - y * n; s[i + 1] = x * n + y * c }
  return s
}
/** Turn a soup about +x by degrees. */
export function tip(s: Soup, deg: number): Soup {
  const c = Math.cos((deg * Math.PI) / 180), n = Math.sin((deg * Math.PI) / 180)
  for (let i = 0; i < s.length; i += 3) { const y = s[i + 1]!, z = s[i + 2]!; s[i + 1] = y * c - z * n; s[i + 2] = y * n + z * c }
  return s
}
export const merge = (...parts: Soup[]): Soup => { const out: Soup = []; for (const p of parts) for (let i = 0; i < p.length; i++) out.push(p[i]!); return out }

// ── normals and the three.js geometry ────────────────────────────────────────────────────────────────
/**
 * Normals for a soup: smooth across edges flatter than `crease` degrees, hard across sharper ones (a lathe looks
 * round, its corners stay corners). Triangles without area are dropped.
 */
export function creased(soup: Soup, crease: number): { positions: Float32Array; normals: Float32Array } {
  const tris = Math.floor(soup.length / 9)
  const keep: number[] = [], fn: number[] = []
  let size = 0
  for (let i = 0; i < soup.length; i++) size = Math.max(size, Math.abs(soup[i]!))
  const grid = 1 / Math.max(size * 1e-6, 1e-9)
  const buckets = new Map<string, number[]>()
  const keys: string[] = []
  for (let t = 0; t < tris; t++) {
    const o = t * 9
    const ax = soup[o + 3]! - soup[o]!, ay = soup[o + 4]! - soup[o + 1]!, az = soup[o + 5]! - soup[o + 2]!
    const bx = soup[o + 6]! - soup[o]!, by = soup[o + 7]! - soup[o + 1]!, bz = soup[o + 8]! - soup[o + 2]!
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx
    if (!(Math.hypot(nx, ny, nz) > size * size * 1e-12)) continue
    const f = keep.length
    keep.push(o)
    fn.push(nx, ny, nz)
    for (let v = 0; v < 3; v++) {
      const key = `${Math.round(soup[o + v * 3]! * grid)},${Math.round(soup[o + v * 3 + 1]! * grid)},${Math.round(soup[o + v * 3 + 2]! * grid)}`
      keys.push(key)
      const b = buckets.get(key)
      if (b) b.push(f)
      else buckets.set(key, [f])
    }
  }
  const cos = Math.cos((crease * Math.PI) / 180)
  const positions = new Float32Array(keep.length * 9), normals = new Float32Array(keep.length * 9)
  for (let f = 0; f < keep.length; f++) {
    const o = keep[f]!
    const fx = fn[f * 3]!, fy = fn[f * 3 + 1]!, fz = fn[f * 3 + 2]!, fl = Math.hypot(fx, fy, fz)
    for (let v = 0; v < 3; v++) {
      let sx = 0, sy = 0, sz = 0
      for (const g of buckets.get(keys[f * 3 + v]!)!) {
        const gx = fn[g * 3]!, gy = fn[g * 3 + 1]!, gz = fn[g * 3 + 2]!
        // area-weighted: the cross products are not normalised
        if ((fx * gx + fy * gy + fz * gz) / (fl * Math.hypot(gx, gy, gz)) >= cos) { sx += gx; sy += gy; sz += gz }
      }
      const l = Math.hypot(sx, sy, sz) || 1, at = f * 9 + v * 3
      positions[at] = soup[o + v * 3]!; positions[at + 1] = soup[o + v * 3 + 1]!; positions[at + 2] = soup[o + v * 3 + 2]!
      normals[at] = sx / l; normals[at + 1] = sy / l; normals[at + 2] = sz / l
    }
  }
  return { positions, normals }
}
/** The three.js geometry of a soup, with creased normals. */
export function toGeometry(soup: Soup, crease: number): BufferGeometry {
  const { positions, normals } = creased(soup, crease)
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(positions, 3))
  g.setAttribute('normal', new BufferAttribute(normals, 3))
  return g
}
