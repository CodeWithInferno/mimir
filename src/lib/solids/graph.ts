/**
 * Contact graph over collision proxies and the floater report built on it (FLOATING in docs/DESIGN.md section 7).
 * Two proxies are connected when their surfaces come within the contact tolerance (or overlap).
 * Floaters are measured by SPAN, not volume: a detached thin panel can be 70% of a model's span and 2% of its volume.
 */
import type { Vec3 } from '../types.ts'
import { type Proxy, span } from './proxy.ts'
import { type Prepared, type QueryOptions, boundsGap, nearest, prepare, preparedTouching } from './query.ts'
import { DEFAULT_SAMPLES } from './sample.ts'

/** Result of `contactGraph`. */
export interface ContactGraph {
  /** Connected groups of part ids, in input order (a part touching nothing is a group of one). */
  components: string[][]
  /** Touching pairs `[idA, idB]`, in input order. */
  edges: [string, string][]
  /** The contact tolerance that was used, world units. */
  tolerance: number
}

/** Options for `floaters`. */
export interface FloaterOptions extends QueryOptions {
  /** Ignore detached groups smaller than this fraction of the model's span (default 0.01). */
  minSpanFraction?: number
}

/** One detached group of parts reported by `floaters`. */
export interface Floater {
  /** Ids of the parts in the detached group. */
  ids: string[]
  /** Diagonal of the group's world bounds. */
  span: number
  /** `span` divided by the whole model's span. */
  spanFraction: number
  /** Id of the part in this group that is closest to the rest of the model (null when there is nothing else). */
  fromId: string | null
  /** Id of the nearest part outside the group (null when there is nothing else). */
  nearestId: string | null
  /** World gap to that nearest part. */
  distance: number
  /** Unit world direction from this group towards the nearest part (zero vector when unknown). */
  direction: Vec3
}

function resolveTolerance(proxies: readonly Proxy[], tolerance: number | undefined): number {
  return tolerance !== undefined && tolerance >= 0 ? tolerance : 0.01 * span(proxies)
}

interface Linked { prepared: Prepared[]; group: Int32Array; groups: number[][]; edges: [number, number][] }

function link(proxies: readonly Proxy[], tolerance: number, n: number, seed: number): Linked {
  const count = proxies.length
  const prepared: Prepared[] = new Array<Prepared>(count)
  for (let i = 0; i < count; i++) prepared[i] = prepare(proxies[i]!)
  const parent = new Int32Array(count)
  for (let i = 0; i < count; i++) parent[i] = i
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]! }
    return i
  }
  const edges: [number, number][] = []
  for (let i = 0; i < count; i++) {
    const A = prepared[i]!
    for (let j = i + 1; j < count; j++) {
      const B = prepared[j]!
      if (boundsGap(A, B) > tolerance) continue
      if (!preparedTouching(A, B, tolerance, n, seed)) continue
      edges.push([i, j])
      const ri = find(i), rj = find(j)
      if (ri !== rj) parent[rj > ri ? rj : ri] = rj > ri ? ri : rj
    }
  }
  const group = new Int32Array(count)
  const groups: number[][] = []
  const indexOfRoot = new Map<number, number>()
  for (let i = 0; i < count; i++) {
    const root = find(i)
    let g = indexOfRoot.get(root)
    if (g === undefined) { g = groups.length; indexOfRoot.set(root, g); groups.push([]) }
    groups[g]!.push(i)
    group[i] = g
  }
  return { prepared, group, groups, edges }
}

/** Groups proxies into connected components: parts whose surfaces come within `tolerance` (default 1% of the model span) are connected. */
export function contactGraph(proxies: readonly Proxy[], tolerance?: number, options?: QueryOptions): ContactGraph {
  const tol = resolveTolerance(proxies, tolerance)
  const linked = link(proxies, tol, sampleCount(options), options?.seed ?? 1)
  return {
    components: linked.groups.map(members => members.map(i => proxies[i]!.id)),
    edges: linked.edges.map(([i, j]) => [proxies[i]!.id, proxies[j]!.id] as [string, string]),
    tolerance: tol,
  }
}

function sampleCount(options: QueryOptions | undefined): number {
  const n = options?.samples
  return n !== undefined && Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_SAMPLES
}

/**
 * Detached groups of parts: components of the contact graph that are not connected to any base part and whose span is
 * at least `minSpanFraction` of the model span. With no (known) base id, the component with the largest span is the base.
 */
export function floaters(proxies: readonly Proxy[], baseIds: readonly string[] = [], options: FloaterOptions = {}): Floater[] {
  const count = proxies.length
  if (count === 0) return []
  const minSpanFraction = options.minSpanFraction !== undefined && options.minSpanFraction >= 0 ? options.minSpanFraction : 0.01
  const tol = resolveTolerance(proxies, options.tolerance)
  const { prepared, group, groups } = link(proxies, tol, sampleCount(options), options.seed ?? 1)
  const modelSpan = span(proxies)
  const spans = groups.map(members => span(members.map(i => proxies[i]!)))

  const isBase = new Array<boolean>(groups.length).fill(false)
  const wanted = new Set(baseIds)
  let anyBase = false
  for (let i = 0; i < count; i++) if (wanted.has(proxies[i]!.id)) { isBase[group[i]!] = true; anyBase = true }
  if (!anyBase) {
    let largest = 0
    for (let g = 1; g < groups.length; g++) if (spans[g]! > spans[largest]!) largest = g
    isBase[largest] = true
  }

  const out: Floater[] = []
  const pairOptions: QueryOptions = { samples: sampleCount(options), seed: options.seed ?? 1 }
  for (let g = 0; g < groups.length; g++) {
    if (isBase[g]) continue
    const groupSpan = spans[g]!
    const fraction = modelSpan > 0 ? groupSpan / modelSpan : 0
    if (fraction < minSpanFraction) continue
    const members = groups[g]!
    // candidate (member, outsider) pairs ordered by the distance between their bounding boxes (a lower bound)
    const candidates: { from: number; to: number; bound: number }[] = []
    for (const i of members) {
      for (let j = 0; j < count; j++) {
        if (group[j] === g) continue
        candidates.push({ from: i, to: j, bound: boundsGap(prepared[i]!, prepared[j]!) })
      }
    }
    candidates.sort((p, q) => p.bound - q.bound || p.from - q.from || p.to - q.to)
    let best = Infinity, fromId: string | null = null, nearestId: string | null = null
    const direction: Vec3 = [0, 0, 0]
    for (const candidate of candidates) {
      if (candidate.bound >= best) break
      const hit = nearest(proxies[candidate.from]!, proxies[candidate.to]!, pairOptions)
      if (hit.distance < best) {
        best = hit.distance
        fromId = proxies[candidate.from]!.id; nearestId = proxies[candidate.to]!.id
        const dx = hit.pointB[0] - hit.pointA[0], dy = hit.pointB[1] - hit.pointA[1], dz = hit.pointB[2] - hit.pointA[2]
        const len = Math.hypot(dx, dy, dz)
        if (len > 0) { direction[0] = dx / len; direction[1] = dy / len; direction[2] = dz / len }
      }
    }
    out.push({
      ids: members.map(i => proxies[i]!.id), span: groupSpan, spanFraction: fraction,
      fromId, nearestId, distance: best === Infinity ? Infinity : Math.max(0, best), direction,
    })
  }
  return out
}

/** Names the dominant axis of a direction, e.g. `[0, -0.9, 0.1]` -> "-Y" (for messages like "0.42 units away along -Y"). */
export function axisLabel(direction: Vec3): '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z' {
  const ax = Math.abs(direction[0]), ay = Math.abs(direction[1]), az = Math.abs(direction[2])
  if (ax >= ay && ax >= az) return direction[0] < 0 ? '-X' : '+X'
  if (ay >= az) return direction[1] < 0 ? '-Y' : '+Y'
  return direction[2] < 0 ? '-Z' : '+Z'
}
