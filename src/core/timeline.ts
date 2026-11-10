// The recorder: steps, clips, actions, anims (DESIGN §3.3). The scene script runs once; nothing here is replayed.
import { ctx } from './context.ts'
import { callSite, type Src } from './diagnostics.ts'
import { forgiving, isNode, type MNode } from './node.ts'
import { PACE, smooth, type RateFn } from './rate.ts'
import type { SceneModel } from './model.ts'

export type Scope = 'persist' | 'step'

/** One recorded change of one channel of one target. Times are absolute story time (seconds). */
export interface Clip {
  target: unknown // MNode | ParamDef | Selector | CAMERA | any object used as a channel owner
  prop: string
  t0: number
  t1: number
  /** value or function (evaluated in the frame being rendered) */
  to: unknown
  /** when present the tween starts here instead of at the folded value (enter effects) */
  from?: unknown
  rate: RateFn
  /** persist: folds forward for the rest of the story. step: cleared with a transition when the step ends. */
  scope: Scope
  /** 0-based index of the step that recorded it */
  step: number
  src: Src
  seq: number
}
/** A clip target that matches many nodes, tested lazily (st.focus dims "everything else"). */
export interface Selector { isSelector: true; test(node: MNode): boolean }
export const selector = (test: (node: MNode) => boolean): Selector => ({ isSelector: true, test })
export const isSelector = (v: unknown): v is Selector => typeof v === 'object' && v !== null && (v as Selector).isSelector === true
/** Clip target for 3D camera poses (channel 'pose'). */
export const CAMERA = Object.freeze({ isCameraTarget: true })
/** Clip target for the 2D camera (channel 'pose2d'): what st.zoom records, what frame.camera2d() folds. */
export const CAMERA2D = Object.freeze({ isCamera2dTarget: true })
/** Clip target for scene-level view channels (cutaway, ghost …): st.clip(VIEW, 'cutaway', value); read with frame.viewValue('cutaway'). */
export const VIEW = Object.freeze({ isViewTarget: true })

/** One guide span of a sentence: `[spoken words](verb:targets,option)`, located in the spoken text. */
export interface NarrationSpanRec { /** character offsets into `plain`: [start, end) */ start: number; end: number; words: string; verb: string; targets: string[]; options: string[] }
/** One sentence a step says. The list of these, in order, is the transcript (DESIGN §3.4). */
export interface NarrationRec { /** as written, with its spans */ text: string; /** the spoken words */ plain: string; /** absolute story time it starts at */ t0: number; duration: number; spans: NarrationSpanRec[]; src: Src }
/** A chapter of a long explanation: s.chapter(title, { keep }). */
export interface ChapterRec { index: number; title: string; /** 0-based index of its first step; −1 while it has none */ firstStep: number; /** nodes that stay on stage when the chapter opens */ keep: MNode[]; /** nodes that were on stage when it was declared (they are cleared when it opens) */ stage: MNode[]; /** seconds the opening clear takes */ clear: number; /** the cameras stay where they are when the chapter opens (s.chapter(title, { keepCamera: true })) */ keepCamera: boolean; src: Src }

/** Something a step declared that overlays and backends read every frame (labels, captions, marks …). */
export interface Action<D = any> {
  type: string
  step: number
  t0: number
  t1: number
  scope: Scope
  data: D
  src: Src
  seq: number
}
export interface ActiveAction<D = any> {
  action: Action<D>
  data: D
  /** 0..1 envelope: fades in over [t0, t1], and for step-scoped actions fades out after the step ends */
  env: number
  /** seconds since the action started */
  age: number
}

/** What verbs return. `record` appends clips; `at` is seconds from the start of the step. */
export interface Anim {
  readonly isAnim: true
  readonly verb: string
  duration: number
  rate?: RateFn
  record(rec: Step, at: number, duration: number, rate?: RateFn): void
}
export const isAnim = (v: unknown): v is Anim => typeof v === 'object' && v !== null && (v as Anim).isAnim === true && typeof (v as Anim).record === 'function'

export interface ClipOpts { at?: number; duration?: number; rate?: RateFn; scope?: Scope; from?: unknown; sweep?: boolean }

export class StepRec {
  t0 = 0
  t1 = 0
  /** seconds of the step that are not the closing hold */
  active = 0
  hold: number = PACE.hold
  cursor = 0
  minActive = 0
  /** multiplier of simulation time during this step (st.clock) */
  clockSpeed = 1
  sweeps: Clip[] = []
  error: string | null = null
  /** 0-based index into model.chapters, −1 when the step is before any s.chapter() */
  chapter = -1
  /** what the step says, in order: the transcript */
  narration: NarrationRec[] = []
  /** read-mode text added with st.note(markdown) */
  notes: string[] = []
  /** true once the step function has returned: nothing more can be recorded into it */
  closed = false
  constructor(readonly index: number, readonly title: string, readonly src: Src) {}
  /** 1-based number used in messages and in info() */
  get k(): number { return this.index + 1 }
}

/**
 * The `st` handle of `s.step(title, st => …)`. Step actions (st.play, st.say, st.label …) are installed on its
 * prototype by defineStepAction; the members below are the recorder API those actions and verbs build on.
 */
export class Step {
  constructor(readonly model: SceneModel, readonly rec: StepRec) {}
  /** seconds from the start of the step where the next play starts */
  get cursor(): number { return this.rec.cursor }
  /** absolute story time of the cursor */
  get now(): number { return this.rec.t0 + this.rec.cursor }
  get index(): number { return this.rec.index }
  /** move the cursor forward */
  advance(seconds: number): this {
    if (Number.isFinite(seconds) && seconds > 0) this.rec.cursor += seconds
    return this
  }
  /** make the step last at least this long (before its hold) without moving the cursor */
  need(seconds: number): this {
    if (Number.isFinite(seconds) && seconds > this.rec.minActive) this.rec.minActive = seconds
    return this
  }
  /**
   * Append a clip. `at` is seconds from the start of the step (default: the cursor). `to` is a value or a function
   * (node, frame) => value. A channel the target node does not have is passed on to the descendants that have it
   * (a group has no colour, its shapes do); when nothing has it, API-UNKNOWN is reported and nothing is recorded.
   */
  clip(target: unknown, prop: string, to: unknown, o: ClipOpts = {}): Clip {
    o = o && typeof o === 'object' ? o : {}
    prop = String(prop)
    const at = finite(o.at) ?? this.rec.cursor
    const duration = Math.max(0, finite(o.duration) ?? 0)
    const inert = (): Clip => ({ target, prop, to, t0: this.rec.t0 + at, t1: this.rec.t0 + at + duration, rate: o.rate ?? smooth, scope: o.scope ?? 'persist', step: this.rec.index, src: callSite(), seq: -1 })
    if (this.rec.closed) { this.model.late('st.clip()'); return inert() }
    if (target === null || target === undefined) { this.model.diagnostics.add({ code: 'REF-MISSING', what: `st.clip(): the target is ${String(target)}.`, fix: ['pass an object, a param, a selector, VIEW, CAMERA or CAMERA2D'] }); return inert() }
    if (target === VIEW && !this.model.checkViewChannel(prop, 'st.clip(VIEW, …)')) return inert()
    if (isNode(target)) {
      const takers = this.model.acceptors(target, prop, 'st.clip()')
      if (takers.length !== 1 || takers[0] !== target) {
        let first: Clip | null = null
        for (const n of takers) { const c = this.clip(n, prop, to, o); first ??= c }
        return first ?? inert()
      }
    } else if (isSelector(target)) this.model.checkChannel(prop, 'st.clip()')
    const c: Clip = {
      target, prop, to,
      t0: this.rec.t0 + at,
      t1: this.rec.t0 + at + duration,
      rate: o.rate ?? smooth,
      scope: o.scope ?? 'persist',
      step: this.rec.index,
      src: callSite(),
      seq: 0,
    }
    if (o.from !== undefined) c.from = o.from
    if (o.sweep) this.rec.sweeps.push(c)
    else this.need(at + duration)
    this.model.addClip(c)
    return c
  }
  /** Append an action record for overlays / backends. Step-scoped by default. */
  action<D>(type: string, data: D, o: { at?: number; duration?: number; scope?: Scope } = {}): Action<D> {
    o = o && typeof o === 'object' ? o : {}
    if (this.rec.closed) { this.model.late(`st.action('${String(type)}')`); return { type: String(type), data, step: this.rec.index, t0: this.rec.t1, t1: this.rec.t1, scope: 'step', src: callSite(), seq: -1 } }
    return this.model.addAction(type, data, { step: this.rec.index, at: finite(o.at) ?? this.rec.cursor, duration: finite(o.duration), scope: o.scope })
  }
  /** Record a sentence of the step's narration (the transcript). The guide's st.say calls this; `at` is seconds from the start of the step. */
  narration(text: string, o: { plain: string; spans?: NarrationSpanRec[]; at?: number; duration?: number }): NarrationRec {
    o = o && typeof o === 'object' ? o : { plain: '' }
    // the transcript is data (info().transcript is JSON): whatever is passed, plain strings and plain spans are recorded
    const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
    const words = str(text)
    const plain = typeof o.plain === 'string' ? o.plain : words
    if (typeof text !== 'string' || typeof o.plain !== 'string') this.model.diagnostics.add({ code: 'API-TYPE', what: `st.narration(): the sentence and its plain form must be strings, got ${typeof text} and ${typeof o.plain}.`, fix: ["st.narration('The [piston](piston) rises.', { plain: 'The piston rises.' })"] })
    const spans: NarrationSpanRec[] = (Array.isArray(o.spans) ? o.spans : []).filter((sp) => sp && typeof sp === 'object').map((sp) => ({
      start: finite(sp.start) ?? 0, end: finite(sp.end) ?? 0, words: str(sp.words), verb: str(sp.verb) || 'point',
      targets: (Array.isArray(sp.targets) ? sp.targets : []).map((t) => (isNode(t) ? t.id : str(t))).filter(Boolean), options: (Array.isArray(sp.options) ? sp.options : []).map(str).filter(Boolean),
    }))
    const n: NarrationRec = { text: words, plain, t0: this.rec.t0 + (finite(o.at) ?? this.rec.cursor), duration: Math.max(0, finite(o.duration) ?? 0), spans, src: callSite() }
    if (this.rec.closed) this.model.late('st.narration()')
    else this.rec.narration.push(n)
    return n
  }
  /** Resolve a node argument (a node or its id); reports REF-MISSING / API-TYPE and returns null when it is not one. */
  node(v: unknown, call: string, name = 'target'): MNode | null {
    if (isNode(v)) return v
    return this.model.resolveNode(v, call, name)
  }
}
forgiving(Step.prototype, () => 'the step (st)', ['model', 'rec', 'cursor', 'now', 'index', 'advance', 'need', 'clip', 'action', 'node', 'narration'])

/** Close a step: fix its duration and the end of its sweeps. */
export function closeStep(rec: StepRec): void {
  rec.closed = true
  let active = Math.max(rec.cursor, rec.minActive)
  if (rec.sweeps.length) active = Math.max(active, active === 0 ? PACE.sweep : PACE.sweepMin)
  if (active <= 0) active = PACE.empty
  rec.active = active
  rec.t1 = rec.t0 + active + rec.hold
  for (const c of rec.sweeps) c.t1 = rec.t0 + active
}

export const currentStep = (): StepRec | null => ctx.step
/** the end state of a step is sampled this long before its end (the instant t1 already belongs to the next step) */
export const STEP_END_EPSILON = 0.001
const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
