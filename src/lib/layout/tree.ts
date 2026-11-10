/**
 * layoutTree(): tidy tree layout (Reingold-Tilford with real node sizes).
 * Children sit side by side as close as their subtrees allow, every parent is centred over its children, and
 * small subtrees caught between two large ones are spread out evenly. Levels are as thick as their thickest
 * node, so edges cross the empty channel between two levels as one S-curve.
 */
import type { GraphEdgeInput, GraphLayout, GraphNodeInput } from './graph.ts'
import { type Route, borderPoint, finishLayout, positiveOr, routeCurve, routeLine, routeStart, sizeOr0 } from './route.ts'

/** Input of layoutTree. */
export interface TreeLayoutInput {
  nodes: readonly GraphNodeInput[]
  /** Parent -> child links. A node keeps its first parent; any other edge is drawn as a straight line. */
  edges: readonly GraphEdgeInput[]
  /** Direction the tree grows in (default 'down'). */
  direction?: 'right' | 'down'
  /** Space between neighbouring subtrees (default 0.5). */
  nodeGap?: number
  /** Space between two levels (default 1). */
  rankGap?: number
  /** True in screen space, where y grows downwards (default false: frame space, y up). */
  yDown?: boolean
}

/** Outline of a subtree: per level below its root, the lowest and highest coordinate across the flow. */
interface Contour { lo: number[]; hi: number[] }

/** Tidy layout of a tree (or a forest: several roots sit side by side). Same result shape as layoutGraph. */
export function layoutTree(input: TreeLayoutInput): GraphLayout {
  const nodeGap = positiveOr(input.nodeGap, 0.5)
  const rankGap = positiveOr(input.rankGap, 1)
  const down = input.direction !== 'right'
  const yDown = input.yDown === true

  const index = new Map<string, number>()
  const ids: string[] = [], breadth: number[] = [], depth: number[] = []
  for (const node of input.nodes ?? []) {
    if (!node || typeof node.id !== 'string' || index.has(node.id)) continue
    index.set(node.id, ids.length)
    ids.push(node.id)
    const w = sizeOr0(node.width), h = sizeOr0(node.height)
    breadth.push(down ? w : h)
    depth.push(down ? h : w)
  }
  const n = ids.length
  const edges = input.edges ?? []
  const m = edges.length

  // Parent links: first parent wins, and a link that would close a loop is not part of the tree.
  const parent = new Int32Array(n).fill(-1)
  const children: number[][] = Array.from({ length: n }, () => [])
  const from = new Int32Array(m), to = new Int32Array(m)
  const isTreeEdge = new Uint8Array(m)
  for (let e = 0; e < m; e++) {
    const edge = edges[e]
    const u = edge ? index.get(edge.from) : undefined, v = edge ? index.get(edge.to) : undefined
    if (u === undefined || v === undefined) { from[e] = -1; to[e] = -1; continue }
    from[e] = u; to[e] = v
    if (u === v || parent[v] !== -1) continue
    let loops = false
    for (let w = u; w !== -1; w = parent[w]!) if (w === v) { loops = true; break }
    if (loops) continue
    parent[v] = u
    children[u]!.push(v)
    isTreeEdge[e] = 1
  }
  const roots: number[] = []
  for (let v = 0; v < n; v++) if (parent[v] === -1) roots.push(v)

  // Breadth-first order: parents before children, so the reverse order visits children first.
  const order: number[] = roots.slice()
  const level = new Int32Array(n)
  for (let i = 0; i < order.length; i++) {
    const v = order[i]!
    for (const c of children[v]!) { level[c] = level[v]! + 1; order.push(c) }
  }

  // Bottom-up: place the children of every node relative to it and build the subtree outline.
  const contours: (Contour | null)[] = new Array(n).fill(null)
  const offset = new Float64Array(n)             // across-the-flow offset from the parent
  const pack = (kids: number[]): Contour => {
    const first = contours[kids[0]!]!
    const at: number[] = [0]
    let lo = first.lo.slice(), hi = first.hi.slice()
    let owner: number[] = hi.map(() => 0)
    const rebuild = (count: number): void => {
      lo = []; hi = []; owner = []
      for (let k = 0; k < count; k++) merge(k)
    }
    const merge = (k: number): void => {
      const c = contours[kids[k]!]!, shift = at[k]!
      for (let d = 0; d < c.lo.length; d++) {
        if (d >= lo.length) { lo.push(c.lo[d]! + shift); hi.push(c.hi[d]! + shift); owner.push(k); continue }
        if (c.lo[d]! + shift < lo[d]!) lo[d] = c.lo[d]! + shift
        if (c.hi[d]! + shift >= hi[d]!) { hi[d] = c.hi[d]! + shift; owner[d] = k }
      }
    }
    for (let i = 1; i < kids.length; i++) {
      const c = contours[kids[i]!]!
      let need = -Infinity, bound = i - 1
      for (let d = 0; d < c.lo.length && d < hi.length; d++) {
        const shift = hi[d]! + nodeGap - c.lo[d]!
        if (shift > need) { need = shift; bound = owner[d]! }
      }
      at.push(need)
      if (bound < i - 1) {
        // Subtrees between the one that pushed us away and us: share the freed room evenly.
        let moved = false
        for (let k = i - 1; k > bound; k--) {
          const wanted = at[bound]! + (need - at[bound]!) * (k - bound) / (i - bound)
          if (wanted <= at[k]!) continue
          const ck = contours[kids[k]!]!
          let room = Infinity
          for (let j = k + 1; j <= i; j++) {
            const cj = contours[kids[j]!]!
            for (let d = 0; d < ck.hi.length && d < cj.lo.length; d++) room = Math.min(room, cj.lo[d]! + at[j]! - nodeGap - ck.hi[d]!)
          }
          const target = Math.min(wanted, room)
          if (target > at[k]!) { at[k] = target; moved = true }
        }
        if (moved) rebuild(i)
      }
      merge(i)
    }
    const middle = (at[0]! + at[at.length - 1]!) / 2
    for (let i = 0; i < kids.length; i++) offset[kids[i]!] = at[i]! - middle
    for (let d = 0; d < lo.length; d++) { lo[d] = lo[d]! - middle; hi[d] = hi[d]! - middle }
    return { lo, hi }
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const v = order[i]!, kids = children[v]!
    const half = breadth[v]! / 2
    if (kids.length === 0) { contours[v] = { lo: [-half], hi: [half] }; continue }
    const below = pack(kids)
    below.lo.unshift(-half); below.hi.unshift(half)
    contours[v] = below
  }
  if (roots.length > 0) pack(roots)

  // Top-down: absolute coordinates.
  const across = new Float64Array(n), along = new Float64Array(n)
  for (const v of order) across[v] = offset[v]! + (parent[v]! >= 0 ? across[parent[v]!]! : 0)
  let levels = 0
  for (let v = 0; v < n; v++) if (level[v]! + 1 > levels) levels = level[v]! + 1
  const levelLo = new Float64Array(levels), levelHi = new Float64Array(levels)
  {
    const thickness = new Float64Array(levels)
    for (let v = 0; v < n; v++) if (depth[v]! > thickness[level[v]!]!) thickness[level[v]!] = depth[v]!
    let cursor = 0
    for (let r = 0; r < levels; r++) { levelLo[r] = cursor; levelHi[r] = cursor + thickness[r]!; cursor += thickness[r]! + rankGap }
  }
  for (let v = 0; v < n; v++) along[v] = (levelLo[level[v]!]! + levelHi[level[v]!]!) / 2

  const routes: (Route | null)[] = new Array(m).fill(null)
  for (let e = 0; e < m; e++) {
    const u = from[e]!, v = to[e]!
    if (u < 0 || u === v) continue
    if (isTreeEdge[e]) {
      const r = level[u]!
      const route = routeStart(along[u]! + depth[u]! / 2, across[u]!)
      const c0 = levelHi[r]!, c1 = levelLo[r + 1]!
      routeLine(route, c0, across[u]!)
      if (Math.abs(across[u]! - across[v]!) < 1e-9) routeLine(route, c1, across[v]!)
      else routeCurve(route, (c0 + c1) / 2, across[u]!, (c0 + c1) / 2, across[v]!, c1, across[v]!)
      routeLine(route, along[v]! - depth[v]! / 2, across[v]!)
      routes[e] = route
    } else {
      const start = borderPoint(along[u]!, across[u]!, depth[u]!, breadth[u]!, along[v]!, across[v]!)
      const end = borderPoint(along[v]!, across[v]!, depth[v]!, breadth[v]!, along[u]!, across[u]!)
      const route = routeStart(start[0], start[1])
      routeLine(route, end[0], end[1])
      routes[e] = route
    }
  }
  return finishLayout({ ids, along, across, depth, breadth, routes, edges, down, yDown, crossings: 0 })
}
