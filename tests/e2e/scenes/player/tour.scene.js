// The player's fixture: a crank and slider told in three chapters, with everything the chrome has to show. Parameters
// in two groups (a number, a switch, a choice) and one hidden one, parts with descriptions, probes named after their
// parts, narration that names parts, a note for read mode.
import { scene, box, cylinder, tube, between, BLUE, YELLOW, GREY_D } from 'mimir'

export default scene({ title: 'How a crank turns a slider', subtitle: 'Turning becomes sliding' }, (s) => {
  const crank = s.param('crank', { value: 40, min: 0, max: 360, unit: '°', label: 'Crank angle', group: 'Running' })
  const radius = s.param('radius', { value: 1.6, min: 1, max: 2, step: 0.1, unit: 'm', label: 'Crank radius', group: 'Geometry' })
  const trace = s.toggle('trace', { value: false, label: 'Long rod', group: 'Geometry' })
  const metal = s.choice('metal', { options: ['steel', 'brass', 'copper'], value: 'steel', label: 'Wheel', group: 'Geometry' })
  const tilt = s.param('tilt', { value: 0, min: 0, max: 20, unit: '°', hidden: true }) // the story may drive it; the viewer offers no control
  const L = () => (trace() ? 6 : 5.2)

  const wheel = cylinder({ id: 'wheel', radius: 2.1, height: 0.5, material: () => metal() })
    .rotate({ about: 'x', deg: 90 })
    .rotate({ about: 'z', deg: crank })
    .describe('Turns about its axle and carries the crank pin round with it.')
  wheel.define('pin', () => [0, 0.25, -radius()])
  const axle = cylinder({ id: 'axle', radius: 0.35, height: 1.9, material: 'iron' }).attach(wheel, { my: 'center', to: 'center' }).shift(0, 0, -0.5)
  const pin = cylinder({ id: 'pin', radius: 0.26, height: 0.9, material: 'brass' }).attach(wheel, { my: 'bottom', to: 'pin' })
    .describe('Sits off the centre of the wheel, so it travels in a circle.')
  const slider = box({ id: 'slider', width: 1.5, height: 1.3, depth: 1.3, color: BLUE }).at(() => {
    const [x, y] = pin.world()
    return [0, y + Math.sqrt(L() * L() - x * x), 0.7]
  }).describe('Can only move along the guide: the rod pushes and pulls it.')
  const rod = between(pin, slider, { id: 'rod', radius: 0.17, material: 'aluminium' }).allow('MECH-OPEN') // the switch swaps in a longer rod
  const guide = tube({ id: 'guide', radius: 1.25, thickness: 0.12, height: 6, material: 'glass' }).at(0, 5.4, 0.7)
  const base = box({ id: 'base', width: 6.4, height: 0.4, depth: 3.2, color: GREY_D }).at(0, -2.6, 0.3).rotate({ about: 'y', deg: tilt })
  const all = [wheel, axle, pin, slider, rod, guide, base]

  s.probe('sliderHeight', () => slider.world()[1])
  s.probe('pinX', () => pin.world()[0])

  s.chapter('Meet the parts')
  s.step('Three parts', (st) => {
    st.say('A [wheel](wheel), a [rod](rod) and a [slider](slider): turning becomes sliding.')
    st.wait(1)
  })
  s.step('What moves', (st) => {
    st.say('The [crank pin](pin) rides on the wheel, off its centre.')
    st.note('The distance from the centre of the wheel to the pin is the **crank radius**. The stroke of the slider is twice that.')
    st.set(crank, 90)
  })

  s.chapter('One turn', { keep: all })
  s.step('Half a turn', (st) => {
    st.say('Half a turn of the wheel pulls the [slider](slider) all the way down.')
    st.camera({ view: 'front' })
    st.set(crank, 220)
  })
  s.step('A full turn', (st) => {
    st.say('The second half pushes it back up: one turn, one stroke each way.')
    st.camera({ view: 'iso' })
    st.set(crank, 400)
    st.play(pin.to.color(YELLOW))
  })

  s.chapter('Why it matters', { keep: all })
  s.step('Engines', (st) => {
    st.say('Run it backwards and a sliding piston turns a wheel: that is an engine.')
    st.camera({ view: 'front' })
    st.set(crank, 580)
    st.set(tilt, 20)
  })
})
