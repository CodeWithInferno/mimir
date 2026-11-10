// check engine: runs the registered rules over the sampling plan and returns diagnostics in JSON form.
// Rules never throw to the caller: a rule that fails is itself reported (RUNTIME-ERROR, internal).
//
// What the engine adds to the rules:
//  - a state that was already measured is not measured again (the same picture, params and probes at two samples:
//    the end of the story and "param at its default"), and a sample whose rules are all pure maths is not rendered;
//  - the id pass is rendered once per sample (Runtime.idPass) and shared by every rule;
//  - one report per (rule, objects); effects are dropped when their cause is reported (two parts piled at the origin
//    are PLACE-NONE, not also INTERPENETRATE and COINCIDENT); many reports of one kind are folded into one line;
//  - what a rule could not measure is recorded as `unknown`, never as a pass.
import {
  allRules, kindOf, SEVERITY, sortDiags, stable,
  type Diag, type Frame, type MNode, type ParamValue, type RuleCtx, type RuleDef, type RuleReport, type Runtime, type Sample, type SceneModel, type Severity, type Space, type TextBox,
} from '../core/index.ts'
import { checkStore, type CheckStore } from './index.ts'
import { settingsOf, type Limits } from './limits.ts'
import { planSamples } from './plan.ts'
import { runQuery } from './query.ts'
import { newSolidCache, solidsOf, type SolidCache, type SolidPart } from './solids.ts'

export interface CheckOptions { /** only these rule codes */ rules?: string[]; static?: boolean }
/** What a run measured, skipped and could not measure. Attached to the array runCheck returns (`.stats`). */
export interface CheckStats {
  ms: number; samples: number; measured: number; rendered: number; skipped: number; idPasses: number; idPassHits: number; pairTests: number; pairHits: number; rules: number
  /** per rule code: objects (or scene-wide reasons) it could not measure */
  unknown: Record<string, { ids: string[]; why: string }[]>
}
/** A rule may say more than core's RuleDef: `pure` = it needs no pixels (the sample is then not rendered for it). */
export type CheckRule = RuleDef & { pure?: boolean }
/** What a report may add: reports of one rule with the same `fold` key are merged into one line. */
export type CheckReport = RuleReport & { fold?: string }
/**
 * Collectors measure a sample and keep notes for rules that can only judge once every sample is known ("first and
 * worst sample", "never moves relative to it"). They report nothing themselves and are internal to this module:
 * rules are still added with defineRule.
 */
export interface Collector { name: string; /** the rules that read its notes: it runs only when one of them does */ for: string[]; on: Sample['kind'][]; pure: boolean; run(c: CheckCtx): void }
/**
 * Rules this module runs under a code that another module may own. MECH-OPEN is the case: the module that builds
 * mechanisms registers the rule for the invariants of its own mechanisms, and this module adds, under the same code,
 * invariants declared with declareInvariant() and rods that change length. A code can have one owner in the registry
 * (the build fails on two), so these are kept here and run with the registered ones.
 */
const shared: CheckRule[] = []
export function alsoRun(def: CheckRule): void { if (!shared.some((r) => r.code === def.code && r.phase === def.phase)) shared.push(def) }
/** every code `mimir check` can report: the registered rules and the shared ones */
export const ruleCodes = (): string[] => [...new Set([...allRules(), ...shared].map((r) => r.code))]
const collectors: Collector[] = []
export function collect(def: Collector): void { if (!collectors.some((c) => c.name === def.name)) collectors.push(def) }
/** Where a finding was measured, for rules that report after looking at many samples. */
export interface Where { step: number | null; t: number; params?: Record<string, ParamValue>; /** "when crank = 180" or '' */ clause: string; /** the command that shows it, or [] */ hint: string[] }

/** The context of this module's own rules: core's RuleCtx plus the limits, the declarations and the solids. */
export interface CheckCtx extends RuleCtx {
  limits: Limits
  store: CheckStore
  /** accumulators of this run, by name: rules that compare samples keep their notes here */
  bag<T>(name: string, init: () => T): T
  /** the solids of a state (default: the sample being measured), memoised */
  solids(frame?: Frame): SolidPart[]
  cache: SolidCache
  /** did the scene declare this exception: a.allow(code) or a.allow(code, b), in either order */
  allowed(code: string, a: MNode, b?: MNode): boolean
  /** record that a rule could not measure something (reported as `unknown`, never as a pass) */
  unknown(code: string, ids: string[], why: string): void
  /** step, time and the "when p = …" clause of any sample */
  where(sample: Sample): Where
  /** index of the sample being measured in `samples` */
  index: number
  /** what has been reported so far in this run (for a rule that explains other findings) */
  found(): { code: string; ids: string[] }[]
  report(r: CheckReport): void
  stats: CheckStats
}

/** param values of a sample that differ from where the story has them at that time */
function pinnedOf(model: SceneModel, sample: Sample): [string, ParamValue][] {
  if (sample.kind !== 'param' && sample.kind !== 'phase') return []
  const story = model.state(sample.tau)
  return Object.entries(sample.params).filter(([name, v]) => { const def = model.params.find((p) => p.name === name); return !def || story.param(def) !== v })
}

// ── causes and effects ───────────────────────────────────────────────────────────────────────────────
/** A report of the code on the left makes reports of the codes on the right about the same objects redundant. */
export const CAUSES: Record<string, string[]> = {
  'PLACE-NONE': ['INTERPENETRATE', 'COLLIDE-IN-MOTION', 'COINCIDENT', 'CONTAINED', 'TEXT-OVERLAP', 'OCCLUDED', 'FLOATING'],
  COINCIDENT: ['INTERPENETRATE', 'COLLIDE-IN-MOTION', 'CONTAINED', 'OCCLUDED'],
  CONTAINED: ['INTERPENETRATE', 'COLLIDE-IN-MOTION', 'OCCLUDED'],
  'MECH-OPEN': ['FLOATING', 'INTERPENETRATE', 'COLLIDE-IN-MOTION'],
  'CAMERA-CLIP': ['OCCLUDED', 'SUBJECT-FIT', 'EMPTY-FRAME', 'OFF-FRAME', 'TINY'],
  'EMPTY-FRAME': ['SUBJECT-FIT', 'TINY', 'OCCLUDED'],
  'OFF-FRAME': ['OCCLUDED', 'SUBJECT-FIT'],
  // the guide's word on a mark that lands on a covered part (src/guide/check.ts) is the same finding, about the same part
  OCCLUDED: ['GUIDE-TARGET'],
}
/** a broken object (its constructor call failed, or it evaluates to NaN) is not measured further */
const BROKEN = new Set(['API-UNKNOWN', 'API-TYPE', 'REF-MISSING', 'NUM-INVALID', 'RUNTIME-ERROR', 'ID-DUP', 'PLACE-CONFLICT'])
const BUILD_TIME = new Set([...BROKEN, 'GUIDE-TARGET'])
/** scene-wide causes: they explain every report of their effects in the same step, whatever the objects */
const WHOLE_STEP = new Set(['CAMERA-CLIP', 'EMPTY-FRAME'])
/** the order diagnostics are printed in inside one severity: what explains the most comes first */
export const ORDER = [
  'RUNTIME-ERROR', 'API-UNKNOWN', 'API-TYPE', 'REF-MISSING', 'ID-DUP', 'PLACE-CONFLICT', 'NUM-INVALID', 'NOT-PURE', 'PLACE-NONE', 'EXPECT-FAILED', 'MECH-OPEN',
  'EMPTY-FRAME', 'CAMERA-CLIP', 'COINCIDENT', 'CONTAINED', 'INTERPENETRATE', 'COLLIDE-IN-MOTION', 'PARAM-BREAKS', 'FLOATING', 'OCCLUDED', 'OFF-FRAME', 'TEXT-OVERLAP',
  'GUIDE-TARGET', 'DEAD-PARAM', 'TEXT-TINY', 'CONTRAST-TEXT', 'STATIC-STEP', 'LABEL-COVERS', 'TINY', 'SUBJECT-FIT', 'TEXT-LONG', 'CHAPTER-LONG', 'COLOR-COUNT', 'HATCH-USE',
]

interface Entry { d: Diag; fold: string | null; rule: string; measured: boolean }

/** Drop effects whose cause is reported, fold many reports of one kind into one, and order what is left. */
export function arrange(entries: Entry[]): Diag[] {
  // 1. effects of a reported cause
  const broken = new Set<string>()
  for (const e of entries) if (BROKEN.has(e.d.code) && e.d.severity === 'error') for (const id of e.d.ids) broken.add(id)
  const kept = entries.filter((e) => {
    if (e.measured && !BUILD_TIME.has(e.d.code) && e.d.ids.length && e.d.ids.every((id) => broken.has(id))) return false
    for (const c of entries) {
      if (c === e || !CAUSES[c.d.code]?.includes(e.d.code)) continue
      if (WHOLE_STEP.has(c.d.code) ? c.d.step === e.d.step : c.d.ids.some((id) => e.d.ids.includes(id))) return false
    }
    return true
  })
  // 2. many of one kind → one line (the first is the example, the others are named)
  const out: Diag[] = []
  const folds = new Map<string, { d: Diag; more: Diag[] }>()
  for (const e of kept) {
    if (e.fold === null) { out.push(e.d); continue }
    const key = `${e.d.code}|${e.d.severity}|${e.fold}`
    const f = folds.get(key)
    if (f) f.more.push(e.d)
    else { folds.set(key, { d: e.d, more: [] }); out.push(e.d) }
  }
  for (const { d, more } of folds.values()) {
    if (!more.length) continue
    const others = [...new Set(more.flatMap((m) => m.ids))].filter((id) => !d.ids.includes(id))
    const named = others.slice(0, 6).map((id) => `#${id}`).join(', ')
    d.what = `${d.what.replace(/\.$/, '')}. ${more.length} more like it${others.length ? `: ${named}${others.length > 6 ? `, and ${others.length - 6} others` : ''}` : ''}.`
    d.ids = [...d.ids, ...others]
  }
  // 3. order: severity, then what explains the most
  const rank = (code: string): number => { const i = ORDER.indexOf(code); return i < 0 ? ORDER.length : i }
  const sev: Record<string, number> = { error: 0, warn: 1, info: 2, unknown: 3 }
  return out.map((d, i) => ({ d, i })).sort((a, b) => (sev[a.d.severity] ?? 4) - (sev[b.d.severity] ?? 4) || rank(a.d.code) - rank(b.d.code) || a.i - b.i).map((x) => x.d)
}

/** Run every rule. With a runtime the samples are rendered and measured; without one only pure rules can report. */
export async function runCheck(runtime: Runtime | null, opts: CheckOptions = {}, modelIn?: SceneModel): Promise<Diag[] & { stats?: CheckStats }> {
  const started = clock()
  const model = runtime ? runtime.model : modelIn!
  const all = [...allRules(), ...shared] as CheckRule[]
  const settings = settingsOf(model, ruleCodes())
  const samples = planSamples(model, settings.limits)
  const rules = all.filter((r) => (!opts.rules || opts.rules.includes(r.code)) && !settings.off.has(r.code))
  const active = new Set(rules.map((r) => r.code))
  const entries: Entry[] = []
  const seen = new Set<string>()
  const stats: CheckStats = { ms: 0, samples: samples.length, measured: 0, rendered: 0, skipped: 0, idPasses: 0, idPassHits: 0, pairTests: 0, pairHits: 0, rules: rules.length, unknown: {} }
  const bags = new Map<string, unknown>()
  const cache = newSolidCache()
  const store = checkStore(model)
  const allow = new Set<string>()
  for (const a of store.allows) { allow.add(`${a.code}|${a.node.id}|${a.other ? a.other.id : '*'}`); if (a.other) allow.add(`${a.code}|${a.other.id}|${a.node.id}`) }
  // an object inside something that carries the exception is exempt too (a group, a composite)
  const carries = (code: string, n: MNode, other: string): boolean => { for (let x: MNode | null = n; x; x = x.parent) if (allow.has(`${code}|${x.id}|${other}`)) return true; return false }

  let rule: CheckRule = { code: '', phase: 'static', run() {} }
  let sample: Sample | null = null
  let frame: Frame | null = null
  let index = -1
  /** id passes of this run by what is drawn: two samples that show the same picture share one */
  const passes = new Map<string, ReturnType<Runtime['idPass']>>()

  const where = (s: Sample): Where => {
    const pinned = pinnedOf(model, s)
    const f = pinned.length ? model.state(s.tau, Object.fromEntries(pinned)) : null
    return { step: s.step, t: Math.round(s.tau * 1000) / 1000, clause: f ? f.paramClause() : '', hint: f ? f.reproHint() : [], ...(pinned.length ? { params: Object.fromEntries(pinned) } : {}) }
  }
  const ctx: CheckCtx = {
    model, runtime, samples, limits: settings.limits, store, cache, stats,
    get sample() { return sample },
    get frame() { return frame },
    get index() { return index },
    stateAt: (tau, params) => model.state(tau, (params ?? {}) as Record<string, ParamValue>),
    visible: (space?: Space) => (frame ? frame.visibleLeaves(space) : []),
    get stage() { return runtime ? runtime.stage() : null },
    screenRect: (node: MNode) => (runtime ? runtime.screenRect(node) : null),
    overlayRects: () => (runtime ? runtime.overlayRects() : []),
    textBoxes: () => {
      if (!runtime || !frame) return []
      const f = frame
      return f.memo('check.textBoxes', () => {
        const out: TextBox[] = []
        for (const n of f.visibleLeaves()) {
          const kind = kindOf(n.kind)
          if (kind?.textRects) {
            // text a kind draws itself: its declared boxes, through the node's transform and the camera
            for (const t of f.textRects(n)) out.push({ name: `text "${t.text.slice(0, 24)}" of ${n.id}`, text: t.text, ids: [n.id], rect: runtime.rectToStage(t.rect), line: n.src.line, from: 'kind', label: false })
          } else if (kind?.text) {
            const r = runtime.screenRect(n)
            // the DOM box of a text line includes the full ascent and descent: compare the middle 70%
            if (r) out.push({ name: `text "${String(f.prop(n, 'text')).slice(0, 24)}"`, text: String(f.prop(n, 'text')), ids: [n.id], rect: { x: r.x, y: r.y + r.height * 0.15, width: r.width, height: r.height * 0.7 }, line: n.src.line, from: 'node', label: false })
          }
        }
        for (const o of runtime.overlayRects()) if (o.kind === 'label' || o.kind === 'text') out.push({ name: o.kind === 'label' ? `label "${o.text ?? o.id}"` : o.id, text: o.text ?? '', ids: o.ids ?? [], rect: o.rect, line: o.src?.line ?? null, from: 'overlay', label: o.kind === 'label', fix: o.fix })
        return out
      }, [])
    },
    // rendered once per picture: Runtime.idPass keeps it while the state is on screen, the engine keeps it for the run
    idPass: (o) => {
      if (!runtime) return null
      const f = runtime.frame
      const key = `${o?.solo ? 'solo' : 'plain'}|${runtime.width}x${runtime.height}|${f.memo('check.picture', () => f.signature({ excludeActions: ['say', 'label', 'focus'] }), '')}`
      if (passes.has(key)) { stats.idPassHits++; return passes.get(key)! }
      const solo = passes.get(key.replace(/^plain/, 'solo'))
      if (solo) { stats.idPassHits++; return solo }
      stats.idPasses++
      const pass = runtime.idPass(o)
      passes.set(key, pass)
      return pass
    },
    bag: <T,>(name: string, init: () => T): T => { if (!bags.has(name)) bags.set(name, init()); return bags.get(name) as T },
    solids: (f) => { const of = f ?? frame; return of ? solidsOf(of, cache) : [] },
    allowed: (code, a, b) => (b ? carries(code, a, b.id) || carries(code, b, a.id) || carries(code, a, '*') || carries(code, b, '*') : carries(code, a, '*')),
    unknown: (code, ids, why) => {
      const list = (stats.unknown[code] ??= [])
      const same = list.find((u) => u.why === why)
      if (same) { for (const id of ids) if (!same.ids.includes(id)) same.ids.push(id) } else list.push({ ids: [...ids], why })
    },
    where,
    found: () => entries.map((e) => ({ code: e.d.code, ids: e.d.ids })),
    report(r: CheckReport) {
      const stepK = r.step !== undefined ? r.step : sample?.step ?? null
      // found with a param pinned away from where the story has it (a slider extreme): the default picture does not show
      // it, so the message says which value, and how to see it
      const at = frame && sample && r.params === undefined ? where(sample) : null
      const when = at ? at.clause : ''
      const d: Diag = {
        code: rule.code,
        severity: r.severity ?? rule.severity ?? SEVERITY[rule.code] ?? 'error',
        step: stepK,
        stepTitle: stepK !== null ? model.steps[stepK - 1]?.title ?? null : null,
        t: r.t !== undefined ? r.t : sample ? Math.round(sample.tau * 1000) / 1000 : null,
        ids: r.ids ?? [],
        file: r.file !== undefined ? r.file : model.file,
        line: r.line ?? null,
        measured: r.measured ?? null,
        limit: r.limit ?? null,
        what: when ? `${r.what.replace(/\.$/, '')} ${when}.` : r.what,
        fix: trim(when && at ? [...(r.fix ?? []), ...at.hint] : r.fix ?? []),
        ...(when && at?.params ? { params: at.params } : r.params && Object.keys(r.params).length ? { params: r.params } : {}),
      }
      // one report per root cause: the same rule on the same objects is reported at the first sample that shows it
      const key = `${d.code}|${d.ids.join(',')}|${rule.phase === 'sample' ? '' : d.what}`
      if (seen.has(key)) return
      seen.add(key)
      entries.push({ d, fold: r.fold ?? null, rule: rule.code, measured: rule.phase !== 'static' })
    },
  }
  const run = (r: CheckRule, s: Sample | null, f: Frame | null): void => {
    rule = r; sample = s; frame = f
    try { r.run(ctx) } catch (e) { model.reportError(e, `check rule ${r.code}`) }
  }

  // the page side of `mimir query` comes with this chunk: a host that has no query() of its own gets one here
  if (runtime) { const host = (globalThis as { __mimir?: { query?: unknown } }).__mimir; if (host && typeof host.query !== 'function') host.query = (request: unknown) => runQuery(runtime, request) }
  const saved = runtime ? { tau: runtime.tau, overrides: runtime.overrides } : null
  if (!opts.static && rules.length) {
    /** rules that already ran on a state, by what the state is: the same state is not measured twice */
    const ran = new Map<string, Set<string>>()
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]!
      index = i
      const wanted = rules.filter((r) => r.phase === 'sample' && (r.on ?? ['step-end', 'transition']).includes(s.kind))
      const noting = collectors.filter((c) => c.on.includes(s.kind) && c.for.some((code) => active.has(code)))
      if (!wanted.length && !noting.length) { stats.skipped++; continue }
      let f: Frame
      if (runtime) { runtime.overrides = s.params; runtime.seek(s.tau); runtime.invalidate(); f = runtime.frame } else f = model.state(s.tau, s.params)
      // resolve everything once so evaluation problems (NaN, throwing functions) surface at this sample
      f.run(() => { for (const n of model.nodes) { f.props(n); f.world(n); if (!kindOf(n.kind)?.container) f.bounds(n) } f.probes(); if (model.viewport) f.camera() })
      // collectors see every sample (they compare samples); rules skip a state that was already measured
      sample = s; frame = f
      let drawn = false
      if (runtime && noting.some((c) => !c.pure)) { runtime.render(true); stats.rendered++; drawn = true }
      for (const c of noting) { try { f.run(() => c.run(ctx)) } catch (e) { model.reportError(e, `check (${c.name})`) } }
      // what the state is: everything that is drawn, the camera, the marks, the params and the probes
      const identity = `${s.step}|${f.signature()}|${stable(model.params.map((p) => f.param(p)))}|${stable(f.probes())}`
      const done = ran.get(identity) ?? new Set<string>()
      ran.set(identity, done)
      const todo = wanted.filter((r) => !done.has(r.code))
      if (!todo.length) { stats.skipped++; continue }
      for (const r of todo) done.add(r.code)
      if (runtime && !drawn && todo.some((r) => !r.pure)) { runtime.render(true); stats.rendered++ }
      stats.measured++
      for (const r of todo) f.run(() => run(r, s, f))
    }
    index = -1
    // rules of the whole story measure the story as it plays: not with the params of the last sample still pinned
    // (a rule that seeks and measures pixels would otherwise judge the story with a slider at its maximum)
    if (runtime && saved) { runtime.overrides = saved.overrides; runtime.invalidate() }
    for (const r of rules) if (r.phase === 'story') run(r, null, null)
  }
  if (runtime && saved) {
    runtime.overrides = saved.overrides
    runtime.seek(saved.tau)
    runtime.invalidate()
    runtime.render(true)
  }
  // static rules last: they forward what the build AND the sampling above recorded
  for (const r of rules) if (r.phase === 'static') run(r, null, null)

  // what was not measured is said, once per rule and reason, never passed over (DESIGN §7)
  rule = { code: '', phase: 'static', run() {} }
  // (without a browser nothing that reads pixels ran at all: that is one fact, kept in stats.unknown['*'], not a line per rule)
  if (!runtime && !opts.static) stats.unknown['*'] = [{ ids: [], why: 'there is no browser: nothing was rendered, so no rule that reads pixels ran' }]
  for (const [code, list] of Object.entries(runtime ? stats.unknown : {})) {
    for (const u of list) {
      const first = u.ids.length ? model.byId.get(u.ids[0]!) : undefined
      entries.push({ rule: code, fold: null, measured: true, d: { code, severity: 'unknown', step: null, stepTitle: null, t: null, ids: u.ids, file: first?.src.file ?? model.file, line: first?.src.line ?? null, measured: null, limit: null, what: `not measured: ${u.why}`, fix: ['look at the frames instead: mimir shot <scene> --sheet'] } })
    }
  }
  stats.pairTests = cache.tests
  stats.pairHits = cache.hits
  stats.ms = Math.round(clock() - started)
  const out: Diag[] & { stats?: CheckStats } = arrange(entries)
  Object.defineProperty(out, 'stats', { value: stats, enumerable: false })
  ;(globalThis as { __mimirCheck?: CheckStats }).__mimirCheck = stats
  return out
}
/** DESIGN §7: one to three literal edits, most likely first; the command that shows the state is kept as well */
const isCommand = (f: string): boolean => /^see it: mimir /.test(f)
export const trim = (fix: string[]): string[] => [...fix.filter((f) => !isCommand(f)).slice(0, 3), ...fix.filter(isCommand).slice(0, 1)]
/** how long a check took is reported, never drawn: the one place this module reads a clock */
const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : 0)

export { planSamples, sortDiags }
export { runQuery }
