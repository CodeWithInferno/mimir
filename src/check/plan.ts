// The sampling plan of DESIGN §7. Part of the lazy check chunk, with the engine (./engine.ts) and the rules (./check.ts).
import { cycleOf, type ParamDef, type Sample, type SceneModel } from '../core/index.ts'
import { configuredLimits, type Limits } from './limits.ts'

/** the end state of a step is measured this long before its end (the instant t1 already belongs to the next step) */
export const END_EPSILON = 0.001

/** A param that goes round, as the scene declared it (`cyclic` / `period` of s.param): phases of one cycle are sampled. */
const cycle = (p: ParamDef): { cyclic: boolean; period: number } => {
  if (p.kind !== 'number') return { cyclic: false, period: 0 }
  const said = p as { cyclic?: boolean; period?: number }
  if (typeof said.cyclic === 'boolean' && typeof said.period === 'number' && (said.period > 0 || !said.cyclic)) return { cyclic: said.cyclic && said.period > 0, period: said.period }
  // a definition that was not made by s.param() (a test, a tool) and says less: read by the core's own rule. The NAME of a param never decides.
  return cycleOf({ ...(typeof said.cyclic === 'boolean' ? { cyclic: said.cyclic } : {}), unit: p.unit }, p.min, p.max)
}
export function isCyclic(p: ParamDef): boolean { return cycle(p).cyclic }

/** `count` moments evenly spaced strictly inside a span, as shares of it: 3 → 0.25, 0.5, 0.75. */
export const insideShares = (count: number): number[] => { const n = Math.max(0, Math.floor(count)); return Array.from({ length: n }, (_, i) => (i + 1) / (n + 1)) }

/**
 * Sampling plan: every step's end state; `planTransitions` moments inside each step's moving part (25 / 50 / 75 %);
 * each param at min / default / max (one at a time, at the story's end state); `planPhases` positions of each cyclic
 * param. Both counts are limits (./limits.ts).
 */
export function planSamples(model: SceneModel, limits: Pick<Limits, 'planTransitions' | 'planPhases'> = configuredLimits(model)): Sample[] {
  const out: Sample[] = []
  const steps = model.steps
  const shares = insideShares(limits.planTransitions)
  const phases = Math.max(0, Math.floor(limits.planPhases))
  for (const s of steps) {
    const hasMotion = model.allClips().some((c) => c.step === s.index && c.t1 > c.t0)
    if (hasMotion) for (const u of shares) out.push({ kind: 'transition', tau: s.t0 + s.active * u, step: s.k, params: {}, label: `step ${s.k} at ${Math.round(u * 1000) / 10}%` })
    out.push({ kind: 'step-end', tau: Math.max(s.t0, s.t1 - END_EPSILON), step: s.k, params: {}, label: `end of step ${s.k}` })
  }
  const last = steps[steps.length - 1]
  const end = last ? Math.max(last.t0, last.t1 - END_EPSILON) : 0
  const step = last ? last.k : null
  for (const p of model.params) {
    // a hidden param is the story's own state: nobody can drag it, so its range is not a set of states a viewer can reach
    if (p.hidden) continue
    if (p.kind === 'number') {
      for (const [name, v] of [['min', p.min], ['default', p.value], ['max', p.max]] as const) out.push({ kind: 'param', tau: end, step, params: { [p.name]: v }, label: `${p.name} = ${v} (${name})` })
      const turn = cycle(p)
      if (turn.cyclic) for (let i = 0; i < phases; i++) { const v = p.min + (Math.min(turn.period, p.max - p.min) * i) / phases; out.push({ kind: 'phase', tau: end, step, params: { [p.name]: v }, label: `${p.name} = ${v} (phase ${i + 1}/${phases})` }) }
    } else if (p.kind === 'toggle') for (const v of [false, true]) out.push({ kind: 'param', tau: end, step, params: { [p.name]: v }, label: `${p.name} = ${v}` })
    else for (const v of p.options) out.push({ kind: 'param', tau: end, step, params: { [p.name]: v }, label: `${p.name} = ${v}` })
  }
  return out
}


/**
 * `count` moments spread evenly over the story, in the form of plan samples: what expectations, invariants and
 * `mimir query probes` are evaluated at besides the plan (pure state, nothing is rendered for them).
 */
export function timelineSamples(model: SceneModel, count: number): Sample[] {
  const d = model.duration
  const n = Math.max(0, Math.floor(count))
  const out: Sample[] = []
  if (!(d > 0) || !n) return out
  for (let i = 0; i < n; i++) {
    const tau = (d * (i + 0.5)) / n
    const k = model.locate(tau).k
    out.push({ kind: 'transition', tau, step: k >= 0 ? k + 1 : null, params: {}, label: `t = ${Math.round(tau * 100) / 100} s` })
  }
  return out
}
