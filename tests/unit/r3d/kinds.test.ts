// The shape kinds, repeat and roles of the 3D module: constructors, bounds, anchors, diagnostics. No three.js.
import { describe, expect, test } from 'bun:test'
import { box, cylinder, extrude, lathe, sweep, mesh, repeat, between, sphere, tube, roleOf, roleInfo, meshSource, REPEAT_LIMIT } from '../../../src/r3d/index.ts'
import { build, codes, near } from '../core/helpers.ts'

const square = [[-1, -1], [1, -1], [1, 1], [-1, 1]]

describe('extrude / lathe / sweep / mesh', () => {
  test('bounds, anchors and hull come from the options', () => {
    let e: any, l: any, w: any, m: any
    const model = build(() => {
      e = extrude(square, { depth: 0.5 }).at(0, 2, 0)
      l = lathe([[0, 0], [1, 0], [1, 2], [0, 2]])
      w = sweep([[0, 0, 0], [0, 2, 0], [2, 2, 0]], { radius: 0.2 })
      m = mesh({ positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], indices: [[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2]] })
    })
    expect(codes(model)).toEqual([])
    const f = model.state(0)
    expect(f.localBounds(e)).toEqual({ min: [-1, -1, -0.25], max: [1, 1, 0.25] })
    expect(near(f.anchor(e, 'top'), [0, 3, 0])).toBe(true)
    expect(f.localBounds(l)).toEqual({ min: [-1, 0, -1], max: [1, 2, 1] })
    expect(near(f.anchor(l, 'bottom'), [0, 0, 0])).toBe(true)
    expect(f.localBounds(w)).toEqual({ min: [-0.2, -0.2, -0.2], max: [2.2, 2.2, 0.2] })
    expect(near(f.anchor(w, 'start'), [0, 0, 0])).toBe(true)
    expect(near(f.anchor(w, 'end'), [2, 2, 0])).toBe(true)
    expect(f.localBounds(m)).toEqual({ min: [0, 0, 0], max: [1, 1, 1] })
    expect(f.hull(e).length).toBe(8)
    expect(f.hull(m).length).toBe(4)
    expect(meshSource(m)!.indices!.length).toBe(12)
  })
  test('a dynamic depth follows a param', () => {
    let e: any, d: any
    const model = build((s) => { d = s.param('d', { value: 1, min: 0.2, max: 3 }); e = extrude(square, { depth: d }) })
    expect(model.state(0).localBounds(e).max[2]).toBe(0.5)
    expect(model.state(0, { d: 3 }).localBounds(e).max[2]).toBe(1.5)
  })
  test('mesh accepts flat arrays and a triangle soup', () => {
    let a: any, b: any
    const model = build(() => {
      a = mesh({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], indices: [0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2] })
      b = mesh({ positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] })
    })
    expect(codes(model)).toEqual([])
    expect(meshSource(a)!.positions.length).toBe(12)
    expect(meshSource(b)!.indices).toBeNull()
  })
  test('bad input never throws: a diagnostic with an example, and a part that still takes every method', () => {
    const model = build(() => {
      extrude([[0, 0], [1, 0]], { depth: 1 }).at(1, 0, 0) // too few points
      extrude([[0, 0], [1, 0], [2, 0]], { depth: 1 }) // no area
      extrude(square, { depht: 1 } as any) // a typo
      lathe([[-1, 0], [1, 1]]) // a negative radius
      lathe([[0, 0], [0, 1]]) // nothing to turn
      sweep([[0, 0, 0]], { radius: 0.1 }) // one point
      sweep('up' as any)
      mesh({ positions: [[0, 0, 0], [1, 0, 0]] }) // too few
      mesh({ positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], indices: [[0, 1, 7]] }).color('#58C4DD') // an index out of range
      mesh({ positions: 'cube' as any })
      ;(mesh as any)()
    })
    const list = model.diagnostics.list
    expect(list.length).toBeGreaterThanOrEqual(11)
    expect(list.every((d) => ['API-TYPE', 'API-UNKNOWN', 'NUM-INVALID'].includes(d.code))).toBe(true)
    expect(list.every((d) => d.fix.length > 0)).toBe(true)
    expect(list.some((d) => /index 7 does not name one of the 3 points/.test(d.what))).toBe(true)
    expect(list.some((d) => d.code === 'API-UNKNOWN' && /depht/.test(d.what) && d.fix.join(' ').includes('depth'))).toBe(true)
    expect(list.some((d) => /negative radius/.test(d.what))).toBe(true)
    // every bad part is still a part with finite bounds
    const f = model.state(0)
    for (const n of model.nodes) for (const v of [...f.bounds(n).min, ...f.bounds(n).max]) expect(Number.isFinite(v)).toBe(true)
  })
})

describe('repeat', () => {
  test('makes count copies, each in a slot of its own, and a ring puts them evenly around y', () => {
    let rep: any
    const seen: number[] = []
    const model = build(() => { rep = repeat(4, (i: number) => { seen.push(i); return box({ width: 0.2, height: 0.2, depth: 0.2 }) }).ring({ radius: 2 }) }, 'ring')
    expect(codes(model)).toEqual([])
    expect(seen).toEqual([0, 1, 2, 3])
    expect(rep.children.map((c: any) => c.id)).toEqual(['repeat1.0', 'repeat1.1', 'repeat1.2', 'repeat1.3'])
    const f = model.state(0)
    const at = rep.children.map((c: any) => f.world(c).p)
    expect(near(at[0], [0, 0, 2], 1e-9)).toBe(true)
    expect(near(at[1], [2, 0, 0], 1e-9)).toBe(true)
    expect(near(at[2], [0, 0, -2], 1e-9)).toBe(true)
    expect(near(at[3], [-2, 0, 0], 1e-9)).toBe(true)
    // the copies turn with their angle: the +z face of copy 1 looks along +x
    expect(near(f.anchor(rep.children[1].children[0], 'front'), [2.1, 0, 0], 1e-9)).toBe(true)
    expect(f.bounds(rep).max[0]).toBeCloseTo(2.1)
  })
  test('ring about another axis, a phase that follows a param, and turn: false', () => {
    let rep: any, p: any
    const model = build((s) => {
      p = s.param('p', { value: 0, min: 0, max: 360 })
      rep = repeat(3, () => sphere({ radius: 0.1 })).ring({ radius: 1, axis: 'z', phase: p, turn: false })
    })
    expect(codes(model)).toEqual([])
    expect(near(model.state(0).world(rep.children[0]).p, [1, 0, 0], 1e-9)).toBe(true)
    expect(near(model.state(0, { p: 90 }).world(rep.children[0]).p, [0, 1, 0], 1e-9)).toBe(true)
    expect(model.state(0, { p: 90 }).world(rep.children[0]).q).toEqual([0, 0, 0, 1])
  })
  test('line: a step apart, centred by default', () => {
    let a: any, b: any
    const model = build(() => {
      a = repeat(3, () => box()).line({ step: [0, 2, 0] })
      b = repeat(3, () => box()).line({ step: 1.5, centered: false })
    })
    const f = model.state(0)
    expect(a.children.map((c: any) => f.world(c).p[1])).toEqual([-2, 0, 2])
    expect(b.children.map((c: any) => f.world(c).p[0])).toEqual([0, 1.5, 3])
  })
  test('the index reaches the part: a per-copy phase', () => {
    let rep: any
    const model = build((s) => {
      const spin = s.param('spin', { value: 0, min: 0, max: 360 })
      rep = repeat(3, (i: number) => box().rotate({ about: 'y', deg: () => spin() + i * 30 }))
    })
    const f = model.state(0, { spin: 10 })
    const deg = rep.children.map((c: any) => (2 * Math.atan2(f.world(c.children[0]).q[1], f.world(c.children[0]).q[3]) * 180) / Math.PI)
    expect(near(deg, [10, 40, 70], 1e-9)).toBe(true)
  })
  test('bad input: a count that is no count, a function that returns nothing, a missing radius', () => {
    const model = build(() => {
      repeat(0, () => box())
      repeat(REPEAT_LIMIT + 1, () => box())
      repeat(3, (() => { box() }) as any) // forgot to return
      repeat(3, 'box' as any)
      repeat(2, () => box()).ring({} as any)
      repeat(2, () => box()).ring({ radius: 1, axis: 'q' as any })
      repeat(2, () => box()).line({} as any)
    })
    const list = model.diagnostics.list
    expect(list.filter((d) => d.code === 'NUM-INVALID').length).toBe(2)
    expect(list.some((d) => /return is missing|return the part/.test(d.what + d.fix.join(' ')))).toBe(true)
    expect(list.some((d) => /needs a radius/.test(d.what))).toBe(true)
    expect(list.some((d) => /axis must be/.test(d.what))).toBe(true)
    expect(list.some((d) => /needs a step/.test(d.what))).toBe(true)
    expect(model.nodes.length).toBeLessThan(40) // the absurd count made nothing
  })
})

describe('roles', () => {
  test('worked out from what the scene says: shells are housings, anything that is moved is moving, the rest static', () => {
    const r: Record<string, any> = {}
    build((s) => {
      const turn = s.param('turn', { value: 0, min: 0, max: 360 })
      r.block = box({ shell: true })
      r.glass = tube({ material: 'glass' })
      r.wheel = cylinder().rotate({ about: 'z', deg: turn })
      r.pin = cylinder({ radius: 0.1 }).attach(r.wheel, { to: 'top' })
      r.slider = box().at(() => [0, r.pin.world()[1], 0])
      r.rod = between(r.pin, r.slider, { radius: 0.05 })
      r.base = box().at(0, -2, 0)
      r.tilted = box().rotate({ about: 'x', deg: 30 })
      r.bolt = cylinder({ role: 'fastener' })
      r.gas = cylinder({ role: 'fluid' })
      r.played = box()
      r.ring = repeat(3, () => box()).ring({ radius: 2 })
      r.spinning = repeat(3, () => box()).ring({ radius: 2, phase: turn })
      s.step('go', (st: any) => { st.play(r.played.to.shift(1, 0, 0)) })
    })
    const roles = Object.fromEntries(Object.entries(r).map(([k, n]) => [k, roleOf(n)]))
    expect(roles).toEqual({ block: 'housing', glass: 'housing', wheel: 'moving', pin: 'moving', slider: 'moving', rod: 'moving', base: 'static', tilted: 'static', bolt: 'fastener', gas: 'fluid', played: 'moving', ring: 'static', spinning: 'static' })
    expect(roleOf(r.ring.children[0].children[0])).toBe('static')
    expect(roleOf(r.spinning.children[0].children[0])).toBe('moving')
  })
  test('a role given to a group reaches its parts; the order inside a role counts drawn parts only', () => {
    let a: any, b: any, c: any, g: any
    build(() => {
      a = box()
      g = repeat(2, () => box())
      b = box()
      c = cylinder({ role: 'housing' })
    })
    expect([roleInfo(a).nth, roleInfo(g.children[0].children[0]).nth, roleInfo(g.children[1].children[0]).nth, roleInfo(b).nth, roleInfo(c).nth]).toEqual([0, 1, 2, 3, 0])
  })
  test('an unknown role is a diagnostic with the list', () => {
    const model = build(() => { box({ role: 'case' as any }) })
    expect(codes(model).length).toBe(1)
    expect(model.diagnostics.list[0]!.what + model.diagnostics.list[0]!.fix.join(' ')).toMatch(/housing/)
  })
})
