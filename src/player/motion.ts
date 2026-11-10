// The player's motion primitives (UI design specification 8.1). No DOM at import time.
//
// The contract: every animation is a pure function of a progress value. A channel of the runner holds that value; the
// one draw function turns channel values into transforms and opacities. Two clocks, never mixed: story time (the
// scene, the playhead, the step's name) is evaluated at a time and never tweened; wall time drives the chrome that
// answers the reader, and only chooses progress values.

// ── numbers ────────────────────────────────────────────────────────────────────────────────────────────
export const clamp = (x: number, a = 0, b = 1): number => (x < a ? a : x > b ? b : x)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
/** Where p sits between a and b, clamped to 0..1. The building block of all choreography. */
export const span = (p: number, a: number, b: number): number => clamp((p - a) / (b - a))

// ── easing, by job ─────────────────────────────────────────────────────────────────────────────────────
/** manim's `smooth`: 10t³ − 15t⁴ + 6t⁵. Drawing a line, writing, a carry. */
export const smooth = (t: number): number => { t = clamp(t); return t * t * t * (10 + t * (6 * t - 15)) }
export const sspan = (p: number, a: number, b: number): number => smooth(span(p, a, b))
/** A CSS cubic-bezier as a function of x in 0..1. */
export function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  return (x) => {
    x = clamp(x)
    let t = x
    for (let i = 0; i < 8; i++) {
      const e = ((ax * t + bx) * t + cx) * t - x, d = (3 * ax * t + 2 * bx) * t + cx
      if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break
      t = clamp(t - e / d)
    }
    return ((ay * t + by) * t + cy) * t
  }
}
/** arriving: a few pixels of rise as text comes in. Translate only, never opacity. */
export const enter = bezier(0.05, 0.7, 0.1, 1)
/** leaving, at about 60 percent of the enter time */
export const exit = bezier(0.3, 0, 0.8, 0.15)
/** one place on screen to another: the stage, dots, unrolling lists */
export const move = bezier(0.2, 0, 0, 1)
export const linear = (t: number): number => clamp(t)

/** manim's lagged start: progress of member i of n when the group is at alpha. Lag is applied before easing. */
export const lagged = (alpha: number, i: number, n: number, lag = 0.1): number => clamp(alpha * ((n - 1) * lag + 1) - i * lag)

/** Closed-form spring from x0 with velocity v0 toward xT. w = 2π / period, z = damping ratio. Pure in t. */
export function spring(t: number, x0: number, v0: number, xT: number, w: number, z: number): number {
  const a = xT - x0
  if (z >= 1) return xT - Math.exp(-w * t) * (a + (w * a - v0) * t)
  const wd = w * Math.sqrt(1 - z * z), b = (z * w * a - v0) / wd
  return xT - Math.exp(-z * w * t) * (a * Math.cos(wd * t) + b * Math.sin(wd * t))
}

// ── durations (ms): the names the runner is called with (spec 3, 8) ────────────────────────────────────
export const D = {
  fast: 80, quick: 130, wake: 150, base: 200, swap: 220, note: 380, noteClose: 180, sleep: 400, explore: 420, exploreBack: 300,
  cross: 480, read: 640, readBack: 420, palette: 180, paletteClose: 110, layerPhone: 240, layerPhoneClose: 140, share: 200, shareClose: 120,
  error: 220, errorClose: 120, ask: 200, askClose: 140, play: 160, dot: 160, now: 320, dissolve: 160, reset: 250, dim: 120, undim: 200,
  /** the chrome sleeps this long after the last input while the film plays */
  idle: 2200,
  /** a view mode from a control: explode out and back, ghost, the section sweep, the camera (spec 8.12) */
  explodeOut: 900, explodeBack: 700, ghost: 320, section: 600, camera: 700,
  /** a jump inside a chapter runs the story to the new moment; further away it is a cut (spec 8.9) */
  warp: 440, warpStep: 60, warpBase: 260, held: 180,
} as const
/** a jump shorter than this many seconds of story, inside one chapter, is a time-warp */
export const WARP_MAX_SECONDS = 24

// ── the wall clock ─────────────────────────────────────────────────────────────────────────────────────
interface Channel { v: number; from: number; to: number; t0: number; dur: number; vel: number; v0?: number; ease?: (t: number) => number; done?: (() => void) | null; turn?: boolean }
export interface RunOpts { from?: number; ease?: (t: number) => number; done?: () => void; delay?: number; /** take the whole duration whatever the distance left */ full?: boolean; /** reversed while moving: turn round on a spring instead of flipping */ turn?: boolean }
export interface Runner {
  readonly reduced: boolean
  value(key: string, d?: number): number
  /** where a channel is going: what geometry jumps to under reduced motion */
  target(key: string, d?: number): number
  moving(key: string): boolean
  set(key: string, v: number, target?: number): Runner
  to(key: string, to: number, dur: number, o?: RunOpts): Runner
  busy(): boolean
  keepAlive(fn: () => boolean): Runner
  kick(): Runner
  stop(): void
}
/** the spring an interrupted channel rides: period 450 ms, no bounce */
const TURN_W = (2 * Math.PI) / 0.45
/**
 * Named channels hold a progress value; `to` retargets a channel from wherever it is, so an exit is the entrance run
 * backwards (its time scales with the distance left). A channel that is still moving the other way when it is
 * retargeted (and asks for `turn`) is carried on a critically damped spring that starts with the velocity it had.
 * `frame(dt, now)` is called once per animation frame while anything is live.
 */
export function createRunner(frame: (dt: number, now: number) => void, o: { reduced?: boolean } = {}): Runner {
  const ch = new Map<string, Channel>()
  let raf = 0, last = 0, alive: () => boolean = () => false, stopped = false
  const now = (): number => performance.now()
  const finish = (c: Channel): void => { c.dur = 0; c.v = c.to; c.vel = 0; c.turn = false; const done = c.done; c.done = null; if (done) done() }
  const tick = (t: number): void => {
    raf = 0
    if (stopped) return
    const dt = Math.min(0.05, Math.max(0, (t - last) / 1000))
    last = t
    let live = false
    for (const c of ch.values()) {
      if (c.dur <= 0) continue
      const before = c.v
      if (c.turn) {
        const s = Math.max(0, (t - c.t0) / 1000)
        c.v = spring(s, c.from, c.v0 ?? 0, c.to, TURN_W, 1)
        c.vel = dt > 0 ? (c.v - before) / dt : c.v0 ?? 0
        if (s > 0.06 && Math.abs(c.v - c.to) < 0.0015 && Math.abs(c.vel) < 0.05) finish(c); else live = true
      } else {
        const p = clamp((t - c.t0) / c.dur)
        c.v = lerp(c.from, c.to, c.ease ? c.ease(p) : p)
        c.vel = dt > 0 ? (c.v - before) / dt : 0
        if (p >= 1) finish(c); else live = true
      }
    }
    frame(dt, t)
    for (const c of ch.values()) if (c.dur > 0) live = true // a done() may have started another
    if (live || alive()) raf = requestAnimationFrame(tick)
  }
  const api: Runner = {
    reduced: !!o.reduced,
    value: (key, d = 0) => ch.get(key)?.v ?? d,
    target: (key, d = 0) => ch.get(key)?.to ?? d,
    moving: (key) => (ch.get(key)?.dur ?? 0) > 0,
    set(key, v, target = v) { ch.set(key, { v, from: v, to: target, t0: 0, dur: 0, vel: 0 }); return api },
    to(key, to, dur, { from, ease, done, delay = 0, full = false, turn = false } = {}) {
      const cur = ch.get(key), v0 = from ?? cur?.v ?? 0, dist = Math.abs(to - v0)
      const d = full ? dur : dur * Math.min(1, dist)
      if (d <= 0 || dist < 1e-6) { ch.set(key, { v: to, from: to, to, t0: 0, dur: 0, vel: 0 }); if (done) done(); api.kick(); return api }
      if (turn && from === undefined && cur && cur.dur > 0 && Math.abs(cur.vel || 0) > 0.05 && Math.sign(cur.vel) !== Math.sign(to - v0)) ch.set(key, { v: v0, from: v0, v0: cur.vel, vel: cur.vel, to, t0: now(), dur: 1, turn: true, done })
      else ch.set(key, { v: v0, from: v0, to, t0: now() + delay, dur: d, ease, done, vel: 0 })
      api.kick()
      return api
    },
    busy() { for (const c of ch.values()) if (c.dur > 0) return true; return false },
    keepAlive(fn) { alive = fn; return api },
    kick() { if (!raf && !stopped && typeof requestAnimationFrame !== 'undefined') { last = now(); raf = requestAnimationFrame(tick) } return api },
    stop() { stopped = true; if (raf) cancelAnimationFrame(raf); raf = 0 },
  }
  return api
}

// ── DOM: transform and opacity only ────────────────────────────────────────────────────────────────────
type Marked = HTMLElement & { _o?: number; _gone?: boolean; _t?: string; _w?: string; _reach?: boolean; _s?: string }
/**
 * Set opacity, and take the element out of hit-testing and the tab order when it is gone. A shown element inherits
 * visibility: it never writes `visible`, which would let a child of a hidden parent stay reachable while invisible.
 */
export function fade(el: HTMLElement | SVGElement, o: number): void {
  const m = el as Marked
  o = clamp(o)
  if (m._o === o) return
  m._o = o
  m.style.opacity = String(Math.round(o * 1000) / 1000)
  const gone = o < 0.01
  if (m._gone !== gone) { m._gone = gone; m.style.visibility = gone ? 'hidden' : '' }
}
/** Take elements out of (or back into) reach of pointer, keyboard and assistive technology. */
export function reach(els: readonly (HTMLElement | null)[], on: boolean): void {
  for (const el of els) { const m = el as Marked | null; if (m && m._reach !== on) { m._reach = on; m.inert = !on } }
}
export function place(el: HTMLElement | SVGElement, x: number, y: number, extra = ''): void {
  const m = el as Marked, t = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0)${extra}`
  if (m._t !== t) { m._t = t; m.style.transform = t }
}
/**
 * A wipe with a crisp edge and no clip-path: `clip` (overflow hidden) slides one way while its only child slides the
 * other, so the content stays put and the window passes over it. `from` is the edge the reveal starts at.
 */
export function wipe(clip: HTMLElement, p: number, from: 'left' | 'right' | 'top' | 'bottom' = 'left'): void {
  const m = clip as Marked
  const k = (1 - clamp(p)) * 100, inner = clip.firstElementChild as HTMLElement | null, s = from === 'left' || from === 'top' ? -1 : 1, ax = from === 'left' || from === 'right' ? 'X' : 'Y'
  const a = `translate${ax}(${(s * k).toFixed(3)}%)`, b = `translate${ax}(${(-s * k).toFixed(3)}%)`
  if (m._w !== a) { m._w = a; clip.style.transform = a; if (inner) inner.style.transform = b }
}
export function setText(el: Element, text: string): void {
  const m = el as unknown as Marked
  if (m._s !== text) { m._s = text; el.textContent = text }
}

// ── ink: linework on one canvas, each drawn from the end it is attached to ──────────────────────────────
export const ink = {
  /** A polyline drawn on from its first point, up to fraction p of its length. */
  line(ctx: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[], p = 1): void {
    p = clamp(p)
    if (p <= 0 || pts.length < 2) return
    let total = 0
    const seg: number[] = []
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]); seg.push(l); total += l }
    let left = total * p
    ctx.beginPath()
    ctx.moveTo(pts[0]![0], pts[0]![1])
    for (let i = 1; i < pts.length && left > 0; i++) {
      const l = seg[i - 1]!, k = l <= left ? 1 : left / l
      ctx.lineTo(lerp(pts[i - 1]![0], pts[i]![0], k), lerp(pts[i - 1]![1], pts[i]![1], k))
      left -= l
    }
    ctx.stroke()
  },
  /** A ring drawn once round, starting at 12 o'clock. */
  ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, p = 1, from = -90): void {
    p = clamp(p)
    if (p <= 0) return
    ctx.beginPath()
    ctx.arc(x, y, r, (from * Math.PI) / 180, ((from + 360 * p) * Math.PI) / 180)
    ctx.stroke()
  },
}

// ── small formatting ───────────────────────────────────────────────────────────────────────────────────
/** 0:46 from seconds. Minutes are never zero-padded. */
export const clock = (s: number): string => { s = Math.max(0, Math.floor(s + 1e-6)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') }
/** True when the reader asked for less motion (`rm` in the page's query overrides: 1 = reduced, 0 = full). */
export function prefersReduced(query?: URLSearchParams | null): boolean {
  const q = query ? query.get('rm') : null
  return q === '1' || (q !== '0' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
}
