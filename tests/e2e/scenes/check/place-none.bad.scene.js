// PLACE-NONE: parts that were never placed pile up at the origin (3D: spring and retainer; 2D: three boxes).
import { scene, cylinder, box, rect, text } from 'mimir'
export default scene({ title: 'Never placed' }, (s) => {
  s.viewport('right', 0.5)
  const spring = cylinder({ id: 'spring', radius: 0.5, height: 2 })
  const retainer = box({ id: 'retainer', width: 1.4, height: 0.4, depth: 1.4 })
  const a = rect({ id: 'a', width: 2, height: 1 })
  const b = rect({ id: 'b', width: 2, height: 1 })
  const c = rect({ id: 'c', width: 2.2, height: 1 })
  s.step('All at the origin', (st) => { st.say('Nothing was placed.'); st.wait(1) })
})
