// chart(opts): a plot that is told WHAT to show, never where. Axes by name or range, ticks and fit by the engine's
// plot module; curves from a function, from points, or from another block (`follow: 'system.queue'`); a cursor bound
// to a control or to the clock of the block it follows. The reducer is pure (reduceChart), the drawing is the
// engine's axes(): nothing is drawn here by hand.
import { Frame, PALETTE, type Handle, type Param } from '../core/index.ts'
import { axes } from '../plot/index.ts'
import { fadeIn, fadeOut } from '../anim/index.ts'
import { textWidth, type BlockCtx, type BlockDef, type BlockHandle } from './block.ts'
import { nearest } from './flowparse.ts'

/** words that name the chart as a whole in a link, whatever the block is called */
const WHOLE: readonly string[] = ['plot', 'chart', 'graph', 'axes']
/** Every default of the chart block, by name. `chart({ look: { … } })` overrides any of them. */
export const CHART_BLOCK = Object.freeze({
  /** width / height the block asks the stage for, its share of the stage, and the widest it lets itself be drawn */
  aspect: 1.9,
  weight: 1,
  maxAspect: 3.6,
  /** the x range of a curve that names none, and the room kept above and below what is plotted (share of its span) */
  range: [0, 10] as readonly [number, number],
  pad: 0.08,
  /** points a function is sampled at when its range is fitted, and most points that get a dot each */
  samples: 120,
  dots: 40,
  /** half length of a tangent, as a share of the x range */
  tangent: 0.16,
  colors: [PALETTE.BLUE, PALETTE.GOLD, PALETTE.GREEN, PALETTE.RED] as readonly string[],
  cursor: PALETTE.GOLD, mark: PALETTE.GREY_A,
  /** room kept between the names of two marks (frame units), and the share of the block's width that the x axis spans */
  markGap: 0.12,
  axisShare: 0.72,
})
type Look = { -readonly [K in keyof typeof CHART_BLOCK]: (typeof CHART_BLOCK)[K] }
type Point = readonly number[]
type Env = Record<string, any>
export type CurveSource = ((x: number, env: Env) => number) | readonly Point[] | ((env: Env) => readonly Point[] | ((x: number) => number))
export interface ChartOptions {
  /** an axis: its name ('time'), a range ([0, 10]), a control's name (the axis then spans the control), or { name, range } */
  x?: string | readonly number[] | { name?: string; range?: readonly number[] }
  y?: string | readonly number[] | { name?: string; range?: readonly number[] }
  /** y = f(x), or (x, { control, block }) => y */
  curve?: CurveSource
  curves?: Record<string, CurveSource>
  /** [x, y] points, or ({ control, block }) => points (read every frame, so they follow the controls) */
  points?: readonly Point[] | ((env: Env) => readonly Point[])
  /** a number of another block over time: 'system.queue', 'net.error' (or several) */
  follow?: string | string[]
  /** what the cursor follows: a control's name or a block's id. Default: the x control, or the block that is followed */
  cursor?: string | false
  look?: Partial<Look>
}
export interface ChartState { hidden: string[]; marks: { x: number; label: string }[]; bands: { from: number; to: number; label: string }[]; tangent: number | null; drawTo: number | null }
const KEYS = ['show', 'hide', 'mark', 'band', 'tangentAt', 'drawTo'] as const
const isRange = (v: unknown): v is readonly number[] => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) && v[0] !== v[1]
const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : [])

/** The pure half of the block: what a change does to the state, and what it could not read. */
export function reduceChart(prev: ChartState, change: unknown, curveNames: readonly string[]): { state: ChartState; problems: { what: string; fix: string }[] } {
  const state: ChartState = { hidden: [...prev.hidden], marks: [...prev.marks], bands: [...prev.bands], tangent: prev.tangent, drawTo: prev.drawTo }
  const problems: { what: string; fix: string }[] = []
  const c = (typeof change === 'object' && change !== null ? change : {}) as Record<string, unknown>
  for (const k of Object.keys(c)) if (!(KEYS as readonly string[]).includes(k)) { const near = nearest(k, KEYS); problems.push({ what: `"${k}" is not something a chart can be told`, fix: near ? `did you mean "${near}"? (${KEYS.join(', ')})` : `one of: ${KEYS.join(', ')}` }) }
  const known = (key: string, v: unknown): string[] => names(v).filter((n) => { if (curveNames.includes(n)) return true; const near = nearest(n, curveNames); problems.push({ what: `{ ${key}: '${n}' } names no curve of this chart`, fix: near ? `did you mean '${near}'?` : `curves: ${curveNames.join(', ')}` }); return false })
  for (const n of known('hide', c.hide)) if (!state.hidden.includes(n)) state.hidden.push(n)
  for (const n of known('show', c.show)) state.hidden = state.hidden.filter((h) => h !== n)
  if (c.mark !== undefined) {
    const m = c.mark as any
    const x = typeof m === 'number' ? m : Array.isArray(m) ? m[0] : m?.x
    const label = Array.isArray(m) ? m[1] : m?.label
    if (typeof x === 'number' && Number.isFinite(x)) state.marks.push({ x, label: typeof label === 'string' ? label : String(Math.round(x * 100) / 100) })
    else problems.push({ what: 'mark needs an x', fix: "mark: 90  ·  mark: [90, 'half way']" })
  }
  if (c.band !== undefined) {
    const b = c.band as any
    const [from, to, label] = Array.isArray(b) ? b : [b?.from, b?.to, b?.label]
    if (typeof from === 'number' && typeof to === 'number' && from !== to) state.bands.push({ from: Math.min(from, to), to: Math.max(from, to), label: typeof label === 'string' ? label : '' })
    else problems.push({ what: 'band needs where it starts and ends', fix: "band: [2, 5, 'overload']" })
  }
  if (c.tangentAt !== undefined) { if (c.tangentAt === null || (typeof c.tangentAt === 'number' && Number.isFinite(c.tangentAt))) state.tangent = c.tangentAt as number | null; else problems.push({ what: 'tangentAt needs an x (or null to remove it)', fix: 'tangentAt: 1.5' }) }
  if (c.drawTo !== undefined) { if (typeof c.drawTo === 'number' && Number.isFinite(c.drawTo)) state.drawTo = c.drawTo; else problems.push({ what: 'drawTo needs an x', fix: 'drawTo: 4' }) }
  return { state, problems }
}

/** The smallest range that holds every value, padded; [0, 1] when there is nothing to hold. */
export function fitRange(values: readonly number[], pad: number): [number, number] {
  let lo = Infinity, hi = -Infinity
  for (const v of values) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v) }
  if (lo > hi) return [0, 1]
  if (lo === hi) { hi = lo + Math.max(1, Math.abs(lo)) * 0.5; lo -= lo === 0 ? 0 : Math.max(1, Math.abs(lo)) * 0.5 }
  const span = hi - lo
  return [lo >= 0 && lo - span * pad < 0 ? 0 : lo - span * pad, hi + span * pad]
}

/** A chart: chart({ x: 'time', y: 'queue depth', follow: 'system.queue' }) · chart({ x: [-3, 3], y: 'loss', curve: (w) => w * w }). */
export function chart(opts: ChartOptions = {}): BlockDef<ChartState> {
  const o = (typeof opts === 'object' && opts !== null ? opts : {}) as ChartOptions
  const look: Look = { ...CHART_BLOCK, ...(typeof o.look === 'object' && o.look !== null ? o.look : {}) }
  return { kind: 'chart', prefer: { aspect: look.aspect, weight: look.weight }, build: (ctx) => buildChart(ctx, o, look) }
}

interface Curve { name: string; fn?: (x: number, env: Env) => number; points?: (env: Env) => readonly Point[]; clock?: () => number; mob?: Handle }

function buildChart(ctx: BlockCtx, o: ChartOptions, look: Look): BlockHandle<ChartState> {
  const { id, rect } = ctx
  const known = ['x', 'y', 'curve', 'curves', 'points', 'follow', 'cursor', 'look']
  for (const k of Object.keys(o)) if (!known.includes(k)) { const near = nearest(k, known); ctx.report(`${id}: chart has no option "${k}"`, near ? `did you mean "${near}"?` : `options: ${known.join(', ')}`) }
  // what an author's function is handed: every control by name (its value now) and every block by id (its api)
  const forced: Record<string, number> = {}
  const touched = new Set<string>()
  const env: Env = new Proxy({}, { get: (_t, key) => {
    if (typeof key !== 'string') return undefined
    if (key in forced) return forced[key]
    const control = ctx.control(key)
    if (control) { touched.add(key); return control() }
    return ctx.block(key)?.api
  } })
  const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn() } catch { return fallback } }

  /** the control the x axis spans, when there is one (set below, read when a curve is drawn) */
  let xControl: string | null = null
  const read = new WeakMap<object, Map<unknown, Map<number, number>>>()
  /** `fn()` as it would read with the x control at `x`, everything else as it is in the frame being drawn (once per frame and x) */
  const readAt = (fn: () => number, x: number): number => {
    if (xControl === null) return Number(fn())
    const model = ctx.s.model, now = model.now()
    let byFn = read.get(now)
    if (!byFn) read.set(now, (byFn = new Map()))
    let byX = byFn.get(fn)
    if (!byX) byFn.set(fn, (byX = new Map()))
    let y = byX.get(x)
    if (y === undefined) { y = Number(new Frame(model, now.tau, { ...now.overrides, [xControl]: x }).run(fn)); byX.set(x, y) }
    return y
  }

  // ── the curves ─────────────────────────────────────────────────────────────────────────────────────────────────
  const curves: Curve[] = []
  let followed: BlockHandle<any> | undefined
  const add = (name: string, source: unknown): void => {
    if (Array.isArray(source)) { curves.push({ name, points: () => source as Point[] }); return }
    if (typeof source !== 'function') { ctx.report(`${id}: the curve "${name}" must be a function of x or a list of [x, y] points`, 'curve: (x) => x * x'); return }
    // ({ block }) => a function / points is a factory; anything else is y = f(x, env)
    const made = safe(() => (source as (e: Env) => unknown)(env), undefined)
    // a reader without arguments (a machine's probe) is a number of the scene NOW: against a control it is plotted by reading it with that control at x
    if (typeof made === 'function') { const f = made as (x: number) => number; curves.push(f.length ? { name, fn: (x) => f(x) } : { name, fn: (x) => readAt(f as () => number, x) }); return }
    if (Array.isArray(made)) { curves.push({ name, points: (e) => safe(() => (source as (e: Env) => readonly Point[])(e), []) }); return }
    curves.push({ name, fn: (x, e) => (source as (x: number, e: Env) => number)(x, e) })
  }
  if (o.curve !== undefined) add('curve', o.curve)
  for (const [name, source] of Object.entries(o.curves ?? {})) add(name, source)
  if (o.points !== undefined) add('points', o.points)
  for (const path of names(o.follow)) {
    const [block, ...rest] = path.split('.')
    const handle = ctx.block(block!)
    const series = handle && typeof handle.api.series === 'function' ? (handle.api.series as (n: string) => unknown)(rest.join('.')) : undefined
    if (typeof series !== 'function') { ctx.report(`${id}: follow: '${path}' names nothing that can be followed`, handle ? `${block} offers: ${handle.targets().join(', ')}` : "follow: '<block>.<name>', the block being one of the stage that comes before this chart"); continue }
    followed ??= handle
    curves.push({ name: rest.join('.') || block!, points: () => (series as () => readonly Point[])(), clock: typeof handle!.api.time === 'function' ? (handle!.api.time as () => number) : undefined })
  }
  if (!curves.length) ctx.report(`${id}: the chart has nothing to plot`, "chart({ x: [0, 10], curve: (x) => x * x })  ·  chart({ follow: 'system.queue' })")

  // ── the axes: names, ranges (given, a control's, or fitted to what is plotted at every control's extremes) ─────
  const axisOf = (v: ChartOptions['x']): { name: string; range: readonly number[] | null; control: Param<number> | undefined } => {
    if (isRange(v)) return { name: '', range: v, control: undefined }
    const name = typeof v === 'string' ? v : typeof v === 'object' && v !== null && typeof (v as any).name === 'string' ? (v as any).name : ''
    const control = name ? ctx.control(name) : undefined
    const given = typeof v === 'object' && v !== null && isRange((v as any).range) ? ((v as any).range as readonly number[]) : null
    const def = (control as unknown as { def?: { min: number; max: number } } | undefined)?.def
    return { name, range: given ?? (def ? [def.min, def.max] : null), control }
  }
  const X = axisOf(o.x), Y = axisOf(o.y)
  if (X.control) xControl = X.name
  const pointsNow = (c: Curve, e: Env = env): readonly Point[] => (c.points ? safe(() => c.points!(e), []) : [])
  // fitted once per frame, from everything the sources can show (so the axes hold still while the story runs)
  const ranges: () => { x: readonly number[]; y: readonly number[] } = ctx.s.signal(() => {
    const end = followed && typeof followed.api.end === 'function' ? (followed.api.end as () => number)() : NaN
    const xs: number[] = [], ys: number[] = []
    const sample = (): void => {
      for (const c of curves) for (const p of pointsNow(c)) { xs.push(p[0]!); ys.push(p[1]!) }
      const xr = X.range ?? (xs.length ? fitRange(xs, 0) : look.range)
      for (const c of curves) if (c.fn) for (let i = 0; i <= look.samples; i++) ys.push(safe(() => c.fn!(xr[0]! + ((xr[1]! - xr[0]!) * i) / look.samples, env), NaN))
    }
    sample()
    // the same again with every control the sources read at its lowest and its highest
    for (const name of [...touched]) {
      const def = (ctx.control(name) as unknown as { def?: { min: number; max: number } })?.def
      if (!def) continue
      for (const v of [def.min, def.max]) { forced[name] = v; sample(); delete forced[name] }
    }
    const x = X.range ?? (Number.isFinite(end) && end > 0 ? [0, end] : xs.length ? fitRange(xs, 0) : look.range)
    return { x, y: Y.range ?? fitRange(ys, look.pad) }
  })

  // ── the picture: the engine's axes inside the rectangle (never wider than maxAspect) ───────────────────────────
  const width = Math.min(rect.width, rect.height * look.maxAspect)
  const box = { x: rect.center[0] - width / 2, y: rect.bottom, width, height: rect.height }
  const ax: Handle = axes({ id, x: () => ranges().x, y: () => ranges().y, ...(X.name ? { xLabel: X.name } : {}), ...(Y.name ? { yLabel: Y.name } : {}) }).fit(box)
  const cursorName = o.cursor === false ? null : typeof o.cursor === 'string' ? o.cursor : null
  const cursorBlock = cursorName ? ctx.block(cursorName) : undefined
  const clock: (() => number) | undefined = o.cursor === false ? undefined
    : cursorName ? (ctx.control(cursorName) ?? (cursorBlock && typeof cursorBlock.api.time === 'function' ? (cursorBlock.api.time as () => number) : undefined))
    : X.control ?? curves.find((c) => c.clock)?.clock
  if (cursorName && !clock) ctx.report(`${id}: cursor: '${cursorName}' is neither a control nor a block with a clock`, 'cursor: the name of a control, or the id of a flow / layers block')
  const valueAt = (c: Curve, x: number): number => {
    if (c.fn) return safe(() => c.fn!(x, env), NaN)
    const pts = pointsNow(c)
    if (!pts.length) return NaN
    let k = 0
    while (k < pts.length - 1 && pts[k + 1]![0]! <= x) k++
    const a = pts[k]!, b = pts[Math.min(pts.length - 1, k + 1)]!
    return b[0] === a[0] || x <= a[0]! ? a[1]! : a[1]! + ((b[1]! - a[1]!) * Math.min(1, (x - a[0]!) / (b[0]! - a[0]!)))
  }
  // a curve may be named with a phrase ('lifting by hand'); an id is one word, and a link finds the curve by either
  const wordOf = (name: string): string => name.trim().replace(/[^A-Za-z0-9]+(.)?/g, (_m, ch: string | undefined) => (ch ? ch.toUpperCase() : '')) || 'curve'
  curves.forEach((c, i) => {
    const color = look.colors[i % look.colors.length]!
    const upTo = c.clock ?? (clock && c.points && followed ? clock : undefined)
    c.mob = c.fn
      ? ax.plot((x: number) => c.fn!(x, env), { id: `${id}.${wordOf(c.name)}`, color, to: () => ranges().x[1]! })
      : ax.plot(() => { const pts = pointsNow(c); if (!upTo) return pts; const t = upTo(); const cut = pts.filter((p) => p[0]! <= t); return cut.length ? [...cut, [t, valueAt(c, t)]] : pts.slice(0, 1) }, { id: `${id}.${wordOf(c.name)}`, color })
    if (c.points && !c.clock && !upTo) {
      // as many dots as the list is ever long: now, and with each control it reads at its lowest and its highest
      let n = pointsNow(c).length
      for (const name of [...touched]) {
        const def = (ctx.control(name) as unknown as { def?: { min: number; max: number } })?.def
        if (def) for (const v of [def.min, def.max]) { forced[name] = v; n = Math.max(n, pointsNow(c).length); delete forced[name] }
      }
      n = Math.min(look.dots, n)
      // a dot the list does not reach yet rests on its last point
      for (let k = 0; k < n; k++) ax.dot(() => pointsNow(c)[k] ?? pointsNow(c)[pointsNow(c).length - 1] ?? [NaN, NaN], { id: `${id}.${wordOf(c.name)}${k + 1}`, color }).allow('TINY')
    }
  })
  let cursorDot: Handle | undefined
  if (clock && curves.length) {
    const first = curves[0]!
    ax.vline(clock, { id: `${id}.at`, color: look.cursor, opacity: 0.5 })
    cursorDot = ax.dot(() => [clock(), valueAt(first, clock())], { id: `${id}.cursor`, color: look.cursor }).allow('TINY')
  }

  // ── state ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const curveNames = curves.map((c) => c.name)
  const made: Record<string, Handle> = {}
  const placed: { x: number; label: string; name: Handle; shown: boolean }[] = []
  let tangent: Handle[] = []
  const apply = (st: any, change: unknown, prev: ChartState): ChartState => {
    const { state, problems } = reduceChart(prev, change, curveNames)
    for (const p of problems) ctx.report(`${id}: ${p.what}`, p.fix)
    for (const c of curves) {
      const was = prev.hidden.includes(c.name), is = state.hidden.includes(c.name)
      if (c.mob && was !== is) st.play(is ? fadeOut(c.mob) : fadeIn(c.mob))
    }
    for (const m of state.marks.slice(prev.marks.length)) {
      // a mark is a dashed line through the plot and a name under the axis. The line always stays; a name that would
      // be written over an older one takes its place (a run of marks then names the newest: where the story is now)
      const r = ranges().x, span = Math.max(1e-9, r[1]! - r[0]!)
      const half = (text: string): number => (textWidth(text, 'note') / 2 + look.markGap) / Math.max(1e-9, ctx.rect.width * look.axisShare)
      const key = `mark${Object.keys(made).length + 1}`
      const line = ax.vline(m.x, { id: `${id}.${key}.line`, color: look.mark, opacity: 0.6 })
      const name = ax.mark(m.x, m.label, { id: `${id}.${key}`, color: look.mark })
      made[key] = name
      const over = placed.filter((p) => p.shown && Math.abs(p.x - m.x) / span < half(p.label) + half(m.label))
      st.play(...over.map((p) => fadeOut(p.name)), fadeIn(line), fadeIn(name))
      for (const p of over) p.shown = false
      placed.push({ x: m.x, label: m.label, name, shown: true })
    }
    for (const b of state.bands.slice(prev.bands.length)) st.play(fadeIn(ax.bracket(b.from, b.to, b.label, { color: look.mark })))
    if (state.tangent !== prev.tangent) {
      const leaving = tangent
      tangent = []
      const c = curves.find((k) => k.fn) ?? curves[0]
      if (state.tangent !== null && c) {
        const x0 = state.tangent, r = ranges().x, h = (r[1]! - r[0]!) * look.tangent, d = (r[1]! - r[0]!) * 1e-4
        const at = (): number[][] => { const y0 = valueAt(c, x0), m = (valueAt(c, x0 + d) - valueAt(c, x0 - d)) / (2 * d); return [[x0 - h, y0 - m * h], [x0 + h, y0 + m * h]] }
        tangent = [ax.plot(at, { id: `${id}.tangent${x0}`, color: look.cursor, strokeWidth: 3 }), ax.dot(() => [x0, valueAt(c, x0)], { color: look.cursor }).allow('TINY')]
      }
      st.play(...leaving.map((m) => fadeOut(m)), ...tangent.map((m) => fadeIn(m)))
    }
    if (state.drawTo !== prev.drawTo && state.drawTo !== null) st.play(...curves.filter((c) => c.fn && c.mob).map((c) => c.mob!.to.set({ to: state.drawTo })))
    return state
  }
  const targets = (): string[] => [...curveNames, ...(cursorDot ? ['cursor'] : []), ...Object.keys(made), 'tangent']
  return {
    root: ax,
    initial: { hidden: [], marks: [], bands: [], tangent: null, drawTo: null }, keys: null,
    // the tangent of a step can be named before that step has drawn it: until then the name stands for its curve
    // `plot` and its like name the chart itself, whatever its id is; a curve answers to its name as written and as one word
    target: (path) => (!path || WHOLE.includes(path) ? ax : path === 'cursor' ? cursorDot : path === 'tangent' ? tangent[0] ?? (curves.find((k) => k.fn) ?? curves[0])?.mob : made[path] ?? curves.find((c) => c.name === path || wordOf(c.name) === path || wordOf(c.name) === wordOf(path))?.mob),
    targets,
    apply: apply as BlockHandle<ChartState>['apply'],
    api: { curves: curveNames, value: (name: string, x: number): number => { const c = curves.find((k) => k.name === name) ?? curves[0]; return c ? valueAt(c, x) : NaN }, range: () => ranges() },
    describe: (state) => `${id}: ${Y.name || 'y'} against ${X.name || 'x'}; curves ${curveNames.filter((n) => !state.hidden.includes(n)).join(', ') || 'none'}${state.marks.length ? `; marks at ${state.marks.map((m) => m.x).join(', ')}` : ''}${state.tangent !== null ? `; tangent at ${state.tangent}` : ''}`,
  }
}
