// slider-crank: a crankshaft, a connecting rod and a piston in a cut-open cylinder, built from kit parts.
// crankSlider() does the trigonometry: the scene gives real dimensions (bore = stroke = 86 mm, rod 139 mm, drawn at
// 1 unit = 50 mm) and one param, the crank angle in degrees. Every number shown is read back from the mechanism.
import { scene, kit, crankSlider, text, rect, column, BLUE, GOLD, GREY_B, GREY_D, WHITE } from 'mimir'

export default scene({ title: 'How a crank moves a piston' }, (s) => {
  const mm = 0.02
  const bore = 86 * mm, stroke = 86 * mm, rodLength = 139 * mm
  const crank = s.param('crank', { value: 0, min: 0, max: 720, unit: '°', label: 'Crank angle' })
  s.viewport('right', 0.62)

  // ── the model: default orientations assemble with no rotate() at all ────────────────────────────────
  // an overhung crank (one web, the pin standing out in front) keeps the rod and both of its pins in view
  const crankshaft = kit.crankshaft({ id: 'crankshaft', throw: stroke / 2, journal: 55 * mm, crankpin: 45 * mm, pinLength: 26 * mm, webThickness: 18 * mm, overhung: true, material: 'iron' })
  const rod = kit.conRod({ id: 'rod', length: rodLength, bigEnd: 46 * mm, smallEnd: 22.5 * mm, thickness: 22 * mm, material: 'aluminium' })
  const piston = kit.piston({ id: 'piston', bore, pin: 22 * mm, color: BLUE })
  // the cylinder covers the whole travel of the piston; its front half is cut away so the piston shows
  const cylinder = kit.liner({ id: 'cylinder', bore, height: 150 * mm, cut: 'half' }).at(0, 151 * mm, 0)

  const slide = crankSlider({ id: 'slide', crank: crankshaft, rod, slider: piston, axis: 'up', angle: crank })
  s.probe('travelPercent', () => 100 * slide.fraction())
  s.probe('pistonHeight', () => piston.world('pin')[1])

  // ── the numbers, beside the model ───────────────────────────────────────────────────────────────────
  const side = s.area() // the part of the frame the 3D panel leaves free
  const title = text('Turning becomes sliding', { size: 'body' })
  const angle = text(() => `crank angle  ${Math.round(crank() % 360)}°`, { size: 'label', color: GREY_B })
  const travel = text(() => `piston at ${(100 * slide.fraction()).toFixed(1)} % of its stroke`, { size: 'label', color: WHITE })
  const size = text('bore 86 mm,  stroke 86 mm,  rod 139 mm', { size: 'note', color: GREY_B })
  const numbers = column([title, angle, travel, size], { gap: 0.3, align: 'left' }).at(side.center[0], 2.1)
  // a gauge of the stroke: the bar grows downwards as the piston leaves top dead centre
  const track = rect({ id: 'track', width: 0.34, height: 2.6, radius: 0.06, color: GREY_D, strokeWidth: 2 }).at(side.left + 0.4, -1.3)
  const level = rect({ id: 'level', width: 0.34, height: () => 0.02 + 2.58 * slide.fraction(), radius: 0.06, strokeWidth: 0, fill: BLUE })
    .at(() => [side.left + 0.4, 0 - (0.02 + 2.58 * slide.fraction()) / 2])
  const top = text('top dead centre', { size: 'note', color: GREY_B }).nextTo(track, 'right', 0.3).shift(0, 1.15)
  const bottom = text('bottom dead centre', { size: 'note', color: GREY_B }).nextTo(track, 'right', 0.3).shift(0, -1.15)

  s.step('The parts', (st) => {
    st.say('A crankshaft turns. A connecting rod ties its pin to a piston, and the piston can only slide in its cylinder.')
    st.label(crankshaft, 'crankshaft')
    st.label(rod, 'connecting rod')
    st.label(piston, 'piston')
    st.label(cylinder, 'cylinder')
    st.wait(2.5)
  })

  s.step('A quarter turn', (st) => {
    st.say('After a quarter turn the piston is already past the middle: 57.9 percent of its stroke, because the rod leans.')
    st.camera({ view: 'front' })
    st.set(crank, 90)
    st.focus(piston, rod, travel, level)
    st.label(rod, 'the rod leans')
  })

  s.step('Bottom dead centre', (st) => {
    st.say('Half a turn brings it to the bottom: one stroke, 86 millimetres, twice the throw of the crank.')
    st.set(crank, 180)
    st.label(piston, 'bottom dead centre')
  })

  s.step('Back to the top', (st) => {
    st.say('The second half turn pushes it back up, and the cycle starts again.')
    st.camera({ view: 'iso' })
    st.set(crank, 360)
    st.play(piston.to.color(GOLD))
  })
})
