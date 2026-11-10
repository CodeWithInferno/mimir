// More 2D kinds (pure side): ellipse, dot, polyline, polygon, path, arc, brace. Every one gives its outline in the
// path format of src/lib/path, and everything else follows from it: the box, the anchors, where arrows stop,
// m.pointAt, morphs, and the drawing itself (the backends in ./shapes.chunk.ts draw the outline).
import {
  boxOf, defineKind, emptyBox, expand, isAnchorRef, isNode, toVec3,
  type Box3, type Frame, type Handle, type MNode, type Resolved, type Schema, type Vec3,
} from '../core/index.ts'
import { arcPath, bounds as pathBounds, ellipsePath, parsePath, polygonPath, polylinePath, validatePath, type Subpath } from '../lib/path/index.ts'
import { STYLE } from './kinds.ts'

/** Name of the lazy chunk that draws these kinds (dist/mimir.shapes.js). */
export const SHAPES_CHUNK = 'shapes'

/** The box of a path (local coordinates); a point at the origin when the path is empty. */
export function boxOfPath(path: Subpath[]): Box3 {
  if (!path.length) return boxOf(0, 0, 0)
  const r = pathBounds(path)
  if (![r.x, r.y, r.width, r.height].every(Number.isFinite)) return boxOf(0, 0, 0)
  return { min: [r.x, r.y, 0], max: [r.x + r.width, r.y + r.height, 0] }
}
const xy = (points: unknown): [number, number][] => (Array.isArray(points) ? points : []).map((p) => { const v = toVec3(p) ?? [0, 0, 0]; return [v[0], v[1]] })

// ── ellipse ──────────────────────────────────────────────────────────────────────────────────────────
export const ellipse = defineKind({
  name: 'ellipse', space: '2d', chunk: SHAPES_CHUNK,
  aliases: { rx: 'radiusX', ry: 'radiusY' },
  schema: { radiusX: { type: 'positive', default: 1, example: 'radiusX: 1.5' }, radiusY: { type: 'positive', default: 0.6, example: 'radiusY: 0.8' }, ...STYLE },
  bounds: (_n, r) => boxOf(r.radiusX, r.radiusY, 0),
  outline: (_n, r) => ellipsePath({ rx: r.radiusX, ry: r.radiusY }),
})

// ── dot ──────────────────────────────────────────────────────────────────────────────────────────────
/** radius of a dot in frame units (manim: 0.08) */
export const DOT_RADIUS = 0.08
const dotKind = defineKind({
  name: 'dot', space: '2d', chunk: SHAPES_CHUNK,
  schema: {
    radius: { type: 'positive', default: DOT_RADIUS },
    color: { type: 'color', default: '#FFFFFF' },
    stroke: { type: 'color', nullable: true, default: null, example: 'stroke: BLACK' },
    strokeWidth: { type: 'nonneg', default: 2 },
  },
  bounds: (_n, r) => boxOf(r.radius, r.radius, 0),
  outline: (_n, r) => ellipsePath({ rx: r.radius, ry: r.radius }),
})
const isPointLike = (v: unknown): boolean => Array.isArray(v) || isNode(v) || isAnchorRef(v) || typeof v === 'function' || typeof v === 'string'
/** dot(), dot(point), dot(point, options), dot(options): a small filled disc; with a point it sits there and follows it. */
export function dot(...args: unknown[]): Handle {
  if (args.length && isPointLike(args[0])) {
    const d = args.length > 1 ? dotKind(args[1]) : dotKind()
    return d.at(args[0])
  }
  return dotKind(...args)
}

// ── polyline, polygon ────────────────────────────────────────────────────────────────────────────────
const POINTS: Schema = { points: { type: { array: 'point', min: 2 }, example: 'points: [[0, 0], [1, 0], [1, 1]]' }, ...STYLE }
export const polyline = defineKind({
  name: 'polyline', space: '2d', chunk: SHAPES_CHUNK, positional: ['points'], required: ['points'],
  schema: POINTS,
  bounds: (_n, r) => boxOfPath(polylinePath(xy(r.points))),
  outline: (_n, r) => polylinePath(xy(r.points)),
})
export const polygon = defineKind({
  name: 'polygon', space: '2d', chunk: SHAPES_CHUNK, positional: ['points'], required: ['points'],
  schema: { ...POINTS, points: { type: { array: 'point', min: 3 }, example: 'points: [[0, 0], [1, 0], [0.5, 1]]' } },
  bounds: (_n, r) => boxOfPath(polygonPath(xy(r.points))),
  outline: (_n, r) => polygonPath(xy(r.points)),
})

// ── path ─────────────────────────────────────────────────────────────────────────────────────────────
/** Parsed path strings by (text, yDown): a path is parsed once, however many frames draw it. */
const parsed = new Map<string, Subpath[]>()
/** Number of parsed path strings kept (a path whose string changes every frame must not grow the cache without end). */
export const PATH_CACHE_SIZE = 500
export function pathOf(d: unknown, yDown: unknown): Subpath[] {
  if (typeof d !== 'string' || !d) return []
  const key = (yDown ? '1' : '0') + d
  let p = parsed.get(key)
  if (!p) {
    p = parsePath(d)
    // an SVG file has y pointing down; the frame has it pointing up
    if (yDown) p = p.map((s) => ({ closed: s.closed, coords: s.coords.map((v, i) => (i % 2 ? -v : v)) }))
    if (parsed.size >= PATH_CACHE_SIZE) parsed.clear()
    parsed.set(key, p)
  }
  return p
}
export const path = defineKind({
  name: 'path', space: '2d', chunk: SHAPES_CHUNK, positional: ['d'], required: ['d'],
  schema: { d: { type: 'string', example: "path('M 0 0 C 1 2, 3 2, 4 0')" }, yDown: { type: 'boolean', default: false, dynamic: false }, ...STYLE },
  bounds: (_n, r) => boxOfPath(pathOf(r.d, r.yDown)),
  outline: (_n, r) => pathOf(r.d, r.yDown),
  init(node, model) {
    const d = node.props.d
    if (typeof d !== 'string') return
    const why = validatePath(d)
    if (why) { node.invalid = true; model.diagnostics.add({ code: 'API-TYPE', ids: [node.id], what: `path(): the path data cannot be read (${why}).`, fix: ["write it like an SVG path, in frame units with y up: path('M 0 0 L 2 0 L 1 1.5 Z')"] }, node.src) }
  },
})

// ── arc ──────────────────────────────────────────────────────────────────────────────────────────────
export const arc = defineKind({
  name: 'arc', space: '2d', chunk: SHAPES_CHUNK,
  schema: { radius: { type: 'positive', default: 1 }, from: { type: 'number', default: 0, example: 'from: 0' }, to: { type: 'number', default: 90, example: 'to: 90' }, ...STYLE },
  bounds: (_n, r) => boxOfPath(arcPath({ radius: r.radius, from: r.from, to: r.to })),
  outline: (_n, r) => arcPath({ radius: r.radius, from: r.from, to: r.to }),
})

// ── brace ────────────────────────────────────────────────────────────────────────────────────────────
/** Shape of a brace, in frame units. */
export const BRACE = {
  /** space between the object and the brace (manim: 0.2) */
  gap: 0.12,
  /** how far the brace reaches out from its arms to its tip */
  depth: 0.26,
  /** thickness of the arms at their thickest */
  weight: 0.034,
  /** length of the curl at each end, as a multiple of the depth (less when the brace is short) */
  curl: 1.0,
  /** half the width of the pointed middle, as a multiple of the depth (less when the brace is short) */
  cusp: 1.5,
}
const SIDES: Record<string, { along: Vec3; out: Vec3 }> = {
  down: { along: [1, 0, 0], out: [0, -1, 0] }, up: { along: [1, 0, 0], out: [0, 1, 0] },
  left: { along: [0, 1, 0], out: [-1, 0, 0] }, right: { along: [0, 1, 0], out: [1, 0, 0] },
}
/**
 * A curly brace along the x axis from -length/2 to +length/2, opening towards +y and pointing towards -y:
 * the ends are at y = 0, the tip at y = -depth. One closed outline: thin at the ends and at the tip, `weight` thick
 * along the arms, like the brace of a typeset formula.
 */
export function bracePath(length: number, depth: number, weight: number): Subpath[] {
  const L = Math.max(length, 1e-6) / 2
  const d = Math.max(depth, 1e-6)
  const e = Math.min(d * BRACE.curl, L * 0.4) // length of the curl at each end
  const m = Math.min(d * BRACE.cusp, L * 0.5) // half the width of the pointed middle
  const t = Math.min(weight, d * 0.45) / 2
  const mid = -d / 2
  const c: number[] = []
  const move = (x: number, y: number): void => { c.push(x, y) }
  const curve = (x1: number, y1: number, x2: number, y2: number, x: number, y: number): void => { c.push(x1, y1, x2, y2, x, y) }
  const line = (x: number, y: number): void => { const x0 = c[c.length - 2]!, y0 = c[c.length - 1]!; c.push(x0 + (x - x0) / 3, y0 + (y - y0) / 3, x0 + ((x - x0) * 2) / 3, y0 + ((y - y0) * 2) / 3, x, y) }
  // the outer edge (nearer the tip), left end → tip → right end …
  const o = mid - t
  move(-L, 0)
  curve(-L, o * 0.8, -L + e * 0.3, o, -L + e, o)
  line(-m, o)
  curve(-m * 0.45, o, -m * 0.08, o - (d + o) * 0.2, 0, -d)
  curve(m * 0.08, o - (d + o) * 0.2, m * 0.45, o, m, o)
  line(L - e, o)
  curve(L - e * 0.3, o, L, o * 0.8, L, 0)
  // … and back along the inner edge (nearer the object)
  const i = mid + t
  const notch = -d + Math.min(5 * t, d * 0.45)
  curve(L, i * 0.5, L - e * 0.45, i, L - e, i)
  line(m, i)
  curve(m * 0.5, i, m * 0.1, i + (notch - i) * 0.25, 0, notch)
  curve(-m * 0.1, i + (notch - i) * 0.25, -m * 0.5, i, -m, i)
  line(-L + e, i)
  curve(-L + e * 0.45, i, -L, i * 0.5, -L, 0)
  return [{ coords: c, closed: true }]
}
interface BraceFrame { path: Subpath[]; tip: Vec3; center: Vec3 }
function braceGeometry(node: MNode, r: Resolved, frame: Frame): BraceFrame {
  return frame.memo('brace' + node.uid, () => {
    const side = SIDES[r.direction as string] ?? SIDES.down!
    const target = r.target as MNode | undefined
    // a brace hugs the box of its target; without one (a bad call) it sits at the origin, one unit long
    const b: Box3 = isNode(target) ? frame.boxIn(node, target) : { min: [-0.5, 0, 0], max: [0.5, 0, 0] }
    const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2
    const hx = (b.max[0] - b.min[0]) / 2, hy = (b.max[1] - b.min[1]) / 2
    const horizontal = side.along[0] !== 0
    const length = 2 * (horizontal ? hx : hy)
    const reach = (horizontal ? hy : hx) + (typeof r.gap === 'number' ? r.gap : BRACE.gap)
    const depth = typeof r.depth === 'number' ? r.depth : BRACE.depth
    const local = bracePath(length, depth, BRACE.weight)
    // local (x along the brace, −y towards the tip) → frame: x·along − y·out, moved out to the edge of the box
    const ox = cx + side.out[0] * reach, oy = cy + side.out[1] * reach
    const map = (x: number, y: number): [number, number] => [ox + x * side.along[0] - y * side.out[0], oy + x * side.along[1] - y * side.out[1]]
    const path = local.map((s) => {
      const coords = new Array<number>(s.coords.length)
      for (let k = 0; k + 1 < s.coords.length; k += 2) { const p = map(s.coords[k]!, s.coords[k + 1]!); coords[k] = p[0]; coords[k + 1] = p[1] }
      return { coords, closed: s.closed }
    })
    const tip = map(0, -depth), mid = map(0, -depth / 2)
    return { path, tip: [tip[0], tip[1], 0], center: [mid[0], mid[1], 0] }
  }, { path: [], tip: [0, 0, 0], center: [0, 0, 0] })
}
export const brace = defineKind({
  name: 'brace', space: '2d', chunk: SHAPES_CHUNK, positional: ['target', 'direction'], required: ['target'], worldGeometry: true,
  aliases: { dir: 'direction' },
  schema: {
    target: { type: 'node', example: 'brace(box)' },
    direction: { type: ['down', 'up', 'left', 'right'], default: 'down', dynamic: false, example: "brace(box, 'up')" },
    gap: { type: 'nonneg', default: BRACE.gap },
    depth: { type: 'positive', default: BRACE.depth },
    color: { type: 'color', default: '#FFFFFF' },
  },
  bounds: (node, r, frame) => { const g = braceGeometry(node, r, frame); const box = emptyBox(); for (const s of g.path) for (let k = 0; k + 1 < s.coords.length; k += 2) expand(box, [s.coords[k]!, s.coords[k + 1]!, 0]); return g.path.length ? box : boxOf(0, 0, 0) },
  anchors: (node, r, frame) => { const g = braceGeometry(node, r, frame); return { tip: g.tip, center: g.center } },
  outline: (node, r, frame) => braceGeometry(node, r, frame).path,
})
