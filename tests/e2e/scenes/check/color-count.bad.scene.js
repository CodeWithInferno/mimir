// COLOR-COUNT: five hues at once, none of them meaning anything.
import { scene, rect, row, RED, BLUE, GREEN, YELLOW, PURPLE } from 'mimir'
export default scene({ title: 'A rainbow' }, (s) => {
  const boxes = [RED, BLUE, GREEN, YELLOW, PURPLE].map((c, i) => rect({ id: `box${i + 1}`, width: 1.6, height: 1, color: c }))
  row(boxes, { gap: 0.5 })
  s.step('Five boxes', (st) => { st.say('Five boxes in five colours.'); st.wait(1) })
})
