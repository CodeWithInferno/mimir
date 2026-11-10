// The 2D kinds, pure side: boxes, outlines, anchors, what arrows stop on, bad input. No DOM.
import { describe, expect, test } from 'bun:test'
import { backendOf, compile, kindOf, scene, type MNode, type Vec3 } from '../../../src/core/index.ts'
import {
  arc, arrow, arrowShape, bendControl, brace, bracePath, BRACE, circle, dot, DOT_RADIUS, ellipse, HEAD, line, path, pathOf, PATH_CACHE_SIZE, polygon, polyline, rect, SHAPES_CHUNK, text,
} from '../../../src/r2d/index.ts'
import { bounds as pathBounds, measurePath } from '../../../src/lib/path/index.ts'
import '../../../src/anim/index.ts'
import { svgPath } from '../../../src/r2d/shapes.chunk.ts'

const build = (fn: (s: any) => void) => compile(scene({ title: 'shapes' }, fn))
const codes = (m: ReturnType<typeof build>): string[] => m.diagnostics.list.map((d) => d.code)
const near = (a: readonly number[], b: readonly number[], eps = 1e-6): boolean => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]!) <= eps)

describe('new kinds', () => {
  test('each has a box, a backend in the shapes chunk, and an outline that is the same shape as the box', () => {
    const made: Record<string, MNode> = {}
    const m = build(() => {
      made.ellipse = ellipse({ radiusX: 2, radiusY: 1 })
      made.dot = dot()
      made.polyline = polyline([[0, 0], [1, 2], [3, 0]])
      made.polygon = polygon([[-1, -1], [1, -1], [0, 2]])
      made.path = path('M 0 0 L 2 0 L 2 1 Z')
      made.arc = arc({ radius: 1, from: 0, to: 180 })
    })
    expect(codes(m)).toEqual([])
    const f = m.state(0)
    const box = (n: MNode): number[] => { const b = f.localBounds(n); return [b.min[0], b.min[1], b.max[0], b.max[1]] }
    expect(near(box(made.ellipse!), [-2, -1, 2, 1])).toBe(true)
    expect(near(box(made.dot!), [-DOT_RADIUS, -DOT_RADIUS, DOT_RADIUS, DOT_RADIUS])).toBe(true)
    expect(near(box(made.polyline!), [0, 0, 3, 2])).toBe(true)
    expect(near(box(made.polygon!), [-1, -1, 1, 2])).toBe(true)
    expect(near(box(made.path!), [0, 0, 2, 1])).toBe(true)
    const ab = f.localBounds(made.arc!)
    expect(near([...ab.min, ...ab.max], [-1, 0, 0, 1, 1, 0], 1e-6)).toBe(true)
    for (const [name, node] of Object.entries(made)) {
      expect(kindOf(name)!.chunks).toEqual([SHAPES_CHUNK])
      expect(backendOf(name)).toBeDefined() // registered by the chunk file, which this test imports
      const b = f.bounds(node), r = pathBounds(f.outline(node))
      expect(near([r.x, r.y, r.x + r.width, r.y + r.height], [b.min[0], b.min[1], b.max[0], b.max[1]], 1e-6)).toBe(true)
    }
    // closed shapes close, open ones have two ends
    expect(f.outline(made.polygon!)[0]!.closed).toBe(true)
    expect(f.outline(made.ellipse!)[0]!.closed).toBe(true)
    expect(f.outline(made.polyline!)[0]!.closed).toBe(false)
    expect(f.outline(made.arc!)[0]!.closed).toBe(false)
  })
  test('rx / ry are accepted for an ellipse; r for a dot', () => {
    let e: MNode, d: MNode
    const m = build(() => { e = ellipse({ rx: 1.5, ry: 0.5 }); d = dot({ r: 0.2 }) })
    expect(codes(m)).toEqual([])
    expect(m.state(0).props(e!)).toMatchObject({ radiusX: 1.5, radiusY: 0.5 })
    expect(m.state(0).props(d!).radius).toBe(0.2)
  })
  test('a shape moves, turns and scales about its own position; points are relative to it', () => {
    let p: MNode
    const m = build(() => { p = polygon([[0, 0], [2, 0], [0, 1]]).at(3, 1).rotate(90).scale(2) })
    const b = m.state(0).bounds(p!)
    expect(near([...b.min, ...b.max], [1, 1, 0, 3, 5, 0])).toBe(true)
    expect(near(m.state(0).anchor(p!, 'center'), [2, 3, 0])).toBe(true)
  })
  test('open outlines have m.start and m.end; m.pointAt walks any outline by length', () => {
    let a: MNode, pl: MNode, c: any
    const m = build(() => {
      a = arc({ radius: 2, from: 0, to: 90 }).at(1, 1)
      pl = polyline([[0, 0], [4, 0], [4, 3]])
      c = circle({ radius: 1 })
    })
    const f = m.state(0)
    expect(near(f.anchor(a!, 'start'), [3, 1, 0])).toBe(true)
    expect(near(f.anchor(a!, 'end'), [1, 3, 0])).toBe(true)
    expect(near(f.anchor(pl!, 'end'), [4, 3, 0])).toBe(true)
    // 4 of 7 units along: the corner
    expect(near(f.run(() => (pl as any).pointAt(4 / 7)()), [4, 0, 0], 1e-3)).toBe(true)
    expect(Math.hypot(...(f.run(() => c.pointAt(0.3)()) as Vec3))).toBeCloseTo(1, 3)
  })
  test('dot(point) sits on a point, an object or an anchor and follows it; dot() is placed like anything else', () => {
    let on: MNode, top: MNode, free: MNode, opt: MNode, box: any
    const m = build((s) => {
      box = rect({ width: 2, height: 1 }).at(1, 2)
      on = dot(box)
      top = dot(box.top, { radius: 0.2 })
      free = dot().at(-3, -1)
      opt = dot([4, 0], { color: '#FF0000' })
      s.step('move', (st: any) => { st.play(box.to.shift(2, 0)) })
    })
    expect(codes(m)).toEqual([])
    const f0 = m.state(0), f1 = m.state(m.duration)
    expect(f0.anchor(on!, 'center')).toEqual([1, 2, 0])
    expect(f0.anchor(top!, 'center')).toEqual([1, 2.5, 0])
    expect(f1.anchor(on!, 'center')).toEqual([3, 2, 0])
    expect(f1.anchor(top!, 'center')).toEqual([3, 2.5, 0])
    expect(f0.anchor(free!, 'center')).toEqual([-3, -1, 0])
    expect(f0.anchor(opt!, 'center')).toEqual([4, 0, 0])
    expect(f0.props(top!).radius).toBe(0.2)
    expect(f0.props(opt!).color).toBe('#FF0000')
  })
  test('lines and arrows stop on the outline of what they point at, not on its box', () => {
    let l: MNode, t: MNode
    const m = build(() => {
      const e = ellipse({ id: 'e', radiusX: 2, radiusY: 1 })
      const tri = polygon([[-1, -1], [1, -1], [0, 1]], { id: 'tri' }).at(6, 3)
      l = line(e, [4, 4], { buff: 0 })
      t = line([6, -3], tri, { buff: 0 })
    })
    const f = m.state(0)
    // along the diagonal the ellipse x²/4 + y² = 1 is left at x = y = 2/√5; its box would be left at (1, 1)
    const a = f.anchor(l!, 'start')
    expect(a[0]).toBeCloseTo(2 / Math.sqrt(5), 2)
    expect(a[1]).toBeCloseTo(2 / Math.sqrt(5), 2)
    // straight up into the triangle's base
    expect(near(f.anchor(t!, 'end'), [6, 2, 0], 1e-3)).toBe(true)
  })
  test('path: SVG path data in frame units; yDown flips data copied from a file; the parse is cached', () => {
    let up: MNode, down: MNode
    const m = build(() => { up = path('M 0 0 L 1 2'); down = path('M 0 0 L 1 2', { yDown: true }) })
    const lb = (n: MNode): number[] => { const b = m.state(0).localBounds(n); return [b.min[0], b.min[1], b.max[0], b.max[1]] }
    expect(near(lb(up!), [0, 0, 1, 2])).toBe(true)
    expect(near(lb(down!), [0, -2, 1, 0])).toBe(true)
    expect(pathOf('M 0 0 L 1 2', false)).toBe(pathOf('M 0 0 L 1 2', false)) // the same object: parsed once
    for (let i = 0; i < PATH_CACHE_SIZE + 10; i++) pathOf(`M 0 0 L ${i} 1`, false)
    expect(pathOf('M 0 0 L 3 1', false)[0]!.coords.length).toBe(8)
    expect(pathOf(42, false)).toEqual([])
  })
  test('bad input never throws: it is reported with the scene line and something inert is drawn', () => {
    const made: MNode[] = []
    const m = build(() => {
      made.push(path('M 0 0 Q banana'))
      made.push(polygon([[0, 0], [1, 1]]))
      made.push(polyline('nope' as any))
      made.push(ellipse({ radiusX: -1 }))
      made.push(arc({ radius: 1, from: 'east' as any }))
      made.push((brace as any)())
      made.push(dot({ colour: 'red' } as any))
      made.push(path(undefined as any))
    })
    expect(codes(m)).toEqual(['API-TYPE', 'API-TYPE', 'API-TYPE', 'NUM-INVALID', 'API-TYPE', 'API-TYPE', 'API-UNKNOWN', 'API-TYPE'])
    expect(m.diagnostics.list.every((d) => d.line !== null && d.fix.length > 0)).toBe(true)
    expect(m.diagnostics.list[1]!.what).toContain('at least 3')
    expect(m.diagnostics.list[6]!.fix[0]).toContain('color')
    const f = m.state(0)
    for (const n of made) {
      expect(n.invalid).toBe(true)
      const b = f.bounds(n)
      expect([...b.min, ...b.max].every(Number.isFinite)).toBe(true)
      expect(Array.isArray(f.outline(n))).toBe(true)
    }
  })
})

describe('brace', () => {
  test('hugs the chosen side of its target, a gap away, and follows it', () => {
    let down: MNode, right: MNode, box: any
    const m = build((s) => {
      box = rect({ width: 4, height: 2 }).at(1, 1)
      down = brace(box)
      right = brace(box, 'right', { gap: 0.3, depth: 0.5 })
      s.step('grow', (st: any) => { st.play(box.to.set({ width: 6 })) })
    })
    expect(codes(m)).toEqual([])
    const f = m.state(0)
    const b = f.bounds(down!)
    expect(b.min[0]).toBeCloseTo(-1, 6)
    expect(b.max[0]).toBeCloseTo(3, 6)
    expect(b.max[1]).toBeCloseTo(0 - BRACE.gap, 6) // the ends touch the gap line under the box
    expect(b.min[1]).toBeCloseTo(0 - BRACE.gap - BRACE.depth, 6) // the tip
    expect(near(f.anchor(down!, 'tip'), [1, -BRACE.gap - BRACE.depth, 0])).toBe(true)
    const r = f.bounds(right!)
    expect(r.min[0]).toBeCloseTo(3.3, 6)
    expect(r.max[0]).toBeCloseTo(3.8, 6)
    expect(r.min[1]).toBeCloseTo(0, 6)
    expect(r.max[1]).toBeCloseTo(2, 6)
    const later = m.state(m.duration).bounds(down!)
    expect(later.max[0] - later.min[0]).toBeCloseTo(6, 6)
    // a label goes under it by relation
    expect(f.outline(down!)[0]!.closed).toBe(true)
  })
  test('the shape: one closed outline, symmetric, thin at the ends and at the tip, never inside out however short', () => {
    for (const length of [8, 2, 0.4, 0.05]) {
      const p = bracePath(length, BRACE.depth, BRACE.weight)
      expect(p.length).toBe(1)
      const c = p[0]!.coords
      expect(c.every(Number.isFinite)).toBe(true)
      expect(near([c[0]!, c[1]!], [c[c.length - 2]!, c[c.length - 1]!])).toBe(true)
      const r = pathBounds(p)
      expect(r.x).toBeCloseTo(-length / 2, 6)
      expect(r.width).toBeCloseTo(length, 6)
      expect(r.y).toBeCloseTo(-BRACE.depth, 6)
      expect(r.y + r.height).toBeCloseTo(0, 6)
      expect(measurePath(p).length).toBeGreaterThan(2 * length)
    }
  })
})

describe('arrows', () => {
  const a: Vec3 = [0, 0, 0], b: Vec3 = [4, 0, 0]
  test('one head at the end, its size from the stroke; the shaft stops inside it', () => {
    const s = arrowShape(a, b, null, { strokeWidth: 4 })
    expect(s.heads.length).toBe(1)
    const [tip, left, notch, right] = s.heads[0]!
    expect(tip).toEqual([4, 0, 0])
    const width = HEAD.base + HEAD.perStroke * 0.04
    expect(left[1] - right[1]).toBeCloseTo(width, 9)
    expect(4 - left[0]).toBeCloseTo(width * HEAD.aspect, 9)
    expect(notch[0]).toBeGreaterThan(left[0])
    expect(s.b).toEqual(notch)
    expect(s.a).toEqual(a)
    // a thicker shaft has a larger head; the head option scales it
    const thick = arrowShape(a, b, null, { strokeWidth: 8 }).heads[0]!
    expect(thick[1][1] - thick[3][1]).toBeGreaterThan(width)
    const big = arrowShape(a, b, null, { strokeWidth: 4, head: 2 }).heads[0]!
    expect(big[1][1] - big[3][1]).toBeCloseTo(2 * width, 9)
  })
  test('both ends; a short arrow keeps heads that fit; nothing degenerate at zero length', () => {
    const both = arrowShape(a, b, null, { strokeWidth: 4, both: true })
    expect(both.heads.length).toBe(2)
    expect(both.heads[1]![0]).toEqual(a)
    expect(both.a[0]).toBeGreaterThan(0)
    const short = arrowShape(a, [0.2, 0, 0], null, { strokeWidth: 4 })
    expect(0.2 - short.heads[0]![1][0]).toBeCloseTo(0.2 * HEAD.maxShare, 9)
    const two = arrowShape(a, [0.2, 0, 0], null, { strokeWidth: 4, both: true })
    expect(two.b[0]).toBeGreaterThan(two.a[0]) // the heads do not cross
    expect(arrowShape(a, a, null, { strokeWidth: 4 }).heads).toEqual([])
  })
  test('drawn on: the first part of the arrow with the head at its front; a bent one follows its curve', () => {
    const half = arrowShape(a, b, null, { strokeWidth: 4, upTo: 0.5 })
    expect(half.heads[0]![0]).toEqual([2, 0, 0])
    const ctrl = bendControl(a, b, 60)!
    const part = arrowShape(a, b, ctrl, { strokeWidth: 4, upTo: 0.5 })
    const tip = part.heads[0]![0]
    expect(tip[0]).toBeCloseTo(2, 9)
    expect(tip[1]).toBeCloseTo(ctrl[1] / 2, 9) // the point of the quadratic at one half
    expect(arrowShape(a, b, ctrl, { strokeWidth: 4, upTo: 1 }).heads[0]![0]).toEqual(b)
  })
  test('under a 2D zoom the head keeps its size on screen', () => {
    const w = (shrink: number): number => { const h = arrowShape(a, b, null, { strokeWidth: 4, shrink }).heads[0]!; return h[1][1] - h[3][1] }
    expect(w(2)).toBeCloseTo(w(1) / 2, 9)
  })
  test('the arrow kind takes both and head, and still has the ends and the outline of a line', () => {
    let ar: MNode
    const m = build(() => { ar = arrow([0, 0], [3, 4], { both: true, head: 1.5, bend: 30, dashed: true }) })
    expect(codes(m)).toEqual([])
    const f = m.state(0)
    expect(f.props(ar!)).toMatchObject({ both: true, head: 1.5, bend: 30, dashed: true })
    expect(f.anchor(ar!, 'start')).toEqual([0, 0, 0])
    expect(f.anchor(ar!, 'end')).toEqual([3, 4, 0])
    expect(f.outline(ar!)[0]!.closed).toBe(false)
  })
})

describe('drawing an outline', () => {
  test('svgPath: frame units with y up → stage units with y down, closed subpaths closed', () => {
    expect(svgPath([{ coords: [0, 0, 1, 0, 2, 0, 3, 1], closed: false }], 100)).toBe('M0 0C100 0 200 0 300 -100')
    expect(svgPath([{ coords: [0, 0, 1, 0, 1, 1, 0, 0], closed: true }, { coords: [5, 5], closed: false }], 10)).toBe('M0 0C10 0 10 -10 0 0ZM50 -50')
    expect(svgPath([], 100)).toBe('')
  })
  test('text over a shape: every text is text for the text rules', () => {
    expect(kindOf('text')!.text).toBe(true)
    let t: MNode
    const m = build(() => { t = text('on top').at(0, 0) })
    expect(m.state(0).textRects(t!).length).toBe(1)
  })
})
