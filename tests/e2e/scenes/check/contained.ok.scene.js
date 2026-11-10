// CONTAINED negative: the housing is glass, so what is inside it shows.
import { scene, box, sphere, YELLOW } from 'mimir'
export default scene({ title: 'Inside glass' }, (s) => {
  const housing = box({ id: 'housing', width: 3, height: 2, depth: 2, material: 'glass' })
  const core = sphere({ id: 'core', radius: 0.5, color: YELLOW }).attach(housing)
  s.step('The core', (st) => { st.say('The core shows through the glass.'); st.label(core, 'core'); st.wait(1) })
})
