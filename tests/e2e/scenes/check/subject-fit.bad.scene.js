// SUBJECT-FIT: the camera is pulled so far back that the model is a speck in its panel.
import { scene, box, cylinder, BLUE } from 'mimir'
export default scene({ title: 'Too far' }, (s) => {
  const block = box({ id: 'block', width: 2, height: 1, depth: 2, color: BLUE })
  const post = cylinder({ id: 'post', radius: 0.3, height: 2 }).nextTo(block, 'up', 0)
  s.step('Far away', (st) => { st.say('A block and a post.'); st.camera({ distance: 28 }); st.wait(1) })
})
