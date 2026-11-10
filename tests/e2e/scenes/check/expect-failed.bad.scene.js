// EXPECT-FAILED: four claims the scene does not keep. The piston rises past the valve, the lift goes over its limit,
// the cam turns at crank speed (it should turn at half), and the rod changes length.
import { scene, box, expect, BLUE, GREY_B } from 'mimir'
export default scene({ title: 'Broken promises' }, (s) => {
  const crank = s.param('crank', { value: 0, min: 0, max: 720, unit: '°' })
  const lift = () => 0.4 + crank() / 360
  const floor = box({ id: 'floor', width: 5, height: 0.2, depth: 2, color: GREY_B }).at(0, -0.1, 0)
  const piston = box({ id: 'piston', width: 1.6, height: 1, depth: 1.6, color: BLUE }).at(() => [0, 0.5 + lift() * 0.4, 0])
  const valve = box({ id: 'valve', width: 0.5, height: 0.3, depth: 0.5 }).nextTo(floor, 'up', 1.3).shift(2, 0, 0)
  s.probe('crankAngle', () => crank())
  s.probe('camAngle', () => crank())
  s.probe('rodLength', () => 3 + crank() / 720)
  expect.above(valve, piston)
  s.expect('the lift stays under 1', () => lift() <= 1)
  expect.ratio('camAngle', 'crankAngle', 0.5)
  expect.conserved('rodLength')
  s.step('Rest', (st) => { st.say('The piston rests on the floor.'); st.wait(1) })
  s.step('Rise', (st) => { st.say('It rises.'); st.set(crank, 360) })
})
