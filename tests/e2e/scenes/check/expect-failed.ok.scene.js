// EXPECT-FAILED negative: the same claims, kept. The cam turns at half the crank's speed, the rod keeps its length,
// the valve stays above the piston, and a claim that is scoped to one step is only checked there.
import { scene, box, expect, BLUE, GREY_B } from 'mimir'
export default scene({ title: 'Kept promises' }, (s) => {
  const crank = s.param('crank', { value: 0, min: 0, max: 720, unit: '°' })
  const lift = () => 0.4 + crank() / 3600
  const floor = box({ id: 'floor', width: 5, height: 0.2, depth: 2, color: GREY_B }).at(0, -0.1, 0)
  const piston = box({ id: 'piston', width: 1.6, height: 1, depth: 1.6, color: BLUE }).at(() => [0, 0.5 + lift() * 0.4, 0])
  const valve = box({ id: 'valve', width: 0.5, height: 0.3, depth: 0.5 }).nextTo(floor, 'up', 1.6).shift(2, 0, 0)
  s.probe('crankAngle', () => crank())
  s.probe('camAngle', () => crank() / 2)
  s.probe('rodLength', () => 3)
  expect.above(valve, piston)
  expect.inside(piston, floor, { tolerance: 5 })
  expect.touching(piston, floor, { tolerance: 0.5 })
  s.expect('the lift stays under 1', () => lift() <= 1)
  expect.ratio('camAngle', 'crankAngle', 0.5)
  expect.conserved('rodLength')
  expect.during('Rise', () => crank() >= 0)
  expect.during(1, () => expect.above(valve, floor))
  s.step('Rest', (st) => { st.say('The piston rests on the floor.'); st.wait(1) })
  s.step('Rise', (st) => { st.say('It rises.'); st.set(crank, 360) })
})
