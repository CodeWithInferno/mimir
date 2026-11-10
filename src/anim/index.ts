// Animation verbs and step transitions (pure side, main chunk). A verb returns an Anim for st.play(); recording it
// appends clips, so the state at any time is sampled, never replayed. What has to be drawn for a verb (the shape
// between two shapes, the pulse of flashAround, the glyph-by-glyph write) is in the module's lazy chunk
// (./anim.chunk.ts), loaded only by scenes that use those verbs.
//   ./shared.ts       defaults, the { duration, rate, lag, span } options, staggering, measuring "at rest"
//   ./verbs.ts        write create uncreate fadeIn fadeOut grow growArrow rotate moveAlong indicate count vary timed
//   ./morph.ts        transform derive fadeTransform flashAround (+ the stand-in kinds they draw with)
//   ./transitions.ts  what happens between two steps
// The combinators (all, seq, lagged), m.to.<setter> and param.to(v) live in the core because the recorder itself
// needs them; timed() gives any of them a duration, a rate or a span of its own.
import { currentModel } from '../core/index.ts'
import { count, create, fadeIn, fadeOut, grow, growArrow, indicate, moveAlong, rotate, timed, uncreate, vary, write } from './verbs.ts'
import { derive, fadeTransform, flashAround, transform } from './morph.ts'
import './transitions.ts'

export * from './shared.ts'
export * from './verbs.ts'
export * from './morph.ts'
export * from './transitions.ts'
export { currentModel }

export const api = {
  write, create, uncreate, fadeIn, fadeOut, grow, growArrow,
  transform, derive, fadeTransform,
  moveAlong, rotate, flashAround, indicate, count, vary, timed,
}
