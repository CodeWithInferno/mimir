// Params say what they are: cyclic (with a period), hidden (the story's own state). Nothing is read off a param's name.
import { describe, expect, test } from 'bun:test'
import { cycleOf, type SceneModel } from '../../../src/core/index.ts'
import { build, codes } from './helpers.ts'
import { rect } from '../../../src/r2d/index.ts'

const cyc = (m: SceneModel): [string, boolean, number][] => m.params.map((p) => [p.name, p.cyclic, p.period])

describe('params', () => {
  test('cyclic is what the scene says: cyclic / period; a param in degrees over whole turns goes round by default', () => {
    const m = build((s) => {
      s.param('angle', { value: 0, min: 0, max: 360, unit: '°' }) // degrees, one turn: cyclic, period 360
      s.param('two', { value: 0, min: 0, max: 720, unit: 'deg' }) // two turns: the period is still one turn
      s.param('crank', { value: 0, min: 0, max: 90 }) // a name says nothing
      s.param('rotation', { value: 0, min: 0, max: 360 }) // no unit: not assumed to be an angle
      s.param('swing', { value: 0, min: -45, max: 45, unit: '°' }) // degrees, but not whole turns
      s.param('phase', { value: 0, min: 0, max: 1, cyclic: true }) // said: one cycle is the range
      s.param('time', { value: 0, min: 0, max: 10, unit: 's', period: 2.5 }) // a period makes it cyclic
      s.param('dial', { value: 0, min: 0, max: 360, unit: '°', cyclic: false }) // said: it does not go round
      s.param('turns', { value: 0, min: 0, max: 720, unit: '°', cyclic: true }) // said, in degrees: one turn
    })
    expect(codes(m)).toEqual([])
    expect(cyc(m)).toEqual([['angle', true, 360], ['two', true, 360], ['crank', false, 0], ['rotation', false, 0], ['swing', false, 0], ['phase', true, 1], ['time', true, 2.5], ['dial', false, 0], ['turns', true, 360]])
  })

  test('cycleOf is the whole rule', () => {
    expect(cycleOf({}, 0, 360)).toEqual({ cyclic: false, period: 0 })
    expect(cycleOf({ unit: '°' }, 0, 360)).toEqual({ cyclic: true, period: 360 })
    expect(cycleOf({ unit: ' Degrees ' }, -360, 360)).toEqual({ cyclic: true, period: 360 })
    expect(cycleOf({ unit: '°' }, 0, 359)).toEqual({ cyclic: false, period: 0 })
    expect(cycleOf({ cyclic: true }, 2, 5)).toEqual({ cyclic: true, period: 3 })
    expect(cycleOf({ cyclic: true }, 5, 5)).toEqual({ cyclic: false, period: 0 }) // no range, nothing to go round
    expect(cycleOf({ period: 4 }, 0, 100)).toEqual({ cyclic: true, period: 4 })
  })

  test('wrong cyclic / period / hidden values are reported and the param still works', () => {
    const m = build((s) => {
      s.param('a', { value: 0, min: 0, max: 1, cyclic: 'yes' })
      s.param('b', { value: 0, min: 0, max: 1, period: -2 })
      s.param('c', { value: 0, min: 0, max: 1, period: 1, cyclic: false })
      s.toggle('d', { value: false, hidden: 1 })
    })
    expect(codes(m)).toEqual(['API-TYPE', 'NUM-INVALID', 'API-TYPE', 'API-TYPE'])
    expect(m.params.map((p) => p.name)).toEqual(['a', 'b', 'c', 'd'])
    expect(cyc(m).slice(0, 3)).toEqual([['a', false, 0], ['b', false, 0], ['c', false, 0]])
  })

  test('hidden: true on a param, a toggle or a choice; they are params in every other way', () => {
    let gain!: any, lit!: any
    const m = build((s) => {
      gain = s.param('gain', { value: 1, min: 0, max: 2, hidden: true })
      lit = s.toggle('lit', { value: false, hidden: true })
      s.choice('mode', { options: ['a', 'b'], value: 'a', hidden: true })
      s.param('shown', { value: 1, min: 0, max: 2 })
      s.step('x', (st: any) => { st.set(gain, 2); st.set(lit, true) })
    })
    expect(codes(m)).toEqual([])
    expect(m.params.map((p) => [p.name, p.hidden])).toEqual([['gain', true], ['lit', true], ['mode', true], ['shown', false]])
    expect([m.state(0).param(gain.def), m.state(m.duration).param(gain.def), m.state(m.duration).param(lit.def)]).toEqual([1, 2, true])
  })

  test('s.state(name, initial): a value only the story drives', () => {
    let lit!: any, count!: any, mode!: any, box!: any
    const m = build((s) => {
      lit = s.state('lit', false)
      count = s.state('count', 2)
      mode = s.state('mode', 'idle', { options: ['idle', 'busy'] })
      box = rect({ width: () => 1 + count() })
      s.step('one', (st: any) => { st.set(lit, true); st.play(count.to(5)); st.set(mode, 'busy') })
    })
    expect(codes(m)).toEqual([])
    expect(m.params.map((p) => [p.name, p.kind, p.hidden, p.value])).toEqual([['lit', 'toggle', true, false], ['count', 'number', true, 2], ['mode', 'choice', true, 'idle']])
    // a number state has no range of its own: there is nothing for a slider or a sweep to reach
    expect([m.params[1]!.min, m.params[1]!.max]).toEqual([2, 2])
    const end = m.state(m.duration)
    expect([end.param(lit.def), end.param(count.def), end.param(mode.def)]).toEqual([true, 5, 'busy'])
    expect(end.prop(box, 'width')).toBe(6)
  })

  test('s.state with a wrong initial value, a text without options, an initial text that is not an option', () => {
    const m = build((s) => {
      s.state('a', { x: 1 })
      s.state('b', 'idle')
      s.state('c', 'idel', { options: ['idle', 'busy'] })
      s.state('', true)
      s.state('n', Number.NaN)
    })
    expect(codes(m)).toEqual(['API-TYPE', 'API-TYPE', 'API-UNKNOWN', 'API-TYPE', 'NUM-INVALID'])
    expect(m.diagnostics.list[2]!.fix[0]).toBe('use "idle"')
    expect(m.params.every((p) => p.hidden)).toBe(true)
  })
})
