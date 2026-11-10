/**
 * stepper(): the recorded states of an algorithm (a sort, a search, gradient descent), addressed by step
 * index or by time. Each state is snapshotted when it is produced, so a generator that mutates one array in
 * place and yields it every step still gives a distinct, frozen state per step.
 */
import { countOr, errorText, positiveOr, snapshot } from './internal.ts'

/** Where the states come from: a list, anything iterable, or a (generator) function that returns one. */
export type StepperSource<T> = readonly T[] | Iterable<T> | Iterator<T> | (() => Iterable<T> | Iterator<T>)

/** Options of `stepper()`. */
export interface StepperOptions {
  /** Cap on the number of states taken from a generator (default 10,000). */
  maxSteps?: number
}

/** How step indices map to time. */
export interface StepTiming {
  /** Seconds each state is shown for (default 1). */
  stepSeconds?: number
}

/** Position inside a stepped run at some time: which state, and how far to the next one. */
export interface StepPhase {
  /** Index of the current state. */
  index: number
  /** Progress from this state to the next, 0 to 1 (0 on the last state). */
  progress: number
}

/** The states of an algorithm, by index or by time. */
export interface Stepper<T> {
  /** Number of recorded states. */
  readonly count: number
  /** Every state in order (frozen). */
  readonly states: readonly T[]
  /** State number `i`; indices are floored and clamped to the first and last state. */
  at(i: number): T
  /** State shown at time `t` when each state lasts `stepSeconds` (default 1); clamped to the last state. */
  atTime(t: number, timing?: StepTiming): T
  /** Index and progress to the next state at time `t`, for tweening between two states. */
  phase(t: number, timing?: StepTiming): StepPhase
  /** Problems found while recording (the generator threw, the state cap was reached); empty when all is well. */
  readonly issues: readonly string[]
}

const DEFAULT_MAX_STATES = 10_000

/** Records the states of an algorithm from a list or a generator and serves them by index or by time. */
export function stepper<T>(source: StepperSource<T>, options: StepperOptions = {}): Stepper<T> {
  const issues: string[] = []
  const maxStates = countOr(options?.maxSteps, DEFAULT_MAX_STATES)
  const states: T[] = []

  try {
    let produced: unknown = source
    if (typeof produced === 'function') produced = (produced as () => unknown)()
    let iterator: Iterator<T> | null = null
    if (produced !== null && typeof produced === 'object') {
      const iterable = produced as Partial<Iterable<T>> & Partial<Iterator<T>>
      if (typeof iterable[Symbol.iterator] === 'function') iterator = iterable[Symbol.iterator]!()
      else if (typeof iterable.next === 'function') iterator = iterable as Iterator<T>
    }
    if (iterator === null) {
      issues.push('stepper: expected an array of states or a generator, e.g. stepper(function* () { yield state })')
    } else {
      for (;;) {
        const result = iterator.next()
        if (result.done) break
        if (states.length >= maxStates) {
          issues.push(`stepper: stopped after ${maxStates} states (raise maxSteps, or check that the generator ends)`)
          if (typeof iterator.return === 'function') iterator.return()
          break
        }
        states.push(snapshot(result.value, true))
      }
    }
  } catch (error) {
    issues.push(`stepper: the generator threw after ${states.length} states: ${errorText(error)}`)
  }
  Object.freeze(states)

  const count = states.length
  const last = Math.max(0, count - 1)

  const at = (i: number): T => states[i > 0 ? Math.min(Math.floor(i), last) : 0] as T

  const phase = (t: number, timing?: StepTiming): StepPhase => {
    const x = t > 0 ? t / positiveOr(timing?.stepSeconds, 1) : 0
    if (!(x < last)) return { index: last, progress: 0 }
    const nearest = Math.round(x)
    const snapped = Math.abs(x - nearest) <= 1e-9 * Math.max(1, nearest) ? nearest : x
    const index = Math.floor(snapped)
    return { index, progress: snapped - index }
  }

  return { count, states, at, atTime: (t, timing) => at(phase(t, timing).index), phase, issues }
}
