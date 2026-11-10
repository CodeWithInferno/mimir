/** Shared checks for the layout tests: geometry predicates, a seeded generator and small graph builders. */
import type { Rect, Vec2 } from '../../../../src/lib/types.ts'
import type { GraphLayout, PlacedLabel } from '../../../../src/lib/layout/index.ts'

export interface Box { id: string; width: number; height: number }

/** Seeded uniform numbers in [0, 1) for the tests (mulberry32). */
export function seeded(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** "a b c" -> boxes of one size. */
export function boxes(ids: string, width = 1.6, height = 0.7): Box[] {
  return ids.split(' ').filter(Boolean).map(id => ({ id, width, height }))
}

/** "a>b b>c" -> edges. */
export function links(text: string): { from: string; to: string }[] {
  return text.split(' ').filter(Boolean).map(pair => {
    const [from, to] = pair.split('>') as [string, string]
    return { from, to }
  })
}

/** Rect of a placed node. */
export function nodeRect(layout: GraphLayout, node: Box): Rect {
  const p = layout.nodes[node.id]!
  return { x: p.x - node.width / 2, y: p.y - node.height / 2, width: node.width, height: node.height }
}

/** True when two rects overlap by more than eps. */
export function overlaps(a: Rect, b: Rect, eps = 1e-9): boolean {
  return a.x + a.width > b.x + eps && b.x + b.width > a.x + eps && a.y + a.height > b.y + eps && b.y + b.height > a.y + eps
}

/** True when the point lies strictly inside the rect (more than eps from every edge). */
export function strictlyInside(p: Vec2, r: Rect, eps = 1e-6): boolean {
  return p[0] > r.x + eps && p[0] < r.x + r.width - eps && p[1] > r.y + eps && p[1] < r.y + r.height - eps
}

/** Proper crossing of two segments (shared endpoints and touching do not count). */
export function cross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const side = (p: Vec2, q: Vec2, r: Vec2): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const eps = 1e-9
  const d1 = side(c, d, a), d2 = side(c, d, b), d3 = side(a, b, c), d4 = side(a, b, d)
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
}

/**
 * Number of edge pairs whose routes cross at least once.
 * Works on the route points as given: routes that share a port are sampled at the same parameters, so their
 * polylines only meet where the curves do. Two cases count: a proper crossing of two segments, and a
 * route passing through the other exactly at one of its sample points (symmetric drawings do that).
 */
export function routeCrossings(layout: GraphLayout): number {
  let count = 0
  const side = (a: Vec2, b: Vec2, c: Vec2): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  // Route p turns at `at` (coming from `before`, going to `after`) and `at` lies on route q, between the
  // points `qBefore` and `qAfter`. They cross there when q's two directions fall on opposite sides of p's
  // corner; a direction that coincides with one of p's (a shared stub) means they only touch.
  const passesThrough = (before: Vec2, at: Vec2, after: Vec2, qBefore: Vec2, qAfter: Vec2): boolean => {
    const angle = (v: Vec2): number => Math.atan2(v[1] - at[1], v[0] - at[0])
    const turn = 2 * Math.PI, eps = 1e-7
    const from = angle(before)
    const rel = (v: Vec2): number => ((angle(v) - from) % turn + turn) % turn
    const span = rel(after), r0 = rel(qBefore), r1 = rel(qAfter)
    for (const r of [r0, r1]) if (r < eps || turn - r < eps || Math.abs(r - span) < eps) return false
    return (r0 < span) !== (r1 < span)
  }
  // Where on segment c-d the point lies: -1 when off it, 0 at c, otherwise strictly inside (0..1).
  const whereOn = (at: Vec2, c: Vec2, d: Vec2): number => {
    const length = Math.hypot(d[0] - c[0], d[1] - c[1])
    if (length < 1e-12 || Math.abs(side(c, d, at)) / length > 1e-9) return -1
    const along = ((at[0] - c[0]) * (d[0] - c[0]) + (at[1] - c[1]) * (d[1] - c[1])) / (length * length)
    if (Math.abs(along) * length < 1e-9) return 0
    return along > 0 && (1 - along) * length > 1e-9 ? along : -1
  }
  const touchCross = (p: Vec2[], a: number, q: Vec2[], b: number): boolean => {
    if (a === 0 || a + 1 >= p.length) return false
    const where = whereOn(p[a]!, q[b]!, q[b + 1]!)
    if (where < 0) return false
    if (where === 0) return b > 0 && passesThrough(p[a - 1]!, p[a]!, p[a + 1]!, q[b - 1]!, q[b + 1]!)
    return passesThrough(p[a - 1]!, p[a]!, p[a + 1]!, q[b]!, q[b + 1]!)
  }
  const routes = layout.edges.map(e => e.points)
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const p = routes[i]!, q = routes[j]!
      let hit = false
      for (let a = 0; a + 1 < p.length && !hit; a++) {
        for (let b = 0; b + 1 < q.length && !hit; b++) {
          if (cross(p[a]!, p[a + 1]!, q[b]!, q[b + 1]!)) hit = true
          else if (touchCross(p, a, q, b) || touchCross(q, b, p, a)) hit = true
        }
      }
      if (hit) count++
    }
  }
  return count
}

/** Every point of a route sampled finely (so a thin node between two samples cannot be skipped). */
export function densify(points: Vec2[], step = 0.02): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, b = points[i + 1]!
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
    for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n])
  }
  if (points.length > 0) out.push(points[points.length - 1]!)
  return out
}

/** Problems found in a graph-shaped layout: overlapping nodes, things outside the reported size, routes
 *  that do not start/end on their node's border or that run through any node. Empty = all good. */
export function layoutProblems(layout: GraphLayout, nodes: Box[], options: { checkRoutes?: boolean } = {}): string[] {
  const problems: string[] = []
  const known = nodes.filter((node, i) => nodes.findIndex(other => other.id === node.id) === i)
  const rects = new Map(known.map(node => [node.id, nodeRect(layout, node)]))
  const frame: Rect = { x: -layout.width / 2, y: -layout.height / 2, width: layout.width, height: layout.height }
  const eps = 1e-6
  for (let i = 0; i < known.length; i++) {
    const r = rects.get(known[i]!.id)!
    if (r.x < frame.x - eps || r.y < frame.y - eps || r.x + r.width > frame.x + frame.width + eps || r.y + r.height > frame.y + frame.height + eps) {
      problems.push(`node ${known[i]!.id} outside the reported size`)
    }
    for (let j = i + 1; j < known.length; j++) {
      if (overlaps(r, rects.get(known[j]!.id)!)) problems.push(`nodes ${known[i]!.id} and ${known[j]!.id} overlap`)
    }
  }
  if (options.checkRoutes === false) return problems
  for (const edge of layout.edges) {
    const from = rects.get(edge.from), to = rects.get(edge.to)
    if (!from || !to) { if (edge.points.length > 0) problems.push(`edge ${edge.from}>${edge.to} has points but an unknown end`); continue }
    if (edge.points.length < 2) { problems.push(`edge ${edge.from}>${edge.to} has no route`); continue }
    const first = edge.points[0]!, last = edge.points[edge.points.length - 1]!
    if (!onBorder(first, from)) problems.push(`edge ${edge.from}>${edge.to} does not start on the border of ${edge.from}`)
    if (!onBorder(last, to)) problems.push(`edge ${edge.from}>${edge.to} does not end on the border of ${edge.to}`)
    if (edge.curve.length !== 0 && (edge.curve.length - 1) % 3 !== 0) problems.push(`edge ${edge.from}>${edge.to} curve is not 1 + 3k points`)
    for (const p of densify(edge.points)) {
      if (p[0] < frame.x - eps || p[0] > frame.x + frame.width + eps || p[1] < frame.y - eps || p[1] > frame.y + frame.height + eps) {
        problems.push(`edge ${edge.from}>${edge.to} leaves the reported size`); break
      }
      let through = ''
      for (const [id, r] of rects) if (strictlyInside(p, r)) { through = id; break }
      if (through) { problems.push(`edge ${edge.from}>${edge.to} passes through ${through}`); break }
    }
  }
  return problems
}

/** True when the point lies on the outline of the rect. */
export function onBorder(p: Vec2, r: Rect, eps = 1e-6): boolean {
  const inside = p[0] >= r.x - eps && p[0] <= r.x + r.width + eps && p[1] >= r.y - eps && p[1] <= r.y + r.height + eps
  const onEdge = Math.abs(p[0] - r.x) < eps || Math.abs(p[0] - r.x - r.width) < eps || Math.abs(p[1] - r.y) < eps || Math.abs(p[1] - r.y - r.height) < eps
  return inside && onEdge
}

/** Rect of a placed label. */
export function labelRect(label: PlacedLabel, sizes: Record<string, { width: number; height: number }>): Rect {
  const s = sizes[label.id] ?? { width: 0, height: 0 }
  return { x: label.x - s.width / 2, y: label.y - s.height / 2, width: s.width, height: s.height }
}

/** Number of pairs of leaders that cross. */
export function leaderCrossings(labels: PlacedLabel[]): number {
  let count = 0
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      if (cross(labels[i]!.leader[0], labels[i]!.leader[1], labels[j]!.leader[0], labels[j]!.leader[1])) count++
    }
  }
  return count
}

/** Runs fn with Math.random, Date.now and performance.now booby-trapped; returns what fn returns. */
export function withoutClockOrRandom<T>(fn: () => T): T {
  const random = Math.random, now = Date.now, perf = performance.now
  const trap = (name: string) => (): never => { throw new Error(`${name} was called`) }
  Math.random = trap('Math.random'); Date.now = trap('Date.now'); performance.now = trap('performance.now')
  try { return fn() } finally { Math.random = random; Date.now = now; performance.now = perf }
}
