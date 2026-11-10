// 2D kinds (pure side): schema, anchors, bounds. Frame space: 14.222 × 8, origin centre, y up.
import {
  anchorRef, boxOf, clamp01, constructorOf, currentModel, defineGetter, defineKind, defineMethod, defineSetter, emOf, expand, emptyBox,
  isAnchorRef, isColor, isNode, kindOf, lerp3, spaceOf, TEXT_SIZES, toVec3, type Box3, type Frame, type Handle, type MNode, type Patch, type Resolved, type Schema, type Vec3,
} from '../core/index.ts'
import { circlePath, flattenPath, measurePath, pointAt as pathPointAt, rectPath, type Subpath } from '../lib/path/index.ts'
import { faceOf, FONT_CHUNK, FONTS, lineMetrics, type Face, type LineMetrics } from './type.ts'

/** user units per frame unit in the SVG (also: stroke width 1 = 0.01 frame units, as in manim) */
export const K = 100
/** distance between the baselines of a multi-line text, in em */
export const LINE_HEIGHT = 1.25
/** height of the box of one line of text, in em (cap height 0.68 plus room for ascenders and descenders) */
export const TEXT_BOX_EM = 0.9
/** width of the black outline behind every text, in stroke units (manim's backstroke; 0 = none) */
export const BACKSTROKE = 5
export { FONTS }

/** The standard style options of a 2D shape (what `c.paint(el, r, node)` draws from): spread it into a kind's schema. */
export const STYLE: Schema = {
  color: { type: 'color', default: '#FFFFFF' },
  fill: { type: 'color', nullable: true, default: null, example: 'fill: BLUE' },
  fillOpacity: { type: 'unit', default: 1 },
  stroke: { type: 'color', nullable: true, default: null, example: 'stroke: WHITE' },
  strokeWidth: { type: 'nonneg', default: 2 },
  dashed: { type: 'boolean', default: false },
}

// ── text ─────────────────────────────────────────────────────────────────────────────────────────────
export interface TextLayout {
  lines: string[]
  /** em in frame units at a 2D zoom of 1 */
  em: number
  /** box in frame units at a 2D zoom of 1 */
  width: number
  height: number
  face: Face
  /** width (em) and kerning of every line */
  metrics: LineMetrics[]
  align: 'center' | 'left' | 'right'
}
export function layoutText(r: Resolved): TextLayout {
  const em = emOf(typeof r.size === 'number' && r.size > 0 ? r.size : 48)
  const face = faceOf(r.font, r.weight, r.italic)
  const lines = String(r.text ?? '').split('\n')
  const metrics = lines.map((l) => lineMetrics(l, face))
  const width = Math.max(0, ...metrics.map((m) => m.width)) * em
  const align = r.align === 'left' || r.align === 'right' ? r.align : 'center'
  return { lines, em, width, height: (lines.length - 1) * LINE_HEIGHT * em + TEXT_BOX_EM * em, face, metrics, align }
}
/**
 * How much the 2D camera magnifies a node: text keeps its size on screen, so its box in the 2D world is its natural
 * size divided by this (1 for objects in screen space, and for text that asked to scale with the zoom).
 */
export function textZoom(node: MNode, r: Resolved, frame: Frame): number {
  if (r.scaleWithZoom || spaceOf(node) !== '2d') return 1
  // The 2D camera measures what it is asked to frame in a scratch frame of its own, where nothing is zoomed: there a
  // text has its natural size, and asking for the camera would mean "this object follows the camera" (it does not:
  // only its size does). `mode` is the core's name for that frame.
  if ((frame as unknown as { mode?: string | null }).mode === 'unzoomed') return 1
  const z = frame.camera2d().zoom
  return z > 0 && Number.isFinite(z) ? z : 1
}
export const text = defineKind({
  name: 'text', space: '2d', text: true, positional: ['text'], required: ['text'], chunk: FONT_CHUNK,
  schema: {
    text: { type: 'text', example: "text('piston')" },
    size: { type: 'positive', default: 48, tokens: TEXT_SIZES, example: "size: 'label'" },
    color: { type: 'color', default: '#FFFFFF' },
    weight: { type: ['normal', 'bold'], default: 'normal' },
    italic: { type: 'boolean', default: false },
    font: { type: ['serif', 'math', 'sans', 'mono'], default: 'serif' },
    align: { type: ['center', 'left', 'right'], default: 'center' },
    backstroke: { type: 'nonneg', default: BACKSTROKE, example: 'backstroke: 0' },
    scaleWithZoom: { type: 'boolean', default: false, dynamic: false },
  },
  bounds: (node, r, frame) => { const t = layoutText(r), z = textZoom(node, r, frame); return boxOf(t.width / 2 / z, t.height / 2 / z, 0) },
})

// ── shapes ───────────────────────────────────────────────────────────────────────────────────────────
export const rect = defineKind({
  name: 'rect', space: '2d',
  schema: { width: { type: 'positive', default: 2 }, height: { type: 'positive', default: 1 }, radius: { type: 'nonneg', default: 0 }, ...STYLE },
  bounds: (_n, r) => boxOf(r.width / 2, r.height / 2, 0),
  outline: (_n, r) => rectPath({ width: r.width, height: r.height, radius: r.radius }),
})
export const circle = defineKind({
  name: 'circle', space: '2d',
  schema: { radius: { type: 'positive', default: 0.5 }, ...STYLE },
  bounds: (_n, r) => boxOf(r.radius, r.radius, 0),
  outline: (_n, r) => circlePath({ radius: r.radius }),
})

/**
 * Where the ray from the centre of `target` towards `toward` leaves its OUTLINE (Frame.outline: the kind's outline
 * hook, or its box), pushed out by `buff`. Coordinates are those of `owner` (the line): a target in another space
 * (a 3D part under a 2D arrow) is taken as the rectangle it covers there.
 */
export function exitPoint(owner: MNode, target: MNode, frame: Frame, toward: Vec3, buff: number): Vec3 {
  const b = frame.boxIn(owner, target)
  const c: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, 0]
  const dx = toward[0] - c[0], dy = toward[1] - c[1]
  const l = Math.hypot(dx, dy)
  if (l < 1e-9) return c
  const ux = dx / l, uy = dy / l
  let t = 0
  const same = spaceOf(owner) === spaceOf(target)
  const polys = same ? frame.memo('olf' + target.uid, () => flattenPath(frame.outline(target), 0.004), []) : []
  for (const poly of polys) {
    for (let i = 0; i + 1 < poly.length; i++) {
      // ray c + t·u against the segment p → q
      const p = poly[i]!, q = poly[i + 1]!
      const ex = q[0] - p[0], ey = q[1] - p[1]
      const den = ux * ey - uy * ex
      if (Math.abs(den) < 1e-12) continue
      const k = ((p[0] - c[0]) * ey - (p[1] - c[1]) * ex) / den
      const m = ((p[0] - c[0]) * uy - (p[1] - c[1]) * ux) / den
      if (k > t && m >= -1e-9 && m <= 1 + 1e-9) t = k
    }
  }
  if (t === 0) {
    // no outline was crossed (another space, an open path, an empty container): leave the box instead
    const hx = (b.max[0] - b.min[0]) / 2, hy = (b.max[1] - b.min[1]) / 2
    t = Math.min(Math.abs(ux) > 1e-9 ? hx / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-9 ? hy / Math.abs(uy) : Infinity)
    if (!Number.isFinite(t)) t = 0
  }
  t = Math.min(t + buff, Math.max(0, l - 1e-3))
  return [c[0] + ux * t, c[1] + uy * t, 0]
}
/**
 * End points of a line / arrow in frame space. An end given as an OBJECT stops at that object's edge (plus a small
 * gap); an end given as a point or an anchor (box.right) is used exactly.
 */
export function ends(node: MNode, r: Resolved, frame: Frame): [Vec3, Vec3] {
  let a = r.a as Vec3, b = r.b as Vec3
  const ra = node.props.a, rb = node.props.b
  const free = !node.model.clipsFor(node, 'a') && !node.model.clipsFor(node, 'b')
  const buff = typeof r.buff === 'number' ? r.buff : 0.1
  const a0 = a, b0 = b
  if (free && isNode(ra)) a = exitPoint(node, ra, frame, b0, buff)
  if (free && isNode(rb)) b = exitPoint(node, rb, frame, a0, buff)
  return [a, b]
}
/** Control point of a bent line (quadratic); null when straight. bend = degrees the line turns through. */
export function bendControl(a: Vec3, b: Vec3, bend: number): Vec3 | null {
  if (!bend) return null
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const k = Math.tan((Math.max(-170, Math.min(170, bend)) * Math.PI) / 180 / 4) * 1 // sagitta of the arc / half chord
  return [mx - dy * k, my + dx * k, 0]
}
const lineBounds = (node: MNode, r: Resolved, frame: Frame): Box3 => {
  const [a, b] = ends(node, r, frame)
  const box = emptyBox()
  expand(box, a)
  expand(box, b)
  const c = bendControl(a, b, r.bend ?? 0)
  if (c) expand(box, [(a[0] + 2 * c[0] + b[0]) / 4, (a[1] + 2 * c[1] + b[1]) / 4, 0])
  return box
}
/** Point at fraction alpha (0 = start, 1 = end) of a line / arrow. */
export function pointOnLine(node: MNode, frame: Frame, alpha: number): Vec3 {
  const r = frame.props(node)
  const [a, b] = ends(node, r, frame)
  const c = bendControl(a, b, r.bend ?? 0)
  const u = clamp01(alpha)
  if (!c) return lerp3(a, b, u)
  const v = 1 - u
  return [v * v * a[0] + 2 * v * u * c[0] + u * u * b[0], v * v * a[1] + 2 * v * u * c[1] + u * u * b[1], 0]
}
const lineAnchors = (node: MNode, r: Resolved, frame: Frame): Record<string, Vec3> => {
  const [a, b] = ends(node, r, frame)
  return { start: a, end: b, center: pointOnLine(node, frame, 0.5) }
}
/** a line / arrow as one open path (a bent one is a quadratic, written as the cubic that equals it) */
const lineOutline = (node: MNode, r: Resolved, frame: Frame): Subpath[] => {
  const [a, b] = ends(node, r, frame)
  const c = bendControl(a, b, r.bend ?? 0)
  const c1 = c ? [a[0] + ((c[0] - a[0]) * 2) / 3, a[1] + ((c[1] - a[1]) * 2) / 3] : [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3]
  const c2 = c ? [b[0] + ((c[0] - b[0]) * 2) / 3, b[1] + ((c[1] - b[1]) * 2) / 3] : [a[0] + ((b[0] - a[0]) * 2) / 3, a[1] + ((b[1] - a[1]) * 2) / 3]
  return [{ coords: [a[0], a[1], c1[0]!, c1[1]!, c2[0]!, c2[1]!, b[0], b[1]], closed: false }]
}
const LINE: Schema = {
  a: { type: 'point', example: 'line(boxA, boxB)' }, b: { type: 'point', example: 'line(boxA, boxB)' },
  bend: { type: 'number', default: 0, example: 'bend: 30' }, buff: { type: 'nonneg', default: 0.1 },
  color: { type: 'color', default: '#FFFFFF' }, strokeWidth: { type: 'nonneg', default: 2 }, dashed: { type: 'boolean', default: false },
}
export const line = defineKind({
  name: 'line', space: '2d', positional: ['a', 'b'], required: ['a', 'b'], worldGeometry: true,
  schema: LINE, bounds: lineBounds, anchors: lineAnchors, outline: lineOutline,
})
export const arrow = defineKind({
  name: 'arrow', space: '2d', positional: ['a', 'b'], required: ['a', 'b'], worldGeometry: true,
  schema: {
    ...LINE, color: { type: 'color', default: '#BBBBBB' }, strokeWidth: { type: 'nonneg', default: 4 }, buff: { type: 'nonneg', default: 0.15 },
    both: { type: 'boolean', default: false, example: 'both: true' },
    head: { type: 'positive', default: 1, example: 'head: 1.5' },
  },
  bounds: lineBounds, anchors: lineAnchors, outline: lineOutline,
})

/** Arrow heads: width = HEAD.base + HEAD.perStroke × the shaft's width (frame units), so thin arrows keep a head that reads. */
export const HEAD = {
  /** frame units added to every head's width */
  base: 0.08,
  /** head width per unit of shaft width (manim: 5 × the shaft at its default thickness) */
  perStroke: 3,
  /** length of a head as a multiple of its width */
  aspect: 1.05,
  /** how far the back of the head is cut in, as a share of its length (0 = a plain triangle) */
  notch: 0.18,
  /** a head never takes more than this share of the arrow's length (half of it when both ends have one) */
  maxShare: 0.45,
}
export interface ArrowShape {
  /** the shaft: start, quadratic control point (null when straight), end; it stops inside the heads */
  a: Vec3; ctrl: Vec3 | null; b: Vec3
  /** each head as three corners and the notch: tip, left, notch, right */
  heads: [Vec3, Vec3, Vec3, Vec3][]
}
/**
 * Geometry of an arrow from a to b in frame units. `upTo` (0..1) draws only the first part of it with the head
 * riding the front (create); `shrink` divides every size that should stay constant on screen (the 2D zoom).
 */
export function arrowShape(a: Vec3, b: Vec3, ctrl: Vec3 | null, o: { strokeWidth: number; head?: number; both?: boolean; upTo?: number; shrink?: number }): ArrowShape {
  const u = clamp01(o.upTo ?? 1)
  if (u < 1) {
    // the first part of a quadratic is a quadratic: a, lerp(a, ctrl, u), point(u)
    const end: Vec3 = ctrl ? [(1 - u) * (1 - u) * a[0] + 2 * (1 - u) * u * ctrl[0] + u * u * b[0], (1 - u) * (1 - u) * a[1] + 2 * (1 - u) * u * ctrl[1] + u * u * b[1], 0] : lerp3(a, b, u)
    if (ctrl) ctrl = lerp3(a, ctrl, u)
    b = end
  }
  const k = o.shrink && o.shrink > 0 ? o.shrink : 1
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1])
  const width = ((HEAD.base + HEAD.perStroke * o.strokeWidth * 0.01) * (o.head ?? 1)) / k
  const length = Math.min(width * HEAD.aspect, chord * (o.both ? HEAD.maxShare / 2 : HEAD.maxShare))
  const half = (length / HEAD.aspect) / 2
  const heads: ArrowShape['heads'] = []
  const headAt = (tip: Vec3, from: Vec3): Vec3 => {
    let dx = tip[0] - from[0], dy = tip[1] - from[1]
    const l = Math.hypot(dx, dy) || 1
    dx /= l; dy /= l
    const base: Vec3 = [tip[0] - dx * length, tip[1] - dy * length, 0]
    const notch: Vec3 = [tip[0] - dx * length * (1 - HEAD.notch), tip[1] - dy * length * (1 - HEAD.notch), 0]
    heads.push([tip, [base[0] - dy * half, base[1] + dx * half, 0], notch, [base[0] + dy * half, base[1] - dx * half, 0]])
    return notch
  }
  if (length <= 1e-6) return { a, ctrl, b, heads }
  const end = headAt(b, ctrl ?? a)
  const start = o.both ? headAt(a, ctrl ?? b) : a
  return { a: start, ctrl, b: end, heads }
}

// ── containers ───────────────────────────────────────────────────────────────────────────────────────
const adoptAll = (node: MNode): MNode[] => {
  const kids = (node.props.children as MNode[] | undefined) ?? []
  delete node.props.children
  for (const c of kids) node.model.adopt(node, c)
  return kids
}
/**
 * The members a group may take: a PART of another object (a curve of its axes) stays inside the object it belongs to,
 * which is where it gets its shape from. Grouped together with that object it simply comes along; grouped without it,
 * that is said.
 */
function ownMembers(node: MNode): void {
  const kids = (node.props.children as MNode[] | undefined) ?? []
  const partOf = (c: MNode): MNode | null => (c.parent && kindOf(c.parent.kind)?.container !== true ? c.parent : null)
  const inGroup = (owner: MNode): boolean => { for (let p: MNode | null = owner; p; p = p.parent) if (kids.includes(p)) return true; return false }
  node.props.children = kids.filter((c) => {
    const owner = partOf(c)
    if (!owner) return true
    if (!inGroup(owner)) node.model.diagnostics.add({ code: 'API-TYPE', ids: [c.id, owner.id], what: `group(): #${c.id} is a part of #${owner.id} and stays inside it; a group cannot take it out.`, fix: [`put #${owner.id} in the group: its parts come with it`, `or leave #${c.id} out of the group`] }, node.src)
    return false
  })
}
const group2d = defineKind({
  name: 'group', space: '2d', container: true, positional: ['children'],
  schema: { children: { type: 'nodes', default: [], example: 'group([a, b])' } },
  init: (node) => { ownMembers(node); adoptAll(node) },
})
/** group([a, b, …]) or group(a, b, …): one object that moves, fades and is placed as a unit. 2D or 3D by its children. */
export function group(...args: unknown[]): Handle {
  let list: unknown[] = args
  let opts: unknown
  if (args.length && Array.isArray(args[0])) { list = args[0]; opts = args[1] }
  const first = list.find(isNode)
  const mixed = first && list.some((c) => isNode(c) && c.space !== first.space)
  if (mixed) currentModel().diagnostics.add({ code: 'API-TYPE', what: 'group() got both 2D and 3D objects; a group lives in one space.', fix: ['make one group for the 2D objects and one for the 3D parts'] })
  const ctor = (first?.space === '3d' ? constructorOf('group3d') : undefined) ?? group2d
  const same = first ? list.filter((c) => !isNode(c) || c.space === first.space) : list
  return opts === undefined ? ctor(same) : ctor(same, opts)
}
const flow = (name: 'row' | 'column') =>
  defineKind({
    name, space: '2d', container: true, positional: ['children'],
    schema: {
      children: { type: 'nodes', default: [], example: `${name}([a, b, c], { gap: 1 })` },
      gap: { type: 'nonneg', default: 0.5 },
      align: { type: name === 'row' ? ['center', 'top', 'bottom'] : ['center', 'left', 'right'], default: 'center' },
      layout: { type: ['row', 'column'], default: name, dynamic: false },
    },
    init: (node, model) => {
      const kids = adoptAll(node)
      kids.forEach((c, index) => {
        if (c.placement) model.diagnostics.add({ code: 'PLACE-CONFLICT', ids: [c.id], what: `#${c.id} already has a placement (${c.placement.type}) and is also an item of ${name}(); the ${name} decides where it goes.`, fix: [`remove the .${c.placement.type === 'at' ? 'at' : c.placement.type}() call on #${c.id}`] }, node.src)
        c.placement = { type: 'flow', container: node, index }
      })
    },
  })
export const row = flow('row')
export const column = flow('column')

// ── setters, getters, methods of 2D objects ──────────────────────────────────────────────────────────
const bad = (node: MNode, code: string, what: string, fix: string): null => { node.model.diagnostics.add({ code, ids: [node.id], what, fix: [fix] }); return null }
const okColor = (c: unknown): boolean => typeof c === 'function' || c === null || isColor(c)
defineSetter('2d', 'fill', (node, c: unknown, opacity?: unknown): Patch | null => {
  if (!okColor(c)) return bad(node, typeof c === 'string' ? 'API-UNKNOWN' : 'API-TYPE', `${node.kind}.fill(): ${String(c)} is not a colour.`, '.fill(BLUE, 0.3)')
  if (opacity !== undefined && typeof opacity !== 'function' && !(typeof opacity === 'number' && opacity >= 0 && opacity <= 1)) return bad(node, typeof opacity === 'number' ? 'NUM-INVALID' : 'API-TYPE', `${node.kind}.fill(): opacity must be a number from 0 to 1, got ${String(opacity)}.`, '.fill(BLUE, 0.3)')
  return opacity === undefined ? { fill: c } : { fill: c, fillOpacity: opacity }
})
defineSetter('2d', 'stroke', (node, c: unknown, width?: unknown): Patch | null => {
  if (!okColor(c)) return bad(node, typeof c === 'string' ? 'API-UNKNOWN' : 'API-TYPE', `${node.kind}.stroke(): ${String(c)} is not a colour.`, '.stroke(WHITE, 2)')
  if (width !== undefined && typeof width !== 'function' && !(typeof width === 'number' && width >= 0 && Number.isFinite(width))) return bad(node, typeof width === 'number' ? 'NUM-INVALID' : 'API-TYPE', `${node.kind}.stroke(): width must be a number that is not negative, got ${String(width)}.`, '.stroke(WHITE, 2)')
  return width === undefined ? { stroke: c } : { stroke: c, strokeWidth: width }
})
defineSetter('2d', 'rotate', (node, deg: unknown): Patch | null => {
  if (typeof deg === 'function') return { rotate: deg }
  if (typeof deg !== 'number') return bad(node, 'API-TYPE', `${node.kind}.rotate() expects degrees (a number), got ${typeof deg}.`, '.rotate(45)')
  if (!Number.isFinite(deg)) return bad(node, 'NUM-INVALID', `${node.kind}.rotate(${deg}): the angle must be a finite number of degrees.`, '.rotate(45)')
  return { rotate: deg }
})
for (const name of ['center', 'top', 'bottom', 'left', 'right', 'ul', 'ur', 'dl', 'dr']) defineGetter('2d', name, (node: MNode) => anchorRef(node, name))
// 'start' / 'end' are anchors every 2D object has: the ends of an open outline, the left / right edge otherwise
for (const name of ['start', 'end']) defineGetter('2d', name, (node: MNode) => anchorRef(node, name))
defineGetter('2d', 'width', (node: MNode) => () => { const b = node.model.now().bounds(node); return b.max[0] - b.min[0] })
defineGetter('2d', 'height', (node: MNode) => () => { const b = node.model.now().bounds(node); return b.max[1] - b.min[1] })
/** Point at a share of the length of a node's outline (0 = start, 1 = end), with the direction of travel there in degrees. */
export function pointOnOutline(node: MNode, frame: Frame, alpha: number): { point: Vec3; tangentDeg: number } {
  const m = frame.memo('olm' + node.uid, () => measurePath(frame.outline(node)), null)
  if (!m || !m.subpaths.length) return { point: frame.anchor(node, 'center'), tangentDeg: 0 }
  const p = pathPointAt(m, clamp01(alpha))
  return { point: [p.point[0], p.point[1], 0], tangentDeg: p.tangentDeg }
}
/** m.pointAt(alpha): a live point along the object's outline, by length (0 = start, 1 = end). For a line or an arrow that is along it. */
defineMethod('2d', 'pointAt', (node: MNode, alpha: unknown = 0.5) => {
  const a = typeof alpha === 'function' ? (alpha as () => number) : () => (typeof alpha === 'number' ? alpha : 0.5)
  return () => pointOnOutline(node, node.model.now(), a()).point
})
export { isAnchorRef, toVec3 }
