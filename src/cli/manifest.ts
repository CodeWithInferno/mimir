// `shot`: which frames to render, how files are named, the manifest, and the sheet layout + page.
// Pure except sha256 (a hash of bytes). No wall-clock, no randomness.
import { createHash } from 'node:crypto'
import { estimateTiming, parseNarration, scheduleCues } from '../lib/guide/index.ts'
import type { AtItem, FrameMode, ParamValue } from './args.ts'
import { UsageError } from './errors.ts'
import { formatSeconds, type HostCue, type SceneInfo, type StepInfo } from './format.ts'

/** A guide cue a frame was shot for. Times are absolute story seconds. */
export interface CueRef {
  /** 1-based, in story order */
  index: number
  verb: string
  targets: string[]
  /** the spoken words the cue is bound to */
  words: string
  /** when the pointer lands and the mark starts to draw */
  land: number
}

export interface FramePlan {
  /** step index as reported by info().steps, or null when the scene has no steps */
  step: number | null
  title: string
  /** story time that is seeked, seconds */
  t: number
  /** file stem without view / debug suffix and extension */
  stem: string
  /** 1-based chapter the step belongs to, when the scene has chapters */
  chapter?: number | null
  cue?: CueRef
  /** set when the frame was addressed as --at name=value: the story has the parameter at this value at `t` */
  param?: { name: string; value: ParamValue }
}

export interface ManifestEntry {
  path: string
  step: number | null
  title: string
  t: number | null
  /** the view the frame was rendered from (--views name, --turntable az045), or null for the scene's own camera (DESIGN section 8) */
  camera: string | null
  width: number
  height: number
  sha256: string
  /** present (true) only when the viewer could not be rebuilt: the frame comes from the last good build, not from the current sources */
  stale?: true
  /** 1-based chapter of the frame's step, when the scene has chapters */
  chapter?: number
  /** the guide cue the frame shows (--cues) */
  cue?: CueRef
  /** the parameter value the frame was addressed by (--at name=value) */
  param?: { name: string; value: ParamValue }
  /** only on a sheet entry; tokens = what looking at it costs an image-reading model, about width x height / 750 */
  sheet?: { cols: number; rows: number; frames: number; tokens?: number; page?: number; pages?: number }
}

/**
 * The end state of a step is sampled 1 ms before its t1: t1 itself is the first instant of the next step,
 * where step-scoped marks and the caption may already belong to that next step.
 */
export const STEP_END_EPSILON = 0.001

const round3 = (t: number): number => Number(t.toFixed(3))

export function stepEndTime(t0: number, t1: number): number {
  return round3(Math.max(t0, t1 - STEP_END_EPSILON))
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** The step a story time belongs to: half-open [t0, t1); the last step also owns the final instant. */
export function stepAt(steps: readonly StepInfo[], t: number): StepInfo | undefined {
  return steps.find((x) => t >= x.t0 && t < x.t1) ?? (steps.length && t >= steps[steps.length - 1]!.t0 ? steps[steps.length - 1]! : undefined)
}

const chapterOf = (s: StepInfo | undefined): { chapter?: number } => (s && typeof s.chapter === 'number' ? { chapter: s.chapter } : {})

/** A file-name-safe rendering of a parameter value: 90, -0.5 → m0.5, true, "fast mode" → fast-mode. */
export function valueSlug(value: ParamValue): string {
  return String(value).replace(/^-/, 'm').replace(/[^\w.]+/g, '-').replace(/^-+|-+$/g, '') || 'x'
}

// ── guide cues ───────────────────────────────────────────────────────────────────────────────────

export interface CuePlanSource { cues: HostCue[]; /** who scheduled them: the viewer (info().cues), or this CLI from the narration text */ from: 'host' | 'cli' }

/**
 * The guide cues of the story in order. The viewer's own list is used when it reports one; otherwise the cues are
 * scheduled here from the narration text with the same pure library the guide uses (src/lib/guide), stretched to
 * the duration the viewer gave each sentence.
 */
export function storyCues(info: SceneInfo): CuePlanSource {
  if (info.cues) return { cues: [...info.cues].sort((a, b) => a.land - b.land), from: 'host' }
  const cues: HostCue[] = []
  for (const entry of info.transcript ?? []) {
    for (const n of entry.narration) {
      const parsed = parseNarration(n.text)
      if (parsed.spans.length === 0) continue
      const timing = estimateTiming(parsed, n.duration > 0 ? { duration: n.duration } : {})
      const schedule = scheduleCues(parsed, timing, { stepDuration: Math.max(timing.duration, entry.t1 - n.t0) })
      for (const c of schedule.cues) {
        cues.push({ step: entry.step, verb: c.verb, targets: c.targets, words: c.words, land: round3(n.t0 + c.landAt), drawn: round3(n.t0 + Math.max(c.landAt, c.drawEnd)) })
      }
    }
  }
  return { cues: cues.sort((a, b) => a.land - b.land), from: 'cli' }
}

// ── which frames ─────────────────────────────────────────────────────────────────────────────────

/**
 * Frames to render for a mode. Throws UsageError for a step or a time the scene does not have.
 * `timeOfParam` gives the story time of a --at name=value item (the page finds it; see paramTimeExpression).
 */
export function planFrames(info: SceneInfo, mode: FrameMode, timeOfParam: (item: Extract<AtItem, { kind: 'param' }>) => number = () => 0): FramePlan[] {
  const steps = info.steps
  const stepPlan = (s: (typeof steps)[number]): FramePlan => ({
    step: s.index,
    title: s.title,
    t: stepEndTime(s.t0, s.t1),
    stem: `step-${pad2(s.index)}`,
    ...chapterOf(s),
  })
  const atTime = (t: number, flag: string): FramePlan => {
    if (t > info.duration + 1e-9) {
      throw new UsageError(`${flag} ${formatSeconds(t)}: past the end of the story (duration ${formatSeconds(info.duration)}s)`, 'shot')
    }
    const s = stepAt(steps, t)
    return { step: s ? s.index : null, title: s ? s.title : info.title, t: round3(t), stem: `t-${t.toFixed(3)}`, ...chapterOf(s) }
  }
  if (mode.kind === 'steps') {
    if (steps.length === 0) return [{ step: null, title: info.title, t: round3(info.duration), stem: 'frame' }]
    return steps.map(stepPlan)
  }
  if (mode.kind === 'step') {
    const s = steps.find((x) => x.index === mode.step)
    if (!s) {
      const have = steps.length ? `steps: ${steps.map((x) => x.index).join(', ')}` : 'the scene has no steps'
      throw new UsageError(`--step ${mode.step}: no such step (${have})`, 'shot')
    }
    return [stepPlan(s)]
  }
  if (mode.kind === 'fine') {
    if (mode.t1 > info.duration + 1e-9) {
      throw new UsageError(`--fine ${formatSeconds(mode.t0)}:${formatSeconds(mode.t1)}:${mode.count}: past the end of the story (duration ${formatSeconds(info.duration)}s)`, 'shot')
    }
    return Array.from({ length: mode.count }, (_, i) => atTime(mode.t0 + ((mode.t1 - mode.t0) * i) / (mode.count - 1), '--fine'))
  }
  if (mode.kind === 'cues') {
    const { cues } = storyCues(info)
    if (cues.length === 0) {
      throw new UsageError(
        '--cues: the narration of this scene has no guide cue. A cue is a span in st.say(): ' +
          "st.say('The [piston](piston) slides down and the [valve](ring:valve) opens.')",
        'shot',
      )
    }
    return cues.map((c, i): FramePlan => {
      const s = steps.find((x) => x.index === c.step) ?? stepAt(steps, c.land)
      // the frame shows the mark fully drawn, and never leaves the cue's own step
      const t = round3(s ? Math.min(Math.max(c.drawn, c.land), Math.max(s.t0, s.t1 - STEP_END_EPSILON)) : Math.max(c.drawn, c.land))
      return {
        step: s ? s.index : null, title: s ? s.title : info.title, t, stem: `cue-${pad2(i + 1)}`, ...chapterOf(s),
        cue: { index: i + 1, verb: c.verb, targets: c.targets, words: c.words, land: c.land },
      }
    })
  }
  return mode.items.map((item) => {
    if (item.kind === 'time') return atTime(item.t, '--at')
    const t = timeOfParam(item)
    const plan = atTime(t, '--at')
    return { ...plan, stem: `at-${item.name.replace(/[^\w.]+/g, '-')}-${valueSlug(item.value)}`, param: { name: item.name, value: item.value } }
  })
}

export function frameFileStem(plan: Pick<FramePlan, 'stem'>, view: string | null, debug: string | null): string {
  return plan.stem + (view ? `.${view}` : '') + (debug ? `.debug-${debug}` : '')
}

/** Camera angles of a turntable: n azimuths in degrees, evenly spaced over the full turn, starting at the front (0). */
export function turntableAngles(count: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.round((360 * i * 1000) / count) / 1000)
}

/** Name of a turntable view in file names and in the manifest: az000, az045, az112.5. */
export function turntableName(azimuth: number): string {
  const whole = Math.floor(azimuth)
  const frac = Math.round((azimuth - whole) * 1000) / 1000
  return `az${String(whole).padStart(3, '0')}${frac ? String(frac).slice(1) : ''}`
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

// ── contact sheet ────────────────────────────────────────────────────────────────────────────────

export interface SheetLayout {
  cols: number
  rows: number
  cellWidth: number
  cellHeight: number
  captionHeight: number
  pad: number
  gap: number
  width: number
  height: number
}

/** widest sheet: at 1280 px a sheet costs an image-reading model about 1 to 2 thousand tokens (measured) */
export const SHEET_MAX_WIDTH = 1280
/** tallest sheet page: image readers scale the long edge down to about 2000 px, which would blur the cells */
export const SHEET_MAX_HEIGHT = 2000
export const SHEET_PAD = 8
export const SHEET_GAP = 8
export const SHEET_CAPTION = 26
/** height of a chapter heading row */
export const SHEET_HEADER = 30
/** below this a cell is too small to judge composition (05 section 5.2: keep the short side above 200 px) */
export const SHEET_MIN_CELL = 400
/** a filmstrip shows motion, not composition: its cells may be this narrow */
export const STRIP_MIN_CELL = 300
/** image tokens are about width x height / 750 (measured) */
export const TOKENS_PER_PIXEL = 1 / 750

export const imageTokens = (width: number, height: number): number => Math.round(width * height * TOKENS_PER_PIXEL)

/** Grid for `count` frames of frameWidth×frameHeight, at most `maxWidth` px wide. Exact pixel size of the PNG. */
export function sheetLayout(count: number, frameWidth: number, frameHeight: number, maxWidth = SHEET_MAX_WIDTH, minCell = SHEET_MIN_CELL, colsWanted: number | null = null): SheetLayout {
  const n = Math.max(1, count)
  const maxCols = Math.max(1, Math.floor(maxWidth / minCell))
  const cols = colsWanted !== null ? Math.max(1, Math.min(colsWanted, n)) : n <= maxCols ? n : Math.min(maxCols, Math.ceil(Math.sqrt(n)))
  const rows = Math.ceil(n / cols)
  // never upscale: a cell is at most as wide as the frame it shows
  const cellWidth = Math.min(frameWidth, Math.floor((maxWidth - 2 * SHEET_PAD - (cols - 1) * SHEET_GAP) / cols))
  const cellHeight = Math.round((cellWidth * frameHeight) / frameWidth)
  return {
    cols,
    rows,
    cellWidth,
    cellHeight,
    captionHeight: SHEET_CAPTION,
    pad: SHEET_PAD,
    gap: SHEET_GAP,
    width: 2 * SHEET_PAD + cols * cellWidth + (cols - 1) * SHEET_GAP,
    height: 2 * SHEET_PAD + rows * (cellHeight + SHEET_CAPTION) + (rows - 1) * SHEET_GAP,
  }
}

export interface SheetCell {
  src: string
  step: number | null
  title: string
  t: number
  view: string | null
  /** what the round badge shows instead of the step number (a cue number); '' = no badge */
  badge?: string
  /** what the caption says instead of the step title (a cue: `ring piston · "the piston"`) */
  label?: string
  /** 1-based chapter, when the sheet has a row per chapter */
  chapter?: number | null
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Caption of a cell: step number, title, time (and the view when one was asked for). */
export function sheetCaption(cell: SheetCell): { left: string; right: string } {
  const badge = cell.badge ?? (cell.step !== null ? String(cell.step) : '')
  const left = (badge !== '' ? `${badge}  ` : '') + (cell.label ?? cell.title)
  const right = `t=${cell.t.toFixed(2)}s` + (cell.view ? `  ${cell.view}` : '')
  return { left, right }
}

const SHEET_CSS = (l: SheetLayout): string => `
figure{margin:0;width:${l.cellWidth}px;height:${l.cellHeight + l.captionHeight}px;background:#1b1b1f}
img{display:block;width:${l.cellWidth}px;height:${l.cellHeight}px;background:#000;object-fit:contain}
figcaption{display:flex;align-items:center;gap:8px;height:${l.captionHeight}px;padding:0 8px;box-sizing:border-box;
font:500 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#e8e8ea;white-space:nowrap}
b{flex:none;min-width:18px;height:18px;padding:0 4px;box-sizing:border-box;border-radius:9px;background:#58c4dd;color:#000;
font-weight:700;font-size:12px;line-height:18px;text-align:center}
.t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.s{flex:none;color:#9a9aa2;font-variant-numeric:tabular-nums}`

function figure(c: SheetCell, l: SheetLayout): string {
  const cap = sheetCaption(c)
  const badge = c.badge ?? (c.step !== null ? String(c.step) : '')
  const num = badge !== '' ? `<b>${esc(badge)}</b>` : ''
  return (
    `<figure><img src="${esc(c.src)}" width="${l.cellWidth}" height="${l.cellHeight}" alt="">` +
    `<figcaption>${num}<span class="t">${esc(c.label ?? c.title)}</span><span class="s">${esc(cap.right)}</span></figcaption></figure>`
  )
}

/** The page that is screenshotted to make the sheet. Fixed pixel geometry, no scripts, no external fonts. */
export function sheetHtml(cells: readonly SheetCell[], l: SheetLayout): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>mimir contact sheet</title>
<style>
html,body{margin:0;background:#101012;width:${l.width}px;height:${l.height}px;overflow:hidden}
main{display:grid;grid-template-columns:repeat(${l.cols},${l.cellWidth}px);gap:${l.gap}px;padding:${l.pad}px}${SHEET_CSS(l)}
</style></head><body><main>
${cells.map((c) => figure(c, l)).join('\n')}
</main></body></html>
`
}

// ── story sheet: a row of cells per chapter, as many pages as it takes ───────────────────────────────

export interface SheetGroup {
  /** heading of the row ("Chapter 2 · Compression"), or null for a sheet without chapters */
  heading: string | null
  /** shown at the right of the heading: the chapter's time range */
  range: string | null
  cells: SheetCell[]
}

export interface SheetPage {
  groups: SheetGroup[]
  /** rows of cells on this page */
  rows: number
  frames: number
  width: number
  height: number
}

export interface StoryLayout {
  cell: SheetLayout
  pages: SheetPage[]
}

/** Cells in story order grouped by chapter; one group without a heading when the scene has no chapters. */
export function groupByChapter(cells: readonly SheetCell[], info: Pick<SceneInfo, 'chapters'>): SheetGroup[] {
  const chapters = info.chapters ?? []
  if (chapters.length === 0 || cells.every((c) => typeof c.chapter !== 'number')) return [{ heading: null, range: null, cells: [...cells] }]
  const groups: SheetGroup[] = []
  let key: number | null | undefined
  for (const c of cells) {
    const chapter = typeof c.chapter === 'number' ? c.chapter : null
    if (groups.length === 0 || chapter !== key) {
      const ch = chapter === null ? undefined : chapters.find((x) => x.index === chapter)
      groups.push({
        heading: ch ? `Chapter ${ch.index} · ${ch.title}` : chapter === null ? 'Before the first chapter' : `Chapter ${chapter}`,
        range: ch ? `${ch.t0.toFixed(1)} s – ${ch.t1.toFixed(1)} s` : null,
        cells: [],
      })
      key = chapter
    }
    groups[groups.length - 1]!.cells.push(c)
  }
  return groups
}

/**
 * Lay groups of cells out as pages no taller than `maxHeight`: every group starts on a new row under its heading;
 * a group that does not fit on the rest of a page continues on the next one (with its heading repeated).
 */
export function storyLayout(
  groups: readonly SheetGroup[], frameWidth: number, frameHeight: number,
  opts: { maxWidth?: number; maxHeight?: number; minCell?: number; cols?: number | null } = {},
): StoryLayout {
  const maxWidth = opts.maxWidth ?? SHEET_MAX_WIDTH
  const maxHeight = opts.maxHeight ?? SHEET_MAX_HEIGHT
  const widest = Math.max(1, ...groups.map((g) => g.cells.length))
  const total = groups.reduce((n, g) => n + g.cells.length, 0)
  const minCell = opts.minCell ?? SHEET_MIN_CELL
  // Several groups: a chapter reads best on one row, so the longest chapter sets the columns as long as a cell stays
  // at least a strip cell wide; longer chapters wrap at the width that keeps cells readable.
  const fit = Math.max(1, Math.floor(maxWidth / Math.min(minCell, STRIP_MIN_CELL)))
  const chapterCols = widest <= fit ? widest : Math.max(1, Math.floor(maxWidth / minCell))
  // one group: the grid of a plain contact sheet
  const cell = groups.length <= 1
    ? sheetLayout(total, frameWidth, frameHeight, maxWidth, minCell, opts.cols ?? null)
    : sheetLayout(widest, frameWidth, frameHeight, maxWidth, minCell, opts.cols ?? chapterCols)
  const rowH = cell.cellHeight + cell.captionHeight
  const fill = (limit: number): SheetPage[] => {
    const pages: SheetPage[] = []
    let page: SheetPage = { groups: [], rows: 0, frames: 0, width: cell.width, height: 2 * cell.pad }
    const close = (): void => {
      if (page.groups.length) pages.push(page)
      page = { groups: [], rows: 0, frames: 0, width: cell.width, height: 2 * cell.pad }
    }
    for (const g of groups) {
      let rest = [...g.cells]
      let first = true
      while (rest.length) {
        const head = g.heading !== null ? SHEET_HEADER : 0
        const lead = page.groups.length ? cell.gap : 0
        // rows of this group that still fit on the page (at least one, on an empty page, whatever the limit)
        const room = Math.floor((limit - page.height - lead - head + cell.gap) / (rowH + cell.gap))
        if (room < 1 && page.groups.length) { close(); continue }
        const rows = Math.max(1, Math.min(room, Math.ceil(rest.length / cell.cols)))
        const take = rest.slice(0, rows * cell.cols)
        rest = rest.slice(take.length)
        page.groups.push({ heading: g.heading === null ? null : first ? g.heading : `${g.heading} (continued)`, range: g.range, cells: take })
        page.height += lead + head + rows * rowH + (rows - 1) * cell.gap
        page.rows += rows
        page.frames += take.length
        first = false
        if (rest.length) close()
      }
    }
    close()
    return pages
  }
  // As few pages as the limit allows, and those of about the same height: a last page with one row helps nobody.
  const whole = fill(Infinity)[0]?.height ?? 2 * cell.pad
  const count = Math.max(1, Math.ceil(whole / maxHeight))
  const even = fill(Math.min(maxHeight, Math.ceil(whole / count) + rowH + SHEET_HEADER))
  const pages = even.length <= count ? even : fill(maxHeight)
  return { cell, pages }
}

/** One page of a story sheet. Fixed pixel geometry, no scripts, no external fonts. */
export function storyHtml(page: SheetPage, l: SheetLayout): string {
  const body = page.groups.map((g) => {
    const head = g.heading === null ? '' : `<h2><span>${esc(g.heading)}</span>${g.range ? `<i>${esc(g.range)}</i>` : ''}</h2>\n`
    return `${head}<section>\n${g.cells.map((c) => figure(c, l)).join('\n')}\n</section>`
  })
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>mimir story sheet</title>
<style>
html,body{margin:0;background:#101012;width:${page.width}px;height:${page.height}px;overflow:hidden}
main{display:flex;flex-direction:column;gap:${l.gap}px;padding:${l.pad}px}
section{display:grid;grid-template-columns:repeat(${l.cols},${l.cellWidth}px);gap:${l.gap}px}
h2{margin:0 0 -${l.gap}px;height:${SHEET_HEADER}px;display:flex;align-items:center;justify-content:space-between;box-sizing:border-box;padding:0 4px;
font:600 14px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#f0ac5f;white-space:nowrap}
h2 span{min-width:0;overflow:hidden;text-overflow:ellipsis}
h2 i{flex:none;font-style:normal;font-weight:500;font-size:12px;color:#9a9aa2;font-variant-numeric:tabular-nums}${SHEET_CSS(l)}
</style></head><body><main>
${body.join('\n')}
</main></body></html>
`
}

// ── --debug ids: every part outlined in its own colour, and a legend colour → id ──────────────────────

export interface LegendItem {
  /** 1-based number drawn on the part and in the legend */
  n: number
  id: string
  color: string
  /** stage px (CSS px of the frame), or null when the part draws nothing in this frame */
  rect: { x: number; y: number; width: number; height: number } | null
  /** a visible pixel of the part (3D parts, from the id pass), or null */
  at: { x: number; y: number } | null
  space: string
}

/** hue step between consecutive legend colours: the golden angle keeps neighbours far apart for any count */
export const LEGEND_HUE_STEP = 137.508
/** Colour of the i-th part (0-based) of a scene: the same part has the same colour in every frame. */
export function legendColor(i: number): string {
  const hue = Math.round(((i * LEGEND_HUE_STEP) % 360) * 10) / 10
  // alternate two lightness levels so that close hues still differ
  return `hsl(${hue} 90% ${i % 2 === 0 ? 62 : 74}%)`
}

/**
 * The page that is screenshotted for a --debug ids frame: the frame, every visible part outlined and numbered in
 * its own colour, and under it the legend (number, colour, id). The legend wraps; the page reports its height.
 */
export function legendHtml(frameSrc: string, width: number, height: number, items: readonly LegendItem[]): string {
  const shown = items.filter((i) => i.rect !== null)
  const boxes = shown.map((i) => {
    const r = i.rect!
    // the number sits above the top-left corner of the box, or just inside it when the box touches the top edge
    const tx = Math.min(Math.max(r.x, 2), width - 22)
    const ty = r.y >= 14 ? r.y - 3 : Math.min(r.y + 13, height - 4)
    return (
      `<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${Math.max(1, r.width).toFixed(1)}" height="${Math.max(1, r.height).toFixed(1)}" fill="none" stroke="${i.color}" stroke-width="1.5"/>` +
      (i.at ? `<circle cx="${i.at.x.toFixed(1)}" cy="${i.at.y.toFixed(1)}" r="3" fill="${i.color}" stroke="#000" stroke-width="1"/>` : '') +
      `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" fill="${i.color}">${i.n}</text>`
    )
  })
  const legend = shown.map((i) => `<li><i style="background:${i.color}"></i><b>${i.n}</b>${esc(i.id)}</li>`)
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>mimir debug ids</title>
<style>
html,body{margin:0;background:#101012;width:${width}px}
.f{position:relative;width:${width}px;height:${height}px}
.f img,.f svg{position:absolute;left:0;top:0;width:${width}px;height:${height}px;display:block}
text{font:700 12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;paint-order:stroke;stroke:#000;stroke-width:3px}
ul{margin:0;padding:8px 10px;list-style:none;display:flex;flex-wrap:wrap;gap:4px 16px;
font:500 13px/18px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#e8e8ea}
li{display:flex;align-items:center;gap:6px;white-space:nowrap}
li i{width:12px;height:12px;border-radius:2px;flex:none}
li b{color:#9a9aa2;font-weight:500}
</style></head><body>
<div class="f"><img src="${esc(frameSrc)}" alt=""><svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${boxes.join('')}</svg></div>
<ul>${legend.join('')}</ul>
</body></html>
`
}

/** Human-readable manifest for a terminal: one line per file, the sheet last. */
export function formatManifestText(entries: readonly ManifestEntry[]): string {
  const lines = entries.map((e) => {
    if (e.sheet) return `sheet ${e.sheet.cols}x${e.sheet.rows}  ${e.width}x${e.height}  ${e.path}`
    const what = (e.step !== null ? `step ${e.step} ` : '') + (e.title !== '' ? `"${e.title}" ` : '')
    const extra = (e.cue ? ` cue ${e.cue.index} ${e.cue.verb}:${e.cue.targets.join('+')}` : '') + (e.param ? ` ${e.param.name}=${String(e.param.value)}` : '')
    return `${what}t=${e.t === null ? '?' : formatSeconds(e.t)}s${e.camera ? ` ${e.camera}` : ''}${extra}  ${e.width}x${e.height}  ${e.path}`
  })
  return lines.join('\n') + '\n'
}
