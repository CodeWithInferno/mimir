/**
 * Stateful-looking helpers that are still pure functions of time: integrating a varying rate, and a smooth
 * follower. Both recompute from t = 0 on a fixed step, so the value at a time never depends on call order.
 */
import {
  DEFAULT_CHECKPOINT_EVERY, DEFAULT_DT, DEFAULT_MAX_STEPS, StepCache, countOr, finiteOr, positiveOr, stepIndex,
} from './internal.ts'

/** Options shared by the cached fixed-step helpers. */
export interface FixedStepOptions {
  /** Fixed step in seconds (default 1/240). */
  dt?: number
  /** Steps between stored checkpoints (default 16). Changes memory and speed only, never the values. */
  checkpointEvery?: number
  /** Cap on the number of steps; past it the value holds (default 2,000,000). */
  maxSteps?: number
}

/** A running integral as a function of time. */
export interface Accumulator {
  /** Integral of the rate from 0 to `t` (negative `t` integrates backwards). */
  at(t: number): number
  /** Forgets the cache; call it when something the rate function reads (a parameter) has changed. */
  reset(): void
}

/** Rate at time t, with anything non-finite counted as 0. */
function rateAt(rateFn: (t: number) => number, t: number): number {
  const rate = rateFn(t)
  return typeof rate === 'number' && Number.isFinite(rate) ? rate : 0
}

/** Offsets of the two Gauss-Legendre points inside a unit interval: 1/2 -+ 1/(2 sqrt 3). */
const GAUSS_LOW = 0.5 - 0.5 / Math.sqrt(3)
const GAUSS_HIGH = 0.5 + 0.5 / Math.sqrt(3)

/**
 * Integral of the rate over [t, t + h] by two-point Gauss-Legendre: exact for rates up to cubic in time, and
 * both samples lie strictly inside the interval, so a rate that switches exactly on a step boundary
 * (`t < 2 ? slow : fast`) is integrated without error.
 */
function slice(rateFn: (t: number) => number, t: number, h: number): number {
  return 0.5 * h * (rateAt(rateFn, t + GAUSS_LOW * h) + rateAt(rateFn, t + GAUSS_HIGH * h))
}

/** Cached integral from 0 to t for t >= 0: whole steps come from the checkpoint cache, the remainder is one more slice. */
function forwardAccumulator(rateFn: (t: number) => number, dt: number, every: number, maxSteps: number): Accumulator {
  const step = (index: number, from: Float64Array, to: Float64Array): void => {
    to[0] = from[0]! + slice(rateFn, index * dt, dt)
  }
  const cache = new StepCache(new Float64Array(1), step, every)
  return {
    at(t) {
      const x = stepIndex(t, dt, maxSteps)
      const index = Math.floor(x)
      const whole = cache.seek(index)[0]!
      return x === index ? whole : whole + slice(rateFn, index * dt, (x - index) * dt)
    },
    reset: () => cache.reset(),
  }
}

/** Cached running integral of `rateFn` from t = 0: `accumulator(t => rpm(t) * 6).at(t)` is a crank angle in degrees. */
export function accumulator(rateFn: (t: number) => number, options: FixedStepOptions = {}): Accumulator {
  const dt = positiveOr(options?.dt, DEFAULT_DT)
  const every = countOr(options?.checkpointEvery, DEFAULT_CHECKPOINT_EVERY)
  const maxSteps = countOr(options?.maxSteps, DEFAULT_MAX_STEPS)
  const rate = typeof rateFn === 'function' ? rateFn : () => 0
  const forward = forwardAccumulator(rate, dt, every, maxSteps)
  let backward: Accumulator | null = null
  return {
    at(t) {
      if (!(t < 0)) return forward.at(t)
      if (backward === null) backward = forwardAccumulator((s) => rate(-s), dt, every, maxSteps)
      return -backward.at(-t)
    },
    reset() {
      forward.reset()
      if (backward !== null) backward.reset()
    },
  }
}

/**
 * Integral of a varying rate from 0 to `t`, recomputed from zero on a fixed step (no hidden state):
 * `accumulate(t => rpm(t) * 6, s.t())` is an angle in degrees that never jumps when the rate changes.
 * It costs two rate evaluations per step (2 t / dt) on every call; `accumulator()` is the cached form.
 */
export function accumulate(rateFn: (t: number) => number, t: number, dt: number = DEFAULT_DT): number {
  if (typeof rateFn !== 'function' || !Number.isFinite(t) || t === 0) return 0
  const step = positiveOr(dt, DEFAULT_DT)
  const rate = t < 0 ? (s: number) => rateFn(-s) : rateFn
  const x = stepIndex(Math.abs(t), step, DEFAULT_MAX_STEPS)
  const whole = Math.floor(x)
  let sum = 0
  for (let index = 0; index < whole; index++) sum += slice(rate, index * step, step)
  if (x !== whole) sum += slice(rate, whole * step, (x - whole) * step)
  return t < 0 ? -sum : sum
}

/** Options of `smoothDamp()`. */
export interface SmoothDampOptions extends FixedStepOptions {
  /** Roughly how long the follower takes to catch up, in seconds (default 0.3). */
  smoothTime?: number
  /** Value at t = 0 (default: the target at t = 0, so it starts settled). */
  from?: number
}

/** A smoothed value as a function of time. */
export interface SmoothDamp {
  /** Smoothed value at time `t`. */
  at(t: number): number
  /** Rate of change of the smoothed value at time `t`, in units per second. */
  velocity(t: number): number
  /** Forgets the cache; call it when something the target function reads (a parameter) has changed. */
  reset(): void
}

/**
 * One step of a critically damped follower (the exact solution for a target held over `dt`, so it is stable
 * for any step size and never overshoots a fixed target). Returns the new `[value, velocity]`.
 */
export function smoothDampStep(value: number, velocity: number, target: number, smoothTime: number, dt: number): [number, number] {
  const time = positiveOr(smoothTime, 0)
  if (time === 0) return [target, 0]
  const omega = 2 / time
  const offset = value - target
  const drive = velocity + omega * offset
  const decay = Math.exp(-omega * dt)
  return [target + (offset + drive * dt) * decay, (velocity - omega * drive * dt) * decay]
}

/**
 * A value that follows `target(t)` smoothly, without overshoot, as a pure function of time:
 * `smoothDamp(t => (t > 1 ? 5 : 0), { smoothTime: 0.4 }).at(t)` eases from 0 to 5 after t = 1.
 */
export function smoothDamp(target: number | ((t: number) => number), options: SmoothDampOptions = {}): SmoothDamp {
  const dt = positiveOr(options?.dt, DEFAULT_DT)
  const every = countOr(options?.checkpointEvery, DEFAULT_CHECKPOINT_EVERY)
  const maxSteps = countOr(options?.maxSteps, DEFAULT_MAX_STEPS)
  const smoothTime = options?.smoothTime === undefined ? 0.3 : positiveOr(options.smoothTime, 0)
  const goal = (t: number): number => finiteOr(typeof target === 'function' ? target(t) : target, 0)

  const step = (index: number, from: Float64Array, to: Float64Array): void => {
    const result = smoothDampStep(from[0]!, from[1]!, goal((index + 0.5) * dt), smoothTime, dt)
    to[0] = result[0]
    to[1] = result[1]
  }
  // Built on first use so that constructing a follower never calls the target function.
  let cache: StepCache | null = null
  const read = (t: number, k: number): number => {
    if (cache === null) cache = new StepCache(new Float64Array([finiteOr(options?.from, goal(0)), 0]), step, every)
    return cache.component(stepIndex(t, dt, maxSteps), k)
  }

  return {
    at: (t) => (smoothTime === 0 ? goal(t > 0 ? t : 0) : read(t, 0)),
    velocity: (t) => (smoothTime === 0 ? 0 : read(t, 1)),
    reset: () => {
      cache = null
    },
  }
}
