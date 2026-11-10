// Every number that decides whether `mimir check` reports something, in one place, by name: the thresholds of the
// rules and the sampling plan. Nothing in the rules is a bare literal. Each default can be changed three ways, the
// later winning:
//   1. project / scene configuration: the key `check.<CODE>.<name>` of the core's config store
//      (model.config('check.OCCLUDED.occludedVisible', 0.3)); <CODE> is the rule the limit belongs to (LIMIT_RULE below),
//      PLAN for the sampling plan and ENGINE for what several rules share. Until the core has a config store the
//      defaults below are used as they are;
//   2. the scene: s.check({ limits: { name: value }, off: ['CODE'] });
//   3. one object, one rule: part.allow('CODE').
// The values marked "starting value" are judgements tuned on the example scenes; the others cite their source.
// ./RULES.md lists every limit with its key (tests/unit/check/limits.test.ts keeps the two in step).
import { closest, type SceneModel } from '../core/index.ts'
import { checkStore } from './index.ts'

export const LIMITS = {
  /** EMPTY-FRAME: least share of the frame that something must cover */
  emptyFrame: 0.005,
  /** EMPTY-FRAME: 2D boxes are counted on a grid with this many columns (the rows follow the shape of the frame) */
  emptyGrid: 96,
  /** EMPTY-FRAME: a 3D part this many times farther from the middle of the model than the next one is named as the reason the camera is so far out */
  emptyFar: 50,
  /** OFF-FRAME: share of an object's area that may lie beyond the frame */
  offFrame: 0.1,
  /** OFF-FRAME: px a text may reach past the frame (antialiasing and side bearings; more than this is cut-off text) */
  offFrameTextPixels: 1.5,
  /** TEXT-OVERLAP: two texts overlap when they share more than this many px each way and this share of the smaller */
  textOverlapPixels: 2,
  textOverlap: 0.02,
  /** PLACE-NONE: unplaced 2D objects pile up when they share this much of the smaller one and are of similar size (the smaller at least pileSimilar of the larger) */
  pileOverlap: 0.5,
  pileSimilar: 0.5,
  /**
   * OCCLUDED and GUIDE-TARGET: a part that is focused, labelled or pointed at must show at least this share of its own
   * pixels. ONE number for both rules: the guide judges the moment a mark lands, this module the end of the step.
   * Tuned on the examples: parts that read well inside a cut cylinder or under the load they carry show 36 to 59 %.
   */
  occludedVisible: 0.3,
  /** OCCLUDED: when every part in front was declared with part.allow('OCCLUDED', other), this smaller share must still show */
  occludedDeclared: 0.25,
  /** OCCLUDED: a part smaller than this many pixels when drawn alone is not judged (TINY speaks about it) */
  occludedMinPixels: 40,
  /** OCCLUDED: a part is inside the one that is pointed at (so it does not hide it: a housing is seen around what it holds) when at least this share of its box lies in the other's box */
  occludedInside: 0.5,
  /** OCCLUDED: a suggested view must show this much more of the part than the best one before it to replace it */
  occludedViewGain: 0.02,
  /** INTERPENETRATE: overlap depth, as a share of the smaller part's smallest extent */
  interpenetrateDepth: 0.02,
  /** INTERPENETRATE: two parts whose overlap depth changes by less than this share while they keep their relative place are one rigid body */
  rigidDepthChange: 0.1,
  /** FLOATING: surfaces closer than this share of the model's span are in contact */
  floatContact: 0.01,
  /** FLOATING: a detached group smaller than this share of the model's span is ignored */
  floatMinSpan: 0.01,
  /** FLOATING: beside a model that holds together, a gap up to this share of the model's span is a near miss (error); beyond it a stray (warn) */
  floatNear: 0.08,
  /** FLOATING: a gap up to this share of the detached part's own thinnest extent is a near miss even when nothing else in the scene holds together */
  floatClose: 0.5,
  /** FLOATING: a stray far from the model is reported only when the model holds at least this many parts in contact */
  floatAssembly: 3,
  /** COINCIDENT: volume overlap (intersection over union) of two parts */
  coincidentIou: 0.9,
  /** MECH-OPEN: residual of a declared invariant, as a share of the scene's span; also how much a rod may change length */
  mechOpen: 0.01,
  /** surface samples per solid for the pair queries (src/lib/solids) */
  solidSamples: 64,
  /** TEXT-LONG: a label is a name, not a sentence */
  labelWords: 4,
  labelChars: 28,
  /** TEXT-LONG: one st.say() is at most two subtitle lines of 90 characters */
  captionChars: 180,
  /** TEXT-TINY: font size as a share of the frame height (14 px at 720p) */
  textTiny: 0.02,
  /** CONTRAST-TEXT: WCAG 2.1 SC 1.4.3 contrast ratios, and the font size (px at 720p) from which text counts as large */
  contrastSmall: 4.5,
  contrastLarge: 3,
  largeTextPx: 24,
  /** CONTRAST-TEXT: an outline round the glyphs (the text backstroke) carries the text when it is at least this wide, px at 720p, on each side of a glyph */
  contrastOutlinePx: 1,
  /** TINY: the longer side of a visible object in px at 720p; and a focused object as a share of the frame height (a point marker is exempt from the second: its kind says `marker: true`) */
  tinyPixels: 6,
  tinyFocused: 0.04,
  /** TINY: how many evenly spaced moments of a step (both ends included) a pointed-at part is measured at */
  tinyMoments: 5,
  /** SUBJECT-FIT: the model must fill this share of the 3D panel in width or in height; one part must not cover more than subjectMax of it */
  subjectFill: 0.45,
  subjectMax: 0.85,
  /** LABEL-COVERS: share of another focused part that a text box may hide; a 3D part is probed on a coverGrid × coverGrid grid over its box */
  labelCovers: 0.25,
  coverGrid: 14,
  /** CONTRAST-TEXT: a filled shape (or the 3D panel) is behind a text when it lies under this share of the text's box */
  behindShare: 0.5,
  /** CHAPTER-LONG: seconds */
  chapterSeconds: 90,
  /** COLOR-COUNT: distinct hues on screen at once; hues closer than hueMerge degrees count as one; below hueChroma a colour is a grey */
  hueCount: 3,
  hueMerge: 40,
  hueChroma: 0.2,
  /** HATCH-USE: share of the placed objects that are positioned with absolute coordinates */
  hatchShare: 0.3,
  /** expect.ratio / expect.conserved: relative tolerance */
  ratioTolerance: 0.01,
  conservedTolerance: 0.01,
  /** how many times along the story probes are sampled for expect.conserved, expect.ratio and `mimir query probes` */
  timelineSamples: 48,
  /** at most this many alternative views are measured to suggest a camera for an occluded part, for this many parts per run */
  viewTrials: 5,
  viewTrialParts: 3,
  /** DEAD-PARAM: a change smaller than 10^-digits of a unit is not a visible change */
  deadParamDigits: 2,
  /** DEAD-PARAM: besides the minimum and the maximum a slider is tried at this share of its range (off centre on purpose: a symmetric picture looks the same at the middle) */
  deadParamProbe: 0.637,
  /** COINCIDENT: two parts whose boxes differ by less than this share of the part's span, corner by corner, are candidates (their volumes are then compared) */
  sameBox: 0.2,
  /** PLACE-NONE: unplaced solids pile up when their boxes share more than this much of the smaller one's volume */
  pileVolume: 0.25,
  /** the sampling plan: evenly spaced moments inside every step that moves (3 = 25 / 50 / 75 %) */
  planTransitions: 3,
  /** the sampling plan: positions of every cyclic param (one turn is divided in this many) */
  planPhases: 8,
}
export type Limits = typeof LIMITS
export type LimitName = keyof Limits

/**
 * The rule each limit belongs to: its configuration key is `check.<this>.<name>`. PLAN = the sampling plan, ENGINE =
 * measurement settings several rules share.
 */
export const LIMIT_RULE: Record<LimitName, string> = {
  emptyFrame: 'EMPTY-FRAME', emptyGrid: 'EMPTY-FRAME', emptyFar: 'EMPTY-FRAME',
  offFrame: 'OFF-FRAME', offFrameTextPixels: 'OFF-FRAME',
  textOverlapPixels: 'TEXT-OVERLAP', textOverlap: 'TEXT-OVERLAP',
  pileOverlap: 'PLACE-NONE', pileSimilar: 'PLACE-NONE', pileVolume: 'PLACE-NONE',
  occludedVisible: 'OCCLUDED', occludedDeclared: 'OCCLUDED', occludedMinPixels: 'OCCLUDED', occludedInside: 'OCCLUDED', occludedViewGain: 'OCCLUDED', viewTrials: 'OCCLUDED', viewTrialParts: 'OCCLUDED',
  interpenetrateDepth: 'INTERPENETRATE', rigidDepthChange: 'INTERPENETRATE',
  floatContact: 'FLOATING', floatMinSpan: 'FLOATING', floatNear: 'FLOATING', floatClose: 'FLOATING', floatAssembly: 'FLOATING',
  coincidentIou: 'COINCIDENT', sameBox: 'COINCIDENT',
  mechOpen: 'MECH-OPEN',
  solidSamples: 'ENGINE', timelineSamples: 'ENGINE',
  labelWords: 'TEXT-LONG', labelChars: 'TEXT-LONG', captionChars: 'TEXT-LONG',
  textTiny: 'TEXT-TINY',
  contrastSmall: 'CONTRAST-TEXT', contrastLarge: 'CONTRAST-TEXT', largeTextPx: 'CONTRAST-TEXT', contrastOutlinePx: 'CONTRAST-TEXT', behindShare: 'CONTRAST-TEXT',
  tinyPixels: 'TINY', tinyFocused: 'TINY', tinyMoments: 'TINY',
  subjectFill: 'SUBJECT-FIT', subjectMax: 'SUBJECT-FIT',
  labelCovers: 'LABEL-COVERS', coverGrid: 'LABEL-COVERS',
  chapterSeconds: 'CHAPTER-LONG',
  hueCount: 'COLOR-COUNT', hueMerge: 'COLOR-COUNT', hueChroma: 'COLOR-COUNT',
  hatchShare: 'HATCH-USE',
  ratioTolerance: 'EXPECT-FAILED', conservedTolerance: 'EXPECT-FAILED',
  deadParamDigits: 'DEAD-PARAM', deadParamProbe: 'DEAD-PARAM',
  planTransitions: 'PLAN', planPhases: 'PLAN',
}
/** The configuration key of a limit: `check.OCCLUDED.occludedVisible`. */
export const configKey = (name: LimitName): string => `check.${LIMIT_RULE[name]}.${name}`

/** A limit is a number that is not negative; anything else is refused where it was said. */
const validLimit = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
/**
 * The defaults as the project configured them: model.config(key, fallback) when the core has a config store, the
 * named default otherwise (and for a value that is not a usable number, which is reported).
 */
export function configuredLimits(model: SceneModel): Limits {
  const limits: Limits = { ...LIMITS }
  const config = (model as unknown as { config?: (key: string, fallback: unknown) => unknown }).config
  if (typeof config !== 'function') return limits
  for (const name of Object.keys(LIMITS) as LimitName[]) {
    let v: unknown
    try { v = config.call(model, configKey(name), LIMITS[name]) } catch { continue }
    if (v === undefined || v === null || v === LIMITS[name]) continue
    if (validLimit(v)) limits[name] = v
    else model.diagnostics.add({ code: typeof v === 'number' ? 'NUM-INVALID' : 'API-TYPE', step: null, t: null, what: `the configuration value ${configKey(name)} must be a number that is not negative, got ${String(v)}.`, fix: [`${configKey(name)}: ${LIMITS[name]}`] })
  }
  return limits
}

export interface Settings { limits: Limits; off: Set<string> }

/** The limits of one scene: the defaults with what s.check({ limits, off }) changed. Problems are reported on the model. */
export function settingsOf(model: SceneModel, codes: readonly string[]): Settings {
  return (model.store<{ value: Settings | null }>('check.settings', () => ({ value: null })).value ??= resolve(model, codes))
}
function resolve(model: SceneModel, codes: readonly string[]): Settings {
  const limits: Limits = configuredLimits(model)
  const off = new Set<string>()
  const names = Object.keys(LIMITS)
  for (const { value, src } of checkStore(model).options) {
    const bad = (code: string, what: string, fix: string[]): void => { model.diagnostics.add({ code, step: null, t: null, what, fix }, src) }
    if (typeof value !== 'object' || value === null) { bad('API-TYPE', `s.check() needs an object, got ${value === null ? 'null' : typeof value}.`, ["s.check({ limits: { occludedVisible: 0.4 }, off: ['COLOR-COUNT'] })"]); continue }
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'limits' && typeof v === 'object' && v !== null) {
        for (const [name, n] of Object.entries(v as Record<string, unknown>)) {
          if (!Object.hasOwn(LIMITS, name)) { const near = closest(name, names); bad('API-UNKNOWN', `s.check(): there is no limit "${name}".`, [near ? `use "${near}"` : `limits: ${names.join(', ')}`]); continue }
          if (!validLimit(n)) { bad(typeof n === 'number' ? 'NUM-INVALID' : 'API-TYPE', `s.check(): limit ${name} must be a number that is not negative, got ${String(n)}.`, [`${name}: ${LIMITS[name as LimitName]}`]); continue }
          limits[name as LimitName] = n
        }
      } else if (key === 'off' && Array.isArray(v)) {
        for (const c of v) {
          const code = String(c).toUpperCase()
          if (!codes.includes(code)) { const near = closest(code, codes); bad('API-UNKNOWN', `s.check(): there is no rule "${String(c)}".`, [near ? `use "${near}"` : `rules: ${codes.join(', ')}`]); continue }
          off.add(code)
        }
      } else {
        const near = closest(key, ['limits', 'off'])
        bad(key === 'limits' || key === 'off' ? 'API-TYPE' : 'API-UNKNOWN', key === 'limits' ? 's.check(): limits must be an object of name: number.' : key === 'off' ? 's.check(): off must be a list of rule codes.' : `s.check() has no option "${key}".`, [near && near !== key ? `use "${near}"` : "s.check({ limits: { occludedVisible: 0.4 }, off: ['COLOR-COUNT'] })"])
      }
    }
  }
  // part.allow(code): the code must be a rule
  for (const a of checkStore(model).allows) {
    if (codes.includes(a.code)) continue
    const near = closest(a.code, codes)
    model.diagnostics.add({ code: 'API-UNKNOWN', ids: [a.node.id], step: null, t: null, what: `${a.node.kind}.allow(): there is no rule "${a.code}".`, fix: [near ? `use '${near}'` : `rules that take an exception: FLOATING, INTERPENETRATE, CONTAINED, COINCIDENT, OCCLUDED, TINY, TEXT-TINY, CONTRAST-TEXT, MECH-OPEN, CAMERA-CLIP`] }, a.src)
  }
  return { limits, off }
}
