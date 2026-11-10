// A 3D part beside a 2D panel: derive from the part's outline on screen and from a point of it, flashAround and
// grow on a 3D part, fadeTransform across the two spaces. Used by tests/unit/anim (pure side) and shot by hand.
import { scene, box, cylinder, rect, circle, text, derive, grow, fadeIn, flashAround, fadeTransform, indicate, rotate, BLUE, TEAL, YELLOW, GREY_B } from 'mimir'

export default scene({ title: 'From a part to a diagram' }, (s) => {
  s.viewport('left', 0.5)
  const block = box({ id: 'block', width: 3, height: 1.2, depth: 2, color: BLUE })
  const pin = cylinder({ id: 'pin', radius: 0.35, height: 1.6, color: TEAL }).attach(block, { my: 'bottom', to: 'top' })
  const plan = rect({ id: 'plan', width: 3, height: 2, color: BLUE }).fill(BLUE, 0.15).at(3.6, 0.8)
  const hole = circle({ id: 'hole', radius: 0.35, color: TEAL }).at(3.6, 0.8)
  const name = text('pin', { id: 'name', size: 'label', color: GREY_B }).at(3.6, -1.2)
  const note = text('seen from above', { id: 'note', size: 'note', color: GREY_B }).at(3.6, 2.4)

  s.step('Parts', (st) => {
    st.say('A block with a pin.')
    st.play(fadeIn(block), grow(pin, { from: 'bottom' }), { lag: 0.5 })
    st.play(rotate(pin, 180, { about: 'y' }))
  })
  s.step('Its plan', (st) => {
    st.say('Its outline lifts off and becomes the plan.')
    st.play(derive(block, plan, { duration: 2 }))
    st.play(derive(pin.anchor('top'), hole, { duration: 1.5 }))
    st.play(derive(pin, name, { duration: 1.5 }))
  })
  s.step('Emphasis', (st) => {
    st.say('The pin, and the note about it.')
    st.play(flashAround(pin), indicate(block))
    st.play(fadeTransform(pin, note, { duration: 1.5 }))
  })
})
