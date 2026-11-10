// The stage of explain(): arranges blocks into rectangles with no input from the author. Pure maths (no scene, no
// DOM): layoutStage(entries, { title }) → one rectangle per block, always inside the safe area, always above the
// caption strip, below the title line when there is one.
import { FRAME_H, FRAME_W, type Area } from '../core/index.ts'
import { areaOf } from './block.ts'

/** Named defaults of the stage. Lengths in frame units (the frame is 14.222 × 8). explain({ layout: { … } }) overrides them per scene. */
export const STAGE_DEFAULTS = {
  /** free room along every edge of the frame */
  margin: 0.45,
  /** height kept free at the bottom for the caption line and the pointer's dock */
  captionStrip: 1.15,
  /** height of the title line at the top (only when the scene has a title) */
  titleStrip: 0.7,
  /** room between two blocks */
  gap: 0.45,
  /** share of the width the 3D panel takes when 2D blocks stand beside it */
  panelShare: 0.58,
  /** aspect (width / height) and weight of a block that states no preference */
  aspect: 1.6,
  weight: 1,
  /** a block never gets less than this share of the room along the axis it is laid out on */
  minimumShare: 0.2,
  /** seconds a block takes to come on stage, the rise it arrives with, and the stagger between blocks that arrive together */
  enterSeconds: 0.7,
  enterRise: 0.18,
  enterLag: 0.25,
  /** seconds a step lasts at least before its closing hold when nothing in it takes longer */
  stepSeconds: 0.6,
}
export type StageOptions = typeof STAGE_DEFAULTS

/** What the stage needs to know about a block. */
export interface StageEntry { id: string; is3d?: boolean; aspect?: number; weight?: number }
export interface StageLayout {
  /** the rectangle everything is arranged in */
  content: Area
  /** the title line, when the scene has a title */
  title: Area | null
  /** the 3D panel, when a 3D block is on stage (centre + size are what s.viewport() takes) */
  panel: Area | null
  /** one rectangle per entry id */
  rects: Record<string, Area>
  /** how the 2D blocks were arranged */
  arrangement: 'single' | 'row' | 'column' | 'grid' | 'none'
  /** 3D blocks beyond the first: the engine has one 3D panel, so these share it */
  extraPanels: string[]
}

const aspectOf = (e: StageEntry, o: StageOptions): number => (typeof e.aspect === 'number' && e.aspect > 0 && Number.isFinite(e.aspect) ? e.aspect : o.aspect)
const weightOf = (e: StageEntry, o: StageOptions): number => (typeof e.weight === 'number' && e.weight > 0 && Number.isFinite(e.weight) ? e.weight : o.weight)
/** Area a block of aspect `a` really uses inside w × h (it keeps its proportions). */
const used = (a: number, w: number, h: number): number => { const width = Math.min(w, h * a); return width * (width / a) }

/**
 * Divide `total` (minus gaps) along one axis so that every block is drawn as large as the others allow. `need[i]` is
 * the room block i wants per unit of its drawn size and `most[i]` the most it can use (beyond it the other axis is the
 * limit and more room would stay empty). Water-filling: nobody is given room it cannot use while another block could;
 * what is left when every block is satisfied is shared out evenly, so the group stays centred. No part is below the
 * minimum share.
 */
function split(total: number, need: number[], most: number[], o: StageOptions): number[] {
  const n = need.length
  const room = Math.max(0.1, total - o.gap * (n - 1))
  const parts = new Array<number>(n).fill(0)
  const open = new Set(need.map((_, i) => i))
  let left = room
  while (open.size) {
    const sum = [...open].reduce((a, i) => a + need[i]!, 0) || 1
    const full = [...open].filter((i) => (left * need[i]!) / sum >= most[i]!)
    if (!full.length) { for (const i of open) parts[i] = (left * need[i]!) / sum; left = 0; break }
    for (const i of full) { parts[i] = most[i]!; left -= most[i]!; open.delete(i) }
  }
  if (left > 1e-9) for (let i = 0; i < n; i++) parts[i]! += left / n
  // lift what is under the floor and take it from the others in proportion
  const floor = Math.min(o.minimumShare, 1 / n) * room
  for (let pass = 0; pass < 3; pass++) {
    const low = parts.map((p) => p < floor - 1e-9)
    if (!low.some(Boolean)) break
    const fixed = low.filter(Boolean).length * floor
    const rest = parts.reduce((a, p, i) => a + (low[i] ? 0 : p), 0) || 1
    for (let i = 0; i < n; i++) parts[i] = low[i] ? floor : (parts[i]! / rest) * (room - fixed)
  }
  return parts
}
/** Widths of a row of blocks in a box `height` high: block i draws width × width / aspect and wants area in proportion to its weight. */
const rowWidths = (width: number, height: number, a: number[], w: number[], o: StageOptions): number[] => split(width, a.map((x, i) => Math.sqrt(w[i]! * x)), a.map((x) => height * x), o)
/** Heights of a column of blocks in a box `width` wide. */
const columnHeights = (width: number, height: number, a: number[], w: number[], o: StageOptions): number[] => split(height, a.map((x, i) => Math.sqrt(w[i]! / x)), a.map((x) => width / x), o)

interface Candidate { name: StageLayout['arrangement']; rects: Area[]; score: number }
/** Arrange 2D entries inside `box`: side by side, stacked, or in a grid of two columns; the arrangement in which the worst-off block is largest wins. */
function arrange(entries: StageEntry[], box: Area, o: StageOptions): Candidate {
  const n = entries.length
  if (n === 0) return { name: 'none', rects: [], score: 0 }
  if (n === 1) return { name: 'single', rects: [box], score: 1 }
  const a = entries.map((e) => aspectOf(e, o)), w = entries.map((e) => weightOf(e, o))
  const score = (rects: Area[]): number => Math.min(...rects.map((r, i) => used(a[i]!, r.width, r.height) / w[i]!))
  const out: Candidate[] = []
  {
    // a row: every block the full height; widths so that each is drawn as large as the others allow
    const widths = rowWidths(box.width, box.height, a, w, o)
    let x = box.x
    const rects = widths.map((width) => { const r = areaOf(x, box.y, width, box.height); x += width + o.gap; return r })
    out.push({ name: 'row', rects, score: score(rects) })
  }
  {
    // a column: every block the full width; heights the same way; the first on top
    const heights = columnHeights(box.width, box.height, a, w, o)
    let top = box.top
    const rects = heights.map((height) => { const r = areaOf(box.x, top - height, box.width, height); top -= height + o.gap; return r })
    out.push({ name: 'column', rects, score: score(rects) })
  }
  if (n >= 4) {
    // two columns, rows of equal height, reading order; an odd one out takes the whole last row
    const rows = Math.ceil(n / 2)
    const height = (box.height - o.gap * (rows - 1)) / rows, width = (box.width - o.gap) / 2
    const rects = entries.map((_, i) => {
      const r = Math.floor(i / 2), c = i % 2
      const alone = i === n - 1 && c === 0
      return areaOf(box.x + c * (width + o.gap), box.top - (r + 1) * height - r * o.gap, alone ? box.width : width, height)
    })
    out.push({ name: 'grid', rects, score: score(rects) })
  }
  // ties go to the first candidate (a row reads left to right like the story)
  return out.reduce((best, c) => (c.score > best.score * 1.0001 ? c : best))
}

/** Lay the blocks out. Entries keep their order: reading order on stage is the order of `stage`. */
export function layoutStage(entries: StageEntry[], opts: { title?: boolean; options?: Partial<StageOptions> } = {}): StageLayout {
  const o: StageOptions = { ...STAGE_DEFAULTS, ...(opts.options ?? {}) }
  const left = -FRAME_W / 2 + o.margin, right = FRAME_W / 2 - o.margin
  const top = FRAME_H / 2 - o.margin, bottom = -FRAME_H / 2 + o.captionStrip
  const title = opts.title ? areaOf(left, top - o.titleStrip, right - left, o.titleStrip) : null
  const content = areaOf(left, bottom, right - left, (title ? title.bottom - o.gap * 0.5 : top) - bottom)
  const rects: Record<string, Area> = {}
  const three = entries.filter((e) => e.is3d), flat = entries.filter((e) => !e.is3d)
  let panel: Area | null = null
  let box = content
  if (three.length) {
    if (flat.length) {
      // the panel on the left, the others stacked on the right
      const width = (content.width - o.gap) * o.panelShare
      panel = areaOf(content.x, content.y, width, content.height)
      box = areaOf(content.x + width + o.gap, content.y, content.width - width - o.gap, content.height)
    } else panel = content
    for (const e of three) rects[e.id] = panel
  }
  let found: Candidate
  if (three.length && flat.length > 1) {
    const heights = columnHeights(box.width, box.height, flat.map((e) => aspectOf(e, o)), flat.map((e) => weightOf(e, o)), o)
    let y = box.top
    found = { name: 'column', score: 0, rects: heights.map((height) => { const r = areaOf(box.x, y - height, box.width, height); y -= height + o.gap; return r }) }
  } else found = arrange(flat, box, o)
  flat.forEach((e, i) => { rects[e.id] = found.rects[i]! })
  return { content, title, panel, rects, arrangement: found.name, extraPanels: three.slice(1).map((e) => e.id) }
}
