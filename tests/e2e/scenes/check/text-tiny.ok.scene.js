// TEXT-TINY negative: the smallest named size is still readable.
import { scene, text, rect, BLUE } from 'mimir'
export default scene({ title: 'Readable' }, (s) => {
  const card = rect({ id: 'card', width: 6, height: 4, color: BLUE })
  const fine = text('a short note', { id: 'fine', size: 'tiny' }).shift(0, 1)
  const label = text('a label', { id: 'label', size: 'label' }).shift(0, -1)
  s.step('Read this', (st) => { st.say('Both are readable.'); st.wait(1) })
})
