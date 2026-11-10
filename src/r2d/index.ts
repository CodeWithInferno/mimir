// 2D: frame-space kinds (text, shapes, lines and arrows, containers), layout, typography, and the SVG backend.
// Importing this file touches no DOM; the backend only does when a Runtime mounts it. Constructors, schemas, bounds,
// anchors and outlines are here; the drawing side of the newer shapes is in ./shapes.chunk.ts and the embedded faces
// are in ./fonts.chunk.ts (lazy chunks, loaded by the names a scene uses).
import { defineFinalize, defineKind, boxOf, kindOf, type SceneModel } from '../core/index.ts'
import { arrow, BACKSTROKE, circle, column, group, HEAD, line, LINE_HEIGHT, rect, row, text, TEXT_BOX_EM } from './kinds.ts'
import { arc, brace, BRACE, dot, DOT_RADIUS, ellipse, path, polygon, polyline } from './shapes.ts'
import { grid, LAYOUT, ring } from './layout.ts'
import { BACKSTROKE_COLOR, BACKSTROKE_FROM, CREATE, WRITE } from './svg.ts'
import { FONT_CHUNK } from './type.ts'
import './svg.ts'

/** returned when a 2D object cannot be built at all: draws a small red cross, accepts every method */
export const placeholder = defineKind({ name: 'placeholder', space: '2d', inert: true, schema: {}, bounds: () => boxOf(0.15, 0.15, 0) })

/**
 * Every piece of text on the stage is set in the embedded faces, whoever draws it: a scene needs the fonts chunk when
 * it has an object that is text or draws text of its own (kinds with `text` or `textRects`), or when it says anything
 * (captions). A module whose overlay shows other text asks for it itself: model.requireChunk(FONT_CHUNK).
 */
defineFinalize('r2d.fonts', (model) => {
  if (model.steps.some((s) => s.narration.length) || model.nodes.some((n) => { const k = kindOf(n.kind); return !!k && (k.text === true || !!k.textRects) })) model.requireChunk(FONT_CHUNK)
})

export * from './kinds.ts'
export * from './shapes.ts'
export * from './layout.ts'
export * from './type.ts'
export { BACKSTROKE_COLOR, CREATE, WRITE } from './svg.ts'
export type { Canvas2D, Ctx2D } from './svg.ts'

/**
 * Every default that shapes what the 2D layer draws, under one name each (the values live beside the code that uses
 * them: ./kinds.ts, ./shapes.ts, ./layout.ts, ./svg.ts). Text sizes are the core's TEXT_SIZES.
 */
export const R2D_DEFAULTS = {
  /** line height of text in ems, and the height of one line's box as a share of the font size */
  lineHeight: LINE_HEIGHT, textBoxEm: TEXT_BOX_EM,
  /** the black outline behind text: width (1 = 0.01 units), colour, and the luminance from which a text gets one */
  backstroke: BACKSTROKE, backstrokeColor: BACKSTROKE_COLOR, backstrokeFrom: BACKSTROKE_FROM,
  /** radius of dot() */
  dotRadius: DOT_RADIUS,
  /** arrow heads, braces, row / column / grid / ring gaps */
  head: HEAD, brace: BRACE, layout: LAYOUT,
  /** how write() and create() draw a shape on */
  write: WRITE, create: CREATE,
}
/**
 * The defaults of this module as one scene sees them: `R2D_DEFAULTS`, with whatever the engine's config store holds
 * under 'r2d.<name>' (model.config('r2d.<name>', fallback), when the core has one). Worked out once per scene.
 */
export const r2dDefaults = (model: SceneModel): typeof R2D_DEFAULTS => model.store<typeof R2D_DEFAULTS>('r2d.defaults', () => {
  const ask = (model as unknown as { config?: (key: string, fallback: unknown) => unknown }).config
  if (typeof ask !== 'function') return R2D_DEFAULTS
  const out = { ...R2D_DEFAULTS } as Record<string, unknown>
  for (const key of Object.keys(out)) { const v = ask.call(model, 'r2d.' + key, out[key]); if (v !== undefined && typeof v === typeof out[key]) out[key] = v }
  return out as typeof R2D_DEFAULTS
})

export const api = { text, rect, circle, line, arrow, group, row, column, ellipse, dot, polyline, polygon, path, arc, brace, grid, ring }
