// The check engine without a browser: the sampling plan, the forwarding rules, and the pure story rules.
import { describe, expect, test } from 'bun:test'
import { rect, text } from '../../../src/r2d/index.ts'
import { box } from '../../../src/r3d/index.ts'
import '../../../src/anim/index.ts'
import '../../../src/guide/index.ts'
import '../../../src/check/check.ts'
import { runCheck } from '../../../src/check/engine.ts'
import { isCyclic, planSamples } from '../../../src/check/plan.ts'
import { allRules, compile, scene } from '../../../src/core/index.ts'

const build = (fn: (s: any) => void) => compile(scene({ title: 'check' }, fn))

describe('check', () => {
  test('the first rules are registered through defineRule', () => {
    const codes = allRules().map((r) => r.code)
    for (const c of ['API-UNKNOWN', 'API-TYPE', 'REF-MISSING', 'NUM-INVALID', 'RUNTIME-ERROR', 'EMPTY-FRAME', 'OFF-FRAME', 'TEXT-OVERLAP', 'STATIC-STEP', 'DEAD-PARAM']) expect(codes).toContain(c)
  })
  test('the plan takes "cyclic" from what the param declares, never from its name; a hidden param is not swept', () => {
    const m = build((s) => {
      s.param('crank', { value: 10, min: 0, max: 90 }) // a name the checker used to read as "an angle"
      s.param('phaseAngleTheta', { value: 0, min: 0, max: 360 }) // every old trigger word, whole turns, no unit: still nothing
      s.param('level', { value: 0, min: 0, max: 8, cyclic: true }) // declared: the range is one cycle
      s.param('time', { value: 0, min: 0, max: 100, period: 4 }) // declared with a period: the phases cover one period
      s.state('lit', false)
      s.param('gain', { value: 1, min: 0, max: 2, hidden: true })
      rect()
      s.step('one', (st: any) => { st.wait(1) })
    })
    expect(m.params.map((p) => isCyclic(p))).toEqual([false, false, true, true, false, false])
    const plan = planSamples(m)
    const phases = (name: string): number[] => plan.filter((x) => x.kind === 'phase' && name in x.params).map((x) => x.params[name] as number)
    expect(phases('crank')).toEqual([])
    expect(phases('phaseAngleTheta')).toEqual([])
    expect(phases('level')).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(phases('time')).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5])
    expect(plan.some((x) => 'lit' in x.params || 'gain' in x.params)).toBe(false)
    expect(plan.filter((x) => x.kind === 'param' && 'crank' in x.params).map((x) => x.params.crank)).toEqual([0, 10, 90])
  })
  test('sampling plan: step ends, 25/50/75% of moving steps, each param at min/default/max, 8 phases of a cyclic param', () => {
    const m = build((s) => {
      const crank = s.param('crank', { value: 30, min: 0, max: 360, unit: '°' })
      const gain = s.param('gain', { value: 1, min: 0, max: 2 })
      const a = rect().rotate(() => crank() * gain())
      s.step('still', (st: any) => { st.label(a) })
      s.step('moving', (st: any) => { st.set(crank, 180) })
    })
    const plan = planSamples(m)
    expect(isCyclic(m.params[0]!)).toBe(true)
    expect(isCyclic(m.params[1]!)).toBe(false)
    expect(plan.filter((x) => x.kind === 'step-end').map((x) => [x.step, x.tau])).toEqual([[1, m.steps[0]!.t1 - 0.001], [2, m.steps[1]!.t1 - 0.001]])
    expect(plan.filter((x) => x.kind === 'transition').map((x) => [x.step, x.tau - m.steps[1]!.t0])).toEqual([[2, 0.75], [2, 1.5], [2, 2.25]])
    expect(plan.filter((x) => x.kind === 'param').map((x) => x.params)).toEqual([{ crank: 0 }, { crank: 30 }, { crank: 360 }, { gain: 0 }, { gain: 1 }, { gain: 2 }])
    expect(plan.filter((x) => x.kind === 'phase').map((x) => x.params.crank)).toEqual([0, 45, 90, 135, 180, 225, 270, 315])
  })
  test('build diagnostics are forwarded in JSON form, errors first', async () => {
    const m = build((s) => {
      rect({ id: 'a', widht: 2 })
      s.step('one', (st: any) => { st.focus('nope'); st.wait(1) })
    })
    const out = await runCheck(null, {}, m)
    expect(out.map((d) => d.code)).toEqual(['API-UNKNOWN', 'REF-MISSING'])
    expect(Object.keys(out[0]!).sort()).toEqual(['code', 'file', 'fix', 'ids', 'limit', 'line', 'measured', 'severity', 'step', 'stepTitle', 't', 'what'])
    expect(out[1]).toMatchObject({ step: 1, stepTitle: 'one', severity: 'error' })
    expect(typeof out[0]!.line).toBe('number')
  })
  test('evaluation problems are found by sampling (a NaN that only happens at one end of a param)', async () => {
    const m = build((s) => {
      const x = s.param('x', { value: 1, min: -1, max: 1 })
      rect({ id: 'r', width: () => Math.sqrt(x()) + 1 })
    })
    expect(m.diagnostics.list.length).toBe(0)
    const out = await runCheck(null, {}, m)
    expect(out.map((d) => d.code)).toEqual(['NUM-INVALID'])
    expect(out[0]!.ids).toEqual(['r'])
  })
  test('STATIC-STEP: a step that changes nothing drawn is a warning; labels, focus and motion count as change', async () => {
    const m = build((s) => {
      const p = s.param('angle', { value: 0, min: 0, max: 90 })
      const a = rect({ id: 'a' }).rotate(() => p())
      s.step('show', (st: any) => { st.set(p, 45) })
      s.step('talk only', (st: any) => { st.say('Nothing moves here.') })
      s.step('label', (st: any) => { st.label(a, 'this') })
      s.step('there and back', (st: any) => { st.play(a.to.shift(1, 0), { duration: 1 }); st.play(a.to.shift(-1, 0), { duration: 1 }) })
    })
    const out = await runCheck(null, { rules: ['STATIC-STEP'] }, m)
    expect(out.length).toBe(1)
    expect(out[0]).toMatchObject({ code: 'STATIC-STEP', severity: 'warn', step: 2, stepTitle: 'talk only' })
    expect(out[0]!.what).toBe('the picture at the end of step 2 is identical to step 1.')
    expect(out[0]!.fix[0]).toContain('only calls st.say()')
  })
  test('DEAD-PARAM: a param that changes nothing the viewer sees is an error (nothing reads it, or only a probe / a hidden object / a sub-pixel change)', async () => {
    const m = build((s) => {
      const used = s.param('used', { value: 0, min: 0, max: 10 })
      const probed = s.param('probed', { value: 0, min: 0, max: 10 })
      s.param('dead', { value: 0, min: 0, max: 10 })
      s.toggle('deadToggle', { value: false })
      const ghost = s.param('ghost', { value: 0, min: 0, max: 10 })
      const tiny = s.param('tiny', { value: 0, min: 0, max: 10 })
      box({ width: () => 1 + used() })
      s.probe('p', () => probed())
      box({ width: () => 1 + ghost() }).opacity(0) // read, by something that is never seen
      box({ width: () => 1 + tiny() * 1e-5 }) // read, and moves a ten-thousandth of a unit: nobody can see that
      s.step('x', (st: any) => { st.wait(1) })
    })
    const out = await runCheck(null, { rules: ['DEAD-PARAM'] }, m)
    expect(out.map((d) => d.what.match(/"(\w+)"/)![1])).toEqual(['probed', 'dead', 'deadToggle', 'ghost', 'tiny'])
    expect(out[0]!.what).toContain('changes nothing that can be seen')
    expect(out[0]).toMatchObject({ code: 'DEAD-PARAM', severity: 'error', step: null })
    expect(typeof out[0]!.line).toBe('number')
  })
  test('measured rules report nothing without a browser (unknown is not a pass, and not a failure)', async () => {
    const m = build((s) => { text('far away').at(40, 0); s.step('x', (st: any) => { st.wait(1) }) })
    const out = await runCheck(null, {}, m)
    expect(out.filter((d) => ['OFF-FRAME', 'EMPTY-FRAME', 'TEXT-OVERLAP'].includes(d.code))).toEqual([])
  })
})
