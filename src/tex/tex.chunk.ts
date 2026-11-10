// Lazy chunk dist/mimir.tex.js: KaTeX, the layout (./layout.ts) and the drawing side of tex(). Loaded only by scenes
// that have a formula. A formula is drawn as real SVG: one <text> per glyph in an embedded Computer Modern face, a
// <rect> per rule, KaTeX's own SVG pieces for roots, braces and tall delimiters. Every piece has its own holder, so
// it can be written on with a lag, coloured, moved, and matched with a piece of another formula.
// Nothing here remembers a frame: the picture is a function of the frame's values alone.
import {
  apply, clamp01, defineKindBackend, emOf, mix, qzDeg, smooth,
  type Frame, type MNode, type Resolved, type Runtime, type Vec3,
} from '../core/index.ts'
import { K, type Ctx2D } from '../r2d/index.ts'
import { FACE_GROUP, FONT_CHUNKS, faceCss, partGeometry, slots, TEX_STYLE, type Box4 } from './index.ts'
import { findKey, fitView, layoutTex, matchItems, texSource, type TexItem, type TexLayout, type TexMatch } from './layout.ts'

// ── layouts, by source ───────────────────────────────────────────────────────────────────────────────
/** how many laid-out formulas are kept (a formula whose source follows a param makes a new one per value) */
const CACHE_SIZE = 400
const layouts = new Map<string, TexLayout>()
/** The layout of a source as the author wrote it (dollar signs and all). Cached by source: the same source, the same object. */
export function layoutOf(source: string, display: boolean): TexLayout {
  const key = (display ? 'd' : 'i') + source
  let l = layouts.get(key)
  if (!l) {
    if (layouts.size >= CACHE_SIZE) layouts.delete(layouts.keys().next().value!)
    layouts.set(key, (l = layoutTex(texSource(source), display)))
  }
  return l
}
const unionOf = (l: TexLayout, indices: readonly number[]): Box4 | null => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const i of indices) { const b = l.items[i]?.box; if (!b) continue; x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]) }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null
}
/** Why a part has no pieces, or its pieces. */
type Found = { indices: number[] } | { indices: null; why: string; fix: string[] }
const piecesText = (l: TexLayout): string => l.order.map((i) => { const it = l.items[i]!; return it.kind === 'glyph' ? it.text : it.kind === 'rule' ? '―' : it.sig.replace('svg:', '') }).join(' ')
/** The pieces a part stands for: a key (the piece that is set like this LaTeX) or an index in reading order. */
export function partIndices(l: TexLayout, key: string | number, occurrence: number): Found {
  if (typeof key === 'number') {
    const i = l.order[key]
    if (i === undefined) return { indices: null, why: `has ${l.order.length} piece${l.order.length === 1 ? '' : 's'}, so there is no piece ${key}`, fix: [l.order.length ? `use an index from 0 to ${l.order.length - 1} (pieces, left to right: ${piecesText(l)})` : 'the formula draws nothing'] }
    return { indices: [i] }
  }
  if (!key.trim()) return { indices: null, why: 'cannot have a part with an empty key', fix: ["formula.part('x^2')"] }
  const k = layoutOf(key, l.display)
  if (k.error) return { indices: null, why: `has no part "${key}": the key is not LaTeX that can be set (${k.error.message})`, fix: ['write the key the way the piece is written in the formula'] }
  const hits = findKey(l, k)
  if (!hits.length) return { indices: null, why: `has no piece set like "${key}"`, fix: [`its pieces, left to right: ${piecesText(l)}`, 'a key must be a run of neighbouring pieces, written as in the formula'] }
  const hit = hits[occurrence - 1]
  if (!hit) return { indices: null, why: `has "${key}" ${hits.length} time${hits.length === 1 ? '' : 's'}, not ${occurrence}`, fix: [`use an occurrence from 1 to ${hits.length}`] }
  return { indices: hit }
}
slots.box = (source, display) => layoutOf(source, display).box
slots.inspect = (node, frame) => { planOf(node, frame) }
slots.partBox = (source, display, key, occurrence) => {
  const l = layoutOf(source, display)
  const f = partIndices(l, key, occurrence)
  return f.indices ? unionOf(l, f.indices) : null
}

// ── the plan of one formula: colours and owners of its pieces, and what is wrong with it ───────────────
interface Plan {
  layout: TexLayout
  /** colour of every piece: the colours map, else what the source says (\color), else null = the formula's colour */
  colors: (string | null)[]
  /** the part that draws each piece (the last one made that contains it), or null: the formula draws it */
  owner: (MNode | null)[]
  /** pieces of each part, by part uid */
  parts: Map<number, number[]>
  key: string
}
const plans = new WeakMap<MNode, Plan>()
const sourceOf = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))
/** closest LaTeX commands to a misspelt one are looked for among these (the ones explainers use most) */
const COMMON = 'frac sqrt sum prod int lim infty alpha beta gamma delta epsilon theta lambda mu pi sigma phi omega Delta Sigma Omega partial nabla cdot times div pm leq geq neq approx equiv to rightarrow leftarrow Rightarrow mapsto in notin subset cup cap forall exists text mathbf mathrm mathbb mathcal vec hat bar dot tilde overline underline underbrace overbrace left right begin end pmatrix bmatrix cases aligned binom sin cos tan log ln exp max min quad qquad color textcolor boxed cancel ldots cdots dots circ angle perp parallel'.split(' ')
function nearestCommand(token: string): string | null {
  const name = token.replace(/^\\/, '')
  if (!/^[A-Za-z]+$/.test(name)) return null
  let best: string | null = null, bestD = 3
  for (const c of COMMON) {
    if (Math.abs(c.length - name.length) >= bestD) continue
    // edit distance, small strings
    const d: number[] = Array.from({ length: c.length + 1 }, (_, j) => j)
    for (let i = 1; i <= name.length; i++) {
      let prev = d[0]!
      d[0] = i
      for (let j = 1; j <= c.length; j++) { const keep = d[j]!; d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (name[i - 1] === c[j - 1] ? 0 : 1)); prev = keep }
    }
    if (d[c.length]! < bestD) { bestD = d[c.length]!; best = c }
  }
  return best
}
const short = (s: string): string => (s.length > 60 ? s.slice(0, 57) + '…' : s)

/** The plan of a tex node in a frame. Reports, once each: a source that does not parse, a colour key or a part the formula does not have. */
export function planOf(node: MNode, frame: Frame): Plan {
  const r = frame.props(node)
  const source = sourceOf(r.latex), display = !r.inline
  const colorMap = (r.colors ?? {}) as Record<string, string>
  const parts = node.children.filter((k) => k.kind === 'texpart')
  const key = `${display ? 'd' : 'i'}${source}\u0001${JSON.stringify(colorMap)}\u0001${parts.map((p) => p.uid).join(',')}`
  const hit = plans.get(node)
  if (hit && hit.key === key) return hit
  const layout = layoutOf(source, display)
  const model = node.model
  if (layout.error) {
    const e = layout.error
    const near = e.token ? nearestCommand(e.token) : null
    model.diagnostics.add({ code: 'TEX-INVALID', severity: 'error', ids: [node.id], what: `tex(): "${short(source)}" is not LaTeX that can be set: ${e.message}${e.token ? ` (at "${short(e.token)}"${e.position !== null ? `, character ${e.position + 1}` : ''})` : ''}. The source is shown as text instead.`, fix: [near ? `did you mean \\${near}?` : 'check the braces and the command names', 'in a JavaScript string every backslash is written twice (\'\\\\frac{a}{b}\'), or use String.raw`\\frac{a}{b}`'] }, node.src)
  }
  const colors: (string | null)[] = layout.items.map((it) => (layout.error ? TEX_STYLE.errorColor : it.color))
  if (!layout.error) {
    for (const [k, color] of Object.entries(colorMap)) {
      const kl = layoutOf(k, display)
      const hits = kl.error ? [] : findKey(layout, kl)
      if (!hits.length) model.diagnostics.add({ code: 'REF-MISSING', ids: [node.id], what: `tex({ colors }): the formula "${short(source)}" has no piece set like "${k}" to colour.`, fix: [`its pieces, left to right: ${piecesText(layout)}`, 'a key must be a run of neighbouring pieces, written as in the formula'] }, node.src)
      for (const h of hits) for (const i of h) colors[i] = color
    }
  }
  const owner: (MNode | null)[] = layout.items.map(() => null)
  const partPieces = new Map<number, number[]>()
  for (const p of parts) {
    const f = partIndices(layout, p.props.key as string | number, Number(p.props.occurrence ?? 1))
    if (!f.indices) {
      if (!layout.error && !p.invalid) model.diagnostics.add({ code: 'REF-MISSING', ids: [p.id], what: `tex.part(${JSON.stringify(p.props.key)}): the formula "${short(source)}" ${f.why}.`, fix: f.fix }, p.src)
      partPieces.set(p.uid, [])
      continue
    }
    partPieces.set(p.uid, f.indices)
    for (const i of f.indices) owner[i] = p
  }
  const plan: Plan = { layout, colors, owner, parts: partPieces, key }
  plans.set(node, plan)
  return plan
}

// ── faces: a safety net for a formula whose source the font plan could not read (it came from a function) ─────
const ready = new Set<string>()
const asked = new Set<string>()
function ensureFaces(layout: TexLayout, node: MNode, rt: Runtime): void {
  if (typeof document === 'undefined' || !document.fonts) return
  for (const face of layout.faces) {
    if (ready.has(face)) continue
    const css = faceCss(face)
    // a face the page declares (whoever embedded it) is the browser's to load; only one nobody declared is fetched here
    let there = false, loaded = false
    for (const f of document.fonts) {
      if (f.status === 'error' || f.family.replace(/["']/g, '') !== css.family || f.style !== css.style || !(f.weight === css.weight || f.weight === (css.weight === 'bold' ? '700' : '400'))) continue
      there = true
      loaded ||= f.status === 'loaded'
    }
    if (loaded) ready.add(face)
    if (there) continue
    const chunk = FONT_CHUNKS[FACE_GROUP[face] ?? '']
    if (!chunk || asked.has(chunk) || !rt.options.load) continue
    asked.add(chunk)
    node.model.diagnostics.add({ code: 'TEX-FONT', severity: 'warn', ids: [node.id], what: `the formula "${short(layout.source)}" needs the face ${face}, which was not loaded with the scene; it is being loaded now, and until it is there the pieces set in it show in another font.`, fix: ['write the LaTeX commands literally in the string passed to tex(), so the scene can ask for their fonts before the first frame', 'for a formula that changes, keep the commands in the template and only the numbers in ${…}'] }, node.src)
    rt.options.load(chunk).then(() => rt.invalidate(), () => {})
  }
}

// ── drawing ──────────────────────────────────────────────────────────────────────────────────────────
/** One drawn piece: a holder that carries its position, colour and opacity, and the shape inside. */
interface Piece { g: SVGGElement; shape: SVGElement; item: TexItem; /** user units per em of the formula the piece belongs to */ unit: number; /** what the piece put into <defs> */ clips: SVGElement[] }
const dropPieces = (list: Piece[]): void => { for (const p of list) { p.g.remove(); for (const k of p.clips) k.remove() } }
/** What a piece looks like in a frame, in the units of its holder's parent (SVG user units, y down). */
interface Look { x: number; y: number; scale: number; alpha: number; color: string; /** write progress 0..1, 1 = fully there */ written: number; /** a rule's size when it is being stretched to another rule's (user units) */ width?: number; height?: number }
/** dash length that is longer than any outline of a glyph, in em of the glyph (the trace of write() runs along it) */
const TRACE_LENGTH = 12
/** dash and gap of a dashed rule, in rule thicknesses */
const DASH = 3
const r3 = (x: number): number => Math.round(x * 1000) / 1000

function makePiece(c: Ctx2D, item: TexItem, unit: number): Piece {
  const g = c.el<SVGGElement>('g')
  const clips: SVGElement[] = []
  let shape: SVGElement
  if (item.kind === 'glyph') {
    const css = faceCss(`${item.family}-${item.bold && item.italic ? 'BoldItalic' : item.bold ? 'Bold' : item.italic ? 'Italic' : 'Regular'}`)
    shape = c.el<SVGTextElement>('text', { x: 0, y: 0, 'font-family': css.family, 'font-size': item.size * unit, 'font-weight': css.weight === 'bold' ? 'bold' : null, 'font-style': css.style === 'italic' ? 'italic' : null })
    shape.textContent = item.text
  } else if (item.kind === 'rule') {
    const w = item.width * unit, h = item.height * unit, t = item.frame * unit
    if (item.dashed) {
      // a dashed rule (\hdashline, a dashed column separator): a stroked line along its longer side
      const flat = w >= h
      shape = c.el<SVGLineElement>('line', { x1: flat ? 0 : w / 2, y1: flat ? -h / 2 : 0, x2: flat ? w : w / 2, y2: flat ? -h / 2 : -h, stroke: 'currentColor', 'stroke-width': flat ? h : w, 'stroke-dasharray': `${r3((flat ? h : w) * DASH)} ${r3((flat ? h : w) * DASH)}` })
    } else if (item.frame > 0 || item.fill) {
      // a frame (\boxed) and / or a background (\colorbox): the border lies inside the box, as in CSS
      shape = c.el<SVGRectElement>('rect', { x: t / 2, y: -h + t / 2, width: Math.max(0, w - t), height: Math.max(0, h - t), fill: item.fill ?? 'none', stroke: t > 0 ? 'currentColor' : 'none', 'stroke-width': t || null })
    } else shape = c.el<SVGRectElement>('rect', { x: 0, y: -h, width: w, height: h })
  } else {
    // a drawing: each view is a rectangle of exactly the view's size, cut to the shape of KaTeX's path. The path may
    // run far outside the view (one path serves every width); the rectangle is what is painted and what is measured.
    shape = c.el<SVGGElement>('g')
    for (const v of item.views) {
      const x = v.x * unit, top = -(v.y + v.height) * unit, w = v.width * unit, h = v.height * unit
      if (v.paths.length) {
        const fit = fitView(v)
        const id = c.uid('tex')
        const clip = c.el('clipPath', { id, clipPathUnits: 'userSpaceOnUse' })
        for (const d of v.paths) clip.appendChild(c.el('path', { d, transform: `translate(${r3(x + fit.tx * unit)} ${r3(top + fit.ty * unit)}) scale(${fit.sx * unit} ${fit.sy * unit})` }))
        c.defs.appendChild(clip)
        clips.push(clip)
        shape.appendChild(c.el('rect', { x, y: top, width: w, height: h, 'clip-path': `url(#${id})`, 'data-wipe': w }))
      }
      for (const l of v.strokes) shape.appendChild(c.el('line', { x1: x + l.x1 * w, y1: top + l.y1 * h, x2: x + l.x2 * w, y2: top + l.y2 * h, stroke: 'currentColor', 'stroke-width': l.width * item.size * unit }))
    }
  }
  g.appendChild(shape)
  return { g, shape, item, unit, clips }
}
function paintPiece(c: Ctx2D, p: Piece, look: Look): void {
  const shown = look.alpha > 0 && look.written > 0
  if (!shown) { c.set(p.g, { display: 'none' }); return }
  const scale = Math.abs(look.scale - 1) > 1e-6 ? ` scale(${Math.round(look.scale * 1e5) / 1e5})` : ''
  c.set(p.g, { display: null, transform: `translate(${r3(look.x)} ${r3(look.y)})${scale}`, fill: look.color, color: look.color, opacity: look.alpha < 1 ? r3(look.alpha) : null })
  const it = p.item
  const w = look.written
  if (it.kind === 'glyph') {
    if (w >= 1) { c.set(p.shape, { stroke: null, 'stroke-width': null, 'stroke-dasharray': null, 'stroke-opacity': null, 'fill-opacity': null }); return }
    // write(): the outline is traced, then the fill comes in while the outline goes (manim's DrawBorderThenFill)
    const fs = it.size * p.unit
    const trace = clamp01(w / TEX_STYLE.writeTrace), fill = smooth(clamp01((w - TEX_STYLE.writeTrace) / (1 - TEX_STYLE.writeTrace)))
    const length = TRACE_LENGTH * fs
    c.set(p.shape, { stroke: look.color, 'stroke-width': r3(TEX_STYLE.writeStroke * fs), 'stroke-dasharray': `${r3(length * trace)} ${r3(length)}`, 'stroke-opacity': r3(1 - fill), 'fill-opacity': r3(fill) })
  } else if (it.kind === 'rule' && !(it.frame > 0 || it.fill) && !it.dashed) {
    // a bar grows from its left end
    const width = look.width ?? it.width * p.unit, height = look.height ?? it.height * p.unit
    c.set(p.shape, { width: r3(width * (w >= 1 ? 1 : smooth(w))), height: r3(height), y: r3(-height) })
  } else if (it.kind === 'svg') {
    // a drawing is uncovered from its left end
    const k = w >= 1 ? 1 : smooth(w)
    for (const e of p.shape.children) { const full = e.getAttribute('data-wipe'); if (full !== null) c.set(e, { width: r3(Number(full) * k) }); else c.set(e, { opacity: k < 1 ? r3(k) : null }) }
  } else c.set(p.shape, { opacity: w >= 1 ? null : r3(smooth(w)) })
}

/** write(): how far piece number `rank` of `count` (left to right) is, when the whole formula is at `p`. */
export function writtenAt(p: number, rank: number, count: number): number {
  if (p >= 1 || count <= 0) return 1
  if (p <= 0) return 0
  const lag = Math.min(TEX_STYLE.writeLagTotal / (count + 1), TEX_STYLE.writeLag)
  return clamp01(p * (1 + lag * (count - 1)) - lag * rank)
}

interface Geometry { /** centre of the formula's box, em */ cx: number; cy: number; /** user units per em */ unit: number }
const geometryOf = (layout: TexLayout, r: Resolved): Geometry => ({ cx: (layout.box[0] + layout.box[2]) / 2, cy: (layout.box[1] + layout.box[3]) / 2, unit: emOf(r.size) * K })
/** rank of every piece in reading order */
const ranksOf = (layout: TexLayout): number[] => { const rank: number[] = []; layout.order.forEach((i, k) => { rank[i] = k }); return rank }
const ranks = new WeakMap<TexLayout, number[]>()
const rankOf = (layout: TexLayout): number[] => { let v = ranks.get(layout); if (!v) ranks.set(layout, (v = ranksOf(layout))); return v }

/** The colour of every piece of a formula in a frame: a part's own colour, else the plan's, else the formula's. */
function colorsIn(node: MNode, plan: Plan, frame: Frame): string[] {
  const base = node.invalid ? TEX_STYLE.errorColor : frame.prop<string>(node, 'color')
  const out = plan.colors.map((c) => c ?? base)
  for (const part of node.children) {
    if (part.kind !== 'texpart') continue
    const c = frame.prop<string | null>(part, 'color')
    if (c) for (const i of plan.parts.get(part.uid) ?? []) out[i] = c
  }
  return out
}

interface TexHandle { g: SVGGElement; key: string; own: Piece[]; ownIndex: number[]; ghosts: Piece[]; ghostIndex: number[] }
const morphing = (r: Resolved): boolean => typeof r.rewriteFrom === 'string' && r.rewriteFrom !== '' && r.rewrite < 1
const matches = new WeakMap<TexLayout, WeakMap<TexLayout, TexMatch>>()
function matchOf(a: TexLayout, b: TexLayout): TexMatch {
  let per = matches.get(a)
  if (!per) matches.set(a, (per = new WeakMap()))
  let m = per.get(b)
  if (!m) per.set(b, (m = matchItems(a, b)))
  return m
}
const mixColor = (a: string, b: string, u: number): string => (a === b || u <= 0 ? a : u >= 1 ? b : mix(a, b, u))

defineKindBackend<TexHandle, Ctx2D>('tex', {
  build: (_node, c) => ({ g: c.el<SVGGElement>('g'), key: '', own: [], ownIndex: [], ghosts: [], ghostIndex: [] }),
  update(h, r, c, node) {
    const frame = c.frame
    const plan = planOf(node, frame)
    const layout = plan.layout
    ensureFaces(layout, node, c.runtime)
    const geo = geometryOf(layout, r)
    const from = morphing(r) ? node.model.byId.get(r.rewriteFrom as string) : undefined
    const other = from && from.kind === 'tex' && from !== node ? from : null
    const otherPlan = other ? planOf(other, frame) : null
    const otherR = other ? frame.props(other) : null
    const otherGeo = otherPlan && otherR ? geometryOf(otherPlan.layout, otherR) : null
    // while it is being rewritten a formula draws every one of its pieces itself; otherwise its parts draw theirs
    const mine = layout.items.map((_, i) => i).filter((i) => other || !plan.owner[i])
    const key = `${plan.key}\u0001${geo.unit}\u0001${mine.join(',')}\u0001${otherPlan ? otherPlan.key + '\u0001' + otherGeo!.unit + (r.rewriteKeep ? 'k' : '') : ''}`
    if (h.key !== key) {
      h.key = key
      dropPieces(h.own)
      dropPieces(h.ghosts)
      h.ownIndex = mine
      h.own = mine.map((i) => makePiece(c, layout.items[i]!, geo.unit))
      // the pieces of the formula that is leaving: all of them, drawn here while the two change places
      h.ghostIndex = otherPlan ? otherPlan.layout.items.map((_, i) => i) : []
      h.ghosts = otherPlan ? h.ghostIndex.map((i) => makePiece(c, otherPlan.layout.items[i]!, otherGeo!.unit)) : []
      for (const p of h.ghosts) h.g.appendChild(p.g)
      for (const p of h.own) h.g.appendChild(p.g)
    }
    const colors = colorsIn(node, plan, frame)
    const rank = rankOf(layout)
    const rv = frame.reveal(node)
    const p = rv.mode === 'fade' ? 1 : rv.p
    const at = (it: TexItem): [number, number] => [(it.x - geo.cx) * geo.unit, -(it.y - geo.cy) * geo.unit]
    if (!other || !otherPlan || !otherGeo) {
      h.own.forEach((piece, k) => {
        const i = h.ownIndex[k]!
        const [x, y] = at(piece.item)
        paintPiece(c, piece, { x, y, scale: 1, alpha: 1, color: colors[i]!, written: writtenAt(p, rank[i]!, layout.order.length) })
      })
      return
    }
    // ── rewrite: where the leaving formula's pieces are, in this formula's own coordinates ──
    const u = clamp01(r.rewrite as number)
    const wa = frame.world(other), wb = frame.world(node)
    const cos = Math.cos(qzDeg(wb.q) * (Math.PI / 180)), sin = Math.sin(qzDeg(wb.q) * (Math.PI / 180))
    // one unit of the leaving formula, in units of this one
    const ratio = wa.s / wb.s
    const fromOther = (it: TexItem): [number, number] => {
      const local: Vec3 = [((it.x - otherGeo.cx) * otherGeo.unit) / K, ((it.y - otherGeo.cy) * otherGeo.unit) / K, 0]
      const w = apply(wa, local)
      const dx = (w[0] - wb.p[0]) / wb.s, dy = (w[1] - wb.p[1]) / wb.s
      return [(dx * cos + dy * sin) * K, -(-dx * sin + dy * cos) * K]
    }
    const otherColors = colorsIn(other, otherPlan, frame)
    const match = matchOf(otherPlan.layout, layout)
    const fade = clamp01(TEX_STYLE.rewriteFade) || 1, drift = TEX_STYLE.rewriteDrift
    const leaving = 1 - smooth(clamp01(u / fade)), arriving = smooth(clamp01((u - (1 - fade)) / fade))
    const centreA = fromOther({ x: otherGeo.cx, y: otherGeo.cy } as TexItem)
    const partner = new Map<number, number>(), partnerOfA = new Map<number, number>()
    for (const [ia, ib] of match.pairs) { partner.set(ib, ia); partnerOfA.set(ia, ib) }
    const same = (a: TexItem, b: TexItem): boolean => a.kind === 'glyph' || (a.kind === 'rule' && b.kind === 'rule' && !a.frame && !b.frame && !a.fill && !b.fill)
    h.own.forEach((piece, k) => {
      const i = h.ownIndex[k]!
      const [x, y] = at(piece.item)
      const ia = partner.get(i)
      if (ia === undefined) {
        // a new piece: comes in over the last part of the transition, from a little way towards the old formula
        paintPiece(c, piece, { x: x + (centreA[0] - x) * drift * (1 - arriving), y: y + (centreA[1] - y) * drift * (1 - arriving), scale: 1, alpha: arriving, color: colors[i]!, written: 1 })
        return
      }
      const a = otherPlan.layout.items[ia]!
      const [ax, ay] = fromOther(a)
      const b = piece.item
      const look: Look = { x: ax + (x - ax) * u, y: ay + (y - ay) * u, scale: 1, alpha: 1, color: mixColor(otherColors[ia]!, colors[i]!, u), written: 1 }
      if (a.kind === 'glyph' && b.kind === 'glyph') { const s0 = (a.size * otherGeo.unit * ratio) / (b.size * geo.unit); look.scale = s0 + (1 - s0) * u } else if (same(a, b) && a.kind === 'rule' && b.kind === 'rule') {
        look.width = a.width * otherGeo.unit * ratio + (b.width * geo.unit - a.width * otherGeo.unit * ratio) * u
        look.height = a.height * otherGeo.unit * ratio + (b.height * geo.unit - a.height * otherGeo.unit * ratio) * u
      } else look.alpha = u // a drawing of another shape (a wider root sign): cross-fades with the old one as both move
      paintPiece(c, piece, look)
    })
    h.ghosts.forEach((piece, k) => {
      const ia = h.ghostIndex[k]!
      const a = piece.item
      const [ax, ay] = fromOther(a)
      const ib = partnerOfA.get(ia)
      if (ib === undefined) {
        // a piece that has no place in the new formula: goes over the first part of the transition (it is still on stage in its own formula when that one stays)
        // … drifting a little way towards the centre of the new one (the origin of this holder)
        const k = 1 - drift * (1 - leaving)
        paintPiece(c, piece, { x: ax * k, y: ay * k, scale: ratio, alpha: r.rewriteKeep ? 0 : leaving, color: otherColors[ia]!, written: 1 })
        return
      }
      const b = layout.items[ib]!
      if (same(a, b)) { paintPiece(c, piece, { x: 0, y: 0, scale: 1, alpha: 0, color: '#000000', written: 1 }); return } // its partner is drawn above
      const [bx, by] = at(b)
      paintPiece(c, piece, { x: ax + (bx - ax) * u, y: ay + (by - ay) * u, scale: ratio, alpha: 1 - u, color: mixColor(otherColors[ia]!, colors[ib]!, u), written: 1 })
    })
  },
})

// ── a part: draws the pieces it stands for, in a holder of its own, so every setter and verb works on it ─────
interface PartHandle { g: SVGGElement; hit: SVGRectElement; key: string; pieces: Piece[]; index: number[] }
defineKindBackend<PartHandle, Ctx2D>('texpart', {
  build(_node, c) {
    const g = c.el<SVGGElement>('g')
    // an unpainted rectangle the size of the part: marks, labels and the pointer find the part by its box
    const hit = c.el<SVGRectElement>('rect', { fill: 'none', stroke: 'none', 'pointer-events': 'none' })
    g.appendChild(hit)
    return { g, hit, key: '', pieces: [], index: [] }
  },
  update(h, _r, c, node) {
    const owner = node.parent
    if (!owner || owner.kind !== 'tex') return
    const frame = c.frame
    const plan = planOf(owner, frame)
    const layout = plan.layout
    const r = frame.props(owner)
    const geo = geometryOf(layout, r)
    const pg = partGeometry(node, frame)
    c.set(h.hit, { x: -pg.halfWidth * K, y: -pg.halfHeight * K, width: 2 * pg.halfWidth * K, height: 2 * pg.halfHeight * K })
    // while the formula is being rewritten it draws all of its pieces itself
    const mine = morphing(r) ? [] : (plan.parts.get(node.uid) ?? []).filter((i) => plan.owner[i] === node)
    const key = `${plan.key}\u0001${geo.unit}\u0001${mine.join(',')}`
    if (h.key !== key) {
      h.key = key
      dropPieces(h.pieces)
      h.index = mine
      h.pieces = mine.map((i) => makePiece(c, layout.items[i]!, geo.unit))
      for (const p of h.pieces) h.g.appendChild(p.g)
    }
    if (!h.pieces.length) return
    const colors = colorsIn(owner, plan, frame)
    const rank = rankOf(layout)
    // the formula's write() reaches its parts in reading order; a part written on its own writes its pieces in order
    const up = frame.reveal(owner), own = frame.reveal(node)
    const ownP = clamp01(frame.prop<number>(node, 'present'))
    const whole = up.mode === 'fade' ? 1 : up.p
    const alone = own.mode === 'fade' || ownP >= 1 ? 1 : ownP
    const order = [...h.index].sort((a, b) => rank[a]! - rank[b]!)
    // the holder sits on the centre of the part's box: pieces are placed relative to it
    const ox = pg.x / (geo.unit / K), oy = pg.y / (geo.unit / K)
    h.pieces.forEach((piece, k) => {
      const i = h.index[k]!
      const it = piece.item
      const written = Math.min(writtenAt(whole, rank[i]!, layout.order.length), writtenAt(alone, order.indexOf(i), order.length))
      paintPiece(c, piece, { x: (it.x - geo.cx - ox) * geo.unit, y: -(it.y - geo.cy - oy) * geo.unit, scale: 1, alpha: 1, color: colors[i]!, written })
    })
  },
})
