// Step transitions: what happens between two declared states. The core already gives every step a closing hold,
// eases step-scoped marks out over the start of the next step, and clears the stage with a lagged fade when a chapter
// opens. This file adds the two rules that make a sequence of steps read as authored, as one finalize hook over the
// recorded timeline (nothing is replayed; every frame stays a pure function of time):
//   1. steady: a step-scoped state that the next step declares again does not blink. Without it, something dimmed by
//      st.focus in two steps in a row brightens and darkens again between them (the old state eases out while the
//      same state eases in).
//   2. leave before arrive: a mark of a kind that the previous step also showed waits for most of the time the old
//      ones take to leave, instead of cross-fading with them.
import {
  defineFinalize, defineSceneMethod, isNode, isSelector, reportProblems, selector, validateOptions,
  type Action, type Clip, type MNode, type SceneModel, type Selector,
} from '../core/index.ts'

/** Defaults of the step transitions; s.transitions({ … }) overrides them for one scene. */
export const TRANSITION_DEFAULTS = {
  /** a step-scoped state the next step declares again is held instead of eased out and in */
  steady: true,
  /** share of the leaving time that new marks wait: 0 = cross-fade, 1 = strictly after the old ones have gone */
  overlap: 0.6,
} as const
export interface TransitionOptions { steady: boolean; overlap: number }
const STORE = 'anim.transitions'
const settings = (model: SceneModel): TransitionOptions => model.store<TransitionOptions>(STORE, () => ({ ...TRANSITION_DEFAULTS }))

const waiting = new Set<string>(['label'])
/**
 * Declare a type of step-scoped action (st.action) as a mark that waits for the previous step's marks of the same
 * type to leave. The guide's labels do; a module that draws its own marks adds their type here.
 */
export function leaveBeforeArrive(type: string): void { waiting.add(type) }
export const marksThatWait = (): string[] => [...waiting]

/** s.transitions({ steady?, overlap? }): how this scene moves from one step to the next. */
defineSceneMethod('transitions', (s, opts: unknown) => {
  const v = validateOptions('s.transitions()', opts, { steady: { type: 'boolean', dynamic: false, example: 'steady: true' }, overlap: { type: 'unit', dynamic: false, example: 'overlap: 0.6' } }, undefined, s.model)
  reportProblems(s.model, v.problems, [])
  Object.assign(settings(s.model), v.props)
  return undefined
})

const same = (a: unknown, b: unknown): boolean => a === b || (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null && !isNode(a) && !isNode(b) && JSON.stringify(a) === JSON.stringify(b))

/** Rule 1. Exported for tests. */
export function holdSteady(model: SceneModel): void {
  const scoped = model.allClips().filter((c) => c.scope === 'step' && typeof c.to !== 'function')
  const byStep = new Map<number, Clip[]>()
  for (const c of scoped) { const l = byStep.get(c.step) ?? []; l.push(c); byStep.set(c.step, l) }
  // what each clip matched as it was recorded (targets are narrowed below; the next step compares against the original)
  const original = new Map<Clip, unknown>(scoped.map((c) => [c, c.target]))
  for (const [k, clips] of byStep) {
    const before = byStep.get(k - 1)
    const step = model.steps[k]
    if (!before || !step) continue
    const window = model.releaseAfter(k - 1)
    if (!(window > 0)) continue
    for (const cur of clips) {
      // only a state declared while the old one is still leaving can blink
      if (cur.t0 - step.t0 >= window) continue
      const prev = before.filter((p) => p.prop === cur.prop && same(p.to, cur.to) && p.from === undefined && cur.from === undefined)
      if (!prev.length) continue
      const target = original.get(cur)
      if (isSelector(target)) {
        const olds = prev.map((p) => original.get(p)).filter(isSelector) as Selector[]
        const nodes = prev.map((p) => original.get(p)).filter(isNode) as MNode[]
        if (!olds.length && !nodes.length) continue
        const was = (n: MNode): boolean => olds.some((o) => o.test(n)) || nodes.includes(n)
        // objects in the state in both steps keep it; the others ease in as recorded
        cur.target = selector((n) => target.test(n) && !was(n))
        model.addClip({ ...cur, target: selector((n) => target.test(n) && was(n)), t0: step.t0, t1: step.t0, seq: 0 })
      } else if (isNode(target)) {
        const held = prev.some((p) => { const o = original.get(p); return o === target || (isSelector(o) && o.test(target)) })
        if (held) { cur.t0 = step.t0; cur.t1 = step.t0 }
      }
    }
  }
}

/** Rule 2. Exported for tests. */
export function leaveFirst(model: SceneModel, overlap: number): void {
  if (!(overlap > 0)) return
  const byStep = new Map<number, Action[]>()
  for (const a of model.actions) { if (a.scope !== 'step' || !waiting.has(a.type)) continue; const l = byStep.get(a.step) ?? []; l.push(a); byStep.set(a.step, l) }
  for (const [k, actions] of byStep) {
    const before = byStep.get(k - 1)
    const step = model.steps[k]
    if (!before || !step) continue
    const from = step.t0 + model.releaseAfter(k - 1) * overlap
    for (const a of actions) {
      if (a.t0 >= from || !before.some((b) => b.type === a.type)) continue
      const d = a.t1 - a.t0
      a.t0 = from
      a.t1 = from + d
    }
  }
}

defineFinalize('anim.transitions', (model) => {
  const o = settings(model)
  if (o.steady) holdSteady(model)
  leaveFirst(model, o.overlap)
})
