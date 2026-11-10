// check, main-chunk side: what a scene DECLARES for the linter. Nothing here measures anything: the calls below only
// record plain data on the model (model.store('check')). The sampling plan (./plan.ts), the engine (./engine.ts), the
// rules (./check.ts and ./rules-*.ts) and the page side of `mimir query` (./query.ts) are the lazy check chunk, which
// `__mimir.diagnostics()` loads on first use.
import {
  callSite, closest, currentModel, defineFinalize, defineMethod, defineSceneMethod, forgiving, isNode,
  type Frame, type MNode, type SceneModel, type Src,
} from '../core/index.ts'

// What a kind may say about itself for check, beside `solid`, `sdf` and `text` (core's KindDef): a point marker.
declare module '../core/registry.ts' {
  interface KindDef {
    /**
     * A point marker: an object that marks a place (a dot on a curve, a cursor on a plot) and is small by nature. TINY
     * does not ask it to fill a share of the frame when a step points at it; it must still be large enough to see.
     */
    marker?: boolean
  }
}

/** One author-declared truth: s.expect(name, fn) or expect.inside / touching / above / ratio / conserved. */
export interface ExpectRec {
  kind: 'fn' | 'inside' | 'touching' | 'above' | 'ratio' | 'conserved'
  /** the name given to s.expect, or the call as the author wrote it ("expect.above(valve, piston)") */
  name: string
  /** nodes for the relations, probes (a name or a function) for ratio / conserved, the predicate for 'fn' */
  args: unknown[]
  /** numbers such as tolerance, the factor of a ratio */
  opts: Record<string, unknown>
  /** only checked during this step (1-based number or title); null = at every sample */
  during: number | string | null
  src: Src
}
/** `part.allow(code, other?)`: one declared exception, on one object, for one rule. */
export interface AllowRec { code: string; node: MNode; other: MNode | null; src: Src }
/** An invariant a mechanism declares about itself (MECH-OPEN): residual(frame) is 0 while it holds, in world units. */
export interface InvariantRec {
  name: string
  ids: string[]
  residual: (frame: Frame) => number
  /** world units; default: a share of the scene's span (limit `mechOpen`) */
  tolerance: number | null
  /** what holds, as a clause: "the rod stays on the crank pin" */
  what: string
  fix: string[]
  src: Src
}
export interface CheckStore { expects: ExpectRec[]; allows: AllowRec[]; invariants: InvariantRec[]; options: { value: unknown; src: Src }[] }
/** Everything a scene declared for check, recorded on the model. */
export const checkStore = (model: SceneModel): CheckStore => model.store<CheckStore>('check', () => ({ expects: [], allows: [], invariants: [], options: [] }))

// ── expect.* ─────────────────────────────────────────────────────────────────────────────────────────
let scope: number | string | null = null // the step of the expect.during() block that is being recorded
const nameOf = (v: unknown): string => (isNode(v) ? v.id : typeof v === 'string' ? `'${v}'` : typeof v === 'function' ? 'fn' : String(v))
const numbers = (o: unknown): Record<string, unknown> => (typeof o === 'object' && o !== null && !isNode(o) ? { ...(o as Record<string, unknown>) } : {})

function record(kind: ExpectRec['kind'], call: string, args: unknown[], opts: unknown, name?: string): void {
  const model = currentModel()
  if (model.finalized) { model.late(call); return }
  checkStore(model).expects.push({ kind, name: name ?? `${call.replace('()', '')}(${args.map(nameOf).join(', ')})`, args, opts: numbers(opts), during: scope, src: callSite() })
}
/** two objects (or their ids) → the nodes; reports REF-MISSING / API-TYPE itself and returns null */
function pair(call: string, a: unknown, b: unknown): [MNode, MNode] | null {
  const model = currentModel()
  const na = isNode(a) ? a : model.resolveNode(a, call, 'the first object'), nb = isNode(b) ? b : model.resolveNode(b, call, 'the second object')
  if (!na || !nb) return null
  if (na === nb) { model.diagnostics.add({ code: 'API-TYPE', ids: [na.id], what: `${call}: both objects are #${na.id}.`, fix: [`pass two different objects: ${call.replace('()', '')}(a, b)`] }); return null }
  return [na, nb]
}
const isProbe = (v: unknown): boolean => typeof v === 'function' || (typeof v === 'string' && v !== '')

class Expect {
  /** a is inside b (a declared fit): checked, and the pair is exempt from INTERPENETRATE and CONTAINED */
  inside(a: unknown, b: unknown, opts?: unknown): void { const p = pair('expect.inside()', a, b); if (p) record('inside', 'expect.inside()', p, opts) }
  /** a and b touch: no gap between them (an overlap counts as touching) */
  touching(a: unknown, b: unknown, opts?: unknown): void { const p = pair('expect.touching()', a, b); if (p) record('touching', 'expect.touching()', p, opts) }
  /** all of a is above all of b (y up), in 2D and in 3D */
  above(a: unknown, b: unknown, opts?: unknown): void { const p = pair('expect.above()', a, b); if (p) record('above', 'expect.above()', p, opts) }
  /** probe a = factor × probe b at every sample */
  ratio(a: unknown, b: unknown, factor: unknown, opts?: unknown): void {
    const call = 'expect.ratio()'
    if (!isProbe(a) || !isProbe(b) || typeof factor !== 'number' || !Number.isFinite(factor)) { currentModel().diagnostics.add({ code: 'API-TYPE', what: `${call} needs two probes (names or functions) and a number, got (${nameOf(a)}, ${nameOf(b)}, ${String(factor)}).`, fix: ["expect.ratio('camAngle', 'crankAngle', 0.5)"] }); return }
    record('ratio', call, [a, b], { ...numbers(opts), factor }, `expect.ratio(${nameOf(a)}, ${nameOf(b)}, ${factor})`)
  }
  /** a probe keeps its value over the whole story and every slider position */
  conserved(probe: unknown, opts?: unknown): void {
    const call = 'expect.conserved()'
    if (!isProbe(probe)) { currentModel().diagnostics.add({ code: 'API-TYPE', what: `${call} needs a probe: its name or a function, got ${nameOf(probe)}.`, fix: ["expect.conserved('rodLength')"] }); return }
    record('conserved', call, [probe], opts)
  }
  /** only during one step: a condition `() => boolean`, or a block of expect.* calls */
  during(step: unknown, fn: unknown): void {
    const model = currentModel()
    const call = 'expect.during()'
    if ((typeof step !== 'number' && typeof step !== 'string') || typeof fn !== 'function') { model.diagnostics.add({ code: 'API-TYPE', what: `${call} needs a step (its number, from 1, or its title) and a function.`, fix: ["expect.during('Intake', () => expect.above(valve, piston))", 'expect.during(2, () => lift() > 0)'] }); return }
    if (model.finalized) { model.late(call); return }
    const store = checkStore(model)
    const before = store.expects.length
    const outer = scope
    scope = step
    let out: unknown
    try { out = fn() } catch (e) { model.reportError(e, call) } finally { scope = outer }
    // a block that declared relations is done; otherwise the function itself is the condition
    if (store.expects.length === before && out !== undefined) store.expects.push({ kind: 'fn', name: `during ${typeof step === 'number' ? `step ${step}` : `"${step}"`}`, args: [fn], opts: {}, during: step, src: callSite() })
  }
}
forgiving(Expect.prototype, () => 'expect')
/** Author-declared truth, checked by `mimir check` at every sample (EXPECT-FAILED). */
export const expect = new Expect()

/** s.expect(name, fn): fn must be true at every step end, transition sample and slider extreme. */
defineSceneMethod('expect', (s, name: unknown, fn: unknown) => {
  if (typeof name !== 'string' || !name || typeof fn !== 'function') { s.model.diagnostics.add({ code: 'API-TYPE', what: 's.expect() needs a name and a function that returns true while the claim holds.', fix: ["s.expect('the valve is shut at top dead centre', () => lift() === 0)"] }); return undefined }
  checkStore(s.model).expects.push({ kind: 'fn', name, args: [fn], opts: {}, during: scope, src: callSite() })
  return undefined
})

/** s.check({ limits, off }): settings of `mimir check` for this scene (thresholds by name, rules to switch off). */
defineSceneMethod('check', (s, options: unknown) => {
  checkStore(s.model).options.push({ value: options, src: callSite() })
  return undefined
})

/** part.allow(code, other?): this object is meant to break that rule (with that other object, when one is given). */
defineMethod('*', 'allow', (node: MNode, code: unknown, other?: unknown) => {
  const model = node.model
  if (typeof code !== 'string' || !code) { model.diagnostics.add({ code: 'API-TYPE', ids: [node.id], what: `${node.kind}.allow() needs the code of a check rule.`, fix: [`${node.id}.allow('FLOATING')`, `${node.id}.allow('INTERPENETRATE', other)`] }); return node }
  let partner: MNode | null = null
  if (other !== undefined) { partner = isNode(other) ? other : model.resolveNode(other, `${node.kind}.allow()`, 'the other object'); if (!partner) return node }
  checkStore(model).allows.push({ code: code.toUpperCase(), node, other: partner, src: callSite() })
  return node
})

/**
 * For modules that build mechanisms: declare something that must stay true while the mechanism moves. `mimir check`
 * samples it over the story, at the phases of every cyclic param and at the slider extremes (MECH-OPEN).
 * declareInvariant({ name: 'rod on crank pin', parts: [rod, crank], residual: (frame) => distance in world units })
 */
export function declareInvariant(spec: { name: string; parts: MNode[]; residual: (frame: Frame) => number; tolerance?: number; what?: string; fix?: string[]; model?: SceneModel }): void {
  const model = spec.model ?? spec.parts.find(isNode)?.model ?? currentModel()
  checkStore(model).invariants.push({ name: String(spec.name), ids: spec.parts.filter(isNode).map((n) => n.id), residual: spec.residual, tolerance: typeof spec.tolerance === 'number' ? spec.tolerance : null, what: spec.what ?? String(spec.name), fix: spec.fix ?? [], src: callSite() })
}

// a probe named by expect.ratio / expect.conserved must exist once the scene is built
defineFinalize('check.expect', (model) => {
  const names = [...model.probes.keys()]
  for (const e of checkStore(model).expects) {
    if (e.kind !== 'ratio' && e.kind !== 'conserved') continue
    for (const p of e.args) {
      if (typeof p !== 'string' || model.probes.has(p)) continue
      const near = closest(p, names)
      model.diagnostics.add({ code: 'REF-MISSING', step: null, t: null, what: `${e.name}: there is no probe "${p}".`, fix: [near ? `use "${near}"` : names.length ? `probes of this scene: ${names.join(', ')}` : `declare it first: s.probe('${p}', () => …)`] }, e.src)
    }
  }
})

export const api = { expect }
