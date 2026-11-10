// scene(opts, build) → SceneDef; compile(def) runs the builder ONCE as a recorder and returns the SceneModel.
// The `s` methods (param, step, viewport …) are installed with defineSceneMethod, like any extension.
import { ctx } from './context.ts'
import { callSite, closest, type Src } from './diagnostics.ts'
import { makeRng } from './math.ts'
import { anim, defineSceneMethod, reportProblems, SceneHandle } from './registry.ts'
import { validateOptions, type Schema } from './schema.ts'
import { closeStep, Step, StepRec, type Anim } from './timeline.ts'
import { PACE, type RateFn } from './rate.ts'
import { FRAME_H, FRAME_W, SceneModel, type ParamDef, type ParamValue, type SceneOpts } from './model.ts'
import type { MNode } from './node.ts'

export interface SceneDef { readonly isSceneDef: true; opts: SceneOpts; build: (s: any) => void; /** the options as written, checked when the scene is compiled */ given?: unknown; /** where scene() was called */ src?: Src }
export const isSceneDef = (v: unknown): v is SceneDef => typeof v === 'object' && v !== null && (v as SceneDef).isSceneDef === true

/** `export default scene({ title }, s => { … })` */
export function scene(opts: SceneOpts | ((s: any) => void), build?: (s: any) => void): SceneDef {
  const src = callSite()
  if (typeof opts === 'function') return { isSceneDef: true, opts: { title: '' }, build: opts, src }
  return { isSceneDef: true, opts: { title: String(opts?.title ?? ''), subtitle: opts?.subtitle === undefined ? undefined : String(opts.subtitle), ...(opts?.defaults === undefined ? {} : { defaults: opts.defaults }) }, build: typeof build === 'function' ? build : () => {}, given: opts, src }
}
const SCENE: Schema = { title: { type: 'string', dynamic: false, example: "title: 'How a piston works'" }, subtitle: { type: 'string', dynamic: false }, defaults: { type: 'any', dynamic: false, example: 'defaults: { pace: { play: 1.5 } }' } }
const isThenable = (v: unknown): v is PromiseLike<unknown> => typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function'
/** A builder or a step function that is `async` stops recording at its first await: say so, and keep the rejection from going unhandled. */
function notAsync(model: SceneModel, out: unknown, what: string, src: Src | undefined): void {
  if (!isThenable(out)) return
  Promise.resolve(out).then(undefined, () => {})
  model.diagnostics.add({ code: 'API-TYPE', what: `${what} is async (it returned a promise): the scene is recorded in one synchronous pass, so everything after its first \`await\` is lost.`, fix: ['remove `async` and the `await`s inside it', 'load data with a top-level `await` before `export default scene(…)`'] }, src)
}

/** Run the builder once and return the recorded model. Never throws: failures become diagnostics. */
export function compile(def: SceneDef, o: { file?: string | null } = {}): SceneModel {
  // nodes created at module top level (before scene() ran its builder) are in the ambient model: keep them
  const model = ctx.model && !ctx.model.finalized ? ctx.model : new SceneModel()
  model.opts = def?.opts ?? { title: '' }
  model.file = o.file ?? null
  model.diagnostics.context.file = model.file
  const prev = { model: ctx.model, building: ctx.building, step: ctx.step, frame: ctx.frame }
  ctx.model = model
  ctx.building = true
  ctx.step = null
  ctx.frame = null
  try {
    if (!isSceneDef(def)) throw new TypeError('the scene module must `export default scene({ title }, s => { … })`')
    if (def.given !== undefined) reportProblems(model, validateOptions('scene()', def.given, SCENE, { name: 'title', config: 'defaults', settings: 'defaults' }, model).problems, [], def.src)
    // settings first: everything the builder creates reads them
    if (def.opts.defaults !== undefined) model.settings.set(def.opts.defaults, 'scene({ defaults })', def.src ?? null)
    model.settings.checkProject()
    notAsync(model, def.build(new SceneHandle(model)), 'the scene builder', def.src)
  } catch (e) {
    model.reportError(e, 'the scene builder')
  } finally {
    ctx.building = prev.building
    ctx.step = prev.step
    ctx.frame = prev.frame
    ctx.model = prev.model === model ? null : prev.model
  }
  model.finalize()
  return model
}

// ── params and signals ───────────────────────────────────────────────────────────────────────────────
export interface Param<T extends ParamValue = number> {
  (): T
  readonly isParam: true
  readonly def: ParamDef
  readonly value: T
  /** tween to a value: st.play(p.to(180)) */
  to(v: T, opts?: { duration?: number; rate?: RateFn }): Anim
}
export const isParam = (v: unknown): v is Param<ParamValue> => typeof v === 'function' && (v as { isParam?: boolean }).isParam === true

function makeParam(model: SceneModel, def: ParamDef): Param<ParamValue> {
  const existing = model.params.find((p) => p.name === def.name)
  if (existing) model.diagnostics.add({ code: 'ID-DUP', what: `two params are both called "${def.name}".`, fix: ['give each param its own name'] })
  else model.params.push(def)
  const d = existing ?? def
  const p = (() => model.now().param(d)) as Param<ParamValue>
  Object.defineProperties(p, {
    isParam: { value: true },
    def: { value: d },
    name: { value: d.name },
    value: { get: () => p() },
    to: {
      value: (v: ParamValue, opts: { duration?: number; rate?: RateFn } = {}) =>
        anim('param', opts?.duration ?? PACE.play, (rec, at, duration, rate) => { rec.clip(d, 'value', v, { at, duration: d.kind === 'number' ? duration : 0, rate: rate ?? opts?.rate }) }),
    },
  })
  return p
}

const HIDDEN = { type: 'boolean', dynamic: false, example: 'hidden: true' } as const
/** under which heading a viewer offers a param ('' = none) */
const GROUP = { type: 'string', dynamic: false, example: "group: 'Engine'" } as const
const groupOf = (o: object): string => { const g = (o as { group?: unknown }).group; return typeof g === 'string' ? g : '' }
const PARAM: Schema = {
  value: { type: 'number', dynamic: false, example: 'value: 0' }, min: { type: 'number', dynamic: false }, max: { type: 'number', dynamic: false },
  step: { type: 'positive', dynamic: false }, unit: { type: 'string', dynamic: false }, label: { type: 'string', dynamic: false },
  cyclic: { type: 'boolean', dynamic: false, example: 'cyclic: true' }, period: { type: 'positive', dynamic: false, example: 'period: 360' }, group: GROUP, hidden: HIDDEN,
}
/** units that say "degrees": a param in degrees whose range is a whole number of turns goes round unless it says `cyclic: false` */
export const DEGREE_UNITS = ['°', 'deg', 'degrees']
/** one turn, in degrees */
export const TURN = 360
/**
 * Does a number param go round, and how long is one cycle? Said by the scene (`cyclic`, `period`); when it says
 * nothing, a param whose unit is degrees and whose range is a whole number of turns does. Never read off its name.
 */
export function cycleOf(o: { cyclic?: boolean; period?: number; unit?: string }, min: number, max: number): { cyclic: boolean; period: number } {
  const span = max - min
  if (o.cyclic === false || !(span > 0)) return { cyclic: false, period: 0 }
  if (o.period !== undefined) return { cyclic: true, period: o.period }
  if (o.cyclic === true) return { cyclic: true, period: DEGREE_UNITS.includes((o.unit ?? '').trim().toLowerCase()) && wholeTurns(span) ? TURN : span }
  return DEGREE_UNITS.includes((o.unit ?? '').trim().toLowerCase()) && wholeTurns(span) ? { cyclic: true, period: TURN } : { cyclic: false, period: 0 }
}
const wholeTurns = (span: number): boolean => span >= TURN && Math.abs(span / TURN - Math.round(span / TURN)) < 1e-9
defineSceneMethod('param', (s, name: unknown, opts: unknown) => {
  const model = s.model
  const call = 's.param()'
  if (typeof name !== 'string' || !name) { model.diagnostics.add({ code: 'API-TYPE', what: `${call} needs a name as its first argument.`, fix: ["s.param('speed', { value: 1, min: 0, max: 10 })"] }); name = `param${model.params.length + 1}` }
  const v = validateOptions(call, opts, PARAM, { default: 'value', initial: 'value' }, model)
  reportProblems(model, v.problems, [])
  const o = v.props as { value?: number; min?: number; max?: number; step?: number; unit?: string; label?: string; cyclic?: boolean; period?: number; hidden?: boolean }
  let min = o.min ?? Math.min(0, o.value ?? 0), max = o.max ?? Math.max(1, o.value ?? 1)
  if (min > max) { model.diagnostics.add({ code: 'NUM-INVALID', what: `${call}: min ${min} is greater than max ${max}.`, fix: [`min: ${max}, max: ${min}`] }); [min, max] = [max, min] }
  const value = o.value ?? min
  if (o.cyclic === false && o.period !== undefined) model.diagnostics.add({ code: 'API-TYPE', what: `${call}: "${name as string}" has a period (${o.period}) and says cyclic: false.`, fix: ['drop `cyclic: false` (a period makes the param cyclic)', 'or drop `period`'] })
  return makeParam(model, { name: name as string, kind: 'number', value, min, max, step: o.step ?? 0, unit: o.unit ?? '', label: o.label ?? (name as string), options: [], ...cycleOf(o, min, max), group: groupOf(o), hidden: o.hidden === true, src: callSite() })
})
defineSceneMethod('toggle', (s, name: unknown, opts: unknown) => {
  const v = validateOptions('s.toggle()', opts, { value: { type: 'boolean', dynamic: false }, label: { type: 'string', dynamic: false }, group: GROUP, hidden: HIDDEN }, undefined, s.model)
  reportProblems(s.model, v.problems, [])
  const n = typeof name === 'string' && name ? name : `toggle${s.model.params.length + 1}`
  return makeParam(s.model, { name: n, kind: 'toggle', value: (v.props.value as boolean | undefined) ?? false, min: 0, max: 1, step: 1, unit: '', label: (v.props.label as string | undefined) ?? n, options: [], cyclic: false, period: 0, group: groupOf(v.props), hidden: v.props.hidden === true, src: callSite() })
})
defineSceneMethod('choice', (s, name: unknown, opts: unknown) => {
  const model = s.model
  const o = (typeof opts === 'object' && opts !== null ? opts : {}) as { options?: unknown; value?: unknown; label?: unknown; hidden?: unknown }
  const options = Array.isArray(o.options) ? o.options.map(String) : []
  if (!options.length) model.diagnostics.add({ code: 'API-TYPE', what: 's.choice() needs options: a list of names.', fix: ["s.choice('mode', { options: ['slow', 'fast'], value: 'slow' })"] })
  let value = typeof o.value === 'string' ? o.value : options[0] ?? ''
  if (options.length && !options.includes(value)) {
    const near = closest(value, options)
    model.diagnostics.add({ code: 'API-UNKNOWN', what: `s.choice(): value "${value}" is not one of the options.`, fix: [near ? `use "${near}"` : `use one of: ${options.join(', ')}`] })
    value = options[0]!
  }
  const n = typeof name === 'string' && name ? name : `choice${model.params.length + 1}`
  return makeParam(model, { name: n, kind: 'choice', value, min: 0, max: Math.max(0, options.length - 1), step: 1, unit: '', label: typeof o.label === 'string' ? o.label : n, options, cyclic: false, period: 0, group: groupOf(o), hidden: o.hidden === true, src: callSite() })
})
/**
 * s.state(name, initial, { options?, min?, max? }): a value only the story drives (st.set(state, v), state.to(v)): a
 * param without a control in the viewer. true / false makes a switch, a number a number (its range is the initial
 * value unless min / max say more), a string one of `options`.
 */
defineSceneMethod('state', (s, name: unknown, initial: unknown, opts?: unknown) => {
  const model = s.model
  const call = 's.state()'
  const n = typeof name === 'string' && name ? name : `state${model.params.length + 1}`
  if (typeof name !== 'string' || !name) model.diagnostics.add({ code: 'API-TYPE', what: `${call} needs a name as its first argument.`, fix: ["s.state('lit', false)"] })
  const v = validateOptions(call, opts, { options: { type: { array: 'string' }, dynamic: false, example: "options: ['idle', 'busy']" }, min: { type: 'number', dynamic: false }, max: { type: 'number', dynamic: false }, label: { type: 'string', dynamic: false } }, undefined, model)
  reportProblems(model, v.problems, [])
  const o = v.props as { options?: string[]; min?: number; max?: number; label?: string }
  const base = { name: n, step: 0, unit: '', label: o.label ?? n, cyclic: false, period: 0, group: '', hidden: true, src: callSite() }
  if (typeof initial === 'boolean') return makeParam(model, { ...base, kind: 'toggle', value: initial, min: 0, max: 1, step: 1, options: [] })
  if (typeof initial === 'number' && Number.isFinite(initial)) return makeParam(model, { ...base, kind: 'number', value: initial, min: Math.min(o.min ?? initial, initial), max: Math.max(o.max ?? initial, initial), options: [] })
  if (typeof initial === 'string') {
    const options = o.options?.length ? o.options : [initial]
    if (!o.options?.length) model.diagnostics.add({ code: 'API-TYPE', what: `${call}: "${n}" starts as the text "${initial}" and names no other value it can take.`, fix: [`s.state('${n}', '${initial}', { options: ['${initial}', 'other'] })`] })
    else if (!options.includes(initial)) { const near = closest(initial, options); model.diagnostics.add({ code: 'API-UNKNOWN', what: `${call}: the initial value "${initial}" is not one of the options.`, fix: [near ? `use "${near}"` : `use one of: ${options.join(', ')}`] }) }
    return makeParam(model, { ...base, kind: 'choice', value: options.includes(initial) ? initial : options[0]!, min: 0, max: Math.max(0, options.length - 1), step: 1, options })
  }
  model.diagnostics.add({ code: typeof initial === 'number' ? 'NUM-INVALID' : 'API-TYPE', what: `${call}: the initial value must be true / false, a finite number or a text, got ${String(initial)}.`, fix: ["s.state('lit', false)", "s.state('count', 0)"] })
  return makeParam(model, { ...base, kind: 'toggle', value: false, min: 0, max: 1, step: 1, options: [] })
})

/** s.t(): simulation time in seconds. */
defineSceneMethod('t', (s) => s.model.now().t)
/** s.signal(fn): a derived value, computed at most once per frame. */
defineSceneMethod('signal', (s, fn: unknown) => {
  const model = s.model
  if (typeof fn !== 'function') { model.diagnostics.add({ code: 'API-TYPE', what: 's.signal() expects a function.', fix: ['s.signal(() => speed() * 2)'] }); return () => fn }
  const src = callSite()
  const sig = (): unknown => {
    const f = model.now()
    const v = f.memo<unknown>(sig, () => f.value(fn, undefined, null, `the signal defined at line ${src.line ?? '?'}`), CYCLE)
    if (v !== CYCLE) return v
    // DESIGN §3.1: signals are cycle-checked. The value has no answer; say which signal, not "width became NaN"
    model.diagnostics.add({ code: 'RUNTIME-ERROR', step: null, t: null, what: `the signal defined at line ${src.line ?? '?'} depends on itself (through the signals and functions it reads).`, fix: ['break the cycle: compute one of the values from params and s.t() only'] }, src)
    return NaN
  }
  return sig
})
const CYCLE = Symbol('cycle')
/** s.probe(name, fn): expose a number to check / shot. */
defineSceneMethod('probe', (s, name: unknown, fn: unknown) => {
  if (typeof name !== 'string' || typeof fn !== 'function') { s.model.diagnostics.add({ code: 'API-TYPE', what: 's.probe() expects a name and a function.', fix: ["s.probe('pistonHeight', () => piston.world()[1])"] }); return undefined }
  s.model.probes.set(name, fn as () => unknown)
  return fn
})
/** s.rng(seed): the only randomness. Draw the numbers while building the scene, not inside per-frame functions. */
defineSceneMethod('rng', (_s, seed: unknown = 1) => makeRng(typeof seed === 'number' || typeof seed === 'string' ? seed : 1))

// ── steps ────────────────────────────────────────────────────────────────────────────────────────────
defineSceneMethod('step', (s, title: unknown, fn: unknown) => {
  const model = s.model
  if (typeof title === 'function' && fn === undefined) { fn = title; title = '' }
  if (typeof fn !== 'function') { model.diagnostics.add({ code: 'API-TYPE', what: 's.step() expects a title and a function.', fix: ["s.step('Intake', st => { st.say('…') })"] }); return undefined }
  if (ctx.step) {
    // steps cannot nest: report it and record the inner body as part of the step that is open
    model.diagnostics.add({ code: 'API-TYPE', what: `s.step("${String(title)}") was called inside step ${ctx.step.k}; steps cannot be nested, so its body was recorded as part of step ${ctx.step.k}.`, fix: ['move this s.step(...) out of the other step'] })
    try { notAsync(model, (fn as (st: Step) => unknown)(new Step(model, ctx.step)), `the function of step "${String(title)}"`, callSite()) } catch (e) { model.reportError(e, `step ${ctx.step.k}`) }
    return undefined
  }
  const outer = ctx.step
  const prev = model.steps[model.steps.length - 1]
  const rec = new StepRec(model.steps.length, typeof title === 'string' ? title : String(title ?? ''), callSite())
  rec.t0 = prev ? prev.t1 : 0
  model.steps.push(rec)
  // the step belongs to the open chapter; the first step of a chapter starts after the stage has been cleared
  const chapter = model.chapters[model.chapters.length - 1]
  if (chapter) {
    rec.chapter = chapter.index
    if (chapter.firstStep < 0) {
      chapter.firstStep = rec.index
      const kept = new Set<MNode>()
      const down = (n: MNode): void => { kept.add(n); n.children.forEach(down) }
      chapter.keep.forEach(down)
      // the opening takes time when something has to leave, or when the 2D camera has to come back from a zoom (a reset in no time is a jump cut)
      const zooms = model.camera2dClips()
      const zoomed = !chapter.keepCamera && zooms.length > 0 && zooms[zooms.length - 1]!.to !== null
      chapter.clear = rec.t0 > 0 && (zoomed || chapter.stage.some((n) => !kept.has(n))) ? PACE.chapterClear : 0
      rec.cursor = chapter.clear
    }
  }
  const dc = model.diagnostics.context
  const saved = { step: dc.step, stepTitle: dc.stepTitle }
  dc.step = rec.k
  dc.stepTitle = rec.title
  ctx.step = rec
  try {
    notAsync(model, (fn as (st: Step) => unknown)(new Step(model, rec)), `the function of step ${rec.k} "${rec.title}"`, rec.src)
  } catch (e) {
    rec.error = String((e as Error)?.message ?? e)
    model.reportError(e, `step ${rec.k} "${rec.title}"`)
  } finally {
    closeStep(rec)
    ctx.step = outer
    dc.step = saved.step
    dc.stepTitle = saved.stepTitle
  }
  return undefined
})

// ── chapters (DESIGN §3.4) ───────────────────────────────────────────────────────────────────────────
/**
 * s.chapter(title, { keep }): start a chapter of a long explanation. When its first step begins, everything on stage
 * except `keep` leaves with a lagged fade and the cameras ease back to the whole picture (`keepCamera: true` leaves
 * them where they are); the steps that follow belong to it. Objects created
 * after this call (outside a step) appear when the chapter opens.
 */
defineSceneMethod('chapter', (s, title: unknown, opts?: unknown) => {
  const model = s.model
  if (ctx.step) { model.diagnostics.add({ code: 'API-TYPE', what: `s.chapter("${String(title)}") was called inside step ${ctx.step.k}; a chapter starts between steps.`, fix: ['move s.chapter(...) out of the step, before the s.step(...) that opens it'] }); return undefined }
  if (typeof title !== 'string' || !title.trim()) { model.diagnostics.add({ code: 'API-TYPE', what: `s.chapter() needs a title, got ${typeof title === 'string' ? 'an empty string' : typeof title}.`, fix: ["s.chapter('Tokens become vectors')"] }); title = `Chapter ${model.chapters.length + 1}` }
  const v = validateOptions('s.chapter()', opts, { keep: { type: 'nodes', example: 'keep: [title]' }, keepCamera: { type: 'boolean', dynamic: false, example: 'keepCamera: true' } }, { keeps: 'keep', camera: 'keepCamera' }, model)
  reportProblems(model, v.problems, [])
  const last = model.chapters[model.chapters.length - 1]
  if (last && last.firstStep < 0) model.diagnostics.add({ code: 'API-TYPE', what: `chapter "${last.title}" has no steps: s.chapter("${title as string}") follows it directly.`, fix: [`add at least one s.step(...) after s.chapter("${last.title}")`, 'or delete the empty chapter'] }, last.src)
  model.chapters.push({ index: model.chapters.length, title: (title as string).trim(), firstStep: -1, keep: (v.props.keep as MNode[] | undefined) ?? [], stage: model.nodes.slice(), clear: 0, keepCamera: v.props.keepCamera === true, src: callSite() })
  model.revision++
  return undefined
})

// ── stage ────────────────────────────────────────────────────────────────────────────────────────────
/** A rectangle of the frame with convenience fields. x, y is the MIN corner (left, bottom). */
export interface Area { x: number; y: number; width: number; height: number; center: [number, number]; left: number; right: number; top: number; bottom: number }
const area = (x: number, y: number, width: number, height: number): Area => ({ x, y, width, height, center: [x + width / 2, y + height / 2], left: x, right: x + width, bottom: y, top: y + height })
const SIDES = ['full', 'left', 'right', 'top', 'bottom'] as const
type Side = (typeof SIDES)[number]
function region(side: Side, fraction: number): Area {
  const W = FRAME_W, H = FRAME_H
  switch (side) {
    case 'left': return area(-W / 2, -H / 2, W * fraction, H)
    case 'right': return area(W / 2 - W * fraction, -H / 2, W * fraction, H)
    case 'top': return area(-W / 2, H / 2 - H * fraction, W, H * fraction)
    case 'bottom': return area(-W / 2, -H / 2, W, H * fraction)
    default: return area(-W / 2, -H / 2, W, H)
  }
}
const OTHER: Record<string, Side> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }
function parseSide(model: SceneModel, call: string, where: unknown): Side | null {
  if (typeof where === 'string' && (SIDES as readonly string[]).includes(where)) return where as Side
  const near = typeof where === 'string' ? closest(where, SIDES) : null
  model.diagnostics.add({ code: typeof where === 'string' ? 'API-UNKNOWN' : 'API-TYPE', what: `${call}: "${String(where)}" is not a region of the frame.`, fix: [near ? `use '${near}'` : `use 'full', 'left', 'right', 'top' or 'bottom'`] })
  return null
}
const fractionOf = (model: SceneModel, call: string, f: unknown, dflt: number): number => {
  if (f === undefined) return dflt
  if (typeof f === 'number' && f > 0.05 && f <= 1) return f
  model.diagnostics.add({ code: typeof f === 'number' ? 'NUM-INVALID' : 'API-TYPE', what: `${call}: fraction must be a number between 0.05 and 1, got ${String(f)}.`, fix: [`${call.replace('()', '')}('left', 0.6)`] })
  return dflt
}
/** s.viewport(where, fraction?): where the 3D panel sits. Returns its rectangle. */
defineSceneMethod('viewport', (s, where: unknown = 'full', fraction?: unknown) => {
  const model = s.model
  const call = 's.viewport()'
  if (typeof where === 'object' && where !== null) {
    const v = validateOptions(call, where, { x: { type: 'number', dynamic: false, default: 0 }, y: { type: 'number', dynamic: false, default: 0 }, width: { type: 'positive', dynamic: false }, height: { type: 'positive', dynamic: false } }, undefined, model)
    reportProblems(model, v.problems, [])
    const width = (v.props.width as number | undefined) ?? FRAME_W / 2, height = (v.props.height as number | undefined) ?? FRAME_H
    model.viewport = { cx: (v.props.x as number | undefined) ?? 0, cy: (v.props.y as number | undefined) ?? 0, width, height, where: 'custom' }
  } else {
    const side = parseSide(model, call, where) ?? 'full'
    const r = region(side, side === 'full' ? 1 : fractionOf(model, call, fraction, 0.6))
    model.viewport = { cx: r.center[0], cy: r.center[1], width: r.width, height: r.height, where: side }
  }
  model.revision++
  const v = model.viewport
  return area(v.cx - v.width / 2, v.cy - v.height / 2, v.width, v.height)
})
/** s.area(where?, fraction?): a region for 2D content, inset by the safe margin. With a viewport and no fraction, the part it leaves free. */
defineSceneMethod('area', (s, where?: unknown, fraction?: unknown) => {
  const model = s.model
  const call = 's.area()'
  const vp = model.viewport
  let side: Side
  if (where === undefined) side = vp && OTHER[vp.where] ? OTHER[vp.where]! : 'full'
  else side = parseSide(model, call, where) ?? 'full'
  let frac = 0.5
  if (vp && OTHER[vp.where] === side) frac = 1 - (vp.where === 'left' || vp.where === 'right' ? vp.width / FRAME_W : vp.height / FRAME_H)
  frac = fractionOf(model, call, fraction, frac)
  const r = region(side, side === 'full' ? 1 : frac)
  const m = 0.5
  return area(r.x + m, r.y + m, Math.max(0.1, r.width - 2 * m), Math.max(0.1, r.height - 2 * m))
})

// ── settings ─────────────────────────────────────────────────────────────────────────────────────────
/**
 * s.config({ pace: { play: 1.5 } }) sets settings of this scene (nested groups or dotted keys: 'pace.play'); what was
 * built before the call keeps the old values, so it belongs on the first line (or in scene({ defaults })).
 * s.config('pace.play') reads the value in force.
 */
defineSceneMethod('config', (s, values: unknown) => {
  if (typeof values === 'string') return s.model.config(values)
  if (s.model.finalized) { s.model.late('s.config()'); return s }
  s.model.settings.set(values, 's.config()', callSite())
  s.model.revision++
  return s
})
