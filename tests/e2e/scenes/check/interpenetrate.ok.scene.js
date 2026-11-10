// INTERPENETRATE negative: the slider rests on the rail (touching is not overlapping); a glass housing around it, a
// pin attached into it, and two boxes grouped into one body may overlap.
import { scene, box, cylinder, tube, group, BLUE, GREY_B } from 'mimir'
export default scene({ title: 'On the rail' }, (s) => {
  const travel = s.param('travel', { value: 0, min: 0, max: 1 })
  const rail = box({ id: 'rail', width: 8, height: 0.4, depth: 1, color: GREY_B }).at(0, 0, 0)
  const slider = box({ id: 'slider', width: 1, height: 0.8, depth: 0.8, color: BLUE }).at(() => [-3 + 6 * travel(), 0.6, 0])
  const cover = box({ id: 'cover', width: 8.4, height: 1.6, depth: 1.4, material: 'glass' }).at(0, 0.5, 0)
  const pin = cylinder({ id: 'pin', radius: 0.1, height: 1.2 }).rotate({ about: 'x', deg: 90 }).attach(slider, { my: 'center', to: 'center' })
  const post = group([box({ id: 'foot', width: 1, height: 0.3, depth: 1 }).at(0, -0.35, 0), box({ id: 'stem', width: 0.4, height: 1, depth: 0.4 }).at(0, -0.7, 0)])
  s.step('Across', (st) => { st.say('The slider crosses the rail.'); st.set(travel, 1) })
})
