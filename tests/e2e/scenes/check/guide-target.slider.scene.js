// GUIDE-TARGET negative: the story is judged as it plays. The arrow has no length when the slider is at its maximum,
// a state the story never reaches; the narration names the arrow while it is on stage and two units long.
// (It was reported as "outside the frame then": the rule measured with the last sampled slider value still pinned.)
import { scene, arrow, create, YELLOW } from 'mimir'
export default scene({ title: 'An arrow that has no length at one end of a slider' }, (s) => {
  const reach = s.param('reach', { value: 2, min: 0, max: 4 })
  const pointer = arrow(() => [-2, 0], () => [2 - reach(), 0], { id: 'pointer', color: YELLOW, buff: 0 })
  s.step('point at it', (st) => {
    st.say('This sentence waits a little before it names anything at all. Now the [arrow](pointer).')
    st.play(create(pointer))
  })
})
