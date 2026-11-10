// The block contract of explain() (docs/QUICK.md), as TypeScript. A block is a GENERAL shape of explanation (a row of
// cells, a sequence diagram, a formula, a machine, a chart …): it draws itself inside the rectangle the stage gives it
// and turns a change of its state into smooth animation. Blocks never place themselves, never choose a duration for
// the story and never throw. Members marked "optional" were added on top of the documented contract; nothing that is
// documented was changed or removed.
import { apply, closest, emOf, kindOf, MNode, TEXT_SIZES, type Handle, type Param, type SceneHandle, type Step, type Area } from '../core/index.ts'
import { circle, faceOf, group, lineMetrics, rect as rectShape } from '../r2d/index.ts'

/** An engine object: what constructors such as rect() or kit.piston() return. */
export type Placed<_Self = unknown> = Handle
/** The scene handle `s` with its methods (param, step, viewport …). */
export type Scene = SceneHandle & { [method: string]: any }
/** The step handle `st` with its actions (play, say, set …). */
export type StepHandle = Step & { [action: string]: any }

export interface BlockDef<State = Record<string, unknown>> {
  /** 'cells' | 'flow' | 'chart' | 'machine' | … */
  kind: string
  /** gets the 3D panel */
  is3d?: boolean
  /** hints for the stage (aspect = width / height; weight = share of the room next to other blocks) */
  prefer?: { aspect?: number; weight?: number }
  /** Create the block's objects inside `rect` (2D frame units) or as the 3D panel. No absolute placement outside it. */
  build(ctx: BlockCtx): BlockHandle<State>
}
export interface BlockCtx {
  s: Scene
  id: string
  /** the rectangle the stage gives this block */
  rect: Area
  control(name: string): Param<number> | undefined
  /** other blocks (for links such as chart.follow); a block sees the blocks that stand before it in `stage` */
  block(id: string): BlockHandle | undefined
  /** a diagnostic; never throw */
  report(what: string, fix?: string): void
}
export interface BlockHandle<State = Record<string, unknown>> {
  /** faded in when the block is introduced */
  root: Placed<unknown>
  initial: State
  /** Link targets for narration and `focus`: '' is the block itself, 'mid' -> 'row.mid'. */
  target(path: string): Placed<unknown> | undefined
  /** for did-you-mean */
  targets(): string[]
  /** Record, inside step `st`, the transition from `prev` to `prev + change`. Unspecified keys keep their value. */
  apply(st: StepHandle, change: Partial<State>, prev: State): State
  /** What an author can read while writing the story (row.value(i), engine.probe(name), row.length ...). */
  api: Record<string, unknown>
  /** One line of plain text describing the block in `state` (for `mimir review`). */
  describe(state: State): string
  /**
   * Optional. The keys a story step may set on this block. Without it the keys of `initial` are the valid ones; `null`
   * accepts every key (a block that validates for itself). An unknown key is one diagnostic with did-you-mean and is
   * dropped before apply() sees the change.
   */
  keys?: readonly string[] | null
  /** Optional. Record how the block comes on stage in `st` (default: its root fades in with a small rise). */
  enter?(st: StepHandle): void
  /** Optional. Objects that live outside `root` and must stay when a chapter clears the stage. */
  extras?(): Placed<unknown>[]
}

// ── registry ─────────────────────────────────────────────────────────────────────────────────────────
/** What the registry knows about a kind of block. */
export interface BlockKind {
  kind: string
  /** how an author writes it, for messages: "cells([3, 8, 12], { pointers: ['lo'] })" */
  example?: string
  /** Optional. Turn an engine object of the node kind `adopts` into a block (an object made by an existing constructor used as a stage entry). */
  adopt?: (node: Placed<unknown>) => BlockDef<any>
  /** the node kind `adopt` takes (default: the block kind) */
  adopts?: string
}
const kinds = new Map<string, BlockKind>()
const adopters = new Map<string, BlockKind>()

/**
 * Register a kind of block. Give the constructor's definition (`defineBlock({ kind: 'cells', example })`) or a block
 * definition itself; the kind then counts as known (an unknown kind in `stage` is a diagnostic with did-you-mean).
 * Registering a kind twice keeps the first and never throws. Returns what it was given.
 */
export function defineBlock<T extends { kind: string }>(def: T): T {
  if (!def || typeof def !== 'object' || typeof def.kind !== 'string' || !def.kind) return def
  if (!kinds.has(def.kind)) {
    const k: BlockKind = { kind: def.kind, example: (def as BlockKind).example, adopt: (def as BlockKind).adopt, adopts: (def as BlockKind).adopts }
    kinds.set(def.kind, k)
    if (typeof k.adopt === 'function') adopters.set(k.adopts ?? k.kind, k)
  }
  return def
}
/** The registered kinds, in registration order. */
export const blockKinds = (): BlockKind[] => [...kinds.values()]
export const blockKind = (kind: string): BlockKind | undefined => kinds.get(kind)
/** The block kind that adopts engine objects of this node kind, if one does. */
export const adopterOf = (nodeKind: string): BlockKind | undefined => adopters.get(nodeKind)
export const isBlockDef = (v: unknown): v is BlockDef => !(v instanceof MNode) && typeof v === 'object' && v !== null && typeof (v as BlockDef).kind === 'string' && typeof (v as BlockDef).build === 'function'

// ── helpers every block uses ─────────────────────────────────────────────────────────────────────────
/** "did you mean …" + the valid list, as the fix line of a diagnostic. */
export function didYouMean(word: string, valid: readonly string[], what = 'valid'): string {
  const near = valid.length ? closest(word, valid) : null
  const list = valid.length ? `${what}: ${valid.join(', ')}` : `${what}: (none)`
  return near ? `did you mean "${near}"? ${list}` : list
}
/** A rectangle with the convenience fields of the engine's Area (x, y is the lower left corner). */
export function areaOf(x: number, y: number, width: number, height: number): Area {
  return { x, y, width, height, center: [x + width / 2, y + height / 2], left: x, right: x + width, bottom: y, top: y + height }
}
/** `rect` with `pad` taken off every side (never smaller than a sliver). */
export const inset = (r: Area, pad: number): Area => areaOf(r.x + pad, r.y + pad, Math.max(0.1, r.width - 2 * pad), Math.max(0.1, r.height - 2 * pad))
/** The largest rectangle of `aspect` (width / height) that fits `rect`, centred in it: a block that keeps its proportions draws into this, so it never hangs at the top of a rectangle that is too tall. */
export function fitAspect(rect: Area, aspect: number): Area {
  if (!(aspect > 0) || !Number.isFinite(aspect)) return rect
  const width = Math.min(rect.width, rect.height * aspect), height = width / aspect
  return areaOf(rect.center[0] - width / 2, rect.center[1] - height / 2, width, height)
}
/** Uniform scale that makes a box of `width` × `height` fit `rect`, never above `most`. */
export const fitScale = (width: number, height: number, rect: Area, most = 1): number => Math.min(most, width > 0 ? rect.width / width : most, height > 0 ? rect.height / height : most)
export const isNodeLike = (v: unknown): v is MNode => (typeof v === 'object' || typeof v === 'function') && v !== null && typeof (v as MNode).kind === 'string' && typeof (v as MNode).uid === 'number'
/** Width in frame units of one line of stage text at a size of the engine's ladder ('label', 'note' …) or a number. Read from the embedded faces: the same with and without a browser. */
export function textWidth(words: string, size: string | number = 'body'): number {
  const em = emOf(typeof size === 'number' ? size : TEXT_SIZES[size] ?? TEXT_SIZES.body!)
  return Math.max(0, ...String(words).split('\n').map((line) => lineMetrics(line, faceOf('serif', 'normal', false)).width)) * em
}

// ── custom(): the escape hatch ───────────────────────────────────────────────────────────────────────
/** What the function given to custom() may return: the object to show, or the object with what a story can do to it. */
export interface CustomResult {
  root: Placed<unknown>
  /** named parts for narration links: { needle } makes [the needle](gauge.needle) work */
  targets?: Record<string, Placed<unknown>>
  /** called for `<block>: change` in a step: record the transition with the full step API (st.play …) */
  change?: (st: StepHandle, change: Record<string, unknown>, state: Record<string, unknown>) => void
  /** one line of text for `mimir describe` */
  describe?: (state: Record<string, unknown>) => string
  /** what the story may read */
  api?: Record<string, unknown>
  /** false: keep the object exactly where and as large as it was built (default: it is scaled and centred into the block's rectangle) */
  fit?: boolean
}
/** room kept free round a custom block inside its rectangle (frame units) */
export const CUSTOM_PAD = 0.15
/**
 * custom(build, prefer?): a block made with the full engine API. `build` receives the block's context (its rectangle
 * `rect`, the scene `s`, the controls) and returns the object to show, or { root, targets, change, describe, api }.
 * Fit what you draw into `rect`.
 */
/**
 * A line or an arrow drawn between two POINTS is drawn in the coordinates of the frame, wherever its group is put.
 * Inside a custom block the author's coordinates are the block's own, and the block is scaled and moved into its
 * rectangle: every end given as numbers is therefore taken through the placement of the block, so that the line stays
 * with the shapes it was drawn beside. (An end given as an object follows that object already.)
 */
/** radius of the invisible mark that stands at the end of a free line while a custom block is measured */
const FIT_MARK = 1e-3
/** The ends of the lines and arrows of a drawing that are given as numbers (in the author's own coordinates). */
function lineEnds(root: MNode): [number, number][] {
  const out: [number, number][] = []
  const walk = (n: MNode): void => {
    if (kindOf(n.kind)?.worldGeometry) for (const key of ['a', 'b']) {
      const p = (n.props as Record<string, unknown>)[key]
      if (Array.isArray(p) && p.every((v) => typeof v === 'number' && Number.isFinite(v))) out.push([Number(p[0] ?? 0), Number(p[1] ?? 0)])
    }
    n.children.forEach(walk)
  }
  walk(root)
  return out
}
function followFit(root: MNode): void {
  const model = root.model
  const walk = (n: MNode): void => {
    if (kindOf(n.kind)?.worldGeometry) {
      for (const key of ['a', 'b']) {
        const p = (n.props as Record<string, unknown>)[key]
        if (!Array.isArray(p) || !p.every((v) => typeof v === 'number' && Number.isFinite(v))) continue
        const v: [number, number, number] = [Number(p[0] ?? 0), Number(p[1] ?? 0), Number(p[2] ?? 0)]
        ;(n.props as Record<string, unknown>)[key] = (): number[] => apply(model.now().world(root), v)
      }
    }
    n.children.forEach(walk)
  }
  walk(root)
}

/** the most a text inside a custom block is enlarged to stay at its own size when the drawing is scaled down to fit */
export const CUSTOM_TEXT_KEEP = 2

/**
 * A drawing that is larger than its rectangle is scaled down, and its words with it: a label that was legible at its
 * own size is then too small to read. The shapes shrink, the words keep their size (up to CUSTOM_TEXT_KEEP).
 */
function keepTextSize(root: MNode, room: Area): void {
  let b: { min: number[]; max: number[] }
  try { b = root.model.state(0).bounds(root) } catch { return }
  const k = fitScale(b.max[0]! - b.min[0]!, b.max[1]! - b.min[1]!, room)
  if (!(k > 0) || k >= 1) return
  const grow = Math.min(CUSTOM_TEXT_KEEP, 1 / k)
  const walk = (n: MNode): void => {
    const h = n as unknown as Handle & { scale?: (k: number) => unknown }
    if (kindOf(n.kind)?.text && n.props.scale === undefined && typeof h.scale === 'function') h.scale(grow)
    n.children.forEach(walk)
  }
  walk(root)
}

/** What the function given to custom() receives: the block's context, with its rectangle also as `area` (a name that does not hide rect(), the shape). */
export type CustomCtx = BlockCtx & { area: Area }
export function custom(build: (ctx: CustomCtx) => Placed<unknown> | CustomResult, prefer?: { aspect?: number; weight?: number; is3d?: boolean }): BlockDef {
  return {
    kind: 'custom', is3d: prefer?.is3d === true, prefer: { aspect: prefer?.aspect, weight: prefer?.weight },
    build(ctx) {
      if (typeof build !== 'function') { ctx.report(`custom() takes a function that builds the block, got ${typeof build}`, 'custom(({ area }) => circle({ radius: 1 }).at(area.center))') }
      // `area` is the block's rectangle. `rect` is that rectangle too, and it can also be CALLED: a function that takes
      // `{ rect }` apart has hidden rect() the shape behind it, and calling it must still draw a rectangle, not throw
      const both = Object.assign((...args: unknown[]): unknown => (rectShape as (...a: unknown[]) => unknown)(...args), ctx.rect) as unknown as Area
      const out = typeof build === 'function' ? build({ ...ctx, rect: both, area: ctx.rect }) : undefined
      const made: CustomResult | undefined = isNodeLike(out) ? { root: out as Placed<unknown> } : out && typeof out === 'object' && isNodeLike((out as CustomResult).root) ? { ...(out as CustomResult) } : undefined
      if (!made) { ctx.report('the function given to custom() must return the object it built (or { root, targets, change })', 'return group([…]) at the end of the function'); return undefined as unknown as BlockHandle }
      const parts = made.targets && typeof made.targets === 'object' ? made.targets : {}
      // the author draws in whatever coordinates are convenient: the stage scales and centres the result into the block's rectangle
      // (an object the author placed is put into a group first: an object has one placement, and the group's is the fit)
      const drawn = made.root // what a link to the block itself points at: the author's own object
      if ((made.root as MNode).space !== '3d' && made.fit !== false) {
        // an object that is named as a target but was made a second time, outside the drawing, belongs to the drawing all
        // the same: left alone it would stand in the middle of the frame, on top of the other blocks
        const within = (n: MNode | null): boolean => { for (let at = n; at; at = at.parent) if (at === (made.root as MNode)) return true; return false }
        const strays = Object.values(parts).filter((t): t is MNode => isNodeLike(t) && !within(t) && !(t as MNode).parent)
        // the ends of free lines count for the size of the drawing: each gets a mark of no size that the block is measured with
        const ends = [made.root as MNode, ...strays].flatMap(lineEnds).map(([x, y]) => (circle({ radius: FIT_MARK, opacity: 0 }) as Handle).at(x, y).allow('TINY'))
        const shown = ((made.root as MNode).placement || ends.length || strays.length ? group([made.root, ...strays, ...ends]) : made.root) as Placed<unknown> & { fit?: (area: Area) => unknown }
        if (typeof shown.fit === 'function') { keepTextSize(shown as unknown as MNode, inset(ctx.rect, CUSTOM_PAD)); shown.fit(inset(ctx.rect, CUSTOM_PAD)); made.root = shown; followFit(shown as unknown as MNode) }
      }
      return {
        root: made.root, initial: {}, keys: null, api: made.api ?? {},
        target: (path) => (path === '' ? drawn : isNodeLike(parts[path]) ? parts[path] : undefined),
        targets: () => Object.keys(parts),
        apply: (st, change, prev) => { const next = { ...prev, ...change }; if (typeof made.change === 'function') made.change(st, change as Record<string, unknown>, next); return next },
        describe: (state) => (typeof made.describe === 'function' ? made.describe(state) : `custom block${Object.keys(state).length ? ' ' + JSON.stringify(state) : ''}`),
      }
    },
  }
}
defineBlock({ kind: 'custom', example: 'custom(({ area }) => circle({ radius: 1 }).at(area.center))' })
