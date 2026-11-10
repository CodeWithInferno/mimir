// Nodes: plain data + chainable handle methods. Methods are installed by registries (defineSetter / defineMethod /
// defineGetter), so a module adds `m.myThing()` without touching this file. Unknown method names never throw
// while a scene is being built: they report API-UNKNOWN with a did-you-mean and return the node.
import { ctx } from './context.ts'
import { callSite, closest, type Src } from './diagnostics.ts'
import { claim } from './ledger.ts'
import type { Vec3 } from './math.ts'
import { PACE } from './rate.ts'
import type { SceneModel } from './model.ts'

export type Dyn<T> = T | (() => T)
export type Space = '2d' | '3d'

/** Options of every define* call. `override: true` replaces an earlier registration of the same name on purpose. */
export interface DefineOpts { override?: boolean }

/** One placement per node. `type` selects a resolver registered with definePlacement. */
export interface Placement { type: string; [key: string]: unknown }

export class MNode {
  uid = 0
  id = ''
  kind = ''
  space: Space = '2d'
  /** base values: a value or a function, per option and per built-in channel */
  props: Record<string, unknown> = {}
  children: MNode[] = []
  parent: MNode | null = null
  /** extra named local points added with .define(name, [x, y, z]) */
  anchors: Record<string, Dyn<Vec3>> = {}
  placement: Placement | null = null
  src: Src = { file: null, line: null }
  /** true when the constructor call had a problem: backends draw it red */
  invalid = false
  /** 0-based step in which it was created, −1 when created outside any step */
  createdStep = -1
  /** story time of creation (0 outside steps) */
  createdAt = 0
  /** 0-based chapter that was open when it was created outside a step (−1: before any s.chapter()) */
  createdChapter = -1
  /** true after m.hud(): a 2D object in screen space, which the 2D camera (st.zoom) does not move */
  isHud = false
  /** optional human label (defaults to the id) */
  label: string | null = null
  model!: SceneModel

  /** `m.to.color(RED).scale(2)` → an Anim that tweens to the state those setters would produce. */
  get to(): ToBuilder & { [setter: string]: any } { return makeTo(this) }
  toString(): string { return `#${this.id}` }
}
export class Node2D extends MNode { override space: Space = '2d' }
export class Node3D extends MNode { override space: Space = '3d' }
export const isNode = (v: unknown): v is MNode => v instanceof MNode
/** What constructors return to scene code: the node plus the chainable methods the registries installed on it. */
export type Handle = MNode & { [method: string]: any }

// ── anchor references ────────────────────────────────────────────────────────────────────────────────
/** A live point on a node: call it for the world position in the frame being evaluated. Usable as any Dyn point. */
export interface AnchorRef { (): Vec3; node: MNode; anchor: string; isAnchorRef: true; src: Src }
export function anchorRef(node: MNode, anchor: string): AnchorRef {
  const f = (() => node.model.now().anchor(node, anchor, f.src)) as AnchorRef
  f.node = node
  f.anchor = anchor
  f.isAnchorRef = true
  f.src = ctx.building ? callSite() : { file: null, line: null }
  return f
}
export const isAnchorRef = (v: unknown): v is AnchorRef => typeof v === 'function' && (v as { isAnchorRef?: boolean }).isAnchorRef === true

// ── forgiving prototypes ─────────────────────────────────────────────────────────────────────────────
const PASS = new Set(['then', 'toJSON', 'asymmetricMatch', '$$typeof', 'nodeType', 'tagName', 'inspect', 'length', 'default', 'prototype', 'name', 'displayName', 'jquery', 'window', 'document', 'nodeName', 'style', 'toStringTag'])

export function memberNames(obj: object): string[] {
  const out = new Set<string>()
  for (let p: object | null = obj; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    let names: string[]
    try { names = Object.getOwnPropertyNames(p) } catch { break }
    if (names.includes('hasOwnProperty')) break // reached Object.prototype (possibly through a forgiving trap)
    for (const n of names) if (n !== 'constructor' && !n.startsWith('_')) out.add(n)
  }
  return [...out]
}

const kindMethods = new Map<string, Map<string, (node: any, ...args: any[]) => unknown>>()
/** Register a method that only nodes of one kind have: defineKindMethod('axes', 'plot', (ax, fn, opts) => …). */
export function defineKindMethod(kind: string, name: string, fn: (node: any, ...args: any[]) => unknown, o: DefineOpts = {}): void {
  if (!claim('kindMethod', kind + '.' + name, o.override)) return
  let per = kindMethods.get(kind)
  if (!per) kindMethods.set(kind, (per = new Map()))
  per.set(name, fn)
}

/** Make missing members of `proto` report API-UNKNOWN (while a scene is being built) instead of throwing. */
export function forgiving(proto: object, label: (self: any) => string, hide: readonly string[] = []): void {
  const base = Object.getPrototypeOf(proto) as object
  const trap = new Proxy(base, {
    get(target, name, receiver) {
      if (typeof name === 'symbol' || name in target) return Reflect.get(target, name, receiver)
      // methods that exist only for one kind (ax.plot, graph.edge …) are found here
      const own = receiver instanceof MNode ? kindMethods.get(receiver.kind)?.get(name) : undefined
      if (own) return (...args: unknown[]) => { try { return own(receiver, ...args) } catch (e) { (receiver as MNode).model.reportError(e, `${(receiver as MNode).kind}.${name}()`); return receiver } }
      // setters that exist only for one kind (gauge.value, gauge.to.value): on the node they apply, on `to` they collect
      const owner: MNode | null = receiver instanceof MNode ? receiver : receiver instanceof ToBuilder ? receiver.node : null
      const setter = owner ? kindSetters.get(owner.kind)?.get(name) : undefined
      if (setter && owner) return (...args: unknown[]) => {
        let patch: Patch | null = null
        try { patch = setter(owner, ...args) } catch (e) { owner.model.reportError(e, `${owner.kind}.${receiver === owner ? '' : 'to.'}${name}()`) }
        if (patch && receiver === owner) hooks.applyPatch(owner, patch, name)
        else if (patch) (receiver as ToBuilder).patches.push(patch)
        return receiver
      }
      // internal duck-type probes (isAnim, isSelector …) and framework probes are not scene mistakes
      if (!ctx.building || PASS.has(name) || name.startsWith('_') || /^is[A-Z]/.test(name)) return undefined
      const model = ctx.model
      const self = receiver as object
      const names = [...memberNames(self), ...(self instanceof MNode ? kindMethods.get(self.kind)?.keys() ?? [] : []), ...(owner ? kindSetterNames(owner.kind) : [])].filter((n) => !hide.includes(n))
      const near = closest(name, names)
      const what = label(self)
      model?.diagnostics.add({
        code: 'API-UNKNOWN',
        ids: self instanceof MNode ? [self.id] : [],
        what: `${what} has no method "${name}".`,
        fix: [near ? `use "${near}"` : `available: ${names.slice(0, 28).join(', ')}`],
      })
      const stub = function (): unknown { return receiver }
      return stub
    },
  })
  Object.setPrototypeOf(proto, trap)
}
const NODE_FIELDS = ['id', 'uid', 'props', 'children', 'parent', 'anchors', 'placement', 'src', 'invalid', 'createdStep', 'createdAt', 'createdChapter', 'isHud', 'model', 'label', 'kind', 'space', 'toString']
forgiving(MNode.prototype, (n: MNode) => `${n.kind}`, NODE_FIELDS)

// ── method registries ────────────────────────────────────────────────────────────────────────────────
/** What a setter changes: channel → new base value (a value or a function). `placement` is a channel too. */
export type Patch = Record<string, unknown>
export type SetterFn = (node: MNode, ...args: any[]) => Patch | null
type SpaceSel = Space | '*'
const protoOf = (space: SpaceSel): object => (space === '2d' ? Node2D.prototype : space === '3d' ? Node3D.prototype : MNode.prototype)

const setters = new Map<string, SetterFn>() // key: space + ':' + name
const kindSetters = new Map<string, Map<string, SetterFn>>() // kind → name → fn
export const setterFor = (node: MNode, name: string): SetterFn | undefined => kindSetters.get(node.kind)?.get(name) ?? setters.get(node.space + ':' + name) ?? setters.get('*:' + name)
/** names of the setters only this kind has (for did-you-mean lists and docs) */
export const kindSetterNames = (kind: string): string[] => [...(kindSetters.get(kind)?.keys() ?? [])]
/**
 * Register a chainable setter that only one kind has: `gauge.value(0.8)` AND `gauge.to.value(0.8)` (a tween), from
 * one function that returns the channels it sets, like defineSetter. Type it with MobOf<Self, SelfTo> (api.d.ts).
 */
export function defineKindSetter(kind: string, name: string, fn: SetterFn, o: DefineOpts = {}): void {
  if (!claim('kindSetter', kind + '.' + name, o.override)) return
  let per = kindSetters.get(kind)
  if (!per) kindSetters.set(kind, (per = new Map()))
  per.set(name, fn)
}

/** Installed by model.ts: applies a patch to a node (base value outside steps, an instant clip inside one). */
export const hooks: { applyPatch: (node: MNode, patch: Patch, name: string) => void; /** which objects a patch lands on (model.route) */ route: (node: MNode, patch: Patch, call: string) => [MNode, Patch][] } = { applyPatch: () => {}, route: (node, patch) => [[node, patch]] }

/**
 * Register a chainable setter `m.<name>(...args)`. The function returns the channels it sets; the same function
 * powers `m.to.<name>(...args)` (a tween to those values). Return null after reporting a problem.
 */
export function defineSetter(space: SpaceSel, name: string, fn: SetterFn, o: DefineOpts = {}): void {
  if (!claim('setter', space + ':' + name, o.override)) return
  setters.set(space + ':' + name, fn)
  Object.defineProperty(protoOf(space), name, {
    configurable: true,
    writable: true,
    value: function (this: MNode, ...args: unknown[]) {
      let patch: Patch | null = null
      // a kind's own setter of the same name (defineKindSetter: axes.fit re-lays the axes out) wins over the general one
      try { patch = (kindSetters.get(this.kind)?.get(name) ?? fn)(this, ...args) } catch (e) { this.model.reportError(e, `${this.kind}.${name}()`) }
      if (patch) hooks.applyPatch(this, patch, name)
      return this
    },
  })
  const to = space === '2d' ? To2D.prototype : space === '3d' ? To3D.prototype : ToBuilder.prototype
  Object.defineProperty(to, name, {
    configurable: true,
    writable: true,
    value: function (this: ToBuilder, ...args: unknown[]) {
      let patch: Patch | null = null
      try { patch = (kindSetters.get(this.node.kind)?.get(name) ?? fn)(this.node, ...args) } catch (e) { this.node.model.reportError(e, `${this.node.kind}.to.${name}()`) }
      if (patch) this.patches.push(patch)
      return this
    },
  })
}
/** Register a plain method `m.<name>(...args)` (returns whatever fn returns; return the node to stay chainable). */
export function defineMethod(space: SpaceSel, name: string, fn: (node: any, ...args: any[]) => unknown, o: DefineOpts = {}): void {
  if (!claim('method', space + ':' + name, o.override)) return
  Object.defineProperty(protoOf(space), name, {
    configurable: true,
    writable: true,
    value: function (this: MNode, ...args: unknown[]) {
      try { return fn(this, ...args) } catch (e) { this.model.reportError(e, `${this.kind}.${name}()`); return this }
    },
  })
}
/** Register a property getter `m.<name>` (e.g. m.top → a live anchor). */
export function defineGetter(space: SpaceSel, name: string, fn: (node: any) => unknown, o: DefineOpts = {}): void {
  if (!claim('getter', space + ':' + name, o.override)) return
  Object.defineProperty(protoOf(space), name, { configurable: true, get(this: MNode) { return fn(this) } })
}

// ── m.to ─────────────────────────────────────────────────────────────────────────────────────────────
/** Collects the setters called on `m.to`. It is an Anim (see timeline.ts): pass it to st.play(). */
export class ToBuilder {
  readonly isAnim = true as const
  readonly verb = 'to'
  patches: Patch[] = []
  duration: number = PACE.play
  rate: ((t: number) => number) | undefined
  constructor(readonly node: MNode) {}
  record(rec: { clip(target: unknown, prop: string, to: unknown, o: { at: number; duration: number; rate?: (t: number) => number }): void }, at: number, duration: number, rate?: (t: number) => number): void {
    // one setter call lands on one set of objects (model.route), exactly as the plain setter does
    for (const patch of this.patches) for (const [node, own] of hooks.route(this.node, patch, `${this.node.kind}.to`)) for (const [prop, to] of Object.entries(own)) rec.clip(node, prop, to, { at, duration, rate: rate ?? this.rate })
  }
}
class To2D extends ToBuilder {}
class To3D extends ToBuilder {}
forgiving(ToBuilder.prototype, (b: ToBuilder) => `${b.node.kind}.to`, ['node', 'patches', 'isAnim', 'verb', 'duration', 'rate', 'record'])
const makeTo = (node: MNode): ToBuilder => (node.space === '2d' ? new To2D(node) : new To3D(node))
