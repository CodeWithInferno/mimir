// A fixture for the guide: a small 3D machine with a wide base plate beside flat content that is in the pointer's
// way. Every case of tests/unit/guide/browser.test.ts is in here; nothing in it is tuned to pass.
import { scene, box, cylinder, rect, text, line, circle, BLUE, RED, TEAL, GOLD, GREY_B } from 'mimir'

export default scene({ title: 'guide fixture' }, (s) => {
  s.viewport('right', 0.55)
  const turn = s.param('turn', { value: 0, min: 0, max: 360 })
  // ── the machine: a plate, two posts, a beam across them, a weight that swings on the beam ───────────────
  const plate = box({ id: 'plate', width: 7, height: 0.3, depth: 4, material: 'iron' }).at(0, -2.6, 0)
  const postA = box({ id: 'postA', width: 0.4, height: 4.6, depth: 0.4, material: 'aluminium' }).at(-1.4, -0.15, 0)
  const postB = box({ id: 'postB', width: 0.4, height: 4.6, depth: 0.4, material: 'aluminium' }).at(1.4, -0.15, 0)
  const beam = cylinder({ id: 'beam', radius: 0.3, height: 3.6, color: GOLD }).at(0, 2.3, 0).rotate({ about: 'z', deg: 90 })
  const weight = box({ id: 'weight', width: 0.7, height: 0.7, depth: 0.7, color: TEAL }).at(() => 0.9 * Math.sin((turn() * Math.PI) / 180), 0.4, 0)
  const knob = cylinder({ id: 'knob', radius: 0.22, height: 0.3, color: RED }).at(-1.4, 2.6, 0)
  plate.allow('OCCLUDED'); beam.allow('INTERPENETRATE', postA).allow('INTERPENETRATE', postB); knob.allow('INTERPENETRATE', postA).allow('INTERPENETRATE', beam)

  // ── the flat side: a small box with words right where a pointer would hang, a thin tall bar, a line ─────
  const target = rect({ id: 'target', width: 1.2, height: 0.7, color: BLUE }).at(-4.6, 2.2)
  const below = text('words under the box', { id: 'below', size: 'note', color: GREY_B }).at(-4.3, 1.62)
  const beside = text('and beside it', { id: 'beside', size: 'note', color: GREY_B }).at(-3.1, 2.2)
  const bar = rect({ id: 'bar', width: 0.3, height: 3, color: GOLD }).at(-5.9, -0.6)
  const wire = line([-4.9, -1.9], [-2.4, 0.3], { id: 'wire', color: GREY_B })
  const dotOnly = circle({ id: 'spot', radius: 0.12, color: RED, fill: RED }).at(-3.2, -1.6)
  const value = text('42 units', { id: 'value', size: 'body', color: TEAL }).at(-4.2, 0.7)

  s.step('Names', (st) => {
    st.say('A [beam](label:beam) lies on two posts, and a [weight](label:weight) hangs from it.')
    st.say('A [knob](knob) sits on top. Then the [box](target), the [number](value) and the [bar](ring:bar).')
    st.label(postA, 'left post')
    st.label(postB, 'right post')
    st.label(plate, 'base plate')
    st.label(wire, 'a wire')
    st.set(turn, 360)
  })
  s.step('Rings and a turn of the view', (st) => {
    st.say('A ring round a [post](ring:postA) hugs it. The [spot](spot) is small.')
    st.label(weight, 'the weight that swings on the beam')
    st.label(knob, 'knob')
    st.camera({ azimuth: 70, elevation: 15 })
  })
  s.step('The light', (st) => {
    st.say('First the [beam](beam), then the [weight](weight), then the [knob](knob) again.')
  })
})
