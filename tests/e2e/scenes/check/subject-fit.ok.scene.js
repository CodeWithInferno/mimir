// SUBJECT-FIT negative: the camera frames the model on its own.
import { scene, box, cylinder, BLUE } from 'mimir'
export default scene({ title: 'Framed' }, (s) => {
  const block = box({ id: 'block', width: 2, height: 1, depth: 2, color: BLUE })
  const post = cylinder({ id: 'post', radius: 0.3, height: 2 }).nextTo(block, 'up', 0)
  s.step('Framed', (st) => { st.say('A block and a post.'); st.camera({ view: 'front' }); st.wait(1) })
})
