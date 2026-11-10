// TEXT-TINY: text of 7 px, and text that is scaled down to 9 px.
import { scene, text, rect, BLUE } from 'mimir'
export default scene({ title: 'Small print' }, (s) => {
  const card = rect({ id: 'card', width: 6, height: 4, color: BLUE })
  const fine = text('the fine print', { id: 'fine', size: 8 }).shift(0, 1)
  const shrunk = text('shrunk to a third', { id: 'shrunk', size: 'label' }).shift(0, -1).scale(0.3)
  s.step('Read this', (st) => { st.say('Can you read it?'); st.wait(1) })
})
