import { describe, expect, test } from 'bun:test'
import { SphereGeometry } from 'three'
import type { Vec3 } from '../../../../src/lib/types.ts'
import {
  type Proxy, closestSurfacePoint, coincident, contained, gap, iou, mat4Compose, mat4FromScale, mateResidual, meshProxy,
  minExtent, nearest, penetration, primitiveProxy, sdfBox, sdfProxy, signedDistance, span, surfaceSamples, touching, unionBounds,
  withWorld, worldBounds,
} from '../../../../src/lib/solids/index.ts'
import { ALL_SHAPES, box, boxMesh, cylinder, dist, fromGeometry, lcg, moved, prim, sphere, tube } from './helpers.ts'

/** An awkward rigid move: results must be the same before and after. */
const AWKWARD = { position: [3.1, -2.2, 0.7] as Vec3, rotation: [23, 141, -67] as Vec3 }

describe('two boxes overlapping by a known depth', () => {
  test('depth is the overlap; point is inside both; symmetric', () => {
    const a = box('a', 2, 2, 2), b = box('b', 2, 2, 2, { position: [1.8, 0, 0] })
    const hit = penetration(a, b)
    expect(hit).not.toBeNull()
    expect(hit!.depth).toBeCloseTo(0.2, 9)
    expect(signedDistance(a, hit!.point)).toBeLessThanOrEqual(1e-9)
    expect(signedDistance(b, hit!.point)).toBeLessThanOrEqual(1e-9)
    expect(hit!.fractionInside).toBeGreaterThan(0.05)
    expect(hit!.fractionInside).toBeLessThan(0.4)
    expect(penetration(b, a)!.depth).toBeCloseTo(0.2, 9)
    expect(gap(a, b)).toBe(0)
  })

  test('overlap in two axes reports the smaller one (the way out)', () => {
    const a = box('a', 2, 2, 2), b = box('b', 2, 2, 2, { position: [1.8, 1.7, 0] })
    expect(penetration(a, b)!.depth).toBeCloseTo(0.2, 6)
  })

  test('a range of depths, also after an awkward rigid move of both parts', () => {
    for (const depth of [0.01, 0.05, 0.3, 0.75]) {
      const pair = [box('a', 2, 4, 3), box('b', 2, 2, 1.9, { position: [2 - depth, 0.3, -0.4] })]
      expect(penetration(pair[0]!, pair[1]!)!.depth).toBeCloseTo(depth, 6)
      const [ma, mb] = moved(pair, AWKWARD)
      expect(penetration(ma!, mb!)!.depth).toBeCloseTo(depth, 6)
    }
  })

  test('face-to-face contact is touching, not penetrating', () => {
    const a = box('a', 2, 2, 2), b = box('b', 2, 2, 2, { position: [2, 0.5, 0] })
    expect(penetration(a, b)).toBeNull()
    expect(gap(a, b)).toBe(0)
    expect(touching(a, b, 1e-6)).toBe(true)
  })

  test('separated boxes: gap is the clearance and nearest gives the facing points', () => {
    const a = box('a', 2, 2, 2), b = box('b', 2, 2, 2, { position: [2.5, 0, 0] })
    expect(penetration(a, b)).toBeNull()
    expect(gap(a, b)).toBeCloseTo(0.5, 9)
    const pair = nearest(a, b)
    expect(pair.distance).toBeCloseTo(0.5, 9)
    expect(pair.pointA[0]).toBeCloseTo(1, 9)
    expect(pair.pointB[0]).toBeCloseTo(1.5, 9)
    expect(dist(pair.pointA, pair.pointB)).toBeCloseTo(0.5, 9)
    expect(touching(a, b, 0.4)).toBe(false)
    expect(touching(a, b, 0.6)).toBe(true)
  })
})

describe('piston inside a hollow tube', () => {
  // liner: outer radius 0.6, wall 0.18 -> bore radius 0.42
  const liner = tube('liner', 0.6, 0.18, 2)

  test('with clearance: no penetration, gap = clearance', () => {
    const piston = cylinder('piston', 0.4, 0.6, { position: [0, 0.3, 0] })
    expect(penetration(piston, liner)).toBeNull()
    expect(gap(piston, liner)).toBeCloseTo(0.02, 6)
    expect(contained(piston, liner)).toBe(false)
  })

  test('oversized piston: penetration by radius - bore', () => {
    const piston = cylinder('piston', 0.5, 0.6, { position: [0, 0.3, 0] })
    const hit = penetration(piston, liner)
    expect(hit).not.toBeNull()
    expect(hit!.depth).toBeCloseTo(0.08, 6)
    expect(Math.hypot(hit!.point[0], hit!.point[2])).toBeGreaterThan(0.41)
    expect(gap(piston, liner)).toBe(0)
  })

  test('exact sliding fit: neither gap nor penetration', () => {
    const piston = cylinder('piston', 0.42, 0.6)
    expect(penetration(piston, liner)).toBeNull()
    expect(gap(piston, liner)).toBe(0)
  })

  test('same answers when the whole assembly is tilted, and at every stroke position', () => {
    for (const y of [-0.7, -0.2, 0, 0.45, 0.7]) {
      const loose = moved([cylinder('piston', 0.4, 0.6, { position: [0, y, 0] }), liner], AWKWARD)
      expect(penetration(loose[0]!, loose[1]!)).toBeNull()
      expect(gap(loose[0]!, loose[1]!)).toBeCloseTo(0.02, 6)
      const tight = moved([cylinder('piston', 0.5, 0.6, { position: [0, y, 0] }), liner], AWKWARD)
      expect(penetration(tight[0]!, tight[1]!)!.depth).toBeCloseTo(0.08, 6)
    }
  })

  test('a piston pushed sideways hits the wall on one side', () => {
    const piston = cylinder('piston', 0.4, 0.6, { position: [0.05, 0, 0] })
    const hit = penetration(piston, liner)
    expect(hit!.depth).toBeCloseTo(0.03, 5)
    expect(hit!.point[0]).toBeGreaterThan(0.4)
  })

  test('a tilted piston jams in the bore', () => {
    const straight = cylinder('piston', 0.4, 0.6)
    const tilted = cylinder('piston', 0.4, 0.6, { rotation: { about: 'z', deg: 12 } })
    expect(penetration(straight, liner)).toBeNull()
    // corner of the tilted piston: radius 0.4 and half height 0.3 turned by 12 degrees
    const reach = 0.4 * Math.cos(12 * Math.PI / 180) + 0.3 * Math.sin(12 * Math.PI / 180)
    expect(penetration(tilted, liner)!.depth).toBeCloseTo(reach - 0.42, 4)
  })
})

describe('a shaft through a bore', () => {
  test('tube as the bearing: clearance, fit, interference', () => {
    const bearing = tube('bearing', 0.5, 0.2, 0.4, { rotation: { about: 'z', deg: 90 } }) // bore radius 0.3, axis along X
    const shaft = (radius: number): Proxy => cylinder('shaft', radius, 3, { rotation: { about: 'z', deg: 90 } })
    expect(penetration(shaft(0.25), bearing)).toBeNull()
    expect(gap(shaft(0.25), bearing)).toBeCloseTo(0.05, 6)
    expect(penetration(shaft(0.3), bearing)).toBeNull()
    expect(gap(shaft(0.3), bearing)).toBe(0)
    expect(penetration(shaft(0.36), bearing)!.depth).toBeCloseTo(0.06, 6)
  })

  test('a block with a drilled hole (custom sdf), tilted in space', () => {
    const drilled = (p: Vec3): number => Math.max(sdfBox(p, 2, 2, 2), 0.3 - Math.hypot(p[0], p[2]))
    const world = mat4Compose({ position: [1, 2, 3], rotation: [25, 50, 75] })
    const block = sdfProxy('block', drilled, { min: [-1, -1, -1], max: [1, 1, 1] }, world)
    const shaft = (radius: number): Proxy => primitiveProxy('shaft', { kind: 'cylinder', radius, height: 4 }, world)
    expect(penetration(shaft(0.25), block)).toBeNull()
    expect(gap(shaft(0.25), block)).toBeCloseTo(0.05, 5)
    expect(penetration(shaft(0.36), block)!.depth).toBeCloseTo(0.06, 5)
  })

  test('a shaft through a block with NO hole is caught, however thin the parts', () => {
    // deepest point of the shaft surface inside the 2x2x2 block: on the diagonal, 1 - r/sqrt(2) from the faces
    const solid = penetration(cylinder('shaft', 0.2, 4), box('block', 2, 2, 2))
    expect(solid!.depth).toBeCloseTo(1 - 0.2 * Math.SQRT1_2, 3)
    // a 0.05 pin through a 0.1 plate: hardly any sample of either lies inside the other
    const plate = box('plate', 10, 0.1, 10)
    for (const x of [0, 1.234, -3.3, 4.9]) {
      const pin = cylinder('pin', 0.05, 10, { position: [x, 0.7, x / 2] })
      expect(penetration(pin, plate)!.depth).toBeCloseTo(0.05, 6)
    }
  })

  test('two thin rods crossing: overlap when the axes are closer than two radii, gap otherwise', () => {
    const a = cylinder('a', 0.05, 8, { rotation: { about: 'z', deg: 30 } })
    const crossing = cylinder('b', 0.05, 8, { rotation: { about: 'z', deg: -40 }, position: [0.3, 0.2, 0.06] })
    const passing = cylinder('b', 0.05, 8, { rotation: { about: 'z', deg: -40 }, position: [0.3, 0.2, 0.16] })
    expect(penetration(a, crossing)!.depth).toBeCloseTo(0.04, 4)
    expect(penetration(a, passing)).toBeNull()
    expect(gap(a, passing)).toBeCloseTo(0.06, 6)
  })
})

describe('a sphere resting on a box', () => {
  const ground = box('ground', 4, 1, 4, { position: [0, -0.5, 0] })
  const ball = (y: number): Proxy => sphere('ball', 1, { position: [0.3, y, -0.2] })

  test('resting: touching, not penetrating', () => {
    expect(penetration(ball(1), ground)).toBeNull()
    expect(gap(ball(1), ground)).toBe(0)
    expect(Math.abs(nearest(ball(1), ground).distance)).toBeLessThan(1e-9)
    expect(touching(ball(1), ground, 1e-6)).toBe(true)
  })

  test('sunk in by 0.1: penetration 0.1 at the bottom of the ball', () => {
    const hit = penetration(ball(0.9), ground)!
    expect(hit.depth).toBeCloseTo(0.1, 6)
    expect(hit.point[0]).toBeCloseTo(0.3, 3)
    expect(hit.point[2]).toBeCloseTo(-0.2, 3)
  })

  test('hovering 0.3 above: gap 0.3, straight down', () => {
    expect(penetration(ball(1.3), ground)).toBeNull()
    expect(gap(ball(1.3), ground)).toBeCloseTo(0.3, 6)
    const pair = nearest(ball(1.3), ground)
    expect(pair.pointA[1]).toBeCloseTo(0.3, 6)
    expect(pair.pointB[1]).toBeCloseTo(0, 6)
    expect(pair.pointA[0]).toBeCloseTo(0.3, 3)
  })

  test('a tessellated sphere mesh behaves like the analytic one (within its facet error)', () => {
    const mesh = fromGeometry(new SphereGeometry(1, 48, 32))
    const meshBall = (y: number): Proxy => meshProxy('ball', mesh, mat4Compose({ position: [0.3, y, -0.2] }))
    expect(meshBall(1).hollow).toBe(false)
    expect(penetration(meshBall(1.001), ground)).toBeNull()
    expect(gap(meshBall(1.3), ground)).toBeCloseTo(0.3, 2)
    expect(penetration(meshBall(0.9), ground)!.depth).toBeCloseTo(0.1, 2)
  })
})

describe('rotated cases', () => {
  const ground = box('ground', 6, 1, 6, { position: [0, -0.5, 0] })

  test('a cube balanced on its edge', () => {
    const onEdge = (y: number): Proxy => box('cube', 1, 1, 1, { position: [0, y, 0], rotation: { about: 'z', deg: 45 } })
    expect(gap(onEdge(Math.SQRT1_2), ground)).toBe(0)
    expect(penetration(onEdge(Math.SQRT1_2), ground)).toBeNull()
    expect(gap(onEdge(Math.SQRT1_2 + 0.25), ground)).toBeCloseTo(0.25, 6)
    expect(penetration(onEdge(Math.SQRT1_2 - 0.1), ground)!.depth).toBeCloseTo(0.1, 6)
  })

  test('a cube balanced on its corner', () => {
    // rotate so the body diagonal is vertical: corner height = sqrt(3)/2
    const tip = Math.sqrt(3) / 2
    const onCorner = (y: number): Proxy => box('cube', 1, 1, 1, { position: [0, y, 0], rotation: { about: [1, 0, -1], deg: Math.atan(Math.SQRT2) * 180 / Math.PI } })
    expect(Math.abs(nearest(onCorner(tip), ground).distance)).toBeLessThan(1e-6)
    expect(gap(onCorner(tip + 0.2), ground)).toBeCloseTo(0.2, 5)
    expect(penetration(onCorner(tip - 0.15), ground)!.depth).toBeCloseTo(0.15, 5)
  })

  test('a cylinder lying on its side, a cone standing on its tip, a torus lying flat and tilted', () => {
    const lying = cylinder('c', 0.5, 2, { rotation: { about: 'z', deg: 90 }, position: [0, 0.5, 0] })
    expect(Math.abs(nearest(lying, ground).distance)).toBeLessThan(1e-9)
    const tipDown = prim('k', { kind: 'cone', radius: 0.5, height: 1 }, { rotation: { about: 'x', deg: 180 }, position: [0.2, 0.5, 0.1] })
    expect(Math.abs(nearest(tipDown, ground).distance)).toBeLessThan(1e-9)
    const flat = prim('t', { kind: 'torus', radius: 1, tube: 0.25 }, { position: [0, 0.25, 0] })
    expect(Math.abs(nearest(flat, ground).distance)).toBeLessThan(1e-9)
    // tilted 30 degrees: lowest point is sin(30) * R + r below the centre
    const tilted = (y: number): Proxy => prim('t', { kind: 'torus', radius: 1, tube: 0.25 }, { position: [0, y, 0], rotation: { about: 'x', deg: 30 } })
    expect(Math.abs(nearest(tilted(0.75), ground).distance)).toBeLessThan(1e-4)
    expect(gap(tilted(1), ground)).toBeCloseTo(0.25, 4)
    expect(penetration(tilted(0.6), ground)!.depth).toBeCloseTo(0.15, 4)
  })

  test('curved against curved: two spheres, capsule and sphere', () => {
    expect(nearest(sphere('a', 1), sphere('b', 0.5, { position: [1, 1, 1] })).distance).toBeCloseTo(Math.sqrt(3) - 1.5, 6)
    expect(penetration(sphere('a', 1), sphere('b', 0.5, { position: [0.8, 0.8, 0.8] }))!.depth).toBeCloseTo(1.5 - 0.8 * Math.sqrt(3), 6)
    expect(nearest(prim('a', { kind: 'capsule', radius: 0.3, height: 2 }), sphere('b', 0.5, { position: [1, 0.2, 0] })).distance).toBeCloseTo(0.2, 6)
  })

  test('uniform scale scales distances', () => {
    const a = box('a', 1, 1, 1, { scale: 2 }), b = box('b', 1, 1, 1, { position: [2.5, 0, 0], scale: 2 })
    expect(gap(a, b)).toBeCloseTo(0.5, 9)
    expect(penetration(a, box('b', 1, 1, 1, { position: [1.9, 0, 0], scale: 2 }))!.depth).toBeCloseTo(0.1, 9)
  })

  test('non-uniform scale: an ellipsoid against walls on each axis', () => {
    const ellipsoid = primitiveProxy('e', { kind: 'sphere', radius: 1 }, mat4FromScale([2, 1, 0.5]))
    expect(gap(ellipsoid, box('x', 1, 4, 4, { position: [2.8, 0, 0] }))).toBeCloseTo(0.3, 5)
    expect(gap(ellipsoid, box('y', 4, 1, 4, { position: [0, 1.75, 0] }))).toBeCloseTo(0.25, 5)
    expect(gap(ellipsoid, box('z', 4, 4, 1, { position: [0.3, 0.2, 1.1] }))).toBeGreaterThan(0.1 - 1e-6)
    expect(penetration(ellipsoid, box('x', 1, 4, 4, { position: [2.4, 0, 0] }))!.depth).toBeCloseTo(0.1, 4)
  })

  test('non-uniform scale: signedDistance is within 3% of a brute-force distance', () => {
    const ellipsoid = primitiveProxy('e', { kind: 'sphere', radius: 1 }, mat4Compose({ scale: [2, 1, 0.5], rotation: [20, 30, 40], position: [0.1, 0.2, 0.3] }))
    const surface = surfaceSamples(ellipsoid, 60000, 3)
    const random = lcg(31)
    for (let i = 0; i < 40; i++) {
      const p: Vec3 = [random() * 6 - 3, random() * 6 - 3, random() * 6 - 3]
      let best = Infinity
      for (const s of surface) best = Math.min(best, (s[0] - p[0]) ** 2 + (s[1] - p[1]) ** 2 + (s[2] - p[2]) ** 2)
      const brute = Math.sqrt(best)
      expect(Math.abs(Math.abs(signedDistance(ellipsoid, p)) - brute)).toBeLessThan(0.03 * brute + 0.02)
    }
  })
})

describe('against brute force', () => {
  test('random primitive pairs: gaps match a dense search over both surfaces; overlaps are always found', () => {
    const random = lcg(41)
    let separated = 0, overlapping = 0, shallow = 0
    for (let trial = 0; trial < 120; trial++) {
      const shapeA = ALL_SHAPES[Math.floor(random() * ALL_SHAPES.length)]!, shapeB = ALL_SHAPES[Math.floor(random() * ALL_SHAPES.length)]!
      const a = prim('a', shapeA, { rotation: [random() * 360, random() * 360, random() * 360] })
      const reachOut = 0.4 + random() * 2.6
      const direction: Vec3 = [random() - 0.5, random() - 0.5, random() - 0.5]
      const length = Math.hypot(...direction)
      const b = prim('b', shapeB, {
        position: [direction[0] / length * reachOut, direction[1] / length * reachOut, direction[2] / length * reachOut],
        rotation: [random() * 360, random() * 360, random() * 360],
      })
      // brute force: min signed distance of each dense surface sampling (~0.04 apart) against the other solid
      let brute = Infinity
      for (const s of surfaceSamples(a, 6000, 5)) brute = Math.min(brute, signedDistance(b, s))
      for (const s of surfaceSamples(b, 6000, 5)) brute = Math.min(brute, signedDistance(a, s))
      const found = nearest(a, b).distance
      // the refined answer can beat the dense search by at most its sample spacing
      expect(found).toBeGreaterThan(brute - 0.04)
      if (brute > 0.01) {
        // separated: never worse than the dense search
        separated++
        expect(found).toBeLessThan(brute + 1e-3)
        expect(penetration(a, b)).toBeNull()
        expect(gap(a, b)).toBeCloseTo(found, 9)
      } else if (brute < -0.01) {
        // overlapping: always detected. The depth is a local search over a kinked field, so deep overlaps may be
        // under-reported (measured: ~1% of pairs, by up to ~15%); shallow ones, the ones near the limit, may not.
        overlapping++
        const hit = penetration(a, b)
        expect(hit).not.toBeNull()
        expect(hit!.depth).toBeCloseTo(-found, 9)
        expect(hit!.depth).toBeGreaterThan(0.8 * -brute)
        if (brute > -0.1) { shallow++; expect(hit!.depth).toBeGreaterThan(-brute - 2e-3) }
        expect(gap(a, b)).toBe(0)
      }
    }
    expect(separated).toBeGreaterThan(30)
    expect(overlapping).toBeGreaterThan(30)
    expect(shallow).toBeGreaterThan(5)
  })
})

describe('contained', () => {
  test('a solid fully inside another is contained; the reverse is not', () => {
    const outer = sphere('outer', 1), inner = box('inner', 0.5, 0.5, 0.5, { position: [0.2, -0.1, 0.3], rotation: [10, 20, 30] })
    expect(contained(inner, outer)).toBe(true)
    expect(contained(outer, inner)).toBe(false)
    const hit = penetration(inner, outer)!
    expect(hit.fractionInside).toBe(1)
    expect(hit.fractionInsideOther).toBe(0)
    const [a, b] = moved([inner, outer], AWKWARD)
    expect(contained(a!, b!)).toBe(true)
  })

  test('poking out, flush with the surface, or merely overlapping is not contained', () => {
    const outer = box('outer', 2, 2, 2)
    expect(contained(box('poke', 0.5, 0.5, 0.5, { position: [0.9, 0, 0] }), outer)).toBe(false)
    expect(contained(box('flush', 0.5, 0.5, 0.5, { position: [0.75, 0, 0] }), outer)).toBe(false)
    expect(contained(box('inside', 0.5, 0.5, 0.5, { position: [0.74, 0, 0] }), outer)).toBe(true)
    expect(contained(box('far', 0.5, 0.5, 0.5, { position: [5, 0, 0] }), outer)).toBe(false)
  })

  test('a small corner poking out between the samples is still caught', () => {
    // a long thin needle inside a slab, tilted so only its very tip leaves the slab
    const slab = box('slab', 10, 1, 10)
    const inside = box('needle', 6, 0.02, 0.02, { rotation: { about: 'z', deg: 9 } })
    const poking = box('needle', 6, 0.02, 0.02, { rotation: { about: 'z', deg: 10 } })
    expect(3 * Math.sin(9 * Math.PI / 180)).toBeLessThan(0.48)
    expect(3 * Math.sin(10 * Math.PI / 180)).toBeGreaterThan(0.5)
    expect(contained(inside, slab)).toBe(true)
    expect(contained(poking, slab)).toBe(false)
  })

  test('the empty bore of a tube and the inside of a hollow shell contain nothing', () => {
    const piston = cylinder('piston', 0.3, 0.5)
    expect(contained(piston, tube('liner', 0.6, 0.18, 2))).toBe(false)
    expect(contained(piston, cylinder('solid', 0.6, 2))).toBe(true)
    const solidHousing = box('housing', 3, 3, 3), shellHousing = primitiveProxy('housing', { kind: 'box', width: 3, height: 3, depth: 3 }, mat4Compose(), { hollow: true })
    expect(contained(piston, solidHousing)).toBe(true)
    expect(contained(piston, shellHousing)).toBe(false)
  })
})

describe('hollow shells', () => {
  const ball = sphere('ball', 0.5)

  test('a part floating inside a thin shell neither penetrates nor touches it', () => {
    const shell = primitiveProxy('shell', { kind: 'sphere', radius: 2 }, mat4Compose(), { hollow: true })
    expect(penetration(ball, shell)).toBeNull()
    expect(gap(ball, shell)).toBeCloseTo(1.5, 6)
    expect(touching(ball, shell, 0.1)).toBe(false)
    expect(signedDistance(shell, [0, 0, 0])).toBeCloseTo(2, 12)
    // resting against the inside of the shell
    expect(gap(withWorld(ball, mat4Compose({ position: [0, -1.5, 0] })), shell)).toBe(0)
  })

  test('a shell with a wall thickness is solid only within its wall', () => {
    const shell = primitiveProxy('shell', { kind: 'sphere', radius: 2 }, mat4Compose(), { hollow: true, wall: 0.2 })
    expect(signedDistance(shell, [1.9, 0, 0])).toBeCloseTo(-0.1, 12)
    expect(signedDistance(shell, [1.5, 0, 0])).toBeCloseTo(0.3, 12)
    expect(signedDistance(shell, [2.5, 0, 0])).toBeCloseTo(0.5, 12)
    expect(gap(withWorld(ball, mat4Compose({ position: [1.2, 0, 0] })), shell)).toBeCloseTo(0.1, 5)
    expect(penetration(withWorld(ball, mat4Compose({ position: [1.4, 0, 0] })), shell)!.depth).toBeCloseTo(0.1, 3)
  })
})

describe('coincident (IoU)', () => {
  test('the same solid in the same place is 1, wherever it is', () => {
    for (const shape of ALL_SHAPES) {
      const a = prim('a', shape, AWKWARD), b = prim('b', { ...shape }, AWKWARD)
      expect(iou(a, b)).toBe(1)
      expect(coincident(a, b)).toBe(true)
    }
  })

  test('known overlaps', () => {
    const a = box('a', 2, 2, 2)
    expect(iou(a, box('b', 2, 2, 2, { position: [1, 0, 0] }))).toBeCloseTo(1 / 3, 2)
    expect(iou(a, box('b', 2, 2, 2, { position: [0.05, 0, 0] }))).toBeCloseTo(1.95 / 2.05, 2)
    expect(iou(a, sphere('s', 1))).toBeCloseTo(Math.PI / 6, 1)
    expect(iou(a, box('b', 2, 2, 2, { position: [2.5, 0, 0] }))).toBe(0)
    expect(iou(a, box('b', 2, 2, 2, { position: [2, 0, 0] }))).toBeLessThan(0.01)
    // same box described two ways: turned a quarter turn with swapped sizes
    expect(iou(box('a', 1, 2, 3), box('b', 2, 1, 3, { rotation: { about: 'z', deg: 90 } }))).toBe(1)
  })

  test('the COINCIDENT threshold: nearly identical is flagged, a clear offset is not', () => {
    const valve = cylinder('valve-1', 0.2, 1.5, AWKWARD)
    expect(coincident(valve, cylinder('valve-2', 0.2, 1.5, AWKWARD))).toBe(true)
    expect(coincident(valve, cylinder('valve-2', 0.2, 1.5, { ...AWKWARD, position: [3.1, -2.2, 0.705] }))).toBe(true)
    expect(coincident(valve, cylinder('valve-2', 0.2, 1.5, { ...AWKWARD, position: [3.3, -2.2, 0.7] }))).toBe(false)
    expect(coincident(valve, cylinder('valve-2', 0.3, 1.5, AWKWARD))).toBe(false)
    expect(coincident(valve, cylinder('valve-2', 0.3, 1.5, AWKWARD), 0.4)).toBe(true)
  })

  test('a mesh and the primitive it tessellates coincide', () => {
    const world = mat4Compose(AWKWARD)
    expect(iou(meshProxy('m', boxMesh(1, 2, 3), world), primitiveProxy('p', { kind: 'box', width: 1, height: 2, depth: 3 }, world))).toBe(1)
    expect(iou(meshProxy('m', fromGeometry(new SphereGeometry(1, 32, 24)), world), primitiveProxy('p', { kind: 'sphere', radius: 1 }, world))).toBeGreaterThan(0.95)
  })
})

describe('mesh proxies', () => {
  test('a box mesh gives the same depths and gaps as the box primitive', () => {
    const meshBox = (id: string, w: number, h: number, d: number, parts = {}): Proxy => meshProxy(id, boxMesh(w, h, d), mat4Compose(parts))
    expect(penetration(meshBox('a', 2, 2, 2), meshBox('b', 2, 2, 2, { position: [1.8, 0, 0] }))!.depth).toBeCloseTo(0.2, 6)
    expect(penetration(meshBox('a', 2, 2, 2), box('b', 2, 2, 2, { position: [1.8, 0.3, 0.2], rotation: [0, 0, 0] }))!.depth).toBeCloseTo(0.2, 6)
    expect(gap(meshBox('a', 2, 2, 2), meshBox('b', 2, 2, 2, { position: [2.5, 0, 0] }))).toBeCloseTo(0.5, 6)
    expect(gap(meshBox('a', 2, 2, 2), meshBox('b', 2, 2, 2, { position: [2, 0, 0] }))).toBe(0)
    expect(contained(meshBox('in', 0.5, 0.5, 0.5), meshBox('out', 2, 2, 2))).toBe(true)
    const onEdge = meshBox('cube', 1, 1, 1, { position: [0, Math.SQRT1_2 + 0.25, 0], rotation: { about: 'z', deg: 45 } })
    expect(gap(onEdge, box('ground', 6, 1, 6, { position: [0, -0.5, 0] }))).toBeCloseTo(0.25, 5)
  })
})

describe('bounds, span and helpers', () => {
  test('worldBounds follows the matrix; span is the diagonal of the union', () => {
    const a = box('a', 2, 4, 6, { position: [10, 0, 0], rotation: { about: 'z', deg: 90 } })
    const bounds = worldBounds(a)
    expect(bounds.min.map(v => +v.toFixed(12))).toEqual([8, -1, -3])
    expect(bounds.max.map(v => +v.toFixed(12))).toEqual([12, 1, 3])
    expect(minExtent(a)).toBeCloseTo(2, 12)
    const b = box('b', 2, 2, 2, { position: [-10, 0, 0] })
    expect(unionBounds([a, b])).toEqual({ min: [-11, -1, -3], max: [12, 1, 3] })
    expect(span([a, b])).toBeCloseTo(Math.hypot(23, 2, 6), 12)
    expect(span([])).toBe(0)
    expect(unionBounds([])).toEqual({ min: [0, 0, 0], max: [0, 0, 0] })
  })

  test('signedDistance and closestSurfacePoint in world space', () => {
    const a = sphere('a', 1, { position: [5, 0, 0], scale: 2 })
    expect(signedDistance(a, [5, 0, 0])).toBeCloseTo(-2, 12)
    expect(signedDistance(a, [10, 0, 0])).toBeCloseTo(3, 12)
    const closest = closestSurfacePoint(a, [10, 0, 0])
    expect(closest[0]).toBeCloseTo(7, 9)
    expect(closest[1]).toBeCloseTo(0, 9)
  })

  test('mateResidual is the world distance between two local anchors (MECH-OPEN)', () => {
    const crank = mat4Compose({ rotation: { about: 'z', deg: 90 } }), rod = mat4Compose({ position: [0, 1, 0] })
    // crank pin at local [1, 0, 0] turns to world [0, 1, 0]; rod big end at local origin sits at world [0, 1, 0]
    expect(mateResidual(crank, [1, 0, 0], rod, [0, 0, 0])).toBeCloseTo(0, 12)
    expect(mateResidual(crank, [1, 0, 0], mat4Compose({ position: [0, 1.6, 0] }), [0, 0, 0])).toBeCloseTo(0.6, 12)
  })
})

describe('determinism, caching and bad input', () => {
  test('repeating a query gives the identical result; options change the sampling, not the answer', () => {
    const a = prim('a', ALL_SHAPES[5]!, { rotation: [10, 20, 30] }), b = prim('b', ALL_SHAPES[3]!, { position: [0.9, 0.4, 0.2], rotation: [50, 60, 70] })
    const first = penetration(a, b)
    expect(first).not.toBeNull()
    expect(penetration(a, b)).toEqual(first)
    const rebuilt = penetration(prim('a', { ...ALL_SHAPES[5]! }, { rotation: [10, 20, 30] }), prim('b', { ...ALL_SHAPES[3]! }, { position: [0.9, 0.4, 0.2], rotation: [50, 60, 70] }))
    expect(rebuilt).toEqual(first)
    // a shallow, well-conditioned overlap: sample count and seed do not move the answer
    const ball = sphere('ball', 1, { position: [0.3, 0.9, -0.2] }), ground = box('ground', 4, 1, 4, { position: [0, -0.5, 0] })
    for (const options of [{ samples: 16 }, { samples: 256, seed: 9 }, { samples: 1000, seed: 77 }]) expect(penetration(ball, ground, options)!.depth).toBeCloseTo(0.1, 6)
  })

  test('moving a proxy in place (mutating its matrix) is picked up', () => {
    const a = box('a', 2, 2, 2), b = box('b', 2, 2, 2, { position: [2.5, 0, 0] })
    expect(gap(a, b)).toBeCloseTo(0.5, 9)
    b.world[12] = 3
    expect(gap(a, b)).toBeCloseTo(1, 9)
    b.world[12] = 1.5
    expect(penetration(a, b)!.depth).toBeCloseTo(0.5, 9)
  })

  test('tolerance decides what counts as touching', () => {
    const a = box('a', 2, 2, 2), b = box('b', 2, 2, 2, { position: [2.01, 0, 0] })
    expect(gap(a, b)).toBeCloseTo(0.01, 9)
    expect(gap(a, b, { tolerance: 0.02 })).toBe(0)
    const c = box('c', 2, 2, 2, { position: [1.99, 0, 0] })
    expect(penetration(a, c)!.depth).toBeCloseTo(0.01, 9)
    expect(penetration(a, c, { tolerance: 0.02 })).toBeNull()
  })

  test('NaN, infinite or collapsed transforms never throw and never report contact', () => {
    const good = box('good', 2, 2, 2)
    const broken: Proxy[] = [
      box('nan', 2, 2, 2, { position: [Number.NaN, 0, 0] }),
      box('inf', 2, 2, 2, { position: [Infinity, 0, 0] }),
      box('flat', 2, 2, 2, { scale: [1, 0, 1] }),
      box('zero', 2, 2, 2, { scale: 0 }),
      primitiveProxy('nan-size', { kind: 'sphere', radius: Number.NaN }),
      { id: 'short-matrix', localBounds: { min: [-1, -1, -1], max: [1, 1, 1] }, world: [1, 0, 0] },
    ]
    for (const bad of broken) {
      expect(penetration(good, bad)).toBeNull()
      expect(penetration(bad, good)).toBeNull()
      expect(gap(good, bad)).toBe(Infinity)
      expect(contained(bad, good)).toBe(false)
      expect(contained(good, bad)).toBe(false)
      expect(iou(good, bad)).toBe(0)
      expect(touching(good, bad, 1)).toBe(false)
      expect(nearest(bad, good).distance).toBe(Infinity)
    }
  })
})
