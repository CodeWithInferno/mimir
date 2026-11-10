// hydraulic-press: how a hydraulic press multiplies force. Two pistons share one body of oil; the oil cannot be
// squeezed, so the volume the small piston pushes out is the volume the large one gains. Nothing is keyed by hand:
// the rise of the large piston and the force it gives are computed from the two areas, and both sliders recompute them.
// It also shows the CLI at work: chapters, a narration with guide spans, a parameter the story sweeps, probes.
//   mimir shot examples/hydraulic-press.scene.js --sheet          a row per chapter
//   mimir shot examples/hydraulic-press.scene.js --cues           one frame per [word](part) of the narration
//   mimir shot examples/hydraulic-press.scene.js --at push=1      the moment the story has pushed half way
//   mimir query examples/hydraulic-press.scene.js probes --at push=2
import { scene, box, cylinder, tube, text, fadeIn, lagged, BLUE, GOLD, GREY_B, GREY_D, TEAL, WHITE } from 'mimir'

const SMALL_RADIUS = 0.6 // radius of the small piston
const OIL_LEVEL = 2.2 // height of both oil columns at rest
const FORCE_IN = 100 // newtons on the small piston
const GAP = 4.2 // distance between the two cylinders
const FLOOR = -2 // top of the base

export default scene({ title: 'How a hydraulic press multiplies force' }, (s) => {
  const push = s.param('push', { value: 0, min: 0, max: 2, step: 0.01, label: 'Push the small piston' })
  const bore = s.param('bore', { value: 1.8, min: 1.2, max: 2.4, step: 0.01, label: 'Radius of the large piston' })

  // the whole physics: the areas give the ratio, the ratio gives the rise and the force
  const ratio = s.signal(() => (bore() * bore()) / (SMALL_RADIUS * SMALL_RADIUS))
  const rise = s.signal(() => push() / ratio())
  const forceOut = s.signal(() => FORCE_IN * ratio())
  s.probe('areaRatio', ratio)
  s.probe('rise', rise)
  s.probe('forceOut', forceOut)

  s.viewport('left', 0.62)
  const xSmall = -GAP / 2
  const xLarge = GAP / 2

  const base = box({ id: 'base', width: GAP + 6, height: 0.4, depth: 5.4, color: GREY_D }).at(0, FLOOR - 0.2, 0)
  // the pipe runs from wall to wall, so it shortens when the large cylinder widens
  const pipe = cylinder({ id: 'pipe', radius: 0.32, height: () => GAP - SMALL_RADIUS - bore(), color: BLUE })
    .rotate({ about: 'z', deg: 90 }).at(() => [(SMALL_RADIUS - bore()) / 2, FLOOR + 0.32, 0]).opacity(0.8)
  // the oil: two columns whose heights trade volume
  const oilSmall = cylinder({ id: 'oilSmall', radius: SMALL_RADIUS * 0.94, height: () => OIL_LEVEL - push(), color: BLUE })
    .at(xSmall, () => FLOOR + (OIL_LEVEL - push()) / 2, 0).opacity(0.8)
  const oil = cylinder({ id: 'oil', radius: () => bore() * 0.97, height: () => OIL_LEVEL + rise(), color: BLUE })
    .at(xLarge, () => FLOOR + (OIL_LEVEL + rise()) / 2, 0).opacity(0.8)
  // each piston rides on its column, each load on its piston
  const small = cylinder({ id: 'small', radius: SMALL_RADIUS * 0.94, height: 0.3, material: 'steel' }).attach(oilSmall, { my: 'bottom', to: 'top' })
  const large = cylinder({ id: 'large', radius: () => bore() * 0.97, height: 0.3, material: 'steel' }).attach(oil, { my: 'bottom', to: 'top' })
  const hand = box({ id: 'hand', width: 0.7, height: 0.7, depth: 0.7, color: GOLD }).attach(small, { my: 'bottom', to: 'top' })
  const load = box({ id: 'load', width: 2.2, height: 1.3, depth: 2.2, color: TEAL }).attach(large, { my: 'bottom', to: 'top' })
  const wallSmall = tube({ id: 'wallSmall', radius: SMALL_RADIUS + 0.1, thickness: 0.1, height: 4.4, material: 'glass' }).at(xSmall, FLOOR + 2.2, 0)
  const wallLarge = tube({ id: 'wallLarge', radius: () => bore() + 0.1, thickness: 0.1, height: 4.4, material: 'glass' }).at(xLarge, FLOOR + 2.2, 0)
  const model = [base, pipe, oilSmall, oil, small, large, hand, load, wallSmall, wallLarge]

  // the numbers, beside the model
  const side = s.area('right', 0.38)
  const column = side.center[0]
  const heading = text('the trade', { id: 'heading', size: 'label', color: GREY_B }).at(column, 2.3)
  const areaLine = text(() => `area  × ${ratio().toFixed(1)}`, { id: 'areaLine', size: 'body', color: WHITE }).at(column, 1.4)
  const forceLine = text(() => `${FORCE_IN} N in  →  ${Math.round(forceOut())} N out`, { id: 'forceLine', size: 'body', color: TEAL }).at(column, 0.5)
  const moveLine = text(() => `moves ${push().toFixed(2)}  →  ${rise().toFixed(2)}`, { id: 'moveLine', size: 'body', color: GOLD }).at(column, -0.4)
  const lines = [heading, areaLine, forceLine, moveLine]

  s.chapter('One fluid, two pistons')
  s.step('The parts', (st) => {
    st.say('A [small piston](small) and a [large piston](large) sit on the same [oil](ring:oil).')
    st.camera({ view: 'iso' })
    st.label(small, 'small piston')
    st.label(large, 'large piston')
    st.wait(1)
  })
  s.step('Push down', (st) => {
    st.say('Push the [small piston](small) down. Oil cannot be squeezed, so it lifts the [large one](ring:large).')
    st.note('The volume that leaves the narrow column is the volume the wide one gains: `A1 × d1 = A2 × d2`.')
    st.camera({ view: 'front' })
    st.set(push, 2)
  })

  s.chapter('Trading distance for force', { keep: model })
  s.step('Same pressure everywhere', (st) => {
    st.say('The oil presses equally on every bit of area, so [nine times the area](ring:large) feels nine times the force.')
    st.note('Pressure is force over area, and it is the same at both pistons: `F2 = F1 × A2 / A1`. The price is distance: the large piston moves `A1 / A2` as far.')
    st.play(lagged(lines.map((l) => fadeIn(l)), { lag: 0.25 }))
    st.focus(large, load, ...lines)
  })
  s.step('A wider piston', (st) => {
    st.say('Make the [large piston](large) wider: it lifts even more, and moves even less.')
    st.set(bore, 2.4)
  })
})
