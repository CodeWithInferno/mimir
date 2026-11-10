// CONTAINED: attach() without anchors centres the core inside the opaque housing, where it can never be seen.
import { scene, box, sphere, YELLOW, GREY_B } from 'mimir'
export default scene({ title: 'Swallowed' }, (s) => {
  const housing = box({ id: 'housing', width: 3, height: 2, depth: 2, color: GREY_B })
  const core = sphere({ id: 'core', radius: 0.5, color: YELLOW }).attach(housing)
  s.step('The core', (st) => { st.say('Somewhere in here is a core.'); st.wait(1) })
})
