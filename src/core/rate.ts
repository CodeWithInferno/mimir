// Rate functions, transcribed from 3b1b/manim manimlib/utils/rate_functions.py (MIT; see THIRD_PARTY_NOTICES.md).
// Every function maps t in [0,1] to progress. Verified against the python reference in tests/unit/core.

import { closeConfigGroup, liveConfig } from './config.ts'
import { ctx } from './context.ts'

export type RateFn = (t: number) => number

const choose = (n: number, k: number): number => {
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return r
}
/** Bernstein form for scalar control values: bezier([0, 0, 1, 1]) is a rate function. */
export const bezier = (pts: readonly number[]): RateFn => {
  if (!Array.isArray(pts) || !pts.length || !pts.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    // D9: never throw on bad input; a rate that cannot be built is the straight line
    ctx.model?.diagnostics.add({ code: 'API-TYPE', what: `bezier() expects a list of control values (numbers), got ${Array.isArray(pts) ? 'a list that is empty or holds something else' : pts === null ? 'null' : typeof pts}.`, fix: ['bezier([0, 0, 1, 1])'] })
    return (t) => t
  }
  const n = pts.length - 1
  return (t) => {
    let sum = 0
    for (let k = 0; k <= n; k++) sum += (1 - t) ** (n - k) * t ** k * choose(n, k) * pts[k]!
    return sum
  }
}
const c01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t)

export const linear: RateFn = (t) => t
/** 10t³ − 15t⁴ + 6t⁵: zero velocity and acceleration at both ends. The default easing. */
export const smooth: RateFn = (t) => {
  const s = 1 - t
  return t * t * t * (10 * s * s + 5 * s * t + t * t)
}
/** slow start, ends at full speed */
export const rushInto: RateFn = (t) => 2 * smooth(0.5 * t)
/** starts at full speed, eases to rest */
export const rushFrom: RateFn = (t) => 2 * smooth(0.5 * (t + 1)) - 1
/** quarter circle: infinite slope at 0, flat at 1 */
export const slowInto: RateFn = (t) => Math.sqrt(1 - (1 - t) * (1 - t))
/** two smooth steps back to back (rests at 0.5 in the middle) */
export const doubleSmooth: RateFn = (t) => (t < 0.5 ? 0.5 * smooth(2 * t) : 0.5 * (1 + smooth(2 * t - 1)))
/** 0 → 1 → 0, a pulse */
export const thereAndBack: RateFn = (t) => smooth(t < 0.5 ? 2 * t : 2 * (1 - t))
/** up, hold at 1 for pauseRatio of the time, down */
export const thereAndBackWithPause = (t: number, pauseRatio = 1 / 3): number => {
  const a = 2 / (1 - pauseRatio)
  if (t < 0.5 - pauseRatio / 2) return smooth(a * t)
  if (t < 0.5 + pauseRatio / 2) return 1
  return smooth(a - a * t)
}
/** backs up first (min −0.1848 at t = 0.290), then goes */
export const runningStart = (t: number, pull = -0.5): number => {
  const s = 1 - t
  return 15 * t ** 2 * s ** 4 * pull + 20 * t ** 3 * s ** 3 * pull + 15 * t ** 4 * s ** 2 + 6 * t ** 5 * s + t ** 6
}
/** passes the target (max 1.2058 at t = 0.634) and settles back */
export const overshoot = (t: number, pull = 1.5): number => {
  const s = 1 - t
  return 10 * s ** 3 * t ** 2 * pull + 10 * s ** 2 * t ** 3 * pull + 5 * s * t ** 4 + t ** 5
}
/** returns a NEW rate function that stops at `proportion` */
export const notQuiteThere = (f: RateFn = smooth, proportion = 0.7): RateFn => (t) => proportion * f(t)
/** there-and-back envelope times a sine; ends at 0 */
export const wiggle = (t: number, wiggles = 2): number => thereAndBack(t) * Math.sin(wiggles * Math.PI * t)
/** run f only inside [a, b] of the time; hold before and after */
export const squish = (f: RateFn, a = 0.4, b = 0.6): RateFn => (t) => {
  if (a === b) return a // (sic) manim returns a; kept for parity
  if (t < a) return f(0)
  if (t > b) return f(1)
  return f((t - a) / (b - a))
}
/** linear to 1 by t = 0.8, then holds */
export const lingering: RateFn = (t) => squish(linear, 0, 0.8)(t)
/** 1 − e^(−t / halfLife). f(1) = 0.99995, not 1 */
export const exponentialDecay = (t: number, halfLife = 0.1): number => 1 - Math.exp(-t / halfLife)

// ── timing helpers that are part of the grammar ───────────────────────────────────────────────────────
/** stagger inside one animation: progress of part `index` of `n` at overall `alpha` */
export const subAlpha = (alpha: number, index: number, n: number, lag: number, rate: RateFn = smooth): number =>
  rate(c01(alpha * ((n - 1) * lag + 1) - index * lag))
/** a member that only occupies [t0, t1] seconds of a play of `runTime` seconds */
export const spanAlpha = (alpha: number, runTime: number, t0: number, t1: number): number => c01((alpha * runTime - t0) / (t1 - t0))
/** LaggedStart start/end times: the next member starts lag × (previous duration) later */
export const laggedTimings = (runTimes: readonly number[], lag: number): [number, number][] => {
  let c = 0
  return runTimes.map((rt) => {
    const s: [number, number] = [c, c + rt]
    c += lag * rt
    return s
  })
}

/** canonical (camelCase) names */
export const RATES = {
  linear, smooth, rushInto, rushFrom, slowInto, doubleSmooth, thereAndBack, thereAndBackWithPause,
  runningStart, overshoot, wiggle, lingering, exponentialDecay,
}
/** manim's snake_case spellings, accepted silently */
export const RATE_ALIASES = {
  rush_into: rushInto, rush_from: rushFrom, slow_into: slowInto, double_smooth: doubleSmooth,
  there_and_back: thereAndBack, there_and_back_with_pause: thereAndBackWithPause, running_start: runningStart,
  not_quite_there: notQuiteThere, squish_rate_func: squish, exponential_decay: exponentialDecay,
}

/**
 * Pacing defaults in seconds, read through the config store: `PACE.play` is the scene's 'pace.play' (scene({ defaults }),
 * s.config(), mimir.config.json), else the default below. The durations follow manim's (play 1 s, camera 2 s, lag 0.1).
 */
export const PACE = liveConfig('pace', {
  /** appear, disappear, draw on, grow */
  enter: 1,
  /** write a short text */
  write: 1,
  /** write a text of 15 glyphs or more */
  writeLong: 2,
  /** turn one object into another */
  transform: 1,
  /** one play: m.to.…, param.to(v) */
  play: 1,
  /** a step whose only content is a parameter sweep (st.set) lasts this long */
  sweep: 3,
  /** a step with a parameter sweep lasts at least this long, whatever else it plays */
  sweepMin: 2,
  /** a camera move (st.camera, st.zoom) */
  camera: 2,
  /** st.wait() without a number */
  wait: 1,
  /** every step ends on a hold of this length */
  hold: 1,
  /** stagger of lagged(): the next member starts this share of the previous one's duration later */
  lag: 0.1,
  /** a step that records nothing still lasts this long (before its hold) */
  empty: 1,
  /** a scene without steps plays for this long */
  still: 4,
  /** step-scoped marks (focus, labels) fade in over this long */
  scopedIn: 0.4,
  /** step-scoped marks clear over this long at the start of the next step */
  scopedOut: 0.4,
  /** when a chapter opens, one object takes this long to leave */
  chapterFade: 0.5,
  /** when a chapter opens, the whole clear (lagged fades, camera reset) takes this long */
  chapterClear: 0.8,
  /** live viewer: after a camera drag, the story's camera takes over again over this long */
  handoff: 0.8,
}, { min: 0 })
closeConfigGroup('pace')
