// Layout, pure side: grid, ring, m.toEdge, m.alignTo, m.fit. No DOM.
import { describe, expect, test } from 'bun:test'
import { compile, FRAME_H, FRAME_W, linear, placementResolver, scene, spaceOf, UL, DR, type MNode } from '../../../src/core/index.ts'
import { circle, dot, grid, LAYOUT, rect, ring, row, text } from '../../../src/r2d/index.ts'
import { box } from '../../../src/r3d/index.ts'
import '../../../src/anim/index.ts'

const build = (fn: (s: any) => void) => compile(scene({ title: 'layout' }, fn))
const codes = (m: ReturnType<typeof build>): string[] => m.diagnostics.list.map((d) => d.code)
const near = (a: readonly number[], b: readonly number[], eps = 1e-9): boolean => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]!) <= eps)
const centre = (m: ReturnType<typeof build>, n: MNode, tau = 0): number[] => { const c = m.state(tau).anchor(n, 'center'); return [c[0], c[1]] }

describe('grid and ring', () => {
  test('grid: reading order, columns as wide as their widest item, centred on the grid', () => {
    const cells: MNode[] = []
    let g: MNode
    const m = build(() => {
      for (let i = 0; i < 6; i++) cells.push(rect({ width: i === 1 ? 2 : 1, height: 1 }))
      g = grid(cells, { columns: 3, gap: 0.5 }).at(1, 2)
    })
    expect(codes(m)).toEqual([])
    for (const p of ['arrange', 'edge', 'fit']) expect(placementResolver(p)).toBeDefined()
    // widths 1, 2, 1 with gaps of 0.5: columns centred at −2, 0, 2; two rows 1.5 apart
    expect(cells.map((c) => centre(m, c))).toEqual([[-1, 2.75], [1, 2.75], [3, 2.75], [-1, 1.25], [1, 1.25], [3, 1.25]])
    const b = m.state(0).bounds(g!)
    expect(near([b.min[0], b.min[1], b.max[0], b.max[1]], [-1.5, 0.75, 3.5, 3.25])).toBe(true)
  })
  test('grid: cols is accepted for columns; without it the grid is as square as it can be; an item whose box is off centre is still put by its box', () => {
    const cells: MNode[] = []
    const m = build(() => {
      for (let i = 0; i < 4; i++) cells.push(circle({ radius: 0.5 }))
      grid(cells, { gap: 1 })
      grid([text('a'), text('b')], { cols: 1 })
    })
    expect(codes(m)).toEqual([])
    expect(cells.map((c) => centre(m, c))).toEqual([[-1, 1], [1, 1], [-1, -1], [1, -1]])
  })
  test('grid follows a tween of its options and of its items', () => {
    const cells: MNode[] = []
    let g: any
    const m = build((s) => {
      for (let i = 0; i < 2; i++) cells.push(rect({ width: 1, height: 1 }))
      g = grid(cells, { columns: 2, gap: 0 })
      s.step('open', (st: any) => { st.play(g.to.set({ gap: 2 }), { duration: 1, rate: linear }) })
    })
    expect(centre(m, cells[1]!, 0)).toEqual([0.5, 0])
    expect(centre(m, cells[1]!, 0.5)).toEqual([1, 0])
    expect(centre(m, cells[1]!, m.duration)).toEqual([1.5, 0])
  })
  test('ring: evenly round a circle, the first at the top, clockwise; a radius of its own when none is given', () => {
    const items: MNode[] = []
    const auto: MNode[] = []
    const m = build(() => {
      for (let i = 0; i < 4; i++) items.push(dot())
      ring(items, { radius: 2 }).at(1, 0)
      for (let i = 0; i < 6; i++) auto.push(circle({ radius: 0.5 }))
      ring(auto)
    })
    expect(codes(m)).toEqual([])
    const at = items.map((c) => centre(m, c))
    expect(near(at.flat(), [1, 2, 3, 0, 1, -2, -1, 0])).toBe(true)
    // neighbours of the automatic ring do not touch: at least their size plus the gap apart
    const p = auto.map((c) => centre(m, c))
    const d = Math.hypot(p[0]![0]! - p[1]![0]!, p[0]![1]! - p[1]![1]!)
    expect(d).toBeGreaterThanOrEqual(1 + LAYOUT.ringGap - 1e-9)
  })
  test('an item that was already placed is reported, and the container wins', () => {
    let a: MNode
    const m = build(() => { a = rect().at(5, 5); grid([a, rect()], { columns: 2 }) })
    expect(codes(m)).toEqual(['PLACE-CONFLICT'])
    expect(m.diagnostics.list[0]!.fix[0]).toContain('.at()')
    expect(centre(m, a!)[1]).toBe(0)
  })
})

describe('m.toEdge and m.alignTo', () => {
  test('toEdge: the box touches the frame edge less the gap; the other axis is left alone; corners move both', () => {
    let top: MNode, left: MNode, corner: MNode, placed: MNode, dflt: MNode
    const m = build(() => {
      top = rect({ width: 2, height: 1 }).toEdge('up', 0.5)
      left = rect({ width: 2, height: 1 }).toEdge('left', 0)
      corner = rect({ width: 2, height: 1 }).toEdge(DR, 0.25)
      placed = rect({ width: 2, height: 1 }).at(3, -1).toEdge('up')
      dflt = rect({ width: 2, height: 1 }).toEdge()
    })
    expect(codes(m)).toEqual([])
    expect(near(centre(m, top!), [0, FRAME_H / 2 - 0.5 - 0.5])).toBe(true)
    expect(near(centre(m, left!), [-FRAME_W / 2 + 1, 0])).toBe(true)
    expect(near(centre(m, corner!), [FRAME_W / 2 - 0.25 - 1, -FRAME_H / 2 + 0.25 + 0.5])).toBe(true)
    expect(near(centre(m, placed!), [3, FRAME_H / 2 - LAYOUT.edgeGap - 0.5])).toBe(true) // x kept from .at()
    expect(near(centre(m, dflt!), [0, FRAME_H / 2 - LAYOUT.edgeGap - 0.5])).toBe(true)
  })
  test('alignTo keeps the placement the object has and lines one edge up: nextTo then alignTo is one placement, not a conflict', () => {
    let label: MNode, bare: MNode, rectTarget: MNode, twice: MNode, box: any
    const m = build(() => {
      box = rect({ width: 4, height: 2 }).at(1, 1)
      label = rect({ width: 1, height: 0.5 }).nextTo(box, 'down', 0.25).alignTo(box, 'left')
      bare = rect({ width: 1, height: 0.5 }).alignTo(box, 'up')
      rectTarget = rect({ width: 1, height: 0.5 }).alignTo({ x: -6, y: -3, width: 2, height: 1 }, 'right')
      twice = rect({ width: 1, height: 0.5 }).toEdge('up', 0).alignTo(box, 'right').alignTo(box.left, 'left')
    })
    expect(codes(m)).toEqual([])
    expect(near(centre(m, label!), [-1 + 0.5, 0 - 0.25 - 0.25])).toBe(true) // under the box, left edges in line
    expect(near(centre(m, bare!), [0, 2 - 0.25])).toBe(true)
    expect(near(centre(m, rectTarget!), [-4 - 0.5, 0])).toBe(true)
    expect(near(centre(m, twice!), [-1 + 0.5, FRAME_H / 2 - 0.25])).toBe(true) // the last word on x wins, y from toEdge
  })
  test('they follow what they refer to, and inside a step they are a move', () => {
    let label: any, box: any
    const m = build((s) => {
      box = rect({ width: 4, height: 2 }).at(0, 0)
      label = rect({ width: 1, height: 0.5 }).nextTo(box, 'up', 0).alignTo(box, 'left')
      s.step('one', (st: any) => { st.play(box.to.shift(2, 0), { duration: 1, rate: linear }) })
      s.step('two', (st: any) => { st.play(label.to.alignTo(box, 'right'), { duration: 1, rate: linear }) })
    })
    expect(codes(m)).toEqual([])
    expect(near(centre(m, label, 0), [-1.5, 1.25])).toBe(true)
    expect(near(centre(m, label, 1), [0.5, 1.25])).toBe(true) // moved with the box
    const t2 = m.steps[1]!.t0
    expect(near(centre(m, label, t2 + 0.5), [2, 1.25])).toBe(true) // half way from the left edge to the right edge
    expect(near(centre(m, label, t2 + 1), [3.5, 1.25])).toBe(true)
  })
  test('an object that is put on the screen (a hud object, a 3D part) makes what is aligned to it a screen object too', () => {
    let tag: MNode, plain: MNode
    const m = build((s) => {
      s.viewport('right', 0.5)
      const part = box({ id: 'part' })
      tag = text('tag').nextTo(part, 'left').alignTo([0, 3], 'up')
      plain = text('plain').at(-3, 0).toEdge('up')
    })
    expect(codes(m)).toEqual([])
    expect(spaceOf(tag!)).toBe('hud')
    expect(spaceOf(plain!)).toBe('2d')
  })
  test('bad calls are reported and change nothing', () => {
    let a: MNode
    const m = build(() => {
      a = rect().at(1, 1)
      ;(a as any).toEdge('sideways')
      ;(a as any).toEdge('up', 'far')
      ;(a as any).alignTo(undefined, 'left')
      ;(a as any).alignTo(a, 'left')
      ;(a as any).fit(42)
      ;(a as any).fit({ x: 0, y: 0, width: 4, height: 4 }, { padding: -1 })
    })
    expect(codes(m)).toEqual(['API-UNKNOWN', 'API-TYPE', 'REF-MISSING', 'PLACE-CONFLICT', 'API-TYPE', 'NUM-INVALID', 'PLACE-CONFLICT'])
    expect(centre(m, a!)).toEqual([1, 1])
  })
})

describe('m.fit', () => {
  test('centres in the rectangle and scales, keeping proportions, to be as large as fits; padding is kept free', () => {
    let wide: MNode, tall: MNode, padded: MNode
    const m = build((s) => {
      const area = s.area('left', 0.5)
      wide = rect({ width: 2, height: 1 }).fit({ x: 0, y: 0, width: 8, height: 2 })
      tall = rect({ width: 1, height: 4 }).fit({ x: -4, y: -1, width: 3, height: 2 })
      padded = rect({ width: 2, height: 2 }).fit(area, { padding: 0.5 })
    })
    expect(codes(m)).toEqual([])
    const f = m.state(0)
    const b = f.bounds(wide!)
    expect(near([b.min[0], b.min[1], b.max[0], b.max[1]], [2, 0, 6, 2])).toBe(true) // height decides: scale 2
    const t = f.bounds(tall!)
    expect(near([t.min[0], t.min[1], t.max[0], t.max[1]], [-2.75, -1, -2.25, 1])).toBe(true) // shrunk to half
    const p = f.bounds(padded!)
    expect(p.max[0] - p.min[0]).toBeCloseTo(p.max[1] - p.min[1], 9)
    expect(p.max[0] - p.min[0]).toBeCloseTo(FRAME_W / 2 - 1 - 1, 9) // the area is inset by 0.5 on each side, the padding by 0.5 more
  })
  test('a container is fitted as a whole; another object can be the rectangle; a later tween of scale starts from the fit', () => {
    let pair: any, inner: MNode, host: any
    const m = build((s) => {
      pair = row([rect({ width: 1, height: 1 }), rect({ width: 1, height: 1 })], { gap: 0 }).fit({ x: -2, y: -1, width: 4, height: 2 })
      host = rect({ width: 6, height: 3 }).at(0, -2)
      inner = circle({ radius: 1 }).fit(host)
      s.step('grow', (st: any) => { st.play(pair.to.scale(1), { duration: 1, rate: linear }) })
    })
    expect(codes(m)).toEqual([])
    const f = m.state(0)
    const b = f.bounds(pair)
    expect(near([b.min[0], b.min[1], b.max[0], b.max[1]], [-2, -1, 2, 1])).toBe(true)
    const c = f.bounds(inner!)
    expect(near([c.min[0], c.min[1], c.max[0], c.max[1]], [-1.5, -3.5, 1.5, -0.5])).toBe(true)
    expect(f.prop<number>(pair, 'scale')).toBeCloseTo(2, 9)
    expect(m.state(0.5).prop<number>(pair, 'scale')).toBeCloseTo(1.5, 9)
  })
})
