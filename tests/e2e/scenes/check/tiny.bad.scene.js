// TINY: a speck nobody can see, and a step that points at something 18 px across.
import { scene, circle, rect, BLUE, YELLOW } from 'mimir'
export default scene({ title: 'Too small' }, (s) => {
  const board = rect({ id: 'board', width: 6, height: 3, color: BLUE }).shift(0, 0.4)
  const speck = circle({ id: 'speck', radius: 0.02, color: YELLOW }).at(-2, 1)
  const chip = circle({ id: 'chip', radius: 0.1, color: YELLOW }).at(1, 0.4)
  s.step('The chip', (st) => { st.say('This is about the [chip](chip).'); st.focus(chip, board); st.wait(1) })
})
