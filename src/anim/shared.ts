// What every verb shares: the named defaults, the { duration, rate, lag, span } options, the staggering of parts,
// target checks, and measuring where things are "at rest" (without the displacement an animation is applying).
import {
  anim, boxCenter, boxSize, currentModel, Frame, isAnim, isNode, kindOf, MAX_SECONDS, NOOP_ANIM, PACE, reportProblems, spec, toVec3, validateOptions,
  type Anim, type Box3, type MNode, type RateFn, type Schema, type SceneModel, type Step, type Vec3,
} from '../core/index.ts'

/**
 * Defaults of the verbs, in one place (the project research notes: manim's class defaults and what 3Blue1Brown
 * types). Where a comment names an option, that option overrides the default per call; the others are constants of
 * the look, changed here. Durations are in PACE (core) and every verb takes `duration`.
 */
export const VERB_DEFAULTS = {
  /** write: the lag between glyphs is min(writeLagSpread / (glyphs + 1), writeLagMax) of one glyph's time (option `lag`) */
  writeLagSpread: 4,
  writeLagMax: 0.2,
  /** write: glyphs under this count take PACE.write seconds, otherwise PACE.writeLong (option `duration`) */
  writeLongFrom: 15,
  /** create / uncreate on a group: the parts are drawn one after another (option `lag`) */
  createLag: 1,
  /** grow: the size it starts from (0 would make a shape with no size) */
  growStart: 0.001,
  /** derive from a 3D part or a point: share of the time over which the outline that lifts off appears */
  deriveAppear: 0.15,
  /** fadeTransform / derive of text and groups: the most an object is scaled up or down while it is carried to another box */
  carryScaleMax: 2.5,
  /** derive from a point: radius of the dot the shape grows out of, in frame units */
  pointRadius: 0.02,
  /** flashAround: colour, stroke width, gap around the object, and the share of the outline the pulse covers (options color, strokeWidth, buff, timeWidth) */
  flashColor: '#FFFF00',
  flashStroke: 4,
  flashBuff: 0.1,
  flashTimeWidth: 1,
  /** indicate: how much it swells and the colour it takes on the way (options scale, color) */
  indicateScale: 1.2,
  indicateColor: '#FFFF00',
  /** vary: seconds of rest at each stop on the way (option `hold`); a leg takes PACE.sweep seconds (option `duration`) */
  varyHold: 0,
} as const
/**
 * The defaults of this module as one scene sees them: `VERB_DEFAULTS`, with whatever the engine's config store holds under
 * 'anim.<name>' (model.config('anim.<name>', fallback), when the core has one). Worked out once per scene.
 */
export const verbDefaults = (model: SceneModel): typeof VERB_DEFAULTS => model.store<typeof VERB_DEFAULTS>('anim.defaults', () => {
  const ask = (model as unknown as { config?: (key: string, fallback: unknown) => unknown }).config
  if (typeof ask !== 'function') return VERB_DEFAULTS
  const out = { ...VERB_DEFAULTS } as Record<string, unknown>
  for (const key of Object.keys(out)) { const v = ask.call(model, 'anim.' + key, out[key]); if (v !== undefined && typeof v === typeof out[key]) out[key] = v }
  return out as typeof VERB_DEFAULTS
})

/** The options every verb takes. */
export interface Timing { duration?: number; rate?: RateFn; lag?: number; span?: [number, number] }
const TIMING: Schema = {
  duration: { type: 'positive', dynamic: false, example: 'duration: 2' },
  rate: { type: 'fn', example: 'rate: smooth' },
  lag: { type: 'nonneg', dynamic: false, example: 'lag: 0.1' },
  span: { type: { array: 'number', min: 2, max: 2 }, dynamic: false, example: 'span: [1, 2]' },
}
/** manim's spellings, accepted silently */
const ALIASES = { runTime: 'duration', run_time: 'duration', rateFunc: 'rate', rate_func: 'rate', lagRatio: 'lag', lag_ratio: 'lag', timeSpan: 'span', time_span: 'span' }

/** Validate the options of a verb call: the common four plus the verb's own. Problems are reported; bad values are dropped. */
export function options(call: string, opts: unknown, own: Schema, model: SceneModel, ids: string[], aliases?: Record<string, string>): Timing & Record<string, any> {
  const v = validateOptions(call, opts, { ...TIMING, ...own }, { ...ALIASES, ...aliases }, model)
  reportProblems(model, v.problems, ids)
  const o = v.props as Timing & Record<string, any>
  if (o.duration !== undefined && o.duration > MAX_SECONDS) {
    model.diagnostics.add({ code: 'NUM-INVALID', ids, measured: o.duration, limit: MAX_SECONDS, what: `${call}: ${o.duration} s is longer than any single move may be (${MAX_SECONDS} s).`, fix: ['durations are seconds: duration: 2'] })
    delete o.duration
  }
  if (o.span) {
    const [a, b] = o.span
    if (!(Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b > a && b <= MAX_SECONDS)) {
      model.diagnostics.add({ code: 'NUM-INVALID', ids, measured: `[${a}, ${b}]`, what: `${call}: span [${a}, ${b}] is not a stretch of time; it is [start, end] in seconds from the start of the play, with 0 <= start < end.`, fix: ['span: [1, 2]'] })
      delete o.span
    }
  }
  return o
}

/**
 * Build the Anim of a verb. `record(rec, at, duration, rate)` appends the clips. With `span: [t0, t1]` the verb only
 * occupies that stretch of the play it is part of (manim's time_span): the play lasts at least until t1.
 * A rate given to the verb wins over the rate of the play.
 */
export function make(verb: string, o: Timing, fallback: number, record: (rec: Step, at: number, duration: number, rate: RateFn | undefined) => void): Anim {
  const own = o.duration ?? fallback
  const span = o.span
  const total = span ? Math.max(span[1], o.duration ?? 0) : own
  return anim(verb, total, (rec, at, d, rate) => {
    const k = total > 0 ? d / total : 1
    if (span) record(rec, at + span[0] * k, (span[1] - span[0]) * k, o.rate ?? rate)
    else record(rec, at, d, o.rate ?? rate)
  }, o.rate)
}

/** manim's lag_ratio inside one animation: part i of n occupies [i·lag, i·lag + 1] / ((n − 1)·lag + 1) of the time. Returns [start, duration] per part. */
export function windows(n: number, lag: number, at: number, duration: number): [number, number][] {
  const full = (Math.max(n, 1) - 1) * lag + 1
  return Array.from({ length: n }, (_, i) => [at + ((i * lag) / full) * duration, duration / full] as [number, number])
}
/** What a lag staggers: the members of a group (row, column …), or the object itself. */
export const parts = (node: MNode): MNode[] => (kindOf(node.kind)?.container && node.children.length ? node.children : [node])
/** The nodes under `node` that draw something (the node itself when it is not a group). */
export function leaves(node: MNode): MNode[] {
  if (!kindOf(node.kind)?.container) return [node]
  return node.children.flatMap(leaves)
}

// ── targets ──────────────────────────────────────────────────────────────────────────────────────────
export const no = (verb: string, duration: number = PACE.enter): Anim => NOOP_ANIM(verb, duration)
/** Report a verb used on something it cannot act on (DESIGN D9: a diagnostic, never a silent no-op). */
export function wrong(node: MNode | null, call: string, what: string, fix: string[], code = 'API-TYPE'): void {
  (node?.model ?? currentModel()).diagnostics.add({ code, ids: node ? [node.id] : [], what: `${call}: ${what}`, fix })
}
/** true for kinds drawn between points (lines, arrows, edges): they have no transform of their own to scale or turn */
export const isWorldGeometry = (node: MNode): boolean => kindOf(node.kind)?.worldGeometry === true
/** a line-like kind: it runs from an option `a` to an option `b`, both points */
export function isLineLike(node: MNode): boolean {
  const schema = kindOf(node.kind)?.schema
  return !!schema && Object.hasOwn(schema, 'a') && Object.hasOwn(schema, 'b') && spec(schema.a!).type === 'point' && spec(schema.b!).type === 'point'
}
/** does the kind of this node have this option, of one of these types? */
export function hasOption(node: MNode, name: string, types?: readonly unknown[]): boolean {
  const schema = kindOf(node.kind)?.schema
  if (!schema || !Object.hasOwn(schema, name)) return false
  return !types || types.includes(spec(schema[name]!).type)
}
export const NUMERIC: readonly unknown[] = ['number', 'positive', 'nonneg', 'unit', 'int']
/** [dx, dy(, dz)] option → vector; reports and returns null when it is not one */
export function vectorOf(node: MNode, call: string, name: string, v: unknown): Vec3 | null {
  if (v === undefined) return null
  const s = toVec3(v)
  if (s && s.every(Number.isFinite)) return s
  wrong(node, call, `${name} must be a vector such as UP or [0, 0.5].`, [`${call.replace('()', '')}(m, { ${name}: UP })`])
  return null
}
export { isAnim, isNode }

// ── where things are, without what an animation is doing to them ──────────────────────────────────────
// A clip that carries an object towards another one needs both boxes as they are when nothing is being carried:
// otherwise the function would ask for the very displacement it is computing. The answer comes from a scratch frame
// of the same time, params and view, evaluated while `measuring` is set: every displacement function of this module
// then returns its neutral value. Nothing is kept between frames.
let measuring = 0
/** true while a scratch frame is being measured: displacement functions return their neutral value */
export const atRest = (): boolean => measuring > 0
/** Evaluate `fn` on the scratch frame of `frame` in which no verb of this module displaces anything. */
export function plain<T>(frame: Frame, fn: (f: Frame) => T): T {
  const f = frame.memo('anim.plain', () => new Frame(frame.model, frame.tau, frame.overrides, frame.view), frame)
  measuring++
  try { return fn(f) } finally { measuring-- }
}

/** How `node` has to move and scale so that its box lands on the box of `other` (both at rest). */
export interface Carry { /** value of the node's `offset` channel */ offset: Vec3; /** value of its `enterScale` channel */ scale: number }
const sizeRatio = (a: Box3, b: Box3): number => {
  const sa = boxSize(a), sb = boxSize(b)
  // by height (glyphs keep their size ratio), by width for something flat; a box with no size keeps its scale
  const r = sa[1] > 1e-6 && sb[1] > 1e-6 ? sb[1] / sa[1] : sa[0] > 1e-6 && sb[0] > 1e-6 ? sb[0] / sa[0] : 1
  return Math.min(Math.max(r, 1 / VERB_DEFAULTS.carryScaleMax), VERB_DEFAULTS.carryScaleMax)
}
/** `start` = the scale to use instead of the ratio of the two boxes (an object that grows out of a point). */
export function carryTo(frame: Frame, node: MNode, other: MNode | ((f: Frame) => Box3), start?: number): Carry {
  const key = 'anim.carry:' + node.uid + ':' + (isNode(other) ? other.uid : 'point')
  const compute = (): Carry => plain(frame, (f) => {
    const mine = f.bounds(node)
    const theirs = isNode(other) ? f.boxIn(node, other) : other(f)
    const scale = isWorldGeometry(node) ? 1 : start ?? sizeRatio(mine, theirs)
    const o = f.world(node).p, ca = boxCenter(mine), cb = boxCenter(theirs)
    // scaling is about the node's origin: centre(u) = origin + offset + scale · (centre − origin)
    const offset: Vec3 = [cb[0] - o[0] - scale * (ca[0] - o[0]), cb[1] - o[1] - scale * (ca[1] - o[1]), node.space === '3d' ? cb[2] - o[2] - scale * (ca[2] - o[2]) : 0]
    return offset.every(Number.isFinite) && Number.isFinite(scale) ? { offset, scale } : { offset: [0, 0, 0], scale: 1 }
  })
  return frame.memo(key, compute, { offset: [0, 0, 0], scale: 1 })
}
