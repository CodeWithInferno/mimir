// The page side of `mimir query`: measured answers to "how far apart are these", "what touches this", "where is
// it", "can it be seen", "what is the state", at any time and any slider setting. One request in, plain JSON out;
// nothing is drawn or changed (the time and the params on screen are put back). A bad request is answered with
// { error, fix }, never with an exception.
//
//   runQuery(runtime, { what: 'distance', args: ['piston', 'head'], step: 2 })
//   runQuery(runtime, { what: 'visible', args: ['piston'], t: 4.5, set: { crank: 180 } })
import { closest, kindOf, SceneModel, type Frame, type MNode, type ParamValue, type Runtime, type Vec3 } from '../core/index.ts'
import { axisLabel } from '../lib/solids/index.ts'
import { checkStore } from './index.ts'
import { LIMITS } from './limits.ts'
import { END_EPSILON, timelineSamples } from './plan.ts'
import { insideSolid, newSolidCache, overlap, separation, solidsOf, spanOf, unitOf, type SolidPart } from './solids.ts'

export const QUERIES = ['distance', 'contacts', 'bounds', 'visible', 'state', 'probes', 'coverage'] as const
export interface QueryRequest {
  what: string
  /** object ids (distance: two, contacts / bounds / visible: one or more) */
  args?: string[]
  /** story time in seconds; default: the time on screen */
  t?: number
  /** or: the end state of this step (1-based number or title) */
  step?: number | string
  /** param values to pin, by name */
  set?: Record<string, ParamValue>
  /** probes: how many moments of the story (default: the timelineSamples limit) */
  samples?: number
  /** distance / contacts: surfaces closer than this are touching (default: 1% of the model's span) */
  tolerance?: number
}
export type QueryResult = Record<string, unknown>

const r4 = (x: number): number => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 + 0 : x)
const v3 = (p: readonly number[]): number[] => [r4(p[0]!), r4(p[1]!), r4(p[2] ?? 0)]
const fail = (error: string, fix: string[]): QueryResult => ({ error, fix })

/**
 * Two ways to ask: one request object, or query(what, ids, options) about the state that is on screen.
 * Without a browser pass the model last: runQuery(null, request, model).
 */
export function runQuery(runtime: Runtime | null, request: unknown, ids?: unknown, options?: unknown): QueryResult {
  const modelIn = ids instanceof SceneModel ? ids : undefined
  const model = runtime ? runtime.model : modelIn
  if (!model) return fail('no scene is loaded.', ['open a scene first'])
  const req = (typeof request === 'string' ? { ...(typeof options === 'object' && options !== null ? options : {}), what: request, args: Array.isArray(ids) ? ids : [] } : typeof request === 'object' && request !== null ? request : {}) as QueryRequest
  const what = String(req.what ?? '')
  if (!(QUERIES as readonly string[]).includes(what)) { const near = closest(what, QUERIES); return fail(`there is no query "${what}".`, [near ? `use "${near}"` : `queries: ${QUERIES.join(', ')}`]) }

  // when: a step's end state, a time, or what is on screen; with params pinned
  let tau = runtime ? runtime.tau : 0
  if (req.step !== undefined) {
    const st = typeof req.step === 'number' || /^\d+$/.test(String(req.step)) ? model.steps[Number(req.step) - 1] : model.steps.find((s) => s.title === req.step)
    if (!st) { const near = typeof req.step === 'string' ? closest(req.step, model.steps.map((s) => s.title)) : null; return fail(`there is no step ${JSON.stringify(req.step)} (the scene has ${model.steps.length}).`, [near ? `use "${near}"` : `steps: ${model.steps.map((s) => `${s.k} "${s.title}"`).join(', ')}`]) }
    tau = Math.max(st.t0, st.t1 - END_EPSILON)
  } else if (req.t !== undefined) {
    if (typeof req.t !== 'number' || !Number.isFinite(req.t) || req.t < 0) return fail(`t must be a time in seconds, got ${String(req.t)}.`, [`a number from 0 to ${r4(model.duration)}`])
    tau = Math.min(req.t, model.duration)
  }
  const set: Record<string, ParamValue> = { ...(runtime ? runtime.overrides : {}) }
  for (const [name, value] of Object.entries(req.set ?? {})) {
    const def = model.params.find((p) => p.name === name)
    if (!def) { const near = closest(name, model.params.map((p) => p.name)); return fail(`the scene has no param "${name}".`, [near ? `use "${near}"` : `params: ${model.params.map((p) => p.name).join(', ') || 'none'}`]) }
    if (def.kind === 'number' && (typeof value !== 'number' || value < def.min || value > def.max)) return fail(`"${name}" goes from ${def.min} to ${def.max}, got ${String(value)}.`, [`set ${name} to a number in that range`])
    set[name] = value
  }
  const names = Array.isArray(req.args) ? req.args.map(String) : []
  const nodes: MNode[] = []
  /** per argument: the anchor it names ("piston.top"), or null for the whole object */
  const anchors: (string | null)[] = []
  // contacts without an id is about every solid part
  const need = what === 'distance' ? 2 : what === 'bounds' || what === 'visible' ? 1 : 0
  if (names.length < need) return fail(`${what} needs ${need === 2 ? 'two object ids' : 'an object id'}.`, [`mimir query <scene> ${what} ${need === 2 ? 'piston head' : 'piston'}`, `ids of this scene: ${[...model.byId.keys()].slice(0, 12).join(', ')}`])
  for (const raw of names) {
    const id = raw.replace(/^#/, '')
    let n = model.byId.get(id), anchor: string | null = null
    // "piston.top": a point of an object (an id may hold dots itself: the parts of a composite)
    if (!n && id.includes('.')) {
      const owner = model.byId.get(id.slice(0, id.lastIndexOf('.'))); const name = id.slice(id.lastIndexOf('.') + 1)
      const points = owner ? model.state(0).anchorNames(owner) : []
      if (owner && points.includes(name)) { n = owner; anchor = name }
      else if (owner) { const near = closest(name, points); return fail(`#${owner.id} has no point "${name}".`, [near ? `use "${owner.id}.${near}"` : `points of #${owner.id}: ${points.join(', ')}`]) }
    }
    if (n && anchor && what !== 'distance') return fail(`${what} takes an object, not a point of one (got "${id}").`, [`mimir query <scene> ${what} ${n.id}`])
    if (!n) { const near = closest(id, model.byId.keys()); return fail(`no object has the id "${id}".`, [near ? `use "${near}"` : `ids: ${[...model.byId.keys()].slice(0, 12).join(', ')}`]) }
    nodes.push(n)
    anchors.push(anchor)
  }

  const k = model.locate(tau).k
  const head = { what, t: r4(tau), step: k >= 0 ? k + 1 : null, ...(Object.keys(set).length ? { params: set } : {}) }
  // pure state for the maths; the runtime is moved only for what needs pixels, and always put back
  const frame = model.state(tau, set, runtime ? runtime.view : null)
  const cache = newSolidCache()
  const withPixels = <T,>(fn: (rt: Runtime) => T): T | null => {
    if (!runtime) return null
    const saved = { tau: runtime.tau, overrides: runtime.overrides }
    try { runtime.overrides = set; runtime.seek(tau); runtime.invalidate(); runtime.render(true); return fn(runtime) } finally { runtime.overrides = saved.overrides; runtime.seek(saved.tau); runtime.invalidate(); runtime.render(true) }
  }
  return frame.run(() => {
    const solids = solidsOf(frame, cache)
    const units = new Map<MNode, SolidPart>(solids.map((p) => [p.node, p]))
    const boxGap = (a: MNode, b: MNode): { gap: number; direction: Vec3 } => {
      const A = frame.bounds(a), B = frame.bounds(b)
      const d = [0, 1, 2].map((i) => (B.min[i]! > A.max[i]! ? B.min[i]! - A.max[i]! : A.min[i]! > B.max[i]! ? -(A.min[i]! - B.max[i]!) : 0)) as Vec3
      return { gap: Math.hypot(d[0], d[1], d[2]), direction: d }
    }
    const between = (a: MNode, b: MNode): QueryResult => {
      const sa = unitOf(a, units), sb = unitOf(b, units)
      const centres = (() => { const p = frame.anchor(a, 'center'), q = frame.anchor(b, 'center'); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) })()
      if (sa && sb && sa !== sb) {
        const n = separation(sa, sb, cache, LIMITS.solidSamples)
        const o = n.distance < 0 ? overlap(sa, sb, cache, LIMITS.solidSamples) : null
        const direction: Vec3 = [n.pointB[0] - n.pointA[0], n.pointB[1] - n.pointA[1], n.pointB[2] - n.pointA[2]]
        const tol = typeof req.tolerance === 'number' && req.tolerance >= 0 ? req.tolerance : LIMITS.floatContact * spanOf(solids)
        return { distance: r4(n.distance), relation: n.distance > tol ? 'apart' : o && o.depth > LIMITS.interpenetrateDepth * Math.min(sa.thin, sb.thin) ? 'overlapping' : 'touching', gap: r4(Math.max(0, n.distance)), depth: r4(o ? o.depth : Math.max(0, -n.distance)), along: n.distance > 0 ? axisLabel(direction) : null, pointA: v3(n.pointA), pointB: v3(n.pointB), centres: r4(centres), measured: sa.exact && sb.exact ? 'solids' : 'boxes', contactTolerance: r4(tol) }
      }
      const g = boxGap(a, b)
      return { distance: r4(g.gap), relation: g.gap > 0 ? 'apart' : 'touching or overlapping', gap: r4(g.gap), depth: null, along: g.gap > 0 ? axisLabel(g.direction) : null, centres: r4(centres), measured: 'boxes' }
    }

    if (what === 'distance') {
      const [a, b] = nodes as [MNode, MNode]
      if (anchors[0] || anchors[1]) {
        // a named point: to the other point, or to the surface of the other solid
        const pa = frame.anchor(a, anchors[0] ?? 'center'), pb = frame.anchor(b, anchors[1] ?? 'center')
        const solid = anchors[0] && anchors[1] ? null : unitOf(anchors[0] ? b : a, units)
        const d = solid ? insideSolid(solid, anchors[0] ? pa : pb) : Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2])
        return { ...head, a: names[0], b: names[1], distance: r4(d), measured: solid ? 'point to surface (negative = inside)' : 'point to point', pointA: v3(pa), pointB: v3(pb) }
      }
      // a 3D part and a 2D object share no space: only where they are drawn can be compared
      if (a.space !== b.space) return { ...head, a: a.id, b: b.id, distance: null, space: 'mixed', measured: 'nothing', reason: `#${a.id} is ${a.space === '3d' ? 'a 3D part' : 'a 2D object'} and #${b.id} is ${b.space === '3d' ? 'a 3D part' : 'a 2D object'}: they share no space, so there is no distance between them. Compare where they are drawn: query bounds gives the rectangle of each on screen.` }
      if (!frame.visible(a) || !frame.visible(b)) return { ...head, a: a.id, b: b.id, error: `${[a, b].filter((n) => !frame.visible(n)).map((n) => `#${n.id}`).join(' and ')} ${frame.visible(a) || frame.visible(b) ? 'is' : 'are'} not on stage at t = ${r4(tau)}.`, fix: ['ask at a time when both are shown: --step k or --at t'] }
      return { ...head, a: a.id, b: b.id, ...between(a, b) }
    }
    if (what === 'contacts') {
      const out = (nodes.length ? nodes : solids.map((p) => p.node)).map((n) => {
        const self = unitOf(n, units)
        const others = solids.filter((p) => p !== self && !within(p.node, n))
        if (!self) return { id: n.id, error: `#${n.id} (${n.kind}) is not a solid 3D part at t = ${r4(tau)}, so it has no contacts.`, fix: ['ask about a 3D part that is on stage'] }
        const rows = others.map((p) => ({ id: p.id, ...between(n, p.node) } as { id: string; distance: number; relation: string; gap: number; depth: number | null; along: string | null }))
        const near = rows.filter((r) => r.relation !== 'apart').sort((x, y) => x.distance - y.distance)
        const nearest = rows.filter((r) => r.relation === 'apart').sort((x, y) => x.distance - y.distance)[0]
        return { id: n.id, touching: near.filter((r) => r.relation === 'touching').map((r) => r.id), overlapping: near.filter((r) => r.relation === 'overlapping').map((r) => ({ id: r.id, depth: r.depth })), nearest: nearest ? { id: nearest.id, gap: nearest.gap, along: nearest.along } : null, floating: near.length === 0 }
      })
      return { ...head, contacts: out }
    }
    if (what === 'bounds') {
      const px = withPixels((rt) => nodes.map((n) => rt.screenRect(n)))
      return { ...head, bounds: nodes.map((n, i) => {
        const b = frame.bounds(n)
        const r = px?.[i] ?? null
        return { id: n.id, kind: n.kind, space: n.space, onStage: frame.visible(n), min: v3(b.min), max: v3(b.max), size: v3([b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]), center: v3(frame.anchor(n, 'center')), screen: r ? { x: r4(r.x), y: r4(r.y), width: r4(r.width), height: r4(r.height) } : null }
      }) }
    }
    if (what === 'visible') {
      const pass = withPixels((rt) => ({ pass: rt.idPass({ solo: true }), rects: nodes.map((n) => rt.screenRect(n)), stage: rt.stage() }))
      return { ...head, visible: nodes.map((n, i) => {
        const onStage = frame.visible(n)
        const base = { id: n.id, onStage, enter: r4(frame.reveal(n).p), opacity: r4(frame.opacity(n)), dimmed: frame.dim(n) > 0.01 }
        if (!pass) return { ...base, pixels: 'unknown', reason: 'no browser: nothing was rendered' }
        const rect = pass.rects[i]
        if (n.space === '2d') {
          const inFrame = !!rect && rect.x < pass.stage.width && rect.y < pass.stage.height && rect.x + rect.width > 0 && rect.y + rect.height > 0
          return { ...base, visible: onStage && inFrame, inFrame, screen: rect ? { x: r4(rect.x), y: r4(rect.y), width: r4(rect.width), height: r4(rect.height) } : null, pixels: 'unknown', reason: '2D objects are not counted by the id pass; `visible` says whether it is on stage and inside the frame' }
        }
        const ids: string[] = []
        const walk = (x: MNode): void => { if (x.space === '3d' && !kindOf(x.kind)?.container) ids.push(x.id); x.children.forEach(walk) }
        walk(n)
        let pixels = 0, total = 0
        for (const id of ids) { const p = pass.pass?.parts[id]; if (p) { pixels += Math.min(p.pixels, p.total ?? p.pixels); total += p.total ?? p.pixels } }
        const fp = frame.frameRect(n)
        const depth = frame.project3(frame.anchor(n, 'center')).depth
        const hiddenBy = total > pixels && pass.pass && rect ? Object.values(pass.pass.parts).filter((p) => !ids.includes(p.id) && p.pixels > 0 && p.rect.x < rect.x + rect.width && rect.x < p.rect.x + p.rect.width && p.rect.y < rect.y + rect.height && rect.y < p.rect.y + p.rect.height).filter((p) => { const o = model.byId.get(p.id); return !!o && frame.project3(frame.anchor(o, 'center')).depth < depth }).map((p) => p.id) : []
        return { ...base, visible: onStage && pixels > 0, pixels, total, ratio: total ? r4(pixels / total) : 0, housing: frame.look(n).shell, inPanel: !!fp, hiddenBy }
      }) }
    }
    if (what === 'probes') {
      const n = typeof req.samples === 'number' && req.samples >= 1 ? Math.min(2000, Math.floor(req.samples)) : LIMITS.timelineSamples
      const moments = timelineSamples(model, n)
      const series: Record<string, number[]> = {}
      for (const name of model.probes.keys()) series[name] = []
      for (const m of moments) { const p = model.state(m.tau, set).probes(); for (const name of Object.keys(series)) series[name]!.push(r4(p[name]!)) }
      return { what, ...(Object.keys(set).length ? { params: set } : {}), times: moments.map((m) => r4(m.tau)), steps: moments.map((m) => m.step), probes: series, range: Object.fromEntries(Object.entries(series).map(([name, v]) => { const ok = v.filter(Number.isFinite); return [name, ok.length ? { min: Math.min(...ok), max: Math.max(...ok) } : null] })) }
    }
    if (what === 'coverage') {
      const stats = (globalThis as { __mimirCheck?: unknown }).__mimirCheck ?? null
      return { what, lastCheck: stats, declared: { expectations: checkStore(model).expects.map((e) => e.name), invariants: checkStore(model).invariants.map((i) => i.name), exceptions: checkStore(model).allows.map((a) => `${a.node.id}.allow('${a.code}'${a.other ? `, ${a.other.id}` : ''})`) } }
    }
    // state: everything a claim about a moment can be checked against
    const params = Object.create(null) as Record<string, ParamValue>
    for (const p of model.params) params[p.name] = frame.param(p)
    const pose = model.viewport ? frame.camera() : null
    const shown = model.nodes.filter((n) => !kindOf(n.kind)?.container && frame.visible(n))
    return {
      ...head, title: frame.step?.title ?? null, duration: r4(model.duration), simTime: r4(frame.t), params, probes: Object.fromEntries(Object.entries(frame.probes()).map(([name, v]) => [name, r4(v)])),
      camera: pose ? { target: v3(pose.target), azimuth: r4(pose.azimuth), elevation: r4(pose.elevation), distance: r4(pose.distance) } : null,
      onStage: shown.map((n) => n.id), hidden: model.nodes.filter((n) => !kindOf(n.kind)?.container && !frame.visible(n)).map((n) => n.id),
      focused: frame.actions<{ nodes?: MNode[] }>('focus').flatMap((a) => (a.data.nodes ?? []).map((n) => n.id)), labelled: frame.actions<{ node?: MNode }>('label').map((a) => a.data.node?.id).filter(Boolean),
      positions: Object.fromEntries(shown.filter((n) => !n.parent || kindOf(n.parent.kind)?.container).slice(0, 200).map((n) => [n.id, v3(frame.anchor(n, 'center'))])),
    }
  })
}
const within = (inner: MNode, outer: MNode): boolean => { for (let n: MNode | null = inner; n; n = n.parent) if (n === outer) return true; return false }
export type { Frame }
