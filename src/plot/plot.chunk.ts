// src/plot/plot.chunk.ts: the drawing side of plots, numbers and readouts (dist/mimir.plot.js). Loaded only for
// scenes that use a kind with `chunk: 'plot'`. Every backend draws exactly what the layouts in ./index.ts computed for
// the frame, so the boxes the linter reads are the boxes on screen. Nothing here remembers an earlier frame.
import { clamp01, defineKindBackend, emOf, INVALID_COLOR, smooth, type MNode, type Resolved } from '../core/index.ts'
import { FONT_TEXT, type Ctx2D } from '../r2d/index.ts'
import { ENTER, PLOT } from './defaults.ts'
import {
  badgeLayout, barsOf, engine, guideEnds, layoutOf, matrixOf, numLayout, readoutLayout,
  type AreaGeometry, type BracketGeometry, type CurveGeometry, type DotGeometry, type LineGeometry, type MarkGeometry, type TrailGeometry,
} from './engine.ts'
import { impl } from './index.ts'
import type { PlotText } from './layout.ts'
import { polylineLength, trimPolyline } from './scale.ts'

// the pure side (./index.ts) asks this chunk for every box, text rectangle and geometry from now on
Object.assign(impl, engine)

const K = 100 // SVG user units per frame unit (Ctx2D.K); SVG y points down
/** the baseline sits this share of the font size below the middle of a line: capitals and digits are 0.68 em tall, centred */
const CAP_MIDDLE = 0.34
const r2 = (v: number): number => Math.round(v * 100) / 100
const P = (x: number, y: number): string => `${r2(x * K)} ${r2(-y * K)}`
const dOf = (pts: readonly number[]): string => { let d = ''; for (let i = 0; i + 1 < pts.length; i += 2) d += (i ? 'L' : 'M') + P(pts[i]!, pts[i + 1]!); return d }
/** progress of one stage of an entrance: 0 before `a`, 1 after `b` */
const span = (p: number, a: number, b: number): number => clamp01((p - a) / (b - a))
/** eased progress of a stage given as [start, end] (1 when the object is not entering) */
const stage = (p: number, s: readonly [number, number]): number => (p < 1 ? smooth(span(p, s[0], s[1])) : 1)
/** eased progress of item `k` (0..1 along its row) of a lagged stage */
const lagged = (p: number, start: number, lag: number, len: number, k: number): number => (p < 1 ? smooth(span(p, start + lag * k, start + lag * k + len)) : 1)
/**
 * Enter progress when the object is being drawn on (create / write); 1 when it is simply there or fading (the renderer
 * fades the whole holder). `after`: a part that enters WITH its axes waits for that share of the entrance, so a curve
 * starts once the axes it runs on are there.
 */
const staged = (c: Ctx2D, node: MNode, after = 0): number => {
  const rv = c.frame.reveal(node)
  if (!(rv.p < 1) || rv.mode === 'fade') return 1
  return after > 0 && c.frame.prop<number>(node, 'present') >= 1 ? span(rv.p, after, 1) : rv.p
}
const AFTER_AXES = ENTER.afterAxes
const TABULAR = 'font-variant-numeric:tabular-nums lining-nums'
const DASH = `${r2(PLOT.tieDash * K)} ${r2(PLOT.tieDash * K)}`

/** a <g> that sets the type of everything inside it: Computer Modern, tabular figures */
const group = (c: Ctx2D): SVGGElement => { const g = c.el<SVGGElement>('g', { 'font-family': FONT_TEXT }); g.setAttribute('style', TABULAR); return g }
function grow<T extends SVGElement>(c: Ctx2D, list: T[], n: number, make: () => T): void {
  while (list.length < n) list.push(make())
  for (let i = n; i < list.length; i++) c.set(list[i]!, { display: 'none' })
}
/** one line of text where the layout put it (x = its anchor, y = its middle; the caps are centred on y) */
function setText(c: Ctx2D, el: SVGTextElement, t: PlotText | null, o: { opacity?: number; dx?: number; dy?: number; back?: boolean; color?: string } = {}): void {
  if (!t || !t.text) { c.set(el, { display: 'none' }); return }
  const fs = emOf(t.size) * K
  c.set(el, {
    display: null, x: (t.x + (o.dx ?? 0)) * K, y: -(t.y + (o.dy ?? 0)) * K + CAP_MIDDLE * fs, 'text-anchor': t.anchor, 'font-size': fs, fill: o.color ?? t.color, 'data-fs': fs,
    opacity: o.opacity !== undefined && o.opacity < 1 ? o.opacity : null,
    // a dark rim keeps a number readable where a line passes behind it
    stroke: o.back ? '#000000' : null, 'stroke-width': o.back ? fs * PLOT.backstroke : null, 'stroke-linejoin': o.back ? 'round' : null, 'paint-order': o.back ? 'stroke' : null,
  })
  if (el.textContent !== t.text) el.textContent = t.text
}

// ── axes and number line ─────────────────────────────────────────────────────────────────────────────
interface AxesHandle { g: SVGGElement; grid: SVGPathElement; x: SVGPathElement; y: SVGPathElement; tipX: SVGPolygonElement; tipY: SVGPolygonElement; marks: SVGPathElement[]; texts: SVGTextElement[] }
const axesBackend = {
  build(_node: MNode, c: Ctx2D): AxesHandle {
    const g = group(c)
    const line = (): SVGPathElement => g.appendChild(c.el<SVGPathElement>('path', { fill: 'none', 'stroke-linecap': 'round' }))
    const grid = line(), x = line(), y = line()
    const tipX = g.appendChild(c.el<SVGPolygonElement>('polygon')), tipY = g.appendChild(c.el<SVGPolygonElement>('polygon'))
    return { g, grid, x, y, tipX, tipY, marks: [], texts: [] }
  },
  /**
   * Drawn on (create / write), the parts arrive in order, as in a hand-made animation: the x axis runs out from the
   * corner, the y axis follows, the ticks and their numbers rise into place from left to right, the names last.
   */
  update(h: AxesHandle, r: Resolved, c: Ctx2D, node: MNode): void {
    const L = layoutOf(node, c.frame)
    const p = staged(c, node)
    const color = node.invalid ? INVALID_COLOR : String(r.color)
    const width = r.strokeWidth
    const T = PLOT
    const ux = stage(p, ENTER.xAxis), uy = stage(p, ENTER.yAxis)
    const xEnd = L.xLine[0] + (L.xLine[1] - L.xLine[0]) * ux
    c.set(h.x, { d: `M${P(L.xLine[0], L.axisY)}L${P(xEnd, L.axisY)}`, stroke: color, 'stroke-width': width, opacity: ux > 0 ? null : 0 })
    const tip = (el: SVGPolygonElement, on: boolean, x: number, y: number, dx: number, dy: number, u: number): void => {
      if (!on) { c.set(el, { display: 'none' }); return }
      // the tip rides on the end of its line while the line is drawn
      c.set(el, { display: null, fill: color, opacity: u < 0.25 ? u * 4 : null, points: `${P(x + dx * T.tip, y + dy * T.tip)} ${P(x - dy * T.tipHalf, y + dx * T.tipHalf)} ${P(x + dy * T.tipHalf, y - dx * T.tipHalf)}` })
    }
    tip(h.tipX, L.tips, xEnd, L.axisY, 1, 0, ux)
    if (L.yLine) {
      const yEnd = L.yLine[0] + (L.yLine[1] - L.yLine[0]) * uy
      c.set(h.y, { display: null, d: `M${P(L.axisX, L.yLine[0])}L${P(L.axisX, yEnd)}`, stroke: color, 'stroke-width': width, opacity: uy > 0 ? null : 0 })
      tip(h.tipY, L.tips, L.axisX, yEnd, 0, 1, uy)
    } else { c.set(h.y, { display: 'none' }); c.set(h.tipY, { display: 'none' }) }
    // faint lines at every tick, behind everything
    let grid = ''
    if (r.grid && L.yLine) {
      for (const t of L.xTicks) grid += `M${P(t.at, L.plot.y0)}L${P(t.at, L.plot.y1)}`
      for (const t of L.yTicks) grid += `M${P(L.plot.x0, t.at)}L${P(L.plot.x1, t.at)}`
    }
    c.set(h.grid, { d: grid || null, display: grid ? null : 'none', stroke: T.gridColor, 'stroke-width': T.gridWidth, opacity: p < 1 ? stage(p, ENTER.grid) : null })

    const ticks = [...L.xTicks.map((t) => ({ t, x: true })), ...L.yTicks.map((t) => ({ t, x: false }))]
    const names = [L.xLabel, L.yLabel].filter((t): t is PlotText => !!t)
    grow(c, h.marks, ticks.length, () => h.g.appendChild(c.el<SVGPathElement>('path', { fill: 'none', 'stroke-linecap': 'round' })))
    grow(c, h.texts, ticks.length + names.length, () => h.g.appendChild(c.el<SVGTextElement>('text')))
    const nx = Math.max(1, L.xTicks.length), ny = Math.max(1, L.yTicks.length)
    ticks.forEach(({ t, x }, i) => {
      const k = x ? i / nx : (i - L.xTicks.length) / ny
      const a = lagged(p, ENTER.tickStart, ENTER.tickLag, ENTER.tickSpan, k)
      c.set(h.marks[i]!, {
        display: null, stroke: color, 'stroke-width': width, opacity: a < 1 ? a : null,
        d: x ? `M${P(t.at, L.axisY - T.tickLength)}L${P(t.at, L.axisY + T.tickLength)}` : `M${P(L.axisX - T.tickLength, t.at)}L${P(L.axisX + T.tickLength, t.at)}`,
      })
      // numbers fade in while they rise (x) or slide in (y) into place
      setText(c, h.texts[i]!, t.label, { opacity: a, dx: x ? 0 : -ENTER.tickShift * (1 - a), dy: x ? -ENTER.tickShift * (1 - a) : 0, back: true })
    })
    names.forEach((t, i) => setText(c, h.texts[ticks.length + i]!, t, { opacity: lagged(p, ENTER.labelStart, ENTER.labelLag, ENTER.labelSpan, i), color: node.invalid ? INVALID_COLOR : t.color }))
  },
}
defineKindBackend<AxesHandle, Ctx2D>('axes', axesBackend)
defineKindBackend<AxesHandle, Ctx2D>('numberLine', axesBackend)

// ── curves, areas, trails ────────────────────────────────────────────────────────────────────────────
interface Strokes { g: SVGGElement; paths: SVGPathElement[] }
const strokes = (c: Ctx2D): Strokes => ({ g: c.el<SVGGElement>('g', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }), paths: [] })
/** draw coloured polylines; while the object is drawn on, only the first share `p` of their length */
function setRuns(c: Ctx2D, h: Strokes, runs: readonly { color: string; pts: readonly number[] }[], width: number, dashed: boolean, p: number, invalid: boolean): void {
  grow(c, h.paths, runs.length, () => h.g.appendChild(c.el<SVGPathElement>('path')))
  let left = p < 1 ? runs.reduce((s, run) => s + polylineLength(run.pts), 0) * p : Infinity
  runs.forEach((run, i) => {
    const pts = left === Infinity ? run.pts : trimPolyline(run.pts, left)
    if (left !== Infinity) left = Math.max(0, left - polylineLength(run.pts))
    c.set(h.paths[i]!, { display: pts.length >= 4 ? null : 'none', d: pts.length >= 4 ? dOf(pts) : null, stroke: invalid ? INVALID_COLOR : run.color, 'stroke-width': width, 'stroke-dasharray': dashed || invalid ? `${Math.max(6, width * 3.5)} ${Math.max(5, width * 3)}` : null })
  })
}
defineKindBackend<Strokes, Ctx2D>('plotCurve', {
  build: (_n, c) => strokes(c),
  update(h, r, c, node) { setRuns(c, h, (r.geometry as CurveGeometry | null)?.runs ?? [], r.strokeWidth, !!r.dashed, staged(c, node, AFTER_AXES), node.invalid) },
})
defineKindBackend<Strokes, Ctx2D>('plotTrail', {
  build: (_n, c) => strokes(c),
  update(h, r, c, node) {
    const p = staged(c, node, AFTER_AXES)
    setRuns(c, h, ((r.geometry as TrailGeometry | null)?.lines ?? []).map((pts) => ({ color: String(r.color), pts })), r.strokeWidth, false, 1, node.invalid)
    c.set(h.g, { opacity: p < 1 ? smooth(p) : null })
  },
})
defineKindBackend<SVGPathElement, Ctx2D>('plotArea', {
  build: (_n, c) => c.el<SVGPathElement>('path', { stroke: 'none' }),
  update(el, r, c, node) {
    const p = staged(c, node, AFTER_AXES)
    const d = ((r.geometry as AreaGeometry | null)?.polys ?? []).map((pts) => dOf(pts) + 'Z').join('')
    c.set(el, { d: d || null, display: d ? null : 'none', fill: node.invalid ? INVALID_COLOR : r.color, 'fill-opacity': r.fillOpacity * (p < 1 ? smooth(p) : 1) })
  },
})

// ── dots, lines, marks, brackets ─────────────────────────────────────────────────────────────────────
defineKindBackend<SVGCircleElement, Ctx2D>('plotDot', {
  build: (_n, c) => c.draw(c.el<SVGCircleElement>('circle', { stroke: '#000000', 'stroke-width': PLOT.dotRim * 2, 'paint-order': 'stroke' }), 'fill'),
  update(el, r, c, node) {
    const g = r.geometry as DotGeometry | null
    c.set(el, { display: g?.shown ? null : 'none', cx: (g?.x ?? 0) * K, cy: -(g?.y ?? 0) * K, r: r.radius * K, fill: node.invalid ? INVALID_COLOR : r.color })
  },
})
/** a thin tie: dashed lines fade in (a dash pattern cannot be drawn on), solid ones are drawn */
function setTie(c: Ctx2D, el: SVGPathElement, d: string | null, r: Resolved, invalid: boolean): void {
  const dashed = !!r.dashed
  c.set(el, { display: d ? null : 'none', d, fill: 'none', stroke: invalid ? INVALID_COLOR : r.color, 'stroke-width': r.strokeWidth, 'stroke-dasharray': dashed ? DASH : null, 'stroke-linecap': dashed ? 'butt' : 'round', 'data-dashed': dashed ? '1' : null })
}
defineKindBackend<SVGPathElement, Ctx2D>('plotLine', {
  build: (_n, c) => c.el<SVGPathElement>('path'),
  update(el, r, c, node) {
    const g = r.geometry as LineGeometry | null
    // entering: a solid line is drawn from its start, a dashed one fades in (and both wait for the axes they belong to)
    const p = staged(c, node, AFTER_AXES)
    const u = r.dashed ? 1 : smooth(p)
    setTie(c, el, g?.shown && u > 0 ? `M${P(g.x0, g.y0)}L${P(g.x0 + (g.x1 - g.x0) * u, g.y0 + (g.y1 - g.y0) * u)}` : null, r, node.invalid)
    c.set(el, { opacity: r.dashed && p < 1 ? smooth(p) : null })
  },
})
defineKindBackend<{ g: SVGGElement; line: SVGPathElement; text: SVGTextElement }, Ctx2D>('plotMark', {
  build(_n, c) {
    const g = group(c)
    const line = g.appendChild(c.el<SVGPathElement>('path', { fill: 'none', 'stroke-dasharray': DASH, 'stroke-width': PLOT.tieWidth }))
    const text = g.appendChild(c.draw(c.el<SVGTextElement>('text'), 'text'))
    return { g, line, text }
  },
  update(h, r, c, node) {
    const g = r.geometry as MarkGeometry | null
    const color = node.invalid ? INVALID_COLOR : String(r.color)
    c.set(h.line, { display: g?.shown && g.line ? null : 'none', d: g?.line ? `M${P(g.line[0], g.line[1])}L${P(g.line[0], g.line[2])}` : null, stroke: color, opacity: PLOT.tieOpacity * smooth(staged(c, node, AFTER_AXES)) })
    setText(c, h.text, g?.shown ? g.label : null, { color })
  },
})
defineKindBackend<{ g: SVGGElement; left: SVGPathElement; right: SVGPathElement; text: SVGTextElement }, Ctx2D>('plotBracket', {
  build(_n, c) {
    const g = group(c)
    // two halves, each drawn from the middle outwards and then up at its end
    const half = (): SVGPathElement => g.appendChild(c.draw(c.el<SVGPathElement>('path', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }), 'stroke'))
    const left = half(), right = half()
    const text = g.appendChild(c.draw(c.el<SVGTextElement>('text'), 'text'))
    return { g, left, right, text }
  },
  update(h, r, c, node) {
    const g = r.geometry as BracketGeometry | null
    const color = node.invalid ? INVALID_COLOR : String(r.color)
    const on = !!g?.shown
    const mid = on ? (g!.x0 + g!.x1) / 2 : 0
    for (const [el, x] of [[h.left, g?.x0 ?? 0], [h.right, g?.x1 ?? 0]] as const) c.set(el, { display: on ? null : 'none', d: on ? `M${P(mid, g!.y)}L${P(x, g!.y)}L${P(x, g!.y + g!.hook)}` : null, stroke: color, 'stroke-width': r.strokeWidth })
    setText(c, h.text, on ? g!.label : null, { color })
  },
})

// ── guide ────────────────────────────────────────────────────────────────────────────────────────────
defineKindBackend<{ g: SVGGElement; line: SVGPathElement; dot: SVGCircleElement }, Ctx2D>('guide', {
  build(_n, c) {
    const g = c.el<SVGGElement>('g')
    const line = g.appendChild(c.draw(c.el<SVGPathElement>('path'), 'stroke'))
    const dot = g.appendChild(c.draw(c.el<SVGCircleElement>('circle'), 'fill'))
    return { g, line, dot }
  },
  update(h, r, c, node) {
    const { a, b, free } = guideEnds(node, r, c.frame)
    setTie(c, h.line, `M${P(a[0], a[1])}L${P(b[0], b[1])}`, r, node.invalid)
    c.set(h.line, { 'stroke-opacity': PLOT.tieOpacity })
    // the end on the model is a small dot at full strength: this is the point being followed (an object there is its own mark)
    c.set(h.dot, { display: r.dot && free ? null : 'none', cx: a[0] * K, cy: -a[1] * K, r: PLOT.guideDotRadius * K, fill: node.invalid ? INVALID_COLOR : r.color })
  },
})

// ── num, readout, badge ──────────────────────────────────────────────────────────────────────────────
const line = (c: Ctx2D, el: SVGTextElement, text: string, x: number, anchor: string, em: number, color: string, weight?: string): void => {
  const fs = em * K
  c.set(el, { x: x * K, y: CAP_MIDDLE * fs, 'text-anchor': anchor, 'font-size': fs, 'font-weight': weight && weight !== 'normal' ? weight : null, fill: color, 'data-fs': fs })
  if (el.textContent !== text) el.textContent = text
}
defineKindBackend<{ g: SVGGElement; text: SVGTextElement }, Ctx2D>('num', {
  build(_n, c) { const g = group(c); return { g, text: g.appendChild(c.draw(c.el<SVGTextElement>('text', { 'xml:space': 'preserve' }), 'text')) } },
  update(h, r, c, node) { const l = numLayout(node, r); line(c, h.text, l.text, l.x, l.anchor, l.em, node.invalid ? INVALID_COLOR : r.color, r.weight) },
})
defineKindBackend<{ g: SVGGElement; label: SVGTextElement; value: SVGTextElement }, Ctx2D>('readout', {
  build(_n, c) {
    const g = group(c)
    const text = (): SVGTextElement => g.appendChild(c.draw(c.el<SVGTextElement>('text', { 'xml:space': 'preserve' }), 'text'))
    return { g, label: text(), value: text() }
  },
  update(h, r, c, node) {
    const l = readoutLayout(node, r)
    line(c, h.label, l.label, l.x0, 'start', l.em, node.invalid ? INVALID_COLOR : r.labelColor)
    line(c, h.value, l.value, l.valueX, 'start', l.em, node.invalid ? INVALID_COLOR : r.color)
  },
})
defineKindBackend<{ g: SVGGElement; dot: SVGCircleElement; text: SVGTextElement }, Ctx2D>('badge', {
  build(_n, c) {
    const g = group(c)
    const dot = g.appendChild(c.draw(c.el<SVGCircleElement>('circle'), 'fill'))
    return { g, dot, text: g.appendChild(c.draw(c.el<SVGTextElement>('text', { 'xml:space': 'preserve' }), 'text')) }
  },
  update(h, r, c, node) {
    const l = badgeLayout(node, r)
    const color = node.invalid ? INVALID_COLOR : l.color
    c.set(h.dot, { cx: l.dotX * K, cy: 0, r: l.dotRadius * K, fill: color })
    line(c, h.text, l.text, l.textX, 'start', l.em, color)
  },
})

// ── bars ─────────────────────────────────────────────────────────────────────────────────────────────
defineKindBackend<{ g: SVGGElement; base: SVGPathElement; rects: SVGRectElement[]; texts: SVGTextElement[] }, Ctx2D>('bars', {
  build(_n, c) { const g = group(c); return { g, base: g.appendChild(c.el<SVGPathElement>('path', { fill: 'none', 'stroke-linecap': 'round' })), rects: [], texts: [] } },
  /** drawn on: the line they stand on first, then each bar grows from it, left to right, with its number */
  update(h, _r, c, node) {
    const L = barsOf(node, c.frame)
    const p = staged(c, node)
    const n = L.bars.length
    const ub = stage(p, ENTER.barBase)
    c.set(h.base, { d: `M${P(L.base.x0, L.base.y)}L${P(L.base.x0 + (L.base.x1 - L.base.x0) * ub, L.base.y)}`, stroke: node.invalid ? INVALID_COLOR : PLOT.axisColor, 'stroke-width': PLOT.axisWidth, opacity: ub > 0 ? null : 0 })
    grow(c, h.rects, n, () => h.g.insertBefore(c.el<SVGRectElement>('rect'), h.base))
    grow(c, h.texts, 2 * n, () => h.g.appendChild(c.el<SVGTextElement>('text')))
    L.bars.forEach((b, i) => {
      const a = lagged(p, ENTER.barStart, ENTER.barLag, ENTER.barSpan, i / Math.max(1, n))
      // a bar grows away from the line it stands on, whichever side it is on
      const up = b.value >= 0
      const height = (b.y1 - b.y0) * a
      const y1 = up ? b.y0 + height : b.y1
      const fade = b.dim ? PLOT.dimmed : 1
      const color = node.invalid ? INVALID_COLOR : b.color
      c.set(h.rects[i]!, { display: null, x: b.x0 * K, y: -y1 * K, width: (b.x1 - b.x0) * K, height: Math.max(0, height) * K, fill: color, 'fill-opacity': PLOT.barOpacity * fade, stroke: color, 'stroke-width': PLOT.barStroke, 'stroke-opacity': fade, 'stroke-linejoin': 'round' })
      setText(c, h.texts[2 * i]!, b.label, { opacity: a * (b.dim ? PLOT.dimmedText : 1) })
      setText(c, h.texts[2 * i + 1]!, b.number, { opacity: a * (b.dim ? PLOT.dimmedText : 1), dy: (up ? -1 : 1) * (b.y1 - b.y0) * (1 - a) })
    })
  },
})

// ── matrix ───────────────────────────────────────────────────────────────────────────────────────────
defineKindBackend<{ g: SVGGElement; cells: SVGRectElement[]; texts: SVGTextElement[]; mark: SVGRectElement }, Ctx2D>('matrix', {
  build(_n, c) { const g = group(c); return { g, cells: [], texts: [], mark: g.appendChild(c.el<SVGRectElement>('rect', { fill: 'none', 'stroke-linejoin': 'round' })) } },
  /** drawn on: the cells arrive along the diagonals, from the top left */
  update(h, r, c, node) {
    const L = matrixOf(node, c.frame)
    const p = staged(c, node)
    const n = L.cells.length, depth = Math.max(1, L.rows + L.columns - 2)
    grow(c, h.cells, n, () => h.g.insertBefore(c.el<SVGRectElement>('rect'), h.mark))
    grow(c, h.texts, n + L.labels.length, () => h.g.appendChild(c.el<SVGTextElement>('text')))
    L.cells.forEach((cell, i) => {
      const k = (cell.row + cell.column) / depth
      const a = lagged(p, 0, ENTER.cellLag, ENTER.cellSpan, k) * (cell.dim ? PLOT.dimmed : 1)
      c.set(h.cells[i]!, { display: null, x: cell.x0 * K, y: -(cell.y0 + cell.size) * K, width: cell.size * K, height: cell.size * K, rx: cell.size * K * PLOT.cellRadius, fill: node.invalid ? INVALID_COLOR : cell.color, opacity: a < 1 ? a : null })
      setText(c, h.texts[i]!, cell.number, { opacity: a })
    })
    L.labels.forEach((t, i) => setText(c, h.texts[n + i]!, t, { opacity: stage(p, ENTER.cellLabels) }))
    const m = L.highlight
    c.set(h.mark, m ? { display: null, x: m.x0 * K, y: -m.y1 * K, width: (m.x1 - m.x0) * K, height: (m.y1 - m.y0) * K, rx: L.cells[0] ? L.cells[0].size * K * PLOT.cellRadius : 0, stroke: r.highlightColor, 'stroke-width': PLOT.highlightWidth, opacity: p < 1 ? stage(p, ENTER.cellMark) : null } : { display: 'none' })
  },
})
