// Where everything of a pair of axes (or a number line) goes: the plot rectangle, the axis lines, ticks and their
// labels, axis labels, the rows under the axis for marks and brackets, and the box around all of it. One pure
// function of the resolved options: bounds, textRects, the SVG backend and every curve / dot / bracket read the same
// answer, so what the linter measures is what is drawn.
import { emOf, type Resolved } from '../core/index.ts'
import { faceOf, lineMetrics } from '../r2d/index.ts'
import { PLOT } from './defaults.ts'
import { decimalsFor, formatNumber, formatTick, linearTicks, logTicks, makeScale, niceStep, withUnit, type Edges, type Scale } from './scale.ts'

const tabular = (s: string): string => s.replace(/[0-9]/g, '0')
/** Size of one line of text in frame units. Digits are measured as the widest digit: numbers are set in tabular figures. */
export function textSize(text: string, size: number, weight = 'normal'): { width: number; height: number; em: number } {
  const em = emOf(size > 0 ? size : 48)
  return { width: lineMetrics(tabular(text), faceOf('serif', weight, false)).width * em, height: 0.9 * em, em }
}

/** One piece of text of a plot: `x` is where its anchor sits, `y` its vertical middle (local coordinates, y up). */
export interface PlotText { text: string; x: number; y: number; anchor: 'start' | 'middle' | 'end'; size: number; color: string; width: number; height: number }
export const textEdges = (t: PlotText): Edges => {
  const x0 = t.anchor === 'start' ? t.x : t.anchor === 'end' ? t.x - t.width : t.x - t.width / 2
  return { x0, x1: x0 + t.width, y0: t.y - t.height / 2, y1: t.y + t.height / 2 }
}
export const makeText = (text: string, x: number, y: number, anchor: PlotText['anchor'], size: number, color: string): PlotText => {
  const s = textSize(text, size)
  return { text, x, y, anchor, size, color, width: s.width, height: s.height }
}

export interface PlotTick { value: number; /** local coordinate along its axis */ at: number; label: PlotText | null }
/** What the children of a pair of axes need to know about it (the rows under the axis are filled by marks and brackets). */
export interface RowsBelow { marks: boolean; /** bracket levels in use (0 = none) */ brackets: number }

export interface AxesLayout {
  /** true for a number line: one axis, no y */
  line: boolean
  /** the rectangle the data ranges span, local coordinates */
  plot: Edges
  sx: Scale
  sy: Scale
  /** data → local coordinates */
  toLocal(x: number, y: number): [number, number]
  /** local y of the x axis line, local x of the y axis line */
  axisY: number
  axisX: number
  /** ends of the axis lines (the arrow tips sit beyond the second) */
  xLine: [number, number]
  yLine: [number, number] | null
  /** whether each axis ends in an arrow tip */
  tips: boolean
  xTicks: PlotTick[]
  yTicks: PlotTick[]
  xLabel: PlotText | null
  yLabel: PlotText | null
  /** local y of the middle of the row of marks, and of the line of a bracket at a level */
  markY: number
  bracketY(level: number): number
  /** the box around everything, rows included */
  box: Edges
}

const eps = (s: Scale): number => (s.max - s.min) * 1e-9
function ticksOf(spec: unknown, s: Scale, length: number, unit: string, size: number, horizontal: boolean): { value: number; label: string }[] {
  if (spec === false || spec === null) return []
  const inRange = (v: number): boolean => Number.isFinite(v) && v >= s.min - eps(s) && v <= s.max + eps(s)
  if (Array.isArray(spec)) {
    return spec.map((item) => (Array.isArray(item) ? { value: Number(item[0]), label: String(item[1] ?? '') } : { value: Number(item), label: withUnit(formatTick(Number(item)), unit) })).filter((t) => inRange(t.value))
  }
  if (s.log) return logTicks(s.min, s.max).map((v) => ({ value: v, label: withUnit(formatTick(v), unit) }))
  const span = s.max - s.min
  const degrees = unit === '°'
  let step: number
  if (typeof spec === 'number' && spec > 0 && span / spec <= 200) step = spec
  else {
    let target = Math.max(1, Math.floor(length / (horizontal ? PLOT.tickSpacingX : PLOT.tickSpacingY)))
    for (;;) {
      step = niceStep(span, target, degrees)
      if (!horizontal || target <= 1) break
      // labels along x must not touch: with a wide unit or many decimals, take the next rounder step
      const d = decimalsFor(step)
      const widest = Math.max(0, ...linearTicks(s.min, s.max, step).map((v) => textSize(withUnit(formatNumber(v, d), unit), size).width))
      if ((step / span) * length >= widest + PLOT.tickLabelClearance) break
      target--
    }
  }
  const d = decimalsFor(step)
  return linearTicks(s.min, s.max, step).map((v) => ({ value: v, label: withUnit(formatNumber(v, d), unit) }))
}

const tickSpec = (ticks: unknown, axis: 'x' | 'y'): unknown => {
  if (ticks === false) return false
  if (ticks && typeof ticks === 'object' && !Array.isArray(ticks)) return (ticks as Record<string, unknown>)[axis]
  return undefined
}

function build(r: Resolved, line: boolean, rows: RowsBelow, W: number, H: number, ox: number, oy: number): AxesLayout {
  const T = PLOT
  const tickSize = r.tickLabelSize > 0 ? r.tickLabelSize : T.tickLabelSize, labelSize = r.labelSize > 0 ? r.labelSize : T.labelSize
  const color = typeof r.color === 'string' ? r.color : T.axisColor
  const plot: Edges = { x0: ox - W / 2, x1: ox + W / 2, y0: oy - H / 2, y1: oy + H / 2 }
  const sx = makeScale(line ? r.range : r.x, !line && r.xScale === 'log')
  const sy = line ? makeScale([0, 1]) : makeScale(r.y, r.yScale === 'log')
  const toLocal = (x: number, y: number): [number, number] => [plot.x0 + sx.at(x) * W, line ? oy : plot.y0 + sy.at(y) * H]
  const zero = !line && r.axis === 'zero'
  const crosses = (s: Scale): boolean => !s.log && s.min < 0 && s.max > 0
  // 'zero': the axis lines pass through 0 where 0 is inside the range; otherwise they sit on the left and bottom edges
  const xInside = zero && crosses(sy), yInside = zero && crosses(sx)
  const axisY = line ? oy : xInside ? plot.y0 + sy.at(0) * H : plot.y0
  const axisX = yInside ? plot.x0 + sx.at(0) * W : plot.x0
  const xUnit = String((line ? r.unit : r.xUnit) ?? ''), yUnit = String(r.yUnit ?? '')

  const xTicks: PlotTick[] = ticksOf(line ? r.ticks : tickSpec(r.ticks, 'x'), sx, W, xUnit, tickSize, true)
    .map((t) => { const at = plot.x0 + sx.at(t.value) * W; return { value: t.value, at, label: t.label ? makeText(t.label, at, 0, 'middle', tickSize, T.tickLabelColor) : null } })
    // an x axis through the middle has the y axis running on below it: no number where that line passes
    .filter((t) => Number.isFinite(t.at) && !(xInside && Math.abs(t.at - axisX) < 1e-6))
  const tickH = textSize('0', tickSize).height
  for (const t of xTicks) if (t.label) t.label.y = axisY - T.tickLength - T.tickLabelGap - tickH / 2
  const yTicks: PlotTick[] = line ? [] : ticksOf(tickSpec(r.ticks, 'y'), sy, H, yUnit, tickSize, false)
    .map((t) => { const at = plot.y0 + sy.at(t.value) * H; return { value: t.value, at, label: t.label ? makeText(t.label, axisX - T.tickLength - T.tickLabelGap, at, 'end', tickSize, T.tickLabelColor) : null } })
    .filter((t) => Number.isFinite(t.at) && !(yInside && Math.abs(t.at - axisY) < 1e-6))

  const tips = !line
  const xLine: [number, number] = [plot.x0 - (line ? T.overhang / 2 : 0), plot.x1 + (line ? T.overhang / 2 : T.overhang)]
  const yText = !line && r.yLabel ? String(r.yLabel) : ''
  const xText = String((line ? r.label : r.xLabel) ?? '')
  const labelH = textSize('X', labelSize).height
  const yLine: [number, number] | null = line ? null : [plot.y0, plot.y1 + (yText ? Math.max(T.overhang, labelH + T.labelClear) : T.overhang)]
  // the y label sits beside the top of its axis, in the part that runs past the data: nothing is ever plotted there
  const yLabel = yText && yLine ? makeText(yText, axisX + T.labelGap, yLine[1] - labelH / 2, 'start', labelSize, color) : null
  const hasTickLabels = xTicks.some((t) => t.label)
  let below = axisY - T.tickLength - (hasTickLabels ? T.tickLabelGap + tickH : 0)
  let xLabel: PlotText | null = null
  if (xText) {
    // on the edge: under the tick labels at the arrow's end, clear of every curve. Through the middle (or a number
    // line): beyond the arrow tip, level with the axis.
    if (line || xInside) xLabel = makeText(xText, xLine[1] + (tips ? T.tip : 0) + T.labelGap, axisY, 'start', labelSize, color)
    else { xLabel = makeText(xText, xLine[1], below - T.rowGap - labelH / 2, 'end', labelSize, color); below = xLabel.y - labelH / 2 }
  }
  let bottom = Math.min(below, plot.y0)
  const markH = textSize('X', T.markSize).height
  const markY = bottom - T.rowGap - markH / 2
  if (rows.marks) bottom = markY - markH / 2
  const bracketTop = bottom - T.rowGap - T.bracketHook
  const bracketRow = T.bracketHook + T.bracketLabelGap + markH + T.rowGap
  const bracketY = (level: number): number => bracketTop - Math.max(0, level) * bracketRow
  if (rows.brackets > 0) bottom = bracketY(rows.brackets - 1) - T.bracketLabelGap - markH

  const box: Edges = { x0: Math.min(plot.x0, xLine[0], axisX - T.tickLength), x1: xLine[1] + (tips ? T.tip : 0), y0: bottom, y1: line ? axisY + T.tickLength : yLine![1] + T.tip }
  for (const t of [...xTicks.map((k) => k.label), ...yTicks.map((k) => k.label), xLabel, yLabel]) {
    if (!t) continue
    const e = textEdges(t)
    box.x0 = Math.min(box.x0, e.x0); box.x1 = Math.max(box.x1, e.x1); box.y0 = Math.min(box.y0, e.y0); box.y1 = Math.max(box.y1, e.y1)
  }
  return { line, plot, sx, sy, toLocal, axisY, axisX, xLine, yLine, tips, xTicks, yTicks, xLabel, yLabel, markY, bracketY, box }
}

/**
 * The layout of axes({ … }) or numberLine({ … }) from their resolved options. Without `fit` the plot rectangle is
 * `width` × `height`, centred on the object's origin (two plots placed at the same height line up exactly). With
 * `fit` the whole thing, labels and rows included, fills a rectangle of that size centred on the origin.
 */
export function layoutAxes(r: Resolved, line: boolean, rows: RowsBelow): AxesLayout {
  const num = (v: unknown, d: number): number => (typeof v === 'number' && v > 0 && Number.isFinite(v) ? v : d)
  let W = num(r.width, 6), H = line ? 0 : num(r.height, 3.5)
  let L = build(r, line, rows, W, H, 0, 0)
  const fit = r.fit as { width?: number; height?: number } | null | undefined
  if (fit && num(fit.width, 0) && num(fit.height, 0)) {
    const fw = fit.width!, fh = fit.height!
    // margins depend on the ticks, which depend on the size: two rounds settle it
    for (let i = 0; i < 2; i++) {
      const mL = L.plot.x0 - L.box.x0, mR = L.box.x1 - L.plot.x1, mB = L.plot.y0 - L.box.y0, mT = L.box.y1 - L.plot.y1
      W = Math.max(0.3, fw - mL - mR)
      H = line ? 0 : Math.max(0.3, fh - mB - mT)
      L = build(r, line, rows, W, H, -fw / 2 + mL + W / 2, line ? (mB - mT) / 2 : -fh / 2 + mB + H / 2)
    }
  }
  return L
}
