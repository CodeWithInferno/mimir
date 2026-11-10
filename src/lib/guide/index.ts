/**
 * Narration guide, pure side: parse spans -> estimate word timing -> schedule cues -> sample the pointer
 * pose, the marks and the caption at any step time. No DOM, no clock, no randomness.
 *
 *   const parsed   = parseNarration('The [piston](piston) slides down.')
 *   const timing   = estimateTiming(parsed)
 *   const schedule = scheduleCues(parsed, timing, { stepDuration })
 *   guidePose(schedule.cues, t, anchorAt, dock) · activeMarks(schedule.cues, t) · captionState(parsed, timing, t)
 *   lintNarration(parsed, schedule, manifest)
 */
export { parseNarration, isGuideVerb, GUIDE_VERBS, GUIDE_VERB_NAMES } from './parse.ts'
export { estimateTiming, pauseAfter } from './timing.ts'
export { scheduleCues } from './schedule.ts'
export {
  guidePose,
  flightPose,
  flightDuration,
  landingPoint,
  strokeProgress,
  smoothstep,
  REST_ANGLE_DEG,
  DOCK,
  ARC_LIFT_FRACTION,
  ARC_LIFT_MAX,
  SCALE_PULSE,
  HEADING_BLEND,
} from './pose.ts'
export { markProgress, activeMarks, MARK_FADE } from './marks.ts'
export { captionState, captionWordState } from './caption.ts'
export { lintNarration, STANDARD_ANCHORS } from './lint.ts'
export { editDistance, nearestName } from './names.ts'
export type {
  ActiveMark,
  AnchorAt,
  CaptionState,
  CueSchedule,
  GuideCue,
  GuidePose,
  GuideVerb,
  LintLimits,
  ManifestPart,
  MarkState,
  NarrationError,
  NarrationLint,
  NarrationSentence,
  NarrationSpan,
  NarrationTiming,
  NarrationWord,
  ParsedNarration,
  ScheduleOptions,
  Severity,
  TimingOptions,
  VerbInfo,
  WordTime,
} from './types.ts'
