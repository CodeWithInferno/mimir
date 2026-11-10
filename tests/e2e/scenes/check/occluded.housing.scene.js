// OCCLUDED negative: a housing is seen around what it holds. The sleeve is cut open and the plug inside it covers
// most of its inner wall, so little of the sleeve's own surface shows; the step labels the sleeve all the same.
// (No narration span on the sleeve: the guide's GUIDE-TARGET measures on its own until it shares shownShare().)
import { scene, kit, cylinder, box, BLUE, GREY_B } from 'mimir'
export default scene({ title: 'A sleeve and what it holds' }, (s) => {
  const sleeve = kit.liner({ id: 'sleeve', bore: 2, height: 2, wall: 0.06, cut: 'half' })
  const plug = cylinder({ id: 'plug', radius: 1, height: 1.9, color: BLUE }).at(sleeve)
  const floor = box({ id: 'floor', width: 6, height: 0.2, depth: 6, color: GREY_B }).nextTo(sleeve, 'down', 0)
  s.step('The sleeve', (st) => { st.say('The sleeve guides the plug.'); st.label(sleeve, 'sleeve'); st.wait(1) })
})
