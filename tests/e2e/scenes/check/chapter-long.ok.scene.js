// CHAPTER-LONG negative: the same story in two chapters.
import { scene, rect, BLUE } from 'mimir'
export default scene({ title: 'Two chapters' }, (s) => {
  const a = rect({ id: 'a', width: 2, height: 1, color: BLUE })
  s.chapter('First', { keep: [a] })
  s.step('First half', (st) => { st.say('This goes on.'); st.play(a.to.shift(1, 0)); st.wait(50) })
  s.chapter('Second', { keep: [a] })
  s.step('Second half', (st) => { st.say('And on.'); st.play(a.to.shift(-1, 0)); st.wait(50) })
})
