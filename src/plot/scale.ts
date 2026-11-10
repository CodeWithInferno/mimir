// Pure maths of plots: scales (linear, log), automatic ticks, number formatting, polyline clipping. No DOM, no state.

/** A data range mapped onto 0..1 (linear, or log base 10). */
export interface Scale {
  min: number
  max: number
  log: boolean
  /** data value → 0..1 along the axis (NaN for a value a log scale cannot show) */
  at(v: number): number
  /** 0..1 along the axis → data value */
  inv(u: number): number
}

/** [min, max] → a scale. A range that is empty or not finite becomes [min, min + 1]; a log scale needs min > 0 (else linear). */
export function makeScale(range: readonly number[] | undefined, log = false): Scale {
  let min = Number.isFinite(range?.[0]) ? (range![0] as number) : 0
  let max = Number.isFinite(range?.[1]) ? (range![1] as number) : min + 1
  if (max < min) [min, max] = [max, min]
  if (max === min) max = min + 1
  if (log && min > 0) {
    const a = Math.log10(min), b = Math.log10(max)
    return { min, max, log: true, at: (v) => (v > 0 ? (Math.log10(v) - a) / (b - a) : NaN), inv: (u) => 10 ** (a + (b - a) * u) }
  }
  return { min, max, log: false, at: (v) => (v - min) / (max - min), inv: (u) => min + (max - min) * u }
}

const DECIMAL_STEPS = [1, 2, 5, 10]
/** steps that read well on an axis of degrees: quarter and half turns instead of 200 or 500 */
const DEGREE_STEPS = [1, 2, 5, 10, 15, 30, 45, 90, 180, 360]

/** The smallest "round" step (1, 2 or 5 × 10ⁿ; for degrees 15, 30, 45, 90, 180, 360 …) that gives at most `target` intervals over `span`. */
export function niceStep(span: number, target: number, degrees = false): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1
  const raw = span / Math.max(1, target)
  if (degrees && raw > 1) {
    for (const s of DEGREE_STEPS) if (s >= raw - 1e-9) return s
    return 360 * niceStep(span / 360, target)
  }
  const p = 10 ** Math.floor(Math.log10(raw))
  const f = raw / p
  for (const s of DECIMAL_STEPS) if (s >= f - 1e-9) return s * p
  return 10 * p
}

/** Decimals needed to write multiples of `step` exactly (0.25 → 2, 5 → 0), at most 6. */
export function decimalsFor(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 0
  for (let d = 0; d <= 6; d++) if (Math.abs(step * 10 ** d - Math.round(step * 10 ** d)) < 1e-7 * 10 ** d) return d
  return 6
}

/** Multiples of `step` inside [min, max] (ends included, with a tolerance for float noise). At most `limit` values. */
export function linearTicks(min: number, max: number, step: number, limit = 200): number[] {
  if (!(step > 0) || !Number.isFinite(step) || !(max >= min)) return []
  const eps = step * 1e-6
  const d = decimalsFor(step)
  const out: number[] = []
  for (let i = Math.ceil((min - eps) / step); i * step <= max + eps && out.length < limit; i++) out.push(Number((i * step).toFixed(Math.min(12, d + 6))) + 0)
  return out
}

/** Ticks of a log axis: the powers of ten in range; with fewer than two of them, 1-2-5 multiples as well. */
export function logTicks(min: number, max: number): number[] {
  if (!(min > 0) || !(max > min)) return []
  const lo = Math.ceil(Math.log10(min) - 1e-9), hi = Math.floor(Math.log10(max) + 1e-9)
  const out: number[] = []
  for (let e = lo; e <= hi && out.length < 40; e++) out.push(10 ** e)
  if (out.length >= 2) return out
  const all: number[] = []
  for (let e = lo - 1; e <= hi + 1; e++) for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v >= min * (1 - 1e-9) && v <= max * (1 + 1e-9)) all.push(v) }
  return all
}

/** the minus sign of typeset numbers (U+2212), not a hyphen */
export const MINUS = '−'
/** a thin space (U+2009): what separates a value from its unit */
export const THIN_SPACE = ' '

/** A number with a fixed count of decimals, a real minus sign, and never "−0". */
export function formatNumber(v: number, decimals = 0): string {
  if (typeof v !== 'number' || Number.isNaN(v)) return '–'
  if (!Number.isFinite(v)) return v > 0 ? '∞' : MINUS + '∞'
  const d = Math.min(12, Math.max(0, Math.round(decimals)))
  const s = Math.abs(v).toFixed(d)
  return (v < 0 && Number(s) !== 0 ? MINUS : '') + s
}

/** A tick value written as short as it can be: as many decimals as the value needs (at most 6); very large or small magnitudes as 1e6. */
export function formatTick(v: number, decimals?: number): string {
  if (!Number.isFinite(v)) return formatNumber(v)
  const a = Math.abs(v)
  if (a !== 0 && (a >= 1e6 || a < 1e-4)) return v.toExponential(2).replace(/\.?0+e/, 'e').replace('e+', 'e').replace('-', MINUS)
  return formatNumber(v, decimals ?? decimalsFor(a))
}

/** value + unit: "381°", "92%", "1.5 V" (a thin space before every unit that is not a degree, prime or percent sign). */
export function withUnit(text: string, unit: string | undefined | null): string {
  if (!unit) return text
  return /^[°%′″]/.test(unit) ? text + unit : text + THIN_SPACE + unit
}

/** Rectangle by its edges. */
export interface Edges { x0: number; y0: number; x1: number; y1: number }

/**
 * Cut a polyline (flat [x, y, x, y …]; a NaN coordinate ends a piece) to a rectangle. Returns the pieces that lie
 * inside, each with at least two points: segments are cut exactly on the edge (Liang–Barsky), never drawn outside.
 */
export function clipPolyline(pts: readonly number[], r: Edges): number[][] {
  const out: number[][] = []
  let cur: number[] = []
  const flush = (): void => { if (cur.length >= 4) out.push(cur); cur = [] }
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i]!, ay = pts[i + 1]!, bx = pts[i + 2]!, by = pts[i + 3]!
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) { flush(); continue }
    const dx = bx - ax, dy = by - ay
    let t0 = 0, t1 = 1
    let inside = true
    const edge = (p: number, q: number): void => {
      if (!inside) return
      if (p === 0) { if (q < 0) inside = false; return }
      const t = q / p
      if (p < 0) { if (t > t1) inside = false; else if (t > t0) t0 = t } else { if (t < t0) inside = false; else if (t < t1) t1 = t }
    }
    edge(-dx, ax - r.x0); edge(dx, r.x1 - ax); edge(-dy, ay - r.y0); edge(dy, r.y1 - ay)
    if (!inside) { flush(); continue }
    const sx = ax + dx * t0, sy = ay + dy * t0, ex = ax + dx * t1, ey = ay + dy * t1
    // a piece continues only when this segment starts where the last one ended (it was not cut at its start)
    if (cur.length && t0 === 0) cur.push(ex, ey)
    else { flush(); cur = [sx, sy, ex, ey] }
    if (t1 < 1) flush()
  }
  flush()
  return out
}

/** Length of a flat polyline. */
export function polylineLength(pts: readonly number[]): number {
  let l = 0
  for (let i = 0; i + 3 < pts.length; i += 2) l += Math.hypot(pts[i + 2]! - pts[i]!, pts[i + 3]! - pts[i + 1]!)
  return l
}

/** The first `length` units of a flat polyline (the whole of it when it is shorter). */
export function trimPolyline(pts: readonly number[], length: number): number[] {
  const out: number[] = []
  if (pts.length < 2 || !(length > 0)) return out
  out.push(pts[0]!, pts[1]!)
  let left = length
  for (let i = 0; i + 3 < pts.length && left > 0; i += 2) {
    const d = Math.hypot(pts[i + 2]! - pts[i]!, pts[i + 3]! - pts[i + 1]!)
    if (d <= left) { out.push(pts[i + 2]!, pts[i + 3]!); left -= d; continue }
    const u = d > 0 ? left / d : 0
    out.push(pts[i]! + (pts[i + 2]! - pts[i]!) * u, pts[i + 1]! + (pts[i + 3]! - pts[i + 1]!) * u)
    break
  }
  return out
}
