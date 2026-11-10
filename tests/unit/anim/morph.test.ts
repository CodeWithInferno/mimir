// transform, derive, fadeTransform, flashAround (pure side), and the drawing maths of the lazy chunk.
import { describe, expect, test } from 'bun:test'
import { circle, group, line, rect, text } from '../../../src/r2d/index.ts'
import { box } from '../../../src/r3d/index.ts'
import { copyOf, derive, fadeTransform, flashAround, transform, VERB_DEFAULTS } from '../../../src/anim/index.ts'
import { convexHull, flashOutline, morphShapeAt, pathData, shapeOf } from '../../../src/anim/anim.chunk.ts'
import { api, boxCenter, linear, smooth, spaceOf, type MNode, type SceneModel } from '../../../src/core/index.ts'
import { bounds as pathBounds, flattenPath } from '../../../src/lib/path/index.ts'
import { build, codes, near } from '../core/helpers.ts'

const { BLUE, RED, YELLOW } = api
const ghosts = (m: SceneModel, kind = 'animMorph'): MNode[] => m.nodes.filter((n) => n.kind === kind)

describe('transform', () => {
  test('a leaves when the move starts, a stand-in morphs, b is live from the end (and hidden before)', () => {
    let a: any, b: any
    const m = build((s) => {
      a = rect({ width: 2, height: 2, color: BLUE }).at(-3, 0)
      b = circle({ radius: 1, color: RED }).at(3, 1)
      s.step('wait', (st: any) => { st.wait(1) })
      s.step('x', (st: any) => { st.play(transform(a, b, { rate: linear, duration: 2 })) })
    })
    expect(codes(m)).toEqual([])
    const [g] = ghosts(m)
    const t = m.steps[1]!.t0
    expect([a, g, b].map((n) => m.state(t - 0.01).visible(n))).toEqual([true, false, false])
    expect([a, g, b].map((n) => m.state(t).visible(n))).toEqual([false, true, false])
    expect([a, g, b].map((n) => m.state(t + 1).visible(n))).toEqual([false, true, false])
    expect([a, g, b].map((n) => m.state(t + 2).visible(n))).toEqual([false, false, true])
    expect(m.state(t + 1).prop(g!, 'progress')).toBeCloseTo(0.5, 12)
    // the stand-in's box travels from a's box to b's
    expect(near(boxCenter(m.state(t).bounds(g!)), [-3, 0, 0], 1e-9)).toBe(true)
    expect(near(boxCenter(m.state(t + 1).bounds(g!)), [0, 0.5, 0], 1e-9)).toBe(true)
    expect(m.chunksNeeded()).toContain('anim')
  })
  test('the shape the stand-in draws: exactly a at the start (corners sharp), exactly b at the end, style blended', () => {
    let a: any, b: any
    const m = build((s) => {
      a = rect({ width: 2, height: 2, color: BLUE, strokeWidth: 2 }).fill(BLUE, 0.5).at(-3, 0)
      b = circle({ radius: 1, color: RED, strokeWidth: 6 }).at(3, 1)
      s.step('x', (st: any) => { st.play(transform(a, b, { rate: linear })) })
    })
    const [g] = ghosts(m)
    const at = (t: number) => { const f = m.state(t); return morphShapeAt(g!, f.props(g!), f) }
    const start = at(0)
    const pts = flattenPath(start.path, 1e-4).flat()
    for (const corner of [[-4, -1], [-2, -1], [-2, 1], [-4, 1]]) expect(pts.some((p) => Math.hypot(p[0] - corner[0]!, p[1] - corner[1]!) < 1e-9)).toBe(true)
    expect(pathBounds(start.path)).toEqual({ x: -4, y: -1, width: 2, height: 2 })
    expect([start.stroke.toUpperCase(), start.strokeWidth, start.fill!.toUpperCase(), start.fillOpacity, start.opacity]).toEqual([BLUE, 2, BLUE, 0.5, 1])
    const end = at(1)
    for (const p of flattenPath(end.path, 1e-4).flat()) expect(Math.hypot(p[0] - 3, p[1] - 1)).toBeCloseTo(1, 3)
    expect([end.stroke.toUpperCase(), end.strokeWidth, end.fillOpacity]).toEqual([RED, 6, 0])
    const mid = at(0.5)
    expect(mid.strokeWidth).toBe(4)
    expect(mid.fillOpacity).toBe(0.25)
    // every corner of the square is still a corner half-way: two straight pieces meet at an angle there
    const flat = flattenPath(mid.path, 1e-4)[0]!
    let sharp = 0
    for (let i = 1; i + 1 < flat.length; i++) {
      const u = [flat[i]![0] - flat[i - 1]![0], flat[i]![1] - flat[i - 1]![1]], v = [flat[i + 1]![0] - flat[i]![0], flat[i + 1]![1] - flat[i]![1]]
      const turn = Math.abs(Math.atan2(u[0]! * v[1]! - u[1]! * v[0]!, u[0]! * v[0]! + u[1]! * v[1]!)) * 180 / Math.PI
      if (turn > 20) sharp++
    }
    expect(sharp).toBeGreaterThanOrEqual(3) // the fourth may be where the outline starts and ends
  })
  test('text and groups are carried box to box: the two meet on the way and b ends at its place and size', () => {
    let a: any, b: any
    const m = build((s) => {
      a = text('one', { size: 48 }).at(-3, 0)
      b = text('two', { size: 96 }).at(3, 2)
      s.step('x', (st: any) => { st.play(transform(a, b, { rate: linear })) })
    })
    expect(codes(m)).toEqual([])
    expect(ghosts(m)).toEqual([])
    const f = m.state(0.5)
    expect(near(boxCenter(f.bounds(a)), boxCenter(f.bounds(b)), 1e-9)).toBe(true)
    expect(near(boxCenter(f.bounds(a)), [0, 1, 0], 1e-9)).toBe(true)
    expect(f.reveal(a).p + f.reveal(b).p).toBeCloseTo(1, 12)
    expect(f.world(a).s).toBeCloseTo(1.5, 9) // half-way between its size and twice its size
    expect(f.world(b).s).toBeCloseTo(0.75, 9)
    const end = m.state(1)
    expect(end.visible(a)).toBe(false)
    expect(end.world(b).p).toEqual([3, 2, 0])
    expect(end.world(b).s).toBe(1)
  })
  test('groups with the same number of pieces morph piece by piece, staggered by lag', () => {
    let a: any, b: any
    const m = build((s) => {
      a = group([rect().at(-2, 0), rect().at(-2, 2)])
      b = group([circle().at(2, 0), circle().at(2, 2)])
      s.step('x', (st: any) => { st.play(transform(a, b, { lag: 1, duration: 2, rate: linear })) })
    })
    const g = ghosts(m)
    expect(g.length).toBe(2)
    expect(m.state(0.5).visible(g[0]!)).toBe(true)
    expect(m.state(0.5).visible(g[1]!)).toBe(false)
    expect(m.state(1.5).visible(b.children[0])).toBe(true)
    expect(m.state(1.5).prop(g[1]!, 'progress')).toBeCloseTo(0.5, 12)
  })
  test('itself, a 3D target and a missing object are reported; nothing throws', () => {
    const m = build((s) => {
      const a = rect({ id: 'a' }), p = box({ id: 'p' })
      s.step('x', (st: any) => { st.play(transform(a, a), transform(a, p), transform(undefined as any, a), transform(a, 5 as any), derive({} as any, a)) })
    })
    expect(codes(m).sort()).toEqual(['API-TYPE', 'API-TYPE', 'API-TYPE', 'API-TYPE', 'REF-MISSING'])
  })
})

describe('derive', () => {
  test('a stays; the copy appears as it lifts off; b is live from the end', () => {
    let a: any, b: any
    const m = build((s) => {
      a = circle({ radius: 1 }).at(-3, 0)
      b = line([0, 0], [4, 0])
      s.step('x', (st: any) => { st.play(derive(a, b, { rate: linear })) })
    })
    const [g] = ghosts(m)
    expect([a, g, b].map((n) => m.state(0.5).visible(n))).toEqual([true, true, false])
    expect([a, g, b].map((n) => m.state(1).visible(n))).toEqual([true, false, true])
    const shape = (t: number) => { const f = m.state(t); return morphShapeAt(g!, f.props(g!), f) }
    expect(shape(0).opacity).toBe(0)
    expect(shape(VERB_DEFAULTS.deriveAppear / 2).opacity).toBeCloseTo(smooth(0.5), 12)
    expect(shape(0.5).opacity).toBe(1)
    // a closed outline becomes an open one: the end is exactly the line
    expect(pathBounds(shape(1).path)).toMatchObject({ y: 0, height: 0 })
  })
  test('a text is copied: the copy sits on the original, travels to b and is gone; the original never moves', () => {
    let a: any, b: any
    const m = build((s) => {
      a = text('x = 2').at(-3, 1).rotate(20).scale(1.5)
      b = text('x = 2').at(3, -1)
      s.step('x', (st: any) => { st.play(derive(a, b, { rate: linear })) })
    })
    expect(codes(m)).toEqual([])
    const copy = m.nodes.find((n) => n.kind === 'text' && n !== a && n !== b)!
    expect(copy).toBeDefined()
    expect(m.state(0).visible(copy)).toBe(false)
    const f = m.state(0.02)
    expect(near(f.world(copy).p, [-3 + 6 * 0.02, 1 - 2 * 0.02, 0], 1e-9)).toBe(true)
    expect(f.world(copy).q).toEqual(f.world(a).q)
    const h = m.state(0.5)
    expect(near(boxCenter(h.bounds(copy)), boxCenter(h.bounds(b)), 1e-9)).toBe(true)
    expect(h.world(a).p).toEqual([-3, 1, 0])
    expect(h.reveal(a).p).toBe(1)
    expect(m.state(1).visible(copy)).toBe(false)
    expect(m.state(1).reveal(b).p).toBe(1)
  })
  test('from a 3D part: the stand-in lives on the screen and starts as the outline of where the part is drawn', () => {
    let p: any, b: any
    const m = build((s) => {
      s.viewport('left', 0.5)
      p = box({ id: 'p', width: 2, height: 1, depth: 1, color: BLUE })
      b = rect({ width: 2, height: 1 }).at(3.5, 0)
      s.step('x', (st: any) => { st.play(derive(p, b, { rate: linear })) })
    })
    expect(codes(m)).toEqual([])
    const [g] = ghosts(m)
    expect(spaceOf(g!)).toBe('hud')
    const f = m.state(0.01)
    const from = shapeOf(g!, g!.props.from, f.prop(g!, 'from'), f)
    const want = f.frameRect(p)!
    const got = pathBounds(from.path)
    expect(near([got.x, got.y, got.width, got.height], [want.x, want.y, want.width, want.height], 1e-9)).toBe(true)
    expect(from.stroke).toBe(BLUE)
    expect(m.state(1).visible(b)).toBe(true)
    expect(m.state(1).visible(p)).toBe(true)
  })
  test('from a point or an anchor: b grows out of it; a text arrives from it', () => {
    let b: any, t: any, pin: any
    const m = build((s) => {
      pin = circle({ radius: 0.1 }).at(-2, -1)
      b = circle({ radius: 1 }).at(2, 1)
      t = text('here').at(0, 3)
      s.step('x', (st: any) => { st.play(derive([-2, -1], b, { rate: linear }), derive(pin.top, t, { rate: linear })) })
    })
    expect(codes(m)).toEqual([])
    const [g] = ghosts(m)
    const f0 = m.state(0), s0 = morphShapeAt(g!, f0.props(g!), f0)
    const b0 = pathBounds(s0.path)
    expect(near([b0.x + b0.width / 2, b0.y + b0.height / 2], [-2, -1], 1e-6)).toBe(true)
    expect(b0.width).toBeCloseTo(2 * VERB_DEFAULTS.pointRadius, 3)
    expect(near(boxCenter(m.state(0).bounds(t)), [-2, -0.9, 0], 1e-6)).toBe(true)
    expect(m.state(0).world(t).s).toBeCloseTo(VERB_DEFAULTS.growStart, 9)
    expect(m.state(1).world(t).p).toEqual([0, 3, 0])
  })
  test('copyOf: a group is copied with its members; a 3D part cannot be copied', () => {
    let g: any, c: any
    const m = build(() => { g = group([rect({ width: 1 }).at(1, 0), text('a').at(0, 1)]).at(2, 2); c = copyOf(g); expect(copyOf(box())).toBeNull() })
    expect(codes(m)).toEqual([])
    expect(c.children.map((n: MNode) => n.kind)).toEqual(['rect', 'text'])
    const f = m.state(0)
    expect(f.visible(c)).toBe(false)
    expect(f.bounds(c)).toEqual(f.bounds(g))
  })
})

describe('fadeTransform, flashAround', () => {
  test('fadeTransform: a fades out towards b while b fades in from a; across spaces only the flat one travels', () => {
    let a: any, b: any, p: any, n: any
    const m = build((s) => {
      s.viewport('left', 0.4)
      a = rect({ width: 1, height: 1 }).at(2, 2); b = rect({ width: 2, height: 2 }).at(5, -1)
      p = box({ id: 'p' }); n = text('part').at(4, 0)
      s.step('x', (st: any) => { st.play(fadeTransform(a, b, { rate: linear }), fadeTransform(p, n, { rate: linear })) })
    })
    expect(codes(m)).toEqual([])
    const f = m.state(0.5)
    expect(near(boxCenter(f.bounds(a)), [3.5, 0.5, 0], 1e-9)).toBe(true)
    expect(near(boxCenter(f.bounds(b)), [3.5, 0.5, 0], 1e-9)).toBe(true)
    expect(f.world(a).s).toBeCloseTo(1.5, 9)
    expect(f.world(b).s).toBeCloseTo(0.75, 9)
    expect(f.world(p).p).toEqual([0, 0, 0])
    expect(f.reveal(p).p).toBeCloseTo(0.5, 12)
    const at0 = m.state(0)
    const where = at0.frameRect(p)!
    expect(near(boxCenter(at0.bounds(n)).slice(0, 2), [where.x + where.width / 2, where.y + where.height / 2], 1e-6)).toBe(true)
    expect(m.state(1).world(n).p).toEqual([4, 0, 0])
  })
  test('flashAround: a stand-in round the box of the target for the length of the pulse, also round a 3D part', () => {
    let a: any, p: any
    const m = build((s) => {
      s.viewport('left', 0.4)
      a = rect({ width: 2, height: 1 }).at(4, 1); p = box({ id: 'p' })
      s.step('x', (st: any) => { st.play(flashAround(a, { buff: 0.2, color: RED }), flashAround(p)) })
    })
    expect(codes(m)).toEqual([])
    const [fa, fp] = ghosts(m, 'animFlash')
    expect(m.state(0.5).visible(fa!)).toBe(true)
    expect(m.state(1).visible(fa!)).toBe(false)
    expect(m.state(0.5).prop(fa!, 'color')).toBe(RED)
    expect(m.state(0.5).prop(fp!, 'color')).toBe(YELLOW)
    const b = m.state(0.5).bounds(fa!)
    expect(b.min[0]).toBeCloseTo(3 - 0.2 - 0.02, 9)
    expect(spaceOf(fp!)).toBe('hud')
    expect(spaceOf(fa!)).toBe('2d')
  })
})

describe('drawing maths of the chunk', () => {
  test('convexHull', () => {
    const h = convexHull([[0, 0], [2, 0], [1, 0.5], [2, 2], [0, 2], [1, 1]])
    expect(h.length).toBe(4)
    expect(h).toEqual([[0, 0], [2, 0], [2, 2], [0, 2]])
  })
  test('pathData: frame coordinates (y up) to SVG units (y down)', () => {
    expect(pathData([{ coords: [0, 0, 1, 0, 2, 0, 3, 1], closed: false }], 100)).toBe('M0 0C100 0 200 0 300 -100')
    expect(pathData([{ coords: [0, 0, 1, 0, 1, 1, 0, 0], closed: true }], 10)).toBe('M0 0C10 0 10 -10 0 0Z')
  })
  test('flashOutline: a Gaussian window of stroke that enters, covers and leaves the outline', () => {
    const box = { min: [-1, -0.5, 0], max: [1, 0.5, 0] }
    expect(flashOutline(box, 0.1, 4, 1, 0).length).toBeLessThan(6) // only the far tail of the window touches the start
    const mid = flashOutline(box, 0.1, 4, 1, 0.5)
    expect(mid.length).toBeGreaterThan(300)
    // nothing is drawn further out than the rounded box plus half the stroke
    for (const p of mid) { expect(Math.abs(p[0])).toBeLessThanOrEqual(1.1 + 0.02 + 1e-9); expect(Math.abs(p[1])).toBeLessThanOrEqual(0.6 + 0.02 + 1e-9) }
    expect(flashOutline(box, 0.1, 4, 1, 1).length).toBeLessThan(6)
    expect(flashOutline(box, 0.1, 4, 0.3, 0.5).length).toBeLessThan(mid.length / 2)
  })
})
