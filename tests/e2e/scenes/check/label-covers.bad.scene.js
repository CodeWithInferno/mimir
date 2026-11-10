// LABEL-COVERS: a note is placed over the box the step is about.
import { scene, rect, text, BLUE } from 'mimir'
export default scene({ title: 'Covered' }, (s) => {
  const worker = rect({ id: 'worker', width: 2.4, height: 1, color: BLUE }).shift(0, 0.5)
  const note = text('takes one request', { id: 'note', size: 'body' }).at(0.2, 0.55)
  s.step('The worker', (st) => { st.say('Look at the [worker](worker).'); st.focus(worker, note); st.wait(1) })
})
