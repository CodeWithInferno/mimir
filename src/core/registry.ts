// Extension registries. Everything a feature module adds (kinds, backends, placements, verbs, step actions,
// scene methods, overlays, renderers, check rules, the player) goes through one of these; the seed modules use
// them too. Registration happens at module import time. Every name is claimed in the ledger (./ledger.ts): a second
// registration of the same name is refused and recorded (the build fails on it) unless it says `override: true`.
import { callSite, type Severity, type Src } from './diagnostics.ts'
import { currentModel } from './context.ts'
import { claim } from './ledger.ts'
import { forgiving, isNode, MNode, Node2D, Node3D, type DefineOpts, type Handle, type Placement, type Space } from './node.ts'
import { checkValue, spec, validateOptions, type Problem, type PropSpec, type Schema } from './schema.ts'
import { Step, isAnim, type Anim } from './timeline.ts'
import type { Box3, Quat, Rect, Vec3 } from './math.ts'
import type { RateFn } from './rate.ts'
import type { Frame } from './frame.ts'
import type { SceneModel } from './model.ts'
import type { Runtime, ScreenPoint } from './runtime.ts'
import type { Subpath } from '../lib/path/index.ts'

/** Resolved option values of a node for one frame (functions evaluated, clips applied, points in world space). */
export type Resolved = Record<string, any>

// ── kinds ──────────────────────────────────────────────────────────────────────────────────────────────
export interface KindDef {
  name: string
  space: Space
  /** option name → type. `id` and `opacity` are added to every kind. */
  schema: Schema
  /** short spellings accepted silently (r w h d always are) */
  aliases?: Record<string, string>
  /** default option values (schema `default`s are merged in) */
  defaults?: Record<string, unknown>
  /** names of leading positional arguments: text(str, opts) → ['text']; line(a, b, opts) → ['a', 'b'] */
  positional?: string[]
  /** positional names that must be given */
  required?: string[]
  /** extra local named points; the seven standard ones come from bounds */
  anchors?(node: MNode, r: Resolved, frame: Frame): Record<string, Vec3>
  /** local axis-aligned box (pure maths, no backend). Containers may omit it: the union of the children is used. */
  bounds?(node: MNode, r: Resolved, frame: Frame): Box3
  /** local points whose projection approximates the silhouette (default: the 8 corners of bounds) */
  hull?(node: MNode, r: Resolved, frame: Frame): Vec3[]
  /** geometry is given in frame/world coordinates (a line between two points): the node has no transform of its own */
  worldGeometry?: boolean
  /** a node that only groups children (no geometry of its own) */
  container?: boolean
  /** counts as text for TEXT-OVERLAP and the text rules */
  text?: boolean
  /** an error placeholder: takes every setter silently */
  inert?: boolean
  /** for check: a closed solid, and its signed distance in local space */
  solid?: boolean
  sdf?(node: MNode, r: Resolved, pLocal: Vec3): number
  /**
   * 2D outline in the path format of src/lib/path (absolute cubics, y up), in the node's LOCAL coordinates (world
   * coordinates for worldGeometry kinds). Edge exit points of lines and arrows, m.pointAt(), m.start / m.end and
   * morph plans all come from it. Default: the rectangle of bounds.
   */
  outline?(node: MNode, r: Resolved, frame: Frame): Subpath[]
  /**
   * Text this kind draws itself (not through child text() nodes), as local boxes: x, y = the min corner, y up.
   * TEXT-OVERLAP and the other text rules read it. A kind with `text: true` is one text box and needs none.
   */
  textRects?(node: MNode, r: Resolved, frame: Frame): { text: string; rect: Rect }[]
  /** Local rectangle (x, y = min corner, y up) that clips what the node's DESCENDANTS draw (2D), e.g. plots inside axes. */
  clip?(node: MNode, r: Resolved, frame: Frame): Rect | null
  /**
   * Lazy chunk (or chunks) this kind needs before it can be drawn: 'tex', 'diagram', ['kit'] … A 3D kind always needs
   * '3d' as well, whatever it names here. The runtime loads exactly the chunks a scene's kinds name.
   */
  chunk?: string | string[]
  /** filled in by defineKind: every chunk the kind needs ('3d' first for a 3D kind) */
  chunks?: string[]
  /** replace an earlier kind of the same name on purpose */
  override?: boolean
  /** runs once after the node is created: build the parts of a composite with model.child(node, name, ctor, …) */
  init?(node: MNode, model: SceneModel): void
  /** inline backend (2D kinds usually put it here; 3D kinds register it from three.ts with defineKindBackend) */
  build?: KindBackend['build']
  update?: KindBackend['update']
  dispose?: KindBackend['dispose']
}
export interface KindBackend<H = any, C = any> {
  /** create the DOM / three objects for a node; return a handle (2D: an SVG element; 3D: an Object3D) */
  build(node: MNode, ctx: C): H
  /** sync the handle to this frame's resolved options */
  update?(handle: H, r: Resolved, ctx: C, node: MNode): void
  dispose?(handle: H, ctx: C): void
}

const kinds = new Map<string, KindDef>()
const backends = new Map<string, KindBackend>()
export const kindOf = (name: string): KindDef | undefined => kinds.get(name)
export const allKinds = (): KindDef[] => [...kinds.values()]
export const backendOf = (kind: string): KindBackend | undefined => backends.get(kind)

/** Register the rendering side of a kind (from src/<module>/three.ts for 3D, or next to defineKind for 2D). */
export function defineKindBackend<H = any, C = any>(kind: string, backend: KindBackend<H, C>, o: DefineOpts = {}): void {
  if (!claim('backend', kind, o.override)) return
  backends.set(kind, backend as KindBackend)
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && !isNode(v) && !isAnim(v)

/** Report validation problems on a model, attributed to a node / call site. */
export function reportProblems(model: SceneModel, problems: readonly Problem[], ids: string[], src?: Src): void {
  for (const p of problems) model.diagnostics.add({ code: p.code, what: p.what, fix: p.fix, ids, measured: p.measured ?? null }, src)
}

/**
 * Register a kind and get its public constructor. The constructor validates its options against the schema
 * (API-UNKNOWN / API-TYPE / REF-MISSING / NUM-INVALID with the scene line), never throws, and always returns a node.
 */
export function defineKind(def: KindDef): (...args: any[]) => Handle {
  if (!claim('kind', def.name, def.override)) return constructors.get(def.name)!
  const schema: Schema = { id: { type: 'string', dynamic: false }, opacity: { type: 'unit', default: 1 }, ...def.schema }
  const named = (Array.isArray(def.chunk) ? def.chunk : def.chunk ? [def.chunk] : []).filter((c) => typeof c === 'string' && c)
  const full: KindDef = { ...def, schema, chunks: [...new Set([...(def.space === '3d' ? ['3d'] : []), ...named])] }
  const defaults: Record<string, unknown> = {}
  for (const [k, s] of Object.entries(schema)) { const d = spec(s).default; if (d !== undefined) defaults[k] = d }
  Object.assign(defaults, def.defaults)
  full.defaults = defaults
  kinds.set(def.name, full)
  if (def.build && claim('backend', def.name, def.override)) backends.set(def.name, { build: def.build, update: def.update, dispose: def.dispose })
  const pos = def.positional ?? []
  const call = `${def.name}()`

  const ctor = function construct(...args: unknown[]): Handle {
    const model = currentModel()
    const src = callSite()
    const node = (def.space === '2d' ? new Node2D() : new Node3D()) as Handle
    node.kind = def.name
    node.src = src
    const problems: Problem[] = []
    try {
      let n = args.length
      let opts: unknown
      if (n > 0 && isPlain(args[n - 1])) { opts = args[n - 1]; n-- } else if (n > pos.length) { opts = args[n - 1]; n-- }
      const given: Record<string, unknown> = {}
      for (let i = 0; i < pos.length; i++) {
        const name = pos[i]!
        const explicit = i < n
        if (!explicit && !(def.required ?? []).includes(name)) continue
        if (!explicit && isPlain(opts) && name in opts) continue
        if (!explicit) { problems.push({ code: 'API-TYPE', what: `${call} needs ${name} (argument ${i + 1}).`, fix: [`${def.name}(${pos.join(', ')})`] }); continue }
        const r = checkValue(call, name, spec(schema[name] ?? 'any'), args[i], model)
        if (r.ok) given[name] = r.value
        else problems.push(r.problem)
      }
      if (n > pos.length) problems.push({ code: 'API-TYPE', what: `${call} takes ${pos.length ? `${pos.join(', ')} and ` : ''}one options object, got ${args.length} arguments.`, fix: [`${def.name}(${[...pos, '{ … }'].join(', ')})`] })
      const v = validateOptions(call, opts, schema, def.aliases, model)
      problems.push(...v.problems)
      node.props = { ...defaults, ...given, ...v.props }
    } catch (e) {
      node.props = { ...defaults }
      problems.push({ code: 'API-TYPE', what: `${call} could not read its arguments (${(e as Error)?.message ?? e}).`, fix: [`${def.name}({ … })`] })
    }
    if (node.props.id === '') problems.push({ code: 'API-TYPE', what: `${call}: id is an empty string.`, fix: [`give it a name: ${def.name}({ id: '${def.name}A' }), or leave id out`] })
    const wanted = typeof node.props.id === 'string' && node.props.id ? (node.props.id as string) : null
    delete node.props.id
    model.addNode(node, wanted)
    node.invalid = problems.length > 0
    reportProblems(model, problems, [node.id], src)
    try { full.init?.(node, model) } catch (e) { model.reportError(e, call) }
    return node
  }
  constructors.set(def.name, ctor)
  return ctor
}
const constructors = new Map<string, (...args: any[]) => Handle>()
/** The constructor of a registered kind by name (for dispatchers such as group()). */
export const constructorOf = (kind: string): ((...args: any[]) => Handle) | undefined => constructors.get(kind)

// ── placements ─────────────────────────────────────────────────────────────────────────────────────────
export interface Placed {
  p: Vec3
  /** full rotation of the node (replaces parent rotation · own rotation) */
  q?: Quat
  /** p (and q) are in world space; otherwise in the parent's space */
  world?: boolean
}
export interface OwnTransform { q: Quat; s: number; parentQ: Quat; parentS: number }
export type PlacementResolver = (node: MNode, placement: Placement, frame: Frame, own: OwnTransform) => Placed
const placements = new Map<string, PlacementResolver>()
/** Register a placement type. A node has at most one placement; its resolver is a pure function of the frame. */
export function definePlacement(type: string, resolve: PlacementResolver, o: DefineOpts = {}): void { if (claim('placement', type, o.override)) placements.set(type, resolve) }
export const placementResolver = (type: string): PlacementResolver | undefined => placements.get(type)

// ── channel interpolation ─────────────────────────────────────────────────────────────────────────────
export type Interp = (a: any, b: any, u: number, frame: Frame, node: MNode | null) => any
const interps = new Map<string, Interp>()
/**
 * Custom interpolation for one channel of one kind, or of every kind with '*' (default: numbers, vectors and colours
 * blend; anything else switches at 50%). defineInterp('gauge', 'value', fn) · defineInterp('*', 'rotate', fn).
 * Scene-level view channels (VIEW) and params use '*'.
 */
export function defineInterp(kind: string, channel: string, fn: Interp, o: DefineOpts = {}): void { if (claim('interp', kind + '.' + channel, o.override)) interps.set(kind + '.' + channel, fn) }
export const interpFor = (kind: string | undefined, channel: string): Interp | undefined => (kind !== undefined ? interps.get(kind + '.' + channel) : undefined) ?? interps.get('*.' + channel)

// ── verbs ──────────────────────────────────────────────────────────────────────────────────────────────
/** Build an Anim from a record function. */
export function anim(verb: string, duration: number, record: Anim['record'], rate?: RateFn): Anim {
  return { isAnim: true, verb, duration, rate, record }
}
export const NOOP_ANIM = (verb = 'noop', duration = 0): Anim => anim(verb, duration, () => {})
const verbs = new Map<string, (...args: any[]) => Anim>()
/**
 * Register a verb and get its public function. The factory returns an Anim (use anim()); it may report problems on
 * the model and return NOOP_ANIM(). Exceptions inside the factory become RUNTIME-ERROR and a no-op.
 */
export function defineVerb<A extends any[]>(name: string, factory: (...args: A) => Anim, o: DefineOpts = {}): (...args: A) => Anim {
  if (!claim('verb', name, o.override)) return verbs.get(name) as (...args: A) => Anim
  const fn = (...args: A): Anim => {
    try {
      const a = factory(...args)
      return isAnim(a) ? a : NOOP_ANIM(name)
    } catch (e) {
      currentModel().reportError(e, `${name}()`)
      return NOOP_ANIM(name)
    }
  }
  verbs.set(name, fn as (...args: any[]) => Anim)
  return fn
}
export const verbNames = (): string[] => [...verbs.keys()]

/** Resolve the node a verb acts on; reports REF-MISSING / API-TYPE and returns null when it is not a node. */
export function verbTarget(v: unknown, call: string): MNode | null {
  if (isNode(v)) return v
  return currentModel().resolveNode(v, call, 'target')
}

// ── step actions and scene methods ────────────────────────────────────────────────────────────────────
/** Install `st.<name>(...args)`. `fn` records clips / actions through the Step recorder. Never throws to the scene. */
export function defineStepAction(name: string, fn: (st: Step, ...args: any[]) => unknown, o: DefineOpts = {}): void {
  if (!claim('stepAction', name, o.override)) return
  Object.defineProperty(Step.prototype, name, {
    configurable: true,
    writable: true,
    value: function (this: Step, ...args: unknown[]) {
      // a step function that has returned is closed: a call that arrives later (after an await) records nothing
      if (this.rec.closed) { this.model.late(`st.${name}()`); return this }
      try {
        const out = fn(this, ...args)
        return out === undefined ? this : out
      } catch (e) {
        this.model.reportError(e, `st.${name}()`)
        return this
      }
    },
  })
}

/** The `s` handle of `scene(opts, s => …)`. Methods are installed with defineSceneMethod. */
export class SceneHandle {
  constructor(readonly model: SceneModel) {}
}
forgiving(SceneHandle.prototype, () => 'the scene (s)', ['model'])
const READS = new Set(['t', 'area', 'rng', 'config'])
/** Install `s.<name>(...args)`. */
export function defineSceneMethod(name: string, fn: (s: SceneHandle, ...args: any[]) => unknown, o: DefineOpts = {}): void {
  if (!claim('sceneMethod', name, o.override)) return
  Object.defineProperty(SceneHandle.prototype, name, {
    configurable: true,
    writable: true,
    value: function (this: SceneHandle, ...args: unknown[]) {
      // reading (s.t(), a param made earlier) is fine at any time; declaring something after the scene was built is not
      if (this.model.finalized && !READS.has(name)) { this.model.late(`s.${name}()`); return undefined }
      try { return fn(this, ...args) } catch (e) { this.model.reportError(e, `s.${name}()`); return undefined }
    },
  })
}

// ── overlays ───────────────────────────────────────────────────────────────────────────────────────────
export interface OverlayRect {
  id: string
  kind: 'text' | 'label' | 'mark'
  /** stage px, x, y = the top-left corner */
  rect: Rect
  ids?: string[]
  text?: string
  src?: Src
  /** literal fixes that TEXT-OVERLAP prints when this rectangle collides with another text */
  fix?: string[]
}
export interface OverlayCtx {
  /** absolutely positioned element covering the stage; pointer-events: none unless the overlay enables them */
  root: HTMLElement
  runtime: Runtime
  model: SceneModel
  /** stage size in CSS px and px per frame unit */
  stage(): { width: number; height: number; scale: number }
  /** screen length in frame units → px */
  px(units: number): number
  /**
   * A stage-px coordinate rounded to a whole DEVICE pixel. Position every HTML element of an overlay with it (left /
   * top): the browser composites an element at a fractional position from the raster of where it was before, so the
   * same time would give different pixels after a different history. SVG and canvas content needs no snapping.
   */
  snap(px: number): number
  /** 2D point [x, y] (where 2D objects live; the 2D camera is applied) → stage px */
  toStage(p: readonly number[]): { x: number; y: number }
  /** screen point of a node (its centre), an anchor (box.top / part.anchor('pin')), a 3D point [x, y, z] or a 2D point [x, y] */
  project(target: unknown): ScreenPoint
  /** screen rectangle of a node in stage px (real DOM box for 2D, projected silhouette for 3D); null when hidden */
  screenRect(node: MNode): Rect | null
  /** a pixel of a 3D part that is really visible (nearest to the centre of its visible area), from the id pass; null when hidden or covered */
  visiblePoint(node: MNode): { x: number; y: number } | null
}
/** What an overlay may read while it lays out: the rectangles produced IN THIS FRAME by overlays laid out before it. */
export interface OverlayLaid {
  /** every earlier overlay's rectangles, or those of one overlay by name (declare it in `after`) */
  rects(name?: string): OverlayRect[]
}
export interface OverlayInstance {
  /**
   * Step 1, in layout order (`after`, then z): decide where things go in this frame and return the rectangles of
   * the text / marks that will be drawn. A pure function of (frame, laid); it may measure its own DOM, never
   * remember an earlier frame.
   */
  layout?(frame: Frame, laid: OverlayLaid): OverlayRect[] | void
  /** Step 2, in z order, after every layout has run: draw what layout decided. */
  paint(frame: Frame): void
  dispose?(): void
}
export interface OverlayDef {
  name: string
  /** stacking order, higher is on top (default 0) */
  z?: number
  /** names of overlays whose rectangles this one reads: it is laid out after them, whatever its z */
  after?: string[]
  /** replace an earlier overlay of the same name on purpose */
  override?: boolean
  create(ctx: OverlayCtx): OverlayInstance
}
const overlays = new Map<string, OverlayDef>()
/** Register an HTML/SVG layer over the stage: layout(frame) → rects, then paint(). */
export function defineOverlay(def: OverlayDef): void { if (claim('overlay', def.name, def.override)) overlays.set(def.name, def) }
/** In paint order (z, then name). */
export const allOverlays = (): OverlayDef[] => [...overlays.values()].sort((a, b) => (a.z ?? 0) - (b.z ?? 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
/** Layout order of a set of overlays: every overlay after the ones it names in `after`, otherwise in paint order. A cycle is broken in paint order and returned in `cycles`. */
export function overlayLayoutOrder(defs: readonly OverlayDef[]): { order: OverlayDef[]; cycles: string[] } {
  const byName = new Map(defs.map((d) => [d.name, d]))
  const order: OverlayDef[] = [], cycles: string[] = []
  const state = new Map<string, 1 | 2>()
  const visit = (d: OverlayDef): void => {
    const st = state.get(d.name)
    if (st === 2) return
    if (st === 1) { cycles.push(d.name); return }
    state.set(d.name, 1)
    for (const dep of d.after ?? []) { const x = byName.get(dep); if (x) visit(x) }
    state.set(d.name, 2)
    order.push(d)
  }
  for (const d of defs) visit(d)
  return { order, cycles }
}

// ── looks: scene-level view modes of the 3D panel (cutaway, ghost …) ──────────────────────────────────
/** What the 3D renderer applies to every material of a part in one frame. A look function edits it in place. */
export interface PartLook {
  color: string
  /** 0..1, already multiplied by the part's opacity, its ancestors' and its enter progress */
  opacity: number
  metalness: number
  roughness: number
  emissive: number
  /** 0..1 focus dimming */
  dim: number
  /** a housing: not picked, not counted as hiding other parts */
  shell: boolean
  /** world-space clipping planes: everything with dot(normal, p) + constant < 0 is cut away */
  clip: { normal: Vec3; constant: number }[]
  /** 0..1 strength of the edge lines */
  edges: number
}
export type LookFn = (look: PartLook, value: any, node: MNode, frame: Frame) => void
const looks = new Map<string, { fn: LookFn; rest: unknown; control?: LookControl }>()
/**
 * Register a view mode. `channel` is a scene-level channel (clips on VIEW, base value model.view[channel]) that any
 * node may override with a channel of the same name. `rest` is the value that means "off" (0 for an amount): tweens
 * start from it. Whenever the value for a part is not rest / null / undefined / false, `fn(look, value, node, frame)`
 * edits that part's look. Pure: no three.js here, so check and tests see it too.
 */
export function defineLook(channel: string, fn: LookFn, o: DefineOpts & { rest?: unknown; control?: LookControl } = {}): void { if (claim('look', channel, o.override)) looks.set(channel, { fn, rest: o.rest, control: o.control }) }
/**
 * A view mode that a viewer may switch by hand (Runtime.setLook): `label` is the word its control carries, `on` the
 * value that means "on" (the amount in between is the look's own interpolation from its rest value), `prepare` makes
 * a scene that never used the look ready for it.
 */
export interface LookControl { label: string; on: unknown; prepare?: (model: SceneModel) => void }
export const lookControls = (): { channel: string; label: string }[] => [...looks.entries()].filter(([, v]) => v.control).map(([channel, v]) => ({ channel, label: v.control!.label }))
export const lookControl = (channel: string): LookControl | undefined => looks.get(channel)?.control
export const allLooks = (): [string, LookFn, unknown][] => [...looks.entries()].map(([k, v]) => [k, v.fn, v.rest])
export const isLookChannel = (name: string): boolean => looks.has(name)
/** the "off" value of a look channel (undefined when it has none, or is not a look channel) */
export const lookRest = (name: string): unknown => looks.get(name)?.rest

// ── narration verbs ───────────────────────────────────────────────────────────────────────────────────
const verbsOfSpans = new Set<string>()
/**
 * Declare a verb of narration spans: `[words](ring:part)` (DESIGN §6: point, ring, label, arrow, glow, focus). The
 * guide registers the ones it draws; a span with any other verb is reported (API-UNKNOWN) when the scene is built.
 */
export function defineSpanVerb(name: string, o: DefineOpts = {}): void { if (claim('spanVerb', name, o.override)) verbsOfSpans.add(name) }
export const spanVerbs = (): string[] => [...verbsOfSpans]

// ── finalize and manifest hooks ───────────────────────────────────────────────────────────────────────
const finalizers = new Map<string, (model: SceneModel) => void>()
/** Run `fn(model)` once at the start of model.finalize(), after the builder: add clips, set lifetimes, report problems. Runs in registration order. */
export function defineFinalize(name: string, fn: (model: SceneModel) => void, o: DefineOpts = {}): void { if (claim('finalize', name, o.override)) finalizers.set(name, fn) }
export const allFinalizers = (): [string, (model: SceneModel) => void][] => [...finalizers.entries()]
const manifests = new Map<string, (model: SceneModel, runtime: Runtime | null) => unknown>()
/** Add a field to `__mimir.info()`: defineManifest('chapters', model => […]). The value must be JSON. */
export function defineManifest(key: string, fn: (model: SceneModel, runtime: Runtime | null) => unknown, o: DefineOpts = {}): void { if (claim('manifest', key, o.override)) manifests.set(key, fn) }
export const allManifests = (): [string, (model: SceneModel, runtime: Runtime | null) => unknown][] => [...manifests.entries()]

// ── renderers (one per space) ──────────────────────────────────────────────────────────────────────────
export interface IdPassPart {
  id: string
  /** pixels of the part that are visible in the frame */
  pixels: number
  /** pixels when drawn alone (only with { solo: true }, and always for housings) */
  total?: number
  /** stage-px box of the visible pixels */
  rect: Rect
  /** a visible pixel of the part, the one nearest to the centre of its visible area (stage px); null when none is visible */
  at: { x: number; y: number } | null
}
export interface IdPassResult { width: number; height: number; /** CSS px per buffer px */ scale: number; background: number; parts: Record<string, IdPassPart> }
export interface Renderer {
  /** create DOM inside the stage and build every node of this space */
  mount(rt: Runtime): void
  render(frame: Frame): void
  resize(): void
  /** stage-px rectangle of what is drawn for a node, null when nothing is (or when only pure maths can tell) */
  screenRect(node: MNode, frame: Frame): Rect | null
  /** top-most node at a stage-px point */
  pick?(x: number, y: number): MNode | null
  /** flat-colour id pass of the frame that was rendered last: per-part pixel counts, screen bounds, a visible point (3D) */
  idPass?(opts?: { solo?: boolean }): IdPassResult
  dispose(): void
}
const renderers = new Map<Space, () => Renderer>()
export function defineRenderer(space: Space, factory: () => Renderer, o: DefineOpts = {}): void { if (claim('renderer', space, o.override)) renderers.set(space, factory) }
export const rendererFor = (space: Space): (() => Renderer) | undefined => renderers.get(space)

// ── check rules ────────────────────────────────────────────────────────────────────────────────────────
export type SampleKind = 'step-end' | 'transition' | 'param' | 'phase'
export interface Sample {
  kind: SampleKind
  tau: number
  /** 1-based step number, null when the scene has no steps */
  step: number | null
  /** param overrides in force for this sample */
  params: Record<string, number | boolean | string>
  label: string
}
export interface RuleReport {
  what: string
  fix?: string[]
  ids?: string[]
  measured?: number | string | null
  limit?: number | string | null
  severity?: Severity
  /** defaults to the sample's step / time; pass null to detach */
  step?: number | null
  t?: number | null
  line?: number | null
  file?: string | null
  /** param values the problem was found with (filled in by the engine at a pinned-param sample; a forwarding rule passes on what was recorded) */
  params?: Record<string, number | boolean | string>
}
/** One piece of text on screen, wherever it comes from: a text node, a kind's textRects, an overlay. */
export interface TextBox { name: string; text: string; ids: string[]; /** stage px */ rect: Rect; line: number | null; from: 'node' | 'kind' | 'overlay'; label: boolean; fix?: string[] }
export interface RuleCtx {
  model: SceneModel
  /** null when rules run without a browser: measured helpers then return null and the rule must report nothing */
  runtime: Runtime | null
  /** the whole sampling plan */
  samples: Sample[]
  /** phase 'sample': the sample being measured and its state (already rendered when there is a runtime) */
  sample: Sample | null
  frame: Frame | null
  /** pure state at any time / params (no rendering) */
  stateAt(tau: number, params?: Record<string, number | boolean | string>): Frame
  /** visible leaf nodes of the current sample (optionally of one space) */
  visible(space?: Space): MNode[]
  /** stage size in px; null without a runtime */
  stage: { width: number; height: number; scale: number } | null
  /** measured rectangle in stage px; null when hidden or not measurable */
  screenRect(node: MNode): Rect | null
  /** text rectangles drawn by overlays (labels, captions) in the current sample */
  overlayRects(): OverlayRect[]
  /** every piece of text on screen in the current sample: text nodes, text inside kinds (textRects), overlays. Empty without a runtime. */
  textBoxes(): TextBox[]
  /** flat-colour id pass of the current sample (rendered once per sample, shared by every rule); null when the scene has no 3D or there is no runtime */
  idPass(opts?: { solo?: boolean }): IdPassResult | null
  report(r: RuleReport): void
}
export interface RuleDef {
  code: string
  severity?: Severity
  /**
   * static: once, from the model alone. sample: once per sample of the plan (see `on`). story: once, with the plan
   * and stateAt() for comparisons across time.
   */
  phase: 'static' | 'sample' | 'story'
  /** which sample kinds a 'sample' rule runs on (default: step-end and transition) */
  on?: SampleKind[]
  /** replace an earlier rule with the same code on purpose */
  override?: boolean
  /** the rule is pure maths (world transforms, no pixels): a sample that only such rules read is not rendered */
  pure?: boolean
  run(c: RuleCtx): void
}
const rules = new Map<string, RuleDef>()
/** Register a check rule (from src/<module>/check.ts). */
export function defineRule(def: RuleDef): void { if (claim('rule', def.code, def.override)) rules.set(def.code, def) }
export const allRules = (): RuleDef[] => [...rules.values()]

// ── player ─────────────────────────────────────────────────────────────────────────────────────────────
export interface PlayerInstance {
  /** where the stage is mounted; the runtime letterboxes the 16:9 frame inside it */ slot: HTMLElement
  dispose?(): void
  /** A player that keeps its own playback clock: the host calls this instead of host.play() when the page should start playing (autoplay). Most players leave it out and use host.play() / host.pause(). */
  play?(): void
  /**
   * A player that keeps its own playback clock hands the host its transport: host.play() / host.pause() /
   * host.playing and state().playing / speed then speak for that clock (there is one clock on a page), and the host's
   * 'play' / 'pause' events fire when the player says it changed.
   */
  transport?: PlayerTransport
}
export interface PlayerTransport {
  readonly playing: boolean
  readonly speed: number
  play(o?: { speed?: number }): void
  pause(): void
  /** the host subscribes once: call `fn` when playback starts or stops (`ended`: it stopped at the end of the story) */
  onChange(fn: (playing: boolean, ended: boolean) => void): void
  /** false while the player lets a reader change params as the story goes on; otherwise pinning a param by hand pauses */
  pausesOnParam?(): boolean
}
/** `host` is window.__mimir (see src/host). The player may use nothing else. */
export type PlayerFactory = (host: any, root: HTMLElement) => PlayerInstance
let player: PlayerFactory | null = null
/** One player per build: the real chrome replaces src/player wholesale, or registers with override: true. */
export function definePlayer(factory: PlayerFactory, o: DefineOpts = {}): void { if (claim('player', 'player', o.override)) player = factory }
export const playerFactory = (): PlayerFactory | null => player

export type { PropSpec, Schema, DefineOpts, Subpath }
