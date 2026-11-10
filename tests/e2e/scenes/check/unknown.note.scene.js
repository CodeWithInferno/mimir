// A cone standing on a block. It used to be the "unknown, never pass" fixture (a cone described no solid, so check
// said "not measured" instead of calling the scene clean); the cone has a solid description now, and the fit is measured.
import { scene, box, cone, GREY_B, BLUE } from 'mimir'
export default scene({ title: 'Not measured' }, (s) => {
  const block = box({ id: 'block', width: 3, height: 1, depth: 3, color: GREY_B })
  const nozzle = cone({ id: 'nozzle', radius: 0.6, height: 1.2, color: BLUE }).nextTo(block, 'up', 0)
  s.step('A nozzle', (st) => { st.say('A nozzle on a block.'); st.wait(1) })
})
