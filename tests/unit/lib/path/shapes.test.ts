import { describe, expect, test } from 'bun:test'
import {
  arcPath, arrowPath, bounds, circlePath, ellipsePath, flattenPath, pathLength, pointAt, polygonPath, polylinePath,
  rectPath, toPathString,
} from '../../../../src/lib/path/index.ts'
import type { ArrowPathOptions, RectPathOptions, Subpath } from '../../../../src/lib/path/index.ts'
import type { Vec2 } from '../../../../src/lib/types.ts'
import { anchors, bruteLength, dist, samplePoints, signedArea } from './helpers.ts'

const within = (value: number, expected: number, relative: number): void => {
  expect(Math.abs(value / expected - 1)).toBeLessThan(relative)
}
const segments = (sp: Subpath): number => (sp.coords.length - 2) / 6

describe('rectPath', () => {
  test('starts at the upper right, runs counter-clockwise, closes on its start', () => {
    const p = rectPath({ width: 4, height: 2 })
    expect(p.length).toBe(1)
    expect(p[0].closed).toBe(true)
    expect(anchors(p[0])).toEqual([[2, 1], [-2, 1], [-2, -1], [2, -1], [2, 1]])
    expect(signedArea(flattenPath(p)[0])).toBeCloseTo(8, 12)
    expect(pathLength(p)).toBeCloseTo(12, 12)
    expect(bounds(p)).toEqual({ x: -2, y: -1, width: 4, height: 2 })
  })

  test('center moves it', () => {
    expect(bounds(rectPath({ width: 2, height: 2, center: [3, -1] }))).toEqual({ x: 2, y: -2, width: 2, height: 2 })
  })

  test('rounded corners: 4 edges + 4 quarter arcs, perimeter within 0.1 %', () => {
    const p = rectPath({ width: 4, height: 2, radius: 0.5 })
    expect(segments(p[0])).toBe(8)
    expect(p[0].coords.slice(0, 2)).toEqual([1.5, 1])
    expect(p[0].coords.slice(-2)).toEqual([1.5, 1])
    within(pathLength(p), 2 * (3 + 1) + Math.PI, 1e-3)
    expect(bounds(p)).toEqual({ x: -2, y: -1, width: 4, height: 2 })
    expect(signedArea(flattenPath(p, 1e-4)[0])).toBeGreaterThan(0)
    // every point of a corner arc is 0.5 from its corner centre
    for (const q of samplePoints(p, 8)) {
      if (Math.abs(q[0]) > 1.5 && Math.abs(q[1]) > 0.5) {
        expect(Math.abs(dist(q, [Math.sign(q[0]) * 1.5, Math.sign(q[1]) * 0.5]) - 0.5)).toBeLessThan(2e-4)
      }
    }
  })

  test('radius is clamped to a pill / circle and leaves no zero-length edges', () => {
    const pill = rectPath({ width: 4, height: 2, radius: 99 })
    expect(segments(pill[0])).toBe(6)
    within(pathLength(pill), 2 * 2 + 2 * Math.PI, 1e-3)
    const round = rectPath({ width: 2, height: 2, radius: 1 })
    expect(segments(round[0])).toBe(4)
    within(pathLength(round), 2 * Math.PI, 1e-3)
    expect(toPathString(rectPath({ width: 2, height: 2, radius: -3 }))).toBe('M1 1 L-1 1 L-1 -1 L1 -1 Z')
  })
})

describe('circlePath / ellipsePath', () => {
  test('circle: starts at 0°, counter-clockwise, circumference within 0.1 %', () => {
    for (const radius of [0.01, 1, 3.5, 400]) {
      const p = circlePath({ radius })
      expect(p[0].closed).toBe(true)
      expect(segments(p[0])).toBe(4)
      expect(anchors(p[0])).toEqual([[radius, 0], [0, radius], [-radius, 0], [0, -radius], [radius, 0]])
      within(pathLength(p), 2 * Math.PI * radius, 1e-3)
      for (const q of samplePoints(p, 16)) expect(Math.abs(dist(q, [0, 0]) / radius - 1)).toBeLessThan(3e-4)
      expect(signedArea(flattenPath(p, radius * 1e-4)[0])).toBeGreaterThan(0)
    }
  })

  test('circle with a centre; bounds are exact', () => {
    const b = bounds(circlePath({ radius: 2, center: [1, 1] }))
    expect(b).toEqual({ x: -1, y: -1, width: 4, height: 4 })
  })

  test('ellipse: radii, bounds, perimeter within 0.1 % of the true value', () => {
    const p = ellipsePath({ rx: 3, ry: 1 })
    expect(anchors(p[0])).toEqual([[3, 0], [0, 1], [-3, 0], [0, -1], [3, 0]])
    expect(bounds(p)).toEqual({ x: -3, y: -1, width: 6, height: 2 })
    // true perimeter by brute-force integration of the parametric ellipse
    let truth = 0
    const steps = 200000
    for (let i = 0; i < steps; i++) {
      const a = (2 * Math.PI * (i + 0.5)) / steps
      truth += Math.hypot(3 * Math.sin(a), Math.cos(a)) * ((2 * Math.PI) / steps)
    }
    within(pathLength(p), truth, 1e-3)
  })
})

describe('polygonPath / polylinePath', () => {
  const tri: Vec2[] = [[0, 0], [4, 0], [4, 3]]

  test('polygon adds the closing edge; polyline does not', () => {
    const closed = polygonPath(tri), open = polylinePath(tri)
    expect(closed[0].closed).toBe(true)
    expect(anchors(closed[0])).toEqual([[0, 0], [4, 0], [4, 3], [0, 0]])
    expect(pathLength(closed)).toBeCloseTo(12, 12)
    expect(open[0].closed).toBe(false)
    expect(anchors(open[0])).toEqual([[0, 0], [4, 0], [4, 3]])
    expect(pathLength(open)).toBeCloseTo(7, 12)
    expect(toPathString(closed)).toBe('M0 0 L4 0 L4 3 Z')
    expect(toPathString(open)).toBe('M0 0 L4 0 L4 3')
  })

  test('a polygon whose last point repeats the first is not closed twice', () => {
    expect(anchors(polygonPath([...tri, [0, 0]])[0]).length).toBe(4)
  })

  test('repeated and unusable points are skipped; too few points give a point or nothing', () => {
    const p = polylinePath([[0, 0], [0, 0], [NaN, 1] as Vec2, null as unknown as Vec2, [1, 0]])
    expect(anchors(p[0])).toEqual([[0, 0], [1, 0]])
    expect(polylinePath([])).toEqual([])
    expect(polylinePath(undefined as unknown as Vec2[])).toEqual([])
    expect(polygonPath([[1, 2]])).toEqual([{ coords: [1, 2], closed: false }])
  })
})

describe('arcPath', () => {
  test('quarter arc: exact end points, right length, counter-clockwise', () => {
    const p = arcPath({ radius: 2, from: 0, to: 90 })
    expect(p[0].closed).toBe(false)
    expect(segments(p[0])).toBe(1)
    expect(p[0].coords.slice(0, 2)).toEqual([2, 0])
    expect(p[0].coords.slice(-2)).toEqual([0, 2])
    within(pathLength(p), Math.PI, 1e-3)
    expect(pointAt(p, 0).tangentDeg).toBeCloseTo(90, 6)
    expect(pointAt(p, 1).tangentDeg).toBeCloseTo(180, 6)
  })

  test('long, negative and off-centre arcs stay on the circle', () => {
    for (const [from, to] of [[30, 300], [200, -45], [-90, 90], [10, 11]]) {
      const p = arcPath({ radius: 1.5, from, to, center: [2, -1] })
      expect(segments(p[0])).toBe(Math.ceil(Math.abs(to - from) / 90))
      within(pathLength(p), (1.5 * Math.abs(to - from) * Math.PI) / 180, 1e-3)
      for (const q of samplePoints(p, 12)) expect(Math.abs(dist(q, [2, -1]) - 1.5)).toBeLessThan(5e-4)
      const rad = (deg: number): number => (deg * Math.PI) / 180
      expect(dist(pointAt(p, 0).point, [2 + 1.5 * Math.cos(rad(from)), -1 + 1.5 * Math.sin(rad(from))])).toBeLessThan(1e-12)
      expect(dist(pointAt(p, 1).point, [2 + 1.5 * Math.cos(rad(to)), -1 + 1.5 * Math.sin(rad(to))])).toBeLessThan(1e-12)
    }
  })

  test('a sweep beyond one turn is one full turn; an empty sweep is a point', () => {
    within(pathLength(arcPath({ radius: 1, from: 0, to: 1000 })), 2 * Math.PI, 1e-3)
    within(pathLength(arcPath({ radius: 1, from: 0, to: -1000 })), 2 * Math.PI, 1e-3)
    expect(arcPath({ radius: 1, from: 45, to: 45 })[0].coords.length).toBe(2)
  })
})

describe('arrowPath', () => {
  test('straight: the shaft stops at the base of the head, the tip is exactly on `to`', () => {
    const { shaft, head } = arrowPath({ from: [0, 0], to: [4, 0], head: 0.5, headWidth: 0.4 })
    expect(shaft.length).toBe(1)
    expect(shaft[0].closed).toBe(false)
    expect(anchors(shaft[0])[0]).toEqual([0, 0])
    expect(dist(anchors(shaft[0])[1], [3.5, 0])).toBeLessThan(1e-9)
    expect(head.length).toBe(1)
    expect(head[0].closed).toBe(true)
    const h = anchors(head[0])
    expect(h[0]).toEqual([4, 0])
    expect(h[3]).toEqual([4, 0])
    expect(dist(h[1], [3.5, 0.2])).toBeLessThan(1e-9)
    expect(dist(h[2], [3.5, -0.2])).toBeLessThan(1e-9)
    expect(Math.abs(signedArea(flattenPath(head)[0]))).toBeCloseTo(0.5 * 0.4 * 0.5, 9)
  })

  test('defaults: head 0.25 long and 0.9 as wide; works in any direction', () => {
    const { shaft, head } = arrowPath({ from: [1, 1], to: [1, -2] })
    expect(pathLength(shaft)).toBeCloseTo(2.75, 9)
    const h = anchors(head[0])
    expect(h[0]).toEqual([1, -2])
    expect(dist(h[1], h[2])).toBeCloseTo(0.225, 9)
    expect((h[1][1] + h[2][1]) / 2).toBeCloseTo(-1.75, 9)
  })

  test('bend: the shaft is a circular arc of that angle, curving counter-clockwise for positive values', () => {
    const { shaft, head } = arrowPath({ from: [-1, 0], to: [1, 0], bend: 90, head: 0 })
    expect(head).toEqual([])
    // a 90° arc over a chord of 2: centre (0, 1), radius √2, bulging below the chord
    for (const q of samplePoints(shaft, 12)) expect(Math.abs(dist(q, [0, 1]) - Math.SQRT2)).toBeLessThan(5e-4)
    expect(dist(pointAt(shaft, 0.5).point, [0, 1 - Math.SQRT2])).toBeLessThan(1e-6)
    expect(pointAt(shaft, 0).tangentDeg).toBeCloseTo(-45, 4)
    expect(pointAt(shaft, 1).tangentDeg).toBeCloseTo(45, 4)
    within(pathLength(shaft), (Math.SQRT2 * Math.PI) / 2, 1e-3)
    const other = arrowPath({ from: [-1, 0], to: [1, 0], bend: -90, head: 0 }).shaft
    expect(dist(pointAt(other, 0.5).point, [0, Math.SQRT2 - 1])).toBeLessThan(1e-6)
    const wide = arrowPath({ from: [-1, 0], to: [1, 0], bend: 270, head: 0 }).shaft
    for (const q of samplePoints(wide, 12)) expect(Math.abs(dist(q, [0, -1]) - Math.SQRT2)).toBeLessThan(5e-4)
    within(pathLength(wide), (Math.SQRT2 * 3 * Math.PI) / 2, 1e-3)
  })

  test('bent with a head: the head sits on the curve and still ends on `to`', () => {
    const full = arrowPath({ from: [-2, 0], to: [2, 1], bend: 60, head: 0 }).shaft
    const { shaft, head } = arrowPath({ from: [-2, 0], to: [2, 1], bend: 60, head: 0.4 })
    const length = pathLength(full)
    expect(pathLength(shaft)).toBeCloseTo(length - 0.4, 6)
    const base = pointAt(full, 1 - 0.4 / length).point
    const end = anchors(shaft[0])[anchors(shaft[0]).length - 1]
    expect(dist(end, base)).toBeLessThan(1e-7)
    const h = anchors(head[0])
    expect(h[0]).toEqual([2, 1])
    expect(dist([(h[1][0] + h[2][0]) / 2, (h[1][1] + h[2][1]) / 2], base)).toBeLessThan(1e-7)
    // the base is perpendicular to the axis base → tip
    const axis: Vec2 = [2 - base[0], 1 - base[1]]
    expect(Math.abs(axis[0] * (h[1][0] - h[2][0]) + axis[1] * (h[1][1] - h[2][1]))).toBeLessThan(1e-9)
  })

  test('a short arrow gets a head no longer than half of it', () => {
    const { shaft, head } = arrowPath({ from: [0, 0], to: [0.2, 0], head: 0.5 })
    expect(pathLength(shaft)).toBeCloseTo(0.1, 9)
    expect(anchors(head[0])[0]).toEqual([0.2, 0])
    expect(bruteLength(head)).toBeGreaterThan(0)
  })

  test('unusable input gives an empty arrow instead of throwing', () => {
    const empty = { shaft: [], head: [] }
    expect(arrowPath({ from: [1, 1], to: [1, 1] })).toEqual(empty)
    expect(arrowPath({ from: [NaN, 0], to: [1, 1] })).toEqual(empty)
    expect(arrowPath({} as ArrowPathOptions)).toEqual(empty)
    expect(arrowPath(undefined as unknown as ArrowPathOptions)).toEqual(empty)
    expect(pathLength(rectPath(undefined as unknown as RectPathOptions))).toBe(0)
    expect(pathLength(circlePath({ radius: NaN }))).toBe(0)
    expect(pathLength(arcPath({ radius: 1, from: NaN, to: Infinity }))).toBe(0)
  })
})
