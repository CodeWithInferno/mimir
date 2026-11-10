// MECH-OPEN negative: the slider is one rod length from the pin at every angle.
import { scene, box, cylinder, between, BLUE, GREY_B } from 'mimir'
export default scene({ title: 'A rigid rod' }, (s) => {
  const crank = s.param('crank', { value: 0, min: 0, max: 360, unit: '°' })
  const wheel = cylinder({ id: 'wheel', radius: 1.5, height: 0.4, color: GREY_B }).rotate({ about: 'x', deg: 90 }).rotate({ about: 'z', deg: crank })
  wheel.define('pin', [0, 0.2, -1.2])
  const pin = cylinder({ id: 'pin', radius: 0.15, height: 0.5 }).attach(wheel, { my: 'bottom', to: 'pin' })
  const slider = box({ id: 'slider', width: 1, height: 0.8, depth: 0.8, color: BLUE }).at(() => { const [x, y] = pin.world(); return [0, y + Math.sqrt(16 - x * x), 0.45] })
  const rod = between(pin, slider, { id: 'rod', radius: 0.1 })
  s.step('Half a turn', (st) => { st.say('The wheel turns.'); st.set(crank, 180) })
})
