// 2D objects that refer to a 3D part, under a 2D zoom beside the 3D panel: the note is zoomed inside the 2D half,
// what follows the part stays where it is and as large as it was, the arrow still joins the note and the ball
import { scene, rect, text, circle, arrow, box, sphere, BLUE, RED, YELLOW } from 'mimir'
export default scene({ title: '2D refers to 3D' }, (s) => {
  s.viewport('right', 0.5)
  const base = box({ id: 'base', width: 4, height: 0.5, depth: 4, color: '#666' })
  const ball = sphere({ id: 'ball', radius: 0.7, color: RED }).at(0, 1, 0)
  const note = rect({ id: 'note', width: 2.2, height: 1, color: BLUE }).at(-4.5, 2)
  const noteText = text('ball', { id: 'noteText', size: 'label' }).at(note)
  const link = arrow(note, ball, { id: 'link' })
  const ring = circle({ id: 'ring', radius: 0.25, color: YELLOW }).at(ball)
  const beside = text('beside', { id: 'beside', size: 'note' }).nextTo(base, 'down', 0.2)
  const wide = rect({ id: 'wide', width: 9, height: 0.3 }).at(-2, 0.6) // a neighbour that the zoom would push over the 3D panel
  s.step('still', (st) => { st.say('A note points at the ball.'); st.wait(1) })
  s.step('zoom', (st) => { st.say('The 2D camera zooms on the note.'); st.zoom(note, { margin: 2 }) })
})
