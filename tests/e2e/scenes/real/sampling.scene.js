// problems that exist only at a param extreme: the default picture is fine, the slider at its maximum is not
import { scene, rect, fadeIn } from 'mimir'
export default scene({ title: 'sampling' }, (s) => {
  const p = s.param('p', { value: 1, min: 0, max: 10 })
  const q = s.param('q', { value: 0, min: 0, max: 10 })
  const a = rect({ id: 'a', width: () => 1 + p() / 10, height: 1 }).at(() => [p() > 8 ? 20 : -3, 0])
  const n = rect({ id: 'n', width: () => (q() >= 10 ? NaN : 1 + q() / 10), height: 0.5 }).at(3, -2)
  s.step('one', (st) => { st.say('one'); st.play(fadeIn(a)) })
})
