/**
 * Rectangle helpers. A Rect is { x, y, width, height } with x,y at the MIN corner, so every helper works the
 * same in frame space (y up) and in screen space (y down). Nothing here allocates more than its result.
 */
import type { Rect, Vec2 } from '../types.ts'

/** Width and height of something that is about to be placed. */
export interface Size { width: number; height: number }

/** Rect of the given size centred on (cx, cy). */
export function rectFromCenter(cx: number, cy: number, width: number, height: number): Rect {
  return { x: cx - width / 2, y: cy - height / 2, width, height }
}

/** Centre point of a rect. */
export function rectCenter(r: Rect): Vec2 {
  return [r.x + r.width / 2, r.y + r.height / 2]
}

/** Smallest rect holding every point; a zero rect at the origin for an empty list. */
export function rectFromPoints(points: readonly Vec2[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of points) {
    if (p[0] < x0) x0 = p[0]
    if (p[0] > x1) x1 = p[0]
    if (p[1] < y0) y0 = p[1]
    if (p[1] > y1) y1 = p[1]
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** True when the two rects overlap by more than `margin` (touching edges do not count; a negative margin
 *  makes rects closer than |margin| count as overlapping). */
export function rectIntersects(a: Rect, b: Rect, margin = 0): boolean {
  return a.x + a.width - margin > b.x && b.x + b.width - margin > a.x
    && a.y + a.height - margin > b.y && b.y + b.height - margin > a.y
}

/** The overlapping region of two rects, or null when they do not overlap. */
export function rectIntersection(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.width, b.x + b.width), y1 = Math.min(a.y + a.height, b.y + b.height)
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** Smallest rect that holds every given rect; a zero rect at the origin when called with none. */
export function rectUnion(...rects: Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const r of rects) {
    if (r.x < x0) x0 = r.x
    if (r.y < y0) y0 = r.y
    if (r.x + r.width > x1) x1 = r.x + r.width
    if (r.y + r.height > y1) y1 = r.y + r.height
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** Rect shrunk by `dx` on the left and right and `dy` (default dx) on the top and bottom; negative values
 *  grow it. The size never goes below zero and the centre never moves. */
export function rectInset(r: Rect, dx: number, dy: number = dx): Rect {
  const width = Math.max(0, r.width - 2 * dx), height = Math.max(0, r.height - 2 * dy)
  return { x: r.x + (r.width - width) / 2, y: r.y + (r.height - height) / 2, width, height }
}

/** True when `inner` (a rect or a point) lies completely inside `outer`, edges included, with `tolerance` slack. */
export function rectContains(outer: Rect, inner: Rect | Vec2, tolerance = 0): boolean {
  if (Array.isArray(inner)) {
    return inner[0] >= outer.x - tolerance && inner[0] <= outer.x + outer.width + tolerance
      && inner[1] >= outer.y - tolerance && inner[1] <= outer.y + outer.height + tolerance
  }
  const r = inner as Rect
  return r.x >= outer.x - tolerance && r.x + r.width <= outer.x + outer.width + tolerance
    && r.y >= outer.y - tolerance && r.y + r.height <= outer.y + outer.height + tolerance
}

/** Shortest distance between two rects, or between a rect and a point; 0 when they touch or overlap. */
export function rectDistance(a: Rect, b: Rect | Vec2): number {
  let dx: number, dy: number
  if (Array.isArray(b)) {
    dx = Math.max(a.x - b[0], 0, b[0] - (a.x + a.width))
    dy = Math.max(a.y - b[1], 0, b[1] - (a.y + a.height))
  } else {
    const r = b as Rect
    dx = Math.max(a.x - (r.x + r.width), 0, r.x - (a.x + a.width))
    dy = Math.max(a.y - (r.y + r.height), 0, r.y - (a.y + a.height))
  }
  return Math.sqrt(dx * dx + dy * dy)
}

/** Area of a rect. */
export function rectArea(r: Rect): number {
  return r.width * r.height
}

/** True when the segment a-b touches the rect (used for "does this line run through that box"). */
export function segmentIntersectsRect(a: Vec2, b: Vec2, r: Rect): boolean {
  return segmentHitsBox(a[0], a[1], b[0], b[1], r.x, r.y, r.x + r.width, r.y + r.height)
}

/** True when segments a-b and c-d cross at a point strictly inside both (shared endpoints do not count). */
export function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  return segmentsCrossXY(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1])
}

/** Scalar form of segmentIntersectsRect (Liang-Barsky clip); no allocation. */
export function segmentHitsBox(
  ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number,
): boolean {
  let t0 = 0, t1 = 1
  const dx = bx - ax, dy = by - ay
  if (dx === 0) { if (ax < x0 || ax > x1) return false } else {
    let ta = (x0 - ax) / dx, tb = (x1 - ax) / dx
    if (ta > tb) { const s = ta; ta = tb; tb = s }
    if (ta > t0) t0 = ta
    if (tb < t1) t1 = tb
    if (t0 > t1) return false
  }
  if (dy === 0) { if (ay < y0 || ay > y1) return false } else {
    let ta = (y0 - ay) / dy, tb = (y1 - ay) / dy
    if (ta > tb) { const s = ta; ta = tb; tb = s }
    if (ta > t0) t0 = ta
    if (tb < t1) t1 = tb
    if (t0 > t1) return false
  }
  return true
}

/** Scalar form of segmentsCross; no allocation. */
export function segmentsCrossXY(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx)
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx)
  if ((d1 > 0) === (d2 > 0) || d1 === 0 || d2 === 0) return false
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax)
  return (d3 > 0) !== (d4 > 0) && d3 !== 0 && d4 !== 0
}
