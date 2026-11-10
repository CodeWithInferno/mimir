import { describe, expect, test } from 'bun:test'
import { rect } from '../../../src/r2d/index.ts'
import { makeRng } from '../../../src/core/index.ts'
import { build, codes } from './helpers.ts'

describe('params and signals', () => {
  test('a param is a callable signal: default while building, folded value per frame, pinned by an override', () => {
    let p: any
    const seen: number[] = []
    const m = build((s) => {
      p = s.param('speed', { value: 2, min: 0, max: 10, unit: 'm/s' })
      seen.push(p(), p.value)
      s.step('go', (st: any) => { st.set(p, 10, { duration: 2, rate: (t: number) => t }) })
    })
    expect(seen).toEqual([2, 2])
    expect(m.params[0]).toMatchObject({ name: 'speed', kind: 'number', value: 2, min: 0, max: 10, unit: 'm/s' })
    expect(m.state(0).param(m.params[0]!)).toBe(2)
    expect(m.state(1).param(m.params[0]!)).toBe(6)
    expect(m.state(2).param(m.params[0]!)).toBe(10)
    expect(m.state(1, { speed: 7 }).param(m.params[0]!)).toBe(7)
    expect(m.state(1).run(() => p())).toBe(6)
    expect(codes(m)).toEqual([])
  })
  test('st.set sweeps the whole step by default (3 s when nothing else gives the step a length)', () => {
    let p: any
    const m = build((s) => {
      p = s.param('a', { value: 0, min: 0, max: 100 })
      s.step('sweep', (st: any) => { st.set(p, 100, { rate: (t: number) => t }) })
    })
    expect(m.steps[0]).toMatchObject({ t0: 0, active: 3, t1: 4 })
    expect(m.state(1.5).param(m.params[0]!)).toBeCloseTo(50, 12)
    expect(m.state(3).param(m.params[0]!)).toBe(100)
    expect(m.state(3.9).param(m.params[0]!)).toBe(100)
  })
  test('toggle and choice; unknown choice value is reported with a suggestion', () => {
    let on: any, mode: any
    const m = build((s) => {
      on = s.toggle('lights', { value: false })
      mode = s.choice('mode', { options: ['slow', 'fast'], value: 'fats' })
      s.step('a', (st: any) => { st.set(on, true); st.set(mode, 'fast'); st.wait(1) })
    })
    expect(m.state(0, {}).param(m.params[0]!)).toBe(true) // instant at the step's cursor (t = 0)
    expect(m.state(0.5).param(m.params[1]!)).toBe('fast')
    const d = m.diagnostics.byCode('API-UNKNOWN')[0]!
    expect(d.what).toContain('"fats"')
    expect(d.fix[0]).toContain('fast')
  })
  test('derived signals are evaluated once per frame and see the frame\'s params', () => {
    let calls = 0
    let double: any
    const m = build((s) => {
      const p = s.param('x', { value: 3, min: 0, max: 10 })
      double = s.signal(() => { calls++; return p() * 2 })
      rect({ width: () => double() + double() })
    })
    calls = 0
    const f = m.state(0)
    expect(f.prop(m.nodes[0]!, 'width')).toBe(12)
    expect(calls).toBe(1)
    expect(m.state(0, { x: 5 }).run(() => double())).toBe(10)
  })
  test('a signal that depends on itself does not hang, has no value, and is reported as a cycle (not as "became NaN")', () => {
    let a: any, b: any
    const m = build((s) => { a = s.signal((): number => b() + 1); b = s.signal((): number => a() + 1) })
    expect(m.state(0).run(() => a())).toBeNaN()
    const d = m.diagnostics.list.filter((x) => x.code === 'RUNTIME-ERROR')
    expect(d.length).toBeGreaterThan(0)
    expect(d[0]!.what).toContain('depends on itself')
    expect(typeof d[0]!.line).toBe('number')
    expect(d[0]!.fix.length).toBeGreaterThan(0)
  })
  test('s.t() follows story time; st.clock changes its speed for one step', () => {
    let s0: any
    const m = build((s) => {
      s0 = s
      s.step('normal', (st: any) => { st.wait(1) }) // 2 s with the hold
      s.step('slow', (st: any) => { st.clock({ speed: 0.5 }); st.wait(1) })
      s.step('frozen', (st: any) => { st.clock({ freeze: true }); st.wait(1) })
    })
    expect(m.state(1).t).toBe(1)
    expect(m.state(3).t).toBe(2.5)
    expect(m.state(4).t).toBe(3)
    expect(m.state(5.5).t).toBe(3)
    expect(m.state(1).run(() => s0.t())).toBe(1)
  })
  test('probes are exposed by name', () => {
    const m = build((s) => {
      const p = s.param('x', { value: 4, min: 0, max: 10 })
      s.probe('twice', () => p() * 2)
      s.probe('flag', () => p() > 3)
    })
    expect(m.state(0).probes()).toEqual({ twice: 8, flag: 1 })
    expect(m.state(0, { x: 1 }).probes()).toEqual({ twice: 2, flag: 0 })
  })
  test('s.rng(seed) is repeatable and seed dependent', () => {
    let a: number[] = [], b: number[] = [], c: number[] = []
    build((s) => { const r1 = s.rng(7), r2 = s.rng(7), r3 = s.rng(8); a = [r1(), r1(), r1.range(2, 3), r1.int(1, 6)]; b = [r2(), r2(), r2.range(2, 3), r2.int(1, 6)]; c = [r3(), r3()] })
    expect(a).toEqual(b)
    expect(a[0]).not.toBe(c[0])
    expect(a.every((x) => Number.isFinite(x))).toBe(true)
    expect(a[2]! >= 2 && a[2]! < 3).toBe(true)
    expect(makeRng('abc')()).toBe(makeRng('abc')())
  })
  test('a throwing dynamic function is reported once and falls back', () => {
    const m = build(() => { rect({ id: 'r', width: () => { throw new Error('boom') } }) })
    const r = m.byId.get('r')!
    expect(m.state(0).prop(r, 'width')).toBe(2)
    m.state(1).prop(r, 'width')
    const errs = m.diagnostics.byCode('RUNTIME-ERROR')
    expect(errs.length).toBe(1)
    expect(errs[0]!.what).toContain('boom')
    expect(errs[0]!.ids).toEqual(['r'])
  })
  test('a dynamic value that becomes NaN is NUM-INVALID with the step and time, and renders with the default', () => {
    const m = build((s) => {
      const p = s.param('x', { value: 1, min: -1, max: 1 })
      rect({ id: 'r', height: () => Math.sqrt(p()) })
      s.step('one', (st: any) => { st.set(p, -1, { duration: 1 }) })
    })
    const r = m.byId.get('r')!
    expect(m.state(0).prop(r, 'height')).toBe(1)
    expect(m.state(1).prop(r, 'height')).toBe(1) // falls back to the kind default
    const d = m.diagnostics.byCode('NUM-INVALID')[0]!
    expect(d).toMatchObject({ step: 1, t: 1, ids: ['r'] })
    expect(d.what).toContain('NaN')
  })
})
