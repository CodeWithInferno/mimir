// verbs: a point walks round a circle and its height unrolls into a wave. One step per family of verbs:
// enter (write, create, grow, growArrow, fadeIn), motion (moveAlong, count, rotate), derive (a copy of the circle
// becomes the plot; a copy of the height becomes a bar of it), emphasis (indicate, flashAround, fadeTransform),
// a param swept with holds (vary), transform (the wave turns into its quarter-turn twin), leave (uncreate, fadeOut).
// Nothing is placed twice: the hand is a line between the centre and the point, so it follows the point by itself.
import {
  scene, text, circle, line, polyline, group,
  write, create, uncreate, fadeIn, fadeOut, grow, growArrow, transform, derive, fadeTransform, moveAlong, rotate, flashAround, indicate, count, vary, timed,
  lagged, seq, linear, BLUE, TEAL, YELLOW, GREY_B, GREY_C, UP, DOWN,
} from 'mimir'

export default scene({ title: 'A circle unrolls into a wave' }, (s) => {
  const turns = s.param('turns', { value: 1, min: 1, max: 3, step: 0.5, label: 'Turns of the point' })

  // one circle on the left, one plot on the right; the plot is as tall as the circle, so heights carry over unchanged
  const C = [-4.6, -0.1], R = 1.5, X0 = -1.9, LENGTH = 7.7, SAMPLES = 120
  /** @param {number} u share of the way along the plot */
  const along = (u) => X0 + LENGTH * u
  /** @param {number} u @param {number} [phase] turns the point is ahead by */
  const height = (u, phase = 0) => C[1] + R * Math.sin(2 * Math.PI * (turns() * u + phase))
  /** every point of the curve is a function, so the curve follows the param @param {number} phase */
  const curve = (phase) => Array.from({ length: SAMPLES + 1 }, (_, i) => () => [along(i / SAMPLES), height(i / SAMPLES, phase)])

  const title = text('A point on a circle', { id: 'title', size: 'section' }).at(0, 3.1)
  const ring = circle({ id: 'ring', radius: R, color: BLUE }).at(C[0], C[1])
  const point = circle({ id: 'point', radius: 0.09, color: YELLOW, fill: YELLOW }).at(ring.right)
  point.allow('TINY') // declared for check: a dot is small by nature; the pointer and its ring are what make it findable
  const hand = line(ring.center, point, { id: 'hand', color: GREY_B, buff: 0 })
  const radius = text('radius 1', { id: 'radius', size: 'note', color: GREY_B }).at(C[0] + R / 2, C[1] - 0.32)
  const angle = text('0°', { id: 'angle', size: 'label' }).nextTo(ring, 'down', 0.45)

  const axis = line([X0, C[1]], [X0 + LENGTH + 0.3, C[1]], { id: 'axis', color: GREY_C })
  const scale = line([X0, C[1] - R - 0.3], [X0, C[1] + R + 0.3], { id: 'scale', color: GREY_C })
  const axes = group([axis, scale])
  const wave = polyline(curve(0), { id: 'wave', color: BLUE, strokeWidth: 3 })
  const twin = polyline(curve(0.25), { id: 'twin', color: TEAL, strokeWidth: 3 })

  // the height of the point above the centre line, and the same height where the plot has reached a sixth of a turn
  const rise = line(() => [point.center()[0], C[1]], point, { id: 'rise', color: YELLOW, strokeWidth: 3, buff: 0 })
  const bar = line([along(1 / 6), C[1]], [along(1 / 6), C[1] + R * Math.sin(Math.PI / 3)], { id: 'bar', color: YELLOW, strokeWidth: 3 })
  const heightLabel = text('height of the point', { id: 'heightLabel', size: 'note', color: BLUE }).at(along(0.25) + 1.75, C[1] + R + 0.1)
  const oneTurn = text('one turn', { id: 'oneTurn', size: 'label', color: GREY_B }).nextTo(ring, 'up', 0.35)
  const onePeriod = text('one period', { id: 'onePeriod', size: 'label', color: GREY_B }).at(along(0.5), C[1] + R + 0.65)
  const later = text('a quarter turn early', { id: 'later', size: 'label', color: TEAL }).at(along(0.5), C[1] + R + 0.65)
  const end = text('The same circle, read two ways', { id: 'end', size: 'section' }).at(0, 3.1)

  s.step('A point on a circle', (st) => {
    st.say('Take a [circle](ring), and a [point](point) on it.')
    st.play(create(ring)) // the circle first: it is on stage when the sentence names it
    st.play(grow(point), growArrow(hand), fadeIn(radius, { shift: [0, 0.25] }), { lag: 0.3 })
    st.play(write(title))
  })

  s.step('Once around', (st) => {
    st.say('The point walks once around: three hundred and sixty degrees.')
    st.play(fadeOut(radius, { shift: DOWN.map((c) => c * 0.25) }), fadeIn(angle, { shift: UP.map((c) => c * 0.25) }))
    st.play(moveAlong(point, ring, { rate: linear }), count(angle, 360, { rate: linear }), { duration: 4 })
    st.play(flashAround(angle))
  })

  s.step('Its height, unrolled', (st) => {
    st.say('Unroll the [circle](ring) along a line, and the height of the point draws a [wave](wave).')
    st.focus(ring, wave, axes, heightLabel) // everything else steps back for this step and the next (declared in both: it does not blink between them)
    st.play(create(axes))
    st.play(derive(ring, wave, { duration: 2.5 }))
    st.play(write(heightLabel))
  })

  s.step('The same height', (st) => {
    st.say('A sixth of the way round, the point is this high; so is the wave a sixth of the way along.')
    st.focus(ring, wave, axes, heightLabel, point, rise, bar, hand, angle)
    st.play(rotate(point, 60, { about: ring.center }), count(angle, 60, { from: 0 }), fadeIn(rise, { span: [0.4, 1] }), { duration: 1.5 })
    st.play(derive(rise, bar, { duration: 1.5 }))
    st.play(indicate(bar))
  })

  s.step('One turn, one period', (st) => {
    st.say('One [turn](ring) of the circle is one period of the [wave](wave).')
    st.play(fadeOut(heightLabel), fadeIn(oneTurn, { shift: [0, -0.25] }))
    st.play(fadeTransform(oneTurn, onePeriod, { duration: 1.5 }))
    st.play(flashAround(wave))
  })

  s.step('More turns', (st) => {
    st.say('Walk round three times and three waves fit; then back to one.')
    st.play(fadeOut(bar), fadeOut(rise))
    st.play(vary(turns, [3, 1], { duration: 2.5, hold: 0.6 }))
  })

  s.step('A quarter turn early', (st) => {
    st.say('Start a quarter turn early and the same wave arrives sooner.')
    st.play(rotate(point, 30, { about: ring.center }), count(angle, 90), transform(onePeriod, later), { duration: 1.5 })
    st.play(transform(wave, twin, { duration: 2 }))
  })

  s.step('Leaving', (st) => {
    st.say('Everything leaves the way it came.')
    st.play(transform(title, end))
    st.play(
      lagged([fadeOut(later, { shift: DOWN.map((c) => c * 0.25) }), fadeOut(angle, { scale: 0.6 })], { lag: 0.2 }),
      seq(uncreate(twin), uncreate(axes)),
      timed(point.to.scale(1.6), { span: [0.5, 1.5] }),
    )
    st.play(uncreate(hand), fadeOut(point), uncreate(ring), { lag: 0.25 })
  })
})
