// SceneModel: everything the builder recorded (nodes, params, steps, clips, actions) + state(τ, params).
import { ctx } from './context.ts'
import { DiagStore, callSite, closest, parseStack, type Src } from './diagnostics.ts'
import { hooks, isAnchorRef, isNode, MNode, type Handle, type Patch } from './node.ts'
import { arrayOf, resolveNodeRef, spec } from './schema.ts'
import { allFinalizers, allKinds, allLooks, isLookChannel, kindOf, reportProblems, spanVerbs } from './registry.ts'
import { CAMERA, CAMERA2D, closeStep, isSelector, StepRec, type Action, type ChapterRec, type Clip, type Scope } from './timeline.ts'
import { CHANNELS, Frame, spaceOf, type ViewOverride, type Zoom2DSpec } from './frame.ts'
import { smooth } from './rate.ts'
import { PACE } from './rate.ts'
import { ConfigStore } from './config.ts'
import type { Rect } from './math.ts'

/** 16:9 exactly (14.222…): a 1280 × 720 stage is 90 px per unit, with nothing left over */
export const FRAME_W = (8 * 16) / 9
export const FRAME_H = 8
export const SAFE_X = 6.6
export const SAFE_Y = 3.5

export type ParamValue = number | boolean | string
export interface ParamDef {
  name: string
  kind: 'number' | 'toggle' | 'choice'
  value: ParamValue
  min: number
  max: number
  step: number
  unit: string
  label: string
  options: string[]
  /** the param goes round: its value and value + period show the same thing (an angle). `check` samples phases of it. */
  cyclic: boolean
  /** length of one cycle in the param's own unit; 0 when the param is not cyclic */
  period: number
  /** heads the param's row in a viewer; '' = none */
  group: string
  /** the story drives it and nobody else: it gets no control in the viewer and is not swept by `check` */
  hidden: boolean
  src: Src
}
export interface SceneOpts { title: string; subtitle?: string; /** settings of this scene (the config store): nested groups or dotted keys */ defaults?: unknown }
/** seconds: no single play, wait, sweep or camera move may be longer (a slip like `duration: 1e9` makes the story endless) */
export const MAX_SECONDS = 300

export class SceneModel {
  opts: SceneOpts = { title: '' }
  /** URL or path of the scene file (set by the host) */
  file: string | null = null
  readonly nodes: MNode[] = []
  readonly byId = new Map<string, MNode>()
  readonly params: ParamDef[] = []
  readonly probes = new Map<string, () => unknown>()
  readonly steps: StepRec[] = []
  /** chapters of a long explanation, in order (s.chapter) */
  readonly chapters: ChapterRec[] = []
  /** base values of the scene-level view channels (cutaway, ghost …); steps tween them with st.clip(VIEW, channel, value) */
  readonly view: Record<string, unknown> = {}
  /** view modes a viewer holds by hand (Runtime.setLook): channel → amount 0..1, instead of what the story says */
  readonly viewPins = new Map<string, number>()
  /** lazy chunks asked for by name (model.requireChunk); the chunks of the kinds in use are added by chunksNeeded() */
  private chunks = new Set<string>()
  readonly actions: Action[] = []
  readonly diagnostics = new DiagStore()
  /** 3D panel in frame units (centre-based), null until s.viewport() or the first 3D node */
  viewport: { cx: number; cy: number; width: number; height: number; where: string } | null = null
  duration = 0
  finalized = false
  /** set when the scene module could not be imported or its builder threw outside any step */
  fatal: { message: string; file: string | null; line: number | null; stack?: string } | null = null
  private clipIndex = new Map<unknown, Map<string, Clip[]>>()
  private selectorClips = new Map<string, Clip[]>()
  private clipSeq = 0
  private idCount = new Map<string, number>()
  private stores = new Map<string, unknown>()
  /** the settings of this scene: what scene({ defaults }) and s.config() set on top of the project's and the registered defaults */
  readonly settings = new ConfigStore((d, src) => { this.diagnostics.add({ step: null, t: null, ...d }, src) })
  private nextUid = 1
  /** bumped whenever recorded data changes, so caches keyed on the model can tell */
  revision = 0

  // ── nodes ────────────────────────────────────────────────────────────────────────────────────────
  addNode(node: MNode, wantedId: string | null): void {
    node.uid = this.nextUid++
    node.model = this
    // a part of a composite: its id is parent.name, whatever id option the constructor was given, and it uses no counter
    const part = ctx.child
    ctx.child = null
    let id = part ? `${part.parent.id}.${part.name}` : wantedId
    if (id !== null && this.byId.has(id)) {
      const other = this.byId.get(id)!
      let n = 2
      while (this.byId.has(`${id}-${n}`)) n++
      this.diagnostics.add({ code: 'ID-DUP', ids: [id], what: `two objects are both called "${id}" (lines ${other.src.line ?? '?'} and ${node.src.line ?? '?'}).`, fix: [`give them different ids, e.g. "${id}-a" and "${id}-b"`] }, node.src)
      id = `${id}-${n}`
    }
    if (id === null) {
      let n = (this.idCount.get(node.kind) ?? 0) + 1
      while (this.byId.has(`${node.kind}${n}`)) n++
      this.idCount.set(node.kind, n)
      id = `${node.kind}${n}`
    }
    node.id = id
    const st = ctx.step
    if (st) { node.createdStep = st.index; node.createdAt = st.t0 + st.cursor }
    else node.createdChapter = this.chapters.length - 1
    this.nodes.push(node)
    this.byId.set(id, node)
    if (part) this.adopt(part.parent, node)
    this.revision++
  }
  /**
   * Create a named part of a composite: model.child(lamp, 'bulb', sphere, { radius: 0.3 }). The part is a child of
   * `parent` with the id `${parent.id}.${name}` ('lamp.bulb'): that is what diagnostics, labels, the id pass and
   * st.focus see. Call it from the kind's init().
   */
  child<A extends any[]>(parent: MNode, name: string, ctor: (...args: A) => Handle, ...args: A): Handle {
    const prev = ctx.child
    ctx.child = { parent, name }
    try { return ctor(...args) } finally { ctx.child = prev }
  }
  /** Does this node have the channel: a built-in one, an option of its kind, or (3D parts) a look channel? */
  accepts(node: MNode, prop: string): boolean {
    const kind = kindOf(node.kind)
    return prop in CHANNELS || prop === 'rotate' || prop === 'placement' || !kind || kind.inert === true || Object.hasOwn(kind.schema, prop) || (node.space === '3d' && isLookChannel(prop))
  }
  /**
   * The nodes a change of `prop` on `node` lands on: the node itself when it has the channel, otherwise the nearest
   * descendants that have it (group.color(RED) colours the shapes inside). Nothing has it → API-UNKNOWN, [].
   */
  acceptors(node: MNode, prop: string, call: string): MNode[] {
    if (this.accepts(node, prop)) return [node]
    const out: MNode[] = []
    const walk = (n: MNode): void => { for (const c of n.children) { if (this.accepts(c, prop)) out.push(c); else walk(c) } }
    walk(node)
    if (!out.length) {
      const names = [...new Set([...Object.keys(kindOf(node.kind)?.schema ?? {}), ...Object.keys(CHANNELS), 'rotate'])].filter((n) => n !== 'id' && n !== 'present' && n !== 'revealMode' && n !== 'enterScale')
      const near = closest(prop, names)
      this.diagnostics.add({ code: 'API-UNKNOWN', ids: [node.id], what: `${call}: #${node.id} (${node.kind}) has no ${prop}${node.children.length ? ', and nothing inside it has' : ''}.`, fix: [near ? `use ${near}` : `a ${node.kind} has: ${names.join(', ')}`] })
    }
    return out
  }
  /**
   * Where a setter's patch lands: on the node when it has the patch's first channel, otherwise on the nearest objects
   * inside it that do. The whole patch goes to the same objects (`group.stroke(RED, 5)` gives every shape inside both
   * the colour and the width); a channel one of them lacks goes further down in that object alone.
   */
  route(node: MNode, patch: Patch, call: string): [MNode, Patch][] {
    const names = Object.keys(patch)
    if (!names.length) return []
    const out: [MNode, Patch][] = []
    for (const taker of this.acceptors(node, names[0]!, call)) {
      const own: Patch = {}
      for (const name of names) {
        if (this.accepts(taker, name)) own[name] = patch[name]
        else for (const [n, sub] of this.route(taker, { [name]: patch[name] }, call)) out.push([n, sub])
      }
      if (Object.keys(own).length) out.push([taker, own])
    }
    return out
  }
  /** Report a clip on VIEW whose channel is not a view mode (defineLook). */
  checkViewChannel(prop: string, call: string): boolean {
    if (isLookChannel(prop)) return true
    const names = allLooks().map((l) => l[0])
    const near = closest(prop, names)
    this.diagnostics.add({ code: 'API-UNKNOWN', what: `${call}: "${prop}" is not a view channel${prop in CHANNELS ? ' (it is a channel of single objects: pass the object, or a selector, as the target)' : ''}.`, fix: [near ? `use "${near}"` : names.length ? `view channels: ${names.join(', ')}` : 'register the view mode first with defineLook(channel, fn)'] })
    return false
  }
  /** Report a channel name that no kind has (for clips on a selector). */
  checkChannel(prop: string, call: string): boolean {
    if (prop in CHANNELS || prop === 'rotate' || prop === 'placement' || isLookChannel(prop) || allKinds().some((k) => prop in k.schema)) return true
    const near = closest(prop, [...Object.keys(CHANNELS), 'rotate', ...new Set(allKinds().flatMap((k) => Object.keys(k.schema)))])
    this.diagnostics.add({ code: 'API-UNKNOWN', what: `${call}: no kind has a channel "${prop}".`, fix: [near ? `use "${near}"` : 'use a built-in channel (opacity, dim, scale, offset, shift, z) or an option of the kinds it targets'] })
    return false
  }
  /** Ask for a lazy chunk by name (a step action or scene method whose drawing side lives in one). Kinds name theirs with `chunk`. */
  requireChunk(name: string): void { this.chunks.add(name) }
  /** The lazy chunks this scene needs: those of the kinds in use plus those asked for by name. '3d' first, then by name. */
  chunksNeeded(): string[] {
    const out = new Set(this.chunks)
    for (const n of this.nodes) for (const c of kindOf(n.kind)?.chunks ?? []) out.add(c)
    return [...out].sort((a, b) => (a === '3d' ? -1 : b === '3d' ? 1 : a < b ? -1 : a > b ? 1 : 0))
  }
  /** Make `child` a child of `parent` (removing it from a previous parent). */
  adopt(parent: MNode, child: MNode): void {
    if (child === parent || child.parent === parent) return
    for (let p: MNode | null = parent; p; p = p.parent) if (p === child) { this.diagnostics.add({ code: 'PLACE-CONFLICT', ids: [child.id, parent.id], what: `#${child.id} cannot be inside #${parent.id}: it already contains it.`, fix: ['remove one of the two group() memberships'] }); return }
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = parent
    parent.children.push(child)
    this.revision++
  }
  /** A node or the id of one → the node; otherwise REF-MISSING / API-TYPE is reported and null returned. */
  resolveNode(v: unknown, call: string, name = 'target'): MNode | null {
    const r = resolveNodeRef(v, this, call, name)
    if (r.ok) return r.value as MNode
    reportProblems(this, [r.problem], [])
    return null
  }
  /**
   * A setting, by its dotted name: model.config('pace.play'). What the scene set (scene({ defaults }), s.config()),
   * else the project's (mimir.config.json), else the default its module registered with defineConfig, else `fallback`.
   * Every default that shapes output is read this way; docs/CONFIG.md lists the keys.
   */
  config<T = unknown>(key: string, fallback?: T): T { return this.settings.get<T>(key, fallback) }
  /** Per-model storage for extension modules: model.store('flow', () => ({ … })). */
  store<T>(key: string, init: () => T): T {
    if (!this.stores.has(key)) this.stores.set(key, init())
    return this.stores.get(key) as T
  }

  /**
   * The part of the frame that 2D content has to itself: what a 3D panel on one side leaves free (s.viewport('right')
   * → the left part). null = the whole frame (no 3D panel, a full one, or one placed by hand). The 2D camera looks
   * through this window: st.zoom fits its target into it and never pushes 2D content over the 3D panel.
   */
  area2d(): Rect | null {
    const v = this.viewport
    if (!v) return null
    const W = FRAME_W, H = FRAME_H
    switch (v.where) {
      case 'left': return { x: -W / 2 + v.width, y: -H / 2, width: W - v.width, height: H }
      case 'right': return { x: -W / 2, y: -H / 2, width: W - v.width, height: H }
      case 'top': return { x: -W / 2, y: -H / 2, width: W, height: H - v.height }
      case 'bottom': return { x: -W / 2, y: -H / 2 + v.height, width: W, height: H - v.height }
      default: return null
    }
  }

  // ── clips and actions ────────────────────────────────────────────────────────────────────────────
  /**
   * Record something overlays and backends read every frame, outside a step callback (a finalize hook): the same
   * record st.action() makes. `step` is the 0-based step it belongs to; `at` is seconds from that step's start.
   */
  addAction<D>(type: string, data: D, o: { step: number; at?: number; duration?: number; scope?: Scope; src?: Src }): Action<D> {
    const rec = this.steps[o.step]
    const t0 = (rec ? rec.t0 : 0) + (o.at ?? 0)
    const a: Action<D> = { type: String(type), data, step: rec ? rec.index : 0, t0, t1: t0 + Math.max(0, o.duration ?? PACE.scopedIn), scope: o.scope ?? 'step', src: o.src ?? callSite(), seq: this.actions.length }
    this.actions.push(a)
    this.revision++
    return a
  }
  addClip(c: Clip): void {
    c.seq = this.clipSeq++
    if (isSelector(c.target)) {
      const list = this.selectorClips.get(c.prop) ?? []
      list.push(c)
      this.selectorClips.set(c.prop, list)
    } else {
      let per = this.clipIndex.get(c.target)
      if (!per) this.clipIndex.set(c.target, (per = new Map()))
      const list = per.get(c.prop) ?? []
      list.push(c)
      per.set(c.prop, list)
    }
    this.revision++
  }
  /** Clips recorded on one channel of one target, in fold order. */
  clipsFor(target: unknown, prop: string): readonly Clip[] | undefined { return this.clipIndex.get(target)?.get(prop) }
  selectorClipsFor(prop: string): readonly Clip[] | undefined { return this.selectorClips.get(prop) }
  /** Every clip (for rules and tools). */
  allClips(): Clip[] {
    const out: Clip[] = []
    for (const per of this.clipIndex.values()) for (const l of per.values()) out.push(...l)
    for (const l of this.selectorClips.values()) out.push(...l)
    return out.sort((a, b) => a.seq - b.seq)
  }
  /** The raw value a channel will have at the recorder's cursor: the last clip's target, else the base value. */
  latest(node: MNode, prop: string): unknown {
    const l = this.clipIndex.get(node)?.get(prop)
    if (l && l.length) return l[l.length - 1]!.to
    return prop === 'placement' ? node.placement : node.props[prop]
  }

  // ── time ─────────────────────────────────────────────────────────────────────────────────────────
  /** Story time → step index (0-based, −1 when there are no steps) and seconds into it. */
  locate(tau: number): { k: number; u: number } {
    const n = this.steps.length
    if (!n) return { k: -1, u: tau }
    for (let i = 0; i < n; i++) if (tau < this.steps[i]!.t1) return { k: i, u: tau - this.steps[i]!.t0 }
    return { k: n - 1, u: tau - this.steps[n - 1]!.t0 }
  }
  /** Simulation time s.t() at story time τ (speed per step from st.clock). */
  simTime(tau: number): number {
    let t = 0
    for (const s of this.steps) {
      if (tau <= s.t0) break
      t += (Math.min(tau, s.t1) - s.t0) * s.clockSpeed
    }
    const last = this.steps[this.steps.length - 1]
    if (!last) return tau
    if (tau > last.t1) t += (tau - last.t1) * last.clockSpeed
    return t
  }
  /** Seconds a step-scoped mark takes to clear after step `index` ends. */
  releaseAfter(index: number): number {
    const next = this.steps[index + 1]
    return next ? Math.min(this.config<number>('pace.scopedOut'), (next.t1 - next.t0) / 2) : 0
  }

  // ── state ────────────────────────────────────────────────────────────────────────────────────────
  /** state(τ, params): total and deterministic. `params` pins params to values (the user dragging a slider). */
  state(tau: number, params: Record<string, ParamValue> = {}, view: ViewOverride | null = null): Frame {
    const d = this.duration
    const t = Number.isFinite(tau) ? Math.min(Math.max(tau, 0), d > 0 ? d : Math.max(tau, 0)) : 0
    return new Frame(this, t, params, view)
  }
  /** The frame API calls read from right now: the one being evaluated, else the state at the recorder's cursor. */
  now(): Frame {
    const f = ctx.frame
    if (f && f.model === this) return f
    const st = ctx.step
    return new Frame(this, st ? st.t0 + st.cursor : 0, {}, null)
  }

  // ── errors ───────────────────────────────────────────────────────────────────────────────────────
  /** Turn an exception into a RUNTIME-ERROR diagnostic (with a did-you-mean for unknown names). */
  reportError(e: unknown, where: string, extra: { ids?: string[]; t?: number | null; /** the param values in force (a frame with pinned params) */ frame?: Frame } = {}): void {
    const err = e as { name?: string; message?: string; stack?: string }
    const msg = `${err?.name ?? 'Error'}: ${err?.message ?? String(e)}`
    const fix: string[] = []
    const m = /^(\w+) is not defined$/.exec(err?.message ?? '') ?? /Can't find variable: (\w+)/.exec(err?.message ?? '')
    if (m) {
      const near = closest(m[1]!, publicNames())
      fix.push(near ? `use "${near}"` : `"${m[1]}" is not part of the API: run \`mimir docs\` for the list`)
    }
    let site = parseErr(err?.stack)
    // an exception inside the engine (a kind backend, a look, a rule) has no scene frame: point at the object it was drawing
    const owner = extra.ids?.length ? this.byId.get(extra.ids[0]!) : undefined
    if (site.line === null && owner && owner.src.line !== null) {
      site = owner.src
      fix.push(`the ${owner.kind} created on this line could not be drawn: check its options, or report the kind "${owner.kind}" as broken`)
    }
    if (site.line === null) site = callSite()
    // DESIGN §7: never a diagnostic without a way out
    if (!fix.length) fix.push(site.line !== null ? `fix line ${site.line}: the code there threw while ${where.startsWith('the ') ? where.slice(4) : where} ran${/is not a function|undefined|null/.test(msg) ? ' (a name that does not exist, or a value that is undefined)' : ''}; everything else was still built` : `find what throws in ${where} and fix it; everything else was still built`)
    const when = extra.frame?.paramClause() ?? ''
    if (when) fix.push(...extra.frame!.reproHint())
    this.diagnostics.add({ code: 'RUNTIME-ERROR', ids: extra.ids ?? [], t: extra.t, what: `${msg} (in ${where}${when ? `, ${when}` : ''}).`, fix, ...(when ? { params: { ...extra.frame!.overrides } } : {}) }, site)
  }

  // ── finalise ─────────────────────────────────────────────────────────────────────────────────────
  /** Called once after the builder has run: lifetimes, ordering, duration. Idempotent. */
  finalize(): void {
    if (this.finalized) return
    // the model being finalised is the current one: defaults read here (PACE, a module's finalize hook) are this scene's
    const outer = ctx.model
    ctx.model = this
    try { this.finish() } finally { ctx.model = outer }
  }
  private finish(): void {
    for (const [name, fn] of allFinalizers()) { try { fn(this) } catch (e) { this.reportError(e, `finalize hook "${name}"`) } }
    this.settleSpaces()
    this.checkNarration()
    if (!this.steps.length) {
      // a scene without steps still gets a playable span (s.t() driven motion)
      const rec = new StepRec(0, this.opts.title || '', { file: this.file, line: null })
      rec.minActive = PACE.still
      rec.hold = 0
      closeStep(rec)
      this.steps.push(rec)
    }
    this.duration = this.steps[this.steps.length - 1]!.t1
    for (const node of this.nodes) {
      // lifetime (DESIGN §3.2): hidden before its first enter; a node created inside a step appears at that moment
      const list = this.clipIndex.get(node)?.get('present')
      const first = list && [...list].sort((a, b) => a.t0 - b.t0 || a.seq - b.seq)[0]
      const entersLater = first !== undefined && first.to === 1
      // a node made between s.chapter() and its first step belongs to that chapter: it appears when the chapter opens
      const ch = node.createdStep < 0 ? this.chapters[node.createdChapter] : undefined
      const opens = ch && ch.firstStep >= 0 ? this.steps[ch.firstStep]!.t0 + ch.clear : 0
      if (entersLater) node.props.present = 0
      else if (node.createdStep >= 0 && node.createdAt > 0 && node.props.present === undefined) {
        node.props.present = 0
        this.addClip({ target: node, prop: 'present', to: 1, t0: node.createdAt, t1: node.createdAt, rate: (t) => t, scope: 'persist', step: node.createdStep, src: node.src, seq: 0 })
      } else if (opens > 0 && node.props.present === undefined) {
        node.props.present = 0
        this.addClip({ target: node, prop: 'present', to: 1, t0: opens, t1: opens + PACE.scopedIn, rate: smooth, scope: 'persist', step: ch!.firstStep, src: node.src, seq: 0 })
      }
    }
    const order = (a: Clip, b: Clip): number => a.t0 - b.t0 || a.seq - b.seq
    for (const per of this.clipIndex.values()) for (const l of per.values()) l.sort(order)
    for (const l of this.selectorClips.values()) l.sort(order)
    this.actions.sort((a, b) => a.t0 - b.t0 || a.seq - b.seq)
    this.openChapters(order)
    if (!this.viewport && this.nodes.some((n) => n.space === '3d')) this.viewport = { cx: 0, cy: 0, width: FRAME_W, height: FRAME_H, where: 'full' }
    this.finalized = true
    this.revision++
  }
  /**
   * A 2D object that is placed on, beside or between things on screen (a 3D part, an m.hud() object) lives on the
   * screen too: the 2D camera moves neither the 3D panel nor what follows it. Decided once here, from what the scene
   * wrote (a function that returns a part cannot be seen through). Then st.zoom targets that are not in the 2D
   * world are reported and dropped.
   */
  private settleSpaces(): void {
    const refs = (v: unknown, out: MNode[]): void => {
      if (isNode(v)) out.push(v)
      else if (isAnchorRef(v)) out.push(v.node)
      else if (Array.isArray(v)) for (const x of v) refs(x, out)
    }
    const targets = new Map<MNode, MNode[]>()
    for (const n of this.nodes) {
      if (n.space !== '2d') continue
      const out: MNode[] = []
      const of = (pl: unknown): void => { if (pl && typeof pl === 'object') for (const key of ['pos', 'ref', 'target', 'a', 'b']) refs((pl as Record<string, unknown>)[key], out) }
      of(n.placement)
      for (const c of this.clipsFor(n, 'placement') ?? []) of(c.to)
      const kind = kindOf(n.kind)
      // options that are points, or that name the object this one sits on (a token on an edge): where that is, this is
      const ties = (t: unknown): boolean => t === 'point' || t === 'node'
      if (kind) for (const [name, sp] of Object.entries(kind.schema)) { const t = spec(sp).type; if (ties(t) || (arrayOf(t) && ties(spec(arrayOf(t)!.array).type))) refs(n.props[name], out) }
      if (out.length) targets.set(n, out)
    }
    for (let changed = true; changed;) {
      changed = false
      for (const [n, list] of targets) {
        if (n.isHud || spaceOf(n) !== '2d') continue
        if (list.some((t) => t !== n && spaceOf(t) !== '2d')) { n.isHud = true; changed = true }
      }
    }
    for (const clip of this.camera2dClips()) {
      const sp = clip.to as Zoom2DSpec | null
      if (!sp?.nodes) continue
      const off = sp.nodes.filter((n) => spaceOf(n) !== '2d')
      if (!off.length) continue
      for (const n of off) this.diagnostics.add({ code: 'API-TYPE', ids: [n.id], step: clip.step + 1, stepTitle: this.steps[clip.step]?.title ?? null, what: `st.zoom(): #${n.id} is on the screen, not in the 2D world (${n.space === '3d' ? 'it is a 3D part' : 'it is m.hud(), or it is placed on a 3D part or a hud object'}): the 2D camera does not move it, so it cannot be zoomed on.`, fix: [sp.nodes.length > off.length ? `zoom on the 2D objects only: st.zoom([${sp.nodes.filter((x) => !off.includes(x)).map((x) => x.id).join(', ')}])` : 'zoom on a 2D object that is not placed on a 3D part', 'or move the 3D camera instead: st.camera({ fit: [part] })'] }, clip.src)
      sp.nodes = sp.nodes.filter((n) => !off.includes(n))
    }
  }
  /** Narration spans (DESIGN §6): every target is an object of the scene, every verb is one the guide knows. */
  private checkNarration(): void {
    const verbs = spanVerbs()
    const ids = [...this.byId.keys()]
    for (const s of this.steps) for (const n of s.narration) for (const sp of n.spans) {
      const at = { step: s.k, stepTitle: s.title }
      if (verbs.length && !verbs.includes(sp.verb)) {
        const near = closest(sp.verb, verbs)
        this.diagnostics.add({ code: 'API-UNKNOWN', ...at, what: `st.say(): "[${sp.words}](${sp.verb}:…)" uses the verb "${sp.verb}", which the guide does not know.`, fix: [near ? `use "${near}"` : `verbs: ${verbs.join(', ')}`, `or drop the verb to point: [${sp.words}](${sp.targets.join('+') || 'partId'})`] }, n.src)
      }
      if (!sp.targets.length) this.diagnostics.add({ code: 'GUIDE-TARGET', ...at, what: `st.say(): the span "[${sp.words}](…)" names no object.`, fix: [`name the part the words are about: [${sp.words || 'words'}](${ids[0] ?? 'partId'})`] }, n.src)
      for (const t of sp.targets) {
        if (this.byId.has(t)) continue
        const near = closest(t, ids)
        this.diagnostics.add({ code: 'GUIDE-TARGET', ids: [t], ...at, what: `st.say(): "[${sp.words}](…${t})" points at "${t}", and no object has that id.`, fix: [near ? `use "${near}"` : ids.length ? `ids in this scene: ${ids.slice(0, 10).join(', ')}${ids.length > 10 ? ', …' : ''}` : 'create the object first', `give the object that id: rect({ id: '${t}' })`] }, n.src)
      }
    }
  }
  /** An API call that arrived after the scene was built (after an await, a timer): it changes nothing and says so, once per call name. */
  late(call: string): void {
    this.diagnostics.add({ code: 'API-TYPE', step: null, t: null, what: `${call} was called after the scene had been built (after an \`await\`, in a callback or a timer); it was ignored.`, fix: ['the scene builder and its steps are synchronous: remove `async` / `await` from them', 'load data with a top-level `await` before `export default scene(…)`'] })
  }
  /**
   * DESIGN §3.4: when a chapter opens, everything on stage except `keep` leaves with a lagged fade and the cameras
   * reset. Done here, once lifetimes are known, in chapter order (what chapter 2 cleared is gone for chapter 3).
   */
  private openChapters(order: (a: Clip, b: Clip) => number): void {
    for (const ch of this.chapters) {
      const first = this.steps[ch.firstStep]
      if (!first || first.t0 + ch.clear <= 0) continue
      const t0 = first.t0
      const keep = new Set<MNode>()
      const down = (n: MNode): void => { keep.add(n); n.children.forEach(down) }
      for (const k of ch.keep) { down(k); for (let p = k.parent; p; p = p.parent) keep.add(p) }
      const at = new Frame(this, t0)
      // whole objects leave as one: a node whose parent leaves needs no clip of its own
      // a container shows what is in it: one whose members have not entered yet (a graph before its draw()) is not on stage,
      // and clearing it would keep its members away when they enter in this chapter
      const shows = (n: MNode): boolean => at.reveal(n).p > 0 && (!kindOf(n.kind)?.container || n.children.some(shows))
      const leaving = ch.stage.filter((n) => !keep.has(n) && shows(n) && !(n.parent && !keep.has(n.parent)))
      const d = Math.min(PACE.chapterFade, ch.clear)
      const lag = leaving.length > 1 ? Math.min(PACE.lag * d, (ch.clear - d) / (leaving.length - 1)) : 0
      leaving.forEach((n, i) => {
        this.addClip({ target: n, prop: 'revealMode', to: 'fade', t0: t0 + i * lag, t1: t0 + i * lag, rate: (t) => t, scope: 'persist', step: first.index, src: ch.src, seq: 0 })
        this.addClip({ target: n, prop: 'present', to: 0, t0: t0 + i * lag, t1: t0 + i * lag + d, rate: smooth, scope: 'persist', step: first.index, src: ch.src, seq: 0 })
        for (const prop of ['revealMode', 'present']) this.clipIndex.get(n)!.get(prop)!.sort(order)
      })
      if (ch.keepCamera) continue
      if (this.viewport) this.addClip({ target: CAMERA, prop: 'pose', to: { reset: this.steps.filter((s) => s.chapter === ch.index).map((s) => [s.t0, s.t1]) }, t0, t1: t0 + ch.clear, rate: smooth, scope: 'persist', step: first.index, src: ch.src, seq: 0 })
      this.addClip({ target: CAMERA2D, prop: 'pose2d', to: null, t0, t1: t0 + ch.clear, rate: smooth, scope: 'persist', step: first.index, src: ch.src, seq: 0 })
      for (const [target, prop] of [[CAMERA, 'pose'], [CAMERA2D, 'pose2d']] as const) this.clipIndex.get(target)?.get(prop)?.sort(order)
    }
  }
  get has3d(): boolean { return this.nodes.some((n) => n.space === '3d') }
  /** Leaf-first list is not needed: nodes are stored in creation order, parents may come after children. */
  roots(): MNode[] { return this.nodes.filter((n) => !n.parent) }
  cameraClips(): readonly Clip[] { return this.clipsFor(CAMERA, 'pose') ?? [] }
  camera2dClips(): readonly Clip[] { return this.clipsFor(CAMERA2D, 'pose2d') ?? [] }
  /** The rectangle of the 3D panel in frame units (min corner), or null. */
  viewportRect(): Rect | null {
    const v = this.viewport
    return v ? { x: v.cx - v.width / 2, y: v.cy - v.height / 2, width: v.width, height: v.height } : null
  }
}

/** defaults of 'pace.chapterFade' / 'pace.chapterClear' (seconds one object takes to leave when a chapter opens, and the whole clear): read PACE, which follows the scene's settings */
export const CHAPTER_FADE = 0.5
export const CHAPTER_CLEAR = 0.8

function parseErr(stack: string | undefined): Src {
  return stack ? parseStack(stack) : { file: null, line: null }
}

let namesProvider: () => string[] = () => []
/** The host installs the list of public API names (for did-you-mean on "X is not defined"). */
export function setPublicNames(fn: () => string[]): void { namesProvider = fn }
export const publicNames = (): string[] => namesProvider()

// ambient model: API calls outside any builder still land somewhere and never throw
ctx.ensureModel = () => (ctx.model ??= new SceneModel())

// setters: outside a step they change the base value; inside a step they are an instant change at the cursor
hooks.route = (node, patch, call) => node.model.route(node, patch, call)
hooks.applyPatch = (target: MNode, whole: Patch, name: string): void => {
  const model = target.model
  if (model.finalized) { model.late(`${target.kind}.${name}()`); return }
  const st = ctx.step
  // a channel the object does not have goes to the objects inside it that do (group.color(RED)); none → API-UNKNOWN
  for (const [node, patch] of model.route(target, whole, `${target.kind}.${name}()`)) for (const [prop, value] of Object.entries(patch)) {
    const fresh = !st || (node.createdStep === st.index && node.createdAt === st.t0 + st.cursor)
    if (!fresh && st) {
      model.addClip({ target: node, prop, to: value, t0: st.t0 + st.cursor, t1: st.t0 + st.cursor, rate: (t) => t, scope: 'persist', step: st.index, src: callSite(), seq: 0 })
      continue
    }
    if (prop === 'placement') {
      const prev = node.placement
      if (prev && value && prev !== value) {
        model.diagnostics.add({ code: 'PLACE-CONFLICT', ids: [node.id], what: `#${node.id} is placed twice (${prev.type}, then ${(value as { type: string }).type} by .${name}()). Only the first is applied.`, fix: [`delete this .${name}() call`, 'or move the object with .shift(dx, dy) instead'] })
        continue
      }
      node.placement = value as MNode['placement']
    } else node.props[prop] = value
  }
  model.revision++
}
export { isNode }
