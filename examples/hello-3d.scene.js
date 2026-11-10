// hello-3d: a crank and slider built from primitives. One param (the crank angle, in degrees) drives everything:
// the pin rides on the wheel (attach), the rod spans pin → slider (between), the slider's height is a function.
import { scene, box, cylinder, tube, between, BLUE, YELLOW, GREY_D } from 'mimir'

export default scene({ title: 'Crank and slider' }, (s) => {
  const crank = s.param('crank', { value: 40, min: 0, max: 360, unit: '°', label: 'Crank angle' })
  const R = 1.6 // crank radius
  const L = 5.2 // rod length

  // the wheel lies in the x-y plane (its axis points at the viewer) and turns about z
  const wheel = cylinder({ id: 'wheel', radius: 2.1, height: 0.5, material: 'steel' })
    .rotate({ about: 'x', deg: 90 })
    .rotate({ about: 'z', deg: crank })
  wheel.define('pin', [0, 0.25, -R]) // a point on the wheel's face, R from the axis: straight up when crank = 0
  // the axle runs through the wheel and out at the back; in front it stops short of the plane the rod swings in
  const axle = cylinder({ id: 'axle', radius: 0.35, height: 1.9, material: 'iron' }).attach(wheel, { my: 'center', to: 'center' }).shift(0, 0, -0.5)
  const pin = cylinder({ id: 'pin', radius: 0.26, height: 0.9, material: 'brass' }).attach(wheel, { my: 'bottom', to: 'pin' })

  // the slider stays on the vertical line above the axle, one rod length from the pin (Pythagoras, no trig)
  const slider = box({ id: 'slider', width: 1.5, height: 1.3, depth: 1.3, color: BLUE }).at(() => {
    const [x, y] = pin.world()
    return [0, y + Math.sqrt(L * L - x * x), 0.7]
  })
  const rod = between(pin, slider, { id: 'rod', radius: 0.17, material: 'aluminium' })
  const guide = tube({ id: 'guide', radius: 1.25, thickness: 0.12, height: 5, material: 'glass' }).at(0, L, 0.7)
  const base = box({ id: 'base', width: 6.4, height: 0.4, depth: 3.2, color: GREY_D }).at(0, -2.6, 0.3)
  // a stand carries the axle: nothing hangs in the air
  const stand = box({ id: 'stand', width: 1.1, height: 2.05, depth: 0.9, color: GREY_D }).attach(base, { my: 'bottom', to: 'top' }).shift(0, 0, -1.3)

  s.probe('sliderHeight', () => slider.world()[1])

  s.step('The parts', (st) => {
    st.say('A wheel, a rod and a slider: turning becomes sliding.')
    st.label(wheel, 'crank wheel')
    st.label(rod, 'connecting rod')
    st.label(slider, 'slider')
    st.wait(2)
  })

  s.step('Half a turn', (st) => {
    st.say('Half a turn of the wheel pulls the slider all the way down.')
    st.camera({ view: 'front' })
    st.set(crank, 180)
    st.focus(slider, rod, pin)
    st.label(slider, 'slides down')
  })

  s.step('A full turn', (st) => {
    st.say('The second half pushes it back up: one turn, one stroke each way.')
    st.camera({ view: 'iso' })
    st.set(crank, 360)
    st.label(pin, 'crank pin')
    st.play(pin.to.color(YELLOW))
  })
})
