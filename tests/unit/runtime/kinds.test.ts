// Pure sides of the seed modules: 2D / 3D kind maths, verbs, guide helpers. No DOM, no three.js.
import { describe, expect, test } from 'bun:test'
import { arrow, group, layoutText, rect, text, line } from '../../../src/r2d/index.ts'
import { box, cone, cylinder, sphere, torus, tube } from '../../../src/r3d/index.ts'
import { GUIDE_DEFAULTS, speechSeconds, stripSpans } from '../../../src/guide/index.ts'
import '../../../src/guide/guide.chunk.ts'
import { allKinds, allOverlays, backendOf, compile, kindOf, placementResolver, rendererFor, scene, type MNode } from '../../../src/core/index.ts'

const build = (fn: (s: any) => void) => compile(scene({ title: 'runtime' }, fn))

describe('seed kinds', () => {
  test('every seed kind is registered through defineKind; 2D kinds have a backend, 3D backends are in the lazy chunk', () => {
    const names = allKinds().map((k) => k.name)
    for (const k of ['text', 'rect', 'circle', 'line', 'arrow', 'group', 'row', 'column', 'box', 'sphere', 'cylinder', 'cone', 'torus', 'tube', 'link', 'group3d']) expect(names).toContain(k)
    for (const k of ['text', 'rect', 'circle', 'line', 'arrow']) expect(backendOf(k)).toBeDefined()
    expect(backendOf('box')).toBeUndefined() // registered by src/r3d/three.ts, which this test never imports
    expect(rendererFor('2d')).toBeDefined()
    expect(rendererFor('3d')).toBeUndefined()
    for (const p of ['at', 'attach', 'nextTo', 'flow', 'between']) expect(placementResolver(p)).toBeDefined()
    expect(allOverlays().map((o) => o.name)).toEqual(expect.arrayContaining(['guide.labels', 'guide.caption']))
  })
  test('3D primitives: bounds, the seven anchors, signed distance', () => {
    let b: MNode, c: MNode, s: MNode, t: MNode, tb: MNode, cn: MNode
    const m = build(() => {
      b = box({ width: 2, height: 4, depth: 6 }).at(1, 0, 0)
      c = cylinder({ radius: 1, height: 3 })
      s = sphere({ radius: 2 })
      t = torus({ radius: 3, tube: 0.5 })
      tb = tube({ radius: 2, thickness: 0.5, height: 4 })
      cn = cone({ radius: 1, height: 2 })
    })
    const f = m.state(0)
    expect(f.bounds(b!)).toEqual({ min: [0, -2, -3], max: [2, 2, 3] })
    expect(f.anchor(b!, 'top')).toEqual([1, 2, 0])
    expect(f.anchor(b!, 'front')).toEqual([1, 0, 3])
    expect(f.anchor(b!, 'left')).toEqual([0, 0, 0])
    expect(f.anchor(cn!, 'tip')).toEqual([0, 1, 0])
    expect(f.localBounds(t!)).toEqual({ min: [-3.5, -0.5, -3.5], max: [3.5, 0.5, 3.5] })
    const sdf = (n: MNode, p: [number, number, number]): number => kindOf(n.kind)!.sdf!(n, f.props(n), p)
    expect(sdf(b!, [0, 0, 0])).toBe(-1)
    expect(sdf(b!, [3, 0, 0])).toBe(2)
    expect(sdf(c!, [0, 0, 0])).toBe(-1)
    expect(sdf(c!, [0, 2.5, 0])).toBe(1)
    expect(sdf(s!, [0, 3, 0])).toBe(1)
    expect(sdf(t!, [3, 0, 0])).toBe(-0.5)
    expect(sdf(tb!, [0, 0, 0])).toBe(1.5) // the bore is empty: 1.5 from the inner wall
    expect(sdf(tb!, [1.75, 0, 0])).toBe(-0.25)
    expect(f.hull(s!).length).toBeGreaterThan(8)
    for (const p of f.hull(c!)) expect(Math.hypot(p[0], p[2])).toBeCloseTo(1, 12)
  })
  test('3D rotate: axes of the parent, applied in call order, replaced per axis; tweens blend per axis', () => {
    let a: MNode
    const m = build((s) => {
      a = box().rotate({ about: 'x', deg: 90 }).rotate({ about: 'z', deg: 90 }).rotate({ about: 'x', deg: 90 })
      s.step('turn', (st: any) => { st.play((a as any).to.rotate({ about: 'z', deg: 180 }), { duration: 1, rate: (t: number) => t }) })
    })
    expect((a!.props.rotate as unknown[]).length).toBe(2)
    const up = (tau: number) => { const f = m.state(tau); const p = f.anchor(a!, 'top'); return p.map((x) => Math.round(x * 1e6) / 1e6 + 0) }
    // top (0, .5, 0) → about x 90 → (0, 0, .5) → about z: unchanged
    expect(up(0)).toEqual([0, 0, 0.5])
    expect(m.state(0.5).ownRotation(a!).every(Number.isFinite)).toBe(true)
    const rot = m.state(0.5).prop<{ about: string; deg: number }[]>(a!, 'rotate')
    expect(rot.map((r) => [r.about, r.deg])).toEqual([['x', 90], ['z', 135]])
  })
  test('text layout: size ladder, multi-line, bounds from the measurer', () => {
    const one = layoutText({ text: 'piston', size: 48, weight: 'normal', font: 'serif' })
    expect(one.em).toBeCloseTo(48 / 99, 12)
    expect(one.lines).toEqual(['piston'])
    expect(one.width).toBeGreaterThan(1)
    expect(one.width).toBeLessThan(2)
    const two = layoutText({ text: 'a\nbb', size: 48 })
    expect(two.lines.length).toBe(2)
    expect(two.height).toBeGreaterThan(one.height)
    let t: MNode
    const m = build(() => { t = text(() => 'load 20%', { size: 'note' }) })
    expect(m.state(0).prop(t!, 'text')).toBe('load 20%')
    expect(m.state(0).bounds(t!).max[0]).toBeGreaterThan(0.3)
  })
  test('getters are live points; bent lines report their midpoint', () => {
    let a: any, l: any, mid: any
    const m = build(() => { a = rect({ width: 2, height: 2 }); l = line([0, 0], [4, 0], { bend: 90 }); mid = l.pointAt(0.5) })
    const f = m.state(0)
    expect(f.run(() => a.top())).toEqual([0, 1, 0])
    const p = f.run(() => mid())
    expect(p[0]).toBeCloseTo(2, 12)
    expect(Math.abs(p[1])).toBeGreaterThan(0.3)
    void arrow
  })
})

describe('guide seed', () => {
  test('span syntax is stripped to the spoken words', () => {
    expect(stripSpans('The [piston](piston) slides down and the [intake valve](ring:intakeValve) opens.')).toBe('The piston slides down and the intake valve opens.')
    expect(stripSpans('Look [](focus:x) here.')).toBe('Look here.')
  })
  test('reading time: 16.5 chars/s plus pauses; st.say gives the step its length; sentences follow each other', () => {
    expect(speechSeconds('Hello.')).toBeCloseTo(6 / 16.5 + 0.36, 12)
    const m = build((s) => {
      s.step('talk', (st: any) => { st.say('One, two.'); st.say('Three.') })
    })
    const a = speechSeconds('One, two.'), b = speechSeconds('Three.')
    const lead = GUIDE_DEFAULTS.leadIn // the first sentence of a step waits this long, so the pointer can land on an early word
    expect(m.steps[0]!.active).toBeCloseTo(lead + a + b, 12)
    const says = m.actions.filter((x) => x.type === 'say')
    expect(says.map((x) => x.data.plain)).toEqual(['One, two.', 'Three.'])
    expect(says[1]!.t0).toBeCloseTo(lead + a, 12)
    expect(m.state(lead + a + 0.5).actions('say').at(-1)!.data.plain).toBe('Three.')
  })
  test('st.label defaults to the id; st.focus keeps descendants of a focused group lit', () => {
    let a: any, b: any, c: any
    const m = build((s) => {
      a = rect({ id: 'a' }); b = rect({ id: 'b' }); c = rect({ id: 'c' })
      const g = group([a, b])
      s.step('x', (st: any) => { st.label(a); st.label('c', 'third'); st.focus(g); st.wait(1) })
    })
    const f = m.state(m.steps[0]!.t1 - 0.001)
    expect(f.actions('label').map((x) => x.data.text)).toEqual(['a', 'third'])
    expect(f.dim(a)).toBe(0)
    expect(f.dim(b)).toBe(0)
    expect(f.dim(c)).toBe(1)
  })
})
