import { describe, expect, test } from 'bun:test'
import {
  STROKES,
  camFromTiming,
  camLift,
  centerDistance,
  fourBar,
  fourStroke,
  gearRatio,
  inlineFour,
  meshAngle,
  pitchRadius,
  planetary,
  planetaryPose,
  rackMesh,
  rackTravel,
  sliderCrank,
  valveLift,
} from '../../../src/lib/kinematics.ts'
import { camProfile, gearProfile, pointInPolygon, rackProfile, supportDistance } from '../../../src/lib/profiles.ts'
import type { Vec2 } from '../../../src/lib/types.ts'

const rad = (d: number): number => (d * Math.PI) / 180
const deg = (r: number): number => (r * 180) / Math.PI

// ── the oracle: the closed-form slider-crank formulas, written out independently of the library (radians) ─────────
function oracleSliderCrank(theta: number, r: number, l: number) {
  const sn = Math.sin(theta)
  const cs = Math.cos(theta)
  const root = Math.sqrt(l * l - r * r * sn * sn)
  const x = r * cs + root
  const s = r + l - x
  const phi = Math.asin((r * sn) / l)
  const dx = -r * sn - (r * r * sn * cs) / root
  return { x, s, phi, dx }
}
const wrap720 = (a: number): number => ((a % 720) + 720) % 720
const oracleSin2 = (theta: number, open: number, dur: number, L: number): number => {
  const u = wrap720(theta - open)
  return u < dur ? L * Math.sin((Math.PI * u) / dur) ** 2 : 0
}
function oracleEggCam(L: number, halfDurCamDeg: number, Rb: number) {
  const c = Math.cos(rad(halfDurCamDeg))
  const d = L / (1 - c)
  const Rn = Rb - d * c
  return { Rb, Rn, d, lift: (alphaDeg: number) => Math.max(0, d * Math.cos(rad(alphaDeg)) + Rn - Rb) }
}

// REF-86 rows of engine_kinematics.out.txt: crank deg | travel from TDC mm | % stroke | rod angle deg
const REF86_TABLE: [number, number, number, number][] = [
  [0, 0.0, 0.0, 0.0],
  [15, 1.91, 2.2, 4.59],
  [30, 7.43, 8.6, 8.9],
  [45, 15.96, 18.6, 12.64],
  [60, 26.58, 30.9, 15.54],
  [75, 38.22, 44.4, 17.39],
  [90, 49.82, 57.9, 18.02],
  [105, 60.48, 70.3, 17.39],
  [120, 69.58, 80.9, 15.54],
  [135, 76.77, 89.3, 12.64],
  [150, 81.91, 95.2, 8.9],
  [165, 84.98, 98.8, 4.59],
  [180, 86.0, 100.0, 0.0],
]
const REF86 = { throw: 43, rod: 139 }

// ── polygon helpers for the meshing tests ────────────────────────────────────────────────────────────────────
function place(polygon: Vec2[], angle: number, center: Vec2): Vec2[] {
  const c = Math.cos(rad(angle))
  const s = Math.sin(rad(angle))
  return polygon.map(([x, y]) => [center[0] + x * c - y * s, center[1] + x * s + y * c] as Vec2)
}
function distanceToOutline(p: Vec2, polygon: Vec2[]): number {
  let best = Infinity
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Vec2
    const b = polygon[(i + 1) % polygon.length] as Vec2
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy))
  }
  return best
}
/** deepest a vertex of `a` sits inside solid `b` (or outside hole `b`), and the smallest clearance otherwise */
function overlap(a: Vec2[], b: Vec2[], bIsHole = false): { penetration: number; clearance: number } {
  let penetration = 0
  let clearance = Infinity
  for (const v of a) {
    const d = distanceToOutline(v, b)
    if (pointInPolygon(v, b) !== bIsHole) penetration = Math.max(penetration, d)
    else clearance = Math.min(clearance, d)
  }
  return { penetration, clearance }
}

describe('sliderCrank', () => {
  test('REF-86 matches the oracle table (travel, % of stroke, rod angle)', () => {
    for (const [angle, travel, percent, rodAngle] of REF86_TABLE) {
      const k = sliderCrank({ ...REF86, angle })
      expect(Math.abs(k.tdc - k.position - travel)).toBeLessThanOrEqual(0.0051)
      expect(Math.abs(100 * k.fraction - percent)).toBeLessThanOrEqual(0.051)
      expect(Math.abs(k.rodAngle - rodAngle)).toBeLessThanOrEqual(0.0051)
    }
  })

  test('the piston is 57.9 % down at 90° of crank, not 50 %', () => {
    const k = sliderCrank({ ...REF86, angle: 90 })
    expect((100 * k.fraction).toFixed(1)).toBe('57.9')
    expect(k.rodAngle.toFixed(2)).toBe('18.02')
    expect(k.tdc).toBe(182)
    expect(k.bdc).toBe(96)
    expect(k.stroke).toBe(86)
    expect(k.valid).toBe(true)
  })

  test('agrees with the oracle formula at every degree of 720°, for three engines', () => {
    for (const [r, l] of [
      [43, 139],
      [46, 151],
      [22.5, 84],
    ] as const) {
      for (let angle = 0; angle <= 720; angle++) {
        const o = oracleSliderCrank(rad(angle), r, l)
        const k = sliderCrank({ throw: r, rod: l, angle })
        expect(k.position).toBeCloseTo(o.x, 9)
        expect(k.fraction * 2 * r).toBeCloseTo(o.s, 9)
        expect(k.rodAngle).toBeCloseTo(deg(o.phi), 9)
        expect(k.velocity).toBeCloseTo(rad(o.dx), 9)
      }
    }
  })

  test('half stroke is reached at 81.10° and top speed at 74.14° (1.0471 × r·ω)', () => {
    let low = 0
    let high = 180
    for (let i = 0; i < 60; i++) {
      const mid = (low + high) / 2
      if (sliderCrank({ ...REF86, angle: mid }).fraction < 0.5) low = mid
      else high = mid
    }
    expect(low.toFixed(2)).toBe('81.10')
    let fastest = 0
    let at = 0
    for (let angle = 0; angle <= 180; angle += 0.01) {
      const speed = Math.abs(sliderCrank({ ...REF86, angle }).velocity)
      if (speed > fastest) {
        fastest = speed
        at = angle
      }
    }
    expect(at.toFixed(2)).toBe('74.14')
    expect((fastest / rad(43)).toFixed(4)).toBe('1.0471')
  })

  test("Wikipedia's worked example: rod 6, throw 2 → top speed at 73.1753°", () => {
    let low = 1
    let high = 90
    const slope = (angle: number): number =>
      sliderCrank({ throw: 2, rod: 6, angle: angle + 1e-4 }).velocity - sliderCrank({ throw: 2, rod: 6, angle: angle - 1e-4 }).velocity
    for (let i = 0; i < 60; i++) {
      const mid = (low + high) / 2
      if (slope(mid) < 0) low = mid
      else high = mid
    }
    expect(Math.abs(low - 73.1753)).toBeLessThan(2e-4)
  })

  test('the rod never stretches: |pin − crank pin| = rod at 72 angles, with and without offset', () => {
    for (const offset of [0, 12, -20]) {
      for (let i = 0; i < 72; i++) {
        const k = sliderCrank({ ...REF86, angle: i * 5, offset })
        const length = Math.hypot(k.crankPin[0] - offset, k.crankPin[1] - k.position)
        expect(length).toBeCloseTo(139, 9)
        expect(Math.hypot(k.crankPin[0], k.crankPin[1])).toBeCloseTo(43, 9)
        expect(k.valid).toBe(true)
      }
    }
  })

  test('offset crank: tdc / bdc are the true extremes and fraction stays in 0..1', () => {
    const base = { throw: 30, rod: 100, offset: 15 }
    let highest = -Infinity
    let lowest = Infinity
    for (let angle = 0; angle < 360; angle += 0.01) {
      const k = sliderCrank({ ...base, angle })
      highest = Math.max(highest, k.position)
      lowest = Math.min(lowest, k.position)
      expect(k.fraction).toBeGreaterThanOrEqual(0)
      expect(k.fraction).toBeLessThanOrEqual(1)
    }
    const k = sliderCrank({ ...base, angle: 0 })
    expect(k.tdc).toBeCloseTo(Math.sqrt(130 * 130 - 15 * 15), 12)
    expect(k.bdc).toBeCloseTo(Math.sqrt(70 * 70 - 15 * 15), 12)
    expect(highest).toBeCloseTo(k.tdc, 5)
    expect(lowest).toBeCloseTo(k.bdc, 5)
    expect(k.stroke).toBeGreaterThan(60) // an offset crank has a stroke slightly longer than 2 × throw
  })

  test('is symmetric about TDC, and the rod leans the other way on the way back up', () => {
    for (const angle of [10, 47, 90, 133, 179]) {
      const down = sliderCrank({ ...REF86, angle })
      const up = sliderCrank({ ...REF86, angle: 360 - angle })
      expect(up.position).toBeCloseTo(down.position, 9)
      expect(up.rodAngle).toBeCloseTo(-down.rodAngle, 9)
      expect(down.velocity).toBeLessThan(0)
      expect(up.velocity).toBeGreaterThan(0)
    }
  })

  test('a rod that is too short is reported, with finite numbers', () => {
    const k = sliderCrank({ throw: 50, rod: 30, angle: 90 })
    expect(k.valid).toBe(false)
    for (const value of [k.position, k.rodAngle, k.tdc, k.bdc, k.stroke, k.fraction, k.velocity]) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })
})

describe('four-stroke cycle and inline-four phasing', () => {
  test('strokes are 180° each in the order intake, compression, power, exhaust', () => {
    expect(STROKES).toEqual(['intake', 'compression', 'power', 'exhaust'])
    expect(fourStroke(0)).toEqual({ index: 0, name: 'intake', progress: 0 })
    expect(fourStroke(90).name).toBe('intake')
    expect(fourStroke(270)).toEqual({ index: 1, name: 'compression', progress: 0.5 })
    expect(fourStroke(360).name).toBe('power')
    expect(fourStroke(719).name).toBe('exhaust')
    expect(fourStroke(720).name).toBe('intake')
    expect(fourStroke(-90).name).toBe('exhaust')
    expect(fourStroke(Number.NaN).name).toBe('intake')
  })

  test('inlineFour gives the 1-3-4-2 offsets 0, 540, 180, 360', () => {
    expect([1, 2, 3, 4].map(inlineFour)).toEqual([0, 540, 180, 360])
    expect(inlineFour(5)).toBe(0)
    expect(inlineFour(0)).toBe(360)
    expect(inlineFour(Number.NaN)).toBe(0)
  })

  test('at 0° pistons 1 and 4 are at TDC, 2 and 3 at BDC; at 90° all four are level at 57.9 %', () => {
    const percent = (angle: number, cylinder: number): string =>
      (100 * sliderCrank({ ...REF86, angle: angle - inlineFour(cylinder) }).fraction).toFixed(1)
    expect([1, 2, 3, 4].map((c) => percent(0, c))).toEqual(['0.0', '100.0', '100.0', '0.0'])
    expect([1, 2, 3, 4].map((c) => percent(90, c))).toEqual(['57.9', '57.9', '57.9', '57.9'])
    expect([1, 2, 3, 4].map((c) => percent(180, c))).toEqual(['100.0', '0.0', '0.0', '100.0'])
  })

  test('exactly one cylinder is on its power stroke at any time, firing 1-3-4-2', () => {
    for (let angle = 1; angle < 720; angle += 7) {
      const onPower = [1, 2, 3, 4].filter((c) => fourStroke(angle - inlineFour(c)).name === 'power')
      expect(onPower.length).toBe(1)
    }
    const firesAt = [1, 2, 3, 4].map((c) => ({ c, at: wrap720(360 + inlineFour(c)) })).sort((a, b) => a.at - b.at)
    expect(firesAt).toEqual([
      { c: 4, at: 0 },
      { c: 2, at: 180 },
      { c: 1, at: 360 },
      { c: 3, at: 540 },
    ])
    // phase table from the research report, crank 0–180: cyl 1 intake, 2 compression, 3 exhaust, 4 power
    expect([1, 2, 3, 4].map((c) => fourStroke(90 - inlineFour(c)).name)).toEqual(['intake', 'compression', 'exhaust', 'power'])
  })
})

describe('valveLift', () => {
  const intake = { opens: 710, closes: 230, lift: 9 }
  const exhaust = { opens: 490, closes: 10, lift: 9 }

  test('matches the oracle table for both lift models', () => {
    // crank theta | sin^2 intake lift | egg-cam intake lift (mm), from engine_kinematics.out.txt
    const table: [number, number, number][] = [
      [710, 0.0, 0.0],
      [0, 0.15, 1.32],
      [30, 2.25, 4.79],
      [60, 5.66, 7.31],
      [90, 8.4, 8.73],
      [110, 9.0, 9.0],
      [150, 6.75, 7.91],
      [180, 3.34, 5.74],
      [210, 0.6, 2.57],
      [230, 0.0, 0.0],
    ]
    for (const [angle, cosine, cam] of table) {
      expect(Math.abs(valveLift({ ...intake, angle }) - cosine)).toBeLessThanOrEqual(0.0051)
      expect(Math.abs(valveLift({ ...intake, angle, profile: 'cam' }) - cam)).toBeLessThanOrEqual(0.0051)
    }
  })

  test('agrees with the oracle formulas at every degree', () => {
    const egg = oracleEggCam(9, 60, 16)
    for (let angle = -720; angle <= 1440; angle++) {
      expect(valveLift({ ...intake, angle })).toBeCloseTo(oracleSin2(angle, 710, 240, 9), 9)
      expect(valveLift({ ...exhaust, angle })).toBeCloseTo(oracleSin2(angle, 490, 240, 9), 9)
      const camAngle = (wrap720(angle - (710 + 120) + 360) - 360) / 2
      expect(valveLift({ ...intake, angle, profile: 'cam' })).toBeCloseTo(egg.lift(camAngle), 9)
    }
  })

  test('rubric frames: lift as a percentage of maximum', () => {
    const percent = (valve: typeof intake, angle: number): string => ((100 * valveLift({ ...valve, angle })) / 9).toFixed(0)
    expect([0, 45, 90, 135, 180, 230, 270].map((a) => percent(intake, a))).toEqual(['2', '43', '93', '90', '37', '0', '0'])
    expect([490, 540, 585, 630, 710, 720].map((a) => percent(exhaust, a))).toEqual(['0', '37', '90', '93', '7', '2'])
  })

  test('both valves are shut from 230° to 490°, and overlap around 0°', () => {
    for (let angle = 230; angle <= 490; angle += 5) {
      for (const profile of ['cosine', 'cam'] as const) {
        expect(valveLift({ ...intake, angle, profile })).toBe(0)
        expect(valveLift({ ...exhaust, angle, profile })).toBe(0)
      }
    }
    expect(valveLift({ ...intake, angle: 5 })).toBeGreaterThan(0)
    expect(valveLift({ ...exhaust, angle: 5 })).toBeGreaterThan(0)
    expect(valveLift({ ...intake, angle: 180 })).toBeGreaterThan(0) // not snapped to the dead centre
    expect(valveLift({ ...exhaust, angle: 540 })).toBeGreaterThan(0)
  })

  test('peaks at the centre of the window, never negative, period = cycle', () => {
    for (const profile of ['cosine', 'cam'] as const) {
      expect(valveLift({ ...intake, angle: 110, profile })).toBeCloseTo(9, 12)
      for (let angle = 0; angle < 720; angle += 3) {
        const lift = valveLift({ ...intake, angle, profile })
        expect(lift).toBeGreaterThanOrEqual(0)
        expect(lift).toBeLessThanOrEqual(9 + 1e-12)
        expect(valveLift({ ...intake, angle: angle + 720, profile })).toBeCloseTo(lift, 9)
      }
    }
  })

  test('cycle: 360 runs the same window every revolution; a zero-length window stays shut', () => {
    expect(valveLift({ angle: 100, opens: 40, closes: 160, lift: 5, cycle: 360 })).toBeCloseTo(5, 12)
    expect(valveLift({ angle: 460, opens: 40, closes: 160, lift: 5, cycle: 360 })).toBeCloseTo(5, 12)
    expect(valveLift({ angle: 200, opens: 40, closes: 160, lift: 5, cycle: 360 })).toBe(0)
    expect(valveLift({ angle: 50, opens: 40, closes: 40, lift: 5 })).toBe(0)
    expect(valveLift({ angle: 50, opens: 40, closes: 160, lift: 5, cycle: 0 })).toBe(0)
  })
})

describe('camLift and camFromTiming', () => {
  test('designing from timing reproduces the oracle: L 9, 240° → distance 18, nose = base − 9', () => {
    for (const baseRadius of [16, 18, 20]) {
      const cam = camFromTiming({ lift: 9, duration: 240, baseRadius })
      expect(cam.distance).toBeCloseTo(18, 9)
      expect(cam.noseRadius).toBeCloseTo(baseRadius - 9, 9)
      expect(cam.valid).toBe(true)
      expect(camLift({ ...cam, angle: 0 })).toBeCloseTo(9, 9)
      expect(camLift({ ...cam, angle: 30 }).toFixed(2)).toBe('6.59')
      expect(camLift({ ...cam, angle: 60 })).toBeCloseTo(0, 9)
      expect(camLift({ ...cam, angle: 180 })).toBe(0)
    }
    expect(camFromTiming({ lift: 9, duration: 240, baseRadius: 8 }).valid).toBe(false) // nose radius would be negative
  })

  test('equals the support function of the two circles, by brute force', () => {
    const cam = { baseRadius: 16, noseRadius: 7, distance: 18 }
    let worst = 0
    for (let angle = -180; angle <= 180; angle += 0.5) {
      let support = -Infinity
      for (let t = 0; t < 360; t += 0.25) {
        support = Math.max(support, 16 * Math.cos(rad(t - angle)), 18 * Math.cos(rad(angle)) + 7 * Math.cos(rad(t - angle)))
      }
      worst = Math.max(worst, Math.abs(support - 16 - camLift({ ...cam, angle })))
    }
    expect(worst).toBeLessThan(1e-9)
  })

  test('the drawn lobe (camProfile) and the motion (camLift) are the same object', () => {
    const cam = camFromTiming({ lift: 9, duration: 240, baseRadius: 16 })
    const lobe = camProfile({ ...cam, samples: 720 })
    for (let angle = -180; angle < 180; angle += 3) {
      // a flat follower whose normal is at `angle` from the lobe centreline rides on the support function
      expect(Math.abs(supportDistance(lobe, angle) - 16 - camLift({ ...cam, angle }))).toBeLessThan(2e-3)
    }
  })

  test('valveLift profile "cam" is camLift at half the crank angle', () => {
    const cam = camFromTiming({ lift: 9, duration: 240, baseRadius: 16 })
    for (let crank = -130; crank <= 130; crank += 5) {
      expect(valveLift({ angle: 110 + crank, opens: 710, closes: 230, lift: 9, profile: 'cam' })).toBeCloseTo(
        camLift({ ...cam, angle: crank / 2 }),
        9,
      )
    }
  })
})

describe('gears', () => {
  test('gearRatio, pitchRadius, centerDistance, rackTravel', () => {
    expect(gearRatio(20, 40)).toBe(2) // the 2 : 1 cam drive
    expect(gearRatio(0, 40)).toBe(0)
    expect(pitchRadius(24, 2)).toBe(24)
    expect(centerDistance(24, 48, 2)).toBe(72)
    expect(centerDistance(24, 72, 1, { internal: true })).toBe(24)
    expect(rackTravel(360, 10)).toBeCloseTo(2 * Math.PI * 10, 12)
    expect(rackTravel(-90, 4)).toBeCloseTo(-2 * Math.PI, 12)
  })

  test('meshAngle turns B at −teethA / teethB (external) or +teethA / teethB (internal)', () => {
    const start = meshAngle(0, 20, 40)
    expect(meshAngle(90, 20, 40) - start).toBeCloseTo(-45, 12)
    expect(meshAngle(720, 20, 40) - start).toBeCloseTo(-360, 12) // crank twice, cam once
    const inner = meshAngle(0, 24, 72, { internal: true })
    expect(meshAngle(90, 24, 72, { internal: true }) - inner).toBeCloseTo(30, 12)
  })

  test('half-tooth phase: a tooth of A facing B meets a gap of B', () => {
    for (const [teethA, teethB] of [
      [24, 24],
      [17, 40],
      [12, 31],
    ] as const) {
      const pitchB = 360 / teethB
      // B's teeth are at angleB + k × pitchB; seen from B the contact is at 180°
      const phase = (((180 - meshAngle(0, teethA, teethB)) / pitchB) % 1 + 1) % 1
      expect(phase).toBeCloseTo(0.5, 9)
    }
    const phase = (((0 - meshAngle(0, 24, 72, { internal: true })) / 5) % 1 + 1) % 1
    expect(phase).toBeCloseTo(0.5, 9)
  })

  test('meshAngle is its own inverse and rotates with `direction`', () => {
    for (const angle of [0, 3.7, 111, -52]) {
      const b = meshAngle(angle, 17, 40, { direction: 30 })
      expect(meshAngle(b, 40, 17, { direction: 210 })).toBeCloseTo(angle + 360, 9)
      expect(meshAngle(angle + 30, 17, 40, { direction: 30 })).toBeCloseTo(meshAngle(angle, 17, 40) + 30, 9)
      const ring = meshAngle(angle, 24, 72, { internal: true, direction: 75 })
      expect(meshAngle(ring, 72, 24, { internal: true, direction: 75 }) - angle).toBeCloseTo(360 / 24, 9)
    }
  })

  test('two gear outlines placed with meshAngle touch without overlapping, all the way round a tooth', () => {
    for (const [teethA, teethB] of [
      [24, 24],
      [17, 40],
      [20, 40],
      [30, 60],
    ] as const) {
      const a = gearProfile({ teeth: teethA, module: 1, samples: 12 })
      const b = gearProfile({ teeth: teethB, module: 1, samples: 12 })
      const distance = centerDistance(teethA, teethB, 1)
      let penetration = 0
      let clearance = Infinity
      let wrong = 0
      for (let step = 0; step < 16; step++) {
        const angleA = 7.3 + (step * 360) / teethA / 8
        const pa = place(a, angleA, [0, 0])
        const pb = place(b, meshAngle(angleA, teethA, teethB), [distance, 0])
        for (const result of [overlap(pa, pb), overlap(pb, pa)]) {
          penetration = Math.max(penetration, result.penetration)
          clearance = Math.min(clearance, result.clearance)
        }
        // without the half-tooth phase the teeth collide head-on
        const shifted = place(b, meshAngle(angleA, teethA, teethB) + 180 / teethB, [distance, 0])
        wrong = Math.max(wrong, overlap(pa, shifted).penetration)
      }
      expect(penetration).toBeLessThan(1e-6) // zero backlash, yet no vertex inside the other gear
      expect(clearance).toBeLessThan(0.002) // … and the flanks really touch (in modules)
      expect(wrong).toBeGreaterThan(0.5)
    }
  })

  test('meshing holds for any `direction` of the mate', () => {
    const a = gearProfile({ teeth: 18, module: 2, backlash: 0.04, samples: 10 })
    const b = gearProfile({ teeth: 27, module: 2, backlash: 0.04, samples: 10 })
    const distance = centerDistance(18, 27, 2)
    for (const direction of [0, 37, 90, 200, -60]) {
      for (const angleA of [0, 4, 11, 95]) {
        const center: Vec2 = [distance * Math.cos(rad(direction)), distance * Math.sin(rad(direction))]
        const pa = place(a, angleA, [0, 0])
        const pb = place(b, meshAngle(angleA, 18, 27, { direction }), center)
        expect(overlap(pa, pb).penetration).toBe(0)
        expect(overlap(pb, pa).penetration).toBe(0)
        expect(overlap(pa, pb).clearance).toBeLessThan(0.1)
      }
    }
  })

  test('a pinion inside a ring gear: stays inside the hole and touches it', () => {
    const pinion = gearProfile({ teeth: 24, module: 1, backlash: 0.02, samples: 12 })
    const ring = gearProfile({ teeth: 72, module: 1, backlash: 0.02, internal: true, samples: 12 })
    const distance = centerDistance(24, 72, 1, { internal: true })
    let wrong = 0
    for (let step = 0; step < 16; step++) {
      const angle = 3 + step * 1.37
      const pp = place(pinion, angle, [0, 0])
      // the teeth touch on the +x side of the pinion, so the ring centre is on the −x side
      const ringAngle = meshAngle(angle, 24, 72, { internal: true })
      const pr = place(ring, ringAngle, [-distance, 0])
      const inHole = overlap(pp, pr, true)
      expect(inHole.penetration).toBe(0)
      expect(inHole.clearance).toBeLessThan(0.05)
      expect(overlap(pr, pp).penetration).toBe(0)
      wrong = Math.max(wrong, overlap(pp, place(ring, ringAngle + 180 / 72, [-distance, 0]), true).penetration)
    }
    expect(wrong).toBeGreaterThan(0.5)
  })

  test('rack and pinion: rackMesh keeps the rack teeth between the pinion teeth while it travels', () => {
    const teeth = 20
    const module = 1.5
    const pinion = gearProfile({ teeth, module, backlash: 0.03, samples: 12 })
    const rack = rackProfile({ teeth: 14, module, backlash: 0.03 })
    const pitch = Math.PI * module
    let wrong = 0
    let clearance = Infinity
    for (let step = 0; step < 20; step++) {
      const angle = -20 + step * 2.1
      const shift = rackMesh(angle, teeth, module)
      // any whole number of pitches is the same mesh: keep the middle of the rack under the pinion
      const local = shift - Math.round(shift / pitch) * pitch - 6 * pitch
      const pp = place(pinion, angle, [0, pitchRadius(teeth, module)])
      const pr = rack.map(([x, y]) => [x + local, y] as Vec2)
      expect(overlap(pp, pr).penetration).toBe(0)
      expect(overlap(pr, pp).penetration).toBe(0)
      clearance = Math.min(clearance, overlap(pp, pr).clearance)
      wrong = Math.max(wrong, overlap(pp, rack.map(([x, y]) => [x + local + pitch / 2, y] as Vec2)).penetration)
    }
    expect(clearance).toBeLessThan(0.06)
    expect(wrong).toBeGreaterThan(0.5)
    // the rack advances by exactly rackTravel
    expect(rackMesh(50, teeth, module) - rackMesh(10, teeth, module)).toBeCloseTo(rackTravel(40, pitchRadius(teeth, module)), 12)
  })
})

describe('planetary', () => {
  const set = { sun: 24, ring: 72 }

  test('matches the oracle (suite_groundtruth): 24 / 24 / 72', () => {
    const ringHeld = planetary({ ...set, sunSpeed: 1, ringSpeed: 0 })
    expect(ringHeld?.carrierSpeed).toBeCloseTo(0.25, 12)
    expect(ringHeld?.planetSpeed).toBeCloseTo(-0.5, 12)
    expect(ringHeld?.planetTeeth).toBe(24)
    const carrierHeld = planetary({ ...set, sunSpeed: 1, carrierSpeed: 0 })
    expect(carrierHeld?.ringSpeed).toBeCloseTo(-1 / 3, 12)
    expect(carrierHeld?.planetSpeed).toBeCloseTo(-1, 12)
    const sunHeld = planetary({ ...set, sunSpeed: 0, carrierSpeed: 1 })
    expect(sunHeld?.ringSpeed).toBeCloseTo(4 / 3, 12)
    expect(sunHeld?.planetSpeed).toBeCloseTo(2, 12)
    const locked = planetary({ ...set, sunSpeed: 1, ringSpeed: 1 })
    expect(locked?.carrierSpeed).toBeCloseTo(1, 12)
    expect(locked?.planetSpeed).toBeCloseTo(1, 12)
  })

  test('any two speeds give the third: the Willis equation holds', () => {
    const cases = [
      { sunSpeed: 3, ringSpeed: -2 },
      { sunSpeed: -1.5, carrierSpeed: 0.75 },
      { ringSpeed: 2.5, carrierSpeed: -4 },
    ]
    for (const teeth of [set, { sun: 30, ring: 78 }, { sun: 18, ring: 90 }]) {
      for (const speeds of cases) {
        const p = planetary({ ...teeth, ...speeds })
        expect(p).not.toBeNull()
        if (p === null) continue
        expect(teeth.sun * p.sunSpeed + teeth.ring * p.ringSpeed).toBeCloseTo((teeth.sun + teeth.ring) * p.carrierSpeed, 9)
        for (const [name, value] of Object.entries(speeds)) expect(p[name as 'sunSpeed']).toBe(value)
        // the planet rolls on the ring without slipping: (ωp − ωc)·Np = (ωr − ωc)·Nr
        expect((p.planetSpeed - p.carrierSpeed) * p.planetTeeth).toBeCloseTo((p.ringSpeed - p.carrierSpeed) * teeth.ring, 9)
      }
    }
  })

  test('fewer than two speeds → null', () => {
    expect(planetary({ ...set })).toBeNull()
    expect(planetary({ ...set, sunSpeed: 1 })).toBeNull()
    expect(planetary({ ...set, ringSpeed: 0 })).toBeNull()
  })

  test('planetaryPose: every planet interleaves with the sun and the ring, for any sun and carrier angle', () => {
    const sun = gearProfile({ teeth: 24, module: 1, backlash: 0.02, samples: 10 })
    const planet = gearProfile({ teeth: 24, module: 1, backlash: 0.02, samples: 10 })
    const ring = gearProfile({ teeth: 72, module: 1, backlash: 0.02, internal: true, samples: 10 })
    for (const [sunAngle, carrierAngle] of [
      [0, 0],
      [13, 0],
      [0, 41],
      [-77.7, 123.4],
    ] as const) {
      const pose = planetaryPose({ ...set, planets: 3, sunAngle, carrierAngle })
      expect(pose.assembles).toBe(true)
      expect(pose.planetTeeth).toBe(24)
      expect(pose.orbitRadius).toBe(24)
      expect(pose.planetCenters.length).toBe(3)
      const ps = place(sun, sunAngle, [0, 0])
      const pr = place(ring, pose.ringAngle, [0, 0])
      for (let i = 0; i < 3; i++) {
        const pp = place(planet, pose.planetAngles[i] as number, pose.planetCenters[i] as Vec2)
        expect(overlap(pp, ps).penetration).toBe(0)
        expect(overlap(ps, pp).penetration).toBe(0)
        expect(overlap(pp, ps).clearance).toBeLessThan(0.05)
        expect(overlap(pp, pr, true).penetration).toBe(0)
        expect(overlap(pr, pp).penetration).toBe(0)
        expect(overlap(pp, pr, true).clearance).toBeLessThan(0.05)
      }
    }
  })

  test('planetaryPose angles follow the same speeds as planetary()', () => {
    const before = planetaryPose({ ...set, sunAngle: 10, carrierAngle: 20 })
    const after = planetaryPose({ ...set, sunAngle: 10 + 8, carrierAngle: 20 + 3 })
    const speeds = planetary({ ...set, sunSpeed: 8, carrierSpeed: 3 })
    expect(after.ringAngle - before.ringAngle).toBeCloseTo(speeds?.ringSpeed ?? Number.NaN, 9)
    expect((after.planetAngles[0] as number) - (before.planetAngles[0] as number)).toBeCloseTo(speeds?.planetSpeed ?? Number.NaN, 9)
    expect(after.planetDirections).toEqual([23, 143, 263])
    expect(planetaryPose({ ...set, planets: 5 }).assembles).toBe(false) // (24 + 72) / 5 is not whole
    expect(planetaryPose({ sun: 24, ring: 72, module: 2 }).orbitRadius).toBe(48)
  })
})

describe('fourBar', () => {
  const links = { ground: 4, crank: 1, coupler: 3.5, rocker: 2.5 } // Grashof crank-rocker: 1 + 4 ≤ 3.5 + 2.5

  test('closes at every crank angle with constant link lengths', () => {
    for (const crossed of [false, true]) {
      for (let angle = 0; angle < 360; angle++) {
        const f = fourBar({ ...links, angle, crossed })
        expect(f).not.toBeNull()
        if (f === null) continue
        expect(f.crankPivot).toEqual([0, 0])
        expect(f.rockerPivot).toEqual([4, 0])
        expect(Math.hypot(f.crankTip[0], f.crankTip[1])).toBeCloseTo(1, 12)
        expect(Math.hypot(f.rockerTip[0] - f.crankTip[0], f.rockerTip[1] - f.crankTip[1])).toBeCloseTo(3.5, 12)
        expect(Math.hypot(f.rockerTip[0] - 4, f.rockerTip[1])).toBeCloseTo(2.5, 12)
        expect(Math.atan2(f.crankTip[1], f.crankTip[0])).toBeCloseTo(Math.atan2(Math.sin(rad(angle)), Math.cos(rad(angle))), 9)
      }
    }
  })

  test('angles describe the same joints', () => {
    for (let angle = 0; angle < 360; angle += 11) {
      const f = fourBar({ ...links, angle })
      if (f === null) throw new Error('should close')
      expect(f.crankTip[0] + 3.5 * Math.cos(rad(f.couplerAngle))).toBeCloseTo(f.rockerTip[0], 9)
      expect(f.crankTip[1] + 3.5 * Math.sin(rad(f.couplerAngle))).toBeCloseTo(f.rockerTip[1], 9)
      expect(4 + 2.5 * Math.cos(rad(f.rockerAngle))).toBeCloseTo(f.rockerTip[0], 9)
      expect(2.5 * Math.sin(rad(f.rockerAngle))).toBeCloseTo(f.rockerTip[1], 9)
      const toCrank: Vec2 = [f.crankTip[0] - f.rockerTip[0], f.crankTip[1] - f.rockerTip[1]]
      const toPivot: Vec2 = [4 - f.rockerTip[0], -f.rockerTip[1]]
      const between = deg(Math.acos((toCrank[0] * toPivot[0] + toCrank[1] * toPivot[1]) / (3.5 * 2.5)))
      expect(f.transmissionAngle).toBeCloseTo(between, 9)
    }
  })

  test('the open assembly keeps the rocker above the ground link and moves smoothly; the rocker only rocks', () => {
    let previous = fourBar({ ...links, angle: 0 })
    let least = Infinity
    let most = -Infinity
    for (let angle = 1; angle <= 360; angle++) {
      const f = fourBar({ ...links, angle })
      if (f === null || previous === null) throw new Error('should close')
      expect(f.rockerTip[1]).toBeGreaterThan(0)
      expect(Math.hypot(f.rockerTip[0] - previous.rockerTip[0], f.rockerTip[1] - previous.rockerTip[1])).toBeLessThan(0.05)
      least = Math.min(least, f.rockerAngle)
      most = Math.max(most, f.rockerAngle)
      const mirrored = fourBar({ ...links, angle: -angle, crossed: true })
      expect(mirrored?.rockerTip[0]).toBeCloseTo(f.rockerTip[0], 9) // crossed = the open one mirrored in the ground link
      expect(mirrored?.rockerTip[1]).toBeCloseTo(-f.rockerTip[1], 9)
      previous = f
    }
    // rocker limits from the two dead-centre triangles (crank and coupler in line)
    const limit = (reach: number): number => 180 - deg(Math.acos((16 + 6.25 - reach * reach) / (2 * 4 * 2.5)))
    expect(least).toBeCloseTo(limit(4.5), 2)
    expect(most).toBeCloseTo(limit(2.5), 2)
  })

  test('a parallelogram keeps the rocker parallel to the crank', () => {
    for (let angle = 5; angle < 180; angle += 10) {
      const f = fourBar({ ground: 5, crank: 2, coupler: 5, rocker: 2, angle })
      expect(f?.rockerAngle).toBeCloseTo(angle, 9)
      expect(f?.couplerAngle).toBeCloseTo(0, 9)
    }
  })

  test('returns null when the links cannot reach', () => {
    expect(fourBar({ ground: 10, crank: 1, coupler: 2, rocker: 2, angle: 30 })).toBeNull()
    expect(fourBar({ ground: 1, crank: 1, coupler: 5, rocker: 1, angle: 90 })).toBeNull() // coupler too long
    expect(fourBar({ ground: 4, crank: 3, coupler: 2, rocker: 2, angle: 180 })).toBeNull() // non-Grashof: opens up
    expect(fourBar({ ground: 4, crank: 3, coupler: 2, rocker: 2, angle: 0 })).not.toBeNull()
    expect(fourBar({ ground: Number.NaN, crank: 1, coupler: 2, rocker: 2, angle: 0 })).toBeNull()
    expect(fourBar({ ground: 4, crank: 1, coupler: 0, rocker: 2, angle: 0 })).toBeNull()
  })
})
