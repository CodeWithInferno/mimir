/** Mark state as a pure function of step time: draw-on progress, then a fade that finishes exactly at expiry. */
import { smoothstep, strokeProgress } from './pose.ts'
import type { ActiveMark, GuideCue, MarkState } from './types.ts'

/** Seconds a mark takes to fade out before `markEnd`. */
export const MARK_FADE = 0.3

/** Draw-on progress (0..1, eased) and expiry fade (opacity 1..0) of one cue's mark at step time `t`. */
export function markProgress(cue: GuideCue, t: number, fadeTime: number = MARK_FADE): MarkState {
  if (!(t >= cue.landAt)) return { progress: 0, opacity: 0, visible: false }
  const progress = strokeProgress(cue, t)
  if (cue.hold) return { progress, opacity: 1, visible: true }
  if (t >= cue.markEnd) return { progress, opacity: 0, visible: false }
  const fade = Math.min(fadeTime > 0 ? fadeTime : 0, cue.markEnd - cue.landAt)
  const opacity = fade > 0 ? smoothstep((cue.markEnd - t) / fade) : 1
  return { progress, opacity, visible: true }
}

/** Every mark that is on screen at step time `t`, in cue order, with its draw-on progress and opacity. */
export function activeMarks(cues: readonly GuideCue[], t: number, fadeTime: number = MARK_FADE): ActiveMark[] {
  const active: ActiveMark[] = []
  for (let index = 0; index < cues.length; index++) {
    const cue = cues[index]!
    const state = markProgress(cue, t, fadeTime)
    if (state.visible) active.push({ index, cue, progress: state.progress, opacity: state.opacity, visible: true })
  }
  return active
}
