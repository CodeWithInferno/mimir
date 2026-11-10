// LaTeX → positioned glyphs, rules and drawings. Pure: no DOM, no clock; the same source gives the same numbers on
// every machine. KaTeX parses the source and builds its box tree (every vertical position in it is explicit, and
// every glyph carries the width of its font's metrics); this file does what a browser's CSS engine would do with
// that tree — the horizontal flow, the tables of stacked rows, the stretchy pieces — and returns coordinates in em.
// Part of the tex chunk only (src/tex/tex.chunk.ts): the main chunk never pays for KaTeX.
import katex from 'katex'

/** One drawn piece of a formula. Coordinates are em of the formula, x right, y UP, origin on the first baseline. */
export type TexItem = TexGlyph | TexRule | TexDrawing
interface ItemBase {
  /** what the piece is, for matching between formulas: the same glyph of the same face, a rule, a kind of drawing */
  sig: string
  /** a colour given in the source (\color, \textcolor), else null */
  color: string | null
  /** box of the piece: [left, bottom, right, top] */
  box: [number, number, number, number]
}
export interface TexGlyph extends ItemBase {
  kind: 'glyph'
  text: string
  /** origin of the glyph on its baseline */
  x: number
  y: number
  /** font size, in em of the formula (0.7 in a superscript) */
  size: number
  /** font family (one of TEX_FACES), weight and slant */
  family: string
  bold: boolean
  italic: boolean
}
export interface TexRule extends ItemBase {
  kind: 'rule'
  /** lower-left corner and size */
  x: number
  y: number
  width: number
  height: number
  dashed: boolean
  /** > 0: a frame of this thickness instead of a filled bar (\boxed) */
  frame: number
  /** background of a frame (\colorbox), else null */
  fill: string | null
}
/** A stroke of a drawing (\cancel): end points as shares of the view (y down), width in em of the piece. */
export interface TexStroke { x1: number; y1: number; x2: number; y2: number; width: number }
/**
 * One viewport of a drawing: KaTeX's own SVG piece (a surd, a brace, an arrow), placed and cut the way its stylesheet
 * would. x, y = lower-left corner relative to the drawing's. The paths are in the units of `viewBox`
 * ([min x, min y, width, height]) and are fitted into the view by `aspect` (SVG's preserveAspectRatio); what falls
 * outside the view is not drawn (that is how one long path serves every width).
 */
export interface TexView { x: number; y: number; width: number; height: number; viewBox: [number, number, number, number] | null; aspect: string; paths: string[]; strokes: TexStroke[] }
export interface TexDrawing extends ItemBase {
  kind: 'svg'
  /** lower-left corner and size of all views together */
  x: number
  y: number
  width: number
  height: number
  /** font size the drawing's em lengths refer to, in em of the formula */
  size: number
  views: TexView[]
}
export interface TexError { message: string; /** the offending piece of the source */ token: string; position: number | null }
export interface TexLayout {
  source: string
  display: boolean
  /** every piece, in the order KaTeX builds them (what a key is matched against) */
  items: TexItem[]
  /** reading order: indices into items, left to right (ties: top first). write() reveals in this order. */
  order: number[]
  /** box of everything drawn: [left, bottom, right, top] */
  box: [number, number, number, number]
  /** faces used, as KaTeX names its font files: 'Main-Regular', 'Math-Italic', 'Size2-Regular' … */
  faces: string[]
  /** set when the source did not parse: items then hold the source itself, as text */
  error: TexError | null
}

// ── what KaTeX's stylesheet says, as data ────────────────────────────────────────────────────────────
/** font-size steps of KaTeX's sizing classes (reset-sizeN sizeM → SIZES[M] / SIZES[N]) */
const SIZES = [1, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.2, 1.44, 1.728, 2.074, 2.488]
type Align = 'left' | 'center' | 'right'
interface Face { family?: string; bold?: boolean; italic?: boolean }
/** class → font change, in the order of the stylesheet (a later rule wins) */
const FACE_RULES: [string, Face][] = [
  ['textbf', { bold: true }], ['textit', { italic: true }], ['textrm', { family: 'Main' }], ['textsf', { family: 'SansSerif' }], ['texttt', { family: 'Typewriter' }],
  ['mathnormal', { family: 'Math', italic: true }], ['mathit', { family: 'Main', italic: true }], ['mathrm', { italic: false }], ['mathbf', { family: 'Main', bold: true }],
  ['boldsymbol', { family: 'Math', bold: true, italic: true }], ['amsrm', { family: 'AMS' }], ['mathbb', { family: 'AMS' }], ['textbb', { family: 'AMS' }],
  ['mathcal', { family: 'Caligraphic' }], ['mathfrak', { family: 'Fraktur' }], ['textfrak', { family: 'Fraktur' }], ['mathboldfrak', { family: 'Fraktur', bold: true }],
  ['textboldfrak', { family: 'Fraktur', bold: true }], ['mathtt', { family: 'Typewriter' }], ['mathscr', { family: 'Script' }], ['textscr', { family: 'Script' }],
  ['mathsf', { family: 'SansSerif' }], ['mathboldsf', { family: 'SansSerif', bold: true }], ['textboldsf', { family: 'SansSerif', bold: true }],
  ['mathsfit', { family: 'SansSerif', italic: true }], ['mathitsf', { family: 'SansSerif', italic: true }], ['textitsf', { family: 'SansSerif', italic: true }],
  ['mainrm', { family: 'Main', italic: false }],
]
const ALIGN_RULES: Record<string, Align> = { msupsub: 'left', mfrac: 'center', 'op-limits': 'center', 'katex-accent': 'center', 'col-align-c': 'center', 'col-align-l': 'left', 'col-align-r': 'right', 'svg-align': 'left', 'x-arrow': 'center', mover: 'center', munder: 'center' }
/** horizontal padding of a class, em: [left, right] */
const PADDING: Record<string, [number, number]> = { 'x-arrow-pad': [0.5, 0.5], 'cd-arrow-pad': [0.27778, 0.55556], boxpad: [0.3, 0.3], 'cancel-pad': [0.2, 0.2], anglpad: [0.03889, 0.03889] }
/** classes whose box is as wide as the row it sits in (width: 100%) */
const FULL_WIDTH = ['frac-line', 'overline-line', 'underline-line', 'katex-hline', 'katex-hdashline', 'katex-stretchy', 'hide-tail']
const RULE_LINES = ['frac-line', 'overline-line', 'underline-line', 'katex-hline', 'katex-hdashline']
/** lengths of KaTeX's stylesheet that are not in its tree, em */
const SHEET = {
  /** width of the empty delimiter beside a fraction */
  nullDelimiter: 0.12,
  /** \cancel overlaps its neighbours by this much on each side */
  cancelLap: 0.2,
  /** the index of a root: pulled in from the left, and the surd pulled under it */
  rootLeft: 0.2777777778,
  rootRight: -0.5555555556,
  /** border of \fbox and \boxed when the tree gives none */
  frame: 0.04,
  /** thickness of the line of \sout */
  strikeout: 0.08,
}
/** pieces of a stretchy drawing: [left edge, width] as shares of the whole */
const PIECES: Record<string, [number, number]> = { 'halfarrow-left': [0, 0.502], 'halfarrow-right': [0.498, 0.502], 'brace-left': [0, 0.251], 'brace-center': [0.25, 0.5], 'brace-right': [0.749, 0.251] }
/**
 * Lines of a formula that has \\ at the top level: every line is at least this tall above and below its baseline, em
 * (what KaTeX's stylesheet gives a line of Computer Modern in a browser). Taller lines sit box on box.
 */
export const LINE_ASCENT = 0.91
export const LINE_DESCENT = 0.35
/** what an unknown character is taken to be wide and tall, em (KaTeX has no metrics for it) */
export const UNKNOWN_ADVANCE = 0.5
export const UNKNOWN_HEIGHT = 0.7
/**
 * Glyphs whose advance in the font file is not the width in KaTeX's metrics table (a browser, and so this layout,
 * goes by the font). `${face}:${character}` → em. tests/unit/tex/metrics.test.ts reads the font files and proves
 * that this list is complete and exact.
 */
export const FONT_ADVANCE: Record<string, number> = {
  'Size1-Regular:\u222c': 0.819, 'Size1-Regular:\u222d': 1.166, 'Size2-Regular:\u222c': 1.084, 'Size2-Regular:\u222d': 1.592,
  'Main-Regular:\u00b0': 0.5, 'Main-Bold:\u00b0': 0.575, 'Main-Italic:\u00b0': 0.511, 'Main-BoldItalic:\u00b0': 0.789,
  'SansSerif-Regular:\u00b0': 0.383, 'SansSerif-Bold:\u00b0': 0.617, 'SansSerif-Italic:\u00b0': 0.512,
}

// ── the walk ─────────────────────────────────────────────────────────────────────────────────────────
interface Ctx { em: number; family: string; bold: boolean; italic: boolean; color: string | null; align: Align; hidden: boolean }
interface Frag { advance: number; items: TexItem[]; /** the width came from the row: lay it out again once the row's width is known */ flex: boolean }
interface VNode { classes?: string[]; style?: Record<string, string | undefined>; children?: VNode[]; attributes?: Record<string, string>; text?: string; width?: number; height?: number; depth?: number; italic?: number; toMarkup?: () => string; pathName?: string }

const EMPTY: Frag = { advance: 0, items: [], flex: false }
const has = (n: VNode, c: string): boolean => !!n.classes && n.classes.includes(c)
const hasAny = (n: VNode, list: readonly string[]): boolean => !!n.classes && list.some((c) => n.classes!.includes(c))

/** a CSS length of KaTeX's tree → em of the formula. `whole` is what a percentage refers to. */
function len(v: string | undefined, em: number, whole = 0): number {
  if (!v) return 0
  const s = v.trim()
  const calc = /^calc\(\s*([-\d.]+)%\s*([+-])\s*([-\d.]+)em\s*\)$/.exec(s)
  if (calc) return (parseFloat(calc[1]!) / 100) * whole + (calc[2] === '-' ? -1 : 1) * parseFloat(calc[3]!) * em
  const n = parseFloat(s)
  if (!Number.isFinite(n)) return 0
  if (s.endsWith('%')) return (n / 100) * whole
  if (s.endsWith('em')) return n * em
  return 0 // px and unitless values only appear as hairline minimums
}
function move(items: TexItem[], dx: number, dy: number): void {
  if (!dx && !dy) return
  for (const it of items) {
    it.x += dx; it.y += dy
    it.box[0] += dx; it.box[2] += dx; it.box[1] += dy; it.box[3] += dy
  }
}

function cascade(c: Ctx, n: VNode): Ctx {
  const cl = n.classes
  const st = n.style
  if ((!cl || !cl.length) && (!st || st.color === undefined)) return c
  const out: Ctx = { ...c }
  if (cl) {
    if (cl.includes('katex-sizing') || cl.includes('fontsize-ensurer')) {
      let from = 0, to = 0
      for (const k of cl) {
        if (k.startsWith('reset-size')) from = Number(k.slice(10))
        else if (k.startsWith('size')) to = Number(k.slice(4))
      }
      if (SIZES[from] && SIZES[to]) out.em = c.em * (SIZES[to]! / SIZES[from]!)
    }
    for (const [name, face] of FACE_RULES) {
      if (!cl.includes(name)) continue
      if (face.family !== undefined) out.family = face.family
      if (face.bold !== undefined) out.bold = face.bold
      if (face.italic !== undefined) out.italic = face.italic
    }
    if (cl.includes('delimsizing')) for (let k = 1; k <= 4; k++) if (cl.includes('size' + k)) out.family = 'Size' + k
    if (cl.includes('op-symbol')) { if (cl.includes('small-op')) out.family = 'Size1'; else if (cl.includes('large-op')) out.family = 'Size2' }
    for (const k of cl) { const a = ALIGN_RULES[k]; if (a) out.align = a }
  }
  if (st && st.color !== undefined) {
    if (st.color === 'transparent') out.hidden = true
    else out.color = st.color
  }
  return out
}
/** `.delimsizing.mult .delim-size1 > span` and `.delim-size4 > span`: the pieces of a stacked delimiter */
const delimFace = (parent: VNode, c: Ctx): Ctx => (has(parent, 'delim-size1') ? { ...c, family: 'Size1' } : has(parent, 'delim-size4') ? { ...c, family: 'Size4' } : c)

const faceName = (g: { family: string; bold: boolean; italic: boolean }): string => `${g.family}-${g.bold && g.italic ? 'BoldItalic' : g.bold ? 'Bold' : g.italic ? 'Italic' : 'Regular'}`

function symbol(n: VNode, c0: Ctx): Frag {
  const text = n.text ?? ''
  if (!text || text === '​') return EMPTY
  const c = cascade(c0, n)
  const em = c.em
  const st = n.style ?? {}
  // a character KaTeX has no metrics for (a letter of another script inside \text) gets a nominal width
  const known = (n.width ?? 0) > 0 || (n.height ?? 0) > 0 || text === ' ' || text === ' '
  const width = (FONT_ADVANCE[`${faceName(c)}:${text}`] ?? (known ? n.width ?? 0 : UNKNOWN_ADVANCE * [...text].length)) * em
  const height = (known ? n.height ?? 0 : UNKNOWN_HEIGHT) * em, depth = (known ? n.depth ?? 0 : 0) * em
  const ml = len(st.marginLeft, em), mr = len(st.marginRight, em) + (n.italic ?? 0) * em
  const dy = len(st.bottom, em) - len(st.top, em)
  const advance = ml + width + mr
  if (c.hidden || !text.trim() || text === ' ') return { advance, items: [], flex: false }
  const g: TexGlyph = { kind: 'glyph', sig: '', text, x: ml, y: dy, size: em, family: c.family, bold: c.bold, italic: c.italic, color: c.color, box: [ml, dy - depth, ml + width, dy + height] }
  g.sig = `${faceName(g)}:${text}`
  return { advance, items: [g], flex: false }
}

const share = (v: string | undefined): number => (v && v.endsWith('%') ? parseFloat(v) / 100 : 0)
/** the viewport of an <svg> of KaTeX's tree, as a view of `width` × `height` whose lower-left corner is at (x, 0) */
function view(svg: VNode, x: number, width: number, height: number): TexView {
  const a = svg.attributes ?? {}
  const box = (a.viewBox ?? '').trim().split(/[\s,]+/).map(Number)
  const paths: string[] = [], strokes: TexStroke[] = []
  for (const k of svg.children ?? []) {
    if (k.pathName !== undefined) {
      // the path data is only reachable as markup: <path d="…"/>
      const d = /\sd="([^"]*)"/.exec(k.toMarkup ? k.toMarkup() : '')
      if (d) paths.push(d[1]!.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
    } else if (k.attributes) {
      const l = k.attributes
      strokes.push({ x1: share(l.x1), y1: share(l.y1), x2: share(l.x2), y2: share(l.y2), width: parseFloat(l['stroke-width'] ?? '') || 0.046 })
    }
  }
  return { x, y: 0, width, height, viewBox: box.length === 4 && box.every(Number.isFinite) ? (box as [number, number, number, number]) : null, aspect: a.preserveAspectRatio ?? 'xMidYMid meet', paths, strokes }
}
/**
 * SVG's rule for fitting a view box into a viewport (preserveAspectRatio), as numbers: a point (px, py) of the view
 * box is drawn at (px * sx + tx, py * sy + ty), measured from the upper-left corner of the view, y down.
 */
export function fitView(v: TexView): { sx: number; sy: number; tx: number; ty: number } {
  if (!v.viewBox || !(v.viewBox[2] > 0) || !(v.viewBox[3] > 0)) return { sx: 1, sy: 1, tx: 0, ty: 0 }
  const [minX, minY, w, h] = v.viewBox
  const kx = v.width / w, ky = v.height / h
  if (v.aspect.trim() === 'none') return { sx: kx, sy: ky, tx: -minX * kx || 0, ty: -minY * ky || 0 }
  const k = v.aspect.includes('slice') ? Math.max(kx, ky) : Math.min(kx, ky)
  const ax = v.aspect.includes('xMin') ? 0 : v.aspect.includes('xMax') ? 1 : 0.5, ay = v.aspect.includes('YMin') ? 0 : v.aspect.includes('YMax') ? 1 : 0.5
  return { sx: k, sy: k, tx: (v.width - w * k) * ax - minX * k || 0, ty: (v.height - h * k) * ay - minY * k || 0 }
}
const drawingName = (svg: VNode): string => {
  const p = (svg.children ?? []).map((k) => k.pathName ?? 'line')[0] ?? 'svg'
  return p.replace(/(Main|Size\d|Tall)$/, '')
}
function drawing(views: TexView[], name: string, c: Ctx): TexDrawing[] {
  if (c.hidden || !views.length) return []
  const x0 = Math.min(...views.map((v) => v.x)), x1 = Math.max(...views.map((v) => v.x + v.width)), top = Math.max(...views.map((v) => v.height))
  // views are placed relative to the drawing's own corner, so moving the drawing moves them
  return [{ kind: 'svg', sig: 'svg:' + name, color: c.color, x: x0, y: 0, width: x1 - x0, height: top, size: c.em, views: views.map((v) => ({ ...v, x: v.x - x0 })), box: [x0, 0, x1, top] }]
}
const svgChild = (n: VNode): VNode | undefined => n.children?.find((k) => k.attributes !== undefined && k.classes === undefined && k.children !== undefined)

function span(n: VNode, c0: Ctx, avail: number | null, parent: VNode | null): Frag {
  if (hasAny(n, ['katex-strut', 'pstrut', 'vlist-s', 'katex-fix'])) return EMPTY
  let c = cascade(c0, n)
  if (parent) c = delimFace(parent, c)
  const em = c.em
  const st = n.style ?? {}
  let ml = len(st.marginLeft, em), mr = len(st.marginRight, em)
  if (st.margin) { const m = st.margin.trim().split(/\s+/); ml = mr = len(m[1] ?? m[0], em) }
  if (has(n, 'cancel-lap')) { ml -= SHEET.cancelLap * em; mr -= SHEET.cancelLap * em }
  if (has(n, 'katex-root') && parent && has(parent, 'sqrt')) { ml += SHEET.rootLeft * em; mr += SHEET.rootRight * em }
  let pl = len(st.paddingLeft, em), pr = 0
  for (const k of n.classes ?? []) { const p = PADDING[k]; if (p) { pl += p[0] * em; pr += p[1] * em } }
  const dy = len(st.bottom, em) - len(st.top, em)
  const dx = len(st.left, em)
  const done = (items: TexItem[], width: number, flex: boolean): Frag => {
    move(items, ml + pl + dx, dy)
    return { advance: ml + pl + width + pr + mr, items, flex }
  }

  if (has(n, 'vlist-t')) { const v = vlist(n, c); return done(v.items, v.advance, false) }

  // a bar as wide as its row: fraction line, overline, underline, \hline
  if (hasAny(n, RULE_LINES)) {
    const width = avail ?? 0, height = len(st.borderBottomWidth, em)
    const items: TexItem[] = c.hidden || !(width > 0) ? [] : [{ kind: 'rule', sig: 'rule', color: c.color, x: 0, y: 0, width, height, dashed: has(n, 'katex-hdashline'), frame: 0, fill: null, box: [0, 0, width, height] }]
    return done(items, width, true)
  }
  // \rule{width}{height}: a bar of its own size, raised by `bottom`
  if (has(n, 'katex-rule')) {
    const width = len(st.borderRightWidth, em), height = len(st.borderTopWidth, em)
    const items: TexItem[] = c.hidden || !(width > 0 && height > 0) ? [] : [{ kind: 'rule', sig: 'rule', color: c.color, x: 0, y: 0, width, height, dashed: false, frame: 0, fill: null, box: [0, 0, width, height] }]
    return done(items, width, false)
  }
  // a vertical line between the columns of an array
  if (has(n, 'vertical-separator')) {
    const width = len(st.borderRightWidth, em), height = len(st.height, em), raise = len(st.verticalAlign, em)
    const items: TexItem[] = c.hidden ? [] : [{ kind: 'rule', sig: 'rule', color: c.color, x: 0, y: raise, width, height, dashed: st.borderRightStyle === 'dashed', frame: 0, fill: null, box: [0, raise, width, raise + height] }]
    return done(items, width, false)
  }
  if (has(n, 'nulldelimiter')) return done([], SHEET.nullDelimiter * em, false)

  // \llap, \rlap, \clap, \phantom's zero-width forms: the content hangs out of a box of no width
  if (hasAny(n, ['llap', 'rlap', 'clap'])) {
    const inner = n.children?.find((k) => has(k, 'katex-inner'))
    const f = inner ? span(inner, c, null, n) : EMPTY
    move(f.items, has(n, 'llap') ? -f.advance : has(n, 'clap') ? -f.advance / 2 : 0, 0)
    return done(f.items, 0, false)
  }

  // a stretchy drawing in several pieces (a brace, a two-headed arrow), or a frame around its row (\boxed, \colorbox)
  if (has(n, 'katex-stretchy')) {
    const width = Math.max(avail ?? 0, len(st.minWidth, em))
    const height = len(st.height, em)
    const views: TexView[] = []
    let name = 'svg'
    for (const k of n.children ?? []) {
      const piece = Object.keys(PIECES).find((p) => has(k, p))
      const svg = svgChild(k)
      if (!piece || !svg) continue
      const [at, share] = PIECES[piece]!
      views.push(view(svg, at * width, share * width, len(k.style?.height, em) || height))
      name = drawingName(svg).replace(/(left|right|center|Left|Right|Center)$/, '')
    }
    const own = svgChild(n)
    if (own) { views.push(view(own, 0, width, height)); name = drawingName(own) }
    const items: TexItem[] = drawing(views, name, c)
    if (!views.length && !c.hidden && width > 0) {
      // a frame (border) and / or a background; \sout is a bar through the middle of the row
      const frame = st.borderStyle === 'solid' || hasAny(n, ['fbox', 'fcolorbox']) ? len(st.borderWidth, em) || SHEET.frame * em : 0
      const fill = st.backgroundColor ?? null
      const sout = has(n, 'katex-sout')
      const border = st.borderColor ?? c.color
      if (sout) items.push({ kind: 'rule', sig: 'rule', color: c.color, x: 0, y: 0, width, height: SHEET.strikeout * em, dashed: false, frame: 0, fill: null, box: [0, 0, width, SHEET.strikeout * em] })
      else if (frame > 0 || fill) items.push({ kind: 'rule', sig: 'frame', color: border, x: 0, y: 0, width, height, dashed: false, frame, fill, box: [0, 0, width, height] })
    }
    return done(items, width, true)
  }

  // a span that holds one drawing: the surd of a root, a tall delimiter, \vec's arrow, the strokes of \cancel
  const svg = svgChild(n)
  if (svg) {
    const height = len(st.height, em)
    const fixed = /width:\s*([-\d.]+)em/.exec(svg.attributes?.style ?? '')
    const full = has(n, 'hide-tail')
    const own = st.width ? len(st.width, em) : full ? Math.max(avail ?? 0, len(st.minWidth, em)) : 0
    // `.katex svg { width: 100% }`: of the span when it is the positioned box, else of the row it sits in
    const width = fixed ? parseFloat(fixed[1]!) * em : st.width || full ? own : avail ?? 0
    return done(drawing(width > 0 ? [view(svg, 0, width, height)] : [], drawingName(svg), c), own, !fixed && !st.width)
  }

  // everything else: children side by side
  const f = flow(n.children ?? [], c, avail, n)
  let width = f.advance
  if (st.width && !st.width.includes('%') && hasAny(n, ['arraycolsep', 'katex-overlay'])) width = len(st.width, em)
  if ((has(n, 'accent-body') && !has(n, 'accent-full')) || has(n, 'katex-thinbox')) width = 0
  if (st.minWidth) width = Math.max(width, len(st.minWidth, em))
  return done(f.items, width, f.flex)
}

/** the classes KaTeX gave a symbol, as it compares them (without the marker of keepSymbolsApart) */
const ownClasses = (n: VNode): string[] => (n.classes ?? []).filter((k) => !k.startsWith(APART))
/**
 * Would KaTeX have merged symbol `next` into the run that started with `first` (its tryCombineChars)? Inside such a
 * run ("softmax", "26") only the last character keeps its italic correction, as in a word of text.
 */
function sameRun(first: VNode, lastItalic: number, next: VNode): boolean {
  const a = ownClasses(first), b = ownClasses(next)
  // the letters of a named operator (\gcd, \lim) carry no class and are never merged: KaTeX builds them outside an expression
  if (!a.length || a.filter(Boolean).join(' ') !== b.filter(Boolean).join(' ')) return false
  if ((first as { skew?: number }).skew !== (next as { skew?: number }).skew || (first as { maxFontSize?: number }).maxFontSize !== (next as { maxFontSize?: number }).maxFontSize) return false
  if (lastItalic !== 0 && a.includes('mathnormal')) return false
  if (a.length === 1 && (a[0] === 'mbin' || a[0] === 'mord')) return false
  const sa = first.style ?? {}, sb = next.style ?? {}
  for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) if (sa[k] !== sb[k]) return false
  return true
}
function flow(children: VNode[], c: Ctx, avail: number | null, parent: VNode | null): Frag {
  const items: TexItem[] = []
  let x = 0, flex = false
  let run: { first: VNode; italic: number; em: number } | null = null
  for (const k of children) {
    const isSymbol = typeof k.text === 'string'
    if (isSymbol && run && sameRun(run.first, run.italic, k)) x -= run.italic * run.em // the character before gives up its italic correction
    else if (isSymbol) run = { first: k, italic: 0, em: c.em }
    else run = null
    if (isSymbol && run) run.italic = k.italic ?? 0
    const f = lay(k, c, avail, parent)
    if (f === EMPTY) continue
    move(f.items, x, 0)
    for (const it of f.items) items.push(it)
    x += f.advance
    flex ||= f.flex
  }
  return { advance: x, items, flex }
}

function lay(n: VNode, c: Ctx, avail: number | null, parent: VNode | null): Frag {
  if (typeof n.text === 'string') return symbol(n, parent ? delimFace(parent, c) : c)
  if (n.classes === undefined) return n.children && n.attributes === undefined ? flow(n.children, c, avail, parent) : EMPTY // a fragment; a bare <svg> is drawn by its span
  return span(n, c, avail, parent)
}

/** KaTeX's vlist: rows stacked at explicit heights; as wide as its widest row; each row aligned by text-align. */
function vlist(table: VNode, c: Ctx): Frag {
  const cell = table.children?.[0]?.children?.find((k) => has(k, 'vlist'))
  if (!cell) return EMPTY
  interface Row { c: Ctx; ml: number; mr: number; up: number; elems: VNode[]; frags: Frag[]; width: number; wrap: VNode }
  const rows: Row[] = []
  for (const wrap of cell.children ?? []) {
    const rc = cascade(c, wrap)
    const em = rc.em
    const st = wrap.style ?? {}
    let strut = 0
    const elems: VNode[] = []
    for (const k of wrap.children ?? []) { if (has(k, 'pstrut')) strut = len(k.style?.height, em); else elems.push(k) }
    // first pass: what each row needs when nothing stretches
    const frags = elems.map((e) => lay(e, rc, null, wrap))
    rows.push({ c: rc, ml: len(st.marginLeft, em), mr: len(st.marginRight, em), up: -len(st.top, em) - strut, elems, frags, width: frags.reduce((s, f) => s + f.advance, 0), wrap })
  }
  const width = Math.max(0, ...rows.map((r) => r.ml + r.width + r.mr))
  const items: TexItem[] = []
  for (const r of rows) {
    const room = width - r.ml - r.mr
    // second pass: the pieces that take the width of their row (rules, stretchy drawings)
    const frags = r.frags.map((f, i) => (f.flex ? lay(r.elems[i]!, r.c, room, r.wrap) : f))
    const used = frags.reduce((s, f) => s + f.advance, 0)
    const slack = Math.max(0, room - used)
    let x = r.ml + (r.c.align === 'center' ? slack / 2 : r.c.align === 'right' ? slack : 0)
    for (const f of frags) {
      move(f.items, x, r.up)
      for (const it of f.items) items.push(it)
      x += f.advance
    }
  }
  return { advance: width, items, flex: false }
}

// ── the public function ──────────────────────────────────────────────────────────────────────────────
const find = (n: VNode, cls: string): VNode | null => {
  if (has(n, cls)) return n
  for (const k of n.children ?? []) { const hit = find(k, cls); if (hit) return hit }
  return null
}
const unionBox = (items: readonly TexItem[]): [number, number, number, number] => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const it of items) { x0 = Math.min(x0, it.box[0]); y0 = Math.min(y0, it.box[1]); x1 = Math.max(x1, it.box[2]); y1 = Math.max(y1, it.box[3]) }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : [0, 0, 0, 0]
}
/** reading order: left to right by the left edge; pieces that start together go top first */
export function readingOrder(items: readonly TexItem[]): number[] {
  return items.map((_, i) => i).sort((a, b) => items[a]!.box[0] - items[b]!.box[0] || items[b]!.box[3] - items[a]!.box[3] || a - b)
}

interface KatexError { message?: string; rawMessage?: string; position?: number; length?: number }
/**
 * KaTeX merges neighbouring characters of one face into a single node ("time", "26") and keeps only the first one's
 * width, because a browser would measure the text anyway. This layout needs every width, so every symbol gets a class
 * of its own, which is all it takes for KaTeX to leave them apart; the layout ignores classes it does not know.
 */
const APART = 'mimir-g'
let symbols = 0
let apart = false
function keepSymbolsApart(): void {
  if (apart) return
  apart = true
  const proto = (katex as unknown as { __domTree?: { SymbolNode?: { prototype: object } } }).__domTree?.SymbolNode?.prototype
  if (!proto) return
  const held = new WeakMap<object, unknown>()
  Object.defineProperty(proto, 'classes', {
    configurable: true,
    get(this: object) { return held.get(this) },
    set(this: object, v: unknown) { if (Array.isArray(v)) v.push(APART + symbols++); held.set(this, v) },
  })
}
function build(source: string, display: boolean): VNode {
  keepSymbolsApart()
  symbols = 0
  // strict: 'ignore' = LaTeX that KaTeX can set is set without warnings; trust: false = no \href, \includegraphics, raw HTML
  return (katex as unknown as { __renderToHTMLTree(s: string, o: object): VNode }).__renderToHTMLTree(source, { displayMode: display, throwOnError: true, strict: 'ignore', trust: false, output: 'html' })
}
function layTree(tree: VNode, display: boolean): TexItem[] {
  const html = find(tree, 'katex-html')
  if (!html) return []
  const root: Ctx = { em: 1, family: 'Main', bold: false, italic: false, color: null, align: display ? 'center' : 'left', hidden: false }
  interface Line { items: TexItem[]; width: number; gap: number; height: number; depth: number }
  const lines: Line[] = [{ items: [], width: 0, gap: 0, height: LINE_ASCENT, depth: LINE_DESCENT }]
  for (const k of html.children ?? []) {
    const line = lines[lines.length - 1]!
    if (has(k, 'katex-newline')) { lines.push({ items: [], width: 0, gap: len(k.style?.marginTop, 1), height: LINE_ASCENT, depth: LINE_DESCENT }); continue }
    // an equation tag goes after the formula, a quad away (a page would push it to the margin)
    if (has(k, 'katex-tag')) line.width += 1
    // the strut KaTeX puts in every piece of a line says how far the line reaches above and below its baseline
    const strut = k.children?.find((s) => has(s, 'katex-strut'))?.style
    const depth = -len(strut?.verticalAlign, 1)
    line.depth = Math.max(line.depth, depth)
    line.height = Math.max(line.height, len(strut?.height, 1) - depth)
    const f = flow(k.children ?? [], cascade(root, k), null, k)
    move(f.items, line.width, 0)
    for (const it of f.items) line.items.push(it)
    line.width += f.advance
  }
  // lines are stacked box on box and centred in display style
  const widest = Math.max(...lines.map((l) => l.width))
  const out: TexItem[] = []
  let y = 0
  lines.forEach((l, i) => {
    if (i > 0) y -= lines[i - 1]!.depth + l.height + l.gap
    move(l.items, display ? (widest - l.width) / 2 : 0, y)
    for (const it of l.items) out.push(it)
  })
  return out
}
// ── prose with maths in it ───────────────────────────────────────────────────────────────────────────
/** what KaTeX would refuse inside \text{…}, written so that it prints */
const ESCAPES: Record<string, string> = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', $: '\\$', '&': '\\&', '#': '\\#', _: '\\_', '%': '\\%', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}' }
/**
 * 'the angle $\\theta$ grows' → LaTeX: what stands between two dollar signs is mathematics, the rest is text. A
 * source without a pair of dollar signs is returned as it is (it is all mathematics); \\$ is a dollar sign.
 */
export function texSource(source: string): string {
  const cut: string[] = ['']
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!
    if (ch === '\\' && i + 1 < source.length) { cut[cut.length - 1] += ch + source[++i]!; continue }
    if (ch === '$') cut.push('')
    else cut[cut.length - 1] += ch
  }
  if (cut.length < 3) return source
  // an odd number of dollar signs: the last one opens nothing, so it is text
  if (cut.length % 2 === 0) { const tail = cut.pop()!; cut[cut.length - 1] += '\\$' + tail }
  return cut.map((piece, i) => {
    if (i % 2) return piece
    if (!piece) return ''
    let out = ''
    for (let k = 0; k < piece.length; k++) {
      const ch = piece[k]!
      if (ch === '\\' && piece[k + 1] === '$') { out += '\\$'; k++ } else out += ESCAPES[ch] ?? ch
    }
    return `\\text{${out}}`
  }).join('')
}

/** a source that does not parse, as text KaTeX can set */
const asText = (s: string): string => `\\text{${[...s].map((ch) => ESCAPES[ch] ?? ch).join('')}}`

/**
 * Lay a formula out. Never throws: a source that does not parse comes back with `error` set (the message and the
 * offending piece) and the source itself as its items, so something is drawn where the formula was meant to be.
 */
export function layoutTex(source: string, display = true): TexLayout {
  let items: TexItem[]
  let error: TexError | null = null
  try {
    items = layTree(build(source, display), display)
  } catch (e) {
    const k = e as KatexError
    const position = typeof k.position === 'number' ? k.position : null
    const token = position !== null ? source.slice(position, position + Math.max(1, k.length ?? 1)) : ''
    error = { message: String(k.rawMessage ?? k.message ?? e).replace(/^KaTeX parse error:\s*/, ''), token, position }
    try { items = layTree(build(asText(source), false), false) } catch { items = [] }
  }
  const faces = [...new Set(items.filter((it): it is TexGlyph => it.kind === 'glyph').map(faceName))].sort()
  return { source, display, items, order: readingOrder(items), box: unionBox(items), faces, error }
}

/**
 * Where a key occurs in a formula: the key is set on its own and its pieces are looked for, as a run, among the
 * formula's pieces (sizes do not matter, so `x` finds the x of `e^x`). Returns the index lists of every occurrence,
 * first to last, without overlaps.
 */
export function findKey(layout: TexLayout, key: TexLayout): number[][] {
  const hay = layout.items.map((it) => it.sig), needle = key.items.map((it) => it.sig)
  const out: number[][] = []
  if (!needle.length || key.error) return out
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true
    for (let j = 0; j < needle.length && ok; j++) ok = hay[i + j] === needle[j]
    if (!ok) continue
    out.push(needle.map((_, j) => i + j))
    i += needle.length - 1
  }
  return out
}

/** How the pieces of formula `a` pair up with the pieces of formula `b` (indices into their items). */
export interface TexMatch { pairs: [number, number][]; onlyA: number[]; onlyB: number[] }
/**
 * Pair the pieces two formulas share. First the longest run of pieces that keep their order (read left to right),
 * so a term that only moves along stays itself; then whatever is left pairs up by kind, in order, so a term that
 * changes sides flies across. A piece is "the same" when it is the same glyph of the same face, whatever its size.
 */
export function matchItems(a: TexLayout, b: TexLayout): TexMatch {
  const sa = a.order.map((i) => a.items[i]!.sig), sb = b.order.map((i) => b.items[i]!.sig)
  const n = sa.length, m = sb.length
  // longest common subsequence
  const w = m + 1
  const t = new Uint16Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i * w + j] = sa[i] === sb[j] ? t[(i + 1) * w + j + 1]! + 1 : Math.max(t[(i + 1) * w + j]!, t[i * w + j + 1]!)
  const pairs: [number, number][] = []
  const usedA = new Uint8Array(n), usedB = new Uint8Array(m)
  for (let i = 0, j = 0; i < n && j < m;) {
    if (sa[i] === sb[j]) { pairs.push([a.order[i]!, b.order[j]!]); usedA[i] = usedB[j] = 1; i++; j++ } else if (t[(i + 1) * w + j]! >= t[i * w + j + 1]!) i++
    else j++
  }
  // the rest: first unpaired piece of a kind in a with the first unpaired piece of that kind in b
  const waiting = new Map<string, number[]>()
  for (let j = 0; j < m; j++) if (!usedB[j]) { const l = waiting.get(sb[j]!); if (l) l.push(j); else waiting.set(sb[j]!, [j]) }
  for (let i = 0; i < n; i++) {
    if (usedA[i]) continue
    const j = waiting.get(sa[i]!)?.shift()
    if (j === undefined) continue
    pairs.push([a.order[i]!, b.order[j]!]); usedA[i] = usedB[j] = 1
  }
  const onlyA: number[] = [], onlyB: number[] = []
  for (let i = 0; i < n; i++) if (!usedA[i]) onlyA.push(a.order[i]!)
  for (let j = 0; j < m; j++) if (!usedB[j]) onlyB.push(b.order[j]!)
  return { pairs, onlyA, onlyB }
}
