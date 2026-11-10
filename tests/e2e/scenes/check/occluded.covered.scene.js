// OCCLUDED: the same sleeve and plug behind a wall. What the sleeve holds is hidden with it, so nothing excuses it.
import { scene, kit, cylinder, box, BLUE, GREY_B } from 'mimir'
export default scene({ title: 'A sleeve behind a wall' }, (s) => {
  const sleeve = kit.liner({ id: 'sleeve', bore: 2, height: 2, wall: 0.06, cut: 'half' })
  const plug = cylinder({ id: 'plug', radius: 1, height: 1.9, color: BLUE }).at(sleeve)
  const floor = box({ id: 'floor', width: 8, height: 0.2, depth: 8, color: GREY_B }).nextTo(sleeve, 'down', 0)
  const wall = box({ id: 'wall', width: 6, height: 4, depth: 0.3, color: GREY_B }).nextTo(floor, 'up', 0).shift(1.4, 0, 2.2).rotate({ about: 'y', deg: 35 })
  s.step('The sleeve', (st) => { st.say('The [sleeve](sleeve) guides the plug.'); st.label(sleeve, 'sleeve'); st.wait(1) })
})
