// pendulum: a damped pendulum beside the plot of its angle against time.
// The motion is not keyframed: ode() integrates  angle'' = -(g / length) · sin(angle) - damping · angle'  from the
// moment of release, and everything on screen (the bob, its trail, the curve, the cursor, the readouts) reads that
// one solution at s.t(). Scrub anywhere: the state is recomputed from t = 0, so the same time is the same picture.
// When the story (or a slider held by the viewer) changes the length or the damping, the equation changes from that
// moment on. It is the equation above with another number in it: the extra term a string that is really being paid
// out would add (-2 · length' / length · angle') is not modelled.
import { scene, text, line, arrow, circle, group, ode, trail, write, create, fadeIn, lagged, BLUE, YELLOW, GREY_A, GREY_B, GREY_C, GREY_D } from 'mimir'

const G = 9.81 // m/s²
const RELEASE = 50 // degrees the bob is pulled aside
const RAD = Math.PI / 180

// where things are on the frame
const PIVOT = [-4, 2.5]
const UNITS_PER_METRE = 1.5
const PLOT = { x: -0.6, y: -0.6, width: 6.4, halfHeight: 1.9, seconds: 30 } // origin of the axes, size, time span

export default scene({ title: 'A pendulum, and the curve it draws' }, (s) => {
  const length = s.param('length', { value: 1, min: 0.5, max: 2, step: 0.05, unit: 'm', label: 'Length' })
  const damping = s.param('damping', { value: 0.08, min: 0, max: 1.5, step: 0.05, unit: '1/s', label: 'Damping' })

  // ── the model ──────────────────────────────────────────────────────────────────────────────────────
  // state in degrees and degrees per second; sin() works in radians, hence the two conversions
  const swing = ode({
    y0: { angle: RELEASE, speed: 0 },
    f: (_t, y) => ({ angle: y.speed, speed: -(G / length()) * Math.sin(y.angle * RAD) / RAD - damping() * y.speed }),
  })
  const angle = (t) => swing.value('angle', t) // t omitted = now
  const bobAt = (t) => { const a = angle(t) * RAD, l = length() * UNITS_PER_METRE; return [PIVOT[0] + l * Math.sin(a), PIVOT[1] - l * Math.cos(a)] }
  // the plot shows the last PLOT.seconds: it starts at 0 and slides once the story runs longer than that
  const windowStart = () => Math.max(0, s.t() - PLOT.seconds)
  const plotX = (t) => PLOT.x + ((t - windowStart()) / PLOT.seconds) * PLOT.width
  const plotY = (degrees) => PLOT.y + (degrees / RELEASE) * PLOT.halfHeight
  s.probe('angle', () => angle())
  s.probe('period', () => 2 * Math.PI * Math.sqrt(length() / G))

  // ── the pendulum ───────────────────────────────────────────────────────────────────────────────────
  const title = text('A pendulum, and the curve it draws', { size: 'section' }).at(0, 3.35)
  const ceiling = line([PIVOT[0] - 0.7, PIVOT[1]], [PIVOT[0] + 0.7, PIVOT[1]], { color: GREY_B, strokeWidth: 4 })
  const plumb = line(PIVOT, () => [PIVOT[0], PIVOT[1] - length() * UNITS_PER_METRE - 0.45], { color: GREY_D, strokeWidth: 1.5, dashed: true })
  const path = trail((t) => bobAt(t), { id: 'path', duration: 1.4, color: BLUE, width: 3 })
  const rod = line(PIVOT, () => bobAt(), { id: 'rod', color: GREY_A, strokeWidth: 3, buff: 0 })
  const bob = circle({ id: 'bob', radius: 0.2, color: BLUE, fill: BLUE, fillOpacity: 1 }).at(() => bobAt())
  const pendulum = group([ceiling, plumb, rod, bob])
  const degrees = (a) => `${Math.round(a) < 0 ? '−' : ''}${Math.abs(Math.round(a))}°`
  const angleNow = text(() => degrees(angle()), { id: 'angleNow', size: 'label', color: YELLOW }).at(PIVOT[0], -1.85)
  const period = text(() => `one swing ≈ ${(2 * Math.PI * Math.sqrt(length() / G)).toFixed(2)} s`, { id: 'period', size: 'note', color: GREY_B }).at(PIVOT[0], -2.35)

  // ── the plot: axes, the curve so far, and a cursor that is the same moment as the bob ────────────────
  const timeAxis = arrow([PLOT.x, PLOT.y], [PLOT.x + PLOT.width + 0.35, PLOT.y], { color: GREY_C, strokeWidth: 2, buff: 0 })
  const angleAxis = line([PLOT.x, PLOT.y - PLOT.halfHeight - 0.25], [PLOT.x, PLOT.y + PLOT.halfHeight + 0.25], { color: GREY_C, strokeWidth: 2, buff: 0 })
  const axisNames = [
    text('time', { size: 'note', color: GREY_B }).at(PLOT.x + PLOT.width + 0.1, PLOT.y - 0.35),
    text('angle', { size: 'note', color: GREY_B }).at(PLOT.x, PLOT.y + PLOT.halfHeight + 0.55),
    text(`${RELEASE}°`, { size: 'note', color: GREY_B }).at(PLOT.x - 0.45, plotY(RELEASE)),
    text(`−${RELEASE}°`, { size: 'note', color: GREY_B }).at(PLOT.x - 0.5, plotY(-RELEASE)),
  ]
  const ticks = [RELEASE, -RELEASE].map((d) => line([PLOT.x - 0.1, plotY(d)], [PLOT.x + 0.1, plotY(d)], { color: GREY_C, strokeWidth: 2, buff: 0 }))
  const axes = group([timeAxis, angleAxis, ...ticks])
  const curve = trail((t) => [plotX(t), plotY(angle(t))], { id: 'curve', duration: PLOT.seconds, fade: false, color: YELLOW, width: 3 })
  const cursor = circle({ id: 'cursor', radius: 0.09, color: YELLOW, fill: YELLOW, fillOpacity: 1 }).at(() => [plotX(s.t()), plotY(angle())])

  // ── the story ──────────────────────────────────────────────────────────────────────────────────────
  s.step('Let it go', (st) => {
    st.say('Pull the [bob](bob) aside and let it go. Gravity pulls it back, and it swings past the middle.')
    st.play(create(pendulum), fadeIn(path), { lag: 0.2 }) // the model first: the bob is on stage when the sentence names it
    st.play(write(title))
    st.play(fadeIn(angleNow), fadeIn(period))
  })
  s.step('Angle against time', (st) => {
    st.say('Plot its [angle](angleNow) against time and the swing becomes a [wave](curve).')
    st.play(lagged([create(axes), ...axisNames.map((n) => fadeIn(n))], { lag: 0.1 }))
    st.play(fadeIn(curve), fadeIn(cursor))
    st.wait(2)
  })
  s.step('A longer string', (st) => {
    st.say('Make the string longer and each [swing](period) takes more time: the period grows with the square root of the length.')
    st.set(length, 1.9, { duration: 3 })
    st.wait(5)
  })
  s.step('Friction', (st) => {
    st.say('Friction takes a little energy on every swing. With more [damping](curve) the wave dies out sooner.')
    st.set(damping, 0.9, { duration: 2 })
    st.wait(4)
  })
})
