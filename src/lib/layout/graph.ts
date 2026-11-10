/**
 * layoutGraph(): layered ("Sugiyama") layout for node-and-arrow diagrams.
 * Pipeline: cycle removal (depth-first, in declaration order) -> longest-path ranking with a tightening pass
 * -> virtual nodes for edges that span several ranks -> barycentre + transpose crossing reduction ->
 * Brandes-Koepf coordinate assignment (four alignments, balanced) -> edge routes.
 * Routes leave a node on its rank-facing side, run straight to the edge of the rank, cross the empty channel
 * between two ranks as one S-curve and continue straight, so a route can never pass through a node.
 * Everything is deterministic: same input, same output, no clock and no randomness.
 */
import type { Vec2 } from '../types.ts'
import { type Route, finishLayout, positiveOr, routeCurve, routeLine, routeStart, sizeOr0 } from './route.ts'

/** A node to place: only its id and size matter. */
export interface GraphNodeInput { id: string; width: number; height: number }

/** A directed edge between two node ids. */
export interface GraphEdgeInput { from: string; to: string }

/** Input of layoutGraph. */
export interface GraphLayoutInput {
  nodes: readonly GraphNodeInput[]
  edges: readonly GraphEdgeInput[]
  /** Direction the edges flow in (default 'right'). */
  direction?: 'right' | 'down'
  /** Space between neighbouring nodes of one rank (default 0.5). */
  nodeGap?: number
  /** Space between two ranks (default 1). */
  rankGap?: number
  /** Space a long edge keeps to its neighbours while it passes a rank (default nodeGap / 2). */
  edgeGap?: number
  /** True in screen space, where y grows downwards (default false: frame space, y up). */
  yDown?: boolean
}

/** Centre of a placed node. */
export interface NodePosition { x: number; y: number }

/** A routed edge. */
export interface EdgeRoute {
  from: string
  to: string
  /** Smooth polyline from the border of `from` to the border of `to`; dense enough to draw or to walk a
   *  token along. Empty when an endpoint id is unknown (and for self loops in layoutTree / forceLayout). */
  points: Vec2[]
  /** The same route as cubic Bezier control points: start, then (control, control, end) per piece. */
  curve: Vec2[]
  /** True when the layout had to run this edge against the flow to break a cycle. */
  reversed: boolean
}

/** Result of layoutGraph, layoutTree and forceLayout. The drawing is centred on the origin: it spans
 *  -width/2..width/2 and -height/2..height/2, edges included. */
export interface GraphLayout {
  nodes: Record<string, NodePosition>
  /** One route per input edge, in input order. */
  edges: EdgeRoute[]
  width: number
  height: number
  /** Edge crossings left in the drawing: between ranks for layoutGraph, between the straight edges for
   *  forceLayout, always 0 for layoutTree (tree links never cross; extra links are not counted). */
  crossings: number
}

/** Layered layout of a directed graph: node centres, smooth edge routes and the overall size. */
export function layoutGraph(input: GraphLayoutInput): GraphLayout {
  const nodeGap = positiveOr(input.nodeGap, 0.5)
  const rankGap = positiveOr(input.rankGap, 1)
  const edgeGap = positiveOr(input.edgeGap, nodeGap / 2)
  const down = input.direction === 'down'
  const yDown = input.yDown === true

  // ── 1. index nodes and edges ────────────────────────────────────────────────────────────────────────
  const index = new Map<string, number>()
  const ids: string[] = []
  const breadth: number[] = []      // extent along the order axis (across the flow)
  const depth: number[] = []        // extent along the rank axis (along the flow)
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
  const from = new Int32Array(m), to = new Int32Array(m)
  const out: number[][] = Array.from({ length: n }, () => [])
  const inDegree = new Int32Array(n)
  for (let e = 0; e < m; e++) {
    const edge = edges[e]
    const u = edge ? index.get(edge.from) : undefined, v = edge ? index.get(edge.to) : undefined
    if (u === undefined || v === undefined) { from[e] = -1; to[e] = -1; continue }
    from[e] = u; to[e] = v
    if (u !== v) { out[u]!.push(e); inDegree[v]!++ }
  }

  // ── 2. cycle removal: depth-first from the sources, edges that point back at the open path are reversed ─
  const reversed = new Uint8Array(m)
  {
    const state = new Uint8Array(n)             // 0 new, 1 on the open path, 2 done
    const stack: number[] = [], cursor: number[] = []
    const visit = (start: number): void => {
      if (state[start] !== 0) return
      state[start] = 1; stack.push(start); cursor.push(0)
      while (stack.length > 0) {
        const top = stack.length - 1, u = stack[top]!, list = out[u]!
        if (cursor[top]! < list.length) {
          const e = list[cursor[top]!++]!, v = to[e]!
          if (state[v] === 0) { state[v] = 1; stack.push(v); cursor.push(0) }
          else if (state[v] === 1) reversed[e] = 1
        } else { state[u] = 2; stack.pop(); cursor.pop() }
      }
    }
    for (let v = 0; v < n; v++) if (inDegree[v] === 0) visit(v)
    for (let v = 0; v < n; v++) visit(v)
  }
  // Layout direction of every edge: a -> b always points down the ranks.
  const a = new Int32Array(m), b = new Int32Array(m)
  for (let e = 0; e < m; e++) {
    if (reversed[e]) { a[e] = to[e]!; b[e] = from[e]! } else { a[e] = from[e]!; b[e] = to[e]! }
  }
  const usable = (e: number): boolean => from[e]! >= 0 && from[e] !== to[e]

  // ── 3. ranks: longest path, then pull nodes with more outgoing than incoming edges towards their targets ─
  const rank = new Int32Array(n)
  {
    const succ: number[][] = Array.from({ length: n }, () => [])
    const pending = new Int32Array(n), fanIn = new Int32Array(n)
    for (let e = 0; e < m; e++) if (usable(e)) { succ[a[e]!]!.push(b[e]!); pending[b[e]!]!++; fanIn[b[e]!]!++ }
    const order: number[] = []
    for (let v = 0; v < n; v++) if (pending[v] === 0) order.push(v)
    for (let i = 0; i < order.length; i++) {
      const u = order[i]!
      for (const v of succ[u]!) {
        if (rank[u]! + 1 > rank[v]!) rank[v] = rank[u]! + 1
        if (--pending[v]! === 0) order.push(v)
      }
    }
    for (let i = order.length - 1; i >= 0; i--) {
      const u = order[i]!, list = succ[u]!
      if (list.length === 0 || fanIn[u]! >= list.length) continue
      let nearest = Infinity
      for (const v of list) if (rank[v]! < nearest) nearest = rank[v]!
      if (nearest - 1 > rank[u]!) rank[u] = nearest - 1
    }
    let lowest = Infinity
    for (let v = 0; v < n; v++) if (rank[v]! < lowest) lowest = rank[v]!
    if (n > 0 && lowest !== 0) for (let v = 0; v < n; v++) rank[v] = rank[v]! - lowest
  }

  // ── 4. virtual nodes: one per rank an edge passes; edges between the same two nodes share a chain ────────
  const itemRank: number[] = Array.from(rank)
  const up: number[][] = Array.from({ length: n }, () => [])
  const dn: number[][] = Array.from({ length: n }, () => [])
  const chainOf = new Map<number, number[]>()
  const chains: (number[] | null)[] = new Array(m).fill(null)
  for (let e = 0; e < m; e++) {
    if (!usable(e)) continue
    const u = a[e]!, v = b[e]!, key = u * n + v
    let chain = chainOf.get(key)
    if (!chain) {
      chain = [u]
      for (let r = rank[u]! + 1; r < rank[v]!; r++) {
        const item = itemRank.length
        itemRank.push(r); breadth.push(0); depth.push(0); up.push([]); dn.push([])
        chain.push(item)
      }
      chain.push(v)
      for (let i = 0; i + 1 < chain.length; i++) { dn[chain[i]!]!.push(chain[i + 1]!); up[chain[i + 1]!]!.push(chain[i]!) }
      chainOf.set(key, chain)
    }
    chains[e] = chain
  }
  const total = itemRank.length
  let rankCount = 0
  for (let i = 0; i < total; i++) if (itemRank[i]! + 1 > rankCount) rankCount = itemRank[i]! + 1

  // ── 5. order inside each rank ──────────────────────────────────────────────────────────────────────────
  const layers: number[][] = Array.from({ length: rankCount }, () => [])
  const pos = new Int32Array(total)
  {
    const seen = new Uint8Array(total)
    const starts: number[] = []
    for (let v = 0; v < n; v++) starts.push(v)
    starts.sort((p, q) => rank[p]! - rank[q]! || p - q)
    const stack: number[] = []
    for (const start of starts) {
      stack.push(start)
      while (stack.length > 0) {
        const v = stack.pop()!
        if (seen[v]) continue
        seen[v] = 1
        layers[itemRank[v]!]!.push(v)
        const next = dn[v]!
        for (let i = next.length - 1; i >= 0; i--) if (!seen[next[i]!]) stack.push(next[i]!)
      }
    }
  }
  const syncPos = (): void => { for (const layer of layers) for (let i = 0; i < layer.length; i++) pos[layer[i]!] = i }
  syncPos()
  let crossings = 0
  if (rankCount > 1) crossings = reduceCrossings(layers, pos, up, dn, total)

  // ── 6. coordinates across the flow (Brandes-Koepf) and along it ──────────────────────────────────────────
  const halfGap = new Float64Array(total)
  for (let i = 0; i < total; i++) halfGap[i] = (i < n ? nodeGap : edgeGap) / 2
  const across = assignCoordinates(layers, pos, up, dn, n, breadth, halfGap)
  const rankLo = new Float64Array(rankCount), rankHi = new Float64Array(rankCount)
  {
    let cursor = 0
    for (let r = 0; r < rankCount; r++) {
      let thickness = 0
      for (const v of layers[r]!) if (depth[v]! > thickness) thickness = depth[v]!
      rankLo[r] = cursor; rankHi[r] = cursor + thickness
      cursor += thickness + rankGap
    }
  }
  const along = (v: number): number => (rankLo[itemRank[v]!]! + rankHi[itemRank[v]!]!) / 2

  // ── 7. ports: edges fan out from the middle of a side, except on a side that has both arriving and
  //       departing edges; there every edge gets its own port, in the order of where it comes from ──────────
  const portA = new Float64Array(m), portB = new Float64Array(m)
  {
    const sideOut: number[][] = Array.from({ length: n }, () => [])
    const sideIn: number[][] = Array.from({ length: n }, () => [])
    for (let e = 0; e < m; e++) {
      if (!usable(e)) continue
      sideOut[a[e]!]!.push(e); sideIn[b[e]!]!.push(e)
      portA[e] = across[a[e]!]!; portB[e] = across[b[e]!]!
    }
    const spread = (v: number, list: number[], port: Float64Array, neighbour: (e: number) => number): void => {
      let forward = 0, backward = 0
      for (const e of list) { if (reversed[e]) backward++; else forward++ }
      if (forward === 0 || backward === 0) return
      // Same neighbour and same direction = same port; forward before backward keeps a two-way pair parallel.
      const sorted = list.slice().sort((p, q) => across[neighbour(p)]! - across[neighbour(q)]! || neighbour(p) - neighbour(q) || reversed[p]! - reversed[q]! || p - q)
      const group = new Int32Array(sorted.length)
      let groups = 1
      for (let i = 1; i < sorted.length; i++) {
        const p = sorted[i - 1]!, q = sorted[i]!
        if (neighbour(p) !== neighbour(q) || reversed[p] !== reversed[q]) groups++
        group[i] = groups - 1
      }
      const spacing = Math.min(Math.min(breadth[v]!, nodeGap) / 2, breadth[v]! * 0.6 / (groups - 1))
      for (let i = 0; i < sorted.length; i++) port[sorted[i]!] = across[v]! + (group[i]! - (groups - 1) / 2) * spacing
    }
    for (let v = 0; v < n; v++) {
      spread(v, sideOut[v]!, portA, e => chains[e]![1]!)
      spread(v, sideIn[v]!, portB, e => chains[e]![chains[e]!.length - 2]!)
    }
  }

  // ── 8. routes ────────────────────────────────────────────────────────────────────────────────────────────
  const routes: (Route | null)[] = new Array(m).fill(null)
  for (let e = 0; e < m; e++) {
    if (from[e]! < 0) continue
    if (from[e] === to[e]) { routes[e] = selfLoop(along(from[e]!), across[from[e]!]!, depth[from[e]!]!, breadth[from[e]!]!, nodeGap); continue }
    const chain = chains[e]!, last = chain.length - 1
    const u = chain[0]!
    const route = routeStart(along(u) + depth[u]! / 2, portA[e]!)
    for (let j = 0; j < last; j++) {
      const p = chain[j]!, q = chain[j + 1]!, r = itemRank[p]!
      const op = j === 0 ? portA[e]! : across[p]!, oq = j + 1 === last ? portB[e]! : across[q]!
      const c0 = rankHi[r]!, c1 = rankLo[r + 1]!
      routeLine(route, c0, op)
      if (Math.abs(op - oq) < 1e-9) routeLine(route, c1, oq)
      else routeCurve(route, (c0 + c1) / 2, op, (c0 + c1) / 2, oq, c1, oq)
      if (j + 1 === last) routeLine(route, along(q) - depth[q]! / 2, oq)
    }
    if (reversed[e]) { route.points.reverse(); route.curve.reverse() }
    routes[e] = route
  }

  // ── 9. to x/y, centred on the origin ─────────────────────────────────────────────────────────────────────
  const alongOf = new Float64Array(n)
  for (let v = 0; v < n; v++) alongOf[v] = along(v)
  return finishLayout({ ids, along: alongOf, across, depth, breadth, routes, edges, reversed, down, yDown, crossings })
}

/** A small loop on the first side of a node, for an edge from a node to itself. */
function selfLoop(c: number, o: number, depth: number, breadth: number, nodeGap: number): Route {
  const reach = 0.6 * nodeGap                      // a cubic rises 3/4 of its control height: 0.45 * nodeGap
  const half = depth / 4, spread = Math.min(depth / 4, reach)
  const edge = o - breadth / 2
  const route = routeStart(c + half, edge)
  routeCurve(route, c + half + spread, edge - reach, c - half - spread, edge - reach, c - half, edge)
  return route
}

/** Barycentre sweeps plus adjacent swaps; leaves the best order found in `layers`/`pos` and returns its
 *  crossing count. Ties never reorder, so the declaration order survives wherever it costs nothing. */
function reduceCrossings(layers: number[][], pos: Int32Array, up: number[][], dn: number[][], total: number): number {
  let widest = 0
  for (const layer of layers) if (layer.length > widest) widest = layer.length
  const tree = new Int32Array(widest + 1)
  const scratch: number[] = []

  const countAll = (): number => {
    let count = 0
    for (let r = 0; r + 1 < layers.length; r++) {
      const size = layers[r + 1]!.length
      tree.fill(0, 0, size + 1)
      let placed = 0
      for (const u of layers[r]!) {
        const next = dn[u]!
        scratch.length = 0
        for (const v of next) scratch.push(pos[v]!)
        scratch.sort((p, q) => p - q)
        for (const p of scratch) {
          let notAfter = 0
          for (let i = p + 1; i > 0; i -= i & -i) notAfter += tree[i]!
          count += placed - notAfter
        }
        for (const p of scratch) { for (let i = p + 1; i <= size; i += i & -i) tree[i]!++; placed++ }
      }
    }
    return count
  }
  const pairCrossings = (listA: number[], listB: number[]): number => {
    let count = 0
    for (const p of listA) for (const q of listB) if (pos[p]! > pos[q]!) count++
    return count
  }
  const transpose = (): void => {
    for (let round = 0, improved = true; improved && round < 12; round++) {
      improved = false
      for (const layer of layers) {
        for (let i = 0; i + 1 < layer.length; i++) {
          const v = layer[i]!, w = layer[i + 1]!
          const now = pairCrossings(up[v]!, up[w]!) + pairCrossings(dn[v]!, dn[w]!)
          const swapped = pairCrossings(up[w]!, up[v]!) + pairCrossings(dn[w]!, dn[v]!)
          if (swapped < now) { layer[i] = w; layer[i + 1] = v; pos[w] = i; pos[v] = i + 1; improved = true }
        }
      }
    }
  }
  const bary = new Float64Array(total)
  const sweep = (r: number, neighbours: number[][], biasRight: boolean): void => {
    const layer = layers[r]!
    const slots: number[] = [], movable: number[] = []
    for (let i = 0; i < layer.length; i++) {
      const v = layer[i]!, list = neighbours[v]!
      if (list.length === 0) continue
      let sum = 0
      for (const w of list) sum += pos[w]!
      bary[v] = sum / list.length
      slots.push(i); movable.push(v)
    }
    movable.sort((p, q) => bary[p]! - bary[q]! || (biasRight ? pos[q]! - pos[p]! : pos[p]! - pos[q]!))
    for (let i = 0; i < slots.length; i++) layer[slots[i]!] = movable[i]!
    for (let i = 0; i < layer.length; i++) pos[layer[i]!] = i
  }
  const snapshot = (): number[][] => layers.map(layer => layer.slice())

  transpose()
  let best = snapshot(), bestCount = countAll()
  for (let pass = 0, stale = 0; pass < 24 && bestCount > 0 && stale < 4; pass++) {
    const biasRight = pass % 4 >= 2
    if (pass % 2 === 0) for (let r = 1; r < layers.length; r++) sweep(r, up, biasRight)
    else for (let r = layers.length - 2; r >= 0; r--) sweep(r, dn, biasRight)
    transpose()
    const count = countAll()
    if (count < bestCount) { best = snapshot(); bestCount = count; stale = 0 } else stale++
  }
  for (let r = 0; r < layers.length; r++) {
    const layer = best[r]!
    layers[r] = layer
    for (let i = 0; i < layer.length; i++) pos[layer[i]!] = i
  }
  return bestCount
}

/**
 * Brandes-Koepf coordinate assignment: every node is aligned with a median neighbour four times (up/down x
 * left/right), each alignment is compacted, and the result is the mean of the two middle candidates. Long
 * edges come out straight and parents sit centred over their children.
 */
function assignCoordinates(
  layers: number[][], pos: Int32Array, up: number[][], dn: number[][], realCount: number,
  breadth: number[], halfGap: Float64Array,
): Float64Array {
  const total = pos.length
  const result = new Float64Array(total)
  if (total === 0) return result
  const isVirtual = (v: number): boolean => v >= realCount
  const separation = (p: number, q: number): number => breadth[p]! / 2 + halfGap[p]! + halfGap[q]! + breadth[q]! / 2

  // Type-1 conflicts: an ordinary edge crossing a virtual-virtual segment loses, so long edges stay straight.
  const conflicts = new Set<number>()
  const conflictKey = (p: number, q: number): number => (p < q ? p * total + q : q * total + p)
  for (let r = 1; r < layers.length; r++) {
    const previous = layers[r - 1]!, layer = layers[r]!
    let k0 = 0, scanFrom = 0
    for (let i = 0; i < layer.length; i++) {
      const v = layer[i]!
      let inner = -1
      if (isVirtual(v)) for (const u of up[v]!) if (isVirtual(u)) { inner = u; break }
      if (inner < 0 && i !== layer.length - 1) continue
      const k1 = inner >= 0 ? pos[inner]! : previous.length
      for (let s = scanFrom; s <= i; s++) {
        const node = layer[s]!
        for (const u of up[node]!) {
          const p = pos[u]!
          if ((p < k0 || p > k1) && !(isVirtual(u) && isVirtual(node))) conflicts.add(conflictKey(u, node))
        }
      }
      scanFrom = i + 1
      k0 = k1
    }
  }

  const candidates: Float64Array[] = []
  const root = new Int32Array(total), align = new Int32Array(total), order = new Int32Array(total)
  for (let vertical = 0; vertical < 2; vertical++) {
    for (let horizontal = 0; horizontal < 2; horizontal++) {
      const neighbours = vertical === 0 ? up : dn
      const sweep: number[][] = []
      for (let r = 0; r < layers.length; r++) {
        const layer = layers[vertical === 0 ? r : layers.length - 1 - r]!
        sweep.push(horizontal === 0 ? layer : layer.slice().reverse())
      }
      for (const layer of sweep) for (let i = 0; i < layer.length; i++) { const v = layer[i]!; root[v] = v; align[v] = v; order[v] = i }
      // vertical alignment with the median neighbour(s)
      for (const layer of sweep) {
        let lastUsed = -1
        for (const v of layer) {
          const list = neighbours[v]!
          if (list.length === 0) continue
          const sorted = list.length === 1 ? list : list.slice().sort((p, q) => order[p]! - order[q]!)
          const middle = (sorted.length - 1) / 2
          for (let i = Math.floor(middle); i <= Math.ceil(middle); i++) {
            const w = sorted[i]!
            if (align[v] === v && lastUsed < order[w]! && !conflicts.has(conflictKey(v, w))) {
              align[w] = v
              root[v] = root[w]!
              align[v] = root[v]!
              lastUsed = order[w]!
            }
          }
        }
      }
      // horizontal compaction over the graph of blocks
      const weights = new Map<number, number>()
      const blockOut: number[][] = Array.from({ length: total }, () => [])
      const blockIn: number[][] = Array.from({ length: total }, () => [])
      for (const layer of sweep) {
        for (let i = 1; i < layer.length; i++) {
          const p = root[layer[i - 1]!]!, q = root[layer[i]!]!
          const key = p * total + q, gap = separation(layer[i - 1]!, layer[i]!)
          const known = weights.get(key)
          if (known === undefined) { blockOut[p]!.push(q); blockIn[q]!.push(p); weights.set(key, gap) }
          else if (gap > known) weights.set(key, gap)
        }
      }
      const pending = new Int32Array(total)
      const topo: number[] = []
      for (let v = 0; v < total; v++) {
        if (root[v] !== v) continue
        pending[v] = blockIn[v]!.length
        if (pending[v] === 0) topo.push(v)
      }
      for (let i = 0; i < topo.length; i++) for (const q of blockOut[topo[i]!]!) if (--pending[q]! === 0) topo.push(q)
      const xs = new Float64Array(total)
      for (const q of topo) {
        let x = 0
        for (const p of blockIn[q]!) x = Math.max(x, xs[p]! + weights.get(p * total + q)!)
        xs[q] = x
      }
      for (let i = topo.length - 1; i >= 0; i--) {
        const p = topo[i]!
        let limit = Infinity
        for (const q of blockOut[p]!) limit = Math.min(limit, xs[q]! - weights.get(p * total + q)!)
        if (limit !== Infinity && limit > xs[p]!) xs[p] = limit
      }
      for (let v = 0; v < total; v++) xs[v] = xs[root[v]!]!
      if (horizontal === 1) for (let v = 0; v < total; v++) xs[v] = -xs[v]!
      candidates.push(xs)
    }
  }

  // Line the four candidates up on the narrowest one, then take the mean of the two middle values.
  const lows: number[] = [], highs: number[] = []
  let narrowest = 0, narrowestWidth = Infinity
  for (let k = 0; k < 4; k++) {
    let lo = Infinity, hi = -Infinity, left = Infinity, right = -Infinity
    const xs = candidates[k]!
    for (let v = 0; v < total; v++) {
      lo = Math.min(lo, xs[v]!); hi = Math.max(hi, xs[v]!)
      left = Math.min(left, xs[v]! - breadth[v]! / 2); right = Math.max(right, xs[v]! + breadth[v]! / 2)
    }
    lows.push(lo); highs.push(hi)
    if (right - left < narrowestWidth - 1e-12) { narrowest = k; narrowestWidth = right - left }
  }
  for (let k = 0; k < 4; k++) {
    if (k === narrowest) continue
    const shift = k % 2 === 0 ? lows[narrowest]! - lows[k]! : highs[narrowest]! - highs[k]!
    const xs = candidates[k]!
    if (shift !== 0) for (let v = 0; v < total; v++) xs[v] = xs[v]! + shift
  }
  const four = [0, 0, 0, 0]
  for (let v = 0; v < total; v++) {
    for (let k = 0; k < 4; k++) four[k] = candidates[k]![v]!
    four.sort((p, q) => p - q)
    result[v] = (four[1]! + four[2]!) / 2
  }
  return result
}
