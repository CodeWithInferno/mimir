// CONTRAST-TEXT negative: light text on black, black text on a yellow box and on a light 3D part, and white text
// that keeps its black outline (the default backstroke) on a yellow box: the outline is what it is read against.
import { scene, rect, text, box, YELLOW, GREY_B, BLACK, TEAL_A } from 'mimir'
export default scene({ title: 'Easy to read' }, (s) => {
  s.viewport('right', 0.4)
  const dim = text('light grey on black', { id: 'dim', size: 'note', color: GREY_B }).at(-3, 2)
  const sign = rect({ id: 'sign', width: 3, height: 1, fill: YELLOW, color: YELLOW }).at(-3, 0)
  const onSign = text('black on yellow', { id: 'onSign', size: 'note', color: BLACK }).at(sign)
  const plate = rect({ id: 'plate', width: 3, height: 1, fill: YELLOW, color: YELLOW }).at(-3, -2)
  const outlined = text('white, outlined', { id: 'outlined', size: 'note' }).at(plate)
  const part = box({ id: 'part', width: 2, height: 2, depth: 2, color: TEAL_A })
  const tag = text('on the part', { id: 'tag', size: 'note', color: BLACK }).pin(part, 'center')
  s.step('Read this', (st) => { st.say('Three texts that stand out.'); st.wait(1) })
})
