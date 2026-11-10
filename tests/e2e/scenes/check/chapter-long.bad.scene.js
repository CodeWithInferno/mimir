// CHAPTER-LONG: one chapter of 104 seconds.
import { scene, rect, BLUE } from 'mimir'
export default scene({ title: 'A long chapter' }, (s) => {
  const a = rect({ id: 'a', width: 2, height: 1, color: BLUE })
  s.chapter('Everything at once')
  s.step('First half', (st) => { st.say('This goes on.'); st.play(a.to.shift(1, 0)); st.wait(50) })
  s.step('Second half', (st) => { st.say('And on.'); st.play(a.to.shift(-1, 0)); st.wait(50) })
})
