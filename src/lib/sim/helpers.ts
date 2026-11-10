/** Small numeric helpers for scene maths: lerp, clamp, remap and sampled trails. All pure. */
import { countOr, finiteOr, positiveOr } from './internal.ts'

/** Linear interpolation between two numbers, or two equal-length vectors: `a` at u = 0, `b` at u = 1 (u is not clamped). */
export function lerp(a: number, b: number, u: number): number
export function lerp<V extends number[]>(a: V, b: V, u: number): V
export function lerp(a: number | number[], b: number | number[], u: number): number | number[] {
  if (typeof a === 'number' || typeof b === 'number') return (a as number) + ((b as number) - (a as number)) * u
  const out = new Array<number>(a.length)
  for (let k = 0; k < a.length; k++) out[k] = a[k]! + ((b[k] ?? a[k]!) - a[k]!) * u
  return out
}

/** Limits `x` to the range [min, max] (the bounds may be given in either order). */
export function clamp(x: number, min = 0, max = 1): number {
  const low = min <= max ? min : max
  const high = min <= max ? max : min
  return x < low ? low : x > high ? high : x
}

/** Maps `x` from the range [inMin, inMax] to [outMin, outMax]; pass `clamped` to stop at the output range. */
export function remap(x: number, inMin: number, inMax: number, outMin: number, outMax: number, clamped = false): number {
  if (inMax === inMin) return outMin
  const u = (x - inMin) / (inMax - inMin)
  return outMin + (outMax - outMin) * (clamped ? clamp(u, 0, 1) : u)
}

/** Options of `trail()`. */
export interface TrailOptions {
  /** Time the trail starts at (default 0). */
  from?: number
  /** Time the trail ends at, usually the current time. */
  to: number
  /** Number of points, evenly spaced from `from` to `to` inclusive (default 64). */
  samples?: number
  /** Alternative to `samples`: one point every this many seconds on a fixed grid, plus both ends; the points then stay put while `to` grows. */
  every?: number
}

const MAX_TRAIL_POINTS = 20_000

/** Samples a moving point `fn(t)` between two times and returns the points it passed through (a polyline). */
export function trail<P extends number[]>(fn: (t: number) => P, options: TrailOptions): P[] {
  const to = finiteOr(options?.to, 0)
  const from = finiteOr(options?.from, 0)
  const points: P[] = []
  const add = (t: number): void => {
    const point = fn(t)
    points.push(Array.isArray(point) ? (point.slice() as P) : point)
  }
  const spacing = options?.every === undefined ? 0 : positiveOr(options.every, 0)
  if (spacing > 0) {
    const low = Math.min(from, to)
    const high = Math.max(from, to)
    // Too many points: widen the grid by a whole factor, so the points still sit on fixed times.
    const every = spacing * Math.max(1, Math.ceil((high - low) / spacing / MAX_TRAIL_POINTS))
    const times: number[] = [low]
    const tolerance = every * 1e-9
    for (let index = Math.floor(low / every) + 1; index * every < high - tolerance; index++) {
      if (index * every > low + tolerance) times.push(index * every)
    }
    if (high > low) times.push(high)
    if (to < from) times.reverse()
    for (const t of times) add(t)
    return points
  }
  const count = Math.min(countOr(options?.samples, 64), MAX_TRAIL_POINTS)
  if (count === 1 || to === from) {
    add(to)
    return points
  }
  for (let i = 0; i < count; i++) add(from + ((to - from) * i) / (count - 1))
  return points
}
