// HATCH-USE negative: the same parts placed by relations.
import { scene, box, GREY_B, BLUE } from 'mimir'
export default scene({ title: 'By relations' }, (s) => {
  const base = box({ id: 'base', width: 3, height: 0.4, depth: 3, color: GREY_B })
  const post = box({ id: 'post', width: 0.5, height: 2, depth: 0.5 }).nextTo(base, 'up', 0)
  const cap = box({ id: 'cap', width: 1.2, height: 0.3, depth: 1.2, color: BLUE }).nextTo(post, 'up', 0)
  s.step('A post', (st) => { st.say('A base, a post and a cap.'); st.wait(1) })
})
