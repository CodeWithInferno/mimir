// FLOATING negative: the lamp stands on the table; a moon that orbits it and a drone that is allowed to hover are
// not parts that failed to touch.
import { scene, box, cylinder, sphere, GREY_B, YELLOW } from 'mimir'
export default scene({ title: 'A lamp on a table' }, (s) => {
  const turn = s.param('turn', { value: 0, min: 0, max: 360, unit: '°' })
  const top = box({ id: 'top', width: 4, height: 0.2, depth: 2.4, color: GREY_B }).at(0, 2, 0)
  const legs = [[-1.8, -1], [1.8, -1], [-1.8, 1], [1.8, 1]].map(([x, z], i) => box({ id: `leg${i + 1}`, width: 0.2, height: 2, depth: 0.2 }).nextTo(top, 'down', 0).shift(x, 0, z))
  const lamp = cylinder({ id: 'lamp', radius: 0.3, height: 0.8, color: YELLOW }).nextTo(top, 'up', 0).shift(0.8, 0, 0)
  const moon = sphere({ id: 'moon', radius: 0.2 }).at(() => [1.2 * Math.cos((turn() * Math.PI) / 180), 3.4, 1.2 * Math.sin((turn() * Math.PI) / 180)])
  const drone = box({ id: 'drone', width: 0.5, height: 0.15, depth: 0.5 }).at(-1.2, 2.5, 0).allow('FLOATING')
  s.step('A table', (st) => { st.say('A table, a lamp, a moon.'); st.set(turn, 180) })
})
