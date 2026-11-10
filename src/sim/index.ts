// Simulations in the scene API: ode(), events(), stepper(), integrate(). The numerics are src/lib/sim (fixed step,
// recomputed from t = 0, cached in checkpoints); this file makes them part of a scene:
//   - the time they are asked for defaults to s.t(), so `sim.at()` inside any dynamic option is "the state now";
//   - whatever a simulation's functions read (params, s.t(), other objects) is read AS IT WAS AT THAT SIMULATED MOMENT
//     of the story, so a slider the story sweeps is felt as a quantity that changes over time, not as a jump of the
//     whole history; a slider the viewer holds is a constant, and gets a trajectory of its own (cached per value);
//   - problems become diagnostics with the scene line: SIM-UNSTABLE, NUM-INVALID, RUNTIME-ERROR, API-TYPE.
// Nothing here keeps state between frames that changes an answer: every cache is keyed on its inputs.
import { callSite, ctx, currentModel, type Frame, type SceneModel, type Src } from '../core/index.ts'
import { accumulate, accumulator, events as runEvents, ode as solveOde, stepper as recordStepper } from '../lib/sim/index.ts'
import type { Accumulator, EventRecord, EventStep, Events, Ode, OdeKey, OdeMethod, OdeState, StepPhase, Stepper, StepperSource } from '../lib/sim/index.ts'
import type { Rng } from '../lib/sim/index.ts'

/** Named defaults of the simulation helpers. Every one can be overridden per call (the option of the same name). */
export const SIM_DEFAULTS = {
  /** fixed step of ode(), seconds: 240 steps per simulated second */
  dt: 1 / 240,
  /** fixed step of integrate(), seconds */
  integrateStep: 1 / 120,
  /** seconds each state of a stepper() is shown for by atTime() / phase() */
  stepSeconds: 1,
  /** how many trajectories are kept per simulation (one per set of values the viewer has pinned the params to) */
  variants: 8,
  /** `mimir check`: an ode() whose state changes by more than this share when the step is halved is SIM-UNSTABLE */
  tolerance: 0.02,
  /** an ode() state that grows past this many times its starting size (at least 1) has run away: SIM-UNSTABLE, and it is held there */
  runaway: 1e9,
}

/**
 * The defaults of this module as one scene sees them: `SIM_DEFAULTS`, with whatever the engine's config store holds under
 * 'sim.<name>' (model.config('sim.<name>', fallback), when the core has one). Worked out once per scene.
 */
export const simDefaults = (model: SceneModel): typeof SIM_DEFAULTS => model.store<typeof SIM_DEFAULTS>('sim.defaults', () => {
  const ask = (model as unknown as { config?: (key: string, fallback: unknown) => unknown }).config
  if (typeof ask !== 'function') return SIM_DEFAULTS
  const out = { ...SIM_DEFAULTS } as Record<string, unknown>
  for (const key of Object.keys(out)) { const v = ask.call(model, 'sim.' + key, out[key]); if (v !== undefined && typeof v === typeof out[key]) out[key] = v }
  return out as typeof SIM_DEFAULTS
})

// ── the story at a simulated moment ───────────────────────────────────────────────────────────────────
/** Story time at which simulation time first reaches `t` (the inverse of model.simTime; steps may run the clock slower, faster or not at all). */
export function storyTimeOf(model: SceneModel, t: number): number {
  if (!(t > 0)) return 0
  let done = 0
  for (const s of model.steps) {
    const span = (s.t1 - s.t0) * s.clockSpeed
    if (span > 0 && done + span >= t) return s.t0 + (t - done) / s.clockSpeed
    done += span
  }
  const last = model.steps[model.steps.length - 1]
  if (!last) return t
  return last.clockSpeed > 0 ? last.t1 + (t - done) / last.clockSpeed : last.t1
}
/** The frame the calling code reads from right now. */
const nowOf = (model: SceneModel): Frame => (ctx.frame && ctx.frame.model === model ? ctx.frame : model.now())
/** Order-stable text of the params a frame is pinned to (the viewer's sliders, a check sample). */
const pinsOf = (frame: Frame): string => { const o = frame.overrides; return Object.keys(o).sort().map((k) => `${k}=${String(o[k])}`).join('&') }

/**
 * Frames of the story by simulation time, with the same pinned params as `base`: what the functions of a simulation
 * read from. One frame serves a whole fixed step (the stages of a Runge-Kutta step are one moment of the story).
 */
function pastFrames(model: SceneModel, base: Frame, step: number): (t: number) => Frame {
  let index = NaN
  let frame: Frame = base
  return (t) => {
    const i = Math.floor(t / step + 1e-6)
    // the middle of the step: a param that is being swept is then integrated to second order
    if (i !== index) { index = i; frame = model.state(storyTimeOf(model, Math.max(0, (i + 0.5) * step)), base.overrides, base.view) }
    return frame
  }
}

// ── one instance per set of pinned params ─────────────────────────────────────────────────────────────
interface Variant<T> { inst: T; reported: number }
/** Keeps one instance of a simulation per key (LRU), and forgets them all when the recorded scene changes. */
class Variants<T extends { issues: readonly string[] }> {
  private map = new Map<string, Variant<T>>()
  private revision = -1
  /** true while one of this simulation's own functions runs: a call back into it then would corrupt its cache */
  busy = false
  constructor(readonly model: SceneModel, readonly call: string, readonly src: Src, private readonly make: (frame: Frame) => T, private readonly limit: number) {}
  get(frame: Frame, key: string): Variant<T> {
    if (this.revision !== this.model.revision) { this.map.clear(); this.revision = this.model.revision }
    let v = this.map.get(key)
    if (v) { this.map.delete(key); this.map.set(key, v); return v }
    v = { inst: this.make(frame), reported: 0 }
    this.map.set(key, v)
    if (this.map.size > this.limit) this.map.delete(this.map.keys().next().value as string)
    return v
  }
  /** Run a query on the instance for the frame being evaluated; new problems of the library become diagnostics. */
  ask<R>(key: (frame: Frame) => string, fn: (inst: T, frame: Frame) => R, fallback: () => R): R {
    const frame = nowOf(this.model)
    if (this.busy) {
      this.model.diagnostics.add({ code: 'RUNTIME-ERROR', what: `${this.call}: its own function reads the simulation's result (directly, or through an object that follows it), so the answer would depend on itself.`, fix: ['make the function depend only on its arguments, on params and on s.t()'] }, this.src)
      return fallback()
    }
    const v = this.get(frame, key(frame))
    this.busy = true
    let out: R
    try { out = fn(v.inst, frame) } finally { this.busy = false }
    this.report(v, frame)
    return out
  }
  /** problems already told, by kind: a problem of the equation itself shows up in every trajectory, and is said once */
  private told = new Set<string>()
  private report(v: Variant<T>, frame: Frame): void {
    const issues = v.inst.issues
    for (; v.reported < issues.length; v.reported++) {
      const text = issues[v.reported]!.replace(/^\w+: /, '').replace(/(\d+\.\d{3})\d+/g, '$1')
      const kind = text.replace(/-?\d+(\.\d+)?(e[+-]?\d+)?/gi, '#')
      if (this.told.has(kind)) continue
      this.told.add(kind)
      const when = frame.paramClause()
      const more = when ? { params: { ...frame.overrides } } : {}
      const hint = frame.reproHint()
      if (/non-finite at t=|f returned (-?Infinity|NaN) /.test(text)) {
        const at = /at t=([-\d.e+]+)/i.exec(text)?.[1]
        this.model.diagnostics.add({ code: 'SIM-UNSTABLE', severity: 'error', what: `${this.call}: the solution blows up${at ? ` at t=${trim(Number(at))}s` : ''}${when ? ` ${when}` : ''}: a value became infinite, not a number, or more than ${SIM_DEFAULTS.runaway.toExponential(0)} times its starting size. The state is held from there.`, fix: ['use a smaller step: dt: ' + trim(stepOf(v.inst) / 4), 'or check f: a sign that makes it grow instead of settle, or a division by a value that reaches zero', ...hint], ...more }, this.src)
      } else if (/threw/.test(text)) this.model.diagnostics.add({ code: 'RUNTIME-ERROR', what: `${this.call}: ${text}${when ? ` (${when})` : ''}.`, fix: [`fix the function passed to ${this.call} (line ${this.src.line ?? '?'}): it threw; the simulation kept its last state`, ...hint], ...more }, this.src)
      else if (/must |unknown method|no state component|expected an array|f returned /.test(text)) this.model.diagnostics.add({ code: 'API-TYPE', what: `${this.call}: ${text}.`, fix: [EXAMPLE[this.call] ?? this.call] }, this.src)
      else this.model.diagnostics.add({ code: 'NUM-INVALID', what: `${this.call}: ${text}${when ? ` (${when})` : ''}.`, fix: [`make the function passed to ${this.call} return finite numbers for every state it can reach`, ...hint], ...more }, this.src)
    }
  }
}
const EXAMPLE: Record<string, string> = {
  'ode()': 'ode({ y0: { angle: 30, speed: 0 }, f: (t, y) => ({ angle: y.speed, speed: -9.81 * y.angle }) })',
  'events()': 'events({ init: { queue: 0 }, next: (state, rng) => ({ after: rng.exponential(1), apply: (s) => { s.queue++ } }) })',
  'stepper()': 'stepper(function* () { let x = 4; while (x > 0.01) { yield { x }; x *= 0.5 } })',
  'integrate()': 'const angle = integrate(() => rpm() * 6)',
}
const stepOf = (inst: unknown): number => (typeof (inst as { dt?: unknown }).dt === 'number' ? (inst as { dt: number }).dt : SIM_DEFAULTS.dt)
const trim = (x: number): string => String(Number(x.toPrecision(3)))
const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const timeOr = (t: unknown, frame: Frame): number => (typeof t === 'number' && Number.isFinite(t) ? t : frame.t)

/** What `mimir check` needs to measure a simulation again with half the step (src/sim/check.ts). */
export interface SimRecord { call: string; src: Src; dt: number; tolerance: number; /** largest state difference between the step in use and half of it at sim time `t`, as a share of the state's size; null when it cannot be measured */ drift(frame: Frame): { share: number; t: number } | null }
/** Every simulation a scene declared, in order. */
export const simsOf = (model: SceneModel): SimRecord[] => model.store<SimRecord[]>('sim.records', () => [])

// ── ode ───────────────────────────────────────────────────────────────────────────────────────────────
/** A solved ordinary differential equation as a function of simulation time. */
export interface SceneOde<Y extends OdeState> {
  /** State at simulation time `t` (default: now, s.t()). */
  at(t?: number): Y
  /** One component of the state at time `t` (default: now): the cheap form for a dynamic option. */
  value(key: OdeKey<Y>, t?: number): number
  /** `n` points [t, value] of one component from `t0` to `t1` (default 200): ready for a plot. */
  series(key: OdeKey<Y>, t0: number, t1: number, n?: number): [number, number][]
  /** The fixed step in use, seconds. */
  readonly dt: number
}
/** Options of ode(). */
export interface SceneOdeOptions<Y extends OdeState> { y0: Y; f: (t: number, y: Y) => Y; dt?: number; method?: OdeMethod; tolerance?: number }

/**
 * ode({ y0, f, dt }): integrate dy/dt = f(t, y) from t = 0 with a fixed step. The result is a pure function of time:
 * scrub anywhere, in any order, and get the same state.
 */
export function ode<Y extends OdeState>(options: SceneOdeOptions<Y>): SceneOde<Y> {
  const model = currentModel()
  const src = callSite()
  const call = 'ode()'
  const o: Partial<SceneOdeOptions<Y>> = isPlain(options) ? options : {}
  if (!isPlain(options)) model.diagnostics.add({ code: 'API-TYPE', what: `${call} expects an options object, got ${options === null ? 'null' : typeof options}.`, fix: [EXAMPLE[call]!] }, src)
  for (const name of Object.keys(o)) if (!['y0', 'f', 'dt', 'method', 'tolerance'].includes(name)) model.diagnostics.add({ code: 'API-UNKNOWN', what: `${call} has no option "${name}".`, fix: ['Valid options: y0, f, dt, method, tolerance.'] }, src)
  const dt = typeof o.dt === 'number' && o.dt > 0 && Number.isFinite(o.dt) ? o.dt : SIM_DEFAULTS.dt
  const tolerance = typeof o.tolerance === 'number' && o.tolerance > 0 ? o.tolerance : SIM_DEFAULTS.tolerance
  const f = o.f
  const y0 = o.y0 as Y
  const isArray = Array.isArray(y0)
  const blank = (): Y => (isArray ? [...(y0 as number[])] : { ...(y0 as Record<string, number>) }) as Y
  // a state far beyond where it started has run away (an unstable step, a wrong sign): finite, but nothing to draw
  const names = isArray ? (y0 as number[]).map((_, i) => i) : isPlain(y0) ? Object.keys(y0) : []
  let start = 1
  for (const k of names) { const v = (y0 as Record<string | number, number>)[k]; if (typeof v === 'number' && Number.isFinite(v)) start = Math.max(start, Math.abs(v)) }
  const bound = start * SIM_DEFAULTS.runaway
  const lost = (y: Y): boolean => { for (const k of names) if (Math.abs((y as Record<string | number, number>)[k]!) > bound) return true; return false }
  /** what the library takes as "no derivative here": it reports it once and holds the state */
  const none = (): Y => (isArray ? names.map(() => NaN) : Object.fromEntries(names.map((k) => [k, NaN]))) as Y
  /** the solver for one set of pinned params: f runs in the frame of the simulated moment */
  const solver = (step: number) => (frame: Frame): Ode<Y> => {
    const at = pastFrames(model, frame, step)
    return solveOde<Y>({ y0, dt: step, method: o.method, f: typeof f === 'function' ? (t, y) => (lost(y) ? none() : at(t).run(() => f(t, y))) : (f as never) })
  }
  const main = new Variants<Ode<Y>>(model, call, src, solver(dt), SIM_DEFAULTS.variants)
  // options that are wrong are reported once, now, not at the first frame that asks
  for (const issue of solveOde<Y>({ y0, dt: o.dt, method: o.method, f: f as never }).issues) {
    const text = issue.replace(/^\w+: /, '')
    model.diagnostics.add({ code: /not a finite number|dt must/.test(text) ? 'NUM-INVALID' : 'API-TYPE', what: `${call}: ${text}.`, fix: [EXAMPLE[call]!] }, src)
  }
  // the same equation with half the step, built only when check asks
  let half: Variants<Ode<Y>> | null = null
  const keys = names
  simsOf(model).push({
    call, src, dt, tolerance,
    drift(frame) {
      if (typeof f !== 'function' || !keys.length) return null
      const t = frame.t
      if (!(t > 0)) return null
      half ??= new Variants<Ode<Y>>(model, call, src, solver(dt / 2), 2)
      const twin = half
      return frame.run(() => {
        // the size of the state over the run so far is the yardstick: a value that passes through zero is not "100% off"
        const coarse = main.ask(pinsOf, (inst) => keys.map((k) => inst.value(k as OdeKey<Y>, t)), () => [])
        const fine = twin.ask(pinsOf, (inst) => keys.map((k) => inst.value(k as OdeKey<Y>, t)), () => [])
        const scale = main.ask(pinsOf, (inst) => keys.map((k) => { let m = 0; for (let i = 0; i <= 16; i++) m = Math.max(m, Math.abs(inst.value(k as OdeKey<Y>, (t * i) / 16))); return m }), () => [])
        let share = 0
        for (let i = 0; i < coarse.length; i++) { const size = Math.max(scale[i] ?? 0, 1e-9); share = Math.max(share, Math.abs(coarse[i]! - fine[i]!) / size) }
        return { share, t }
      })
    },
  })
  return {
    at: (t) => main.ask(pinsOf, (inst, frame) => inst.at(timeOr(t, frame)), blank),
    value: (key, t) => main.ask(pinsOf, (inst, frame) => inst.value(key, timeOr(t, frame)), () => 0),
    series: (key, t0, t1, n) => main.ask(pinsOf, (inst) => inst.series(key, t0, t1, n), () => []),
    dt,
  }
}

// ── events ────────────────────────────────────────────────────────────────────────────────────────────
/** A discrete-event simulation as a function of simulation time. */
export interface SceneEvents<S> {
  /** State at simulation time `t` (default: now, s.t()): the result of every event up to then. Frozen: do not mutate. */
  at(t?: number): S
  /** The latest event at time `t`: { index, t, label, state }. `t - entry.t` is the time since it happened. */
  entry(t?: number): EventRecord<S>
  /** Every event up to time `t`, oldest first (entry 0 is the initial state). */
  history(t?: number): readonly EventRecord<S>[]
}
/** Options of events(). */
export interface SceneEventsOptions<S> { init: S; next: (state: S, rng: Rng, t: number) => EventStep<S> | null | undefined; seed?: number | string; maxEvents?: number }

/**
 * events({ init, next, seed }): a seeded discrete-event simulation (arrivals, queues, retries, messages). `next` says
 * what happens next and when; the state at any time is recomputed from the start, so it is the same in any order.
 */
export function events<S>(options: SceneEventsOptions<S>): SceneEvents<S> {
  const model = currentModel()
  const src = callSite()
  const call = 'events()'
  const o: Partial<SceneEventsOptions<S>> = isPlain(options) ? options : {}
  if (!isPlain(options)) model.diagnostics.add({ code: 'API-TYPE', what: `${call} expects an options object, got ${options === null ? 'null' : typeof options}.`, fix: [EXAMPLE[call]!] }, src)
  else if (typeof o.next !== 'function') model.diagnostics.add({ code: 'API-TYPE', what: `${call}: next must be a function (state, rng, t) => { after, apply } | null.`, fix: [EXAMPLE[call]!] }, src)
  for (const name of Object.keys(o)) if (!['init', 'next', 'seed', 'maxEvents'].includes(name)) model.diagnostics.add({ code: 'API-UNKNOWN', what: `${call} has no option "${name}".`, fix: ['Valid options: init, next, seed, maxEvents.'] }, src)
  const next = o.next
  const variants = new Variants<Events<S>>(model, call, src, (frame) => {
    // an event happens at one moment: next and apply read the story as it was then
    const at = pastFrames(model, frame, 1e-3)
    return runEvents<S>({
      init: o.init as S, seed: o.seed, maxEvents: o.maxEvents,
      next: typeof next === 'function' ? (state, rng, t) => {
        const step = at(t).run(() => next(state, rng, t))
        if (!step || typeof step.apply !== 'function') return step
        const apply = step.apply
        return { ...step, apply: (s: S, when: number) => at(when).run(() => apply.call(step, s, when)) }
      } : (next as never),
    })
  }, SIM_DEFAULTS.variants)
  const first = (): EventRecord<S> => ({ index: 0, t: 0, label: 'init', state: o.init as S })
  return {
    at: (t) => variants.ask(pinsOf, (inst, frame) => inst.at(timeOr(t, frame)), () => o.init as S),
    entry: (t) => variants.ask(pinsOf, (inst, frame) => inst.entry(timeOr(t, frame)), first),
    history: (t) => variants.ask(pinsOf, (inst, frame) => inst.history(timeOr(t, frame)), () => [first()]),
  }
}

// ── stepper ───────────────────────────────────────────────────────────────────────────────────────────
/** The recorded states of an algorithm, by index or by time. */
export interface SceneStepper<T> {
  /** Number of recorded states. */
  readonly count: number
  /** Every state, in order (frozen). */
  readonly states: readonly T[]
  /** State number `i` (floored, clamped to the first and last). */
  at(i: number): T
  /** The state shown at simulation time `t` (default: now) when each one lasts `stepSeconds`. */
  atTime(t?: number): T
  /** { index, progress } at time `t` (default: now): which state, and how far to the next (0..1), for tweening between two states. */
  phase(t?: number): StepPhase
}

/**
 * stepper(states | generator, { stepSeconds }): record the states of an algorithm (a sort, a search, gradient descent)
 * and address them by index or by time. A generator function is run again whenever a param it reads has another
 * value, so a slider re-runs the algorithm.
 */
export function stepper<T>(source: StepperSource<T>, options: { stepSeconds?: number; maxSteps?: number } = {}): SceneStepper<T> {
  const model = currentModel()
  const src = callSite()
  const call = 'stepper()'
  const o = isPlain(options) ? options : {}
  for (const name of Object.keys(o)) if (!['stepSeconds', 'maxSteps'].includes(name)) model.diagnostics.add({ code: 'API-UNKNOWN', what: `${call} has no option "${name}".`, fix: ['Valid options: stepSeconds, maxSteps.'] }, src)
  const seconds = typeof o.stepSeconds === 'number' && o.stepSeconds > 0 && Number.isFinite(o.stepSeconds) ? o.stepSeconds : SIM_DEFAULTS.stepSeconds
  if (o.stepSeconds !== undefined && seconds !== o.stepSeconds) model.diagnostics.add({ code: 'NUM-INVALID', what: `${call}: stepSeconds must be a positive number of seconds, got ${String(o.stepSeconds)}.`, fix: ['stepSeconds: 0.5'] }, src)
  const variants = new Variants<Stepper<T>>(model, call, src, (frame) => frame.run(() => recordStepper<T>(source, { maxSteps: o.maxSteps as number | undefined })), SIM_DEFAULTS.variants)
  // an algorithm has no clock of its own: it is a function of the values the params have NOW (a list is recorded once)
  const key = typeof source === 'function' ? (frame: Frame): string => model.params.map((p) => String(frame.param(p))).join('&') : (): string => ''
  const empty = (): Stepper<T> => recordStepper<T>([])
  const timing = { stepSeconds: seconds }
  // recorded now, so that a generator that throws is reported on the line that made it
  variants.ask(key, () => 0, () => 0)
  return {
    get count() { return variants.ask(key, (inst) => inst.count, () => 0) },
    get states() { return variants.ask(key, (inst) => inst.states, () => empty().states) },
    at: (i) => variants.ask(key, (inst) => inst.at(i), () => undefined as T),
    atTime: (t) => variants.ask(key, (inst, frame) => inst.atTime(timeOr(t, frame), timing), () => undefined as T),
    phase: (t) => variants.ask(key, (inst, frame) => inst.phase(timeOr(t, frame), timing), () => ({ index: 0, progress: 0 })),
  }
}

// ── integrate ─────────────────────────────────────────────────────────────────────────────────────────
/** A running integral: call it for its value now (it is a dynamic value), or `.at(t)` for another time. */
export interface Integral { (): number; at(t: number): number }

/**
 * integrate(rate): the running integral of a rate over simulation time, e.g. an angle from a speed that changes:
 * `const angle = integrate(() => rpm() * 6)` then `.rotate({ about: 'z', deg: angle })`. The rate is read as it was at
 * every past moment of the story, so a speed the story sweeps turns into an angle that never jumps.
 */
export function integrate(rate: (t: number) => number, options?: { dt?: number } | number): Integral {
  const model = currentModel()
  const src = callSite()
  const call = 'integrate()'
  if (typeof rate !== 'function') {
    model.diagnostics.add({ code: 'API-TYPE', what: `${call} expects a function that returns the rate, got ${rate === null ? 'null' : typeof rate}.`, fix: [EXAMPLE[call]!] }, src)
    const k = typeof rate === 'number' && Number.isFinite(rate) ? rate : 0
    rate = () => k
  }
  // integrate(rate, t): the integral up to an explicit time, with the rate taken as written (a plain function of time)
  if (typeof options === 'number') return accumulate(rate, options) as unknown as Integral
  const o = isPlain(options) ? options : {}
  const dt = typeof o.dt === 'number' && o.dt > 0 && Number.isFinite(o.dt) ? o.dt : SIM_DEFAULTS.integrateStep
  if (o.dt !== undefined && dt !== o.dt) model.diagnostics.add({ code: 'NUM-INVALID', what: `${call}: dt must be a positive number of seconds, got ${String(o.dt)}.`, fix: ['dt: 0.01'] }, src)
  const fn = rate
  let bad = false
  const variants = new Variants<Accumulator & { issues: readonly string[] }>(model, call, src, (frame) => {
    const at = pastFrames(model, frame, dt)
    const acc = accumulator((t) => {
      const v = at(t).value<unknown>(() => fn(t), 0, null, `the rate of ${call}`)
      if (typeof v === 'number' && Number.isFinite(v)) return v
      if (!bad) { bad = true; model.diagnostics.add({ code: 'NUM-INVALID', measured: String(v), what: `${call}: the rate became ${String(v)} at t=${trim(t)}s; it counts as 0 there.`, fix: ['make the rate function return a finite number at every time'] }, src) }
      return 0
    }, { dt })
    return { at: acc.at, reset: acc.reset, issues: [] }
  }, SIM_DEFAULTS.variants)
  const read = (t?: number): number => variants.ask(pinsOf, (inst, frame) => inst.at(timeOr(t, frame)), () => 0)
  const out = (() => read()) as Integral
  out.at = (t) => read(t)
  return out
}

export type { EventRecord, EventStep, OdeKey, OdeMethod, OdeState, Rng, StepPhase, StepperSource }
/** On demand: this module's API is its own chunk (mimir.simapi.js), loaded before a scene that uses one of its names. */
export const lazy = true
export const api = { ode, events, stepper, integrate }
