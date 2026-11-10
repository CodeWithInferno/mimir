// cam-and-valve: an offset disc on a turning shaft lifts a valve. The picture is built from relations (the cam rides
// a point of the shaft, the valve stands on the tappet), and the scene says what must stay true while it moves:
// `mimir check` holds it to those claims at every step end, during every move and at both ends of every slider.
import { scene, box, cylinder, tube, text, expect, write, fadeIn, BLUE, YELLOW, GREY_B } from 'mimir'

export default scene({ title: 'A cam lifts a valve' }, (s) => {
  s.viewport('right', 0.62)
  const turn = s.param('turn', { value: 0, min: 0, max: 360, unit: '°', label: 'Shaft angle' })
  const offset = s.param('offset', { value: 0.5, min: 0.2, max: 0.7, step: 0.05, label: 'Cam offset' })
  const RADIUS = 1.3 // of the cam disc
  const TAPPET = 0.3 // thickness of the flat plate that rides on it

  // the shaft points at the viewer and turns about its own axis; `lobe` is the point of it that carries the cam
  const shaft = cylinder({ id: 'shaft', radius: 0.25, height: 3, material: 'iron' })
    .rotate({ about: 'x', deg: 90 })
    .rotate({ about: 'z', deg: turn })
  shaft.define('lobe', () => [0, 0, offset()]) // off the axis by the offset: straight down when turn = 0
  const cam = cylinder({ id: 'cam', radius: RADIUS, height: 0.8, color: BLUE }).attach(shaft, { my: 'center', to: 'lobe' })

  // a flat tappet rests on the highest point of the disc; the stem and the valve head stand on it
  const tappet = box({ id: 'tappet', width: 2.4, height: TAPPET, depth: 1.2, material: 'steel' }).at(() => [0, cam.world()[1] + RADIUS + TAPPET / 2, 0])
  const stem = cylinder({ id: 'stem', radius: 0.16, height: 3, material: 'steel' }).nextTo(tappet, 'up', 0)
  const valve = cylinder({ id: 'valve', radius: 0.75, height: 0.22, color: YELLOW }).nextTo(stem, 'up', 0)

  // what holds it: a base, a bearing under the shaft, and a head (two blocks on posts) that carries the glass guide
  const base = box({ id: 'base', width: 6.4, height: 0.2, depth: 3.2, material: 'iron' }).at(0, -2.3, 0)
  const bearing = box({ id: 'bearing', width: 0.8, height: 1.95, depth: 0.4, material: 'iron' }).nextTo(base, 'up', 0).shift(0, 0, -1.2)
  const guide = tube({ id: 'guide', radius: 0.38, thickness: 0.12, height: 1.2, material: 'glass' }).at(0, 3.1, 0)
  const posts = [-1, 1].map((side) => box({ id: side < 0 ? 'postLeft' : 'postRight', width: 0.3, height: 4.7, depth: 0.3, material: 'iron' }).nextTo(base, 'up', 0).shift(side * 1.7, 0, -0.9))
  const head = [-1, 1].map((side, i) => box({ id: side < 0 ? 'headLeft' : 'headRight', width: 1.6, height: 1, depth: 2.2, material: 'iron' }).nextTo(posts[i], 'up', 0).shift(side * -0.52, 0, 0.9))

  // how far the valve is open: measured on the model, not written down
  const closed = () => RADIUS - offset() + TAPPET / 2 // height of the tappet when the cam hangs straight down
  const lift = s.signal(() => tappet.world()[1] - closed())
  s.probe('lift', lift)
  s.probe('offset', () => offset())
  const title = text('A cam lifts a valve', { id: 'title', size: 'section' }).at(-4.4, 2.6)
  const readout = text(() => `lift ${lift().toFixed(2)}`, { id: 'readout', size: 'body', color: YELLOW }).nextTo(title, 'down', 0.7)
  const note = text(() => `offset ${offset().toFixed(2)}`, { id: 'note', size: 'label', color: GREY_B }).nextTo(readout, 'down', 0.35)

  // declared truth: the linter checks these wherever it samples the scene
  expect.touching(tappet, cam) // the tappet never leaves the cam, and never sinks into it
  expect.above(valve, guide) // the valve head stays clear of its guide
  s.expect('the lift is never more than twice the offset', () => lift() <= 2 * offset() + 1e-6)
  s.expect('the valve is shut when the cam hangs down', () => turn() !== 0 || Math.abs(lift()) < 1e-6)
  expect.during('Half a turn', () => lift() >= -1e-6)

  s.step('The parts', (st) => {
    st.say('A [disc](cam) sits off-centre on a turning shaft. A flat [tappet](tappet) rests on it and carries the [valve](valve).')
    st.play(write(title))
    st.camera({ view: 'front', zoom: 0.8 }) // the mechanism is flat: seen from the front nothing hides the stem, and the valve has room to rise
    st.label(cam, 'cam')
    st.label(tappet, 'tappet')
    st.label(valve, 'valve')
    st.wait(1)
  })

  s.step('Half a turn', (st) => {
    st.say('Half a turn brings the wide side of the disc to the top: the valve rises by twice the offset.')
    st.play(fadeIn(readout), fadeIn(note))
    st.set(turn, 180)
    st.focus(cam, tappet, stem, valve, shaft, title, readout)
  })

  s.step('A larger offset', (st) => {
    st.say('Move the disc further off-centre and the same half turn lifts the valve further.')
    st.set(offset, 0.7)
    st.focus(cam, tappet, stem, valve, shaft, title, readout, note)
    st.label(valve, 'opens wider')
  })
})
