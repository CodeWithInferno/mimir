// data imported as a JSON module: check, shot and export must all work (the export embeds it)
import { scene, rect, text, fadeIn } from 'mimir'
import data from './lib/da ta/size.json' with { type: 'json' }
export default scene({ title: 'json import' }, (s) => {
  const a = rect({ id: 'a', width: 2, height: data.h })
  text(data.label, { id: 'label', size: 'note' }).nextTo(a, 'down')
  s.step('x', (st) => { st.say('json'); st.play(fadeIn(a)) })
})
