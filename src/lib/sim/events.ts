/**
 * events(): a seeded discrete-event simulation, exposed as a pure function of time.
 * The run always starts at t = 0, advances lazily and records every state, so `at(t)` is identical for any
 * order of calls. States are stored as frozen deep copies: nothing a scene does can rewrite history.
 */
import { countOr, errorText, snapshot } from './internal.ts'
import { rng, type Rng } from './rng.ts'

/** The next thing that will happen: `after` seconds from now, `apply` produces the state that follows. */
export interface EventStep<S> {
  /** Delay in seconds from the current event time (0 or more). */
  after: number
  /** Returns the next state; it receives a private copy, so it may also mutate it and return nothing. */
  apply: (state: S, t: number) => S | void
  /** Optional name of the event, recorded in the log ("arrive", "finish", ...). */
  label?: string
}

/** Options of `events()`. */
export interface EventsOptions<S> {
  /** State at t = 0 (plain data: numbers, strings, arrays, objects). */
  init: S
  /** Called once per event, in order: returns what happens next, or null when nothing more will happen. */
  next: (state: S, rng: Rng, t: number) => EventStep<S> | null | undefined
  /** Seed of the random stream handed to `next` (default 0). */
  seed?: number | string
  /** Cap on the number of events; past it the simulation ends (default 20,000). */
  maxEvents?: number
}

/** One entry of the recorded history: the state that holds from time `t` until the next entry. */
export interface EventRecord<S> {
  /** Position in the history; entry 0 is the initial state at t = 0. */
  index: number
  /** Time of the event in seconds. */
  t: number
  /** The event's label ('init' for entry 0, '' when none was given). */
  label: string
  /** Frozen state right after the event. */
  state: S
}

/** A discrete-event simulation as a function of time. */
export interface Events<S> {
  /** State at time `t`: the result of every event at or before `t` (frozen; do not mutate). */
  at(t: number): S
  /** The history entry in force at time `t`: its `t` is when the latest event happened, its `index` how many have. */
  entry(t: number): EventRecord<S>
  /** The recorded history up to and including time `until` (a pure function of `until`). */
  history(until: number): readonly EventRecord<S>[]
  /** Everything simulated so far; it grows with the furthest time asked for, so prefer `history(t)` in a scene. */
  readonly log: readonly EventRecord<S>[]
  /** Forgets the history; call it when something `next` reads (a parameter) has changed. */
  reset(): void
  /** Problems found so far (`next` or `apply` threw, bad delays, event cap reached); empty when all is well. */
  readonly issues: readonly string[]
}

const DEFAULT_MAX_EVENTS = 20_000

interface Pending<S> { t: number; apply: unknown; label: string; step: EventStep<S> }

/** Runs a seeded discrete-event simulation from t = 0 and returns its state as a function of time. */
export function events<S>(options: EventsOptions<S>): Events<S> {
  const issues: string[] = []
  const reported = new Set<string>()
  const report = (kind: string, message: string): void => {
    if (reported.has(kind)) return
    reported.add(kind)
    issues.push(message)
  }

  const next = options?.next
  const seed = options?.seed ?? 0
  const maxEvents = countOr(options?.maxEvents, DEFAULT_MAX_EVENTS)
  if (typeof next !== 'function') report('next', 'events: next must be a function (state, rng, t) => { after, apply } | null')
  const setupIssues = issues.length
  const setupKinds = new Set(reported)

  let records: EventRecord<S>[] = []
  let random: Rng = rng(seed)
  let pending: Pending<S> | null = null
  let scheduled = false
  let ended = false
  let cursor = 0

  const reset = (): void => {
    records = [Object.freeze({ index: 0, t: 0, label: 'init', state: snapshot(options?.init as S, true) })]
    random = rng(seed)
    pending = null
    scheduled = false
    ended = typeof next !== 'function'
    cursor = 0
    issues.length = setupIssues
    reported.clear()
    for (const kind of setupKinds) reported.add(kind)
  }
  reset()

  /** Asks `next` what follows the latest record. Called exactly once per event, so the rng use is fixed. */
  const schedule = (): void => {
    scheduled = true
    pending = null
    const last = records[records.length - 1]!
    if (records.length > maxEvents) {
      ended = true
      report('cap', `events: stopped after ${maxEvents} events at t=${last.t} (raise maxEvents, or check that "after" is not always 0)`)
      return
    }
    let step: EventStep<S> | null | undefined
    try {
      step = (next as EventsOptions<S>['next'])(last.state, random, last.t)
    } catch (error) {
      ended = true
      report('next', `events: next threw at t=${last.t}: ${errorText(error)} (the state is frozen inside next: change it in apply)`)
      return
    }
    if (step === null || step === undefined) {
      ended = true
      return
    }
    let after: unknown = (step as { after?: unknown }).after
    if (typeof after !== 'number' || Number.isNaN(after)) {
      ended = true
      report('after', `events: next returned after=${String(after)} at t=${last.t}; it must be a number of seconds`)
      return
    }
    if (after < 0) {
      report('negative', `events: next returned a negative delay (${after}) at t=${last.t}; treated as 0`)
      after = 0
    }
    if (after === Infinity) {
      ended = true
      return
    }
    pending = { t: last.t + (after as number), apply: step.apply, label: typeof step.label === 'string' ? step.label : '', step }
  }

  /** Simulates every event whose time is at or before `until`. */
  const advance = (until: number): void => {
    while (!ended) {
      if (!scheduled) schedule()
      const event = pending as Pending<S> | null
      if (ended || event === null || event.t > until) return
      const last = records[records.length - 1]!
      let state: S = last.state
      if (typeof event.apply === 'function') {
        const working = snapshot(last.state, false)
        try {
          const result = (event.apply as EventStep<S>['apply']).call(event.step, working, event.t)
          state = snapshot(result === undefined ? working : (result as S), true)
        } catch (error) {
          report('apply', `events: apply threw at t=${event.t}: ${errorText(error)}; the state was left unchanged`)
        }
      } else {
        report('applyType', `events: next must return { after, apply(state) }; apply was ${typeof event.apply} at t=${last.t}`)
      }
      records.push(Object.freeze({ index: records.length, t: event.t, label: event.label, state }))
      scheduled = false
    }
  }

  /** Index of the last record at or before `t` (records are sorted by time). */
  const locate = (t: number): number => {
    const hint = records[cursor]
    if (hint !== undefined && hint.t <= t && (cursor + 1 >= records.length || records[cursor + 1]!.t > t)) return cursor
    let low = 0
    let high = records.length - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if (records[middle]!.t <= t) low = middle
      else high = middle - 1
    }
    cursor = low
    return low
  }

  const entry = (t: number): EventRecord<S> => {
    const time = t > 0 ? t : 0
    advance(time)
    return records[locate(time)]!
  }

  const history = (until: number): readonly EventRecord<S>[] => {
    const time = until > 0 ? until : 0
    advance(time)
    return records.slice(0, locate(time) + 1)
  }

  return {
    at: (t) => entry(t).state,
    entry,
    history,
    get log() {
      return records
    },
    reset,
    issues,
  }
}
