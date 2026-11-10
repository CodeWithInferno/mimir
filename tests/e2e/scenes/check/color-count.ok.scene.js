// COLOR-COUNT negative: two hues and grey; blue and teal are neighbours and read as one family.
import { scene, rect, row, BLUE, TEAL, YELLOW, GREY_B } from 'mimir'
export default scene({ title: 'Two hues' }, (s) => {
  const boxes = [BLUE, TEAL, GREY_B, YELLOW, GREY_B].map((c, i) => rect({ id: `box${i + 1}`, width: 1.6, height: 1, color: c }))
  row(boxes, { gap: 0.5 })
  s.step('Five boxes', (st) => { st.say('Five boxes, two hues.'); st.wait(1) })
})
