import { describe, expect, test } from 'bun:test'
import { events, rng } from '../../../../src/lib/sim/index.ts'

// ── a single-server queue with random arrivals and random service times (M/M/1) ───────────────────────────
interface Shop { arrived: number; waiting: number; serving: boolean; served: number; nextArrival: number; serviceEnds: number }

const shop = (seed: number | string = 1) => events<Shop>({
  init: { arrived: 0, waiting: 0, serving: false, served: 0, nextArrival: 0, serviceEnds: Infinity },
  seed,
  next: (state, random, t) => {
    if (state.serviceEnds <= state.nextArrival) {
      const service = random.exponential(0.4)
      return {
        after: state.serviceEnds - t,
        label: 'finish',
        apply: (s, now) => {
          s.served++
          s.serving = s.waiting > 0
          if (s.serving) s.waiting--
          s.serviceEnds = s.serving ? now + service : Infinity
        },
      }
    }
    const gap = random.exponential(0.5)
    const service = random.exponential(0.4)
    return {
      after: state.nextArrival - t,
      label: 'arrive',
      apply: (s, now) => {
        s.arrived++
        s.nextArrival = now + gap
        if (s.serving) s.waiting++
        else {
          s.serving = true
          s.serviceEnds = now + service
        }
      },
    }
  },
})

describe('events: seeded queue with arrivals and service', () => {
  test('same seed, same history; different seed, different history', () => {
    const a = shop(7).history(60)
    const b = shop(7).history(60)
    expect(a.length).toBeGreaterThan(150)
    expect(b).toEqual(a)
    const c = shop(8).history(60)
    expect(c.map((record) => record.t)).not.toEqual(a.map((record) => record.t))
    expect(shop('seven').history(60)).toEqual(shop('seven').history(60))
  })

  test('at(t) is identical whatever the call order', () => {
    const random = rng('events-order')
    const times = Array.from({ length: 200 }, () => random.range(0, 60))
    const ascending = shop(3)
    const expected = new Map([...times].sort((x, y) => x - y).map((t) => [t, ascending.at(t)]))
    const shuffled = shop(3)
    for (const t of times) expect(shuffled.at(t)).toEqual(expected.get(t)!)
    const backwards = shop(3)
    for (const t of [...times].sort((x, y) => y - x)) expect(backwards.at(t)).toEqual(expected.get(t)!)
    // a far query first, then early ones: the early states are still the early states
    const farFirst = shop(3)
    farFirst.at(1000)
    for (const t of times.slice(0, 40)) expect(farFirst.at(t)).toEqual(expected.get(t)!)
  })

  test('history is ordered, conserves customers, and the queue behaves like a queue', () => {
    const log = shop(11).history(200)
    for (let i = 1; i < log.length; i++) {
      const { t, state, index } = log[i]!
      expect(index).toBe(i)
      expect(t).toBeGreaterThanOrEqual(log[i - 1]!.t)
      expect(state.arrived).toBe(state.waiting + (state.serving ? 1 : 0) + state.served)
      expect(state.waiting).toBeGreaterThanOrEqual(0)
      if (!state.serving) expect(state.waiting).toBe(0)
    }
    expect(log[0]).toEqual({ index: 0, t: 0, label: 'init', state: { arrived: 0, waiting: 0, serving: false, served: 0, nextArrival: 0, serviceEnds: Infinity } })
    const labels = new Set(log.map((record) => record.label))
    expect([...labels].sort()).toEqual(['arrive', 'finish', 'init'])
    // utilisation 0.8 (service 0.4 s, one arrival per 0.5 s): about 2 arrivals per second over 200 s
    const last = log[log.length - 1]!.state
    expect(last.arrived).toBeGreaterThan(330)
    expect(last.arrived).toBeLessThan(470)
  })

  test('at(t) holds the state of the latest event at or before t', () => {
    const sim = shop(5)
    const log = sim.history(30)
    for (const i of [1, 2, 10, 25, log.length - 2]) {
      const record = log[i]!
      const following = log[i + 1]!
      expect(sim.at(record.t)).toBe(record.state)
      if (following.t > record.t) {
        expect(sim.at((record.t + following.t) / 2)).toBe(record.state)
        expect(sim.entry((record.t + following.t) / 2)).toBe(record)
      }
    }
    // time before 0 does not exist: it reads as t = 0 (here the first customer arrives exactly at 0)
    expect(sim.at(-3)).toBe(sim.at(0))
    expect(sim.at(Number.NaN)).toBe(sim.at(0))
    expect(sim.at(0).arrived).toBe(1)
    expect(sim.entry(0).label).toBe('arrive')
  })

  test('history(until) is a pure function of until; log is whatever has been simulated so far', () => {
    const sim = shop(5)
    expect(sim.log).toHaveLength(1)
    const upTo10 = sim.history(10)
    expect(upTo10[upTo10.length - 1]!.t).toBeLessThanOrEqual(10)
    expect(sim.entry(10).index).toBe(upTo10.length - 1)
    sim.at(50)
    expect(sim.history(10)).toEqual(upTo10)
    expect(sim.log.length).toBeGreaterThan(upTo10.length)
    expect(sim.log.slice(0, upTo10.length)).toEqual([...upTo10])
    expect(sim.log[sim.log.length - 1]!.t).toBeLessThanOrEqual(50)
    expect(sim.history(-1)).toEqual(sim.history(0))
  })

  test('reset() replays the same history from the seed', () => {
    const sim = shop(9)
    const first = sim.history(40)
    sim.reset()
    expect(sim.log).toHaveLength(1)
    expect(sim.history(40)).toEqual(first)
  })
})

// ── a reference pipeline worked out by hand: no randomness, exact expected numbers ──
interface Job { id: number; attempts: number }
interface Pipeline {
  produced: number
  nextArrival: number
  queue: Job[]
  workers: ({ job: Job; end: number } | null)[]
  retry: { job: Job; at: number }[]
  done: number[]
  dead: number[]
}

const EPS = 1e-9
/** Time of the next arrival: one job's worth of the arrival rate (2/s, then 4/s from t = 12) accumulated from `t`. */
const arrivalAfter = (t: number): number => {
  const beforeSwitch = t < 12 ? (12 - t) * 2 : 0
  return beforeSwitch >= 1 ? t + 0.5 : Math.max(t, 12) + (1 - beforeSwitch) / 4
}
const poolSize = (t: number): number => (t < 20 - EPS ? 3 : 5)

const pipeline = () => events<Pipeline>({
  init: { produced: 0, nextArrival: 0.45, queue: [], workers: [null, null, null], retry: [], done: [], dead: [] },
  next: (state, _random, t) => {
    // the earliest of: a job arriving, the pool growing, a retry coming back, a worker finishing
    let time = state.nextArrival
    let kind = 'arrive'
    let which = -1
    if (t < 20 && 20 < time) { time = 20; kind = 'scale' }
    state.retry.forEach((entry, i) => { if (entry.at < time - EPS) { time = entry.at; kind = 'requeue'; which = i } })
    state.workers.forEach((worker, i) => { if (worker && worker.end < time - EPS) { time = worker.end; kind = 'finish'; which = i } })
    return {
      after: Math.max(0, time - t),
      label: kind,
      apply: (s, now) => {
        if (kind === 'arrive') {
          s.produced++
          s.queue.push({ id: s.produced, attempts: 0 })
          s.nextArrival = arrivalAfter(now)
        } else if (kind === 'requeue') {
          s.queue.push(s.retry.splice(which, 1)[0]!.job)
        } else if (kind === 'finish') {
          const { job } = s.workers[which]!
          s.workers[which] = null
          if (job.id !== 7) s.done.push(job.id) // job 7 always fails
          else if (job.attempts >= 3) s.dead.push(job.id)
          else s.retry.push({ job, at: now + 2 ** (job.attempts - 1) }) // back off 1 s, then 2 s
        }
        while (s.workers.length < poolSize(now)) s.workers.push(null)
        for (let w = 0; w < s.workers.length; w++) {
          if (s.workers[w] === null && s.queue.length > 0) {
            const job = s.queue.shift()!
            job.attempts++
            s.workers[w] = { job, end: now + 1 }
          }
        }
      },
    }
  },
})

describe('events: research reference pipeline (3 workers, 1 s jobs, poison job 7, retries, overload, recovery)', () => {
  const counts = (s: Pipeline): number[] =>
    [s.produced, s.queue.length, s.workers.filter(Boolean).length, s.retry.length, s.done.length, s.dead.length]

  test('reproduces the reference table: produced, queue, in flight, retry, done, dead', () => {
    const reference: Record<number, number[]> = {
      2: [4, 0, 2, 0, 2, 0], 5: [10, 0, 2, 1, 7, 0], 8: [16, 0, 2, 1, 13, 0], 10: [20, 0, 2, 0, 17, 1],
      12: [24, 0, 2, 0, 21, 1], 14: [32, 2, 3, 0, 26, 1], 16: [40, 4, 3, 0, 32, 1], 18: [48, 6, 3, 0, 38, 1],
      20: [56, 6, 5, 0, 44, 1], 22: [64, 4, 5, 0, 54, 1], 24: [72, 2, 5, 0, 64, 1], 26: [80, 0, 5, 0, 74, 1],
      28: [88, 0, 4, 0, 83, 1], 30: [96, 0, 4, 0, 91, 1], 35: [116, 0, 4, 0, 111, 1], 40: [136, 0, 4, 0, 131, 1],
    }
    const sim = pipeline()
    // asked for in a scrambled order on purpose
    for (const t of rng(1).shuffle(Object.keys(reference).map(Number))) expect(counts(sim.at(t))).toEqual(reference[t]!)
    expect(sim.issues).toEqual([])
  })

  test('the poison job fails at 4.45, 6.45 and 9.45 s with backoff 1 s then 2 s, then is dead-lettered', () => {
    const log = pipeline().history(40)
    const story: string[] = []
    for (let i = 1; i < log.length; i++) {
      const before = log[i - 1]!.state
      const { t, state } = log[i]!
      if (state.retry.length > before.retry.length) story.push(`${t.toFixed(2)} fail, back at ${state.retry[state.retry.length - 1]!.at.toFixed(2)}`)
      if (state.retry.length < before.retry.length) story.push(`${t.toFixed(2)} requeue`)
      if (state.dead.length > before.dead.length) story.push(`${t.toFixed(2)} dead ${state.dead.join()}`)
    }
    expect(story).toEqual(['4.45 fail, back at 5.45', '5.45 requeue', '6.45 fail, back at 8.45', '8.45 requeue', '9.45 dead 7'])
  })

  test('jobs are conserved and served first-in first-out at every event', () => {
    const log = pipeline().history(40)
    for (const { state } of log) {
      const inFlight = state.workers.filter(Boolean).length
      expect(state.produced).toBe(state.queue.length + inFlight + state.retry.length + state.done.length + state.dead.length)
      for (let i = 1; i < state.queue.length; i++) {
        if (state.queue[i]!.id !== 7 && state.queue[i - 1]!.id !== 7) expect(state.queue[i]!.id).toBeGreaterThan(state.queue[i - 1]!.id)
      }
    }
    expect(log.length).toBe(274)
  })
})

describe('events: history cannot be rewritten', () => {
  const counter = () => events<{ n: number; items: number[] }>({
    init: { n: 0, items: [] },
    next: () => ({ after: 1, apply: (s) => { s.n++; s.items.push(s.n) } }),
  })

  test('apply may mutate its copy in place; earlier states keep their values', () => {
    const sim = counter()
    expect(sim.at(3.5)).toEqual({ n: 3, items: [1, 2, 3] })
    expect(sim.at(1)).toEqual({ n: 1, items: [1] })
    expect(sim.at(0.999)).toEqual({ n: 0, items: [] })
  })

  test('apply may instead return a new state', () => {
    const sim = events({ init: { n: 0 }, next: (s) => (s.n < 3 ? { after: 0.5, apply: (state) => ({ n: state.n + 1 }) } : null) })
    expect(sim.at(0.75)).toEqual({ n: 1 })
    expect(sim.at(100)).toEqual({ n: 3 }) // next returned null: the simulation is over and the state holds
    expect(sim.history(Infinity)).toHaveLength(4)
  })

  test('returned states are frozen, and the init object is not touched', () => {
    const init = { n: 0, items: [] as number[] }
    const sim = events({ init, next: () => ({ after: 1, apply: (s) => { s.items.push(1) } }) })
    const state = sim.at(2)
    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(state.items)).toBe(true)
    expect(() => { state.items.push(9) }).toThrow()
    expect(Object.isFrozen(init)).toBe(false)
    expect(init.items).toEqual([])
    expect(sim.at(2)).toEqual({ n: 0, items: [1, 1] })
  })

  test('the rng handed to next is the same stream on every replay, and forks are independent of it', () => {
    const draws = () => events<number[]>({
      init: [],
      seed: 'draws',
      next: (_s, random) => {
        const value = random.int(1, 6)
        return { after: 1, apply: (s) => [...s, value] }
      },
    })
    expect(draws().at(20)).toEqual(draws().at(20))
    expect(draws().at(20)).toHaveLength(20)
    expect(new Set(draws().at(20)).size).toBeGreaterThan(3)
  })
})

describe('events: bad input never throws', () => {
  test('a model whose delay is always 0 stops at the event cap instead of hanging', () => {
    const sim = events({ init: 0, next: () => ({ after: 0, apply: (n: number) => n + 1 }), maxEvents: 500 })
    expect(sim.at(1)).toBe(500)
    expect(sim.issues).toHaveLength(1)
    expect(sim.issues[0]).toContain('500 events')
  })

  test('next that throws, or mutates the frozen state, ends the run with an issue', () => {
    const throws = events({ init: { n: 0 }, next: () => { throw new Error('nope') } })
    expect(throws.at(5)).toEqual({ n: 0 })
    expect(throws.issues[0]).toContain('nope')
    const mutates = events({ init: { n: 0 }, next: (s) => { s.n++; return { after: 1, apply: (x) => x } } })
    expect(mutates.at(5)).toEqual({ n: 0 })
    expect(mutates.issues).toHaveLength(1)
    expect(mutates.issues[0]).toContain('change it in apply')
  })

  test('apply that throws leaves the state unchanged and the run continues', () => {
    let calls = 0
    const sim = events({ init: { n: 0 }, next: () => ({ after: 1, apply: (s: { n: number }) => { if (++calls === 2) throw new Error('once'); s.n++ } }) })
    expect(sim.at(3)).toEqual({ n: 2 })
    expect(sim.issues).toHaveLength(1)
  })

  test('bad delays and a missing next are reported', () => {
    const negative = events({ init: 0, next: (n: number) => (n < 3 ? { after: -1, apply: (x: number) => x + 1 } : null) })
    expect(negative.at(0)).toBe(3)
    expect(negative.issues).toHaveLength(1)
    const notANumber = events({ init: 0, next: () => ({ after: Number.NaN, apply: (x: number) => x + 1 }) })
    expect(notANumber.at(10)).toBe(0)
    expect(notANumber.issues).toHaveLength(1)
    const never = events({ init: 0, next: () => ({ after: Infinity, apply: (x: number) => x + 1 }) })
    expect(never.at(1e9)).toBe(0)
    expect(never.issues).toEqual([])
    const missing = events({ init: 4 } as unknown as { init: number; next: () => null })
    expect(missing.at(10)).toBe(4)
    expect(missing.issues).toHaveLength(1)
    expect(events(undefined as unknown as { init: number; next: () => null }).at(1)).toBeUndefined()
  })
})
