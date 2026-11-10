// src/guide/solver.ts: the geometry of the guide, pure. Geometry in, places out: no DOM, no clock, no frame kept.
//
//   solveLabels   where the names of the parts of a figure stand: two columns, left and right of its silhouette,
//                 inside the free stage, each name on the cheaper side, leaders that do not cross. It answers in
//                 two parts, so that names hold still: `keep` (side, order in the column and height beside the part,
//                 decided once for a reference pose) and `slots` (where each name is for the geometry it was given).
//                 Called again with `keep` and other geometry (the camera has turned, a part has moved) only the
//                 heights follow, continuously: no name changes side or jumps over another.
//   wrapLabel     a long name on two lines.
//   hullOutline   a rounded outline that hugs a part: the convex hull of its points, pushed out, corners rounded.
//   choosePerch   the side of a part on which a resting pointer covers no text.
//   glyphAlpha    how much of glyph i of n is written at progress p (manim's lagged start).
// Lengths are the caller's (stage px in the viewer); y grows downwards.

export interface Pt { x: number; y: number }
export interface Box { x: number; y: number; width: number; height: number }
export type ColumnSide = 'left' | 'right'

const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x)
const smooth = (x: number): number => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t) }

/** Progress of glyph `i` of `n` when the whole name is at `p` (0..1): each starts `lag` of a glyph's own run after the one before. */
export const glyphAlpha = (p: number, i: number, n: number, lag = 0.1): number => smooth(clamp(clamp(p, 0, 1) * ((Math.max(n, 1) - 1) * lag + 1) - i * lag, 0, 1))

/** A name wider than `maxWidth` goes on two lines, cut where the longer line is shortest. `measure(text)` is its width. */
export function wrapLabel(text: string, measure: (text: string) => number, maxWidth: number): { lines: string[]; width: number } {
  const whole = text.trim(), width = measure(whole)
  const words = whole.split(/\s+/)
  if (!(width > maxWidth) || words.length < 2) return { lines: [whole], width }
  let best: { lines: string[]; width: number } | null = null
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(' '), b = words.slice(k).join(' '), w = Math.max(measure(a), measure(b))
    if (!best || w < best.width) best = { lines: [a, b], width: w }
  }
  return best!
}

// ── segments ────────────────────────────────────────────────────────────────────────────────────────────
const orient = (a: Pt, b: Pt, c: Pt): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
/** Do the segments a-b and c-d properly cross (touching ends do not count)? */
export const segmentsCross = (a: Pt, b: Pt, c: Pt, d: Pt): boolean => orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0
const pointToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1)
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}
/** Does the segment a-b pass through the ellipse inscribed in `box`? */
export const throughEllipse = (a: Pt, b: Pt, box: Box): boolean => {
  const rx = box.width / 2, ry = box.height / 2
  if (!(rx > 0) || !(ry > 0)) return false
  const cx = box.x + rx, cy = box.y + ry
  return pointToSegment(0, 0, (a.x - cx) / rx, (a.y - cy) / ry, (b.x - cx) / rx, (b.y - cy) / ry) < 1
}

/**
 * Heights that keep their order and their distance: the nearest ones (least squares) to `want` such that
 * y[i] - y[i-1] >= need[i] (need[0] is not used). Pool-adjacent-violators: exact, and continuous in `want`.
 */
export function spaced(want: readonly number[], need: readonly number[]): number[] {
  const n = want.length, shift = new Array<number>(n).fill(0)
  for (let i = 1; i < n; i++) shift[i] = shift[i - 1]! + Math.max(0, need[i] ?? 0)
  // blocks of equal value: sum and count
  const sum: number[] = [], count: number[] = []
  for (let i = 0; i < n; i++) {
    sum.push(want[i]! - shift[i]!)
    count.push(1)
    while (sum.length > 1 && sum[sum.length - 2]! / count[count.length - 2]! > sum[sum.length - 1]! / count[count.length - 1]!) {
      const s = sum.pop()!, c = count.pop()!
      sum[sum.length - 1]! += s
      count[count.length - 1]! += c
    }
  }
  const out: number[] = []
  for (let b = 0; b < sum.length; b++) for (let k = 0; k < count[b]!; k++) out.push(sum[b]! / count[b]! + shift[out.length]!)
  return out
}

// ── names in two columns ────────────────────────────────────────────────────────────────────────────────
/** Something a leader should not pass over: the box of another part (its inscribed ellipse is tested). */
export interface LabelObstacle { box: Box; /** the names whose own leaders may touch it */ ids: readonly string[]; /** what passing over it costs, in the caller's length */ cost: number; /** counted in `hued` when a leader passes over it */ hued?: boolean }
/** What was decided for the reference pose and is kept while the picture changes. */
export interface LabelKeep { sides: Record<string, ColumnSide>; /** order in its column, top first */ rank: Record<string, number>; /** height of the name relative to the middle of its part */ offset: Record<string, number> }
export interface LabelTuning {
  /** between the silhouette and the text */
  gap: number
  /** air between two names in a column */
  space: number
  /** from the text to the elbow of its leader */
  elbow: number
  /** names fan away from the middle of the figure by `fan` x their distance from the column, between fanMin and fanMax */
  fan: number; fanMin: number; fanMax: number
  /** added to the cost of the side the scene's hint is not on */
  hintCost: number
  /** added when the text does not fit between the silhouette and the edge of the free stage, plus `roomSlope` per unit that is missing */
  roomCost: number; roomSlope: number
  /** how fast a part of the figure stops mattering to a column as it lies further above or below the names (see `silhouette`) */
  chamfer: number
}
export const LABEL_TUNING: Readonly<LabelTuning> = Object.freeze({ gap: 20, space: 7, elbow: 22, fan: 0.14, fanMin: 10, fanMax: 30, hintCost: 14, roomCost: 400, roomSlope: 4, chamfer: 1 })
export interface LabelInput {
  /** the names wanted, most important first */
  ids: readonly string[]
  /** the middle of each part */
  at: Record<string, Pt>
  /** the text block of each name (after wrapping) */
  size: Record<string, { width: number; height: number }>
  /** the silhouette of the figure: its left and right edge and its vertical middle */
  figure: { left: number; right: number; middle: number }
  /**
   * Points along the outlines of the parts of the figure (see outlinePoints). With them a column stands beside the
   * figure AT THE HEIGHTS ITS NAMES ARE, not beside its widest part: names of the head of a machine are not pushed out
   * by its base plate. A point above or below the names still keeps the column away by `chamfer` times its vertical
   * distance, so the answer is continuous.
   */
  silhouette?: readonly Pt[]
  /** the free stage: no text leaves it */
  bounds: { left: number; right: number; top: number; bottom: number }
  obstacles?: readonly LabelObstacle[]
  hint?: Record<string, ColumnSide | undefined>
  /** what an earlier call decided: sides, order and heights beside the parts are taken from it, nothing is decided again */
  keep?: LabelKeep | null
  /** where the leader of a name leaves its part when it runs toward `to`; the middle of the part without it */
  tip?: (id: string, to: Pt) => Pt
  tuning?: Partial<LabelTuning>
}
export interface LabelSlot { /** the edge of the text nearest the figure (its right edge on the left side) */ x: number; /** the middle of the text block */ y: number; side: ColumnSide; width: number; height: number; /** the leader: from the part to the elbow; the level shoulder runs from the elbow to the text */ tip: Pt; elbow: Pt }
export interface LabelResult { slots: Record<string, LabelSlot>; keep: LabelKeep; /** names that found no room in either column */ dropped: string[]; /** leaders that cross each other */ crossings: number; /** leaders that pass over a coloured part */ hued: number }

/** Where the names stand. See the header of this file. */
export function solveLabels(input: LabelInput): LabelResult {
  const T: LabelTuning = { ...LABEL_TUNING, ...(input.tuning ?? {}) }
  const { figure, bounds } = input
  const obstacles = input.obstacles ?? []
  const out: LabelResult = { slots: {}, keep: { sides: {}, rank: {}, offset: {} }, dropped: [], crossings: 0, hued: 0 }
  const ids = input.ids.filter((id, i) => input.at[id] && input.size[id] && input.ids.indexOf(id) === i)
  if (!ids.length) return out
  const at = (id: string): Pt => input.at[id]!, size = (id: string): { width: number; height: number } => input.size[id]!
  /** the edge of the figure a column stands beside, for names between the heights `top` and `bottom` */
  const edge = (side: ColumnSide, top: number, bottom: number): number => {
    const points = input.silhouette
    if (!points?.length) return side === 'left' ? figure.left : figure.right
    let x = side === 'left' ? Infinity : -Infinity
    for (const p of points) {
      const away = Math.max(0, p.y - bottom, top - p.y) * T.chamfer
      x = side === 'left' ? Math.min(x, p.x + away) : Math.max(x, p.x - away)
    }
    return side === 'left' ? Math.max(figure.left, Math.min(x, figure.right)) : Math.min(figure.right, Math.max(x, figure.left))
  }
  /** where the column of one name alone would be (sides are chosen with it) */
  const ownX = (id: string, side: ColumnSide): number => { const c = at(id), h = size(id).height / 2 + T.fanMax; return edge(side, c.y - h, c.y + h) + (side === 'left' ? -T.gap : T.gap) }
  const fanOf = (id: string, side: ColumnSide): number => { const c = at(id); return (c.y - figure.middle < 0 ? -1 : c.y - figure.middle > 0 ? 1 : -1) * clamp(Math.abs(ownX(id, side) - c.x) * T.fan, T.fanMin, T.fanMax) }
  /** where the column of these names is: beside the figure at the heights they span */
  const columnX = (side: ColumnSide, order: readonly string[], ys: readonly number[]): number => {
    let top = Infinity, bottom = -Infinity
    order.forEach((id, i) => { top = Math.min(top, ys[i]! - size(id).height / 2); bottom = Math.max(bottom, ys[i]! + size(id).height / 2) })
    return edge(side, top, bottom) + (side === 'left' ? -T.gap : T.gap)
  }
  const textX = (id: string, side: ColumnSide, x: number): number => (side === 'left' ? Math.max(Math.min(x, bounds.right), bounds.left + size(id).width) : Math.min(Math.max(x, bounds.left), bounds.right - size(id).width))
  const tipOf = (id: string, to: Pt): Pt => (input.tip ? input.tip(id, to) : at(id))
  const cost = (id: string, side: ColumnSide): number => {
    const c = at(id), x = ownX(id, side), far = { x, y: c.y + fanOf(id, side) }
    let k = Math.abs(x - c.x) + (input.hint?.[id] && input.hint[id] !== side ? T.hintCost : 0)
    for (const o of obstacles) if (!o.ids.includes(id) && throughEllipse(c, far, o.box)) k += o.cost
    const room = side === 'left' ? x - bounds.left : bounds.right - x
    if (room < size(id).width) k += T.roomCost + (size(id).width - room) * T.roomSlope // the text would have to stand on the figure
    return k
  }
  const need = (a: string, b: string): number => (size(a).height + size(b).height) / 2 + T.space
  /** heights of one column for a given order: beside the parts, never closer than the text allows, inside the free stage */
  const heights = (order: readonly string[], want: (id: string) => number): number[] => {
    const ys = spaced(order.map(want), order.map((id, i) => (i ? need(order[i - 1]!, id) : 0)))
    if (!ys.length) return ys
    const first = order[0]!, last = order[order.length - 1]!
    const under = Math.max(0, bounds.top + size(first).height / 2 - ys[0]!), over = Math.max(0, ys[ys.length - 1]! + size(last).height / 2 - bounds.bottom)
    // a column taller than the free stage starts at its top: the first names are the ones that matter
    return ys.map((y) => y + (under > 0 ? under : -over))
  }
  /** the leaders of one column: from the edge of each part to the elbow beside its name */
  const leaders = (order: readonly string[], side: ColumnSide, ys: readonly number[]): [Pt, Pt][] => {
    const x = columnX(side, order, ys)
    return order.map((id, i) => { const e = { x: textX(id, side, x) + (side === 'left' ? T.elbow : -T.elbow), y: ys[i]! }; return [tipOf(id, e), e] as [Pt, Pt] })
  }
  const crossingsOf = (segs: readonly [Pt, Pt][]): number => {
    let n = 0
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (segmentsCross(segs[i]![0], segs[i]![1], segs[j]![0], segs[j]![1])) n++
    return n
  }

  let keep = input.keep ?? null
  if (!keep || ids.some((id) => !keep!.sides[id])) {
    // ── 1. sides: the cheaper one; a full column gives away the name that minds least
    let items = ids.map((id, i) => { const l = cost(id, 'left'), r = cost(id, 'right'); return { id, i, side: (l <= r ? 'left' : 'right') as ColumnSide, regret: Math.abs(l - r) } })
    const lineHeight = Math.min(...ids.map((id) => size(id).height))
    const room = Math.max(1, Math.floor((bounds.bottom - bounds.top + T.space) / (Math.max(lineHeight, 1e-6) + T.space)))
    // past what both columns hold, the least important names go
    for (const it of items.slice(2 * room)) out.dropped.push(it.id)
    items = items.slice(0, 2 * room)
    for (const side of ['left', 'right'] as const) {
      const other: ColumnSide = side === 'left' ? 'right' : 'left'
      for (;;) {
        const here = items.filter((it) => it.side === side)
        if (here.length <= room || items.filter((it) => it.side === other).length >= room) break
        here.sort((a, b) => a.regret - b.regret || b.i - a.i)[0]!.side = other
      }
    }
    keep = { sides: {}, rank: {}, offset: {} }
    for (const side of ['left', 'right'] as const) {
      let list = items.filter((it) => it.side === side)
      if (list.length > room) { for (const it of list.slice(room)) out.dropped.push(it.id); list = list.slice(0, room) } // the least important go
      // ── 2. heights: beside its part, fanned away from the middle of the figure
      const want = (id: string): number => at(id).y + fanOf(id, side)
      let order = list.map((it) => it.id).sort((a, b) => at(a).y - at(b).y || ids.indexOf(a) - ids.indexOf(b))
      let ys = heights(order, want), segs = leaders(order, side, ys), crossed = crossingsOf(segs)
      // ── 3. no crossings: two names whose leaders cross trade places, as long as that helps
      for (let pass = 0; pass < 8 && crossed > 0; pass++) {
        let better = false
        for (let i = 0; i < order.length && crossed > 0; i++) for (let j = i + 1; j < order.length && crossed > 0; j++) {
          if (!segmentsCross(segs[i]![0], segs[i]![1], segs[j]![0], segs[j]![1])) continue
          const trial = order.slice()
          trial[i] = order[j]!
          trial[j] = order[i]!
          const ty = heights(trial, want), ts = leaders(trial, side, ty), tc = crossingsOf(ts)
          if (tc < crossed) { order = trial; ys = ty; segs = ts; crossed = tc; better = true }
        }
        if (!better) break
      }
      order.forEach((id, i) => { keep!.sides[id] = side; keep!.rank[id] = i; keep!.offset[id] = ys[i]! - at(id).y })
    }
  }
  out.keep = keep
  // ── where each name is for THIS geometry: its column, the order that was decided, its height beside its part
  const placed: { id: string; seg: [Pt, Pt] }[] = []
  for (const side of ['left', 'right'] as const) {
    const order = ids.filter((id) => keep!.sides[id] === side).sort((a, b) => (keep!.rank[a] ?? 0) - (keep!.rank[b] ?? 0) || ids.indexOf(a) - ids.indexOf(b))
    const ys = heights(order, (id) => at(id).y + (keep!.offset[id] ?? 0))
    const x = columnX(side, order, ys), segs = leaders(order, side, ys)
    order.forEach((id, i) => {
      out.slots[id] = { x: textX(id, side, x), y: ys[i]!, side, width: size(id).width, height: size(id).height, tip: segs[i]![0], elbow: segs[i]![1] }
      placed.push({ id, seg: segs[i]! })
    })
  }
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) if (segmentsCross(placed[i]!.seg[0], placed[i]!.seg[1], placed[j]!.seg[0], placed[j]!.seg[1])) out.crossings++
    for (const o of obstacles) if (o.hued && !o.ids.includes(placed[i]!.id) && throughEllipse(placed[i]!.seg[0], placed[i]!.seg[1], o.box)) out.hued++
  }
  return out
}

/** The corners of the convex hull of `points` and points along its edges, at most `step` apart: the outline of one part, for `silhouette`. */
export function outlinePoints(points: readonly Pt[], step: number): Pt[] {
  const hull = convexHull(points), out: Pt[] = []
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!, b = hull[(i + 1) % hull.length]!
    const n = Math.max(1, Math.min(64, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(step, 1e-6))))
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })
  }
  return out
}

// ── an outline that hugs a part ─────────────────────────────────────────────────────────────────────────
/** Convex hull of points, clockwise on a y-down screen (Andrew's monotone chain). */
export function convexHull(points: readonly Pt[]): Pt[] {
  const list = points.filter((p) => Number.isFinite(p.x + p.y)).slice().sort((a, b) => a.x - b.x || a.y - b.y)
  if (list.length < 3) return list
  const half = (src: readonly Pt[]): Pt[] => {
    const h: Pt[] = []
    for (const p of src) { while (h.length >= 2 && orient(h[h.length - 2]!, h[h.length - 1]!, p) <= 0) h.pop(); h.push(p) }
    h.pop()
    return h
  }
  return [...half(list), ...half(list.slice().reverse())]
}
/**
 * The outline of the convex hull of `points`, `pad` away from it, with round corners: one closed SVG path that starts
 * at its top and runs clockwise (so it can be drawn on), and the box it covers. A single point gives a circle, two a
 * capsule: a thin part gets an outline that follows it, not an ellipse round its box.
 */
export function hullOutline(points: readonly Pt[], pad: number): { d: string; box: Box } | null {
  let hull = convexHull(points)
  // points closer together than a hundredth of the padding are one point
  hull = hull.filter((p, i) => { const q = hull[(i + hull.length - 1) % hull.length]!; return hull.length < 2 || i === 0 || Math.hypot(p.x - q.x, p.y - q.y) > pad * 0.01 })
  if (!hull.length || !(pad > 0)) return null
  const f = (v: number): string => (Math.round(v * 10) / 10).toString()
  const n = hull.length
  // start at the corner that is highest on screen
  let top = 0
  for (let i = 1; i < n; i++) if (hull[i]!.y < hull[top]!.y || (hull[i]!.y === hull[top]!.y && hull[i]!.x < hull[top]!.x)) top = i
  const at = (i: number): Pt => hull[(top + i + n * 2) % n]!
  // outward normal of the edge from a to b (the hull is clockwise on a y-down screen: outside is to the left of travel)
  const normal = (a: Pt, b: Pt): Pt => { const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.y - a.y) / l, y: -(b.x - a.x) / l } }
  let d = ''
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of hull) { x0 = Math.min(x0, p.x - pad); y0 = Math.min(y0, p.y - pad); x1 = Math.max(x1, p.x + pad); y1 = Math.max(y1, p.y + pad) }
  const box = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
  if (n === 1) {
    const c = hull[0]!
    return { d: `M${f(c.x)} ${f(c.y - pad)}A${f(pad)} ${f(pad)} 0 0 1 ${f(c.x)} ${f(c.y + pad)}A${f(pad)} ${f(pad)} 0 0 1 ${f(c.x)} ${f(c.y - pad)}Z`, box }
  }
  for (let i = 0; i < n; i++) {
    const prev = at(i - 1), cur = at(i), next = at(i + 1)
    const a = normal(prev, cur), b = normal(cur, next)
    const from = { x: cur.x + a.x * pad, y: cur.y + a.y * pad }, to = { x: cur.x + b.x * pad, y: cur.y + b.y * pad }
    // the corner: an arc round the hull point from the end of one edge to the start of the next
    d += `${i ? 'L' : 'M'}${f(from.x)} ${f(from.y)}A${f(pad)} ${f(pad)} 0 ${n === 2 ? 1 : 0} 1 ${f(to.x)} ${f(to.y)}`
  }
  return { d: d + 'Z', box }
}

// ── where the pointer rests ─────────────────────────────────────────────────────────────────────────────
export interface PerchInput {
  /** the middle of the part the pointer names */
  center: Pt
  /** where the outline of the part is met when it is approached from direction `dir` (a unit vector pointing away from the part) */
  edge: (dir: Pt) => Pt
  /** length of the pointer and half its width */
  length: number; halfWidth: number
  /** text on screen (its own names and those of others, captions, labels): a perch never covers one */
  texts: readonly Box[]
  /** other objects: avoided when a free side exists */
  others?: readonly Box[]
  /** the pointer stays inside */
  bounds: Box
  /** the side it rests on when nothing speaks against it, degrees clockwise from "the pointer hangs straight below the part" */
  prefer: number
  /** how many directions are tried round the part */
  directions?: number
  /** air kept round text */
  margin?: number
}
export interface Perch { /** the tip: on the outline of the part */ tip: Pt; /** unit vector from the tip along the body of the pointer, away from the part */ dir: Pt; /** degrees clockwise from straight below */ angle: number; /** true when every side covers some text and this one covers least */ covers: boolean }
const overlap = (a: Box, b: Box): number => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
/** The box a pointer covers when its tip is at `tip` and its body runs along `dir`. */
export const pointerBox = (tip: Pt, dir: Pt, length: number, halfWidth: number): Box => {
  const ex = tip.x + dir.x * length, ey = tip.y + dir.y * length, nx = -dir.y * halfWidth, ny = dir.x * halfWidth
  const xs = [tip.x, ex + nx, ex - nx], ys = [tip.y, ey + ny, ey - ny]
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}
/**
 * The side of a part on which the pointer rests: its tip on the outline, its body outside, on free space. Sides are
 * tried round the part starting from the preferred one; a side that would put the pointer over text or outside the
 * stage is out, a side over another object costs, and of the rest the one nearest the preferred side wins.
 */
export function choosePerch(input: PerchInput): Perch {
  const n = Math.max(4, Math.round(input.directions ?? 16)), margin = input.margin ?? 0
  let best: Perch | null = null, least = Infinity
  for (let k = 0; k < n; k++) {
    // nearest the preferred side first: 0, +1, -1, +2 …
    const turn = ((k + 1) >> 1) * (k % 2 ? 1 : -1) * (360 / n)
    const angle = input.prefer + turn, a = (angle * Math.PI) / 180
    // 0 degrees: the body hangs straight below the part (y down); clockwise as seen on screen
    const dir = { x: -Math.sin(a), y: Math.cos(a) }
    const tip = input.edge(dir)
    if (!Number.isFinite(tip.x + tip.y)) continue
    const box = pointerBox(tip, dir, input.length, input.halfWidth)
    const grown = { x: box.x - margin, y: box.y - margin, width: box.width + 2 * margin, height: box.height + 2 * margin }
    const area = Math.max(grown.width * grown.height, 1e-9)
    let text = 0, other = 0
    for (const t of input.texts) text += overlap(grown, t)
    for (const o of input.others ?? []) other += overlap(box, o)
    const b = input.bounds
    const outside = 1 - overlap(box, b) / Math.max(box.width * box.height, 1e-9)
    const cost = (text > 0 ? 1000 + (100 * text) / area : 0) + (outside > 1e-6 ? 500 + 100 * outside : 0) + (4 * Math.min(other, area)) / area + Math.abs(turn) / 180
    if (cost < least) { least = cost; best = { tip, dir, angle, covers: text > 0 } }
  }
  if (best) return best
  const a = (input.prefer * Math.PI) / 180, dir = { x: -Math.sin(a), y: Math.cos(a) }
  return { tip: input.center, dir, angle: input.prefer, covers: false }
}
/** Where a ray from the middle of `box` along `dir` leaves the ellipse inscribed in it (a stand-in outline for a part whose real one is not known). */
export const ellipseEdge = (box: Box, dir: Pt): Pt => {
  const rx = box.width / 2, ry = box.height / 2, cx = box.x + rx, cy = box.y + ry
  const k = Math.hypot(rx > 0 ? dir.x / rx : 0, ry > 0 ? dir.y / ry : 0)
  return k > 0 && rx > 0 && ry > 0 ? { x: cx + dir.x / k, y: cy + dir.y / k } : { x: cx, y: cy }
}
/** Where a ray from the middle of `box` along `dir` leaves the box itself. */
export const boxEdge = (box: Box, dir: Pt): Pt => {
  const hx = box.width / 2, hy = box.height / 2, cx = box.x + hx, cy = box.y + hy
  const tx = Math.abs(dir.x) > 1e-9 ? hx / Math.abs(dir.x) : Infinity, ty = Math.abs(dir.y) > 1e-9 ? hy / Math.abs(dir.y) : Infinity
  const t = Math.min(tx, ty)
  return Number.isFinite(t) ? { x: cx + dir.x * t, y: cy + dir.y * t } : { x: cx, y: cy }
}
