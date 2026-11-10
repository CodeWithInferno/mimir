// SVG backend for 2D kinds. One <g> holder per drawing node, flat, painted in (z, creation) order. Every holder
// carries the whole transform of its node: the 2D camera (st.zoom) times the world transform from the core, so
// objects marked m.hud() simply skip the camera part and still interleave with the others in z.
// Text is real SVG text: crisp at any size, measurable for check. Many-particle kinds draw into a canvas layer
// (Ctx2D.canvas): a real <canvas> at device resolution that sits between the SVG holders in the same z order (the
// SVG is split into segments around it). A kind with a `clip` hook clips what its descendants draw.
import {
  apply, clamp01, defineKindBackend, defineRenderer, FRAME_H, FRAME_W, backendOf, kindOf, qzDeg, setMeasurer, smooth, spaceOf, INVALID_COLOR,
  type Frame, type MNode, type Rect, type Renderer, type Resolved, type Reveal, type Runtime, type TextMetrics, type Vec3, luminance,
} from '../core/index.ts'
import { arrowShape, bendControl, ends, K, layoutText, LINE_HEIGHT, textZoom } from './kinds.ts'
import { clearLineCache, faceStyle, FONT_MATH, FONT_TEXT, FONT_VARS } from './type.ts'

const NS = 'http://www.w3.org/2000/svg'
const INVALID = INVALID_COLOR
type Attrs = Record<string, string | number | null | undefined>

/** A canvas layer of one node (Ctx2D.canvas): return it from build(), draw into Ctx2D.begin(layer) in update(). */
export interface Canvas2D { canvas: HTMLCanvasElement }

/** What a 2D kind backend receives. */
export interface Ctx2D {
  /** SVG user units per frame unit (100) */
  K: number
  /** the frame being rendered */
  frame: Frame
  runtime: Runtime
  /**
   * How much the 2D camera magnifies the object being drawn (1 for objects in screen space). Divide a length by it
   * to keep it constant on screen: paint() does that for stroke widths and dashes, text does it for its size.
   */
  zoom: number
  /** create an SVG element */
  el<T extends SVGElement = SVGElement>(tag: string, attrs?: Attrs): T
  /** set attributes (null removes); skips values that did not change */
  set(el: Element, attrs: Attrs): void
  /**
   * Mark an element as drawable so enter verbs can reveal it: 'stroke' = an outline that can be drawn on (optionally
   * filled), 'fill' = a filled shape that fades in late (arrow tips), 'text' = glyphs.
   */
  draw<T extends SVGElement>(el: T, role: 'stroke' | 'fill' | 'text'): T
  /** stroke / fill / dash of a shape from the standard style options (color, fill, fillOpacity, stroke, strokeWidth, dashed) */
  paint(el: Element, r: Resolved, node: MNode, o?: { fillable?: boolean }): void
  /** the <defs> of the stage SVG: gradients, markers, patterns. Give every element in it an id from uid(). */
  defs: SVGDefsElement
  /** an id nobody else on the page has: c.uid('grad') → 'mimir-grad-7'. The same scene gets the same ids every time. */
  uid(prefix?: string): string
  /**
   * build(): a canvas in this node's place in the z order, for kinds that draw many small marks (particles, tokens,
   * trails). Return it: a canvas kind draws nothing else. The kind should be `worldGeometry: true` and give `bounds`.
   */
  canvas(): Canvas2D
  /**
   * update(): the 2D context of a canvas layer for this frame: sized to the stage, cleared, and set up so that
   * 1 unit = 1 frame unit with y up and the 2D camera applied, clipped like the node is, with globalAlpha = the
   * node's opacity and enter progress. Draw every mark of this frame; nothing survives from the frame before.
   */
  begin(layer: Canvas2D): CanvasRenderingContext2D
}

interface Handle {
  node: MNode
  /** outer holder: opacity, visibility, the clip of an ancestor */
  g: SVGGElement
  /** carries the transform (the same element as g unless the node is clipped) */
  inner: SVGGElement
  h: any
  drawables: SVGElement[]
  z: number
  order: number
  shown: boolean
  revealing: boolean
  hud: boolean
  /** set when the node draws on a canvas layer instead of SVG */
  layer: HTMLCanvasElement | null
  /** opacity × enter progress of a canvas node in the frame being drawn */
  alpha: number
  /** nearest ancestor whose kind clips its descendants */
  clipBy: MNode | null
  /** true for a 2D-world object of a scene whose 3D panel leaves a window for 2D: cut to that window while the 2D camera is zoomed */
  windowed: boolean
}

let uidSeq = 0
const last = new WeakMap<Element, Record<string, string | null>>()
function set(el: Element, attrs: Attrs): void {
  let rec = last.get(el)
  if (!rec) last.set(el, (rec = {}))
  for (const k in attrs) {
    const raw = attrs[k]
    const v = raw === null || raw === undefined ? null : typeof raw === 'number' ? String(Math.round(raw * 1000) / 1000) : raw
    if (rec[k] === v) continue
    rec[k] = v
    if (v === null) el.removeAttribute(k)
    else el.setAttribute(k, v)
  }
}
function el<T extends SVGElement = SVGElement>(tag: string, attrs?: Attrs): T {
  const e = document.createElementNS(NS, tag) as T
  if (attrs) set(e, attrs)
  return e
}
function draw<T extends SVGElement>(e: T, role: 'stroke' | 'fill' | 'text'): T {
  e.dataset.draw = role
  return e
}
/** the 2D camera's magnification for the node being drawn (set by the renderer before every backend call) */
let zoomNow = 1
/** dash and gap of a dashed outline, in stroke units, for a stroke of width sw */
export const dashOf = (sw: number): [number, number] => [Math.max(6, sw * 3.5), Math.max(5, sw * 3)]
function paint(e: Element, r: Resolved, node: MNode, o: { fillable?: boolean } = {}): void {
  const stroke = node.invalid ? INVALID : r.stroke ?? r.color ?? '#FFFFFF'
  const fill = o.fillable === false ? null : node.invalid ? null : r.fill ?? null
  const sw = r.strokeWidth ?? 2
  const dashed = !!r.dashed || node.invalid
  // widths belong to the frame, not to the 2D world: a line does not get thicker when the camera moves in (manim)
  const k = 1 / zoomNow
  const [dash, gap] = dashOf(sw)
  set(e, {
    stroke: sw > 0 ? stroke : 'none', 'stroke-width': sw * k, fill: fill ?? 'none', 'fill-opacity': fill ? r.fillOpacity ?? 1 : null,
    'stroke-dasharray': dashed ? `${r3(dash * k)} ${r3(gap * k)}` : null, 'stroke-linecap': dashed ? 'butt' : 'round', 'stroke-linejoin': 'round',
    'data-dashed': dashed ? '1' : null,
  })
}

// ── kind backends ────────────────────────────────────────────────────────────────────────────────────
/** colour of the outline behind text: the stage's black */
export const BACKSTROKE_COLOR = '#000000'
/** text darker than this (relative luminance) gets no outline: it sits on something light, where a black outline only smears it */
export const BACKSTROKE_FROM = 0.1
/** How text is written on (manim's Write): every glyph's outline is traced, then gives way to its fill; glyphs are lagged. */
export const WRITE = {
  /** glyph k starts min(lagMax, lagOver / (n + 1)) of one glyph's own duration after glyph k − 1 */
  lagMax: 0.2,
  lagOver: 4,
  /** length of outline traced in the first half of a glyph's time, in em: longer than any glyph's outline */
  reach: 5,
  /** width of the traced outline in stroke units: [per unit of font size, least, most] (manim: 2 at the default size) */
  stroke: [0.03, 0.9, 2] as const,
  /** the black outline behind a glyph is whole after this share of the glyph's own time (it arrives just ahead of the trace) */
  backBy: 0.25,
}
/** True when the story ever draws a node on (write / create), itself or through a group it is in: decided from the model, never from what was shown. */
function everDrawnOn(node: MNode): boolean {
  const drawn = (v: unknown): boolean => v === 'write' || v === 'create'
  if (node.model.selectorClipsFor('revealMode')?.some((c) => drawn(c.to))) return true
  for (let n: MNode | null = node; n; n = n.parent) {
    if (drawn(n.props.revealMode) || node.model.clipsFor(n, 'revealMode')?.some((c) => drawn(c.to))) return true
  }
  return false
}
interface TextHandle {
  g: SVGGElement
  /** the black outline behind the glyphs, as an element of its own when the text is ever written on */
  back: SVGTextElement | null
  front: SVGTextElement
  /** one <tspan> per visible glyph, in reading order (only when the text is ever written on) */
  glyphs: SVGTSpanElement[]
  /** the same glyphs of the outline behind them */
  backGlyphs: SVGTSpanElement[]
  written: boolean
  key: string
  /** per-glyph reveal attributes are in force */
  live: boolean
}
const TEXT_STYLE = 'font-variant-numeric:tabular-nums lining-nums;font-variant-ligatures:none;white-space:pre'
defineKindBackend<TextHandle, Ctx2D>('text', {
  build(node, c) {
    const g = c.el<SVGGElement>('g')
    const written = everDrawnOn(node)
    const back = written ? c.el<SVGTextElement>('text', { style: TEXT_STYLE, 'stroke-linejoin': 'round' }) : null
    const front = c.el<SVGTextElement>('text', { style: TEXT_STYLE, 'stroke-linejoin': 'round' })
    if (back) g.appendChild(back)
    g.appendChild(front)
    return { g, back, front, glyphs: [], backGlyphs: [], written, key: '', live: false }
  },
  update(h, r, c, node) {
    const lay = layoutText(r)
    const fs = lay.em * K
    // text keeps its size on screen: the holder magnifies by the camera's zoom, this takes it back out
    const zoom = textZoom(node, r, c.frame)
    c.set(h.g, { transform: zoom !== 1 ? `scale(${r5(1 / zoom)})` : null })
    const color = node.invalid ? INVALID : r.color
    // the outline behind the glyphs is a stroke like any other: its width belongs to the frame, also on text that grows with the zoom
    const back = typeof r.backstroke === 'number' && r.backstroke > 0 && luminance(color) >= BACKSTROKE_FROM ? (r.backstroke * zoom) / c.zoom : 0
    const common: Attrs = {
      'font-family': lay.face.family, 'font-size': fs, 'font-weight': lay.face.weight === 'bold' ? 'bold' : null, 'font-style': lay.face.italic ? 'italic' : null,
      'text-anchor': lay.align === 'left' ? 'start' : lay.align === 'right' ? 'end' : 'middle',
    }
    if (h.back) {
      c.set(h.back, { ...common, fill: BACKSTROKE_COLOR, stroke: BACKSTROKE_COLOR, 'stroke-width': back, display: back > 0 ? null : 'none' })
      c.set(h.front, { ...common, fill: color })
    } else c.set(h.front, { ...common, fill: color, stroke: back > 0 ? BACKSTROKE_COLOR : null, 'stroke-width': back > 0 ? back : null, 'paint-order': back > 0 ? 'stroke' : null })
    const key = `${fs}|${lay.align}|${r.font}|${faceStyle(lay.face)}|${lay.lines.join('\n')}`
    if (h.key !== key) {
      h.key = key
      h.glyphs = []
      h.backGlyphs = []
      h.live = true // new glyph elements: give them this frame's state below
      const n = lay.lines.length
      const x = lay.align === 'left' ? (-lay.width * K) / 2 : lay.align === 'right' ? (lay.width * K) / 2 : 0
      for (const t of h.back ? [h.back, h.front] : [h.front]) {
        t.textContent = ''
        lay.lines.forEach((ln, i) => {
          const span = document.createElementNS(NS, 'tspan')
          span.setAttribute('x', String(r2(x)))
          // centre the cap height of each line on its row (caps are 0.68 em tall)
          span.setAttribute('y', String(r2((i - (n - 1) / 2) * LINE_HEIGHT * fs + 0.34 * fs)))
          const dx = lay.metrics[i]!.dx
          if (h.written) {
            // one element per glyph, so each can be traced and filled on its own; kerning rides on dx
            for (let j = 0; j < ln.length; j++) {
              const code = ln.codePointAt(j)!
              const ch = String.fromCodePoint(code)
              const glyph = document.createElementNS(NS, 'tspan')
              if (dx && dx[j]) glyph.setAttribute('dx', String(r2(dx[j]! * fs)))
              glyph.textContent = ch
              span.appendChild(glyph)
              if (ch.trim()) (t === h.front ? h.glyphs : h.backGlyphs).push(glyph)
              if (code > 0xffff) j++
            }
          } else {
            span.textContent = ln
            if (dx) span.setAttribute('dx', dx.map((v) => r2(v * fs)).join(' '))
          }
          t.appendChild(span)
        })
      }
    }
    if (!h.written) return
    const rv = c.frame.reveal(node)
    const drawing = rv.p < 1 && rv.mode !== 'fade'
    if (!drawing && !h.live) return
    h.live = drawing
    const n = h.glyphs.length
    const lag = Math.min(WRITE.lagOver / (n + 1), WRITE.lagMax)
    const span = 1 + (n - 1) * lag
    const reach = WRITE.reach * fs
    const width = Math.min(Math.max(fs * WRITE.stroke[0], WRITE.stroke[1]), WRITE.stroke[2])
    for (let i = 0; i < n; i++) {
      const a = drawing ? clamp01(rv.p * span - i * lag) : 1
      const glyph = h.glyphs[i]!
      // the outline behind a glyph comes with that glyph, not before: nothing shows what is about to be written
      const behind = h.backGlyphs[i]
      if (behind) { const o = a >= 1 ? null : r4(clamp01(a / WRITE.backBy)); c.set(behind, { 'fill-opacity': o, 'stroke-opacity': o }) }
      if (a >= 1) c.set(glyph, { stroke: null, 'stroke-width': null, 'stroke-dasharray': null, 'stroke-opacity': null, 'fill-opacity': null })
      else if (a <= 0) c.set(glyph, { stroke: null, 'stroke-width': null, 'stroke-dasharray': null, 'stroke-opacity': null, 'fill-opacity': 0 })
      else {
        // first half: the outline is traced; second half: it gives way to the fill
        const draw = clamp01(a * 2), fill = clamp01(a * 2 - 1)
        c.set(glyph, { stroke: color, 'stroke-width': width, 'stroke-dasharray': `${r2(draw * reach)} ${r2(reach)}`, 'stroke-opacity': r4(1 - fill), 'fill-opacity': r4(fill) })
      }
    }
  },
})
defineKindBackend<SVGRectElement, Ctx2D>('rect', {
  build: (_n, c) => c.draw(c.el<SVGRectElement>('rect'), 'stroke'),
  update(e, r, c, node) {
    const w = r.width * K, h = r.height * K
    c.set(e, { x: -w / 2, y: -h / 2, width: w, height: h, rx: Math.min(r.radius * K, w / 2, h / 2) || null })
    c.paint(e, r, node)
  },
})
defineKindBackend<SVGCircleElement, Ctx2D>('circle', {
  build: (_n, c) => c.draw(c.el<SVGCircleElement>('circle'), 'stroke'),
  update(e, r, c, node) {
    c.set(e, { r: r.radius * K })
    c.paint(e, r, node)
  },
})
const P = (p: Vec3): string => `${Math.round(p[0] * K * 100) / 100} ${Math.round(-p[1] * K * 100) / 100}`
function pathOf(a: Vec3, b: Vec3, ctrl: Vec3 | null): string {
  return ctrl ? `M${P(a)} Q${P(ctrl)} ${P(b)}` : `M${P(a)} L${P(b)}`
}
defineKindBackend<SVGPathElement, Ctx2D>('line', {
  build: (_n, c) => c.draw(c.el<SVGPathElement>('path'), 'stroke'),
  update(e, r, c, node) {
    const [a, b] = ends(node, r, c.frame)
    c.set(e, { d: pathOf(a, b, bendControl(a, b, r.bend ?? 0)) })
    c.paint(e, r, node, { fillable: false })
  },
})
defineKindBackend<{ g: SVGGElement; shaft: SVGPathElement; tip: SVGPathElement }, Ctx2D>('arrow', {
  build(_n, c) {
    const g = c.el<SVGGElement>('g')
    // neither part is marked for the generic draw-on: an arrow draws itself on, with its head riding the front
    const shaft = c.el<SVGPathElement>('path')
    const tip = c.el<SVGPathElement>('path')
    g.append(shaft, tip)
    return { g, shaft, tip }
  },
  update(h, r, c, node) {
    const [a, b] = ends(node, r, c.frame)
    const rv = c.frame.reveal(node)
    const sw = r.strokeWidth ?? 4
    const shape = arrowShape(a, b, bendControl(a, b, r.bend ?? 0), { strokeWidth: sw, head: r.head, both: !!r.both, upTo: rv.mode !== 'fade' && rv.p < 1 ? rv.p : 1, shrink: c.zoom })
    c.set(h.shaft, { d: pathOf(shape.a, shape.b, shape.ctrl) })
    c.paint(h.shaft, r, node, { fillable: false })
    c.set(h.shaft, { 'stroke-linecap': 'butt' })
    const color = node.invalid ? INVALID : r.color
    c.set(h.tip, { d: shape.heads.map((p) => `M${P(p[0])} L${P(p[1])} L${P(p[2])} L${P(p[3])} Z`).join(' ') || null, fill: color, stroke: color, 'stroke-width': Math.min(sw, 1) / c.zoom, 'stroke-linejoin': 'round' })
  },
})
/** what an unknown / unbuildable 2D object becomes: a small red cross */
defineKindBackend<SVGPathElement, Ctx2D>('placeholder', {
  build: (_n, c) => c.el<SVGPathElement>('path', { d: 'M-14 -14 L14 14 M-14 14 L14 -14', stroke: INVALID, 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }),
})

// ── renderer ─────────────────────────────────────────────────────────────────────────────────────────
function installMeasurer(): void {
  const canvas = document.createElement('canvas')
  const g = canvas.getContext('2d')
  if (!g) return
  const cache = new Map<string, TextMetrics>()
  // widths estimated before there was a canvas (while the scene was being built) are measured again from now on
  clearLineCache()
  setMeasurer((text, weight, font) => {
    const key = weight + '|' + font + '|' + text
    let m = cache.get(key)
    if (!m) {
      g.font = `${weight} 200px ${font}`
      const tm = g.measureText(text)
      m = { width: tm.width / 200, ascent: (tm.actualBoundingBoxAscent || 138) / 200, descent: (tm.actualBoundingBoxDescent || 40) / 200 }
      if (cache.size > 4000) cache.clear()
      cache.set(key, m)
    }
    return m
  })
}

/** How a shape is drawn on, as shares of the enter progress. */
export const CREATE = {
  /** the outline is complete at this point */
  strokeEnd: 0.8,
  /** the fill starts to arrive here and is whole at the end */
  fillStart: 0.55,
  /** width (stroke units) of the outline a shape with no stroke is traced with */
  trace: 2,
}

class Svg2D implements Renderer {
  private rt!: Runtime
  private root!: HTMLDivElement
  /** SVG segments, in paint order: a new one starts after every canvas layer */
  private svgs: SVGSVGElement[] = []
  private defs!: SVGDefsElement
  private handles: Handle[] = []
  private byNode = new Map<number, Handle>()
  private ctx!: Ctx2D
  private building: Handle | null = null
  /** clip rectangle element of each clipping node, by node uid */
  private clips = new Map<number, { node: MNode; id: string; rect: SVGRectElement }>()
  /** the part of the frame 2D content has to itself beside a 3D panel (model.area2d), and its clip path */
  private window: { x: number; y: number; width: number; height: number } | null = null
  private windowId = ''
  private zoomed = false

  mount(rt: Runtime): void {
    this.rt = rt
    installMeasurer()
    // the faces every module's text on the stage is set in (the fonts chunk has registered them by now)
    rt.stageEl.style.setProperty(FONT_VARS.text, FONT_TEXT)
    rt.stageEl.style.setProperty(FONT_VARS.math, FONT_MATH)
    this.root = document.createElement('div')
    this.root.className = 'mimir-2d-layers'
    this.root.style.cssText = 'position:absolute;inset:0;z-index:2;pointer-events:none;overflow:hidden'
    rt.stageEl.appendChild(this.root)
    // ids in <defs> are document-wide, so one <defs> serves every segment
    this.defs = el<SVGDefsElement>('defs')
    this.segment(0).appendChild(this.defs)
    const self = this
    this.ctx = {
      K, frame: rt.frame, runtime: rt, zoom: 1, el, set, draw, paint, defs: this.defs,
      uid: (prefix = 'id') => `mimir-${prefix}-${++uidSeq}`,
      canvas() {
        const canvas = document.createElement('canvas')
        canvas.className = 'mimir-2d-canvas'
        canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block'
        if (self.building) { self.building.layer = canvas; canvas.dataset.node = self.building.node.id }
        return { canvas }
      },
      begin(layer) {
        const st = rt.stage()
        const dpr = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 3)
        const w = Math.max(1, Math.round(st.width * dpr)), h = Math.max(1, Math.round(st.height * dpr))
        const cv = layer.canvas
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
        const g = cv.getContext('2d')!
        // start from a clean state every frame: the clip and alpha of the frame before are dropped, then everything is wiped
        g.restore()
        g.save()
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.clearRect(0, 0, w, h)
        const hd = self.building
        const frame = self.ctx.frame
        const cam = hd?.hud ? { center: [0, 0], zoom: 1 } : frame.camera2d()
        const k = (w / FRAME_W) * cam.zoom
        // while the 2D camera is zoomed, 2D-world content stays inside its window beside the 3D panel
        const win = hd?.windowed && self.zoomed ? self.window : null
        if (win) {
          const u = w / FRAME_W
          g.beginPath()
          g.rect((win.x + FRAME_W / 2) * u, (FRAME_H / 2 - win.y - win.height) * u, win.width * u, win.height * u)
          g.clip()
        }
        // frame units, y up, through the 2D camera → canvas pixels; the node's own shift and offset move its marks too
        const o = hd ? frame.world(hd.node).p : [0, 0, 0]
        g.setTransform(k, 0, 0, -k, w / 2 + (o[0]! - cam.center[0]!) * k, h / 2 - (o[1]! - cam.center[1]!) * k)
        // the clip of a clipping ancestor and the node's opacity live in the drawing itself, not in the compositor
        const clip = hd?.clipBy ? self.clipCorners(hd.clipBy, frame) : null
        if (clip) {
          g.beginPath()
          clip.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])))
          g.closePath()
          g.clip()
        }
        g.globalAlpha = hd ? hd.alpha : 1
        return g
      },
    }
    this.window = rt.model.area2d()
    if (this.window) {
      const w = this.window
      this.windowId = this.ctx.uid('window')
      const path = el('clipPath', { id: this.windowId, clipPathUnits: 'userSpaceOnUse' })
      path.appendChild(el('rect', { x: w.x * K, y: -(w.y + w.height) * K, width: w.width * K, height: w.height * K }))
      this.defs.appendChild(path)
    }
    let order = 0
    for (const node of rt.model.nodes) {
      if (node.space !== '2d') continue
      const backend = backendOf(node.kind)
      if (!backend) continue // containers and kinds without a drawing
      let clipBy: MNode | null = null
      for (let p = node.parent; p && !clipBy; p = p.parent) if (kindOf(p.kind)?.clip) clipBy = p
      const g = el<SVGGElement>('g')
      g.dataset.node = node.id
      const hud = spaceOf(node) === 'hud'
      const windowed = !!this.window && !hud
      // g: opacity, visibility, the window clip. host: the clip of a clipping ancestor. inner: the transform.
      let host = g
      if (windowed && clipBy) { host = el<SVGGElement>('g'); g.appendChild(host) }
      let inner = host
      if (windowed && !clipBy) { inner = el<SVGGElement>('g'); host.appendChild(inner) }
      if (clipBy) {
        let c = this.clips.get(clipBy.uid)
        if (!c) {
          const id = this.ctx.uid('clip')
          const path = el('clipPath', { id, clipPathUnits: 'userSpaceOnUse' })
          const rect = el<SVGRectElement>('rect')
          path.appendChild(rect)
          this.defs.appendChild(path)
          this.clips.set(clipBy.uid, (c = { node: clipBy, id, rect }))
        }
        host.setAttribute('clip-path', `url(#${c.id})`)
        inner = el<SVGGElement>('g')
        host.appendChild(inner)
      }
      const handle: Handle = { node, g, inner, h: null, drawables: [], z: 0, order: order++, shown: true, revealing: false, hud, layer: null, alpha: 1, clipBy, windowed }
      this.building = handle
      try {
        const h = (handle.h = backend.build(node, this.ctx))
        const root: SVGElement | undefined = h instanceof SVGElement ? h : h?.g ?? h?.el
        if (root instanceof SVGElement && !handle.layer) inner.appendChild(root)
      } catch (e) { rt.model.reportError(e, `building #${node.id}`, { ids: [node.id] }) }
      this.building = null
      handle.drawables = [...inner.querySelectorAll<SVGElement>('[data-draw]')]
      this.handles.push(handle)
      this.byNode.set(node.uid, handle)
    }
    this.relayer()
  }

  private segment(i: number): SVGSVGElement {
    const W = FRAME_W * K, H = FRAME_H * K
    let svg = this.svgs[i]
    if (!svg) {
      svg = this.svgs[i] = el<SVGSVGElement>('svg', { viewBox: `${-W / 2} ${-H / 2} ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet', class: 'mimir-2d' })
      svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden;text-rendering:geometricPrecision'
    }
    return svg
  }
  /** Put every holder in paint order (z, then creation): SVG holders into segments, each canvas layer between two segments. */
  private relayer(): void {
    const sorted = [...this.handles].sort((a, b) => a.z - b.z || a.order - b.order)
    let i = 0
    this.root.appendChild(this.segment(0))
    for (const hd of sorted) {
      if (hd.layer) { this.root.appendChild(hd.layer); this.root.appendChild(this.segment(++i)) }
      else this.segment(i).appendChild(hd.g)
    }
    for (let k = this.svgs.length - 1; k > i; k--) { this.svgs[k]!.remove(); this.svgs.pop() }
  }

  /** transform attribute of a node's holder: the 2D camera (not for hud objects) times its world transform */
  private transformOf(node: MNode, frame: Frame, hud: boolean): string {
    const w = frame.world(node)
    const cam = hud ? null : frame.camera2d()
    const zoom = cam ? cam.zoom : 1
    const x = (w.p[0] - (cam ? cam.center[0] : 0)) * zoom, y = (w.p[1] - (cam ? cam.center[1] : 0)) * zoom
    const deg = qzDeg(w.q), s = w.s * zoom
    return `translate(${r2(x * K)} ${r2(-y * K)})${Math.abs(deg) > 1e-9 ? ` rotate(${r2(-deg)})` : ''}${Math.abs(s - 1) > 1e-9 ? ` scale(${r4(s)})` : ''}`
  }
  /** corners of a node's clip rectangle in 2D coordinates (the node's own transform applied), or null when it clips nothing now */
  private clipCorners(node: MNode, frame: Frame): Vec3[] | null {
    const r = kindOf(node.kind)?.clip?.(node, frame.props(node), frame)
    if (!r) return null
    const w = frame.world(node)
    return ([[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height], [r.x, r.y + r.height]] as const).map((c) => apply(w, [c[0], c[1], 0]))
  }

  render(frame: Frame): void {
    this.ctx.frame = frame
    for (const c of this.clips.values()) {
      const r = kindOf(c.node.kind)?.clip?.(c.node, frame.props(c.node), frame)
      // no rectangle = nothing is clipped: a rectangle far larger than the frame
      if (!r) set(c.rect, { x: -1e6, y: -1e6, width: 2e6, height: 2e6, transform: null })
      else set(c.rect, { x: r.x * K, y: -(r.y + r.height) * K, width: r.width * K, height: r.height * K, transform: this.transformOf(c.node, frame, spaceOf(c.node) === 'hud') })
    }
    let resort = false
    this.zoomed = !!this.window && frame.zoomed()
    const cam = frame.camera2d()
    const zoom = cam.zoom > 0 && Number.isFinite(cam.zoom) ? cam.zoom : 1
    for (const hd of this.handles) {
      const node = hd.node
      const rv = frame.reveal(node)
      const op = frame.opacity(node) * (1 - 0.75 * frame.dim(node))
      const shown = rv.p > 0 && op > 0
      if (shown !== hd.shown) { hd.shown = shown; (hd.layer ?? hd.g).style.display = shown ? '' : 'none' }
      if (!shown) continue
      // a part is stacked with its composite: its own z on top of its ancestors'
      const z = frame.z(node)
      if (z !== hd.z) { hd.z = z; resort = true }
      if (hd.windowed && !hd.layer) set(hd.g, { 'clip-path': this.zoomed ? `url(#${this.windowId})` : null })
      // a canvas layer is screen-aligned: its drawing context carries the camera (and the opacity) instead
      if (hd.layer) hd.alpha = clamp01(op * rv.p)
      else set(hd.inner, { transform: this.transformOf(node, frame, hd.hud) })
      const backend = backendOf(node.kind)
      zoomNow = this.ctx.zoom = hd.hud ? 1 : zoom
      if (backend?.update) {
        this.building = hd
        try { backend.update(hd.h, frame.props(node), this.ctx, node) } catch (e) { this.rt.model.reportError(e, `drawing #${node.id}`, { ids: [node.id], t: frame.tau }) }
        this.building = null
      }
      if (!hd.layer) this.reveal(hd, rv, op)
    }
    if (resort) this.relayer()
  }

  /**
   * Enter / exit look. fade: opacity. create / write: every outline is drawn on from its start, and the fill arrives
   * at the end (manim's ShowCreation / DrawBorderThenFill). A dashed outline keeps its dashes while it grows; a shape
   * with no outline is traced in its fill colour first. Text and arrows draw themselves on in their backends.
   */
  private reveal(hd: Handle, rv: Reveal, op: number): void {
    const p = rv.p
    const drawOn = p < 1 && rv.mode !== 'fade'
    set(hd.g, { opacity: drawOn ? (op < 1 ? op : null) : op * p < 1 ? op * p : null })
    if (!drawOn) {
      if (hd.revealing) {
        hd.revealing = false
        for (const e of hd.drawables) { e.style.cssText = ''; e.removeAttribute('pathLength') }
      }
      return
    }
    hd.revealing = true
    const traced = clamp01(p / CREATE.strokeEnd)
    const filled = smooth(clamp01((p - CREATE.fillStart) / (1 - CREATE.fillStart)))
    for (const e of hd.drawables) {
      const role = e.dataset.draw
      if (role === 'stroke') {
        if (e.getAttribute('stroke') === 'none') {
          // a filled shape with no outline: trace it in its own colour, and let the trace go as the fill arrives
          const fill = e.getAttribute('fill')
          if (fill && fill !== 'none') { e.style.stroke = fill; e.style.strokeWidth = String(r3(CREATE.trace / zoomNow)); e.style.strokeOpacity = String(r4(1 - filled)) }
        }
        if (e.dataset.dashed) {
          // the dashes stay where they are and more of them show: the pattern is cut off at the length drawn so far
          const dashes = (e.getAttribute('stroke-dasharray') ?? '').split(/[\s,]+/).map(Number)
          const dash = dashes[0]! > 0 ? dashes[0]! : 1, gap = dashes[1]! > 0 ? dashes[1]! : dash
          const length = (e as unknown as SVGGeometryElement).getTotalLength?.() ?? 0
          const shown = traced * length
          const whole = Math.floor(shown / (dash + gap))
          e.style.strokeDasharray = `${`${dash} ${gap} `.repeat(whole)}${r3(Math.min(shown - whole * (dash + gap), dash))} ${r3(length + dash + gap)}`
        } else {
          e.setAttribute('pathLength', '1')
          e.style.strokeDasharray = '1 1'
          e.style.strokeDashoffset = String(r4(1 - traced))
        }
        const base = parseFloat(e.getAttribute('fill-opacity') ?? '1')
        e.style.fillOpacity = String(r4(base * filled))
      } else if (role === 'fill') {
        e.style.opacity = String(r4(filled))
      }
    }
  }

  resize(): void { /* the viewBoxes scale with the stage; canvas layers are resized when they are next drawn */ }

  screenRect(node: MNode, frame: Frame): Rect | null {
    const hd = this.byNode.get(node.uid)
    // a canvas layer covers the whole stage: only the kind's bounds can say where its marks are
    if (!hd || !hd.shown || hd.layer) return null
    const s = this.rt.stageEl.getBoundingClientRect()
    // text: the box of its glyphs, without the black outline behind them (which would make every label look larger)
    const glyphs: SVGTextElement | undefined = hd.h?.front instanceof SVGTextElement ? hd.h.front : undefined
    const b = (glyphs && boxOnScreen(glyphs)) ?? hd.inner.getBoundingClientRect()
    if (!(b.width > 0 || b.height > 0)) return null
    let x0 = b.left - s.left, y0 = b.top - s.top, x1 = x0 + b.width, y1 = y0 + b.height
    const clip = hd.clipBy ? this.clipCorners(hd.clipBy, frame) : null
    if (clip) {
      // the DOM box ignores clipping: cut it down to what the clipping ancestor lets through
      const pts = clip.map((p) => this.rt.screenToStage(hd.hud ? p : frame.toScreen(p)))
      x0 = Math.max(x0, Math.min(...pts.map((p) => p.x))); x1 = Math.min(x1, Math.max(...pts.map((p) => p.x)))
      y0 = Math.max(y0, Math.min(...pts.map((p) => p.y))); y1 = Math.min(y1, Math.max(...pts.map((p) => p.y)))
      if (x1 <= x0 || y1 <= y0) return null
    }
    if (hd.windowed && this.zoomed && this.window) {
      // …and to the window the zoomed 2D world is shown through
      const w = this.rt.rectToStage(this.window)
      x0 = Math.max(x0, w.x); x1 = Math.min(x1, w.x + w.width); y0 = Math.max(y0, w.y); y1 = Math.min(y1, w.y + w.height)
      if (x1 <= x0 || y1 <= y0) return null
    }
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
  }

  pick(x: number, y: number): MNode | null {
    const sorted = [...this.handles].sort((a, b) => b.z - a.z || b.order - a.order)
    const frame = this.rt.frame
    for (const hd of sorted) {
      if (!hd.shown || kindOf(hd.node.kind)?.worldGeometry) continue
      const r = this.screenRect(hd.node, frame)
      if (r && x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return hd.node
    }
    return null
  }

  dispose(): void {
    setMeasurer(null)
    this.root?.remove()
    this.svgs = []
    this.handles = []
    this.byNode.clear()
    this.clips.clear()
  }
}
/** The geometry box of an SVG element (no stroke) in client coordinates, or null when it cannot be measured. */
function boxOnScreen(e: SVGGraphicsElement): { left: number; top: number; width: number; height: number } | null {
  try {
    const bb = e.getBBox(), m = e.getScreenCTM()
    if (!m || !(bb.width > 0 || bb.height > 0)) return null
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [x, y] of [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height]] as const) {
      const px = m.a * x + m.c * y + m.e, py = m.b * x + m.d * y + m.f
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py)
    }
    return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 }
  } catch { return null }
}
const r2 = (x: number): number => Math.round(x * 100) / 100
const r3 = (x: number): number => Math.round(x * 1000) / 1000
const r4 = (x: number): number => Math.round(x * 10000) / 10000
const r5 = (x: number): number => Math.round(x * 100000) / 100000

defineRenderer('2d', () => new Svg2D())
