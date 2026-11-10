// Mesh builders of the shape kinds (extrude, lathe, sweep), as plain arrays. Only the triangulation of a polygon with
// holes comes from three.js (its earcut); everything else is arithmetic, so the builders run and are tested under bun.
// The renderer (./three.ts) turns the result into creased geometry and line work.
import { ShapeUtils, Vector2 } from 'three'

export interface Soup { positions: number[]; indices: number[] }
type P2 = readonly [number, number]
type P3 = readonly [number, number, number]

const area2 = (pts: readonly P2[]): number => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j]![0] * pts[i]![1] - pts[i]![0] * pts[j]![1]; return a / 2 }
/** A closed loop without a repeated end point, without coincident neighbours, in the wanted winding (ccw = positive area). */
export function cleanLoop(pts: readonly P2[], ccw: boolean): [number, number][] {
  const out: [number, number][] = []
  for (const p of pts) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue
    const last = out[out.length - 1]
    if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 1e-9) continue
    out.push([p[0], p[1]])
  }
  while (out.length > 1 && Math.hypot(out[0]![0] - out[out.length - 1]![0], out[0]![1] - out[out.length - 1]![1]) < 1e-9) out.pop()
  if (out.length >= 3 && area2(out) > 0 !== ccw) out.reverse()
  return out
}
/** Move every corner of a loop inwards by `d` along its mitre (negative = outwards). Mitres are capped at 3 d. */
function inset(loop: readonly P2[], d: number): [number, number][] {
  const n = loop.length
  const sign = area2(loop) > 0 ? 1 : -1
  return loop.map((p, i) => {
    const a = loop[(i - 1 + n) % n]!, b = loop[(i + 1) % n]!
    let e1x = p[0] - a[0], e1y = p[1] - a[1], e2x = b[0] - p[0], e2y = b[1] - p[1]
    const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1
    e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2
    // inward normals of the two edges (left of the direction of travel for a counter-clockwise loop)
    const n1x = -e1y * sign, n1y = e1x * sign, n2x = -e2y * sign, n2y = e2x * sign
    const k = Math.max(1 / 3, 1 + n1x * n2x + n1y * n2y)
    return [p[0] + ((n1x + n2x) / k) * d, p[1] + ((n1y + n2y) / k) * d] as [number, number]
  })
}

/**
 * A profile in the x-y plane pushed through `depth` along z, centred on z = 0, with holes and an optional chamfer
 * (`bevel`, clamped to what the depth and the profile allow). Returns null when the profile has no area.
 */
export function extrudeMesh(profile: readonly P2[], holes: readonly (readonly P2[])[], depth: number, bevel = 0): Soup | null {
  const outer = cleanLoop(profile, true)
  if (outer.length < 3 || !(Math.abs(area2(outer)) > 1e-12) || !(depth > 0) || !Number.isFinite(depth)) return null
  const inner = holes.map((h) => cleanLoop(h, false)).filter((h) => h.length >= 3 && Math.abs(area2(h)) > 1e-12)
  const loops = [outer, ...inner]
  let minEdge = Infinity
  for (const l of loops) for (let i = 0; i < l.length; i++) { const a = l[i]!, b = l[(i + 1) % l.length]!; minEdge = Math.min(minEdge, Math.hypot(a[0] - b[0], a[1] - b[1])) }
  const b = Number.isFinite(bevel) && bevel > 0 ? Math.min(bevel, depth * 0.45, minEdge * 0.45) : 0
  const half = depth / 2
  const positions: number[] = [], indices: number[] = []
  const push = (p: P2, z: number): number => { positions.push(p[0], p[1], z); return positions.length / 3 - 1 }
  // caps: the profile (moved inwards by the bevel) triangulated once, used for the front (+z) and mirrored for the back
  const capLoops = b > 0 ? loops.map((l) => inset(l, b)) : loops
  const faces = ShapeUtils.triangulateShape(capLoops[0]!.map(([x, y]) => new Vector2(x, y)), capLoops.slice(1).map((l) => l.map(([x, y]) => new Vector2(x, y)))) as number[][]
  const flat = capLoops.flat()
  const front = flat.map((p) => push(p, half)), back = flat.map((p) => push(p, -half))
  for (const f of faces) {
    const [i, j, k] = f as [number, number, number]
    // earcut keeps the winding of the outline for the triangles it returns only by chance: orient each one
    const a = flat[i]!, c = flat[j]!, d = flat[k]!
    const ccw = (c[0] - a[0]) * (d[1] - a[1]) - (c[1] - a[1]) * (d[0] - a[0]) > 0
    if (ccw) { indices.push(front[i]!, front[j]!, front[k]!); indices.push(back[i]!, back[k]!, back[j]!) }
    else { indices.push(front[i]!, front[k]!, front[j]!); indices.push(back[i]!, back[j]!, back[k]!) }
  }
  // walls: one quad per edge of every loop (and two chamfer strips when bevelled). A counter-clockwise outline and
  // clockwise holes both have the material on their left, so one winding rule serves all loops.
  const quad = (a: number, b2: number, c: number, d: number): void => { indices.push(a, b2, c, a, c, d) }
  loops.forEach((loop, li) => {
    const cap = capLoops[li]!
    const n = loop.length
    const z1 = half - b, z0 = -half + b
    const top = loop.map((p) => push(p, z1)), bottom = loop.map((p) => push(p, z0))
    const capTop = b > 0 ? cap.map((p) => push(p, half)) : top, capBottom = b > 0 ? cap.map((p) => push(p, -half)) : bottom
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      quad(bottom[i]!, bottom[j]!, top[j]!, top[i]!)
      if (b > 0) { quad(top[i]!, top[j]!, capTop[j]!, capTop[i]!); quad(capBottom[i]!, capBottom[j]!, bottom[j]!, bottom[i]!) }
    }
  })
  return { positions, indices }
}

/**
 * A profile of [radius, height] points turned about the y axis. Points on the axis become one vertex; a profile whose
 * first and last points coincide is a ring-shaped solid. Running up the outside (counter-clockwise in the
 * radius-height plane) gives outward faces. Returns null for fewer than two usable points.
 */
export function latheMesh(profile: readonly P2[], segments = 48): Soup | null {
  const pts: [number, number][] = []
  for (const p of profile) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue
    const q: [number, number] = [Math.max(0, p[0]), p[1]]
    const last = pts[pts.length - 1]
    if (last && Math.hypot(last[0] - q[0], last[1] - q[1]) < 1e-9) continue
    pts.push(q)
  }
  if (pts.length < 2) return null
  const seg = Math.max(3, Math.min(256, Math.round(Number.isFinite(segments) ? segments : 48)))
  const positions: number[] = [], indices: number[] = []
  const rings: number[][] = pts.map(([r, y]) => {
    if (r < 1e-9) { positions.push(0, y, 0); return Array.from({ length: seg }, () => positions.length / 3 - 1) }
    const ring: number[] = []
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * 2 * Math.PI
      positions.push(r * Math.sin(a), y, r * Math.cos(a))
      ring.push(positions.length / 3 - 1)
    }
    return ring
  })
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i]!, b = rings[i + 1]!
    for (let j = 0; j < seg; j++) {
      const k = (j + 1) % seg
      // degenerate triangles at the axis are dropped by the consumers
      if (a[j] !== a[k]) indices.push(a[j]!, a[k]!, b[k]!)
      if (b[j] !== b[k]) indices.push(a[j]!, b[k]!, b[j]!)
    }
  }
  return { positions, indices }
}

const sub = (a: P3, b: P3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: P3, b: P3): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: P3, b: P3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (a: P3): [number, number, number] => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0] }

/**
 * A round tube of `radius` along a path of 3D points (a pipe, a wire, a rail). The cross-section is carried along
 * without twisting; the ends of an open path are capped flat, so the result is a closed solid.
 * Returns null for fewer than two distinct points.
 */
export function sweepMesh(path: readonly P3[], radius: number, sides = 20, closed = false): Soup | null {
  const pts: [number, number, number][] = []
  for (const p of path) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2] ?? 0)) continue
    const q: [number, number, number] = [p[0], p[1], p[2] ?? 0]
    const last = pts[pts.length - 1]
    if (last && Math.hypot(last[0] - q[0], last[1] - q[1], last[2] - q[2]) < 1e-9) continue
    pts.push(q)
  }
  if (closed) while (pts.length > 1 && Math.hypot(pts[0]![0] - pts[pts.length - 1]![0], pts[0]![1] - pts[pts.length - 1]![1], pts[0]![2] - pts[pts.length - 1]![2]) < 1e-9) pts.pop()
  const n = pts.length
  if (n < 2 || !(radius > 0) || !Number.isFinite(radius)) return null
  const loop = closed && n >= 3
  const m = Math.max(3, Math.min(96, Math.round(Number.isFinite(sides) ? sides : 20)))
  const tangent = (i: number): [number, number, number] => {
    const a = pts[loop ? (i - 1 + n) % n : Math.max(0, i - 1)]!, b = pts[loop ? (i + 1) % n : Math.min(n - 1, i + 1)]!
    const before = unit(sub(pts[i]!, a)), after = unit(sub(b, pts[i]!))
    const t = unit([before[0] + after[0], before[1] + after[1], before[2] + after[2]])
    return dot(t, t) > 0 ? t : dot(after, after) > 0 ? after : before
  }
  // a first normal that is not along the tangent, then carried from point to point without twist (parallel transport)
  let t0 = tangent(0)
  let normal = unit(cross(t0, Math.abs(t0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]))
  const positions: number[] = [], indices: number[] = []
  const rings: number[][] = []
  for (let i = 0; i < n; i++) {
    const t = tangent(i)
    if (i > 0) {
      const axis = cross(t0, t)
      const s = Math.hypot(axis[0], axis[1], axis[2]), c = dot(t0, t)
      if (s > 1e-9) {
        // rotate the normal by the turn of the tangent (Rodrigues)
        const k = unit(axis), kxn = cross(k, normal), kn = dot(k, normal)
        normal = unit([normal[0] * c + kxn[0] * s + k[0] * kn * (1 - c), normal[1] * c + kxn[1] * s + k[1] * kn * (1 - c), normal[2] * c + kxn[2] * s + k[2] * kn * (1 - c)])
      }
      t0 = t
    }
    const binormal = cross(t, normal)
    const ring: number[] = []
    for (let j = 0; j < m; j++) {
      const a = (j / m) * 2 * Math.PI, ca = Math.cos(a) * radius, sa = Math.sin(a) * radius
      positions.push(pts[i]![0] + normal[0] * ca + binormal[0] * sa, pts[i]![1] + normal[1] * ca + binormal[1] * sa, pts[i]![2] + normal[2] * ca + binormal[2] * sa)
      ring.push(positions.length / 3 - 1)
    }
    rings.push(ring)
  }
  const last = loop ? n : n - 1
  for (let i = 0; i < last; i++) {
    const a = rings[i]!, b = rings[(i + 1) % n]!
    for (let j = 0; j < m; j++) { const k = (j + 1) % m; indices.push(a[j]!, b[k]!, b[j]!, a[j]!, a[k]!, b[k]!) }
  }
  if (!loop) {
    for (const [i, flip] of [[0, true], [n - 1, false]] as [number, boolean][]) {
      positions.push(pts[i]![0], pts[i]![1], pts[i]![2])
      const c = positions.length / 3 - 1, ring = rings[i]!
      for (let j = 0; j < m; j++) { const k = (j + 1) % m; if (flip) indices.push(c, ring[k]!, ring[j]!); else indices.push(c, ring[j]!, ring[k]!) }
    }
  }
  return { positions, indices }
}

/** Signed volume of an indexed mesh (positive when its faces point outwards). */
export function soupVolume(s: Soup): number {
  let v = 0
  const p = s.positions
  for (let t = 0; t + 2 < s.indices.length; t += 3) {
    const a = 3 * s.indices[t]!, b = 3 * s.indices[t + 1]!, c = 3 * s.indices[t + 2]!
    v += p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) - p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)
  }
  return v / 6
}
/** A mesh whose faces point outwards: one that was given inside out is turned (a closed mesh only: an open one has no inside). */
export function outward(s: Soup): Soup {
  if (soupVolume(s) >= 0) return s
  const indices = s.indices.slice()
  for (let t = 0; t + 2 < indices.length; t += 3) { const x = indices[t + 1]!; indices[t + 1] = indices[t + 2]!; indices[t + 2] = x }
  return { positions: s.positions, indices }
}
