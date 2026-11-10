// Runtime: mounts a compiled SceneModel into the page and renders frames. It owns the stage (the 16:9 frame,
// letterboxed into whatever slot it is given), one renderer per space and the overlay layers. Nothing here reads a
// clock: time only moves through seek(). Importing this file touches no DOM; mount() does.
import { smooth } from './rate.ts'
import { clamp01, type Rect } from './math.ts'
import { isNode, type MNode, type Space } from './node.ts'
import { allOverlays, kindOf, lookControl, overlayLayoutOrder, rendererFor, type IdPassResult, type OverlayCtx, type OverlayDef, type OverlayInstance, type OverlayRect, type Renderer } from './registry.ts'
import { lerpPose, type Pose } from './camera.ts'
import type { CoordSpace, Frame, ViewOverride } from './frame.ts'
import { FRAME_H, FRAME_W, type ParamValue, type SceneModel } from './model.ts'

export interface ScreenPoint { /** stage px from the top-left corner */ x: number; y: number; visible: boolean; depth: number }
export type RuntimeEvent = 'frame' | 'resize' | 'view' | 'params'
export interface RuntimeOptions {
  /** nothing advances or schedules on its own; frames are rendered on demand */
  headless?: boolean
  /** loads a lazy chunk by name ('3d', 'check', a module's own) and resolves once its modules have registered */
  load?: (chunk: string) => Promise<unknown>
}

export class Runtime {
  tau = 0
  overrides: Record<string, ParamValue> = {}
  /** persistent view set through setView() (CLI --views, ?view=) */
  view: ViewOverride | null = null
  /** camera pose the user dragged to; cleared when a later step brings its own camera cue */
  private userView: { pose: Pose; step: number } | null = null
  private handoff: { from: Pose; tau0: number } | null = null
  debugMode: string | null = null
  slot: HTMLElement | null = null
  stageEl!: HTMLElement
  width = 1280
  height = 720
  /** px per frame unit */
  scale = 90
  readonly renderers = new Map<Space, Renderer>()
  /** overlays in paint order, and the same ones in layout order */
  private overlays: { def: OverlayDef; inst: OverlayInstance; root: HTMLElement }[] = []
  private layoutOrder: { def: OverlayDef; inst: OverlayInstance; root: HTMLElement }[] = []
  private overlayHolder: HTMLElement | null = null
  /** rectangles the overlays produced for the frame on screen, by overlay name */
  private laidRects = new Map<string, OverlayRect[]>()
  private idPassMemo: { frame: Frame; size: string; byKey: Map<string, IdPassResult | null> } | null = null
  /** lazy chunks that were loaded for this scene, in load order */
  readonly chunks: string[] = []
  private current: Frame | null = null
  private dirty = true
  private raf = 0
  private listeners = new Map<string, Set<(arg: any) => void>>()
  private observer: ResizeObserver | null = null
  private renderErrors = new Set<string>()
  readonly headless: boolean

  constructor(readonly model: SceneModel, readonly options: RuntimeOptions = {}) {
    this.headless = !!options.headless
  }

  // ── mounting ─────────────────────────────────────────────────────────────────────────────────────
  async mount(slot: HTMLElement): Promise<void> {
    this.slot = slot
    const stage = (this.stageEl = document.createElement('div'))
    stage.className = 'mimir-stage'
    stage.style.cssText = 'position:absolute;overflow:hidden;background:#000;contain:strict;user-select:none;-webkit-user-select:none'
    if (getComputedStyle(slot).position === 'static') slot.style.position = 'relative'
    slot.appendChild(stage)
    this.layout()
    // exactly the lazy chunks this scene's kinds (and step actions) name: a 2D scene never loads three.js
    for (const chunk of this.model.chunksNeeded()) {
      if (chunk === '3d' && rendererFor('3d')) continue
      if (!this.options.load) continue
      try { await this.options.load(chunk); this.chunks.push(chunk) } catch (e) {
        // say who asked for it: the kind (and the first object of that kind), so the message has a scene line
        const user = this.model.nodes.find((n) => kindOf(n.kind)?.chunks?.includes(chunk))
        this.model.reportError(e, `loading the chunk "${chunk}"${user ? `, which the kind "${user.kind}" names` : ''}`, { ids: user ? [user.id] : [] })
      }
    }
    // the chunks registered their settings: keys the scene or the project set for them can be judged now
    this.model.settings.recheck()
    // a 3D part with no 3D renderer would simply not be there: say so instead of leaving an empty frame to explain
    if (this.model.has3d && !rendererFor('3d')) {
      const part = this.model.nodes.find((n) => n.space === '3d')!
      this.model.diagnostics.add({ code: 'RUNTIME-ERROR', ids: [part.id], what: `this scene has 3D parts (#${part.id}, a ${part.kind}) but no 3D renderer was loaded, so none of them is drawn.`, fix: [this.options.load ? 'the 3D chunk (mimir.3d.js) failed to load: see the error above, or rebuild with bun scripts/build.ts' : 'this host has no chunk loader: pass `load` to the Runtime'] }, part.src)
    }
    for (const space of ['3d', '2d'] as Space[]) {
      if (space === '3d' && !this.model.has3d) continue
      const make = rendererFor(space)
      if (!make) continue
      try {
        const r = make()
        r.mount(this)
        this.renderers.set(space, r)
      } catch (e) { this.model.reportError(e, `starting the ${space} renderer`) }
    }
    const holder = document.createElement('div')
    holder.className = 'mimir-overlays'
    holder.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3'
    stage.appendChild(holder)
    this.overlayHolder = holder
    this.syncOverlays()
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => { if (this.layout()) { for (const r of this.renderers.values()) r.resize(); this.emit('resize', this.stage()); this.invalidate() } })
      this.observer.observe(slot)
    }
    this.dirty = true
  }
  /**
   * Create every registered overlay that is not there yet, in paint order (z, then name), and work out the layout
   * order. Called when the runtime mounts, and again after a lazy chunk that registers overlays has been loaded later
   * (the debug overlay of the dev chunk).
   */
  syncOverlays(): void {
    const holder = this.overlayHolder
    if (!holder) return
    const have = new Set(this.overlays.map((o) => o.def))
    for (const def of allOverlays()) {
      if (have.has(def)) continue
      const root = document.createElement('div')
      root.dataset.overlay = def.name
      root.style.cssText = 'position:absolute;inset:0;pointer-events:none'
      try { this.overlays.push({ def, inst: def.create(this.overlayCtx(root)), root }) } catch (e) { this.model.reportError(e, `overlay "${def.name}"`) }
    }
    // paint order is DOM order, whatever order the overlays were created in
    const order = allOverlays()
    this.overlays.sort((a, b) => order.indexOf(a.def) - order.indexOf(b.def))
    for (const o of this.overlays) holder.appendChild(o.root)
    const plan = overlayLayoutOrder(this.overlays.map((o) => o.def))
    this.layoutOrder = plan.order.map((d) => this.overlays.find((o) => o.def === d)!)
    if (plan.cycles.length) this.model.diagnostics.add({ code: 'RUNTIME-ERROR', what: `overlays wait for each other in a circle (${plan.cycles.join(', ')}): their \`after\` lists form a cycle.`, fix: ['remove one of the `after` entries'] }, null)
    this.invalidate()
  }
  /** Letterbox the 16:9 frame into the slot. Returns true when the size changed. */
  layout(): boolean {
    const slot = this.slot
    if (!slot) return false
    const sw = slot.clientWidth || 1280, sh = slot.clientHeight || 720
    let w = Math.min(sw, (sh * FRAME_W) / FRAME_H)
    w = Math.max(16, Math.floor(w + 1e-6)) // a 16:9 slot is used whole: 1280 × 720 is 90 px per unit
    const h = Math.round((w * FRAME_H) / FRAME_W)
    const changed = w !== this.width || h !== this.height || !this.stageEl.style.width
    this.width = w
    this.height = h
    this.scale = w / FRAME_W
    const st = this.stageEl.style
    st.width = w + 'px'
    st.height = h + 'px'
    st.left = Math.floor((sw - w) / 2) + 'px'
    st.top = Math.floor((sh - h) / 2) + 'px'
    return changed
  }
  stage(): { width: number; height: number; scale: number } { return { width: this.width, height: this.height, scale: this.scale } }
  private overlayCtx(root: HTMLElement): OverlayCtx {
    return {
      root, runtime: this, model: this.model,
      stage: () => this.stage(),
      px: (u) => u * this.scale,
      snap: (v) => { const d = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1; return Math.round(v * d) / d },
      toStage: (p) => this.toStage(p),
      project: (t) => this.project(t),
      screenRect: (n) => this.screenRect(n),
      visiblePoint: (n) => this.visiblePoint(n),
    }
  }

  // ── state ────────────────────────────────────────────────────────────────────────────────────────
  seek(tau: number): void {
    const d = this.model.duration
    const t = Number.isFinite(tau) ? Math.min(Math.max(0, tau), d) : 0
    if (t === this.tau && this.current) return
    if (this.userView) {
      // the user's camera wins until a later step brings its own camera cue; then hand back smoothly
      const k = this.model.locate(t).k
      const s = this.model.steps[k]
      if (k !== this.userView.step && s && this.model.cameraClips().some((c) => c.step === k)) {
        this.handoff = { from: this.userView.pose, tau0: s.t0 }
        this.userView = null
      }
    }
    this.tau = t
    this.invalidate()
  }
  setParam(name: string, value: ParamValue): void {
    const def = this.model.params.find((p) => p.name === name)
    if (!def) return
    let v: ParamValue = value
    if (def.kind === 'number') {
      const n = typeof value === 'number' ? value : parseFloat(String(value))
      if (!Number.isFinite(n)) return
      v = n
    } else if (def.kind === 'toggle') v = value === true || value === 'true' || value === 1 || value === '1'
    else v = String(value)
    this.overrides = { ...this.overrides, [name]: v }
    this.emit('params', this.overrides)
    this.invalidate()
  }
  /** Give a param back to the story (all params when no name is given). */
  clearParam(name?: string): void {
    if (name === undefined) this.overrides = {}
    else { const { [name]: _, ...rest } = this.overrides; this.overrides = rest }
    this.emit('params', this.overrides)
    this.invalidate()
  }
  /** A named view or a pose, kept until setView(null). `user: true` marks a drag: a later camera cue takes over again. */
  setView(view: ViewOverride | null, o: { user?: boolean } = {}): void {
    this.handoff = null
    if (o.user && view && typeof view === 'object') {
      this.userView = { pose: { ...this.frame.camera(), ...view } as Pose, step: this.model.locate(this.tau).k }
    } else {
      this.userView = null
      this.view = view
    }
    this.emit('view', view)
    this.invalidate()
  }
  get userHasView(): boolean { return this.userView !== null }
  /**
   * Hold a view mode by hand (a viewer's control): `amount` 0..1 of the look's "on" value, whatever the story says;
   * null gives it back to the story. Only looks registered with a `control` can be held.
   */
  setLook(channel: string, amount: number | null): void {
    const control = lookControl(channel)
    if (!control) return
    if (amount === null) this.model.viewPins.delete(channel)
    else {
      if (!this.model.viewPins.has(channel)) control.prepare?.(this.model)
      this.model.viewPins.set(channel, Number.isFinite(amount) ? Math.min(1, Math.max(0, amount)) : 0)
    }
    this.invalidate()
  }
  setDebug(mode: string | null): void { this.debugMode = mode || null; this.invalidate() }

  /** The state being shown. */
  get frame(): Frame {
    if (this.current) return this.current
    let view: ViewOverride | null = this.view
    if (this.userView) view = this.userView.pose
    else if (this.handoff && this.view === null) {
      const w = smooth(clamp01((this.tau - this.handoff.tau0) / this.model.config<number>('pace.handoff')))
      if (w >= 1 || this.tau < this.handoff.tau0) this.handoff = null
      else view = lerpPose(this.handoff.from, this.model.state(this.tau, this.overrides, null).camera(), w)
    }
    return (this.current = this.model.state(this.tau, this.overrides, view))
  }
  /** Pure state at another time (does not change what is shown). */
  stateAt(tau: number, params?: Record<string, ParamValue>): Frame { return this.model.state(tau, params ?? this.overrides, this.view) }

  // ── rendering ────────────────────────────────────────────────────────────────────────────────────
  invalidate(): void {
    this.current = null
    this.dirty = true
    if (this.headless || this.raf || typeof requestAnimationFrame === 'undefined') return
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.render() })
  }
  /** Draw the current state now (no-op when nothing changed, unless forced). */
  render(force = false): void {
    if (!this.dirty && !force) return
    this.dirty = false
    const frame = this.frame
    frame.run(() => {
      for (const [space, r] of this.renderers) this.guard(`rendering ${space}`, () => r.render(frame))
      // overlays: every layout first (in declared order, each seeing only what was laid out before it in THIS frame),
      // then every paint (in z order). Nothing an overlay draws can depend on the frame that was shown before.
      const laid = new Map<string, OverlayRect[]>()
      this.laidRects = laid
      for (const o of this.layoutOrder) {
        const name = o.def.name
        this.guard(`overlay "${name}" (layout)`, () => {
          const out = o.inst.layout?.(frame, {
            rects: (from?: string) => {
              if (from === undefined) return [...laid.values()].flat()
              if (!laid.has(from)) throw new Error(`overlay "${name}" reads the rectangles of "${from}", which is laid out later (or does not exist): add after: ['${from}'] to defineOverlay`)
              return laid.get(from)!
            },
          })
          laid.set(name, Array.isArray(out) ? out : [])
        })
        if (!laid.has(name)) laid.set(name, [])
      }
      for (const o of this.overlays) this.guard(`overlay "${o.def.name}"`, () => o.inst.paint(frame))
    })
    if (this.headless) this.repaintAll()
    this.emit('frame', frame)
  }
  /**
   * Headless frames are evidence (shots, check): each must be rastered from nothing. The browser repaints only what
   * it thinks changed, and its estimate misses the antialiased rim of a shape that moved by a fraction of a pixel, so
   * the same state gave different pixels after different histories. Taking the DOM layers out of the stage and putting
   * them back in the same task invalidates all of their pixels without changing the picture. (The WebGL canvas is
   * redrawn whole by the 3D renderer anyway.)
   */
  private repaintAll(): void {
    for (const el of [...this.stageEl.children]) {
      if (el.tagName === 'CANVAS') continue
      const next = el.nextSibling
      el.remove()
      this.stageEl.insertBefore(el, next)
    }
  }
  private guard(where: string, fn: () => void): void {
    try { fn() } catch (e) {
      const key = where + String((e as Error)?.message)
      if (!this.renderErrors.has(key)) { this.renderErrors.add(key); this.model.reportError(e, where, { t: this.tau }); console.error('[mimir]', where, e) }
    }
  }
  /** Resolves after the current state has been drawn and presented by the browser. */
  async settled(): Promise<void> {
    this.render()
    if (typeof requestAnimationFrame === 'undefined') return
    await new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())))
  }

  // ── projection helpers ───────────────────────────────────────────────────────────────────────────
  /** screen length in frame units → px */
  px(units: number): number { return units * this.scale }
  /** screen position in frame units (what Frame.project and Frame.frameRect return) → stage px (origin top-left, y down) */
  screenToStage(p: readonly number[]): { x: number; y: number } { return { x: ((p[0] ?? 0) + FRAME_W / 2) * this.scale, y: (FRAME_H / 2 - (p[1] ?? 0)) * this.scale } }
  /** stage px → screen position in frame units */
  stageToScreen(x: number, y: number): [number, number] { return [x / this.scale - FRAME_W / 2, FRAME_H / 2 - y / this.scale] }
  /** 2D point [x, y] (where 2D objects live) → stage px, through the 2D camera of the frame on screen */
  toStage(p: readonly number[]): { x: number; y: number } { return this.screenToStage(this.frame.toScreen(p)) }
  /** stage px → the 2D point drawn there (the inverse of toStage) */
  toFrame(x: number, y: number): [number, number] { const p = this.frame.fromScreen(this.stageToScreen(x, y)); return [p[0], p[1]] }
  /** Screen point of a node (centre), an anchor, a 3D point [x, y, z] or a 2D point [x, y]; `space` says which when the length cannot. */
  project(target: unknown, space?: CoordSpace): ScreenPoint {
    const q = this.frame.project(target, space)
    const s = this.screenToStage([q.x, q.y])
    return { x: s.x, y: s.y, visible: q.visible, depth: q.depth }
  }
  /** A screen rectangle in frame units (y up, x, y = min corner) → stage px (x, y = top-left). */
  rectToStage(r: Rect): Rect {
    const a = this.screenToStage([r.x, r.y + r.height])
    return { x: a.x, y: a.y, width: r.width * this.scale, height: r.height * this.scale }
  }
  /** Stage-px rectangle of a node: the measured box when a renderer can give one, else from pure maths. null when hidden. */
  screenRect(node: MNode): Rect | null {
    const frame = this.frame
    if (!isNode(node) || !frame.visible(node)) return null
    if (kindOf(node.kind)?.container || (!kindOf(node.kind)?.bounds && node.children.length)) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const c of node.children) {
        const r = this.screenRect(c)
        if (!r) continue
        x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.width); y1 = Math.max(y1, r.y + r.height)
      }
      return Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null
    }
    const measured = this.renderers.get(node.space)?.screenRect(node, frame)
    const own = measured ?? (() => { const r = frame.frameRect(node); return r ? this.rectToStage(r) : null })()
    if (!node.children.length) return own
    // a composite: what it draws itself plus its parts
    let x0 = own ? own.x : Infinity, y0 = own ? own.y : Infinity, x1 = own ? own.x + own.width : -Infinity, y1 = own ? own.y + own.height : -Infinity
    for (const c of node.children) {
      const r = this.screenRect(c)
      if (!r) continue
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.width); y1 = Math.max(y1, r.y + r.height)
    }
    return Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null
  }
  /** Top-most node under a stage-px point (2D above 3D). */
  pick(x: number, y: number): MNode | null {
    return this.renderers.get('2d')?.pick?.(x, y) ?? this.renderers.get('3d')?.pick?.(x, y) ?? null
  }
  /** Flat-colour id pass of the 3D panel for the current state; null when there is no 3D renderer. */
  /**
   * Rendered once per frame on screen and shared by everyone who asks (every check rule of a sample, label placement):
   * the result is kept until the state or the stage size changes.
   */
  idPass(opts?: { solo?: boolean }): IdPassResult | null {
    this.render()
    const r = this.renderers.get('3d')
    if (!r?.idPass) return null
    const frame = this.frame, size = this.width + 'x' + this.height
    if (!this.idPassMemo || this.idPassMemo.frame !== frame || this.idPassMemo.size !== size) this.idPassMemo = { frame, size, byKey: new Map() }
    const memo = this.idPassMemo.byKey
    const key = opts?.solo ? 'solo' : 'plain'
    // a solo pass contains everything a plain one does
    if (!memo.has(key)) memo.set(key, key === 'plain' && memo.get('solo') ? memo.get('solo')! : r.idPass(opts))
    return memo.get(key) ?? null
  }
  /** A pixel of a 3D part that is really visible (stage px), from the id pass; null when the part is hidden, covered, or not 3D. */
  visiblePoint(node: MNode): { x: number; y: number } | null {
    if (!isNode(node) || node.space !== '3d') return null
    return this.idPass()?.parts[node.id]?.at ?? null
  }
  /** Rectangles the overlays produced for the frame on screen (labels, captions, marks), in layout order. */
  overlayRects(): OverlayRect[] {
    this.render()
    return [...this.laidRects.values()].flat()
  }

  // ── events ───────────────────────────────────────────────────────────────────────────────────────
  on(event: RuntimeEvent, fn: (arg: any) => void): () => void {
    let set = this.listeners.get(event)
    if (!set) this.listeners.set(event, (set = new Set()))
    set.add(fn)
    return () => set!.delete(fn)
  }
  private emit(event: RuntimeEvent, arg: unknown): void {
    const set = this.listeners.get(event)
    if (set) for (const fn of [...set]) { try { fn(arg) } catch (e) { console.error('[mimir] listener', e) } }
  }
  dispose(): void {
    if (this.raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.raf)
    this.observer?.disconnect()
    for (const o of this.overlays) { try { o.inst.dispose?.() } catch { /* ignore */ } }
    for (const r of this.renderers.values()) { try { r.dispose() } catch { /* ignore */ } }
    this.overlays = []
    this.layoutOrder = []
    this.laidRects.clear()
    this.idPassMemo = null
    this.renderers.clear()
    this.stageEl?.remove()
  }
}
