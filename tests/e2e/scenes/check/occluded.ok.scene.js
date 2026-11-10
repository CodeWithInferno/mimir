// OCCLUDED negative: the wall in front of the labelled ball is glass, so the ball shows through it.
import { scene, sphere, box, BLUE, GREY_B } from 'mimir'
export default scene({ title: 'Seen through glass' }, (s) => {
  const ball = sphere({ id: 'ball', radius: 0.6, color: BLUE })
  const floor = box({ id: 'floor', width: 6, height: 0.2, depth: 6, color: GREY_B }).nextTo(ball, 'down', 0)
  const wall = box({ id: 'wall', width: 4, height: 3, depth: 0.3, material: 'glass' }).nextTo(floor, 'up', 0).shift(1.1, 0, 1.6).rotate({ about: 'y', deg: 35 })
  s.step('The ball', (st) => { st.say('Look at the [ball](ball).'); st.label(ball, 'ball'); st.wait(1) })
})
