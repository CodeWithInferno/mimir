// Where everything stands for one window size (UI design specification 5). Measured once per size and cached; a frame
// only reads it. Pure: the window, the tokens and the safe areas go in, numbers come out. Unit tests:
// tests/unit/player/layout.test.ts.
import { clamp } from './motion.ts'

/** The tokens the layout needs, as numbers of px. Read from the stylesheet in the page (so the two cannot disagree). */
export interface Tokens { lhCaption: number; fsUi: number; lhUi: number; fsBody: number; lhBody: number; fsSmall: number; lhSmall: number; fsHead: number; lhHead: number; fsTitle: number; lhTitle: number; gutter: number; col: number; note: number; first: number; clear: number; row: number; page: number }
export interface Safe { top: number; right: number; bottom: number; left: number }
export interface Box { x: number; y: number; width: number; height: number }

// ── named defaults (spec 5.8, 5.9) ─────────────────────────────────────────────────────────────────────
export const LAYOUT = {
  /** a window under this height that is wider than tall is "short" (a phone on its side) */
  shortHeight: 520,
  /** a window this wide or narrower is a phone */
  phoneWidth: 760,
  /** under this width the read column goes under the stage */
  stackWidth: 1040,
  /** page margin: this share of the width, between min and max */
  margin: { share: 0.05, min: 20, max: 72 },
  /** top row height: desktop, phone, short */
  top: { desktop: 60, phone: 56, short: 44 },
  /** the line of time, measured up from the bottom of the window */
  axis: { desktop: 66, phone: 84, short: 44 },
  /** centre of the transport row, measured up from the bottom */
  transport: { desktop: 32, phone: 36, short: 19 },
  /** height of the line's hit band, and where the axis sits in it */
  band: 44, axisInBand: 22,
  /** the stage ends this far above the axis in watch mode (the chapter names stand between) */
  stageFoot: { desktop: 44, phone: 52, short: 42 },
  /** read: the stage ends this far above the axis, the column this far; stacked, the stage takes this share of the height at most */
  readFoot: 56, columnFoot: 40, columnFootStacked: 54, stackShare: 0.42,
  /** read column: this share of the width, between min and the --col token; short windows: this share, at most max */
  column: { share: 0.31, min: 340, shortShare: 0.42, shortMax: 340 },
  /** the number line begins this far inside the free stage in read mode */
  readLineInset: 24,
  /** the right column: this share of the width, between min and the --note token */
  note: { share: 0.235, min: 264 },
  /** palette and erratum: this wide at the left */
  layer: 470,
  /** the parts index: a gutter for group names, then the names; between min and max */
  index: { gutter: 96, min: 220, max: 340, name: 165 },
  /** explore: the line that says what the lit part is (lines of body type), its foot above the axis, and the air above it */
  hint: { lines: 2, foot: 60, footPhone: 42, air: 22 },
  /** explore on a phone: the stage takes this share of the height at most; the panel ends this far above the axis */
  exploreShare: 0.45, exploreFoot: 46,
  /** explore: index and givens stand either side of the stage only while the stage keeps this share of its watch width */
  exploreKeep: 0.62,
  /** a note on a phone: the stage keeps at least this share of the height, and ends this far above the sheet */
  sheetKeep: 0.3, sheetAir: 12,
  /** a first baseline for short windows */
  firstShort: 70,
  /** a frame narrower than this (px) cannot carry captions that can be read: the player sets them under the stage */
  captionOwnBelow: 760,
  /** the stage's own aspect (the engine's frame) */
  aspect: 16 / 9,
} as const

export interface Metrics {
  W: number; H: number; safe: Safe
  short: boolean; phone: boolean; stack: boolean
  /** 1, or 1.125 on a large display (type and columns grow together) */
  k: number
  mx: number; top: number; topH: number; axisY: number; transY: number; first: number
  /** watch: where the stage ends */
  stageBottom: number
  /** the frame would be too narrow for the engine's own captions to be read: the player sets them under the stage instead */
  ownCaptions: boolean
  // read
  colX: number; colW: number; colTop: number; colBottom: number; readLeft: number; readLine: number; readBottom: number
  // the right column and the layer at the left
  noteX: number; noteW: number; layerW: number
  /** tops of what hangs from the first baseline: a line to write on, the givens' first group name, a note's headword, the share link, the palette's line, the tabs */
  yLine: number; yGiven: number; yNote: number; yShare: number; yPalette: number; yTabs: number
  // explore
  hintTop: number; hintH: number; exBottom: number; exFoot: number; exStack: boolean; exDock: boolean; exTabs: boolean; idxX: number; idxW: number; idxGutter: number
  tokens: Tokens
}

/** How far under the top of its line box a line of type has its baseline (Computer Modern's ascent is about three quarters of an em). */
export const baseOf = (fontSize: number, lineHeight: number): number => Math.round((lineHeight - fontSize) / 2 + fontSize * 0.76)

/** The engine letterboxes its 16:9 frame into the slot it is given (Runtime.layout): the same sums, so the player knows where the frame is. */
export function letterbox(slot: Box): Box {
  const sw = Math.max(1, slot.width), sh = Math.max(1, slot.height)
  const w = Math.max(16, Math.floor(Math.min(sw, sh * LAYOUT.aspect) + 1e-6)), h = Math.round(w / LAYOUT.aspect)
  return { x: slot.x + Math.floor((sw - w) / 2), y: slot.y + Math.floor((sh - h) / 2), width: w, height: h }
}

export function measure(W: number, H: number, tokens: Tokens, safe: Safe = { top: 0, right: 0, bottom: 0, left: 0 }): Metrics {
  const short = H < LAYOUT.shortHeight && W > H, phone = W <= LAYOUT.phoneWidth && !short, stack = W < LAYOUT.stackWidth && !short
  const k = tokens.fsUi / 17
  const kind = phone ? 'phone' : short ? 'short' : 'desktop'
  const mx = Math.round(Math.max(clamp(W * LAYOUT.margin.share, LAYOUT.margin.min, LAYOUT.margin.max), (W - tokens.page) / 2) + Math.max(safe.left, safe.right))
  const topH = LAYOUT.top[kind], top = safe.top + topH
  const axisY = H - safe.bottom - LAYOUT.axis[kind], transY = H - safe.bottom - LAYOUT.transport[kind]
  const first = safe.top + (short ? LAYOUT.firstShort : tokens.first)
  // a frame too narrow to carry its own captions leaves room for the player's under it
  const wide = letterbox({ x: 0, y: top, width: W, height: axisY - LAYOUT.stageFoot[kind] - top }).width
  const ownCaptions = wide < LAYOUT.captionOwnBelow
  const capLines = phone ? 3 : 2
  const stageBottom = ownCaptions && !short ? axisY - (phone ? LAYOUT.hint.footPhone : LAYOUT.hint.foot) - capLines * tokens.lhCaption - (phone ? 12 : 22) : axisY - LAYOUT.stageFoot[kind]
  // read: a column beside the stage, or under it when there is no room
  const colW = stack ? W - 2 * mx : short ? Math.round(Math.min(LAYOUT.column.shortMax, W * LAYOUT.column.shortShare)) : Math.round(clamp(W * LAYOUT.column.share, LAYOUT.column.min, tokens.col))
  const colX = mx + (stack ? 0 : tokens.gutter)
  const readLeft = stack ? 0 : colX + colW
  const readLine = stack || short ? mx : readLeft + tokens.clear + LAYOUT.readLineInset
  const frameH = Math.ceil(W / LAYOUT.aspect) // what the frame needs at the window's full width
  const readBottom = stack ? Math.min(Math.round(H * LAYOUT.stackShare), top + frameH) : short ? stageBottom : axisY - LAYOUT.readFoot
  const colBottom = stack ? axisY - LAYOUT.columnFootStacked : short ? stageBottom + 4 : axisY - LAYOUT.columnFoot
  const colTop = stack ? readBottom + 14 : first - baseOf(tokens.fsTitle, tokens.lhTitle)
  // the one column at the right, and the layer at the left
  const noteW = phone ? W - 2 * mx : Math.round(clamp(W * LAYOUT.note.share, LAYOUT.note.min, tokens.note))
  const noteX = W - mx - noteW
  const layerW = Math.round(Math.min(LAYOUT.layer * k, W - 2 * mx))
  // explore
  const hintH = LAYOUT.hint.lines * tokens.lhBody
  const hintTop = (short ? H - safe.bottom - 12 : axisY - (phone ? LAYOUT.hint.footPhone : LAYOUT.hint.foot)) - hintH
  const exStack = phone
  const idxGutter = Math.round(LAYOUT.index.gutter * k)
  const idx3 = Math.round(clamp(idxGutter + 17 + LAYOUT.index.name * k + 8, LAYOUT.index.min, LAYOUT.index.max * k))
  // index left and givens right while the stage between them keeps its size; otherwise tabs, docked at the right (or under the stage)
  const between = noteX - tokens.clear - (mx + idx3 + tokens.clear)
  const exDock = !exStack && between < LAYOUT.exploreKeep * letterbox({ x: 0, y: top, width: W, height: stageBottom - top }).width
  const exTabs = exStack || exDock
  const exBottom = exStack ? Math.min(Math.round(H * LAYOUT.exploreShare), top + frameH) : short ? stageBottom : hintTop - LAYOUT.hint.air
  const exFoot = exStack ? axisY - LAYOUT.exploreFoot : short ? stageBottom + 4 : hintTop - 32
  return {
    W, H, safe, short, phone, stack, k, mx, top, topH, axisY, transY, first, stageBottom, ownCaptions,
    colX, colW, colTop, colBottom, readLeft, readLine, readBottom, noteX, noteW, layerW,
    yLine: first - 5 - baseOf(tokens.fsUi, tokens.lhUi), yGiven: first - baseOf(tokens.fsSmall, tokens.lhSmall), yNote: first - baseOf(tokens.fsHead, tokens.lhHead), yShare: first - baseOf(tokens.fsUi, tokens.lhUi),
    yPalette: first - 8 - baseOf(tokens.fsHead, tokens.lhHead), yTabs: first - 6 - baseOf(tokens.fsUi, tokens.lhUi),
    hintTop, hintH, exBottom, exFoot, exStack, exDock, exTabs, idxX: exStack ? mx : exDock ? noteX : mx, idxW: exStack ? W - 2 * mx : exDock ? noteW : idx3, idxGutter: exTabs ? 0 : idxGutter,
    tokens,
  }
}

/** What is open beside or over the stage: the stage keeps clear of it. */
export interface Open { mode: 'video' | 'read' | 'explore'; /** a note, an answer or the share list stands in the right column */ right: boolean; /** the palette or the erratum stands at the left */ left: boolean; /** px of a phone sheet's height (0 = none) */ sheet: number }
/**
 * The free stage: what the modes and whatever is open leave for the scene (spec 5.10). The scene's frame is
 * letterboxed inside it. Nothing typeset comes within `clear` px of it.
 */
export function freeStage(L: Metrics, o: Open): Box {
  const clear = L.tokens.clear
  let x0 = 0, x1 = L.W, y0 = L.top, y1 = L.stageBottom
  if (o.mode === 'read') {
    y1 = L.readBottom
    if (!L.stack) { x0 = L.readLeft + clear; x1 = L.W - L.mx }
  } else if (o.mode === 'explore') {
    y1 = L.exBottom
    if (!L.exStack) { x1 = (L.exDock ? L.idxX : L.noteX) - clear; x0 = L.exDock ? L.mx : L.mx + L.idxW + clear }
  }
  if (!L.phone) {
    if (o.right) x1 = Math.min(x1, L.noteX - clear)
    if (o.left) x0 = Math.max(x0, L.mx + L.layerW + clear)
  } else if (o.sheet > 0) {
    y1 = Math.min(y1, Math.max(L.top + Math.round(L.H * LAYOUT.sheetKeep), L.H - o.sheet - LAYOUT.sheetAir))
  }
  if (x1 - x0 < 64) { const mid = (x0 + x1) / 2; x0 = mid - 32; x1 = mid + 32 } // never nothing: a sliver is still a stage
  return { x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.max(36, Math.round(y1 - y0)) }
}
/** The transform that shows a box drawn at `to` as if it stood at `at` (translate, then a uniform scale about its corner). */
export function carryBox(at: Box, to: Box): { x: number; y: number; scale: number } {
  return { x: at.x - to.x, y: at.y - to.y, scale: to.width > 0 ? at.width / to.width : 1 }
}
export const mixBox = (a: Box, b: Box, t: number): Box => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, width: a.width + (b.width - a.width) * t, height: a.height + (b.height - a.height) * t })
