// pipe-flow: water through a pipe that narrows (a Venturi tube), drawn as a section through its axis.
// Nothing is drawn by hand: the speed in every section follows from continuity (same volume per second through every
// section of a round pipe, so speed ∝ 1 / radius²), the gauges from Bernoulli (pressure head falls by v² / 2g), and
// the particles are a steady stream at exactly those speeds, coloured by them. Two sliders recompute all of it.
import { scene, text, line, rect, group, flow, fillLevel, colorScale, integrate, write, create, fadeIn, lagged, BLUE, GREY_A, GREY_B, GREY_C } from 'mimir'

const G = 9.81 // m/s²
const HALF = 5.6 // half the length of the pipe on screen, frame units
const WIDE = 1.05 // radius of the wide part on screen
const UNITS_PER_METRE_PER_SECOND = 0.9 // screen speed of water moving at 1 m/s
const GAUGE_HEIGHT = 1.9 // screen height of a gauge tube …
const GAUGE_METRES = 2.2 // … and the pressure head it holds when full
const INLET_HEAD = 2 // pressure head at the inlet, metres of water

export default scene({ title: 'Why water speeds up in a narrow pipe' }, (s) => {
  const throat = s.param('throat', { value: 60, min: 45, max: 100, unit: '%', label: 'Throat width' })
  const inflow = s.param('inflow', { value: 1, min: 0.6, max: 1.2, step: 0.1, unit: 'm/s', label: 'Speed at the inlet' })

  // ── the model ──────────────────────────────────────────────────────────────────────────────────────
  // radius along the pipe (along = 0 at the inlet … 1 at the outlet): wide, a straight taper, the throat, and back
  const KNOTS = [0, 0.3, 0.44, 0.56, 0.7, 1]
  const radiusAt = (along) => {
    const narrow = WIDE * throat() / 100
    const r = [WIDE, WIDE, narrow, narrow, WIDE, WIDE]
    const i = Math.min(KNOTS.length - 2, Math.max(0, KNOTS.findIndex((k) => k > along) - 1))
    return r[i] + (r[i + 1] - r[i]) * Math.min(1, Math.max(0, (along - KNOTS[i]) / (KNOTS[i + 1] - KNOTS[i])))
  }
  const speedAt = (along) => inflow() * (WIDE / radiusAt(along)) ** 2 // m/s: continuity in a round pipe
  const headAt = (along) => INLET_HEAD - (speedAt(along) ** 2 - inflow() ** 2) / (2 * G) // m of water: Bernoulli
  const xAt = (along) => -HALF + 2 * HALF * along
  const speedColor = colorScale('speed', { min: 0.6, max: 6 })
  // seconds a drop of water needs for the whole pipe; the stream's phase is the running count of such trips, so the
  // particles never jump when a slider (or the story) changes the speed
  const transit = () => { let sum = 0; for (let i = 0; i < 64; i++) sum += (2 * HALF / 64) / (speedAt((i + 0.5) / 64) * UNITS_PER_METRE_PER_SECOND); return sum }
  const trips = integrate(() => 1 / transit())

  // ── the picture ────────────────────────────────────────────────────────────────────────────────────
  const title = text('Same water, less room', { size: 'section' }).at(0, 3.25)
  const wall = (side) => KNOTS.slice(1).map((k, i) => line(() => [xAt(KNOTS[i]), side * radiusAt(KNOTS[i])], () => [xAt(k), side * radiusAt(k)], { color: GREY_A, strokeWidth: 4 }))
  const pipe = group([...wall(1), ...wall(-1)])
  const axis = line([-HALF, 0], [HALF, 0], { color: GREY_C, strokeWidth: 1, dashed: true })
  const water = flow([[-HALF, 0], [HALF, 0]], {
    id: 'water', count: 150, size: 0.075, tail: 0.11, fade: 0.05,
    speed: (along) => speedAt(along) * UNITS_PER_METRE_PER_SECOND,
    spread: (along) => radiusAt(along) - 0.12,
    color: (along) => speedColor(speedAt(along)),
    phase: trips,
  })

  // speed readouts under the inlet and under the throat
  const readout = (id, along, name) => group([
    text(name, { size: 'note', color: GREY_B }).at(xAt(along), -1.75),
    text(() => `${speedAt(along).toFixed(1)} m/s`, { id, size: 'label', color: () => speedColor(speedAt(along)) }).at(xAt(along), -2.2),
  ])
  const inletSpeed = readout('inletSpeed', 0.13, 'inlet')
  const throatSpeed = readout('throatSpeed', 0.5, 'throat')

  // three gauge tubes standing on the pipe: the water in each rises to the pressure head in that section
  const gauge = (id, along) => {
    const tube = rect({ id, width: 0.42, height: GAUGE_HEIGHT, color: GREY_B, strokeWidth: 2 }).at(() => [xAt(along), radiusAt(along) + GAUGE_HEIGHT / 2])
    const level = fillLevel(tube, { level: () => headAt(along) / GAUGE_METRES, color: BLUE, opacity: 0.6 })
    return { tube, level }
  }
  const gauges = [gauge('gaugeInlet', 0.13), gauge('gaugeThroat', 0.5), gauge('gaugeOutlet', 0.87)]
  const pressure = text('pressure', { size: 'note', color: GREY_B }).nextTo(gauges[0].tube, 'left', 0.25)

  s.probe('throatSpeed', () => speedAt(0.5))
  s.probe('throatHead', () => headAt(0.5))

  // ── the story ──────────────────────────────────────────────────────────────────────────────────────
  s.step('A pipe that narrows', (st) => {
    st.say('Water runs through a pipe that narrows in the middle.')
    st.play(write(title))
    st.play(create(pipe), fadeIn(axis), { lag: 0.3 })
    st.play(fadeIn(water))
    st.wait(1.5)
  })
  s.step('It has to hurry', (st) => {
    st.say('Each second the same amount of water must pass every section, so in the [throat](throatSpeed) it moves faster.')
    st.play(fadeIn(inletSpeed), fadeIn(throatSpeed), { lag: 0.4 })
    st.wait(2)
  })
  s.step('Fast water, low pressure', (st) => {
    st.say('Gauges on the pipe show the price: where the water is fast, its [pressure](gaugeThroat) is low.')
    st.play(lagged(gauges.map((g) => create(g.tube)), { lag: 0.2 }))
    st.play(...gauges.map((g) => fadeIn(g.level)), fadeIn(pressure))
    st.wait(1.5)
  })
  s.step('Squeeze it harder', (st) => {
    st.say('Narrow the throat and the water there races: half the width means four times the speed.')
    st.set(throat, 50)
    st.wait(3)
  })
})
