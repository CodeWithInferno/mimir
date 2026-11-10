// Rules about what the author declared and how the story is told: EXPECT-FAILED (s.expect, expect.*), MECH-OPEN
// (invariants that mechanisms declare, rods that change length), PLACE-NONE, TEXT-LONG, CHAPTER-LONG, HATCH-USE.
// All of them are pure maths on the model: they run without a browser.
import { closest, defineRule, isNode, kindOf, toVec3, type Box3, type Frame, type MNode, type Sample, type Vec3 } from '../core/index.ts'
import { axisLabel, surfaceSamples } from '../lib/solids/index.ts'
import type { ExpectRec } from './index.ts'
import { alsoRun, type CheckCtx, type CheckRule } from './engine.ts'
import { timelineSamples } from './plan.ts'
import { besideFix, len, seeIt, when } from './rules-solid.ts'
import { overlap, separation, spanOf, unitOf, type SolidPart } from './solids.ts'

const r2 = (x: number): number => Math.round(x * 100) / 100 + 0
const r3 = (x: number): number => Math.round(x * 1000) / 1000 + 0
const num = (x: number): string => (Number.isFinite(x) ? String(Math.abs(x) >= 100 ? Math.round(x) : Math.abs(x) >= 1 ? r2(x) : r3(x)) : String(x))
const pure = (def: CheckRule): void => defineRule({ ...def, pure: true } as CheckRule)

/** the plan and the timeline: every state an expectation or an invariant is held to */
const everywhere = (c: CheckCtx): Sample[] => c.bag('story.samples', () => [...c.samples, ...timelineSamples(c.model, c.limits.timelineSamples)])
const frameOf = (c: CheckCtx, s: Sample): Frame => c.bag('story.frames', () => new Map<Sample, Frame>()).get(s) ?? (() => { const f = c.stateAt(s.tau, s.params); c.bag('story.frames', () => new Map<Sample, Frame>()).set(s, f); return f })()
/** the model's size: the span of its solids, else of everything visible, else the 10 units a scene is meant to be */
const scaleOf = (c: CheckCtx): number => c.bag('story.scale', () => {
  const last = c.samples.filter((s) => s.kind === 'step-end').pop()
  const f = c.stateAt(last ? last.tau : 0)
  const solids = spanOf(c.solids(f))
  if (solids > 0) return solids
  let lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const n of f.visibleLeaves()) { const b = f.bounds(n); lo = lo.map((v, i) => Math.min(v, b.min[i]!)) as Vec3; hi = hi.map((v, i) => Math.max(v, b.max[i]!)) as Vec3 }
  const d = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
  return Number.isFinite(d) && d > 0 ? d : 10
})

// ── EXPECT-FAILED ────────────────────────────────────────────────────────────────────────────────────
interface Verdict { ok: boolean; /** how wrong, for "worst" */ by: number; measured: number | string; limit: number | string | null; detail: string; fix: string[] }
const NOT_EVALUATED = Symbol('not evaluated')
const yOf = (b: Box3): [number, number] => [b.min[1], b.max[1]]
const probe = (f: Frame, p: unknown, what: string): number => {
  const v = typeof p === 'string' ? f.probes()[p] : f.value<unknown>(p, NaN, null, what)
  return typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : NaN
}
const probeName = (p: unknown): string => (typeof p === 'string' ? `"${p}"` : 'the first function')

/** One expectation in one state: a verdict, or null when it does not apply there (an object is not on stage). */
function judge(c: CheckCtx, e: ExpectRec, f: Frame): Verdict | null {
  const L = c.limits
  const tol = typeof e.opts.tolerance === 'number' && e.opts.tolerance >= 0 ? e.opts.tolerance : null
  if (e.kind === 'fn') {
    const v = f.value<unknown>(e.args[0], NOT_EVALUATED, null, `the expectation "${e.name}"`)
    if (v === NOT_EVALUATED) return null
    if (typeof v !== 'boolean') {
      const told = c.bag('expect.type', () => new Set<ExpectRec>())
      if (!told.has(e)) { told.add(e); c.report({ ids: [], step: null, t: null, line: e.src.line, file: e.src.file ?? undefined, measured: String(v), what: `the function of "${e.name}" returned ${v === undefined ? 'nothing' : typeof v === 'number' ? `the number ${v}` : `a ${typeof v}`}: an expectation answers true or false.`, fix: ["return a comparison: s.expect('…', () => lift() > 0)"] }) }
      return null
    }
    const probes = Object.entries(f.probes()).filter(([, x]) => Number.isFinite(x)).slice(0, 4).map(([name, x]) => `${name} = ${num(x)}`)
    return { ok: v, by: v ? 0 : 1, measured: String(v), limit: 'true', detail: probes.length ? `the probes there: ${probes.join(', ')}` : 'no probe is declared that would say why: add s.probe(name, fn) for the values it compares', fix: [] }
  }
  if (e.kind === 'ratio') {
    const a = probe(f, e.args[0], e.name), b = probe(f, e.args[1], e.name)
    const k = e.opts.factor as number
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null
    const off = Math.abs(a - k * b), size = Math.max(Math.abs(a), Math.abs(k * b))
    const limit = (tol ?? L.ratioTolerance) * size + 1e-9
    return { ok: off <= limit, by: off / Math.max(size, 1e-9), measured: b !== 0 ? r3(a / b) : `${num(a)} / 0`, limit: k, detail: `${probeName(e.args[0])} is ${num(a)} and ${typeof e.args[1] === 'string' ? `"${e.args[1]}"` : 'the second'} is ${num(b)}${b !== 0 ? `: a ratio of ${num(a / b)}` : ''}, expected ${num(k)}`, fix: [`compute the first from the second: ${typeof e.args[1] === 'string' ? e.args[1] : 'b'}() * ${num(k)}`, `or, if ${b !== 0 ? num(a / b) : 'this'} is right, correct the factor in the expectation`] }
  }
  if (e.kind === 'conserved') return null // judged over all samples at once
  const [na, nb] = e.args as [MNode, MNode]
  if (!f.visible(na) || !f.visible(nb)) return null
  const A = f.bounds(na), B = f.bounds(nb)
  const solids = na.space === '3d' && nb.space === '3d' ? c.solids(f) : []
  const units = new Map<MNode, SolidPart>(solids.map((p) => [p.node, p]))
  const sa = solids.length ? unitOf(na, units) : null, sb = solids.length ? unitOf(nb, units) : null
  const a = na.id, b = nb.id
  if (e.kind === 'above') {
    const [lowA] = yOf(A), [, topB] = yOf(B)
    const short = topB - lowA
    return { ok: short <= (tol ?? 1e-6 * scaleOf(c)), by: short, measured: r3(lowA), limit: r3(topB), detail: `the lowest point of #${a} (y = ${num(lowA)}) is ${len(short)} below the top of #${b} (y = ${num(topB)})`, fix: [`put it on top by a relation: ${a}.nextTo(${b}, 'up', 0)`, `or raise it by the difference: ${a}.shift(0, ${num(Math.ceil(short * 100) / 100)}${na.space === '3d' ? ', 0' : ''})`] }
  }
  if (e.kind === 'touching') {
    let gap: number, direction: Vec3
    if (sa && sb && sa !== sb) { const n = separation(sa, sb, c.cache, L.solidSamples); gap = n.distance; direction = [n.pointB[0] - n.pointA[0], n.pointB[1] - n.pointA[1], n.pointB[2] - n.pointA[2]] }
    else { const d = [0, 1, 2].map((i) => Math.max(0, B.min[i]! - A.max[i]!, A.min[i]! - B.max[i]!)); gap = Math.hypot(d[0]!, d[1]!, d[2]!); direction = [0, 1, 2].map((i) => (B.min[i]! > A.max[i]! ? 1 : A.min[i]! > B.max[i]! ? -1 : 0) * d[i]!) as Vec3 }
    const limit = tol ?? (sa && sb ? L.floatContact * scaleOf(c) : 0.02)
    const g = Math.hypot(direction[0], direction[1], direction[2]) || 1
    const move = direction.map((x) => num((x / g) * gap)).slice(0, na.space === '3d' ? 3 : 2).join(', ')
    return { ok: gap <= limit, by: gap, measured: r3(Math.max(0, gap)), limit: r3(limit), detail: `there is a gap of ${len(gap)} units between #${a} and #${b} (along ${axisLabel(direction)})`, fix: [`close it with a relation: ${besideFix(a, b, direction)}`, `or move it by the gap: ${a}.shift(${move})`] }
  }
  // inside: every point of a within the box of b (b's own axes when both are solids, so a tilted housing works)
  let out = 0, axis = ''
  if (sa && sb && sa !== sb) {
    const w = sb.world, [x, y, z, q] = w.q
    const local = f.localBounds(sb.node)
    const pts = sa.exact ? surfaceSamples(sa.proxy, L.solidSamples) : ([0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? sa.bounds.max[0] : sa.bounds.min[0], i & 2 ? sa.bounds.max[1] : sa.bounds.min[1], i & 4 ? sa.bounds.max[2] : sa.bounds.min[2]]) as Vec3[])
    for (const p of pts) {
      const v: Vec3 = [p[0] - w.p[0], p[1] - w.p[1], p[2] - w.p[2]]
      // rotate by the inverse of b's turn
      const tx = 2 * (-y * v[2] + z * v[1]), ty = 2 * (-z * v[0] + x * v[2]), tz = 2 * (-x * v[1] + y * v[0])
      const l: Vec3 = [(v[0] + q * tx + (-y * tz + z * ty)) / w.s, (v[1] + q * ty + (-z * tx + x * tz)) / w.s, (v[2] + q * tz + (-x * ty + y * tx)) / w.s]
      for (let i = 0; i < 3; i++) { const over = Math.max(local.min[i]! - l[i]!, l[i]! - local.max[i]!) * w.s; if (over > out) { out = over; axis = 'xyz'[i]! } }
    }
  } else for (let i = 0; i < (na.space === '3d' ? 3 : 2); i++) { const over = Math.max(B.min[i]! - A.min[i]!, A.max[i]! - B.max[i]!); if (over > out) { out = over; axis = 'xyz'[i]! } }
  const limit = tol ?? 1e-3 * scaleOf(c)
  return { ok: out <= limit, by: out, measured: r3(out), limit: r3(limit), detail: `#${a} reaches ${len(out)} units outside #${b} (along ${sa && sb ? `#${b}'s ` : ''}${axis})`, fix: [`centre it inside: ${a}.attach(${b}, { my: 'center', to: 'center' })`, `or make #${a} smaller by ${len(out * 2)} along ${axis}, or #${b} larger`] }
}

pure({
  code: 'EXPECT-FAILED', phase: 'story',
  run(c0) {
    const c = c0 as CheckCtx
    const model = c.model
    const stepOf = (e: ExpectRec): number | null | undefined => {
      if (e.during === null) return null
      const hit = typeof e.during === 'number' ? model.steps[e.during - 1] : model.steps.find((s) => s.title === e.during) ?? model.steps.find((s) => s.title.toLowerCase() === String(e.during).toLowerCase())
      return hit ? hit.k : undefined
    }
    for (const e of c.store.expects) {
      const ids = e.args.filter(isNode).map((n) => n.id)
      const only = stepOf(e)
      if (only === undefined) {
        const near = typeof e.during === 'string' ? closest(e.during, model.steps.map((s) => s.title)) : null
        c.report({ ids, step: null, t: null, line: e.src.line, file: e.src.file ?? undefined, what: `expect.during(${typeof e.during === 'number' ? e.during : `'${e.during}'`}, …): there is no such step (the scene has ${model.steps.length}).`, fix: [near ? `use '${near}'` : `steps: ${model.steps.map((s) => `${s.k} "${s.title}"`).join(', ')}`] })
        continue
      }
      const where = everywhere(c).filter((s) => only === null || s.step === only)
      if (e.kind === 'conserved') {
        const seen = where.map((s) => ({ s, v: probe(frameOf(c, s), e.args[0], e.name) })).filter((x) => Number.isFinite(x.v))
        if (!seen.length) { c.unknown('EXPECT-FAILED', ids, `${e.name} never gave a number, so it was not checked`); continue }
        const lo = seen.reduce((a, b) => (b.v < a.v ? b : a)), hi = seen.reduce((a, b) => (b.v > a.v ? b : a))
        const size = Math.max(Math.abs(lo.v), Math.abs(hi.v))
        const limit = (typeof e.opts.tolerance === 'number' ? e.opts.tolerance : c.limits.conservedTolerance) * size + 1e-9
        if (hi.v - lo.v <= limit) continue
        const s = hi.s.tau === seen[0]!.s.tau && hi.s.params === seen[0]!.s.params ? lo.s : hi.s
        const w = c.where(s)
        c.report({ ids, step: s.step, t: w.t, line: e.src.line, file: e.src.file ?? undefined, measured: `${num(lo.v)} … ${num(hi.v)}`, limit: num(limit), ...(w.params ? { params: w.params } : {}), what: `${e.name} is false: ${typeof e.args[0] === 'string' ? `"${e.args[0]}"` : 'the value'} goes from ${num(lo.v)} ${when(c, lo.s)} to ${num(hi.v)} ${when(c, hi.s)}, a change of ${num(((hi.v - lo.v) / Math.max(size, 1e-9)) * 100)}% (limit ${num((limit / Math.max(size, 1e-9)) * 100)}%).`, fix: ['whatever sets it must not depend on time or on a param: derive the moving part from the fixed length, not the other way round', 'or, if a small change is fine, allow it: expect.conserved(probe, { tolerance: 0.05 })', ...seeIt(s, w)] })
        continue
      }
      let total = 0
      const failed: { s: Sample; v: Verdict }[] = []
      for (const s of where) { const v = judge(c, e, frameOf(c, s)); if (!v) continue; total++; if (!v.ok) failed.push({ s, v }) }
      if (!total) { if (e.kind !== 'fn' || !c.bag('expect.type', () => new Set<ExpectRec>()).has(e)) c.unknown('EXPECT-FAILED', ids, `${e.name} was never evaluated${ids.length ? `: ${ids.map((id) => `#${id}`).join(' and ')} are never on stage together${only ? ` in step ${only}` : ''}` : ''}`); continue }
      if (!failed.length) continue
      const first = failed[0]!, worst = failed.reduce((a, b) => (b.v.by > a.v.by ? b : a))
      const w = c.where(first.s)
      const more = worst !== first && worst.v.by > first.v.by * 1.05 ? ` Worst ${when(c, worst.s)}: ${worst.v.detail}.` : ''
      const scopeFix = only === null && failed.length < total ? [`if it only has to hold in some steps, say which: expect.during(${first.s.step === 1 ? 2 : 1}, () => ${e.kind === 'fn' ? '…' : e.name})`] : []
      c.report({ ids, step: first.s.step, t: w.t, line: e.src.line, file: e.src.file ?? undefined, measured: first.v.measured, limit: first.v.limit, ...(w.params ? { params: w.params } : {}), what: `${e.kind === 'fn' ? `"${e.name}"` : e.name} is false ${when(c, first.s, w)}: ${first.v.detail}. It fails in ${failed.length} of the ${total} states it was checked in.${more}`, fix: [...first.v.fix, ...(e.kind === 'fn' ? ['make the condition true at that moment: compare the probes above with what the function expects'] : []), ...scopeFix, ...seeIt(first.s, w).map((x) => (e.kind === 'fn' ? `${x} (the probes of that moment are written next to the frame)` : x))] })
    }
  },
})

// ── MECH-OPEN ────────────────────────────────────────────────────────────────────────────────────────
// Shared with the module that builds mechanisms (it registers the rule for its own mechanisms): see alsoRun().
alsoRun({
  code: 'MECH-OPEN', phase: 'story', pure: true,
  run(c0) {
    const c = c0 as CheckCtx
    const all = everywhere(c)
    // 1. what mechanisms declared about themselves
    for (const inv of c.store.invariants) {
      const limit = inv.tolerance ?? c.limits.mechOpen * scaleOf(c)
      let first: { s: Sample; r: number } | null = null, worst: { s: Sample; r: number } | null = null, n = 0
      for (const s of all) {
        const f = frameOf(c, s)
        const r = f.run(() => f.value<number>(() => inv.residual(f), NaN, null, `the invariant "${inv.name}"`))
        if (!Number.isFinite(r)) continue
        n++
        if (Math.abs(r) <= limit) continue
        first ??= { s, r: Math.abs(r) }
        if (!worst || Math.abs(r) > worst.r) worst = { s, r: Math.abs(r) }
      }
      if (!n) { c.unknown('MECH-OPEN', inv.ids, `the invariant "${inv.name}" never gave a number, so it was not checked`); continue }
      if (!first || !worst) continue
      const w = c.where(worst.s)
      c.report({ ids: inv.ids, step: first.s.step, t: c.where(first.s).t, line: inv.src.line, file: inv.src.file ?? undefined, measured: r3(worst.r), limit: r3(limit), ...(w.params ? { params: w.params } : {}), what: `${inv.what} does not hold: it is off by ${len(worst.r)} units ${when(c, worst.s, w)} (limit ${len(limit)})${first.s !== worst.s ? `, first ${when(c, first.s)}` : ''}.`, fix: [...(inv.fix.length ? inv.fix : ['let the mechanism place its parts: remove any .at(), .shift() or tween that moves one of them on its own']), ...seeIt(worst.s, w)].slice(0, 3) })
    }
    // 2. a rod between two points that changes length: something rigid is being stretched
    for (const node of c.model.nodes) {
      if (node.space !== '3d' || c.allowed('MECH-OPEN', node)) continue
      let lo: { s: Sample; d: number } | null = null, hi: { s: Sample; d: number } | null = null
      for (const s of all) {
        const f = frameOf(c, s)
        const pl = f.prop<{ type?: string; a?: unknown; b?: unknown } | null>(node, 'placement')
        if (!pl || pl.type !== 'between' || !f.visible(node)) continue
        const a = toVec3(f.point(pl.a, node)), b = toVec3(f.point(pl.b, node))
        if (!a || !b) continue
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
        if (!lo || d < lo.d) lo = { s, d }
        if (!hi || d > hi.d) hi = { s, d }
      }
      if (!lo || !hi || hi.d - lo.d <= c.limits.mechOpen * scaleOf(c)) continue
      const w = c.where(hi.s)
      c.report({ severity: 'warn', ids: [node.id], step: hi.s.step, t: w.t, line: node.src.line, file: node.src.file ?? undefined, measured: `${num(lo.d)} … ${num(hi.d)}`, limit: r3(c.limits.mechOpen * scaleOf(c)), ...(w.params ? { params: w.params } : {}), what: `#${node.id} spans two points whose distance goes from ${num(lo.d)} ${when(c, lo.s)} to ${num(hi.d)} ${when(c, hi.s)}: a rigid rod cannot change length by ${num(hi.d - lo.d)}.`, fix: [`place one end from the other so the length stays ${num(lo.d)}: a mechanism (crankSlider) or a function that keeps the distance`, `if it is meant to stretch (a spring, a beam, a string): ${node.id}.allow('MECH-OPEN')`, ...seeIt(hi.s, w)] })
    }
  },
})

// ── PLACE-NONE ───────────────────────────────────────────────────────────────────────────────────────
const volume = (b: Box3, dims: number): number => { let v = 1; for (let i = 0; i < dims; i++) v *= Math.max(0, b.max[i]! - b.min[i]!); return v }
const shared = (a: Box3, b: Box3, dims: number): number => { let v = 1; for (let i = 0; i < dims; i++) v *= Math.max(0, Math.min(a.max[i]!, b.max[i]!) - Math.max(a.min[i]!, b.min[i]!)); return v }
pure({
  code: 'PLACE-NONE', phase: 'story',
  run(c0) {
    const c = c0 as CheckCtx
    const model = c.model
    const placed = (n: MNode): boolean => n.placement !== null || !!model.clipsFor(n, 'placement') || n.props.shift !== undefined || !!model.clipsFor(n, 'shift')
    // candidates: top-level objects the author never placed (parts of a composite and children of a layout are placed by it)
    // a group is where its members are: one whose members were all placed (or are drawn between points) was not forgotten
    const settled = (n: MNode): boolean => placed(n) || !!kindOf(n.kind)?.worldGeometry || (!!kindOf(n.kind)?.container && n.children.length > 0 && n.children.every(settled))
    const loose = model.nodes.filter((n) => !n.parent && !settled(n) && !kindOf(n.kind)?.inert)
    if (loose.length < 2) return
    const done = new Set<string>()
    for (const s of c.samples) {
      if (s.kind !== 'step-end') continue
      const f = frameOf(c, s)
      const here = loose.filter((n) => f.visible(n) && f.reveal(n).p >= 0.999)
      const solids = c.solids(f)
      const units = new Map<MNode, SolidPart>(solids.map((p) => [p.node, p]))
      const kindOfThing = (n: MNode): string => (n.space === '3d' ? 'solid' : kindOf(n.kind)?.text ? 'text' : 'shape')
      const piles: MNode[][] = []
      for (let i = 0; i < here.length; i++) for (let j = i + 1; j < here.length; j++) {
        const a = here[i]!, b = here[j]!
        if (kindOfThing(a) !== kindOfThing(b)) continue // a caption on a box is a picture, not a pile
        let pile = false
        if (a.space === '3d') {
          const sa = units.get(a), sb = units.get(b)
          if (sa && sb) pile = !sa.shell && !sb.shell && (sa.exact && sb.exact ? ((): boolean => { const o = overlap(sa, sb, c.cache, c.limits.solidSamples); return !!o && o.depth > c.limits.interpenetrateDepth * Math.min(sa.thin, sb.thin) })() : shared(sa.bounds, sb.bounds, 3) > c.limits.pileVolume * Math.min(volume(sa.bounds, 3), volume(sb.bounds, 3)))
        } else {
          const A = f.bounds(a), B = f.bounds(b)
          const small = Math.min(volume(A, 2), volume(B, 2)), large = Math.max(volume(A, 2), volume(B, 2))
          // objects of about the same size on top of each other; one small shape inside a large one is a composition
          pile = small > 0 && shared(A, B, 2) > c.limits.pileOverlap * small && (kindOfThing(a) === 'text' || small >= c.limits.pileSimilar * large)
        }
        if (!pile) continue
        const g = piles.find((p) => p.includes(a) || p.includes(b))
        if (g) { for (const n of [a, b]) if (!g.includes(n)) g.push(n) } else piles.push([a, b])
      }
      for (const pile of piles) {
        const key = pile.map((n) => n.id).sort().join('|')
        if (done.has(key)) continue
        done.add(key)
        const ids = pile.map((n) => n.id)
        const [a, b] = pile as [MNode, MNode]
        const three = a.space === '3d'
        c.report({ ids, step: s.step, t: null, line: b.src.line, file: b.src.file ?? undefined, measured: pile.length, limit: 1, what: `${pile.length} objects were never placed, so they all sit at the origin on top of each other: ${ids.map((id) => `#${id}`).join(', ')}.`, fix: [three ? `place each on the one it belongs to: ${b.id}.attach(${a.id}, { my: 'bottom', to: 'top' })` : `place each relative to another: ${b.id}.nextTo(${a.id}, 'right')`, three ? `or beside it: ${b.id}.nextTo(${a.id}, 'right')` : `or lay them out together: row([${ids.join(', ')}])`] })
      }
    }
  },
})

// ── TEXT-LONG ────────────────────────────────────────────────────────────────────────────────────────
pure({
  code: 'TEXT-LONG', phase: 'static', severity: 'warn',
  run(c0) {
    const c = c0 as CheckCtx
    const L = c.limits
    for (const a of c.model.actions) {
      const step = c.model.steps[a.step]
      if (a.type === 'label') {
        const data = a.data as { node?: MNode; text?: unknown }
        const text = String(data.text ?? '').trim()
        const words = text.split(/\s+/).filter(Boolean).length
        if (words <= L.labelWords && text.length <= L.labelChars) continue
        const id = data.node?.id ?? 'part'
        const short = text.split(/\s+/).slice(0, 2).join(' ')
        const span = (a.data as { cue?: number }).cue !== undefined // a label made by a narration span: [words](label:part)
        c.report({ fold: span ? 'span' : 'label', ids: data.node ? [data.node.id] : [], step: step?.k ?? null, t: null, line: a.src.line, file: a.src.file ?? undefined, measured: words > L.labelWords ? words : text.length, limit: words > L.labelWords ? L.labelWords : L.labelChars, what: `the label on #${id} is ${words > L.labelWords ? `${words} words` : `${text.length} characters`} long (a label is a name: at most ${L.labelWords} words, ${L.labelChars} characters): "${text.length > 48 ? text.slice(0, 45) + '…' : text}".`, fix: span ? [`put fewer words in the span: [${short}](label:${id})`, 'and say the rest outside the span'] : [`name the part and say the rest: st.label(${id}, '${short}') and st.say('${text.replace(/'/g, "\\'").slice(0, 60)}${text.length > 60 ? '…' : ''}')`] })
      } else if (a.type === 'say') {
        const plain = String((a.data as { plain?: unknown }).plain ?? '')
        if (plain.length <= L.captionChars) continue
        const cut = plain.slice(0, L.captionChars).lastIndexOf('. ')
        c.report({ fold: 'caption', ids: [], step: step?.k ?? null, t: null, line: a.src.line, file: a.src.file ?? undefined, measured: plain.length, limit: L.captionChars, what: `one st.say() of step ${step?.k ?? '?'} is ${plain.length} characters long (a caption is at most two lines, about ${L.captionChars} characters): "${plain.slice(0, 45)}…".`, fix: [cut > 20 ? `split it after "…${plain.slice(Math.max(0, cut - 18), cut + 1)}": two st.say() calls` : 'split it into two st.say() calls, one thought each', 'or move the detail to st.note(…), which read mode shows'] })
      }
    }
  },
})

// ── CHAPTER-LONG ─────────────────────────────────────────────────────────────────────────────────────
pure({
  code: 'CHAPTER-LONG', phase: 'static', severity: 'warn',
  run(c0) {
    const c = c0 as CheckCtx
    const model = c.model, limit = c.limits.chapterSeconds
    const judge = (title: string | null, index: number, steps: typeof model.steps, line: number | null, file: string | null): void => {
      if (!steps.length) return
      const seconds = steps[steps.length - 1]!.t1 - steps[0]!.t0
      if (seconds <= limit) return
      const longest = steps.reduce((a, b) => (b.t1 - b.t0 > a.t1 - a.t0 ? b : a))
      // the step whose start is nearest the middle is where a new chapter would begin
      const mid = steps[0]!.t0 + seconds / 2
      const split = steps.slice(1).reduce((a, b) => (Math.abs(b.t0 - mid) < Math.abs(a.t0 - mid) ? b : a), steps[Math.min(1, steps.length - 1)]!)
      c.report({ ids: [], step: steps[0]!.k, t: null, line, file: file ?? undefined, measured: Math.round(seconds), limit, what: title === null ? `the story runs ${Math.round(seconds)} s without a chapter (${steps.length} steps; a chapter is about ${limit} s at most).` : `chapter ${index} "${title}" lasts ${Math.round(seconds)} s (${steps.length} steps; about ${limit} s at most).`, fix: [steps.length > 1 ? `start a new chapter before step ${split.k}: s.chapter('…') above s.step('${split.title}', …)` : 'split the step in two, then start a chapter between them', `or shorten its longest step (step ${longest.k} "${longest.title}", ${Math.round(longest.t1 - longest.t0)} s)`] })
    }
    const real = model.chapters.filter((ch) => ch.firstStep >= 0)
    if (!real.length) { if (model.steps.length && model.steps.some((s) => s.narration.length)) judge(null, 0, model.steps, model.steps[0]!.src.line, model.steps[0]!.src.file); return }
    for (const ch of real) judge(ch.title, ch.index + 1, model.steps.filter((s) => s.chapter === ch.index), ch.src.line, ch.src.file)
  },
})

// ── HATCH-USE ────────────────────────────────────────────────────────────────────────────────────────
/** findings about solids that numbers typed by hand usually cause (2D layout with .at(x, y) is ordinary and is not counted) */
const PLACEMENT_FINDINGS = ['FLOATING', 'INTERPENETRATE', 'COLLIDE-IN-MOTION', 'COINCIDENT', 'CONTAINED']
/** kinds that bypass the engine's own geometry (DESIGN §5, "escape hatches") */
export const ESCAPE_KINDS = ['raw3d', 'svg', 'draw2d']
pure({
  code: 'HATCH-USE', phase: 'static', severity: 'info',
  run(c0) { const c = c0 as CheckCtx; hatchUse(c, c.found()) },
})
function hatchUse(c: CheckCtx, found: { code: string; ids: string[] }[]): void {
  const model = c.model
  const literal = (n: MNode): boolean => n.placement?.type === 'at' && Array.isArray((n.placement as { pos?: unknown }).pos)
  const placed = model.nodes.filter((n) => n.placement !== null && n.placement.type !== 'flow' && !(n.parent && n.id.startsWith(n.parent.id + '.')))
  const absolute = placed.filter(literal)
  const raw = model.nodes.filter((n) => ESCAPE_KINDS.includes(n.kind))
  const behind = new Map<string, Set<string>>()
  for (const d of found) if (PLACEMENT_FINDINGS.includes(d.code)) for (const id of d.ids) if (absolute.some((n) => n.id === id) || raw.some((n) => n.id === id)) behind.set(id, (behind.get(id) ?? new Set()).add(d.code))
  if (!behind.size) return
  const share = placed.length ? absolute.length / placed.length : 0
  if (share <= c.limits.hatchShare && !raw.length) return
  const ids = [...behind.keys()]
  const codes = [...new Set([...behind.values()].flatMap((s) => [...s]))]
  const first = model.byId.get(ids[0]!)
  c.report({ severity: 'info', ids, step: null, t: null, line: first?.src.line ?? null, file: first?.src.file ?? undefined, measured: Math.round(share * 100), limit: Math.round(c.limits.hatchShare * 100), what: `${absolute.length} of ${placed.length} placed objects use literal coordinates (.at(x, y${first?.space === '3d' ? ', z' : ''}))${raw.length ? ` and ${raw.length} bypass the engine (${[...new Set(raw.map((n) => n.kind))].join(', ')})` : ''}; ${ids.length} of them ${ids.length === 1 ? 'is' : 'are'} behind ${codes.join(', ')}: ${ids.map((id) => `#${id}`).join(', ')}.`, fix: [`replace the coordinates with a relation, which cannot drift: ${ids[0]}.attach(other, { my: 'bottom', to: 'top' }) or ${ids[0]}.nextTo(other, 'right')`] })
}
