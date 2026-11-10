// SVG backends of the diagram kinds: thin outlines that draw on, arrows with small tips, tokens, rings. Part of the
// lazy chunk. Every attribute is a function of the frame; nothing is remembered between frames.
import { clamp01, defineKindBackend, emOf, INVALID_COLOR, smooth, type MNode, type Resolved } from '../core/index.ts'
import { FONT_TEXT, K, type Ctx2D } from '../r2d/index.ts'
import { circlePath, measurePath, pointAt, rectPath, trimPath, type Subpath } from '../lib/path/index.ts'
import { clusterBox, DIAGRAM_DEFAULTS as D, edgeCurve, flashOf, nodeGeom, pointOn, shapeOutline, slotLocal, streamAt, trafficView, type NodeGeom } from './index.ts'

const r2 = (x: number): number => Math.round(x * 100) / 100
/** path data of a path given in frame units, y up */
function pathData(path: Subpath[]): string {
  let out = ''
  for (const sp of path) {
    const c = sp.coords
    if (c.length < 2) continue
    out += `M${r2(c[0]! * K)} ${r2(-c[1]! * K)}`
    for (let i = 2; i + 5 < c.length; i += 6) out += `C${r2(c[i]! * K)} ${r2(-c[i + 1]! * K)} ${r2(c[i + 2]! * K)} ${r2(-c[i + 3]! * K)} ${r2(c[i + 4]! * K)} ${r2(-c[i + 5]! * K)}`
    if (sp.closed) out += 'Z'
  }
  return out
}
const DASH = `${r2(D.dash * K)} ${r2(D.dashGap * K)}`
const QUARTER = 0.5522847498

// ── node ─────────────────────────────────────────────────────────────────────────────────────────────
interface NodeH { g: SVGGElement; body: SVGPathElement; rim: SVGPathElement; slots: SVGCircleElement[]; dots: SVGCircleElement[]; ring: SVGCircleElement; badge: SVGCircleElement; flash: SVGPathElement }
/** the front edge of a cylinder's top: the lower half of its ellipse */
function rimPath(g: NodeGeom): Subpath[] {
  const rx = g.width / 2, ry = D.cylinderCap, top = g.height / 2 - ry
  return [{ coords: [-rx, top, -rx, top - ry * QUARTER, -rx * QUARTER, top - ry, 0, top - ry, rx * QUARTER, top - ry, rx, top - ry * QUARTER, rx, top], closed: false }]
}
/** the outline pushed out by `by` (the ring of a failure flash) */
function swollen(g: NodeGeom, by: number): Subpath[] {
  if (g.shape === 'circle' || g.shape === 'ring') return circlePath({ radius: g.width / 2 + by })
  return rectPath({ width: g.width + 2 * by, height: g.height + 2 * by, radius: Math.max(g.radius, g.shape === 'cylinder' ? D.cylinderCap : 0) + by })
}
defineKindBackend<NodeH, Ctx2D>('node', {
  build(node, c) {
    const g = c.el<SVGGElement>('g')
    const flash = c.el<SVGPathElement>('path', { fill: 'none', 'stroke-linejoin': 'round' })
    const body = c.draw(c.el<SVGPathElement>('path', { 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }), 'stroke')
    const rim = c.draw(c.el<SVGPathElement>('path', { fill: 'none', 'stroke-linecap': 'round' }), 'stroke')
    g.append(flash, body, rim)
    const slots: SVGCircleElement[] = [], dots: SVGCircleElement[] = []
    // the number of slots is fixed when the node is made, so the circles exist from the start and draw on with it
    const count = node.props.shape === 'queue' && typeof node.props.slots === 'number' ? Math.max(1, Math.min(64, Math.round(node.props.slots))) : 0
    for (let k = 0; k < count; k++) slots.push(g.appendChild(c.draw(c.el<SVGCircleElement>('circle', { fill: 'none' }), 'stroke')))
    for (let k = 0; k < count; k++) dots.push(g.appendChild(c.el<SVGCircleElement>('circle')))
    const ring = g.appendChild(c.el<SVGCircleElement>('circle', { fill: 'none', 'stroke-linecap': 'round', transform: 'rotate(-90)' }))
    const badge = g.appendChild(c.el<SVGCircleElement>('circle'))
    return { g, body, rim, slots, dots, ring, badge, flash }
  },
  update(h, r, c, node) {
    const frame = c.frame
    const g = nodeGeom(node, frame)
    // what create() cannot draw on (dots, the ring, the badge) arrives with the enter progress instead
    const shown = smooth(clamp01(frame.reveal(node).p))
    const states = (r.states ?? D.states) as Record<string, string>
    const state = r.down ? 'down' : typeof r.state === 'string' ? r.state : null
    const tint = state && state !== 'idle' ? states[state] ?? D.states[state] ?? null : null
    const stroke = node.invalid ? INVALID_COLOR : tint ?? r.color
    const sw = r.strokeWidth as number
    const dashed = !!r.down || node.invalid
    const ringed = g.shape === 'ring'
    const body = ringed ? circlePath({ radius: Math.max(0.02, g.width / 2 - D.ringGap) }) : shapeOutline(g)
    c.set(h.body, {
      d: pathData(body), stroke: sw > 0 ? stroke : 'none', 'stroke-width': sw, 'stroke-opacity': r.down ? 0.7 : null,
      fill: r.fill ?? 'none', 'fill-opacity': r.fill ? r.fillOpacity : null, 'stroke-dasharray': dashed ? DASH : null, 'data-dashed': dashed ? '1' : null,
    })
    const cyl = g.shape === 'cylinder'
    c.set(h.rim, { d: cyl ? pathData(rimPath(g)) : null, stroke: cyl && sw > 0 ? stroke : 'none', 'stroke-width': sw, 'stroke-opacity': r.down ? 0.7 : null, display: cyl ? null : 'none' })
    const filled = typeof r.filled === 'number' && Number.isFinite(r.filled) ? r.filled : 0
    h.slots.forEach((el, k) => {
      const p = slotLocal(g, k)
      c.set(el, { cx: p[0] * K, cy: -p[1] * K, r: D.slotRadius * K, stroke: D.slotColor, 'stroke-width': D.slotStroke })
      const part = clamp01(filled - k)
      c.set(h.dots[k]!, { cx: p[0] * K, cy: -p[1] * K, r: D.tokenRadius * K * (0.4 + 0.6 * part), fill: r.accent, opacity: part * shown, display: part > 0 ? null : 'none' })
    })
    const progress = ringed && typeof r.progress === 'number' && Number.isFinite(r.progress) ? clamp01(r.progress) : 0
    const circumference = Math.PI * g.width * K
    c.set(h.ring, { r: (g.width / 2) * K, stroke: r.accent, 'stroke-width': D.ringStroke, 'stroke-dasharray': `${r2(progress * circumference)} ${r2(circumference)}`, opacity: shown, display: progress > 0.004 ? null : 'none' })
    // the state badge: a small light just off the upper right corner
    const round = g.shape === 'circle' || ringed ? g.width / 2 : g.radius
    const out = (round + D.badgeGap) * Math.SQRT1_2
    c.set(h.badge, {
      cx: (g.width / 2 - round + out) * K, cy: -(g.height / 2 - round + out) * K, r: D.badgeRadius * K,
      // a ring shows its state with the ring itself
      fill: state ? states[state] ?? D.states[state] ?? D.states.idle : 'none', opacity: shown, display: state && !ringed ? null : 'none',
    })
    const u = flashOf(node, frame)
    if (u === null) c.set(h.flash, { display: 'none' })
    else c.set(h.flash, { display: null, d: pathData(swollen(g, D.flashStart + D.flashReach * (1 - (1 - u) ** 2))), stroke: states.failed ?? D.states.failed, 'stroke-width': 1 + (D.flashStroke - 1) * (1 - u), opacity: Math.min(1, u * 6) * (1 - u) * shown })
  },
})

// ── group box ────────────────────────────────────────────────────────────────────────────────────────
defineKindBackend<SVGPathElement, Ctx2D>('cluster', {
  build: (_node, c) => c.draw(c.el<SVGPathElement>('path', { fill: 'none', 'stroke-linejoin': 'round' }), 'stroke'),
  update(el, r, c, node) {
    const b = clusterBox(node, c.frame)
    const dashed = !!r.dashed || node.invalid
    c.set(el, {
      d: pathData(rectPath({ width: b.max[0] - b.min[0], height: b.max[1] - b.min[1], radius: r.radius, center: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2] })),
      stroke: node.invalid ? INVALID_COLOR : r.color, 'stroke-width': r.strokeWidth, 'stroke-dasharray': dashed ? DASH : null, 'data-dashed': dashed ? '1' : null,
    })
  },
})

// ── timer ────────────────────────────────────────────────────────────────────────────────────────────
defineKindBackend<{ g: SVGGElement; track: SVGCircleElement; arc: SVGCircleElement }, Ctx2D>('timer', {
  build(_node, c) {
    const g = c.el<SVGGElement>('g')
    const track = c.draw(c.el<SVGCircleElement>('circle', { fill: 'none' }), 'stroke')
    const arc = c.el<SVGCircleElement>('circle', { fill: 'none', 'stroke-linecap': 'round', transform: 'rotate(-90)' })
    g.append(track, arc)
    return { g, track, arc }
  },
  update(h, r, c, node) {
    const color = node.invalid ? INVALID_COLOR : r.color
    const progress = typeof r.progress === 'number' && Number.isFinite(r.progress) ? clamp01(r.progress) : 0
    const round = 2 * Math.PI * r.radius * K
    c.set(h.track, { r: r.radius * K, stroke: color, 'stroke-width': r.strokeWidth, 'stroke-opacity': r.track, display: r.track > 0 ? null : 'none' })
    c.set(h.arc, { r: r.radius * K, stroke: color, 'stroke-width': r.strokeWidth, 'stroke-dasharray': `${r2(progress * round)} ${r2(round)}`, opacity: smooth(clamp01(c.frame.reveal(node).p)), display: progress > 0.004 ? null : 'none' })
  },
})

// ── edge ─────────────────────────────────────────────────────────────────────────────────────────────
const tipPoints = (p: readonly number[], deg: number, length: number, half: number): string => {
  const a = (deg * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a)
  const bx = p[0]! - dx * length, by = p[1]! - dy * length
  const pt = (x: number, y: number): string => `${r2(x * K)},${r2(-y * K)}`
  return `${pt(p[0]!, p[1]!)} ${pt(bx - dy * half, by + dx * half)} ${pt(bx + dy * half, by - dx * half)}`
}
defineKindBackend<{ g: SVGGElement; shaft: SVGPathElement; tip: SVGPolygonElement; tail: SVGPolygonElement }, Ctx2D>('edge', {
  build(_node, c) {
    const g = c.el<SVGGElement>('g')
    const shaft = c.draw(c.el<SVGPathElement>('path', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }), 'stroke')
    const tip = c.draw(c.el<SVGPolygonElement>('polygon', { 'stroke-linejoin': 'round' }), 'fill')
    const tail = c.draw(c.el<SVGPolygonElement>('polygon', { 'stroke-linejoin': 'round' }), 'fill')
    g.append(shaft, tip, tail)
    return { g, shaft, tip, tail }
  },
  update(h, r, c, node) {
    const m = measurePath([{ coords: edgeCurve(node, c.frame), closed: false }])
    const L = m.length
    const drawn = typeof r.drawn === 'number' && Number.isFinite(r.drawn) ? clamp01(r.drawn) : 1
    const color = node.invalid ? INVALID_COLOR : r.color
    const sw = r.strokeWidth as number
    if (!(L > 1e-6) || drawn <= 0) { c.set(h.shaft, { d: null }); c.set(h.tip, { display: 'none' }); c.set(h.tail, { display: 'none' }); return }
    // the tip grows with the line's width, never takes more than part of a short edge, and shrinks while the edge is still short
    const length = r.arrow ? Math.min(D.tipLength * Math.sqrt(Math.max(1, sw / D.edgeStroke)), L * 0.4, drawn * L) : 0
    const half = length * (D.tipHalf / D.tipLength)
    const from = r.both && r.arrow ? (length * 0.8) / L : 0, to = drawn - (length * 0.8) / L
    const dashed = !!r.dashed || node.invalid
    c.set(h.shaft, { d: to > from ? pathData(trimPath(m, from, to)) : null, stroke: color, 'stroke-width': sw, 'stroke-dasharray': dashed ? DASH : null, 'data-dashed': dashed ? '1' : null })
    const end = pointAt(m, drawn)
    c.set(h.tip, { display: length > 0 ? null : 'none', points: tipPoints(end.point, end.tangentDeg, length, half), fill: color, stroke: color, 'stroke-width': Math.min(sw, 1) })
    const start = pointAt(m, 0)
    c.set(h.tail, { display: length > 0 && r.both ? null : 'none', points: tipPoints(start.point, start.tangentDeg + 180, length, half), fill: color, stroke: color, 'stroke-width': Math.min(sw, 1) })
  },
})

// ── tokens ───────────────────────────────────────────────────────────────────────────────────────────
defineKindBackend<{ g: SVGGElement; dot: SVGCircleElement; text: SVGTextElement }, Ctx2D>('token', {
  build(_node, c) {
    const g = c.el<SVGGElement>('g')
    const dot = c.el<SVGCircleElement>('circle')
    const text = c.el<SVGTextElement>('text', { 'text-anchor': 'middle', 'font-family': FONT_TEXT })
    g.append(dot, text)
    return { g, dot, text }
  },
  update(h, r, c, node) {
    const p = pointOn(r.on, c.frame, r.at)
    c.set(h.dot, { cx: p[0] * K, cy: -p[1] * K, r: r.radius * K, fill: node.invalid ? INVALID_COLOR : r.color })
    const label = String(r.label ?? '')
    c.set(h.text, { x: p[0] * K, y: -(p[1] + r.radius + D.tokenLabelGap) * K, 'font-size': emOf(r.labelSize) * K, fill: r.labelColor, display: label ? null : 'none' })
    if (h.text.textContent !== label) h.text.textContent = label
  },
})
/** a pool of elements that grows to what a frame needs; what it does not need is hidden */
function pool<T>(c: Ctx2D, list: T[], need: number, make: () => T, root: (item: T) => SVGElement): void {
  while (list.length < need) list.push(make())
  list.forEach((item, i) => c.set(root(item), { display: i < need ? null : 'none' }))
}
defineKindBackend<{ g: SVGGElement; dots: SVGCircleElement[] }, Ctx2D>('tokens', {
  build: (_node, c) => ({ g: c.el<SVGGElement>('g'), dots: [] }),
  update(h, r: Resolved, c, node: MNode) {
    const frame = c.frame
    const m = r.on ? measurePath(frame.outline(r.on as MNode)) : null
    const list = m && m.length > 0 ? streamAt(r, m.length) : []
    pool(c, h.dots, list.length, () => h.g.appendChild(c.el<SVGCircleElement>('circle')), (el) => el)
    list.forEach((s, i) => {
      const p = pointAt(m!, s.u).point
      c.set(h.dots[i]!, { cx: p[0] * K, cy: -p[1] * K, r: r.radius * K, fill: node.invalid ? INVALID_COLOR : r.color, opacity: s.alpha })
    })
  },
})

// ── traffic ──────────────────────────────────────────────────────────────────────────────────────────
interface JobEl { g: SVGGElement; track: SVGCircleElement; arc: SVGCircleElement; dot: SVGCircleElement; core: SVGCircleElement }
defineKindBackend<{ g: SVGGElement; jobs: JobEl[] }, Ctx2D>('traffic', {
  build: (_node, c) => ({ g: c.el<SVGGElement>('g'), jobs: [] }),
  update(h, r, c, node) {
    const list = trafficView(node, c.frame).tokens()
    const radius = (r.radius as number) * K, halo = radius * D.waitRing
    pool(c, h.jobs, list.length, () => {
      const g = h.g.appendChild(c.el<SVGGElement>('g'))
      const track = c.el<SVGCircleElement>('circle', { fill: 'none', 'stroke-opacity': D.waitTrack })
      const arc = c.el<SVGCircleElement>('circle', { fill: 'none', 'stroke-linecap': 'round', transform: 'rotate(-90)' })
      const dot = c.el<SVGCircleElement>('circle')
      const core = c.el<SVGCircleElement>('circle')
      g.append(track, arc, dot, core)
      return { g, track, arc, dot, core }
    }, (job) => job.g)
    list.forEach((t, i) => {
      const el = h.jobs[i]!
      c.set(el.g, { transform: `translate(${r2(t.x * K)} ${r2(-t.y * K)})${Math.abs(t.scale - 1) > 1e-4 ? ` scale(${Math.round(t.scale * 1e4) / 1e4})` : ''}`, opacity: t.alpha < 1 ? t.alpha : null })
      c.set(el.dot, { r: radius, fill: t.color })
      c.set(el.core, { r: radius * D.coreShare, fill: r.failedColor, display: t.core > 0 ? null : 'none' })
      const waiting = t.wait !== null
      const round = 2 * Math.PI * halo
      c.set(el.track, { r: halo, stroke: r.waitColor, 'stroke-width': D.waitStroke, display: waiting ? null : 'none' })
      c.set(el.arc, { r: halo, stroke: r.waitColor, 'stroke-width': D.waitStroke, 'stroke-dasharray': `${r2((t.wait ?? 0) * round)} ${r2(round)}`, display: waiting && (t.wait ?? 0) > 0.004 ? null : 'none' })
    })
  },
})
