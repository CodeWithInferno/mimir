// Plots, numbers and state readouts (main chunk): the constructors, their schemas and the methods of axes. The maths
// of what is drawn (layouts, curve sampling, boxes, text rectangles: ./engine.ts) and the drawing (./plot.chunk.ts)
// are in the module's lazy chunk, which the runtime loads for any scene that uses one of these kinds; this file
// reaches them through `impl`. Until the chunk is there (while a scene is being built) a box is the plain rectangle
// of the object and nothing is drawn; nothing that is measured or rendered ever sees that state.
import {
  boxOf, defineInterp, defineKind, defineKindMethod, defineKindSetter, reportProblems, TEXT_SIZES, validateOptions,
  type Box3, type Frame, type Handle, type MNode, type Patch, type Rect, type Resolved, type Schema, type Subpath, type Vec3,
} from '../core/index.ts'
import { MATRIX_RAMP, PLOT } from './defaults.ts'

export { MATRIX_RAMP, PLOT } from './defaults.ts'

/** What the lazy chunk provides (./engine.ts), by the kind of the node it is asked about. */
export interface PlotImpl {
  /** local box of an object of this module */
  bounds(node: MNode, r: Resolved, frame: Frame): Box3
  /** the text it draws, as local rectangles */
  textRects(node: MNode, r: Resolved, frame: Frame): { text: string; rect: Rect }[]
  outline(node: MNode, r: Resolved, frame: Frame): Subpath[] | null
  anchors(node: MNode, r: Resolved, frame: Frame): Record<string, Vec3>
  /** what a part of a pair of axes draws in this frame, in the local coordinates of the axes */
  geometry(node: MNode, frame: Frame): unknown
  /** a point of the frame for a value of a plot, a bar or a cell */
  point(node: MNode, frame: Frame, a: unknown, b: unknown): Vec3
}
/** Filled in by ./plot.chunk.ts when it loads. */
export const impl: Partial<PlotImpl> = {}

const SIZE = (dflt: number): Schema[string] => ({ type: 'positive', default: dflt, tokens: TEXT_SIZES, example: "size: 'note'" })
const ID: Schema = { id: { type: 'string', dynamic: false } }
const fin = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
/** the hooks every kind of this module shares: the chunk answers, a plain box stands in before it is loaded */
const hooks = (plain: (r: Resolved) => Box3 = () => boxOf(0, 0, 0)) => ({
  chunk: 'plot',
  bounds: (node: MNode, r: Resolved, frame: Frame): Box3 => impl.bounds?.(node, r, frame) ?? plain(r),
  textRects: (node: MNode, r: Resolved, frame: Frame): { text: string; rect: Rect }[] => impl.textRects?.(node, r, frame) ?? [],
})
const sized = (r: Resolved): Box3 => { const f = r.fit as { width?: number; height?: number } | null; return boxOf(fin(f?.width, fin(r.width, 1)) / 2, fin(f?.height, fin(r.height, 0)) / 2, 0) }

// ── axes and number line ─────────────────────────────────────────────────────────────────────────────
const AXIS_STYLE: Schema = {
  width: { type: 'positive', default: 6 },
  color: { type: 'color', default: PLOT.axisColor },
  strokeWidth: { type: 'nonneg', default: PLOT.axisWidth },
  tickLabelSize: SIZE(PLOT.tickLabelSize),
  labelSize: SIZE(PLOT.labelSize),
  fit: { type: { object: { width: 'positive', height: 'positive' } }, nullable: true, default: null },
}
const TICKS_EXAMPLE = "ticks: { x: 90, y: [-1, 0, 1] }  (a step, a list of values or [value, 'label'] pairs, or false)"
/** ticks as the author wrote them: report what cannot be read (the object then gets automatic ticks) */
function checkTicks(node: MNode, one: boolean): void {
  const v = node.props.ticks
  const okSpec = (s: unknown): boolean => s === undefined || s === true || s === false || (typeof s === 'number' && s > 0) || (Array.isArray(s) && s.every((t) => typeof t === 'number' || (Array.isArray(t) && typeof t[0] === 'number')))
  const ok = typeof v === 'function' || (one ? okSpec(v) : v === true || v === false || v === undefined || (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).every((k) => (k === 'x' || k === 'y') && okSpec((v as Record<string, unknown>)[k]))))
  if (ok) return
  node.invalid = true
  node.model.diagnostics.add({ code: 'API-TYPE', ids: [node.id], what: `${node.kind}(): ticks cannot be read (${Array.isArray(v) ? 'a list' : typeof v}${typeof v === 'object' && v && !Array.isArray(v) ? ` with the keys ${Object.keys(v).join(', ')}` : ''}).`, fix: [one ? "ticks: 5  (a step), ticks: [0, 5, 10]  or  ticks: [[0, 'start'], [10, 'end']]" : TICKS_EXAMPLE] }, node.src)
  node.props.ticks = true
}

/** axes({ x, y, width, height, … }): a pair of axes. Curves, dots, lines, marks and brackets are added with its methods. */
export const axes = defineKind({
  name: 'axes', space: '2d', ...hooks(sized),
  schema: {
    x: { type: 'vec2', default: [0, 10], example: 'x: [0, 720]' },
    y: { type: 'vec2', default: [0, 1], example: 'y: [-1, 1]' },
    height: { type: 'positive', default: 3.5 },
    xLabel: { type: 'text', default: '' }, yLabel: { type: 'text', default: '' },
    xUnit: { type: 'text', default: '', example: "xUnit: '°'" }, yUnit: { type: 'text', default: '' },
    xScale: { type: ['linear', 'log'], default: 'linear' }, yScale: { type: ['linear', 'log'], default: 'linear' },
    ticks: { type: 'any', default: true, example: TICKS_EXAMPLE },
    axis: { type: ['edge', 'zero'], default: 'edge' },
    grid: { type: 'boolean', default: false },
    ...AXIS_STYLE,
  },
  aliases: { xlabel: 'xLabel', ylabel: 'yLabel', xRange: 'x', yRange: 'y', xrange: 'x', yrange: 'y' },
  init(node) {
    checkTicks(node, false)
    // a log axis cannot start at zero or below: say so (the axis is then drawn linear)
    for (const a of ['x', 'y'] as const) {
      const range = node.props[a]
      if (node.props[a + 'Scale'] !== 'log' || !Array.isArray(range) || Math.min(range[0], range[1]) > 0) continue
      node.invalid = true
      node.model.diagnostics.add({ code: 'NUM-INVALID', ids: [node.id], measured: String(Math.min(range[0], range[1])), what: `axes(): ${a}Scale is 'log' but the ${a} range starts at ${Math.min(range[0], range[1])}; a log axis needs a range above 0.`, fix: [`${a}: [0.01, ${Math.max(range[0], range[1]) > 0 ? Math.max(range[0], range[1]) : 100}]`, `or remove ${a}Scale: 'log'`] }, node.src)
    }
  },
})

/** numberLine({ range, width, … }): one axis with ticks. Dots, marks and brackets are added with its methods. */
export const numberLine = defineKind({
  name: 'numberLine', space: '2d', ...hooks(sized),
  schema: {
    range: { type: 'vec2', default: [0, 10], example: 'range: [0, 10]' },
    unit: { type: 'text', default: '' },
    label: { type: 'text', default: '' },
    ticks: { type: 'any', default: true, example: 'ticks: 1' },
    ...AXIS_STYLE,
  },
  aliases: { x: 'range' },
  init: (node) => checkTicks(node, true),
})

// ── parts: what the methods of axes / numberLine create ──────────────────────────────────────────────
/** what a part computes for the frame being drawn (its `geometry` option): set by the method that makes the part */
const GEOMETRY: Schema = { geometry: { type: 'any', default: null } }
const SOURCE: Schema = { fn: { type: 'fn', nullable: true, default: null }, data: { type: 'any', default: null } }
const CURVE: Schema = {
  color: { type: 'color', default: '#58C4DD' },
  colorAt: { type: 'fn', nullable: true, default: null, example: 'colorAt: (x, y) => (y >= 0 ? BLUE : RED)' },
  samples: { type: 'int', default: PLOT.samples, dynamic: false },
  from: { type: 'number', nullable: true, default: null, example: 'from: 0' },
  to: { type: 'number', nullable: true, default: null, example: 'to: () => angle()' },
  strokeWidth: { type: 'nonneg', default: PLOT.curveWidth },
  dashed: { type: 'boolean', default: false },
}
const AREA: Schema = {
  color: { type: 'color', default: '#58C4DD' },
  fillOpacity: { type: 'unit', default: PLOT.areaOpacity },
  baseline: { type: 'number', default: 0 },
  samples: { type: 'int', default: PLOT.samples, dynamic: false },
  from: { type: 'number', nullable: true, default: null }, to: { type: 'number', nullable: true, default: null },
}
const TRAIL: Schema = {
  color: { type: 'color', default: '#FFFF00' },
  strokeWidth: { type: 'nonneg', default: PLOT.trailWidth },
  seconds: { type: 'positive', nullable: true, default: null, example: 'seconds: 2' },
}
const DOT: Schema = { color: { type: 'color', default: '#FFFFFF' }, radius: { type: 'positive', default: PLOT.dotRadius } }
const LINE: Schema = {
  color: { type: 'color', default: PLOT.tieColor },
  strokeWidth: { type: 'nonneg', default: PLOT.tieWidth },
  dashed: { type: 'boolean', default: true },
  from: { type: 'number', nullable: true, default: null }, to: { type: 'number', nullable: true, default: null },
  opacity: { type: 'unit', default: PLOT.tieOpacity },
}
const MARK: Schema = { color: { type: 'color', default: PLOT.markColor }, size: SIZE(PLOT.markSize), line: { type: 'boolean', default: false } }
const BRACKET: Schema = { color: { type: 'color', default: PLOT.markColor }, size: SIZE(PLOT.markSize), strokeWidth: { type: 'nonneg', default: PLOT.bracketWidth }, level: { type: 'int', default: 0, dynamic: false } }

const plotCurve = defineKind({ name: 'plotCurve', space: '2d', ...hooks(), schema: { ...SOURCE, ...CURVE, ...GEOMETRY } })
const plotArea = defineKind({ name: 'plotArea', space: '2d', ...hooks(), schema: { ...SOURCE, ...AREA, ...GEOMETRY } })
const plotTrail = defineKind({ name: 'plotTrail', space: '2d', ...hooks(), schema: { point: { type: 'fn', nullable: true, default: null }, ...TRAIL, ...GEOMETRY } })
const plotDot = defineKind({ name: 'plotDot', space: '2d', ...hooks(), schema: { at: { type: 'any', default: [0, 0] }, ...DOT, ...GEOMETRY }, outline: (node, r, frame) => impl.outline?.(node, r, frame) ?? [] })
const plotLine = defineKind({ name: 'plotLine', space: '2d', ...hooks(), schema: { at: { type: 'number', default: 0 }, axis: { type: ['x', 'y'], default: 'x', dynamic: false }, ...LINE, ...GEOMETRY } })
const plotMark = defineKind({ name: 'plotMark', space: '2d', ...hooks(), schema: { at: { type: 'number', default: 0 }, text: { type: 'text', default: '' }, ...MARK, ...GEOMETRY } })
const plotBracket = defineKind({ name: 'plotBracket', space: '2d', ...hooks(), schema: { from: { type: 'number', default: 0 }, to: { type: 'number', default: 1 }, text: { type: 'text', default: '' }, ...BRACKET, ...GEOMETRY } })

type Issue = { code: 'API-TYPE'; what: string; fix: string[] }
/**
 * Make a part of a pair of axes. The options are checked under the name of the method the author called
 * (`ax.plot()`), the part's id is `<axes id>.<name><n>` (or the `id` option as given), and its `geometry` option is
 * the function that computes what it draws in the frame being evaluated.
 */
function part(ax: MNode, ctor: (...args: any[]) => Handle, name: string, call: string, schema: Schema, opts: unknown, fixed: Record<string, unknown>, problems: Issue[] = []): Handle {
  const model = ax.model
  // `opacity` is an option of every kind (the registry adds it): a part of a plot takes it like any other object
  const v = validateOptions(call, opts, { ...ID, opacity: { type: 'unit' }, ...schema }, undefined, model)
  const wanted = typeof v.props.id === 'string' && v.props.id ? v.props.id : null
  delete v.props.id
  const props = { ...v.props, ...fixed }
  let node: Handle
  if (wanted) { node = ctor({ ...props, id: wanted }); model.adopt(ax, node) }
  else node = model.child(ax, `${name}${ax.children.filter((c) => c.id.startsWith(`${ax.id}.${name}`)).length + 1}`, ctor, props)
  const all = [...v.problems, ...problems]
  if (all.length) { node.invalid = true; reportProblems(model, all, [node.id]) }
  node.props.geometry = () => impl.geometry?.(node, model.now()) ?? null
  return node
}
const dyn = (v: unknown): boolean => typeof v === 'number' || typeof v === 'function'
const bad = (what: string, fix: string): Issue[] => [{ code: 'API-TYPE', what, fix: [fix] }]
/** a live point of the frame, computed by the chunk in the frame being evaluated (the object's centre until it is loaded) */
const livePoint = (node: MNode, a: unknown, b: unknown): (() => Vec3) => () => { const frame = node.model.now(); return impl.point?.(node, frame, a, b) ?? frame.anchor(node, 'center') }

/** What the function or the point list given to ax.plot / ax.area is: a function of x, a list of points, or a function that returns such a list. */
function source(ax: MNode, call: string, what: unknown): { fixed: Record<string, unknown>; problems: Issue[] } {
  const example = `${call.replace('()', '')}((x) => Math.sin(x))  or  ${call.replace('()', '')}([[0, 1], [1, 3], [2, 2]])`
  const points = (v: unknown): boolean => Array.isArray(v) && v.every((p) => Array.isArray(p) && p.length >= 2)
  if (points(what)) return { fixed: { data: what }, problems: [] }
  if (typeof what !== 'function') return { fixed: {}, problems: bad(`${call} needs a function of x or a list of [x, y] points, got ${what === null ? 'null' : Array.isArray(what) ? 'a list that is not made of [x, y] pairs' : typeof what}.`, example) }
  // ask it once, in the middle of the range: a number means y = f(x), a list means "the points right now"
  const frame = ax.model.now()
  const range = frame.prop<unknown>(ax, 'x')
  const mid = Array.isArray(range) ? (fin(range[0], 0) + fin(range[1], 1)) / 2 : 0.5
  let probe: unknown
  try { probe = frame.run(() => (what as (x: number) => unknown)(mid)) } catch (e) { ax.model.reportError(e, call); return { fixed: {}, problems: [] } }
  if (points(probe)) return { fixed: { data: what }, problems: [] }
  if (typeof probe === 'number' || probe === undefined || probe === null) return { fixed: { fn: what }, problems: [] }
  return { fixed: {}, problems: bad(`${call}: the function returned ${Array.isArray(probe) ? 'a list that is not made of [x, y] pairs' : `a ${typeof probe}`}; it must return y for an x, or a list of [x, y] points.`, example) }
}

for (const host of ['axes', 'numberLine']) {
  const who = host === 'axes' ? 'ax' : 'line'
  /** ax.dot(point): a point that follows a value. */
  defineKindMethod(host, 'dot', (ax: MNode, at: unknown, opts?: unknown, more?: unknown) => {
    // ax.dot(x, y) is a slip with one right reading: the point [x, y]
    if (host === 'axes' && dyn(at) && dyn(opts)) {
      const x = at, y = opts
      const value = (v: unknown): unknown => (typeof v === 'function' ? (v as () => unknown)() : v)
      at = () => { const first = value(x); return Array.isArray(first) ? first : [first, value(y)] }
      opts = more
    }
    const ok = typeof at === 'function' || typeof at === 'number' || (Array.isArray(at) && at.length >= 2 && at.every((x) => typeof x === 'number'))
    return part(ax, plotDot, 'dot', `${who}.dot()`, DOT, opts, ok ? { at } : {}, ok ? [] : bad(`${who}.dot() needs ${host === 'axes' ? 'a point [x, y] or a function that returns one' : 'a value or a function that returns one'}, got ${typeof at}.`, host === 'axes' ? `${who}.dot(() => [angle(), height()])` : `${who}.dot(() => level())`))
  })
  /** ax.mark(x, 'name'): a name under the axis at a value. */
  defineKindMethod(host, 'mark', (ax: MNode, at: unknown, text?: unknown, opts?: unknown) => {
    const ok = dyn(at)
    return part(ax, plotMark, 'mark', `${who}.mark()`, MARK, opts, { ...(ok ? { at } : {}), text: typeof text === 'function' ? text : String(text ?? '') }, ok ? [] : bad(`${who}.mark() needs a value along the axis, got ${typeof at}.`, `${who}.mark(90, 'peak')`))
  })
  /** ax.bracket(x0, x1, 'name'): a bracket under the axis. */
  defineKindMethod(host, 'bracket', (ax: MNode, from: unknown, to: unknown, text?: unknown, opts?: unknown) => {
    const ok = dyn(from) && dyn(to)
    return part(ax, plotBracket, 'bracket', `${who}.bracket()`, BRACKET, opts, { ...(ok ? { from, to } : {}), text: typeof text === 'function' ? text : String(text ?? '') }, ok ? [] : bad(`${who}.bracket() needs the two values it spans, got ${typeof from} and ${typeof to}.`, `${who}.bracket(0, 360, 'one turn')`))
  })
  /** ax.toFrame(x, y): a live point of the frame for a value of the plot. The guide converts it into its own space. */
  defineKindMethod(host, 'toFrame', (ax: MNode, x: unknown, y?: unknown) => {
    if (!(dyn(x) || Array.isArray(x))) ax.model.diagnostics.add({ code: 'API-TYPE', ids: [ax.id], what: `${who}.toFrame() needs ${host === 'axes' ? 'x and y (numbers or functions), or a function that returns [x, y]' : 'a value (a number or a function)'}, got ${typeof x}.`, fix: [host === 'axes' ? `${who}.toFrame(90, 1)` : `${who}.toFrame(5)`] })
    return Object.assign(livePoint(ax, x, y), { plotPointOf: ax })
  })
  /** ax.fit(rect): fill a rectangle of the frame (s.area('right')), labels included. */
  defineKindSetter(host, 'fit', (ax: MNode, rect: unknown): Patch | null => {
    const r = rect as Partial<Rect> | null
    if (!r || typeof r !== 'object' || ![r.x, r.y, r.width, r.height].every((n) => typeof n === 'number' && Number.isFinite(n)) || !(r.width! > 0) || !(r.height! > 0)) {
      ax.model.diagnostics.add({ code: 'API-TYPE', ids: [ax.id], what: `${who}.fit() needs a rectangle { x, y, width, height } (x, y = its lower left corner), got ${rect === null ? 'null' : typeof rect}.`, fix: [`${who}.fit(s.area('right'))`, `${who}.fit({ x: 0, y: -3, width: 6, height: 5 })`] })
      return null
    }
    return { placement: { type: 'at', pos: [r.x! + r.width! / 2, r.y! + r.height! / 2, 0] }, fit: { width: r.width, height: r.height } }
  })
  defineInterp(host, 'fit', (a: { width: number; height: number } | null, b: { width: number; height: number } | null, u: number) => (a && b ? { width: a.width + (b.width - a.width) * u, height: a.height + (b.height - a.height) * u } : u >= 0.5 ? b : a))
}
/** ax.plot(fn | points, { color, colorAt, samples, from, to }): a curve. */
defineKindMethod('axes', 'plot', (ax: MNode, what: unknown, opts?: unknown) => { const s = source(ax, 'ax.plot()', what); return part(ax, plotCurve, 'curve', 'ax.plot()', CURVE, opts, s.fixed, s.problems) })
/** ax.area(fn | points, { from, to, baseline }): the region between a function and a baseline. */
defineKindMethod('axes', 'area', (ax: MNode, what: unknown, opts?: unknown) => { const s = source(ax, 'ax.area()', what); return part(ax, plotArea, 'area', 'ax.area()', AREA, opts, s.fixed, s.problems) })
/** ax.trail(point, { seconds }): the path a moving point has taken. */
defineKindMethod('axes', 'trail', (ax: MNode, point: unknown, opts?: unknown) => {
  const ok = typeof point === 'function'
  return part(ax, plotTrail, 'trail', 'ax.trail()', TRAIL, opts, ok ? { point } : {}, ok ? [] : bad(`ax.trail() needs a function that returns the moving point [x, y], got ${typeof point}.`, 'ax.trail(() => [angle(), height()])'))
})
for (const [name, axis] of [['vline', 'x'], ['hline', 'y']] as const) {
  /** ax.vline(x) / ax.hline(y): a dashed line across the plot at a value. */
  defineKindMethod('axes', name, (ax: MNode, at: unknown, opts?: unknown) => {
    const ok = dyn(at)
    return part(ax, plotLine, name, `ax.${name}()`, LINE, opts, { axis, ...(ok ? { at } : {}) }, ok ? [] : bad(`ax.${name}() needs a value (a number or a function), got ${typeof at}.`, `ax.${name}(() => angle())`))
  })
}

// ── guide: the dashed tie between a point of the model and a point of the plot ───────────────────────
/** guide(from, to): a thin dashed line that ties a point of a model (a 3D part, an anchor, a 2D object) to a point of a plot. */
export const guide = defineKind({
  name: 'guide', space: '2d', positional: ['a', 'b'], required: ['a', 'b'], worldGeometry: true, ...hooks(),
  schema: {
    a: { type: 'point', example: "guide(piston.anchor('top'), point)" }, b: { type: 'point', example: "guide(piston.anchor('top'), point)" },
    color: { type: 'color', default: PLOT.guideColor },
    strokeWidth: { type: 'nonneg', default: PLOT.tieWidth },
    dashed: { type: 'boolean', default: true },
    dot: { type: 'boolean', default: true },
    buff: { type: 'nonneg', default: PLOT.guideBuff },
  },
  aliases: { from: 'a', to: 'b' },
  anchors: (node, r, frame) => impl.anchors?.(node, r, frame) ?? {},
  outline: (node, r, frame) => impl.outline?.(node, r, frame) ?? [],
})

// ── numbers ──────────────────────────────────────────────────────────────────────────────────────────
/** num(value, { decimals, unit }): a number in tabular figures that follows its value; n.to.value(v) counts to v. */
export const num = defineKind({
  name: 'num', space: '2d', text: true, positional: ['value'], required: ['value'], ...hooks(),
  schema: {
    value: { type: 'number', example: 'num(() => speed())' },
    decimals: { type: 'int', nullable: true, default: null, dynamic: false, example: 'decimals: 1' },
    unit: { type: 'text', default: '' },
    align: { type: ['center', 'left', 'right'], default: 'center', dynamic: false },
    size: SIZE(48), color: { type: 'color', default: '#FFFFFF' }, weight: { type: ['normal', 'bold'], default: 'normal' },
  },
})
defineKindSetter('num', 'value', (node: MNode, v: unknown): Patch | null => {
  if (typeof v === 'function' || (typeof v === 'number' && Number.isFinite(v))) return { value: v }
  node.model.diagnostics.add({ code: typeof v === 'number' ? 'NUM-INVALID' : 'API-TYPE', ids: [node.id], what: `num.value() needs a finite number or a function, got ${String(v)}.`, fix: ['st.play(n.to.value(100))'] })
  return null
})
/** readout('name', value, { decimals, unit }): "name = value unit" on one line; the name holds still while the value counts. */
export const readout = defineKind({
  name: 'readout', space: '2d', text: true, positional: ['label', 'value'], required: ['label', 'value'], ...hooks(),
  schema: {
    label: { type: 'text', example: "readout('speed', () => speed(), { unit: 'm/s' })" },
    value: { type: 'any', example: "readout('speed', () => speed(), { unit: 'm/s' })" },
    decimals: { type: 'int', nullable: true, default: null, dynamic: false, example: 'decimals: 1' },
    unit: { type: 'text', default: '' },
    size: SIZE(TEXT_SIZES.note!),
    color: { type: 'color', default: '#FFFFFF' },
    labelColor: { type: 'color', default: PLOT.readoutLabelColor },
  },
})
/** badge(state, { colors }): the name of a state with a dot in the state's colour, for state machines. */
export const badge = defineKind({
  name: 'badge', space: '2d', text: true, positional: ['state'], required: ['state'], ...hooks(),
  schema: {
    state: { type: 'any', example: 'badge(() => phase(), { colors: { idle: GREY_B, running: GREEN, failed: RED } })' },
    colors: { type: { record: 'color' }, default: {}, example: 'colors: { idle: GREY_B, running: GREEN }' },
    color: { type: 'color', default: '#DDDDDD' },
    size: SIZE(TEXT_SIZES.note!),
  },
})

// ── bars and heat grids ──────────────────────────────────────────────────────────────────────────────
/** bars(values, { labels, range, … }): a bar chart whose bars follow their values. */
export const bars = defineKind({
  name: 'bars', space: '2d', positional: ['values'], required: ['values'], ...hooks(sized),
  schema: {
    values: { type: { array: 'number' }, example: 'bars([3, 5, 2])' },
    labels: { type: { array: 'text' }, default: [], example: "labels: ['a', 'b', 'c']" },
    width: { type: 'positive', default: 5 }, height: { type: 'positive', default: 3 },
    range: { type: 'vec2', nullable: true, default: null, example: 'range: [0, 10]' },
    color: { type: 'color', default: '#58C4DD' },
    colors: { type: { array: 'color' }, default: [], example: 'colors: [BLUE, GREEN, RED]' },
    gap: { type: 'unit', default: PLOT.barGap },
    showValues: { type: 'boolean', default: true },
    decimals: { type: 'int', nullable: true, default: null, dynamic: false },
    unit: { type: 'text', default: '' },
    highlight: { type: 'int', nullable: true, default: null, example: 'highlight: () => current()' },
    labelSize: SIZE(PLOT.tickLabelSize),
  },
})
/** chart.bar(i): a live point on top of bar i (0 = the first). */
defineKindMethod('bars', 'bar', (node: MNode, index: unknown) => livePoint(node, index, undefined))

/** matrix(values, { rows, columns, colors, highlight }): a grid of cells coloured by their value. */
export const matrix = defineKind({
  name: 'matrix', space: '2d', positional: ['values'], required: ['values'], ...hooks(),
  schema: {
    values: { type: { array: { array: 'number' } }, example: 'matrix([[1, 2], [3, 4]])' },
    rows: { type: { array: 'text' }, default: [], example: "rows: ['a', 'b']" },
    columns: { type: { array: 'text' }, default: [], example: "columns: ['x', 'y']" },
    cellSize: { type: 'positive', default: PLOT.cellSize },
    gap: { type: 'nonneg', default: PLOT.cellGap },
    range: { type: 'vec2', nullable: true, default: null, example: 'range: [0, 1]' },
    colors: { type: { array: 'color' }, default: MATRIX_RAMP, example: 'colors: [BLACK, BLUE, WHITE]' },
    showValues: { type: 'boolean', default: false },
    decimals: { type: 'int', nullable: true, default: null, dynamic: false },
    highlight: { type: { object: { row: { type: 'int', nullable: true }, column: { type: 'int', nullable: true } } }, nullable: true, default: null, example: 'highlight: { row: 1 }' },
    highlightColor: { type: 'color', default: PLOT.highlightColor },
    labelSize: SIZE(PLOT.tickLabelSize),
  },
  aliases: { cols: 'columns', cell: 'cellSize' },
})
/** grid.cell(row, column): a live point at the centre of a cell (0, 0 = top left). */
defineKindMethod('matrix', 'cell', (node: MNode, row: unknown, column: unknown) => livePoint(node, row, column))

/** On demand: this module's API is its own chunk (mimir.plotapi.js), loaded before a scene that uses one of its names. */
export const lazy = true
export const api = { axes, numberLine, bars, matrix, num, readout, badge, guide }
