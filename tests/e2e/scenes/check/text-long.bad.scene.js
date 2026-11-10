// TEXT-LONG: a label that is a sentence, and a caption that is a paragraph.
import { scene, rect, BLUE } from 'mimir'
export default scene({ title: 'Too many words' }, (s) => {
  const queue = rect({ id: 'queue', width: 3, height: 1.4, color: BLUE }).shift(0, 0.6)
  s.step('The queue', (st) => {
    st.say('Requests wait in the queue until a worker is free to take the next one, and while they wait more of them keep arriving from the clients on the left, so the queue grows whenever the clients are faster than the workers are, which is the whole story of this picture.')
    st.label(queue, 'the queue where requests wait for a free worker')
    st.wait(1)
  })
})
