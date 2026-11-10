// FLOATING: a lamp that hovers 0.3 above the table it should stand on.
import { scene, box, cylinder, GREY_B, YELLOW } from 'mimir'
export default scene({ title: 'A lamp in the air' }, (s) => {
  const top = box({ id: 'top', width: 4, height: 0.2, depth: 2.4, color: GREY_B }).at(0, 2, 0)
  const legs = [[-1.8, -1], [1.8, -1], [-1.8, 1], [1.8, 1]].map(([x, z], i) => box({ id: `leg${i + 1}`, width: 0.2, height: 2, depth: 0.2 }).nextTo(top, 'down', 0).shift(x, 0, z))
  const lamp = cylinder({ id: 'lamp', radius: 0.3, height: 0.8, color: YELLOW }).at(0.8, 2.8, 0)
  s.step('A table', (st) => { st.say('A table and a lamp.'); st.wait(1) })
})
