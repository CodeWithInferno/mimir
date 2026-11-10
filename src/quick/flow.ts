// flow(spec, opts): a system diagram that RUNS. One line of arrow text (or { nodes, links }) is laid out by the
// engine's graph layout inside the block's rectangle; jobs are dots driven by one seeded simulation that is a pure
// function of the block's clock (src/quick/flowsim.ts), so the counts on screen add up at every instant.
// The author writes no position, size or duration: a step says how far the clock runs (`until`) and what breaks.
import { linear, PALETTE, type Handle, type Param } from '../core/index.ts'
import { column, dot, group, text } from '../r2d/index.ts'
import { fadeIn, fadeOut, indicate, moveAlong } from '../anim/index.ts'
import { graph } from '../diagram/index.ts'
import { fitAspect, type BlockCtx, type BlockDef, type BlockHandle } from './block.ts'
import { nearest as closest, parseFlow, resolveNodes, type FlowGraph } from './flowparse.ts'
import { FLOW_JOBS, jobOptions, rolesOf, simulate, type Fault, type JobOptions, type Role, type Run, type Snapshot } from './flowsim.ts'

/** Every default of the flow block, by name. `flow(spec, { look: { … } })` overrides any of them. */
export const FLOW_BLOCK = Object.freeze({
  /** its share of the stage next to other blocks; the shape it asks for comes from the system (shapeOf) */
  weight: 2,
  /** room one rank and one row of the diagram want (frame units): what the asked-for shape is estimated from */
  rank: 1.95,
  row: 1.8,
  /** the strip of live counts under the diagram: its height, the width of one count and of one sign between two */
  strip: 0.95,
  term: 1.2,
  sign: 0.38,
  /** radius of a job, and how many points of a link a job's way is read from */
  token: 0.075,
  samples: 16,
  /** seconds (of the block's clock) a job takes to appear and to vanish */
  appear: 0.25,
  /** seconds of the clock after a step starts at which what it breaks happens (so the fault is seen to happen) */
  reaction: 0.4,
  /** seconds between the moments a crash looks at for a job to catch (the fault lands when the node is at work) */
  scan: 0.1,
  /** seconds the clock runs in a step that breaks something but says no `until` */
  advance: 6,
  /** seconds one hop of a hand-sent job takes (state key `send`) */
  hop: 0.9,
  /** one colour per meaning: a job, a job that failed once, what is lost */
  job: PALETTE.BLUE, retried: PALETTE.GOLD, poison: PALETTE.RED, dead: PALETTE.RED, ink: PALETTE.WHITE, quiet: PALETTE.GREY_B,
})
type Look = { -readonly [K in keyof typeof FLOW_BLOCK]: (typeof FLOW_BLOCK)[K] }

export interface FlowOptions {
  /** the simulation: { count, every, service, seed, travel, backoff, factor, retries }. Left out: nothing runs by itself (use `send`). */
  jobs?: Partial<JobOptions>
  /** which way the links run (default 'right') */
  direction?: 'right' | 'down'
  /** overrides of FLOW_BLOCK */
  look?: Partial<Look>
}
export interface FlowState {
  /** seconds on the block's clock */
  clock: number
  /** nodes that are down */
  down: string[]
  /** poison jobs sent so far, and the jobs per second the sources send (null: as configured) */
  poison: number
  rate: number | null
  /** what is switched on: 'conservation' */
  show: string[]
  /** states set by hand, by node */
  marks: Record<string, string>
}
export interface FlowChange {
  until?: number | 'end'
  crash?: string | string[] | { node: string; for?: number }
  recover?: string | string[]
  poison?: number
  rate?: number
  show?: string | string[]
  send?: string | string[]
  busy?: string | string[]
  fail?: string | string[]
  idle?: string | string[]
}
const KEYS = ['until', 'crash', 'recover', 'poison', 'rate', 'show', 'send', 'busy', 'fail', 'idle'] as const
const COUNTERS = ['in', 'done', 'queued', 'inFlight', 'dead'] as const
const COUNTER_NAMES: Record<string, string> = { in: 'in', done: 'done', queued: 'queued', inFlight: 'in flight', dead: 'dead' }
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : [])

/** A system that runs: flow('client -> queue[6] -> worker*2 -> database', { jobs: { count: 30, every: 0.6 } }). */
export function flow(spec: unknown, opts: FlowOptions = {}): BlockDef<FlowState> {
  const parsed = parseFlow(spec)
  const o = (typeof opts === 'object' && opts !== null ? opts : {}) as FlowOptions
  const look: Look = { ...FLOW_BLOCK, ...(typeof o.look === 'object' && o.look !== null ? o.look : {}) }
  return {
    kind: 'flow',
    prefer: { aspect: shapeOf(parsed, { rank: look.rank, row: look.row, strip: o.jobs !== undefined ? look.strip : 0 }, o.direction === 'down'), weight: look.weight },
    build: (ctx) => buildFlow(ctx, parsed, o, look),
  }
}

/** width / height the diagram wants: its ranks along the flow (longest path over the plain links) by its fullest rank */
export function shapeOf(g: FlowGraph, look: Pick<Look, 'rank' | 'row'> & { strip?: number } = { rank: FLOW_BLOCK.rank, row: FLOW_BLOCK.row }, down = false): number {
  const rank = new Map(g.nodes.map((n) => [n.id, 0]))
  for (let pass = 0; pass < g.nodes.length; pass++) for (const l of g.links) if (l.kind === 'go' && !g.links.some((f) => f.kind === 'fail' && f.to === l.from)) rank.set(l.to, Math.max(rank.get(l.to)!, rank.get(l.from)! + 1 > g.nodes.length ? 0 : rank.get(l.from)! + 1))
  for (const l of g.links) if (l.kind !== 'go') rank.set(l.to, Math.max(rank.get(l.to)!, rank.get(l.from)! + 1))
  const ranks = Math.max(1, ...rank.values()) + 1
  const rows = Math.max(1, ...[...Array(ranks).keys()].map((r) => g.nodes.filter((n) => rank.get(n.id) === r).length))
  // the strip of counts under a running system is part of the block's height either way
  const strip = look.strip ?? 0
  return down ? (rows * look.row) / (ranks * look.rank + strip) : (ranks * look.rank) / (rows * look.row + strip)
}

function buildFlow(ctx: BlockCtx, g: FlowGraph, o: FlowOptions, look: Look): BlockHandle<FlowState> {
  const { s, id } = ctx
  // the diagram keeps its proportions: it is drawn into the centred part of the rectangle that has its shape, so the counts sit right under it
  const rect = fitAspect(ctx.rect, shapeOf(g, { rank: look.rank, row: look.row, strip: o.jobs !== undefined && g.nodes.length > 0 ? look.strip : 0 }, o.direction === 'down'))
  for (const p of g.problems) ctx.report(p.what, p.fix)
  const optionProblems: string[] = []
  const running = o.jobs !== undefined && g.nodes.length > 0
  const jobs = jobOptions(o.jobs, optionProblems)
  for (const p of optionProblems) ctx.report(`flow: ${p}`, 'jobs: { count: 30, every: 0.6, service: [0.8, 1.2], seed: 1 }')
  const roles: Role[] = rolesOf(g, jobs.service)
  const nodeIndex = new Map(g.nodes.map((n, i) => [n.id, i]))

  // ── the run: recomputed only when the story adds a fault; a pure function of (system, options, faults) ──────────
  const faults: Fault[] = []
  let memo: { key: number; run: Run } | null = null
  const run = (): Run => {
    if (!memo || memo.key !== faults.length) {
      memo = { key: faults.length, run: simulate(g, jobs, faults) }
      for (const p of memo.run.problems) ctx.report(`flow: ${p}`, 'send fewer jobs: jobs: { count: 40 }')
    }
    return memo.run
  }
  const horizon = running ? Math.ceil(run().end) : 1
  const clock: Param<number> | null = running ? s.param(`${id} time`, { value: 0, min: 0, max: horizon, unit: 's', label: `${id}: time` }) : null
  const now = (): number => (clock ? clock() : 0)
  const snap: () => Snapshot = s.signal(() => run().at(now()))
  const nodeSnap = (i: number) => snap().nodes[i]!

  // ── the picture: the engine's graph, every node bound to the run ───────────────────────────────────────────────
  const strip = running ? look.strip : 0
  const nodes: Record<string, unknown> = {}
  g.nodes.forEach((n, i) => {
    const role = roles[i]!
    const spec: Record<string, unknown> = { label: n.label }
    if (n.slots > 0) Object.assign(spec, { shape: 'queue', slots: n.slots })
    else if (role === 'server') spec.shape = 'ring'
    else if (role === 'sink') spec.shape = 'cylinder'
    else if (role === 'retry') spec.shape = 'pill'
    if (running) {
      if (n.slots > 0) Object.assign(spec, { filled: () => Math.min(n.slots, nodeSnap(i).depth), count: () => nodeSnap(i).depth })
      else if (role === 'server') Object.assign(spec, {
        progress: () => { const v = nodeSnap(i); return v.busy && v.duration > 0 ? Math.min(1, Math.max(0, (now() - v.since) / v.duration)) : 0 },
        state: () => { const v = nodeSnap(i); return v.down ? 'down' : v.busy ? 'busy' : 'idle' },
        down: () => nodeSnap(i).down,
        // a server where some jobs end (a cache that answers) counts them
        ...(g.links.some((l) => l.from === n.id && l.kind === 'go' && l.share !== null) ? { count: () => nodeSnap(i).done } : {}),
      })
      else if (role === 'retry') Object.assign(spec, { count: () => nodeSnap(i).depth || null, state: () => (nodeSnap(i).depth ? 'waiting' : 'idle') })
      else if (role === 'deadSink') Object.assign(spec, { count: () => nodeSnap(i).dead, state: () => (nodeSnap(i).dead ? 'failed' : 'idle'), countColor: look.dead })
      else if (role === 'sink') Object.assign(spec, { count: () => nodeSnap(i).done })
      else if (role !== 'source') Object.assign(spec, { count: () => nodeSnap(i).depth || null })
    }
    nodes[n.id] = spec
  })
  // one label per fan of links that say the same thing (worker*3 -fail-> retry is labelled once)
  const labelled = new Set<string>()
  const edges = g.links.map((l) => {
    const from = g.nodes[nodeIndex.get(l.from)!]!, to = g.nodes[nodeIndex.get(l.to)!]!
    const key = `${from.base}>${to.base}>${l.label}`
    const middle = (n: typeof from): boolean => n.replica === 0 || n.replica === Math.ceil(g.nodes.filter((m) => m.base === n.base).length / 2)
    const show = l.label && !labelled.has(key) && middle(from) && middle(to)
    if (show) labelled.add(key)
    return [l.from, l.to, { ...(show ? { label: l.label } : {}), ...(l.kind === 'go' ? {} : { dashed: true }) }]
  })
  const diagram: Handle = graph({ id, nodes, edges, direction: o.direction === 'down' ? 'down' : 'right', width: rect.width, height: Math.max(0.5, rect.height - strip) })
    .at(rect.center[0], rect.center[1] + strip / 2)
  // the stage chose this rectangle, not the author: a system drawn a little under full size is not theirs to fix (TEXT-TINY still guards legibility)
  if (typeof diagram.allow === 'function') diagram.allow('GRAPH-SHRUNK')
  const nodeOf = (name: string): Handle | undefined => diagram.nodes?.[name]
  const edgeOf = (a: string, b: string): Handle | undefined => { const i = g.links.findIndex((l) => l.from === a && l.to === b); return i < 0 ? undefined : diagram.edges?.[i] }

  // ── the jobs: one dot each, where the run says it is ────────────────────────────────────────────────────────────
  const parts: Handle[] = [diagram]
  if (running) {
    const K = Math.max(2, Math.round(look.samples))
    const ways = g.links.map((_, i) => Array.from({ length: K + 1 }, (_, k) => diagram.edges[i].pointAt(k / K) as () => number[]))
    const along = (link: number, u: number): [number, number] => {
      const x = Math.min(1, Math.max(0, u)) * K, k = Math.min(K - 1, Math.floor(x)), w = x - k
      const a = ways[link]![k]!(), b = ways[link]![k + 1]!()
      return [a[0]! + (b[0]! - a[0]!) * w, a[1]! + (b[1]! - a[1]!) * w]
    }
    const ease = (u: number): number => u * u * (3 - 2 * u)
    // room for every job the sources send plus the poison jobs a story can add; a pose is computed once per frame
    const room = jobs.count + FLOW_JOBS.spare
    const poses = s.signal(() => {
      const t = now(), r = run()
      return Array.from({ length: room }, (_, j) => {
        const p = r.pose(j, t)
        if (!p || p.seg.kind !== 'edge') return null
        const [x, y] = along(p.seg.link, p.seg.rev ? 1 - ease(p.u) : ease(p.u))
        const edge = Math.min(t - p.seg.t0, p.seg.t1 - t) / look.appear
        const job = r.jobs[j]!
        return { x, y, alpha: Math.min(1, Math.max(0, edge)), color: job.poison ? look.poison : job.failedAt <= t ? look.retried : look.job }
      })
    })
    const home = diagram.center
    for (let j = 0; j < room; j++) {
      parts.push(dot({ id: `${id}.job${j + 1}`, radius: look.token, color: () => poses()[j]?.color ?? look.job, opacity: () => poses()[j]?.alpha ?? 0 })
        .at(() => { const p = poses()[j]; return p ? [p.x, p.y] : home() }).z(3).allow('TINY'))
    }
  }

  // ── the line of live counts: in = done + queued + in flight + dead (the signs arrive with show: 'conservation') ──
  const terms: Record<string, Handle> = {}
  const signAt: [number, number][] = []
  if (running) {
    const natural = COUNTERS.length * look.term + (COUNTERS.length - 1) * look.sign
    const k = Math.min(1, rect.width / natural), term = look.term * k, sign = look.sign * k
    const y = rect.bottom + strip / 2
    COUNTERS.forEach((name, i) => {
      const x = rect.center[0] - (natural * k) / 2 + i * (term + sign) + term / 2
      const color = name === 'dead' ? look.dead : name === 'in' || name === 'done' ? look.ink : look.job
      terms[name] = column([text(() => String(snap()[name]), { size: 'label', color }), text(COUNTER_NAMES[name]!, { size: 'note', color: look.quiet })], { id: `${id}.${name}`, gap: 0.1 }).at(x, y)
      parts.push(terms[name]!)
      if (i < COUNTERS.length - 1) signAt.push([x + (term + sign) / 2, y + 0.14])
    })
    s.probe(`${id}.balance`, () => { const c = snap(); return c.in - c.done - c.queued - c.inFlight - c.dead })
    for (const name of COUNTERS) s.probe(`${id}.${name}`, () => snap()[name])
  }
  const root: Handle = group(parts)

  // ── names an author may point at ───────────────────────────────────────────────────────────────────────────────
  const names = (): string[] => [...g.nodes.map((n) => n.id), ...new Set(g.nodes.filter((n) => n.replica).map((n) => n.base)), ...(running ? COUNTERS : [])]
  const target = (path: string): Handle | undefined => {
    if (!path) return root
    if (path in terms) return terms[path]
    const ids = resolveNodes(g, path)
    if (ids.length) return nodeOf(ids[0]!)
    const link = /^(.+?)\s*(?:->|>|-)\s*(.+)$/.exec(path)
    return link ? edgeOf(resolveNodes(g, link[1])[0] ?? '', resolveNodes(g, link[2])[0] ?? '') : undefined
  }
  /** the node ids a state key names; unknown names are reported with the nearest one */
  const named = (key: string, v: unknown): string[] => list(v).flatMap((name) => {
    const ids = resolveNodes(g, name)
    if (!ids.length) { const near = closest(name, names()); ctx.report(`${id}: { ${key}: '${name}' } names no node of this system`, near ? `did you mean '${near}'?` : `nodes: ${g.nodes.map((n) => n.id).join(', ')}`) }
    return ids
  })

  /** nodes that were told to crash and held no job in that step */
  const idleCrash = new Set<string>()
  const apply = (st: any, change: Partial<FlowChange>, prev: FlowState): FlowState => {
    const next: FlowState = { ...prev, down: [...prev.down], show: [...prev.show], marks: { ...prev.marks } }
    const c = (typeof change === 'object' && change !== null ? change : {}) as Record<string, unknown>
    for (const k of Object.keys(c)) if (!(KEYS as readonly string[]).includes(k)) { const near = closest(k, KEYS); ctx.report(`${id}: "${k}" is not something a flow can be told`, near ? `did you mean "${near}"? (${KEYS.join(', ')})` : `one of: ${KEYS.join(', ')}`) }
    const needsRun = (key: string): boolean => { if (!running && c[key] !== undefined) ctx.report(`${id}: { ${key} } needs a simulation, and this flow has no jobs`, "flow('a -> b', { jobs: { count: 20 } }), or move one job by hand: { send: 'a -> b' }"); return running && c[key] !== undefined }
    let broke = false
    const when = prev.clock + look.reaction
    if (needsRun('crash')) {
      const spec = c.crash as { node?: unknown; for?: unknown }
      const many = typeof c.crash === 'object' && c.crash !== null && !Array.isArray(c.crash)
      for (const node of named('crash', many ? spec.node : c.crash)) {
        // "its job fails" must be true: the fault lands at the first moment in this step at which the node is at work
        // on a job; a node that stays idle through the whole step goes down idle, and describe() says so
        const i = nodeIndex.get(node)!
        const until = c.until === 'end' ? run().end : typeof c.until === 'number' && c.until > when ? c.until : when + look.advance
        let at = when, caught = false
        for (let t = when; t <= until - look.reaction; t += look.scan) { const v = run().at(t).nodes[i]!; if (v.busy && !v.down && t - v.since >= look.scan && v.since + v.duration - t >= look.scan) { at = t; caught = true; break } }
        if (!caught) idleCrash.add(node); else idleCrash.delete(node)
        faults.push({ t: at, kind: 'crash', node })
        if (!next.down.includes(node)) next.down.push(node)
        if (many && typeof spec.for === 'number' && spec.for > 0) { faults.push({ t: at + spec.for, kind: 'recover', node }); next.down = next.down.filter((d) => d !== node) }
        broke = true
      }
    }
    if (needsRun('recover')) for (const node of named('recover', c.recover)) { faults.push({ t: when, kind: 'recover', node }); next.down = next.down.filter((d) => d !== node); broke = true }
    if (needsRun('poison')) {
      const n = typeof c.poison === 'number' && c.poison >= 1 ? Math.round(c.poison) : 1
      const left = FLOW_JOBS.spare - prev.poison
      if (n > left) ctx.report(`${id}: at most ${FLOW_JOBS.spare} poison jobs fit in one story`, `poison: ${Math.max(0, left)}`)
      if (Math.min(n, left) > 0) { faults.push({ t: when, kind: 'poison', value: Math.min(n, left) }); next.poison += Math.min(n, left); broke = true }
    }
    if (needsRun('rate')) {
      if (typeof c.rate === 'number' && c.rate > 0) { faults.push({ t: when, kind: 'rate', value: c.rate }); next.rate = c.rate; broke = true }
      else ctx.report(`${id}: rate must be jobs per second, a number above 0`, 'rate: 2')
    }
    if (running && clock && (c.until !== undefined || broke)) {
      const end = run().end
      let to = c.until === 'end' ? end : typeof c.until === 'number' && Number.isFinite(c.until) ? c.until : c.until === undefined ? Math.min(end, prev.clock + look.advance) : NaN
      if (Number.isNaN(to)) { ctx.report(`${id}: until must be seconds or 'end'`, "until: 12  ·  until: 'end'"); to = prev.clock }
      if (to < prev.clock) { ctx.report(`${id}: until: ${to} is before the clock (${prev.clock.toFixed(1)} s); the clock only runs forward`, `until: ${Math.ceil(prev.clock + look.advance)}`); to = prev.clock }
      const def = (clock as unknown as { def: { max: number } }).def
      if (to > def.max) def.max = Math.ceil(to)
      if (to > prev.clock) st.set(clock, to, { rate: linear })
      next.clock = to
    } else if (!running && c.until !== undefined) needsRun('until')
    for (const what of list(c.show)) {
      if (what !== 'conservation') { ctx.report(`${id}: show: '${what}' is not known`, "show: 'conservation'"); continue }
      if (!running) { needsRun('show'); continue }
      if (next.show.includes(what)) continue
      next.show.push(what)
      const signs = signAt.map(([x, y], i) => text(i === 0 ? '=' : '+', { id: `${id}.sign${i + 1}`, size: 'label', color: look.ink }).at(x, y))
      st.play(...signs.map((sign) => fadeIn(sign)), ...COUNTERS.map((name) => indicate(terms[name]!, { color: null })))
    }
    // by hand: one job along a route, and node states
    for (const route of list(c.send)) {
      const stops = route.split(/->|>/).map((x) => resolveNodes(g, x.trim())[0])
      const hops: Handle[] = []
      stops.forEach((stop, i) => { if (i > 0) { const e = stop && stops[i - 1] ? edgeOf(stops[i - 1]!, stop) : undefined; if (e) hops.push(e); else ctx.report(`${id}: send: '${route}' follows no link of this system`, `links: ${g.links.map((l) => `${l.from} -> ${l.to}`).join(', ')}`) } })
      if (!hops.length) continue
      const job = dot({ radius: look.token, color: look.job }).at(nodeOf(stops[0]!)!).z(3).allow('TINY')
      st.play(fadeIn(job, { duration: look.appear }))
      for (const hop of hops) st.play(moveAlong(job, hop, { duration: look.hop }))
      st.play(fadeOut(job, { duration: look.appear }))
    }
    for (const [key, state] of [['busy', 'busy'], ['fail', 'failed'], ['idle', 'idle']] as const) {
      for (const node of named(key, c[key])) { next.marks[node] = state; const n = nodeOf(node); if (n) st.play(n.to.state(state)) }
    }
    return next
  }

  const api = {
    /** node ids, in the order written */
    nodes: g.nodes.map((n) => n.id),
    /** a live count: 'in' | 'done' | 'queued' | 'inFlight' | 'dead' at the block's clock, or at time t */
    count: (name: string, t?: number): number => { const v = (t === undefined ? snap() : run().at(t)) as unknown as Record<string, unknown>; return typeof v[name] === 'number' ? (v[name] as number) : 0 },
    /** how many jobs wait at a node, now or at time t */
    depth: (node: string, t?: number): number => { const i = nodeIndex.get(resolveNodes(g, node)[0] ?? ''); return i === undefined ? 0 : (t === undefined ? snap() : run().at(t)).nodes[i]!.depth },
    /** one number over the whole run as [t, value] points (a counter or a node's line): what a chart follows */
    series: (name: string) => {
      const key = COUNTERS.includes(name as never) ? name : resolveNodes(g, name)[0]
      if (!running || key === undefined) return undefined
      let made: { run: Run; points: [number, number][] } | null = null
      return (): [number, number][] => { const r = run(); if (!made || made.run !== r) made = { run: r, points: r.series(key) }; return made.points }
    },
    /** the block's clock in seconds, and when the run ends */
    time: now,
    end: (): number => (running ? run().end : 0),
    axis: 'time',
  }
  const describe = (state: FlowState): string => {
    if (!running) return `${id}: ${g.nodes.length} nodes, ${g.links.length} links${Object.keys(state.marks).length ? `; ${Object.entries(state.marks).map(([n, v]) => `${n} ${v}`).join(', ')}` : ''}`
    const c = run().at(state.clock)
    const retried = run().jobs.filter((j) => j.failedAt <= state.clock).length
    return `${id} at ${state.clock.toFixed(1)} s: in ${c.in} = done ${c.done} + queued ${c.queued} + in flight ${c.inFlight} + dead ${c.dead}; ${retried} job(s) failed at least once${state.down.length ? `; down: ${state.down.map((n) => (idleCrash.has(n) ? `${n} (was idle when it went down: no job of its own failed)` : n)).join(', ')}` : ''}`
  }
  return { root, initial: { clock: 0, down: [], poison: 0, rate: null, show: [], marks: {} }, keys: null, target, targets: names, apply: apply as BlockHandle<FlowState>['apply'], api, describe }
}
