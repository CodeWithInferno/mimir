import { describe, expect, test } from 'bun:test'
import {
  arcPoints,
  bearingBalls,
  bearingProfile,
  beltPath,
  camProfile,
  circleProfile,
  circleThrough,
  conRodProfile,
  counterClockwise,
  crankWebProfile,
  gearDimensions,
  gearProfile,
  helixPath,
  isSimplePolygon,
  pathLength,
  pathLengths,
  pistonProfile,
  pointAlong,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  polygonWinding,
  pulleyProfile,
  rackProfile,
  roundedRect,
  shaftProfile,
  smoothPath,
  supportDistance,
  valveProfile,
} from '../../../src/lib/profiles.ts'
import type { Vec2, Vec3 } from '../../../src/lib/types.ts'

const rad = (d: number): number => (d * Math.PI) / 180
const radiusOf = (p: Vec2): number => Math.hypot(p[0], p[1])
const bounds = (points: Vec2[]): { minX: number; maxX: number; minY: number; maxY: number } => ({
  minX: Math.min(...points.map((p) => p[0])),
  maxX: Math.max(...points.map((p) => p[0])),
  minY: Math.min(...points.map((p) => p[1])),
  maxY: Math.max(...points.map((p) => p[1])),
})
const noRepeats = (points: number[][]): boolean =>
  points.every((p, i) => {
    const q = points[(i + 1) % points.length] as number[]
    return points.length < 2 || p.some((value, k) => Math.abs(value - (q[k] as number)) > 1e-12)
  })
/** A closed counter-clockwise polygon that does not cross itself and does not repeat a point. */
function expectCleanPolygon(points: Vec2[]): void {
  expect(points.length).toBeGreaterThanOrEqual(3)
  expect(points.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))).toBe(true)
  expect(noRepeats(points)).toBe(true)
  expect(polygonWinding(points)).toBe(1)
  expect(isSimplePolygon(points)).toBe(true)
}
/** A lathe profile of a solid: starts and ends on the axis, lowest point at 0, counter-clockwise, no crossings. */
function expectSolidLathe(profile: Vec2[]): void {
  expect(profile.length).toBeGreaterThanOrEqual(3)
  expect((profile[0] as Vec2)[0]).toBe(0)
  expect((profile[profile.length - 1] as Vec2)[0]).toBe(0)
  expect(profile.every((p) => p[0] >= 0 && Number.isFinite(p[0]) && Number.isFinite(p[1]))).toBe(true)
  expect(Math.min(...profile.map((p) => p[1]))).toBe(0)
  expectCleanPolygon(profile) // closed along the axis
}
/** A lathe profile of a ring: a closed loop that repeats its first point. */
function expectRingLathe(profile: Vec2[]): Vec2[] {
  expect(profile[profile.length - 1]).toEqual(profile[0] as Vec2)
  const open = profile.slice(0, -1)
  expect(open.every((p) => p[0] > 0)).toBe(true)
  expect(Math.min(...open.map((p) => p[1]))).toBe(0)
  expectCleanPolygon(open)
  return open
}

describe('polygon measures', () => {
  const square: Vec2[] = [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
  ]
  const ell: Vec2[] = [
    [0, 0],
    [2, 0],
    [2, 1],
    [1, 1],
    [1, 2],
    [0, 2],
  ]

  test('area is signed, winding follows it', () => {
    expect(polygonArea(square)).toBe(4)
    expect(polygonArea(square.slice().reverse())).toBe(-4)
    expect(polygonWinding(square)).toBe(1)
    expect(polygonWinding(square.slice().reverse())).toBe(-1)
    expect(polygonWinding([[0, 0], [1, 1], [2, 2]])).toBe(0)
    expect(polygonArea([])).toBe(0)
    expect(polygonArea(ell)).toBe(3)
  })

  test('centroid', () => {
    expect(polygonCentroid(square)).toEqual([1, 1])
    const c = polygonCentroid(ell) // three unit squares centred at (0.5,0.5), (1.5,0.5), (0.5,1.5)
    expect(c[0]).toBeCloseTo(2.5 / 3, 12)
    expect(c[1]).toBeCloseTo(2.5 / 3, 12)
    expect(polygonCentroid(ell.slice().reverse())[0]).toBeCloseTo(2.5 / 3, 12)
    expect(polygonCentroid([[0, 0], [2, 0], [4, 0]])).toEqual([2, 0])
    expect(polygonCentroid([])).toEqual([0, 0])
  })

  test('counterClockwise flips only clockwise input', () => {
    expect(counterClockwise(square)).toBe(square)
    const flipped = counterClockwise(square.slice().reverse())
    expect(polygonWinding(flipped)).toBe(1)
  })

  test('pointInPolygon', () => {
    expect(pointInPolygon([0.5, 0.5], ell)).toBe(true)
    expect(pointInPolygon([1.5, 1.5], ell)).toBe(false)
    expect(pointInPolygon([3, 1], square)).toBe(false)
    expect(pointInPolygon([1, 1], square.slice().reverse())).toBe(true)
  })

  test('isSimplePolygon', () => {
    expect(isSimplePolygon(square)).toBe(true)
    expect(isSimplePolygon(ell)).toBe(true)
    expect(isSimplePolygon([[0, 0], [2, 2], [2, 0], [0, 2]])).toBe(false) // bow-tie
    expect(isSimplePolygon([[0, 0], [2, 0], [2, 0], [2, 2], [0, 2]])).toBe(false) // repeated point
    expect(isSimplePolygon([[0, 0], [2, 0], [1, 0], [1, 2]])).toBe(false) // folds back on itself
    expect(isSimplePolygon([[0, 0], [2, 0], [2, 2], [1, 0], [0, 2]])).toBe(false) // a corner touching an edge
    expect(isSimplePolygon([[0, 0], [1, 1]])).toBe(false)
  })

  test('supportDistance is the farthest extent in a direction', () => {
    expect(supportDistance(square, 0)).toBeCloseTo(2, 12)
    expect(supportDistance(square, 180)).toBeCloseTo(0, 12)
    expect(supportDistance(square, 45)).toBeCloseTo(2 * Math.SQRT2, 12)
    expect(supportDistance([], 10)).toBe(0)
  })
})

describe('arcs, circles, rectangles', () => {
  test('arcPoints lie on the circle and include both ends', () => {
    const arc = arcPoints({ radius: 3, from: 30, to: 150, center: [1, -2] })
    expect(arc.length).toBe(21) // one point every 6°
    for (const p of arc) expect(Math.hypot(p[0] - 1, p[1] + 2)).toBeCloseTo(3, 12)
    expect(arc[0]?.[0]).toBeCloseTo(1 + 3 * Math.cos(rad(30)), 12)
    expect(arc[20]?.[1]).toBeCloseTo(-2 + 3 * Math.sin(rad(150)), 12)
    expect(arcPoints({ radius: 1, from: 0, to: 90, samples: 4 }).length).toBe(4)
    const clockwise = arcPoints({ radius: 1, from: 90, to: 0, samples: 3 })
    expect(clockwise[0]?.[1]).toBeCloseTo(1, 12)
    expect(clockwise[2]?.[0]).toBeCloseTo(1, 12)
    expect(arcPoints({ radius: Number.NaN, from: 0, to: 90 })).toEqual([])
  })

  test('circleProfile is a clean counter-clockwise polygon', () => {
    const circle = circleProfile({ radius: 2, samples: 180, center: [5, 5] })
    expectCleanPolygon(circle)
    expect(circle.length).toBe(180)
    expect(polygonArea(circle)).toBeCloseTo(Math.PI * 4, 2)
    expect(polygonCentroid(circle)[0]).toBeCloseTo(5, 9)
    expect(circleProfile({ radius: 0 })).toEqual([])
  })

  test('roundedRect: exact bounds, the right area, clean', () => {
    const r = roundedRect({ width: 6, height: 4, radius: 1, samples: 32 })
    expectCleanPolygon(r)
    expect(bounds(r)).toEqual({ minX: -3, maxX: 3, minY: -2, maxY: 2 })
    expect(polygonArea(r)).toBeCloseTo(24 - (4 - Math.PI), 2)
    const sharp = roundedRect({ width: 6, height: 4 })
    expect(sharp.length).toBe(4)
    expect(polygonArea(sharp)).toBe(24)
    const pill = roundedRect({ width: 6, height: 2, radius: 5, center: [1, 1] }) // radius clamps to height / 2
    expectCleanPolygon(pill)
    expect(bounds(pill).maxY).toBeCloseTo(2, 12)
    expect(bounds(pill).minX).toBeCloseTo(-2, 12)
    expectCleanPolygon(roundedRect({ width: 2, height: 2, radius: 1 })) // a full circle
    expect(roundedRect({ width: 0, height: 2 })).toEqual([])
  })

  test('circleThrough', () => {
    const on = (angle: number): Vec2 => [3 + 5 * Math.cos(rad(angle)), -1 + 5 * Math.sin(rad(angle))]
    const circle = circleThrough(on(10), on(140), on(250))
    expect(circle?.center[0]).toBeCloseTo(3, 9)
    expect(circle?.center[1]).toBeCloseTo(-1, 9)
    expect(circle?.radius).toBeCloseTo(5, 9)
    expect(circleThrough([0, 0], [1, 1], [2, 2])).toBeNull()
    expect(circleThrough([0, 0], [0, 0], [2, 2])).toBeNull()
  })
})

describe('paths', () => {
  const ell: Vec2[] = [
    [0, 0],
    [4, 0],
    [4, 3],
  ]

  test('pathLength, open and closed, 2D and 3D', () => {
    expect(pathLength(ell)).toBe(7)
    expect(pathLength(ell, true)).toBe(12)
    expect(pathLengths(ell)).toEqual([0, 4, 7])
    expect(pathLengths(ell, true)).toEqual([0, 4, 7, 12])
    expect(pathLength([[0, 0, 0], [1, 2, 2]] as Vec3[])).toBe(3)
    expect(pathLength([])).toBe(0)
    expect(pathLength([[1, 1]])).toBe(0)
  })

  test('pointAlong walks by arc length and reports a unit tangent', () => {
    expect(pointAlong(ell, 0)).toEqual({ point: [0, 0], tangent: [1, 0] })
    expect(pointAlong(ell, 2 / 7)).toEqual({ point: [2, 0], tangent: [1, 0] })
    const late = pointAlong(ell, 5.5 / 7)
    expect(late.point[0]).toBeCloseTo(4, 12)
    expect(late.point[1]).toBeCloseTo(1.5, 12)
    expect(late.tangent).toEqual([0, 1])
    expect(pointAlong(ell, 1).point).toEqual([4, 3])
    expect(pointAlong(ell, 7).point).toEqual([4, 3]) // clamped
    expect(pointAlong(ell, -1).point).toEqual([0, 0])
    expect(pointAlong(ell, Number.NaN).point).toEqual([0, 0])
  })

  test('pointAlong on a closed path wraps, and a cached length table gives the same answers', () => {
    const lengths = pathLengths(ell, true)
    const back = pointAlong(ell, 9.5 / 12, { closed: true })
    expect(back.point[0]).toBeCloseTo(2, 12)
    expect(back.point[1]).toBeCloseTo(1.5, 12)
    expect(back.tangent[0]).toBeCloseTo(-0.8, 12)
    expect(back.tangent[1]).toBeCloseTo(-0.6, 12)
    for (const u of [0, 0.1, 0.33, 0.5, 0.875, 1.25, -0.4]) {
      expect(pointAlong(ell, u, { closed: true, lengths })).toEqual(pointAlong(ell, u, { closed: true }))
    }
    expect(pointAlong(ell, 1.25, { closed: true }).point).toEqual(pointAlong(ell, 0.25, { closed: true }).point)
  })

  test('pointAlong copes with 3D, repeated points and tiny inputs', () => {
    const p = pointAlong([[0, 0, 0], [0, 0, 2], [0, 0, 2], [0, 4, 2]] as Vec3[], 0.5)
    expect(p.point).toEqual([0, 1, 2])
    expect(p.tangent).toEqual([0, 1, 0])
    expect(pointAlong([[0, 0, 0], [0, 0, 2], [0, 0, 2], [0, 4, 2]] as Vec3[], 1 / 3).tangent).toEqual([0, 1, 0])
    expect(pointAlong([] as Vec2[], 0.5)).toEqual({ point: [0, 0], tangent: [1, 0] })
    expect(pointAlong([[3, 4, 5]] as Vec3[], 0.5)).toEqual({ point: [3, 4, 5], tangent: [1, 0, 0] })
    for (let u = 0; u <= 1; u += 0.05) {
      const t = pointAlong(ell, u).tangent
      expect(Math.hypot(t[0], t[1])).toBeCloseTo(1, 12)
    }
  })

  test('smoothPath rounds a right angle with a true circular arc', () => {
    const corner: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ]
    const smooth = smoothPath(corner, { radius: 2, samples: 16 })
    expect(smooth[0]).toEqual([0, 0])
    expect(smooth[smooth.length - 1]).toEqual([10, 10])
    expect(smooth.length).toBe(2 + 17)
    for (const p of smooth.slice(1, -1)) expect(Math.hypot(p[0] - 8, p[1] - 2)).toBeCloseTo(2, 12)
    expect(smooth[1]?.[0]).toBeCloseTo(8, 12) // leaves the first leg tangentially
    expect(smooth[1]?.[1]).toBeCloseTo(0, 12)
    expect(smooth[17]?.[0]).toBeCloseTo(10, 12)
    expect(smooth[17]?.[1]).toBeCloseTo(2, 12)
    expect(pathLength(smooth)).toBeCloseTo(20 - 4 + Math.PI, 2)
    expect(noRepeats(smooth.concat([[99, 99]]))).toBe(true)
  })

  test('smoothPath shrinks the radius where a leg is too short, and leaves straight runs alone', () => {
    const zigzag: Vec2[] = [
      [0, 0],
      [4, 0],
      [4, 1],
      [8, 1],
    ]
    const smooth = smoothPath(zigzag, { radius: 3, samples: 8 })
    expect(noRepeats(smooth.concat([[99, 99]]))).toBe(true)
    for (let i = 1; i < smooth.length; i++) {
      expect((smooth[i] as Vec2)[0]).toBeGreaterThanOrEqual((smooth[i - 1] as Vec2)[0] - 1e-12) // never doubles back
      expect((smooth[i] as Vec2)[1]).toBeGreaterThanOrEqual((smooth[i - 1] as Vec2)[1] - 1e-12)
    }
    expect(pathLength(smooth)).toBeLessThan(pathLength(zigzag))
    const straight: Vec2[] = [
      [0, 0],
      [1, 0],
      [2, 0],
    ]
    expect(smoothPath(straight, { radius: 1 })).toEqual(straight)
    expect(smoothPath(zigzag, { radius: 0 })).toEqual(zigzag)
    expect(smoothPath(zigzag, { radius: 0 })).not.toBe(zigzag)
    expect(smoothPath([[0, 0], [1, 1]], { radius: 1 })).toEqual([[0, 0], [1, 1]])
  })

  test('smoothPath works in 3D and on closed loops', () => {
    const pipe: Vec3[] = [
      [0, 0, 0],
      [0, 5, 0],
      [0, 5, 5],
      [5, 5, 5],
    ]
    const smooth = smoothPath(pipe, { radius: 1, samples: 12 })
    expect(smooth[0]).toEqual([0, 0, 0])
    expect(smooth[smooth.length - 1]).toEqual([5, 5, 5])
    expect(pathLength(smooth)).toBeCloseTo(15 - 2 * (2 - Math.PI / 2), 2)
    for (const p of smooth.slice(1, 14)) expect(Math.hypot(p[1] - 4, p[2] - 1)).toBeCloseTo(1, 12) // first bend, centre (0, 4, 1)
    const loop = smoothPath(
      [
        [-3, -2],
        [3, -2],
        [3, 2],
        [-3, 2],
      ] as Vec2[],
      { radius: 1, samples: 32, closed: true },
    )
    expectCleanPolygon(loop)
    expect(polygonArea(loop)).toBeCloseTo(24 - (4 - Math.PI), 2)
  })

  test('helixPath: constant radius, even rise, the right length, right-handed', () => {
    const helix = helixPath({ radius: 2, turns: 5, length: 10, samples: 601 })
    expect(helix.length).toBe(601)
    expect(helix[0]).toEqual([2, 0, -0])
    for (const p of helix) expect(Math.hypot(p[0], p[2])).toBeCloseTo(2, 12)
    expect(helix[600]?.[1]).toBe(10)
    expect(helix[300]?.[1]).toBeCloseTo(5, 12)
    expect(pathLength(helix)).toBeCloseTo(Math.hypot(2 * Math.PI * 2 * 5, 10), 1)
    // right-handed about +y: (radial × tangent) points up
    const a = helix[10] as Vec3
    const b = helix[11] as Vec3
    expect(a[2] * (b[0] - a[0]) - a[0] * (b[2] - a[2])).toBeGreaterThan(0)
    expect(helixPath({ radius: 1, turns: 2, length: 3 }).length).toBe(49)
    const cone = helixPath({ radius: 2, endRadius: 1, turns: 3, length: 6, startAngle: 90 })
    expect(Math.hypot(cone[0]?.[0] ?? 0, cone[0]?.[2] ?? 0)).toBeCloseTo(2, 12)
    expect(cone[0]?.[2]).toBeCloseTo(-2, 12)
    expect(Math.hypot(cone[cone.length - 1]?.[0] ?? 0, cone[cone.length - 1]?.[2] ?? 0)).toBeCloseTo(1, 12)
    expect(helixPath({ radius: Number.NaN, turns: 1, length: 1 })).toEqual([])
  })
})

describe('gearProfile', () => {
  test('gearDimensions: the standard proportions', () => {
    const g = gearDimensions({ teeth: 24, module: 2 })
    expect(g.pitchRadius).toBe(24)
    expect(g.baseRadius).toBeCloseTo(24 * Math.cos(rad(20)), 12)
    expect(g.tipRadius).toBe(26)
    expect(g.rootRadius).toBe(21.5)
    expect(g.circularPitch).toBeCloseTo(2 * Math.PI, 12)
    expect(g.toothThickness).toBeCloseTo(Math.PI, 12)
    expect(g.valid).toBe(true)
    const ring = gearDimensions({ teeth: 72, module: 1, internal: true })
    expect(ring.tipRadius).toBe(35)
    expect(ring.rootRadius).toBe(37.25)
    expect(gearDimensions({ teeth: Number.NaN, module: 1 }).valid).toBe(false)
  })

  for (const teeth of [3, 5, 8, 12, 17, 24, 40, 42, 60, 120]) {
    test(`${teeth} teeth: clean polygon, tooth count, radii, symmetry`, () => {
      const module = 2
      const g = gearDimensions({ teeth, module })
      const outline = gearProfile({ teeth, module })
      expectCleanPolygon(outline)
      const radii = outline.map(radiusOf)
      // every tooth crosses the pitch circle outward exactly once
      let rising = 0
      for (let i = 0; i < radii.length; i++) {
        if ((radii[i] as number) <= g.pitchRadius && (radii[(i + 1) % radii.length] as number) > g.pitchRadius) rising++
      }
      expect(rising).toBe(teeth)
      expect(Math.min(...radii)).toBeCloseTo(g.rootRadius, 9)
      expect(Math.max(...radii)).toBeLessThanOrEqual(g.tipRadius + 1e-9)
      if (teeth >= 8) expect(Math.max(...radii)).toBeCloseTo(g.tipRadius, 9) // fewer teeth come to a point first
      // the same lobe repeated `teeth` times
      expect(outline.length % teeth).toBe(0)
      const perTooth = outline.length / teeth
      const turn = rad(360 / teeth)
      for (let i = 0; i < perTooth; i++) {
        const p = outline[i] as Vec2
        const q = outline[i + perTooth] as Vec2
        expect(q[0]).toBeCloseTo(p[0] * Math.cos(turn) - p[1] * Math.sin(turn), 9)
        expect(q[1]).toBeCloseTo(p[0] * Math.sin(turn) + p[1] * Math.cos(turn), 9)
      }
      // a tooth is centred on +x and a gap half a pitch later
      expect(pointInPolygon([g.pitchRadius, 0], outline)).toBe(true)
      expect(pointInPolygon([g.pitchRadius * Math.cos(turn / 2), g.pitchRadius * Math.sin(turn / 2)], outline)).toBe(false)
      expect(supportDistance(outline, 0)).toBeGreaterThan(g.pitchRadius + 0.5 * (Math.max(...radii) - g.pitchRadius))
      expect(supportDistance(outline, 180 / teeth)).toBeLessThan(supportDistance(outline, 0))
      // mirror symmetric about the x axis
      expect(polygonCentroid(outline)[0]).toBeCloseTo(0, 6)
      expect(polygonCentroid(outline)[1]).toBeCloseTo(0, 6)
      // about as much metal as a disc of the pitch radius (dedendum > addendum, so a little less)
      const disc = Math.PI * g.pitchRadius * g.pitchRadius
      expect(polygonArea(outline)).toBeLessThan(disc)
      expect(polygonArea(outline)).toBeGreaterThan(Math.PI * g.rootRadius * g.rootRadius)
    })
  }

  test('flanks are true involutes of the base circle, and the tooth is half a pitch thick at the pitch circle', () => {
    const teeth = 30
    const module = 1
    const g = gearDimensions({ teeth, module })
    const outline = gearProfile({ teeth, module, samples: 40 })
    const involute = (pressure: number): number => Math.tan(pressure) - pressure
    const halfAtPitch = g.toothThickness / (2 * g.pitchRadius)
    let checked = 0
    for (const p of outline) {
      const radius = radiusOf(p)
      const angle = Math.atan2(p[1], p[0])
      if (radius <= g.baseRadius + 1e-9 || radius >= g.tipRadius - 1e-9 || Math.abs(angle) > rad(6)) continue
      const expected = halfAtPitch + involute(rad(20)) - involute(Math.acos(g.baseRadius / radius))
      expect(Math.abs(angle)).toBeCloseTo(expected, 9)
      checked++
    }
    expect(checked).toBeGreaterThan(60)
    // thickness at the pitch circle, measured on the polygon by interpolating the two flank crossings
    const crossing = (from: number, step: number): number => {
      for (let i = from; ; i += step) {
        const a = outline[(i + outline.length) % outline.length] as Vec2
        const b = outline[(i + step + outline.length) % outline.length] as Vec2
        const ra = radiusOf(a)
        const rb = radiusOf(b)
        if (ra <= g.pitchRadius === rb <= g.pitchRadius) continue
        const t = (g.pitchRadius - ra) / (rb - ra)
        return Math.atan2(a[1] + (b[1] - a[1]) * t, a[0] + (b[0] - a[0]) * t)
      }
    }
    const thickness = (crossing(0, 1) - crossing(0, -1)) * g.pitchRadius
    expect(Math.abs(thickness)).toBeCloseTo((Math.PI * module) / 2, 3)
  })

  test('backlash thins the teeth; pressure angle and tooth height are options', () => {
    const plain = gearProfile({ teeth: 20, module: 1 })
    const thinned = gearProfile({ teeth: 20, module: 1, backlash: 0.1 })
    expectCleanPolygon(thinned)
    expect(polygonArea(thinned)).toBeLessThan(polygonArea(plain))
    expect(gearDimensions({ teeth: 20, module: 1, backlash: 0.1 }).toothThickness).toBeCloseTo(Math.PI / 2 - 0.1, 12)
    const stub = gearProfile({ teeth: 20, module: 1, pressureAngle: 25, addendum: 0.8, dedendum: 1 })
    expectCleanPolygon(stub)
    expect(Math.max(...stub.map(radiusOf))).toBeCloseTo(10.8, 9)
    expect(Math.min(...stub.map(radiusOf))).toBeCloseTo(9, 9)
    expect(gearProfile({ teeth: 20, module: 1, samples: 12 }).length).toBeGreaterThan(plain.length)
  })

  test('internal: the outline is the hole of a ring gear with a tooth centred on +x', () => {
    for (const teeth of [30, 60, 72, 100]) {
      const g = gearDimensions({ teeth, module: 1, internal: true })
      const hole = gearProfile({ teeth, module: 1, internal: true })
      expectCleanPolygon(hole)
      const radii = hole.map(radiusOf)
      expect(Math.min(...radii)).toBeCloseTo(g.tipRadius, 9)
      expect(Math.max(...radii)).toBeCloseTo(g.rootRadius, 9)
      let rising = 0
      for (let i = 0; i < radii.length; i++) {
        if ((radii[i] as number) <= g.pitchRadius && (radii[(i + 1) % radii.length] as number) > g.pitchRadius) rising++
      }
      expect(rising).toBe(teeth)
      const half = rad(180 / teeth)
      expect(pointInPolygon([g.pitchRadius, 0], hole)).toBe(false) // ring tooth (metal) on +x
      expect(pointInPolygon([g.pitchRadius * Math.cos(half), g.pitchRadius * Math.sin(half)], hole)).toBe(true)
      expect(pointInPolygon([0, 0], hole)).toBe(true)
    }
  })

  test('bad input gives an empty outline; odd input is clamped, never thrown', () => {
    expect(gearProfile({ teeth: Number.NaN, module: 1 })).toEqual([])
    expect(gearProfile({ teeth: 20, module: 0 })).toEqual([])
    expect(gearProfile({ teeth: 20, module: -1 })).toEqual([])
    expect(gearProfile({ teeth: 20, module: Number.POSITIVE_INFINITY })).toEqual([])
    expectCleanPolygon(gearProfile({ teeth: 1, module: 1 })) // becomes 3 teeth
    expectCleanPolygon(gearProfile({ teeth: 12.4, module: 1, pressureAngle: 60, backlash: 99, samples: 0 }))
    expectCleanPolygon(gearProfile({ teeth: 9, module: 1, addendum: 3 })) // would be pointed: cut off
    expectCleanPolygon(gearProfile({ teeth: 40, module: 1, dedendum: 30 }))
  })

  test('is deterministic', () => {
    expect(gearProfile({ teeth: 17, module: 1.25 })).toEqual(gearProfile({ teeth: 17, module: 1.25 }))
  })
})

describe('rackProfile', () => {
  test('clean polygon with the right teeth, pitch and thickness', () => {
    const module = 2
    const rack = rackProfile({ teeth: 8, module })
    expectCleanPolygon(rack)
    const pitch = Math.PI * module
    const tips = rack.filter((p) => Math.abs(p[1] - module) < 1e-12)
    expect(tips.length).toBe(16) // two tip corners per tooth
    const b = bounds(rack)
    expect(b.maxY).toBe(module)
    expect(b.minY).toBeCloseTo(-1.25 * module - 2 * module, 12)
    expect(b.minX).toBeCloseTo(-pitch / 2, 12)
    expect(b.maxX).toBeCloseTo(7.5 * pitch, 12)
    // on the pitch line each tooth is half a pitch wide and centred on k × pitch
    for (let k = 0; k < 8; k++) {
      expect(pointInPolygon([k * pitch + pitch / 4 - 1e-6, 0], rack)).toBe(true)
      expect(pointInPolygon([k * pitch - pitch / 4 + 1e-6, 0], rack)).toBe(true)
      expect(pointInPolygon([k * pitch + pitch / 4 + 1e-6, 0], rack)).toBe(false)
    }
    // flanks lean at the pressure angle
    const flank = Math.atan2((rack[3] as Vec2)[0] - (rack[4] as Vec2)[0], (rack[4] as Vec2)[1] - (rack[3] as Vec2)[1])
    expect(flank).toBeCloseTo(rad(20), 9)
    expect(rackProfile({ teeth: 5, module: 1, height: 4, backlash: 0.1 }).length).toBe(4 + 5 * 4)
    expect(bounds(rackProfile({ teeth: 5, module: 1, height: 4 })).minY).toBeCloseTo(-5.25, 12)
    expect(rackProfile({ teeth: 0, module: 1 })).toEqual([])
    expect(rackProfile({ teeth: 4, module: Number.NaN })).toEqual([])
  })
})

describe('camProfile and beltPath', () => {
  test('the lobe is convex, clean and has the closed-form area', () => {
    const cam = { baseRadius: 16, noseRadius: 7, distance: 18 }
    const lobe = camProfile({ ...cam, samples: 720 })
    expectCleanPolygon(lobe)
    expect(lobe.length).toBe(720)
    for (let i = 0; i < lobe.length; i++) {
      const a = lobe[i] as Vec2
      const b = lobe[(i + 1) % lobe.length] as Vec2
      const c = lobe[(i + 2) % lobe.length] as Vec2
      expect((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])).toBeGreaterThanOrEqual(-1e-9)
    }
    const spread = Math.acos((16 - 7) / 18)
    const area = 16 * 16 * (Math.PI - spread) + 7 * 7 * spread + 18 * Math.sin(spread) * (16 + 7)
    expect(polygonArea(lobe)).toBeCloseTo(area, 1)
    const b = bounds(lobe)
    expect(b.maxX).toBeCloseTo(25, 3) // nose tip = distance + nose radius = base + lift
    expect(b.minX).toBeCloseTo(-16, 3)
    expect(b.maxY).toBeCloseTo(16, 3)
    expect(camProfile(cam).length).toBe(72)
    expectCleanPolygon(camProfile(cam))
  })

  test('degenerate lobes fall back to a circle; bad input gives nothing', () => {
    const round = camProfile({ baseRadius: 10, noseRadius: 2, distance: 3, samples: 90 })
    expectCleanPolygon(round)
    for (const p of round) expect(radiusOf(p)).toBeCloseTo(10, 12)
    expectCleanPolygon(camProfile({ baseRadius: 10, noseRadius: 0, distance: 20 })) // pointed nose
    expect(camProfile({ baseRadius: 0, noseRadius: 2, distance: 3 })).toEqual([])
    expect(camProfile({ baseRadius: Number.NaN, noseRadius: 2, distance: 3 })).toEqual([])
  })

  test('beltPath wraps two pulleys: length = 2 × distance + circumference for equal pulleys', () => {
    const belt = beltPath({ centerA: [1, 2], radiusA: 3, centerB: [1, 12], radiusB: 3, samples: 720 })
    expectCleanPolygon(belt)
    expect(pathLength(belt, true)).toBeCloseTo(20 + 2 * Math.PI * 3, 2)
    expect(bounds(belt).minY).toBeCloseTo(-1, 3)
    expect(bounds(belt).maxY).toBeCloseTo(15, 3)
    // the 2 : 1 cam drive: closed-form open-belt length
    const drive = beltPath({ centerA: [0, 0], radiusA: 4, centerB: [20, 0], radiusB: 8, samples: 1440 })
    expectCleanPolygon(drive)
    const lean = Math.asin((8 - 4) / 20)
    const exact = 2 * 20 * Math.cos(lean) + 4 * (Math.PI - 2 * lean) + 8 * (Math.PI + 2 * lean)
    expect(pathLength(drive, true)).toBeCloseTo(exact, 2)
  })
})

describe('lathe profiles', () => {
  test('pistonProfile: solid, with three ring grooves', () => {
    const piston = pistonProfile({ radius: 43, height: 52 })
    expectSolidLathe(piston)
    expect(Math.max(...piston.map((p) => p[0]))).toBe(43)
    expect(Math.max(...piston.map((p) => p[1]))).toBe(52)
    const grooveFloor = piston.filter((p) => Math.abs(p[0] - (43 - 0.07 * 43)) < 1e-9)
    expect(grooveFloor.length).toBe(6) // two corners per groove
    expect(Math.min(...grooveFloor.map((p) => p[1]))).toBeGreaterThan(0.6 * 52) // ring pack in the top 40 %
    expect(pistonProfile({ radius: 10 }).some((p) => p[1] === 12)).toBe(true) // default height 1.2 × radius
    expect(pistonProfile({ radius: 10, rings: 0 }).length).toBe(6)
  })

  test('pistonProfile: dome, dish, hollow skirt and odd proportions stay clean', () => {
    const dome = pistonProfile({ radius: 40, height: 50, crown: 6 })
    expectSolidLathe(dome)
    expect(Math.max(...dome.map((p) => p[1]))).toBe(56)
    expect(dome[dome.length - 1]).toEqual([0, 56])
    const dish = pistonProfile({ radius: 40, height: 50, crown: -5 })
    expectSolidLathe(dish)
    expect(dish[dish.length - 1]).toEqual([0, 45])
    expect(Math.max(...dish.map((p) => p[1]))).toBe(50)
    const hollow = pistonProfile({ radius: 40, height: 50, wall: 5 })
    expect(hollow[0]?.[0]).toBe(0)
    expect(hollow[0]?.[1]).toBeGreaterThan(30) // underside of the crown
    expect(hollow[hollow.length - 1]).toEqual([0, 50])
    expect(hollow.filter((p) => p[0] === 35).length).toBe(2) // the inner wall
    expectCleanPolygon(hollow)
    expect(Math.min(...hollow.map((p) => p[1]))).toBe(0)
    for (const options of [
      { radius: 40, height: 10 },
      { radius: 5, height: 60, rings: 9 },
      { radius: 40, height: 50, wall: 5, crown: -8 },
      { radius: 40, height: 50, wall: 0.5, chamfer: 4 },
      { radius: 40, height: 50, crown: 500 },
      { radius: 40, height: 50, ringWidth: 30, ringDepth: 99 },
      { radius: 40, height: 50, chamfer: 0 },
    ]) {
      const profile = pistonProfile(options)
      expectCleanPolygon(profile)
      expect(profile.every((p) => p[0] >= 0)).toBe(true)
    }
    expect(pistonProfile({ radius: 0 })).toEqual([])
  })

  test('valveProfile: face at 0, stem to the tip, radius falls monotonically from head to stem', () => {
    const valve = valveProfile({ headRadius: 17.5, stemRadius: 2.75, length: 109 })
    expectSolidLathe(valve)
    expect(valve[1]).toEqual([17.5, 0])
    expect(valve[valve.length - 1]).toEqual([0, 109])
    expect(Math.max(...valve.map((p) => p[0]))).toBe(17.5)
    expect(Math.max(...valve.map((p) => p[1]))).toBe(109)
    for (let i = 2; i < valve.length; i++) {
      expect((valve[i] as Vec2)[0]).toBeLessThanOrEqual((valve[i - 1] as Vec2)[0] + 1e-12)
      expect((valve[i] as Vec2)[1]).toBeGreaterThanOrEqual((valve[i - 1] as Vec2)[1] - 1e-12)
    }
    // 45° seat
    const seat = Math.atan2((valve[3] as Vec2)[1] - (valve[2] as Vec2)[1], (valve[2] as Vec2)[0] - (valve[3] as Vec2)[0])
    expect(seat).toBeCloseTo(rad(45), 9)
    expect(valve.filter((p) => Math.abs(p[0] - 2.75) < 1e-12).length).toBeGreaterThanOrEqual(2) // a straight stem
    const byDefault = valveProfile({ headRadius: 10 })
    expectSolidLathe(byDefault)
    expect(byDefault[byDefault.length - 1]).toEqual([0, 60])
    for (const options of [
      { headRadius: 10, length: 1 },
      { headRadius: 10, stemRadius: 50 },
      { headRadius: 10, headHeight: 500, seatAngle: 89 },
      { headRadius: 10, stemRadius: 0.001, samples: 1 },
    ]) {
      expectSolidLathe(valveProfile(options))
    }
    expect(valveProfile({ headRadius: -1 })).toEqual([])
  })

  test('bearingProfile: two closed races, and the balls fit between them without overlapping anything', () => {
    for (const size of [
      { innerRadius: 10, outerRadius: 23.5, width: 14 }, // a 6204
      { innerRadius: 5, outerRadius: 8 },
      { innerRadius: 20, outerRadius: 60, width: 6 },
      { innerRadius: 3, outerRadius: 4, width: 9 },
    ]) {
      const outer = expectRingLathe(bearingProfile({ ...size, race: 'outer', samples: 24 }))
      const inner = expectRingLathe(bearingProfile({ ...size, race: 'inner', samples: 24 }))
      const balls = bearingBalls(size)
      const width = size.width ?? size.outerRadius - size.innerRadius
      expect(Math.max(...outer.map((p) => p[0]))).toBe(size.outerRadius)
      expect(Math.min(...inner.map((p) => p[0]))).toBe(size.innerRadius)
      expect(Math.max(...outer.map((p) => p[1]))).toBe(width)
      expect(Math.max(...inner.map((p) => p[1]))).toBe(width)
      expect(balls.pitchRadius).toBe((size.innerRadius + size.outerRadius) / 2)
      expect(balls.height).toBe(width / 2)
      // a ball touches the bottom of each groove …
      expect(Math.min(...outer.map((p) => Math.hypot(p[0] - balls.pitchRadius, p[1] - balls.height)))).toBeCloseTo(balls.radius, 6)
      expect(Math.min(...inner.map((p) => Math.hypot(p[0] - balls.pitchRadius, p[1] - balls.height)))).toBeCloseTo(balls.radius, 6)
      // … sits between the races, and neighbouring balls do not overlap
      expect(Math.min(...outer.map((p) => p[0]))).toBeGreaterThan(balls.pitchRadius)
      expect(Math.max(...inner.map((p) => p[0]))).toBeLessThan(balls.pitchRadius)
      expect(balls.count).toBeGreaterThanOrEqual(3)
      expect(2 * balls.pitchRadius * Math.sin(Math.PI / balls.count)).toBeGreaterThanOrEqual(2 * balls.radius)
    }
    expect(bearingBalls({ innerRadius: 10, outerRadius: 23.5, width: 14 }).count).toBe(8) // a 6204 has 8 balls
    expect(bearingBalls({ innerRadius: 10, outerRadius: 23.5, count: 5 }).count).toBe(5)
    expect(bearingBalls({ innerRadius: 10, outerRadius: 23.5, count: 500 }).count).toBeLessThan(20)
    expect(bearingProfile({ innerRadius: 10, outerRadius: 5 })).toEqual([])
    expect(bearingBalls({ innerRadius: 0, outerRadius: 5 }).count).toBe(0)
  })

  test('shaftProfile stacks sections with chamfered ends', () => {
    const shaft = shaftProfile({
      sections: [
        { radius: 5, length: 10 },
        { radius: 8, length: 4 },
        { radius: 3, length: 20 },
      ],
    })
    expectSolidLathe(shaft)
    expect(Math.max(...shaft.map((p) => p[1]))).toBe(34)
    expect(Math.max(...shaft.map((p) => p[0]))).toBe(8)
    expect(shaft).toContainEqual([8, 10])
    expect(shaft).toContainEqual([8, 14])
    expect(shaft).toContainEqual([4.5, 0]) // chamfer 10 % of the radius
    const plain = shaftProfile({ sections: [{ radius: 2, length: 9 }], chamfer: 0 })
    expect(plain).toEqual([
      [0, 0],
      [2, 0],
      [2, 9],
      [0, 9],
    ])
    expect(shaftProfile({ sections: [] })).toEqual([])
    expect(shaftProfile({ sections: [{ radius: -1, length: 2 }] })).toEqual([])
  })

  test('pulleyProfile: a V groove in the rim; a bore makes it a closed loop', () => {
    const solid = pulleyProfile({ radius: 20, width: 10 })
    expectSolidLathe(solid)
    expect(Math.max(...solid.map((p) => p[0]))).toBe(20)
    expect(Math.max(...solid.map((p) => p[1]))).toBe(10)
    const grooveFloor = solid.filter((p) => Math.abs(p[0] - (20 - 0.18 * 20)) < 1e-9)
    expect(grooveFloor.length).toBeGreaterThanOrEqual(1)
    for (const p of grooveFloor) expect(Math.abs(p[1] - 5)).toBeLessThan(3)
    const bored = expectRingLathe(pulleyProfile({ radius: 20, width: 10, boreRadius: 4 }))
    expect(Math.min(...bored.map((p) => p[0]))).toBe(4)
    expectSolidLathe(pulleyProfile({ radius: 20, width: 10, grooveDepth: 0 }))
    expectSolidLathe(pulleyProfile({ radius: 20, width: 2, grooveDepth: 500, grooveAngle: 5 }))
    expect(pulleyProfile({ radius: 20, width: 0 })).toEqual([])
  })
})

describe('outlines to extrude', () => {
  test('conRodProfile: two eyes joined by a beam, symmetric, clean', () => {
    const rod = conRodProfile({ length: 139, bigEndRadius: 32, smallEndRadius: 16 })
    expectCleanPolygon(rod)
    const b = bounds(rod)
    expect(b.minY).toBeCloseTo(-32, 9)
    expect(b.maxY).toBeCloseTo(139 + 16, 9)
    expect(b.maxX).toBeGreaterThan(31.5)
    expect(b.maxX).toBeLessThanOrEqual(32 + 1e-9)
    expect(b.minX).toBeCloseTo(-b.maxX, 9)
    expect(pointInPolygon([0, 0], rod)).toBe(true)
    expect(pointInPolygon([0, 139], rod)).toBe(true)
    expect(pointInPolygon([0, 70], rod)).toBe(true) // the beam
    expect(pointInPolygon([20, 70], rod)).toBe(false) // … which is narrower than the big end
    expect(polygonCentroid(rod)[0]).toBeCloseTo(0, 6)
    // every point is on one of the two eyes: the beam edges are the straight lines between them
    for (const p of rod) {
      expect(Math.min(Math.abs(radiusOf(p) - 32), Math.abs(Math.hypot(p[0], p[1] - 139) - 16))).toBeLessThan(1e-9)
    }
    const wide = conRodProfile({ length: 100, bigEndRadius: 20, smallEndRadius: 10, beamWidth: 12, taper: 1 })
    expectCleanPolygon(wide)
    expect(pointInPolygon([5.9, 50], wide)).toBe(true)
    expect(pointInPolygon([6.1, 50], wide)).toBe(false)
    expectCleanPolygon(conRodProfile({ length: 10, bigEndRadius: 20, smallEndRadius: 15 })) // eyes overlap: plain hull
    expectCleanPolygon(conRodProfile({ length: 100, bigEndRadius: 20, smallEndRadius: 10, beamWidth: 900, taper: 50 }))
    expect(conRodProfile({ length: 0, bigEndRadius: 20, smallEndRadius: 10 })).toEqual([])
  })

  test('crankWebProfile: the counterweight is opposite the crank pin', () => {
    const web = crankWebProfile({ throw: 43, journalRadius: 27.5, pinRadius: 22.5, counterweightRadius: 65 })
    expectCleanPolygon(web)
    expect(pointInPolygon([0, 0], web)).toBe(true)
    expect(pointInPolygon([0, 43], web)).toBe(true)
    expect(pointInPolygon([0, 43 + 22.5], web)).toBe(true) // the web wraps the whole pin
    expect(pointInPolygon([0, -60], web)).toBe(true) // counterweight
    expect(pointInPolygon([0, 80], web)).toBe(false)
    expect(Math.max(...web.map(radiusOf))).toBeCloseTo(Math.max(65, 43 + 1.35 * 22.5), 9)
    const centroid = polygonCentroid(web)
    expect(centroid[0]).toBeCloseTo(0, 6)
    const bare = crankWebProfile({ throw: 43, journalRadius: 27.5, pinRadius: 22.5, counterweightRadius: 1 })
    expectCleanPolygon(bare)
    expect(polygonCentroid(bare)[1]).toBeGreaterThan(0) // without a counterweight the web is heavy on the pin side
    expect(centroid[1]).toBeLessThan(polygonCentroid(bare)[1]) // the counterweight pulls it back
    const b = bounds(web)
    expect(b.minY).toBeCloseTo(-65, 9)
    expect(Math.abs(b.minX + b.maxX)).toBeLessThan(1e-6)
    for (const options of [
      { throw: 10, journalRadius: 30, pinRadius: 5 }, // pin boss swallowed by the main boss
      { throw: 40, journalRadius: 10, pinRadius: 30 }, // pin bigger than the journal
      { throw: 40, journalRadius: 20, pinRadius: 15, counterweightAngle: 300 },
      { throw: 40, journalRadius: 20, pinRadius: 15, counterweightAngle: 0 },
      { throw: 40, journalRadius: 20, pinRadius: 15, samples: 8 },
    ]) {
      expectCleanPolygon(crankWebProfile(options))
    }
    expect(crankWebProfile({ throw: 0, journalRadius: 1, pinRadius: 1 })).toEqual([])
  })
})
