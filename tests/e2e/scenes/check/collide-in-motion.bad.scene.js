// COLLIDE-IN-MOTION: the ram is clear of the post at the start and at the end of the step, and passes through it on the way.
import { scene, box, BLUE, GREY_B } from 'mimir'
export default scene({ title: 'Through the post' }, (s) => {
  const travel = s.param('travel', { value: 0, min: 0, max: 1 })
  const floor = box({ id: 'floor', width: 9, height: 0.2, depth: 2, color: GREY_B }).at(0, -0.1, 0)
  const post = box({ id: 'post', width: 0.5, height: 1.5, depth: 0.5 }).nextTo(floor, 'up', 0)
  const ram = box({ id: 'ram', width: 1, height: 0.6, depth: 0.6, color: BLUE }).at(() => [-3 + 6 * travel(), 0.3, 0])
  s.step('Start', (st) => { st.say('The ram waits on the left.'); st.wait(1) })
  s.step('Across', (st) => { st.say('It slides to the right.'); st.set(travel, 1) })
})
