/**
 * ode(): fixed-step integration of dy/dt = f(t, y), exposed as a pure function of time.
 * The run always starts at t = 0 and is cached in checkpoints, so `at(t)` returns bit-identical values for
 * any order of calls (scrubbing, filmstrips and live playback all see the same curve).
 */
import type { Vec2 } from '../types.ts'
import {
  DEFAULT_CHECKPOINT_EVERY, DEFAULT_DT, DEFAULT_MAX_STEPS, StepCache, countOr, errorText, positiveOr, stepIndex,
} from './internal.ts'

/** State of an ODE system: a plain array, or an object of named numbers. */
export type OdeState = number[] | Record<string, number>

/** How one component of a state is addressed: an index for array states, a name for object states. */
export type OdeKey<Y extends OdeState> = Y extends number[] ? number : keyof Y & string

/** Integration scheme: classic Runge-Kutta (default), midpoint (2nd order) or forward Euler (1st order). */
export type OdeMethod = 'rk4' | 'midpoint' | 'euler'

/** Options of `ode()`. */
export interface OdeOptions<Y extends OdeState> {
  /** State at t = 0, e.g. `[1, 0]` or `{ angle: 30, speed: 0 }`. */
  y0: Y
  /** Derivative of the state, in the same shape as `y0`. Must be pure: depend only on `t` and `y`. */
  f: (t: number, y: Y) => Y
  /** Fixed step in seconds (default 1/240). */
  dt?: number
  /** Integration scheme (default 'rk4'). */
  method?: OdeMethod
  /** Steps between stored checkpoints (default 16). Changes memory and speed only, never the values. */
  checkpointEvery?: number
  /** Cap on the number of steps; past it the state holds (default 2,000,000). */
  maxSteps?: number
}

/** A solved ODE as a function of time. */
export interface Ode<Y extends OdeState> {
  /** State at time `t` (a fresh object), linearly interpolated between fixed steps; `t <= 0` gives `y0`. */
  at(t: number): Y
  /** One component at time `t`, without allocating (the cheap form for a dynamic property). */
  value(key: OdeKey<Y>, t: number): number
  /** `n` points `[t, value]` of one component, evenly spaced from `t0` to `t1` inclusive (ready for a plot). */
  series(key: OdeKey<Y>, t0: number, t1: number, n?: number): Vec2[]
  /** Forgets the cache; call it when something `f` reads (a parameter) has changed. */
  reset(): void
  /** The fixed step in use. */
  readonly dt: number
  /** Problems found so far (bad options, `f` threw, non-finite values); empty when all is well. */
  readonly issues: readonly string[]
}

const METHODS: readonly OdeMethod[] = ['rk4', 'midpoint', 'euler']

/** Integrates dy/dt = f(t, y) from t = 0 with a fixed step and returns the state as a function of time. */
export function ode<Y extends OdeState>(options: OdeOptions<Y>): Ode<Y> {
  const issues: string[] = []
  const reported = new Set<string>()
  /** Records the first problem of each kind; later ones of the same kind would only repeat it. */
  const report = (kind: string, message: string): void => {
    if (reported.has(kind)) return
    reported.add(kind)
    issues.push(message)
  }

  const given: unknown = options?.y0
  const shape: Record<string, unknown> | unknown[] =
    given !== null && typeof given === 'object' ? (given as Record<string, unknown>) : []
  const isArray = Array.isArray(shape)
  if (shape !== given) report('y0', 'ode: y0 must be an array of numbers or an object of numbers, e.g. y0: [1, 0]')
  const keys: string[] = isArray ? [] : Object.keys(shape)
  const size = isArray ? (shape as unknown[]).length : keys.length

  const initial = new Float64Array(size)
  for (let k = 0; k < size; k++) {
    const raw = isArray ? (shape as unknown[])[k] : (shape as Record<string, unknown>)[keys[k]!]
    if (typeof raw === 'number' && Number.isFinite(raw)) initial[k] = raw
    else report(`y0.${k}`, `ode: y0.${isArray ? k : keys[k]} is not a finite number; using 0`)
  }

  const f = options?.f
  if (typeof f !== 'function') report('f', 'ode: f must be a function (t, y) => dy; the state will stay at y0')
  const dt = positiveOr(options?.dt, DEFAULT_DT)
  if (options?.dt !== undefined && dt !== options.dt) report('dt', `ode: dt must be a positive number; using ${DEFAULT_DT}`)
  const method: OdeMethod = METHODS.includes(options?.method as OdeMethod) ? (options.method as OdeMethod) : 'rk4'
  if (options?.method !== undefined && method !== options.method) {
    report('method', `ode: unknown method "${String(options.method)}"; using "rk4" (valid: ${METHODS.join(', ')})`)
  }
  const maxSteps = countOr(options?.maxSteps, DEFAULT_MAX_STEPS)
  const every = countOr(options?.checkpointEvery, DEFAULT_CHECKPOINT_EVERY)

  // Scratch buffers: one input handed to f, the stage derivatives and a stage state. Nothing is allocated per step.
  const input: number[] | Record<string, number> = isArray ? new Array<number>(size).fill(0) : {}
  const k1 = new Float64Array(size)
  const k2 = new Float64Array(size)
  const k3 = new Float64Array(size)
  const k4 = new Float64Array(size)
  const stage = new Float64Array(size)
  const output = new Float64Array(size)

  /** Evaluates f(t, state) into `out`; a missing, non-finite or thrown derivative counts as 0 and is reported. */
  const derivative = (t: number, state: Float64Array, out: Float64Array): void => {
    if (typeof f !== 'function') {
      out.fill(0)
      return
    }
    let result: unknown
    if (isArray) {
      const y = input as number[]
      y.length = size
      for (let k = 0; k < size; k++) y[k] = state[k]!
    } else {
      const y = input as Record<string, number>
      for (let k = 0; k < size; k++) y[keys[k]!] = state[k]!
    }
    try {
      result = f(t, input as Y)
    } catch (error) {
      report('threw', `ode: f threw at t=${t}: ${errorText(error)}`)
      out.fill(0)
      return
    }
    if (result === null || typeof result !== 'object') {
      report('shape', `ode: f must return the derivative in the same shape as y0 (got ${result === null ? 'null' : typeof result})`)
      out.fill(0)
      return
    }
    for (let k = 0; k < size; k++) {
      const raw = isArray ? (result as unknown[])[k] : (result as Record<string, unknown>)[keys[k]!]
      if (typeof raw === 'number' && Number.isFinite(raw)) out[k] = raw
      else {
        out[k] = 0
        report('derivative', `ode: f returned ${String(raw)} for "${isArray ? k : keys[k]}" at t=${t}; treated as 0`)
      }
    }
  }

  // Stage times at the two ends of a step are pulled inside it by a hair. For a smooth f this changes nothing
  // measurable; for a switched f (`t < 1 ? a : b`) with the switch on a step boundary it makes every stage of a
  // step see the same side of the switch, which keeps the full accuracy of the method across the switch.
  const inset = dt * 1e-7

  const step = (index: number, from: Float64Array, to: Float64Array): void => {
    const t = index * dt
    if (method === 'euler') {
      derivative(t + inset, from, k1)
      for (let k = 0; k < size; k++) to[k] = from[k]! + dt * k1[k]!
    } else if (method === 'midpoint') {
      derivative(t + inset, from, k1)
      for (let k = 0; k < size; k++) stage[k] = from[k]! + 0.5 * dt * k1[k]!
      derivative(t + 0.5 * dt, stage, k2)
      for (let k = 0; k < size; k++) to[k] = from[k]! + dt * k2[k]!
    } else {
      derivative(t + inset, from, k1)
      for (let k = 0; k < size; k++) stage[k] = from[k]! + 0.5 * dt * k1[k]!
      derivative(t + 0.5 * dt, stage, k2)
      for (let k = 0; k < size; k++) stage[k] = from[k]! + 0.5 * dt * k2[k]!
      derivative(t + 0.5 * dt, stage, k3)
      for (let k = 0; k < size; k++) stage[k] = from[k]! + dt * k3[k]!
      derivative(t + dt - inset, stage, k4)
      for (let k = 0; k < size; k++) to[k] = from[k]! + (dt / 6) * (k1[k]! + 2 * k2[k]! + 2 * k3[k]! + k4[k]!)
    }
    for (let k = 0; k < size; k++) {
      if (!Number.isFinite(to[k]!)) {
        report('diverged', `ode: the state became non-finite at t=${t + dt}; holding the last finite state (reduce dt or check f)`)
        to.set(from)
        return
      }
    }
  }

  const cache = new StepCache(initial, step, every)
  const setupIssues = issues.length
  const setupKinds = new Set(reported)
  /** Forgets cached states and the problems found while running (those found in the options stay). */
  const reset = (): void => {
    cache.reset()
    issues.length = setupIssues
    reported.clear()
    for (const kind of setupKinds) reported.add(kind)
  }

  const position = (t: number): number => {
    if (t > maxSteps * dt) report('limit', `ode: t=${t} is past the ${maxSteps}-step limit; the state holds at t=${maxSteps * dt}`)
    return stepIndex(t, dt, maxSteps)
  }

  const slot = (key: OdeKey<Y>): number => {
    const k = isArray ? (typeof key === 'number' ? key : Number(key)) : keys.indexOf(String(key))
    if (Number.isInteger(k) && k >= 0 && k < size) return k
    report(`key.${String(key)}`, `ode: no state component "${String(key)}" (valid: ${isArray ? `0..${size - 1}` : keys.join(', ')})`)
    return -1
  }

  const at = (t: number): Y => {
    const x = position(t)
    if (isArray) {
      const out = new Array<number>(size)
      cache.sample(x, out)
      return out as Y
    }
    cache.sample(x, output)
    const out: Record<string, number> = {}
    for (let k = 0; k < size; k++) out[keys[k]!] = output[k]!
    return out as Y
  }

  const value = (key: OdeKey<Y>, t: number): number => {
    const k = slot(key)
    return k < 0 ? 0 : cache.component(position(t), k)
  }

  const series = (key: OdeKey<Y>, t0: number, t1: number, n = 200): Vec2[] => {
    const k = slot(key)
    const count = countOr(n, 200)
    const from = Number.isFinite(t0) ? t0 : 0
    const to = Number.isFinite(t1) ? t1 : from
    const points: Vec2[] = new Array(count)
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? to : from + ((to - from) * i) / (count - 1)
      points[i] = [t, k < 0 ? 0 : cache.component(position(t), k)]
    }
    return points
  }

  return { at, value, series, reset, dt, issues }
}
