// CAMERA-CLIP negative: the camera moves in but stays outside.
import { scene, box, GREY_B } from 'mimir'
export default scene({ title: 'Outside the block' }, (s) => {
  const block = box({ id: 'block', width: 6, height: 4, depth: 6, color: GREY_B })
  s.step('The block', (st) => { st.say('A block of iron.'); st.wait(1) })
  s.step('Closer', (st) => { st.say('Closer still.'); st.camera({ zoom: 1.2 }) })
})
