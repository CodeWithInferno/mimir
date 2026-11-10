// Shape morphs, write on two lines, lagged entrances and the two emphasis verbs, close up. Used by tests/unit/anim
// (pure side) and shot by hand: corners must stay sharp, nothing may pop.
import { scene, rect, circle, text, group, row, transform, derive, write, fadeIn, fadeOut, flashAround, indicate, grow, create, uncreate, wiggle, BLUE, TEAL, RED, YELLOW, GREY_B } from 'mimir'

export default scene({ title: 'Morphs' }, (s) => {
  const square = rect({ id: 'square', width: 2.4, height: 2.4, color: BLUE }).fill(BLUE, 0.25).at(-4.5, 1)
  const disc = circle({ id: 'disc', radius: 1.3, color: RED, strokeWidth: 4 }).fill(RED, 0.25).at(0, 1)
  const card = rect({ id: 'card', width: 3.4, height: 1.6, radius: 0.3, color: TEAL }).at(4.5, 1)
  const words = text('Outline first,\nthen the fill', { id: 'words', size: 'body' }).at(-3.5, -1.8)
  const chips = row([0, 1, 2, 3, 4].map((i) => rect({ id: 'chip' + i, width: 0.8, height: 0.8, radius: 0.1, color: YELLOW }).fill(YELLOW, 0.3)), { gap: 0.3 }).at(3.2, -1.8)
  const frame = group([rect({ id: 'frameA', width: 6.6, height: 1.6, color: GREY_B, strokeWidth: 1 }).at(3.2, -1.8)])

  s.step('Square to circle', (st) => {
    st.say('A square becomes a circle; its corners stay corners until the end.')
    st.play(create(square))
    st.play(transform(square, disc, { duration: 2 }))
  })
  s.step('Copy to card', (st) => {
    st.say('A copy of the circle becomes a card.')
    st.play(derive(disc, card, { duration: 2, pathArc: 60 }))
  })
  s.step('Words and chips', (st) => {
    st.say('Text is written glyph by glyph; a row arrives one by one.')
    st.play(write(words))
    st.play(fadeIn(chips, { lag: 0.3, shift: [0, 0.3] }), create(frame))
    st.play(grow(text('grown', { id: 'grown', size: 'label' }).at(-3.5, -3), { from: 'left' }))
  })
  s.step('Emphasis', (st) => {
    st.say('A flash around, a swell, a wiggle.')
    st.play(flashAround(card))
    st.play(indicate(disc), indicate(words, { rate: wiggle, scale: 1.1 }))
    st.play(fadeOut(chips, { lag: 0.3, shift: [0, -0.3] }), uncreate(frame))
  })
})
