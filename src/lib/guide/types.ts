/** Plain-data types for the narration guide: spans, timing, cues, pointer pose, marks, captions, lint. */
import type { Vec2 } from '../types.ts'

/** What the guide does while a span's words are spoken. */
export type GuideVerb = 'point' | 'ring' | 'label' | 'arrow' | 'glow' | 'focus'

/** Static facts about a verb: does it move the pointer, how many parts it takes, how long its mark lives. */
export interface VerbInfo {
  /** true when the pointer flies to the part (point, ring, label, arrow). */
  pointer: boolean
  /** 'one' part, 'many' parts joined with +, or a 'pair' written from->to. */
  arity: 'one' | 'many' | 'pair'
  /** 'pointer' = until the pointer leaves, 'step' = until the step ends, 'span' = a little past the words, 'camera' = until the next focus. */
  lifetime: 'pointer' | 'step' | 'span' | 'camera'
}

/** Diagnostic severity, as printed by `check`. */
export type Severity = 'error' | 'warn'

/** One whitespace-separated token of the spoken text (punctuation stays attached to its word). */
export interface NarrationWord {
  text: string
  /** Character offsets into `plain`: [start, end). */
  start: number
  end: number
  /** Index into `sentences`. */
  sentence: number
  /** Index into `spans` of the span that covers this word, or -1. */
  span: number
}

/** One sentence of the spoken text. */
export interface NarrationSentence {
  text: string
  /** Character offsets into `plain`: [start, end). */
  start: number
  end: number
  /** Index of its first word in `words`, and how many words it has. */
  firstWord: number
  wordCount: number
}

/** One guide span `[spoken words](verb:targets,option)`, located in the spoken text. */
export interface NarrationSpan {
  /** Character offsets into `plain`: [start, end). start === end for an empty span `[](focus:x)`. */
  start: number
  end: number
  /** The spoken words inside the brackets ('' for an empty span). */
  words: string
  verb: GuideVerb
  /** Every part the span names, in written order. For `a->b` this is [a, b]. */
  targets: string[]
  /** [from, to], present only when the targets were written `a->b`. */
  arrow?: [string, string]
  /** Options after the first comma, trimmed (`hold` keeps the mark past the step). */
  options: string[]
  /** Index into `words` of the first word the span covers (the next word, for an empty span), and how many it covers. */
  firstWord: number
  wordCount: number
  /** Index into `sentences`. */
  sentence: number
  /** The span exactly as authored, e.g. `[intake valve](ring:intakeValve)`. */
  source: string
  /** Character offset of its `[` in the authored text. */
  at: number
}

/** A problem found while parsing; the spoken text always survives. */
export interface NarrationError {
  code: 'GUIDE-SYNTAX' | 'GUIDE-BARE' | 'GUIDE-VERB' | 'GUIDE-ARROW' | 'GUIDE-SHAPE' | 'GUIDE-NAME'
  severity: Severity
  /** Character offset in the authored text. */
  at: number
  what: string
  /** 1-3 literal edits, most likely first. */
  fix: string[]
  /** The offending target text, when the problem is a target that is not a name. */
  ref?: string
}

/** Result of `parseNarration`. */
export interface ParsedNarration {
  /** The spoken text: spans replaced by their words, whitespace collapsed. Safe for captions and TTS. */
  plain: string
  words: NarrationWord[]
  sentences: NarrationSentence[]
  spans: NarrationSpan[]
  errors: NarrationError[]
}

/** A real word onset from a TTS boundary event or an aligner. */
export interface WordTime {
  /** Character offset into `plain` (speechSynthesis `charIndex`). */
  offset: number
  /** Seconds from the start of speech. */
  time: number
}

/** Options of `estimateTiming`. */
export interface TimingOptions {
  /** Articulation pace when there is no audio. Default 16.5 (about 160 words a minute). */
  charsPerSecond?: number
  /** Silence after , ; : and dashes, seconds. Default 0.365. */
  commaPause?: number
  /** Silence after . ! ?, seconds. Default 0.36. */
  sentencePause?: number
  /** Real word onsets: seconds per word index, or sparse {offset, time} records. Words without one are interpolated. */
  wordTimes?: readonly number[] | readonly WordTime[]
  /** Real audio length in seconds, when known; the estimate is stretched to fit it. */
  duration?: number
  /** Seconds of silence before the first word, so a pointer can land on an early word. Default 0. */
  leadIn?: number
}

/** Result of `estimateTiming`. All times are seconds from the start of the step. */
export interface NarrationTiming {
  /** When the narration is over (includes the lead-in and the last pause). */
  duration: number
  /** Onset of each word, index-aligned with `parsed.words`. Never decreases. */
  wordStarts: number[]
  /** End of each word (before any pause that follows it). */
  wordEnds: number[]
  /** [start, end] of each sentence, index-aligned with `parsed.sentences`. */
  sentenceRanges: [number, number][]
  /** Onset of the first word and end of the last one. */
  speechStart: number
  speechEnd: number
}

/** Options of `scheduleCues`. All seconds. */
export interface ScheduleOptions {
  /** Flight time of one pointer hop. Default 0.5. */
  hop?: number
  /** The pointer rests at least this long before leaving again. Default 0.35. */
  minPerch?: number
  /** Draw-on time of ring / label / arrow / glow. Default 0.45. */
  drawTime?: number
  /** Shortest life of a glow. Default 1.2. */
  glowMin?: number
  /** A glow outlives its words by this much. Default 0.6. */
  glowTail?: number
  /** Idle time after which the pointer flies back to the dock. Default 1.5. */
  dockAfter?: number
  /** Landing later than this after the word starts is flagged `late`. Default 0.25. */
  lateTolerance?: number
  /** Length of the whole step (narration, plays and hold); step-scoped marks live until then. Default: the narration length. */
  stepDuration?: number
}

/** One compiled guide cue. All times are seconds from the start of the step. */
export interface GuideCue {
  verb: GuideVerb
  /** Every part the cue names; [from, to] for an arrow. */
  targets: string[]
  /** [from, to], present only for `a->b`. */
  arrow?: [string, string]
  options: string[]
  /** The spoken words the cue is bound to ('' for an empty span). */
  words: string
  /** Index into `parsed.spans`. */
  spanIndex: number
  /** When the span's first word starts, and when its last word ends. */
  wordAt: number
  wordEnd: number
  /** When the pointer takes off (equals `landAt` for verbs that do not move it). */
  fireAt: number
  /** When the pointer lands and the mark starts. Equals `wordAt` unless the cue is late. */
  landAt: number
  /** When the mark has finished drawing on (equals `landAt` for point and focus). */
  drawEnd: number
  /** When the mark is gone. */
  markEnd: number
  /** true when this cue moves the pointer. */
  pointer: boolean
  /** When the pointer leaves this cue's perch for the dock, or null when it flies straight on to the next cue. */
  dockAt: number | null
  /** true when the `hold` option keeps the mark past the step. */
  hold: boolean
  /** Seconds the pointer lands after its word starts (0 when on time). */
  lateBy: number
  /** true when `lateBy` exceeds the tolerance. */
  late: boolean
}

/** Result of `scheduleCues`. */
export interface CueSchedule {
  /** Step length the marks were scheduled against. */
  duration: number
  /** First word onset and last word end of the narration. */
  speechStart: number
  speechEnd: number
  /** One cue per span, in span order (`cues[i].spanIndex === i`). */
  cues: GuideCue[]
}

/** Where a part is on screen right now (pixels, y down), or null when it cannot be pointed at. */
export type AnchorAt = (target: string, t: number) => Vec2 | null

/** Pose of the pointer tip at one instant. */
export interface GuidePose {
  /** Screen position of the pointer TIP (pixels, y down); rotate and scale the sprite about its tip. */
  x: number
  y: number
  /** Sprite rotation, clockwise in screen space (CSS rotate); 0 = tip pointing up, -35 at rest. Continuous in t, so it may leave +-180. */
  angleDeg: number
  /** 1 at rest, up to 1.3 mid-flight. */
  scale: number
  /** false only when the pose cannot be drawn (a non-finite time or dock). */
  visible: boolean
  /** Part id (or 'dock') the pointer is coming from and going to; equal when it is resting. */
  from: string
  to: string
  /** 0..1 through the current flight or arrow stroke; 1 when resting. */
  progress: number
  /** 'docked' by the caption, 'flying', 'perched' on a part, or 'drawing' an arrow as its pen tip. */
  phase: 'docked' | 'flying' | 'perched' | 'drawing'
  /** Index into `cues` of the cue the pointer is serving, or -1. */
  cue: number
}

/** Draw-on and expiry state of one mark at one instant. */
export interface MarkState {
  /** 0..1 eased draw-on progress (stroke length, fade-in). */
  progress: number
  /** 1 while alive, easing to 0 as the mark expires. */
  opacity: number
  /** true between landing and expiry. */
  visible: boolean
}

/** A mark that is on screen at the sampled instant. */
export interface ActiveMark extends MarkState {
  /** Index into `cues`. */
  index: number
  cue: GuideCue
}

/** What the caption shows at one instant. */
export interface CaptionState {
  /** Number of words whose onset has passed (the current word included). */
  spokenCount: number
  /** Index of the word being spoken (held through pauses), or -1 before speech and after it ends. */
  currentWord: number
  /** 0..1 through the current word. */
  wordProgress: number
  /** true while a word is being articulated, false in pauses. */
  speaking: boolean
  /** Index of the sentence to show, or -1 when there is no text. */
  sentence: number
  /** Index of the span the current word belongs to, or -1. */
  span: number
}

/** One part the narration may refer to. */
export interface ManifestPart {
  id: string
  /** Human name, used for did-you-mean. */
  label?: string
  /** Anchor names valid after the id (`piston.top`); the standard ones are always accepted. */
  anchors?: readonly string[]
}

/** Thresholds of `lintNarration`. */
export interface LintLimits {
  /** Default 14. */
  maxSentenceWords?: number
  /** Default 2. */
  maxMarksPerSentence?: number
  /** Seconds of narration with no cue. Default 3. */
  maxDeadAir?: number
  /** Seconds the pointer may land after its word. Default 0.25. */
  maxLate?: number
}

/** One lint finding, shaped for the `check` diagnostics contract. */
export interface NarrationLint {
  code:
    | NarrationError['code']
    | 'GUIDE-TARGET'
    | 'GUIDE-LATE'
    | 'GUIDE-CROWDED'
    | 'GUIDE-DEAD-AIR'
    | 'GUIDE-REPEAT'
    | 'SAY-LONG'
    | 'SAY-SYMBOL'
  severity: Severity
  /** One sentence with the measured value and the limit. */
  what: string
  /** 1-3 literal edits, most likely first. */
  fix: string[]
  /** Index into `parsed.spans`, when the finding is about one span. */
  spanIndex?: number
  /** Index into `parsed.sentences`, when the finding is about one sentence. */
  sentenceIndex?: number
  measured?: number
  limit?: number
}
