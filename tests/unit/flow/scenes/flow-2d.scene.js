// Every 2D effect of the flow module in one scene (a regression scene for shots and `mimir check`): a stream round a
// closed shape, a stream along an arrow that switches on and off, a burst, a vector field, fill levels, a trail.
import { scene, circle, rect, arrow, text, flow, burst, trail, field, fillLevel, ramp, RAMPS, BLUE, TEAL, GOLD, YELLOW, RED, GREY_B, GREY_C } from 'mimir'

export default scene({ title: 'Flow in 2D' }, (s) => {
  const level = s.param('level', { value: 0.35, min: 0, max: 1, label: 'Level' })
  const swirl = s.param('swirl', { value: 1, min: -1, max: 1, label: 'Swirl' })

  // round and round a closed outline
  const loop = circle({ id: 'loop', radius: 1.1, color: GREY_C }).at(-5, 1.6)
  const current = flow(loop, { id: 'current', count: 26, speed: 1.2, tail: 0.12, color: TEAL })

  // along an arrow, in pulses: a number between 0 and 1 fades the stream
  const a = rect({ id: 'a', width: 1.1, height: 0.8, color: BLUE }).at(-2.6, 1.6)
  const b = rect({ id: 'b', width: 1.1, height: 0.8, color: BLUE }).at(1.2, 1.6)
  const wire = arrow(a, b, { id: 'wire', color: GREY_C })
  const pulses = flow(wire, { id: 'pulses', count: 9, speed: 1.5, size: 0.12, color: YELLOW, active: () => 0.5 + 0.5 * Math.sin(s.t() * 2) })

  // a burst every two seconds at the end of the arrow
  const pop = burst(b, { id: 'pop', when: [1, 3, 5, 7], color: GOLD, radius: 0.9 })
  const jet = burst([3.4, 1.6], { id: 'jet', when: [1.3, 3.3, 5.3], color: RED, direction: [1, 0.4], cone: 50, radius: 1.6, count: 16 })

  // a vector field: a rotation whose sense follows a param, coloured by strength
  const heat = ramp(RAMPS.speed)
  const wind = field((x, y) => [-(y + 1.6) * swirl(), (x + 3.6) * swirl() + 0.3], { id: 'wind', region: { x: -6.2, y: -3.2, width: 5.2, height: 3.2 }, density: 1.6, color: (strength) => heat(strength) })

  // fill levels: from the bottom of a circle, from the left of a bar
  const tank = circle({ id: 'tank', radius: 1, color: GREY_B }).at(1, -1.5)
  const water = fillLevel(tank, { id: 'water', level, color: BLUE })
  const bar = rect({ id: 'bar', width: 3, height: 0.5, radius: 0.25, color: GREY_B }).at(4.6, -0.7)
  const progress = fillLevel(bar, { id: 'progress', level, from: 'left', color: TEAL, surface: false, opacity: 0.9 })
  const share = text(() => `${Math.round(level() * 100)}%`, { size: 'note', color: GREY_B }).nextTo(bar, 'down', 0.2)

  // a trail: a Lissajous figure drawn by a moving point
  const pen = (t) => [4.6 + 1.2 * Math.sin(t * 1.5), -2.3 + 0.55 * Math.sin(t * 3 + 0.6)]
  const figure = trail(pen, { id: 'figure', duration: 3, color: GOLD })
  const nib = circle({ id: 'nib', radius: 0.07, color: GOLD, fill: GOLD, fillOpacity: 1 }).at(() => pen(s.t()))

  s.step('Streams', (st) => {
    st.say('Streams, bursts, a field, levels and a trail.')
    st.wait(3)
  })
  s.step('Fill and reverse', (st) => {
    st.say('The level rises and the field turns the other way.')
    st.set(level, 0.85)
    st.set(swirl, -1)
    st.wait(2)
  })
})
