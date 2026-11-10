// The solid side of check: which 3D parts are solids, their collision proxies (from each kind's `sdf`, or a mesh
// given as positions + indices), and the pair measurements (overlap depth, gap, containment, volume overlap) of one
// state. Pure maths on top of src/lib/solids: it runs without a browser, so the solid rules do too.
//
// Two caches keep a whole check cheap. A proxy is rebuilt only when the resolved options of its part change, and a
// pair is measured once per (shape, shape, relative pose): parts that do not move are measured once for the run.
import { isAnchorRef, isNode, kindOf, stable, type Box3, type Frame, type MNode, type Quat, type TRS, type Vec3 } from '../core/index.ts'
import { meshSource, roleOf } from '../r3d/index.ts'
import {
  contained, iou, meshData, meshProxy, nearest, penetration, sdfProxy, signedDistance, worldBounds,
  type Mat4, type Nearest, type Penetration, type SolidProxy,
} from '../lib/solids/index.ts'

export interface SolidPart {
  node: MNode
  id: string
  proxy: SolidProxy
  /** the proxy is the real solid (an sdf or a mesh); false = only the bounding box is known, so depth is not measured */
  exact: boolean
  /** a housing: ghost / glass material, shell: true, or made one by a view mode */
  shell: boolean
  /** drawn fully: entered, and neither transparent nor cut by a view mode */
  opaque: boolean
  cut: boolean
  /** 0..1 enter progress */
  present: number
  world: TRS
  bounds: Box3
  /** smallest extent of its world box, and the diagonal of that box */
  thin: number
  span: number
  /** identifies the shape (resolved options) and the pose, for the pair cache */
  shapeKey: string
  poseKey: string
}
export interface PairInfo { depth: number; point: Vec3; /** share of a's surface inside b, and of b's inside a */ insideA: number; insideB: number }

const q4 = (q: Quat): string => { const s = q[3] < 0 ? -1 : 1; return q.map((x) => (Math.round(x * s * 1e5) / 1e5 + 0).toString()).join(',') }
const r5 = (x: number): number => Math.round(x * 1e5) / 1e5 + 0
const matOf = (t: TRS): Mat4 => {
  const [x, y, z, w] = t.q, s = t.s
  return [
    (1 - 2 * (y * y + z * z)) * s, 2 * (x * y + w * z) * s, 2 * (x * z - w * y) * s, 0,
    2 * (x * y - w * z) * s, (1 - 2 * (x * x + z * z)) * s, 2 * (y * z + w * x) * s, 0,
    2 * (x * z + w * y) * s, 2 * (y * z - w * x) * s, (1 - 2 * (x * x + y * y)) * s, 0,
    t.p[0], t.p[1], t.p[2], 1,
  ]
}

interface ProxyMemo { key: string; proxy: SolidProxy; exact: boolean }
export interface SolidCache { proxies: Map<number, ProxyMemo>; pairs: Map<string, PairInfo | null>; near: Map<string, Nearest>; tests: number; hits: number }
export const newSolidCache = (): SolidCache => ({ proxies: new Map(), pairs: new Map(), near: new Map(), tests: 0, hits: 0 })

const isMesh = (r: Record<string, unknown>): boolean => (Array.isArray(r.positions) || ArrayBuffer.isView(r.positions)) && (Array.isArray(r.indices) || ArrayBuffer.isView(r.indices))
/** Is this node one solid for check: its kind says so (`solid: true`), or describes one (`sdf`), or it is a mesh? */
const isSolidKind = (node: MNode, frame: Frame): boolean => {
  const kind = kindOf(node.kind)
  if (!kind || kind.inert || kind.space !== '3d') return false
  return !!kind.sdf || kind.solid === true || (!!kind.bounds && isMesh(frame.props(node)))
}

/** The solids of one state: every visible 3D part that is a solid, with its proxy at rest (nothing pushed apart). */
export function solidsOf(frame: Frame, cache: SolidCache): SolidPart[] {
  return frame.memo('check.solids', () => {
    const out: SolidPart[] = []
    const visit = (node: MNode): void => {
      if (node.space !== '3d' || !frame.visible(node)) return
      if (!isSolidKind(node, frame)) { node.children.forEach(visit); return }
      const kind = kindOf(node.kind)!
      const r = frame.props(node)
      const local = frame.localBounds(node)
      if (!(local.max[0] > local.min[0] || local.max[1] > local.min[1] || local.max[2] > local.min[2])) return
      const shapeKey = node.uid + ':' + stable(r, 0, 5)
      let memo = cache.proxies.get(node.uid)
      // where the part is when nothing is pushed apart: an exploded view or an enter shift is not a mistake in the model
      const world = frame.rest(node)
      const m = matOf(world)
      if (!memo || memo.key !== shapeKey) {
        let proxy: SolidProxy
        let exact = true
        if (kind.sdf) { const sdf = kind.sdf; proxy = sdfProxy(node.id, (p) => sdf(node, r, p), local, m) }
        else if (meshSource(node)) {
          // a mesh() as the 3D layer read it: flat numbers; a triangle soup has no indices (every three points are a triangle)
          const src = meshSource(node)!
          proxy = meshProxy(node.id, meshData(src.positions, src.indices ?? Uint32Array.from({ length: src.positions.length / 3 }, (_, i) => i)), m)
        } else if (isMesh(r)) proxy = meshProxy(node.id, meshData(r.positions as ArrayLike<number>, r.indices as ArrayLike<number>), m)
        else { proxy = { id: node.id, localBounds: local, world: m }; exact = false }
        memo = { key: shapeKey, proxy, exact }
        cache.proxies.set(node.uid, memo)
      } else memo.proxy.world = m
      const look = frame.look(node)
      // a volume of fluid (role: 'fluid') is like a housing: what stands in it is in it on purpose, and it is seen through
      const shell = look.shell || roleOf(node) === 'fluid'
      const bounds = worldBounds(memo.proxy)
      const size: Vec3 = [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]]
      out.push({
        node, id: node.id, proxy: memo.proxy, exact: memo.exact, shell, cut: look.clip.length > 0, opaque: !shell && look.opacity >= 0.98 && look.clip.length === 0,
        present: frame.reveal(node).p, world, bounds, thin: Math.min(...size), span: Math.hypot(...size), shapeKey,
        poseKey: `${r5(world.p[0])},${r5(world.p[1])},${r5(world.p[2])}|${q4(world.q)}|${r5(world.s)}`,
      })
    }
    for (const n of frame.model.nodes) if (!n.parent) visit(n)
    return out
  }, [])
}

/** the pose of b seen from a: equal strings = the two parts did not move relative to each other */
export function relativePose(a: TRS, b: TRS): { p: Vec3; q: Quat } {
  const [x, y, z, w] = a.q
  const inv: Quat = [-x, -y, -z, w]
  const d: Vec3 = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]]
  return { p: rot(inv, d).map((c) => c / (a.s || 1)) as Vec3, q: mulq(inv, b.q) }
}
const mulq = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
]
const rot = (q: Quat, v: Vec3): Vec3 => {
  const [x, y, z, w] = q
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0])
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]
}
const relKey = (a: SolidPart, b: SolidPart): string => { const r = relativePose(a.world, b.world); return `${r5(r.p[0])},${r5(r.p[1])},${r5(r.p[2])}|${q4(r.q)}|${r5(b.world.s / (a.world.s || 1))}` }
const boxesApart = (a: Box3, b: Box3, by = 0): boolean => a.min[0] > b.max[0] + by || b.min[0] > a.max[0] + by || a.min[1] > b.max[1] + by || b.min[1] > a.max[1] + by || a.min[2] > b.max[2] + by || b.min[2] > a.max[2] + by

/** Overlap of two solids (null = none beyond numerical noise). Measured once per shape pair and relative pose. */
export function overlap(a: SolidPart, b: SolidPart, cache: SolidCache, samples: number): PairInfo | null {
  if (boxesApart(a.bounds, b.bounds)) return null
  const key = `${a.shapeKey}|${b.shapeKey}|${relKey(a, b)}`
  const hit = cache.pairs.get(key)
  if (hit !== undefined) {
    cache.hits++
    // the cached point is where it was measured; the depth and the shares are what a rule compares
    return hit
  }
  cache.tests++
  const p: Penetration | null = penetration(a.proxy, b.proxy, { samples })
  const info = p ? { depth: p.depth, point: p.point, insideA: p.fractionInside, insideB: p.fractionInsideOther } : null
  cache.pairs.set(key, info)
  return info
}
/** Signed distance between two solids with the closest points: positive = a gap, negative = an overlap depth. */
export function separation(a: SolidPart, b: SolidPart, cache: SolidCache, samples: number): Nearest {
  const key = `${a.shapeKey}|${b.shapeKey}|${relKey(a, b)}`
  const hit = cache.near.get(key)
  // the points are world positions: valid only while neither part has moved
  if (hit && (hit as Nearest & { poses?: string }).poses === a.poseKey + b.poseKey) { cache.hits++; return hit }
  cache.tests++
  const n = nearest(a.proxy, b.proxy, { samples }) as Nearest & { poses?: string }
  n.poses = a.poseKey + b.poseKey
  cache.near.set(key, n)
  return n
}
export const isContained = (a: SolidPart, b: SolidPart, samples: number): boolean => !boxesApart(a.bounds, b.bounds) && contained(a.proxy, b.proxy, { samples })
export const volumeOverlap = (a: SolidPart, b: SolidPart): number => (boxesApart(a.bounds, b.bounds) ? 0 : iou(a.proxy, b.proxy))
export const insideSolid = (part: SolidPart, p: Vec3): number => signedDistance(part.proxy, p)
export { boxesApart }

/** Diagonal of the box around a set of solids: the model's size, which the relative limits are shares of. */
export function spanOf(parts: readonly SolidPart[]): number {
  if (!parts.length) return 0
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const p of parts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i]!, p.bounds.min[i]!); hi[i] = Math.max(hi[i]!, p.bounds.max[i]!) }
  const d = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
  return Number.isFinite(d) ? d : 0
}

// ── declared relations ───────────────────────────────────────────────────────────────────────────────
/** The solid a node belongs to: itself, or the nearest ancestor that is one solid for check. */
export function unitOf(node: MNode, units: Map<MNode, SolidPart>): SolidPart | null {
  for (let n: MNode | null = node; n; n = n.parent) { const u = units.get(n); if (u) return u }
  return null
}
/** Nodes a placement record names: attach(target), between(a, b), pin(ref), at(node), a mechanism's parts. */
export function placementRefs(node: MNode, frame: Frame): MNode[] {
  const out: MNode[] = []
  const seen = new Set<unknown>()
  const walk = (v: unknown, depth: number): void => {
    if (v === null || v === undefined || seen.has(v)) return
    if (isNode(v)) { out.push(v); return }
    if (typeof v === 'function') { if (isAnchorRef(v)) out.push(v.node); return }
    if (typeof v !== 'object' || depth > 3) return
    seen.add(v)
    for (const x of Array.isArray(v) ? v : Object.values(v as object)) walk(x, depth + 1)
  }
  walk(frame.prop(node, 'placement'), 0)
  // a rod drawn between two things names them in its own options
  const kind = kindOf(node.kind)
  if (kind) for (const name of Object.keys(kind.schema)) { const raw = node.props[name]; if (typeof raw === 'object' || typeof raw === 'function') walk(raw, 2) }
  return out.filter((n) => n !== node)
}
