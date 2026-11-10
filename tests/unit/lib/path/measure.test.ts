import { describe, expect, test } from 'bun:test'
import {
  arcPath, bounds, circlePath, flattenPath, measurePath, parsePath, pathLength, pointAt, polygonPath, polylinePath,
  rectPath, toPathString, transformPath, trimPath,
} from '../../../../src/lib/path/index.ts'
import type { Subpath } from '../../../../src/lib/path/index.ts'
import type { Vec2 } from '../../../../src/lib/types.ts'
import { anchors, bruteLength, dist, distanceToPolylines, rng, samplePoints } from './helpers.ts'

const within = (value: number, expected: number, relative: number): void => {
  expect(Math.abs(value / expected - 1)).toBeLessThan(relative)
}

function randomPath(random: () => number): Subpath[] {
  const subpaths: Subpath[] = []
  const count = 1 + Math.floor(random() * 3)
  for (let s = 0; s < count; s++) {
    const coords = [random() * 8 - 4, random() * 8 - 4]
    const curves = 1 + Math.floor(random() * 4)
    for (let j = 0; j < curves; j++) for (let q = 0; q < 6; q++) coords.push(random() * 8 - 4)
    subpaths.push({ coords, closed: false })
  }
  return subpaths
}

describe('pathLength (known shapes within 0.1 %)', () => {
  test('straight pieces are exact', () => {
    expect(pathLength(polylinePath([[0, 0], [3, 4]]))).toBeCloseTo(5, 12)
    expect(pathLength(rectPath({ width: 3, height: 2 }))).toBeCloseTo(10, 12)
    expect(pathLength(polygonPath([[0, 0], [4, 0], [4, 3]]))).toBeCloseTo(12, 12)
  })

  test('circle, arc, semicircle from an SVG arc', () => {
    within(pathLength(circlePath({ radius: 1 })), 2 * Math.PI, 1e-3)
    within(pathLength(circlePath({ radius: 250 })), 500 * Math.PI, 1e-3)
    within(pathLength(arcPath({ radius: 3, from: 20, to: 140 })), (3 * 120 * Math.PI) / 180, 1e-3)
    within(pathLength(parsePath('M0 0 A 5 5 0 0 1 10 0')), 5 * Math.PI, 1e-3)
  })

  test('parabola (quadratic bezier) against the closed form, to 1e-9', () => {
    // y = x² on [0, 1] is the quadratic (0,0) (0.5,0) (1,1); length = (2√5 + asinh 2) / 4
    const p = parsePath('M0 0 Q 0.5 0 1 1')
    within(pathLength(p), (2 * Math.sqrt(5) + Math.asinh(2)) / 4, 1e-9)
  })

  test('a cubic with a cusp and a loop, against brute force', () => {
    const cusp = parsePath('M0 0 C 2 2 0 2 2 0')
    const loop = parsePath('M0 0 C 4 3 -2 3 2 0')
    within(pathLength(cusp), bruteLength(cusp, 200000), 1e-6)
    within(pathLength(loop), bruteLength(loop, 200000), 1e-6)
  })

  test('sums subpaths; empty and degenerate paths have length 0', () => {
    const two = [...circlePath({ radius: 1 }), ...rectPath({ width: 2, height: 2 })]
    within(pathLength(two), 2 * Math.PI + 8, 1e-3)
    expect(pathLength([])).toBe(0)
    expect(pathLength([{ coords: [1, 1], closed: false }])).toBe(0)
    expect(pathLength([{ coords: [1, 1, 1, 1, 1, 1, 1, 1], closed: false }])).toBe(0)
    expect(pathLength(null as unknown as Subpath[])).toBe(0)
    expect(pathLength([null as unknown as Subpath])).toBe(0)
  })

  test('measurePath gives the same answers and can be reused', () => {
    const p = [...circlePath({ radius: 2 }), ...polylinePath([[5, 0], [6, 0]])]
    const m = measurePath(p)
    expect(m.length).toBe(pathLength(p))
    expect(pathLength(m)).toBe(m.length)
    expect(m.ends.length).toBe(5)
    expect(m.offsets).toEqual([0, 4, 5])
    expect(pointAt(m, 0.3)).toEqual(pointAt(p, 0.3))
    expect(trimPath(m, 0.2, 0.9)).toEqual(trimPath(p, 0.2, 0.9))
  })
})

describe('pointAt', () => {
  test('square: position and direction at the quarters and in between', () => {
    const p = rectPath({ width: 2, height: 2 }) // (1,1) → (-1,1) → (-1,-1) → (1,-1) → (1,1)
    const expectAt = (u: number, point: Vec2, deg: number): void => {
      const r = pointAt(p, u)
      expect(dist(r.point, point)).toBeLessThan(1e-9)
      expect(r.tangentDeg).toBeCloseTo(deg, 9)
    }
    expectAt(0, [1, 1], 180)
    expectAt(0.125, [0, 1], 180)
    expectAt(0.25, [-1, 1], -90) // a corner reports the edge that leaves it
    expectAt(0.375, [-1, 0], -90)
    expectAt(0.5, [-1, -1], 0)
    expectAt(0.875, [1, 0], 90)
    expectAt(1, [1, 1], 90) // the end reports the edge that arrives
  })

  test('circle: u is the angle / 360, direction is the angle + 90', () => {
    const p = circlePath({ radius: 2 })
    for (const u of [0.05, 0.25, 0.4, 0.5, 0.77, 0.99]) {
      const r = pointAt(p, u)
      const a = 2 * Math.PI * u
      expect(dist(r.point, [2 * Math.cos(a), 2 * Math.sin(a)])).toBeLessThan(2 * 6e-4)
      const off = (((r.tangentDeg - (u * 360 + 90)) % 360) + 540) % 360 - 180 // difference, wrapped to ±180
      expect(Math.abs(off)).toBeLessThan(0.1) // a 4-cubic circle's own tangent is up to 0.072° off the true one
      expect(r.tangentDeg).toBeGreaterThan(-180.0001)
      expect(r.tangentDeg).toBeLessThanOrEqual(180)
    }
  })

  test('u is clamped; NaN is treated as 0', () => {
    const p = polylinePath([[0, 0], [10, 0]])
    expect(pointAt(p, -3).point).toEqual([0, 0])
    expect(pointAt(p, 7).point).toEqual([10, 0])
    expect(pointAt(p, NaN).point).toEqual([0, 0])
    expect(pointAt(p, 0.3).point[0]).toBeCloseTo(3, 12)
    expect(pointAt(p, 0.3).tangentDeg).toBe(0)
  })

  test('equal steps of u are equal steps of distance, even on an uneven cubic', () => {
    const p = parsePath('M0 0 C 9 0 9.5 0.2 10 6')
    const m = measurePath(p)
    const step = m.length / 50
    // walk with the library, check against brute-force lengths of the trimmed pieces
    for (let i = 1; i <= 50; i++) {
      const piece = trimPath(m, (i - 1) / 50, i / 50)
      within(bruteLength(piece, 2000), step, 1e-6)
      expect(dist(pointAt(m, i / 50).point, anchors(piece[0])[anchors(piece[0]).length - 1])).toBeLessThan(1e-7)
    }
  })

  test('several subpaths are walked in order by length', () => {
    const p = [...polylinePath([[0, 0], [1, 0]]), ...polylinePath([[5, 5], [5, 8]])]
    expect(pointAt(p, 0.125).point[0]).toBeCloseTo(0.5, 12)
    expect(dist(pointAt(p, 0.625).point, [5, 6.5])).toBeLessThan(1e-12)
    expect(pointAt(p, 0.625).tangentDeg).toBeCloseTo(90, 9)
    expect(pointAt(p, 1).point).toEqual([5, 8])
  })

  test('a handle sitting on its anchor still gives a direction', () => {
    const p: Subpath[] = [{ coords: [0, 0, 0, 0, 1, 1, 2, 0], closed: false }]
    const start = pointAt(p, 0)
    expect(start.point).toEqual([0, 0])
    expect(start.tangentDeg).toBeGreaterThan(20)
    expect(start.tangentDeg).toBeLessThan(50)
  })

  test('paths without length return their first point', () => {
    expect(pointAt([], 0.5)).toEqual({ point: [0, 0], tangentDeg: 0 })
    expect(pointAt([{ coords: [3, 4], closed: false }], 0.5)).toEqual({ point: [3, 4], tangentDeg: 0 })
    expect(pointAt(undefined as unknown as Subpath[], 0.5)).toEqual({ point: [0, 0], tangentDeg: 0 })
  })
})

describe('trimPath', () => {
  test('end points are pointAt(a) and pointAt(b); length is (b - a) of the total', () => {
    const shapes: Subpath[][] = [
      circlePath({ radius: 1.5 }),
      rectPath({ width: 4, height: 2, radius: 0.4 }),
      parsePath('M0 0 C 4 3 -2 3 2 0 S 5 -4 6 0'),
    ]
    for (const p of shapes) {
      const m = measurePath(p)
      for (const [a, b] of [[0, 0.3], [0.1, 0.2], [0.37, 0.93], [0.5, 1], [0.249, 0.251]]) {
        const piece = trimPath(m, a, b)
        expect(piece.length).toBe(1)
        expect(piece[0].closed).toBe(false)
        const pts = anchors(piece[0])
        expect(dist(pts[0], pointAt(m, a).point)).toBeLessThan(1e-7)
        expect(dist(pts[pts.length - 1], pointAt(m, b).point)).toBeLessThan(1e-7)
        within(pathLength(piece), (b - a) * m.length, 1e-6)
        // and it lies on the original curve
        const fine = flattenPath(p, 1e-6)
        for (const q of samplePoints(piece, 4)) expect(distanceToPolylines(q, fine)).toBeLessThan(5e-6)
      }
    }
  })

  test('the whole range returns an equal copy (closed stays closed)', () => {
    const p = [...circlePath({ radius: 1 }), ...polylinePath([[3, 0], [4, 1]])]
    const all = trimPath(p, 0, 1)
    expect(all).toEqual(p)
    expect(all[0]).not.toBe(p[0])
    expect(all[0].coords).not.toBe(p[0].coords)
  })

  test('an empty range draws nothing; reversed and out-of-range arguments are normalised', () => {
    const p = rectPath({ width: 2, height: 2 })
    expect(trimPath(p, 0.4, 0.4)).toEqual([])
    expect(trimPath(p, 0, 0)).toEqual([])
    expect(trimPath(p, 1, 1)).toEqual([])
    expect(trimPath(p, 0.75, 0.25)).toEqual(trimPath(p, 0.25, 0.75))
    expect(trimPath(p, -5, 0.5)).toEqual(trimPath(p, 0, 0.5))
    expect(trimPath(p, 0.5, 9)).toEqual(trimPath(p, 0.5, 1))
    expect(trimPath(p, NaN, 0.5)).toEqual(trimPath(p, 0, 0.5))
    expect(trimPath([], 0, 1)).toEqual([])
  })

  test('square corners survive: draw-on to 3/8 is one and a half edges', () => {
    const p = rectPath({ width: 2, height: 2 })
    expect(toPathString(trimPath(p, 0, 0.375))).toBe('M1 1 L-1 1 L-1 0')
    expect(toPathString(trimPath(p, 0.125, 0.5))).toBe('M0 1 L-1 1 L-1 -1')
    // a passing flash across a corner
    expect(toPathString(trimPath(p, 0.2, 0.3), 6)).toBe('M-0.6 1 L-1 1 L-1 0.6')
  })

  test('several subpaths: whole ones are kept whole, the cut ones are open', () => {
    const p = [
      ...polylinePath([[0, 0], [2, 0]]),          // 0 … 0.2
      ...rectPath({ width: 1, height: 1 }),       // 0.2 … 0.6
      ...polylinePath([[5, 0], [5, 4]]),          // 0.6 … 1
    ]
    const piece = trimPath(p, 0.1, 0.8)
    expect(piece.length).toBe(3)
    expect(anchors(piece[0])).toEqual([[1, 0], [2, 0]])
    expect(piece[1]).toEqual(p[1])
    expect(piece[1].closed).toBe(true)
    expect(piece[2].closed).toBe(false)
    expect(dist(anchors(piece[2])[1], [5, 2])).toBeLessThan(1e-9)
    // a window that ends exactly where a subpath ends does not leak into the next one
    expect(trimPath(p, 0, 0.2).length).toBe(1)
    expect(trimPath(p, 0.2, 0.6)).toEqual([p[1]])
    // part of the closed one is open
    const part = trimPath(p, 0.3, 0.5)
    expect(part.length).toBe(1)
    expect(part[0].closed).toBe(false)
  })

  test('draw-on grows monotonically and pieces add up (random paths)', () => {
    const random = rng(11)
    for (let n = 0; n < 40; n++) {
      const p = randomPath(random)
      const m = measurePath(p)
      const cut = 0.05 + 0.9 * random()
      within(pathLength(trimPath(m, 0, cut)) + pathLength(trimPath(m, cut, 1)), m.length, 1e-6)
      let previous = 0
      for (let i = 1; i <= 10; i++) {
        const length = pathLength(trimPath(m, 0, i / 10))
        expect(length).toBeGreaterThan(previous)
        within(length, (m.length * i) / 10, 1e-6)
        previous = length
      }
    }
  })

  test('does not change its input', () => {
    const p = circlePath({ radius: 1 })
    const before = JSON.stringify(p)
    trimPath(p, 0.1, 0.6)
    pointAt(p, 0.3)
    expect(JSON.stringify(p)).toBe(before)
  })
})

describe('bounds', () => {
  test('uses curve extrema, not control points', () => {
    expect(bounds(parsePath('M0 0 C 0 10 10 10 10 0'))).toEqual({ x: 0, y: 0, width: 10, height: 7.5 })
    const b = bounds(parsePath('M0 0 C 10 0 -10 5 0 5'))
    const pts = samplePoints(parsePath('M0 0 C 10 0 -10 5 0 5'), 20000)
    const minX = Math.min(...pts.map((q) => q[0])), maxX = Math.max(...pts.map((q) => q[0]))
    expect(b.x).toBeCloseTo(minX, 6)
    expect(b.x + b.width).toBeCloseTo(maxX, 6)
    expect(b.y).toBe(0)
    expect(b.height).toBe(5)
  })

  test('random paths: equal to brute force', () => {
    const random = rng(3)
    for (let n = 0; n < 50; n++) {
      const p = randomPath(random)
      const b = bounds(p)
      const pts = samplePoints(p, 4000)
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const q of pts) {
        minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0])
        minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1])
      }
      expect(Math.abs(b.x - minX)).toBeLessThan(1e-5)
      expect(Math.abs(b.y - minY)).toBeLessThan(1e-5)
      expect(Math.abs(b.x + b.width - maxX)).toBeLessThan(1e-5)
      expect(Math.abs(b.y + b.height - maxY)).toBeLessThan(1e-5)
      // never smaller than the truth (x + width may round by one ulp)
      expect(b.x).toBeLessThanOrEqual(minX)
      expect(b.x + b.width).toBeGreaterThanOrEqual(maxX - 1e-12)
    }
  })

  test('several subpaths, single points, and nothing', () => {
    expect(bounds([...rectPath({ width: 2, height: 2 }), ...polylinePath([[5, 5], [6, 7]])])).toEqual({ x: -1, y: -1, width: 7, height: 8 })
    expect(bounds([{ coords: [2, 3], closed: false }])).toEqual({ x: 2, y: 3, width: 0, height: 0 })
    expect(bounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    expect(bounds(undefined as unknown as Subpath[])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe('flattenPath / transformPath', () => {
  test('polyline stays within the tolerance of the curve and of the true radius', () => {
    for (const tolerance of [0.1, 0.01, 0.001]) {
      const lines = flattenPath(circlePath({ radius: 3 }), tolerance)
      expect(lines.length).toBe(1)
      const line = lines[0]
      expect(line[0]).toEqual([3, 0])
      expect(line[line.length - 1]).toEqual([3, 0])
      for (let i = 0; i + 1 < line.length; i++) {
        const mid: Vec2 = [(line[i][0] + line[i + 1][0]) / 2, (line[i][1] + line[i + 1][1]) / 2]
        expect(3 - Math.hypot(mid[0], mid[1])).toBeLessThan(tolerance + 3 * 3e-4)
      }
    }
    expect(flattenPath(circlePath({ radius: 3 }), 0.001)[0].length).toBeGreaterThan(flattenPath(circlePath({ radius: 3 }), 0.1)[0].length)
  })

  test('straight edges are not subdivided', () => {
    expect(flattenPath(rectPath({ width: 2, height: 2 }))).toEqual([[[1, 1], [-1, 1], [-1, -1], [1, -1], [1, 1]]])
    expect(flattenPath([])).toEqual([])
  })

  test('transformPath maps every point and leaves the input alone', () => {
    const p = rectPath({ width: 2, height: 2 })
    const before = JSON.stringify(p)
    const moved = transformPath(p, [2, 0, 0, 3, 10, -1])
    expect(bounds(moved)).toEqual({ x: 8, y: -4, width: 4, height: 6 })
    expect(moved[0].closed).toBe(true)
    expect(JSON.stringify(p)).toBe(before)
    // rotation by 90°: (x, y) → (-y, x)
    const turned = transformPath(polylinePath([[1, 0], [2, 0]]), [0, 1, -1, 0, 0, 0])
    expect(anchors(turned[0])).toEqual([[0, 1], [0, 2]])
    expect(toPathString(turned)).toBe('M0 1 L0 2')
    within(pathLength(transformPath(circlePath({ radius: 1 }), [3, 0, 0, 3, 0, 0])), 6 * Math.PI, 1e-3)
  })
})
