// chapters, read-mode data and the 2D camera: s.chapter, st.note, st.zoom, m.hud, a 2D label pinned to a 3D part
import { scene, rect, text, box, fadeIn, BLUE, TEAL, BLACK } from 'mimir'

export default scene({ title: 'Chapters' }, (s) => {
  s.viewport('right', 0.4)
  const title = text('Chapters', { id: 'title', size: 'label' }).at(-5.2, 3.3).hud()

  s.chapter('Parts')
  const a = rect({ id: 'a', width: 2, height: 1.2, color: BLUE }).at(-4, 0.5)
  const far = rect({ id: 'far', width: 1, height: 0.6 }).at(-6, -2.8) // inside the frame, outside the view once the camera zooms in on a
  const part = box({ id: 'part', width: 2, height: 2, depth: 2, color: TEAL })
  const tag = text('part', { id: 'tag', size: 'note', color: BLACK }).pin(part, 'top', { offset: [0, 0.4] }) // black: it lies on the light top face
  s.step('Meet the parts', (st) => {
    st.say('A [box](part) and a [rectangle](ring:a+title,hold).')
    st.note('Read mode shows this **note** under the paragraph.')
    st.wait(1)
  })
  s.step('Look closer', (st) => {
    st.say('The camera moves in.')
    st.zoom(a, { margin: 2 })
  })

  s.chapter('Afterwards', { keep: [title] })
  const b = rect({ id: 'b', width: 3, height: 1 }).at(-3.5, -1)
  s.step('A new stage', (st) => {
    st.say('Everything but the title has left.')
    st.play(fadeIn(text('fresh', { id: 'fresh' }).at(-3.5, 1)))
  })
})
