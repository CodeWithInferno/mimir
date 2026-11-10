// traffic(): the seeded simulation of jobs through a graph, and the poses of its tokens. Pure functions of time:
// counts are conserved at every instant, nothing depends on the order of questions, and tokens never jump.
import { describe, expect, test } from 'bun:test'
import { compile, scene, type Handle, type MNode, type SceneModel } from '../../../src/core/index.ts'
import '../../../src/r2d/index.ts'
import '../../../src/anim/index.ts'
import '../../../src/guide/index.ts'
import { DIAGRAM_DEFAULTS as D, edge, graph, node, nodeGeom, slotLocal, traffic, trafficView, type TokenPose, type TrafficView } from '../../../src/diagram/index.ts'
import '../../../src/diagram/diagram.chunk.ts'
import { simOf } from '../../../src/diagram/engine.ts'

const build = (fn: (s: any) => void): SceneModel => compile(scene({ title: 'traffic' }, fn))
const codes = (m: SceneModel): string[] => m.diagnostics.list.map((d) => d.code)
const view = (m: SceneModel, sim: MNode, tau: number): TrafficView => { const f = m.state(tau); return f.run(() => trafficView(sim, f)) }
const balance = (v: TrafficView): number => v.counts.sent - v.counts.done - v.counts.dead - v.counts.queued - v.counts.inFlight

/** N producers → a queue → M workers → a sink, with retries: the pipeline of the reel in a few lines */
const pipeline = (o: { seconds?: number; seed?: number; failRate?: number; count?: number; failing?: number[]; steps?: (s: any, g: Handle, sim: Handle) => void } = {}) => {
  let g!: Handle, sim!: Handle
  const m = build((s) => {
    g = graph({
      nodes: { producer: 'producer', queue: { shape: 'queue', slots: 8, label: 'queue' }, a: { label: 'worker', shape: 'ring' }, b: { label: 'worker', shape: 'ring' }, db: { label: 'database', shape: 'cylinder' } },
      edges: [['producer', 'queue'], ['queue', 'a'], ['queue', 'b'], ['a', 'db'], ['b', 'db']],
    })
    sim = traffic(g, {
      seed: o.seed ?? 7,
      sources: { producer: { count: o.count ?? 30, every: [0.5, 0.8], failing: o.failing ?? [] } },
      stations: { a: { service: [0.9, 1.4], failRate: o.failRate ?? 0 }, b: { service: [0.9, 1.4], failRate: o.failRate ?? 0 } },
    })
    if (o.steps) o.steps(s, g, sim)
    else s.step('run', (st: any) => { st.wait(o.seconds ?? 80) })
  })
  return { m, g, sim }
}

describe('traffic: counts', () => {
  test('sent = done + dead + queued + in flight at every instant, and the job histories agree', () => {
    const { m, sim } = pipeline({ failRate: 0.25 })
    expect(codes(m)).toEqual([])
    let sawQueue = false, sawFlight = false
    for (let t = 0; t <= 80; t += 0.173) {
      const v = view(m, sim, t)
      expect(balance(v)).toBe(0)
      expect(v.live).toBe(v.counts.queued + v.counts.inFlight)
      for (const k of Object.values(v.counts)) expect(k).toBeGreaterThanOrEqual(0)
      sawQueue ||= v.counts.queued > 0
      sawFlight ||= v.counts.inFlight > 0
    }
    expect(sawQueue && sawFlight).toBe(true)
    const end = view(m, sim, 80)
    expect(end.counts.sent).toBe(30)
    expect(end.counts.done + end.counts.dead).toBe(30)
    expect(end.counts.queued + end.counts.inFlight).toBe(0)
    expect(end.station('db').done).toBe(end.counts.done)
    expect(end.station('a').failed + end.station('b').failed).toBeGreaterThan(0)
  })
  test('the same seed gives the same run; another seed another; the order of questions changes nothing', () => {
    const one = pipeline({ failRate: 0.2 }), two = pipeline({ failRate: 0.2 }), other = pipeline({ failRate: 0.2, seed: 8 })
    const times = [3.3, 41.7, 12.1, 0.4, 66.6, 12.1, 27.9]
    const snap = (p: ReturnType<typeof pipeline>, t: number): string => { const v = view(p.m, p.sim, t); return JSON.stringify([v.counts, v.tokens().map((k) => [k.id, +k.x.toFixed(9), +k.y.toFixed(9), +k.alpha.toFixed(9), k.wait])]) }
    const forward = times.map((t) => snap(one, t))
    const backward = [...times].reverse().map((t) => snap(two, t)).reverse()
    expect(backward).toEqual(forward)
    expect(times.map((t) => snap(other, t))).not.toEqual(forward)
  })
  test('nodes left unbound show the simulation: counts, the ring, the state; probes are registered', () => {
    const { m, g, sim } = pipeline()
    const f = m.state(20)
    const v = view(m, sim, 20)
    expect(f.prop(g.nodes.producer, 'count')).toBe(v.station('producer').sent)
    expect(f.prop(g.nodes.db, 'count')).toBe(v.counts.done)
    expect(f.prop(g.nodes.queue, 'count')).toBe(v.station('queue').waiting)
    expect(f.prop(g.nodes.db, 'countColor')).toBe(D.doneColor)
    expect(['idle', 'busy']).toContain(f.prop(g.nodes.a, 'state'))
    expect(f.prop(g.nodes.a, 'progress')).toBe(v.station('a').progress)
    expect(m.byId.get('db.count')?.kind).toBe('text')
    const probes = f.probes()
    expect(probes[`${sim.id}.sent`]).toBe(v.counts.sent)
    expect(probes[`${sim.id}.balance`]).toBe(0)
    expect(sim.count('done')()).toBe(0) // read while nothing is being evaluated: the state at the start
    expect(f.run(() => sim.count('done', 'db')())).toBe(v.counts.done)
  })
  test('bind: false leaves the nodes alone', () => {
    let g!: Handle
    const m = build((s) => {
      g = graph({ nodes: { a: 'a', b: { shape: 'ring' } }, edges: [['a', 'b']] })
      traffic(g, { sources: { a: { every: 1 } }, stations: { b: { service: 1 } }, bind: false })
      s.step('run', (st: any) => st.wait(5))
    })
    expect(m.state(3).prop(g.nodes.a, 'count')).toBeNull()
    expect(m.state(3).prop(g.nodes.b, 'progress')).toBe(0)
  })
})

describe('traffic: the rules', () => {
  test('a queue holds what the workers cannot take, never more than its slots, and jobs keep their order', () => {
    const { m, sim } = pipeline({ count: 40 })
    let deepest = 0
    for (let t = 0; t <= 80; t += 0.25) { const v = view(m, sim, t); deepest = Math.max(deepest, v.station('queue').waiting); expect(v.station('queue').waiting).toBeLessThanOrEqual(8) }
    expect(deepest).toBeGreaterThan(1)
    // first in, first out: jobs reach the database in the order they were made, give or take the two workers
    const got = simOf(sim, m.state(80))!
    got.sim.run.at(80)
    const order = got.sim.tracks.filter((t) => t.end < Infinity).sort((a, b) => a.end - b.end).map((t) => t.id)
    order.forEach((id, i) => expect(Math.abs(id - i)).toBeLessThanOrEqual(2))
  })
  test('a job that always fails retries with a doubling backoff and is dead after the limit', () => {
    const { m, sim } = pipeline({ count: 6, failing: [2] })
    const end = view(m, sim, 80)
    expect(end.counts.dead).toBe(1)
    expect(end.counts.done).toBe(5)
    const got = simOf(sim, m.state(80))!
    const tr = got.sim.tracks[2]!
    expect(tr.attempts).toBe(D.retryLimit + 1)
    expect(tr.segs.filter((s) => s.kind === 'backoff').map((s) => s.d)).toEqual([1, 2, 4])
    expect(tr.segs[tr.segs.length - 1]!.kind).toBe('dead')
    // while it waits a backoff out, its token shows the ring running down
    const waits = tr.segs.filter((s) => s.kind === 'backoff')
    const mid = waits[1]!.t0 + 1
    const pose = view(m, sim, mid).tokens().find((k) => k.id === 2)!
    expect(pose.wait).toBeCloseTo(0.5, 6)
    expect(pose.core).toBe(1)
  })
  test('node.down() in a step: what it served fails and is retried elsewhere; nothing is sent to it until it is back', () => {
    const { m, g, sim } = pipeline({
      count: 40,
      steps: (s, graph_) => {
        s.step('normal', (st: any) => { st.wait(10) })
        s.step('outage', (st: any) => { graph_.nodes.b.down(); st.wait(12) })
        s.step('back', (st: any) => { graph_.nodes.b.down(false); st.wait(40) })
      },
    })
    expect(codes(m)).toEqual([])
    const t0 = m.steps[1]!.t0, t1 = m.steps[2]!.t0
    expect(m.state(t0 + 0.01).prop(g.nodes.b, 'state')).toBe('down')
    const before = view(m, sim, t0 - 0.01), start = view(m, sim, t0 + 0.01)
    expect(start.station('b').down).toBe(true)
    expect(start.station('b').failed).toBe(before.station('b').failed + before.station('b').busy)
    expect(start.station('b').flash).not.toBeNull()
    for (let t = t0 + D.travel + D.hop + 0.1; t < t1; t += 0.2) { const v = view(m, sim, t); expect(v.station('b').busy).toBe(0); expect(balance(v)).toBe(0) }
    // traffic shifts: worker a does everything during the outage, and b works again afterwards
    const clock = (tau: number): number => view(m, sim, tau).t
    const servedByB = (tau: number): number => simOf(sim, m.state(tau))!.sim.tracks.flatMap((tr) => tr.segs).filter((s) => s.kind === 'serve' && s.node === 3 && s.t1 <= clock(tau) && s.t1 - s.t0 >= s.d - 1e-9).length
    expect(servedByB(t1)).toBe(servedByB(t0))
    expect(view(m, sim, m.duration).counts.done).toBe(40)
    expect(servedByB(m.duration)).toBeGreaterThan(servedByB(t1))
  })
  test('routes: round robin alternates, weights follow their shares, absorb ends jobs early', () => {
    let sim!: Handle
    const m = build((s) => {
      const g = graph({ nodes: { src: 'src', lb: 'lb', a: 'a', b: 'b', c: 'c', end: 'end' }, edges: [['src', 'lb'], ['lb', 'a'], ['lb', 'b'], ['a', 'c'], ['b', 'c'], ['c', 'end']] })
      sim = traffic(g, { sources: { src: { count: 200, every: 0.2 } }, stations: { lb: { route: 'roundRobin' }, c: { absorb: 0.5 } }, travel: 0.3 })
      s.step('run', (st: any) => st.wait(60))
    })
    expect(codes(m)).toEqual([])
    const v = view(m, sim, 60)
    expect(v.counts.done).toBe(200)
    const got = simOf(sim, m.state(60))!
    const via = (node: number): number => got.sim.tracks.filter((t) => t.segs.some((s) => s.kind === 'travel' && s.node === node)).length
    expect(via(2)).toBe(100)
    expect(via(3)).toBe(100)
    expect(v.station('c').done + v.station('end').done).toBe(200)
    expect(v.station('c').done).toBeGreaterThan(70)
    expect(v.station('c').done).toBeLessThan(130)
  })
  test('an edge that points back carries retries, and only retries', () => {
    let sim!: Handle
    const m = build((s) => {
      const g = graph({ nodes: { src: 'src', q: { shape: 'queue', slots: 4 }, w: { shape: 'ring' }, out: 'out' }, edges: [['src', 'q'], ['q', 'w'], ['w', 'out'], ['w', 'q', { dashed: true, label: 'retry' }]] })
      sim = traffic(g, { sources: { src: { count: 10, every: 1 } }, stations: { w: { service: 0.5, failRate: 0.4 } }, retry: { limit: 10, backoff: 0.2, factor: 1 } })
      s.step('run', (st: any) => st.wait(80))
    })
    expect(codes(m)).toEqual([])
    const v = view(m, sim, 80)
    expect(v.counts.done).toBe(10)
    const got = simOf(sim, m.state(80))!
    const back = got.sim.tracks.flatMap((t) => t.segs).filter((s) => s.kind === 'travel' && s.edge === 3)
    expect(back.length).toBeGreaterThan(0)
    expect(back.every((s) => !s.rev)).toBe(true)
    expect(got.sim.tracks.flatMap((t) => t.segs).some((s) => s.kind === 'travel' && s.rev)).toBe(false)
  })
})

describe('traffic: tokens', () => {
  const motion = (m: SceneModel, sim: MNode, from: number, to: number): { jump: number; pop: number; seen: number } => {
    let prev = new Map<number, TokenPose>(), jump = 0, pop = 0, seen = 0
    for (let t = from; t <= to; t += 1 / 60) {
      const now = new Map(view(m, sim, t).tokens().map((k) => [k.id, k]))
      seen = Math.max(seen, now.size)
      for (const [id, k] of now) {
        const was = prev.get(id)
        if (was) { jump = Math.max(jump, Math.hypot(k.x - was.x, k.y - was.y)); pop = Math.max(pop, Math.abs(k.alpha - was.alpha)) }
        else if (t > from) pop = Math.max(pop, k.alpha)
      }
      for (const [id, was] of prev) if (!now.has(id)) pop = Math.max(pop, was.alpha)
      prev = now
    }
    return { jump, pop, seen }
  }
  test('at 60 frames a second no token jumps and none pops in or out', () => {
    const { m, sim } = pipeline({ failRate: 0.3, count: 40 })
    const r = motion(m, sim, 0, 60)
    expect(r.seen).toBeGreaterThan(3)
    expect(r.jump).toBeLessThan(0.16) // an edge is a few units long and takes 0.9 s
    expect(r.pop).toBeLessThan(0.13)
  })
  test('the same holds through an outage', () => {
    const { m, sim } = pipeline({
      count: 30,
      steps: (s, g) => {
        s.step('normal', (st: any) => { st.wait(6) })
        s.step('outage', (st: any) => { g.nodes.a.down(); st.wait(8) })
        s.step('back', (st: any) => { g.nodes.a.down(false); st.wait(30) })
      },
    })
    const r = motion(m, sim, 0, m.duration)
    expect(r.jump).toBeLessThan(0.16)
    expect(r.pop).toBeLessThan(0.13)
  })
  test('waiting jobs sit in the slots of the queue, one per slot, the head on the right', () => {
    const { m, g, sim } = pipeline({ count: 40 })
    let checked = 0
    for (let t = 5; t < 40; t += 0.5) {
      const f = m.state(t)
      const v = f.run(() => trafficView(sim, f))
      const got = simOf(sim, f)!
      const geom = nodeGeom(g.nodes.queue, f), c = f.anchor(g.nodes.queue, 'center')
      const resting = got.sim.tracks.filter((tr) => { const s = [...tr.segs].reverse().find((x) => x.t0 <= v.t); return s?.kind === 'slot' && v.t - s.t0 > 1.5 && !s.shifts.some((x) => x <= v.t && v.t - x < D.settle) })
      if (resting.length !== v.station('queue').waiting || !resting.length) continue
      const xs = resting.map((tr) => v.tokens().find((k) => k.id === tr.id)!.x).sort((a, b) => b - a)
      xs.forEach((x, k) => expect(x).toBeCloseTo(c[0] + slotLocal(geom, k)[0], 6))
      checked++
    }
    expect(checked).toBeGreaterThan(3)
  })
  test('a job being served sits in the middle of its ring while the ring fills', () => {
    const { m, g, sim } = pipeline()
    let checked = 0
    for (let t = 3; t < 30; t += 0.31) {
      const f = m.state(t)
      const v = f.run(() => trafficView(sim, f))
      const st = v.station('a')
      if (st.busy !== 1 || st.progress < 0.5 || st.progress >= 1) continue
      const c = f.anchor(g.nodes.a, 'center')
      expect(v.tokens().some((k) => Math.hypot(k.x - c[0], k.y - c[1]) < 1e-6 && k.alpha === 1)).toBe(true)
      checked++
    }
    expect(checked).toBeGreaterThan(3)
  })
  test('the clock starts when the traffic appears; st.clock slows it', () => {
    let sim!: Handle
    const m = build((s) => {
      const g = graph({ nodes: { a: 'a', b: 'b' }, edges: [['a', 'b']] })
      s.step('draw', (st: any) => { st.wait(3) })
      s.step('go', (st: any) => { sim = traffic(g, { sources: { a: { every: 1 } } }); st.wait(4) })
      s.step('slow', (st: any) => { st.clock({ speed: 0.5 }); st.wait(4) })
    })
    expect(codes(m)).toEqual([])
    const go = m.steps[1]!.t0, slow = m.steps[2]!.t0
    expect(view(m, sim, go + 2.5).t).toBeCloseTo(2.5, 9)
    expect(view(m, sim, go + 2.5).counts.sent).toBe(3) // at 0, 1 and 2 s
    expect(view(m, sim, slow + 2).t).toBeCloseTo(slow - go + 1, 9)
    expect(view(m, sim, 1).tokens()).toEqual([])
  })
  test('options given as functions follow params: a slider reruns the whole history', () => {
    let sim!: Handle
    const m = build((s) => {
      const gap = s.param('gap', { value: 1, min: 0.25, max: 2 })
      const g = graph({ nodes: { a: 'a', b: 'b' }, edges: [['a', 'b']] })
      sim = traffic(g, { sources: { a: { every: gap } } })
      s.step('run', (st: any) => st.wait(10))
    })
    expect(codes(m)).toEqual([])
    const at = (params: Record<string, number>): number => { const f = m.state(8, params); return f.run(() => trafficView(sim, f)).counts.sent }
    expect(at({})).toBe(9)
    expect(at({ gap: 0.5 })).toBe(17)
    expect(at({})).toBe(9)
  })
})

describe('traffic: bad input', () => {
  test('reported, never thrown: no graph, an unknown node, a wrong route, no sources', () => {
    const m = build((s) => {
      const g = graph({ nodes: { a: 'a', b: 'b' }, edges: [['a', 'b']] })
      traffic(undefined as any, { sources: {} })
      traffic(g, { sources: { c: { every: 1 } } })
      traffic(g, { sources: { a: { every: 'fast' } }, stations: { b: { route: 'zigzag', service: [2, 1] } } })
      traffic(g, { sources: { a: { evry: 1 } } })
      const ok = traffic(g, { sources: { a: { every: 1 } } })
      ok.count('finished')
      ok.count('done', 'nowhere')
      s.step('run', (st: any) => st.wait(3))
    })
    const got = codes(m)
    expect(got.filter((c) => c === 'REF-MISSING').length).toBe(2) // sources.c, count(…, 'nowhere')
    expect(got).toContain('API-UNKNOWN')
    expect(got.filter((c) => c === 'API-TYPE').length).toBeGreaterThanOrEqual(3)
    expect(m.diagnostics.list.find((d) => d.what.includes('zigzag'))!.fix[0]).toContain('roundRobin')
    // every one of them still gives an object, and the frame can be evaluated
    const f = m.state(2)
    for (const n of m.nodes.filter((x) => x.kind === 'traffic')) expect(f.run(() => trafficView(n, f)).counts.sent).toBeGreaterThanOrEqual(0)
  })
  test('edges given by hand work like a graph', () => {
    let sim!: Handle
    const m = build((s) => {
      const a = node('a').at(-3, 0), b = node('b', { shape: 'ring' }).at(0, 0), c = node('c').at(3, 0)
      sim = traffic([edge(a, b), edge(b, c)], { sources: { [a.id]: { count: 5, every: 1 } }, stations: { [b.id]: { service: 0.5 } } })
      s.step('run', (st: any) => st.wait(20))
    })
    expect(codes(m)).toEqual([])
    expect(view(m, sim, 20).counts.done).toBe(5)
  })
})
