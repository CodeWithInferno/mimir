// Guide, pure side (main chunk): st.say / st.label / st.focus, s.guide, the cue compiler and the transcript.
// Narration is the clock: every sentence is parsed, timed and scheduled here while the scene is built, because step
// durations are fixed then. Everything that draws (pointer, marks, labels, captions, voice) lives in the lazy chunk
// ./guide.chunk.ts and reads the plain data recorded here as a pure function of (step, seconds into the step).
import {
  closeConfigGroup, defineConfig, defineFinalize, defineLook, defineManifest, defineSceneMethod, defineSpanVerb, defineStepAction, isNode, kindOf, luminance, PACE, parseColor, reportProblems,
  selector, smooth, validateOptions,
  type Action, type Frame, type MNode, type SceneModel, type Schema, type Src,
} from '../core/index.ts'
import { FONT_CHUNK } from '../r2d/index.ts'
import { lightPart } from '../r3d/index.ts'
import { parseNarration } from '../lib/guide/parse.ts'
import { estimateTiming } from '../lib/guide/timing.ts'
import { scheduleCues } from '../lib/guide/schedule.ts'
import type { GuideCue, GuideVerb, NarrationTiming, ParsedNarration, ScheduleOptions } from '../lib/guide/types.ts'

// ── defaults: every number that shapes what the guide shows, in ONE table ──────────────────────────────────────────
// Read through guideConfig(model): the scene's s.guide({ … }) first, then the engine's config store under
// 'guide.<name>' (model.config, when the core has one), then this table. Lengths are frame units (the frame is
// 14.222 × 8), times are seconds, shares are 0..1.
const DEFAULTS = {
  // narration
  /** narration pace without audio, characters per second */
  charactersPerSecond: 16.5,
  /** silence after , ; : and dashes; after . ! ? */
  commaPause: 0.365, sentencePause: 0.36,
  /** silence before the first word of a step, so the pointer can land on an early word */
  leadIn: 0.6,
  // pointer
  /** flight time of one pointer hop; the pointer rests at least `perch` before leaving again */
  hop: 0.5, perch: 0.35,
  /** idle time after which the pointer flies back to its dock by the caption */
  dockAfter: 1.5,
  /** length of the pointer (a swept arrow tip), its colour, its half-width and notch depth as shares of its length, its black keyline */
  pointerSize: 0.22, pointerColor: '#FFFFFF' as string, pointerHalf: 0.36, pointerNotch: 0.62, pointerKeyline: 0.026,
  /** opacity of the pointer while it rests at its dock (0: it is born at the caption when its word comes); it fades in / out there over `pointerFade` */
  dockOpacity: 0, pointerFade: 0.12,
  /** the side of a part a resting pointer hangs on when nothing speaks against it: degrees clockwise from straight below (−35: below right) */
  perchAngle: -35,
  /** how many sides of a part are tried for a perch that covers no text, and the air kept round text */
  perchDirections: 16, perchMargin: 0.05,
  /** the trail behind a flying pointer: samples, seconds between them, radius */
  trailSamples: 7, trailStep: 0.02, trailRadius: 0.028,
  // marks
  /** draw-on time of a ring, label, arrow or glow; shortest life of a glow; a glow outlives its words by `glowTail` */
  drawTime: 0.45, glowTime: 1.2, glowTail: 0.6,
  /** colour of marks and of the words that name them; null = the colour of the part */
  markColor: null as string | null,
  /** stroke width of rings and arrows; a mark fades out over `markFade` before it expires */
  markWidth: 0.022, markFade: 0.3,
  /** how far a ring stands off the part it hugs */
  ringPad: 0.1,
  /** head of an arrow mark; halo width round a glowing flat shape; emissive strength of a glowing 3D part */
  arrowHead: 0.16, haloWidth: 0.1, glowEmissive: 0.9,
  /** the touch-down ring: radius; drawn over `pulseDraw`, fades from `pulseHold`, gone at `pulseEnd` after landing */
  pulseRadius: 0.15, pulseDraw: 0.28, pulseHold: 0.58, pulseEnd: 0.9,
  // labels
  /** height of label text, line height in ems, black backstroke as a share of the text height */
  labelSize: 0.21, labelLine: 1.2, labelBackstroke: 0.26,
  /** colour of a name while its word is said; null = the colour of the part */
  labelColor: null as string | null,
  /** colour of a name that is not being said ("dust"); null = it keeps its lit colour */
  labelRest: '#BBBBBB' as string | null,
  /** a name goes from its lit colour to its resting one over this long */
  labelDust: 0.22,
  /** space between a part (or the silhouette of the figure) and its label */
  labelGap: 0.3,
  /** a name wider than this is set on two lines */
  labelMaxWidth: 2.4,
  /** air between two names in a column */
  labelSpace: 0.08,
  /** from the text to the elbow of its leader, and the level shoulder inside that */
  labelElbow: 0.24, labelShoulder: 0.16,
  /** names fan away from the middle of the figure: share of their distance from the column, least and most */
  labelFan: 0.14, labelFanMin: 0.1, labelFanMax: 0.3,
  /** what a leader that passes over another part costs when a side is chosen: a coloured part, a grey one */
  labelHuedCost: 1.6, labelGreyCost: 0.4,
  /** what a name that does not fit between the figure and the edge of the free stage costs, plus `labelRoomSlope` per unit missing */
  labelRoomCost: 4, labelRoomSlope: 4,
  /** a column of names stands beside the figure at the heights of its names; a part above or below keeps it away by this much per unit of height between them */
  labelChamfer: 1,
  /** at most this many other objects are handed to the label solver and to the pointer as things to stay off */
  labelObstacles: 120,
  /** a part counts as coloured (a leader should not cross it) from this chroma on, 0..1 */
  labelHueChroma: 0.22,
  /** points taken along each curve of an outline that a ring hugs (a circle is four curves) */
  outlineSamples: 12,
  /** moments of a step at which the figure is measured, so that names stand clear of it while it moves */
  labelPoseSamples: 5,
  /** names that stay across steps glide to their new places over this long */
  labelSettle: 0.6,
  /** a flat shape thinner than this is touched at its middle, and its name sits on it */
  thin: 0.14,
  /** prefix labels with 1, 2, 3 … in the order they are spoken */
  numbered: false,
  /** leader: colour (null = the colour of its name), width, black backstroke width, radius of the dot on the part */
  leaderColor: '#888888' as string | null, leaderWidth: 0.014, leaderBackstroke: 0.045, dotRadius: 0.032,
  /** a label's leader draws over `leaderTime`; its name is written from `labelTextAt` over `labelText`, glyph i starting `glyphLag` of a glyph's run after the one before */
  leaderTime: 0.22, labelTextAt: 0.18, labelText: 0.3, glyphLag: 0.1,
  // captions
  /** height of caption text, line height in ems */
  captionSize: 0.25, captionLine: 1.4,
  /** colour of caption words that name no part, and of anything whose part has no readable colour */
  ink: '#DDDDDD' as string,
  /** distance from the bottom of the frame to the bottom of the caption line */
  captionBottom: 0.42,
  /** the caption line is at most this share of the stage wide; a clause that still does not fit shrinks down to `captionShrink` of the caption size */
  captionWidth: 0.86, captionShrink: 0.6,
  /** show captions (the transcript is recorded either way) */
  captions: true,
  /** a caption line is shown `captionLead` before its first word and fades in / out over `captionFade` */
  captionLead: 0.42, captionFade: 0.18,
  /** opacity of a caption word before it is spoken, and of a word that names a part */
  wordRest: 0.66, wordLinked: 0.82,
  /** a word lights from `wordBefore` before its onset to `wordAfter` after; the underline of a linked word draws over `underline` */
  wordBefore: 0.03, wordAfter: 0.07, underline: 0.26,
  /** speak the narration with the browser's speech synthesis while the story plays (never required) */
  voice: false,
  // the light: `lit` (which part) and `dim` (everything else) are separate, so the light changes hands without a flash
  /** how dim the rest of the 3D figure is while the pointer names its parts; the same for flat objects (0: the flat stage keeps its light) */
  highlightDim: 0.9, highlightDim2d: 0,
  /** how dim everything else is under [words](focus:part) */
  focusDim: 1,
  /** the dim comes on from `highlightBefore` before the first landing of a step to `highlightAfter` after it, holds `highlightHold` after the last landing and releases over `highlightOut` */
  highlightBefore: 0.1, highlightAfter: 0.14, highlightHold: 3.4, highlightOut: 0.5,
  /** the light passes from one part to the next from `handBefore` before the landing to `handAfter` after it */
  handBefore: 0.2, handAfter: 0.14,
  // check
  /** check: words in one sentence; guide marks in one sentence; seconds of narration with no cue; seconds the pointer may land after its word */
  maximumSentenceWords: 25, maximumMarksPerSentence: 3, maximumDeadAir: 10, maximumLate: 0.25,
  /** check: share of a part's pixels that must be visible when the guide points at it */
  minimumVisibleShare: 0.3,
}
/** Options of s.guide(): every name of GUIDE_DEFAULTS. */
export type GuideConfig = typeof DEFAULTS
export const GUIDE_DEFAULTS: Readonly<GuideConfig> = Object.freeze(DEFAULTS)
/** Options that must be more than zero, and those that are a share (0..1). Everything else numeric is zero or more. */
const POSITIVE = new Set(['charactersPerSecond', 'hop', 'pointerSize', 'markWidth', 'labelSize', 'labelLine', 'captionSize', 'captionLine', 'maximumSentenceWords', 'maximumMarksPerSentence', 'maximumDeadAir', 'labelMaxWidth', 'perchDirections', 'labelPoseSamples', 'labelObstacles', 'outlineSamples'])
const SHARES = new Set(['dockOpacity', 'minimumVisibleShare', 'highlightDim', 'highlightDim2d', 'focusDim', 'wordRest', 'wordLinked', 'captionWidth', 'captionShrink', 'pointerHalf', 'pointerNotch', 'labelHueChroma'])
const SIGNED = new Set(['perchAngle'])
const NULLABLE = new Set(['markColor', 'labelColor', 'labelRest', 'leaderColor'])
const CONFIG: Schema = Object.fromEntries(Object.entries(GUIDE_DEFAULTS).map(([name, value]): [string, Schema[string]] => {
  if (typeof value === 'boolean') return [name, { type: 'boolean', dynamic: false }]
  if (typeof value === 'number') return [name, { type: POSITIVE.has(name) ? 'positive' : SHARES.has(name) ? 'unit' : SIGNED.has(name) ? 'number' : 'nonneg', dynamic: false, example: `${name}: ${value}` }]
  return [name, { type: 'color', nullable: NULLABLE.has(name), dynamic: false }]
}))
/** The guide options of a scene: what s.guide() changed, else the engine's config store ('guide.<name>'), else the defaults. */
export const guideConfig = (model: SceneModel): GuideConfig => model.store<GuideConfig>('guide.config', () => {
  const cfg = { ...GUIDE_DEFAULTS } as GuideConfig
  // the config store of the core, when it has one: model.config('<module>.<name>', fallback)
  const ask = (model as unknown as { config?: (key: string, fallback: unknown) => unknown }).config
  if (typeof ask === 'function') for (const key of Object.keys(cfg) as (keyof GuideConfig)[]) {
    const v = ask.call(model, 'guide.' + key, cfg[key])
    if (v === null ? NULLABLE.has(key) : typeof v === typeof GUIDE_DEFAULTS[key] || (NULLABLE.has(key) && typeof v === 'string')) (cfg as Record<string, unknown>)[key] = v
  }
  return cfg
})
// the guide's options are part of the config store: 'guide.hop' in scene({ defaults }), s.config() or mimir.config.json, and docs/CONFIG.md lists them
defineConfig('guide', DEFAULTS)
closeConfigGroup('guide')
const scheduleOptions = (cfg: GuideConfig): ScheduleOptions => ({ hop: cfg.hop, minPerch: cfg.perch, drawTime: cfg.drawTime, glowMin: cfg.glowTime, glowTail: cfg.glowTail, dockAfter: cfg.dockAfter, lateTolerance: cfg.maximumLate })

defineSceneMethod('guide', (s, opts: unknown) => {
  const model = s.model
  const v = validateOptions('s.guide()', opts ?? {}, CONFIG, { charsPerSecond: 'charactersPerSecond', minPerch: 'perch', numbers: 'numbered', caption: 'captions' }, model)
  reportProblems(model, v.problems, [])
  if (guideStore(model).steps.size) model.diagnostics.add({ code: 'API-TYPE', what: 's.guide() was called after a step had already spoken; narration that was timed before it keeps the old pace.', fix: ['move s.guide({ … }) above the first s.step()'] })
  const cfg = guideConfig(model)
  for (const [key, value] of Object.entries(v.props)) if (Object.hasOwn(GUIDE_DEFAULTS, key) && value !== undefined) (cfg as unknown as Record<string, unknown>)[key] = value
  return s
})

// ── what is recorded per step ────────────────────────────────────────────────────────────────────────
/** One st.say() of a step. Times inside `timing` are seconds from `at`. */
export interface GuideSay { /** seconds from the start of the step */ at: number; text: string; parsed: ParsedNarration; timing: NarrationTiming; src: Src; action: Action }
/** One compiled cue of a step. Every time is seconds from the start of the step. */
export interface GuideCueRec extends GuideCue {
  /** index into the step's says, and the 0-based step */
  say: number
  step: number
  /** index into the step's cues */
  index: number
  /** the objects the cue names, in written order (missing ones are left out), and the anchor named after each ('piston.top' → 'top') */
  nodes: MNode[]
  anchors: (string | null)[]
  src: Src
}
/** One caption line: a sentence, its words and when each is spoken (seconds from the start of the step). */
export interface GuideLine { say: number; text: string; /** shown from … until the next line is shown */ showAt: number; t0: number; t1: number; words: { text: string; t0: number; t1: number; /** index into the step's cues, or −1 */ cue: number }[] }
export interface GuideStep { index: number; says: GuideSay[]; cues: GuideCueRec[]; lines: GuideLine[]; /** seconds, hold included */ duration: number }
/**
 * One state of the light, from story time `t` on: which objects are lit (and how much), and how dim everything else
 * is in the 3D figure and on the flat stage. The state before blends into it from `t - before` to `t + after`.
 */
export interface LightState { t: number; before: number; after: number; lit: Map<MNode, number>; dim3: number; dim2: number; step: number }
/** What st.highlight() recorded: resolved into light states when the scene is finalised. */
export interface HighlightRec { step: number; /** seconds from the start of the step */ at: number; lit: Map<MNode, number>; dim: number | null; src: Src }
export interface GuideStore { steps: Map<number, GuideStep>; /** st.highlight() calls, in the order they were made */ highlights: HighlightRec[]; /** the light of the whole story, in time order (compileGuide) */ lights: LightState[] }
export const guideStore = (model: SceneModel): GuideStore => model.store<GuideStore>('guide', () => ({ steps: new Map(), highlights: [], lights: [] }))
export interface SayData { text: string; plain: string; duration: number; index: number }
export interface LabelData { node: MNode; text: string; /** the cue that made it ([](label:part)), when it was not st.label() */ cue?: number; /** the anchor it is attached to */ anchor?: string | null }
export interface FocusData { nodes: MNode[] }
export interface CueData { verb: GuideVerb; ids: string[]; words: string; index: number }

/**
 * `piston` → the object; `piston.top` → the object and the anchor `top`. An id wins over an anchor reading
 * (`gauge.needle` is a part). null when no object answers.
 */
export function resolveTarget(model: SceneModel, ref: string): { node: MNode; anchor: string | null } | null {
  const whole = model.byId.get(ref)
  if (whole) return { node: whole, anchor: null }
  for (let cut = ref.lastIndexOf('.'); cut > 0; cut = ref.lastIndexOf('.', cut - 1)) {
    const owner = model.byId.get(ref.slice(0, cut))
    if (owner) return { node: owner, anchor: ref.slice(cut + 1) }
  }
  return null
}
/** The colour a part is drawn in right now (its own, else the first part inside it that has one); null when it has none. */
export function partColor(frame: Frame, node: MNode, depth = 0): string | null {
  const schema = kindOf(node.kind)?.schema
  if (schema) {
    if (node.space === '3d' && (Object.hasOwn(schema, 'material') || Object.hasOwn(schema, 'color'))) return frame.look(node).color
    for (const name of ['color', 'stroke', 'fill']) {
      if (!Object.hasOwn(schema, name)) continue
      const v = frame.prop<unknown>(node, name)
      if (typeof v === 'string' && parseColor(v)) return v
    }
  }
  if (depth < 4) for (const child of node.children) { const v = partColor(frame, child, depth + 1); if (v) return v }
  return null
}
/** Luminance under which a part's colour cannot carry text on black; the ink colour is used instead. */
export const LEGIBLE_LUMINANCE = 0.12
/** The colour a mark, a label or a linked word is drawn in for a part: the configured one, else the part's own when it reads on black, else ink. */
export function markColor(frame: Frame, node: MNode | undefined, configured: string | null, ink: string): string {
  if (configured) return configured
  const c = node ? partColor(frame, node) : null
  return c && luminance(c) >= LEGIBLE_LUMINANCE ? c : ink
}
/** Words of a label: the text without the punctuation that speech needs and a label does not. */
export const labelText = (words: string): string => words.replace(/[.,;:!?…]+$/u, '').trim()

// ── narration ────────────────────────────────────────────────────────────────────────────────────────
// the verbs of DESIGN §6; a span with another one is reported by st.say
for (const verb of ['point', 'ring', 'label', 'arrow', 'glow', 'focus']) defineSpanVerb(verb)
/** `[spoken words](verb:target)` → `spoken words`: the sentence as it is spoken and captioned. */
export const stripSpans = (text: string): string => parseNarration(text).plain
/** Reading time without audio: 16.5 characters a second plus pauses (comma 365 ms, sentence end 360 ms). */
export const speechSeconds = (plain: string): number => estimateTiming(parseNarration(plain.replace(/[\[\]]/g, ''))).duration
/** The spans of a sentence, located in its spoken text (what the transcript carries). */
export function readSpans(text: string): { plain: string; spans: { start: number; end: number; words: string; verb: string; targets: string[]; options: string[] }[] } {
  const p = parseNarration(text)
  return { plain: p.plain, spans: p.spans.map((sp) => ({ start: sp.start, end: sp.end, words: sp.words, verb: sp.verb, targets: sp.targets.slice(), options: sp.options.slice() })) }
}

const VERB_LIST = 'point, ring, label, arrow, glow, focus'
defineStepAction('say', (st, text: unknown) => {
  const model = st.model
  if (typeof text !== 'string' || !text.trim()) { model.diagnostics.add({ code: 'API-TYPE', what: `st.say() expects a sentence, got ${typeof text === 'string' ? 'an empty string' : typeof text}.`, fix: ["st.say('The [piston](piston) slides down.')"] }); return }
  const cfg = guideConfig(model)
  const parsed = parseNarration(text)
  for (const e of parsed.errors) {
    // the parser's codes are folded into the engine's: an unknown verb is an unknown name, everything else a malformed call
    const fix = e.code === 'GUIDE-VERB' ? [`verbs: ${VERB_LIST}`, ...e.fix] : e.fix
    model.diagnostics.add({ code: e.code === 'GUIDE-VERB' ? 'API-UNKNOWN' : 'API-TYPE', severity: e.severity, what: `st.say(): ${e.what}; the words are spoken without a guide mark.`, fix: fix.slice(0, 3) })
  }
  if (!parsed.words.length) { model.diagnostics.add({ code: 'API-TYPE', what: 'st.say(): the sentence has no spoken words.', fix: ["st.say('The [piston](piston) slides down.')"] }); return }
  const store = guideStore(model)
  let gs = store.steps.get(st.index)
  if (!gs) store.steps.set(st.index, (gs = { index: st.index, says: [], cues: [], lines: [], duration: 0 }))
  const last = gs.says[gs.says.length - 1]
  // sentences of one step follow each other; the first waits `leadIn` so the pointer can be there for an early word
  const at = Math.max(st.cursor, last ? last.at + last.timing.duration : 0)
  const timing = estimateTiming(parsed, { charsPerSecond: cfg.charactersPerSecond, commaPause: cfg.commaPause, sentencePause: cfg.sentencePause, leadIn: last ? 0 : cfg.leadIn })
  const cues = scheduleCues(parsed, timing, scheduleOptions(cfg)).cues
  const end = Math.max(timing.duration, ...cues.map((c) => c.drawEnd))
  st.narration(text, {
    plain: parsed.plain, at, duration: timing.duration,
    // the transcript names objects: `piston.top` is the piston
    spans: parsed.spans.map((sp) => ({ start: sp.start, end: sp.end, words: sp.words, verb: sp.verb, targets: sp.targets.map((t) => resolveTarget(model, t)?.node.id ?? t), options: sp.options.slice() })),
  })
  const action = st.action<SayData>('say', { text, plain: parsed.plain, duration: timing.duration, index: gs.says.length }, { at, duration: PACE.scopedIn })
  gs.says.push({ at, text, parsed, timing, src: action.src, action })
  st.need(at + end)
  model.requireChunk('guide')
})

defineStepAction('label', (st, part: unknown, text?: unknown) => {
  const node = st.node(part, 'st.label()', 'the part')
  if (!node) return
  if (text !== undefined && typeof text !== 'string' && typeof text !== 'number') { st.model.diagnostics.add({ code: 'API-TYPE', ids: [node.id], what: `st.label(): the text must be a string, got ${typeof text}.`, fix: [`st.label(${node.id}, 'name')`] }); return }
  st.action<LabelData>('label', { node, text: text === undefined ? node.label ?? node.id : String(text) })
  st.model.requireChunk('guide')
  st.model.requireChunk(FONT_CHUNK) // a label is set in the embedded text face, also in a scene with no other text
})

/** Everything that draws and is not one of `nodes` (or inside one): what a focus pushes back. */
const others = (nodes: readonly MNode[]): ReturnType<typeof selector> => {
  const keep = new Set<MNode>()
  const add = (n: MNode): void => { keep.add(n); n.children.forEach(add) }
  nodes.forEach(add)
  // the parts of a composite AND what the composite draws itself (only pure containers draw nothing)
  return selector((n) => !kindOf(n.kind)?.container && !keep.has(n))
}
defineStepAction('focus', (st, ...parts: unknown[]) => {
  const nodes = parts.flat(3).map((p) => st.node(p, 'st.focus()', 'the part')).filter((n): n is MNode => n !== null)
  if (!nodes.length) return
  st.clip(others(nodes), 'dim', 1, { duration: PACE.scopedIn, scope: 'step' })
  st.action<FocusData>('focus', { nodes })
})

// ── a glowing 3D part: a look, so it fades, slices and shows in the id pass like everything else ──────
defineLook('guideGlow', (look, amount: number, _node, frame) => {
  const a = typeof amount === 'number' && Number.isFinite(amount) ? Math.min(Math.max(amount, 0), 1) : 0
  look.emissive = Math.max(look.emissive, guideConfig(frame.model).glowEmissive * a)
  look.dim *= 1 - a
}, { rest: 0 })

// ── the light: `lit` and `dim` are two channels ──────────────────────────────────────────────────────
// One channel ("everything but this part is dim") flashes when the light moves on: the old part falls and the new one
// rises through the same value while everything else dips with them. Here the dim is one amount for the stage and
// `lit` an amount per object; an object is drawn at dim × (1 − lit). When the light changes hands only `lit` moves.
/** The light at one moment: how dim the 3D figure and the flat stage are, and how much each lit object is in the light. */
export interface Light { dim3: number; dim2: number; lit: Map<MNode, number> }
const NO_LIGHT: Light = { dim3: 0, dim2: 0, lit: new Map() }
/** The light of the story at story time `tau`: every state blended into the one before it, in order. Pure. */
export function lightAt(model: SceneModel, tau: number): Light {
  const states = guideStore(model).lights
  let cur: Light = NO_LIGHT
  for (const st of states) {
    const a = st.t - st.before
    if (tau <= a) break
    const span = st.before + st.after
    const u = span > 0 ? smooth(Math.min(1, (tau - a) / span)) : 1
    if (u >= 1) { cur = st; continue }
    const lit = new Map<MNode, number>()
    for (const [n, v] of cur.lit) lit.set(n, v * (1 - u))
    for (const [n, v] of st.lit) lit.set(n, (lit.get(n) ?? 0) + v * u)
    cur = { dim3: cur.dim3 + (st.dim3 - cur.dim3) * u, dim2: cur.dim2 + (st.dim2 - cur.dim2) * u, lit }
  }
  return cur
}
const lightOf = (frame: Frame): Light => frame.memo('guide.light', () => lightAt(frame.model, frame.tau), NO_LIGHT)
/** How dim the light of the story makes one object in this frame: the dim of its space, less its own share of the light. */
export const lightDim = (node: MNode, frame: Frame): number => {
  const l = lightOf(frame)
  const d = node.space === '3d' ? l.dim3 : l.dim2
  return d > 0 ? d * (1 - Math.min(1, l.lit.get(node) ?? 0)) : 0
}
// a lit 3D part gets the focus highlight of the 3D look (contour, lit body): a look, so check and tests see it without a GPU
defineLook('guideLit', (look, _on: unknown, node, frame) => {
  const amount = lightOf(frame).lit.get(node) ?? 0
  if (amount > 0) lightPart(look, amount)
})
/** An object and everything inside it. */
const withParts = (nodes: Iterable<MNode>, amount = 1, into = new Map<MNode, number>()): Map<MNode, number> => {
  const add = (n: MNode): void => { into.set(n, Math.max(into.get(n) ?? 0, amount)); n.children.forEach(add) }
  for (const n of nodes) add(n)
  return into
}
/**
 * st.highlight({ lit, dim }): put parts in the light and dim everything else, as two separate things. `lit` is a
 * part, a list of parts, or a record of id → amount (0..1); `dim` (0..1) is how dim everything else becomes (default:
 * `highlightDim`). It lasts until the next st.highlight() of the step or the end of the step; st.highlight(false)
 * ends it. A second call hands the light over: the lit part changes, the dim does not move.
 */
defineStepAction('highlight', (st, opts: unknown) => {
  const model = st.model, store = guideStore(model)
  const lit = new Map<MNode, number>()
  let dim: number | null = null
  const bad = (what: string): void => { model.diagnostics.add({ code: 'API-TYPE', what: `st.highlight(): ${what}.`, fix: ['st.highlight({ lit: piston, dim: 0.9 })', 'st.highlight(false) ends it'] }) }
  if (opts === false || opts === null) { store.highlights.push({ step: st.index, at: st.cursor, lit, dim: 0, src: st.action('highlight', { ids: [], dim: 0 }).src }); return }
  if (typeof opts !== 'object' || isNode(opts) || Array.isArray(opts)) { bad('expects { lit, dim }'); return }
  const o = opts as { lit?: unknown; dim?: unknown }
  for (const key of Object.keys(o)) if (key !== 'lit' && key !== 'dim') model.diagnostics.add({ code: 'API-UNKNOWN', what: `st.highlight() has no option "${key}".`, fix: ['options: lit, dim'] })
  if (o.dim !== undefined) {
    if (typeof o.dim !== 'number' || !Number.isFinite(o.dim)) { bad(`dim must be a number from 0 to 1, got ${String(o.dim)}`); return }
    dim = Math.min(1, Math.max(0, o.dim))
  }
  const one = (part: unknown, amount: number): void => { const node = st.node(part, 'st.highlight()', 'the part'); if (node) withParts([node], Math.min(1, Math.max(0, amount)), lit) }
  if (o.lit !== undefined && o.lit !== null) {
    if (isNode(o.lit) || typeof o.lit === 'string') one(o.lit, 1)
    else if (Array.isArray(o.lit)) o.lit.flat(3).forEach((p) => one(p, 1))
    else if (typeof o.lit === 'object') for (const [id, amount] of Object.entries(o.lit as Record<string, unknown>)) { if (typeof amount === 'number' && Number.isFinite(amount)) one(id, amount); else bad(`the amount of "${id}" must be a number from 0 to 1`) }
    else { bad('lit must be a part, a list of parts or a record of id → amount'); return }
  }
  const action = st.action('highlight', { ids: [...lit.keys()].map((n) => n.id), dim })
  store.highlights.push({ step: st.index, at: st.cursor, lit, dim, src: action.src })
})
/** Rate of a mark that comes, stays and goes inside its own clip: up over `rise`, down over `fall` (shares of the clip), ending at 0. */
export const pulseRate = (rise: number, fall: number) => (u: number): number => {
  const up = rise > 0 ? Math.min(1, u / rise) : 1, down = fall > 0 ? Math.min(1, (1 - u) / fall) : 1
  const x = Math.max(0, Math.min(up, down))
  return x * x * (3 - 2 * x)
}

// ── the cue compiler: runs once the scene is built, when every step has its length ──────────────────
/**
 * Compile the says of every step into one cue list per step, in seconds from the start of the step: flights are
 * back-timed to land on their words, the pointer never leaves a perch early, marks of a step live until the step
 * ends (the step-scoped envelope clears them), a glow expires, a focus lasts until the next one.
 */
export function compileGuide(model: SceneModel): void {
  const cfg = guideConfig(model)
  for (const gs of guideStore(model).steps.values()) {
    const rec = model.steps[gs.index]
    if (!rec) continue
    gs.duration = rec.t1 - rec.t0
    gs.cues = []
    gs.lines = []
    gs.says.forEach((say, j) => {
      const at = say.at
      const sched = scheduleCues(say.parsed, say.timing, { ...scheduleOptions(cfg), stepDuration: Math.max(0, gs.duration - at) })
      const cueOfSpan = new Map<number, number>()
      for (const c of sched.cues) {
        const found = c.targets.map((t) => resolveTarget(model, t)).filter((x): x is { node: MNode; anchor: string | null } => x !== null)
        const cue: GuideCueRec = {
          ...c, wordAt: c.wordAt + at, wordEnd: c.wordEnd + at, fireAt: c.fireAt + at, landAt: c.landAt + at, drawEnd: c.drawEnd + at, markEnd: c.markEnd + at,
          dockAt: c.dockAt === null ? null : c.dockAt + at, say: j, step: gs.index, index: gs.cues.length, nodes: found.map((x) => x.node), anchors: found.map((x) => x.anchor), src: say.src,
        }
        // a cue whose parts do not exist (reported as GUIDE-TARGET) moves nothing
        if (found.length < c.targets.length) cue.pointer = false
        cueOfSpan.set(c.spanIndex, cue.index)
        gs.cues.push(cue)
      }
      const words = say.parsed.words
      for (const s of say.parsed.sentences) {
        const list = words.slice(s.firstWord, s.firstWord + s.wordCount).map((w, k) => ({ text: w.text, t0: at + (say.timing.wordStarts[s.firstWord + k] ?? 0), t1: at + (say.timing.wordEnds[s.firstWord + k] ?? 0), cue: w.span >= 0 ? cueOfSpan.get(w.span) ?? -1 : -1 }))
        if (!list.length) continue
        const prev = gs.lines[gs.lines.length - 1]
        const t0 = list[0]!.t0, t1 = list[list.length - 1]!.t1
        gs.lines.push({ say: j, text: s.text, t0, t1, showAt: Math.max(0, t0 - cfg.captionLead, prev ? prev.t1 : 0), words: list })
      }
    })
    // across the sentences of the step: one pointer, so a perch is never left early and a dock trip must fit
    const pointers = gs.cues.filter((c) => c.pointer)
    pointers.forEach((c, i) => {
      // back-timed against the whole step: a flight may start while the sentence before is still being spoken
      const before = pointers[i - 1]
      const free = before ? Math.max(before.landAt + cfg.perch, before.verb === 'arrow' ? before.drawEnd : 0) : 0
      const d = Math.max(c.wordAt - cfg.hop, free, 0) - c.fireAt
      if (d !== 0) { c.fireAt += d; c.landAt += d; c.drawEnd += d; if (c.dockAt !== null) c.dockAt += d }
      c.lateBy = Math.max(0, c.landAt - c.wordAt)
      c.late = c.lateBy > cfg.maximumLate
    })
    pointers.forEach((c, i) => {
      const next = pointers[i + 1]
      if (c.dockAt !== null && next && next.fireAt < c.dockAt + cfg.hop + cfg.perch) c.dockAt = null
      if (c.verb === 'point') c.markEnd = c.dockAt ?? next?.fireAt ?? Infinity
    })
    const focuses = gs.cues.filter((c) => c.verb === 'focus')
    focuses.forEach((c, i) => { c.markEnd = focuses[i + 1]?.landAt ?? Infinity })
    for (const c of gs.cues) {
      // marks of a step stay until the step ends: the step-scoped envelope of their action clears them over the start of the next one
      if (c.verb === 'ring' || c.verb === 'label' || c.verb === 'arrow' || c.hold) c.markEnd = Infinity
      if (!c.nodes.length) continue
      const scope = c.hold ? 'persist' as const : 'step' as const
      const t0 = rec.t0 + c.landAt
      if (c.verb === 'label') {
        model.addAction<LabelData>('label', { node: c.nodes[0]!, text: labelText(c.words) || c.nodes[0]!.id, cue: c.index, anchor: c.anchors[0] ?? null }, { step: gs.index, at: c.landAt, duration: cfg.drawTime, scope, src: c.src })
      } else {
        model.addAction<CueData>('cue', { verb: c.verb, ids: c.nodes.map((n) => n.id), words: c.words, index: c.index }, { step: gs.index, at: c.landAt, duration: Math.max(cfg.drawTime, 1e-3), scope, src: c.src })
      }
      const life = Number.isFinite(c.markEnd) ? c.markEnd - c.landAt : 0
      if (c.verb === 'glow') {
        for (const node of c.nodes) {
          if (node.space !== '3d') continue // a flat shape gets its halo from the marks overlay
          const takers = kindOf(node.kind)?.container || node.children.length ? leaves(node) : [node]
          for (const n of takers) {
            if (life > 0) model.addClip({ target: n, prop: 'guideGlow', to: 1, t0, t1: t0 + life, rate: pulseRate(cfg.drawTime / life, cfg.markFade / life), scope: 'persist', step: gs.index, src: c.src, seq: 0 })
            else model.addClip({ target: n, prop: 'guideGlow', to: 1, t0, t1: t0 + cfg.drawTime, rate: pulseRate(1, 0), scope, step: gs.index, src: c.src, seq: 0 })
          }
        }
      }
    }
  }
  compileLights(model, cfg)
}

/**
 * The light of the whole story, as states in time order (guideStore(model).lights).
 * - The pointer: at the first landing of a step everything but the named part dims; the dim holds until `highlightHold`
 *   after the last landing; in between only the lit part changes hands. A step that declares st.focus() keeps the
 *   focus it declared: the pointer adds no light there.
 * - [words](focus:part): the same, with `focusDim`, until the step ends.
 * - st.highlight({ lit, dim }): from its moment until the next one or the end of the step.
 * A state that ends within reach of the next one hands over to it directly: the dim does not dip between two steps.
 */
function compileLights(model: SceneModel, cfg: GuideConfig): void {
  const store = guideStore(model)
  const states: LightState[] = []
  const off = (t: number, step: number): LightState => ({ t, before: 0, after: cfg.highlightOut, lit: new Map(), dim3: 0, dim2: 0, step })
  const focusSteps = new Set(model.actions.filter((a) => a.type === 'focus').map((a) => a.step))
  for (const rec of model.steps) {
    const k = rec.index, gs = store.steps.get(k)
    const own: LightState[] = []
    let end = -Infinity // when the light of this step goes out, story time
    // the pointer's light and the focus spans, in landing order
    const cues = gs ? gs.cues.filter((c) => c.nodes.length && (c.verb === 'focus' || (c.pointer && !c.arrow && !focusSteps.has(k)))).sort((a, b) => a.landAt - b.landAt) : []
    let carry: MNode[] = [], focused = false
    cues.forEach((c, i) => {
      // the light stays on the last part of the 3D figure while the pointer visits something flat, and the other way round
      const space = c.nodes[0]!.space
      const lit = withParts([...c.nodes, ...carry.filter((n) => n.space !== space)])
      carry = [...c.nodes, ...carry.filter((n) => n.space !== space)]
      focused ||= c.verb === 'focus'
      const first = i === 0
      own.push({ t: rec.t0 + c.landAt, before: first ? cfg.highlightBefore : cfg.handBefore, after: first ? cfg.highlightAfter : cfg.handAfter, lit, dim3: focused ? cfg.focusDim : cfg.highlightDim, dim2: focused ? cfg.focusDim : cfg.highlightDim2d, step: k })
      end = focused ? rec.t1 : Math.min(rec.t1, rec.t0 + c.landAt + cfg.highlightHold)
    })
    // what the scene declared itself wins from its moment on
    for (const h of store.highlights.filter((x) => x.step === k).sort((a, b) => a.at - b.at)) {
      const t = rec.t0 + h.at
      const dim = h.dim ?? cfg.highlightDim
      for (let i = own.length - 1; i >= 0; i--) if (own[i]!.t >= t) own.splice(i, 1) // later pointer states are replaced
      if (!h.lit.size && h.dim === 0) { own.push(off(t, k)); end = -Infinity; continue }
      own.push({ t, before: own.length ? cfg.handBefore : cfg.highlightBefore, after: own.length ? cfg.handAfter : cfg.highlightAfter, lit: h.lit, dim3: dim, dim2: dim, step: k })
      end = rec.t1
    }
    if (!own.length) continue
    own.sort((a, b) => a.t - b.t)
    // the step before left its light on until now: hand over instead of going dark and coming back
    const last = states[states.length - 1]
    if (last && !last.lit.size && last.dim3 === 0 && last.dim2 === 0 && own[0]!.t - own[0]!.before < last.t + last.after + cfg.highlightBefore + cfg.highlightAfter && states.length > 1) {
      states.pop()
      own[0]!.before = cfg.handBefore
      own[0]!.after = cfg.handAfter
    }
    states.push(...own)
    if (Number.isFinite(end)) states.push(off(end, k))
  }
  store.lights = states
  if (!states.length) return
  // one clip for everything that draws: its value is the light's dim for that object in the frame being drawn, so the
  // light is a pure function of story time and a later st.focus() of the scene still folds over it
  model.addClip({ target: selector((n) => !kindOf(n.kind)?.container), prop: 'dim', to: lightDim as unknown as number, t0: 0, t1: 0, rate: (u) => u, scope: 'persist', step: 0, src: model.steps[0]?.src ?? { line: 0 }, seq: 0 })
  model.view.guideLit = true
}
const leaves = (node: MNode): MNode[] => (node.children.length ? node.children.flatMap(leaves) : [node])
defineFinalize('guide', compileGuide)

/**
 * info().guide: per step, every cue with its story times (shoot one frame per cue with `mimir shot --at <land>`), and
 * every spoken word with its onset: the timings the transcript's spans go with.
 */
defineManifest('guide', (model) => {
  const out: unknown[] = []
  for (const gs of [...guideStore(model).steps.values()].sort((a, b) => a.index - b.index)) {
    const rec = model.steps[gs.index]
    if (!rec) continue
    const r = (x: number | null): number | null => (x === null || !Number.isFinite(x) ? null : Math.round((rec.t0 + x) * 1000) / 1000)
    out.push({
      step: gs.index + 1,
      cues: gs.cues.map((c) => ({ verb: c.verb, targets: c.targets, words: c.words, sentence: c.say, word: r(c.wordAt), fire: r(c.fireAt), land: r(c.landAt), drawn: r(c.drawEnd), end: r(c.markEnd), late: c.late, hold: c.hold })),
      lines: gs.lines.map((l) => ({ text: l.text, show: r(l.showAt), words: l.words.map((w) => ({ text: w.text, t0: r(w.t0), t1: r(w.t1), cue: w.cue })) })),
    })
  }
  return { steps: out, voice: guideConfig(model).voice }
})

export const api = {}
