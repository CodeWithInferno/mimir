// Step transitions (src/anim/transitions.ts), the rate functions as the public API exports them, and purity:
// the same time gives the same state whatever was asked before.
import { describe, expect, test } from 'bun:test'
import { circle, rect, text } from '../../../src/r2d/index.ts'
import { derive, fadeTransform, grow, leaveBeforeArrive, marksThatWait, moveAlong, TRANSITION_DEFAULTS } from '../../../src/anim/index.ts'
import { api as coreApi, PACE, selector, smooth, type SceneModel } from '../../../src/core/index.ts'
import ref from '../core/fixtures/rate_ref.json'
import { build, codes } from '../core/helpers.ts'

describe('steady: a state two steps in a row declare does not blink between them', () => {
  const scene = (steady: boolean) => {
    let a: any, b: any, c: any
    const m = build((s) => {
      if (!steady) s.transitions({ steady: false })
      a = rect({ id: 'a' }); b = rect({ id: 'b' }); c = rect({ id: 'c' })
      s.step('one', (st: any) => { st.focus(a) }) // b and c are pushed back
      s.step('two', (st: any) => { st.focus(b) }) // a and c are pushed back
      s.step('three', (st: any) => { st.wait(1) })
    })
    return { m, a, b, c }
  }
  test('without the rule something dimmed in both steps brightens and darkens again (this is what the rule removes)', () => {
    const { m, c } = scene(false)
    const t = m.steps[1]!.t0
    const dip = Math.min(...[0.1, 0.2, 0.3].map((u) => m.state(t + u).dim(c)))
    expect(dip).toBeLessThan(0.8)
  })
  test('with it: what stays dimmed stays, what is newly dimmed eases in, what is released eases out', () => {
    const { m, a, b, c } = scene(true)
    expect(codes(m)).toEqual([])
    const t = m.steps[1]!.t0
    for (const u of [0, 0.05, 0.1, 0.2, 0.3, 0.39, 0.5, 1]) expect(m.state(t + u).dim(c)).toBe(1)
    expect(m.state(t + 0.2).dim(a)).toBeCloseTo(smooth(0.5), 12) // newly pushed back
    expect(m.state(t + 0.2).dim(b)).toBeCloseTo(1 - smooth(0.5), 12) // newly in focus
    expect(m.state(t + 0.4).dim(a)).toBe(1)
    expect(m.state(t + 0.4).dim(b)).toBe(0)
    // and it all clears when no step declares it any more
    const t3 = m.steps[2]!.t0
    expect(m.state(t3 + 0.2).dim(c)).toBeCloseTo(1 - smooth(0.5), 12)
    expect(m.state(t3 + 0.4).dim(c)).toBe(0)
  })
  test('the same holds for a step-scoped clip on one object, and only while the old state is still leaving', () => {
    let a: any, b: any
    const m = build((s) => {
      a = rect(); b = rect()
      s.step('one', (st: any) => { st.clip(a, 'dim', 1, { duration: 0.4, scope: 'step' }); st.clip(selector((n: any) => n === b), 'dim', 1, { duration: 0.4, scope: 'step' }) })
      s.step('two', (st: any) => { st.clip(a, 'dim', 1, { duration: 0.4, scope: 'step' }); st.wait(1); st.clip(b, 'dim', 1, { duration: 0.4, scope: 'step' }) })
    })
    const t = m.steps[1]!.t0
    expect(m.state(t + 0.2).dim(a)).toBe(1)
    expect(m.state(t + 0.5).dim(b)).toBe(0) // declared again a second later: it had left, and comes back
    expect(m.state(t + 1.4).dim(b)).toBe(1)
  })
})

describe('leave before arrive', () => {
  const starts = (m: SceneModel) => m.actions.filter((a) => a.type === 'label').map((a) => Math.round((a.t0 - m.steps[a.step]!.t0) * 1e9) / 1e9)
  test('a label waits for most of the time the labels of the step before take to leave; the first step and other kinds do not wait', () => {
    const m = build((s) => {
      const a = rect({ id: 'a' }), b = rect({ id: 'b' })
      s.step('one', (st: any) => { st.say('first'); st.label(a, 'a') })
      s.step('two', (st: any) => { st.say('second'); st.label(b, 'b') })
    })
    expect(starts(m)).toEqual([0, Math.round(PACE.scopedOut * TRANSITION_DEFAULTS.overlap * 1e9) / 1e9])
    expect(m.actions.filter((a) => a.type === 'say').map((a) => a.t0 - m.steps[a.step]!.t0)).toEqual([0, 0])
    const second = m.actions.filter((a) => a.type === 'label')[1]!
    expect(second.t1 - second.t0).toBeCloseTo(PACE.scopedIn, 12)
  })
  test('s.transitions({ overlap }) sets the wait; 0 is a cross-fade; bad options are reported', () => {
    const make = (opts: unknown) => build((s) => {
      s.transitions(opts)
      const a = rect({ id: 'a' })
      s.step('one', (st: any) => { st.label(a, 'a') })
      s.step('two', (st: any) => { st.label(a, 'b') })
    })
    expect(starts(make({ overlap: 0 }))).toEqual([0, 0])
    expect(starts(make({ overlap: 1 }))).toEqual([0, PACE.scopedOut])
    const bad = make({ overlap: 3, stedy: true })
    expect(codes(bad).sort()).toEqual(['API-UNKNOWN', 'NUM-INVALID'])
    expect(starts(bad)).toEqual([0, Math.round(PACE.scopedOut * TRANSITION_DEFAULTS.overlap * 1e9) / 1e9])
  })
  test('a label that starts later than the wait, or follows a step without labels, keeps its time', () => {
    const m = build((s) => {
      const a = rect({ id: 'a' })
      s.step('one', (st: any) => { st.label(a, 'a') })
      s.step('two', (st: any) => { st.wait(1); st.label(a, 'late') })
      s.step('three', (st: any) => { st.wait(1) })
      s.step('four', (st: any) => { st.label(a, 'again') })
    })
    expect(starts(m)).toEqual([0, 1, 0])
  })
  test('a module registers the marks it draws', () => {
    expect(marksThatWait()).toContain('label')
    leaveBeforeArrive('animTestMark')
    expect(marksThatWait()).toContain('animTestMark')
  })
})

describe('rate functions, as scenes get them', () => {
  const table = ref as Record<string, number[]>
  const api = coreApi as unknown as Record<string, (t: number) => number>
  const names: [string, string][] = [
    ['smooth', 'smooth'], ['linear', 'linear'], ['rush_into', 'rushInto'], ['rush_from', 'rushFrom'], ['slow_into', 'slowInto'], ['double_smooth', 'doubleSmooth'],
    ['there_and_back', 'thereAndBack'], ['there_and_back_with_pause', 'thereAndBackWithPause'], ['running_start', 'runningStart'], ['overshoot', 'overshoot'],
    ['wiggle', 'wiggle'], ['exponential_decay', 'exponentialDecay'],
  ]
  for (const [snake, camel] of names) {
    test(`${snake} is exported under both spellings and matches the reference`, () => {
      expect(typeof api[snake]).toBe('function')
      expect(api[snake]).toBe(api[camel]!)
      const want = table[camel]!
      expect(want).toBeDefined()
      let worst = 0
      for (let i = 0; i < want.length; i++) worst = Math.max(worst, Math.abs(api[snake]!(i / (want.length - 1)) - want[i]!))
      expect(worst).toBeLessThan(1e-12)
    })
  }
  test('lingering, and the rates that are made from another', () => {
    expect(api.lingering!(0.4)).toBeCloseTo(0.5, 12)
    expect(api.lingering!(0.9)).toBe(1)
    const nqt = (coreApi as any).not_quite_there(), sq = (coreApi as any).squish_rate_func(coreApi.smooth, 0.25, 0.75)
    expect(nqt(1)).toBeCloseTo(0.7, 12)
    expect([sq(0.2), sq(0.5), sq(0.8)]).toEqual([0, 0.5, 1])
    expect((coreApi as any).bezier([0, 0, 1, 1])(0.5)).toBeCloseTo(0.5, 12)
  })
})

describe('purity', () => {
  test('the same time gives the same state in any order, and measuring at rest leaves nothing behind', () => {
    let a: any, b: any, t1: any, t2: any, d: any, ring: any
    const m = build((s) => {
      a = circle({ radius: 1 }).at(-3, 0); b = rect().at(3, 1)
      t1 = text('one').at(-3, 2); t2 = text('two').at(3, -2)
      ring = circle({ radius: 1.5 }).at(0, 0); d = circle({ radius: 0.1 }).at(ring.right)
      s.step('x', (st: any) => { st.play(derive(a, b), fadeTransform(t1, t2), moveAlong(d, ring), grow(rect().at(0, 3), { from: 'left' }), { duration: 2 }) })
    })
    expect(codes(m)).toEqual([])
    const times = [0, 0.37, 0.9, 1.3, 1.99, 2, 2.6]
    const forward = times.map((t) => m.state(t).signature())
    const backward = [...times].reverse().map((t) => m.state(t).signature()).reverse()
    expect(backward).toEqual(forward)
    // one frame asked in a different order of questions
    const f = m.state(0.9), g = m.state(0.9)
    const p1 = [f.world(t2).p, f.world(t1).p, f.bounds(t2)]
    const p2 = [g.bounds(t2), g.world(t1).p, g.world(t2).p]
    expect(p1).toEqual([p2[2], p2[1], p2[0]] as any)
    expect(new Set(forward).size).toBeGreaterThan(4)
  })
})
