// one param of each kind, for `shot --set`
import { scene, rect, fadeIn, RED, BLUE } from 'mimir'
export default scene({ title: 'params' }, (s) => {
  const size = s.param('size', { value: 2, min: 1, max: 4 })
  const on = s.toggle('on', { value: false })
  const mode = s.choice('mode', { options: ['slow', 'fast'], value: 'slow' })
  const a = rect({ id: 'a', width: () => size() * (on() ? 2 : 1), height: 1, color: () => (mode() === 'fast' ? RED : BLUE) })
  s.step('intro', (st) => { st.say('intro'); st.play(fadeIn(a)) })
})
