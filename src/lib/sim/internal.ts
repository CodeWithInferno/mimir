/**
 * Shared internals of the sim library: the fixed-step checkpoint cache and plain-data snapshots.
 * Not re-exported from index.ts; the public surface is in the sibling files.
 */

/** Default fixed step of every simulator: 240 steps per simulated second. */
export const DEFAULT_DT = 1 / 240

/** Default cap on fixed steps per simulator (2.3 hours of simulated time at the default step). */
export const DEFAULT_MAX_STEPS = 2_000_000

/** Default distance, in steps, between stored checkpoints. */
export const DEFAULT_CHECKPOINT_EVERY = 16

/** Returns `value` when it is a finite number greater than zero, otherwise `fallback`. */
export function positiveOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/** Returns `value` floored when it is a finite number of at least one, otherwise `fallback`. */
export function countOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback
}

/** Returns `value` when it is a finite number, otherwise `fallback`. */
export function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Converts a time to a fractional step index in [0, maxSteps]; values within 1e-9 of a whole step snap to it
 * so that step-aligned times never pay for (or jitter around) an extra step.
 */
export function stepIndex(t: number, dt: number, maxSteps: number): number {
  if (!(t > 0)) return 0
  const x = t / dt
  if (x >= maxSteps) return maxSteps
  const nearest = Math.round(x)
  return Math.abs(x - nearest) <= 1e-9 * Math.max(1, nearest) ? nearest : x
}

/** Short text of a thrown value for an issue message. */
export function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/** One fixed step: read the state at step `index` from `from`, write the state at `index + 1` into `to`. */
export type StepFunction = (index: number, from: Float64Array, to: Float64Array) => void

/**
 * State of a fixed-step simulation at any step index, recomputed from step 0 and cached.
 *
 * Every K-th state is stored as a checkpoint and a cursor holds the most recent state, so access is O(1)
 * amortised for increasing indices and at most K steps for random ones. The state at step i is always the
 * result of the same i applications of `step` to the initial state, so results are bit-identical whatever
 * the order of calls.
 */
export class StepCache {
  private current: Float64Array
  private following: Float64Array
  private index = 0
  private followingReady = false
  private checkpoints: Float64Array[]

  constructor(
    private readonly initial: Float64Array,
    private readonly step: StepFunction,
    private readonly every: number,
  ) {
    this.current = initial.slice()
    this.following = new Float64Array(initial.length)
    this.checkpoints = [initial.slice()]
  }

  /** Drops everything computed so far (call when the step function's inputs changed). */
  reset(): void {
    this.current.set(this.initial)
    this.index = 0
    this.followingReady = false
    this.checkpoints = [this.initial.slice()]
  }

  /** State at whole step `i` (i >= 0). The returned buffer is only valid until the next call. */
  seek(i: number): Float64Array {
    if (i === this.index) return this.current
    if (i === this.index + 1 && this.followingReady) {
      this.advance()
      return this.current
    }
    const checkpoint = Math.min(Math.floor(i / this.every), this.checkpoints.length - 1)
    const checkpointStep = checkpoint * this.every
    if (!(i > this.index && this.index >= checkpointStep)) {
      this.current.set(this.checkpoints[checkpoint]!)
      this.index = checkpointStep
    }
    this.followingReady = false
    while (this.index < i) {
      this.step(this.index, this.current, this.following)
      this.advance()
    }
    return this.current
  }

  /** State one step after the last `seek`. The returned buffer is only valid until the next call. */
  next(): Float64Array {
    if (!this.followingReady) {
      this.step(this.index, this.current, this.following)
      this.followingReady = true
    }
    return this.following
  }

  /** Component `k` of the state at fractional step `x`, linearly interpolated between whole steps. */
  component(x: number, k: number): number {
    const i = Math.floor(x)
    const u = x - i
    const a = this.seek(i)[k]!
    return u === 0 ? a : a + (this.next()[k]! - a) * u
  }

  /** Writes the state at fractional step `x`, linearly interpolated between whole steps, into `out`. */
  sample(x: number, out: number[] | Float64Array): void {
    const i = Math.floor(x)
    const u = x - i
    const a = this.seek(i)
    if (u === 0) {
      for (let k = 0; k < a.length; k++) out[k] = a[k]!
      return
    }
    const b = this.next()
    for (let k = 0; k < a.length; k++) out[k] = a[k]! + (b[k]! - a[k]!) * u
  }

  private advance(): void {
    const swap = this.current
    this.current = this.following
    this.following = swap
    this.index++
    this.followingReady = false
    if (this.index % this.every === 0 && this.index / this.every === this.checkpoints.length) {
      this.checkpoints.push(this.current.slice())
    }
  }
}

const MAX_SNAPSHOT_DEPTH = 64

/**
 * Deep copy of plain data (arrays, plain objects, Map, Set, Date, typed arrays); anything else (class
 * instances, functions) is shared by reference. With `freeze`, the copied arrays and plain objects are frozen.
 */
export function snapshot<T>(value: T, freeze: boolean, depth = 0): T {
  if (value === null || typeof value !== 'object' || depth > MAX_SNAPSHOT_DEPTH) return value
  if (Array.isArray(value)) {
    const copy: unknown[] = new Array(value.length)
    for (let i = 0; i < value.length; i++) copy[i] = snapshot(value[i], freeze, depth + 1)
    return (freeze ? Object.freeze(copy) : copy) as T
  }
  if (value instanceof Map) {
    const copy = new Map<unknown, unknown>()
    for (const [key, item] of value) copy.set(key, snapshot(item, freeze, depth + 1))
    return copy as T
  }
  if (value instanceof Set) {
    const copy = new Set<unknown>()
    for (const item of value) copy.add(snapshot(item, freeze, depth + 1))
    return copy as T
  }
  if (value instanceof Date) return new Date(value.getTime()) as T
  if (ArrayBuffer.isView(value)) {
    const view = value as unknown as { slice?: () => unknown }
    return (typeof view.slice === 'function' ? view.slice() : value) as T
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return value
  const source = value as Record<string, unknown>
  const copy: Record<string, unknown> = prototype === null ? Object.create(null) : {}
  for (const key of Object.keys(source)) copy[key] = snapshot(source[key], freeze, depth + 1)
  return (freeze ? Object.freeze(copy) : copy) as T
}
