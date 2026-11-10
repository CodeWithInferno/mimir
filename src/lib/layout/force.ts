/**
 * forceLayout(): seeded force-directed layout for organic networks (no natural flow direction).
 * Springs pull linked nodes to `linkDistance`, every pair repels, a weak pull keeps the drawing together, and
 * a final pass removes any box overlap. The iteration count is fixed and the only randomness is the seed,
 * so the same input always gives the same picture. A run that ends with crossing edges is retried from a
 * few more seeded starts and the run with the fewest crossings wins.
 */
import type { GraphEdgeInput, GraphLayout } from './graph.ts'
import { segmentsCrossXY } from './rect.ts'
import { type Route, borderPoint, finishLayout, positiveOr, routeLine, routeStart, sizeOr0 } from './route.ts'

/** A node of a force layout; the size is optional (a point when omitted). */
export interface ForceNodeInput { id: string; width?: number; height?: number }

/** Input of forceLayout. */
export interface ForceLayoutInput {
  nodes: readonly ForceNodeInput[]
  edges: readonly GraphEdgeInput[]
  /** Seed of the starting positions: the same seed gives the same layout (default 1). */
  seed?: number
  /** Number of simulation steps per run (default 300). */
  iterations?: number
  /** Rest length of an edge, centre to centre (default: the mean node diagonal + 1). */
  linkDistance?: number
  /** Minimum space between two node boxes (default 0.5). */
  nodeGap?: number
  /** Most runs to try while the result still has crossing edges (default 4). */
  attempts?: number
}

/** Small seeded generator (mulberry32): uniform numbers in [0, 1). */
function seeded(seed: number): () => number {
  let state = (Math.floor(seed) | 0) ^ 0x9e3779b9
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Force-directed layout with a seed. Edges come back as straight lines between the node borders. */
export function forceLayout(input: ForceLayoutInput): GraphLayout {
  const index = new Map<string, number>()
  const ids: string[] = [], width: number[] = [], height: number[] = []
  for (const node of input.nodes ?? []) {
    if (!node || typeof node.id !== 'string' || index.has(node.id)) continue
    index.set(node.id, ids.length)
    ids.push(node.id)
    width.push(sizeOr0(node.width)); height.push(sizeOr0(node.height))
  }
  const n = ids.length
  const edges = input.edges ?? []
  const m = edges.length
  const from = new Int32Array(m), to = new Int32Array(m)
  const degree = new Float64Array(n)
  const neighbours: number[][] = Array.from({ length: n }, () => [])
  for (let e = 0; e < m; e++) {
    const edge = edges[e]
    const u = edge ? index.get(edge.from) : undefined, v = edge ? index.get(edge.to) : undefined
    if (u === undefined || v === undefined) { from[e] = -1; to[e] = -1; continue }
    from[e] = u; to[e] = v
    if (u !== v) { degree[u]!++; degree[v]!++; neighbours[u]!.push(v); neighbours[v]!.push(u) }
  }

  const nodeGap = positiveOr(input.nodeGap, 0.5)
  let meanDiagonal = 0
  for (let v = 0; v < n; v++) meanDiagonal += Math.hypot(width[v]!, height[v]!)
  meanDiagonal = n > 0 ? meanDiagonal / n : 0
  const linkDistance = positiveOr(input.linkDistance, meanDiagonal + 1) || 1
  const iterations = Math.max(0, Math.floor(positiveOr(input.iterations, 300)))
  const attempts = Math.max(1, Math.floor(positiveOr(input.attempts, 4)))
  const seed = typeof input.seed === 'number' && Number.isFinite(input.seed) ? input.seed : 1

  // Starting shape, shared by every run: a radial tree with the best-connected node of each group in the
  // middle, its neighbours around it, theirs around them. Linked nodes start close together, which is what
  // keeps rings and hubs untangled. Each node gets a slice of the circle as wide as its share of the leaves.
  const level = new Int32Array(n).fill(-1), parent = new Int32Array(n).fill(-1)
  const order: number[] = []
  const sliceStart = new Float64Array(n), sliceSpan = new Float64Array(n)
  let groups = 0
  {
    const byDegree: number[] = []
    for (let v = 0; v < n; v++) byDegree.push(v)
    byDegree.sort((p, q) => degree[q]! - degree[p]! || p - q)
    for (const start of byDegree) {
      if (level[start] !== -1) continue
      level[start] = 0; groups++
      for (let i = order.push(start) - 1; i < order.length; i++) {
        const u = order[i]!
        for (const v of neighbours[u]!) if (level[v] === -1) { level[v] = level[u]! + 1; parent[v] = u; order.push(v) }
      }
    }
    const leaves = new Float64Array(n), taken = new Float64Array(n)
    let allLeaves = 0
    for (let i = order.length - 1; i >= 0; i--) {
      const v = order[i]!
      if (leaves[v] === 0) leaves[v] = 1
      if (parent[v]! >= 0) leaves[parent[v]!] = leaves[parent[v]!]! + leaves[v]!
      else allLeaves += leaves[v]!
    }
    let handed = 0
    for (const v of order) {
      const p = parent[v]!
      if (p < 0) { sliceSpan[v] = 2 * Math.PI * leaves[v]! / allLeaves; sliceStart[v] = handed; handed += sliceSpan[v]! }
      else {
        sliceSpan[v] = sliceSpan[p]! * leaves[v]! / leaves[p]!
        sliceStart[v] = sliceStart[p]! + taken[p]!
        taken[p] = taken[p]! + sliceSpan[v]!
      }
    }
  }

  const x = new Float64Array(n), y = new Float64Array(n), vx = new Float64Array(n), vy = new Float64Array(n)
  const decay = iterations > 0 ? 1 - Math.pow(0.001, 1 / iterations) : 1
  const repulsion = linkDistance * linkDistance / 10
  const closest = linkDistance * 0.1

  /** One full run from a seeded start; leaves the result in x/y and returns its crossing count. */
  const run = (random: () => number): number => {
    const turn = random() * Math.PI * 2
    const lift = groups > 1 ? 1 : 0                     // several groups: their centres start on a ring
    for (const v of order) {
      const radius = linkDistance * 0.9 * (level[v]! + lift), angle = turn + sliceStart[v]! + sliceSpan[v]! / 2
      x[v] = radius * Math.cos(angle) + (random() - 0.5) * linkDistance * 0.2
      y[v] = radius * Math.sin(angle) + (random() - 0.5) * linkDistance * 0.2
      vx[v] = 0; vy[v] = 0
    }
    let alpha = 1
    for (let step = 0; step < iterations; step++) {
      alpha -= alpha * decay
      // springs
      for (let e = 0; e < m; e++) {
        const u = from[e]!, v = to[e]!
        if (u < 0 || u === v) continue
        let dx = x[v]! + vx[v]! - x[u]! - vx[u]!, dy = y[v]! + vy[v]! - y[u]! - vy[u]!
        const length = Math.hypot(dx, dy) || 1e-6
        const pull = (length - linkDistance) / length * alpha / Math.min(degree[u]!, degree[v]!)
        dx *= pull; dy *= pull
        const share = degree[u]! / (degree[u]! + degree[v]!)
        vx[v] = vx[v]! - dx * share; vy[v] = vy[v]! - dy * share
        vx[u] = vx[u]! + dx * (1 - share); vy[u] = vy[u]! + dy * (1 - share)
      }
      // repulsion between every pair
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          let dx = x[j]! - x[i]!, dy = y[j]! - y[i]!
          let d2 = dx * dx + dy * dy
          if (d2 < 1e-12) { dx = 1e-3 * (1 + j - i); dy = 1e-3; d2 = dx * dx + dy * dy }
          if (d2 < closest * closest) d2 = closest * Math.sqrt(d2)
          const push = repulsion * alpha / d2
          vx[i] = vx[i]! - dx * push; vy[i] = vy[i]! - dy * push
          vx[j] = vx[j]! + dx * push; vy[j] = vy[j]! + dy * push
        }
      }
      // weak pull to the centre, friction, move
      for (let v = 0; v < n; v++) {
        vx[v] = (vx[v]! - x[v]! * 0.06 * alpha) * 0.6
        vy[v] = (vy[v]! - y[v]! * 0.06 * alpha) * 0.6
        x[v] = x[v]! + vx[v]!; y[v] = y[v]! + vy[v]!
      }
    }
    // Remove box overlaps: push every overlapping pair apart along the axis that needs the smaller move.
    for (let round = 0; round < 200; round++) {
      let moved = false
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = x[j]! - x[i]!, dy = y[j]! - y[i]!
          const overlapX = (width[i]! + width[j]!) / 2 + nodeGap - Math.abs(dx)
          const overlapY = (height[i]! + height[j]!) / 2 + nodeGap - Math.abs(dy)
          if (overlapX <= 1e-9 || overlapY <= 1e-9) continue
          moved = true
          if (overlapX < overlapY) {
            const shift = (overlapX / 2 + 1e-6) * (dx < 0 ? -1 : 1)
            x[i] = x[i]! - shift; x[j] = x[j]! + shift
          } else {
            const shift = (overlapY / 2 + 1e-6) * (dy < 0 ? -1 : 1)
            y[i] = y[i]! - shift; y[j] = y[j]! + shift
          }
        }
      }
      if (!moved) break
    }
    // Crossings between edges that do not share a node.
    let crossings = 0
    for (let e = 0; e < m; e++) {
      const a = from[e]!, b = to[e]!
      if (a < 0 || a === b) continue
      for (let f = e + 1; f < m; f++) {
        const c = from[f]!, d = to[f]!
        if (c < 0 || c === d || a === c || a === d || b === c || b === d) continue
        if (segmentsCrossXY(x[a]!, y[a]!, x[b]!, y[b]!, x[c]!, y[c]!, x[d]!, y[d]!)) crossings++
      }
    }
    return crossings
  }

  let crossings = n > 0 ? run(seeded(seed)) : 0
  if (crossings > 0 && attempts > 1) {
    let bestX = x.slice(), bestY = y.slice()
    for (let k = 1; k < attempts && crossings > 0; k++) {
      const count = run(seeded(seed * 7919 + k * 104729))
      if (count < crossings) { crossings = count; bestX = x.slice(); bestY = y.slice() }
    }
    x.set(bestX); y.set(bestY)
  }

  const routes: (Route | null)[] = new Array(m).fill(null)
  for (let e = 0; e < m; e++) {
    const u = from[e]!, v = to[e]!
    if (u < 0 || u === v) continue
    const start = borderPoint(x[u]!, y[u]!, width[u]!, height[u]!, x[v]!, y[v]!)
    const end = borderPoint(x[v]!, y[v]!, width[v]!, height[v]!, x[u]!, y[u]!)
    const route = routeStart(start[0], start[1])
    routeLine(route, end[0], end[1])
    routes[e] = route
  }
  // Coordinates are already x/y: map them straight through.
  return finishLayout({ ids, along: x, across: y, depth: width, breadth: height, routes, edges, down: false, yDown: true, crossings })
}
