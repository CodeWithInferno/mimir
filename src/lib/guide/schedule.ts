/**
 * Cue scheduler. Narration is the clock: the pointer LEAVES EARLY so that it LANDS as its word starts.
 * One fixed-length hop per pointer cue, so the whole schedule is computable from text alone.
 */
import { GUIDE_VERBS } from './parse.ts'
import type { CueSchedule, GuideCue, NarrationTiming, ParsedNarration, ScheduleOptions } from './types.ts'

/** Compile spans into timed cues: flights back-timed to land on their word, late arrivals flagged, mark lifetimes resolved. */
export function scheduleCues(parsed: ParsedNarration, timing: NarrationTiming, options: ScheduleOptions = {}): CueSchedule {
  const hop = nonNegativeOr(options.hop, 0.5)
  const minPerch = nonNegativeOr(options.minPerch, 0.35)
  const drawTime = nonNegativeOr(options.drawTime, 0.45)
  const glowMin = nonNegativeOr(options.glowMin, 1.2)
  const glowTail = nonNegativeOr(options.glowTail, 0.6)
  const lateTolerance = nonNegativeOr(options.lateTolerance, 0.25)
  const dockAfter = options.dockAfter !== undefined && !Number.isNaN(options.dockAfter) && options.dockAfter >= 0 ? options.dockAfter : 1.5
  const narration = Number.isFinite(timing.duration) ? timing.duration : 0
  const duration = Math.max(narration, nonNegativeOr(options.stepDuration, 0))

  const wordCount = Math.min(parsed.words.length, timing.wordStarts.length, timing.wordEnds.length)
  const cues: GuideCue[] = []
  let pointerFreeAt = 0 // earliest moment the pointer may leave where it is

  // pass 1: when each cue fires and lands
  for (let i = 0; i < parsed.spans.length; i++) {
    const span = parsed.spans[i]!
    const info = GUIDE_VERBS[span.verb] ?? GUIDE_VERBS.point
    const wordAt = span.firstWord < wordCount ? timing.wordStarts[span.firstWord]! : narration
    const lastWord = span.firstWord + span.wordCount - 1
    const wordEnd = span.wordCount > 0 && lastWord < wordCount ? Math.max(timing.wordEnds[lastWord]!, wordAt) : wordAt

    let fireAt = wordAt
    let landAt = wordAt
    if (info.pointer) {
      const onTime = wordAt - hop
      fireAt = Math.max(onTime, pointerFreeAt)
      landAt = fireAt === onTime ? wordAt : fireAt + hop
    }
    const drawEnd = span.verb === 'point' || span.verb === 'focus' ? landAt : landAt + drawTime
    // an arrow is drawn with the pointer as its pen tip, so the pointer is busy until the stroke ends
    if (info.pointer) pointerFreeAt = Math.max(landAt + minPerch, span.verb === 'arrow' ? drawEnd : 0)

    const lateBy = Math.max(0, landAt - wordAt)
    const cue: GuideCue = {
      verb: span.verb,
      targets: span.targets.slice(),
      options: span.options.slice(),
      words: span.words,
      spanIndex: i,
      wordAt,
      wordEnd,
      fireAt,
      landAt,
      drawEnd,
      markEnd: duration,
      pointer: info.pointer,
      dockAt: null,
      hold: span.options.includes('hold'),
      lateBy,
      late: lateBy > lateTolerance,
    }
    if (span.arrow) cue.arrow = [span.arrow[0], span.arrow[1]]
    cues.push(cue)
  }

  // pass 2 (backwards): when the pointer leaves each perch, and when each mark ends
  let nextPointerFire: number | null = null
  let nextFocusFire: number | null = null
  for (let i = cues.length - 1; i >= 0; i--) {
    const cue = cues[i]!
    const lifetime = (GUIDE_VERBS[cue.verb] ?? GUIDE_VERBS.point).lifetime

    if (cue.pointer) {
      const idleFrom = Math.max(cue.landAt, cue.drawEnd, cue.wordEnd)
      const dockAt = idleFrom + dockAfter
      // go home only when the round trip fits before the next take-off
      if (Number.isFinite(dockAt) && (nextPointerFire === null || nextPointerFire >= dockAt + hop + minPerch)) cue.dockAt = dockAt
      if (lifetime === 'pointer') cue.markEnd = cue.dockAt ?? nextPointerFire ?? duration
      nextPointerFire = cue.fireAt
    }
    if (lifetime === 'step') {
      cue.markEnd = Math.max(duration, cue.drawEnd)
    } else if (lifetime === 'span') {
      const natural = Math.max(cue.wordEnd + glowTail, cue.landAt + glowMin)
      cue.markEnd = cue.hold ? Math.max(natural, duration) : natural
    } else if (lifetime === 'camera') {
      cue.markEnd = Math.max(cue.landAt, nextFocusFire ?? duration)
      nextFocusFire = cue.fireAt
    }
  }

  return { duration, speechStart: timing.speechStart, speechEnd: timing.speechEnd, cues }
}

function nonNegativeOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback
}
