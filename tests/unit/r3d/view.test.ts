// View modes of the 3D module as pure functions of the frame state: ghost, cutaway, explode, s.look. No three.js.
import { describe, expect, test } from 'bun:test'
import { box, cylinder, sphere, between, repeat, explodeOffset, explodeShare, lookOverrides, VIEW_DEFAULTS, VIEW_PACE } from '../../../src/r3d/index.ts'
import { group } from '../../../src/r2d/index.ts'
import { build, codes, near } from '../core/helpers.ts'

/** a housing, a mechanism part inside it, a static bracket, a bolt, a fluid */
function pump(steps: (s: any, p: Record<string, any>) => void, before?: (s: any, p: Record<string, any>) => void) {
  const p: Record<string, any> = {}
  const model = build((s) => {
    const turn = s.param('turn', { value: 0, min: 0, max: 360 })
    p.block = box({ id: 'block', width: 4, height: 4, depth: 4, shell: true })
    p.piston = cylinder({ id: 'piston', radius: 1, height: 1 }).rotate({ about: 'y', deg: turn })
    p.bracket = box({ id: 'bracket', width: 1, height: 1, depth: 1 }).at(4, 0, 0)
    p.bolt = cylinder({ id: 'bolt', radius: 0.2, height: 0.4, role: 'fastener' }).at(0, 2.2, 0)
    p.gas = cylinder({ id: 'gas', radius: 1, height: 1, role: 'fluid' }).at(0, 1, 0)
    before?.(s, p)
    steps(s, p)
  })
  return { model, p }
}

describe('ghost', () => {
  test('st.ghost(true) turns housings and fasteners into shells, and nothing else', () => {
    const { model, p } = pump((s) => { s.step('a', (st: any) => { st.ghost(true) }); s.step('b', (st: any) => { st.ghost(false) }) })
    expect(codes(model)).toEqual([])
    const end = model.state(model.steps[0]!.t1)
    expect(end.look(p.block).ghost).toBe(1)
    expect(end.look(p.bolt).ghost).toBe(1)
    expect(end.look(p.piston).ghost).toBeUndefined()
    expect(end.look(p.bracket).ghost).toBeUndefined()
    expect(end.look(p.gas).ghost).toBeUndefined()
    expect(end.look(p.block).shell).toBe(true)
    // it tweens: half way through the play the amount is in between, and it takes the default second
    const mid = model.state(VIEW_PACE.ghost / 2).look(p.block).ghost!
    expect(mid).toBeGreaterThan(0.3)
    expect(mid).toBeLessThan(0.7)
    expect(model.state(0).look(p.block).ghost).toBeUndefined()
    // and back
    const back = model.state(model.steps[1]!.t0 + VIEW_PACE.ghost / 2).look(p.block).ghost!
    expect(back).toBeGreaterThan(0.3)
    expect(back).toBeLessThan(0.7)
    expect(model.state(model.duration).look(p.block).ghost).toBeUndefined()
    expect(model.state(model.duration).look(p.block).shell).toBe(true) // it is still a housing by its own option
  })
  test('a list names exactly those parts (ids work too), and their parts inside a group', () => {
    let g: any, inner: any
    const { model, p } = pump((s, q) => { s.step('a', (st: any) => { st.ghost([q.piston, 'bracket', g]) }) }, () => { inner = sphere({ id: 'inner' }).at(0, 6, 0); g = group([inner]) })
    expect(codes(model)).toEqual([])
    const f = model.state(model.duration)
    expect(f.look(p.piston).ghost).toBe(1)
    expect(f.look(p.bracket).ghost).toBe(1)
    expect(f.look(inner).ghost).toBe(1)
    expect(f.look(p.block).ghost).toBeUndefined()
  })
  test('moving from one set to another cross-fades', () => {
    const { model, p } = pump((s, q) => { s.step('a', (st: any) => { st.ghost([q.piston]) }); s.step('b', (st: any) => { st.ghost([q.bracket]) }) })
    const f = model.state(model.steps[1]!.t0 + VIEW_PACE.ghost / 2)
    expect(f.look(p.piston).ghost! + f.look(p.bracket).ghost!).toBeCloseTo(1)
    expect(f.look(p.piston).ghost!).toBeGreaterThan(0.2)
  })
  test('s.ghost() is there from the start; a part can opt out with a channel of its own', () => {
    const { model, p } = pump((s, q) => { s.step('a', (st: any) => { st.clip(q.bolt, 'ghost', 0, { duration: 0 }) }) }, (s) => { s.ghost() })
    expect(model.state(0).look(p.block).ghost).toBe(1)
    expect(model.state(model.duration).look(p.bolt).ghost).toBeUndefined()
    expect(model.state(model.duration).look(p.block).ghost).toBe(1)
  })
  test('something that is not a part is reported, and nothing is recorded', () => {
    const { model, p } = pump((s) => { s.step('a', (st: any) => { st.ghost('nothing'); st.ghost(42) }) })
    expect(codes(model).length).toBe(2)
    expect(model.state(model.duration).look(p.block).ghost).toBeUndefined()
  })
})

describe('cutaway', () => {
  test('housings, static parts, fasteners and fluids are cut; the mechanism stays whole', () => {
    const { model, p } = pump((s) => { s.step('a', (st: any) => { st.cutaway({ axis: 'z', at: 0 }) }) })
    expect(codes(model)).toEqual([])
    const f = model.state(model.duration)
    for (const part of [p.block, p.bracket, p.bolt, p.gas]) {
      expect(f.look(part).clip).toEqual([{ normal: [-0, -0, -1], constant: 0 }])
      expect(f.look(part).cut!.sweep).toBe(0)
    }
    expect(f.look(p.piston).clip).toEqual([])
    expect(f.look(p.piston).cut).toBeUndefined()
    expect(f.look(p.piston).opacity).toBe(1) // it straddles the plane: whole
  })
  test('the plane sweeps in from outside the model, and its outline lights up while it travels', () => {
    const { model, p } = pump((s) => { s.step('a', (st: any) => { st.cutaway({ axis: 'z', at: 0 }) }) })
    expect(model.state(0).viewValue('cutaway')).toBeNull()
    const ats: number[] = []
    for (let t = 0.1; t < VIEW_PACE.cutaway; t += 0.1) { const v = model.state(t).viewValue<any>('cutaway'); ats.push(v.at); expect(v.sweep).toBeGreaterThan(0) }
    for (let i = 1; i < ats.length; i++) expect(ats[i]!).toBeLessThanOrEqual(ats[i - 1]!)
    expect(ats[0]!).toBeGreaterThan(2) // it starts in front of the block (which reaches z = 2)
    expect(ats[0]!).toBeLessThan(2 + 4 * VIEW_DEFAULTS.cut.margin + 0.5)
    // nothing of the block is cut in the first instant: no pop when the cutaway is switched on
    const first = model.state(1e-3).look(p.block)
    expect(first.cut!.constant).toBeGreaterThan(2)
    const mid = model.state(VIEW_PACE.cutaway / 2).viewValue<any>('cutaway')
    expect(mid.sweep).toBeCloseTo(1, 1)
  })
  test('moving the plane, and switching it off, are sweeps too', () => {
    const { model } = pump((s) => {
      s.step('a', (st: any) => { st.cutaway({ axis: 'z', at: 0 }) })
      s.step('b', (st: any) => { st.cutaway({ axis: 'z', at: 1 }) })
      s.step('c', (st: any) => { st.cutaway(false) })
    })
    const b = model.steps[1]!, c = model.steps[2]!
    expect(model.state(b.t0 + VIEW_PACE.cutaway / 2).viewValue<any>('cutaway').at).toBeCloseTo(0.5)
    expect(model.state(b.t1).viewValue<any>('cutaway').at).toBe(1)
    const out = model.state(c.t0 + VIEW_PACE.cutaway * 0.9).viewValue<any>('cutaway')
    expect(out.at).toBeGreaterThan(1.5)
    expect(model.state(model.duration).viewValue('cutaway')).toBeNull()
  })
  test('a mechanism part that lies wholly on the removed side is hidden, with a soft edge', () => {
    let front: any
    const { model } = pump((s) => { s.step('a', (st: any) => { st.cutaway({ axis: 'z', at: 0 }) }) }, (s) => {
      const turn = s.param('t2', { value: 0, min: 0, max: 360 })
      front = box({ id: 'front', width: 1, height: 1, depth: 1 }).at(0, 0, 3).rotate({ about: 'z', deg: turn })
    })
    expect(model.state(0).look(front).opacity).toBe(1)
    expect(model.state(model.duration).look(front).opacity).toBe(0)
    const seen = new Set<number>()
    for (let t = 0; t <= VIEW_PACE.cutaway; t += 0.02) seen.add(Math.round(model.state(t).look(front).opacity * 10))
    expect(seen.size).toBeGreaterThan(3) // it fades, it does not pop
  })
  test('parts: cut exactly these; another axis; a vector; at as a param', () => {
    let at: any
    const { model, p } = pump((s, q) => { s.step('a', (st: any) => { st.cutaway({ axis: [0, -1, 0], at, parts: [q.piston] }, { duration: 0 }) }) }, (s) => { at = s.param('at', { value: 0.25, min: -1, max: 1 }) })
    expect(codes(model)).toEqual([])
    const f = model.state(model.duration)
    expect(f.look(p.piston).clip).toEqual([{ normal: [-0, 1, -0], constant: 0.25 }])
    expect(f.look(p.block).clip).toEqual([])
    expect(model.state(model.duration, { at: -0.5 }).look(p.piston).cut!.constant).toBe(-0.5)
  })
  test('bad input is reported with a fix and records nothing', () => {
    const { model } = pump((s) => { s.step('a', (st: any) => { st.cutaway({ axis: 'w', at: 0 }); st.cutaway({ axsi: 'z' }); st.cutaway({ at: 'middle' }) }) })
    expect(codes(model).length).toBe(3)
    expect(model.diagnostics.list.every((d) => d.fix.length > 0)).toBe(true)
    expect(model.state(model.duration).viewValue('cutaway')).toBeNull()
  })
})

describe('explode', () => {
  test('the share of the way by order: order 1 leaves first, all arrive together', () => {
    expect(explodeShare(0, 1, 0.2)).toBe(0)
    expect(explodeShare(1, 1, 0.2)).toBe(1)
    expect(explodeShare(1, 3, 0.2)).toBe(1)
    expect(explodeShare(0.2, 2, 0.2)).toBe(0)
    expect(explodeShare(0.6, 2, 0.2)).toBeCloseTo(0.5)
    expect(explodeShare(0.5, 1, 0.2)).toBeGreaterThan(explodeShare(0.5, 2, 0.2))
  })
  test('parts without an axis move away from the centre of the model; what is mated to another part follows it', () => {
    let a: any, b: any, pin: any, rod: any
    const model = build((s) => {
      a = box({ id: 'a' }).at(-2, 0, 0)
      b = box({ id: 'b' }).at(2, 0, 0)
      pin = sphere({ id: 'pin', radius: 0.1 }).attach(b, { to: 'top' })
      rod = between(a, b, { id: 'rod', radius: 0.05 })
      s.step('apart', (st: any) => { st.explode(1) })
      s.step('back', (st: any) => { st.explode(0) })
    })
    expect(codes(model)).toEqual([])
    const f = model.state(model.steps[0]!.t1)
    // the model's centre is at x = 0 (a from -2.5, b and the pin to 2.5): each box moves 0.85 of its distance further out
    expect(f.world(a).p[0]).toBeCloseTo(-2 - 2 * VIEW_DEFAULTS.explode.spread, 5)
    expect(f.world(b).p[0]).toBeCloseTo(2 + 2 * VIEW_DEFAULTS.explode.spread, 5)
    expect(near(explodeOffset(pin, f), [0, 0, 0])).toBe(true)
    expect(near(explodeOffset(rod, f), [0, 0, 0])).toBe(true)
    expect(f.world(pin).p[0]).toBeCloseTo(f.world(b).p[0]) // the pin went with b
    expect(near(f.rest(a).p, [-2, 0, 0])).toBe(true)
    // it tweens, and it comes back
    const mid = model.state(VIEW_PACE.explode / 2).world(a).p[0]
    expect(mid).toBeLessThan(-2.2)
    expect(mid).toBeGreaterThan(-2 - 2 * VIEW_DEFAULTS.explode.spread + 0.2)
    expect(near(model.state(model.duration).world(a).p, [-2, 0, 0], 1e-9)).toBe(true)
  })
  test('an axis and an order: farther and later; a distance; false stays', () => {
    let a: any, b: any, c: any, d: any
    const model = build((s) => {
      a = box({ id: 'a' }).explode({ axis: 'up' })
      b = box({ id: 'b' }).at(0, 1, 0).explode({ axis: 'up', order: 2 })
      c = box({ id: 'c' }).at(3, 0, 0).explode({ axis: [1, 0, 0], distance: 5 })
      d = box({ id: 'd' }).at(-3, 0, 0).explode(false)
      s.step('apart', (st: any) => { st.explode(1, { duration: 2 }) })
    })
    expect(codes(model)).toEqual([])
    const end = model.state(model.duration)
    const up = end.world(a).p[1]
    expect(up).toBeGreaterThan(0.5)
    expect(end.world(b).p[1] - 1).toBeCloseTo(2 * up) // order 2 goes twice as far
    expect(end.world(c).p[0]).toBeCloseTo(8)
    expect(near(end.world(d).p, [-3, 0, 0])).toBe(true)
    // early on order 1 is under way and order 2 has not left
    const early = model.state(0.25)
    expect(early.world(a).p[1]).toBeGreaterThan(0)
    expect(early.world(b).p[1]).toBe(1)
  })
  test('a group moves as one; s.explode(amount) holds from the start and follows a param', () => {
    let g: any, inner: any, amount: any
    const model = build((s) => {
      amount = s.param('apart', { value: 1, min: 0, max: 1 })
      inner = box({ id: 'inner' }).at(0, 1, 0)
      g = group([inner, box({ id: 'other' })]).explode({ axis: 'right', distance: 2 })
      box({ id: 'base' }).at(0, -3, 0).explode(false)
      s.explode(amount)
    })
    expect(codes(model)).toEqual([])
    expect(near(model.state(0).world(inner).p, [2, 1, 0])).toBe(true)
    expect(near(model.state(0, { apart: 0.5 }).world(inner).p, [1, 1, 0])).toBe(true)
    expect(near(model.state(0, { apart: 0 }).world(inner).p, [0, 1, 0])).toBe(true)
    expect(near(explodeOffset(inner, model.state(0)), [0, 0, 0])).toBe(true) // the group carries it
    expect(near(model.state(0).prop<number[]>(g, 'offset'), [2, 0, 0])).toBe(true)
  })
  test('bad input is reported', () => {
    const model = build((s) => {
      box().explode({ axis: 'sideways' } as any)
      box().explode({ axsi: 'up' } as any)
      s.explode('a lot' as any)
      s.step('a', (st: any) => { st.explode('half' as any) })
    })
    expect(codes(model).length).toBe(4)
    expect(model.diagnostics.list.every((d) => d.fix.length > 0)).toBe(true)
  })
  test('every state is a pure function of time', () => {
    const { model, p } = pump((s) => { s.step('a', (st: any) => { st.ghost(true); st.cutaway({ axis: 'x', at: 0.5 }); st.explode(0.7) }) })
    for (const t of [0.3, 1.1, 0.3, 1.9, 1.1]) {
      const a = model.state(t), b = model.state(t)
      expect(a.signature()).toBe(b.signature())
      expect(JSON.stringify(a.look(p.block))).toBe(JSON.stringify(b.look(p.block)))
    }
  })
})

describe('s.look', () => {
  test('overrides are kept for the renderer; an unknown section is reported with the nearest name', () => {
    const model = build((s) => {
      s.look({ line: { sigma: 2 }, cut: { soft: 0.5 } })
      s.look({ line: { crease: 0.9 }, lihgt: { ambient: 0.3 } })
      s.look('bright' as any)
    })
    expect(lookOverrides(model).overrides).toEqual({ line: { sigma: 2, crease: 0.9 }, cut: { soft: 0.5 } })
    expect(codes(model)).toEqual(['API-UNKNOWN', 'API-TYPE'])
    expect(model.diagnostics.list[0]!.fix.join(' ')).toMatch(/light/)
  })
  test('the pure side reads its own numbers from the overrides', () => {
    let a: any
    const model = build((s) => {
      s.look({ explode: { spread: 2 } })
      a = box({ id: 'a' }).at(1, 0, 0)
      box({ id: 'b' }).at(-1, 0, 0)
      s.explode(1)
    })
    expect(model.state(0).world(a).p[0]).toBeCloseTo(3)
  })
})

describe('explode with parts that are worked out from other parts', () => {
  test('a rod between two parts keeps its length and its place while they are pulled apart; it is not stretched', () => {
    let a: any, b: any, rod: any
    const model = build((s) => {
      a = box({ id: 'a', width: 1, height: 1, depth: 1 }).at(-2, 0, 0)
      b = box({ id: 'b', width: 1, height: 1, depth: 1 }).at(2, 0, 0)
      rod = between(a, b, { id: 'rod', radius: 0.1 })
      s.step('together', (st: any) => { st.wait(1) })
      s.step('apart', (st: any) => { st.explode(1) })
    })
    expect(codes(model)).toEqual([]) // no PLACE-CONFLICT: the size of the rod does not ask for the push being worked out
    // the record of its placement still names the two parts it joins: for check its ends in them are a declared fit
    expect((rod.placement.parts as any[]).map((n) => n.id)).toEqual(['a', 'b'])
    const before = model.state(model.steps[0]!.t1 - 0.01), after = model.state(model.steps[1]!.t1)
    const length = (f: any): number => { const bb = f.localBounds(rod); return bb.max[1] - bb.min[1] }
    expect(length(before)).toBeCloseTo(4, 6)
    expect(after.world(a).p[0]).toBeLessThan(-2.5) // the parts really left
    expect(after.world(b).p[0]).toBeGreaterThan(2.5)
    expect(length(after)).toBeCloseTo(4, 6) // one channel of truth: where the parts are in the mechanism
    expect(after.world(rod).p[0]).toBeCloseTo(0, 6)
    // half way through the move too
    const mid = model.state((model.steps[1]!.t0 + model.steps[1]!.t1) / 2)
    expect(length(mid)).toBeCloseTo(4, 6)
  })
  test('a rod with an explode axis of its own travels as one piece', () => {
    let rod: any
    const model = build((s) => {
      const a = box({ id: 'a' }).at(-2, 0, 0), b = box({ id: 'b' }).at(2, 0, 0)
      rod = between(a, b, { id: 'rod', radius: 0.1 }).explode({ axis: 'up', distance: 3 })
      s.step('apart', (st: any) => { st.explode(1) })
    })
    expect(codes(model)).toEqual([])
    const f = model.state(model.steps[0]!.t1)
    const bb = f.localBounds(rod)
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(4, 6)
    expect(f.world(rod).p[1]).toBeCloseTo(3, 6)
  })
  test('part.world() in a scene function reads the mechanism: a part placed by a function stays put, and so does a probe', () => {
    let follower: any
    const model = build((s) => {
      const lead = box({ id: 'lead' }).at(3, 0, 0)
      box({ id: 'other' }).at(-3, 0, 0)
      follower = sphere({ id: 'follower', radius: 0.3 }).at(() => { const p = lead.world(); return [p[0], p[1] + 2, p[2]] })
      s.probe('leadX', () => lead.world()[0])
      s.step('apart', (st: any) => { st.explode(1) })
    })
    expect(codes(model)).toEqual([])
    const f = model.state(model.steps[0]!.t1)
    expect(f.world(model.byId.get('lead')!).p[0]).toBeGreaterThan(3.5) // pushed out
    expect(f.world(follower).p[0]).toBeCloseTo(3, 6) // where the mechanism has it
    expect(f.world(follower).p[1]).toBeCloseTo(2, 6)
  })
})
