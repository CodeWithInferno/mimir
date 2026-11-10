import { describe, expect, test } from 'bun:test'
import { stepper } from '../../../../src/lib/sim/index.ts'

/** Bubble sort that mutates ONE array in place and yields it after every swap (the natural way to write it). */
function* bubbleSort(values: number[]): Generator<{ values: number[]; swapped: [number, number] | null }> {
  const a = values.slice()
  yield { values: a, swapped: null }
  for (let end = a.length - 1; end > 0; end--) {
    for (let i = 0; i < end; i++) {
      if (a[i]! > a[i + 1]!) {
        const swap = a[i]!
        a[i] = a[i + 1]!
        a[i + 1] = swap
        yield { values: a, swapped: [i, i + 1] }
      }
    }
  }
}

describe('stepper: from a list', () => {
  const run = stepper(['a', 'b', 'c', 'd'])

  test('count and at(i), with indices floored and clamped', () => {
    expect(run.count).toBe(4)
    expect(run.states).toEqual(['a', 'b', 'c', 'd'])
    expect([run.at(0), run.at(1), run.at(3)]).toEqual(['a', 'b', 'd'])
    expect(run.at(2.9)).toBe('c')
    expect(run.at(-1)).toBe('a')
    expect(run.at(99)).toBe('d')
    expect(run.at(Number.NaN)).toBe('a')
    expect(run.at(Infinity)).toBe('d')
  })

  test('atTime maps time to steps: one second each by default, stepSeconds otherwise', () => {
    expect([0, 0.99, 1, 2.5, 3, 50].map((t) => run.atTime(t))).toEqual(['a', 'a', 'b', 'c', 'd', 'd'])
    expect([0, 0.24, 0.25, 0.6, 0.75, 9].map((t) => run.atTime(t, { stepSeconds: 0.25 }))).toEqual(['a', 'a', 'b', 'c', 'd', 'd'])
    expect(run.atTime(-4)).toBe('a')
    // a time that is a whole number of steps only up to rounding error still lands on that step
    expect(run.atTime(0.1 * 3, { stepSeconds: 0.1 })).toBe('d')
    expect(run.atTime(0.3 - 1e-6, { stepSeconds: 0.1 })).toBe('c')
    expect(run.atTime(1, { stepSeconds: -2 })).toBe('b') // a bad stepSeconds falls back to 1
  })

  test('phase gives the index and the progress to the next state', () => {
    expect(run.phase(0)).toEqual({ index: 0, progress: 0 })
    expect(run.phase(1.25)).toEqual({ index: 1, progress: 0.25 })
    expect(run.phase(1, { stepSeconds: 4 })).toEqual({ index: 0, progress: 0.25 })
    expect(run.phase(3)).toEqual({ index: 3, progress: 0 })
    expect(run.phase(1000)).toEqual({ index: 3, progress: 0 })
  })

  test('later changes to the source list do not leak in', () => {
    const source = [{ n: 1 }, { n: 2 }]
    const fixed = stepper(source)
    source[0]!.n = 99
    source.push({ n: 3 })
    expect(fixed.count).toBe(2)
    expect(fixed.at(0)).toEqual({ n: 1 })
  })
})

describe('stepper: from a generator', () => {
  test('each yielded state is snapshotted, even when the algorithm mutates one array in place', () => {
    const input = [5, 2, 4, 1, 3]
    const sort = stepper(() => bubbleSort(input))
    expect(sort.count).toBe(8) // the start plus 7 swaps (7 inversions)
    expect(sort.at(0).values).toEqual([5, 2, 4, 1, 3])
    expect(sort.at(1)).toEqual({ values: [2, 5, 4, 1, 3], swapped: [0, 1] })
    expect(sort.at(sort.count - 1).values).toEqual([1, 2, 3, 4, 5])
    expect(new Set(sort.states.map((state) => state.values.join())).size).toBe(8)
    expect(input).toEqual([5, 2, 4, 1, 3])
    for (let i = 1; i < sort.count; i++) {
      // every step differs from the one before by exactly the swap it reports
      const [x, y] = sort.at(i).swapped!
      const expected = [...sort.at(i - 1).values]
      const swap = expected[x]!
      expect(expected[y]!).toBeLessThan(swap)
      expected[x] = expected[y]!
      expected[y] = swap
      expect(sort.at(i).values).toEqual(expected)
    }
    expect(sort.issues).toEqual([])
  })

  test('accepts a generator function, a generator object, and any iterable', () => {
    function* counting(): Generator<number> { for (let i = 0; i < 5; i++) yield i * i }
    expect(stepper(counting).states).toEqual([0, 1, 4, 9, 16])
    expect(stepper(counting()).states).toEqual([0, 1, 4, 9, 16])
    expect(stepper(new Set(['x', 'y'])).states).toEqual(['x', 'y'])
    expect(stepper(() => [1, 2, 3]).count).toBe(3)
    let i = 0
    expect(stepper<number>({ next: () => (i < 3 ? { value: i++, done: false } : { value: undefined, done: true }) }).states).toEqual([0, 1, 2])
  })

  test('states are frozen so that one reader cannot change what the next one sees', () => {
    const sort = stepper(() => bubbleSort([3, 1, 2]))
    expect(Object.isFrozen(sort.at(1))).toBe(true)
    expect(Object.isFrozen(sort.at(1).values)).toBe(true)
    expect(() => { sort.at(1).values.push(7) }).toThrow()
    expect(Object.isFrozen(sort.states)).toBe(true)
  })

  test('gradient descent as a stepper: the recorded path converges', () => {
    const descent = stepper(function* () {
      let x = 4
      for (let step = 0; step <= 40; step++) {
        yield { step, x, loss: x * x }
        x -= 0.2 * 2 * x
      }
    })
    expect(descent.count).toBe(41)
    expect(descent.at(1).x).toBeCloseTo(2.4, 12)
    expect(descent.atTime(2, { stepSeconds: 0.5 }).step).toBe(4)
    expect(descent.at(40).loss).toBeLessThan(1e-15)
    for (let i = 1; i < descent.count; i++) expect(descent.at(i).loss).toBeLessThan(descent.at(i - 1).loss)
  })
})

describe('stepper: bad input never throws', () => {
  test('an endless generator is cut at the cap and reported', () => {
    let closed = false
    const endless = stepper(function* () {
      try { for (let i = 0; ; i++) yield i } finally { closed = true }
    }, { maxSteps: 250 })
    expect(endless.count).toBe(250)
    expect(endless.at(249)).toBe(249)
    expect(endless.issues).toHaveLength(1)
    expect(closed).toBe(true)
    let made = 0
    const byDefault = stepper(function* () { for (;;) yield made++ })
    expect(byDefault.count).toBe(10_000)
    expect(made).toBe(10_001)
  })

  test('a generator that throws keeps the states it produced', () => {
    const broken = stepper(function* () { yield 1; yield 2; throw new Error('bad step') })
    expect(broken.states).toEqual([1, 2])
    expect(broken.issues[0]).toContain('bad step')
    const immediately = stepper((() => { throw new Error('never started') }) as unknown as () => number[])
    expect(immediately.count).toBe(0)
    expect(immediately.issues).toHaveLength(1)
  })

  test('nothing to step through: count 0, at() is undefined, a clear issue', () => {
    const empty = stepper([])
    expect(empty.count).toBe(0)
    expect(empty.at(0)).toBeUndefined()
    expect(empty.atTime(3)).toBeUndefined()
    expect(empty.phase(3)).toEqual({ index: 0, progress: 0 })
    expect(empty.issues).toEqual([])
    for (const junk of [undefined, null, 42, 'abc', {}]) {
      const inert = stepper(junk as unknown as number[])
      expect(inert.count).toBe(0)
      expect(inert.issues).toHaveLength(1)
    }
  })
})
