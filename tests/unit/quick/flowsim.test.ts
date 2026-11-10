// flow(): the simulation. Counts are conserved at every event, the run is a pure function of (system, options,
// faults), and a fault dated T changes nothing before T.
import { describe, expect, test } from 'bun:test'
import { parseFlow } from '../../../src/quick/flowparse.ts'
import { balance, FLOW_JOBS, jobOptions, rolesOf, simulate, type Fault } from '../../../src/quick/flowsim.ts'

const QUEUE = parseFlow('producer -> queue[8] -> worker*3 -> database; worker -fail-> retry -> queue; retry -3x-> dead letters')
const SITE = parseFlow('client -> balancer[5] -> server*2 -> cache -miss 35%-> database')
const jobs = jobOptions({ count: 30, every: 0.8, service: [0.9, 1.4], seed: 7 })
const at = (id: string): number => QUEUE.nodes.findIndex((n) => n.id === id)

describe('roles come from the shape of the graph', () => {
  test('queue system', () => expect(rolesOf(QUEUE, jobs.service)).toEqual(['source', 'queue', 'server', 'server', 'server', 'sink', 'retry', 'deadSink']))
  test('a service map names the servers', () => expect(rolesOf(SITE, { server: 1, cache: 0.2 })).toEqual(['source', 'queue', 'server', 'server', 'server', 'sink']))
  test('options: defaults by name, unknown keys reported', () => {
    const problems: string[] = []
    const o = jobOptions({ count: 5, evry: 2, service: 'fast' }, problems)
    expect(o).toMatchObject({ count: 5, every: FLOW_JOBS.every, service: FLOW_JOBS.service, travel: FLOW_JOBS.travel, retries: FLOW_JOBS.retries })
    expect(problems.length).toBe(1)
  })
})

describe('conservation', () => {
  // worker1 is the one that holds a job at t = 12 in this run
  const faults: Fault[] = [{ t: 12, kind: 'crash', node: 'worker1' }, { t: 27, kind: 'poison', value: 1 }]
  const run = simulate(QUEUE, jobs, faults)
  test('in = done + queued + in flight + dead at every event', () => {
    expect(run.problems).toEqual([])
    expect(run.snapshots.length).toBeGreaterThan(100)
    for (const s of run.snapshots) expect(balance(s)).toBe(0)
  })
  test('every job ends: 30 done, the poison job dead after three tries with doubling waits', () => {
    const end = run.at(run.end)
    expect(end).toMatchObject({ in: 31, done: 30, dead: 1, queued: 0, inFlight: 0 })
    expect(end.nodes[at('deadLetters')]!.dead).toBe(1)
    expect(end.nodes[at('database')]!.done).toBe(30)
    const poison = run.jobs.find((j) => j.poison)!
    expect(poison.attempts).toBe(3)
    const waits = poison.segs.filter((s) => s.kind === 'wait').map((s) => Math.round((s.t1 - s.t0) * 100) / 100)
    expect(waits).toEqual([FLOW_JOBS.backoff, FLOW_JOBS.backoff * FLOW_JOBS.factor])
    expect(poison.segs[poison.segs.length - 1]!.kind).toBe('dead')
  })
  test('the crashed worker serves nothing after the crash; the job it held is finished by another', () => {
    for (const s of run.snapshots) if (s.t > 12) { expect(s.nodes[at('worker1')]!.busy).toBe(false); expect(s.nodes[at('worker1')]!.down).toBe(true) }
    const victim = run.jobs.find((j) => !j.poison && j.attempts === 1)!
    expect(victim.failedAt).toBe(12)
    expect(victim.segs[victim.segs.length - 1]!.kind).toBe('done')
  })
  test('a job is in exactly one place at any time, and its stretches follow each other', () => {
    for (const j of run.jobs) for (let i = 1; i < j.segs.length; i++) expect(j.segs[i]!.t0).toBeCloseTo(j.segs[i - 1]!.t1, 9)
  })
})

describe('a pure function of time', () => {
  test('same input, same run; another seed, another run', () => {
    const a = simulate(QUEUE, jobs), b = simulate(QUEUE, jobs), c = simulate(QUEUE, { ...jobs, seed: 8 })
    expect(a.snapshots).toEqual(b.snapshots)
    expect(a.end).toBe(b.end)
    expect(c.end).not.toBe(a.end)
  })
  test('a fault dated T changes nothing before T', () => {
    const plain = simulate(QUEUE, jobs), broken = simulate(QUEUE, jobs, [{ t: 12, kind: 'crash', node: 'worker3' }])
    for (const t of [0, 3, 7.5, 11.99]) expect(broken.at(t)).toEqual(plain.at(t))
    for (let j = 0; j < 8; j++) expect(broken.pose(j, 9)).toEqual(plain.pose(j, 9))
    expect(broken.at(20)).not.toEqual(plain.at(20))
  })
  test('asking in any order gives the same answers', () => {
    const run = simulate(QUEUE, jobs)
    const times = [31, 2, 18, 0, 9.5]
    const first = times.map((t) => JSON.stringify(run.at(t)))
    expect([...times].reverse().map((t) => JSON.stringify(run.at(t))).reverse()).toEqual(first)
  })
})

describe('faults and branches', () => {
  test('a server that recovers takes jobs again; without a fail link a job goes back the way it came', () => {
    const run = simulate(SITE, jobOptions({ count: 36, every: 0.9, service: { server: [0.9, 1.3], cache: 0.3 }, seed: 11 }), [{ t: 13, kind: 'crash', node: 'server2' }, { t: 28, kind: 'recover', node: 'server2' }])
    for (const s of run.snapshots) expect(balance(s)).toBe(0)
    const i = SITE.nodes.findIndex((n) => n.id === 'server2'), line = SITE.nodes.findIndex((n) => n.id === 'balancer')
    expect(run.snapshots.some((s) => s.t > 28 && s.nodes[i]!.busy)).toBe(true)
    expect(Math.max(...run.snapshots.filter((s) => s.t > 13 && s.t < 28).map((s) => s.nodes[line]!.depth))).toBeGreaterThan(3)
    const end = run.at(run.end)
    expect(end).toMatchObject({ in: 36, done: 36, dead: 0 })
    // hits end at the cache, misses at the database
    const cache = SITE.nodes.findIndex((n) => n.id === 'cache'), db = SITE.nodes.findIndex((n) => n.id === 'database')
    expect(end.nodes[cache]!.done + end.nodes[db]!.done).toBe(36)
    expect(end.nodes[db]!.done).toBeGreaterThan(0)
    expect(end.nodes[cache]!.done).toBeGreaterThan(end.nodes[db]!.done)
    expect(run.jobs.some((j) => j.segs.some((s) => s.kind === 'edge' && s.rev))).toBe(true)
  })
  test('rate changes how fast jobs arrive from then on', () => {
    const slow = simulate(QUEUE, jobs), fast = simulate(QUEUE, jobs, [{ t: 4, kind: 'rate', value: 5 }])
    expect(fast.at(10).in).toBeGreaterThan(slow.at(10).in)
    expect(fast.at(3.9)).toEqual(slow.at(3.9))
  })
  test('series: a step curve that ends where the run ends', () => {
    const run = simulate(QUEUE, jobs, [{ t: 12, kind: 'crash', node: 'worker3' }])
    const depth = run.series('queue'), done = run.series('done')
    expect(depth[0]).toEqual([0, 0])
    expect(depth[depth.length - 1]![0]).toBe(run.end)
    expect(Math.max(...depth.map((p) => p[1]))).toBeGreaterThanOrEqual(3)
    expect(done[done.length - 1]![1]).toBe(30)
    for (let i = 1; i < done.length; i++) { expect(done[i]![0]).toBeGreaterThanOrEqual(done[i - 1]![0]); expect(done[i]![1]).toBeGreaterThanOrEqual(done[i - 1]![1]) }
  })
  test('a system with no source, or with nothing to send, simply does not run', () => {
    expect(simulate(parseFlow('a -> b; b -> a'), jobs).at(100).in).toBe(0)
    expect(simulate(QUEUE, jobOptions({ count: 0 })).at(100).in).toBe(0)
  })
})
