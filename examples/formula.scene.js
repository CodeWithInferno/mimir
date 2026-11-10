// formula: typeset mathematics that is written on, highlighted term by term, and rewritten into the next line.
// tex() sets LaTeX in Computer Modern; write() draws it piece by piece; formula.part(key) is one term as an object;
// rewrite(a, b) lets the terms two formulas share glide into place. A param drives the triangle and the numbers.
import { scene, tex, line, write, create, fadeIn, rewrite, lagged, BLUE, TEAL, YELLOW, GREY_B } from 'mimir'

// String.raw keeps the backslashes of LaTeX as they are
const R = String.raw

export default scene({ title: 'The Pythagorean theorem' }, (s) => {
  const a = s.param('a', { value: 3, min: 1, max: 5, step: 0.5, label: 'leg a' })
  const b = 4
  const c = () => Math.hypot(a(), b)

  // the triangle: the right angle at the origin of the drawing, one frame unit per 1.25 units of length
  const unit = 0.8
  const corner = [-5.6, -2.0]
  const right = [corner[0] + b * unit, corner[1]]
  const top = () => [corner[0], corner[1] + a() * unit]
  const legB = line(corner, right, { id: 'legB', color: TEAL, strokeWidth: 4 })
  const legA = line(corner, top, { id: 'legA', color: BLUE, strokeWidth: 4 })
  const hyp = line(top, right, { id: 'hyp', color: YELLOW, strokeWidth: 4 })
  const nameA = tex('a', { id: 'nameA', size: 'label', color: BLUE }).at(() => [corner[0] - 0.35, corner[1] + (a() * unit) / 2])
  const nameB = tex('b', { id: 'nameB', size: 'label', color: TEAL }).at(corner[0] + (b * unit) / 2, corner[1] - 0.4)
  const nameC = tex('c', { id: 'nameC', size: 'label', color: YELLOW }).at(() => [corner[0] + (b * unit) / 2 + 0.3, corner[1] + (a() * unit) / 2 + 0.3])

  // three lines of one derivation. colors: every occurrence of a key gets the colour.
  const colors = { a: BLUE, b: TEAL, c: YELLOW }
  const theorem = tex(R`a^2 + b^2 = c^2`, { id: 'theorem', colors }).at(2.6, 2.0)
  const solved = tex(R`c = \sqrt{a^2 + b^2}`, { id: 'solved', colors }).at(2.6, 0.3)
  // a formula can follow a param: the commands stay in the template, only the numbers change. \textcolor colours in the source.
  const numbers = tex(() => R`c = \sqrt{\textcolor{${BLUE}}{${a().toFixed(1)}}^2 + \textcolor{${TEAL}}{${b}}^2} = \textcolor{${YELLOW}}{${c().toFixed(2)}}`, { id: 'numbers', colors: { c: YELLOW } }).at(2.6, 0.3)
  const note = tex(R`the square on the hypotenuse $c$`, { id: 'note', size: 'note', color: GREY_B, colors: { c: YELLOW } }).at(2.6, 3.1)

  s.step('A right triangle', (st) => {
    st.say('A right triangle has two [legs](glow:legA+legB) and a [hypotenuse](hyp).')
    st.play(lagged([create(legB), create(legA), create(hyp)], { lag: 0.4 }))
    st.play(lagged([fadeIn(nameA), fadeIn(nameB), fadeIn(nameC)], { lag: 0.2 }))
  })

  s.step('The theorem', (st) => {
    st.say('The squares on the legs add up to the square on the hypotenuse.')
    // write(): the outline of each piece is traced, then filled, left to right
    st.play(write(theorem), { duration: 2 })
  })

  s.step('One term', (st) => {
    st.say('Look at the term on the right: it is the one we want.')
    // a part is the piece of the formula that is set like its key
    const term = theorem.part('c^2')
    st.play(fadeIn(note), term.to.scale(1.25))
    st.play(term.to.scale(1))
  })

  s.step('Solve for c', (st) => {
    st.say('Take the square root of both sides.')
    // keep: true leaves the first line where it is; the terms both lines have fly down from it
    st.play(rewrite(theorem, solved, { keep: true }))
  })

  s.step('With numbers', (st) => {
    st.say('With legs 3 and 4 the hypotenuse is 5. Make leg a longer and c follows.')
    // without keep the old line leaves: the letters fade, the numbers come in, everything else glides
    st.play(rewrite(solved, numbers))
    st.wait(0.5)
    st.play(a.to(5), { duration: 2 })
  })
})
