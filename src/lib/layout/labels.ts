/**
 * placeLabels(): puts one label next to each anchored part and draws a straight leader to it.
 *
 * Every label gets a small set of candidate spots: flush beside its part on the right or left (sliding up
 * and down in whole label steps, which is what makes neat columns), or above / below it (sliding sideways).
 * Each spot has a cost: leader length, covering an obstacle or another part, pointing back across the
 * subject. Labels are then placed in priority order, each taking its cheapest spot that does not overlap a
 * placed label and whose leader crosses nothing; a repair pass re-places labels that had to compromise and
 * swaps pairs whose leaders cross. A label with no free spot searches the whole bounds on a grid.
 *
 * Stability: pass the previous result as `previous`. A label then stays exactly where it was for as long
 * as that spot is still legal and not much worse than the best one, and prefers its old side after that.
 * Units are the caller's (pixels or frame units): every default scales with the label height.
 */
import type { Rect, Vec2 } from '../types.ts'
import { type Size, segmentHitsBox, segmentsCrossXY } from './rect.ts'

/** Side of the anchor the label sits on. */
export type LabelSide = 'left' | 'right' | 'top' | 'bottom'

/** A point to label. `avoid` is the box of the part itself: the label is kept outside it. */
export interface LabelAnchor { id: string; x: number; y: number; avoid?: Rect }

/** A placed label: its centre, the side it sits on and the leader from the anchor to the label's edge. */
export interface PlacedLabel { id: string; x: number; y: number; side: LabelSide; leader: [Vec2, Vec2] }

/** Input of placeLabels. */
export interface PlaceLabelsInput {
  anchors: readonly LabelAnchor[]
  /** Label size per anchor id. */
  sizes: Record<string, Size>
  /** Boxes labels should stay off (other content, panels, captions). */
  obstacles?: readonly Rect[]
  /** Box every label must stay inside (the safe area). */
  bounds: Rect
  /** Ids in priority order: earlier labels get the better spots. Labels not listed follow, the ones nearest
   *  the middle of the subject first (which lets the outer labels fan outwards around them). */
  order?: readonly string[]
  /** An earlier result for the same labels, used as a hint so labels stay put while their parts move. */
  previous?: readonly { id: string; x: number; y: number; side?: LabelSide }[]
  /** Space between a part and its label (default 0.6 x the mean label height). */
  gap?: number
  /** Minimum space between two labels (default 0.25 x the mean label height). */
  labelGap?: number
  /** True in screen space, where y grows downwards: 'top' then means smaller y (default false). */
  yDown?: boolean
}

// Sides as numbers while solving. UP means larger y; it is named 'top' or 'bottom' on the way out.
const RIGHT = 0, LEFT = 1, UP = 2, DOWN = 3

// Candidate slides, in label steps: beside the part (vertical slide) and above / below it (sideways slide).
const SIDE_SLIDES = [0, 1, -1, 2, -2, 3, -3]
const END_SLIDES = [0, 1, -1, 2, -2]
// Slides that also get a "pushed out" twin: moved outwards until the label is off every obstacle and part.
const PUSHED_SLIDES = 3
const MAX_CANDIDATES = 2 * SIDE_SLIDES.length + 2 * END_SLIDES.length + 4 * PUSHED_SLIDES + 1

// Costs, in label heights.
const COST_END = 0.5              // sitting above or below instead of beside
const COST_INWARD = 2             // pointing back across the subject instead of away from it
const COST_OBSTACLE = 2           // touching an obstacle, plus COST_OBSTACLE_AREA x the covered fraction
const COST_OBSTACLE_AREA = 6
const COST_PART = 2                // touching another labelled part, plus COST_PART_AREA x the covered fraction
const COST_PART_AREA = 4
const COST_DOT = 6                // covering another anchor's dot
const COST_CROSSING = 10          // leader crossing another leader
const COST_THROUGH = 6            // leader running through another label
const COST_FALLBACK = 1           // a grid spot instead of a regular one
const STAY_FACTOR = 0.5           // the previous spot costs half ...
const STAY_BONUS = 1              // ... minus this
const SAME_SIDE_BONUS = 3         // any spot on the previous side

/** Places a label beside every anchor: outside its part, inside the bounds, no two labels overlapping,
 *  leaders short and uncrossed wherever the space allows. Returns one entry per anchor, in input order. */
export function placeLabels(input: PlaceLabelsInput): PlacedLabel[] {
  const anchors = input.anchors ?? []
  const n = anchors.length
  if (n === 0) return []
  const sizes = input.sizes ?? {}
  const finite = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

  // ── inputs as flat arrays ──────────────────────────────────────────────────────────────────────────────
  const ax = new Float64Array(n), ay = new Float64Array(n), hw = new Float64Array(n), hh = new Float64Array(n)
  // The box a label must clear: the part's box grown to include the anchor point itself.
  const k0x = new Float64Array(n), k0y = new Float64Array(n), k1x = new Float64Array(n), k1y = new Float64Array(n)
  // The raw part box, for "do not cover someone else's part" (empty when the anchor has none).
  const p0x = new Float64Array(n), p0y = new Float64Array(n), p1x = new Float64Array(n), p1y = new Float64Array(n)
  let heightSum = 0, heightCount = 0, meanX = 0, meanY = 0
  for (let i = 0; i < n; i++) {
    const anchor = anchors[i]!
    const size = sizes[anchor.id]
    ax[i] = finite(anchor.x, 0); ay[i] = finite(anchor.y, 0)
    hw[i] = Math.max(0, finite(size?.width, 0)) / 2; hh[i] = Math.max(0, finite(size?.height, 0)) / 2
    if (hh[i]! > 0) { heightSum += hh[i]! * 2; heightCount++ }
    meanX += ax[i]!; meanY += ay[i]!
    const part = anchor.avoid
    if (part && Number.isFinite(part.x + part.y + part.width + part.height) && part.width >= 0 && part.height >= 0) {
      p0x[i] = part.x; p0y[i] = part.y; p1x[i] = part.x + part.width; p1y[i] = part.y + part.height
      k0x[i] = Math.min(part.x, ax[i]!); k0y[i] = Math.min(part.y, ay[i]!)
      k1x[i] = Math.max(p1x[i]!, ax[i]!); k1y[i] = Math.max(p1y[i]!, ay[i]!)
    } else {
      p0x[i] = 0; p0y[i] = 0; p1x[i] = -1; p1y[i] = -1
      k0x[i] = ax[i]!; k1x[i] = ax[i]!; k0y[i] = ay[i]!; k1y[i] = ay[i]!
    }
  }
  meanX /= n; meanY /= n
  const unit = heightCount > 0 ? heightSum / heightCount : 1
  const gap = Math.max(0, finite(input.gap, 0.6 * unit))
  const labelGap = Math.max(0, finite(input.labelGap, 0.25 * unit))
  const tiny = 1e-9 * unit

  const obstacleList = input.obstacles ?? []
  const obstacleCount = obstacleList.length
  const obstacles = new Float64Array(obstacleCount * 4)
  for (let o = 0; o < obstacleCount; o++) {
    const r = obstacleList[o]!
    obstacles[o * 4] = r.x; obstacles[o * 4 + 1] = r.y; obstacles[o * 4 + 2] = r.x + r.width; obstacles[o * 4 + 3] = r.y + r.height
  }

  // Bounds; without usable ones, a generous box around the anchors so the grid search still has a domain.
  let b0x: number, b0y: number, b1x: number, b1y: number
  const bounds = input.bounds
  if (bounds && Number.isFinite(bounds.x + bounds.y + bounds.width + bounds.height) && bounds.width > 0 && bounds.height > 0) {
    b0x = bounds.x; b0y = bounds.y; b1x = bounds.x + bounds.width; b1y = bounds.y + bounds.height
  } else {
    b0x = Infinity; b0y = Infinity; b1x = -Infinity; b1y = -Infinity
    let reach = gap
    for (let i = 0; i < n; i++) {
      b0x = Math.min(b0x, k0x[i]!); b1x = Math.max(b1x, k1x[i]!); b0y = Math.min(b0y, k0y[i]!); b1y = Math.max(b1y, k1y[i]!)
      reach += 2 * Math.max(hw[i]!, hh[i]!) + labelGap
    }
    b0x -= reach; b0y -= reach; b1x += reach; b1y += reach
  }

  // "Away from the subject": direction from the mean anchor to each anchor, weighted by how far out it is.
  const outX = new Float64Array(n), outY = new Float64Array(n), outWeight = new Float64Array(n)
  {
    let spread = 0
    for (let i = 0; i < n; i++) spread += (ax[i]! - meanX) ** 2 + (ay[i]! - meanY) ** 2
    spread = Math.sqrt(spread / n)
    for (let i = 0; i < n; i++) {
      const dx = ax[i]! - meanX, dy = ay[i]! - meanY, d = Math.hypot(dx, dy)
      if (d > 1e-9 * (spread + unit) && spread > 0) { outX[i] = dx / d; outY[i] = dy / d; outWeight[i] = Math.min(1, d / (0.5 * spread)) }
    }
  }

  // ── geometry of one spot: side and leader end, left in the t* variables ────────────────────────────────
  let tSide = RIGHT, tx = 0, ty = 0
  const attach = (i: number, cx: number, cy: number): void => {
    const x0 = cx - hw[i]!, x1 = cx + hw[i]!
    if (x0 > ax[i]!) { tSide = RIGHT; tx = x0; ty = cy; return }
    if (x1 < ax[i]!) { tSide = LEFT; tx = x1; ty = cy; return }
    const round = Math.min(hw[i]!, hh[i]!)
    tx = Math.min(Math.max(ax[i]!, x0 + round), x1 - round)
    if (cy >= ay[i]!) { tSide = UP; ty = cy - hh[i]! } else { tSide = DOWN; ty = cy + hh[i]! }
  }

  /** Cost of a spot on its own (no other labels considered). Leaves side and leader end in the t* variables. */
  const staticCost = (i: number, cx: number, cy: number): number => {
    attach(i, cx, cy)
    const side = tSide, endX = tx, endY = ty
    const x0 = cx - hw[i]!, x1 = cx + hw[i]!, y0 = cy - hh[i]!, y1 = cy + hh[i]!
    const area = Math.max((x1 - x0) * (y1 - y0), 1e-12)
    let cost = Math.hypot(endX - ax[i]!, endY - ay[i]!) / unit
    if (side >= UP) cost += COST_END
    if (outWeight[i]! > 0) {
      const dx = cx - ax[i]!, dy = cy - ay[i]!, d = Math.hypot(dx, dy)
      if (d > 0) cost += COST_INWARD * outWeight[i]! * (1 - (dx * outX[i]! + dy * outY[i]!) / d) / 2
    }
    for (let o = 0; o < obstacleCount * 4; o += 4) {
      const w = Math.min(x1, obstacles[o + 2]!) - Math.max(x0, obstacles[o]!)
      if (w <= tiny) continue
      const h = Math.min(y1, obstacles[o + 3]!) - Math.max(y0, obstacles[o + 1]!)
      if (h > tiny) cost += COST_OBSTACLE + COST_OBSTACLE_AREA * w * h / area
    }
    const dot = 0.15 * unit                    // a label this close to another anchor counts as covering it
    for (let j = 0; j < n; j++) {
      if (j === i) continue
      if (ax[j]! > x0 - dot && ax[j]! < x1 + dot && ay[j]! > y0 - dot && ay[j]! < y1 + dot) cost += COST_DOT
      const w = Math.min(x1, p1x[j]!) - Math.max(x0, p0x[j]!)
      if (w <= tiny) continue
      const h = Math.min(y1, p1y[j]!) - Math.max(y0, p0y[j]!)
      if (h > tiny) cost += COST_PART + COST_PART_AREA * w * h / area
    }
    tSide = side; tx = endX; ty = endY
    return cost
  }

  // ── hints ────────────────────────────────────────────────────────────────────────────────────────────────
  const hintX = new Float64Array(n), hintY = new Float64Array(n), hintSide = new Int8Array(n).fill(-1)
  const hasHint = new Uint8Array(n)
  const yDown = input.yDown === true
  if (input.previous && input.previous.length > 0) {
    const byId = new Map<string, number>()
    for (let i = 0; i < n; i++) if (!byId.has(anchors[i]!.id)) byId.set(anchors[i]!.id, i)
    for (const old of input.previous) {
      const i = old ? byId.get(old.id) : undefined
      if (i === undefined || !Number.isFinite(old.x) || !Number.isFinite(old.y)) continue
      hasHint[i] = 1; hintX[i] = old.x; hintY[i] = old.y
      if (old.side === 'right') hintSide[i] = RIGHT
      else if (old.side === 'left') hintSide[i] = LEFT
      else if (old.side === 'top') hintSide[i] = yDown ? DOWN : UP
      else if (old.side === 'bottom') hintSide[i] = yDown ? UP : DOWN
    }
  }

  // ── candidates ───────────────────────────────────────────────────────────────────────────────────────────
  const candX = new Float64Array(n * MAX_CANDIDATES), candY = new Float64Array(n * MAX_CANDIDATES)
  const candCost = new Float64Array(n * MAX_CANDIDATES)
  const candOrder = new Int32Array(n * MAX_CANDIDATES), candCount = new Int32Array(n)
  // Per label, the 8 lines its regular spots lie on: right, left, pushed right, pushed left (x of the label
  // centre), then above, below, pushed above, pushed below (y). NaN when the line is outside the bounds.
  const lines = new Float64Array(n * 8).fill(NaN)
  const dotRadius = 0.15 * unit
  let current = 0, count = 0
  const add = (cx: number, cy: number, stay: boolean): void => {
    const i = current, base = i * MAX_CANDIDATES
    let cost = staticCost(i, cx, cy)
    if (stay) cost = cost * STAY_FACTOR - STAY_BONUS
    if (hintSide[i] === tSide) cost -= SAME_SIDE_BONUS
    candX[base + count] = cx; candY[base + count] = cy; candCost[base + count] = cost
    // insertion sort by cost; equal costs keep the order they were generated in
    let slot = count
    while (slot > 0 && candCost[candOrder[base + slot - 1]!]! > cost) { candOrder[base + slot] = candOrder[base + slot - 1]!; slot-- }
    candOrder[base + slot] = base + count
    count++
  }
  /** Moves a spot outwards along one axis until the label is off every obstacle, other part and other dot.
   *  Returns the new centre coordinate on that axis (the old one when nothing was in the way). */
  const pushOut = (i: number, cx: number, cy: number, alongX: boolean, sign: number): number => {
    const halfAlong = alongX ? hw[i]! : hh[i]!
    let centre = alongX ? cx : cy
    for (let round = 0; round < 4; round++) {
      const x0 = (alongX ? centre : cx) - hw[i]!, x1 = (alongX ? centre : cx) + hw[i]!
      const y0 = (alongX ? cy : centre) - hh[i]!, y1 = (alongX ? cy : centre) + hh[i]!
      let far = -Infinity
      for (let o = 0; o < obstacleCount * 4; o += 4) {
        if (x0 < obstacles[o + 2]! - tiny && x1 > obstacles[o]! + tiny && y0 < obstacles[o + 3]! - tiny && y1 > obstacles[o + 1]! + tiny) {
          far = Math.max(far, sign * (alongX ? (sign > 0 ? obstacles[o + 2]! : obstacles[o]!) : (sign > 0 ? obstacles[o + 3]! : obstacles[o + 1]!)))
        }
      }
      for (let j = 0; j < n; j++) {
        if (j === i) continue
        if (x0 < p1x[j]! - tiny && x1 > p0x[j]! + tiny && y0 < p1y[j]! - tiny && y1 > p0y[j]! + tiny) {
          far = Math.max(far, sign * (alongX ? (sign > 0 ? p1x[j]! : p0x[j]!) : (sign > 0 ? p1y[j]! : p0y[j]!)))
        }
        if (ax[j]! > x0 - dotRadius && ax[j]! < x1 + dotRadius && ay[j]! > y0 - dotRadius && ay[j]! < y1 + dotRadius) {
          far = Math.max(far, sign * (alongX ? ax[j]! : ay[j]!))
        }
      }
      if (far === -Infinity) break
      centre = sign * (far + gap + halfAlong)
    }
    return centre
  }
  for (let i = 0; i < n; i++) {
    current = i; count = 0
    const w = hw[i]! * 2, h = hh[i]! * 2
    const fitsX = b1x - b0x >= w - tiny, fitsY = b1y - b0y >= h - tiny
    if (fitsX && fitsY) {
      const loX = b0x + hw[i]!, hiX = b1x - hw[i]!, loY = b0y + hh[i]!, hiY = b1y - hh[i]!
      if (hasHint[i]) {
        const cx = Math.min(Math.max(hintX[i]!, loX), hiX), cy = Math.min(Math.max(hintY[i]!, loY), hiY)
        // still legal: clear of the part's box (and of the anchor dot)
        const clear = cx - hw[i]! >= k1x[i]! - tiny || cx + hw[i]! <= k0x[i]! + tiny
          || cy - hh[i]! >= k1y[i]! - tiny || cy + hh[i]! <= k0y[i]! + tiny
        if (clear) add(cx, cy, true)
      }
      const stepY = h + labelGap, stepX = (w + labelGap) / 2
      const right = k1x[i]! + gap + hw[i]!, left = k0x[i]! - gap - hw[i]!
      const above = k1y[i]! + gap + hh[i]!, below = k0y[i]! - gap - hh[i]!
      for (let s = 0; s < SIDE_SLIDES.length; s++) {
        const cy = Math.min(Math.max(ay[i]! + SIDE_SLIDES[s]! * stepY, loY), hiY)
        if (right <= hiX + tiny) {
          add(right, cy, false)
          if (s === 0) lines[i * 8] = right
          if (s < PUSHED_SLIDES) {
            const out = pushOut(i, right, cy, true, 1)
            if (out > right + tiny && out <= hiX + tiny) { add(out, cy, false); if (s === 0) lines[i * 8 + 2] = out }
          }
        }
        if (left >= loX - tiny) {
          add(left, cy, false)
          if (s === 0) lines[i * 8 + 1] = left
          if (s < PUSHED_SLIDES) {
            const out = pushOut(i, left, cy, true, -1)
            if (out < left - tiny && out >= loX - tiny) { add(out, cy, false); if (s === 0) lines[i * 8 + 3] = out }
          }
        }
      }
      for (let s = 0; s < END_SLIDES.length; s++) {
        const cx = Math.min(Math.max(ax[i]! + END_SLIDES[s]! * stepX, loX), hiX)
        if (above <= hiY + tiny) {
          add(cx, above, false)
          if (s === 0) lines[i * 8 + 4] = above
          if (s < PUSHED_SLIDES) {
            const out = pushOut(i, cx, above, false, 1)
            if (out > above + tiny && out <= hiY + tiny) { add(cx, out, false); if (s === 0) lines[i * 8 + 6] = out }
          }
        }
        if (below >= loY - tiny) {
          add(cx, below, false)
          if (s === 0) lines[i * 8 + 5] = below
          if (s < PUSHED_SLIDES) {
            const out = pushOut(i, cx, below, false, -1)
            if (out < below - tiny && out >= loY - tiny) { add(cx, out, false); if (s === 0) lines[i * 8 + 7] = out }
          }
        }
      }
    }
    candCount[i] = count
  }

  // ── placement state ──────────────────────────────────────────────────────────────────────────────────────
  const placed = new Uint8Array(n)
  const posX = new Float64Array(n), posY = new Float64Array(n), endX = new Float64Array(n), endY = new Float64Array(n)
  const side = new Uint8Array(n)

  /** Extra cost of a spot given the labels already placed, or -1 when it overlaps one of them. */
  const dynamicCost = (i: number, cx: number, cy: number, ex: number, ey: number): number => {
    const x0 = cx - hw[i]!, x1 = cx + hw[i]!, y0 = cy - hh[i]!, y1 = cy + hh[i]!
    const margin = labelGap - tiny
    // overlaps first: they are the cheap test and the common reason to reject a spot
    for (let j = 0; j < n; j++) {
      if (!placed[j] || j === i) continue
      if (x0 - margin < posX[j]! + hw[j]! && x1 + margin > posX[j]! - hw[j]! && y0 - margin < posY[j]! + hh[j]! && y1 + margin > posY[j]! - hh[j]!) return -1
    }
    let cost = 0
    for (let j = 0; j < n; j++) {
      if (!placed[j] || j === i) continue
      if (segmentsCrossXY(ax[i]!, ay[i]!, ex, ey, ax[j]!, ay[j]!, endX[j]!, endY[j]!)) cost += COST_CROSSING
      if (segmentHitsBox(ax[i]!, ay[i]!, ex, ey, posX[j]! - hw[j]!, posY[j]! - hh[j]!, posX[j]! + hw[j]!, posY[j]! + hh[j]!)) cost += COST_THROUGH
      if (segmentHitsBox(ax[j]!, ay[j]!, endX[j]!, endY[j]!, x0, y0, x1, y1)) cost += COST_THROUGH
    }
    return cost
  }

  const put = (i: number, cx: number, cy: number): void => {
    attach(i, cx, cy)
    posX[i] = cx; posY[i] = cy; endX[i] = tx; endY[i] = ty; side[i] = tSide; placed[i] = 1
  }

  /** Whole-bounds search for a label with no clean regular spot. Returns the cost of the best grid spot that
   *  beats `limit` (leaving it in gridX/gridY), or Infinity. */
  let gridX = 0, gridY = 0
  const gridSearch = (i: number, limit: number): number => {
    const w = hw[i]! * 2, h = hh[i]! * 2
    const spanX = b1x - b0x - w, spanY = b1y - b0y - h
    if (spanX < -tiny || spanY < -tiny) return Infinity
    const columns = Math.max(1, Math.min(48, Math.ceil(spanX / Math.max((w + labelGap) / 2, tiny))))
    const rows = Math.max(1, Math.min(48, Math.ceil(spanY / Math.max((h + labelGap) / 2, tiny))))
    const nearRow = spanY > 0 ? Math.min(rows, Math.max(0, Math.round((ay[i]! - b0y - hh[i]!) / spanY * rows))) : 0
    const nearColumn = spanX > 0 ? Math.min(columns, Math.max(0, Math.round((ax[i]! - b0x - hw[i]!) / spanX * columns))) : 0
    // pass 0 keeps the label outside its own part; pass 1 gives that up, and only runs when nothing else exists
    for (let pass = 0; pass < (limit === Infinity ? 2 : 1); pass++) {
      let best = limit
      // Rows and columns are visited from the anchor outwards (0, +1, -1, +2, ...), so a near spot is found
      // early and everything further away than it is skipped: a direction is closed once it cannot win.
      for (let k = 0, up = true, down = true; (up || down) && k <= 2 * rows + 1; k++) {
        const rowStep = k & 1 ? (k + 1) >> 1 : -(k >> 1)
        if (rowStep > 0 ? !up : rowStep < 0 && !down) continue
        const r = nearRow + rowStep
        if (r < 0) { down = false; continue }
        if (r > rows) { up = false; continue }
        const cy = b0y + hh[i]! + Math.max(0, spanY) * r / rows
        const y0 = cy - hh[i]!, y1 = cy + hh[i]!
        const dy = Math.max(y0 - ay[i]!, 0, ay[i]! - y1)
        if (dy / unit + COST_FALLBACK >= best) { if (rowStep >= 0) up = false; if (rowStep <= 0) down = false; continue }
        for (let m = 0, right = true, left = true; (right || left) && m <= 2 * columns + 1; m++) {
          const columnStep = m & 1 ? (m + 1) >> 1 : -(m >> 1)
          if (columnStep > 0 ? !right : columnStep < 0 && !left) continue
          const c = nearColumn + columnStep
          if (c < 0) { left = false; continue }
          if (c > columns) { right = false; continue }
          const cx = b0x + hw[i]! + Math.max(0, spanX) * c / columns
          const x0 = cx - hw[i]!, x1 = cx + hw[i]!
          const dx = Math.max(x0 - ax[i]!, 0, ax[i]! - x1)
          if (Math.hypot(dx, dy) / unit + COST_FALLBACK >= best) { if (columnStep >= 0) right = false; if (columnStep <= 0) left = false; continue }
          if (pass === 0 && x0 < k1x[i]! - tiny && x1 > k0x[i]! + tiny && y0 < k1y[i]! - tiny && y1 > k0y[i]! + tiny) continue
          // cheap tests first: leader length alone, then the placed labels, and only then the full cost
          attach(i, cx, cy)
          const reach = Math.hypot(tx - ax[i]!, ty - ay[i]!) / unit + COST_FALLBACK
          if (reach >= best) continue
          const extra = dynamicCost(i, cx, cy, tx, ty)
          if (extra < 0 || reach + extra >= best) continue
          const cost = staticCost(i, cx, cy) + COST_FALLBACK + extra
          if (cost >= best) continue
          best = cost; gridX = cx; gridY = cy
        }
      }
      if (best < limit) return best
    }
    return Infinity
  }

  /** Places label i on its cheapest spot given every label placed so far. */
  const choose = (i: number): void => {
    const base = i * MAX_CANDIDATES, count = candCount[i]!
    let found = false, bestTotal = Infinity, bestExtra = 0, bestX = 0, bestY = 0
    let blocked = false                    // true when a cheaper regular spot than the chosen one was not free
    for (let s = 0; s < count; s++) {
      const c = candOrder[base + s]!
      if (candCost[c]! >= bestTotal) break
      attach(i, candX[c]!, candY[c]!)
      const extra = dynamicCost(i, candX[c]!, candY[c]!, tx, ty)
      if (extra !== 0) blocked = true
      if (extra < 0) continue
      if (candCost[c]! + extra < bestTotal) { found = true; bestTotal = candCost[c]! + extra; bestExtra = extra; bestX = candX[c]!; bestY = candY[c]! }
      if (extra === 0) break
    }
    if (found && !blocked) { put(i, bestX, bestY); return }

    // Something was in the way. Try sitting flush against a placed label on one of this label's lines:
    // that is what packs labels into tight columns and rows instead of leaving whole-step holes.
    const loX = b0x + hw[i]!, hiX = b1x - hw[i]!, loY = b0y + hh[i]!, hiY = b1y - hh[i]!
    for (let line = 0; line < 8; line++) {
      const at = lines[i * 8 + line]!
      if (at !== at) continue
      const vertical = line < 4
      for (let j = 0; j < n; j++) {
        if (!placed[j] || j === i) continue
        const reachX = hw[i]! + hw[j]! + labelGap, reachY = hh[i]! + hh[j]! + labelGap
        if (vertical ? Math.abs(at - posX[j]!) >= reachX : Math.abs(at - posY[j]!) >= reachY) continue
        for (let dir = -1; dir <= 1; dir += 2) {
          const cx = vertical ? at : posX[j]! + dir * reachX, cy = vertical ? posY[j]! + dir * reachY : at
          if (cx < loX - tiny || cx > hiX + tiny || cy < loY - tiny || cy > hiY + tiny) continue
          attach(i, cx, cy)
          const bonus = hintSide[i] === tSide ? SAME_SIDE_BONUS : 0
          const reach = Math.hypot(tx - ax[i]!, ty - ay[i]!) / unit - bonus
          if (reach >= bestTotal) continue
          const extra = dynamicCost(i, cx, cy, tx, ty)
          if (extra < 0 || reach + extra >= bestTotal) continue
          const cost = staticCost(i, cx, cy) - bonus + extra
          if (cost >= bestTotal) continue
          found = true; bestTotal = cost; bestExtra = extra; bestX = cx; bestY = cy
        }
      }
    }
    if (found && bestExtra === 0) { put(i, bestX, bestY); return }
    // Still compromised (or nothing at all): a spot anywhere in the bounds may be better.
    if (gridSearch(i, bestTotal) < bestTotal) { put(i, gridX, gridY); return }
    if (found) { put(i, bestX, bestY); return }
    // Nothing is free anywhere: overlap rather than vanish.
    if (count > 0) { put(i, candX[candOrder[base]!]!, candY[candOrder[base]!]!); return }
    const cx = b1x - b0x >= hw[i]! * 2 ? Math.min(Math.max(k1x[i]! + gap + hw[i]!, b0x + hw[i]!), b1x - hw[i]!) : (b0x + b1x) / 2
    const cy = b1y - b0y >= hh[i]! * 2 ? Math.min(Math.max(ay[i]!, b0y + hh[i]!), b1y - hh[i]!) : (b0y + b1y) / 2
    put(i, cx, cy)
  }

  // ── solve: greedy in priority order, then repair ─────────────────────────────────────────────────────────
  const priority: number[] = []
  {
    const taken = new Uint8Array(n)
    if (input.order && input.order.length > 0) {
      const byId = new Map<string, number[]>()
      for (let i = 0; i < n; i++) {
        const list = byId.get(anchors[i]!.id)
        if (list) list.push(i); else byId.set(anchors[i]!.id, [i])
      }
      for (const id of input.order) for (const i of byId.get(id) ?? []) if (!taken[i]) { taken[i] = 1; priority.push(i) }
    }
    // The rest: closest to the middle of the subject first, so the outer labels fan outwards around them.
    const rest: number[] = []
    for (let i = 0; i < n; i++) if (!taken[i]) rest.push(i)
    const reach = (i: number): number => (ax[i]! - meanX) ** 2 + (ay[i]! - meanY) ** 2
    rest.sort((p, q) => reach(p) - reach(q) || p - q)
    for (const i of rest) priority.push(i)
  }
  for (const i of priority) choose(i)

  const penaltyOf = (i: number): number => {
    placed[i] = 0
    const cost = dynamicCost(i, posX[i]!, posY[i]!, endX[i]!, endY[i]!)
    placed[i] = 1
    return cost < 0 ? 1e6 : cost
  }
  for (let round = 0; round < 2; round++) {
    let changed = false
    // labels that had to compromise get another go now that everyone is placed
    for (const i of priority) {
      const before = penaltyOf(i)
      if (before === 0) continue
      const oldX = posX[i]!, oldY = posY[i]!
      placed[i] = 0
      choose(i)
      if (penaltyOf(i) < before) changed = true
      else put(i, oldX, oldY)
    }
    // crossing leaders: let the two labels pick again in the opposite order
    for (let p = 0; p < n; p++) {
      const i = priority[p]!
      for (let q = p + 1; q < n; q++) {
        const j = priority[q]!
        if (!segmentsCrossXY(ax[i]!, ay[i]!, endX[i]!, endY[i]!, ax[j]!, ay[j]!, endX[j]!, endY[j]!)) continue
        const before = penaltyOf(i) + penaltyOf(j)
        const ix = posX[i]!, iy = posY[i]!, jx = posX[j]!, jy = posY[j]!
        placed[i] = 0; placed[j] = 0
        choose(j); choose(i)
        if (penaltyOf(i) + penaltyOf(j) < before) changed = true
        else { put(i, ix, iy); put(j, jx, jy) }
      }
    }
    if (!changed) break
  }

  // ── result ───────────────────────────────────────────────────────────────────────────────────────────────
  const names: LabelSide[] = ['right', 'left', yDown ? 'bottom' : 'top', yDown ? 'top' : 'bottom']
  const result: PlacedLabel[] = new Array(n)
  for (let i = 0; i < n; i++) {
    result[i] = {
      id: anchors[i]!.id, x: posX[i]!, y: posY[i]!, side: names[side[i]!]!,
      leader: [[ax[i]!, ay[i]!], [endX[i]!, endY[i]!]],
    }
  }
  return result
}
