// flow(): the simulation. Pure (no engine, no DOM): a parsed system, the job options and a list of dated faults in;
// the whole run out, as a function of time. One seeded discrete-event run decides everything that is drawn, so
// every job is, at every instant, in exactly one of: queued, in flight, done, dead. Hence
//   in = done + queued + in flight + dead      by construction.
// Events are handled in time order from one random stream, so a fault dated T cannot change anything before T:
// adding faults as the story is compiled never rewrites what earlier steps already showed.
//
// The model, read off the shape of the graph (nothing is named in code):
//   source   a node no plain link leads into: jobs appear there
//   queue    a node with slots: jobs wait in line until a node after it is free
//   server   a node with a service time (every replicated node, or the nodes named in `service`): one job at a time
//   retry    the node a fail link leads to: a job waits out its backoff there (doubling per failure) and goes on
//   sink     a node nothing leaves: jobs end there, done; one reached by an `-Nx->` link holds the dead ones
import { rng as makeRng, type Rng } from '../lib/sim/index.ts'
import type { FlowGraph, FlowLink } from './flowparse.ts'

export type Span = number | readonly [number, number]
/** Every default of the simulation, by name. `jobs: { … }` overrides any of them. */
export const FLOW_JOBS = Object.freeze({
  /** how many jobs the sources send in all */
  count: 20,
  /** seconds between two jobs */
  every: 1 as Span,
  /** seconds a server works on one job */
  service: [0.8, 1.2] as Span,
  seed: 1 as number | string,
  /** seconds a job takes along one link */
  travel: 0.8,
  /** first backoff in seconds, and the factor it grows by per failure */
  backoff: 1,
  factor: 2,
  /** failures after which a job is dead when no `-Nx->` link says so */
  retries: 3,
  /** seconds between two poison jobs injected together */
  spacing: 0.4,
  /** poison jobs a story may add on top of `count` (each needs a dot of its own) */
  spare: 6,
  /** quiet seconds kept after the last event, so the end can be seen */
  tail: 1.5,
  /** most jobs and most events of one run (more is cut off and reported) */
  maxJobs: 400,
  maxEvents: 20000,
})
export interface JobOptions { count: number; every: Span; service: Span | Record<string, Span>; seed: number | string; travel: number; backoff: number; factor: number; retries: number }
export interface Fault { t: number; kind: 'crash' | 'recover' | 'poison' | 'rate'; node?: string; value?: number }

export type SegKind = 'edge' | 'queue' | 'serve' | 'wait' | 'done' | 'dead'
export interface Seg { kind: SegKind; t0: number; t1: number; node: number; link: number; rev: boolean }
export interface Job { id: number; born: number; poison: boolean; failedAt: number; attempts: number; segs: Seg[] }
export interface NodeSnap { depth: number; busy: boolean; since: number; duration: number; down: boolean; done: number; dead: number; failed: number }
export interface Counts { in: number; done: number; queued: number; inFlight: number; dead: number }
export interface Snapshot extends Counts { t: number; nodes: NodeSnap[] }
export type Role = 'source' | 'queue' | 'server' | 'retry' | 'sink' | 'deadSink' | 'pass'
export interface Run {
  roles: Role[]
  jobs: Job[]
  /** when the last thing happened, plus the tail */
  end: number
  snapshots: Snapshot[]
  /** the state in force at time t */
  at(t: number): Snapshot
  /** where job `id` is at time t (null: not born yet, or gone) */
  pose(id: number, t: number): { seg: Seg; u: number } | null
  /** one number over time as a step series of [t, value] points: a counter name, or a node id (its line) */
  series(name: string): [number, number][]
  problems: string[]
}

const isSpan = (v: unknown): v is Span => (typeof v === 'number' && v >= 0 && Number.isFinite(v)) || (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && x >= 0 && Number.isFinite(x)))
const num = (v: unknown, fallback: number, min = 0): number => (typeof v === 'number' && Number.isFinite(v) && v >= min ? v : fallback)

/** Fill in every default; anything unusable falls back to the default (and is named in `problems`). */
export function jobOptions(given: unknown, problems: string[] = []): JobOptions {
  const o = (typeof given === 'object' && given !== null ? given : {}) as Record<string, unknown>
  const known = ['count', 'every', 'service', 'seed', 'travel', 'backoff', 'factor', 'retries']
  for (const k of Object.keys(o)) if (!known.includes(k)) problems.push(`jobs.${k} is not an option (${known.join(', ')})`)
  let service: JobOptions['service'] = FLOW_JOBS.service
  if (isSpan(o.service)) service = o.service
  else if (typeof o.service === 'object' && o.service !== null) service = Object.fromEntries(Object.entries(o.service as Record<string, unknown>).filter(([, v]) => isSpan(v))) as Record<string, Span>
  return {
    count: Math.min(FLOW_JOBS.maxJobs, Math.round(num(o.count, FLOW_JOBS.count))),
    every: isSpan(o.every) ? o.every : FLOW_JOBS.every,
    service,
    seed: typeof o.seed === 'number' || typeof o.seed === 'string' ? o.seed : FLOW_JOBS.seed,
    travel: num(o.travel, FLOW_JOBS.travel, 0.05), backoff: num(o.backoff, FLOW_JOBS.backoff), factor: num(o.factor, FLOW_JOBS.factor, 0.01), retries: Math.round(num(o.retries, FLOW_JOBS.retries)),
  }
}

/** What each node does, from the shape of the graph and the service option. */
export function rolesOf(graph: FlowGraph, service: JobOptions['service']): Role[] {
  const named = typeof service === 'object' && !Array.isArray(service) ? (service as Record<string, Span>) : null
  const anyReplica = graph.nodes.some((n) => n.replica > 0)
  return graph.nodes.map((n) => {
    const out = graph.links.filter((l) => l.from === n.id), into = graph.links.filter((l) => l.to === n.id)
    if (!out.length) return into.length && into.every((l) => l.kind === 'after') ? 'deadSink' : 'sink'
    if (into.some((l) => l.kind === 'fail')) return 'retry'
    if (!into.some((l) => l.kind === 'go' && !graph.links.some((f) => f.kind === 'fail' && f.to === l.from))) return 'source'
    if (n.slots > 0) return 'queue'
    if (named ? n.id in named || n.base in named : anyReplica ? n.replica > 0 : into.some((l) => (graph.nodes.find((m) => m.id === l.from)?.slots ?? 0) > 0)) return 'server'
    return 'pass'
  })
}

interface Ev { t: number; q: number; type: 'emit' | 'arrive' | 'back' | 'finish' | 'release' | 'fault'; node: number; job: number; epoch: number; fault?: Fault; poison?: boolean }
/** line: jobs waiting to be served (a server only); ready: jobs that are through here and wait for room further on */
interface NodeState { line: number[]; ready: number[]; serving: number; reserved: number; since: number; duration: number; down: boolean; done: number; dead: number; failed: number; lastSent: number; waiting: number }

/** Run the system to its end. Same graph, options and faults → the same run, whatever is asked of it and in whatever order. */
export function simulate(graph: FlowGraph, options: JobOptions, faults: readonly Fault[] = []): Run {
  const N = graph.nodes, L = graph.links
  const index = new Map(N.map((n, i) => [n.id, i]))
  const roles = rolesOf(graph, options.service)
  const random: Rng = makeRng(options.seed)
  const draw = (v: Span): number => (typeof v === 'number' ? v : random.range(v[0], v[1]))
  const serviceOf = (x: number): Span => {
    const s = options.service
    if (typeof s === 'object' && !Array.isArray(s)) { const m = s as Record<string, Span>; return m[N[x]!.id] ?? m[N[x]!.base] ?? FLOW_JOBS.service }
    return s as Span
  }
  const outs: Record<string, number[][]> = { go: [], fail: [], after: [] }
  for (const kind of ['go', 'fail', 'after']) outs[kind] = N.map((n) => L.map((l, i) => (l.from === n.id && l.kind === kind ? i : -1)).filter((i) => i >= 0))
  const out = (x: number, kind: FlowLink['kind']): number[] => outs[kind]![x]!
  const to = (link: number): number => index.get(L[link]!.to)!
  const problems: string[] = []
  const jobs: Job[] = []
  const st: NodeState[] = N.map(() => ({ line: [], ready: [], serving: -1, reserved: -1, since: 0, duration: 0, down: false, done: 0, dead: 0, failed: 0, lastSent: -1, waiting: 0 }))
  const epochs: number[] = []
  const pending: Ev[] = []
  let seq = 0, every: Span = options.every
  const push = (t: number, type: Ev['type'], node: number, job = -1, extra: Partial<Ev> = {}): void => {
    const ev: Ev = { t, q: seq++, type, node, job, epoch: job >= 0 ? epochs[job]! : 0, ...extra }
    let i = pending.length
    while (i > 0 && pending[i - 1]!.t > t) i--
    pending.splice(i, 0, ev)
  }
  const seg = (job: number, kind: SegKind, t0: number, t1: number, node: number, link = -1, rev = false): void => {
    const segs = jobs[job]!.segs, last = segs[segs.length - 1]
    if (last && last.t1 > t0) last.t1 = t0
    segs.push({ kind, t0, t1, node, link, rev })
  }
  const free = (y: number): boolean => roles[y] !== 'server' || (!st[y]!.down && st[y]!.serving < 0 && st[y]!.reserved < 0 && !st[y]!.line.length)
  const travel = (job: number, link: number, t: number, rev = false): void => {
    const y = rev ? index.get(L[link]!.from)! : to(link)
    if (!rev && roles[y] === 'server') st[y]!.reserved = job
    seg(job, 'edge', t, t + options.travel, y, link, rev)
    push(t + options.travel, rev ? 'back' : 'arrive', y, job)
  }
  const end = (job: number, x: number, t: number, dead: boolean): void => {
    seg(job, dead ? 'dead' : 'done', t, Infinity, x)
    if (dead) st[x]!.dead++; else st[x]!.done++
  }
  /** the link a job at x takes next (WAIT: no node after it is free; END: it ends here) */
  const WAIT = -1, END = -2
  const choose = (x: number): number => {
    const plain = out(x, 'go')
    const shared = plain.filter((l) => L[l]!.share !== null), rest = plain.filter((l) => L[l]!.share === null)
    if (shared.length) {
      let u = random.next()
      for (const l of shared) { u -= L[l]!.share!; if (u < 0) return free(to(l)) ? l : WAIT }
    }
    if (!rest.length) return END
    const open = rest.filter((l) => free(to(l)))
    if (!open.length) return WAIT
    // among the nodes that are free: the one sent to longest ago
    return open.reduce((best, l) => (st[to(l)]!.lastSent < st[to(best)]!.lastSent ? l : best))
  }
  /** a job is through at x (or was born there): it goes on as soon as a node after x is free */
  const hold = (job: number, x: number, t: number): void => { st[x]!.ready.push(job); seg(job, 'queue', t, Infinity, x) }
  const serve = (job: number, x: number, t: number): void => {
    const d = draw(serviceOf(x))
    Object.assign(st[x]!, { serving: job, since: t, duration: d })
    seg(job, 'serve', t, t + d, x)
    push(t + d, 'finish', x, job)
  }
  /** a job rests at x for a backoff that grows with every failure, then joins the line there again */
  const backoff = (job: number, x: number, t: number): void => {
    const wait = options.backoff * options.factor ** Math.max(0, jobs[job]!.attempts - 1)
    st[x]!.waiting++
    seg(job, 'wait', t, t + wait, x)
    push(t + wait, 'release', x, job)
  }
  const fail = (job: number, x: number, t: number): void => {
    const j = jobs[job]!
    j.attempts++
    if (j.failedAt === Infinity) j.failedAt = t
    st[x]!.failed++
    epochs[job] = epochs[job]! + 1
    const way = out(x, 'fail')[0]
    if (way !== undefined) { travel(job, way, t); return }
    // no fail link: back the way it came, unless it has failed too often
    const came = [...j.segs].reverse().find((s) => s.kind === 'edge' && !s.rev)
    if (j.attempts > options.retries || !came) { end(job, x, t, true); return }
    travel(job, came.link, t, true)
  }
  const arrive = (job: number, x: number, t: number): void => {
    const role = roles[x]!, ns = st[x]!
    if (ns.reserved === job) ns.reserved = -1
    if (role === 'sink' || role === 'deadSink') { end(job, x, t, role === 'deadSink'); return }
    if (role === 'server') {
      if (ns.down) fail(job, x, t)
      else if (ns.serving < 0 && !ns.line.length) serve(job, x, t)
      else { ns.line.push(job); seg(job, 'queue', t, Infinity, x) }
      return
    }
    if (role === 'retry') {
      const j = jobs[job]!
      const exit = out(x, 'after').find((l) => j.attempts >= L[l]!.tries)
      if (exit !== undefined) { travel(job, exit, t); return }
      if (!out(x, 'after').length && j.attempts > options.retries) { end(job, x, t, true); return }
      backoff(job, x, t)
      return
    }
    hold(job, x, t)
  }
  /** let every job that can move at time t move: servers take the next in their line, jobs that are through go on */
  const settle = (t: number): void => {
    for (let round = 0, moved = true; moved && round < 256; round++) {
      moved = false
      for (let x = 0; x < N.length; x++) {
        const ns = st[x]!
        if (roles[x] === 'server' && !ns.down && ns.serving < 0 && ns.line.length) { serve(ns.line.shift()!, x, t); moved = true }
        while (ns.ready.length) {
          const link = choose(x)
          if (link === WAIT) break
          const job = ns.ready.shift()!
          moved = true
          if (link === END) { end(job, x, t, false); continue }
          st[to(link)]!.lastSent = t
          travel(job, link, t)
        }
      }
    }
  }
  const emit = (x: number, t: number, poison: boolean): void => {
    if (jobs.length >= FLOW_JOBS.maxJobs) { if (!problems.length) problems.push(`more than ${FLOW_JOBS.maxJobs} jobs: the rest are not sent`); return }
    const id = jobs.length
    jobs.push({ id, born: t, poison, failedAt: Infinity, attempts: 0, segs: [] })
    epochs.push(0)
    hold(id, x, t)
  }

  const sources = roles.map((r, i) => (r === 'source' ? i : -1)).filter((i) => i >= 0)
  let made = 0
  if (sources.length && options.count > 0) push(0, 'emit', sources[0]!)
  for (const f of faults) push(Math.max(0, f.t), 'fault', -1, -1, { fault: f })

  const count = (t: number): Snapshot => {
    const c: Snapshot = { t, in: jobs.length, done: 0, queued: 0, inFlight: 0, dead: 0, nodes: st.map((ns) => ({ depth: ns.line.length + ns.ready.length + ns.waiting, busy: ns.serving >= 0, since: ns.since, duration: ns.duration, down: ns.down, done: ns.done, dead: ns.dead, failed: ns.failed })) }
    for (const j of jobs) {
      const k = j.segs[j.segs.length - 1]!.kind
      if (k === 'done') c.done++; else if (k === 'dead') c.dead++; else if (k === 'queue' || k === 'wait') c.queued++; else c.inFlight++
    }
    return c
  }
  const snapshots: Snapshot[] = [count(0)]
  let last = 0, handled = 0
  while (pending.length) {
    if (++handled > FLOW_JOBS.maxEvents) { problems.push(`the run was cut off after ${FLOW_JOBS.maxEvents} events (a job that can never finish?)`); break }
    const ev = pending.shift()!
    const t = ev.t
    if (ev.job >= 0 && ev.epoch !== epochs[ev.job] && ev.type === 'finish') continue // it failed in the meantime
    if (ev.type === 'emit') {
      emit(ev.node, t, ev.poison === true)
      if (ev.poison !== true && ++made < options.count) push(t + Math.max(0.01, draw(every)), 'emit', sources[made % sources.length]!)
    } else if (ev.type === 'arrive') arrive(ev.job, ev.node, t)
    else if (ev.type === 'back') backoff(ev.job, ev.node, t)
    else if (ev.type === 'finish') {
      const ns = st[ev.node]!
      if (ns.serving === ev.job) {
        ns.serving = -1
        if (jobs[ev.job]!.poison) fail(ev.job, ev.node, t)
        else hold(ev.job, ev.node, t)
      }
    } else if (ev.type === 'release') {
      // the backoff is over: the job joins the line again where it rested
      st[ev.node]!.waiting--
      if (roles[ev.node] === 'server') arrive(ev.job, ev.node, t); else hold(ev.job, ev.node, t)
    } else if (ev.fault) {
      const f = ev.fault, x = f.node === undefined ? -1 : index.get(f.node) ?? -1
      if (f.kind === 'crash' && x >= 0 && !st[x]!.down) {
        const ns = st[x]!
        ns.down = true
        const serving = ns.serving
        ns.serving = -1
        const waiting = ns.line.splice(0)
        if (serving >= 0) fail(serving, x, t)
        for (const job of waiting) fail(job, x, t)
      } else if (f.kind === 'recover' && x >= 0) st[x]!.down = false
      else if (f.kind === 'rate' && typeof f.value === 'number' && f.value > 0) every = 1 / f.value
      else if (f.kind === 'poison' && sources.length) for (let i = 0; i < Math.max(1, Math.round(f.value ?? 1)); i++) push(t + i * FLOW_JOBS.spacing, 'emit', sources[0]!, -1, { poison: true })
    }
    settle(t)
    last = t
    const snap = count(t)
    if (snapshots[snapshots.length - 1]!.t === t) snapshots[snapshots.length - 1] = snap; else snapshots.push(snap)
  }
  const finish = last + FLOW_JOBS.tail

  const at = (t: number): Snapshot => {
    let lo = 0, hi = snapshots.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (snapshots[mid]!.t <= t) lo = mid; else hi = mid - 1 }
    return snapshots[lo]!
  }
  const pose = (id: number, t: number): { seg: Seg; u: number } | null => {
    const j = jobs[id]
    if (!j || j.born > t) return null
    let lo = 0, hi = j.segs.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (j.segs[mid]!.t0 <= t) lo = mid; else hi = mid - 1 }
    const s = j.segs[lo]!
    return { seg: s, u: s.t1 > s.t0 && Number.isFinite(s.t1) ? Math.min(1, Math.max(0, (t - s.t0) / (s.t1 - s.t0))) : 0 }
  }
  const series = (name: string): [number, number][] => {
    const x = index.get(name)
    const read = (s: Snapshot): number => (x !== undefined ? s.nodes[x]!.depth : name in s ? Number((s as unknown as Record<string, number>)[name]) : 0)
    const points: [number, number][] = []
    for (const s of snapshots) {
      const v = read(s), prev = points[points.length - 1]
      if (prev && prev[1] !== v) points.push([s.t, prev[1]]) // a step, not a ramp
      if (!prev || prev[1] !== v) points.push([s.t, v])
    }
    points.push([finish, points.length ? points[points.length - 1]![1] : 0])
    return points
  }
  return { roles, jobs, end: finish, snapshots, at, pose, series, problems }
}

/** in − done − queued − in flight − dead: 0 at every instant of a run. */
export const balance = (c: Counts): number => c.in - c.done - c.queued - c.inFlight - c.dead
