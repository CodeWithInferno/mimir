// PLACE-NONE negative: one part may rest at the origin, the others are placed by relations; a caption on a box and a
// small shape inside a large one are compositions, not piles.
import { scene, cylinder, box, rect, circle, text } from 'mimir'
export default scene({ title: 'Placed' }, (s) => {
  s.viewport('right', 0.5)
  const spring = cylinder({ id: 'spring', radius: 0.5, height: 2 })
  const retainer = box({ id: 'retainer', width: 1.4, height: 0.4, depth: 1.4 }).attach(spring, { my: 'bottom', to: 'top' })
  const a = rect({ id: 'a', width: 3, height: 2 }).shift(-3.5, 0)
  const b = rect({ id: 'b', width: 2, height: 1 }).nextTo(a, 'down')
  const frame = rect({ id: 'frame', width: 3, height: 2 })
  const name = text('frame', { id: 'name', size: 'label' })
  const dot = circle({ id: 'dot', radius: 0.2 })
  frame.shift(-3.5, 2.6); name.shift(-3.5, 2.6); dot.shift(-3.5, 0)
  s.step('Placed', (st) => { st.say('Each part has its place.'); st.wait(1) })
})
