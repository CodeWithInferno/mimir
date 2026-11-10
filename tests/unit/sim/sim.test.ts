// The simulation helpers of the scene API (src/sim): pure functions of (story time, params), recomputed from t = 0.
import { describe, expect, test } from 'bun:test'
import { compile, scene, type SceneModel } from '../../../src/core/index.ts'
import '../../../src/r2d/index.ts'
import '../../../src/anim/index.ts'
import '../../../src/guide/index.ts'
import { circle } from '../../../src/r2d/index.ts'
import { events, integrate, ode, SIM_DEFAULTS, simsOf, stepper, storyTimeOf } from '../../../src/sim/index.ts'

const build = (fn: (s: any) => void): SceneModel => compile(scene({ title: 'sim test' }, fn))
const codes = (m: SceneModel): string[] => m.diagnostics.list.map((d) => d.code)

describe('ode()', () => {
  test('a harmonic oscillator follows cos(wt), and at() without a time is the state at s.t()', () => {
    let sim: any
    const m = build((s) => {
      sim = ode({ y0: { x: 1, v: 0 }, f: (_t, y) => ({ x: y.v, v: -4 * y.x }) })
      circle({ radius: 0.2 }).at(() => sim.value('x'), 0)
      s.step('swing', (st: any) => { st.wait(5) })
    })
    expect(codes(m)).toEqual([])
    for (const t of [0, 0.5, 1.5, 3.25]) expect(sim.value('x', t)).toBeCloseTo(Math.cos(2 * t), 6)
    expect(sim.value('x', 0.3712)).toBeCloseTo(Math.cos(0.7424), 4) // between two steps: linear interpolation
    const f = m.state(2.5)
    expect(f.run(() => sim.at().x)).toBeCloseTo(Math.cos(2 * f.t), 4)
    expect(f.run(() => sim.value('x'))).toBe(sim.value('x', f.t))
    expect(sim.series('x', 0, 1, 5).map((p: number[]) => p[0])).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(sim.dt).toBe(SIM_DEFAULTS.dt)
  })

  test('the same time gives bit-identical state whatever was asked before', () => {
    let a: any, b: any
    build(() => {
      const f = (_t: number, y: number[]): number[] => [y[1]!, -Math.sin(y[0]!) - 0.2 * y[1]!]
      a = ode({ y0: [1.2, 0], f })
      b = ode({ y0: [1.2, 0], f })
    })
    const times = [7.31, 0.004, 3.3, 12.75, 3.3, 0.5]
    const forward = [...times].sort((x, y) => x - y).map((t) => [t, a.at(t)])
    for (const t of [...times].reverse()) { const hit = forward.find((x) => x[0] === t)!; expect(b.at(t)).toEqual(hit[1]) }
  })

  test('a param the viewer pins restarts the run with that value; the cache is per value', () => {
    let sim: any, k: any
    const m = build((s) => {
      k = s.param('k', { value: 4, min: 1, max: 16 })
      sim = ode({ y0: { x: 1, v: 0 }, f: (_t, y) => ({ x: y.v, v: -k() * y.x }) })
      s.step('one', (st: any) => { st.wait(4) })
    })
    const base = m.state(2).run(() => sim.value('x', 1))
    const pinned = m.state(2, { k: 16 }).run(() => sim.value('x', 1))
    expect(base).toBeCloseTo(Math.cos(2), 6)
    expect(pinned).toBeCloseTo(Math.cos(4), 6)
    // back and forth: the first answer is still exactly the first answer
    expect(m.state(0.3).run(() => sim.value('x', 1))).toBe(base)
    expect(m.state(3.9, { k: 16 }).run(() => sim.value('x', 1))).toBe(pinned)
  })

  test('a param the story sweeps is felt as it changes: no jump of the history', () => {
    let sim: any, k: any
    const m = build((s) => {
      k = s.param('k', { value: 4, min: 1, max: 16 })
      sim = ode({ y0: { x: 1, v: 0 }, f: (_t, y) => ({ x: y.v, v: -k() * y.x }) })
      s.step('steady', (st: any) => { st.wait(2) })
      s.step('stiffer', (st: any) => { st.set(k, 16, { duration: 1 }); st.wait(2) })
    })
    expect(codes(m)).toEqual([])
    const t1 = m.steps[0]!.t1
    // before the sweep starts the run is the k = 4 run, also when asked from a frame after the sweep
    const late = m.state(m.duration - 0.01)
    expect(late.run(() => sim.value('x', 1))).toBeCloseTo(Math.cos(2), 6)
    // across the start of the sweep the state is continuous (it would jump by O(1) if the new k rewrote the past)
    const before = m.state(t1 - 1e-3).run(() => sim.value('x')), after = m.state(t1 + 1e-3).run(() => sim.value('x'))
    expect(Math.abs(after - before)).toBeLessThan(0.02)
    // and after the sweep it oscillates at the new frequency: energy x'^2 + 16 x^2 is conserved between two late times
    const energy = (t: number): number => { const y = late.run(() => sim.at(t)); return y.v * y.v + 16 * y.x * y.x }
    expect(energy(late.t - 0.3)).toBeCloseTo(energy(late.t - 1.1), 4)
  })

  test('bad options are diagnostics, never exceptions, and the result is inert', () => {
    let a: any, b: any, c: any
    const m = build(() => {
      a = (ode as any)(undefined)
      b = ode({ y0: { x: 1 }, f: 'no' as any, dt: -1, steps: 3 } as any)
      c = ode({ y0: [1], f: () => { throw new Error('boom') } })
    })
    expect(a.at(1)).toEqual([])
    expect(b.value('x', 2)).toBe(1)
    expect(c.at(1)).toEqual([1])
    const got = codes(m)
    expect(got).toContain('API-TYPE')
    expect(got).toContain('API-UNKNOWN')
    expect(got).toContain('NUM-INVALID')
    expect(got).toContain('RUNTIME-ERROR')
    expect(m.diagnostics.list.every((d) => d.fix.length > 0)).toBe(true)
  })

  test('a state that blows up is SIM-UNSTABLE with the line and a smaller step as the fix', () => {
    let sim: any
    const m = build(() => { sim = ode({ y0: [1], f: (_t, y) => [y[0]! * y[0]! * 50] }) })
    const y = sim.at(5)
    expect(Number.isFinite(y[0])).toBe(true) // the last finite state is held
    const d = m.diagnostics.byCode('SIM-UNSTABLE')[0]!
    expect(d.severity).toBe('error')
    expect(d.what).toContain('blows up at t=0.02')
    expect(d.fix[0]).toContain('dt:')
    expect(d.line).not.toBeNull()
  })

  test('a state that runs away but stays finite is SIM-UNSTABLE too, said once however many sliders ask, and held', () => {
    let sim: any
    const m = build((s) => {
      const k = s.param('k', { value: 100, min: 100, max: 40000 })
      sim = ode({ y0: { x: 1, v: 0 }, f: (_t, y) => ({ x: y.v, v: -k() * y.x }), dt: 0.02 }) // at k = 40000 the step is 4 radians: RK4 diverges
      s.step('run', (st: any) => { st.wait(4) })
    })
    expect(Math.abs(m.state(3).run(() => sim.value('x')))).toBeLessThanOrEqual(1.5)
    expect(m.diagnostics.byCode('SIM-UNSTABLE')).toEqual([])
    for (const k of [40000, 39000, 38000]) expect(Math.abs(m.state(3, { k }).run(() => sim.value('x')))).toBeLessThan(1e12)
    const list = m.diagnostics.byCode('SIM-UNSTABLE')
    expect(list.length).toBe(1)
    expect(list[0]!.what).toContain('when k = 40000 (its maximum)')
    expect(list[0]!.params).toEqual({ k: 40000 })
  })

  test('a function that reads its own simulation is reported instead of corrupting the cache', () => {
    let sim: any
    const m = build(() => { sim = ode({ y0: [1], f: (t) => [sim.value(0, t / 2)] }) })
    expect(Number.isFinite(sim.value(0, 1))).toBe(true)
    expect(m.diagnostics.byCode('RUNTIME-ERROR')[0]!.what).toContain('depend on itself')
  })

  test('check can measure convergence: a stiff equation on a coarse step drifts, a gentle one does not', () => {
    const m = build((s) => {
      ode({ y0: { x: 1, v: 0 }, f: (_t, y) => ({ x: y.v, v: -3600 * y.x }), dt: 0.02 }) // 1.2 radians per step
      ode({ y0: { x: 1, v: 0 }, f: (_t, y) => ({ x: y.v, v: -4 * y.x }) })
      s.step('run', (st: any) => { st.wait(3) })
    })
    const [stiff, gentle] = simsOf(m)
    const frame = m.state(2.5)
    expect(stiff!.drift(frame)!.share).toBeGreaterThan(stiff!.tolerance)
    expect(gentle!.drift(frame)!.share).toBeLessThan(1e-6)
    expect(gentle!.drift(m.state(0))).toBeNull()
  })
})

describe('events()', () => {
  const make = (): any => events({
    init: { waiting: 0, served: 0 }, seed: 7,
    next: (state: { waiting: number; served: number }, rng) => (state.served >= 20 ? null : rng.chance(0.6) || state.waiting === 0
      ? { after: rng.exponential(0.5), label: 'arrive', apply: (s) => { s.waiting++ } }
      : { after: rng.exponential(0.4), label: 'serve', apply: (s) => { s.waiting--; s.served++ } }),
  })
  test('seeded: two runs agree, any order of questions agrees, the state is frozen', () => {
    let a: any, b: any
    const m = build((s) => { a = make(); b = make(); s.step('run', (st: any) => { st.wait(6) }) })
    expect(codes(m)).toEqual([])
    const times = [5.5, 0.2, 3.1, 9, 1.7]
    const first = times.map((t) => a.at(t))
    for (const t of [...times].reverse()) expect(b.at(t)).toEqual(first[times.indexOf(t)])
    expect(Object.isFrozen(a.at(3))).toBe(true)
    expect(a.entry(0).label).toBe('init')
    const h = a.history(4)
    expect(h.length).toBeGreaterThan(2)
    expect(h.every((e: any, i: number) => i === 0 || e.t >= h[i - 1].t)).toBe(true)
    // without a time: the state at s.t()
    const f = m.state(3)
    expect(f.run(() => a.at())).toEqual(a.at(f.t))
    expect(f.run(() => a.entry().t)).toBeLessThanOrEqual(f.t)
  })
  test('a rate read from a param is read at the moment of each event', () => {
    let sim: any, gap: any
    const m = build((s) => {
      gap = s.param('gap', { value: 1, min: 0.1, max: 2 })
      sim = events({ init: 0, next: () => ({ after: gap(), apply: (n: number) => n + 1 }) })
      s.step('slow', (st: any) => { st.wait(4) })
      s.step('fast', (st: any) => { st.set(gap, 0.25, { duration: 0.01 }); st.wait(3) })
    })
    const t1 = m.steps[0]!.t1
    const late = m.state(m.duration - 0.01)
    // one event per second during the first step, four per second afterwards
    expect(late.run(() => sim.at(t1 - 0.5))).toBe(Math.floor(t1 - 0.5))
    const during = late.run(() => sim.at(t1 + 2.5) - sim.at(t1 + 1.5))
    expect(during).toBe(4)
    expect(m.state(1, { gap: 0.5 }).run(() => sim.at(2.01))).toBe(4)
  })
  test('bad input is reported', () => {
    let sim: any
    const m = build(() => { sim = (events as any)({ init: 1, nxt: 2 }) })
    expect(sim.at(3)).toBe(1)
    expect(codes(m)).toContain('API-TYPE')
    expect(codes(m)).toContain('API-UNKNOWN')
  })
})

describe('stepper()', () => {
  test('a list and a generator, by index and by time', () => {
    let list: any, gen: any
    const m = build((s) => {
      list = stepper([{ n: 1 }, { n: 2 }, { n: 3 }])
      gen = stepper(function* () { const state = { x: 8 }; while (state.x >= 1) { yield state; state.x /= 2 } }, { stepSeconds: 0.5 })
      s.step('run', (st: any) => { st.wait(3) })
    })
    expect(codes(m)).toEqual([])
    expect(list.count).toBe(3)
    expect(list.at(-4).n).toBe(1)
    expect(list.at(99).n).toBe(3)
    expect(list.atTime(1.4).n).toBe(2)
    expect(gen.states.map((v: any) => v.x)).toEqual([8, 4, 2, 1]) // one mutated object, four distinct states
    expect(gen.atTime(0.75).x).toBe(4)
    expect(gen.phase(0.75)).toEqual({ index: 1, progress: 0.5 })
    const f = m.state(1.2)
    expect(f.run(() => gen.atTime().x)).toBe(gen.atTime(f.t).x)
  })
  test('a generator that reads a param is run again when the param has another value', () => {
    let run: any
    const m = build((s) => {
      const rate = s.param('rate', { value: 0.5, min: 0.1, max: 0.9 })
      run = stepper(function* () { let x = 1; for (let i = 0; i < 4; i++) { yield x; x *= 1 - rate() } })
    })
    expect(run.states).toEqual([1, 0.5, 0.25, 0.125])
    expect(m.state(0, { rate: 0.9 }).run(() => run.at(1))).toBeCloseTo(0.1, 12)
    expect(run.at(1)).toBe(0.5)
  })
  test('something that is not a list of states is reported', () => {
    let bad: any
    const m = build(() => { bad = stepper(5 as any, { stepSecnds: 1 } as any) })
    expect(bad.count).toBe(0)
    expect(codes(m)).toContain('API-TYPE')
    expect(codes(m)).toContain('API-UNKNOWN')
  })
})

describe('integrate()', () => {
  test('a constant rate is rate × time; the value is a dynamic number', () => {
    let angle: any
    const m = build((s) => { angle = integrate(() => 90); s.step('turn', (st: any) => { st.wait(4) }) })
    expect(codes(m)).toEqual([])
    const f = m.state(2)
    expect(f.run(() => angle())).toBeCloseTo(90 * f.t, 9)
    expect(angle.at(1.5)).toBeCloseTo(135, 9)
  })
  test('a speed the story sweeps gives an angle that never jumps, equal to the area under the speed', () => {
    let angle: any, rpm: any
    const m = build((s) => {
      rpm = s.param('rpm', { value: 10, min: 0, max: 100 })
      angle = integrate(() => rpm() * 6)
      s.step('slow', (st: any) => { st.wait(2) })
      s.step('speed up', (st: any) => { st.set(rpm, 60, { duration: 2, rate: (u: number) => u }); st.wait(3) })
    })
    expect(codes(m)).toEqual([])
    const t1 = m.steps[0]!.t1
    const at = (tau: number): number => m.state(tau).run(() => angle())
    expect(at(t1)).toBeCloseTo(60 * t1, 6)
    // linear ramp of the speed from 60 to 360 deg/s over 2 s: the area is a trapezoid
    expect(at(t1 + 2)).toBeCloseTo(60 * t1 + (60 + 360), 3)
    expect(at(t1 + 3)).toBeCloseTo(60 * t1 + 420 + 360, 3)
    // no jump: neighbouring frames differ by about rate × dt (speed × time would jump by hundreds of degrees)
    for (const tau of [t1 + 0.4, t1 + 1.3]) expect(Math.abs(at(tau + 0.01) - at(tau))).toBeLessThan(4)
    // a slider the viewer holds is a constant speed
    expect(m.state(3, { rpm: 100 }).run(() => angle())).toBeCloseTo(600 * 3, 6)
    // order does not matter
    const again = [t1 + 3, 0.5, t1 + 1].map(at)
    expect(again).toEqual([at(t1 + 3), at(0.5), at(t1 + 1)])
  })
  test('the clock of a step (st.clock) is respected', () => {
    let angle: any
    const m = build((s) => {
      angle = integrate(() => 10)
      s.step('normal', (st: any) => { st.wait(2) })
      s.step('frozen', (st: any) => { st.clock({ freeze: true }); st.wait(2) })
    })
    const t1 = m.steps[0]!.t1
    expect(m.state(m.duration).run(() => angle())).toBeCloseTo(10 * t1, 9)
    expect(storyTimeOf(m, t1 / 2)).toBeCloseTo(t1 / 2, 12)
  })
  test('bad input is reported and counts as zero', () => {
    let a: any, b: any
    const m = build(() => { a = integrate('fast' as any); b = integrate(() => NaN) })
    expect(a()).toBe(0)
    expect(b.at(2)).toBe(0)
    expect(codes(m)).toContain('API-TYPE')
    expect(codes(m)).toContain('NUM-INVALID')
  })
})
