// src/guide/guide.chunk.ts: the drawing side of the guide (dist/mimir.guide.js), loaded for scenes that speak or label.
// Four overlays, each a pure function of the frame: guide.marks (rings that hug their part, arrows, halos, touch-down
// rings), guide.labels (typeset names on leaders: in two columns beside a 3D figure, beside the object on the flat
// stage, on the line for a line), guide.caption (one line, lit by the word) and guide.pointer (the dart: it rests on
// the edge of its part, on free space, never on text). Nothing here takes pointer events, reads a clock or remembers a
// frame: caches are keyed by their inputs. Every number comes from GUIDE_DEFAULTS (./index.ts) through guideConfig.
import {
  anchorRef, defineOverlay, FRAME_H, FRAME_W, isNode, kindOf, mix, parseColor, SAFE_X, SAFE_Y, smooth, spaceOf,
  type Action, type Frame, type MNode, type OverlayCtx, type OverlayLaid, type OverlayRect, type Rect,
} from '../core/index.ts'
import { faceOf, FONT_TEXT, lineMetrics } from '../r2d/index.ts'
import { partEdge, partOutline } from '../r3d/index.ts'
import { DOCK, guidePose, REST_ANGLE_DEG } from '../lib/guide/pose.ts'
import { markProgress } from '../lib/guide/marks.ts'
import type { GuideCue } from '../lib/guide/types.ts'
import { placeLabels, type LabelSide } from '../lib/layout/labels.ts'
import { guideConfig, guideStore, markColor, partColor, type GuideConfig, type GuideCueRec, type GuideLine, type GuideStep, type LabelData } from './index.ts'
import { boxEdge, choosePerch, ellipseEdge, glyphAlpha, hullOutline, outlinePoints, solveLabels, wrapLabel, type LabelKeep, type LabelObstacle, type Perch } from './solver.ts'
import { startVoice } from './voice.ts'

interface P { x: number; y: number }
const SVG = 'http://www.w3.org/2000/svg'
const c01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x)
const n1 = (x: number): string => (Math.round(x * 10) / 10).toString()
/** a colour that is safe to write into markup: anything the colour parser does not know becomes the fallback */
const paint = (color: string, fallback: string): string => (parseColor(color) && /^[#\w(),.%\s-]+$/.test(color) ? color : fallback)

// ── geometry shared by the four overlays (stage px, y down) ──────────────────────────────────────────
/** What the overlays of one frame tell each other. */
interface Shared {
  /** by node id: where the leader of its name ends on the part, and the turn of a dart that rests there (degrees clockwise from "hanging straight below") */
  dots: Map<string, P>; aims: Map<string, number>
  /** every name of the steps on screen, shown or still to come: a resting pointer covers none of them */
  names: Rect[]
  /** by step:cue: where the pointer lands and how it is turned there */
  touch: Map<string, { at: P; angle: number } | null>
}
const sharedByFrame = new WeakMap<Frame, Shared>()
const shared = (frame: Frame): Shared => { let s = sharedByFrame.get(frame); if (!s) sharedByFrame.set(frame, (s = { dots: new Map(), aims: new Map(), names: [], touch: new Map() })); return s }

const leavesOf = (node: MNode): MNode[] => (node.children.length ? node.children.flatMap(leavesOf) : [node])
const centerOf = (r: Rect): P => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by })
const union = (a: Rect | null, b: Rect | null): Rect | null => {
  if (!a || !b) return a ?? b
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}
const finite = (p: P): boolean => Number.isFinite(p.x + p.y)
const toStageRect = (c: OverlayCtx, r: Rect | null): Rect | null => (r && Number.isFinite(r.x + r.y + r.width + r.height) ? c.runtime.rectToStage(r) : null)
/** The points of the first contour of a flat shape's outline, in stage px, and whether that contour is closed. */
function contourOf(c: OverlayCtx, frame: Frame, node: MNode): { points: P[]; closed: boolean } | null {
  const CURVE_SAMPLES = Math.max(2, Math.round(guideConfig(c.model).outlineSamples))
  if (node.space !== '2d' || node.children.length || kindOf(node.kind)?.container) return null
  const hud = spaceOf(node) === 'hud'
  for (const sub of frame.outline(node)) {
    const k = sub.coords, out: P[] = []
    const put = (x: number, y: number): void => { out.push(c.runtime.screenToStage(hud ? [x, y] : frame.toScreen([x, y]))) }
    if (k.length < 2) continue
    put(k[0]!, k[1]!)
    for (let i = 2; i + 5 < k.length; i += 6) {
      const x0 = k[i - 2]!, y0 = k[i - 1]!
      for (let s = 1; s <= CURVE_SAMPLES; s++) { const t = s / CURVE_SAMPLES, a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, d = 3 * (1 - t) * t * t, e = t ** 3; put(a * x0 + b * k[i]! + d * k[i + 2]! + e * k[i + 4]!, a * y0 + b * k[i + 1]! + d * k[i + 3]! + e * k[i + 5]!) }
    }
    if (out.length >= 2 && out.every(finite)) return { points: out, closed: sub.closed } // the outer contour is enough to touch, to hug and to halo
  }
  return null
}
/** The outline of a flat shape as a closed polygon in stage px; null when it has none of its own (text, groups, lines). */
function outlineOf(c: OverlayCtx, frame: Frame, node: MNode): P[] | null {
  if (kindOf(node.kind)?.worldGeometry) return null
  const k = contourOf(c, frame, node)
  return k && k.closed && k.points.length >= 3 ? k.points : null
}
/** The middle of an open line, by length: where the name of a line sits and where the pointer touches it. */
function middleOf(points: readonly P[]): { at: P; along: P } {
  let total = 0
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y)
  let left = total / 2
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, d = Math.hypot(b.x - a.x, b.y - a.y)
    if (d >= left && d > 0) return { at: { x: a.x + ((b.x - a.x) * left) / d, y: a.y + ((b.y - a.y) * left) / d }, along: { x: (b.x - a.x) / d, y: (b.y - a.y) / d } }
    left -= d
  }
  return { at: points[0]!, along: { x: 1, y: 0 } }
}
/** Where the ray from `o` along `d` leaves a polygon (the farthest crossing), or null. */
function exitOf(poly: readonly P[], o: P, d: P): P | null {
  let best = -1
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!
    const ex = b.x - a.x, ey = b.y - a.y, den = d.x * ey - d.y * ex
    if (Math.abs(den) < 1e-9) continue
    const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / den, s = ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / den
    if (t > best && s >= -1e-6 && s <= 1 + 1e-6) best = t
  }
  return best > 0 ? { x: o.x + d.x * best, y: o.y + d.y * best } : null
}
/** A closed circle as one stroke that starts at the top and runs clockwise (drawn on with a dash of its own length). */
const ringPath = (o: P, r: number): string => `M${n1(o.x)} ${n1(o.y - r)}A${n1(r)} ${n1(r)} 0 0 1 ${n1(o.x)} ${n1(o.y + r)}A${n1(r)} ${n1(r)} 0 0 1 ${n1(o.x)} ${n1(o.y - r)}`
const rectPoly = (r: Rect): P[] => [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }]
/**
 * Points whose convex hull is the silhouette of an object on screen: the projected hull of a 3D part (of every part
 * inside an assembly), the outline of a flat shape, the corners of the box of anything else.
 */
function silhouettePoints(c: OverlayCtx, frame: Frame, node: MNode): P[] {
  if (!frame.visible(node)) return []
  if (node.space === '3d') {
    // what can be seen of the part, from the id pass of the frame on screen: tighter than any box round it
    if (frame === c.runtime.frame) {
      const pass = c.runtime.idPass(), seen = leavesOf(node).flatMap((leaf) => partOutline(pass, leaf.id))
      if (seen.length >= 3) return seen
    }
    return frame.hull(node).map((p) => { const q = frame.project3(p); return c.runtime.screenToStage([q.x, q.y]) }).filter(finite)
  }
  if (node.children.length) return node.children.flatMap((child) => silhouettePoints(c, frame, child)).concat(kindOf(node.kind)?.container ? [] : rectPoly(c.screenRect(node) ?? { x: NaN, y: NaN, width: 0, height: 0 }).filter(finite))
  const k = contourOf(c, frame, node)
  if (k) return k.points
  const r = c.screenRect(node)
  return r ? rectPoly(r) : []
}
/** The part of a 3D object that shows most in the id pass (itself when it is one part), with the pixel the pass gives for it. */
function seenPart(c: OverlayCtx, node: MNode): { id: string; at: P } | null {
  const parts = c.runtime.idPass()?.parts
  if (!parts) return null
  let best: { id: string; at: P } | null = null, most = 0
  for (const leaf of leavesOf(node)) { const p = parts[leaf.id]; if (p?.at && p.pixels > most) { most = p.pixels; best = { id: leaf.id, at: p.at } } }
  return best
}
/**
 * Where an object is met when it is approached from `from` (stage px): the silhouette of a 3D part along that ray (from
 * the id pass, so it is a pixel that is really visible), the outline of a flat shape, the box of anything else. With
 * `anchor`, the named anchor as it is projected. null when the object is hidden.
 */
function edgeToward(c: OverlayCtx, frame: Frame, node: MNode, anchor: string | null, from: P, thin: number): P | null {
  if (!frame.visible(node)) return null
  if (anchor) { const q = c.project(anchorRef(node, anchor)); return finite(q) ? { x: q.x, y: q.y } : null }
  if (node.space === '3d') {
    const seen = seenPart(c, node)
    if (seen) return partEdge(c.runtime.idPass(), seen.id, from, seen.at) ?? seen.at
    const r = c.screenRect(node)
    if (r) { const o = centerOf(r), len = Math.hypot(from.x - o.x, from.y - o.y); return len > 1e-6 ? ellipseEdge(r, { x: (from.x - o.x) / len, y: (from.y - o.y) / len }) : o }
    const q = c.project(node)
    return finite(q) ? { x: q.x, y: q.y } : null
  }
  const k = contourOf(c, frame, node)
  if (k && !k.closed) return middleOf(k.points).at // a line is touched on the line
  const r = c.screenRect(node)
  if (!r) return null
  const o = centerOf(r)
  if (Math.min(r.width, r.height) < thin) return o
  const len = Math.hypot(from.x - o.x, from.y - o.y)
  if (!(len > 1e-6)) return o
  const d = { x: (from.x - o.x) / len, y: (from.y - o.y) / len }
  return exitOf(outlineOf(c, frame, node) ?? rectPoly(r), o, d) ?? o
}
/** Tail and head of an arrow cue: where the line between the two parts leaves each of them. */
function arrowEnds(c: OverlayCtx, frame: Frame, cue: GuideCueRec, thin: number): [P, P] | null {
  const a = cue.nodes[0], b = cue.nodes[1]
  if (!a || !b) return null
  const middle = (n: MNode): P | null => { const r = c.screenRect(n); return r ? centerOf(r) : null }
  const ca = middle(a), cb = middle(b)
  if (!ca || !cb) return null
  const pa = edgeToward(c, frame, a, cue.anchors[0] ?? null, cb, thin), pb = edgeToward(c, frame, b, cue.anchors[1] ?? null, ca, thin)
  return pa && pb ? [pa, pb] : null
}
/** Where the caption line sits: its top edge and its height (constant, so labels and the dock never move with the text). */
const captionZone = (c: OverlayCtx, cfg: GuideConfig): { top: number; height: number } => {
  const height = c.px(cfg.captionSize * cfg.captionLine)
  return { top: c.stage().height - c.px(cfg.captionBottom) - height, height }
}
/** The steps whose marks can be on screen: this one, the one before while its marks clear, and earlier ones that hold marks. */
function liveSteps(frame: Frame): { gs: GuideStep; u: number; alpha: number; held: boolean }[] {
  const store = guideStore(frame.model), out: { gs: GuideStep; u: number; alpha: number; held: boolean }[] = []
  for (const gs of store.steps.values()) {
    if (gs.index > frame.k) continue
    const rec = frame.model.steps[gs.index]
    if (!rec) continue
    const u = frame.tau - rec.t0
    if (gs.index === frame.k) out.push({ gs, u, alpha: 1, held: false })
    else {
      const alpha = frame.release(gs.index)
      if (alpha > 0) out.push({ gs, u, alpha, held: false })
      else if (gs.cues.some((q) => q.hold)) out.push({ gs, u, alpha: 1, held: true })
    }
  }
  return out.sort((a, b) => a.gs.index - b.gs.index)
}
const cueColor = (frame: Frame, cue: GuideCueRec, cfg: GuideConfig): string => markColor(frame, cue.nodes[cue.arrow ? cue.nodes.length - 1 : 0], cfg.markColor, cfg.ink)
/** Is `a` the same object as `b`, inside it, or round it? (A name for an assembly is lit by a word for one of its parts, and the other way round.) */
const related = (a: MNode, b: MNode): boolean => { for (let p: MNode | null = a; p; p = p.parent) if (p === b) return true; for (let p: MNode | null = b; p; p = p.parent) if (p === a) return true; return false }
/** Every piece of text the scene itself shows in a frame, as stage rectangles (text objects and the text inside kinds). */
function sceneTexts(c: OverlayCtx, frame: Frame): Rect[] {
  const out: Rect[] = []
  for (const n of frame.model.nodes) {
    const kind = kindOf(n.kind)
    if (!kind || (!kind.text && !kind.textRects) || !frame.visible(n)) continue
    for (const t of frame.textRects(n)) { const r = toStageRect(c, t.rect); if (r && r.width > 0 && r.height > 0) out.push(r) }
  }
  return out
}
/** A key for everything a reference state depends on besides its time: the camera on screen, dragged params, the stage. */
const viewKey = (c: OverlayCtx, frame: Frame): string => { const s = c.stage(); return `${s.width}x${s.height}|${c.model.has3d ? JSON.stringify(frame.camera()) : ''}|${JSON.stringify(frame.overrides)}` }

// ── marks: rings, arrows, halos round flat shapes, the touch-down ring ────────────────────────────────
defineOverlay({
  name: 'guide.marks',
  z: 9,
  create(c) {
    const svg = document.createElementNS(SVG, 'svg')
    svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;overflow:visible')
    c.root.appendChild(svg)
    let markup = '', shown = ''
    return {
      layout(frame: Frame): OverlayRect[] {
        const cfg = guideConfig(c.model), rects: OverlayRect[] = []
        const w = Math.max(1, c.px(cfg.markWidth)), thin = c.px(cfg.thin)
        let out = ''
        const stroke = (d: string, color: string, opacity: number, dash = ''): void => {
          out += `<path d="${d}" fill="none" stroke="#000" stroke-width="${n1(w * 3)}" stroke-linecap="round" opacity="${(opacity * 0.7).toFixed(3)}"${dash}/><path d="${d}" fill="none" stroke="${color}" stroke-width="${n1(w)}" stroke-linecap="round" opacity="${opacity.toFixed(3)}"${dash}/>`
        }
        for (const { gs, u, alpha, held } of liveSteps(frame)) for (const cue of gs.cues) {
          if (held && !cue.hold) continue
          const color = paint(cueColor(frame, cue, cfg), cfg.ink)
          const st = markProgress(cue, u, cfg.markFade)
          const opacity = st.opacity * alpha
          if (st.visible && opacity > 0) {
            if (cue.verb === 'ring') for (const node of cue.nodes) {
              // a rounded outline that hugs the part: round a post it is a tall capsule, round a wheel a circle
              const hug = hullOutline(silhouettePoints(c, frame, node), c.px(cfg.ringPad))
              if (!hug) continue
              stroke(hug.d, color, opacity, ` pathLength="1" stroke-dasharray="${st.progress.toFixed(4)} 2"`)
              rects.push({ id: `ring:${node.id}`, kind: 'mark', ids: [node.id], rect: hug.box })
            }
            if (cue.verb === 'arrow') {
              const ends = arrowEnds(c, frame, cue, thin)
              if (ends && st.progress > 0) {
                const [a, b] = ends, tip = { x: a.x + (b.x - a.x) * st.progress, y: a.y + (b.y - a.y) * st.progress }
                const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / len, uy = (b.y - a.y) / len
                const head = Math.min(c.px(cfg.arrowHead), len * st.progress)
                stroke(`M${n1(a.x)} ${n1(a.y)}L${n1(tip.x - ux * head * 0.6)} ${n1(tip.y - uy * head * 0.6)}`, color, opacity)
                const bx = tip.x - ux * head, by = tip.y - uy * head, half = head * 0.42
                out += `<path d="M${n1(tip.x)} ${n1(tip.y)}L${n1(bx - uy * half)} ${n1(by + ux * half)}L${n1(bx + uy * half)} ${n1(by - ux * half)}Z" fill="${color}" stroke="#000" stroke-width="${n1(w)}" stroke-linejoin="round" paint-order="stroke" opacity="${opacity.toFixed(3)}"/>`
                rects.push({ id: `arrow:${cue.nodes.map((n) => n.id).join('>')}`, kind: 'mark', ids: cue.nodes.map((n) => n.id), rect: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) } })
              }
            }
            if (cue.verb === 'glow') for (const node of cue.nodes) {
              if (node.space !== '2d' || !frame.visible(node)) continue // a 3D part glows through its own look (guideGlow)
              const r = c.screenRect(node)
              const poly = outlineOf(c, frame, node) ?? (r ? rectPoly(grow(r, c.px(cfg.haloWidth * 0.6))) : null)
              if (!poly) continue
              const d = 'M' + poly.map((p) => `${n1(p.x)} ${n1(p.y)}`).join('L') + 'Z'
              const k = st.progress * opacity
              out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${n1(c.px(cfg.haloWidth))}" stroke-linejoin="round" opacity="${(0.55 * k).toFixed(3)}" filter="url(#mimir-guide-halo)"/><path d="${d}" fill="${color}" fill-opacity="${(0.16 * k).toFixed(3)}" stroke="${color}" stroke-width="${n1(w * 1.4)}" stroke-linejoin="round" opacity="${k.toFixed(3)}"/>`
            }
          }
        }
        markup = out ? `<defs><filter id="mimir-guide-halo" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${n1(c.px(cfg.haloWidth) * 0.7)}"/></filter></defs>${out}` : ''
        return rects
      },
      paint() { if (markup !== shown) { svg.innerHTML = markup; shown = markup } },
      dispose() { svg.remove() },
    }
  },
})

// ── labels: typeset names on thin leaders ─────────────────────────────────────────────────────────────
const FACE = faceOf('serif', 'normal', false)
interface LabelEl { el: HTMLDivElement; key: string; lines: string[]; glyphs: HTMLSpanElement[]; w: number; h: number }
interface LabelPlan { item: LabelEl; x: number; y: number; opacity: number; write: number; align: 'left' | 'right' | 'center'; color: string }
/** Where one name stands: the box of its text, the side of its part it is on, and its leader (null: it sits on its line). */
interface Spot { x: number; y: number; side: LabelSide; tip?: P; elbow?: P; onLine?: boolean }
defineOverlay({
  name: 'guide.labels',
  z: 10,
  after: ['guide.caption'],
  create(c) {
    const svg = document.createElementNS(SVG, 'svg')
    svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;overflow:visible')
    c.root.appendChild(svg)
    const els = new Map<number, LabelEl>() // by action seq
    const keeps = new Map<string, LabelKeep>() // what was decided for a step's reference pose: sides, order, heights beside the parts
    const solved = new Map<string, { spots: Map<number, Spot>; ref: Frame }>() // where the names of a step stand in its reference picture, by everything that was measured
    const live = new Set<number>()
    let plan: LabelPlan[] = [], markup = '', shown = ''
    // text elements are made when their label is first on screen, but they sit in the DOM in story order (action seq)
    const make = (seq: number): LabelEl => {
      let next: LabelEl | null = null, nextSeq = Infinity
      for (const [k, p] of els) if (k > seq && k < nextSeq) { nextSeq = k; next = p }
      const el = document.createElement('div')
      el.style.cssText = `position:absolute;left:0;top:0;white-space:pre;font-family:${FONT_TEXT};paint-order:stroke fill;-webkit-text-stroke-color:#000`
      c.root.insertBefore(el, next ? next.el : null)
      return { el, key: '', lines: [], glyphs: [], w: 0, h: 0 }
    }
    /** set a name: one element per glyph (it is written glyph by glyph), kerned from the tables of the embedded face */
    const typeset = (item: LabelEl, text: string, fs: number, cfg: GuideConfig): void => {
      const key = `${text}|${fs.toFixed(2)}|${cfg.labelMaxWidth}|${cfg.labelLine}|${cfg.labelBackstroke}`
      if (item.key === key) return
      item.key = key
      const wrapped = wrapLabel(text, (s) => lineMetrics(s, FACE).width * fs, c.px(cfg.labelMaxWidth))
      item.lines = wrapped.lines
      item.w = Math.ceil(wrapped.width)
      item.h = Math.ceil(wrapped.lines.length * fs * cfg.labelLine)
      item.glyphs = []
      const s = item.el.style
      s.fontSize = fs.toFixed(2) + 'px'
      s.lineHeight = String(cfg.labelLine)
      s.webkitTextStrokeWidth = (fs * cfg.labelBackstroke).toFixed(2) + 'px'
      s.width = item.w + 'px'
      s.height = item.h + 'px'
      item.el.textContent = ''
      wrapped.lines.forEach((line, li) => {
        const row = document.createElement('span')
        row.style.display = 'block'
        const dx = lineMetrics(line, FACE).dx
        for (let i = 0; i < line.length; i++) {
          const ch = line[i]!
          if (ch === ' ') { row.appendChild(document.createTextNode(' ')); continue }
          const g = document.createElement('span')
          g.textContent = ch
          if (dx?.[i]) g.style.marginLeft = dx[i]!.toFixed(4) + 'em'
          row.appendChild(g)
          item.glyphs.push(g)
        }
        if (li < wrapped.lines.length - 1) row.appendChild(document.createTextNode(' ')) // the words stay apart in the element's text
        item.el.appendChild(row)
      })
    }
    /** the rectangle a node covers in the reference state `ref` (stage px): 3D parts through the camera `ref` was made with, flat ones through its 2D camera */
    const rectIn = (ref: Frame, node: MNode): Rect | null => {
      const kind = kindOf(node.kind)
      let box = kind?.container || !kind?.bounds ? null : toStageRect(c, ref.frameRect(node))
      for (const child of node.children) box = union(box, rectIn(ref, child))
      return box
    }
    /** a point of the reference picture of the flat stage → where it is in the frame on screen (the 2D camera may have moved since) */
    const carry = (ref: Frame, frame: Frame, node: MNode, p: P): P => {
      if (node.space === '3d' || spaceOf(node) === 'hud') return p
      const s = c.stage().scale
      return c.runtime.screenToStage(frame.toScreen(ref.fromScreen([p.x / s - FRAME_W / 2, FRAME_H / 2 - p.y / s])))
    }
    const isHue = (frame: Frame, node: MNode): boolean => {
      const rgb = parseColor(partColor(frame, node) ?? '')
      return !!rgb && Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]) >= guideConfig(c.model).labelHueChroma
    }
    type Item = { action: Action; data: LabelData; item: LabelEl; node: MNode; id: string }
    /** Where the names of step `k` stand, for the picture on screen. */
    const solveStep = (frame: Frame, k: number, items: Item[], cfg: GuideConfig, bounds: Rect): Map<number, Spot> => {
      const rec = c.model.steps[k]
      const tRef = rec ? rec.t0 + rec.active : frame.tau
      const key = `${k}|${viewKey(c, frame)}|${items.map((it) => `${it.id}:${it.item.key}`).join(',')}|${cfg.labelGap}|${rec ? '' : frame.tau}`
      // flat names belong to the flat stage: when its camera moves inside the step they move with what they name.
      // That is worked out for the frame on screen every time; what is kept is where the names stand in the reference picture
      const carried = (found: { spots: Map<number, Spot>; ref: Frame }): Map<number, Spot> => {
        const out = new Map<number, Spot>()
        for (const it of items) {
          const spot = found.spots.get(it.action.seq)
          if (!spot) continue
          if (it.node.space === '3d') { out.set(it.action.seq, spot); continue }
          const mid = carry(found.ref, frame, it.node, { x: spot.x + it.item.w / 2, y: spot.y + it.item.h / 2 })
          out.set(it.action.seq, { ...spot, x: mid.x - it.item.w / 2, y: mid.y - it.item.h / 2, tip: spot.tip ? carry(found.ref, frame, it.node, spot.tip) : undefined })
        }
        return out
      }
      const hit = solved.get(key)
      if (hit) return carried(hit)
      const spots = new Map<number, Spot>()
      const stage = c.stage()
      // the reference state: the settled end of the step, with the params and the 3D camera of the frame on screen
      const ref = c.model.state(tRef, frame.overrides, c.model.has3d ? frame.camera() : null)
      const px = (units: number): number => c.px(units)
      const rects = new Map<Item, Rect>()
      for (const it of items) rects.set(it, rectIn(ref, it.node) ?? c.screenRect(it.node) ?? { x: stage.width / 2, y: stage.height / 2, width: 0, height: 0 })
      const three = items.filter((it) => it.node.space === '3d'), flat = items.filter((it) => it.node.space !== '3d')
      const taken: Rect[] = [] // names placed so far: later ones stay off them

      // ── names of 3D parts: two columns, left and right of the figure ──────────────────────────────────
      if (three.length) {
        const tuning = { gap: px(cfg.labelGap), space: px(cfg.labelSpace), elbow: px(cfg.labelElbow), fan: cfg.labelFan, fanMin: px(cfg.labelFanMin), fanMax: px(cfg.labelFanMax), hintCost: 0, roomCost: px(cfg.labelRoomCost), roomSlope: cfg.labelRoomSlope, chamfer: cfg.labelChamfer }
        /** what the solver is given, measured in the reference state `at`; `sample(t)` is the same picture at another moment of the step */
        const measure = (at: Frame, sample: (t: number) => Frame): Parameters<typeof solveLabels>[0] => {
          // the silhouette of the figure over the whole step, so that names stand clear of it while it moves
          let figure: Rect | null = null
          const silhouette: P[] = []
          const n = Math.max(1, Math.round(cfg.labelPoseSamples)), step = px(cfg.labelSize)
          for (let i = 0; i < n; i++) {
            const state = i === n - 1 || !rec ? at : sample(n > 1 ? rec.t0 + (rec.active * i) / (n - 1) : tRef)
            for (const leaf of state.visibleLeaves('3d')) {
              const r = toStageRect(c, state.frameRect(leaf))
              if (!r) continue
              figure = union(figure, r)
              silhouette.push(...outlinePoints(state.hull(leaf).map((p) => { const q = state.project3(p); return c.runtime.screenToStage([q.x, q.y]) }).filter(finite), step))
            }
          }
          const fig = figure ?? { x: stage.width / 2, y: stage.height / 2, width: 0, height: 0 }
          // the free stage: what flat content beside the figure leaves of the safe area
          let left = bounds.x, right = bounds.x + bounds.width
          const reach = px(cfg.labelFanMax + cfg.labelSize * cfg.labelLine)
          for (const leaf of at.visibleLeaves('2d')) {
            if (kindOf(leaf.kind)?.worldGeometry) continue
            const t = rectIn(at, leaf)
            if (!t || t.y > fig.y + fig.height + reach || t.y + t.height < fig.y - reach) continue
            if (t.x + t.width <= fig.x) left = Math.max(left, t.x + t.width + px(cfg.labelSpace))
            else if (t.x >= fig.x + fig.width) right = Math.min(right, t.x - px(cfg.labelSpace))
          }
          const obstacles: LabelObstacle[] = []
          for (const leaf of at.visibleLeaves('3d')) {
            if (obstacles.length >= cfg.labelObstacles) break
            const box = toStageRect(c, at.frameRect(leaf))
            if (!box || box.width * box.height > 0.5 * fig.width * fig.height) continue // the housing is not something to go round
            const hue = isHue(at, leaf)
            obstacles.push({ box, ids: three.filter((it) => related(it.node, leaf)).map((it) => it.id), cost: px(hue ? cfg.labelHuedCost : cfg.labelGreyCost), hued: hue })
          }
          const boxes = new Map<string, Rect>(), where: Record<string, P> = {}, size: Record<string, { width: number; height: number }> = {}
          for (const it of three) {
            const r = rectIn(at, it.node) ?? rects.get(it)!
            boxes.set(it.id, r)
            where[it.id] = centerOf(r)
            size[it.id] = { width: it.item.w, height: it.item.h }
          }
          return {
            ids: three.map((it) => it.id), at: where, size, obstacles, tuning, silhouette,
            figure: { left: fig.x, right: fig.x + fig.width, middle: fig.y + fig.height / 2 },
            bounds: { left, right, top: bounds.y, bottom: bounds.y + bounds.height },
            tip: (id: string, to: P): P => { const r = boxes.get(id)!, o = centerOf(r), len = Math.hypot(to.x - o.x, to.y - o.y); return len > 1e-6 ? ellipseEdge(r, { x: (to.x - o.x) / len, y: (to.y - o.y) / len }) : o },
          }
        }
        // Sides, order and heights beside the parts are decided once per step, for the story's own camera and params at
        // the settled end of the step: whatever frame is drawn first, the answer is the same. An orbit, an authored
        // camera move or a dragged slider then moves the names continuously instead of making them change places.
        const keepKey = `${k}|${stage.width}x${stage.height}|${three.map((it) => `${it.id}:${it.item.key}`).join(',')}`
        let keep = keeps.get(keepKey)
        if (!keep) {
          const canon = c.model.state(tRef, {}, null), camera = c.model.has3d ? canon.camera() : null
          keep = solveLabels(measure(canon, (t) => c.model.state(t, {}, camera))).keep
          if (keeps.size > 64) keeps.clear()
          keeps.set(keepKey, keep)
        }
        const camera = c.model.has3d ? frame.camera() : null
        const result = solveLabels({ ...measure(ref, (t) => c.model.state(t, frame.overrides, camera)), keep })
        for (const it of three) {
          const slot = result.slots[it.id]
          if (!slot) continue
          const x = slot.side === 'left' ? slot.x - slot.width : slot.x
          spots.set(it.action.seq, { x, y: slot.y - slot.height / 2, side: slot.side === 'left' ? 'left' : 'right', tip: slot.tip, elbow: slot.elbow })
          taken.push({ x, y: slot.y - slot.height / 2, width: slot.width, height: slot.height })
        }
      }

      // ── names of flat objects: on the line for a line, beside the object otherwise ─────────────────────
      const named = new Set<MNode>()
      for (const { node } of items) { for (let p: MNode | null = node; p; p = p.parent) named.add(p); leavesOf(node).forEach((n) => named.add(n)) }
      const obstacles: Rect[] = [...taken]
      for (const n of ref.visibleLeaves()) {
        if (obstacles.length >= cfg.labelObstacles) break
        if (named.has(n) || kindOf(n.kind)?.worldGeometry) continue
        const r = rectIn(ref, n)
        if (!r || r.width * r.height > 0.5 * stage.width * stage.height) continue
        obstacles.push(r)
      }
      const hits = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
      const beside: Item[] = []
      for (const it of flat) {
        const line = it.data.anchor ? null : contourOf(c, ref, it.node)
        if (!line || line.closed || line.points.length < 2) { beside.push(it); continue }
        // a line carries its name: at its middle, just off it, on the side that is free
        const mid = middleOf(line.points), nx = -mid.along.y, ny = mid.along.x
        const reach = Math.abs(nx) * it.item.w / 2 + Math.abs(ny) * it.item.h / 2 + px(cfg.labelSpace)
        let best: Rect | null = null, least = Infinity
        for (const sign of ny * 1 > 0 ? [-1, 1] : [1, -1]) { // above the line first
          const box = { x: mid.at.x + nx * reach * sign - it.item.w / 2, y: mid.at.y + ny * reach * sign - it.item.h / 2, width: it.item.w, height: it.item.h }
          const inside = box.x >= bounds.x && box.y >= bounds.y && box.x + box.width <= bounds.x + bounds.width && box.y + box.height <= bounds.y + bounds.height
          const cost = obstacles.filter((o) => hits(box, o)).length * 2 + (inside ? 0 : 5)
          if (cost < least) { least = cost; best = box }
        }
        spots.set(it.action.seq, { x: best!.x, y: best!.y, side: best!.y + best!.height / 2 < mid.at.y ? 'top' : 'bottom', tip: mid.at, onLine: true })
        obstacles.push(best!)
      }
      if (beside.length) {
        const q = (x: number): number => Math.round(x * 2) / 2
        const anchors = beside.map((it) => { const r = rects.get(it)!; return { id: it.id, x: q(r.x + r.width / 2), y: q(r.y + r.height / 2), avoid: { x: q(r.x), y: q(r.y), width: q(r.width), height: q(r.height) } } })
        const sizes: Record<string, { width: number; height: number }> = {}
        for (const it of beside) sizes[it.id] = { width: it.item.w, height: it.item.h }
        const placed = placeLabels({ anchors, sizes, obstacles: obstacles.map((r) => ({ x: q(r.x), y: q(r.y), width: q(r.width), height: q(r.height) })), bounds, order: beside.map((it) => it.id), gap: px(cfg.labelGap), yDown: true })
        beside.forEach((it, i) => { const p = placed[i]; if (p) spots.set(it.action.seq, { x: p.x - it.item.w / 2, y: p.y - it.item.h / 2, side: p.side }) })
      }
      if (solved.size > 256) solved.clear()
      solved.set(key, { spots, ref })
      return carried({ spots, ref })
    }
    return {
      layout(frame: Frame, laid: OverlayLaid): OverlayRect[] {
        const cfg = guideConfig(c.model), stage = c.stage()
        const active = new Map(frame.actions<LabelData>('label').map((a) => [a.action.seq, a]))
        live.clear()
        plan = []
        markup = ''
        const sh = shared(frame)
        const store = guideStore(c.model)
        // every name of the steps on screen is solved (those still to come included): names hold still while others arrive
        const steps = new Set<number>([...active.values()].map((a) => (a.action.scope === 'persist' ? frame.k : a.action.step)))
        if (frame.k >= 0 && c.model.actions.some((a) => a.type === 'label' && a.step === frame.k)) steps.add(frame.k)
        if (!steps.size) return []
        const fs = Math.max(11, c.px(cfg.labelSize))
        const zone = captionZone(c, cfg)
        const x0 = c.px(FRAME_W / 2 - SAFE_X), y0 = c.px(FRAME_H / 2 - SAFE_Y)
        const bounds = { x: x0, y: y0, width: stage.width - 2 * x0, height: zone.top - c.px(0.1) - y0 }
        const lw = Math.max(1, c.px(cfg.leaderWidth)), thin = c.px(cfg.thin)
        const rects: OverlayRect[] = []
        const groupOf = (k: number): Item[] => {
          const seen = new Set<string>()
          return c.model.actions
            .filter((a) => a.type === 'label' && isNode((a.data as LabelData).node) && (a.step === k || (a.scope === 'persist' && a.step < k)))
            .sort((m, n) => m.t0 - n.t0 || m.seq - n.seq)
            .filter((a) => { const id = (a.data as LabelData).node.id; return !seen.has(id) && !!seen.add(id) }) // one name per part: the first
            .map((action, n) => {
              const data = action.data as LabelData
              let item = els.get(action.seq)
              if (!item) els.set(action.seq, (item = make(action.seq)))
              typeset(item, (cfg.numbered ? `${n + 1}  ` : '') + data.text, fs, cfg)
              return { action, data, item, node: data.node, id: String(action.seq) }
            })
        }
        for (const k of [...steps].sort((m, n) => m - n)) {
          const items = groupOf(k)
          if (!items.length) continue
          const spots = solveStep(frame, k, items, cfg, bounds)
          // a name that stays across steps glides from where it stood in the step before
          const settle = k === frame.k && k > 0 && frame.u < cfg.labelSettle && items.some((it) => it.action.scope === 'persist' && it.action.step < k) ? smooth(c01(frame.u / cfg.labelSettle)) : 1
          const before = settle < 1 ? solveStep(frame, k - 1, groupOf(k - 1), cfg, bounds) : null
          const gs = store.steps.get(k), u = frame.tau - (c.model.steps[k]?.t0 ?? 0)
          for (const { action, data, item, node } of items) {
            const spot = spots.get(action.seq)
            if (spot) sh.names.push({ x: spot.x, y: spot.y, width: item.w, height: item.h })
            const a = active.get(action.seq)
            if (!spot || !frame.visible(node)) continue
            let sx = spot.x, sy = spot.y
            const old = before?.get(action.seq)
            if (old) { sx = old.x + (spot.x - old.x) * settle; sy = old.y + (spot.y - old.y) * settle }
            // HTML goes on whole device pixels
            const left = c.snap(sx), top = c.snap(sy)
            const mid = { x: left + item.w / 2, y: top + item.h / 2 }
            // the leader: a level shoulder at the text, an elbow, one oblique segment to the edge of the part
            const air = c.px(cfg.labelElbow - cfg.labelShoulder)
            const end = spot.side === 'right' ? { x: left - air, y: mid.y } : spot.side === 'left' ? { x: left + item.w + air, y: mid.y } : spot.side === 'top' ? { x: mid.x, y: top + item.h } : { x: mid.x, y: top }
            const elbow = spot.side === 'right' ? { x: left - c.px(cfg.labelElbow), y: mid.y } : spot.side === 'left' ? { x: left + item.w + c.px(cfg.labelElbow), y: mid.y } : end
            const dot = spot.onLine ? (spot.tip ? { x: spot.tip.x + (sx - spot.x), y: spot.tip.y + (sy - spot.y) } : null) : edgeToward(c, frame, node, data.anchor ?? null, elbow, thin)
            if (dot) {
              // known before the name is shown: a pointer on its way lands where the leader will end
              sh.dots.set(node.id, dot)
              // a dart that rests here is the arrowhead of this leader: it points in along it
              sh.aims.set(node.id, (Math.atan2(-(elbow.x - dot.x), elbow.y - dot.y) * 180) / Math.PI)
            }
            if (!a) continue
            live.add(action.seq)
            // its part's hue while its word is being said, dust afterwards (and before)
            const hue = paint(markColor(frame, node, cfg.labelColor, cfg.ink), cfg.ink)
            let said = 0
            if (gs && cfg.labelRest) for (const cue of gs.cues) {
              if (!cue.nodes.some((n) => related(n, node))) continue
              const next = cue.pointer ? gs.cues.find((q) => q.pointer && q.index > cue.index) : undefined
              const until = next ? next.fireAt : cue.pointer ? cue.dockAt ?? Infinity : cue.markEnd
              said = Math.max(said, smooth(c01((u - cue.landAt + 0.02) / 0.1)) * (1 - smooth(c01((u - until) / cfg.labelDust))))
            }
            const color = cfg.labelRest ? mix(paint(cfg.labelRest, cfg.ink), hue, said) : hue
            const length = action.t1 - action.t0
            const fading = a.age >= length ? a.env : 1 // the step-scoped envelope, once the label has arrived
            const draw = smooth(c01(a.age / cfg.leaderTime)), write = c01((a.age - cfg.labelTextAt) / cfg.labelText)
            plan.push({ item, x: left, y: top, opacity: fading, write, align: spot.side === 'left' ? 'right' : spot.side === 'right' ? 'left' : 'center', color })
            rects.push({ id: `label:${node.id}`, kind: 'label', rect: { x: left, y: top, width: item.w, height: item.h }, ids: [node.id], text: data.text, src: action.src, fix: ['label fewer parts in this step, or shorten the label text', 'move the text that sits under the label: .shift(0, 0.6)'] })
            if (!dot || spot.onLine) continue // the name sits on its line: no leader
            const d = `M${n1(dot.x)} ${n1(dot.y)}L${n1(elbow.x)} ${n1(elbow.y)}L${n1(end.x)} ${n1(end.y)}`
            const dash = ` pathLength="1" stroke-dasharray="${draw.toFixed(4)} 2"`
            const line = paint(cfg.leaderColor ?? color, cfg.ink)
            const o = fading.toFixed(3), rad = c.px(cfg.dotRadius) * (0.4 + 0.6 * draw)
            markup += `<g opacity="${o}"><path d="${d}" fill="none" stroke="#000" stroke-width="${n1(Math.max(lw * 2, c.px(cfg.leaderBackstroke)))}" stroke-linecap="round" stroke-linejoin="round" opacity="0.75"${dash}/><path d="${d}" fill="none" stroke="${line}" stroke-width="${n1(lw)}" stroke-linecap="round" stroke-linejoin="round"${dash}/><circle cx="${n1(dot.x)}" cy="${n1(dot.y)}" r="${n1(rad)}" fill="${color}" stroke="#000" stroke-width="${n1(lw * 1.5)}"/></g>`
          }
        }
        void laid
        return rects
      },
      paint() {
        const cfg = guideConfig(c.model)
        for (const p of plan) {
          const s = p.item.el.style
          s.left = p.x + 'px'
          s.top = p.y + 'px'
          s.color = p.color
          s.textAlign = p.align
          s.opacity = p.opacity.toFixed(3)
          // written glyph by glyph, in reading order, on either side of the figure
          const n = p.item.glyphs.length
          p.item.glyphs.forEach((g, i) => { const a = p.write >= 1 ? '' : glyphAlpha(p.write, i, n, cfg.glyphLag).toFixed(3); if (g.style.opacity !== a) g.style.opacity = a })
          s.display = ''
        }
        for (const [seq, item] of els) if (!live.has(seq)) item.el.style.display = 'none'
        if (markup !== shown) { svg.innerHTML = markup; shown = markup }
      },
      dispose() { c.root.textContent = '' },
    }
  },
})

// ── caption: one line at a time, lit by the word ──────────────────────────────────────────────────────
const CONJUNCTIONS = new Set(['and', 'but', 'or', 'so', 'yet', 'because', 'while', 'when', 'where', 'which', 'that', 'until', 'if', 'then', 'than'])
/** What it costs to start a new caption line before word j: nothing after punctuation, most inside the name of a part. */
export function breakCost(words: readonly { text: string; cue: number }[], j: number): number {
  const a = words[j - 1]!, b = words[j]!
  if (a.cue >= 0 && a.cue === b.cue) return 4
  if (/[.!?,;:—–]$/.test(a.text)) return 0
  if (CONJUNCTIONS.has(b.text.toLowerCase().replace(/[^a-z']/g, ''))) return 0.04
  return 0.3
}
/** Cut words [a, b) into runs that each fit `width`: at the best pause nearest the middle, again for each half. */
export function captionRuns(words: readonly { text: string; cue: number }[], left: readonly number[], right: readonly number[], a: number, b: number, width: number, out: [number, number][] = []): [number, number][] {
  const span = right[b - 1]! - left[a]!
  if (span <= width || b - a < 2) { out.push([a, b]); return out }
  const mid = left[a]! + span / 2
  let cut = a + 1, least = Infinity
  for (let j = a + 1; j < b; j++) { const cost = breakCost(words, j) * 1.5 + Math.abs(left[j]! - mid) / span; if (cost < least) { least = cost; cut = j } }
  captionRuns(words, left, right, a, cut, width, out)
  captionRuns(words, left, right, cut, b, width, out)
  return out
}
defineOverlay({
  name: 'guide.caption',
  z: 20,
  create(c) {
    const el = document.createElement('div')
    el.style.cssText = `position:absolute;left:0;top:0;white-space:nowrap;font-family:${FONT_TEXT};paint-order:stroke fill;-webkit-text-stroke-color:#000;display:none`
    c.root.appendChild(el)
    const stopVoice = startVoice(c.runtime)
    // a viewer may switch the captions off and on (the page dispatches `mimir:captions` with a boolean, like `mimir:voice`)
    let shown = true
    const toggle = (e: Event): void => { shown = !!(e as CustomEvent).detail; c.runtime.invalidate() }
    document.addEventListener('mimir:captions', toggle)
    let built = '', spans: HTMLSpanElement[] = []
    const runs = new Map<string, [number, number][]>() // by line, font size and width
    let plan: { x: number; y: number; opacity: number; line: GuideLine; gs: GuideStep; a: number; u: number; frame: Frame } | null = null
    const build = (key: string, line: GuideLine, a: number, b: number, size: number, cfg: GuideConfig): void => {
      if (built === key) return
      built = key
      el.textContent = ''
      el.style.fontSize = size.toFixed(2) + 'px'
      el.style.lineHeight = String(cfg.captionLine)
      el.style.webkitTextStrokeWidth = (size * cfg.labelBackstroke * 0.8).toFixed(2) + 'px'
      spans = []
      for (let i = a; i < b; i++) {
        const s = document.createElement('span')
        // the words of one name share one underline: the space between them belongs to the first
        const joined = i < b - 1 && line.words[i]!.cue >= 0 && line.words[i]!.cue === line.words[i + 1]!.cue
        s.textContent = line.words[i]!.text + (joined ? ' ' : '')
        s.style.cssText = 'background-repeat:no-repeat;background-position:0 96%;white-space:pre'
        spans.push(s)
        el.appendChild(s)
        if (i < b - 1 && !joined) el.appendChild(document.createTextNode(' '))
      }
    }
    return {
      layout(frame: Frame): OverlayRect[] {
        const cfg = guideConfig(c.model)
        plan = null
        if (!cfg.captions || !shown) return []
        const store = guideStore(c.model)
        const gs = store.steps.get(frame.k)
        let pick: { gs: GuideStep; li: number; u: number; opacity: number } | null = null
        if (gs) {
          let li = -1
          for (let i = 0; i < gs.lines.length; i++) if (gs.lines[i]!.showAt <= frame.u) li = i
          if (li >= 0) {
            const line = gs.lines[li]!, next = gs.lines[li + 1]
            let opacity = smooth(c01((frame.u - line.showAt) / cfg.captionFade))
            if (next) opacity = Math.min(opacity, smooth(c01((next.showAt - frame.u) / cfg.captionFade)))
            pick = { gs, li, u: frame.u, opacity }
          }
        }
        if (!pick && frame.k > 0) {
          // nothing said yet in this step: the last line of the step before leaves first (exits lead)
          const prev = store.steps.get(frame.k - 1)
          if (prev?.lines.length) {
            const until = gs?.lines[0]?.showAt ?? Infinity
            const opacity = Math.min(frame.release(frame.k - 1), Number.isFinite(until) ? smooth(c01((until - frame.u) / cfg.captionFade)) : 1)
            if (opacity > 0) pick = { gs: prev, li: prev.lines.length - 1, u: prev.duration + frame.u, opacity }
          }
        }
        if (!pick) return []
        const stage = c.stage(), line = pick.gs.lines[pick.li]!, n = line.words.length
        const size = Math.max(11, c.px(cfg.captionSize)), width = stage.width * cfg.captionWidth
        el.style.display = ''
        const id = `${pick.gs.index}:${pick.li}:${size.toFixed(2)}:${width.toFixed(0)}`
        let list = runs.get(id)
        if (!list) {
          // set the whole sentence once to learn where its words fall; a sentence wider than the zone is cut at its pauses
          build(id + ':all', line, 0, n, size, cfg)
          const left = spans.map((s) => s.offsetLeft), right = spans.map((s) => s.offsetLeft + s.offsetWidth)
          list = captionRuns(line.words, left, right, 0, n, width)
          if (runs.size > 256) runs.clear()
          runs.set(id, list)
        }
        let run = list[0]!
        for (const r of list) if (line.words[r[0]]!.t0 - cfg.captionLead <= pick.u) run = r
        build(`${id}:${run[0]}:${run[1]}`, line, run[0], run[1], size, cfg)
        if (el.offsetWidth > width) {
          // one clause that is still too wide: smaller type, never a second line
          const smaller = Math.max(size * cfg.captionShrink, (size * width) / el.offsetWidth)
          build(`${id}:${run[0]}:${run[1]}:s`, line, run[0], run[1], smaller, cfg)
        }
        const w = el.offsetWidth, h = el.offsetHeight, zone = captionZone(c, cfg)
        const x = c.snap((stage.width - w) / 2), y = c.snap(zone.top + (zone.height - h) / 2 + (1 - pick.opacity) * c.px(0.04))
        plan = { x, y, opacity: pick.opacity, line, gs: pick.gs, a: run[0], u: pick.u, frame }
        return [{ id: 'caption', kind: 'text', rect: { x, y, width: w, height: h }, text: line.words.slice(run[0], run[1]).map((q) => q.text).join(' '), src: pick.gs.says[line.say]?.src, fix: ['keep the bottom of the frame free for the caption: move this up with .shift(0, 0.8)', 'or shorten the sentence in st.say()'] }]
      },
      paint() {
        if (!plan) { el.style.display = 'none'; return }
        const cfg = guideConfig(c.model)
        el.style.left = plan.x + 'px'
        el.style.top = plan.y + 'px'
        el.style.opacity = plan.opacity.toFixed(3)
        const rule = Math.max(1, Math.round(c.px(0.012)))
        spans.forEach((s, i) => {
          const word = plan!.line.words[plan!.a + i]!
          const cue = word.cue >= 0 ? plan!.gs.cues[word.cue] : undefined
          const linked = !!cue && cue.nodes.length > 0
          const rest = linked ? cfg.wordLinked : cfg.wordRest
          const lit = smooth(c01((plan!.u - (word.t0 - cfg.wordBefore)) / (cfg.wordBefore + cfg.wordAfter)))
          s.style.color = linked ? paint(cueColor(plan!.frame, cue!, cfg), cfg.ink) : cfg.ink
          s.style.opacity = (rest + (1 - rest) * lit).toFixed(3)
          // a word that names a part underlines itself, from the left, when its mark lands
          const under = linked ? smooth(c01((plan!.u - cue!.landAt) / cfg.underline)) : 0
          s.style.backgroundImage = under > 0 ? 'linear-gradient(currentColor,currentColor)' : 'none'
          s.style.backgroundSize = `${(under * 100).toFixed(1)}% ${rule}px`
        })
      },
      dispose() { stopVoice(); document.removeEventListener('mimir:captions', toggle); el.remove() },
    }
  },
})

// ── pointer: the dart ─────────────────────────────────────────────────────────────────────────────────
/** guidePose asks for anchors by name; these names say which cue of the step, and which end of an arrow. */
const keyed = new WeakMap<GuideStep, GuideCue[]>()
const poseCues = (gs: GuideStep): GuideCue[] => {
  let list = keyed.get(gs)
  if (!list) keyed.set(gs, (list = gs.cues.map((q, i) => ({ ...q, targets: q.arrow ? [`${i}<`, `${i}>`] : [String(i)], ...(q.arrow ? { arrow: [`${i}<`, `${i}>`] as [string, string] } : {}) }))))
  return list
}
/** The pointer cue the dart leaves when it flies for cue `index`: itself when it flies home, the pointer cue before it otherwise (unless that one had gone home). */
function originCue(gs: GuideStep, index: number): GuideCueRec | undefined {
  const cue = gs.cues[index]
  if (!cue) return undefined
  let before: GuideCueRec | undefined
  for (let i = index - 1; i >= 0; i--) if (gs.cues[i]!.pointer) { before = gs.cues[i]; break }
  return cue.dockAt !== null ? cue : before && before.dockAt === null ? before : undefined
}
defineOverlay({
  name: 'guide.pointer',
  z: 30,
  after: ['guide.caption', 'guide.labels'],
  create(c) {
    const svg = document.createElementNS(SVG, 'svg')
    svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;overflow:visible')
    c.root.appendChild(svg)
    const sides = new Map<string, number>() // the side of its part a cue's pointer rests on (an angle), by everything it was chosen from
    let markup = '', shown = ''
    /**
     * Where the pointer rests for a cue that names one part, and how it is turned there.
     * - A part that carries a name: on the end of that name's leader, pointing in along it (the dart is its arrowhead).
     * - Any other: its tip on the edge of the part, its body on free space beside it. The side is chosen once per cue,
     *   for the moment it lands, so that the pointer covers no text (of the scene, of a label, of the caption) and
     *   stays on the stage; while the part moves the pointer keeps that side.
     */
    const landingOf = (frame: Frame, cue: GuideCueRec, cfg: GuideConfig, caption: Rect): { at: P; angle: number } | null => {
      const node = cue.nodes[0]
      if (!node) return null
      const sh = shared(frame), key = `${cue.step}:${cue.index}`
      if (sh.touch.has(key)) return sh.touch.get(key)!
      const thin = c.px(cfg.thin)
      let out: { at: P; angle: number } | null = null
      const dot = cue.anchors[0] ? undefined : sh.dots.get(node.id)
      if (dot) out = { at: dot, angle: sh.aims.get(node.id) ?? cfg.perchAngle }
      else if (frame.visible(node)) {
        const length = c.px(cfg.pointerSize), rec = c.model.steps[cue.step]
        const now = c.screenRect(node)
        const sideKey = `${key}|${viewKey(c, frame)}|${frame.zoomed() ? JSON.stringify(frame.camera2d()) : ''}` // everything the choice is made from
        let angle = sides.get(sideKey)
        if (angle === undefined) {
          // the picture at the moment of landing: what the pointer must not cover is decided there, once
          const ref = rec ? c.model.state(rec.t0 + cue.landAt, frame.overrides, c.model.has3d ? frame.camera() : null) : frame
          const box = toStageRect(c, ref.frameRect(node)) ?? now
          const stage = c.stage()
          const texts = [...sceneTexts(c, ref), ...sh.names, caption]
          const others: Rect[] = []
          for (const n of ref.visibleLeaves()) { if (others.length >= cfg.labelObstacles) break; if (related(n, node) || kindOf(n.kind)?.worldGeometry) continue; const r = toStageRect(c, ref.frameRect(n)); if (r && r.width * r.height < 0.25 * stage.width * stage.height) others.push(r) }
          const anchor = cue.anchors[0] ? ref.project(anchorRef(node, cue.anchors[0])) : null
          const anchorAt = anchor && Number.isFinite(anchor.x + anchor.y) ? c.runtime.screenToStage([anchor.x, anchor.y]) : null
          const perch: Perch = choosePerch({
            center: anchorAt ?? (box ? centerOf(box) : { x: stage.width / 2, y: stage.height / 2 }),
            edge: (dir) => (anchorAt ? anchorAt : !box ? { x: NaN, y: NaN } : Math.min(box.width, box.height) < thin ? centerOf(box) : node.space === '3d' ? ellipseEdge(box, dir) : boxEdge(box, dir)),
            length, halfWidth: length * cfg.pointerHalf, texts, others,
            bounds: { x: 0, y: 0, width: stage.width, height: stage.height }, prefer: cfg.perchAngle, directions: cfg.perchDirections, margin: c.px(cfg.perchMargin),
          })
          angle = perch.angle
          if (sides.size > 512) sides.clear()
          sides.set(sideKey, angle)
        }
        const a = (angle * Math.PI) / 180, dir = { x: -Math.sin(a), y: Math.cos(a) }
        const o = now ? centerOf(now) : null
        const far = o && now ? { x: o.x + dir.x * (now.width + now.height + length), y: o.y + dir.y * (now.width + now.height + length) } : null
        const at = far ? edgeToward(c, frame, node, cue.anchors[0] ?? null, far, thin) : null
        if (at) out = { at, angle }
      }
      sh.touch.set(key, out)
      return out
    }
    return {
      layout(frame: Frame, laid: OverlayLaid) {
        const cfg = guideConfig(c.model), stage = c.stage(), zone = captionZone(c, cfg)
        // the dock: the middle of the caption line's top edge, where the words are; a dart is born there and goes home there
        const dock: [number, number] = [stage.width / 2, zone.top]
        const size = c.px(cfg.pointerSize), color = paint(cfg.pointerColor, '#FFFFFF')
        const thin = c.px(cfg.thin)
        // the caption line as it can ever be: the pointer keeps off the whole zone, whatever is said at the moment
        const wide = stage.width * cfg.captionWidth
        const caption: Rect = { x: (stage.width - wide) / 2, y: zone.top, width: wide, height: zone.height }
        void laid
        let out = ''
        for (const { gs, u, alpha, held } of liveSteps(frame)) {
          if (held || !gs.cues.some((q) => q.pointer)) continue
          const anchorAt = (name: string): [number, number] | null => {
            const cue = gs.cues[parseInt(name, 10)]
            if (!cue) return null
            const end = name.endsWith('<') ? 0 : name.endsWith('>') ? 1 : -1
            const ends: readonly P[] | null = end >= 0 ? arrowEnds(c, frame, cue, thin) : null
            const p = end >= 0 ? ends?.[end] ?? null : landingOf(frame, cue, cfg, caption)?.at ?? null
            return p ? [p.x, p.y] : null
          }
          // the touch-down ring: every landing of the pointer is seen, whatever the verb
          const mw = Math.max(1, c.px(cfg.markWidth))
          for (const cue of gs.cues) {
            const age = u - cue.landAt
            if (!cue.pointer || age <= -0.02 || age >= cfg.pulseEnd) continue
            const at = cue.arrow ? arrowEnds(c, frame, cue, thin)?.[0] ?? null : landingOf(frame, cue, cfg, caption)?.at ?? null
            if (!at) continue
            const p = smooth(c01((age + 0.02) / cfg.pulseDraw)), fade = (1 - smooth(c01((age - cfg.pulseHold) / (cfg.pulseEnd - cfg.pulseHold)))) * alpha
            const d = ringPath(at, c.px(cfg.pulseRadius) * (0.7 + 0.3 * p)), dash = ` pathLength="1" stroke-dasharray="${p.toFixed(4)} 2"`
            out += `<path d="${d}" fill="none" stroke="#000" stroke-width="${n1(mw * 3)}" stroke-linecap="round" opacity="${(fade * 0.7).toFixed(3)}"${dash}/><path d="${d}" fill="none" stroke="${paint(cueColor(frame, cue, cfg), cfg.ink)}" stroke-width="${n1(mw)}" stroke-linecap="round" opacity="${fade.toFixed(3)}"${dash}/>`
          }
          const cues = poseCues(gs)
          const pose = guidePose(cues, u, anchorAt, dock)
          if (!pose.visible) continue
          const hop = Math.max(cfg.hop, 1e-3)
          let opacity = 1
          // a pointer that is not shown at its dock does not fly home across the stage (and over whatever lies between):
          // it goes out where it rests. The next one is born at its word.
          const leaving = pose.phase === 'flying' && pose.to === DOCK && cfg.dockOpacity <= 0 ? landingOf(frame, gs.cues[pose.cue]!, cfg, caption) : null
          if (pose.phase === 'docked') opacity = cfg.dockOpacity
          else if (leaving) opacity = 1 - c01((pose.progress * hop) / cfg.pointerFade)
          else if (pose.phase === 'flying' && pose.from === DOCK) opacity = cfg.dockOpacity + (1 - cfg.dockOpacity) * c01((pose.progress * hop) / cfg.pointerFade)
          else if (pose.phase === 'flying' && pose.to === DOCK) opacity = cfg.dockOpacity + (1 - cfg.dockOpacity) * c01(((1 - pose.progress) * hop) / cfg.pointerFade)
          opacity *= alpha
          if (opacity <= 0) continue
          // a short trail while it flies: the same pose function, a few instants earlier
          const samples = leaving ? 0 : Math.round(cfg.trailSamples)
          for (let k = samples; k >= 1; k--) {
            const past = guidePose(cues, u - k * cfg.trailStep, anchorAt, dock)
            if (past.phase !== 'flying' || !past.visible) continue
            out += `<circle cx="${n1(past.x)}" cy="${n1(past.y)}" r="${n1(c.px(cfg.trailRadius) * (1 - k / (samples + 2)))}" fill="${color}" opacity="${(opacity * 0.6 * 0.78 ** k).toFixed(3)}"/>`
          }
          // at rest the dart points at its part: in along the leader of a name, in from the free side otherwise.
          // In flight it turns from the way it rested to the way it will rest, the short way round.
          const turnOf = (cue: GuideCueRec | undefined): number => {
            if (!cue || cue.arrow) return 0
            const land = landingOf(frame, cue, cfg, caption)
            if (!land) return 0
            let turn = (land.angle - REST_ANGLE_DEG) % 360
            if (turn > 180) turn -= 360
            else if (turn <= -180) turn += 360
            return turn
          }
          const served = pose.cue >= 0 ? gs.cues[pose.cue] : undefined
          const here = turnOf(served)
          const blend = pose.phase === 'flying' ? smooth(pose.progress) : 1
          const from = pose.phase === 'flying' ? turnOf(originCue(gs, pose.cue)) : 0
          const angle = leaving ? leaving.angle : pose.angleDeg + (pose.phase === 'flying' ? from * (1 - blend) + (pose.to === DOCK ? 0 : here) * blend : here)
          const half = size * cfg.pointerHalf
          const px = leaving ? leaving.at.x : pose.x, py = leaving ? leaving.at.y : pose.y
          out += `<path d="M0 0L${n1(half)} ${n1(size)}L0 ${n1(size * cfg.pointerNotch)}L${n1(-half)} ${n1(size)}Z" transform="translate(${n1(px)} ${n1(py)}) rotate(${n1(angle)}) scale(${(leaving ? 1 : pose.scale).toFixed(3)})" fill="${color}" stroke="#000" stroke-width="${n1(c.px(cfg.pointerKeyline) * 2)}" stroke-linejoin="round" paint-order="stroke" opacity="${opacity.toFixed(3)}"/>`
        }
        markup = out
      },
      paint() { if (markup !== shown) { svg.innerHTML = markup; shown = markup } },
      dispose() { svg.remove() },
    }
  },
})
