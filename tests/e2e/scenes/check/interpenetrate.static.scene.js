// INTERPENETRATE (warning): two primitives that overlap and never move against each other: one body, or a misplaced part?
import { scene, box, GREY_B } from 'mimir'
export default scene({ title: 'One body or two' }, (s) => {
  const body = box({ id: 'body', width: 3, height: 1, depth: 1.5, color: GREY_B }).at(0, 0, 0)
  const cabin = box({ id: 'cabin', width: 1.4, height: 1, depth: 1.3 }).at(0.3, 0.7, 0)
  s.step('A car body', (st) => { st.say('A body and a cabin.'); st.wait(1) })
})
