// OCCLUDED: the step labels a ball that sits behind an opaque wall.
import { scene, sphere, box, BLUE, GREY_B } from 'mimir'
export default scene({ title: 'Hidden' }, (s) => {
  const ball = sphere({ id: 'ball', radius: 0.6, color: BLUE })
  const floor = box({ id: 'floor', width: 6, height: 0.2, depth: 6, color: GREY_B }).nextTo(ball, 'down', 0)
  // the wall stands on the floor between the ball and the camera (the default view looks from +x +z)
  const wall = box({ id: 'wall', width: 4, height: 3, depth: 0.3, color: GREY_B }).nextTo(floor, 'up', 0).shift(1.1, 0, 1.6).rotate({ about: 'y', deg: 35 })
  s.step('The ball', (st) => { st.say('Look at the [ball](ball).'); st.label(ball, 'ball'); st.wait(1) })
})
