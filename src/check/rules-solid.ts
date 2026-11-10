// The solid rules: INTERPENETRATE, COLLIDE-IN-MOTION, PARAM-BREAKS, FLOATING, CONTAINED, COINCIDENT, CAMERA-CLIP.
// One collector measures the solids of every sample (pure maths, no rendering); the rules then judge with every
// sample known, so each can say where a problem starts and where it is worst, and can tell a collision between two
// parts that move from two primitives that were stacked into one body on purpose.
//
// Who is exempt (so that an error here is worth reading):
//  - a housing: material ghost / glass, `shell: true`, or made transparent by a view mode;
//  - a declared fit: a.attach(b), between(a, b), a.pin(b), a.at(b), a mechanism that names both; expect.inside(a, b);
//    a.allow(code, b);
//  - parts of one composite kind (the kind is one solid for check), and a part that is still entering.
import { basisOf, defineRule, type MNode, type Sample, type TRS, type Vec3 } from '../core/index.ts'
import { axisLabel } from '../lib/solids/index.ts'
import { collect, type CheckCtx, type CheckRule, type Where } from './engine.ts'
import { boxesApart, insideSolid, isContained, overlap, placementRefs, relativePose, separation, spanOf, unitOf, volumeOverlap, type SolidPart } from './solids.ts'

const r2 = (x: number): number => Math.round(x * 100) / 100 + 0
const r3 = (x: number): number => Math.round(x * 1000) / 1000 + 0
/** a length for a message: two decimals, three when it is small */
export const len = (x: number): string => String(Math.abs(x) < 0.1 ? r3(x) : r2(x))
const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)
const FULL = 0.999

interface Seen { world: TRS; shapeKey: string; shell: boolean; /** fully entered */ full: boolean }
interface Hit { a: string; b: string; depth: number; limit: number; insideA: number; insideB: number }
interface Floater { ids: string[]; gap: number; from: string; nearest: string; direction: Vec3; span: number; /** diagonal of the whole model */ model: number; /** thinnest extent of the part that is nearest to the rest */ thin: number; baseParts: number; solidParts: number }
interface SolidNotes {
  /** per sample index: where every solid was */
  seen: Map<number, Map<string, Seen>>
  /** per sample index: overlapping pairs that have no declared fit */
  hits: Map<number, Hit[]>
  /** pairs that are one body by declaration (same group): a static overlap of theirs is not reported */
  grouped: Set<string>
  /** step-end samples only */
  floaters: Map<number, Floater[]>
  /** per step-end sample: ids of parts that were connected to the model there */
  attached: Map<number, Set<string>>
  contained: Map<number, { a: string; b: string }[]>
  coincident: Map<number, { a: string; b: string; iou: number }[]>
  inside: Map<number, string[]>
  /** parts whose solid is only a box (no sdf, no mesh) */
  boxOnly: Set<string>
  /** diagonal of each part's box, and the contact tolerance of each step-end sample */
  sizes: Map<string, number>
  tolerance: Map<number, number>
}
export const solidNotes = (c: CheckCtx): SolidNotes => c.bag<SolidNotes>('solid', () => ({ seen: new Map(), hits: new Map(), grouped: new Set(), floaters: new Map(), attached: new Map(), contained: new Map(), coincident: new Map(), inside: new Map(), boxOnly: new Set(), sizes: new Map(), tolerance: new Map() }))

/** how a sample is named in a sentence */
export function when(c: CheckCtx, s: Sample, w: Where = c.where(s)): string {
  if (w.clause) return w.clause
  if (s.kind === 'transition' && s.step !== null) { const st = c.model.steps[s.step - 1]!; return `${Math.round(((s.tau - st.t0) / Math.max(st.active, 1e-9)) * 100)}% of the way through step ${s.step} (t = ${r2(s.tau)} s)` }
  return s.step !== null ? `at the end of step ${s.step}` : `at t = ${r2(s.tau)} s`
}
/** the command that shows a sample */
export const seeIt = (s: Sample, w: Where): string[] => (w.hint.length ? w.hint : s.kind === 'transition' ? [`see it: mimir shot <scene> --at ${r2(s.tau)}`] : s.step !== null ? [`see it: mimir shot <scene> --step ${s.step}`] : [])
const SIDE: Record<string, string> = { '+X': 'left', '-X': 'right', '+Y': 'down', '-Y': 'up', '+Z': 'back', '-Z': 'front' }
/**
 * The relation that puts `a` against `b` when b lies in `direction` from a: nextTo with no gap. (attach would also
 * make a turn with b, which is wrong for a part that only rests on something that spins.)
 */
export const besideFix = (a: string, b: string, direction: Vec3): string => `${a}.nextTo(${b}, '${SIDE[axisLabel(direction)]}', 0)`

// ── the collector: every sample, no pixels ───────────────────────────────────────────────────────────
collect({
  name: 'solids', pure: true, for: ['INTERPENETRATE', 'COLLIDE-IN-MOTION', 'PARAM-BREAKS', 'FLOATING', 'CONTAINED', 'COINCIDENT', 'CAMERA-CLIP'], on: ['step-end', 'transition', 'param', 'phase'],
  run(c) {
    const f = c.frame!, s = c.sample!
    const parts = c.solids(f)
    if (!parts.length) return
    const notes = solidNotes(c)
    const L = c.limits
    const units = new Map<MNode, SolidPart>(parts.map((p) => [p.node, p]))
    notes.seen.set(c.index, new Map(parts.map((p) => [p.id, { world: p.world, shapeKey: p.shapeKey, shell: p.shell, full: p.present >= FULL }])))
    for (const p of parts) { if (!p.exact) notes.boxOnly.add(p.id); notes.sizes.set(p.id, p.span) }

    // declared fits: a placement that names the other part, in either direction, through groups on both sides
    const related = new Set<string>()
    for (const p of parts) {
      for (let n: MNode | null = p.node; n; n = n.parent) {
        for (const ref of placementRefs(n, f)) {
          const targets = units.has(ref) || unitOf(ref, units) ? [unitOf(ref, units)!] : parts.filter((q) => { for (let x: MNode | null = q.node; x; x = x.parent) if (x === ref) return true; return false })
          for (const t of targets) if (t !== p) related.add(pairKey(p.id, t.id))
        }
      }
    }
    // expect.inside(a, b) declares the fit (and is checked: EXPECT-FAILED)
    const declared = new Set<string>()
    for (const e of c.store.expects) if (e.kind === 'inside') { const a = unitOf(e.args[0] as MNode, units), b = unitOf(e.args[1] as MNode, units); if (a && b) declared.add(pairKey(a.id, b.id)) }
    // parts of one group are one object by declaration
    const rootOf = (n: MNode): MNode => { let x = n; while (x.parent) x = x.parent; return x }
    const sameGroup = (a: SolidPart, b: SolidPart): boolean => !!a.node.parent && rootOf(a.node) === rootOf(b.node)

    // 1. overlaps between solids that are fully there, are real solids, and have no declared fit
    const hits: Hit[] = []
    const fit = (a: SolidPart, b: SolidPart): boolean => related.has(pairKey(a.id, b.id)) || declared.has(pairKey(a.id, b.id)) || c.allowed('INTERPENETRATE', a.node, b.node)
    for (let i = 0; i < parts.length; i++) {
      const a = parts[i]!
      if (a.shell || !a.exact || a.present < FULL) continue
      for (let j = i + 1; j < parts.length; j++) {
        const b = parts[j]!
        if (b.shell || !b.exact || b.present < FULL || boxesApart(a.bounds, b.bounds) || fit(a, b)) continue
        const o = overlap(a, b, c.cache, L.solidSamples)
        if (!o) continue
        const limit = L.interpenetrateDepth * Math.min(a.thin, b.thin)
        if (o.depth <= limit) continue
        hits.push({ a: a.id, b: b.id, depth: o.depth, limit, insideA: o.insideA, insideB: o.insideB })
        if (sameGroup(a, b)) notes.grouped.add(pairKey(a.id, b.id))
      }
    }
    if (hits.length) notes.hits.set(c.index, hits)
    if (s.kind !== 'step-end' && s.kind !== 'transition') return

    // 2. the camera inside a solid
    if (c.model.viewport) {
      const eye = basisOf(f.camera()).eye
      const inside = parts.filter((p) => p.opaque && p.exact && p.present >= FULL && !c.allowed('CAMERA-CLIP', p.node) && insideSolid(p, eye) < 0).map((p) => p.id)
      if (inside.length) notes.inside.set(c.index, inside)
    }
    if (s.kind !== 'step-end') return

    // 3. swallowed and doubled parts
    const swallowed: { a: string; b: string }[] = []
    const doubled: { a: string; b: string; iou: number }[] = []
    for (let i = 0; i < parts.length; i++) {
      for (let j = 0; j < parts.length; j++) {
        if (i === j) continue
        const a = parts[i]!, b = parts[j]!
        if (!a.exact || !b.exact || a.present < FULL || b.present < FULL || boxesApart(a.bounds, b.bounds)) continue
        if (i < j && !a.shell && !b.shell && !c.allowed('COINCIDENT', a.node, b.node)) {
          // the same solid in the same place: cheap test first (the boxes agree), then the volumes
          const close = [0, 1, 2].every((k) => Math.abs(a.bounds.min[k]! - b.bounds.min[k]!) <= L.sameBox * a.span && Math.abs(a.bounds.max[k]! - b.bounds.max[k]!) <= L.sameBox * a.span)
          if (close) { const v = volumeOverlap(a, b); if (v > L.coincidentIou) { doubled.push({ a: a.id, b: b.id, iou: v }); continue } }
        }
        // a inside b: b hides it for good only while b is opaque and whole
        if (a.shell || !b.opaque || a.span > b.span || declared.has(pairKey(a.id, b.id)) || c.allowed('CONTAINED', a.node, b.node)) continue
        if (isContained(a, b, L.solidSamples)) swallowed.push({ a: a.id, b: b.id })
      }
    }
    if (swallowed.length) notes.contained.set(c.index, swallowed)
    if (doubled.length) notes.coincident.set(c.index, doubled)

    // 4. what hangs in the air: contact, declared relations and groups connect parts
    const here = parts.filter((p) => p.present >= FULL)
    const n = here.length
    if (n < 2) return
    const span = spanOf(here)
    const tol = L.floatContact * span
    notes.tolerance.set(c.index, tol)
    const parent = here.map((_, i) => i)
    const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]! } return i }
    const join = (i: number, j: number): void => { const a = find(i), b = find(j); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b) }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = here[i]!, b = here[j]!
      if (find(i) === find(j)) continue
      if (related.has(pairKey(a.id, b.id)) || sameGroup(a, b)) { join(i, j); continue }
      if (boxesApart(a.bounds, b.bounds, tol)) continue
      if (separation(a, b, c.cache, L.solidSamples).distance <= tol) join(i, j)
    }
    const groups = new Map<number, number[]>()
    for (let i = 0; i < n; i++) { const g = find(i); groups.set(g, [...(groups.get(g) ?? []), i]) }
    const list = [...groups.values()]
    // the model is the group with the most parts (the larger one when two are equal)
    const base = list.reduce((best, g) => (g.length > best.length || (g.length === best.length && spanOf(g.map((i) => here[i]!)) > spanOf(best.map((i) => here[i]!))) ? g : best))
    notes.attached.set(c.index, new Set(base.map((i) => here[i]!.id)))
    const solid = here.filter((p) => !p.shell).length
    const found: Floater[] = []
    for (const g of list) {
      if (g === base) continue
      const members = g.map((i) => here[i]!)
      if (members.every((p) => p.shell) || members.every((p) => c.allowed('FLOATING', p.node))) continue
      const own = spanOf(members)
      if (own < L.floatMinSpan * span) continue
      let best = Infinity, from = '', nearestId = '', direction: Vec3 = [0, 0, 0]
      for (const p of members) for (const q of here) {
        if (g.includes(here.indexOf(q))) continue
        const lower = Math.max(0, ...[0, 1, 2].map((k) => Math.max(p.bounds.min[k]! - q.bounds.max[k]!, q.bounds.min[k]! - p.bounds.max[k]!)))
        if (lower >= best) continue
        const near = separation(p, q, c.cache, L.solidSamples)
        if (near.distance < best) { best = near.distance; from = p.id; nearestId = q.id; direction = [near.pointB[0] - near.pointA[0], near.pointB[1] - near.pointA[1], near.pointB[2] - near.pointA[2]] }
      }
      if (best === Infinity) continue
      found.push({ ids: members.map((p) => p.id), gap: Math.max(0, best), from, nearest: nearestId, direction, span: own, thin: members.find((p) => p.id === from)?.thin ?? 0, model: span, baseParts: base.filter((i) => !here[i]!.shell).length, solidParts: solid })
    }
    if (found.length) notes.floaters.set(c.index, found)
  },
})

// ── judging with every sample known ──────────────────────────────────────────────────────────────────
/** did the two parts keep their relative place over every sample that has both? */
function fixedPair(notes: SolidNotes, a: string, b: string): boolean {
  let first: { p: Vec3; q: number[] } | null = null
  let scale = 1
  for (const m of notes.seen.values()) {
    const x = m.get(a), y = m.get(b)
    if (!x || !y) continue
    const rel = relativePose(x.world, y.world)
    if (!first) { first = rel; scale = Math.max(1e-9, Math.hypot(...rel.p), 1); continue }
    if (Math.hypot(rel.p[0] - first.p[0], rel.p[1] - first.p[1], rel.p[2] - first.p[2]) > 1e-4 * scale) return false
  }
  return true
}
interface PairStory { a: string; b: string; all: { index: number; hit: Hit }[]; first: { index: number; hit: Hit }; worst: { index: number; hit: Hit }; kinds: Set<Sample['kind']>; rigid: boolean }
/** every overlapping pair with the samples it overlaps in, and whether it is two parts of one rigid body */
function pairStories(c: CheckCtx): PairStory[] {
  return c.bag('solid.pairs', () => {
    const notes = solidNotes(c)
    const by = new Map<string, PairStory>()
    for (const [index, hits] of [...notes.hits].sort((x, y) => x[0] - y[0])) for (const hit of hits) {
      const key = pairKey(hit.a, hit.b)
      let st = by.get(key)
      if (!st) by.set(key, (st = { a: hit.a, b: hit.b, all: [], first: { index, hit }, worst: { index, hit }, kinds: new Set(), rigid: false }))
      st.all.push({ index, hit })
      st.kinds.add(c.samples[index]!.kind)
      if (hit.depth > st.worst.hit.depth) st.worst = { index, hit }
    }
    for (const st of by.values()) {
      // one rigid body made of two primitives: they keep their relative place and overlap as much everywhere they are both seen
      const depths = st.all.map((x) => x.hit.depth)
      const both = [...notes.seen.values()].filter((m) => m.get(st.a)?.full && m.get(st.b)?.full).length
      st.rigid = fixedPair(notes, st.a, st.b) && st.all.length >= both && Math.max(...depths) - Math.min(...depths) <= c.limits.rigidDepthChange * Math.max(...depths)
    }
    return [...by.values()]
  })
}
const lineOf = (c: CheckCtx, id: string): number | null => c.model.byId.get(id)?.src.line ?? null
const smaller = (c: CheckCtx, a: string, b: string): [string, string] => { const sizes = solidNotes(c).sizes; return (sizes.get(a) ?? 0) <= (sizes.get(b) ?? 0) ? [a, b] : [b, a] }
/** the ways out of a collision, the most likely first: room, then the declarations that make an overlap intended */
const collisionFix = (c: CheckCtx, st: PairStory): string[] => {
  const [small, big] = smaller(c, st.a, st.b)
  const h = st.worst.hit
  const swallowed = (small === h.a ? h.insideA : h.insideB) > 0.5
  return [
    `make room: move #${small} out of the way of #${big}, or make one of them ${len(h.depth)} smaller where they meet`,
    swallowed ? `if #${small} is meant to sit inside #${big}, declare the fit: expect.inside(${small}, ${big})` : `if one drives the other, say so with a relation (${small}.attach(${big}, …)): a declared fit is not a collision`,
    swallowed ? `if #${big} is only a housing, make it one: ${big}.material('glass')` : `if the overlap is meant: ${small}.allow('INTERPENETRATE', ${big})`,
  ]
}

const solidRule = (def: CheckRule): void => defineRule({ ...def, pure: true } as CheckRule)

solidRule({
  code: 'INTERPENETRATE', phase: 'story',
  run(c0) {
    const c = c0 as CheckCtx
    const notes = solidNotes(c)
    if (notes.boxOnly.size) c.unknown('INTERPENETRATE', [...notes.boxOnly], `the kind of ${[...notes.boxOnly].map((id) => `#${id}`).join(', ')} describes no solid (no sdf, no mesh), so overlap with other parts was not measured (INTERPENETRATE, CONTAINED, COINCIDENT, CAMERA-CLIP)`)
    const stories = pairStories(c)
    // two parts that move against each other and overlap at the end of a step
    for (const st of stories) {
      if (st.rigid || !st.kinds.has('step-end')) continue
      const at = st.all.find((x) => c.samples[x.index]!.kind === 'step-end')!
      const s = c.samples[at.index]!, w = c.where(s)
      const ws = c.samples[st.worst.index]!
      const [small, big] = smaller(c, st.a, st.b)
      const deeper = st.worst.hit.depth > at.hit.depth * 1.05 ? `; deepest ${len(st.worst.hit.depth)} ${when(c, ws)}` : ''
      c.report({ ids: [small, big], step: s.step, t: w.t, line: lineOf(c, small), measured: r3(at.hit.depth), limit: r3(at.hit.limit), what: `#${small} and #${big} overlap by ${len(at.hit.depth)} units ${when(c, s, w)} (limit ${len(at.hit.limit)}: ${Math.round(c.limits.interpenetrateDepth * 100)}% of the thinner part) and they move against each other: a collision${deeper}.`, fix: [...collisionFix(c, st), ...seeIt(s, w)] })
    }
    // primitives that overlap and never move against each other: one body, or a misplaced part? ask once per cluster
    const rigid = stories.filter((st) => st.rigid && !notes.grouped.has(pairKey(st.a, st.b)))
    const cluster = new Map<string, string>()
    const root = (id: string): string => { let x = id; while (cluster.get(x) && cluster.get(x) !== x) x = cluster.get(x)!; return x }
    for (const st of rigid) { for (const id of [st.a, st.b]) if (!cluster.has(id)) cluster.set(id, id); cluster.set(root(st.a), root(st.b)) }
    const groups = new Map<string, PairStory[]>()
    for (const st of rigid) groups.set(root(st.a), [...(groups.get(root(st.a)) ?? []), st])
    for (const list of groups.values()) {
      const ids = [...new Set(list.flatMap((st) => [st.a, st.b]))]
      const worst = list.reduce((a, b) => (b.worst.hit.depth > a.worst.hit.depth ? b : a))
      const s = c.samples[worst.first.index]!
      c.report({ severity: 'warn', ids, step: s.step, t: null, line: lineOf(c, ids[0]!), measured: r3(worst.worst.hit.depth), limit: r3(worst.worst.hit.limit), what: `${ids.length === 2 ? `#${worst.a} and #${worst.b} overlap by ${len(worst.worst.hit.depth)} units` : `${ids.map((id) => `#${id}`).join(', ')} overlap (#${worst.a} and #${worst.b} by ${len(worst.worst.hit.depth)} units)`} and never move against each other: one body built from ${ids.length} parts, or a part in the wrong place.`, fix: [`if they are one body, say so: group([${ids.join(', ')}])`, `or set one against the other: ${besideFix(worst.a, worst.b, [0, -1, 0])}`, `or exempt the pair: ${worst.a}.allow('INTERPENETRATE', ${worst.b})`] })
    }
  },
})

solidRule({
  code: 'COLLIDE-IN-MOTION', phase: 'story',
  run(c0) {
    const c = c0 as CheckCtx
    for (const st of pairStories(c)) {
      if (st.rigid || st.kinds.has('step-end') || !(st.kinds.has('transition') || st.kinds.has('phase'))) continue
      const first = st.all.find((x) => { const k = c.samples[x.index]!.kind; return k === 'transition' || k === 'phase' })!
      const s = c.samples[first.index]!, w = c.where(s)
      const ws = c.samples[st.worst.index]!
      const [small, big] = smaller(c, st.a, st.b)
      const deeper = st.worst.index !== first.index && st.worst.hit.depth > first.hit.depth * 1.05 ? `; deepest ${len(st.worst.hit.depth)} ${when(c, ws)}` : ''
      c.report({ ids: [small, big], step: s.step, t: w.t, line: lineOf(c, small), measured: r3(st.worst.hit.depth), limit: r3(first.hit.limit), ...(w.params ? { params: w.params } : {}), what: `#${small} passes through #${big} (${len(first.hit.depth)} units deep) ${when(c, s, w)}${deeper}; they are clear at the end of every step, so the still frames do not show it.`, fix: [...seeIt(s, w), ...collisionFix(c, st).slice(0, 2)] })
    }
  },
})

solidRule({
  code: 'PARAM-BREAKS', phase: 'story',
  run(c0) {
    const c = c0 as CheckCtx
    for (const st of pairStories(c)) {
      if (st.rigid || st.kinds.has('step-end') || st.kinds.has('transition') || st.kinds.has('phase')) continue
      const s = c.samples[st.worst.index]!, w = c.where(s)
      if (!w.clause) continue
      const [small, big] = smaller(c, st.a, st.b)
      const name = Object.keys(w.params ?? {})[0] ?? ''
      c.report({ ids: [small, big], step: s.step, t: w.t, line: lineOf(c, small), measured: r3(st.worst.hit.depth), limit: r3(st.worst.hit.limit), ...(w.params ? { params: w.params } : {}), what: `the scene is sound where the story has "${name}", but ${w.clause} #${small} cuts ${len(st.worst.hit.depth)} units into #${big} (INTERPENETRATE).`, fix: [`narrow the slider so it cannot get there: s.param('${name}', { min, max })`, `or make the geometry follow the param: derive the size or place of #${big} from ${name}()`, ...w.hint] })
    }
  },
})

solidRule({
  code: 'FLOATING', phase: 'story',
  run(c0) {
    const c = c0 as CheckCtx
    const notes = solidNotes(c)
    const L = c.limits
    const done = new Set<string>()
    for (const [index, list] of [...notes.floaters].sort((x, y) => x[0] - y[0])) for (const fl of list) {
      const key = [...fl.ids].sort().join('|')
      if (done.has(key)) continue
      done.add(key)
      // a part that is attached at the end of some step travels (a token that docks, a ball that lands): not a mistake
      const lands = [...notes.attached].some(([i, set]) => fl.ids.some((id) => set.has(id)) && notes.seen.get(i)?.has(fl.from))
      if (lands) continue
      // something that moves near the model (an orbit, a part in flight) is not a part that failed to touch
      if (!fixedPair(notes, fl.from, fl.nearest)) continue
      // a near miss: close to a model that holds together, or almost touching whatever is next to it. Bodies that are
      // meant to be apart (planets, charges) have nothing that holds together and gaps wider than themselves.
      const near = (fl.baseParts >= 2 && fl.gap <= L.floatNear * fl.model) || fl.gap <= L.floatClose * fl.thin
      const stray = fl.baseParts >= L.floatAssembly && fl.baseParts * 2 >= fl.solidParts
      if (!near && !stray) continue
      const s = c.samples[index]!
      const who = fl.ids.length === 1 ? `#${fl.ids[0]}` : `${fl.ids.map((id) => `#${id}`).join(', ')} (which hold together)`
      const d = fl.direction, g = Math.hypot(d[0], d[1], d[2]) || 1
      const move: Vec3 = [r2((d[0] / g) * fl.gap), r2((d[1] / g) * fl.gap), r2((d[2] / g) * fl.gap)]
      c.report({
        severity: near ? 'error' : 'warn', fold: near ? 'near' : 'stray', ids: fl.ids, step: s.step, t: null, line: lineOf(c, fl.from), measured: r3(fl.gap), limit: r3(notes.tolerance.get(index) ?? 0),
        what: `${who} ${fl.ids.length === 1 ? 'touches' : 'touch'} nothing else: the nearest part, #${fl.nearest}, is ${len(fl.gap)} units away (along ${axisLabel(d)})${near ? '' : `, far from the ${fl.baseParts} parts that hold together`}.`,
        fix: [`close the gap with a relation: ${besideFix(fl.from, fl.nearest, d)}`, `or move it by the gap: ${fl.from}.shift(${move.join(', ')})`, `if it is meant to hang free: ${fl.from}.allow('FLOATING')`],
      })
    }
  },
})

solidRule({
  code: 'CONTAINED', phase: 'story',
  run(c0) {
    const c = c0 as CheckCtx
    const notes = solidNotes(c)
    const ends = c.samples.map((s, i) => [s, i] as const).filter(([s]) => s.kind === 'step-end')
    const pairs = new Map<string, { a: string; b: string; index: number }>()
    for (const [index, list] of [...notes.contained].sort((x, y) => x[0] - y[0])) for (const p of list) if (!pairs.has(p.a)) pairs.set(p.a, { ...p, index })
    for (const { a, b, index } of pairs.values()) {
      // never visible: swallowed by something opaque at the end of every step it is on stage in
      const always = ends.every(([, i]) => !notes.seen.get(i)?.has(a) || [...(notes.contained.get(i) ?? [])].some((p) => p.a === a))
      if (!always) continue
      const s = c.samples[index]!
      c.report({ ids: [a, b], step: s.step, t: null, line: lineOf(c, a), measured: 100, limit: 100, what: `#${a} is completely inside #${b} (100% of its surface), which is solid and opaque in every step: #${a} can never be seen.`, fix: [`put it on the outside: ${besideFix(a, b, [0, -1, 0])}`, `or show the inside: ${b}.material('glass'), or cut #${b} open in the steps about #${a}`, `or, if it is not needed, delete #${a}`] })
    }
  },
})

solidRule({
  code: 'COINCIDENT', phase: 'story',
  run(c0) {
    const c = c0 as CheckCtx
    const notes = solidNotes(c)
    const done = new Set<string>()
    for (const [index, list] of [...notes.coincident].sort((x, y) => x[0] - y[0])) for (const p of list) {
      const key = pairKey(p.a, p.b)
      if (done.has(key)) continue
      done.add(key)
      const s = c.samples[index]!
      c.report({ ids: [p.a, p.b], step: s.step, t: null, line: lineOf(c, p.b), measured: Math.round(p.iou * 100), limit: Math.round(c.limits.coincidentIou * 100), what: `#${p.a} and #${p.b} are the same size in the same place (their volumes overlap ${Math.round(p.iou * 100)}%): only one of them can be seen.`, fix: [`give each its own place: ${p.b}.nextTo(${p.a}, 'right')`, `or delete one of them`] })
    }
  },
})

solidRule({
  code: 'CAMERA-CLIP', phase: 'story',
  run(c0) {
    const c = c0 as CheckCtx
    const notes = solidNotes(c)
    const done = new Set<string>()
    for (const [index, ids] of [...notes.inside].sort((x, y) => x[0] - y[0])) for (const id of ids) {
      if (done.has(id)) continue
      done.add(id)
      // said about the end of the step when the camera is still inside there: that is the frame the author looks at
      const end = [...notes.inside].find(([i, list]) => list.includes(id) && c.samples[i]!.kind === 'step-end' && c.samples[i]!.step === c.samples[index]!.step)
      const s = c.samples[end ? end[0] : index]!
      const own = c.model.cameraClips().some((clip) => clip.step === (s.step ?? 0) - 1)
      c.report({ ids: [id], step: s.step, t: c.where(s).t, line: lineOf(c, id), what: `the camera is inside #${id} ${when(c, s)}: the frame shows the inside of the part, or nothing.`, fix: [own ? `remove the distance / zoom from the st.camera() call of step ${s.step} (the camera frames the model on its own)` : 'st.camera({ fit: true })', `or frame what the step is about: st.camera({ fit: [${id}] })`, ...seeIt(s, c.where(s))] })
    }
  },
})

