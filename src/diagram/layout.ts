// The layout engine of graph(): the layered layout of src/lib/layout, fitted into the graph's box, with every route
// ending on the outline of the shape it joins. Part of the lazy chunk; it fills `slots.layout`.
import { kindOf, type Frame, type MNode } from '../core/index.ts'
import { layoutGraph } from '../lib/layout/index.ts'
import { flattenPath, rectPath, type Subpath } from '../lib/path/index.ts'
import { DIAGRAM_DEFAULTS as D, edgeEnds, nodeGeom, slots, storeOf, type GraphGeom } from './index.ts'

type Poly = [number, number][]
/** how far the gaps may be squeezed before the whole drawing is shrunk instead */
const SQUEEZE = [1, 0.8, 0.62, 0.48]
/** layouts kept per scene (a graph whose sizes follow a slider makes a new one per value) */
const KEEP = 24

/** The outline of a member in its own coordinates, flattened: what an edge has to reach. */
function outlineOf(m: MNode, frame: Frame, w: number, h: number): Poly[] {
  const kind = kindOf(m.kind)
  let path: Subpath[] | null = null
  try { path = kind?.outline ? kind.outline(m, frame.props(m), frame) : null } catch { path = null }
  return flattenPath(path && path.length ? path : rectPath({ width: w, height: h }), 0.004) as Poly[]
}
/**
 * Where the line p + t·d meets an outline centred on c, taking the crossing nearest to p on the node's side
 * (t ≤ 0 runs into the node). null when the line misses the shape.
 */
function meet(polys: Poly[], c: [number, number], p: [number, number], d: [number, number]): number | null {
  let best: number | null = null
  for (const poly of polys) {
    for (let i = 0; i + 1 < poly.length; i++) {
      const ax = poly[i]![0] + c[0] - p[0], ay = poly[i]![1] + c[1] - p[1]
      const ex = poly[i + 1]![0] - poly[i]![0], ey = poly[i + 1]![1] - poly[i]![1]
      const den = d[0] * ey - d[1] * ex
      if (Math.abs(den) < 1e-12) continue
      const t = (ax * ey - ay * ex) / den
      const m = (ax * d[1] - ay * d[0]) / den
      if (m < -1e-9 || m > 1 + 1e-9 || t > 1e-6) continue
      if (best === null || t > best) best = t
    }
  }
  return best
}
const unit = (x: number, y: number): [number, number] | null => { const l = Math.hypot(x, y); return l > 1e-9 ? [x / l, y / l] : null }
/**
 * Make one end of a route (flat cubic coordinates) stop on the outline of the node it joins, `buff` short of it. The
 * layout ends routes on the box it was given, which is larger than the shape when the node has a label beside it.
 */
function snap(route: number[], atStart: boolean, polys: Poly[], centre: [number, number], buff: number): number[] {
  const n = route.length
  if (n < 8) return route
  const p: [number, number] = atStart ? [route[0]!, route[1]!] : [route[n - 2]!, route[n - 1]!]
  // the direction of travel away from the node, read from the first control point that is not on the end itself
  let dir: [number, number] | null = null
  for (let k = 1; k <= 3 && !dir; k++) { const i = atStart ? 2 * k : n - 2 - 2 * k; dir = unit(route[i]! - p[0], route[i + 1]! - p[1]) }
  if (!dir) return route
  let t = meet(polys, centre, p, dir)
  let d = dir
  if (t === null) {
    // the route points past the shape (a port beside a round node): go straight for its middle instead
    const inward = unit(p[0] - centre[0], p[1] - centre[1])
    if (!inward) return route
    d = inward
    t = meet(polys, centre, p, d)
    if (t === null) return route
  }
  const q: [number, number] = [p[0] + (t + buff) * d[0], p[1] + (t + buff) * d[1]]
  if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6) return route
  if (t + buff > 0 && d === dir) {
    // the end has to move a little along the route: move it and its handle together
    const out = route.slice()
    const i = atStart ? 0 : n - 2, h = atStart ? 2 : n - 4
    out[i] = q[0]; out[i + 1] = q[1]
    out[h] = out[h]! + (q[0] - p[0]); out[h + 1] = out[h + 1]! + (q[1] - p[1])
    return out
  }
  const third = (a: [number, number], b: [number, number], u: number): [number, number] => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]
  if (atStart) return [q[0], q[1], ...third(q, p, 1 / 3), ...third(q, p, 2 / 3), ...route]
  return [...route, ...third(p, q, 1 / 3), ...third(p, q, 2 / 3), q[0], q[1]]
}

/** Lay a graph out for this frame. The result depends only on the sizes, the edges and the graph's options, and is kept per distinct input. */
export function layoutOf(graph: MNode, frame: Frame): GraphGeom {
  const model = graph.model
  const rec = storeOf(model).graphs.get(graph.uid)
  const empty: GraphGeom = { pos: new Map(), routes: [], scale: 1, width: 0, height: 0, crossings: 0 }
  if (!rec) return empty
  const sizes = rec.members.map((m) => {
    const b = frame.localBounds(m)
    const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1]
    // a node asks for room for the label beside it, the same on both sides so that it stays centred on its rank
    const reach = m.kind === 'node' ? nodeGeom(m, frame).reach : [w / 2, w / 2, h / 2, h / 2]
    return { w, h, reach, lw: 2 * Math.max(reach[0]!, reach[1]!), lh: 2 * Math.max(reach[2]!, reach[3]!), tag: m.kind === 'node' ? String(frame.prop(m, 'shape')) : m.kind }
  })
  const pairs = rec.edges.map((e) => { const [a, b] = edgeEnds(e); return [a ? rec.members.indexOf(a) : -1, b ? rec.members.indexOf(b) : -1, frame.prop<number>(e, 'buff')] as const })
  const opt = { direction: rec.direction, nodeGap: frame.prop<number>(graph, 'nodeGap'), rankGap: frame.prop<number>(graph, 'rankGap'), width: frame.prop<number>(graph, 'width'), height: frame.prop<number>(graph, 'height') }
  const r4 = (x: number): number => Math.round(x * 1e4) / 1e4
  const key = JSON.stringify([graph.uid, opt, sizes.map((s) => [r4(s.w), r4(s.h), r4(s.lw), r4(s.lh), s.tag]), pairs.map((p) => [p[0], p[1], r4(p[2] ?? 0)])])
  const cache = model.store('diagram.layouts', () => new Map<string, GraphGeom>())
  const hit = cache.get(key)
  if (hit) return hit

  const input = {
    nodes: rec.members.map((m, i) => ({ id: String(m.uid), width: sizes[i]!.lw, height: sizes[i]!.lh })),
    edges: pairs.map((p) => ({ from: String(rec.members[p[0]]?.uid ?? ''), to: String(rec.members[p[1]]?.uid ?? '') })),
    direction: opt.direction,
  }
  // first give up air between the nodes, then shrink the whole drawing
  let lay = layoutGraph({ ...input, nodeGap: opt.nodeGap, rankGap: opt.rankGap })
  // (the layout's own size is a little more than what is drawn: it is only used to decide when to squeeze)
  for (let i = 1; i < SQUEEZE.length && (lay.width > opt.width || lay.height > opt.height); i++) lay = layoutGraph({ ...input, nodeGap: opt.nodeGap * SQUEEZE[i]!, rankGap: opt.rankGap * SQUEEZE[i]! })
  const centre = (i: number): [number, number] => { const p = lay.nodes[String(rec.members[i]!.uid)]; return p ? [p.x, p.y] : [0, 0] }
  const polys = rec.members.map((m, i) => outlineOf(m, frame, sizes[i]!.w, sizes[i]!.h))
  const routes = pairs.map((p, e) => {
    const curve = lay.edges[e]?.curve
    if (!curve || curve.length < 4 || p[0] < 0 || p[1] < 0 || p[0] === p[1]) return null
    let flat: number[] = []
    for (const c of curve) flat.push(c[0], c[1])
    flat = snap(flat, true, polys[p[0]]!, centre(p[0]), 0)
    flat = snap(flat, false, polys[p[1]]!, centre(p[1]), p[2] ?? D.edgeBuff)
    return flat
  })
  // the layout kept the same room on both sides of every node; what is drawn is what gets centred and fitted
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  const grow = (x: number, y: number): void => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
  rec.members.forEach((_m, i) => { const c = centre(i), r = sizes[i]!.reach; grow(c[0] - r[0]!, c[1] - r[2]!); grow(c[0] + r[1]!, c[1] + r[3]!) })
  for (const route of routes) for (let i = 0; route && i + 1 < route.length; i += 2) grow(route[i]!, route[i + 1]!)
  if (!(x0 <= x1)) x0 = x1 = y0 = y1 = 0
  const dx = (x0 + x1) / 2, dy = (y0 + y1) / 2, width = x1 - x0, height = y1 - y0
  const out: GraphGeom = {
    pos: new Map(rec.members.map((m, i) => { const c = centre(i); return [m.uid, [c[0] - dx, c[1] - dy] as [number, number]] })),
    routes: routes.map((route) => route && route.map((v, i) => v - (i % 2 ? dy : dx))),
    scale: Math.min(1, width > 0 ? opt.width / width : 1, height > 0 ? opt.height / height : 1), width, height, crossings: lay.crossings,
  }
  if (cache.size >= KEEP) cache.delete(cache.keys().next().value as string)
  cache.set(key, out)
  return out
}
slots.layout = layoutOf
