// INTERPENETRATE: a slider that runs along a rail but sits 0.1 too low, so it cuts into the rail all the way.
import { scene, box, BLUE, GREY_B } from 'mimir'
export default scene({ title: 'Sunk into the rail' }, (s) => {
  const travel = s.param('travel', { value: 0, min: 0, max: 1 })
  const rail = box({ id: 'rail', width: 8, height: 0.4, depth: 1, color: GREY_B }).at(0, 0, 0)
  const slider = box({ id: 'slider', width: 1, height: 0.8, depth: 0.8, color: BLUE }).at(() => [-3 + 6 * travel(), 0.5, 0])
  s.step('Across', (st) => { st.say('The slider crosses the rail.'); st.set(travel, 1) })
})
