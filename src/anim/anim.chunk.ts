// src/anim/anim.chunk.ts: the drawing side of the verbs (dist/mimir.anim.js). Loaded only for scenes that use
// transform / derive / flashAround. Two things live here:
//   1. the stand-in of a path morph (kind `animMorph`): the outlines of both ends, the morph plan, the blended style;
//   2. the pulse of flashAround (kind `animFlash`).
// (Write, glyph by glyph, is the text backend's own: WRITE in src/r2d/svg.ts.)
// Everything is a function of the frame being drawn; nothing is remembered from the frame before.
import {
  clamp01, defineKindBackend, defineOverlay, isColor, isNode, mix, smooth, spaceOf, toVec3,
  type Frame, type MNode, type Resolved,
} from '../core/index.ts'
import type { Ctx2D } from '../r2d/index.ts'
import { circlePath, measurePath, morphAt, morphPlan, pointAt, polygonPath, rectPath, type Subpath } from '../lib/path/index.ts'
import { VERB_DEFAULTS } from './index.ts'

// ── paths → SVG ──────────────────────────────────────────────────────────────────────────────────────
const n2 = (x: number): string => String(Math.round(x * 100) / 100)
/** Path data in SVG units (K per frame unit, y down) of a path in frame coordinates (y up). */
export function pathData(path: Subpath[], K: number): string {
  let d = ''
  for (const sp of path) {
    const c = sp.coords
    if (c.length < 2) continue
    d += `M${n2(c[0]! * K)} ${n2(-c[1]! * K)}`
    for (let i = 2; i + 5 < c.length; i += 6) d += `C${n2(c[i]! * K)} ${n2(-c[i + 1]! * K)} ${n2(c[i + 2]! * K)} ${n2(-c[i + 3]! * K)} ${n2(c[i + 4]! * K)} ${n2(-c[i + 5]! * K)}`
    if (sp.closed) d += 'Z'
  }
  return d
}

// ── 1. the morph stand-in ────────────────────────────────────────────────────────────────────────────
/** One end of a morph, in the coordinates the stand-in is drawn in. */
export interface Shape { path: Subpath[]; stroke: string; strokeWidth: number; fill: string | null; fillOpacity: number; opacity: number }

/** Convex hull of 2D points (Andrew's monotone chain), counter-clockwise. */
export function convexHull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop(); lower.push(q) }
  const upper: [number, number][] = []
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]!; while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop(); upper.push(q) }
  lower.pop(); upper.pop()
  return [...lower, ...upper]
}
const dot = (p: readonly number[]): Subpath[] => circlePath({ radius: VERB_DEFAULTS.pointRadius, center: [p[0] ?? 0, p[1] ?? 0] })
const color = (v: unknown, fallback: string): string => (typeof v === 'string' && isColor(v) ? v : fallback)

/**
 * The outline and style of one end of a morph, in the space of `ghost`. An object gives its outline (a 3D part: the
 * hull of where it is drawn); a point gives a dot. `like` = the other end, for what this end does not have (a 3D
 * part has no stroke width, a point has no style at all).
 */
export function shapeOf(ghost: MNode, raw: unknown, resolved: unknown, frame: Frame, like?: Shape): Shape {
  const hud = spaceOf(ghost) === 'hud'
  if (!isNode(raw)) {
    const p = toVec3(resolved) ?? [0, 0, 0]
    return { path: dot(p), stroke: like?.stroke ?? '#FFFFFF', strokeWidth: like?.strokeWidth ?? 2, fill: like?.fill ?? null, fillOpacity: like?.fillOpacity ?? 0, opacity: like?.opacity ?? 1 }
  }
  if (raw.space === '3d') {
    const pts: [number, number][] = []
    for (const q of frame.hull(raw)) { const s = frame.project3(q); if (s.depth > 0) { const v = hud ? [s.x, s.y] : frame.fromScreen([s.x, s.y]); pts.push([v[0]!, v[1]!]) } }
    const hull = convexHull(pts)
    const look = frame.look(raw)
    const path = hull.length >= 3 ? polygonPath(hull) : dot(toVec3(resolved) ?? [0, 0, 0])
    return { path, stroke: color(look.color, '#FFFFFF'), strokeWidth: like?.strokeWidth ?? 2, fill: like?.fill ? color(look.color, '#FFFFFF') : null, fillOpacity: 0, opacity: look.opacity }
  }
  const r = frame.props(raw)
  let path = frame.outline(raw)
  let k = 1
  if (hud && spaceOf(raw) === '2d') {
    // a shape of the 2D world drawn on the screen: through the 2D camera
    k = frame.camera2d().zoom
    path = path.map((sp) => { const out = new Array<number>(sp.coords.length); for (let i = 0; i + 1 < sp.coords.length; i += 2) { const s = frame.toScreen([sp.coords[i]!, sp.coords[i + 1]!]); out[i] = s[0]; out[i + 1] = s[1] } return { coords: out, closed: sp.closed } })
  }
  const fill = typeof r.fill === 'string' && isColor(r.fill) ? r.fill : null
  return {
    path, stroke: color(r.stroke ?? r.color, '#FFFFFF'), strokeWidth: (typeof r.strokeWidth === 'number' ? r.strokeWidth : 2) * k,
    fill, fillOpacity: fill ? (typeof r.fillOpacity === 'number' ? r.fillOpacity : 1) : 0, opacity: frame.opacity(raw),
  }
}
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u
/** The shape between the two ends at the stand-in's progress: path (corners of both ends kept) and blended style. */
export function morphShapeAt(ghost: MNode, r: Resolved, frame: Frame): Shape {
  const to = shapeOf(ghost, ghost.props.to, r.to, frame)
  const from = shapeOf(ghost, ghost.props.from, r.from, frame, to)
  const u = clamp01(r.progress)
  const path = morphAt(morphPlan(from.path, to.path), u, r.pathArc)
  const fill = from.fill || to.fill ? mix(from.fill ?? to.fill!, to.fill ?? from.fill!, u) : null
  const appear = r.appear > 0 ? smooth(clamp01(u / r.appear)) : 1
  return {
    path, stroke: mix(from.stroke, to.stroke, u), strokeWidth: lerp(from.strokeWidth, to.strokeWidth, u),
    fill, fillOpacity: lerp(from.fill ? from.fillOpacity : 0, to.fill ? to.fillOpacity : 0, u), opacity: lerp(from.opacity, to.opacity, u) * appear,
  }
}
defineKindBackend<SVGPathElement, Ctx2D>('animMorph', {
  build: (_node, c) => c.el<SVGPathElement>('path', { 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
  update(el, r, c, node) {
    const s = morphShapeAt(node, r, c.frame)
    c.set(el, {
      d: pathData(s.path, c.K), stroke: s.strokeWidth > 0 ? s.stroke : 'none', 'stroke-width': s.strokeWidth,
      fill: s.fill ?? 'none', 'fill-opacity': s.fill ? s.fillOpacity : null, opacity: s.opacity < 1 ? s.opacity : null,
    })
  },
})

// ── 2. the pulse of flashAround ──────────────────────────────────────────────────────────────────────
/** samples round the box: enough that the swelling stroke reads as a curve */
const FLASH_SAMPLES = 160
/**
 * manim's FlashAround: the stroke width along the outline is a Gaussian window (three sigma on either side = timeWidth
 * of the outline) whose centre runs from before the start to past the end. Returns the outline of the stroke as a
 * polygon, in frame coordinates.
 */
export function flashOutline(box: { min: readonly number[]; max: readonly number[] }, buff: number, strokeWidth: number, timeWidth: number, progress: number): [number, number][] {
  const width = box.max[0]! - box.min[0]! + 2 * buff, height = box.max[1]! - box.min[1]! + 2 * buff
  const m = measurePath(rectPath({ width, height, radius: Math.min(buff, width / 2, height / 2), center: [(box.min[0]! + box.max[0]!) / 2, (box.min[1]! + box.max[1]!) / 2] }))
  const sigma = timeWidth / 6, mu = lerp(-timeWidth / 2, 1 + timeWidth / 2, progress)
  const left: [number, number][] = [], right: [number, number][] = []
  for (let i = 0; i <= FLASH_SAMPLES; i++) {
    const x = i / FLASH_SAMPLES, z = (x - mu) / sigma
    if (Math.abs(z) > 3) continue
    const half = ((strokeWidth / 100) * Math.exp(-0.5 * z * z)) / 2
    const p = pointAt(m, x), a = (p.tangentDeg * Math.PI) / 180
    const nx = -Math.sin(a) * half, ny = Math.cos(a) * half
    left.push([p.point[0] + nx, p.point[1] + ny])
    right.push([p.point[0] - nx, p.point[1] - ny])
  }
  return [...left, ...right.reverse()]
}
defineKindBackend<SVGPathElement, Ctx2D>('animFlash', {
  build: (_node, c) => c.el<SVGPathElement>('path', { stroke: 'none' }),
  update(el, r, c, node) {
    const raw = node.props.target
    const p = toVec3(r.target) ?? [0, 0, 0]
    const box = isNode(raw) ? c.frame.boxIn(node, raw) : { min: p, max: p }
    const poly = flashOutline(box, r.buff, r.strokeWidth, r.timeWidth, clamp01(r.progress))
    c.set(el, { d: poly.length >= 3 ? 'M' + poly.map((q) => `${n2(q[0] * c.K)} ${n2(-q[1] * c.K)}`).join('L') + 'Z' : '', fill: r.color })
  },
})
