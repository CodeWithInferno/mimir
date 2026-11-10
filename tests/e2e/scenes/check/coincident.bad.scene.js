// COINCIDENT: two valves of the same size in exactly the same place.
import { scene, box, cylinder, GREY_B, BLUE, RED } from 'mimir'
export default scene({ title: 'Two in one place' }, (s) => {
  const head = box({ id: 'head', width: 4, height: 0.5, depth: 2, color: GREY_B })
  const intake = cylinder({ id: 'intake', radius: 0.4, height: 1, color: BLUE }).nextTo(head, 'up', 0)
  const exhaust = cylinder({ id: 'exhaust', radius: 0.4, height: 1, color: RED }).nextTo(head, 'up', 0)
  s.step('Two valves', (st) => { st.say('An intake valve and an exhaust valve.'); st.wait(1) })
})
