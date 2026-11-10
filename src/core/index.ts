// Core: environment-agnostic. Everything here runs under bun with no DOM.
// `api` = the public names this module contributes to `import { … } from 'mimir'` and to globalThis.
import './setters.ts'
import './story.ts'
import { mix, ramp, PALETTE } from './color.ts'
import { RATES, RATE_ALIASES, bezier, notQuiteThere, squish } from './rate.ts'
import { scene } from './scene.ts'
import { all, lagged, seq } from './story.ts'
import { BACK, DL, DOWN, DR, FRONT, LEFT, ORIGIN, RIGHT, UL, UP, UR } from './setters.ts'
import { FRAME_H, FRAME_W } from './model.ts'

export * from './math.ts'
export * from './color.ts'
export * from './rate.ts'
export * from './diagnostics.ts'
export * from './schema.ts'
export * from './node.ts'
export * from './ledger.ts'
export * from './config.ts'
export * from './registry.ts'
export * from './timeline.ts'
export * from './model.ts'
export * from './frame.ts'
export * from './camera.ts'
export * from './scene.ts'
export * from './story.ts'
export * from './setters.ts'
export * from './text.ts'
export * from './runtime.ts'
export { ctx, currentModel } from './context.ts'

export const api = {
  scene,
  // colour
  ...PALETTE, mix, ramp,
  // directions and frame
  UP, DOWN, LEFT, RIGHT, UL, UR, DL, DR, FRONT, BACK, ORIGIN, FRAME_W, FRAME_H,
  // rate functions (camelCase is canonical; manim's snake_case spellings are accepted too)
  ...RATES, ...RATE_ALIASES, bezier, notQuiteThere, squish,
  // combinators
  all, seq, lagged,
}
