// CAMERA-CLIP: the camera is put inside the block.
import { scene, box, GREY_B } from 'mimir'
export default scene({ title: 'Inside the block' }, (s) => {
  const block = box({ id: 'block', width: 6, height: 4, depth: 6, color: GREY_B })
  s.step('The block', (st) => { st.say('A block of iron.'); st.wait(1) })
  s.step('Closer', (st) => { st.say('Closer still.'); st.camera({ target: block, distance: 1.5 }) })
})
