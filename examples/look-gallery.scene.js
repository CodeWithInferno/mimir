// look-gallery: a hand-cranked piston pump built from every 3D primitive, with every material, shown in the five
// states of the 3D look: solid, focus, ghost, cutaway (the plane sweeps), exploded.
// One param (the crank angle, in degrees) drives the mechanism: the pin rides on the wheel, the rod spans pin to
// piston, the piston's height is one line of Pythagoras, and the water under it is a fluid whose height follows.
import {
  scene, box, sphere, cylinder, cone, torus, tube, extrude, lathe, sweep, mesh, repeat, between,
  create, fadeIn, lagged, BLUE, GREEN, RED,
} from 'mimir'

export default scene({ title: 'A piston pump, five ways to look at it' }, (s) => {
  const crank = s.param('crank', { value: 30, min: 0, max: 360, unit: '°', label: 'Crank angle' })
  const R = 1.0 // crank radius
  const L = 4.2 // rod length
  const AXLE = 8.2 // height of the crank axle
  const FLOOR = 0.35 // inside floor of the barrel

  // ── the frame: a plate with bolt holes, a column, a gusset ────────────────────────────────────────
  /** a round hole as a 16-sided outline @param {number} x @param {number} y */
  const hole = (x, y, r = 0.24) => Array.from({ length: 16 }, (_, i) => [x + r * Math.cos((i / 16) * 2 * Math.PI), y + r * Math.sin((i / 16) * 2 * Math.PI)])
  const corner = 1.85
  const plate = extrude(
    [[-2.7, -2.2], [-2.2, -2.7], [2.2, -2.7], [2.7, -2.2], [2.7, 2.2], [2.2, 2.7], [-2.2, 2.7], [-2.7, 2.2]],
    { id: 'plate', depth: 0.4, bevel: 0.06, holes: [hole(-corner, -corner), hole(corner, -corner), hole(corner, corner), hole(-corner, corner)], material: 'iron' },
  ).rotate({ about: 'x', deg: 90 }).at(0, -0.2, 0)
  const bolts = repeat(4, () => cylinder({ radius: 0.2, height: 0.5, role: 'fastener' }))
    .ring({ radius: corner * Math.SQRT2, phase: 45 }).at(0, -0.1, 0)
  const column = box({ id: 'column', width: 0.9, height: 8.6, depth: 0.7, material: 'iron' }).at(0, 4.3, -2.05)
  // a wedge under the column, as raw triangles: 6 points, 8 triangles
  const gusset = mesh({
    id: 'gusset', material: 'matte',
    positions: [[-0.25, 0, 0], [0.25, 0, 0], [-0.25, 0, 1.1], [0.25, 0, 1.1], [-0.25, 1.6, 0], [0.25, 1.6, 0]],
    indices: [[0, 1, 3], [0, 3, 2], [0, 4, 5], [0, 5, 1], [2, 3, 5], [2, 5, 4], [0, 2, 4], [1, 5, 3]],
  }).at(0, 0, -1.7)
  const lamp = sphere({ id: 'lamp', radius: 0.24, material: 'glow', color: GREEN }).at(0, 8.86, -2.05)

  // ── the barrel and what is inside it ──────────────────────────────────────────────────────────────
  const barrel = tube({ id: 'barrel', radius: 1.3, thickness: 0.18, height: 5.6, shell: true }).at(0, 2.8, 0)
  const floor = cylinder({ id: 'floor', radius: 1.3, height: FLOOR, shell: true }).at(0, FLOOR / 2, 0)
  const fins = repeat(4, () => torus({ radius: 1.36, tube: 0.09, material: 'plastic' })).line({ step: [0, 0.42, 0] }).at(0, 4.3, 0)

  // ── the crank: a wheel that turns about z, a pin on its face, an axle back to the column ──────────
  const wheel = cylinder({ id: 'wheel', radius: 1.45, height: 0.35, material: 'brass' })
    .rotate({ about: 'x', deg: 90 })
    .rotate({ about: 'z', deg: crank })
    .at(0, AXLE, -0.5)
  wheel.define('pin', [0, 0.175, -R]) // on the front face, R from the axis: straight up when crank = 0
  const pin = cylinder({ id: 'pin', radius: 0.2, height: 0.7, material: 'copper' }).attach(wheel, { my: 'bottom', to: 'pin' })
  const axle = between([0, AXLE, -1.7], wheel.anchor('bottom'), { id: 'axle', radius: 0.22, material: 'steel' })
  axle.allow('OCCLUDED') // it runs behind the wheel: structure, never the subject of a step
  const guard = box({ id: 'guard', width: 3.5, height: 3.5, depth: 1.5, material: 'ghost' }).at(0, AXLE, -0.35)

  // ── the piston: a turned profile with two ring grooves; it stays on the barrel's axis, one rod length from the pin
  const piston = lathe(
    [[0, 0], [1.1, 0], [1.1, 0.3], [1.02, 0.3], [1.02, 0.42], [1.1, 0.42], [1.1, 0.6], [1.02, 0.6], [1.02, 0.72], [1.1, 0.72], [1.1, 1.0], [0.35, 1.0], [0.35, 1.25], [0, 1.25]],
    { id: 'piston', material: 'steel' },
  ).at(() => {
    const [x, y] = pin.world()
    return [0, y - Math.sqrt(L * L - x * x) - 1.25, 0]
  })
  const seal = torus({ id: 'seal', radius: 1.06, tube: 0.06, material: 'rubber' }).attach(piston, { my: 'center', to: 'bottom', gap: -0.36 })
  const rod = between(pin, piston.anchor('top'), { id: 'rod', radius: 0.14, material: 'aluminium' })

  // the water under the piston: a fluid whose height follows the piston and whose energy rises as it is squeezed
  const level = () => piston.world('bottom')[1] - FLOOR
  const water = cylinder({ id: 'water', radius: 1.1, height: level, role: 'fluid', color: BLUE, energy: () => 1 - (level() - 1.7) / 2 })
    .at(0, () => FLOOR + level() / 2, 0)
  const valve = sphere({ id: 'valve', radius: 0.3, material: 'steel' }).at(0, FLOOR + 0.3, 0)

  // ── the way out: a bent pipe, a nozzle, a sight glass ─────────────────────────────────────────────
  const spout = sweep([[1.2, 1.2, 0], [3.3, 1.2, 0], [3.3, 0.55, 0]], { id: 'spout', radius: 0.3, bend: 0.6, material: 'copper' })
  const nozzle = cone({ id: 'nozzle', radius: 0.44, height: 0.6, color: RED }).rotate({ about: 'x', deg: 180 }).at(3.3, 0.3, 0)
  spout.allow('INTERPENETRATE', nozzle) // declared for check: the nozzle is pushed over the end of the pipe
  const sight = tube({ id: 'sight', radius: 0.32, thickness: 0.05, height: 3.2, material: 'glass' }).at(-1.75, 2.2, 0)

  // how the pump comes apart: the housing slides off the mechanism, which stays where it works
  barrel.explode({ axis: 'front', order: 1, distance: 4.2 })
  fins.explode({ axis: 'front', order: 2, distance: 6.4 })
  guard.explode({ axis: 'front', order: 1, distance: 3 })
  floor.explode({ axis: 'down', order: 1 })
  plate.explode({ axis: 'down', order: 2 })
  bolts.explode({ axis: 'down', order: 3 })
  spout.explode({ axis: 'right', order: 1 })
  nozzle.explode({ axis: 'right', order: 2 })
  sight.explode({ axis: 'left', order: 1 })
  for (const part of [wheel, column, gusset, lamp, valve]) part.explode(false)

  s.probe('pistonHeight', () => piston.world('bottom')[1])
  s.probe('waterLevel', level)

  s.step('Solid', (st) => {
    st.say('A piston pump: a crank, a rod, a piston in a barrel, and a pipe out.')
    st.camera({ view: 'iso', fit: [plate, column, lamp, spout, sight], zoom: 1.2, duration: 0 })
    // every part is drawn on, line work first, from the ground up; the fluid and the lamp fade in last
    st.play(lagged([plate, bolts, column, gusset, floor, valve, barrel, fins, sight, spout, nozzle, piston, seal, axle, wheel, pin, rod, guard].map((part) => create(part)), { lag: 0.12 }), { duration: 3 })
    st.play(fadeIn(water), fadeIn(lamp))
    st.set(crank, 150)
  })

  s.step('Focus', (st) => {
    st.say('The [piston](focus:piston) is the part that does the work.')
    st.focus(piston)
    st.label(piston, 'piston')
    st.set(crank, 330)
  })

  s.step('Ghost', (st) => {
    st.say('Make the housing a ghost, and the water it moves shows through.')
    st.ghost(true)
    st.label(water, 'water')
    st.set(crank, 540)
  })

  s.step('Cutaway', (st) => {
    st.say('A cut through the middle: solid walls are hatched, the mechanism stays whole.')
    st.ghost(false)
    st.cutaway({ axis: 'z', at: 0 }, { duration: 2.5 })
    st.label(barrel, 'barrel wall')
    st.set(crank, 720)
  })

  s.step('Exploded', (st) => {
    st.say('Pulled apart: the housing slides off, and the mechanism stays where it works.')
    st.cutaway(false, { duration: 1.5 })
    st.explode(1, { duration: 2.5 })
    st.camera({ fit: true, duration: 2.5 })
    st.wait(3)
  })
})
