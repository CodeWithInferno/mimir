// real-viewer fixture: the only object fades out, so the end of step 2 is an empty frame (EMPTY-FRAME).
import { scene, rect, fadeIn, fadeOut, BLUE } from 'mimir'
export default scene({ title: 'Empty' }, (s) => {
  const a = rect({ id: 'a', width: 3, height: 2, color: BLUE })
  s.step('In', (st) => { st.say('A box.'); st.play(fadeIn(a)) })
  s.step('Out', (st) => { st.say('Gone.'); st.play(fadeOut(a)) })
})
