// Shapes from maths (src/lib/curves.ts): pure, and checked against what the formulas are known to give.
import { describe, expect, test } from 'bun:test'
import { areaBetween, areaOf, curve, CURVE_SAMPLES, FULL_TURN, lengthOf, moved, outset, parameters, polar } from '../../../src/lib/curves.ts'

const circle = (r: number, n = 720) => curve((t) => [r * Math.cos(t), r * Math.sin(t)], { samples: n })

describe('curve and polar', () => {
  test('one full turn in radians by default, closed: the first point is not repeated', () => {
    const c = curve((t) => [2 * Math.cos(t), 2 * Math.sin(t)])
    expect(c).toHaveLength(CURVE_SAMPLES)
    expect(c[0]![0]).toBeCloseTo(2, 12)
    expect(Math.hypot(c[0]![0] - c[c.length - 1]![0], c[0]![1] - c[c.length - 1]![1])).toBeGreaterThan(0.01)
    expect(parameters()).toMatchObject({ closed: true })
    expect(parameters().values[CURVE_SAMPLES - 1]).toBeCloseTo(FULL_TURN * (1 - 1 / CURVE_SAMPLES), 12)
  })
  test('an open stretch has both of its ends', () => {
    const s = curve((x) => [x, x * x], { from: 0, to: 3, samples: 4 })
    expect(s).toEqual([[0, 0], [1, 1], [2, 4], [3, 9]])
    expect(parameters({ from: 0, to: 3 }).closed).toBe(false)
  })
  test('an epitrochoid has the two radii the formula says, and polar is the same thing by radius', () => {
    const R = 1.05, e = 0.15
    const wall = curve((t) => [R * Math.cos(t) + e * Math.cos(3 * t), R * Math.sin(t) + e * Math.sin(3 * t)], { samples: 720 })
    const radii = wall.map(([x, y]) => Math.hypot(x, y))
    expect(Math.max(...radii)).toBeCloseTo(R + e, 6)
    expect(Math.min(...radii)).toBeCloseTo(R - e, 4)
    const flower = polar((a) => 1 + 0.2 * Math.cos(3 * a), { samples: 360 })
    expect(Math.hypot(...(flower[0] as [number, number]))).toBeCloseTo(1.2, 12)
    expect(Math.hypot(...(flower[60] as [number, number]))).toBeCloseTo(0.8, 12)
  })
  test('nothing throws: a formula that fails or gives no number leaves the point out', () => {
    expect(curve((t) => { if (t > 3) throw new Error('boom'); return [t, 1 / (t - 1)] }, { from: 0, to: 4, samples: 5 })).toEqual([[0, -1], [2, 1], [3, 0.5]])
    expect(curve(5 as never)).toEqual([])
    expect(polar('r' as never)).toEqual([])
    expect(curve((t) => ({ x: t, y: 2 * t }), { from: 0, to: 1, samples: 2 })).toEqual([[0, 0], [1, 2]])
  })
})

describe('outset', () => {
  test('a circle grows by exactly the distance, whichever way round it is drawn, and its points keep their order', () => {
    for (const ring of [circle(2), circle(2).reverse()]) {
      const grown = outset(ring, 0.5)
      expect(grown).toHaveLength(ring.length)
      for (const [x, y] of grown) expect(Math.hypot(x, y)).toBeCloseTo(2.5, 4)
      expect(Math.atan2(grown[10]![1], grown[10]![0])).toBeCloseTo(Math.atan2(ring[10]![1], ring[10]![0]), 6)
      for (const [x, y] of outset(ring, -0.5)) expect(Math.hypot(x, y)).toBeCloseTo(1.5, 4)
    }
  })
  test('a square: edges move out by the distance, corners along the diagonal; a wall has the area of both', () => {
    const square = [[0, 0], [2, 0], [2, 2], [0, 2]]
    expect(outset(square, 0.5)).toEqual([[-0.5, -0.5], [2.5, -0.5], [2.5, 2.5], [-0.5, 2.5]])
    expect(areaOf(outset(square, 0.5)) - areaOf(square)).toBeCloseTo(5, 12)
  })
  test('too few points, no distance, a point that repeats: the outline comes back whole', () => {
    expect(outset([[0, 0], [1, 1]], 1)).toEqual([[0, 0], [1, 1]])
    expect(outset([[0, 0], [2, 0], [2, 2]], 0)).toEqual([[0, 0], [2, 0], [2, 2]])
    const doubled = outset([[0, 0], [2, 0], [2, 0], [2, 2], [0, 2]], 0.5)
    expect(doubled).toHaveLength(5)
    expect(doubled[1]).toEqual(doubled[2]!)
    for (const p of doubled) for (const v of p) expect(Number.isFinite(v)).toBe(true)
  })
})

describe('moved, areas and lengths', () => {
  test('a pose turns an outline (degrees, about its own origin) and then moves it', () => {
    const p = moved([[1, 0], [0, 1]], { at: [10, 20], turn: 90 })
    expect(p[0]![0]).toBeCloseTo(10, 12); expect(p[0]![1]).toBeCloseTo(21, 12)
    expect(p[1]![0]).toBeCloseTo(9, 12); expect(p[1]![1]).toBeCloseTo(20, 12)
    expect(moved([[1, 2]], {})).toEqual([[1, 2]])
  })
  test('area and length of a circle; either way round', () => {
    expect(areaOf(circle(3))).toBeCloseTo(Math.PI * 9, 2)
    expect(areaOf(circle(3).reverse())).toBeCloseTo(Math.PI * 9, 2)
    expect(lengthOf(circle(3), true)).toBeCloseTo(2 * Math.PI * 3, 3)
    expect(lengthOf([[0, 0], [3, 4]])).toBe(5)
    expect(areaOf([[0, 0], [1, 1]])).toBe(0)
  })
  test('the area between two stretches of curve does not depend on the direction either is drawn in', () => {
    const arc = curve((t) => [Math.cos(t), Math.sin(t)], { from: 0, to: Math.PI, samples: 400 }) // a half circle over the x axis
    const chord = [[1, 0], [-1, 0]]
    const half = Math.PI / 2
    expect(areaBetween(arc, chord)).toBeCloseTo(half, 3)
    expect(areaBetween(arc, chord.slice().reverse())).toBeCloseTo(half, 3)
    expect(areaBetween(arc.slice().reverse(), chord)).toBeCloseTo(half, 3)
    expect(areaBetween([], chord)).toBe(0)
  })
})
