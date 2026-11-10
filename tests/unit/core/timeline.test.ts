import { describe, expect, test } from 'bun:test'
import { rect, text, circle, group } from '../../../src/r2d/index.ts'
import { box } from '../../../src/r3d/index.ts'
import { create, fadeIn, fadeOut, write } from '../../../src/anim/index.ts'
import { all, lagged, seq, linear, smooth, api } from '../../../src/core/index.ts'
import { build, codes, near } from './helpers.ts'

const { BLUE, RED } = api

describe('timeline: recorder and step compiler', () => {
  test('cursor: play advances it, wait holds, a step ends on a 1 s hold; steps follow each other', () => {
    let a: any
    const m = build((s) => {
      a = rect()
      s.step('one', (st: any) => { st.play(a.to.shift(1, 0)); st.wait(0.5); st.play(a.to.shift(0, 1), { duration: 1 }) }) // 1 + 0.5 + 1 (a play is 1 s: DESIGN §3.3)
      s.step('two', (st: any) => { st.wait() })
    })
    expect(m.steps.map((s) => [s.t0, s.active, s.t1])).toEqual([[0, 2.5, 3.5], [3.5, 1, 5.5]])
    expect(m.duration).toBe(5.5)
    expect(m.locate(3.4)).toEqual({ k: 0, u: 3.4 })
    expect(m.locate(3.5)).toEqual({ k: 1, u: 0 })
    expect(m.locate(5.5).k).toBe(1)
  })
  test('persistent clips fold forward like manim: later steps start from the end state of earlier ones', () => {
    let a: any
    const m = build((s) => {
      a = rect().at(0, 0)
      s.step('right', (st: any) => { st.play(a.to.shift(2, 0), { duration: 1, rate: linear }) })
      s.step('up', (st: any) => { st.play(a.to.shift(0, 3).color(RED), { duration: 1, rate: linear }) })
    })
    expect(m.state(0.5).world(a).p).toEqual([1, 0, 0])
    expect(m.state(1.5).world(a).p).toEqual([2, 0, 0])
    expect(m.state(2.5).world(a).p).toEqual([2, 1.5, 0]) // m.shift accumulates on the latest value
    expect(m.state(4).world(a).p).toEqual([2, 3, 0])
    expect(m.state(4).prop(a, 'color')).toBe(RED)
    expect(m.state(1.9).prop(a, 'color')).toBe('#FFFFFF')
  })
  test('default easing is smooth; a rate can be passed per play', () => {
    let a: any, b: any
    const m = build((s) => {
      a = rect(); b = rect()
      s.step('x', (st: any) => { st.play(a.to.shift(1, 0), b.to.shift(1, 0), { duration: 2 }) })
    })
    expect(m.state(0.5).world(a).p[0]).toBeCloseTo(smooth(0.25), 12)
    expect(m.state(0.5).world(b).p[0]).toBeCloseTo(smooth(0.25), 12)
  })
  test('all / seq / lagged timings (lag × previous duration)', () => {
    let a: any, b: any, c: any
    const m = build((s) => {
      a = rect(); b = rect(); c = rect()
      const mv = (n: any) => n.to.shift(1, 0)
      s.step('lagged', (st: any) => { st.play(lagged([mv(a), mv(b), mv(c)], { lag: 0.5 }), { rate: linear }) }) // each 1 s, starts 0, 0.5, 1 → 2 s
      s.step('seq', (st: any) => { st.play(seq(mv(a), mv(b)), { rate: linear }) }) // 2 s
      s.step('all', (st: any) => { st.play(all(mv(a), mv(b)), mv(c), { duration: 1, rate: linear }) })
    })
    expect(m.steps[0]!.active).toBe(2)
    const f = m.state(0.75)
    expect([f.world(a).p[0], f.world(b).p[0], f.world(c).p[0]]).toEqual([0.75, 0.25, 0])
    expect(m.steps[1]!.active).toBe(2)
    const g = m.state(m.steps[1]!.t0 + 1.5)
    expect([g.world(a).p[0], g.world(b).p[0]]).toEqual([2, 1.5])
    expect(m.steps[2]!.active).toBe(1)
    const h = m.state(m.steps[2]!.t0 + 0.5)
    expect([h.world(a).p[0], h.world(b).p[0], h.world(c).p[0]]).toEqual([2.5, 2.5, 1.5])
  })
  test('play({ lag }) staggers its animations', () => {
    let a: any, b: any
    const m = build((s) => { a = rect(); b = rect(); s.step('x', (st: any) => { st.play(a.to.shift(1, 0), b.to.shift(1, 0), { lag: 0.5, rate: linear }) }) })
    expect(m.steps[0]!.active).toBe(1.5)
    expect(m.state(0.5).world(b).p[0]).toBe(0)
    expect(m.state(1).world(b).p[0]).toBe(0.5)
  })
  test('setters inside a step are an instant change at the cursor, not a change of the past', () => {
    let a: any
    const m = build((s) => {
      a = rect().color(BLUE)
      s.step('x', (st: any) => { st.wait(1); a.color(RED); st.wait(1) })
    })
    expect(m.state(0.99).prop(a, 'color')).toBe(BLUE)
    expect(m.state(1).prop(a, 'color')).toBe(RED)
  })
  test('enter-verb lifetime: hidden before its first enter, visible from 0 otherwise, fadeOut ends it', () => {
    let always: any, later: any, gone: any
    const m = build((s) => {
      always = rect({ id: 'always' }); later = rect({ id: 'later' }); gone = rect({ id: 'gone' })
      s.step('one', (st: any) => { st.wait(1) })
      s.step('two', (st: any) => { st.play(fadeIn(later), fadeOut(gone)) })
    })
    const t2 = m.steps[1]!.t0
    expect(m.state(0).visible(always)).toBe(true)
    expect(m.state(0).visible(later)).toBe(false)
    expect(m.state(0).visible(gone)).toBe(true)
    expect(m.state(t2 + 0.5).reveal(later)).toEqual({ p: 0.5, mode: 'fade' })
    expect(m.state(t2 + 1).visible(later)).toBe(true)
    expect(m.state(t2 + 1).visible(gone)).toBe(false)
    expect(m.state(m.duration).visible(gone)).toBe(false)
  })
  test('an object created inside a step without an enter verb appears at that moment, not at 0', () => {
    let n: any
    const m = build((s) => {
      s.step('one', (st: any) => { st.wait(1) })
      s.step('two', (st: any) => { st.wait(0.5); n = text('now') })
    })
    expect(m.state(0).visible(n)).toBe(false)
    expect(m.state(2.4).visible(n)).toBe(false)
    expect(m.state(2.5).visible(n)).toBe(true)
  })
  test('create and write set the reveal mode; write is linear and takes 2 s from 15 glyphs', () => {
    let a: any, short: any, long: any
    const m = build((s) => {
      a = circle(); short = text('piston'); long = text('a much longer piece of text')
      s.step('x', (st: any) => { st.play(create(a)); st.play(write(short)); st.play(write(long)) })
    })
    expect(m.steps[0]!.active).toBe(1 + 1 + 2)
    expect(m.state(0.5).reveal(a)).toEqual({ p: 0.5, mode: 'create' })
    expect(m.state(1.25).reveal(short)).toEqual({ p: 0.25, mode: 'write' })
    expect(m.state(3).reveal(long)).toEqual({ p: 0.5, mode: 'write' })
  })
  test('fadeIn with shift arrives along the shift; with scale it grows to its size', () => {
    let a: any
    const m = build((s) => { a = rect().at(1, 1); s.step('x', (st: any) => { st.play(fadeIn(a, { shift: [0, 1], scale: 0.5, rate: linear })) }) })
    expect(near(m.state(0.5).world(a).p, [1, 0.5, 0])).toBe(true)
    expect(m.state(0.5).world(a).s).toBe(0.75)
    expect(near(m.state(1).world(a).p, [1, 1, 0])).toBe(true)
    expect(m.state(1).world(a).s).toBe(1)
  })
  test('a group\'s enter reveals its children', () => {
    let a: any, b: any, g: any
    const m = build((s) => { a = rect(); b = rect(); g = group([a, b]); s.step('x', (st: any) => { st.wait(1); st.play(fadeIn(g, { rate: linear })) }) })
    expect(m.state(0).visible(a)).toBe(false)
    expect(m.state(1.5).reveal(a)).toEqual({ p: 0.5, mode: 'fade' })
    expect(m.state(1.5).reveal(b).p).toBe(0.5)
    expect(m.state(2).visible(b)).toBe(true)
    expect(g.children.length).toBe(2)
  })
  test('step-scoped vs persistent: focus and labels belong to their step and clear over the start of the next', () => {
    let a: any, b: any
    const m = build((s) => {
      a = rect({ id: 'a' }); b = rect({ id: 'b' })
      s.step('one', (st: any) => { st.focus(a); st.label(a, 'the part'); st.play(a.to.color(RED)) })
      s.step('two', (st: any) => { st.wait(2) })
    })
    const end1 = m.steps[0]!.t1
    expect(m.state(end1 - 0.001).dim(b)).toBe(1)
    expect(m.state(end1 - 0.001).dim(a)).toBe(0)
    expect(m.state(end1 - 0.001).actions('label').map((x) => [x.data.text, x.env])).toEqual([['the part', 1]])
    // persistent: the colour stays; scoped: dim and label ease out over 0.4 s and are gone after
    expect(m.state(end1 + 0.2).dim(b)).toBeCloseTo(0.5, 12)
    expect(m.state(end1 + 0.2).actions('label')[0]!.env).toBeCloseTo(0.5, 12)
    expect(m.state(end1 + 0.4).dim(b)).toBe(0)
    expect(m.state(end1 + 0.4).actions('label')).toEqual([])
    expect(m.state(end1 + 1).prop(a, 'color')).toBe(RED)
    // scoped marks of the last step stay until the end of the story
    const m2 = build((s) => { const x = rect(); const y = rect(); s.step('only', (st: any) => { st.focus(x); st.wait(1) }); void y })
    expect(m2.state(m2.duration).dim(m2.nodes[1]!)).toBe(1)
  })
  test('any step is renderable alone: state at a step equals the fold of everything before it', () => {
    const make = (upTo: number) => build((s) => {
      const p = s.param('angle', { value: 0, min: 0, max: 360 })
      const a = rect({ id: 'a' }).at(() => [p() / 90, 0])
      const b = rect({ id: 'b' })
      const steps: ((st: any) => void)[] = [
        (st) => { st.set(p, 90); st.play(b.to.shift(0, 1)) },
        (st) => { st.set(p, 180); st.focus(a); st.play(b.to.color(RED)) },
        (st) => { st.set(p, 360); st.label(b, 'b') },
      ]
      steps.slice(0, upTo).forEach((fn, i) => s.step(`s${i + 1}`, fn))
    })
    const full = make(3)
    // jumping straight to the end of step 3 gives the same state as the scene that was recorded step by step
    const sigEnd = full.state(full.steps[2]!.t1 - 0.001).signature()
    expect(make(3).state(full.steps[2]!.t1 - 0.001).signature()).toBe(sigEnd)
    // the end of step 2 in the 3-step scene equals the end of the 2-step scene (later steps do not leak back)
    const end2 = full.steps[1]!.t1 - 0.001
    expect(full.state(end2).signature()).toBe(make(2).state(end2).signature())
    // and scoped marks of step 2 are not part of step 3's end state
    expect(full.state(full.steps[2]!.t1 - 0.001).dim(full.byId.get('b')!)).toBe(0)
  })
  test('determinism: state(τ) is identical when sampled out of order, on fresh frames, and after other samples', () => {
    const m = build((s) => {
      const p = s.param('angle', { value: 0, min: 0, max: 360 })
      const a = rect({ id: 'a' }).rotate(() => p())
      const b = box({ id: 'b' }).rotate({ about: 'y', deg: p }).at(() => [Math.sin(s.t()), 0, 0])
      const c = text(() => `t=${s.t().toFixed(2)}`).nextTo(a, 'down')
      s.step('one', (st: any) => { st.say('first'); st.set(p, 120); st.play(fadeIn(c)); st.camera({ view: 'front' }) })
      s.step('two', (st: any) => { st.set(p, 360); st.focus(b); st.label(a) })
    })
    const taus = [0, 0.37, 1.5, 2.999, 4.2, 5.01, 7.3, m.duration]
    const forward = taus.map((t) => m.state(t).signature())
    const backward = [...taus].reverse().map((t) => m.state(t).signature()).reverse()
    const shuffled = [3, 0, 6, 1, 7, 2, 5, 4].map((i) => [i, m.state(taus[i]!).signature()] as const)
    expect(backward).toEqual(forward)
    for (const [i, sig] of shuffled) expect(sig).toBe(forward[i]!)
    expect(new Set(forward).size).toBeGreaterThan(5) // and the states do differ over time
    // overrides are part of the input: same (τ, params) → same state; different params → different state
    expect(m.state(1.5, { angle: 45 }).signature()).toBe(m.state(1.5, { angle: 45 }).signature())
    expect(m.state(1.5, { angle: 45 }).signature()).not.toBe(m.state(1.5).signature())
    expect(codes(m)).toEqual([])
  })
  test('state(τ) is total: out-of-range and non-finite times clamp', () => {
    const m = build((s) => { rect(); s.step('x', (st: any) => { st.wait(1) }) })
    expect(m.state(-5).tau).toBe(0)
    expect(m.state(99).tau).toBe(m.duration)
    expect(m.state(NaN).tau).toBe(0)
  })
  test('a scene without steps still has a playable span', () => {
    const m = build(() => { rect() })
    expect(m.steps.length).toBe(1)
    expect(m.duration).toBe(4)
  })
  test('st.camera records a persistent pose; views are named; the default is an auto-fit iso', () => {
    const m = build((s) => {
      box({ width: 4, height: 2, depth: 2 })
      s.step('front', (st: any) => { st.camera({ view: 'front' }) })
      s.step('hold', (st: any) => { st.wait(1) })
    })
    const base = m.state(0).camera()
    expect(base.azimuth).toBe(35)
    expect(base.elevation).toBe(24)
    expect(base.distance).toBeGreaterThan(4)
    const mid = m.state(1).camera()
    expect(mid.azimuth).toBeGreaterThan(0)
    expect(mid.azimuth).toBeLessThan(35)
    expect(m.state(2).camera()).toMatchObject({ azimuth: 0, elevation: 0 })
    expect(m.state(m.duration).camera()).toMatchObject({ azimuth: 0, elevation: 0 }) // persists
    expect(m.state(0, {}, 'top').camera().elevation).toBe(90) // a view override wins
    // everything stays inside the panel with the fitted pose
    for (const t of [0, 2]) for (const p of m.state(t).subject()) { const q = m.state(t).project3(p); expect(q.visible).toBe(true) }
  })
  test('bad step calls are reported, not thrown', () => {
    const m = build((s) => {
      const a = rect({ id: 'a' })
      s.step('x', (st: any) => { st.play(a); st.play(undefined); st.wait(-1); st.set('nope', 3); st.camera({ view: 'isometric' }); st.play(a.to.shift(1, 0), { duraton: 2 }) })
    })
    expect(codes(m)).toEqual(['API-TYPE', 'REF-MISSING', 'NUM-INVALID', 'REF-MISSING', 'API-UNKNOWN', 'API-UNKNOWN'])
    expect(m.diagnostics.list[0]!.fix[0]).toBe('st.play(fadeIn(a))')
    expect(m.diagnostics.list[4]!.fix[0]).toContain('iso')
    expect(m.diagnostics.list[5]!.fix[0]).toContain('duration')
    expect(m.steps[0]!.active).toBe(1)
  })
})
