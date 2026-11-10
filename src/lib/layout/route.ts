/**
 * Internals shared by the graph, tree and force layouts: option readers, the route builder and the final
 * mapping to x/y. Not re-exported from index.ts.
 * A route is kept twice: `curve` holds cubic Bezier control points (1 + 3k of them) for exact drawing, and
 * `points` holds the same line sampled into a polyline for measuring, hit tests and moving tokens.
 */
import type { Vec2 } from '../types.ts'
import type { EdgeRoute, GraphLayout, NodePosition } from './graph.ts'

/** Reads a finite option that must not be negative, or falls back. */
export function positiveOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/** Reads a size; missing, negative or non-finite sizes count as 0. */
export function sizeOr0(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** A route under construction. `lineFrom` is the index in `points` where the trailing straight run starts. */
export interface Route { points: Vec2[]; curve: Vec2[]; lineFrom: number }

/** Polyline samples per curved segment. */
export const CURVE_SAMPLES = 16

/** Starts a route at (x, y). */
export function routeStart(x: number, y: number): Route {
  return { points: [[x, y]], curve: [[x, y]], lineFrom: -1 }
}

/** Adds a straight piece; a piece that continues the previous straight piece is merged into it. */
export function routeLine(route: Route, x: number, y: number): void {
  const { points, curve } = route
  const last = points[points.length - 1]!
  const dx = x - last[0], dy = y - last[1]
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return
  if (route.lineFrom >= 0 && route.lineFrom === points.length - 2) {
    const from = points[route.lineFrom]!
    const px = last[0] - from[0], py = last[1] - from[1]
    const cross = px * dy - py * dx, dot = px * dx + py * dy
    if (dot > 0 && Math.abs(cross) <= 1e-9 * (Math.abs(dot) + 1e-12)) {
      last[0] = x; last[1] = y
      const n = curve.length
      curve[n - 3] = [from[0] + (x - from[0]) / 3, from[1] + (y - from[1]) / 3]
      curve[n - 2] = [from[0] + (x - from[0]) * 2 / 3, from[1] + (y - from[1]) * 2 / 3]
      curve[n - 1] = [x, y]
      return
    }
  }
  route.lineFrom = points.length - 1
  curve.push([last[0] + dx / 3, last[1] + dy / 3], [last[0] + dx * 2 / 3, last[1] + dy * 2 / 3], [x, y])
  points.push([x, y])
}

/** Adds a cubic Bezier piece with control points (ax, ay) and (bx, by), ending at (x, y). */
export function routeCurve(route: Route, ax: number, ay: number, bx: number, by: number, x: number, y: number): void {
  const { points, curve } = route
  const last = points[points.length - 1]!
  const x0 = last[0], y0 = last[1]
  curve.push([ax, ay], [bx, by], [x, y])
  for (let i = 1; i <= CURVE_SAMPLES; i++) {
    const t = i / CURVE_SAMPLES, s = 1 - t
    const w0 = s * s * s, w1 = 3 * s * s * t, w2 = 3 * s * t * t, w3 = t * t * t
    points.push(i === CURVE_SAMPLES ? [x, y] : [w0 * x0 + w1 * ax + w2 * bx + w3 * x, w0 * y0 + w1 * ay + w2 * by + w3 * y])
  }
  route.lineFrom = -1
}

/** Point where the straight line from the centre of a box towards (tx, ty) leaves the box. */
export function borderPoint(cx: number, cy: number, width: number, height: number, tx: number, ty: number): Vec2 {
  const dx = tx - cx, dy = ty - cy
  if (dx === 0 && dy === 0) return [cx, cy]
  const kx = dx !== 0 ? (width / 2) / Math.abs(dx) : Infinity
  const ky = dy !== 0 ? (height / 2) / Math.abs(dy) : Infinity
  const k = Math.min(kx, ky, 1)
  return [cx + dx * k, cy + dy * k]
}

/** What finishLayout needs: node centres and sizes on the (along, across) axes plus the routes. */
export interface LayoutParts {
  ids: string[]
  along: ArrayLike<number>
  across: ArrayLike<number>
  depth: ArrayLike<number>
  breadth: ArrayLike<number>
  routes: (Route | null)[]
  edges: readonly ({ from: string; to: string } | undefined)[]
  reversed?: ArrayLike<number>
  down: boolean
  yDown: boolean
  crossings: number
}

/** Maps (along the flow, across the flow) to x/y, centres the drawing on the origin and packs the result. */
export function finishLayout(parts: LayoutParts): GraphLayout {
  const { ids, along, across, depth, breadth, routes, edges, reversed, down } = parts
  const n = ids.length, m = edges.length
  const flip = parts.yDown ? 1 : -1
  const toX = (c: number, o: number): number => (down ? o : c)
  const toY = (c: number, o: number): number => flip * (down ? c : o)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const cx = new Float64Array(n), cy = new Float64Array(n)
  for (let v = 0; v < n; v++) {
    const c = along[v]!, o = across[v]!
    cx[v] = toX(c, o); cy[v] = toY(c, o)
    const w = down ? breadth[v]! : depth[v]!, h = down ? depth[v]! : breadth[v]!
    x0 = Math.min(x0, cx[v]! - w / 2); x1 = Math.max(x1, cx[v]! + w / 2)
    y0 = Math.min(y0, cy[v]! - h / 2); y1 = Math.max(y1, cy[v]! + h / 2)
  }
  for (const route of routes) {
    if (!route) continue
    for (const p of route.points) {
      const c = p[0], o = p[1]
      p[0] = toX(c, o); p[1] = toY(c, o)
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1])
    }
    for (const p of route.curve) { const c = p[0], o = p[1]; p[0] = toX(c, o); p[1] = toY(c, o) }
  }
  if (n === 0) { x0 = 0; x1 = 0; y0 = 0; y1 = 0 }
  const midX = (x0 + x1) / 2, midY = (y0 + y1) / 2
  const nodes: Record<string, NodePosition> = {}
  for (let v = 0; v < n; v++) nodes[ids[v]!] = { x: cx[v]! - midX, y: cy[v]! - midY }
  const routed: EdgeRoute[] = new Array(m)
  for (let e = 0; e < m; e++) {
    const route = routes[e], edge = edges[e]
    if (route) {
      for (const p of route.points) { p[0] -= midX; p[1] -= midY }
      for (const p of route.curve) { p[0] -= midX; p[1] -= midY }
    }
    routed[e] = {
      from: String(edge?.from), to: String(edge?.to),
      points: route ? route.points : [], curve: route ? route.curve : [],
      reversed: reversed ? reversed[e] === 1 : false,
    }
  }
  return { nodes, edges: routed, width: x1 - x0, height: y1 - y0, crossings: parts.crossings }
}
