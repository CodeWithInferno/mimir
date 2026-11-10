// The simulation behind traffic(): a seeded discrete-event run (src/lib/sim `events`) of jobs through a graph of
// stations, and the pose of every job as a pure function of time. Part of the lazy chunk; it fills `slots.traffic`.
//
// The model. A job is born at a source and moves along edges. Every node is a station:
//   - a node with `service` serves `workers` jobs at a time (and lets `slots` more wait);
//   - a node with slots and no service is a queue: jobs wait in line and the head leaves when the next node has room;
//   - any other node passes jobs straight on.
// A job leaves a node only when the node it goes to has room for it (room is reserved when it leaves), so nothing
// is ever dropped or overtaken. A job that fails (the station's failRate, a node that goes down under it, or a job
// marked as failing) goes back the way it came, waits out a backoff half way, and enters the node it came from
// again; past the retry limit it is dead. A job ends where no edge leads on, or where a station absorbs it.
// Every job is, at every time, in exactly one of: queued, in flight, done, dead. Hence sent = done + dead + queued
// + inFlight by construction; `live` recounts the middle two from the job histories so that the linter can compare.
import { apply, clamp01, type Frame, type MNode, type Resolved, type SceneModel, type Vec3 } from '../core/index.ts'
import { events, type Events, type Rng } from '../lib/sim/index.ts'
import { measurePath, pointAt, type PathMeasure } from '../lib/path/index.ts'
import {
  DIAGRAM_DEFAULTS as D, enterTime, nodeGeom, seatLocal, slotLocal, slots, storeOf,
  type StationView, type TokenPose, type Topology, type TrafficCounts, type TrafficView,
} from './index.ts'

// ── the resolved description of a run (plain data: it is also the cache key) ─────────────────────────
type Span = number | [number, number]
interface NodeSpec {
  id: string
  /** edges that lead on from here, and edges that only carry retries back (by the node they return to) */
  out: number[]
  back: Record<number, number>
  slots: number
  /** jobs served at once: 0 = a pure queue, Infinity = passes jobs straight on */
  workers: number
  service: Span
  route: string | Record<string, number>
  failRate: number
  absorb: number
  release: number
  source: { count: number; every: Span; start: number; failing: number[] } | null
}
export interface Spec {
  seed: number | string
  nodes: NodeSpec[]
  edges: { from: number; to: number }[]
  travel: number
  hop: number
  retry: { limit: number; backoff: number; factor: number }
  /** [time, node, down?] in simulation seconds, from the story (node.down() inside a step) */
  outages: [number, number, boolean][]
}
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const span = (v: unknown, fallback: Span): Span => (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && x >= 0 && Number.isFinite(x)) ? [Math.min(v[0], v[1]), Math.max(v[0], v[1])] : typeof v === 'number' && v >= 0 && Number.isFinite(v) ? v : fallback)
const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** What a traffic object asks for in this frame, with every default filled in. */
export function resolveSpec(n: MNode, r: Resolved, topo: Topology, model: SceneModel): Spec {
  const stations = plain(r.stations) ? r.stations : {}, sources = plain(r.sources) ? r.sources : {}
  const retry = plain(r.retry) ? r.retry : {}
  const edges = topo.edges.map((e) => ({ from: e.from, to: e.to }))
  // an edge that points back along an earlier one (b → a after a → b) carries retries only
  const isBack = edges.map((e, i) => edges.some((f, j) => j < i && f.from === e.to && f.to === e.from))
  const nodes: NodeSpec[] = topo.nodes.map((m, i) => {
    const o = plain(stations[m.id]) ? (stations[m.id] as Record<string, unknown>) : {}
    const src = plain(sources[m.id]) ? (sources[m.id] as Record<string, unknown>) : null
    const serves = o.service !== undefined
    const queueShape = m.kind === 'node' && m.props.shape === 'queue'
    const slotCount = Math.max(0, Math.round(num(o.slots, queueShape ? num(m.props.slots, 0) : 0)))
    const workers = serves ? Math.max(1, Math.round(num(o.workers, 1))) : slotCount > 0 ? 0 : Infinity
    const back: Record<number, number> = {}
    edges.forEach((e, k) => { if (isBack[k] && e.from === i) back[e.to] = k })
    return {
      id: m.id, out: edges.map((e, k) => (e.from === i && !isBack[k] ? k : -1)).filter((k) => k >= 0), back, slots: slotCount, workers,
      service: span(o.service, 0),
      route: typeof o.route === 'string' ? o.route : plain(o.route) ? Object.fromEntries(Object.entries(o.route).map(([k, v]) => [k, num(v, 0)])) : 'idle',
      failRate: clamp01(num(o.failRate, 0)), absorb: clamp01(num(o.absorb, 0)), release: Math.max(0, num(o.release, workers === 0 ? D.release : 0)),
      source: src ? { count: src.count === undefined ? Infinity : Math.max(0, Math.round(num(src.count, 0))), every: span(src.every, 1), start: Math.max(0, num(src.start, 0)), failing: Array.isArray(src.failing) ? src.failing.filter((x): x is number => typeof x === 'number') : [] } : null,
    }
  })
  // node.down() recorded by the story → simulation seconds on the traffic's own clock
  const t0 = model.simTime(enterTime(n)) - num(n.props.start, 0)
  const outages: [number, number, boolean][] = []
  topo.nodes.forEach((m, i) => {
    if (m.props.down === true) outages.push([-1, i, true])
    for (const c of model.clipsFor(m, 'down') ?? []) if (typeof c.to === 'boolean') outages.push([model.simTime((c.t0 + c.t1) / 2) - t0, i, c.to])
  })
  outages.sort((a, b) => a[0] - b[0])
  return {
    seed: typeof r.seed === 'number' || typeof r.seed === 'string' ? r.seed : 1, nodes, edges,
    travel: Math.max(0.05, num(r.travel, D.travel)), hop: Math.max(0, num(r.hop, D.hop)),
    retry: { limit: Math.max(0, Math.round(num(retry.limit, D.retryLimit))), backoff: Math.max(0, num(retry.backoff, D.backoff)), factor: Math.max(0.01, num(retry.factor, D.backoffFactor)) },
    outages,
  }
}

// ── the run ──────────────────────────────────────────────────────────────────────────────────────────
/**
 * One stretch of a job's life. A 'travel' moves along an edge between two shares of its length (reversed for the
 * way back); every other kind rests at a node or on an edge. `t1` is when the stretch ends (Infinity while it is
 * open); what is drawn at a time never depends on it, nor on anything a later event adds.
 */
export interface Seg {
  kind: 'travel' | 'slot' | 'serve' | 'hold' | 'backoff' | 'absorb' | 'dead'
  t0: number
  t1: number
  /** the stretch before this one (where the token comes from) */
  prev: Seg | null
  node: number
  edge: number
  rev: boolean
  u0: number
  u1: number
  /** travel: start from rest / come to rest */
  easeIn: boolean
  easeOut: boolean
  /** slot: place in line on entry, and the times the line advanced; serve / hold: the seat */
  k: number
  shifts: number[]
  /** serve, backoff: how long it is planned to last */
  d: number
}
export interface Track {
  id: number
  born: number
  /** when it was done or dead (Infinity while it is alive) */
  end: number
  segs: Seg[]
  /** when it first failed (Infinity: never) */
  failedAt: number
  attempts: number
  failing: boolean
  /** the nodes it came through and the edges it took, most recent last */
  path: { node: number; edge: number }[]
  /** 1 queued, 2 in flight, 3 done, 4 dead */
  cat: 0 | 1 | 2 | 3 | 4
}
interface NodeSt {
  wait: number[]
  /** seat → job (−1: free), when its service started and how long it takes */
  serve: number[]
  since: number[]
  dur: number[]
  /** jobs that are through here and wait for room further on */
  ready: number[]
  inbound: number
  down: boolean
  /** per outgoing edge: when a job last left on it */
  lastSent: number[]
  next: number
  lastRelease: number
  sent: number
  done: number
  failed: number
  flashAt: number
  made: number
}
interface Ev { t: number; q: number; type: 'emit' | 'arrive' | 'finish' | 'wake' | 'down' | 'up' | 'resume'; node: number; job: number }
interface St { nodes: NodeSt[]; pending: Ev[]; seq: number; counts: TrafficCounts }
export interface Sim { spec: Spec; run: Events<St>; tracks: Track[]; reported: boolean }
const LONG_AGO = -1e9

export function buildSim(spec: Spec): Sim {
  const N = spec.nodes, E = spec.edges
  const tracks: Track[] = []
  let random!: Rng
  const draw = (v: Span): number => (Array.isArray(v) ? random.range(v[0], v[1]) : v)
  const seg = (tr: Track, kind: Seg['kind'], t0: number, t1: number, o: Partial<Seg> = {}): Seg => {
    const prev = tr.segs[tr.segs.length - 1] ?? null
    if (prev && prev.t1 > t0) prev.t1 = t0
    const s: Seg = { kind, t0, t1, prev, node: -1, edge: -1, rev: false, u0: 0, u1: 1, easeIn: true, easeOut: false, k: 0, shifts: [], d: 0, ...o }
    tr.segs.push(s)
    return s
  }
  const cat = (s: St, tr: Track, c: Track['cat']): void => {
    const names = [null, 'queued', 'inFlight', 'done', 'dead'] as const
    const from = names[tr.cat], to = names[c]
    if (from) s.counts[from]--
    if (to) s.counts[to]++
    tr.cat = c
  }
  const push = (s: St, t: number, type: Ev['type'], node: number, job = -1): void => {
    const ev: Ev = { t, q: s.seq++, type, node, job }
    let i = s.pending.length
    while (i > 0 && s.pending[i - 1]!.t > t) i--
    s.pending.splice(i, 0, ev)
  }
  const busy = (ns: NodeSt): number => ns.serve.reduce((c, j) => c + (j >= 0 ? 1 : 0), 0)
  const room = (s: St, y: number): number => {
    const ns = s.nodes[y]!, sp = N[y]!
    if (ns.down) return 0
    return sp.workers === Infinity ? Infinity : sp.workers + sp.slots - ns.wait.length - busy(ns) - ns.inbound
  }
  const freeSeat = (ns: NodeSt, sp: NodeSpec): number => { for (let k = 0; k < sp.workers; k++) if ((ns.serve[k] ?? -1) < 0) return k; return -1 }
  /** which edge the next job leaves on: the station's route among the targets that are up and have room; −1 when none */
  const choose = (s: St, x: number): number => {
    const sp = N[x]!, ns = s.nodes[x]!
    const open = sp.out.filter((e) => room(s, E[e]!.to) > 0)
    if (!open.length) return -1
    if (typeof sp.route !== 'string') {
      const weights = open.map((e) => Math.max(0, (sp.route as Record<string, number>)[N[E[e]!.to]!.id] ?? 0))
      const total = weights.reduce((a, b) => a + b, 0)
      if (!(total > 0)) return open[0]!
      let u = random.next() * total
      for (let i = 0; i < open.length; i++) { u -= weights[i]!; if (u < 0) return open[i]! }
      return open[open.length - 1]!
    }
    if (sp.route === 'first') return open[0]!
    if (sp.route === 'random') return random.pick(open)
    if (sp.route === 'roundRobin') {
      for (let i = 0; i < sp.out.length; i++) { const e = sp.out[(ns.next + i) % sp.out.length]!; if (open.includes(e)) { ns.next = (sp.out.indexOf(e) + 1) % sp.out.length; return e } }
      return open[0]!
    }
    // 'idle': the target that was sent to longest ago
    let best = open[0]!
    for (const e of open) if (ns.lastSent[sp.out.indexOf(e)]! < ns.lastSent[sp.out.indexOf(best)]!) best = e
    return best
  }
  const leaveLine = (s: St, x: number, t: number): void => { for (const j of s.nodes[x]!.wait) { const last = tracks[j]!.segs[tracks[j]!.segs.length - 1]; if (last?.kind === 'slot') last.shifts.push(t) } }
  const vacate = (ns: NodeSt, job: number): void => {
    const k = ns.serve.indexOf(job)
    if (k >= 0) ns.serve[k] = -1
    for (const list of [ns.wait, ns.ready]) { const i = list.indexOf(job); if (i >= 0) list.splice(i, 1) }
  }
  const depart = (s: St, x: number, job: number, e: number, t: number): void => {
    const tr = tracks[job]!, ns = s.nodes[x]!
    const y = E[e]!.to
    s.nodes[y]!.inbound++
    ns.lastSent[N[x]!.out.indexOf(e)] = t
    ns.lastRelease = t
    tr.path.push({ node: x, edge: e })
    const prev = tr.segs[tr.segs.length - 1]
    // a job that only passes through a node crosses it (that takes `hop`) and keeps moving; one that was at rest starts from rest
    const passing = !!prev && prev.prev?.kind === 'travel' && (prev.kind === 'hold' || (prev.kind === 'slot' && prev.t0 === t))
    const takes = spec.travel + (passing ? spec.hop : 0)
    seg(tr, 'travel', t, t + takes, { node: y, edge: e, easeIn: !(passing && prev.t0 === t) })
    cat(s, tr, 2)
    push(s, t + takes, 'arrive', y, job)
  }
  const done = (s: St, x: number, job: number, t: number): void => {
    const tr = tracks[job]!
    vacate(s.nodes[x]!, job)
    seg(tr, 'absorb', t, t + D.settle, { node: x })
    tr.end = t
    cat(s, tr, 3)
    s.nodes[x]!.done++
  }
  /** a job is through at x: it ends here, or waits here for room further on */
  const through = (s: St, x: number, job: number, t: number, seat: number): void => {
    const sp = N[x]!, tr = tracks[job]!
    if (!sp.out.length || (sp.absorb > 0 && random.chance(sp.absorb))) { done(s, x, job, t); return }
    s.nodes[x]!.ready.push(job)
    seg(tr, 'hold', t, Infinity, { node: x, k: seat })
    cat(s, tr, 1)
  }
  const fail = (s: St, x: number, job: number, t: number): void => {
    const tr = tracks[job]!, ns = s.nodes[x]!
    vacate(ns, job)
    ns.failed++
    ns.flashAt = t
    if (tr.failedAt === Infinity) tr.failedAt = t
    tr.attempts++
    const from = tr.path.pop()
    if (!from || tr.attempts > spec.retry.limit) {
      seg(tr, 'dead', t, t + 2 * D.settle, { node: x })
      tr.end = t
      cat(s, tr, 4)
      return
    }
    // back the way it came: on the edge that returns there when the graph has one, else along the same edge reversed
    const back = N[x]!.back[from.node]
    const edge = back ?? from.edge, rev = back === undefined
    const half = spec.travel / 2
    const wait = spec.retry.backoff * spec.retry.factor ** (tr.attempts - 1)
    seg(tr, 'travel', t, t + half, { node: from.node, edge, rev, u0: 0, u1: 0.5, easeOut: true })
    seg(tr, 'backoff', t + half, t + half + wait, { node: from.node, edge, rev, u0: 0.5, u1: 0.5, d: wait })
    cat(s, tr, 2)
    push(s, t + half + wait, 'resume', from.node, job)
  }
  const serve = (s: St, x: number, job: number, t: number): void => {
    const sp = N[x]!, ns = s.nodes[x]!, tr = tracks[job]!
    const k = freeSeat(ns, sp)
    const d = draw(sp.service)
    ns.serve[k] = job; ns.since[k] = t; ns.dur[k] = d
    seg(tr, 'serve', t, t + d, { node: x, k, d })
    cat(s, tr, 2)
    push(s, t + d, 'finish', x, job)
  }
  const arrive = (s: St, x: number, job: number, t: number): void => {
    const sp = N[x]!, ns = s.nodes[x]!, tr = tracks[job]!
    ns.inbound--
    if (ns.down) { fail(s, x, job, t); return }
    if (sp.workers === Infinity) { through(s, x, job, t, 0); return }
    if (sp.workers > 0 && !ns.wait.length && freeSeat(ns, sp) >= 0) { serve(s, x, job, t); return }
    ns.wait.push(job)
    seg(tr, 'slot', t, Infinity, { node: x, k: ns.wait.length - 1 })
    cat(s, tr, 1)
  }
  const finish = (s: St, x: number, job: number, t: number): void => {
    const sp = N[x]!, ns = s.nodes[x]!, tr = tracks[job]!
    const k = ns.serve.indexOf(job)
    if (k < 0 || ns.ready.includes(job)) return // it failed under an outage in the meantime
    if (tr.failing || (sp.failRate > 0 && random.chance(sp.failRate))) { fail(s, x, job, t); return }
    through(s, x, job, t, k)
  }
  const emit = (s: St, x: number, t: number): void => {
    const src = N[x]!.source!, ns = s.nodes[x]!
    const i = ns.made++
    const tr: Track = { id: tracks.length, born: t, end: Infinity, segs: [], failedAt: Infinity, attempts: 0, failing: src.failing.includes(i), path: [], cat: 0 }
    tracks.push(tr)
    s.counts.sent++
    ns.sent++
    ns.ready.push(tr.id)
    cat(s, tr, 1)
    if (ns.made < src.count) push(s, t + Math.max(0.01, draw(src.every)), 'emit', x)
  }
  const setDown = (s: St, x: number, down: boolean, t: number): void => {
    const ns = s.nodes[x]!
    if (ns.down === down) return
    ns.down = down
    if (!down) return
    ns.flashAt = t
    // what it was serving fails; what waits in its line, or is through and waits for room, stays where it is
    for (const job of ns.serve.filter((j) => j >= 0 && !ns.ready.includes(j))) {
      s.pending = s.pending.filter((ev) => !(ev.type === 'finish' && ev.job === job))
      fail(s, x, job, t)
    }
  }
  const resume = (s: St, x: number, job: number, t: number): void => {
    const tr = tracks[job]!
    // the node it goes back to may be full or down: it waits where it is and asks again shortly
    if (room(s, x) <= 0) { push(s, t + D.retryPoll, 'resume', x, job); return }
    const last = tr.segs[tr.segs.length - 1]!
    s.nodes[x]!.inbound++
    seg(tr, 'travel', t, t + spec.travel / 2, { node: x, edge: last.edge, rev: last.rev, u0: 0.5, u1: 1 })
    push(s, t + spec.travel / 2, 'arrive', x, job)
  }
  /** let everything that can move at time t move: waiting jobs take free servers, jobs that are through leave when there is room */
  const settle = (s: St, t: number): void => {
    for (let round = 0, moved = true; moved && round < 256; round++) {
      moved = false
      for (let x = 0; x < N.length; x++) {
        const sp = N[x]!, ns = s.nodes[x]!
        if (ns.down) continue
        while (sp.workers > 0 && sp.workers !== Infinity && ns.wait.length && freeSeat(ns, sp) >= 0) {
          const job = ns.wait.shift()!
          leaveLine(s, x, t)
          serve(s, x, job, t)
          moved = true
        }
        for (;;) {
          // a queue lets its head go; anything else lets go what is through (jobs born here are through at once)
          const line = sp.workers === 0 && !ns.ready.length ? ns.wait : ns.ready
          const job = line[0]
          if (job === undefined || !sp.out.length) break
          if (t < ns.lastRelease + sp.release - 1e-9) { if (!s.pending.some((ev) => ev.type === 'wake' && ev.node === x)) push(s, ns.lastRelease + sp.release, 'wake', x); break }
          const e = choose(s, x)
          if (e < 0) break
          const queued = ns.wait.includes(job)
          vacate(ns, job)
          if (queued) leaveLine(s, x, t)
          depart(s, x, job, e, t)
          moved = true
        }
      }
    }
  }
  const init: St = {
    nodes: N.map((sp) => ({ wait: [], serve: sp.workers === Infinity ? [] : new Array(sp.workers).fill(-1), since: [], dur: [], ready: [], inbound: 0, down: false, lastSent: sp.out.map(() => LONG_AGO), next: 0, lastRelease: LONG_AGO, sent: 0, done: 0, failed: 0, flashAt: LONG_AGO, made: 0 })),
    pending: [], seq: 0, counts: { sent: 0, done: 0, dead: 0, queued: 0, inFlight: 0 },
  }
  for (const [t, node, down] of spec.outages) { if (t < 0) init.nodes[node]!.down = down; else push(init, t, down ? 'down' : 'up', node) }
  N.forEach((sp, x) => { if (sp.source && sp.source.count > 0) push(init, sp.source.start, 'emit', x) })
  const run = events<St>({
    init, seed: spec.seed,
    next(state, rng, t) {
      random = rng
      const ev = state.pending[0]
      if (!ev) return null
      return {
        after: Math.max(0, ev.t - t), label: ev.type,
        apply(s, now) {
          const e = s.pending.shift()!
          if (e.type === 'emit') emit(s, e.node, now)
          else if (e.type === 'arrive') arrive(s, e.node, e.job, now)
          else if (e.type === 'finish') finish(s, e.node, e.job, now)
          else if (e.type === 'down' || e.type === 'up') setDown(s, e.node, e.type === 'down', now)
          else if (e.type === 'resume') resume(s, e.node, e.job, now)
          settle(s, now)
        },
      }
    },
  })
  return { spec, run, tracks, reported: false }
}

// ── counts and station views (no geometry) ───────────────────────────────────────────────────────────
function stationAt(sim: Sim, st: St, x: number, t: number): StationView {
  const ns = st.nodes[x]
  if (!ns) return { sent: 0, done: 0, failed: 0, waiting: 0, busy: 0, progress: 0, down: false, flash: null }
  let progress = 0, serving = 0
  ns.serve.forEach((job, k) => {
    if (job < 0) return
    serving++
    progress = Math.max(progress, ns.ready.includes(job) || !(ns.dur[k]! > 0) ? 1 : clamp01((t - ns.since[k]!) / ns.dur[k]!))
  })
  const u = (t - ns.flashAt) / D.flashSeconds
  return { sent: ns.sent, done: ns.done, failed: ns.failed, waiting: ns.wait.length + (sim.spec.nodes[x]!.workers === Infinity ? ns.ready.length : 0), busy: serving, progress, down: ns.down, flash: u > 0 && u < 1 ? u : null }
}

// ── poses (geometry of the frame) ────────────────────────────────────────────────────────────────────
interface Spot { x: number; y: number; alpha: number; /** in a node that has no place to show a token */ inside: boolean }
const easeOut = (u: number): number => 1 - (1 - clamp01(u)) ** 2
/** progress along a stretch that starts from rest (in) and / or comes to rest (out); it keeps moving otherwise */
const along = (u: number, easeIn: boolean, easeOutToo: boolean): number => {
  const x = clamp01(u), m0 = easeIn ? 0 : easeOutToo ? 1.5 : 1, m1 = easeOutToo ? 0 : easeIn ? 1.5 : 1
  return (x ** 3 - 2 * x * x + x) * m0 + (-2 * x ** 3 + 3 * x * x) + (x ** 3 - x * x) * m1
}
function posesAt(sim: Sim, t: number, topo: Topology, frame: Frame, r: Resolved): TokenPose[] {
  const paths = new Map<number, PathMeasure>()
  const pathOf = (e: number): PathMeasure => { let m = paths.get(e); if (!m) paths.set(e, (m = measurePath(frame.outline(topo.edges[e]!.edge)))); return m }
  const onEdge = (e: number, rev: boolean, u: number): [number, number] => { const p = pointAt(pathOf(e), rev ? 1 - u : u).point; return [p[0], p[1]] }
  const world = (m: MNode, p: [number, number]): [number, number] => { const q = apply(frame.world(m), [p[0], p[1], 0] as Vec3); return [q[0], q[1]] }
  /** where a job rests in a node: its place in the line, or its seat; null when the node has no room to show it */
  const place = (x: number, k: number, waiting: boolean): [number, number] | null => {
    const m = topo.nodes[x]!
    if (m.kind !== 'node') return null
    const g = nodeGeom(m, frame)
    if (g.shape === 'queue') { const w = sim.spec.nodes[x]!.workers; return world(m, slotLocal(g, k + (waiting && w !== Infinity ? w : 0))) }
    if (waiting) return null
    const p = seatLocal(g, k)
    if (!p) return null
    // several jobs served at once sit round the middle
    const n = sim.spec.nodes[x]!.workers
    if (n === Infinity || n <= 1) return world(m, p)
    const a = (k / n) * 2 * Math.PI + Math.PI / 2
    return world(m, [p[0] + D.seatSpread * Math.cos(a), p[1] + D.seatSpread * Math.sin(a)])
  }
  const spot = (s: Seg, at: number): Spot => {
    if (s.kind === 'travel') {
      const span = s.t1 - s.t0
      if (at >= s.t1 || span <= 0) { const p = onEdge(s.edge, s.rev, s.u1); return { x: p[0], y: p[1], alpha: 1, inside: false } }
      const m = pathOf(s.edge)
      const first = onEdge(s.edge, s.rev, s.u0)
      const from = s.prev ? spot(s.prev, s.t0) : null
      // a token that was out of sight comes back at the start of the edge; one that can be seen walks to it first
      const lead = from && from.alpha > 0.02 ? Math.hypot(first[0] - from.x, first[1] - from.y) : 0
      const run = m.length * Math.abs(s.u1 - s.u0)
      const d = along((at - s.t0) / span, s.easeIn, s.easeOut) * (lead + run)
      if (from && d < lead) {
        const w = d / lead
        // across a node that has no room to show it, the token goes out of sight at one edge and comes back at the other
        const step = (x: number): number => { const c = clamp01(x); return c * c * (3 - 2 * c) }
        const alpha = from.inside ? Math.max(from.alpha * (1 - step(w / 0.25)), step((w - 0.75) / 0.25)) : 1
        return { x: from.x + (first[0] - from.x) * w, y: from.y + (first[1] - from.y) * w, alpha, inside: false }
      }
      const p = onEdge(s.edge, s.rev, s.u0 + (s.u1 - s.u0) * (run > 0 ? (d - lead) / run : 1))
      const appear = !from || from.alpha <= 0.02 ? clamp01((at - s.t0) / D.appear) : 1
      return { x: p[0], y: p[1], alpha: appear, inside: false }
    }
    const from = s.prev ? spot(s.prev, s.t0) : { x: 0, y: 0, alpha: 0, inside: true }
    if (s.kind === 'backoff' || s.kind === 'dead') return from
    if (s.kind === 'absorb') {
      const w = easeOut((at - s.t0) / D.settle)
      const c = frame.anchor(topo.nodes[s.node]!, 'center')
      return { x: from.x + (c[0] - from.x) * D.absorbReach * w, y: from.y + (c[1] - from.y) * D.absorbReach * w, alpha: from.alpha * (1 - w), inside: false }
    }
    let k = s.k
    if (s.kind === 'slot') for (const moved of s.shifts) if (moved <= at) k -= easeOut((at - moved) / D.settle)
    const to = place(s.node, k, s.kind === 'slot')
    // a long way inside a node (to the head of an empty queue) takes its time: tokens glide, they do not dart
    const first = s.kind === 'slot' ? place(s.node, s.k, true) : to
    const w = easeOut((at - s.t0) / Math.max(D.settle, first ? Math.hypot(first[0] - from.x, first[1] - from.y) / D.glide : 0))
    if (!to) {
      // no place to show it: it slips into the node and out of sight
      const c = frame.anchor(topo.nodes[s.node]!, 'center')
      const v = easeOut((at - s.t0) / D.settle)
      return { x: from.x + (c[0] - from.x) * D.slip * v, y: from.y + (c[1] - from.y) * D.slip * v, alpha: from.alpha * (1 - v), inside: true }
    }
    return { x: from.x + (to[0] - from.x) * w, y: from.y + (to[1] - from.y) * w, alpha: from.alpha + (1 - from.alpha) * w, inside: false }
  }
  const out: TokenPose[] = []
  const linger = 2 * D.settle
  for (const tr of sim.tracks) {
    if (tr.born > t) break
    if (tr.end + linger < t || !tr.segs.length || tr.segs[0]!.t0 > t) continue
    // the stretch in force: the last one that has started
    let lo = 0, hi = tr.segs.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tr.segs[mid]!.t0 <= t) lo = mid; else hi = mid - 1 }
    const s = tr.segs[lo]!
    const at = spot(s, t)
    let alpha = at.alpha, scale = 1, wait: number | null = null
    if (s.kind === 'absorb') scale = 1 - D.doneShrink * easeOut((t - s.t0) / D.settle)
    if (s.kind === 'dead') { const u = clamp01((t - s.t0) / (2 * D.settle)); alpha *= 1 - u * u; scale = 1 + D.deadSwell * u }
    if (s.kind === 'backoff') wait = s.d > 0 ? clamp01(1 - (t - s.t0) / s.d) : 0
    if (!(alpha > 0.004)) continue
    const failed = tr.failedAt <= t
    out.push({ id: tr.id, x: at.x, y: at.y, alpha: clamp01(alpha), scale, color: s.kind === 'dead' ? r.failedColor : r.color, core: failed && s.kind !== 'dead' ? 1 : 0, wait })
  }
  return out
}

// ── the view of one frame ────────────────────────────────────────────────────────────────────────────
/** simulations kept per traffic object (one per distinct set of option values: a slider makes a new one per position) */
const KEEP = 6
export function simOf(n: MNode, frame: Frame): { sim: Sim; topo: Topology } | null {
  const model = n.model
  const topo = storeOf(model).topology.get(n.uid)
  if (!topo || !topo.edges.length) return null
  const spec = resolveSpec(n, frame.props(n), topo, model)
  const key = JSON.stringify(spec)
  const all = model.store('diagram.sims', () => new Map<number, Map<string, Sim>>())
  let mine = all.get(n.uid)
  if (!mine) all.set(n.uid, (mine = new Map()))
  let sim = mine.get(key)
  if (!sim) {
    sim = buildSim(spec)
    if (mine.size >= KEEP) mine.delete(mine.keys().next().value as string)
    mine.set(key, sim)
  }
  return { sim, topo }
}
function viewOf(n: MNode, frame: Frame): TrafficView {
  const model = n.model
  const got = simOf(n, frame)
  const clock = Number(frame.prop(n, 'time'))
  const t = Math.max(0, clock || 0)
  // before its clock starts (the traffic has not appeared yet) nothing has happened, not even the first job
  if (!got || !(clock >= 0)) return { t, counts: { sent: 0, done: 0, dead: 0, queued: 0, inFlight: 0 }, station: () => stationAt({} as Sim, { nodes: [] } as unknown as St, -1, t), tokens: () => [], live: 0, issues: [] }
  const { sim, topo } = got
  const st = sim.run.at(t)
  if (sim.run.issues.length && !sim.reported) {
    sim.reported = true
    for (const issue of sim.run.issues) model.diagnostics.add({ code: 'RUNTIME-ERROR', ids: [n.id], t: frame.tau, what: `traffic #${n.id}: ${issue}.`, fix: ['give the sources a count, or slow them down: sources: { client: { count: 200, every: 0.5 } }', 'shorten the story time the simulation runs for'] }, n.src)
  }
  let live = 0
  for (const tr of sim.tracks) { if (tr.born > t) break; if (tr.end > t) live++ }
  const index = new Map(sim.spec.nodes.map((sp, i) => [sp.id, i]))
  let poses: TokenPose[] | null = null
  return {
    t, counts: st.counts, live, issues: sim.run.issues,
    station: (id) => stationAt(sim, st, index.get(id) ?? -1, t),
    tokens: () => (poses ??= posesAt(sim, t, topo, frame, frame.props(n))),
  }
}
slots.traffic = viewOf
