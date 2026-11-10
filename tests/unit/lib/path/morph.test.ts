import { describe, expect, test } from 'bun:test'
import {
  arcPath, bounds, circlePath, ellipsePath, flattenPath, morphAt, morphPlan, parsePath, pathLength, polygonPath,
  polylinePath, rectPath, toPathString, transformPath,
} from '../../../../src/lib/path/index.ts'
import type { MorphPlan, Subpath } from '../../../../src/lib/path/index.ts'
import type { Vec2 } from '../../../../src/lib/types.ts'
import { anchors, curveDistance, dist, isSimpleLoop, rng, signedArea, starPoints } from './helpers.ts'

const square = rectPath({ width: 2, height: 2 })
const circle = circlePath({ radius: 1 })
const star = polygonPath(starPoints(5))
/** A circle that starts at 137° and runs clockwise: the worst case for index matching. */
const awkwardCircle: Subpath[] = (() => {
  const turned = transformPath(circle, [Math.cos(2.39), Math.sin(2.39), Math.sin(2.39), -Math.cos(2.39), 0, 0])
  return turned
})()
const ring = [...circlePath({ radius: 1 }), ...circlePath({ radius: 0.5 })]
const threeCircles = [-1.2, 0, 1.2].flatMap((x) => circlePath({ radius: 0.5, center: [x, 0] }))

/** Mean distance travelled by the anchors of a plan. */
function travel(plan: MorphPlan): number {
  let sum = 0, count = 0
  for (const pair of plan.pairs) {
    for (let i = 0; i < pair.from.length; i += 6) {
      sum += Math.hypot(pair.to[i] - pair.from[i], pair.to[i + 1] - pair.from[i + 1])
      count++
    }
  }
  return sum / count
}

const cases: Record<string, [Subpath[], Subpath[]]> = {
  'square → circle': [square, circle],
  'circle → square': [circle, square],
  'square → star': [square, star],
  'awkward circle → square': [awkwardCircle, square],
  'rounded rect → ellipse': [rectPath({ width: 4, height: 2, radius: 0.5 }), ellipsePath({ rx: 1, ry: 2, center: [3, 1] })],
  'ring (2 subpaths) → disc (1)': [ring, circle],
  '1 circle → 3 circles': [circle, threeCircles],
  'open arc → line': [arcPath({ radius: 1, from: 180, to: 0 }), polylinePath([[-1, 0], [1, 0]])],
  'reversed line → arc': [polylinePath([[1, 0], [-1, 0]]), arcPath({ radius: 1, from: 180, to: 0 })],
  'circle → open line (unrolling)': [circle, polylinePath([[-3, -2], [3, -2]])],
  'open zigzag → closed square': [polylinePath([[-2, 0], [-1, 1], [0, 0], [1, 1], [2, 0]]), square],
  'svg heart → circle': [parsePath('M0 -1 C -2 0.5 -1 2 0 1 C 1 2 2 0.5 0 -1 Z'), circle],
  'two subpaths → two subpaths': [
    [...square, ...circlePath({ radius: 0.3, center: [3, 0] })],
    [...circlePath({ radius: 0.4, center: [-3, 0] }), ...star],
  ],
}

describe('morph end points equal the inputs', () => {
  for (const [name, [from, to]] of Object.entries(cases)) {
    test(name, () => {
      const plan = morphPlan(from, to)
      for (const pair of plan.pairs) {
        expect(pair.from.length).toBe(pair.to.length)
        expect((pair.from.length - 2) % 6).toBe(0)
      }
      const start = morphAt(plan, 0), end = morphAt(plan, 1)
      // unmatched subpaths start (or end) as a point at their own centre, so compare only the side that exists
      if (from.length >= to.length) {
        expect(curveDistance(start, from)).toBeLessThan(5e-6)
        expect(Math.abs(pathLength(start) / pathLength(from) - 1)).toBeLessThan(1e-9)
        expect(bounds(start).width).toBeCloseTo(bounds(from).width, 9)
      }
      if (to.length >= from.length) {
        expect(curveDistance(end, to)).toBeLessThan(5e-6)
        expect(Math.abs(pathLength(end) / pathLength(to) - 1)).toBeLessThan(1e-9)
        expect(bounds(end).height).toBeCloseTo(bounds(to).height, 9)
      }
      // u = 0 and u = 1 are bit-exact copies of the plan's two sides
      expect(start.map((s) => s.coords)).toEqual(plan.pairs.map((p) => p.from))
      expect(end.map((s) => s.coords)).toEqual(plan.pairs.map((p) => p.to))
    })
  }

  test('corners stay sharp: every corner of both shapes is an anchor of the morph, exactly', () => {
    const plan = morphPlan(circle, square)
    const end = anchors(morphAt(plan, 1)[0])
    for (const corner of [[1, 1], [-1, 1], [-1, -1], [1, -1]] as Vec2[]) {
      expect(end.some((p) => p[0] === corner[0] && p[1] === corner[1])).toBe(true)
    }
    const back = morphPlan(star, circle)
    const start = anchors(morphAt(back, 0)[0])
    for (const tip of starPoints(5)) expect(start.some((p) => dist(p, tip) < 1e-12)).toBe(true)
    // and straight edges stay straight: the square end is written with L only
    expect(toPathString(morphAt(plan, 1))).not.toContain('C')
  })

  test('closed pairs stay closed and end on their start; mixed pairs are open', () => {
    const closed = morphAt(morphPlan(square, circle), 0.4)[0]
    expect(closed.closed).toBe(true)
    expect(closed.coords.slice(-2)).toEqual(closed.coords.slice(0, 2))
    expect(morphAt(morphPlan(circle, polylinePath([[0, 0], [1, 0]])), 0.4)[0].closed).toBe(false)
  })
})

describe('morph quality', () => {
  test('square → circle stays a simple loop the whole way, with the same winding', () => {
    for (const [from, to] of [[square, circle], [circle, square], [awkwardCircle, square], [square, awkwardCircle]]) {
      const plan = morphPlan(from, to)
      for (let i = 0; i <= 20; i++) {
        const shape = morphAt(plan, i / 20)
        expect(shape.length).toBe(1)
        const loop = flattenPath(shape, 1e-3)[0]
        expect(isSimpleLoop(loop)).toBe(true)
        // never collapses or turns inside out: area stays between the circle's (π) and the square's (4)
        const area = Math.abs(signedArea(loop))
        expect(area).toBeGreaterThan(3.1)
        expect(area).toBeLessThan(4.001)
        // every point stays between the inscribed circle and the square's corner
        for (const p of loop) {
          const r = Math.hypot(p[0], p[1])
          expect(r).toBeGreaterThan(0.99)
          expect(r).toBeLessThan(Math.SQRT2 + 1e-9)
        }
      }
    }
  })

  test('square → star and heart → circle stay simple too', () => {
    for (const [from, to] of [cases['square → star'], cases['svg heart → circle']]) {
      const plan = morphPlan(from, to)
      for (let i = 0; i <= 20; i++) expect(isSimpleLoop(flattenPath(morphAt(plan, i / 20), 1e-3)[0])).toBe(true)
    }
  })

  test('aligning start point and direction removes the twist (travel vs index matching)', () => {
    const aligned = travel(morphPlan(awkwardCircle, square))
    const naive = travel(morphPlan(awkwardCircle, square, { align: false }))
    expect(aligned).toBeLessThan(0.2)
    expect(naive).toBeGreaterThan(1)
    // unaligned, the same morph turns inside out: its signed area goes through zero
    const twisted = morphPlan(awkwardCircle, square, { align: false })
    const areaAt = (plan: MorphPlan, u: number): number => signedArea(flattenPath(morphAt(plan, u), 1e-3)[0])
    expect(areaAt(twisted, 0) * areaAt(twisted, 1)).toBeLessThan(0)
    expect(Math.abs(areaAt(twisted, 0.45))).toBeLessThan(0.5)
    const kept = morphPlan(awkwardCircle, square)
    expect(areaAt(kept, 0) * areaAt(kept, 1)).toBeGreaterThan(0)
    // an already aligned pair is not made worse
    expect(travel(morphPlan(circle, square))).toBeLessThan(0.2)
  })

  test('the same shape with another start point or direction does not move at all', () => {
    const pentagon: Vec2[] = [0, 1, 2, 3, 4].map((i) => [Math.cos((i * 2 * Math.PI) / 5), Math.sin((i * 2 * Math.PI) / 5)])
    const rotated = [...pentagon.slice(2), ...pentagon.slice(0, 2)]
    const backwards = [...pentagon].reverse()
    for (const other of [rotated, backwards]) {
      const plan = morphPlan(polygonPath(pentagon), polygonPath(other))
      for (const pair of plan.pairs) {
        for (let i = 0; i < pair.from.length; i++) expect(Math.abs(pair.from[i] - pair.to[i])).toBeLessThan(1e-9)
      }
    }
    // a translated, scaled copy moves every point along the same affine map
    const moved = transformPath(polygonPath(rotated), [2, 0, 0, 2, 5, 1])
    const plan = morphPlan(polygonPath(pentagon), moved)
    for (const pair of plan.pairs) {
      for (let i = 0; i < pair.from.length; i += 2) {
        expect(Math.abs(pair.to[i] - (2 * pair.from[i] + 5))).toBeLessThan(1e-9)
        expect(Math.abs(pair.to[i + 1] - (2 * pair.from[i + 1] + 1))).toBeLessThan(1e-9)
      }
    }
  })

  test('open paths are reversed when that is shorter', () => {
    const plan = morphPlan(polylinePath([[1, 0], [-1, 0]]), arcPath({ radius: 1, from: 180, to: 0 }))
    // the line runs right → left, the arc left → right: the arc is turned round, nothing crosses over
    expect(travel(plan)).toBeLessThan(0.7)
    expect(travel(morphPlan(polylinePath([[1, 0], [-1, 0]]), arcPath({ radius: 1, from: 180, to: 0 }), { align: false }))).toBeGreaterThan(1)
  })

  test('a circle unrolls onto a line without crossing itself', () => {
    const plan = morphPlan(circle, polylinePath([[-3, -2], [3, -2]]))
    expect(plan.pairs.length).toBe(1)
    for (let i = 1; i < 20; i++) {
      const line = flattenPath(morphAt(plan, i / 20), 1e-3)[0]
      // treat the open curve as a loop by closing it: still no crossing between non-adjacent pieces
      expect(isSimpleLoop([...line, line[0]])).toBe(true)
    }
  })

  test('subpaths pair longest with longest; unmatched ones grow from their own centre', () => {
    const plan = morphPlan(circle, threeCircles)
    expect(plan.pairs.length).toBe(3)
    const start = morphAt(plan, 0)
    // equal lengths keep their authored order: the first small circle (x = -1.2) takes the big circle
    expect(bounds([start[0]]).width).toBeCloseTo(2, 9)
    expect(bounds([morphAt(plan, 1)[0]]).x).toBeCloseTo(-1.7, 9)
    for (const [k, x] of [[1, 0], [2, 1.2]]) {
      const b = bounds([start[k]])
      expect(b.width).toBeLessThan(1e-12)
      expect(b.height).toBeLessThan(1e-12)
      expect(b.x).toBeCloseTo(x, 6)
      expect(b.y).toBeCloseTo(0, 6)
    }
    // ring → disc: the hole shrinks to its centre
    const hole = morphAt(morphPlan(ring, circle), 1)[1]
    expect(bounds([hole]).width).toBeLessThan(1e-12)
    const half = morphAt(morphPlan(ring, circle), 0.5)[1]
    expect(bounds([half]).width).toBeCloseTo(0.5, 3)
  })

  test('detail controls the number of pieces; anchors are always kept', () => {
    const count = (plan: MorphPlan): number => (plan.pairs[0].from.length - 2) / 6
    expect(count(morphPlan(square, circle))).toBe(24)
    expect(count(morphPlan(square, circle, { detail: 8 }))).toBe(8)
    expect(count(morphPlan(square, circle, { detail: 1 }))).toBe(8) // 4 corners + 4 circle anchors, offset by 45°
    expect(count(morphPlan(square, circle, { detail: 64 }))).toBe(64)
    expect(count(morphPlan(square, circle, { detail: NaN }))).toBe(24)
  })
})

describe('morphAt', () => {
  const plan = morphPlan(square, circle)

  test('is a pure function of (plan, u): same input, same output, plan untouched', () => {
    const before = JSON.stringify(plan)
    const a = morphAt(plan, 0.37), b = morphAt(plan, 0.37)
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    morphAt(plan, 0.9)
    expect(JSON.stringify(plan)).toBe(before)
    expect(morphPlan(square, circle)).toEqual(plan)
    expect(JSON.parse(before)).toEqual(plan) // plain data
  })

  test('halfway is the midpoint of every number', () => {
    const half = morphAt(plan, 0.5)[0].coords
    const { from, to } = plan.pairs[0]
    for (let i = 0; i < half.length; i++) expect(half[i]).toBeCloseTo((from[i] + to[i]) / 2, 12)
  })

  test('reuses the out buffer without allocating new arrays', () => {
    const out: Subpath[] = []
    const first = morphAt(plan, 0.2, 0, out)
    expect(first).toBe(out)
    const coords = out[0].coords
    const second = morphAt(plan, 0.8, 0, out)
    expect(second).toBe(out)
    expect(out[0].coords).toBe(coords)
    expect(out).toEqual(morphAt(plan, 0.8))
    // a buffer from another plan is resized
    const other = morphPlan(ring, circle)
    morphAt(other, 0.5, 0, out)
    expect(out).toEqual(morphAt(other, 0.5))
    morphAt(plan, 0.5, 0, out)
    expect(out).toEqual(morphAt(plan, 0.5))
  })

  test('u outside 0…1 extrapolates (overshooting easings); NaN is 0', () => {
    const { from, to } = plan.pairs[0]
    const over = morphAt(plan, 1.1)[0].coords
    for (let i = 0; i < over.length; i++) expect(over[i]).toBeCloseTo(to[i] + 0.1 * (to[i] - from[i]), 12)
    expect(morphAt(plan, NaN)).toEqual(morphAt(plan, 0))
  })

  test('pathArcDeg: same end points, and halfway along a 180° arc every point is half a chord from the midpoint', () => {
    expect(morphAt(plan, 0, 90)).toEqual(morphAt(plan, 0))
    expect(morphAt(plan, 1, 90)).toEqual(morphAt(plan, 1))
    expect(morphAt(plan, 0.5, 0)).toEqual(morphAt(plan, 0.5))
    const moved = morphPlan(square, transformPath(square, [1, 0, 0, 1, 4, 0]))
    const { from, to } = moved.pairs[0]
    const half = morphAt(moved, 0.5, 180)[0].coords
    for (let i = 0; i < half.length; i += 2) {
      const mid: Vec2 = [(from[i] + to[i]) / 2, (from[i + 1] + to[i + 1]) / 2]
      expect(dist([half[i], half[i + 1]], mid)).toBeCloseTo(2, 9)
      // counter-clockwise from a to b: the route dips below the straight line
      expect(half[i + 1]).toBeCloseTo(mid[1] - 2, 9)
    }
    // continuity into the end points
    const nearEnd = morphAt(moved, 1 - 1e-9, 180)[0].coords
    for (let i = 0; i < nearEnd.length; i++) expect(nearEnd[i]).toBeCloseTo(to[i], 6)
    const nearStart = morphAt(moved, 1e-9, -120)[0].coords
    for (let i = 0; i < nearStart.length; i++) expect(nearStart[i]).toBeCloseTo(from[i], 6)
  })
})

describe('morph: degenerate input never throws', () => {
  test('empty sides, points, zero-length and malformed subpaths', () => {
    expect(morphPlan([], [])).toEqual({ pairs: [] })
    expect(morphAt(morphPlan([], []), 0.5)).toEqual([])
    const fromNothing = morphPlan([], square)
    expect(curveDistance(morphAt(fromNothing, 1), square)).toBeLessThan(5e-6)
    expect(bounds(morphAt(fromNothing, 0)).width).toBeLessThan(1e-12)
    const point: Subpath[] = [{ coords: [2, 2], closed: false }]
    const toPoint = morphPlan(square, point)
    expect(curveDistance(morphAt(toPoint, 0), square)).toBeLessThan(5e-6)
    expect(bounds(morphAt(toPoint, 1))).toEqual({ x: 2, y: 2, width: 0, height: 0 })
    expect(morphAt(morphPlan(point, point), 0.5)[0].coords.slice(0, 2)).toEqual([2, 2])
    const zero: Subpath[] = [{ coords: [1, 1, 1, 1, 1, 1, 1, 1], closed: true }]
    expect(morphAt(morphPlan(zero, circle), 1).length).toBe(1)
    expect(morphPlan(null as unknown as Subpath[], [null as unknown as Subpath])).toEqual({ pairs: [] })
    expect(morphAt(null as unknown as MorphPlan, 0.5)).toEqual([])
    expect(morphAt(morphPlan(square, circle), 0.5, 0, null as unknown as Subpath[])).toEqual(morphAt(morphPlan(square, circle), 0.5))
    expect(morphAt(morphPlan(square, circle), 0.5, NaN)).toEqual(morphAt(morphPlan(square, circle), 0.5))
    const nan: Subpath[] = [{ coords: [0, 0, NaN, 1, 2, 2, 3, 3], closed: false }]
    expect(() => morphAt(morphPlan(nan, circle), 0.5)).not.toThrow()
  })

  test('paths with repeated points and zero-length curves still match up', () => {
    const messy = parsePath('M0 0 L0 0 L2 0 L2 0 L2 2 C 2 2 2 2 2 2 L0 2 Z')
    const plan = morphPlan(messy, circle)
    expect(plan.pairs[0].from.length).toBe(plan.pairs[0].to.length)
    expect(curveDistance(morphAt(plan, 0), messy)).toBeLessThan(5e-6)
    expect(curveDistance(morphAt(plan, 1), circle)).toBeLessThan(5e-6)
  })

  test('100 random pairs: both ends reproduce the inputs', () => {
    const random = rng(23)
    const randomShape = (): Subpath[] => {
      const coords = [random() * 6 - 3, random() * 6 - 3]
      const curves = 1 + Math.floor(random() * 5)
      for (let j = 0; j < curves; j++) for (let q = 0; q < 6; q++) coords.push(random() * 6 - 3)
      const closed = random() < 0.5
      if (closed) { coords[coords.length - 2] = coords[0]; coords[coords.length - 1] = coords[1] }
      return [{ coords, closed }]
    }
    for (let n = 0; n < 100; n++) {
      const a = randomShape(), b = randomShape()
      const plan = morphPlan(a, b)
      const start = morphAt(plan, 0), end = morphAt(plan, 1)
      expect(Math.abs(pathLength(start) / pathLength(a) - 1)).toBeLessThan(1e-8)
      expect(Math.abs(pathLength(end) / pathLength(b) - 1)).toBeLessThan(1e-8)
      if (n < 25) {
        expect(curveDistance(start, a, 1e-5)).toBeLessThan(5e-5)
        expect(curveDistance(end, b, 1e-5)).toBeLessThan(5e-5)
      }
    }
  })
})

describe('performance', () => {
  // The targets in the test names are the library's. A wall clock on a shared machine cannot hold a test to them, so
  // they are asserted as they are with MIMIR_PERF=1 (a quiet machine) and with PERF_SLACK times the room otherwise:
  // enough to catch an algorithm that has become an order of magnitude slower, not a busy runner.
  const PERF_SLACK = process.env.MIMIR_PERF === '1' ? 1 : 20
  // Best of several batches, so a busy machine does not fail the budget by accident.
  const microseconds = (run: () => unknown, repeats: number): number => {
    for (let i = 0; i < Math.min(repeats, 500); i++) run()
    let best = Infinity
    for (let batch = 0; batch < 7; batch++) {
      const t0 = performance.now()
      for (let i = 0; i < repeats; i++) run()
      best = Math.min(best, ((performance.now() - t0) * 1000) / repeats)
    }
    return best
  }

  test('morphPlan under 1 ms for typical shapes', () => {
    expect(microseconds(() => morphPlan(square, circle), 300)).toBeLessThan(1000 * PERF_SLACK)
    expect(microseconds(() => morphPlan(star, awkwardCircle), 300)).toBeLessThan(1000 * PERF_SLACK)
    expect(microseconds(() => morphPlan(cases['rounded rect → ellipse'][0], cases['rounded rect → ellipse'][1]), 300)).toBeLessThan(1000 * PERF_SLACK)
    expect(microseconds(() => morphPlan(circle, polylinePath([[-3, -2], [3, -2]])), 300)).toBeLessThan(1000 * PERF_SLACK)
  })

  test('morphAt under 20 µs for a typical shape, with and without a reused buffer, straight or along an arc', () => {
    const plan = morphPlan(square, circle)
    const out: Subpath[] = []
    expect(microseconds(() => morphAt(plan, 0.37, 0, out), 20000)).toBeLessThan(20 * PERF_SLACK)
    expect(microseconds(() => morphAt(plan, 0.37), 20000)).toBeLessThan(20 * PERF_SLACK)
    expect(microseconds(() => morphAt(plan, 0.37, 90, out), 20000)).toBeLessThan(20 * PERF_SLACK)
    const starPlan = morphPlan(star, awkwardCircle)
    expect(microseconds(() => morphAt(starPlan, 0.37, 0, out), 20000)).toBeLessThan(20 * PERF_SLACK)
  })

  test('a whole frame of square → circle (morphAt + toPathString) stays under 50 µs', () => {
    const plan = morphPlan(square, circle)
    const out: Subpath[] = []
    expect(microseconds(() => toPathString(morphAt(plan, 0.37, 0, out)), 5000)).toBeLessThan(50 * PERF_SLACK)
  })
})
