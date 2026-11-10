// The maths of plots, numbers and readouts that only the frame being drawn needs: the layout of axes, what every
// curve / dot / line / mark / bracket draws (in the local coordinates of its axes), the layouts of numbers, bars and
// heat grids, and from them the boxes and text rectangles the linter reads. Pure: no DOM. It lives in the module's
// lazy chunk; ./index.ts reaches it through the `impl` slot once the chunk is loaded.
import {
  apply, emptyBox, expand, isNode, isParam, luminance, ramp,
  type Box3, type Frame, type MNode, type Rect, type Resolved, type Subpath, type Vec3,
} from '../core/index.ts'
import { ends } from '../r2d/index.ts'
import { circlePath } from '../lib/path/index.ts'
import { trail as sampleTrail } from '../lib/sim/helpers.ts'
import { MATRIX_RAMP, PLOT } from './defaults.ts'
import { layoutAxes, makeText, textEdges, textSize, type AxesLayout, type PlotText, type RowsBelow } from './layout.ts'
import { clipPolyline, formatNumber, makeScale, withUnit, type Edges } from './scale.ts'
import type { PlotImpl } from './index.ts'

// ── small helpers ────────────────────────────────────────────────────────────────────────────────────
const box = (e: Edges): Box3 => ({ min: [e.x0, e.y0, 0], max: [e.x1, e.y1, 0] })
const rectOf = (e: Edges): Rect => ({ x: e.x0, y: e.y0, width: e.x1 - e.x0, height: e.y1 - e.y0 })
const fin = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const r4 = (v: number): number => (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 + 0 : v)

const isAxesKind = (kind: string): boolean => kind === 'axes' || kind === 'numberLine'

// ── axes and number line ─────────────────────────────────────────────────────────────────────────────
const rowsOf = (ax: MNode): RowsBelow => {
  let marks = false, brackets = 0
  for (const c of ax.children) {
    if (c.kind === 'plotMark') marks = true
    else if (c.kind === 'plotBracket') brackets = Math.max(brackets, 1 + Math.max(0, Math.round(fin(c.props.level, 0))))
  }
  return { marks, brackets }
}
let fallback: AxesLayout | null = null
/** The layout of a pair of axes or a number line in a frame (memoised: the axes, every curve and every mark ask for it). */
export function layoutOf(ax: MNode, frame: Frame): AxesLayout {
  return frame.memo('plot.layout' + ax.uid, () => layoutAxes(frame.props(ax), ax.kind === 'numberLine', rowsOf(ax)), (fallback ??= layoutAxes({}, false, { marks: false, brackets: 0 })))
}
const layoutTexts = (L: AxesLayout): PlotText[] => [...L.xTicks.map((t) => t.label), ...L.yTicks.map((t) => t.label), L.xLabel, L.yLabel].filter((t): t is PlotText => !!t)


// ── parts: what the methods of axes / numberLine create ──────────────────────────────────────────────
/** the layout of the axes a part belongs to; null when it has none (a part is only made by a method of its axes) */
const hostOf = (node: MNode, frame: Frame): AxesLayout | null => (node.parent && isAxesKind(node.parent.kind) ? layoutOf(node.parent, frame) : null)
/** a point given as [x, y], or as one number on a number line */
const xy = (v: unknown): [number, number] => (Array.isArray(v) ? [fin(v[0], NaN), fin(v[1], 0)] : [fin(v, NaN), 0])
const inside = (L: AxesLayout, x: number, y: number): boolean => {
  const ex = (L.sx.max - L.sx.min) * 1e-6, ey = (L.sy.max - L.sy.min) * 1e-6
  return x >= L.sx.min - ex && x <= L.sx.max + ex && (L.line || (y >= L.sy.min - ey && y <= L.sy.max + ey))
}

/** The samples of a plotted function or point list in DATA coordinates: pieces (flat [x, y, …]) inside from..to, cut where a value is not finite. */
function dataPieces(node: MNode, frame: Frame, L: AxesLayout): { pieces: number[][]; fn: ((x: number) => number) | null } {
  const lo = Math.max(L.sx.min, fin(frame.prop(node, 'from'), L.sx.min)), hi = Math.min(L.sx.max, fin(frame.prop(node, 'to'), L.sx.max))
  const raw = node.props.fn
  const fn = typeof raw === 'function' ? (raw as (x: number) => number) : null
  if (!(hi > lo)) return { pieces: [], fn }
  if (!fn) {
    const data = frame.prop<unknown>(node, 'data')
    const flat: number[] = []
    if (Array.isArray(data)) for (const p of data) { const q = xy(p); flat.push(q[0], Array.isArray(p) ? fin(p[1], NaN) : NaN) }
    return { pieces: clipPolyline(flat, { x0: lo, x1: hi, y0: -Infinity, y1: Infinity }), fn }
  }
  // a fixed grid over the whole range, plus the two ends: the curve does not shimmer while `to` moves
  const n = Math.min(2000, Math.max(2, Math.round(fin(frame.prop(node, 'samples'), PLOT.samples))))
  const xs: number[] = [lo]
  for (let i = 0; i <= n; i++) { const x = L.sx.inv(i / n); if (x > lo && x < hi) xs.push(x) }
  xs.push(hi)
  const pieces: number[][] = []
  let cur: number[] = []
  for (const x of xs) {
    let y: unknown
    try { y = fn(x) } catch (e) { frame.model.reportError(e, `the function plotted by #${node.id}`, { ids: [node.id], t: frame.tau, frame }); break }
    if (typeof y === 'number' && Number.isFinite(y)) cur.push(x, y)
    else { if (cur.length >= 4) pieces.push(cur); cur = [] }
  }
  if (cur.length >= 4) pieces.push(cur)
  return { pieces, fn }
}

export interface CurveGeometry { runs: { color: string; pts: number[] }[] }
/** A curve as coloured polylines in the LOCAL coordinates of its axes, cut to the plot rectangle. */
function curveGeometry(node: MNode, frame: Frame): CurveGeometry {
  const L = hostOf(node, frame)
  if (!L) return { runs: [] }
  const base = String(frame.prop(node, 'color'))
  const pick = typeof node.props.colorAt === 'function' ? (node.props.colorAt as (x: number, y: number) => unknown) : null
  const colorOf = (x: number, y: number): string => { if (!pick) return base; let c: unknown; try { c = pick(x, y) } catch (e) { frame.model.reportError(e, `colorAt of #${node.id}`, { ids: [node.id], t: frame.tau, frame }) } return typeof c === 'string' && c ? c : base }
  const { pieces, fn } = dataPieces(node, frame, L)
  const runs: CurveGeometry['runs'] = []
  const local = (x: number, y: number, out: number[]): void => { const p = L.toLocal(x, y); out.push(r4(p[0]), r4(p[1])) }
  for (const piece of pieces) {
    let color = colorOf(piece[0]!, piece[1]!)
    let cur: number[] = []
    local(piece[0]!, piece[1]!, cur)
    const close = (): void => { for (const pts of clipPolyline(cur, L.plot)) runs.push({ color, pts }) }
    for (let i = 2; i + 1 < piece.length; i += 2) {
      const x = piece[i]!, y = piece[i + 1]!
      const c = pick ? colorOf(x, y) : color
      if (c !== color) {
        // the colour changes between two samples: find where (to a thousandth of the gap), and end the run exactly there
        let a = piece[i - 2]!, b = x, my = (piece[i - 1]! + y) / 2
        if (fn) {
          for (let k = 0; k < 10; k++) { const m = (a + b) / 2; let v = NaN; try { v = fn(m) } catch { /* reported by dataPieces */ } if (Number.isFinite(v) && colorOf(m, v) === color) a = m; else b = m }
          try { const v = fn(b); if (Number.isFinite(v)) my = v } catch { /* keep the middle */ }
        } else b = (a + b) / 2
        local(b, my, cur)
        close()
        color = c
        cur = []
        local(b, my, cur)
      }
      local(x, y, cur)
    }
    close()
  }
  return { runs }
}

export interface AreaGeometry { polys: number[][] }
/** The region between a function and a baseline, as polygons in local coordinates (values beyond the y range are held at its edge). */
function areaGeometry(node: MNode, frame: Frame): AreaGeometry {
  const L = hostOf(node, frame)
  if (!L) return { polys: [] }
  const clampY = (y: number): number => Math.min(L.sy.max, Math.max(L.sy.min, y))
  const base = clampY(fin(frame.prop(node, 'baseline'), 0))
  const polys: number[][] = []
  for (const piece of dataPieces(node, frame, L).pieces) {
    const out: number[] = []
    const first = L.toLocal(piece[0]!, base), last = L.toLocal(piece[piece.length - 2]!, base)
    out.push(r4(first[0]), r4(first[1]))
    for (let i = 0; i + 1 < piece.length; i += 2) { const p = L.toLocal(piece[i]!, clampY(piece[i + 1]!)); out.push(r4(p[0]), r4(p[1])) }
    out.push(r4(last[0]), r4(last[1]))
    if (out.every(Number.isFinite)) polys.push(out)
  }
  return { polys }
}

export interface TrailGeometry { lines: number[][] }
interface TrailCache { revision: number; points: Map<string, [number, number]> }
/** when a part first shows: the moment it was made inside a step, or its first enter verb; 0 when it is there from the start */
const bornAt = (node: MNode): number => {
  const first = node.model.clipsFor(node, 'present')?.find((c) => c.to === 1)
  return first ? first.t0 : node.createdStep >= 0 ? node.createdAt : 0
}
/** The path a moving point has taken up to now: the point is asked again at fixed past times (with the same param overrides), so it is a function of time alone. */
function trailGeometry(node: MNode, frame: Frame): TrailGeometry {
  const L = hostOf(node, frame)
  if (!L) return { lines: [] }
  const model = frame.model
  const cache = model.store<TrailCache>('plot.trail', () => ({ revision: -1, points: new Map() }))
  if (cache.revision !== model.revision || cache.points.size > 60000) { cache.revision = model.revision; cache.points.clear() }
  const pinned = Object.keys(frame.overrides).sort().map((k) => `${k}=${String(frame.overrides[k])}`).join('&')
  const at = (t: number): [number, number] => {
    const key = `${node.uid}|${pinned}|${t.toFixed(5)}`
    let p = cache.points.get(key)
    if (!p) {
      const f = t === frame.tau ? frame : model.state(t, frame.overrides)
      p = xy(f.value<unknown>(node.props.point, [NaN, NaN], node, 'the point of the trail'))
      cache.points.set(key, p)
    }
    return p
  }
  const seconds = frame.prop<number | null>(node, 'seconds')
  const from = Math.max(bornAt(node), typeof seconds === 'number' && seconds > 0 ? frame.tau - seconds : 0)
  if (!(frame.tau > from)) return { lines: [] }
  const flat: number[] = []
  for (const p of sampleTrail(at, { from, to: frame.tau, every: PLOT.trailStep })) { const q = L.toLocal(p[0], p[1]); flat.push(r4(q[0]), r4(q[1])) }
  return { lines: clipPolyline(flat, L.plot) }
}

export interface DotGeometry { x: number; y: number; shown: boolean }
function dotGeometry(node: MNode, frame: Frame): DotGeometry {
  const L = hostOf(node, frame)
  const [x, y] = xy(frame.prop(node, 'at'))
  if (!L || !Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0, shown: false }
  const cx = Math.min(L.sx.max, Math.max(L.sx.min, x)), cy = L.line ? 0 : Math.min(L.sy.max, Math.max(L.sy.min, y))
  const p = L.toLocal(cx, cy)
  return { x: r4(p[0]), y: r4(p[1]), shown: inside(L, x, y) && Number.isFinite(p[0]) && Number.isFinite(p[1]) }
}

export interface LineGeometry { x0: number; y0: number; x1: number; y1: number; shown: boolean }
/** vline / hline: across the plot at a value, or between `from` and `to` along the other axis. */
function lineGeometry(node: MNode, frame: Frame): LineGeometry {
  const L = hostOf(node, frame)
  const v = fin(frame.prop(node, 'at'), NaN)
  const none = { x0: 0, y0: 0, x1: 0, y1: 0, shown: false }
  if (!L || !Number.isFinite(v)) return none
  const vertical = node.props.axis !== 'y'
  const s = vertical ? L.sx : L.sy, o = vertical ? L.sy : L.sx
  if (v < s.min - (s.max - s.min) * 1e-6 || v > s.max + (s.max - s.min) * 1e-6) return none
  // right across the plot; with only `to` (or only `from`) given, the other end is on the axis: a line dropped from a curve
  const from = frame.prop<number | null>(node, 'from'), to = frame.prop<number | null>(node, 'to')
  const axis = o.log ? o.min : Math.min(o.max, Math.max(o.min, 0))
  const hold = (v: number | null, d: number): number => Math.min(o.max, Math.max(o.min, fin(v, d)))
  const a = hold(from, typeof to === 'number' ? axis : o.min), b = hold(to, o.max)
  const p = vertical ? L.toLocal(v, a) : L.toLocal(a, v), q = vertical ? L.toLocal(v, b) : L.toLocal(b, v)
  if (L.line) { p[1] -= PLOT.tickLength * 2; q[1] += PLOT.tickLength * 2 }
  const g = { x0: r4(p[0]), y0: r4(p[1]), x1: r4(q[0]), y1: r4(q[1]), shown: true }
  return [g.x0, g.y0, g.x1, g.y1].every(Number.isFinite) ? g : none
}

export interface MarkGeometry { label: PlotText; shown: boolean; line: [number, number, number] | null }
/** A name under the axis at a value (the row under the tick labels), optionally with a dashed line through the plot. */
function markGeometry(node: MNode, frame: Frame): MarkGeometry {
  const L = hostOf(node, frame)
  const r = { text: String(frame.prop(node, 'text') ?? ''), size: fin(frame.prop(node, 'size'), PLOT.markSize), color: String(frame.prop(node, 'color')) }
  const v = fin(frame.prop(node, 'at'), NaN)
  if (!L || !Number.isFinite(v) || !inside(L, v, L.sy.min)) return { label: makeText(r.text, 0, 0, 'middle', r.size, r.color), shown: false, line: null }
  const x = r4(L.toLocal(v, L.sy.min)[0])
  return { label: makeText(r.text, x, r4(L.markY), 'middle', r.size, r.color), shown: Number.isFinite(x), line: frame.prop(node, 'line') && !L.line ? [x, r4(L.plot.y0), r4(L.plot.y1)] : null }
}

export interface BracketGeometry { x0: number; x1: number; y: number; hook: number; label: PlotText | null; shown: boolean }
/** A bracket under the axis from one value to another, with its name beneath. */
function bracketGeometry(node: MNode, frame: Frame): BracketGeometry {
  const L = hostOf(node, frame)
  const text = String(frame.prop(node, 'text') ?? ''), size = fin(frame.prop(node, 'size'), PLOT.markSize), color = String(frame.prop(node, 'color'))
  let a = fin(frame.prop(node, 'from'), NaN), b = fin(frame.prop(node, 'to'), NaN)
  const none: BracketGeometry = { x0: 0, x1: 0, y: 0, hook: 0, label: null, shown: false }
  if (!L || !Number.isFinite(a) || !Number.isFinite(b)) return none
  if (b < a) [a, b] = [b, a]
  a = Math.max(a, L.sx.min); b = Math.min(b, L.sx.max)
  if (!(b > a)) return none
  let x0 = L.toLocal(a, L.sy.min)[0], x1 = L.toLocal(b, L.sy.min)[0]
  if (!Number.isFinite(x0) || !Number.isFinite(x1)) return none
  // stay a little inside the span, so that two brackets side by side do not touch
  const inset = Math.min(PLOT.bracketInset, (x1 - x0) / 4)
  x0 += inset; x1 -= inset
  const y = L.bracketY(Math.max(0, Math.round(fin(node.props.level, 0))))
  const h = textSize('X', size).height
  return { x0: r4(x0), x1: r4(x1), y: r4(y), hook: PLOT.bracketHook, label: text ? makeText(text, r4((x0 + x1) / 2), r4(y - PLOT.bracketLabelGap - h / 2), 'middle', size, color) : null, shown: true }
}

const geometries: Record<string, (node: MNode, frame: Frame) => unknown> = { plotCurve: curveGeometry, plotArea: areaGeometry, plotTrail: trailGeometry, plotDot: dotGeometry, plotLine: lineGeometry, plotMark: markGeometry, plotBracket: bracketGeometry }
const flatBox = (lists: readonly (readonly number[])[]): Box3 => {
  const b = emptyBox()
  for (const pts of lists) for (let i = 0; i + 1 < pts.length; i += 2) expand(b, [pts[i]!, pts[i + 1]!, 0])
  return b.min[0] <= b.max[0] ? b : { min: [0, 0, 0], max: [0, 0, 0] }
}
const pad = (b: Box3, k: number): Box3 => ({ min: [b.min[0] - k, b.min[1] - k, 0], max: [b.max[0] + k, b.max[1] + k, 0] })


export interface GuideGeometry { a: Vec3; b: Vec3; /** whether the first end is a bare point (then it gets the small dot); an object is its own mark */ free: boolean }
/** the two ends in the guide's own space: an end given as an object stops at its edge, a point of a plot is converted from the space its axes live in */
export function guideEnds(node: MNode, r: Resolved, frame: Frame): GuideGeometry {
  const fix = (raw: unknown, p: Vec3): Vec3 => { const ax = typeof raw === 'function' ? (raw as { plotPointOf?: MNode }).plotPointOf : undefined; return ax && isNode(ax) ? frame.into(node, ax, p) : p }
  const [a, b] = ends(node, { ...r, a: fix(node.props.a, r.a as Vec3), b: fix(node.props.b, r.b as Vec3) }, frame)
  return { a, b, free: !isNode(node.props.a) }
}

interface SampleCache { revision: number; values: Map<string, unknown[]> }
/**
 * The values an option takes over the story (start, middle and end of every step, with the story's own params), plus
 * both ends of the slider when the option is a param. A number reserves the width of the widest of them, so that a
 * readout does not shift its label, or whatever sits beside it, every time a digit is added.
 */
function storyValues(node: MNode, prop: string): unknown[] {
  const model = node.model
  const cache = model.store<SampleCache>('plot.samples', () => ({ revision: -1, values: new Map() }))
  if (cache.revision !== model.revision) { cache.revision = model.revision; cache.values.clear() }
  const key = node.uid + ':' + prop
  let out = cache.values.get(key)
  if (out) return out
  out = []
  cache.values.set(key, out) // set first: a value that asks for its own node's size gets what is known so far
  const raw = node.props[prop]
  if (isParam(raw) && raw.def.kind === 'number') out.push(raw.def.min, raw.def.max)
  if (typeof raw === 'function' || model.clipsFor(node, prop)) for (const s of model.steps) for (const t of [s.t0, (s.t0 + s.t1) / 2, s.t1]) out.push(model.state(t).prop(node, prop))
  return out
}
/** decimals of a number that was given none: from the slider's step or range when it shows a param, otherwise two */
function decimalsOf(node: MNode, r: Resolved, prop = 'value'): number {
  if (typeof r.decimals === 'number') return Math.max(0, Math.min(12, r.decimals))
  const raw = node.props[prop]
  if (isParam(raw) && raw.def.kind === 'number') {
    const d = raw.def
    if (d.step > 0) { for (let k = 0; k <= 6; k++) if (Math.abs(d.step * 10 ** k - Math.round(d.step * 10 ** k)) < 1e-9) return k; return 2 }
    const span = d.max - d.min
    return span >= 50 ? 0 : span >= 5 ? 1 : 2
  }
  return typeof raw === 'number' && Number.isInteger(raw) && !node.model.clipsFor(node, prop) ? 0 : 2
}
/** how a value reads: a number with its decimals and unit; anything else as it is */
const show = (v: unknown, decimals: number, unit: string): string => (typeof v === 'number' ? withUnit(formatNumber(v, decimals), unit) : v === null || v === undefined ? '' : withUnit(String(v), unit))
/** width kept free for the value: the widest it gets over the story (or is now) */
function reserved(node: MNode, now: string, size: number, weight: string, texts: (v: unknown) => string, prop = 'value'): number {
  let w = textSize(now, size, weight).width
  for (const v of storyValues(node, prop)) w = Math.max(w, textSize(texts(v), size, weight).width)
  return w
}
const anchored = (align: unknown, width: number): number => (align === 'left' ? 0 : align === 'right' ? -width : -width / 2)

export interface NumLayout { text: string; /** left edge, width and height of the reserved box (local, centred on y = 0) */ x0: number; width: number; height: number; em: number; /** where the text is anchored, and how */ x: number; anchor: 'start' | 'middle' | 'end' }
export function numLayout(node: MNode, r: Resolved): NumLayout {
  const decimals = decimalsOf(node, r), unit = String(r.unit ?? '')
  const text = show(r.value, decimals, unit)
  const s = textSize(text, r.size, r.weight)
  const width = reserved(node, text, r.size, r.weight, (v) => show(v, decimals, unit))
  const x0 = anchored(r.align, width)
  return { text, x0, width, height: s.height, em: s.em, x: r.align === 'left' ? x0 : r.align === 'right' ? x0 + width : x0 + width / 2, anchor: r.align === 'left' ? 'start' : r.align === 'right' ? 'end' : 'middle' }
}

export interface ReadoutLayout { label: string; value: string; x0: number; width: number; height: number; em: number; /** local x where the value starts */ valueX: number }
export const READOUT_EQUALS = ' = '
export function readoutLayout(node: MNode, r: Resolved): ReadoutLayout {
  const decimals = decimalsOf(node, r), unit = String(r.unit ?? '')
  const value = show(r.value, decimals, unit)
  const label = r.label ? String(r.label) + READOUT_EQUALS : ''
  const s = textSize(label, r.size)
  const valueWidth = reserved(node, value, r.size, 'normal', (v) => show(v, decimals, unit))
  const width = s.width + valueWidth
  return { label, value, x0: -width / 2, width, height: s.height, em: s.em, valueX: -width / 2 + s.width }
}

export interface BadgeLayout { text: string; color: string; x0: number; width: number; height: number; em: number; /** centre and radius of the dot, start of the text */ dotX: number; dotRadius: number; textX: number }
export function badgeLayout(node: MNode, r: Resolved): BadgeLayout {
  const text = r.state === null || r.state === undefined ? '' : String(r.state)
  const colors = (r.colors ?? {}) as Record<string, unknown>
  const own = colors[text]
  const s = textSize(text, r.size)
  let textWidth = reserved(node, text, r.size, 'normal', (v) => (v === null || v === undefined ? '' : String(v)), 'state')
  for (const name of Object.keys(colors)) textWidth = Math.max(textWidth, textSize(name, r.size).width)
  const dotRadius = PLOT.badgeDot * s.em, gap = PLOT.badgeGap * s.em
  const width = 2 * dotRadius + gap + textWidth
  return { text, color: typeof own === 'string' ? own : String(r.color), x0: -width / 2, width, height: s.height, em: s.em, dotX: -width / 2 + dotRadius, dotRadius, textX: -width / 2 + 2 * dotRadius + gap }
}

/** decimals for values of a chart when none are given: from the size of the range, so they do not change while values move */
const rangeDecimals = (span: number): number => (span >= 20 ? 0 : span >= 2 ? 1 : 2)
export interface BarsLayout {
  bars: { x0: number; x1: number; y0: number; y1: number; value: number; color: string; dim: boolean; label: PlotText | null; number: PlotText | null }[]
  /** the line every bar stands on */
  base: { x0: number; x1: number; y: number }
  box: Edges
}
export function barsLayout(r: Resolved): BarsLayout {
  const values: number[] = (Array.isArray(r.values) ? r.values : []).map((v: unknown) => fin(v, 0))
  const n = values.length
  const W = fin(r.width, 5), H = fin(r.height, 3)
  const range = Array.isArray(r.range) ? r.range : [Math.min(0, ...values), Math.max(0, ...values)]
  const s = makeScale(range)
  const yOf = (v: number): number => -H / 2 + Math.min(1, Math.max(0, s.at(v))) * H
  const baseY = yOf(0)
  const slot = n ? W / n : W, barWidth = slot * (1 - Math.min(0.95, Math.max(0, fin(r.gap, PLOT.barGap))))
  const decimals = typeof r.decimals === 'number' ? r.decimals : rangeDecimals(s.max - s.min)
  const labels: unknown[] = Array.isArray(r.labels) ? r.labels : []
  const colors: unknown[] = Array.isArray(r.colors) ? r.colors : []
  const hi = typeof r.highlight === 'number' ? Math.round(r.highlight) : null
  const size = fin(r.labelSize, PLOT.tickLabelSize), h = textSize('0', size).height
  const out: BarsLayout = { bars: [], base: { x0: -W / 2, x1: W / 2, y: baseY }, box: { x0: -W / 2, x1: W / 2, y0: -H / 2, y1: H / 2 } }
  values.forEach((value, i) => {
    const x0 = -W / 2 + i * slot + (slot - barWidth) / 2, top = yOf(value), mid = x0 + barWidth / 2
    const color = typeof colors[i] === 'string' ? (colors[i] as string) : String(r.color)
    const name = labels[i] === undefined || labels[i] === null ? '' : String(labels[i])
    out.bars.push({
      x0, x1: x0 + barWidth, y0: Math.min(baseY, top), y1: Math.max(baseY, top), value, color, dim: hi !== null && hi !== i,
      label: name ? makeText(name, mid, -H / 2 - PLOT.rowGap - h / 2, 'middle', size, PLOT.markColor) : null,
      number: r.showValues ? makeText(withUnit(formatNumber(value, decimals), String(r.unit ?? '')), mid, value >= 0 ? top + PLOT.tickLabelGap + h / 2 : top - PLOT.tickLabelGap - h / 2, 'middle', size, '#DDDDDD') : null,
    })
  })
  for (const b of out.bars) for (const t of [b.label, b.number]) {
    if (!t) continue
    const e = textEdges(t)
    out.box.x0 = Math.min(out.box.x0, e.x0); out.box.x1 = Math.max(out.box.x1, e.x1); out.box.y0 = Math.min(out.box.y0, e.y0); out.box.y1 = Math.max(out.box.y1, e.y1)
  }
  return out
}
const barsOf = (node: MNode, frame: Frame): BarsLayout => frame.memo('plot.bars' + node.uid, () => barsLayout(frame.props(node)), barsLayout({}))

export interface MatrixLayout {
  cells: { row: number; column: number; x0: number; y0: number; size: number; value: number; color: string; dim: boolean; number: PlotText | null }[]
  labels: PlotText[]
  /** the outlined row, column or cell */
  highlight: Edges | null
  rows: number
  columns: number
  box: Edges
}
export function matrixLayout(r: Resolved): MatrixLayout {
  const values: number[][] = (Array.isArray(r.values) ? r.values : []).map((row: unknown) => (Array.isArray(row) ? row.map((v) => fin(v, NaN)) : []))
  const rows = values.length, columns = Math.max(0, ...values.map((row) => row.length))
  const size = fin(r.cellSize, PLOT.cellSize), gap = fin(r.gap, PLOT.cellGap), pitch = size + gap
  const W = Math.max(0, columns * pitch - gap), H = Math.max(0, rows * pitch - gap)
  const all = values.flat().filter(Number.isFinite)
  const s = makeScale(Array.isArray(r.range) ? r.range : [Math.min(...(all.length ? all : [0])), Math.max(...(all.length ? all : [1]))])
  const colorOf = ramp(Array.isArray(r.colors) && r.colors.length ? r.colors : MATRIX_RAMP)
  const decimals = typeof r.decimals === 'number' ? r.decimals : rangeDecimals(s.max - s.min)
  const h = (r.highlight ?? null) as { row?: unknown; column?: unknown } | null
  const hr = h && typeof h.row === 'number' ? Math.round(h.row) : null, hc = h && typeof h.column === 'number' ? Math.round(h.column) : null
  const lit = hr !== null || hc !== null
  const labelSize = fin(r.labelSize, PLOT.tickLabelSize)
  // a number inside a cell is never wider than the cell: the size comes down until the widest fits
  let valueSize = Math.min(labelSize, size * 99 * PLOT.cellTextSize)
  if (r.showValues) { const widest = Math.max(0, ...all.map((v) => textSize(formatNumber(v, decimals), valueSize).width)); if (widest > size * PLOT.cellTextFit) valueSize *= (size * PLOT.cellTextFit) / widest }
  const out: MatrixLayout = { cells: [], labels: [], highlight: null, rows, columns, box: { x0: -W / 2, x1: W / 2, y0: -H / 2, y1: H / 2 } }
  values.forEach((row, i) => row.forEach((value, j) => {
    const x0 = -W / 2 + j * pitch, y0 = H / 2 - i * pitch - size
    const color = Number.isFinite(value) ? colorOf(Math.min(1, Math.max(0, s.at(value)))) : '#000000'
    out.cells.push({
      row: i, column: j, x0, y0, size, value, color, dim: lit && !((hr === null || hr === i) && (hc === null || hc === j)),
      number: r.showValues && Number.isFinite(value) ? makeText(formatNumber(value, decimals), x0 + size / 2, y0 + size / 2, 'middle', valueSize, luminance(color) > PLOT.cellLightAbove ? '#000000' : '#FFFFFF') : null,
    })
  }))
  const rowNames: unknown[] = Array.isArray(r.rows) ? r.rows : [], columnNames: unknown[] = Array.isArray(r.columns) ? r.columns : []
  const lh = textSize('X', labelSize).height
  for (let i = 0; i < rows; i++) if (rowNames[i] !== undefined && rowNames[i] !== null && rowNames[i] !== '') out.labels.push(makeText(String(rowNames[i]), -W / 2 - PLOT.rowGap, H / 2 - i * pitch - size / 2, 'end', labelSize, PLOT.markColor))
  for (let j = 0; j < columns; j++) if (columnNames[j] !== undefined && columnNames[j] !== null && columnNames[j] !== '') out.labels.push(makeText(String(columnNames[j]), -W / 2 + j * pitch + size / 2, H / 2 + PLOT.rowGap + lh / 2, 'middle', labelSize, PLOT.markColor))
  if (lit && rows && columns) {
    const i0 = hr === null ? 0 : Math.min(rows - 1, Math.max(0, hr)), i1 = hr === null ? rows - 1 : i0
    const j0 = hc === null ? 0 : Math.min(columns - 1, Math.max(0, hc)), j1 = hc === null ? columns - 1 : j0
    out.highlight = { x0: -W / 2 + j0 * pitch - gap / 2, x1: -W / 2 + j1 * pitch + size + gap / 2, y0: H / 2 - i1 * pitch - size - gap / 2, y1: H / 2 - i0 * pitch + gap / 2 }
  }
  for (const t of out.labels) { const e = textEdges(t); out.box.x0 = Math.min(out.box.x0, e.x0); out.box.x1 = Math.max(out.box.x1, e.x1); out.box.y0 = Math.min(out.box.y0, e.y0); out.box.y1 = Math.max(out.box.y1, e.y1) }
  return out
}
const matrixOf = (node: MNode, frame: Frame): MatrixLayout => frame.memo('plot.matrix' + node.uid, () => matrixLayout(frame.props(node)), matrixLayout({}))

// ── what ./index.ts asks for, by kind ────────────────────────────────────────────────────────────────
const ZERO: Box3 = { min: [0, 0, 0], max: [0, 0, 0] }
const centred = (x0: number, width: number, height: number): Box3 => ({ min: [x0, -height / 2, 0], max: [x0 + width, height / 2, 0] })
const texts = (list: readonly (PlotText | null)[]): { text: string; rect: Rect }[] => list.filter((t): t is PlotText => !!t && !!t.text).map((t) => ({ text: t.text, rect: rectOf(textEdges(t)) }))
const boundsOf: Record<string, (node: MNode, r: Resolved, frame: Frame) => Box3> = {
  axes: (node, _r, frame) => box(layoutOf(node, frame).box),
  numberLine: (node, _r, frame) => box(layoutOf(node, frame).box),
  plotCurve: (_n, r) => flatBox(((r.geometry as CurveGeometry | null)?.runs ?? []).map((run) => run.pts)),
  plotArea: (_n, r) => flatBox((r.geometry as AreaGeometry | null)?.polys ?? []),
  plotTrail: (_n, r) => flatBox((r.geometry as TrailGeometry | null)?.lines ?? []),
  plotDot: (_n, r) => { const g = r.geometry as DotGeometry | null; return pad({ min: [g?.x ?? 0, g?.y ?? 0, 0], max: [g?.x ?? 0, g?.y ?? 0, 0] }, r.radius) },
  plotLine: (_n, r) => { const g = r.geometry as LineGeometry | null; return g ? { min: [Math.min(g.x0, g.x1), Math.min(g.y0, g.y1), 0], max: [Math.max(g.x0, g.x1), Math.max(g.y0, g.y1), 0] } : ZERO },
  plotMark: (_n, r) => { const g = r.geometry as MarkGeometry | null; return g ? box(textEdges(g.label)) : ZERO },
  plotBracket: (_n, r) => {
    const g = r.geometry as BracketGeometry | null
    if (!g) return ZERO
    const e = g.label ? textEdges(g.label) : { x0: g.x0, x1: g.x1, y0: g.y, y1: g.y }
    return { min: [Math.min(g.x0, e.x0), Math.min(g.y, e.y0), 0], max: [Math.max(g.x1, e.x1), g.y + g.hook, 0] }
  },
  guide: (node, r, frame) => { const g = guideEnds(node, r, frame); return pad({ min: [Math.min(g.a[0], g.b[0]), Math.min(g.a[1], g.b[1]), 0], max: [Math.max(g.a[0], g.b[0]), Math.max(g.a[1], g.b[1]), 0] }, r.dot && g.free ? PLOT.guideDotRadius : 0) },
  num: (node, r) => { const l = numLayout(node, r); return centred(l.x0, l.width, l.height) },
  readout: (node, r) => { const l = readoutLayout(node, r); return centred(l.x0, l.width, l.height) },
  badge: (node, r) => { const l = badgeLayout(node, r); return centred(l.x0, l.width, l.height) },
  bars: (node, _r, frame) => box(barsOf(node, frame).box),
  matrix: (node, _r, frame) => box(matrixOf(node, frame).box),
}
const textsOf: Record<string, (node: MNode, r: Resolved, frame: Frame) => { text: string; rect: Rect }[]> = {
  axes: (node, _r, frame) => texts(layoutTexts(layoutOf(node, frame))),
  numberLine: (node, _r, frame) => texts(layoutTexts(layoutOf(node, frame))),
  plotMark: (_n, r) => { const g = r.geometry as MarkGeometry | null; return g?.shown ? texts([g.label]) : [] },
  plotBracket: (_n, r) => { const g = r.geometry as BracketGeometry | null; return g?.shown ? texts([g.label]) : [] },
  num: (node, r) => { const l = numLayout(node, r); return [{ text: l.text, rect: { x: l.x0, y: -l.height / 2, width: l.width, height: l.height } }] },
  readout: (node, r) => { const l = readoutLayout(node, r); return [{ text: l.label + l.value, rect: { x: l.x0, y: -l.height / 2, width: l.width, height: l.height } }] },
  badge: (node, r) => { const l = badgeLayout(node, r); return l.text ? [{ text: l.text, rect: { x: l.textX, y: -l.height / 2, width: l.x0 + l.width - l.textX, height: l.height } }] : [] },
  bars: (node, _r, frame) => texts(barsOf(node, frame).bars.flatMap((b) => [b.label, b.number])),
  matrix: (node, _r, frame) => { const L = matrixOf(node, frame); return texts([...L.labels, ...L.cells.map((c) => c.number)]) },
}
/** a value given as a number or a function, in a frame */
const valueIn = (v: unknown, frame: Frame, node: MNode): unknown => (typeof v === 'function' ? frame.value(v, NaN, node, `a point of #${node.id}`) : v)

/** Everything ./index.ts needs from this file, by the kind of the node. */
export const engine: PlotImpl = {
  bounds: (node, r, frame) => boundsOf[node.kind]?.(node, r, frame) ?? ZERO,
  textRects: (node, r, frame) => textsOf[node.kind]?.(node, r, frame) ?? [],
  outline(node, r, frame) {
    if (node.kind === 'plotDot') { const g = r.geometry as DotGeometry | null; return circlePath({ radius: r.radius, center: [g?.x ?? 0, g?.y ?? 0] }) }
    if (node.kind === 'guide') { const { a, b } = guideEnds(node, r, frame); return [{ coords: [a[0], a[1], a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3, a[0] + ((b[0] - a[0]) * 2) / 3, a[1] + ((b[1] - a[1]) * 2) / 3, b[0], b[1]], closed: false }] }
    return null
  },
  anchors(node, r, frame): Record<string, Vec3> {
    if (node.kind !== 'guide') return {}
    const g = guideEnds(node, r, frame)
    return { start: g.a, end: g.b, center: [(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2, 0] }
  },
  geometry: (node, frame) => geometries[node.kind]?.(node, frame) ?? null,
  /** ax.toFrame(x, y) / line.toFrame(x) / chart.bar(i) / grid.cell(row, column): where that is in the frame, now */
  point(node, frame, a, b) {
    let local: [number, number] | null = null
    if (isAxesKind(node.kind)) {
      const first = valueIn(a, frame, node)
      const p = Array.isArray(first) ? xy(first) : ([fin(first, NaN), fin(valueIn(b, frame, node), 0)] as [number, number])
      local = layoutOf(node, frame).toLocal(p[0], p[1])
    } else if (node.kind === 'bars') {
      const L = barsOf(node, frame)
      const bar = L.bars[Math.min(L.bars.length - 1, Math.max(0, Math.round(fin(valueIn(a, frame, node), 0))))]
      if (bar) local = [(bar.x0 + bar.x1) / 2, bar.value >= 0 ? bar.y1 : bar.y0]
    } else if (node.kind === 'matrix') {
      const i = Math.round(fin(valueIn(a, frame, node), 0)), j = Math.round(fin(valueIn(b, frame, node), 0))
      const cell = matrixOf(node, frame).cells.find((x) => x.row === i && x.column === j)
      if (cell) local = [cell.x0 + cell.size / 2, cell.y0 + cell.size / 2]
    }
    return local && Number.isFinite(local[0]) && Number.isFinite(local[1]) ? apply(frame.world(node), [local[0], local[1], 0]) : frame.anchor(node, 'center')
  },
}
export { layoutTexts, barsOf, matrixOf }
