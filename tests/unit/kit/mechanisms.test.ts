// Mechanisms: the numbers against src/lib/kinematics and the published tables, the placements against the world
// transforms, and every declared invariant at many angles. No DOM, no three.js.
import { describe, expect, test } from 'bun:test'
import { allRules, compile, dist, qrot, scene, type Frame, type MNode, type SceneModel, type Vec3 } from '../../../src/core/index.ts'
import { box, cylinder } from '../../../src/r3d/index.ts'
import { angleOf, belt, camFollower, camShape, crankSlider, fourStroke, gearPair, gearTrain, kit, mechanismsOf, planetary, planeOf, rackPinion, valveLift } from '../../../src/kit/index.ts'
import '../../../src/kit/check.ts'
import { camLift, sliderCrank, valveLift as libValveLift } from '../../../src/lib/kinematics.ts'

const build = (fn: (s: any) => void): SceneModel => compile(scene({ title: 'kit mechanisms' }, fn))
const codes = (m: SceneModel): string[] => m.diagnostics.list.map((d) => d.code)
/** every invariant of every mechanism that does not hold in this frame */
const open = (m: SceneModel, f: Frame): string[] => mechanismsOf(m).flatMap((mech) => mech.invariants.filter((i) => !(i.measure(f) <= i.limit)).map((i) => `${mech.id}: ${i.name} (${i.measure(f)})`))
/** direction of a part's local +x in the world, degrees */
const heading = (f: Frame, n: MNode): number => { const x = qrot(f.world(n).q, [1, 0, 0]); return (Math.atan2(x[1], x[0]) * 180) / Math.PI }
const ANGLES = [0, 15, 37.5, 90, 123, 180, 211, 270, 345, 360, 500, 719]
const near = (a: Vec3, b: Vec3, digits = 9): void => { for (let k = 0; k < 3; k++) expect(a[k]!).toBeCloseTo(b[k]!, digits) }

describe('crankSlider', () => {
  // REF-86: bore = stroke = 86 mm, rod 139 mm (the project research notes), in millimetres
  const engine = (extra: (s: any, parts: { crank: any; rod: any; piston: any }) => void = () => {}) => {
    let cs: any, parts: any
    const m = build((s) => {
      const a = s.param('a', { value: 0, min: 0, max: 720, unit: '°' })
      const crank = kit.crankshaft({ id: 'crank', throw: 43, journal: 55, crankpin: 45, pinLength: 26, webThickness: 18 })
      const rod = kit.conRod({ id: 'rod', length: 139, bigEnd: 46, smallEnd: 22.5, thickness: 22 })
      const piston = kit.piston({ id: 'piston', bore: 86 })
      parts = { crank, rod, piston }
      cs = crankSlider({ crank, rod, slider: piston, angle: a })
      extra(s, parts)
    })
    return { m, cs, ...parts } as { m: SceneModel; cs: any; crank: MNode; rod: MNode; piston: MNode }
  }

  test('the published table: 57.9 % of the stroke at 90°, 18.02° of rod tilt, the stroke is twice the throw', () => {
    const { m, cs } = engine()
    expect(codes(m)).toEqual([])
    const at = (a: number, fn: () => number): number => m.state(0, { a }).run(fn)
    expect(at(0, () => cs.stroke)).toBeCloseTo(86, 10)
    expect(at(0, () => cs.tdc)).toBeCloseTo(182, 10)
    expect(at(0, () => cs.bdc)).toBeCloseTo(96, 10)
    const table: [number, number, number][] = [[0, 0, 0], [15, 1.91, 4.59], [30, 7.43, 8.9], [45, 15.96, 12.64], [60, 26.58, 15.54], [75, 38.22, 17.39], [90, 49.82, 18.02], [105, 60.48, 17.39], [120, 69.58, 15.54], [135, 76.77, 12.64], [150, 81.91, 8.9], [165, 84.98, 4.59], [180, 86, 0]]
    for (const [a, travel, tilt] of table) {
      expect(at(a, cs.travel)).toBeCloseTo(travel, 2)
      expect(Math.abs(at(a, cs.rodAngle))).toBeCloseTo(tilt, 2)
      expect(at(a, cs.angle)).toBeCloseTo(a, 9)
    }
    expect(at(90, cs.fraction)).toBeCloseTo(0.5793, 4)
    expect(Math.round(1000 * at(90, cs.fraction)) / 10).toBe(57.9)
    // and against the library at arbitrary angles, second revolution included
    for (const a of ANGLES) {
      const k = sliderCrank({ throw: 43, rod: 139, angle: a })
      expect(at(a, cs.position)).toBeCloseTo(k.position, 9)
      expect(at(a, cs.fraction)).toBeCloseTo(k.fraction, 9)
    }
    // probes for check and shot
    expect(Object.keys(m.state(0, { a: 90 }).probes())).toEqual(['crankSlider1.position', 'crankSlider1.travel', 'crankSlider1.fraction'])
    expect(m.state(0, { a: 90 }).probes()['crankSlider1.fraction']).toBeCloseTo(0.5793, 4)
  })

  test('the parts are where the numbers say: piston pin on the axis, rod on both pins, crank pin on its circle', () => {
    const { m, crank, rod, piston } = engine()
    for (const a of ANGLES) {
      const f = m.state(0, { a })
      const k = sliderCrank({ throw: 43, rod: 139, angle: a })
      near(f.anchor(piston, 'pin'), [0, k.position, 0])
      // counter-clockwise from the front: after a quarter turn the pin is on the left
      near(f.anchor(crank, 'pin'), [-43 * Math.sin((a * Math.PI) / 180), 43 * Math.cos((a * Math.PI) / 180), 0])
      near(f.anchor(rod, 'bigEnd'), f.anchor(crank, 'pin'))
      near(f.anchor(rod, 'smallEnd'), f.anchor(piston, 'pin'))
      expect(dist(f.anchor(rod, 'bigEnd'), f.anchor(rod, 'smallEnd'))).toBeCloseTo(139, 9)
      // the piston stays upright; the crown is above the pin by the compression height
      expect(f.anchor(piston, 'crown')[1] - f.anchor(piston, 'pin')[1]).toBeCloseTo(0.37 * 86, 9)
      expect(open(m, f)).toEqual([])
    }
    expect(m.state(0, { a: 90 }).anchor(crank, 'pin')[0]).toBeCloseTo(-43, 9)
  })

  test('the mechanism lies in the plane of its crank: move, turn or scale the crank and everything follows', () => {
    let cs: any, crank: MNode, rod: MNode, piston: MNode
    const m = build((s) => {
      const a = s.param('a', { value: 0, min: 0, max: 720, unit: '°' })
      crank = kit.crankshaft({ id: 'crank' }).at(5, 1, -2).rotate({ about: 'y', deg: 90 }).scale(2)
      rod = kit.conRod({ id: 'rod' })
      piston = kit.piston({ id: 'piston' })
      cs = crankSlider({ crank, rod, slider: piston, axis: 'left', angle: a })
    })
    expect(codes(m)).toEqual([])
    for (const a of ANGLES) {
      const f = m.state(0, { a })
      // crank scaled by 2: throw 2; the rod (not scaled) is 3.25. The crank's x axis now points along world −z; 'left' is its −x: world +z
      const k = sliderCrank({ throw: 2, rod: 3.25, angle: a })
      near(f.anchor(piston!, 'pin'), [5, 1, -2 + k.position])
      near(f.anchor(rod!, 'bigEnd'), f.anchor(crank!, 'pin'))
      near(f.anchor(rod!, 'smallEnd'), f.anchor(piston!, 'pin'))
      expect(f.run(cs.position)).toBeCloseTo(k.position, 9)
      // the piston's own "up" (its crown) points along the slide axis
      const up = qrot(f.world(piston!).q, [0, 1, 0])
      near(up, [0, 0, 1])
      expect(open(m, f)).toEqual([])
    }
  })

  test('any part with a pin anchor is a crank; any part is a rod (bottom to top); a rod length alone is enough', () => {
    let wheel: MNode, link: MNode, slider: MNode, cs: any, cs2: any, block: MNode
    const m = build((s) => {
      const a = s.param('a', { value: 0, min: 0, max: 360, unit: '°' })
      wheel = (kit.flywheel({ id: 'wheel', radius: 2 }) as any).define('pin', [1.2, 0, 0.4])
      link = box({ id: 'link', width: 0.3, height: 4, depth: 0.3 })
      slider = box({ id: 'slider', width: 1, height: 1, depth: 1 })
      cs = crankSlider({ crank: wheel, rod: link, slider, axis: 0, angle: a, offset: 0.5 })
      const disc = (kit.pulley({ id: 'disc' }) as any).at(0, -8, 0).define('pin', [0, 0.7, 0])
      block = box({ id: 'block' })
      cs2 = crankSlider({ id: 'yoke', crank: disc, slider: block, rodLength: 2, axis: 'down', angle: a })
    })
    expect(codes(m)).toEqual([])
    for (const a of [0, 40, 90, 200, 300]) {
      const f = m.state(0, { a })
      const k = sliderCrank({ throw: 1.2, rod: 4, angle: a, offset: 0.5 })
      // axis 0 = to the right; the offset moves the slide axis sideways (up); the slider rides in the plane of the pin
      near(f.anchor(slider!, 'center'), [k.position, 0.5, 0.4])
      near(f.anchor(link!, 'bottom'), f.anchor(wheel!, 'pin'))
      near(f.anchor(link!, 'top'), f.anchor(slider!, 'center'))
      expect(f.run(cs.fraction)).toBeCloseTo(k.fraction, 9)
      const k2 = sliderCrank({ throw: 0.7, rod: 2, angle: a })
      near(f.anchor(block!, 'center'), [0, -8 - k2.position, 0])
      expect(f.run(cs2.travel)).toBeCloseTo(k2.tdc - k2.position, 9)
      expect(open(m, f)).toEqual([])
    }
    expect(Object.keys(m.state(0).probes())).toContain('yoke.travel')
  })

  test('a rod shorter than the throw is MECH-OPEN, measured, with the fix', () => {
    const m = build((s) => {
      const a = s.param('a', { value: 0, min: 0, max: 360, unit: '°' })
      crankSlider({ crank: kit.crankshaft({ id: 'crank', throw: 2 }), rod: kit.conRod({ id: 'rod', length: 1.5 }), slider: kit.piston({ id: 'piston' }), angle: a })
    })
    expect(codes(m)).toEqual([]) // nothing at build time: it is a property of the motion
    expect(open(m, m.state(0, { a: 0 }))).toEqual(['crankSlider1: the rod is long enough (0.5)'])
    expect(open(m, m.state(0, { a: 90 })).length).toBe(3) // and now the linkage is really open
    // through the rule, as check runs it
    const reports: any[] = []
    const rule = allRules().find((r) => r.code === 'MECH-OPEN')!
    const frame = m.state(0, { a: 90 })
    rule.run({ model: m, runtime: null, samples: [], sample: null, frame, stateAt: (t: number) => m.state(t), visible: () => [], stage: null, screenRect: () => null, overlayRects: () => [], textBoxes: () => [], idPass: () => null, report: (r: any) => reports.push(r) })
    expect(reports.length).toBe(3)
    expect(reports[0].ids).toEqual(['crank', 'rod', 'piston'])
    expect(reports[0].what).toBe('the rod of crankSlider1 is 0.5 too short to reach round the crank (it must be longer than the throw), so the crank cannot turn all the way.')
    expect(reports[0].fix[0]).toContain('make #rod longer')
    expect(reports[0].measured).toBe(0.5)
    expect(reports[0].line).toBeGreaterThan(0)
    // a sound mechanism reports nothing
    const fine = build((s) => { crankSlider({ crank: kit.crankshaft(), rod: kit.conRod(), slider: kit.piston(), angle: s.param('a', { value: 30, min: 0, max: 360 }) }) })
    const none: any[] = []
    rule.run({ model: fine, runtime: null, samples: [], sample: null, frame: fine.state(0), stateAt: (t: number) => fine.state(t), visible: () => [], stage: null, screenRect: () => null, overlayRects: () => [], textBoxes: () => [], idPass: () => null, report: (r: any) => none.push(r) })
    expect(none).toEqual([])
  })

  test('wrong calls are reported with the fix and never throw; the result is still usable', () => {
    let r1: any, r2: any, r3: any
    const m = build((s) => {
      const a = s.param('a', { value: 0, min: 0, max: 360 })
      r1 = (crankSlider as any)()
      r2 = crankSlider({ crank: cylinder({ id: 'plain' }), slider: box({ id: 'b1' }), rodLength: 2, angle: a })
      r3 = crankSlider({ crank: kit.crankshaft({ id: 'c3' }), slider: box({ id: 'b3' }), angle: a })
      crankSlider({ crank: kit.crankshaft({ id: 'c4' }), rod: kit.conRod({ id: 'r4' }), slider: (kit.piston({ id: 'p4' }) as any).at(0, 3, 0), angle: a, axsi: 'up' } as any)
      crankSlider({ crank: 'c4', slider: box({ id: 'b5' }), rodLength: 3, angle: a })
      crankSlider({ crank: kit.crankshaft({ id: 'c6' }), slider: box({ id: 'b6' }), rodLength: 3, axis: 'upp' })
    })
    const d = m.diagnostics.list
    expect(d.map((x) => x.code)).toEqual(['API-TYPE', 'API-TYPE', 'API-TYPE', 'API-TYPE', 'API-UNKNOWN', 'PLACE-CONFLICT', 'PLACE-CONFLICT', 'API-UNKNOWN'])
    expect(d[0]!.what).toBe('crankSlider() takes one options object.')
    expect(d[1]!.what).toBe('crankSlider() needs crank and slider (parts created earlier in the scene).')
    expect(d[2]!.what).toContain('#plain (cylinder) has no anchor "pin"')
    expect(d[2]!.fix[1]).toContain("plain.define('pin', [0, 1, 0])")
    expect(d[3]!.what).toBe('crankSlider() needs a rod (a part) or rodLength (a number).')
    expect(d[4]!.fix[0]).toContain('axis')
    expect(d[5]!.what).toBe('#p4 already has a placement (at); crankSlider() decides where it goes and replaces it.')
    expect(d[6]!.what).toContain('#c4 is already turned by crankSlider')
    expect(d[7]!.fix[0]).toBe("use 'up'")
    for (const r of [r1, r2, r3]) { expect(r.stroke).toBe(0); expect(r.position()).toBe(0); expect(r.fraction()).toBe(0) }
    for (const a of [0, 100]) expect(m.state(0, { a }).world(m.byId.get('p4')!).p.every(Number.isFinite)).toBe(true)
  })
})

describe('gears', () => {
  test('gearPair: b sits at the meshing distance and the teeth interleave at every phase', () => {
    let a: MNode, b: MNode, pair: any
    const m = build((s) => {
      const t = s.param('t', { value: 0, min: 0, max: 720, unit: '°' })
      a = kit.gear({ id: 'a', teeth: 12, module: 0.3 }).at(1, 2, 3)
      b = kit.gear({ id: 'b', teeth: 30, module: 0.3 })
      pair = gearPair(a, b, { angle: t, direction: 'up' })
    })
    expect(codes(m)).toEqual([])
    const f0 = m.state(0)
    expect(f0.run(() => pair.ratio)).toBe(2.5)
    expect(f0.run(() => pair.distance)).toBeCloseTo(0.3 * 21, 12)
    near(f0.world(b!).p, [1, 2 + 6.3, 3])
    // 8 phases of one tooth of the driver, and a few arbitrary angles
    for (const t of [...Array.from({ length: 8 }, (_, i) => (i * 30) / 8), 77, 200.5, 719]) {
      const f = m.state(0, { t })
      expect(open(m, f)).toEqual([])
      expect(heading(f, a!)).toBeCloseTo(((((t + 180) % 360) + 360) % 360) - 180, 9)
      // b turns the other way, 12/30 as fast
      expect(f.run<number>(pair.driven) - f0.run<number>(pair.driven)).toBeCloseTo((-t * 12) / 30, 9)
      // where they touch (straight above a), a tooth of one faces a gap of the other: phases add up to half a tooth
      const pa = ((90 - heading(f, a!)) * 12) / 360, pb = ((270 - heading(f, b!)) * 30) / 360
      expect(Math.abs(pa + pb - 0.5 - Math.round(pa + pb - 0.5))).toBeLessThan(1e-9)
    }
    expect(Object.keys(f0.probes())).toEqual(['gearPair1.ratio', 'gearPair1.driven'])
  })

  test('gearTrain: ratios multiply, directions alternate, each gear beside the one before', () => {
    let g: MNode[], train: any
    const m = build((s) => {
      const t = s.param('t', { value: 0, min: 0, max: 720, unit: '°' })
      g = [kit.gear({ id: 'g0', teeth: 12 }), kit.gear({ id: 'g1', teeth: 24 }), kit.gear({ id: 'g2', teeth: 36 })]
      train = gearTrain(g, { angle: t, direction: ['right', 'up'] })
    })
    expect(codes(m)).toEqual([])
    const f = m.state(0, { t: 360 })
    expect(f.run(() => train.ratio)).toBe(3)
    expect(train.pairs.map((p: any) => f.run(() => p.ratio))).toEqual([2, 1.5])
    expect(f.run(() => train.turned(0))).toBe(360)
    expect(f.run(() => train.turned(1))).toBeCloseTo(-180, 9)
    expect(f.run(() => train.turned(2))).toBeCloseTo(120, 9)
    near(f.world(g![1]!).p, [0.25 * 18, 0, 0])
    near(f.world(g![2]!).p, [0.25 * 18, 0.25 * 30, 0])
    for (const t of [0, 3.3, 45, 180, 500]) expect(open(m, m.state(0, { t }))).toEqual([])
    expect(mechanismsOf(m).map((x) => x.id)).toEqual(['gearTrain1.1', 'gearTrain1.2'])
  })

  test('a ring gear: the pinion runs inside it, on the side asked for, turning the same way', () => {
    let ring: MNode, pinion: MNode, pair: any, ring2: MNode, pin2: MNode
    const m = build((s) => {
      const t = s.param('t', { value: 0, min: 0, max: 360, unit: '°' })
      ring = kit.gear({ id: 'ring', teeth: 40, internal: true })
      pinion = kit.gear({ id: 'pinion', teeth: 10 })
      pair = gearPair(ring, pinion, { angle: t, direction: 'left' })
      pin2 = kit.gear({ id: 'pin2', teeth: 16 }).at(20, 0, 0)
      ring2 = kit.gear({ id: 'ring2', teeth: 48, internal: true })
      gearPair(pin2, ring2, { angle: t, direction: 60 })
    })
    expect(codes(m)).toEqual([])
    for (const t of [0, 2, 7, 31, 100, 359]) {
      const f = m.state(0, { t })
      expect(open(m, f)).toEqual([])
      near(f.world(pinion!).p, [-0.25 * 15, 0, 0])
      // the ring's centre is on the far side of the pinion from where they touch
      near(f.world(ring2!).p, [20 - 4 * Math.cos(Math.PI / 3), -4 * Math.sin(Math.PI / 3), 0])
    }
    expect(m.state(0, { t: 90 }).run<number>(pair.driven) - m.state(0, { t: 0 }).run<number>(pair.driven)).toBeCloseTo(360, 9)
  })

  test('a gear attached to a turning shaft turns with it: compound trains need no angle', () => {
    let a: MNode, b: MNode, c: MNode, d: MNode
    const m = build((s) => {
      const t = s.param('t', { value: 0, min: 0, max: 720, unit: '°' })
      a = kit.gear({ id: 'a', teeth: 10 })
      b = kit.gear({ id: 'b', teeth: 30 })
      gearPair(a, b, { angle: t })
      c = (kit.gear({ id: 'c', teeth: 10 }) as any).attach(b, { my: 'back', to: 'front' }) // on the same shaft, in front
      d = kit.gear({ id: 'd', teeth: 20 })
      gearPair(c, d, { direction: 'up' })
    })
    expect(codes(m)).toEqual([])
    const turn = (t: number, n: MNode): number => angleOf(n, m.state(0, { t })) - angleOf(n, m.state(0))
    expect(turn(90, c!)).toBeCloseTo(-30, 9)
    expect(turn(90, d!)).toBeCloseTo(15, 9)
    for (const t of [0, 11, 90, 400]) {
      const f = m.state(0, { t })
      expect(open(m, f)).toEqual([])
      near(f.world(d!).p, [0.25 * 20, 0.25 * 15, 0.5]) // above c, in c's plane (one face width in front)
    }
  })

  test('rackPinion: the rack slides angle × pitch radius, tangent to the pinion, on any side', () => {
    let rack: MNode, rp: any, rack2: MNode
    const m = build((s) => {
      const t = s.param('t', { value: 0, min: -180, max: 180, unit: '°' })
      const pinion = kit.gear({ id: 'pinion', teeth: 16, module: 0.25 }).at(0, 5, 0)
      rack = kit.rack({ id: 'rack', teeth: 20, module: 0.25 })
      rp = rackPinion({ rack, pinion, angle: t })
      const p2 = kit.gear({ id: 'p2', teeth: 16, module: 0.25 }).at(10, 5, 0)
      rack2 = kit.rack({ id: 'rack2', teeth: 20, module: 0.25 })
      rackPinion({ rack: rack2, pinion: p2, angle: t, side: 'right' })
    })
    expect(codes(m)).toEqual([])
    const x0 = m.state(0).world(rack!).p[0], y0 = m.state(0).world(rack2!).p[1]
    expect(Math.abs(x0)).toBeLessThanOrEqual((Math.PI * 0.25) / 2 + 1e-12) // centred under the pinion to within half a tooth
    for (const t of [-180, -33, 0, 1.5, 4, 90, 180]) {
      const f = m.state(0, { t })
      expect(open(m, f)).toEqual([])
      const travel = (t * Math.PI / 180) * 2
      expect(f.run(rp.travel)).toBeCloseTo(travel, 12)
      near(f.world(rack!).p, [x0 + travel, 5 - 2, 0]) // pitch line one pitch radius under the pinion; anticlockwise pushes it right
      expect(f.world(rack2!).p[0]).toBeCloseTo(12, 9) // the rack on the right stands upright and moves up
      expect(f.world(rack2!).p[1]).toBeCloseTo(y0 + travel, 9)
    }
    expect(Object.keys(m.state(0).probes())).toEqual(['rackPinion1.travel', 'rackPinion2.travel'])
  })

  test('planetary: the Willis equation for each held member, every mesh phased, bad tooth counts reported', () => {
    const set = (hold: string, planets = 3) => {
      let out: any
      const m = build((s) => {
        const t = s.param('t', { value: 0, min: 0, max: 720, unit: '°' })
        const sun = kit.gear({ id: 'sun', teeth: 12 }), ring = kit.gear({ id: 'ring', teeth: 36, internal: true })
        const ps = Array.from({ length: planets }, (_, i) => kit.gear({ id: 'p' + i, teeth: 12 }))
        const carrier = cylinder({ id: 'carrier', radius: 0.4, height: 0.2 })
        out = { sun, ring, ps, carrier, p: planetary({ sun, planets: ps, ring, carrier, angle: t, hold: hold as any }) }
      })
      return { m, ...out } as { m: SceneModel; sun: MNode; ring: MNode; ps: MNode[]; carrier: MNode; p: any }
    }
    const ringHeld = set('ring')
    expect(codes(ringHeld.m)).toEqual([])
    for (const t of [0, 5, 44, 90, 360, 700]) {
      const f = ringHeld.m.state(0, { t })
      expect(open(ringHeld.m, f)).toEqual([])
      expect(f.run(ringHeld.p.sun)).toBe(t)
      expect(f.run(ringHeld.p.carrier)).toBeCloseTo(t / 4, 9) // sun 12, ring 36: the carrier turns a quarter as fast
      expect(f.run(ringHeld.p.ring)).toBeCloseTo(0, 9)
      // the planets ride on the carrier, 120° apart, at the sum of the pitch radii
      ringHeld.ps.forEach((p, i) => { const a = ((t / 4 + i * 120) * Math.PI) / 180; near(f.world(p).p, [3 * Math.cos(a), 3 * Math.sin(a), 0]) })
      // the ring does not turn, the carrier does
      expect(heading(f, ringHeld.ring)).toBeCloseTo(heading(ringHeld.m.state(0), ringHeld.ring), 9)
      expect(angleOf(ringHeld.carrier, f)).toBeCloseTo(t / 4, 9)
    }
    expect(ringHeld.m.state(0).run(() => ringHeld.p.ratio)).toBe(4)
    const carrierHeld = set('carrier')
    for (const t of [0, 30, 90]) {
      const f = carrierHeld.m.state(0, { t })
      expect(open(carrierHeld.m, f)).toEqual([])
      expect(f.run(carrierHeld.p.ring)).toBeCloseTo(-t / 3, 9) // the ring turns backwards, 12/36 as fast
      near(f.world(carrierHeld.ps[0]!).p, [3, 0, 0])
    }
    const sunHeld = set('sun')
    for (const t of [0, 30, 90]) {
      const f = sunHeld.m.state(0, { t })
      expect(open(sunHeld.m, f)).toEqual([])
      expect(f.run(sunHeld.p.sun)).toBe(0)
      expect(f.run(sunHeld.p.carrier)).toBe(t)
      expect(f.run(sunHeld.p.ring)).toBeCloseTo((t * 48) / 36, 9)
    }
    // five planets do not fit 12 + 36 teeth; a ring of 40 does not fit a sun of 12 with planets of 12
    const five = set('ring', 5)
    expect(codes(five.m)).toEqual(['NUM-INVALID'])
    expect(five.m.diagnostics.list[0]!.what).toContain('5 evenly spaced planets do not fit a sun of 12 and a ring of 36 teeth')
    expect(five.m.diagnostics.list[0]!.fix[0]).toBe('use 2 or 3 or 4 or 6 planets')
    const wrong = build(() => { planetary({ sun: kit.gear({ teeth: 12 }), planets: [kit.gear({ teeth: 12 })], ring: kit.gear({ id: 'big', teeth: 40, internal: true }) }) })
    expect(wrong.diagnostics.list[0]!.what).toContain('the ring #big has 40 teeth, but a sun of 12 with planets of 12 needs a ring of 36')
    const plain = build(() => { planetary({ sun: kit.gear({ teeth: 12 }), planets: [kit.gear({ teeth: 12 })], ring: kit.gear({ id: 'outer', teeth: 36 }) }) })
    expect(plain.diagnostics.list[0]!.fix[0]).toBe('ring: kit.gear({ teeth: 48, internal: true })')
  })

  test('gears that cannot mesh are reported: different modules, a part without teeth, two rings', () => {
    const m = build((s) => {
      const t = s.param('t', { value: 0, min: 0, max: 360 })
      gearPair(kit.gear({ id: 'a', module: 0.25 }), kit.gear({ id: 'b', module: 0.4 }), { angle: t })
      gearPair(kit.gear({ id: 'c' }), cylinder({ id: 'wheel' }) as any)
      gearPair(kit.gear({ id: 'r1', internal: true }), kit.gear({ id: 'r2', internal: true }))
      gearPair(kit.gear({ id: 'e' }), 'nobody' as any)
      gearTrain([kit.gear({ id: 'lonely' })])
    })
    expect(codes(m)).toEqual(['API-TYPE', 'API-TYPE', 'REF-MISSING', 'API-TYPE'])
    expect(m.diagnostics.list[0]!.what).toContain('#wheel (cylinder) is not a gear')
    expect(m.diagnostics.list[1]!.what).toContain('two rings cannot mesh')
    expect(m.diagnostics.list[3]!.what).toBe('gearTrain() needs a list of at least two gears, got 1.')
    const bad = open(m, m.state(0))
    expect(bad.length).toBe(1)
    expect(bad[0]).toContain('gearPair1: a and b have one module')
    const inv = mechanismsOf(m)[0]!.invariants[0]!
    expect(m.state(0).run(() => inv.what(inv.measure(m.state(0))))).toBe('#a has module 0.25 and #b has module 0.4: gears mesh only when their teeth are the same size.')
  })
})

describe('camFollower, belt, valve timing', () => {
  test('camFollower: the follower rides the lobe; its lift is the support of the lobe that is drawn', () => {
    let cam: MNode, valve: MNode, cf: any, shaft: MNode, tappet: MNode, cf2: any
    const m = build((s) => {
      const t = s.param('t', { value: 0, min: 0, max: 360, unit: '°' })
      cam = kit.cam({ id: 'cam', baseRadius: 0.32, lift: 0.18, duration: 120 }).at(0, 4, 0)
      valve = kit.valve({ id: 'valve', head: 0.8, length: 2.4 })
      cf = camFollower({ cam, follower: valve, axis: 'down', angle: t })
      shaft = kit.camshaft({ id: 'shaft', lobes: [{ offset: -1, angle: 0 }, { offset: 1, angle: 135 }] }).at(6, 0, 0)
      tappet = box({ id: 'tappet', width: 0.6, height: 0.3, depth: 0.5 })
      cf2 = camFollower({ cam: shaft, lobe: 2, follower: tappet, axis: 'up', angle: t })
    })
    expect(codes(m)).toEqual([])
    const shape = camShape(0.32, 0.18, 120)
    expect(m.state(0).run(() => cf.maxLift)).toBeCloseTo(0.18, 12)
    for (const t of [0, 10, 30, 59, 60, 61, 90, 180, 300, 359]) {
      const f = m.state(0, { t })
      const lift = camLift({ angle: t, ...shape })
      expect(f.run(cf.lift)).toBeCloseTo(lift, 12)
      expect(f.run(cf.angle)).toBeCloseTo(t, 9)
      // the valve hangs under the cam: its tip is on the lowest point of the lobe
      near(f.anchor(valve!, 'tip'), [0, 4 - 0.32 - lift, 0])
      // the tappet sits on top of lobe 2 of the camshaft (one unit along the shaft)
      near(f.anchor(tappet!, 'bottom'), [6, 0.32 + lift, 1])
      expect(f.run(cf2.lift)).toBeCloseTo(lift, 12)
      expect(open(m, f)).toEqual([])
      // exactly the motion the timing helper gives for the same lobe: closed outside ±60° of cam angle
      expect(lift).toBeCloseTo(libValveLift({ angle: 2 * t, opens: 600, closes: 120, lift: 0.18, profile: 'cam' }), 12)
    }
    expect(m.state(0, { t: 61 }).run(cf.lift)).toBe(0)
    expect(m.state(0).run(cf.lift)).toBeCloseTo(0.18, 12)
    // at angle 0 the nose points down at the valve
    expect(heading(m.state(0), cam!)).toBeCloseTo(-90, 9)
    expect(Object.keys(m.state(0).probes())).toEqual(['camFollower1.lift', 'camFollower2.lift'])
    const wrong = build(() => {
      camFollower({ cam: kit.gear({ id: 'notacam' }), follower: box({ id: 'f1' }) })
      camFollower({ cam: kit.camshaft({ id: 'cs' }), lobe: 5, follower: box({ id: 'f2' }) })
      camFollower({ cam: kit.cam({ id: 'c2' }), follower: box({ id: 'f3' }), contact: 'tpo' })
    })
    expect(codes(wrong)).toEqual(['API-TYPE', 'NUM-INVALID', 'API-UNKNOWN'])
    expect(wrong.diagnostics.list[1]!.what).toBe('camFollower(): lobe 5 does not exist; #cs has 2 lobes.')
    expect(wrong.diagnostics.list[2]!.fix[0]).toContain('use "top"')
  })

  test('belt: the driven wheel turns in the ratio of the radii, the same way round; the belt lies round both', () => {
    let a: MNode, b: MNode, bl: any
    const m = build((s) => {
      const t = s.param('t', { value: 0, min: 0, max: 720, unit: '°' })
      a = kit.pulley({ id: 'a', radius: 1, groove: 0.2 }).at(-3, 0, 0)
      b = kit.pulley({ id: 'b', radius: 2, groove: 0.4 }).at(4, 0, 0)
      bl = belt(a, b, { angle: t })
    })
    expect(codes(m)).toEqual([])
    const f = m.state(0, { t: 90 })
    expect(f.run(() => bl.ratio)).toBeCloseTo(2, 12) // groove floors 0.8 and 1.6
    expect(angleOf(a!, f)).toBe(90)
    expect(angleOf(b!, f)).toBeCloseTo(45, 12)
    expect(heading(f, b!)).toBeCloseTo(45, 9)
    // open belt: 2 d cos(tilt) + π (ra + rb) + 2 tilt (rb − ra)
    const tilt = Math.asin(0.8 / 7)
    expect(f.run(() => bl.length)).toBeCloseTo(2 * 7 * Math.cos(tilt) + Math.PI * 2.4 + 2 * tilt * 0.8, 12)
    expect(bl.part.kind).toBe('belt')
    expect(bl.part.id).toBe('belt1')
    near(f.world(bl.part).p, [-3, 0, 0])
    const box3 = f.bounds(bl.part)
    expect(box3.min[0]).toBeLessThan(-3.8)
    expect(box3.max[0]).toBeGreaterThan(5.6)
    expect(open(m, f)).toEqual([])
    // wheels out of plane, or inside each other: reported by the invariants
    const off = build(() => { belt(kit.pulley({ id: 'a' }), kit.pulley({ id: 'b' }).at(4, 0, 2)); belt(kit.pulley({ id: 'c', radius: 3 }).at(0, 10, 0), kit.pulley({ id: 'd', radius: 1 }).at(0.5, 10, 0)) })
    expect(open(off, off.state(0)).map((x) => x.split(' (')[0])).toEqual(['belt1: the wheels are in one plane', 'belt2: the wheels are apart'])
  })

  test('valveLift and fourStroke: the timing of the project research notes', () => {
    let intake: () => number, exhaust: () => number, stroke: () => { name: string; index: number; progress: number }
    const m = build((s) => {
      const crank = s.param('crank', { value: 0, min: 0, max: 720, unit: '°' })
      intake = valveLift({ angle: crank, opens: 710, closes: 230, lift: 9 })
      exhaust = valveLift({ angle: crank, opens: 490, closes: 10, lift: 9 })
      stroke = fourStroke(crank)
      valveLift({ angle: crank } as any)
    })
    expect(codes(m)).toEqual(['API-TYPE'])
    const at = <T,>(crank: number, fn: () => T): T => m.state(0, { crank }).run(fn)
    expect(at(110, intake!)).toBeCloseTo(9, 12) // the middle of 710 → 230
    expect(at(0, intake!)).toBeGreaterThan(0) // already open at top dead centre (it opened 10° before)
    expect(at(0, exhaust!)).toBeGreaterThan(0) // overlap
    expect(at(230, intake!)).toBe(0)
    expect(at(360, intake!)).toBe(0)
    expect(at(360, exhaust!)).toBe(0) // both closed round the firing
    expect(at(610, exhaust!)).toBeCloseTo(9, 12)
    expect(at(110, intake!)).toBe(libValveLift({ angle: 110, opens: 710, closes: 230, lift: 9 }))
    expect([0, 179, 180, 400, 719].map((c) => at(c, stroke!).name)).toEqual(['intake', 'intake', 'compression', 'power', 'exhaust'])
    expect(at(450, stroke!).progress).toBe(0.5)
  })
})

describe('determinism', () => {
  test('the same time and params give the same state, whatever was evaluated before', () => {
    const m = build((s) => {
      const t = s.param('t', { value: 0, min: 0, max: 720, unit: '°' })
      crankSlider({ crank: kit.crankshaft(), rod: kit.conRod(), slider: kit.piston(), angle: t })
      gearTrain([kit.gear({ teeth: 12 }).at(8, 0, 0), kit.gear({ teeth: 20 }), kit.gear({ teeth: 31 })], { angle: t })
      camFollower({ cam: kit.cam().at(-8, 0, 0), follower: kit.valve(), angle: () => t() / 2 })
      s.step('turn', (st: any) => { st.set(t, 720) })
    })
    expect(codes(m)).toEqual([])
    const times = [0, 0.4, 1.7, 2.9, 1.1]
    const first = times.map((tau) => m.state(tau).signature())
    const again = [...times].reverse().map((tau) => m.state(tau).signature()).reverse()
    expect(again).toEqual(first)
    expect(new Set(first).size).toBe(times.length) // and it really moves
    expect(m.state(1.7, { t: 33 }).signature()).toBe(m.state(1.7, { t: 33 }).signature())
    for (const tau of times) expect(open(m, m.state(tau))).toEqual([])
    // the plane of a turning part does not turn with it
    const crank = m.nodes.find((n) => n.kind === 'crankshaft')!
    planeOf(crank, m.state(1.7)).q.forEach((c, i) => expect(c).toBeCloseTo([0, 0, 0, 1][i]!, 12))
  })
})
