// PARAM-BREAKS negative: the slider stops before the piston reaches the head.
import { scene, box, BLUE, GREY_B } from 'mimir'
export default scene({ title: 'Sound everywhere' }, (s) => {
  const stroke = s.param('stroke', { value: 1, min: 0.5, max: 2 })
  const floor = box({ id: 'floor', width: 3, height: 0.2, depth: 3, color: GREY_B }).at(0, -0.1, 0)
  const piston = box({ id: 'piston', width: 1.6, height: 1, depth: 1.6, color: BLUE }).at(() => [0, 0.5 + stroke() * 0.5, 0])
  const post = box({ id: 'post', width: 0.3, height: 2.2, depth: 0.3 }).nextTo(floor, 'up', 0).shift(1.2, 0, 1.2)
  const head = box({ id: 'head', width: 3, height: 0.4, depth: 3, color: GREY_B }).nextTo(post, 'up', 0).shift(-1.2, 0, -1.2)
  s.step('The stroke', (st) => { st.say('The piston rises by the stroke.'); st.set(stroke, 1.5) })
})
