// CONTRAST-TEXT: dark grey text on black, and white text WITHOUT its outline on a yellow box and on a light 3D part.
import { scene, rect, text, box, YELLOW, GREY_D, WHITE } from 'mimir'
export default scene({ title: 'Hard to read' }, (s) => {
  s.viewport('right', 0.4)
  const dim = text('dark grey on black', { id: 'dim', size: 'note', color: GREY_D }).at(-3, 2)
  const sign = rect({ id: 'sign', width: 3, height: 1, fill: YELLOW, color: YELLOW }).at(-3, 0)
  const onSign = text('white on yellow', { id: 'onSign', size: 'note', backstroke: 0 }).at(sign)
  const part = box({ id: 'part', width: 2, height: 2, depth: 2, color: WHITE, material: 'matte' })
  const tag = text('on the part', { id: 'tag', size: 'note', backstroke: 0 }).pin(part, 'top')
  s.step('Read this', (st) => { st.say('Three texts that do not stand out.'); st.wait(1) })
})
// The part is white and matte, the tag on its lit top face: under the luminous 3D look a tinted part is dark enough for white text.
