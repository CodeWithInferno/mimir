// TINY negative: the step zooms in on the small thing it is about; a bar that shrinks to nothing on purpose is fine.
import { scene, circle, rect, BLUE, YELLOW } from 'mimir'
export default scene({ title: 'Large enough' }, (s) => {
  const level = s.param('level', { value: 1, min: 0, max: 1 })
  const board = rect({ id: 'board', width: 6, height: 3, color: BLUE }).shift(0, 0.4)
  const chip = circle({ id: 'chip', radius: 0.1, color: YELLOW }).at(1, 0.4)
  const bar = rect({ id: 'bar', width: () => 0.01 + 2 * level(), height: 0.03, color: YELLOW }).at(-1.5, -0.6)
  s.step('The chip', (st) => { st.say('This is about the [chip](chip).'); st.zoom(chip, { margin: 6 }); st.wait(1) })
  s.step('The bar empties', (st) => { st.say('The bar runs out.'); st.zoom(null); st.set(level, 0) })
})
