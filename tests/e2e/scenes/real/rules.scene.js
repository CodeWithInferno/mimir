// real-viewer fixture: one deliberate case each of OFF-FRAME, TEXT-OVERLAP, DEAD-PARAM (errors) and STATIC-STEP (warning).
import { scene, rect, text, circle, box, fadeIn, BLUE, RED } from 'mimir'
export default scene({ title: 'Rules' }, (s) => {
  const unused = s.param('unused', { value: 1, min: 0, max: 10 })
  const a = text('First label here', { size: 'body' }).at(0, 1)
  const b = text('Second label here', { size: 'body' }).at(0.4, 1.05)
  const off = rect({ id: 'off', width: 3, height: 2, color: BLUE }).at(7.5, 0)
  const tiny = circle({ id: 'tiny', radius: 0.5, color: RED }).at(-3, -2)
  s.step('Shown', (st) => { st.say('Things appear.'); st.play(fadeIn(a), fadeIn(b), fadeIn(off), fadeIn(tiny)) })
  s.step('Nothing happens', (st) => { st.say('Still the same picture.') })
})
