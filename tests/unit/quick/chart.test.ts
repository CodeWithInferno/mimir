// chart() and layers(): the pure reducers, the fitting, the training run, and both blocks through the engine
// (compiled by the stand-in explain() of this directory, no browser).
import { describe, expect, test } from 'bun:test'
import { compile, type SceneModel } from '../../../src/core/index.ts'
import '../../../src/r2d/index.ts'
import '../../../src/anim/index.ts'
import '../../../src/guide/index.ts'
import '../../../src/check/index.ts'
import '../../../src/plot/index.ts'
import { chart, fitRange, reduceChart, type ChartState } from '../../../src/quick/chart.ts'
import { layers, reduceLayers, train, type LayersState } from '../../../src/quick/layers.ts'
import { explain, last } from './real.ts'

const build = (spec: any): SceneModel => compile(explain(spec) as any)
const whats = (m: SceneModel): string[] => m.diagnostics.list.map((d) => d.what)
const EMPTY: ChartState = { hidden: [], marks: [], bands: [], tangent: null, drawTo: null }

describe('reduceChart', () => {
  test('show / hide, mark, band, tangentAt, drawTo; unspecified keys keep their value', () => {
    let { state, problems } = reduceChart(EMPTY, { hide: 'b', mark: [90, 'half way'], band: [5, 2, 'busy'], tangentAt: 1.5, drawTo: 4 }, ['a', 'b'])
    expect(problems).toEqual([])
    expect(state).toEqual({ hidden: ['b'], marks: [{ x: 90, label: 'half way' }], bands: [{ from: 2, to: 5, label: 'busy' }], tangent: 1.5, drawTo: 4 })
    ;({ state, problems } = reduceChart(state, { show: 'b', mark: 180, tangentAt: null }, ['a', 'b']))
    expect(state).toMatchObject({ hidden: [], tangent: null, drawTo: 4 })
    expect(state.marks.map((m) => m.label)).toEqual(['half way', '180'])
    expect(EMPTY.marks).toEqual([]) // the previous state is never changed
  })
  test('what cannot be read is reported with the fix and changes nothing', () => {
    const { state, problems } = reduceChart(EMPTY, { hid: 'a', hide: 'c', mark: 'soon', band: [1], tangentAt: 'x', drawTo: null }, ['a', 'b'])
    expect(state).toEqual(EMPTY)
    expect(problems.length).toBe(6)
    expect(problems[0]!.fix).toContain('did you mean "hide"')
    for (const p of problems) expect(p.fix).toBeTruthy()
  })
  test('fitRange: padded, anchored at 0 when the data starts near it, never empty', () => {
    expect(fitRange([0, 10], 0.1)).toEqual([0, 11])
    expect(fitRange([-5, 5], 0.1)).toEqual([-6, 6])
    expect(fitRange([3, 3], 0.1)[1]).toBeGreaterThan(3)
    expect(fitRange([], 0.1)).toEqual([0, 1])
    expect(fitRange([NaN, 2, 4], 0)).toEqual([2, 4])
  })
})

describe('chart through the engine', () => {
  const loss = (w: number): number => (w - 2) ** 2
  const walk = (rate: number, steps: number): number[][] => { const path = [[-1, loss(-1)]]; for (let i = 0; i < steps; i++) { const w = path[i]![0]! - rate * 2 * (path[i]![0]! - 2); path.push([w, loss(w)]) } return path }
  const spec = (story: any[]) => ({
    controls: { rate: { from: 0.05, to: 0.9, value: 0.2 }, steps: { from: 0, to: 8, step: 1 } },
    stage: { valley: chart({ x: { name: 'weight', range: [-2, 6] }, y: 'loss', curve: loss, points: ({ rate, steps }: any) => walk(rate, Math.round(steps)) }) },
    story,
  })
  test('curves from a function and from points that follow the controls; the y range holds every control position', () => {
    const m = build(spec([{ say: 'The [curve](valley.curve).', valley: { tangentAt: -1 } }, { say: 'Every [dot](valley.points) is a step.', set: { steps: 8 }, valley: { tangentAt: null, mark: [2, 'best'] } }]))
    expect(whats(m)).toEqual([])
    const api = last.handles.valley!.api as any
    expect(api.curves).toEqual(['curve', 'points'])
    const f = m.state(m.duration)
    expect(f.run(() => api.value('curve', 2))).toBe(0)
    const range = f.run(() => api.range())
    expect(range.x).toEqual([-2, 6])
    expect(range.y[0]).toBe(0)
    expect(range.y[1]).toBeGreaterThanOrEqual(16) // loss(6) and loss(-2) are 16: the curve is inside whatever the rate
    expect(last.states.valley).toMatchObject({ tangent: null, marks: [{ x: 2, label: 'best' }] })
    expect(last.handles.valley!.targets()).toEqual(expect.arrayContaining(['curve', 'points', 'mark1', 'tangent']))
    expect(last.handles.valley!.describe(last.states.valley)).toContain('loss against weight')
  })
  test('bad input: unknown option, unknown key, nothing to plot, a follow that names nothing', () => {
    const m = build({ stage: { a: chart({ colour: 'red' } as any), b: chart({ x: [0, 1], curve: (x: number) => x, follow: 'ghost.line' }) }, story: [{ say: 'Go.', b: { tangnt: 1, hide: 'missing' } }] })
    const w = whats(m)
    expect(w.some((x) => x.includes('no option "colour"'))).toBe(true)
    expect(w.some((x) => x.includes('nothing to plot'))).toBe(true)
    expect(w.some((x) => x.includes("follow: 'ghost.line'"))).toBe(true)
    expect(w.some((x) => x.includes('"tangnt"'))).toBe(true)
    expect(w.some((x) => x.includes("'missing'"))).toBe(true)
  })
})

describe('train: real gradient descent, every round kept', () => {
  const days = (random: any) => Array.from({ length: 40 }, () => { const sun = random(), wind = random(); return { x: [sun, wind], y: sun - wind > 0.15 ? 1 : 0 } })
  const run = train({ sizes: [2, 3, 1], data: days, rate: 3, rounds: 300, seed: 7 })
  test('the error falls, and the trained network answers the examples', () => {
    expect(run.history.length).toBe(301)
    expect(run.errors[300]!).toBeLessThan(run.errors[0]! * 0.25)
    const right = run.data.filter((e) => Math.round(run.forward(run.history[300]!, e.x)[2]![0]!) === (e.y as number[])[0]).length
    expect(right).toBeGreaterThanOrEqual(36)
  })
  test('seeded: the same run twice, another seed another start; at() blends two rounds', () => {
    expect(train({ sizes: [2, 3, 1], data: days, rate: 3, rounds: 20, seed: 7 }).errors).toEqual(run.errors.slice(0, 21))
    expect(train({ sizes: [2, 3, 1], data: days, rounds: 1, seed: 8 }).errors[0]).not.toBe(run.errors[0])
    const a = run.history[10]!.weights[0]![0]![0]!, b = run.history[11]!.weights[0]![0]![0]!
    expect(run.at(10.5).weights[0]![0]![0]!).toBeCloseTo((a + b) / 2, 12)
    expect(run.at(-5)).toBe(run.history[0]!)
  })
  test('nothing usable in, nothing thrown', () => {
    expect(train({ sizes: [2, 1], data: [] }).errors).toEqual([0])
    expect(train(undefined as any).history.length).toBe(1)
  })
})

describe('layers', () => {
  const START: LayersState = { round: 0, focus: null, pulses: 0, version: 0 }
  test('reduceLayers', () => {
    const o = { rounds: 300, targets: ['1.1', '2.1', '1.1-2.1'] }
    expect(reduceLayers(START, { round: 'end', focus: '1.1-2.1', pulse: true }, o)).toMatchObject({ state: { round: 300, focus: '1.1-2.1', pulses: 1 }, pulse: true, problems: [] })
    expect(reduceLayers(START, { round: 999 }, o).state.round).toBe(300)
    const bad = reduceLayers(START, { rond: 3, focus: '9.9', set: 4 }, o)
    expect(bad.state).toEqual(START)
    expect(bad.problems.length).toBe(3)
    expect(bad.problems[0]!.fix).toContain('did you mean "round"')
    expect(reduceLayers(START, { round: 5 }, { rounds: 0, targets: [] }).problems[0]!.what).toContain('trained network')
  })
  test('through the engine: a trained network at its round, fed by controls, followed by a chart', () => {
    const m = build({
      controls: { sun: { from: 0, to: 1, value: 0.9 }, wind: { from: 0, to: 1, value: 0.1 } },
      stage: {
        net: layers({ sizes: [2, 3, 1], inputs: ['sun', 'wind'], outputs: ['beach day?'], feed: ['sun', 'wind'], train: { data: (r: any) => Array.from({ length: 40 }, () => { const a = r(), b = r(); return { x: [a, b], y: a - b > 0.15 ? 1 : 0 } }), rate: 3, rounds: 300, seed: 7 } }),
        error: chart({ x: 'round', y: 'error', follow: 'net.error' }),
      },
      story: [{ say: 'A [neuron](net.2.2) and a [link](net.1.1-2.2).', net: { focus: '2.2' } }, { say: 'A forward pass.', net: { pulse: true } }, { say: 'It learns: the [error](error) shrinks.', net: { round: 'end' } }],
    })
    expect(whats(m)).toEqual([])
    const api = last.handles.net!.api as any
    const before = m.state(0).run(() => api.value(2, 0)), after = m.state(m.duration).run(() => api.value(2, 0))
    expect(after).toBeGreaterThan(0.9) // sunny and calm: a yes, once trained
    expect(before).not.toBeCloseTo(after, 2)
    expect(Number(m.state(m.duration).run(() => m.probes.get('net.error')!()))).toBeLessThan(0.1)
    expect(m.state(m.duration).run(() => (last.handles.error!.api as any).range().x)).toEqual([0, 300])
    expect(last.states.net).toMatchObject({ round: 300, focus: '2.2', pulses: 1 })
    expect(last.handles.net!.describe(last.states.net)).toContain('round 300 of 300')
  })
  test('values and weights from functions and lists, changed with set; bad input reported', () => {
    const m = build({
      stage: { pipe: layers({ sizes: [2, 2], values: [[1, 0], [0.2, 0.8]], weights: (_l: number, from: number, to: number) => (from === to ? 2 : -1) }), none: layers({ sizes: [3] } as any) },
      story: [{ say: 'Before.' }, { say: 'After.', pipe: { set: { values: [[0, 1], [0.6, 0.4]] } } }, { say: 'Wrong.', pipe: { round: 3 } }],
    })
    const api = last.handles.pipe!.api as any
    expect(m.state(0).run(() => [api.value(0, 0), api.weight(0, 0, 0), api.weight(0, 0, 1)])).toEqual([1, 2, -1])
    expect(m.state(m.duration).run(() => [api.value(0, 0), api.value(1, 0)])).toEqual([0, 0.6])
    expect(whats(m).some((w) => w.includes('at least two layers'))).toBe(true)
    expect(whats(m).some((w) => w.includes('trained network'))).toBe(true)
  })
})
