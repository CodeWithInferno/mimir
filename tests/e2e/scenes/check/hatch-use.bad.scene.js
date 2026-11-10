// HATCH-USE: every part is placed with typed-in numbers, and one of the numbers is off (the cap hovers).
import { scene, box, GREY_B, BLUE } from 'mimir'
export default scene({ title: 'By numbers' }, (s) => {
  const base = box({ id: 'base', width: 3, height: 0.4, depth: 3, color: GREY_B }).at(0, 0.2, 0)
  const post = box({ id: 'post', width: 0.5, height: 2, depth: 0.5 }).at(0, 1.4, 0)
  const cap = box({ id: 'cap', width: 1.2, height: 0.3, depth: 1.2, color: BLUE }).at(0, 2.85, 0)
  s.step('A post', (st) => { st.say('A base, a post and a cap.'); st.wait(1) })
})
