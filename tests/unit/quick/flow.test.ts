// flow(): the block through the engine, without a browser. A script is compiled by the stand-in explain() of this
// directory (the contract of docs/QUICK.md); the blocks' reducers, link targets, diagnostics and live numbers are read
// from the compiled scene.
import { describe, expect, test } from 'bun:test'
import { compile, type SceneModel } from '../../../src/core/index.ts'
import '../../../src/r2d/index.ts'
import '../../../src/anim/index.ts'
import '../../../src/guide/index.ts'
import '../../../src/check/index.ts'
import '../../../src/diagram/index.ts'
import '../../../src/diagram/diagram.chunk.ts'
import '../../../src/plot/index.ts'
import { flow, shapeOf, FLOW_BLOCK } from '../../../src/quick/flow.ts'
import { chart } from '../../../src/quick/chart.ts'
import { parseFlow } from '../../../src/quick/flowparse.ts'
import { explain, last } from './real.ts'

const SYSTEM = 'producer -> queue[8] -> worker*3 -> database; worker -fail-> retry -> queue; retry -3x-> dead letters'
const JOBS = { count: 30, every: 0.8, service: [0.9, 1.4] as [number, number], seed: 7 }
const build = (spec: any): SceneModel => compile(explain(spec) as any)
const whats = (m: SceneModel): string[] => m.diagnostics.list.map((d) => d.what)
const probe = (m: SceneModel, name: string, tau: number): number => { const f = m.state(tau); return f.run(() => Number(m.probes.get(name)!())) }

describe('flow: a script that parses compiles without a diagnostic', () => {
  const m = build({
    title: 'queue',
    stage: { system: flow(SYSTEM, { jobs: JOBS }), depth: chart({ x: 'time', y: 'jobs waiting', follow: 'system.queue' }) },
    story: [
      { say: 'Jobs go from the [producer](system.producer) to the [database](system.database).', system: { until: 6 } },
      { say: 'A [worker](system.worker1) crashes.', system: { until: 12 } },
      { say: 'Its job is retried.', system: { crash: 'worker2', until: 20 } },
      { say: 'A poison job is set aside.', system: { poison: 1, until: 'end' } },
      { say: 'Nothing is lost: every job that came [in](system.in) is accounted for.', system: { show: 'conservation' } },
    ],
  })
  const state = last.states.system, handle = last.handles.system!
  test('no diagnostics', () => expect(whats(m)).toEqual([]))
  test('the reducer: the clock runs to the end, the crash and the poison job are recorded', () => {
    expect(state.down).toEqual(['worker2'])
    expect(state.poison).toBe(1)
    expect(state.show).toEqual(['conservation'])
    expect(state.clock).toBe((handle.api.end as () => number)())
    expect(handle.describe(state)).toContain('in 31 = done 30 + queued 0 + in flight 0 + dead 1; 2 job(s) failed at least once')
    // the crash lands a moment into its step, on a worker that holds a job: that job fails once and is still finished
    expect(handle.describe({ ...state, clock: 20 })).toContain('1 job(s) failed at least once; down: worker2')
  })
  test('counts are conserved at every moment of the story, and the story moves them', () => {
    const total = m.duration
    const seen = new Set<number>()
    for (let i = 0; i <= 60; i++) { const tau = (total * i) / 60; expect(probe(m, 'system.balance', tau)).toBe(0); seen.add(probe(m, 'system.done', tau)) }
    expect(seen.size).toBeGreaterThan(10)
    expect(probe(m, 'system.in', total)).toBe(31)
    expect(probe(m, 'system.dead', total)).toBe(1)
  })
  test('link targets: every node, a replica group, the counters, a link', () => {
    expect(handle.targets()).toEqual(expect.arrayContaining(['producer', 'queue', 'worker1', 'worker3', 'worker', 'deadLetters', 'in', 'done', 'queued', 'inFlight', 'dead']))
    for (const name of ['', 'producer', 'worker', 'worker3', 'dead letters', 'in', 'dead', 'queue->worker2']) expect(handle.target(name)).toBeTruthy()
    expect(handle.target('nobody')).toBeUndefined()
  })
  test('api: count, depth and series read the same run', () => {
    const api = handle.api as any
    expect(api.count('done', 1e9)).toBe(30)
    expect(api.depth('queue', 0)).toBe(0)
    const series = api.series('queue')()
    expect(series[series.length - 1][0]).toBe(api.end())
    expect(api.series('nothing')).toBeUndefined()
  })
})

describe('flow: bad input never throws and says what to write', () => {
  test('unknown key, unknown node, a clock that would run backwards, an unknown show', () => {
    const m = build({
      stage: { system: flow(SYSTEM, { jobs: JOBS }) },
      story: [
        { say: 'One.', system: { until: 8, crahs: 'worker1' } },
        { say: 'Two.', system: { crash: 'worker9', until: 3 } },
        { say: 'Three.', system: { show: 'everything', rate: -1 } },
      ],
    })
    const list = m.diagnostics.list.map((d) => `${d.what} | ${(d.fix ?? []).join(' ')}`)
    expect(list.some((w) => w.includes('"crahs"') && w.includes('did you mean "crash"'))).toBe(true)
    expect(list.some((w) => w.includes("'worker9'") && w.includes("did you mean 'worker"))).toBe(true)
    expect(list.some((w) => w.includes('the clock only runs forward'))).toBe(true)
    expect(list.some((w) => w.includes("show: 'everything'"))).toBe(true)
    expect(list.some((w) => w.includes('rate must be'))).toBe(true)
    expect(last.states.system.clock).toBe(8)
  })
  test('a system that cannot be read still builds; a broken step without `until` still moves the clock', () => {
    const m = build({ stage: { a: flow(42 as any), b: flow('x -> y*2 -> z', { jobs: { count: 6, colour: 'red' } as any }) }, story: [{ say: 'Go.', b: { crash: 'y1' } }] })
    expect(whats(m).some((w) => w.includes('arrow text'))).toBe(true)
    expect(whats(m).some((w) => w.includes('jobs.colour'))).toBe(true)
    expect(last.states.b.clock).toBeGreaterThan(0)
  })
  test('without jobs nothing runs by itself: send and node states work, simulation keys are reported', () => {
    const m = build({ stage: { site: flow('client -> server*2 -> cache') }, story: [{ say: 'A request.', site: { send: 'client -> server1 -> cache', busy: 'server1' } }, { say: 'It fails.', site: { fail: 'server1', until: 5, send: 'cache -> client' } }] })
    expect(last.states.site.marks).toEqual({ server1: 'failed' })
    expect(whats(m).filter((w) => w.includes('needs a simulation')).length).toBe(1)
    expect(whats(m).filter((w) => w.includes('follows no link')).length).toBe(1)
    expect(last.handles.site!.describe(last.states.site)).toContain('server1 failed')
  })
})

test('shapeOf: the block asks the stage for the shape of its system', () => {
  expect(shapeOf(parseFlow('a -> b -> c -> d -> e'))).toBeCloseTo((5 * FLOW_BLOCK.rank) / FLOW_BLOCK.row, 6)
  expect(shapeOf(parseFlow('a -> b*4 -> c'))).toBeCloseTo((3 * FLOW_BLOCK.rank) / (4 * FLOW_BLOCK.row), 6)
  const shape = { rank: FLOW_BLOCK.rank, row: FLOW_BLOCK.row }
  expect(shapeOf(parseFlow('a -> b -> c'), shape, true)).toBeCloseTo(FLOW_BLOCK.row / (3 * FLOW_BLOCK.rank), 6)
  // a system that runs has its strip of counts under it: that height is part of the shape it asks for
  expect(shapeOf(parseFlow('a -> b -> c'), { ...shape, strip: FLOW_BLOCK.strip })).toBeCloseTo((3 * FLOW_BLOCK.rank) / (FLOW_BLOCK.row + FLOW_BLOCK.strip), 6)
  expect(flow('a -> b').prefer!.aspect).toBeGreaterThan(0)
})
