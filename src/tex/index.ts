// Mathematics typesetting, pure side (the module's on-demand API chunk): the tex() kind, its parts, the font plan and rewrite().
// Everything heavy is in the module's lazy chunks: tex.chunk.ts (KaTeX, the layout, the drawing) and one small chunk
// per group of Computer Modern faces (tex<group>.chunk.ts), loaded only by scenes whose formulas need them.
import {
  anim, boxOf, currentModel, defineInterp, defineKind, defineKindMethod, defineVerb, emOf, mix, NOOP_ANIM, reportProblems, TEXT_SIZES, validateOptions, verbTarget,
  type Anim, type Frame, type Handle, type MNode, type RateFn, type SceneModel,
} from '../core/index.ts'
import { FONT_CHUNK } from '../r2d/index.ts'

// ── defaults (every one can be changed: TEX_STYLE.writeLag = 0.1 before the formulas are made) ─────────────────
/** Named defaults of formulas. Change a field before creating formulas to change it for the scene. */
export const TEX_STYLE = {
  /** rewrite(a, b) lasts this long, s (3Blue1Brown's matching transforms run 1.5 to 2 s) */
  rewriteDuration: 1.5,
  /** write(): a piece starts this share of one piece's time after the one before it … */
  writeLag: 0.2,
  /** … but never so late that the whole formula takes more than this many pieces' time to start (manim: min(4 / (n + 1), 0.2)) */
  writeLagTotal: 4,
  /** write(): the share of a piece's time in which its outline is traced; the fill comes in over the rest */
  writeTrace: 0.5,
  /** write(): width of the traced outline, em of the glyph */
  writeStroke: 0.022,
  /** rewrite(): pieces that have no partner fade over this share of the transition: old ones from the start, new ones up to the end (1 = a plain cross-fade, as manim does) */
  rewriteFade: 1,
  /** rewrite(): how far a piece without a partner drifts towards / from the other formula while it fades, 0..1 of the way */
  rewriteDrift: 0.25,
  /** colour of a formula that does not parse (the engine's error red) */
  errorColor: '#FF3B30',
}
/**
 * The defaults of this module as one scene sees them: `TEX_STYLE`, with whatever the engine's config store holds under
 * 'tex.<name>' (model.config('tex.<name>', fallback), when the core has one). Worked out once per scene.
 */
export const texDefaults = (model: SceneModel): typeof TEX_STYLE => model.store<typeof TEX_STYLE>('tex.defaults', () => {
  const ask = (model as unknown as { config?: (key: string, fallback: unknown) => unknown }).config
  if (typeof ask !== 'function') return TEX_STYLE
  const out = { ...TEX_STYLE } as Record<string, unknown>
  for (const key of Object.keys(out)) { const v = ask.call(model, 'tex.' + key, out[key]); if (v !== undefined && typeof v === typeof out[key]) out[key] = v }
  return out as typeof TEX_STYLE
})

// ── which font chunks a formula needs ────────────────────────────────────────────────────────────────
/**
 * group of faces → the lazy chunk that carries them (src/tex/tex<group>.chunk.ts). The 'main' group is the four faces
 * all stage text is set in: they come with the 2D layer's faces chunk (src/r2d/fonts.chunk.ts), so a formula beside
 * a title loads them once.
 */
export const FONT_CHUNKS: Record<string, string> = { main: FONT_CHUNK, size: 'texsize', ams: 'texams', bold: 'texbold', italic: 'texitalic', cal: 'texcal', fancy: 'texfancy', sans: 'texsans' }
/** KaTeX face → group */
export const FACE_GROUP: Record<string, string> = {
  'Main-Regular': 'main', 'Math-Italic': 'main', 'Main-Bold': 'main', 'Main-Italic': 'main',
  'Size1-Regular': 'size', 'Size2-Regular': 'size', 'Size3-Regular': 'size', 'Size4-Regular': 'size',
  'AMS-Regular': 'ams',
  'Math-BoldItalic': 'bold',
  'Main-BoldItalic': 'italic',
  'Caligraphic-Regular': 'cal',
  'Fraktur-Regular': 'fancy', 'Fraktur-Bold': 'fancy', 'Script-Regular': 'fancy',
  'SansSerif-Regular': 'sans', 'SansSerif-Bold': 'sans', 'SansSerif-Italic': 'sans', 'Typewriter-Regular': 'sans',
}
/** Faces KaTeX ships a file for but never sets anything in (it has no metrics for them): not embedded. */
export const UNUSED_FACES = ['Caligraphic-Bold']
// Commands by the group of faces they draw with. Everything not named here is set in the two main faces.
// tests/unit/tex/fonts.test.ts runs every command, environment and character KaTeX knows through the layout and
// fails when this plan asks for less than the layout uses.
const SIZE = /^(?:(?:big|Big|bigg|Bigg)[lrm]?|big(?:cap|cup|odot|oplus|otimes|sqcup|uplus|vee|wedge)|sum|prod|coprod|int|intop|smallint|iint|iiint|oint|oiint|oiiint|[dt]?binom|choose|brace|brack|begin|left|right|middle|genfrac|Braket|Bra|Ket|Set)$/
const BOLD = /^(?:bf|bm|bold|boldsymbol|mathbf|textbf)$/
const ITALIC = /^(?:emph|it|mathit|textit|var[A-Z][a-z]+)$/
const CAL = /^(?:cal|mathcal)$/
const FANCY = /^(?:frak|mathfrak|mathscr)$/
const SANS = /^(?:mathsf|mathsfit|mathtt|sf|textsf|texttt|tt|verb)$/
const AMS = new Set('mathbb Bbb Bbbk Box Bumpeq Cap Complex Cup Diamond Doteq Finv Game Lleftarrow Lsh N R Reals Rrightarrow Rsh Subset Supset Vdash Vvdash Z approxeq backepsilon backprime backsim backsimeq barwedge because beth between bigstar blacklozenge blacksquare blacktriangle blacktriangledown blacktriangleleft blacktriangleright boxdot boxminus boxplus boxtimes bumpeq centerdot checkmark circeq circlearrowleft circlearrowright circledR circledS circledast circledcirc circleddash cnums complement curlyeqprec curlyeqsucc curlyvee curlywedge curvearrowleft curvearrowright daleth dashleftarrow dashrightarrow diagdown diagup digamma divideontimes doteqdot dotplus doublebarwedge doublecap doublecup downdownarrows downharpoonleft downharpoonright eqcirc eqsim eqslantgtr eqslantless eth fallingdotseq geqq geqslant ggg gggtr gimel gnapprox gneq gneqq gnsim gtrapprox gtrdot gtreqless gtreqqless gtrless gtrsim gvertneqq hslash intercal leadsto leftarrowtail leftleftarrows leftrightarrows leftrightharpoons leftrightsquigarrow leftthreetimes leqq leqslant lessapprox lessdot lesseqgtr lesseqqgtr lessgtr lesssim lhd llcorner lll llless lnapprox lneq lneqq lnsim looparrowleft looparrowright lozenge lrcorner ltimes lvertneqq maltese measuredangle mho multimap nLeftarrow nLeftrightarrow nRightarrow nVDash nVdash natnums ncong nexists ngeq ngeqq ngeqslant ngtr nleftarrow nleftrightarrow nleq nleqq nleqslant nless nmid nparallel nprec npreceq nrightarrow nshortmid nshortparallel nsim nsubseteq nsubseteqq nsucc nsucceq nsupseteq nsupseteqq ntriangleleft ntrianglelefteq ntriangleright ntrianglerighteq nvDash nvdash pitchfork precapprox preccurlyeq precnapprox precneqq precnsim precsim reals restriction rhd rightarrowtail rightleftarrows rightrightarrows rightsquigarrow rightthreetimes risingdotseq rtimes shortmid shortparallel smallfrown smallsetminus smallsmile sphericalangle sqsubset sqsupset square subseteqq subsetneq subsetneqq succapprox succcurlyeq succnapprox succneqq succnsim succsim supseteqq supsetneq supsetneqq therefore thickapprox thicksim triangledown trianglelefteq triangleq trianglerighteq twoheadleftarrow twoheadrightarrow ulcorner unlhd unrhd upharpoonleft upharpoonright upuparrows urcorner vDash varkappa varnothing varpropto varsubsetneq varsubsetneqq varsupsetneq varsupsetneqq vartriangle vartriangleleft vartriangleright veebar yen'.split(' '))

/**
 * The groups of faces a LaTeX source can need, from its commands and characters alone (KaTeX itself is not loaded
 * when a scene is built). Always a superset of what the layout then uses; 'main' is always in it.
 */
export function fontGroups(source: string): string[] {
  const g = new Set(['main'])
  for (const m of source.matchAll(/\\([A-Za-z]+)/g)) {
    const n = m[1]!
    if (SIZE.test(n)) g.add('size')
    else if (AMS.has(n)) g.add('ams')
    else if (BOLD.test(n)) g.add('bold')
    else if (ITALIC.test(n)) g.add('italic')
    else if (CAL.test(n)) g.add('cal')
    else if (FANCY.test(n)) g.add('fancy')
    else if (SANS.test(n)) g.add('sans')
  }
  // characters typed directly instead of as commands
  for (const ch of source) {
    const cp = ch.codePointAt(0)!
    if (cp < 0xa0) continue
    if ((cp >= 0x220f && cp <= 0x2211) || (cp >= 0x222b && cp <= 0x2230) || (cp >= 0x22c0 && cp <= 0x22c3) || (cp >= 0x2a00 && cp <= 0x2a06)) g.add('size')
    else if (cp >= 0x2100 && cp <= 0x214f) { g.add('ams'); g.add('fancy') }
    else if (cp === 0xa5 || cp === 0xf0 || cp === 0x3dd || (cp >= 0x2190 && cp <= 0x2bff)) g.add('ams')
    else if (cp >= 0x1d400 && cp <= 0x1d7ff) for (const k of ['bold', 'italic', 'fancy', 'sans', 'ams']) g.add(k)
  }
  return [...g]
}

// ── what the tex chunk fills in ──────────────────────────────────────────────────────────────────────
/** [left, bottom, right, top] in em of the formula, x right, y up, origin on the first baseline */
export type Box4 = [number, number, number, number]
/** Filled by tex.chunk.ts when it loads. Until then (under bun, before the page has the chunk) sizes are estimates. */
export const slots: {
  /** box of everything a formula draws */
  box?: (source: string, display: boolean) => Box4
  /** box of one part: a key (the piece that is set like this LaTeX; occurrence counts from 1) or an index in reading order; null when the formula has no such part */
  partBox?: (source: string, display: boolean, key: string | number, occurrence: number) => Box4 | null
  /** looks a formula over and reports what is wrong with it (a source that does not parse, a key it does not have), once */
  inspect?: (node: MNode, frame: Frame) => void
} = {}
/** A rough box for a source nobody can lay out yet: about half an em per visible character, one line. */
export function estimateBox(source: string): Box4 {
  const n = source.replace(/\\[A-Za-z]+/g, 'x').replace(/[{}^_&$\s\\]/g, '').length
  return [0, -0.2, Math.max(1, n) * 0.55, 0.7]
}
const boxOfFormula = (source: string, display: boolean): Box4 => (slots.box ? slots.box(source, display) : estimateBox(source))
const sourceOf = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : v === null || v === undefined ? '' : String(v))

// ── the kind ─────────────────────────────────────────────────────────────────────────────────────────
/** tex(latex, { size, color, colors, inline }): a typeset formula in Computer Modern. */
export const tex = defineKind({
  name: 'tex', space: '2d', text: true, positional: ['latex'], required: ['latex'],
  // the drawing side and the two faces every formula uses; more faces are asked for per formula in init()
  chunk: ['tex', FONT_CHUNKS.main!],
  schema: {
    latex: { type: 'text', example: "tex('e^{i\\\\pi} + 1 = 0')" },
    size: { type: 'positive', default: 48, tokens: TEXT_SIZES, example: "size: 'label'" },
    color: { type: 'color', default: '#FFFFFF' },
    colors: { type: { record: 'color' }, default: {}, dynamic: false, example: "colors: { '\\\\theta': YELLOW }" },
    inline: { type: 'boolean', default: false, dynamic: false, example: 'inline: true' },
    // set by rewrite(): the id of the formula this one is coming from, how far the transition is, and whether the other stays
    rewriteFrom: { type: 'string', nullable: true, default: null },
    rewrite: { type: 'unit', default: 1 },
    rewriteKeep: { type: 'boolean', default: false },
  },
  bounds: (node, r, frame) => {
    slots.inspect?.(node, frame)
    const b = boxOfFormula(sourceOf(r.latex), !r.inline), em = emOf(r.size)
    return boxOf(((b[2] - b[0]) / 2) * em, ((b[3] - b[1]) / 2) * em, 0)
  },
  // the linter's text box is the ink of the formula, not a line box
  textRects: (_node, r) => {
    const b = boxOfFormula(sourceOf(r.latex), !r.inline), em = emOf(r.size)
    const w = (b[2] - b[0]) * em, h = (b[3] - b[1]) * em
    return [{ text: sourceOf(r.latex), rect: { x: -w / 2, y: -h / 2, width: w, height: h } }]
  },
  init(node, model) {
    // a source given as a function is read as text: the commands are in it the way the author wrote them
    const raw = node.props.latex
    const text = typeof raw === 'function' ? String(raw) : sourceOf(raw)
    const keys = node.props.colors && typeof node.props.colors === 'object' ? Object.keys(node.props.colors) : []
    for (const g of fontGroups([text, ...keys].join(' '))) { const c = FONT_CHUNKS[g]; if (c) model.requireChunk(c) }
  },
})

// ── parts: one term of a formula as an object of its own ─────────────────────────────────────────────
interface PartGeometry { x: number; y: number; halfWidth: number; halfHeight: number; found: boolean }
/** Where a part sits in its formula (frame units, relative to the formula's centre) and how big it is. */
export function partGeometry(part: MNode, frame: Frame): PartGeometry {
  return frame.memo('texpart' + part.uid, () => {
    const none: PartGeometry = { x: 0, y: 0, halfWidth: 0, halfHeight: 0, found: false }
    const owner = part.parent
    if (!owner || owner.kind !== 'tex') return none
    const r = frame.props(owner)
    const source = sourceOf(r.latex), display = !r.inline, em = emOf(r.size)
    const b = slots.partBox ? slots.partBox(source, display, part.props.key as string | number, Number(part.props.occurrence ?? 1)) : null
    if (!b) return none
    const whole = boxOfFormula(source, display)
    const cx = (whole[0] + whole[2]) / 2, cy = (whole[1] + whole[3]) / 2
    return { x: ((b[0] + b[2]) / 2 - cx) * em, y: ((b[1] + b[3]) / 2 - cy) * em, halfWidth: ((b[2] - b[0]) / 2) * em, halfHeight: ((b[3] - b[1]) / 2) * em, found: true }
  }, { x: 0, y: 0, halfWidth: 0, halfHeight: 0, found: false })
}
const texPart = defineKind({
  name: 'texpart', space: '2d', chunk: 'tex',
  schema: {
    key: { type: 'any', dynamic: false },
    occurrence: { type: 'int', default: 1, dynamic: false },
    // null = the colour the formula gives these pieces
    color: { type: 'color', nullable: true, default: null },
  },
  bounds: (node, _r, frame) => { const g = partGeometry(node, frame); return boxOf(g.halfWidth, g.halfHeight, 0) },
})
// a part that has no colour of its own starts a colour tween from the formula's colour, not from nothing
defineInterp('texpart', 'color', (a, b, u, frame, node) => {
  const base = node?.parent ? frame.prop<string>(node.parent, 'color') : '#FFFFFF'
  return mix((a as string | null) ?? base, (b as string | null) ?? base, u)
})

const partsOf = new WeakMap<MNode, Map<string, Handle>>()
const partName = (key: string | number): string => (typeof key === 'number' ? `piece${key}` : key.replace(/\\/g, ' ').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).join('-').slice(0, 24) || 'part')
/**
 * m.part(key, occurrence = 1): the piece of the formula that is set like `key` (LaTeX), as an object of its own.
 * m.part(index): the index-th piece in reading order (0 = leftmost). Asking twice gives the same object.
 */
defineKindMethod('tex', 'part', (node: MNode, key: unknown, occurrence: unknown = 1): Handle => {
  const model = node.model
  const good = (typeof key === 'string' && key.trim() !== '') || (typeof key === 'number' && Number.isInteger(key) && key >= 0)
  if (!good) model.diagnostics.add({ code: 'API-TYPE', ids: [node.id], what: `tex.part() expects the LaTeX of a piece of the formula or an index from 0, got ${typeof key === 'string' ? 'an empty string' : String(key)}.`, fix: ["formula.part('x^2')", 'formula.part(0)'] })
  let nth = 1
  if (typeof occurrence === 'number' && Number.isInteger(occurrence) && occurrence >= 1) nth = occurrence
  else if (occurrence !== undefined) model.diagnostics.add({ code: 'API-TYPE', ids: [node.id], what: `tex.part(): the occurrence counts from 1 (1 = the first one), got ${String(occurrence)}.`, fix: [`formula.part(${JSON.stringify(key)}, 2)  for the second one`] })
  const k: string | number = good ? (key as string | number) : ''
  const tag = `${typeof k}:${k}:${nth}`
  let made = partsOf.get(node)
  if (!made) partsOf.set(node, (made = new Map()))
  const hit = made.get(tag)
  if (hit) return hit
  let name = partName(k) + (nth > 1 ? `-${nth}` : '')
  for (let n = 2; model.byId.has(`${node.id}.${name}`); n++) name = name.replace(/~\d+$/, '') + '~' + n
  const part = model.child(node, name, texPart, { key: k, occurrence: nth })
  if (!good) part.invalid = true
  // it sits on its pieces and follows them; move it with shift(), not at()
  part.placement = { type: 'at', pos: () => { const g = partGeometry(part, model.now()); return [g.x, g.y, 0] } }
  // a handle is not an entrance: the pieces are on stage with their formula unless a verb says otherwise
  part.props.present = 1
  made.set(tag, part)
  return part
})

// ── rewrite(a, b): one formula becomes another, piece by piece ───────────────────────────────────────
/**
 * rewrite(from, to, { keep, duration, rate }): `to` takes the stage. The pieces both formulas have glide from where
 * they are in `from` to where they belong in `to`; the others fade out and in. keep: true leaves `from` where it
 * is (the new line is derived from a copy of it).
 */
export const rewrite = defineVerb('rewrite', (from: unknown, to: unknown, opts?: unknown): Anim => {
  const a = verbTarget(from, 'rewrite()'), b = verbTarget(to, 'rewrite()')
  if (!a || !b) return NOOP_ANIM('rewrite', TEX_STYLE.rewriteDuration)
  const model = currentModel()
  for (const n of [a, b]) {
    if (n.kind === 'tex') continue
    model.diagnostics.add({ code: 'API-TYPE', ids: [n.id], what: `rewrite() turns one formula into another; #${n.id} is a ${n.kind}, not a tex().`, fix: ["rewrite(tex('a^2 + b^2'), tex('c^2'))", 'for other objects use fadeOut(a) and fadeIn(b)'] })
    return NOOP_ANIM('rewrite', TEX_STYLE.rewriteDuration)
  }
  if (a === b) { model.diagnostics.add({ code: 'API-TYPE', ids: [a.id], what: 'rewrite() got the same formula twice.', fix: ['pass the formula to leave and the one to arrive'] }); return NOOP_ANIM('rewrite', TEX_STYLE.rewriteDuration) }
  const v = validateOptions('rewrite()', opts, { duration: { type: 'positive', dynamic: false, example: 'duration: 2' }, rate: { type: 'fn', example: 'rate: smooth' }, keep: { type: 'boolean', dynamic: false, example: 'keep: true' } }, { runTime: 'duration', run_time: 'duration', rateFunc: 'rate', rate_func: 'rate' }, model)
  reportProblems(model, v.problems, [a.id, b.id])
  const o = v.props as { duration?: number; rate?: RateFn; keep?: boolean }
  return anim('rewrite', o.duration ?? TEX_STYLE.rewriteDuration, (rec, at, duration, rate) => {
    // from this moment the arriving formula draws everything: its own pieces, and the leaving ones that have no partner
    rec.clip(b, 'revealMode', 'fade', { at, duration: 0 })
    rec.clip(b, 'present', 1, { at, duration: 0 })
    rec.clip(b, 'rewriteFrom', a.id, { at, duration: 0 })
    rec.clip(b, 'rewriteKeep', !!o.keep, { at, duration: 0 })
    rec.clip(b, 'rewrite', 1, { at, duration, rate: rate ?? o.rate, from: 0 })
    if (!o.keep) {
      rec.clip(a, 'revealMode', 'fade', { at, duration: 0 })
      rec.clip(a, 'present', 0, { at, duration: 0 })
    }
  })
})

// ── faces ────────────────────────────────────────────────────────────────────────────────────────────
/** 'Main-BoldItalic' → what CSS calls it */
export function faceCss(face: string): { family: string; weight: 'normal' | 'bold'; style: 'normal' | 'italic' } {
  const [family, cut = 'Regular'] = face.split('-')
  return { family: 'KaTeX_' + family, weight: cut.startsWith('Bold') ? 'bold' : 'normal', style: cut.endsWith('Italic') ? 'italic' : 'normal' }
}
/**
 * Make faces available to the page: name ('Main-Regular') → the bytes of its woff2 file in base64. A face the page
 * already has under the same family, weight and style is left alone. Resolves when every face can be drawn with.
 * Without a document (bun, tests) it does nothing.
 */
export async function installFaces(faces: Record<string, string>): Promise<void> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) return
  const loading: Promise<unknown>[] = []
  for (const [face, base64] of Object.entries(faces)) {
    const css = faceCss(face)
    let there = false
    for (const f of document.fonts) if (f.family.replace(/["']/g, '') === css.family && (f.weight === css.weight || (css.weight === 'bold' ? f.weight === '700' : f.weight === '400')) && f.style === css.style) there = true
    if (there) continue
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const f = new FontFace(css.family, bytes.buffer, { weight: css.weight, style: css.style })
    document.fonts.add(f)
    loading.push(f.load().catch(() => null))
  }
  await Promise.all(loading)
}

/** On demand: this module's API is its own chunk (mimir.texapi.js), loaded before a scene that uses one of its names. */
export const lazy = true
export const api = { tex, rewrite, TEX_STYLE }
