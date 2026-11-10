import { describe, expect, test } from 'bun:test'
import { column, group, rect, row, text, circle, arrow, line } from '../../../src/r2d/index.ts'
import { between, box, cylinder } from '../../../src/r3d/index.ts'
import { dist, qrot } from '../../../src/core/index.ts'
import { build, codes, near } from './helpers.ts'

describe('placement', () => {
  test('absolute at(): numbers, a vector, a function, another object', () => {
    let a: any, b: any, c: any, d: any
    const m = build((s) => {
      const x = s.param('x', { value: 2, min: 0, max: 5 })
      a = rect().at(1, 2)
      b = box().at([1, 2, 3])
      c = rect().at(() => [x(), -1])
      d = text('on a').at(a)
    })
    const f = m.state(0)
    expect(f.world(a).p).toEqual([1, 2, 0])
    expect(f.world(b).p).toEqual([1, 2, 3])
    expect(f.world(c).p).toEqual([2, -1, 0])
    expect(m.state(0, { x: 4 }).world(c).p).toEqual([4, -1, 0])
    expect(f.world(d).p).toEqual([1, 2, 0])
    expect(codes(m)).toEqual([])
  })
  test('one placement per object: the second is PLACE-CONFLICT and the first is kept; shift is not a placement', () => {
    let a: any
    const m = build(() => { a = rect().at(1, 1).shift(0.5, 0).at(3, 3) })
    expect(m.state(0).world(a).p).toEqual([1.5, 1, 0])
    expect(codes(m)).toEqual(['PLACE-CONFLICT'])
    expect(m.diagnostics.list[0]!.what).toContain('placed twice')
  })
  test('nextTo is extent aware in every direction, with the default gap 0.25', () => {
    let a: any, r: any, l: any, u: any, d: any
    const m = build(() => {
      a = rect({ width: 4, height: 2 }).at(1, 1)
      r = rect({ width: 2, height: 1 }).nextTo(a, 'right')
      l = circle({ radius: 0.5 }).nextTo(a, 'left', 0)
      u = rect({ width: 1, height: 1 }).nextTo(a, 'up', 0.5)
      d = rect({ width: 1, height: 1 }).nextTo(a, [0, -1, 0])
    })
    const f = m.state(0)
    expect(near(f.world(r).p, [1 + 2 + 0.25 + 1, 1, 0])).toBe(true)
    expect(near(f.world(l).p, [1 - 2 - 0.5, 1, 0])).toBe(true)
    expect(near(f.world(u).p, [1, 1 + 1 + 0.5 + 0.5, 0])).toBe(true)
    expect(near(f.world(d).p, [1, 1 - 1 - 0.25 - 0.5, 0])).toBe(true)
  })
  test('nextTo follows its target when the target moves', () => {
    let a: any, b: any
    const m = build((s) => {
      a = rect({ width: 2, height: 1 })
      b = rect({ width: 1, height: 1 }).nextTo(a, 'right', 0)
      s.step('move', (st: any) => { st.play(a.to.shift(3, 0), { duration: 1 }) })
    })
    expect(m.state(0).world(b).p[0]).toBeCloseTo(1.5, 12)
    expect(m.state(1).world(b).p[0]).toBeCloseTo(4.5, 12)
  })
  test('attach: my anchor on its anchor, gap outwards, rigidly following rotation', () => {
    let base: any, cap: any, arm: any
    const m = build((s) => {
      const turn = s.param('turn', { value: 0, min: 0, max: 360 })
      base = box({ width: 2, height: 2, depth: 2 }).at(0, 1, 0).rotate({ about: 'z', deg: turn })
      cap = cylinder({ radius: 0.5, height: 1 }).attach(base, { to: 'top' }) // my defaults to the opposite: bottom
      arm = box({ width: 1, height: 0.2, depth: 0.2 }).attach(base, { my: 'left', to: 'right', gap: 0.5 })
    })
    const f = m.state(0)
    expect(near(f.world(cap).p, [0, 2.5, 0])).toBe(true)
    expect(near(f.world(arm).p, [1 + 0.5 + 0.5, 1, 0])).toBe(true)
    const g = m.state(0, { turn: 90 }) // base turned a quarter about z: its top now points along −x
    expect(near(g.world(cap).p, [-1.5, 1, 0], 1e-9)).toBe(true)
    expect(near(qrot(g.world(cap).q, [0, 1, 0]), [-1, 0, 0], 1e-9)).toBe(true)
    expect(near(g.world(arm).p, [0, 3, 0], 1e-9)).toBe(true)
  })
  test('attach to a defined anchor; unknown anchor names are reported with the list', () => {
    let wheel: any, pin: any
    const m = build(() => {
      wheel = cylinder({ radius: 2, height: 0.5 })
      wheel.define('pin', [1.5, 0.25, 0])
      pin = cylinder({ radius: 0.2, height: 1 }).attach(wheel, { my: 'bottom', to: 'pin' })
      cylinder().attach(wheel, { to: 'topp' })
    })
    expect(near(m.state(0).world(pin).p, [1.5, 0.75, 0])).toBe(true)
    const d = m.diagnostics.byCode('API-UNKNOWN')[0]!
    expect(d.what).toContain('has no anchor "topp"')
    expect(d.fix[0]).toContain('use "top"')
  })
  test('row and column lay children out by their extents and centre the group', () => {
    let a: any, b: any, c: any, r: any, col: any, x: any, y: any
    const m = build(() => {
      a = rect({ width: 2, height: 1 }); b = rect({ width: 4, height: 2 }); c = circle({ radius: 0.5 })
      r = row([a, b, c], { gap: 1 }).at(1, 0)
      x = rect({ width: 2, height: 1 }); y = rect({ width: 1, height: 3 })
      col = column([x, y], { gap: 0.5, align: 'left' })
    })
    const f = m.state(0)
    // total width 2 + 4 + 1 + 2 gaps = 9 → from −4.5 to 4.5, shifted by 1
    expect(near(f.world(a).p, [-3.5 + 1, 0, 0])).toBe(true)
    expect(near(f.world(b).p, [0.5 + 1, 0, 0])).toBe(true)
    expect(near(f.world(c).p, [4 + 1, 0, 0])).toBe(true)
    const rb = f.bounds(r)
    expect(near([rb.min[0], rb.max[0], rb.min[1], rb.max[1]], [-3.5, 5.5, -1, 1])).toBe(true)
    // column: total height 1 + 3 + 0.5 = 4.5, first on top, left edges aligned
    expect(near(f.world(x).p, [-1 + 1, 2.25 - 0.5, 0])).toBe(true)
    expect(near(f.world(y).p, [-1 + 0.5, 2.25 - 1 - 0.5 - 1.5, 0])).toBe(true)
    expect(f.bounds(col).min[0]).toBeCloseTo(-1, 12)
  })
  test('a row item that also has its own placement is a PLACE-CONFLICT (the row wins)', () => {
    const m = build(() => { row([rect().at(5, 5), rect()]) })
    expect(codes(m)).toEqual(['PLACE-CONFLICT'])
    expect(m.state(0).world(m.nodes[0]!).p[1]).toBe(0)
  })
  test('groups: children are in the group\'s space; the group can be placed and scaled as a unit', () => {
    let a: any, b: any, g: any, t: any
    const m = build(() => {
      a = rect({ width: 2, height: 2 }).at(-2, 0); b = rect({ width: 2, height: 2 }).at(2, 0)
      g = group([a, b]).at(0, 1).scale(0.5)
      t = text('below').nextTo(g, 'down', 0)
    })
    const f = m.state(0)
    expect(near(f.world(a).p, [-1, 1, 0])).toBe(true)
    expect(f.world(a).s).toBe(0.5)
    const gb = f.bounds(g)
    expect(near([gb.min[0], gb.max[0], gb.min[1], gb.max[1]], [-1.5, 1.5, 0.5, 1.5])).toBe(true)
    expect(f.bounds(t).max[1]).toBeCloseTo(0.5, 12)
    expect(g.space).toBe('2d')
  })
  test('group() picks the 3D kind for 3D children', () => {
    let g: any
    build(() => { g = group([box(), cylinder()]) })
    expect(g.kind).toBe('group3d')
    expect(g.children.length).toBe(2)
  })
  test('between: a rod that spans two points and follows both', () => {
    let a: any, b: any, rod: any
    const m = build((s) => {
      const h = s.param('h', { value: 4, min: 1, max: 9 })
      a = box().at(0, 0, 0)
      b = box().at(() => [3, h(), 0])
      rod = between(a, b, { radius: 0.1 })
    })
    for (const hv of [4, 9]) {
      const f = m.state(0, { h: hv })
      const w = f.world(rod)
      expect(near(w.p, [1.5, hv / 2, 0])).toBe(true)
      const len = dist([0, 0, 0], [3, hv, 0])
      expect(near(f.anchor(rod, 'end'), [3, hv, 0], 1e-9)).toBe(true)
      expect(near(f.anchor(rod, 'start'), [0, 0, 0], 1e-9)).toBe(true)
      expect(f.localBounds(rod).max[1]).toBeCloseTo(len / 2, 12)
    }
  })
  test('lines and arrows: an end given as an object stops at its edge; an anchor is exact', () => {
    let a: any, b: any, l1: any, l2: any
    const m = build(() => {
      a = rect({ width: 2, height: 2 }).at(-3, 0); b = rect({ width: 2, height: 2 }).at(3, 0)
      l1 = arrow(a, b, { buff: 0.1 })
      l2 = line(a.right, b.left)
    })
    const f = m.state(0)
    expect(near(f.anchor(l1, 'start'), [-1.9, 0, 0])).toBe(true)
    expect(near(f.anchor(l1, 'end'), [1.9, 0, 0])).toBe(true)
    expect(near(f.anchor(l2, 'start'), [-2, 0, 0])).toBe(true)
    expect(near(f.anchor(l2, 'end'), [2, 0, 0])).toBe(true)
  })
  test('world transforms are lazy and cycle safe: a placement loop is PLACE-CONFLICT, not a hang', () => {
    let a: any, b: any
    const m = build(() => { a = rect(); b = rect().nextTo(a, 'right'); a.nextTo(b, 'right') })
    const f = m.state(0)
    expect(f.world(a).p.every(Number.isFinite)).toBe(true)
    expect(f.world(b).p.every(Number.isFinite)).toBe(true)
    expect(codes(m)).toContain('PLACE-CONFLICT')
  })
  test('anchors and world(): standard names, live anchor refs as points', () => {
    let a: any, tip: any, seen: number[] = []
    const m = build(() => {
      a = rect({ width: 4, height: 2 }).at(1, 1)
      tip = circle({ radius: 0.1 }).at(a.top)
      seen = a.world('right')
    })
    expect(seen).toEqual([3, 1, 0])
    const f = m.state(0)
    expect(f.anchor(a, 'ul')).toEqual([-1, 2, 0])
    expect(f.world(tip).p).toEqual([1, 2, 0])
    expect(f.run(() => a.width())).toBe(4)
  })
})
