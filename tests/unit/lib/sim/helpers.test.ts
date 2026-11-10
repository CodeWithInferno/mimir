import { describe, expect, test } from 'bun:test'
import type { Vec2, Vec3 } from '../../../../src/lib/types.ts'
import { accumulate, accumulator, clamp, lerp, remap, rng, smoothDamp, smoothDampStep, trail } from '../../../../src/lib/sim/index.ts'

const DT = 1 / 240

describe('lerp, clamp, remap', () => {
  test('lerp on numbers and on vectors', () => {
    expect(lerp(2, 10, 0)).toBe(2)
    expect(lerp(2, 10, 1)).toBe(10)
    expect(lerp(2, 10, 0.25)).toBe(4)
    expect(lerp(2, 10, 1.5)).toBe(14) // not clamped
    expect(lerp(10, 2, 0.5)).toBe(6)
    const a: Vec3 = [0, 10, -4], b: Vec3 = [2, 20, 4]
    expect(lerp(a, b, 0.5)).toEqual([1, 15, 0])
    expect(lerp(a, b, 0)).toEqual(a)
    expect(lerp(a, b, 0)).not.toBe(a) // a fresh vector
    expect(a).toEqual([0, 10, -4])
  })

  test('clamp', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(15, 0, 10)).toBe(10)
    expect(clamp(15, 10, 0)).toBe(10) // bounds in either order
    expect(clamp(1.7)).toBe(1) // default range 0..1
    expect(clamp(-0.2)).toBe(0)
    expect(clamp(Infinity, -1, 1)).toBe(1)
  })

  test('remap', () => {
    expect(remap(5, 0, 10, 0, 100)).toBe(50)
    expect(remap(0.25, 0, 1, 10, 20)).toBe(12.5)
    expect(remap(750, 500, 1000, 0, 360)).toBe(180)
    expect(remap(5, 0, 10, 100, 0)).toBe(50) // reversed output
    expect(remap(15, 0, 10, 0, 100)).toBe(150) // extrapolates by default
    expect(remap(15, 0, 10, 0, 100, true)).toBe(100)
    expect(remap(-5, 0, 10, 0, 100, true)).toBe(0)
    expect(remap(3, 2, 2, 7, 9)).toBe(7) // empty input range: no division by zero
  })
})

describe('trail', () => {
  const circle = (t: number): Vec2 => [Math.cos(t), Math.sin(t)]

  test('samples evenly from `from` to `to`, both ends included', () => {
    const points = trail(circle, { from: 0, to: Math.PI, samples: 5 })
    expect(points).toHaveLength(5)
    expect(points[0]).toEqual([1, 0])
    expect(points[2]![0]).toBeCloseTo(0, 12)
    expect(points[2]![1]).toBeCloseTo(1, 12)
    expect(points[4]![0]).toBeCloseTo(-1, 12)
    expect(trail(circle, { to: 1 })).toHaveLength(64) // defaults: from 0, 64 samples
    expect(trail(circle, { from: 2, to: 2 })).toEqual([circle(2)])
    expect(trail(circle, { from: 0, to: 2, samples: 1 })).toEqual([circle(2)])
  })

  test('works for 3D points and copies each point (fn may reuse one buffer)', () => {
    const shared: Vec3 = [0, 0, 0]
    const helix = (t: number): Vec3 => { shared[0] = Math.cos(t); shared[1] = t; shared[2] = Math.sin(t); return shared }
    const points = trail(helix, { from: 0, to: 3, samples: 4 })
    expect(points.map((p) => p[1])).toEqual([0, 1, 2, 3])
    expect(points[0]).toEqual([1, 0, 0])
  })

  test('with `every`, points sit on a fixed time grid, so they do not crawl as the trail grows', () => {
    const position = (t: number): Vec2 => [t, t * t]
    const short = trail(position, { from: 0, to: 1.03, every: 0.25 })
    expect(short.map((p) => p[0])).toEqual([0, 0.25, 0.5, 0.75, 1, 1.03])
    const longer = trail(position, { from: 0, to: 1.61, every: 0.25 })
    expect(longer.map((p) => p[0])).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.61])
    expect(longer.slice(0, 5)).toEqual(short.slice(0, 5)) // the old vertices did not move
    // a window that slides with time keeps the same interior grid
    expect(trail(position, { from: 0.6, to: 1.61, every: 0.25 }).map((p) => p[0])).toEqual([0.6, 0.75, 1, 1.25, 1.5, 1.61])
    // ends that fall on the grid are not doubled
    expect(trail(position, { from: 0.5, to: 1, every: 0.25 }).map((p) => p[0])).toEqual([0.5, 0.75, 1])
    expect(trail(position, { from: 1, to: 0.5, every: 0.25 }).map((p) => p[0])).toEqual([1, 0.75, 0.5])
    expect(trail(position, { from: 1, to: 1, every: 0.25 })).toEqual([[1, 1]])
  })

  test('is bounded and never throws on bad options', () => {
    expect(trail(circle, { from: 0, to: 1e9, every: 0.001 }).length).toBeLessThanOrEqual(20_002)
    expect(trail(circle, { from: 0, to: 1, samples: 1e9 }).length).toBe(20_000)
    expect(trail(circle, { from: 0, to: 1, samples: -3 })).toHaveLength(64)
    expect(trail(circle, { from: Number.NaN, to: Number.NaN })).toEqual([[1, 0]])
    expect(trail(circle, undefined as unknown as { to: number })).toEqual([[1, 0]])
  })
})

describe('accumulate: integrating a varying rate', () => {
  test('a constant rate gives rate * t', () => {
    expect(accumulate(() => 360, 2.5)).toBeCloseTo(900, 9)
    expect(accumulate(() => 360, 0)).toBe(0)
    expect(accumulate(() => 6 * 1200, 1 / 3)).toBeCloseTo(2400, 9) // 1200 rpm for a third of a second, in degrees
  })

  test('matches closed forms for ramps, cubics and sines, on and off the step grid', () => {
    const rpm = (t: number): number => 600 + 300 * t // spinning up
    for (const t of [0.001, 0.5, 1, 1.2345, 7.77]) {
      expect(accumulate((s) => rpm(s) * 6, t)).toBeCloseTo(6 * (600 * t + 150 * t * t), 7)
      expect(accumulate((s) => s * s * s, t)).toBeCloseTo(t ** 4 / 4, 9) // the rule is exact for cubics
      expect(Math.abs(accumulate(Math.cos, t) - Math.sin(t))).toBeLessThan(1e-10)
    }
  })

  test('the angle never jumps when the rate changes (the bug of angle = rpm * t)', () => {
    const rpm = (t: number): number => (t < 2 ? 600 : 3000) // the slider is pushed up at t = 2
    const angle = (t: number): number => accumulate((s) => rpm(s) * 6, t)
    expect(angle(2)).toBeCloseTo(7200, 6)
    expect(angle(2.001) - angle(2)).toBeCloseTo(18, 6) // 3000 rpm for 1 ms; rpm * t would jump by 28,800 degrees
    expect(angle(3)).toBeCloseTo(7200 + 18000, 6)
    for (let i = 0; i < 200; i++) {
      const t = 1.9 + i * 0.001
      expect(angle(t + 0.001) - angle(t)).toBeLessThanOrEqual(18.000001)
      expect(angle(t + 0.001) - angle(t)).toBeGreaterThanOrEqual(3.599999)
    }
  })

  test('negative time integrates backwards, and a custom step is honoured', () => {
    expect(accumulate(() => 5, -2)).toBeCloseTo(-10, 9)
    expect(accumulate((s) => 2 * s, -3)).toBeCloseTo(9, 9)
    let calls = 0
    expect(accumulate(() => { calls++; return 1 }, 1, 0.1)).toBeCloseTo(1, 12)
    expect(calls).toBe(20) // 10 steps, two rate samples each
  })

  test('never throws: non-finite rates count as 0, junk arguments give 0', () => {
    expect(accumulate((t) => (t < 1 ? Number.NaN : 2), 2)).toBeCloseTo(2, 2)
    expect(accumulate(() => Infinity, 1)).toBe(0)
    expect(accumulate(() => 1, Number.NaN)).toBe(0)
    expect(accumulate(() => 1, Infinity)).toBe(0)
    expect(accumulate(undefined as unknown as () => number, 1)).toBe(0)
    expect(accumulate(() => 1, 1, -5)).toBeCloseTo(1, 12) // bad dt falls back to the default
  })

  test('accumulator().at(t) is the cached form: bit-identical to accumulate, in any call order', () => {
    const rate = (t: number): number => 600 + 250 * Math.sin(1.3 * t) + (t > 4 ? 900 : 0)
    const random = rng('accumulate')
    const times = [...Array.from({ length: 120 }, () => random.range(-3, 12)), 0, 1, 2.5, -1, 12]
    const cached = accumulator(rate)
    const expected = times.map((t) => accumulate(rate, t))
    times.forEach((t, i) => expect(cached.at(t)).toBe(expected[i]!))
    const again = accumulator(rate, { checkpointEvery: 1 })
    for (const i of rng(2).shuffle(times.map((_t, index) => index))) expect(again.at(times[i]!)).toBe(expected[i]!)
    expect(accumulator(rate, { dt: 0.01 }).at(3.3)).toBe(accumulate(rate, 3.3, 0.01))
  })

  test('the cache makes increasing time cheap, and reset() picks up a changed rate', () => {
    let calls = 0
    let gain = 1
    const cached = accumulator((t) => { calls++; return gain * t })
    cached.at(10)
    const first = calls
    expect(first).toBe(2400 * 2)
    for (let frame = 1; frame <= 60; frame++) cached.at(10 + frame / 60)
    expect(calls - first).toBe(240 * 2) // one second more costs one second of steps, not eleven
    calls = 0
    cached.at(5.0001) // scrubbing back: at most one checkpoint interval of steps, plus the part-step
    expect(calls).toBeLessThanOrEqual(16 * 2 + 2)
    gain = 2
    expect(cached.at(10)).toBeCloseTo(50, 9) // stale until reset
    cached.reset()
    expect(cached.at(10)).toBeCloseTo(100, 9)
  })
})

describe('smoothDamp: a smooth follower as a function of time', () => {
  test('a fixed target is approached along the critically damped curve, with no overshoot', () => {
    const smoothTime = 0.4
    const omega = 2 / smoothTime
    const follower = smoothDamp(10, { smoothTime, from: 0 })
    let previous = 0
    for (let i = 0; i <= 480; i++) {
      const t = i * DT
      const value = follower.at(t)
      expect(Math.abs(value - 10 * (1 - (1 + omega * t) * Math.exp(-omega * t)))).toBeLessThan(1e-9)
      expect(value).toBeGreaterThanOrEqual(previous)
      expect(value).toBeLessThanOrEqual(10)
      previous = value
    }
    expect(follower.velocity(0)).toBe(0)
    expect(follower.velocity(0.2)).toBeCloseTo(10 * omega * omega * 0.2 * Math.exp(-omega * 0.2), 6)
    expect(follower.at(5)).toBeCloseTo(10, 6)
  })

  test('starts settled on the target by default, then eases after a step change', () => {
    const target = (t: number): number => (t < 1 ? 2 : 5)
    const follower = smoothDamp(target, { smoothTime: 0.3 })
    expect(follower.at(0)).toBe(2)
    expect(follower.at(0.99)).toBe(2)
    expect(follower.at(1.1)).toBeGreaterThan(2)
    expect(follower.at(1.1)).toBeLessThan(5)
    const omega = 2 / 0.3
    expect(follower.at(1.5)).toBeCloseTo(5 - 3 * (1 + omega * 0.5) * Math.exp(-omega * 0.5), 6)
    expect(follower.at(4)).toBeCloseTo(5, 6)
    for (let i = 0; i < 300; i++) expect(follower.at(1 + (i + 1) * 0.01)).toBeGreaterThanOrEqual(follower.at(1 + i * 0.01))
  })

  test('follows a moving target with a lag of about smoothTime', () => {
    const follower = smoothDamp((t) => 3 * t, { smoothTime: 0.5 })
    expect(follower.at(6)).toBeCloseTo(3 * (6 - 0.5), 4) // steady-state lag of a critically damped follower = smoothTime
    expect(follower.velocity(6)).toBeCloseTo(3, 3)
  })

  test('identical bits whatever the call order', () => {
    const make = () => smoothDamp((t) => Math.sin(3 * t) + (t > 2 ? 1 : 0), { smoothTime: 0.25 })
    const random = rng('smooth')
    const times = Array.from({ length: 150 }, () => random.range(0, 8))
    const ascending = make()
    const expected = new Map([...times].sort((a, b) => a - b).map((t) => [t, ascending.at(t)]))
    const shuffled = make()
    for (const t of times) expect(shuffled.at(t)).toBe(expected.get(t)!)
    expect(make().at(times[0]!)).toBe(expected.get(times[0]!)!)
  })

  test('smoothDampStep is exact and stable for any step size', () => {
    // one big step equals many small ones (the update is the exact solution for a held target)
    let value = 0, velocity = 0
    for (let i = 0; i < 1000; i++) [value, velocity] = smoothDampStep(value, velocity, 1, 0.3, 0.001)
    const [single, singleVelocity] = smoothDampStep(0, 0, 1, 0.3, 1)
    expect(value).toBeCloseTo(single, 10)
    expect(velocity).toBeCloseTo(singleVelocity, 10)
    // a huge step with a tiny smoothTime lands on the target instead of exploding
    const [landed, landedVelocity] = smoothDampStep(0, 0, 1, 0.001, 10)
    expect(landed).toBe(1)
    expect(Math.abs(landedVelocity)).toBe(0)
    expect(smoothDampStep(3, 99, 7, 0, 0.1)).toEqual([7, 0]) // no smoothing: jump to the target
    expect(smoothDampStep(4, 0, 4, 0.3, 0.1)).toEqual([4, 0]) // already there: stays
  })

  test('never throws: smoothTime 0 tracks the target, junk falls back, reset() picks up a new target', () => {
    expect(smoothDamp((t) => 2 * t, { smoothTime: 0 }).at(3)).toBe(6)
    expect(smoothDamp(() => Number.NaN).at(1)).toBe(0)
    expect(smoothDamp(4).at(-1)).toBe(4)
    expect(smoothDamp(4, { smoothTime: Number.NaN, dt: -1 }).at(2)).toBe(4)
    let goal = 1
    const follower = smoothDamp(() => goal, { smoothTime: 0.2 })
    expect(follower.at(3)).toBe(1)
    goal = 8
    follower.reset()
    expect(follower.at(3)).toBe(8)
  })
})
