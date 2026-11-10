import { describe, expect, test } from 'bun:test'
import { rng } from '../../../../src/lib/sim/index.ts'

const take = (count: number, draw: () => number): number[] => Array.from({ length: count }, draw)
const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length
const deviation = (values: number[]): number => {
  const m = mean(values)
  return Math.sqrt(mean(values.map((value) => (value - m) ** 2)))
}
const correlation = (a: number[], b: number[]): number => {
  const ma = mean(a), mb = mean(b)
  return mean(a.map((value, i) => (value - ma) * (b[i]! - mb))) / (deviation(a) * deviation(b))
}

describe('rng: reproducibility', () => {
  test('the same seed replays the same numbers; a different seed does not', () => {
    const a = rng(42), b = rng(42), c = rng(43)
    const first = take(1000, a.next)
    expect(take(1000, b.next)).toEqual(first)
    expect(take(1000, c.next)).not.toEqual(first)
    expect(new Set(first).size).toBeGreaterThan(990)
  })

  test('the sequences are pinned: these values must never change between versions', () => {
    expect(take(4, rng(1).next)).toEqual(PINNED_SEED_1)
    expect(take(4, rng('mimir').next)).toEqual(PINNED_SEED_MIMIR)
    expect(take(2, rng(1).fork('arrivals').next)).toEqual(PINNED_FORK)
  })

  test('number and string seeds, and the default seed, are all valid and distinct', () => {
    const firsts = [rng().next(), rng(0).next(), rng('0').next(), rng(1).next(), rng(-1).next(), rng(0.5).next(), rng('').next(), rng(Number.NaN).next()]
    expect(firsts[0]).toBe(firsts[1]!) // rng() is rng(0)
    expect(new Set(firsts.slice(1)).size).toBe(7)
    for (const value of firsts) expect(value >= 0 && value < 1).toBe(true)
  })

  test('every derived method is reproducible too', () => {
    const run = () => {
      const r = rng('all')
      return [r.range(-2, 3), r.int(1, 6), r.pick(['a', 'b', 'c']), r.normal(), r.exponential(2), r.chance(0.5), r.shuffle([1, 2, 3, 4, 5]), r.next()]
    }
    expect(run()).toEqual(run())
  })
})

describe('rng: distributions', () => {
  test('next() is uniform on [0, 1)', () => {
    const values = take(200_000, rng(5).next)
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...values)).toBeLessThan(1)
    expect(Math.abs(mean(values) - 0.5)).toBeLessThan(0.003)
    expect(Math.abs(deviation(values) - Math.sqrt(1 / 12))).toBeLessThan(0.002)
    const buckets = new Array<number>(20).fill(0)
    for (const value of values) buckets[Math.floor(value * 20)]!++
    const expected = values.length / 20
    const chiSquare = buckets.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0)
    expect(chiSquare).toBeLessThan(43.8) // 19 degrees of freedom, p = 0.001
    // no correlation between consecutive numbers
    expect(Math.abs(correlation(values.slice(0, -1), values.slice(1)))).toBeLessThan(0.01)
  })

  test('range(a, b) stays in [a, b) and int(a, b) includes both ends evenly', () => {
    const r = rng(6)
    for (const value of take(5000, () => r.range(-3, 7))) expect(value >= -3 && value < 7).toBe(true)
    const faces = new Array<number>(7).fill(0)
    for (const value of take(60_000, () => r.int(1, 6))) {
      expect(Number.isInteger(value) && value >= 1 && value <= 6).toBe(true)
      faces[value]!++
    }
    for (let face = 1; face <= 6; face++) expect(Math.abs(faces[face]! - 10_000)).toBeLessThan(450)
    expect(new Set(take(200, () => r.int(6, 1)))).toEqual(new Set([1, 2, 3, 4, 5, 6])) // bounds in either order
    expect(r.int(4, 4)).toBe(4)
    expect(new Set(take(100, () => r.int(-1, 1)))).toEqual(new Set([-1, 0, 1]))
  })

  test('pick and shuffle', () => {
    const r = rng(7)
    const items = ['a', 'b', 'c', 'd']
    const counts = new Map<string, number>()
    for (const item of take(8000, () => 0).map(() => r.pick(items))) counts.set(item, (counts.get(item) ?? 0) + 1)
    for (const item of items) expect(Math.abs(counts.get(item)! - 2000)).toBeLessThan(200)
    expect(r.pick([])).toBeUndefined()

    const deck = Array.from({ length: 52 }, (_unused, i) => i)
    const shuffled = r.shuffle(deck)
    expect(shuffled).not.toEqual(deck)
    expect([...shuffled].sort((x, y) => x - y)).toEqual(deck)
    expect(deck[0]).toBe(0) // the input is not modified
    expect(r.shuffle([])).toEqual([])
  })

  test('normal, exponential and chance have the right moments', () => {
    const r = rng(8)
    const normals = take(100_000, () => r.normal())
    expect(Math.abs(mean(normals))).toBeLessThan(0.015)
    expect(Math.abs(deviation(normals) - 1)).toBeLessThan(0.015)
    expect(normals.filter((value) => Math.abs(value) < 1).length / normals.length).toBeCloseTo(0.6827, 2)
    for (const value of normals) expect(Number.isFinite(value)).toBe(true)
    const shifted = take(50_000, () => r.normal(10, 2))
    expect(Math.abs(mean(shifted) - 10)).toBeLessThan(0.04)
    expect(Math.abs(deviation(shifted) - 2)).toBeLessThan(0.04)

    const waits = take(100_000, () => r.exponential(0.5))
    expect(Math.abs(mean(waits) - 0.5)).toBeLessThan(0.01)
    expect(Math.min(...waits)).toBeGreaterThanOrEqual(0)
    for (const value of waits) expect(Number.isFinite(value)).toBe(true)

    expect(take(50_000, () => (r.chance(0.3) ? 1 : 0)).reduce((sum: number, hit) => sum + hit, 0) / 50_000).toBeCloseTo(0.3, 2)
    expect(r.chance(0)).toBe(false)
    expect(r.chance(1)).toBe(true)
  })
})

describe('rng: fork', () => {
  test('a fork depends only on the seed and the label, not on how far the parent has run', () => {
    const fresh = rng('scene')
    const used = rng('scene')
    take(137, used.next)
    expect(take(50, used.fork('arrivals').next)).toEqual(take(50, fresh.fork('arrivals').next))
  })

  test('forking does not disturb the parent', () => {
    const plain = rng(9), forked = rng(9)
    const a = take(5, plain.next)
    forked.fork('x')
    take(20, forked.fork('y').next)
    expect(take(5, forked.next)).toEqual(a)
  })

  test('different labels, parents and nesting give different, uncorrelated streams', () => {
    const root = rng(10)
    const streams = [
      take(20_000, root.fork('a').next), take(20_000, root.fork('b').next), take(20_000, root.fork(1).next),
      take(20_000, root.fork('1').next), take(20_000, root.fork('a').fork('a').next), take(20_000, rng(11).fork('a').next),
      take(20_000, root.next),
    ]
    for (let i = 0; i < streams.length; i++) {
      for (let j = i + 1; j < streams.length; j++) {
        expect(streams[i]!.slice(0, 5)).not.toEqual(streams[j]!.slice(0, 5))
        expect(Math.abs(correlation(streams[i]!, streams[j]!))).toBeLessThan(0.03)
      }
    }
  })

  test('neighbouring seeds are uncorrelated', () => {
    for (const seed of [0, 1, 2, 1000]) {
      expect(Math.abs(correlation(take(20_000, rng(seed).next), take(20_000, rng(seed + 1).next)))).toBeLessThan(0.03)
    }
  })
})

// Captured from this implementation (sfc32 seeded by xmur3). A change here changes every seeded scene.
const PINNED_SEED_1: number[] = [0.05834614858031273, 0.6046565514989197, 0.9302729927003384, 0.5209892001003027]
const PINNED_SEED_MIMIR: number[] = [0.14121787552721798, 0.28997817169874907, 0.2884915438480675, 0.770035061519593]
const PINNED_FORK: number[] = [0.6289251742418855, 0.581544196465984]
