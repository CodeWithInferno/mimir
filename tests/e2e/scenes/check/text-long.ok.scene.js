// TEXT-LONG negative: a label is a name, a caption is a sentence or two.
import { scene, rect, BLUE } from 'mimir'
export default scene({ title: 'Few words' }, (s) => {
  const queue = rect({ id: 'queue', width: 3, height: 1.4, color: BLUE }).shift(0, 0.6)
  s.step('The queue', (st) => {
    st.say('Requests wait in the queue until a worker is free. When clients are faster than workers, it grows.')
    st.label(queue, 'waiting requests')
    st.wait(1)
  })
})
