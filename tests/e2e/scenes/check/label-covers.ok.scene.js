// LABEL-COVERS negative: the note sits beside the box; a name placed on the box is its caption.
import { scene, rect, text, BLUE } from 'mimir'
export default scene({ title: 'Beside' }, (s) => {
  const worker = rect({ id: 'worker', width: 2.4, height: 1, color: BLUE }).shift(0, 0.5)
  const name = text('Worker', { id: 'name', size: 'label' }).at(worker)
  const note = text('takes one request', { id: 'note', size: 'body' }).nextTo(worker, 'down')
  s.step('The worker', (st) => { st.say('Look at the [worker](worker).'); st.focus(worker, name, note); st.wait(1) })
})
