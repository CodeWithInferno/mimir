// sine-explorer: a point going round a circle, and its height plotted against the angle. One shared param (the
// angle) drives the arm, the moving point of the plot, the curve that draws on behind it and the readouts; two more
// sliders change the amplitude and the frequency. The dashed guide ties the model to the plot.
import { scene, axes, guide, line, readout, row, text, create, write, fadeIn, linear, BLUE, GOLD, YELLOW, WHITE, GREY_B, UP } from 'mimir'

export default scene({ title: 'Where a sine wave comes from' }, (s) => {
  const angle = s.param('angle', { value: 0, min: 0, max: 720, unit: '°', label: 'Angle' })
  const amplitude = s.param('amplitude', { value: 1, min: 0.4, max: 1.4, step: 0.1, label: 'Amplitude' })
  const frequency = s.param('frequency', { value: 1, min: 1, max: 3, step: 0.5, label: 'Frequency' })

  // the one piece of maths in the scene: how far round the point is after an angle, and so how high it is
  /** @param {number} degrees */
  const turn = (degrees) => (frequency() * degrees * Math.PI) / 180
  /** @param {number} degrees */
  const height = (degrees) => amplitude() * Math.sin(turn(degrees))
  const tip = () => [amplitude() * Math.cos(turn(angle())), height(angle())]
  const circle = () => Array.from({ length: 121 }, (_, i) => [amplitude() * Math.cos((i * Math.PI) / 60), amplitude() * Math.sin((i * Math.PI) / 60)])

  const title = text('Where a sine wave comes from', { size: 'section' }).at(0, 3.25)

  // left: the circle, on its own small pair of axes through zero. Both plots are 3 units tall for a range of 3,
  // and sit at the same height: one unit of height is the same length in both, so the guide between them is level.
  const plane = axes({ id: 'plane', x: [-1.5, 1.5], y: [-1.5, 1.5], width: 3, height: 3, axis: 'zero', ticks: false }).at(-4.9, 0.2)
  const ring = plane.plot(circle, { id: 'circle', color: GREY_B, strokeWidth: 2 })
  const arm = line(plane.toFrame(0, 0), plane.toFrame(tip), { id: 'arm', color: WHITE, strokeWidth: 3, buff: 0 })
  const point = plane.dot(tip, { id: 'point', color: YELLOW, radius: 0.08 })

  // right: the height of that point against the angle
  const plot = axes({ id: 'plot', x: [0, 720], y: [-1.5, 1.5], width: 6.4, height: 3, xUnit: '°', xLabel: 'angle', yLabel: 'height', ticks: { x: 90, y: [-1, 0, 1] } }).at(2.4, 0.2)
  plot.hline(0, { id: 'zero', dashed: false, opacity: 0.3 })
  const wave = plot.plot(height, { id: 'wave', to: angle, colorAt: (x, y) => (y >= 0 ? BLUE : GOLD) })
  const cursor = plot.dot(() => [angle(), height(angle())], { id: 'cursor' })
  // declared for check: a dot is small by nature; the pointer and its ring are what make it findable
  point.allow('TINY')
  cursor.allow('TINY')
  const tie = guide(point, cursor, { id: 'tie' })
  const period = plot.bracket(0, () => 360 / frequency(), 'one period', { id: 'period' })

  // the numbers, in a row under the plot (a readout keeps room for its widest value, so the row never shifts)
  const numbers = row([readout('angle', angle, { id: 'angleNow', unit: '°' }), readout('height', () => height(angle()), { id: 'heightNow', decimals: 2 })], { gap: 1.2 }).nextTo(plot, 'down', 0.3)

  s.step('A point on a circle', (st) => {
    st.say('Take a [point](point) on a [circle](circle), at the end of an [arm](arm) that can turn.')
    st.play(create(plane), create(arm), { lag: 0.4 }) // the circle first: it is on stage when the sentence names it
    st.play(write(title))
    st.set(angle, 60, { duration: 1.5 })
  })

  s.step('Its height against the angle', (st) => {
    st.say('Plot the [height](cursor) of the point against the angle it has turned through. The [dashed line](tie) carries it across.')
    st.play(create(plot))
    st.play(fadeIn(tie), fadeIn(numbers, { shift: UP.map((c) => c * 0.2) }), { lag: 0.3 })
    st.set(angle, 360, { duration: 5, rate: linear })
  })

  s.step('One period', (st) => {
    st.say('After one full turn the point is back where it began, and the [curve](wave) starts again: that is [one period](period).')
    st.play(create(period))
    st.set(angle, 600, { duration: 4, rate: linear })
  })

  s.step('Turn faster', (st) => {
    st.say('Turn twice as fast and two periods fit in the same angle.')
    st.set(frequency, 2, { duration: 3 })
  })

  s.step('A smaller circle', (st) => {
    st.say('Shrink the circle and the wave is lower, but just as long.')
    st.set(amplitude, 0.5, { duration: 3 })
    st.focus(ring, point, wave, cursor, tie)
  })
})
