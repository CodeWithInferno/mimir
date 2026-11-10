// Every 3D effect of the flow module in one scene (a regression scene for shots and `mimir check`): particles through
// a glass pipe coloured along the way, a tank filling, a chamber of gas squeezed by a piston, a spark, a trail.
import { scene, box, cylinder, tube, sphere, between, flow, burst, trail, fillLevel, gas, colorScale, text, BLUE, GOLD, YELLOW, GREY_B } from 'mimir'

export default scene({ title: 'Flow in 3D' }, (s) => {
  const squeeze = s.param('squeeze', { value: 0.15, min: 0, max: 1, label: 'Squeeze' })
  const heat = colorScale('temperature', { min: 0, max: 1 })

  // particles through a glass pipe, warming on the way
  const pipe = tube({ id: 'pipe', radius: 0.55, thickness: 0.04, height: 7, material: 'glass' }).rotate({ about: 'z', deg: -90 }).at(0, 2.6, 0)
  const stream = flow(pipe, { id: 'stream', count: 110, spread: 0.42, speed: 1.4, tail: 0.08, color: (along) => heat(along) })

  // a tank that fills
  const tank = box({ id: 'tank', width: 2.2, height: 2.6, depth: 2.2, material: 'glass' }).at(-3.4, -0.9, 0)
  const water = fillLevel(tank, { id: 'water', level: () => 0.15 + 0.7 * squeeze(), color: BLUE })

  // a chamber of gas between a piston and a head, inside a glass liner
  const head = cylinder({ id: 'head', radius: 1.15, height: 0.3, material: 'steel' }).at(1.6, 0.9, 0)
  const piston = cylinder({ id: 'piston', radius: 1, height: 0.5, material: 'aluminium' }).at(1.6, () => -2.4 + 2.2 * squeeze(), 0)
  const chamber = between(piston.anchor('top'), head.anchor('bottom'), { id: 'chamber', radius: 1 })
  chamber.allow('MECH-OPEN') // a volume of gas, not a rod: it is meant to change length
  const charge = gas(chamber, { id: 'charge', density: () => 0.2 + 0.8 * squeeze(), temperature: () => squeeze() })

  // a spark under the head, and a moon that leaves a trail
  const spark = burst(head.anchor('bottom'), { id: 'spark', when: [1, 9.5], color: YELLOW, radius: 1.2 })
  const orbit = (t) => [4.6 + 0.9 * Math.cos(t * 1.6), -0.6 + 0.9 * Math.sin(t * 1.6), 0.9 * Math.sin(t * 0.8)]
  const moon = sphere({ id: 'moon', radius: 0.16, color: GOLD, material: 'glow' }).at(() => orbit(s.t()))
  const wake = trail((t) => orbit(t), { id: 'wake', duration: 2.5, color: GOLD, width: 3 })
  const note = text('flow · fillLevel · gas · burst · trail', { size: 'note', color: GREY_B }).at(0, 3.5).hud()

  s.step('At rest', (st) => {
    st.say('A stream in a pipe, a tank, a chamber of gas.')
    st.wait(3)
  })
  s.step('Squeeze', (st) => {
    st.say('The piston squeezes the gas: it gets denser and hotter, and the tank fills.')
    st.set(squeeze, 0.85)
    st.wait(3)
  })
})
