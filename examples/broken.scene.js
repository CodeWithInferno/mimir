// broken: four mistakes an author makes. The scene must still render what it can, and check must report all four
// with the line and a fix: an unknown option, a wrong type, a missing reference and a NaN.
import { scene, rect, circle, text, arrow, row, fadeIn, BLUE, TEAL } from 'mimir'

export default scene({ title: 'Broken on purpose' }, (s) => {
  const title = text('Four mistakes', { size: 'section' }).at(0, 3)

  const a = rect({ id: 'a', widht: 2.4, height: 1.4, color: BLUE }) // API-UNKNOWN: "widht"
  const b = circle({ id: 'b', radius: 'big', color: TEAL }) // API-TYPE: radius must be a number
  const c = rect({ id: 'c', width: 2.4, height: 0 / 0 }) // NUM-INVALID: NaN height
  row([a, b, c], { gap: 1.4 }).at(0, 0)

  const parts = { a, b, c }
  const link = arrow(a, parts.d) // REF-MISSING: parts.d does not exist
  const ok = arrow(a, b)

  s.step('Still renders', (st) => {
    st.say('Each mistake is reported with its line and a fix; the rest still renders.')
    st.play(fadeIn(ok))
  })
})
