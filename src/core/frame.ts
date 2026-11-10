// Frame = the state of the scene at one (τ, params, view). Everything is computed lazily and memoised for the
// lifetime of the frame; a Frame is never mutated by rendering, so sampling in any order gives the same answers.
import { ctx } from './context.ts'
import { closest, type Src } from './diagnostics.ts'
import { isColor, MATERIALS, mix, parseColor, toHex, type MaterialSpec } from './color.ts'
import {
  add, apply, boxCenter, boxCorners, boxOf, clamp01, compose, DEG, emptyBox, finite3, finiteTRS, hashString, isEmptyBox, lerp3, norm,
  QID, qAxisDeg, qmul, qrot, qslerp, qz, qzDeg, sub, TID, toVec3, transformBox, union, type Box3, type Quat, type Rect, type TRS, type Vec3,
} from './math.ts'
import { isAnchorRef, isNode, type MNode, type Placement } from './node.ts'
import { allLooks, interpFor, kindOf, lookControl, lookRest, placementResolver, type KindDef, type PartLook, type Placed, type Resolved, type Subpath } from './registry.ts'
import { arrayOf, objectOf, recordOf, spec, type PropSpec, type PropType } from './schema.ts'
import { isSelector, VIEW, type ActiveAction, type Clip, type StepRec } from './timeline.ts'
import { basisOf, fitPose, lerpPose, poseOk, projectWith, VIEWS, type Basis, type Pose } from './camera.ts'
import { smooth } from './rate.ts'
import { FRAME_H, FRAME_W, type ParamDef, type ParamValue, type SceneModel } from './model.ts'

/** A view forced from outside the story: a named view or (part of) a pose. Wins over every camera cue. */
export type ViewOverride = string | Partial<Pose>
/** What st.camera() accepts. */
export interface CameraSpec { view?: string; target?: unknown; azimuth?: number; elevation?: number; distance?: number; fit?: unknown; fov?: number; zoom?: number; /** [t0, t1] spans to fit the default view over (a chapter opening) */ reset?: [number, number][] }
/** The 2D camera: the 2D point at the centre of the frame, and the magnification. Identity = { center: [0, 0], zoom: 1 }. */
export interface Pose2D { center: [number, number]; zoom: number }
/** What st.zoom() records: null = back to the whole frame. `target` = nodes to frame, a point [x, y] or a rectangle. */
export interface Zoom2DSpec { nodes?: MNode[]; point?: [number, number]; rect?: Rect; zoom?: number; margin?: number }
export const IDENTITY_2D: Pose2D = Object.freeze({ center: [0, 0] as [number, number], zoom: 1 }) as Pose2D
/** Where a node's coordinates live: 3D world, the 2D frame the 2D camera looks at, or the screen itself (m.hud()). */
export type CoordSpace = '3d' | '2d' | 'hud'
export function spaceOf(node: MNode): CoordSpace {
  if (node.space === '3d') return '3d'
  for (let n: MNode | null = node; n; n = n.parent) if (n.isHud) return 'hud'
  return '2d'
}
/** colour of anything whose constructor call had a problem */
export const INVALID_COLOR = '#FF3B30'
/** material option (preset name or object) + colour option → concrete numbers */
export function materialOf(r: Resolved): MaterialSpec {
  const m = r.material
  const base = typeof m === 'string' ? MATERIALS[m] ?? MATERIALS.matte! : { ...MATERIALS.matte!, ...(typeof m === 'object' && m ? m : {}) }
  return { ...base, color: r.color ?? base.color, shell: base.shell || !!r.shell }
}

/** Built-in channels every node has, with their rest values. */
export const CHANNELS: Record<string, unknown> = Object.assign(Object.create(null) as Record<string, unknown>, { present: 1, revealMode: 'fade', dim: 0, scale: 1, enterScale: 1, shift: [0, 0, 0], offset: [0, 0, 0], z: 0, opacity: 1 })
/** The 2D camera magnifies between these limits (st.zoom reports a value outside them; a fitted target is clamped). */
export const ZOOM_MIN = 0.25, ZOOM_MAX = 8
const NUMERIC = new Set<unknown>(['number', 'positive', 'nonneg', 'unit', 'int'])
const STD_ANCHORS: Record<string, Vec3> = {
  center: [0, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0], front: [0, 0, 1], back: [0, 0, -1],
  ul: [-1, 1, 0], ur: [1, 1, 0], dl: [-1, -1, 0], dr: [1, -1, 0],
}
export const ANCHOR_NAMES = Object.keys(STD_ANCHORS)
const OPPOSITE: Record<string, string> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left', front: 'back', back: 'front', center: 'center', ul: 'dr', dr: 'ul', ur: 'dl', dl: 'ur' }
export const oppositeAnchor = (name: string): string => OPPOSITE[name] ?? 'center'

export interface Reveal { /** 0 = not there, 1 = fully there */ p: number; /** how the node enters / leaves: 'fade' | 'create' | 'write' | … */ mode: string }
export interface Projection { /** frame units */ x: number; y: number; /** distance in front of the camera (3D), 0 for 2D */ depth: number; visible: boolean }

interface CameraCache { revision: number; base: Pose | null; resolved: Map<Clip, Pose> }

export class Frame {
  /** 0-based step index (−1 when the scene has no steps) */
  readonly k: number
  readonly step: StepRec | null
  /** seconds into the step */
  readonly u: number
  /** simulation time s.t() */
  readonly t: number
  private vals = new Map<number, Record<string, unknown>>()
  private resolved = new Map<number, Resolved>()
  private worlds = new Map<number, TRS>()
  private memos = new Map<unknown, unknown>()
  private busy = new Set<unknown>()
  private pose: Pose | null = null
  private basis: Basis | null = null
  private pose2: Pose2D | null = null
  private pose2Busy = false
  /** scratch frames of this one (same time, params and view), made on demand: see rest() and camera2d() */
  private atRest: Frame | null = null
  private unzoomed: Frame | null = null
  /** set on an `unzoomed` scratch frame when something in it asked for the 2D camera */
  private askedCamera2d = false

  /**
   * `mode` makes a scratch frame: 'rest' = every `offset` channel is zero (where things are when nothing is exploded),
   * 'unzoomed' = the 2D camera is the identity (where things are before st.zoom). Their memos are their own, so
   * asking them never changes what this frame answers.
   */
  constructor(readonly model: SceneModel, readonly tau: number, readonly overrides: Record<string, ParamValue> = {}, readonly view: ViewOverride | null = null, private readonly mode: 'rest' | 'unzoomed' | null = null) {
    const { k, u } = model.locate(tau)
    this.k = k
    this.u = u
    this.step = k >= 0 ? model.steps[k]! : null
    this.t = model.simTime(tau)
  }

  // ── evaluation ───────────────────────────────────────────────────────────────────────────────────
  /** Run code with this frame as the one params / s.t() / part.world() read from. */
  run<T>(fn: () => T): T {
    const prev = ctx.frame
    ctx.frame = this
    try { return fn() } finally { ctx.frame = prev }
  }
  /** Evaluate a value-or-function in this frame. A throwing function is reported once (RUNTIME-ERROR) and yields `fallback`. */
  value<T>(d: unknown, fallback?: T, owner?: MNode | null, what = 'a dynamic value', args?: readonly unknown[]): T {
    if (typeof d !== 'function') return d as T
    const prev = ctx.frame
    ctx.frame = this
    try {
      return args ? (d as (...a: unknown[]) => T)(...args) : (d as () => T)()
    } catch (e) {
      this.model.reportError(e, `${what}${owner ? ` of #${owner.id}` : ''}`, { ids: owner ? [owner.id] : [], t: this.tau, frame: this })
      return fallback as T
    } finally { ctx.frame = prev }
  }
  /** Per-frame memo with cycle detection: memo(key, compute, valueWhenCyclic). */
  memo<T>(key: unknown, compute: () => T, onCycle?: T): T {
    if (this.memos.has(key)) return this.memos.get(key) as T
    if (this.busy.has(key)) return onCycle as T
    this.busy.add(key)
    try {
      const v = compute()
      this.memos.set(key, v)
      return v
    } finally { this.busy.delete(key) }
  }

  // ── params ───────────────────────────────────────────────────────────────────────────────────────
  param(def: ParamDef): ParamValue {
    if (Object.hasOwn(this.overrides, def.name)) return this.overrides[def.name]!
    return this.memo(def, () => {
      const clips = this.model.clipsFor(def, 'value')
      let v: unknown = def.value
      if (clips) v = this.fold(null, 'value', v, clips, def.kind === 'number' ? 'number' : 'any')
      return v as ParamValue
    }, def.value)
  }
  /** Values of every s.probe(), by name. Non-numeric results are reported as NaN. */
  probes(): Record<string, number> {
    const out = Object.create(null) as Record<string, number> // a probe may be called "constructor"
    for (const [name, fn] of this.model.probes) {
      const v = this.value<unknown>(fn, NaN, null, `probe "${name}"`)
      out[name] = typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : NaN
    }
    return out
  }

  // ── channels ─────────────────────────────────────────────────────────────────────────────────────
  private specOf(kind: KindDef | undefined, name: string): PropSpec | undefined {
    const s = kind && Object.hasOwn(kind.schema, name) ? kind.schema[name] : undefined
    return s === undefined ? undefined : spec(s)
  }
  /** `clip`: the value comes from a clip, whose functions are called with (node, frame). `sp` = the option's spec (a bare type is accepted). */
  private typed(raw: unknown, sp: PropSpec | PropType | undefined, node: MNode | null, name: string, clip = false): unknown {
    const ps = sp === undefined ? undefined : spec(sp)
    const type = ps?.type
    if (type === 'fn' || name === 'placement') return raw
    let v = typeof raw === 'function' && !(type === 'point' && isAnchorRef(raw)) ? this.value(raw, undefined, node, name, clip ? [node, this] : undefined) : raw
    if (v === null && ps?.nullable) return null // "no value" is a value for an option declared nullable
    if (type === 'point') return tagSpace(this.point(v, node), node ? spaceOf(node) : '2d')
    if (type !== undefined && typeof type === 'object' && v !== null && v !== undefined) {
      const arr = arrayOf(type), rec = recordOf(type), ob = objectOf(type)
      if (arr && Array.isArray(v)) return v.map((x, i) => this.typed(x, spec(arr.array), node, `${name}[${i}]`, clip))
      if (rec && typeof v === 'object') return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, this.typed(x, spec(rec.record), node, `${name}.${k}`, clip)]))
      if (ob && typeof v === 'object') return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, this.typed(x, ob.object[k] === undefined ? undefined : spec(ob.object[k]!), node, `${name}.${k}`, clip)]))
      return v
    }
    if (type === 'text') return v === undefined || v === null ? '' : String(v)
    if (typeof v === 'number' && !Number.isFinite(v)) v = this.invalid(node, name, v)
    else if (NUMERIC.has(type) && typeof v !== 'number') v = this.invalid(node, name, v)
    else if (type === 'positive' && (v as number) <= 0) v = this.invalid(node, name, v)
    return v
  }
  private invalid(node: MNode | null, name: string, got: unknown): unknown {
    const kind = node ? kindOf(node.kind) : undefined
    const fb = kind?.defaults?.[name] ?? CHANNELS[name] ?? 0
    const when = this.paramClause()
    this.model.diagnostics.add({
      code: 'NUM-INVALID', ids: node ? [node.id] : [], step: this.k >= 0 ? this.k + 1 : null, stepTitle: this.step?.title ?? null, t: round(this.tau, 3),
      measured: String(got), what: `${name}${node ? ` of #${node.id}` : ''} became ${describeBad(got)}${when ? ` ${when}` : ''}.`,
      fix: [`make the function passed for ${name} return a finite${kind && spec(kind.schema[name] ?? 'number').type === 'positive' ? ' positive' : ''} number for every param value and time`, ...this.reproHint()],
      ...(when ? { params: { ...this.overrides } } : {}),
    }, node ? node.src : null)
    return typeof fb === 'function' ? 0 : fb
  }
  /** "when p = 10 (its maximum)": the param values this frame was pinned to (a slider position, a check sample), or ''. */
  paramClause(): string {
    const parts: string[] = []
    for (const [name, v] of Object.entries(this.overrides)) {
      const def = this.model.params.find((p) => p.name === name)
      const edge = def?.kind === 'number' ? (v === def.max ? ' (its maximum)' : v === def.min ? ' (its minimum)' : '') : ''
      parts.push(`${name} = ${String(v)}${edge}`)
    }
    return parts.length ? `when ${parts.join(' and ')}` : ''
  }
  /** The command that shows this state, for diagnostics found with params pinned (the default picture does not show them). */
  reproHint(): string[] {
    const sets = Object.entries(this.overrides).map(([name, v]) => `--set ${name}=${String(v)}`)
    return sets.length ? [`see it: mimir shot <scene> ${this.k >= 0 ? `--step ${this.k + 1}` : `--at ${round(this.tau, 3)}`} ${sets.join(' ')}`] : []
  }
  /** Fold clips over a base value (DESIGN §3.3). */
  fold(node: MNode | null, name: string, base: unknown, clips: readonly Clip[], type?: PropSpec | PropType): unknown {
    let v = base
    const tau = this.tau
    for (const c of clips) {
      if (tau < c.t0) break
      if (isSelector(c.target) && (!node || !c.target.test(node))) continue
      const d = c.t1 - c.t0
      let w = d > 0 ? c.rate(clamp01((tau - c.t0) / d)) : 1
      if (c.scope === 'step') w *= this.release(c.step)
      if (w === 0 && c.from === undefined) continue
      const to = this.typed(c.to, type, node, name, true)
      const from = c.from !== undefined ? this.typed(c.from, type, node, name, true) : v
      v = w === 1 ? to : this.interp(name, type, from, to, w, node)
    }
    return v
  }
  /** 1 while step `index` is current, easing to 0 over the start of the next step; 1 forever for the last step. */
  release(index: number): number {
    const s = this.model.steps[index]
    if (!s || this.tau <= s.t1) return 1
    const rel = this.model.releaseAfter(index)
    if (rel <= 0) return index === this.model.steps.length - 1 ? 1 : 0
    return 1 - smooth(clamp01((this.tau - s.t1) / rel))
  }
  private interp(name: string, sp: PropSpec | PropType | undefined, a: unknown, b: unknown, u: number, node: MNode | null): unknown {
    const type = sp === undefined ? undefined : spec(sp).type
    const custom = interpFor(node?.kind, name)
    if (custom) return custom(a, b, u, this, node)
    if (name === 'placement') return { type: 'blend', from: a, to: b, u }
    if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * u
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x) => typeof x === 'number') && b.every((x) => typeof x === 'number')) return a.map((x, i) => x + ((b[i] as number) - x) * u)
    if (type === 'color' || (typeof a === 'string' && typeof b === 'string' && isColor(a) && isColor(b))) {
      const ca = parseColor(a), cb = parseColor(b)
      if (ca && cb) return mix(a as string, b as string, clamp01(u))
      if (cb && !ca) return toHex([cb[0], cb[1], cb[2], cb[3] * clamp01(u)], true)
      if (ca && !cb) return toHex([ca[0], ca[1], ca[2], ca[3] * (1 - clamp01(u))], true)
    }
    return u >= 0.5 ? b : a
  }
  private mergedClips(node: MNode, name: string): readonly Clip[] | undefined {
    const own = this.model.clipsFor(node, name)
    const sel = this.model.selectorClipsFor(name)
    if (!sel) return own
    if (!own) return sel
    return [...own, ...sel].sort((a, b) => a.t0 - b.t0 || a.seq - b.seq)
  }
  /** Resolved value of one channel of a node: base value (or function), then the clips recorded on it. */
  prop<T = any>(node: MNode, name: string): T {
    let rec = this.vals.get(node.uid)
    if (!rec) this.vals.set(node.uid, (rec = Object.create(null) as Record<string, unknown>))
    if (name in rec) return rec[name] as T
    if (name === 'offset' && this.mode === 'rest') return (rec[name] = [0, 0, 0]) as T
    const key = node.uid + ':' + name
    if (this.busy.has(key)) return (kindOf(node.kind)?.defaults?.[name] ?? CHANNELS[name]) as T
    this.busy.add(key)
    try {
      const kind = kindOf(node.kind)
      const type = this.specOf(kind, name)
      let raw: unknown = name === 'placement' ? node.placement : node.props[name]
      if (raw === undefined) raw = kind?.defaults?.[name] ?? (name === 'rotate' ? (node.space === '3d' ? [] : 0) : CHANNELS[name] ?? lookRest(name))
      let v = this.typed(raw, type, node, name)
      const clips = this.mergedClips(node, name)
      if (clips) v = this.fold(node, name, v, clips, type)
      rec[name] = v
      return v as T
    } finally { this.busy.delete(key) }
  }
  /** All schema options of a node, resolved for this frame. */
  props(node: MNode): Resolved {
    let r = this.resolved.get(node.uid)
    if (r) return r
    r = {}
    this.resolved.set(node.uid, r)
    const kind = kindOf(node.kind)
    this.resolving.add(node.uid)
    try { if (kind) for (const name of Object.keys(kind.schema)) if (name !== 'id') r[name] = this.prop(node, name) } finally { this.resolving.delete(node.uid) }
    return r
  }
  /** nodes whose options are being worked out right now, and how often the 3D camera was asked for: see subject() */
  private readonly resolving = new Set<number>()
  private cameraAsks = 0

  // ── points ───────────────────────────────────────────────────────────────────────────────────────
  /**
   * Anything that denotes a point → coordinates: [x, y(, z)], a node (its centre), an anchor, a function.
   * With `owner` the result is in the owner's space: a 2D object that refers to a 3D part gets the point where that
   * part is drawn (its projection), a hud object gets screen coordinates, and so on. Plain coordinates are taken
   * as already being in the owner's space.
   */
  point(v: unknown, owner?: MNode | null, depth = 0): Vec3 {
    if (isNode(v)) return this.into(owner, v, this.anchor(v, 'center'))
    if (isAnchorRef(v)) return this.into(owner, v.node, this.anchor(v.node, v.anchor, v.src))
    if (typeof v === 'function' && depth < 4) return this.point(this.value(v, [0, 0, 0], null, 'a point'), owner, depth + 1)
    const p = toVec3(v)
    if (p && finite3(p)) return p
    if (typeof v === 'string') { const n = this.model.byId.get(v); if (n) return this.into(owner, n, this.anchor(n, 'center')) }
    return [0, 0, 0]
  }
  /** A point of `from`'s space expressed in `owner`'s space (3D → where it is drawn; 2D ↔ hud through the 2D camera). */
  into(owner: MNode | null | undefined, from: MNode, p: Vec3): Vec3 {
    if (!owner) return p
    const a = spaceOf(owner), b = spaceOf(from)
    if (a === b) return p
    if (a === '3d') {
      this.model.diagnostics.add({ code: 'API-TYPE', ids: [owner.id, from.id], step: null, t: null, what: `#${owner.id} is a 3D part placed relative to #${from.id}, a 2D object; a 3D part cannot follow something flat.`, fix: [`turn it round: pin the 2D object to the part with ${from.id}.pin(${owner.id})`, `or give #${owner.id} 3D coordinates: .at(x, y, z)`] }, owner.src)
      return p
    }
    const screen: Vec3 = b === '3d' ? (() => { const q = this.project3(p); return [q.x, q.y, 0] as Vec3 })() : b === '2d' ? this.toScreen(p) : p
    return a === 'hud' ? screen : this.fromScreen(screen)
  }
  /** The box of `target` in `owner`'s space (for nextTo and line ends): its bounds, or the rectangle it covers on screen when the spaces differ. */
  boxIn(owner: MNode, target: MNode): Box3 {
    const a = spaceOf(owner), b = spaceOf(target)
    if (a === b || a === '3d') return this.bounds(target)
    const r = this.frameRect(target)
    if (!r) { const c = this.into(owner, target, this.anchor(target, 'center')); return { min: [...c] as Vec3, max: [...c] as Vec3 } }
    const lo: Vec3 = [r.x, r.y, 0], hi: Vec3 = [r.x + r.width, r.y + r.height, 0]
    return a === 'hud' ? { min: lo, max: hi } : { min: this.fromScreen(lo), max: this.fromScreen(hi) }
  }

  // ── transforms ───────────────────────────────────────────────────────────────────────────────────
  /** Own rotation of a node (before its parent's): 2D degrees about z, 3D a list of { about, deg }. */
  ownRotation(node: MNode): Quat {
    const r = this.prop<unknown>(node, 'rotate')
    if (typeof r === 'number') return r === 0 ? QID : qz(r)
    if (!Array.isArray(r)) return QID
    let q: Quat = QID
    for (const e of r as { about: unknown; deg: unknown }[]) {
      const deg = this.value<number>(e.deg, 0, node, 'rotate.deg')
      if (typeof deg !== 'number' || !Number.isFinite(deg)) { this.invalid(node, 'rotate.deg', deg); continue }
      const axis: Vec3 = e.about === 'x' ? [1, 0, 0] : e.about === 'y' ? [0, 1, 0] : e.about === 'z' ? [0, 0, 1] : toVec3(e.about) ?? [0, 0, 1]
      q = qmul(qAxisDeg(axis, deg), q) // later rotations are applied on top, about the parent's axes
    }
    return q
  }
  ownScale(node: MNode): number {
    let own = this.prop<number>(node, 'scale')
    // a size of nothing (a function that returns 0) or a mirrored one is a mistake, not a way to hide an object
    if (!(own > 0) || !Number.isFinite(own)) own = this.invalid(node, 'scale', own) as number
    const s = own * this.prop<number>(node, 'enterScale')
    return Number.isFinite(s) ? s : 1
  }
  private resolvePlacement(node: MNode, pl: Placement | null, own: { q: Quat; s: number; parentQ: Quat; parentS: number }): Placed {
    if (!pl) return { p: [0, 0, 0] }
    if (pl.type === 'blend') {
      const a = this.resolvePlacement(node, pl.from as Placement | null, own)
      const b = this.resolvePlacement(node, pl.to as Placement | null, own)
      const u = pl.u as number
      const world = !!(a.world || b.world)
      const pw = node.parent ? this.world(node.parent) : TID
      const toWorld = (x: Placed): Vec3 => (world && !x.world ? apply(pw, x.p) : x.p)
      const out: Placed = { p: lerp3(toWorld(a), toWorld(b), u), world }
      if (a.q || b.q) out.q = qslerp(a.q ?? qmul(own.parentQ, own.q), b.q ?? qmul(own.parentQ, own.q), clamp01(u))
      return out
    }
    const resolver = placementResolver(pl.type)
    if (!resolver) return { p: [0, 0, 0] }
    const out = resolver(node, pl, this, own)
    return finite3(out.p) ? out : { ...out, p: (this.invalid(node, 'position', out.p), [0, 0, 0]) }
  }
  /** World transform of a node (lazy, memoised; a cycle is reported as PLACE-CONFLICT and resolves to identity). */
  world(node: MNode): TRS {
    const hit = this.worlds.get(node.uid)
    if (hit) return hit
    if (this.busy.has(node)) {
      this.model.diagnostics.add({ code: 'PLACE-CONFLICT', ids: [node.id], what: `the placement of #${node.id} depends on itself (a cycle of attach / nextTo / at).`, fix: ['break the cycle: place one of the objects with .at(x, y) or relative to something outside the loop', 'a function that sets offset or shift reads where the object rests with frame.rest(node), not frame.world(node)'] }, node.src)
      return TID
    }
    this.busy.add(node)
    try {
      const kind = kindOf(node.kind)
      const parent = node.parent ? this.world(node.parent) : TID
      let out: TRS
      const shift = add(toVec3(this.prop(node, 'shift')) ?? [0, 0, 0], toVec3(this.prop(node, 'offset')) ?? [0, 0, 0])
      if (kind?.worldGeometry) out = { p: shift, q: QID, s: 1 }
      else {
        const own = { q: this.ownRotation(node), s: this.ownScale(node), parentQ: parent.q, parentS: parent.s }
        const pl = this.resolvePlacement(node, this.prop<Placement | null>(node, 'placement'), own)
        if (pl.world) out = { p: add(pl.p, shift), q: pl.q ?? qmul(parent.q, own.q), s: parent.s * own.s }
        else {
          out = compose(parent, { p: add(pl.p, shift), q: own.q, s: own.s })
          if (pl.q) out.q = pl.q
        }
      }
      if (!finiteTRS(out)) { this.invalid(node, 'transform', NaN); out = TID }
      this.worlds.set(node.uid, out)
      return out
    } finally { this.busy.delete(node) }
  }

  /**
   * World transform of a node when nothing is pushed apart: as world(), with every `offset` channel taken as zero.
   * This is what an explode reads to decide where a part goes: `(node, frame) => scale(frame.rest(node).p, 0.4)` as
   * the target of a clip on `offset` does not ask for the offset it is computing.
   */
  rest(node: MNode): TRS {
    if (this.mode === 'rest') return this.world(node)
    return (this.atRest ??= new Frame(this.model, this.tau, this.overrides, this.view, 'rest')).world(node)
  }
  /** Stacking order of a 2D node: its own `z` plus its ancestors' (raising a composite raises its parts). */
  z(node: MNode): number {
    return this.memo('z' + node.uid, () => {
      const own = this.prop<number>(node, 'z')
      return (Number.isFinite(own) ? own : 0) + (node.parent ? this.z(node.parent) : 0)
    }, 0)
  }

  // ── bounds and anchors ───────────────────────────────────────────────────────────────────────────
  /** Local box of a node (kind maths; containers: union of the children that are placed inside them). */
  localBounds(node: MNode): Box3 {
    return this.memo('lb' + node.uid, () => {
      const kind = kindOf(node.kind)
      if (kind?.bounds) {
        const b = kind.bounds(node, this.props(node), this)
        if (finite3(b.min) && finite3(b.max)) return b
        this.invalid(node, 'size', NaN)
        return boxOf(0, 0, 0)
      }
      const out = emptyBox()
      for (const c of node.children) {
        // a line or an arrow is drawn between points of the frame: its box is not in this node's own coordinates
        if (kindOf(c.kind)?.worldGeometry) continue
        const cb = this.localBounds(c)
        if (isEmptyBox(cb)) continue
        const own = { q: this.ownRotation(c), s: this.ownScale(c), parentQ: QID, parentS: 1 }
        const pl = this.resolvePlacement(c, this.prop<Placement | null>(c, 'placement'), own)
        if (pl.world) continue
        union(out, transformBox(cb, { p: add(pl.p, toVec3(this.prop(c, 'shift')) ?? [0, 0, 0]), q: own.q, s: own.s }))
      }
      return isEmptyBox(out) ? boxOf(0, 0, 0) : out
    }, boxOf(0, 0, 0))
  }
  /** World axis-aligned box of a node (containers: union of all children). */
  bounds(node: MNode): Box3 {
    return this.memo('wb' + node.uid, () => {
      const kind = kindOf(node.kind)
      if (kind?.bounds || !node.children.length) return transformBox(this.localBounds(node), this.world(node))
      const out = emptyBox()
      for (const c of node.children) union(out, this.bounds(c))
      return isEmptyBox(out) ? transformBox(boxOf(0, 0, 0), this.world(node)) : out
    }, boxOf(0, 0, 0))
  }
  /** World points that approximate the silhouette of a node (kind hull, else the corners of its box). */
  hull(node: MNode): Vec3[] {
    const kind = kindOf(node.kind)
    if (!kind?.bounds && node.children.length) return node.children.flatMap((c) => this.hull(c))
    const w = this.world(node)
    const local = kind?.hull ? kind.hull(node, this.props(node), this) : boxCorners(this.localBounds(node))
    return local.map((p) => apply(w, p))
  }
  /** Names of the anchors a node has in this frame. */
  anchorNames(node: MNode): string[] {
    const kind = kindOf(node.kind)
    const extra = kind?.anchors ? Object.keys(kind.anchors(node, this.props(node), this)) : []
    return [...new Set([...Object.keys(node.anchors), ...extra, ...ANCHOR_NAMES, ...(node.space === '2d' ? ['start', 'end'] : [])])]
  }
  /** Local position of a named anchor, or null when the node has no such anchor. */
  anchorLocal(node: MNode, name: string): Vec3 | null {
    const user = node.anchors[name]
    if (user !== undefined) return toVec3(this.value(user, [0, 0, 0], node, `anchor "${name}"`)) ?? [0, 0, 0]
    const kind = kindOf(node.kind)
    const own = kind?.anchors?.(node, this.props(node), this)[name]
    if (own) return own
    if (name === 'start' || name === 'end') {
      // the ends of an open outline; a closed shape (or one without an outline) starts on its left and ends on its right
      const path = kind?.outline && !kind.worldGeometry ? kind.outline(node, this.props(node), this) : null
      const open = path && path.length === 1 && !path[0]!.closed && path[0]!.coords.length >= 2 ? path[0]!.coords : null
      if (open) return name === 'start' ? [open[0]!, open[1]!, 0] : [open[open.length - 2]!, open[open.length - 1]!, 0]
      name = name === 'start' ? 'left' : 'right'
    }
    const dir = STD_ANCHORS[name]
    if (!dir) return null
    const b = this.localBounds(node)
    const c = boxCenter(b)
    return [dir[0] > 0 ? b.max[0] : dir[0] < 0 ? b.min[0] : c[0], dir[1] > 0 ? b.max[1] : dir[1] < 0 ? b.min[1] : c[1], dir[2] > 0 ? b.max[2] : dir[2] < 0 ? b.min[2] : c[2]]
  }
  /** World position of a named anchor ('center' when omitted). Unknown names are reported once and give the centre. */
  anchor(node: MNode, name = 'center', src?: Src): Vec3 {
    const kind = kindOf(node.kind)
    if (!kind?.bounds && !kind?.worldGeometry && node.children.length && STD_ANCHORS[name] && node.anchors[name] === undefined) {
      // containers: anchors of the union of the children, in world axes
      const b = this.bounds(node)
      const dir = STD_ANCHORS[name]!
      const c = boxCenter(b)
      return [dir[0] > 0 ? b.max[0] : dir[0] < 0 ? b.min[0] : c[0], dir[1] > 0 ? b.max[1] : dir[1] < 0 ? b.min[1] : c[1], dir[2] > 0 ? b.max[2] : dir[2] < 0 ? b.min[2] : c[2]]
    }
    let local = this.anchorLocal(node, name)
    if (!local) {
      const names = this.anchorNames(node)
      const near = closest(name, names)
      this.model.diagnostics.add({ code: 'API-UNKNOWN', ids: [node.id], step: null, t: null, what: `#${node.id} (${node.kind}) has no anchor "${name}".`, fix: [`${near ? `use "${near}". ` : ''}Anchors: ${names.join(', ')}.`] }, src ?? node.src)
      local = this.anchorLocal(node, 'center') ?? [0, 0, 0]
    }
    return apply(this.world(node), local)
  }
  /** Outward direction (world) of an anchor: the axis for the standard names, away from the centre otherwise. */
  anchorOut(node: MNode, name: string): Vec3 {
    const std = STD_ANCHORS[name]
    const w = this.world(node)
    if (std && node.anchors[name] === undefined) return norm(qrot(w.q, std))
    const local = this.anchorLocal(node, name)
    const c = this.anchorLocal(node, 'center') ?? [0, 0, 0]
    return local ? norm(qrot(w.q, sub(local, c))) : [0, 0, 0]
  }

  // ── visibility ───────────────────────────────────────────────────────────────────────────────────
  /** Enter / exit progress of a node including its ancestors. */
  reveal(node: MNode): Reveal {
    return this.memo('rv' + node.uid, () => {
      const p = clamp01(this.prop<number>(node, 'present'))
      const own: Reveal = { p, mode: this.prop<string>(node, 'revealMode') }
      if (!node.parent) return own
      const up = this.reveal(node.parent)
      if (up.p >= 1) return own
      return own.p >= 1 ? up : { p: up.p * own.p, mode: own.mode }
    }, { p: 1, mode: 'fade' })
  }
  /** Opacity of a node times its ancestors' (not counting reveal or dim). */
  opacity(node: MNode): number {
    return this.memo('op' + node.uid, () => {
      const o = clamp01(this.prop<number>(node, 'opacity'))
      return node.parent ? o * this.opacity(node.parent) : o
    }, 1)
  }
  /** 0..1: how strongly a node is pushed back by st.focus on something else. */
  dim(node: MNode): number { return clamp01(this.prop<number>(node, 'dim')) }
  visible(node: MNode): boolean { return this.reveal(node).p > 0 && this.opacity(node) > 0 }
  /** Leaf nodes (those that draw something) that are visible in this frame. */
  visibleLeaves(space?: '2d' | '3d'): MNode[] {
    return this.model.nodes.filter((n) => (!space || n.space === space) && !kindOf(n.kind)?.container && this.visible(n))
  }

  // ── actions ──────────────────────────────────────────────────────────────────────────────────────
  /** Actions (st.label, st.say, marks …) in force at this time, with their fade envelope. */
  actions<D = any>(type?: string): ActiveAction<D>[] {
    const all = this.memo('actions', () => {
      const out: ActiveAction[] = []
      for (const a of this.model.actions) {
        if (this.tau < a.t0) continue
        const d = a.t1 - a.t0
        let env = d > 0 ? smooth(clamp01((this.tau - a.t0) / d)) : 1
        if (a.scope === 'step') env *= this.release(a.step)
        if (env <= 0) continue
        out.push({ action: a, data: a.data, env, age: this.tau - a.t0 })
      }
      return out
    }, [])
    return (type ? all.filter((x) => x.action.type === type) : all) as ActiveAction<D>[]
  }

  // ── camera ───────────────────────────────────────────────────────────────────────────────────────
  private camCache(): CameraCache {
    const c = this.model.store<CameraCache>('core.camera', () => ({ revision: -1, base: null, resolved: new Map() }))
    if (c.revision !== this.model.revision) { c.revision = this.model.revision; c.base = null; c.resolved = new Map() }
    return c
  }
  /** width / height of the 3D panel */
  aspect(): number {
    const v = this.model.viewport
    return v ? v.width / v.height : FRAME_W / FRAME_H
  }
  /** World points of everything 3D that is visible in this frame (or of the given nodes). */
  subject(nodes?: readonly MNode[]): Vec3[] {
    const list = nodes ?? this.model.nodes.filter((n) => n.space === '3d' && !kindOf(n.kind)?.container && this.reveal(n).p > 0)
    // A part whose own place depends on the camera (a mark that stands on a plot beside the projected model) cannot also
    // steer the camera: it is left out of the fit, whoever asked first. Asked from inside that part's own options it
    // would be measured half-made (it was reported as "size became NaN" in the live page, never in a headless frame).
    return list.flatMap((n) => {
      if (this.resolving.has(n.uid)) return []
      const asked = this.cameraAsks
      const pts = this.hull(n)
      return this.cameraAsks !== asked ? [] : pts
    })
  }
  private basePose(): Pose {
    const c = this.camCache()
    if (c.base) return c.base
    const m = this.model
    const iso = this.homeView(), fov = this.model.config<number>('camera.fov')
    c.base = { target: [0, 0, 0], azimuth: iso.azimuth, elevation: iso.elevation, distance: 10, fov } // guards re-entry
    const pts: Vec3[] = []
    const times = new Set<number>([0])
    // the default view frames everything up to the first chapter that clears the stage (a chapter opening re-fits it)
    const cut = m.chapters.find((c) => c.firstStep >= 0 && m.steps[c.firstStep]!.t0 + c.clear > 0)
    for (const s of cut ? m.steps.slice(0, cut.firstStep) : m.steps) { times.add((s.t0 + s.t1) / 2); times.add(Math.max(s.t0, s.t1 - 1e-3)) }
    for (const t of times) pts.push(...(t === this.tau && !Object.keys(this.overrides).length ? this : new Frame(m, t)).subject())
    c.base = fitPose(pts, iso.azimuth, iso.elevation, fov, this.aspect(), this.model.config<number>('camera.fill'))
    return c.base
  }
  /** The direction the camera looks from when the story has not said: the named view of 'camera.view'. */
  private homeView(): { azimuth: number; elevation: number } { return VIEWS[this.model.config<string>('camera.view')] ?? VIEWS.iso! }
  /** Turn a camera spec into a full pose, starting from `prev`. Evaluated at story time `at` with default params. */
  resolveCamera(specIn: CameraSpec | string, prev: Pose, at: number): Pose {
    const sp: CameraSpec = typeof specIn === 'string' ? { view: specIn } : specIn ?? {}
    const f = at === this.tau && !Object.keys(this.overrides).length ? this : new Frame(this.model, at)
    const pose: Pose = { ...prev, target: [...prev.target] as Vec3 }
    if (sp.reset) {
      const iso = this.homeView(), fov = this.model.config<number>('camera.fov')
      const pts: Vec3[] = []
      for (const [a, b] of sp.reset) for (const t of [(a + b) / 2, Math.max(a, b - 1e-3)]) pts.push(...new Frame(this.model, t).subject())
      return pts.length ? fitPose(pts, iso.azimuth, iso.elevation, fov, this.aspect(), this.model.config<number>('camera.fill')) : { ...pose, azimuth: iso.azimuth, elevation: iso.elevation, fov }
    }
    const v = sp.view !== undefined ? VIEWS[sp.view] : undefined
    if (v) { pose.azimuth = v.azimuth; pose.elevation = v.elevation }
    if (typeof sp.azimuth === 'number') pose.azimuth = sp.azimuth
    if (typeof sp.elevation === 'number') pose.elevation = sp.elevation
    if (typeof sp.fov === 'number') pose.fov = sp.fov
    const fitNodes = sp.fit === true || sp.fit === undefined ? null : (Array.isArray(sp.fit) ? sp.fit : [sp.fit]).filter(isNode)
    if (sp.fit !== undefined || (v && sp.target === undefined && sp.distance === undefined)) {
      const pts = f.subject(fitNodes && fitNodes.length ? fitNodes : undefined)
      if (pts.length) { const fit = fitPose(pts, pose.azimuth, pose.elevation, pose.fov, this.aspect(), this.model.config<number>(fitNodes ? 'camera.fitFill' : 'camera.fill')); pose.target = fit.target; pose.distance = fit.distance }
    }
    if (sp.target !== undefined) pose.target = f.point(sp.target)
    if (typeof sp.distance === 'number') pose.distance = sp.distance
    if (typeof sp.zoom === 'number' && sp.zoom > 0) pose.distance = pose.distance / sp.zoom
    return poseOk(pose) ? pose : prev
  }
  /** Camera pose of the 3D panel: auto-fit iso, then the camera cues folded up to now; a view override wins. */
  camera(): Pose {
    this.cameraAsks++
    if (this.pose) return this.pose
    const c = this.camCache()
    let pose = this.basePose()
    let prevTarget = pose
    for (const clip of this.model.cameraClips()) {
      let target = c.resolved.get(clip)
      if (!target) { target = this.resolveCamera(clip.to as CameraSpec, prevTarget, clip.t1); c.resolved.set(clip, target) }
      prevTarget = target
      if (this.tau < clip.t0) continue
      const d = clip.t1 - clip.t0
      const w = d > 0 ? clip.rate(clamp01((this.tau - clip.t0) / d)) : 1
      pose = w >= 1 ? target : lerpPose(pose, target, w)
    }
    if (this.view !== null) pose = typeof this.view === 'string' ? this.resolveCamera({ view: this.view }, pose, this.tau) : { ...pose, ...this.view, target: (this.view.target as Vec3 | undefined) ?? pose.target }
    this.pose = poseOk(pose) ? pose : this.basePose()
    return this.pose
  }
  cameraBasis(): Basis { return (this.basis ??= basisOf(this.camera())) }

  // ── the 2D camera ────────────────────────────────────────────────────────────────────────────────
  private resolve2d(sp: Zoom2DSpec | null, src: Src): Pose2D {
    if (!sp) return IDENTITY_2D
    let center: [number, number] | null = sp.point ?? null
    let zoom = sp.zoom ?? (sp.point ? 2 : 1)
    let r: Rect | null = sp.rect ?? null
    if (sp.nodes?.length) {
      // Where the targets are is asked of a scratch frame whose 2D camera is the identity: the camera cannot depend
      // on itself, the answer does not depend on what was evaluated first, and this frame's memos are untouched.
      const flat = this.mode === 'unzoomed' ? this : (this.unzoomed ??= new Frame(this.model, this.tau, this.overrides, this.view, 'unzoomed'))
      const box = emptyBox()
      for (const n of sp.nodes) {
        if (spaceOf(n) !== '2d' || flat.reveal(n).p <= 0) continue
        flat.askedCamera2d = false
        const b = flat.bounds(n)
        if (flat.askedCamera2d) {
          // its position is a function of the 2D camera (it follows something on screen through a function): it cannot also steer the camera
          this.model.diagnostics.add({ code: 'API-TYPE', ids: [n.id], step: null, t: null, what: `st.zoom(): #${n.id} follows something on screen (a 3D part or a hud object), which the 2D camera does not move; it was left out of the zoom.`, fix: [`zoom on the 2D objects next to it instead, or move the 3D camera: st.camera({ fit: [part] })`] }, src)
          continue
        }
        union(box, b)
      }
      if (!isEmptyBox(box)) r = { x: box.min[0], y: box.min[1], width: box.max[0] - box.min[0], height: box.max[1] - box.min[1] }
      else if (!r && !center) return IDENTITY_2D
    }
    // the 2D camera looks through the part of the frame that the 3D panel leaves free (the whole frame without one)
    const win = this.model.area2d() ?? { x: -FRAME_W / 2, y: -FRAME_H / 2, width: FRAME_W, height: FRAME_H }
    if (r) {
      center = [r.x + r.width / 2, r.y + r.height / 2]
      const m = sp.margin ?? 1.3
      if (sp.zoom === undefined) zoom = Math.min(win.width / Math.max(r.width * m, 1e-6), win.height / Math.max(r.height * m, 1e-6))
    }
    if (!center || !Number.isFinite(center[0]) || !Number.isFinite(center[1]) || !(zoom > 0) || !Number.isFinite(zoom)) return IDENTITY_2D
    zoom = Math.min(Math.max(zoom, ZOOM_MIN), ZOOM_MAX)
    // the target lands in the middle of that window: screen = (p − center) × zoom
    return { center: [center[0] - (win.x + win.width / 2) / zoom, center[1] - (win.y + win.height / 2) / zoom], zoom }
  }
  /**
   * The 2D camera: centre + zoom, folded from the st.zoom() cues like the 3D pose. A target object is followed (it
   * is resolved in this frame). 2D objects are drawn at (p − center) × zoom; hud objects ignore it.
   */
  camera2d(): Pose2D {
    if (this.mode === 'unzoomed') { this.askedCamera2d = true; return IDENTITY_2D }
    if (this.pose2) return this.pose2
    if (this.pose2Busy) return IDENTITY_2D // never reached through resolve2d (it asks a scratch frame); kept as a guard
    this.pose2Busy = true
    try {
      let pose = IDENTITY_2D
      for (const clip of this.model.camera2dClips()) {
        if (this.tau < clip.t0) break
        const target = this.resolve2d(clip.to as Zoom2DSpec | null, clip.src)
        const d = clip.t1 - clip.t0
        const w = d > 0 ? clip.rate(clamp01((this.tau - clip.t0) / d)) : 1
        // a reset eases back from where the camera WAS when it began: what it was following may be leaving the stage meanwhile (a chapter opening), and must not take the camera with it
        if (clip.to === null && w < 1 && this.tau > clip.t0) pose = new Frame(this.model, clip.t0, this.overrides, this.view).camera2d()
        pose = w >= 1 ? target : { center: [pose.center[0] + (target.center[0] - pose.center[0]) * w, pose.center[1] + (target.center[1] - pose.center[1]) * w], zoom: Math.exp(Math.log(pose.zoom) + (Math.log(target.zoom) - Math.log(pose.zoom)) * w) }
      }
      return (this.pose2 = pose)
    } finally { this.pose2Busy = false }
  }
  /** True while the 2D camera shows anything but the whole frame. */
  zoomed(): boolean { const c = this.camera2d(); return c.zoom !== 1 || c.center[0] !== 0 || c.center[1] !== 0 }
  /** 2D point → where it is on screen, in frame units (the 2D camera applied). */
  toScreen(p: readonly number[]): Vec3 {
    const c = this.camera2d()
    return [((p[0] ?? 0) - c.center[0]) * c.zoom, ((p[1] ?? 0) - c.center[1]) * c.zoom, 0]
  }
  /** Screen position in frame units → the 2D point drawn there. */
  fromScreen(p: readonly number[]): Vec3 {
    const c = this.camera2d()
    return [(p[0] ?? 0) / c.zoom + c.center[0], (p[1] ?? 0) / c.zoom + c.center[1], 0]
  }

  // ── scene-level view channels and looks ──────────────────────────────────────────────────────────
  /** Value of a scene-level view channel (cutaway, ghost …): model.view[channel], then the clips recorded on VIEW. */
  viewValue<T = unknown>(channel: string, fallback?: T): T {
    const v = this.memo('view:' + channel, () => {
      let base: unknown = this.model.view[channel] ?? lookRest(channel)
      if (typeof base === 'function') base = this.value(base, undefined, null, `view channel "${channel}"`)
      const clips = this.model.clipsFor(VIEW, channel)
      // a view mode the viewer holds by hand: the amount between its rest value and its "on" value, whatever the story says
      const pin = this.model.viewPins.get(channel), control = pin === undefined ? undefined : lookControl(channel)
      if (pin !== undefined && control) return pin <= 0 ? lookRest(channel) : pin >= 1 ? control.on : this.interp(channel, undefined, lookRest(channel), control.on, pin, null)
      return clips ? this.fold(null, channel, base, clips, 'any') : base
    }, undefined as unknown)
    return (v === undefined ? fallback : v) as T
  }
  /**
   * The value of a view channel for one part. A part that has the channel set (as an option, or by a clip that has
   * started) decides for itself and for everything inside it, whatever the value, the "off" value included; until
   * then it has what its parent has, and a root has the scene-level value. A clip on a part starts from what the part
   * had inherited, so `st.clip(piston, 'ghost', 0)` under a scene-wide ghost fades the piston back in.
   */
  lookValue<T = unknown>(node: MNode, channel: string): T {
    return this.memo('lv' + node.uid + ':' + channel, () => {
      const inherited: unknown = node.parent ? this.lookValue(node.parent, channel) : this.viewValue(channel)
      const base = node.props[channel]
      const clips = this.mergedClips(node, channel)
      const first = clips?.find((c) => !isSelector(c.target) || c.target.test(node))
      if (base === undefined && (!first || this.tau < first.t0)) return inherited
      const start = base === undefined ? inherited : this.value(base, undefined, node, channel)
      return clips ? this.fold(node, channel, start, clips, 'any') : start
    }, undefined as unknown) as T
  }
  /**
   * How a 3D part looks in this frame: its material and colour, opacity (its own × ancestors × enter progress), focus
   * dimming, then every view mode registered with defineLook whose channel is on (for the scene, or for this part).
   */
  look(node: MNode): PartLook {
    return this.memo('look' + node.uid, () => {
      const m = materialOf(this.props(node))
      const look: PartLook = {
        color: node.invalid ? INVALID_COLOR : m.color, opacity: clamp01(m.opacity * this.opacity(node) * this.reveal(node).p),
        metalness: m.metalness, roughness: m.roughness, emissive: m.emissive, dim: this.dim(node), shell: !!m.shell, clip: [], edges: 1,
      }
      for (const [channel, fn, rest] of allLooks()) {
        const v = this.lookValue(node, channel)
        if (v === undefined || v === null || v === false || v === rest) continue
        try { fn(look, v, node, this) } catch (e) { this.model.reportError(e, `look "${channel}"`, { ids: [node.id], t: this.tau }) }
      }
      look.opacity = clamp01(look.opacity)
      return look
    }, { color: '#BBBBBB', opacity: 1, metalness: 0, roughness: 0.85, emissive: 0, dim: 0, shell: false, clip: [], edges: 1 })
  }

  // ── projection ───────────────────────────────────────────────────────────────────────────────────
  /** 3D world point → frame coordinates (inside the 3D panel). */
  project3(p: Vec3): Projection {
    const r = this.model.viewportRect() ?? { x: -FRAME_W / 2, y: -FRAME_H / 2, width: FRAME_W, height: FRAME_H }
    const q = projectWith(this.cameraBasis(), this.camera().fov, r.width / r.height, p)
    return { x: r.x + ((q.x + 1) / 2) * r.width, y: r.y + ((q.y + 1) / 2) * r.height, depth: q.depth, visible: q.depth > 0 && Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1 }
  }
  /**
   * Where something is on SCREEN, in frame units: a node (its centre), an anchor, or coordinates. Coordinates are
   * read in `space` when it is given; otherwise in the space a resolved option carries (r.a of a line), else
   * [x, y, z] is a 3D point and [x, y] a 2D one. 3D goes through the 3D camera, 2D through the 2D camera, hud is
   * already screen. `visible` is false behind the camera, outside the panel / frame, or when the node is hidden.
   */
  project(target: unknown, space?: CoordSpace): Projection {
    let node: MNode | null = null
    let p: Vec3
    let sp: CoordSpace
    if (isNode(target)) { node = target; p = this.anchor(target, 'center'); sp = spaceOf(target) }
    else if (isAnchorRef(target)) { node = target.node; p = this.anchor(target.node, target.anchor, target.src); sp = spaceOf(target.node) }
    else { sp = space ?? spaceTag(target) ?? (Array.isArray(target) && target.length === 3 ? '3d' : '2d'); p = this.point(target) }
    const shown = !node || this.visible(node)
    if (sp === '3d') { const q = this.project3(p); return { ...q, visible: q.visible && shown } }
    const q = sp === 'hud' ? p : this.toScreen(p)
    return { x: q[0], y: q[1], depth: 0, visible: shown && Math.abs(q[0]) <= FRAME_W / 2 && Math.abs(q[1]) <= FRAME_H / 2 }
  }
  /** Rectangle a node covers on SCREEN, in frame units, from pure maths (2D: its box through the 2D camera; 3D: the projected hull). */
  frameRect(node: MNode): Rect | null {
    if (node.space === '2d') {
      const b = this.bounds(node)
      if (isEmptyBox(b)) return null
      if (spaceOf(node) === 'hud') return { x: b.min[0], y: b.min[1], width: b.max[0] - b.min[0], height: b.max[1] - b.min[1] }
      const lo = this.toScreen(b.min), hi = this.toScreen(b.max)
      return { x: lo[0], y: lo[1], width: hi[0] - lo[0], height: hi[1] - lo[1] }
    }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const p of this.hull(node)) {
      const q = this.project3(p)
      if (q.depth <= 0) continue
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y)
    }
    return Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null
  }

  /**
   * Text a node draws, as rectangles on SCREEN in frame units (x, y = min corner, y up): the node's own box for a
   * text kind, the kind's textRects otherwise. Pure maths; check measures text nodes in the DOM instead when it can.
   */
  textRects(node: MNode): { text: string; rect: Rect }[] {
    const kind = kindOf(node.kind)
    if (!kind) return []
    if (kind.text && !kind.textRects) { const r = this.frameRect(node); return r ? [{ text: String(this.prop(node, 'text') ?? ''), rect: r }] : [] }
    if (!kind.textRects) return []
    const w = this.world(node)
    const sp = spaceOf(node)
    return kind.textRects(node, this.props(node), this).map(({ text, rect }) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const c of [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]] as const) {
        const p = apply(w, [c[0], c[1], 0])
        const q = sp === '3d' ? this.project3(p) : sp === 'hud' ? { x: p[0], y: p[1] } : (() => { const t = this.toScreen(p); return { x: t[0], y: t[1] } })()
        x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y)
      }
      return { text, rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } }
    })
  }
  /**
   * 2D outline of a node in the path format of src/lib/path, in the 2D coordinates the node lives in: the kind's
   * outline hook moved by the node's transform, or the rectangle of its bounds. Edge exit points, pointAt and morph
   * plans are derived from this one answer.
   */
  outline(node: MNode): Subpath[] {
    return this.memo('ol' + node.uid, () => {
      const kind = kindOf(node.kind)
      const w = this.world(node)
      if (kind?.outline) {
        const local = kind.outline(node, this.props(node), this)
        const deg = qzDeg(w.q), cos = Math.cos(deg * DEG) * w.s, sin = Math.sin(deg * DEG) * w.s
        return local.map((sp) => {
          const out = new Array<number>(sp.coords.length)
          for (let i = 0; i + 1 < sp.coords.length; i += 2) { const x = sp.coords[i]!, y = sp.coords[i + 1]!; out[i] = w.p[0] + x * cos - y * sin; out[i + 1] = w.p[1] + x * sin + y * cos }
          return { coords: out, closed: sp.closed }
        })
      }
      const b = this.bounds(node)
      if (isEmptyBox(b)) return []
      const pts: [number, number][] = [[b.min[0], b.min[1]], [b.max[0], b.min[1]], [b.max[0], b.max[1]], [b.min[0], b.max[1]], [b.min[0], b.min[1]]]
      const coords: number[] = [pts[0]![0], pts[0]![1]]
      for (let i = 1; i < pts.length; i++) { const a = pts[i - 1]!, c = pts[i]!; coords.push(a[0] + (c[0] - a[0]) / 3, a[1] + (c[1] - a[1]) / 3, a[0] + ((c[0] - a[0]) * 2) / 3, a[1] + ((c[1] - a[1]) * 2) / 3, c[0], c[1]) }
      return [{ coords, closed: true }]
    }, [])
  }

  // ── signature ────────────────────────────────────────────────────────────────────────────────────
  /** Hash of everything visible in this state. Equal signatures = nothing the viewer can see differs. */
  signature(opts: { excludeActions?: string[]; camera?: boolean; /** decimals kept (default 6): 2 = "the same to the eye" */ digits?: number } = {}): string {
    const parts: string[] = []
    const st = (v: unknown): string => stable(v, 0, opts.digits ?? 6)
    for (const n of this.model.nodes) {
      const rv = this.reveal(n)
      // what cannot be seen is all the same: not entered yet, faded out, or fully transparent
      if (rv.p <= 0 || this.opacity(n) <= 0) { parts.push(n.id + ':hidden'); continue }
      const w = this.world(n)
      parts.push(`${n.id}:${rv.mode}:${st(rv.p)}:${st(this.opacity(n))}:${st(this.dim(n))}:${st(w.p)}:${st(w.q)}:${st(w.s)}:${st(this.props(n))}`)
    }
    if (opts.camera !== false && this.model.viewport) parts.push('cam:' + st(this.camera()))
    if (opts.camera !== false && this.model.camera2dClips().length) parts.push('cam2:' + st(this.camera2d()))
    for (const [channel] of allLooks()) {
      const v = this.viewValue(channel)
      if (v !== undefined) parts.push(`view:${channel}:${st(v)}`)
      // a view channel set on single parts changes the picture too
      for (const n of this.model.nodes) if (n.space === '3d' && (n.props[channel] !== undefined || this.model.clipsFor(n, channel) || this.model.selectorClipsFor(channel))) parts.push(`look:${n.id}:${channel}:${st(this.lookValue(n, channel))}`)
    }
    for (const a of this.actions()) if (!opts.excludeActions?.includes(a.action.type)) parts.push(`act:${a.action.type}:${st(a.env)}:${st(a.data)}`)
    return hashString(parts.join('|'))
  }
}

/** Resolved points remember the space they are in, so project() does not have to guess from their length. */
const tagSpace = (p: Vec3, space: CoordSpace): Vec3 => { Object.defineProperty(p, 'space', { value: space, enumerable: false, configurable: true }); return p }
export const spaceTag = (v: unknown): CoordSpace | undefined => (Array.isArray(v) ? (v as { space?: CoordSpace }).space : undefined)
const round = (x: number, n: number): number => Math.round(x * 10 ** n) / 10 ** n
const describeBad = (v: unknown): string => (typeof v === 'number' ? String(v) : Array.isArray(v) ? `[${v.map(String).join(', ')}]` : v === undefined ? 'undefined' : typeof v === 'object' ? 'not a number' : `${typeof v} ${String(v)}`)
/** Order-stable, rounding serialisation for signatures. */
export function stable(v: unknown, depth = 0, digits = 6): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 10 ** digits) / 10 ** digits + 0) : String(v)
  if (typeof v === 'string') return JSON.stringify(v)
  if (v === null || v === undefined || typeof v === 'boolean') return String(v)
  if (typeof v === 'function') return isAnchorRef(v) ? `@${v.node.id}.${v.anchor}` : 'fn'
  if (isNode(v)) return '#' + v.id
  if (depth > 5) return '…'
  if (Array.isArray(v)) return '[' + v.map((x) => stable(x, depth + 1, digits)).join(',') + ']'
  if (typeof v === 'object') return '{' + Object.keys(v as object).sort().map((k) => k + ':' + stable((v as Record<string, unknown>)[k], depth + 1, digits)).join(',') + '}'
  return String(v)
}
