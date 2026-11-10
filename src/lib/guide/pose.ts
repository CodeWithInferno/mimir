/**
 * Pointer pose. The flight is Clicky's (quadratic bezier, control point lifted min(0.2 d, 80) px, smoothstep,
 * tangent heading, scale pulse) rewritten as a PURE FUNCTION OF TIME: both ends are re-read from the current
 * anchor positions on every call, so the pointer rides moving parts and scrubbing is exact.
 * Coordinates are screen pixels, y down.
 */
import type { Vec2 } from '../types.ts'
import type { AnchorAt, GuideCue, GuidePose } from './types.ts'

/** Sprite rotation when the pointer rests (cursor-like tilt). */
export const REST_ANGLE_DEG = -35
/** The id reported in `from` / `to` when the pointer is at its dock. */
export const DOCK = 'dock'
/** The bezier control point is lifted by this fraction of the flight distance... */
export const ARC_LIFT_FRACTION = 0.2
/** ...but never by more than this many pixels. */
export const ARC_LIFT_MAX = 80
/** Extra scale at the middle of a flight. */
export const SCALE_PULSE = 0.3
/** Fraction of a flight, at each end, over which the heading turns between the rest angle and the tangent. */
export const HEADING_BLEND = 0.15

/** Smoothstep ease-in-out on 0..1 (clamped). */
export function smoothstep(u: number): number {
  const x = u <= 0 ? 0 : u >= 1 ? 1 : u
  return x * x * (3 - 2 * x)
}

/** Distance-based flight time (Clicky's rule: 800 px/s, clamped to 0.6..1.4 s) for hosts that do not use a fixed hop. */
export function flightDuration(distancePx: number, speedPxPerSecond = 800, minSeconds = 0.6, maxSeconds = 1.4): number {
  return Math.min(Math.max(distancePx / speedPxPerSecond, minSeconds), maxSeconds)
}

/** Where the pointer rests for a target: offset beside it, then clamped `padding` px inside the viewport. */
export function landingPoint(target: Vec2, viewport: { width: number; height: number }, offset: Vec2 = [8, 12], padding = 20): Vec2 {
  return [
    Math.max(padding, Math.min(target[0] + offset[0], viewport.width - padding)),
    Math.max(padding, Math.min(target[1] + offset[1], viewport.height - padding)),
  ]
}

/** Pose at linear progress 0..1 of one flight from `start` to `end`: tip position, heading (continuous, may leave +-180) and scale. */
export function flightPose(start: Vec2, end: Vec2, progress: number): { x: number; y: number; angleDeg: number; scale: number } {
  const linear = progress <= 0 ? 0 : progress >= 1 ? 1 : progress
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const distance = Math.hypot(dx, dy)
  if (linear >= 1 || !(distance > 1e-9)) return { x: end[0], y: end[1], angleDeg: REST_ANGLE_DEG, scale: 1 }

  const eased = linear * linear * (3 - 2 * linear)
  const controlX = (start[0] + end[0]) / 2
  const controlY = (start[1] + end[1]) / 2 - Math.min(distance * ARC_LIFT_FRACTION, ARC_LIFT_MAX)

  const rest = 1 - eased
  const x = rest * rest * start[0] + 2 * rest * eased * controlX + eased * eased * end[0]
  const y = rest * rest * start[1] + 2 * rest * eased * controlY + eased * eased * end[1]

  // tangent -> heading; +90 because the sprite's tip points up at 0 degrees
  const tangentX = 2 * rest * (controlX - start[0]) + 2 * eased * (end[0] - controlX)
  const tangentY = 2 * rest * (controlY - start[1]) + 2 * eased * (end[1] - controlY)
  const heading = (Math.atan2(tangentY, tangentX) * 180) / Math.PI + 90

  // turn out of / back into the rest angle at the two ends, the short way round, so nothing snaps
  const edge = Math.min(linear, 1 - linear)
  const blend = edge >= HEADING_BLEND ? 1 : smoothstep(edge / HEADING_BLEND)
  let turn = (heading - REST_ANGLE_DEG) % 360
  if (turn > 180) turn -= 360
  else if (turn <= -180) turn += 360

  return { x, y, angleDeg: REST_ANGLE_DEG + turn * blend, scale: 1 + Math.sin(linear * Math.PI) * SCALE_PULSE }
}

/** Where the pointer tip is at step time `t`: flying to a cue, perched on its part, drawing an arrow, or docked. */
export function guidePose(cues: readonly GuideCue[], t: number, anchorAt: AnchorAt, dock: Vec2): GuidePose {
  const drawable = Number.isFinite(t) && Number.isFinite(dock[0]) && Number.isFinite(dock[1])

  // the cue the pointer is serving: the last pointer cue that has fired
  let current = -1
  if (drawable) {
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i]!
      if (cue.pointer && cue.fireAt <= t) current = i
    }
  }
  if (current < 0) return rest(dock[0], dock[1], DOCK, DOCK, 1, 'docked', -1, drawable)

  const cue = cues[current]!
  const perch: Vec2 = [0, 0]

  if (t < cue.landAt) {
    const origin: Vec2 = [0, 0]
    const fromId = originOf(cues, current, t, anchorAt, dock, origin)
    const toId = restingPoint(cues, current, t, anchorAt, dock, perch)
    return fly(origin, perch, (t - cue.fireAt) / (cue.landAt - cue.fireAt), fromId, toId, current)
  }

  const perchId = restingPoint(cues, current, t, anchorAt, dock, perch)

  if (cue.dockAt !== null && t >= cue.dockAt) {
    const hop = cue.landAt - cue.fireAt
    const progress = hop > 0 ? (t - cue.dockAt) / hop : 1
    if (progress >= 1 || perchId === DOCK) return rest(dock[0], dock[1], DOCK, DOCK, 1, 'docked', -1, true)
    return fly(perch, dock, progress, perchId, DOCK, current)
  }

  if (cue.arrow && t < cue.drawEnd && perchId !== DOCK) {
    return rest(perch[0], perch[1], cue.arrow[0], cue.arrow[1], strokeProgress(cue, t), 'drawing', current, true)
  }
  return rest(perch[0], perch[1], perchId, perchId, 1, perchId === DOCK ? 'docked' : 'perched', perchId === DOCK ? -1 : current, true)
}

function rest(x: number, y: number, from: string, to: string, progress: number, phase: GuidePose['phase'], cue: number, visible: boolean): GuidePose {
  return { x, y, angleDeg: REST_ANGLE_DEG, scale: 1, visible, from, to, progress, phase, cue }
}

function fly(start: Vec2, end: Vec2, progress: number, from: string, to: string, cue: number): GuidePose {
  const linear = progress <= 0 ? 0 : progress >= 1 ? 1 : progress
  const pose = flightPose(start, end, linear)
  return { x: pose.x, y: pose.y, angleDeg: pose.angleDeg, scale: pose.scale, visible: true, from, to, progress: linear, phase: 'flying', cue }
}

/** Eased 0..1 progress of a cue's draw-on stroke (shared with markProgress so the pen tip stays on the stroke end). */
export function strokeProgress(cue: GuideCue, t: number): number {
  if (t < cue.landAt) return 0
  const length = cue.drawEnd - cue.landAt
  return length > 0 ? smoothstep((t - cue.landAt) / length) : 1
}

/** Index of the pointer cue before `index`, or -1. */
function previousPointer(cues: readonly GuideCue[], index: number): number {
  for (let i = index - 1; i >= 0; i--) if (cues[i]!.pointer) return i
  return -1
}

/**
 * Where the pointer rests once it has reached pointer cue `index`, at the CURRENT anchor positions.
 * A part that cannot be pointed at right now (anchor null) is skipped: the pointer stays where it was.
 * Writes the point into `out` and returns the id of the place.
 */
function restingPoint(cues: readonly GuideCue[], index: number, t: number, anchorAt: AnchorAt, dock: Vec2, out: Vec2): string {
  let i = index
  while (i >= 0) {
    const id = cuePoint(cues[i]!, t, anchorAt, out)
    if (id !== null) return id
    i = previousPointer(cues, i)
    if (i >= 0 && cues[i]!.dockAt !== null) break // it had already gone home before this cue
  }
  out[0] = dock[0]
  out[1] = dock[1]
  return DOCK
}

/** Where the pointer takes off from for pointer cue `index`: the previous perch, or the dock. */
function originOf(cues: readonly GuideCue[], index: number, t: number, anchorAt: AnchorAt, dock: Vec2, out: Vec2): string {
  const previous = previousPointer(cues, index)
  if (previous >= 0 && cues[previous]!.dockAt === null) return restingPoint(cues, previous, t, anchorAt, dock, out)
  out[0] = dock[0]
  out[1] = dock[1]
  return DOCK
}

/** The point a cue puts the pointer on at time t (an arrow glides from its tail to its head while it is drawn), or null. */
function cuePoint(cue: GuideCue, t: number, anchorAt: AnchorAt, out: Vec2): string | null {
  if (cue.arrow) {
    const tail = usable(anchorAt(cue.arrow[0], t))
    const head = usable(anchorAt(cue.arrow[1], t))
    if (tail && head) {
      const along = strokeProgress(cue, t)
      out[0] = tail[0] + (head[0] - tail[0]) * along
      out[1] = tail[1] + (head[1] - tail[1]) * along
      return along >= 1 ? cue.arrow[1] : cue.arrow[0]
    }
    const only = tail ?? head
    if (!only) return null
    out[0] = only[0]
    out[1] = only[1]
    return tail ? cue.arrow[0] : cue.arrow[1]
  }
  const target = cue.targets[0]
  if (target === undefined) return null
  const point = usable(anchorAt(target, t))
  if (!point) return null
  out[0] = point[0]
  out[1] = point[1]
  return target
}

function usable(point: Vec2 | null | undefined): Vec2 | null {
  return point && Number.isFinite(point[0]) && Number.isFinite(point[1]) ? point : null
}
