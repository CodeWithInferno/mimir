// gradient-descent: how gradient descent finds the bottom, and what the learning rate does to it.
// Nothing is keyed by hand. The loss is one function, f(x, y) = ½ (ALONG · x² + ACROSS · y²); the first chapter walks
// its steep slice (one ball on one curve), the second walks the whole valley seen from above, the third says where
// the limit comes from. Every position, arrow, number and curve is read from stepper() runs of the real update rule,
// p ← p − η ∇f(p), and the learning-rate slider runs them again. The stability limit is computed (2 / the largest
// curvature), never typed, and `mimir check` holds the runs to the maths: the loss falls at every step below the
// limit, grows above it, and every iterate equals the closed form.
import {
  scene, axes, numberLine, readout, tex, text, line, arrow, polyline, column, stepper,
  create, write, fadeIn, fadeOut, growArrow, derive, rewrite, lagged, linear, smooth,
  BLUE, YELLOW, RED, GREY_A, GREY_C,
} from 'mimir'

const R = String.raw // keeps the backslashes of LaTeX

// ── the maths: one bowl, its gradient, and the plain update rule ─────────────────────────────────────────────────
const ALONG = 1 // curvature along the valley floor (x)
const ACROSS = 10 // curvature across the valley (y): ten times steeper
const START = [-4, 1] // where the walk begins
const loss = (x, y) => 0.5 * (ALONG * x * x + ACROSS * y * y)
const gradient = (x, y) => [ALONG * x, ACROSS * y]
const LIMIT = 2 / Math.max(ALONG, ACROSS) // above this rate the steepest direction grows at every step
// the steep slice through the valley, x = 0: the one curve of the first chapter
const sliceLoss = (w) => loss(0, w)
const sliceSlope = (w) => gradient(0, w)[1]
// the level line of the bowl at one height: an ellipse with these half axes
const halfAxes = (level) => [Math.sqrt((2 * level) / ALONG), Math.sqrt((2 * level) / ACROSS)]
const RING_SAMPLES = 240
const ring = (level) => {
  const [a, b] = halfAxes(level)
  return Array.from({ length: RING_SAMPLES + 1 }, (_, i) => [a * Math.cos((2 * Math.PI * i) / RING_SAMPLES), b * Math.sin((2 * Math.PI * i) / RING_SAMPLES)])
}

// ── the story's numbers ──────────────────────────────────────────────────────────────────────────────────────────
const RATE = { crawl: 0.005, small: 0.02, exact: 1 / ACROSS, zigzag: 0.9 * LIMIT, edge: LIMIT, past: 1.05 * LIMIT }
const RATE_RANGE = [0.005, 0.25] // what the slider allows
const STEPS = 50 // updates the step slider allows
const SLICE = { steps: 10, climb: 6, secondsPerStep: 0.6, w: [-2, 2], loss: [0, 20] } // chapter 1: updates shown, window of the plot
const VALLEY = { steps: 50, zigzag: 25, secondsPerStep: 0.16, slowSecondsPerStep: 0.4 } // chapter 2
const RINGS = [1, 2, 3, 4, 5].map((halfWidth) => 0.5 * ALONG * halfWidth * halfWidth) // level lines one unit of x apart
const MOVE_SHARE = 0.7 // share of each update's time the ball is in motion; it rests for the remainder
const HEADROOM = 1.12 // room a plot leaves round what it shows
const DROP = [0, -0.6] // the way a ball arrives: from above
const FACTOR_SIZE = 29 // type size of the two factor lines: between 'note' and 'label', so the longer one fits the column

// where things are on the frame
const LEFT = -2.35 // centre line of the pictures
const SIDE = 4.75 // centre line of the column that stays
const MAP = { width: 8.1, aspect: 3, y: 0.5, lift: 1.4, closeHalfHeight: 0.45 } // the valley from above: as wide as three heights; the close-up shows this much of y each way
const HISTORY = { height: 1.6, y: -1.5 } // the loss plot under it

const lerp = (a, b, u) => a + (b - a) * u
// two decimals, and a value that rounds to zero is written without a sign
const twoPlaces = (value) => (Number(value.toFixed(2)) === 0 ? (0).toFixed(2) : value.toFixed(2))
// falling means lower at every step, until there is nothing left to lose (one rate lands a coordinate exactly on 0)
const fallsEveryStep = (states) => states.every((state, i) => i === 0 || state.loss < states[i - 1].loss || states[i - 1].loss === 0)
const risesInTheEnd = (states) => states[states.length - 1].loss > states[states.length - 2].loss

export default scene({ title: 'How gradient descent finds the bottom' }, (s) => {
  const rate = s.param('rate', { value: RATE.small, min: RATE_RANGE[0], max: RATE_RANGE[1], step: 0.005, label: 'Learning rate η' })
  const step = s.param('step', { value: 0, min: 0, max: STEPS, label: 'Step' })
  const closeUp = s.param('closeUp', { value: 0, min: 0, max: 1, step: 0.01, label: 'Close-up on the start' })

  // an update takes one unit of `step`: the ball rests, then moves, and lands exactly on the whole number
  const done = () => Math.floor(step() + 1e-9) // updates completed
  const moving = () => smooth(Math.min(1, Math.max(0, (step() - done() - (1 - MOVE_SHARE)) / MOVE_SHARE)))

  // ── the column that stays: the rule, the rate and its limit ────────────────────────────────────────────────────
  const rateNow = readout('η', rate, { id: 'rateNow', decimals: 3, color: YELLOW, size: 'label' })
  const dial = numberLine({ id: 'dial', range: [0, RATE_RANGE[1]], width: 3, ticks: 0.05, label: 'η', tickLabelSize: 'tiny' })
  const knob = dial.dot(rate, { id: 'knob', color: YELLOW, radius: 0.1 })
  const limitMark = dial.mark(LIMIT, 'limit', { id: 'limitMark', color: RED, size: 'tiny' })
  const beyond = line(dial.toFrame(LIMIT), dial.toFrame(RATE_RANGE[1]), { id: 'beyond', color: RED, strokeWidth: 5, buff: 0 })
  const control = column([rateNow, dial], { id: 'control', gap: 0.4 }).at(SIDE, 1.1).hud()
  const rule = tex(R`w \leftarrow w - \eta\,L'(w)`, { id: 'rule', size: 'label', colors: { [R`\eta`]: YELLOW, [R`L'(w)`]: BLUE } }).nextTo(control, 'up', 0.6).hud()
  const valleyRule = tex(R`\mathbf{w} \leftarrow \mathbf{w} - \eta\,\nabla L(\mathbf{w})`, { id: 'valleyRule', size: 'label', colors: { [R`\eta`]: YELLOW, [R`\nabla L(\mathbf{w})`]: BLUE } }).nextTo(control, 'up', 0.6).hud()

  // ── chapter 1: one ball on one curve ───────────────────────────────────────────────────────────────────────────
  const sliceRun = stepper(function* () {
    let w = START[1]
    for (let i = 0; i <= STEPS + 1; i++) {
      yield { w, loss: sliceLoss(w) }
      w -= rate() * sliceSlope(w) // the update rule
    }
  })
  const ballW = s.signal(() => lerp(sliceRun.at(done()).w, sliceRun.at(done() + 1).w, moving()))
  // a run that diverges leaves the window: what is drawn beside the plot stops at its edge
  const inView = (w) => Math.min(SLICE.w[1], Math.max(SLICE.w[0], w))
  const ballInView = () => Math.abs(ballW()) <= SLICE.w[1] && sliceLoss(ballW()) <= SLICE.loss[1]

  const curveAxes = axes({ id: 'curveAxes', x: SLICE.w, y: SLICE.loss, width: 7.6, height: 4.6, xLabel: 'w', yLabel: 'loss', ticks: { x: 1, y: 5 } }).at(LEFT - 0.25, 0.5)
  const curve = curveAxes.plot(sliceLoss, { id: 'curve', color: BLUE })
  const visited = Array.from({ length: SLICE.steps + 1 }, (_, i) =>
    curveAxes.dot(() => [sliceRun.at(i).w, sliceRun.at(i).loss], { id: `visited${i}`, color: YELLOW, radius: 0.06 }).opacity(() => (i <= done() ? 0.55 : 0)).allow('TINY'))
  const ball = curveAxes.dot(() => [ballW(), sliceLoss(ballW())], { id: 'ball', color: YELLOW, radius: 0.17 })
  const drop = curveAxes.vline(ballW, { id: 'drop', color: GREY_C, to: () => sliceLoss(ballW()) })
  // the tangent at the ball: a fixed length on screen, along the slope the ball feels
  const TANGENT = 1.1 // half length, frame units
  const tangentEnd = (side) => () => {
    const w = inView(ballW()), here = curveAxes.toFrame(w, sliceLoss(w))(), near = curveAxes.toFrame(w + 0.01, sliceLoss(w) + 0.01 * sliceSlope(w))()
    const dx = near[0] - here[0], dy = near[1] - here[1], length = Math.hypot(dx, dy)
    return [here[0] + (side * TANGENT * dx) / length, here[1] + (side * TANGENT * dy) / length]
  }
  const tangent = line(tangentEnd(-1), tangentEnd(1), { id: 'tangent', color: GREY_A, strokeWidth: 2.5, buff: 0, opacity: () => (ballInView() ? 1 : 0) })
  // the next update, drawn where it happens: along the w axis
  const nextStep = arrow(
    () => curveAxes.toFrame(inView(sliceRun.at(done()).w), 0)(),
    () => curveAxes.toFrame(inView(sliceRun.at(done() + 1).w), 0)(),
    { id: 'nextStep', color: YELLOW, strokeWidth: 4, buff: 0 },
  )
  const sliceNumbers = column([
    readout('step', done, { id: 'sliceStep', decimals: 0, size: 'label' }),
    readout('slope', () => sliceSlope(sliceRun.at(done()).w), { id: 'slopeNow', decimals: 1, color: GREY_A, size: 'label' }),
    readout('loss', () => sliceRun.at(done()).loss, { id: 'sliceLossNow', decimals: 2, color: BLUE, size: 'label' }),
  ], { id: 'sliceNumbers', gap: 0.3 }).nextTo(control, 'down', 0.7).hud()

  // ── chapter 2: the valley from above ───────────────────────────────────────────────────────────────────────────
  const run = stepper(function* () {
    let [x, y] = START
    for (let i = 0; i <= STEPS + 1; i++) {
      yield { x, y, loss: loss(x, y) }
      const [gx, gy] = gradient(x, y)
      x -= rate() * gx // the update rule, once per coordinate
      y -= rate() * gy
    }
  })
  const here = () => run.at(done())
  const next = () => run.at(done() + 1)
  const ballAt = s.signal(() => [lerp(here().x, next().x, moving()), lerp(here().y, next().y, moving())])
  // the window: at rest it holds the level line through the start; it opens up when the walk swings out of it
  const restHalfHeight = HEADROOM * halfAxes(loss(...START))[1]
  const swing = s.signal(() => Math.max(Math.abs(ballAt()[1]), ...run.states.slice(0, done() + 1).map((state) => Math.abs(state.y))))
  // closeUp moves in on the start: the same window, smaller and centred there (sizes blend as ratios, as a zoom does)
  const halfHeight = s.signal(() => Math.max(restHalfHeight, HEADROOM * swing()) ** (1 - closeUp()) * MAP.closeHalfHeight ** closeUp())
  const middle = s.signal(() => [START[0] * closeUp(), START[1] * closeUp()])
  const windowX = () => [middle()[0] - MAP.aspect * halfHeight(), middle()[0] + MAP.aspect * halfHeight()]
  const windowY = () => [middle()[1] - halfHeight(), middle()[1] + halfHeight()]
  const inWindow = (x, y) => x >= windowX()[0] && x <= windowX()[1] && y >= windowY()[0] && y <= windowY()[1]
  // the part of the segment from p to q that the window shows, when p is in it: q, or the point where it leaves
  const leaves = (p, q) => {
    let share = 1
    for (const [from, to, [low, high]] of [[p[0], q[0], windowX()], [p[1], q[1], windowY()]]) {
      if (to > high) share = Math.min(share, (high - from) / (to - from))
      if (to < low) share = Math.min(share, (low - from) / (to - from))
    }
    return [lerp(p[0], q[0], share), lerp(p[1], q[1], share)]
  }
  const map = axes({
    id: 'map', x: windowX, y: windowY,
    width: MAP.width, height: MAP.width / MAP.aspect, xLabel: 'x', yLabel: 'y',
  }).at(LEFT, MAP.y)
  const rings = RINGS.map((level, i) => map.plot(ring(level), { id: `ring${i + 1}`, color: BLUE, strokeWidth: 2 }).opacity(0.55))
  const levelNow = map.plot(() => ring(here().loss), { id: 'levelNow', color: BLUE, strokeWidth: 3 })
  const bottom = map.dot([0, 0], { id: 'bottom', color: GREY_A, radius: 0.06 }).allow('TINY')
  const bottomTag = text('minimum', { id: 'bottomTag', size: 'note', color: GREY_A }).nextTo(bottom, 'down', 0.12)
  const path = map.plot(() => [...run.states.slice(0, done() + 1).map((state) => [state.x, state.y]), ballAt()], { id: 'path', color: YELLOW, strokeWidth: 2.5 })
  const iterates = Array.from({ length: STEPS + 1 }, (_, i) =>
    map.dot(() => [run.at(i).x, run.at(i).y], { id: `iterate${i}`, color: YELLOW, radius: 0.045 }).opacity(() => (i <= done() ? 1 : 0)).allow('TINY'))
  const walker = map.dot(ballAt, { id: 'walker', color: YELLOW, radius: 0.17 })
  // the step about to be taken, and the level line it leaves at right angles
  const hereShown = () => (inWindow(here().x, here().y) ? 1 : 0)
  const stepEnd = () => {
    const [x, y] = leaves([here().x, here().y], [next().x, next().y])
    return map.toFrame(x, y)()
  }
  const stepArrow = arrow(() => map.toFrame(here().x, here().y)(), stepEnd, { id: 'stepArrow', color: YELLOW, strokeWidth: 3, buff: 0, opacity: hereShown })
  const SQUARE = 0.3 // side of the right-angle mark, frame units: it has to show beside the ball
  const corner = (along, down) => () => {
    const [gx, gy] = gradient(here().x, here().y), size = Math.hypot(gx, gy), base = map.toFrame(here().x, here().y)()
    const downhill = [-gx / size, -gy / size], level = [-downhill[1], downhill[0]] // the level line runs at right angles to the gradient
    return [base[0] + SQUARE * (along * level[0] + down * downhill[0]), base[1] + SQUARE * (along * level[1] + down * downhill[1])]
  }
  const rightAngle = polyline([corner(1, 0), corner(1, 1), corner(0, 1)], { id: 'rightAngle', color: GREY_A, strokeWidth: 1.5, opacity: hereShown })
  // the numbers of the walk, one under the other; the loss stays for the last chapter
  const stepNow = readout('step', done, { id: 'stepNow', decimals: 0, size: 'label' }).nextTo(control, 'down', 0.7).hud()
  const pointNow = tex(() => R`\mathbf{w} = (${twoPlaces(here().x)},\ ${twoPlaces(here().y)})`, { id: 'pointNow', size: 'label', colors: { [R`\mathbf{w}`]: YELLOW } }).nextTo(stepNow, 'down', 0.3).hud()
  const lossNow = readout('loss', () => here().loss, { id: 'lossNow', decimals: 2, color: BLUE, size: 'label' }).nextTo(pointNow, 'down', 0.3).hud()
  const valleyNumbers = [stepNow, pointNow, lossNow]

  // the loss of every iterate, in order: the plot that is born from the path
  const lossTop = s.signal(() => HEADROOM * Math.max(loss(...START), lerp(here().loss, next().loss, moving()), ...run.states.slice(0, done() + 1).map((state) => state.loss)))
  const history = axes({ id: 'history', x: [0, STEPS], y: () => [0, lossTop()], width: MAP.width, height: HISTORY.height, xLabel: 'step', yLabel: 'loss', ticks: { x: 10 } }).at(LEFT, HISTORY.y)
  const cursorAt = () => [done() + moving(), lerp(here().loss, next().loss, moving())]
  const lossCurve = history.plot(() => [...run.states.slice(0, done() + 1).map((state, i) => [i, state.loss]), cursorAt()], { id: 'lossCurve', color: BLUE, strokeWidth: 3 })
  const cursor = history.dot(cursorAt, { id: 'cursor', color: YELLOW, radius: 0.09 }).allow('TINY')
  // the cue fades in as the loss climbs from what it started with to twice that
  const diverged = text('diverged', { id: 'diverged', size: 'label', color: RED, opacity: () => Math.min(1, Math.max(0, cursorAt()[1] / loss(...START) - 1)) }).nextTo(cursor, 'left', 0.3)

  // ── chapter 3: where the limit comes from ──────────────────────────────────────────────────────────────────────
  const factor = (curvature) => 1 - rate() * curvature // what one update multiplies a coordinate by
  const across = tex(() => R`y \leftarrow (1 - ${ACROSS}\,\eta)\,y = ${twoPlaces(factor(ACROSS))}\,y`, { id: 'across', size: FACTOR_SIZE, colors: { [R`\eta`]: YELLOW } })
  const along = tex(() => R`x \leftarrow (1 - ${ALONG === 1 ? '' : ALONG + R`\,`}\eta)\,x = ${twoPlaces(factor(ALONG))}\,x`, { id: 'along', size: FACTOR_SIZE, colors: { [R`\eta`]: YELLOW } })
  const bound = tex(R`\eta < \frac{2}{${Math.max(ALONG, ACROSS)}} = ${LIMIT}`, { id: 'bound', size: 'label', color: RED, colors: { [R`\eta`]: YELLOW } })
  const reasons = column([across, along], { id: 'reasons', gap: 0.3 }).nextTo(control, 'down', 0.7).hud() // where the step and the point were
  bound.nextTo(lossNow, 'down', 0.35).hud()
  // the same bound for any bowl: the number under the 2 is the curvature of its steepest direction
  const general = tex(R`\eta < \frac{2}{\text{steepest curvature}}`, { id: 'general', size: FACTOR_SIZE, color: RED, colors: { [R`\eta`]: YELLOW } }).nextTo(lossNow, 'down', 0.35).hud()
  // the same climb, two ways: out to one ring along the valley, and across it
  const [reachAlong, reachAcross] = halfAxes(RINGS[2])
  const onMap = (x, y) => () => map.toFrame(Math.min(windowX()[1], Math.max(windowX()[0], x)), Math.min(windowY()[1], Math.max(windowY()[0], y)))()
  const restView = () => (inWindow(0, 0) && inWindow(reachAlong, reachAcross) ? 1 : 0)
  const shallow = arrow(onMap(0, 0), onMap(reachAlong, 0), { id: 'shallow', color: GREY_A, strokeWidth: 2.5, buff: 0, opacity: restView })
  const steep = arrow(onMap(0, 0), onMap(0, reachAcross), { id: 'steep', color: GREY_A, strokeWidth: 2.5, buff: 0, opacity: restView })
  const shallowTag = text('shallow', { id: 'shallowTag', size: 'note', color: GREY_A, opacity: restView }).nextTo(shallow, 'down', 0.1)
  const steepTag = text(`${ACROSS / ALONG}× steeper`, { id: 'steepTag', size: 'note', color: GREY_A, opacity: restView }).nextTo(steep, 'left', 0.12)
  const slopes = [shallow, steep, shallowTag, steepTag]

  // ── what must be true, whatever the sliders say ────────────────────────────────────────────────────────────────
  s.probe('loss', () => here().loss)
  s.probe('x', () => here().x)
  s.probe('y', () => here().y)
  s.probe('limit', () => LIMIT)
  s.expect('on the curve, below the limit, the loss falls at every step', () => rate() >= LIMIT || fallsEveryStep(sliceRun.states))
  s.expect('on the curve, above the limit, the loss rises at every step', () => rate() <= LIMIT || sliceRun.states.every((state, i, all) => i === 0 || state.loss > all[i - 1].loss))
  s.expect('in the valley, below the limit, the loss falls at every step', () => rate() >= LIMIT || fallsEveryStep(run.states))
  s.expect('in the valley, above the limit, the loss ends up rising', () => rate() <= LIMIT || risesInTheEnd(run.states))
  s.expect('every iterate equals the closed form: each coordinate times (1 − η · curvature) per step', () =>
    run.states.every((state, i) => {
      const x = START[0] * factor(ALONG) ** i, y = START[1] * factor(ACROSS) ** i
      return Math.abs(state.x - x) <= 1e-9 * (1 + Math.abs(x)) && Math.abs(state.y - y) <= 1e-9 * (1 + Math.abs(y))
    }))
  s.expect('every step leaves its level line at right angles', () => {
    const [gx, gy] = gradient(here().x, here().y), [a, b] = halfAxes(here().loss)
    const angle = Math.atan2(here().y / b, here().x / a), tangentLine = [-a * Math.sin(angle), b * Math.cos(angle)] // the ellipse's own tangent there
    return Math.abs(gx * tangentLine[0] + gy * tangentLine[1]) <= 1e-9 * Math.hypot(gx, gy) * Math.hypot(...tangentLine) + 1e-12
  })

  // ── the story ──────────────────────────────────────────────────────────────────────────────────────────────────
  s.chapter('One ball, one curve')
  s.step('A ball on a curve', (st) => {
    st.say("Training a model means making one number, the loss, as small as it'll go. Here's a [loss curve](curve), and a [ball](ball) that wants the bottom.")
    st.play(create(curveAxes))
    st.play(create(curve), { duration: 2 })
    st.play(fadeIn(ball, { shift: DROP }), fadeIn(drop), fadeIn(sliceNumbers))
  })
  s.step('The slope says which way', (st) => {
    st.say("The ball can't see the curve. It only feels the [slope](tangent) under it. Here the ground rises to the right, so it should step left.")
    st.play(create(tangent))
    st.play(write(rule), { duration: 2 })
  })
  s.step('One step', (st) => {
    st.say('How far? The slope times a number we choose, the [learning rate](rateNow). That makes one step downhill.')
    st.play(lagged([fadeIn(rateNow), create(dial), fadeIn(dial)], { lag: 0.3 }))
    st.play(create(nextStep), ...visited.map((dot) => fadeIn(dot)))
    st.wait(2)
    st.play(step.to(1, { duration: 2, rate: linear }))
  })
  s.step('Too small, and it crawls', (st) => {
    st.say("Make the rate tiny and every step is safe. But ten steps later the ball still isn't close.")
    st.play(step.to(0))
    st.play(rate.to(RATE.crawl), { duration: 2 })
    st.play(step.to(SLICE.steps, { duration: SLICE.steps * SLICE.secondsPerStep, rate: linear }))
  })
  s.step('Just right', (st) => {
    st.say('Turn the [rate](dial) up. At one value the very first step lands on the bottom.')
    st.play(step.to(0))
    st.play(rate.to(RATE.exact), { duration: 2 })
    st.play(step.to(2, { duration: 3, rate: linear }))
  })
  s.step('Too large, and it overshoots', (st) => {
    st.say('Go further and the ball jumps past the bottom, to the other side. Each jump is shorter than the last, so it still settles.')
    st.play(step.to(0))
    st.play(rate.to(RATE.zigzag), { duration: 2 })
    st.play(step.to(SLICE.steps, { duration: SLICE.steps * SLICE.secondsPerStep, rate: linear }))
  })
  s.step('Past the limit, it climbs', (st) => {
    st.say('A touch more, and each jump lands higher than the last. The ball climbs out. There is a [limit](limitMark), and the rate just crossed it.')
    st.play(step.to(0))
    st.play(fadeIn(limitMark), create(beyond))
    st.play(rate.to(RATE.past), { duration: 2 })
    st.play(step.to(SLICE.climb, { duration: SLICE.climb * SLICE.secondsPerStep, rate: linear }))
  })

  s.chapter('A valley, from above', { keep: [control, rateNow, dial, knob, limitMark, beyond, rule] })
  s.step('A valley from above', (st) => {
    st.say('Real losses depend on many numbers. With two, the loss is a valley, drawn here from above. Each [ring](ring4) is one height, and the [bottom](bottom) is in the middle.')
    st.play(step.to(0), rate.to(RATE.small))
    st.play(create(map))
    st.play(lagged(rings.map((one) => create(one)), { lag: 0.25 }), { duration: 2 })
    st.play(fadeIn(bottom), fadeIn(bottomTag))
  })
  s.step('Straight downhill', (st) => {
    st.say('Drop the [ball](walker) in. The slope is now an arrow, the gradient, at [right angles](rightAngle) to the ring it stands on. One [step](stepArrow) goes straight against it.')
    st.play(fadeOut(bottomTag), fadeIn(walker, { shift: DROP }), create(levelNow), ...iterates.map((dot) => fadeIn(dot)), fadeIn(path))
    st.play(rewrite(rule, valleyRule), lagged(valleyNumbers.map((one) => fadeIn(one)), { lag: 0.2 }))
    st.play(closeUp.to(1), { duration: 2.5 })
    st.play(create(stepArrow), create(rightAngle))
    st.wait(1)
    st.play(step.to(1, { duration: 2, rate: linear }))
    st.wait(1)
  })
  s.step('Fifty small steps', (st) => {
    st.say("Now pull back and let it run. Fifty steps at this small rate trace a smooth [path](path), but a slow one. The ball has crawled only part of the way along the valley floor.")
    st.play(fadeOut(stepArrow), fadeOut(rightAngle), closeUp.to(0), { duration: 2 })
    st.play(step.to(VALLEY.steps, { duration: VALLEY.steps * VALLEY.secondsPerStep, rate: linear }))
  })
  s.step('The loss, step by step', (st) => {
    st.say('Every dot on the path has a height. Line the heights up in order, and the path becomes a [curve](lossCurve): the loss after each step.')
    st.play(map.to.shift(0, MAP.lift), { duration: 1.5 })
    st.play(create(history))
    st.play(derive(path, lossCurve, { duration: 2.5 }))
    st.play(fadeIn(cursor), fadeIn(diverged))
  })
  s.step('A larger rate zig-zags', (st) => {
    st.say('Now turn the [rate](dial) up, close to the limit. Every step overshoots the valley floor, so the path zig-zags. But each swing is smaller, and the loss falls much faster.')
    st.play(step.to(0), { duration: 1.5 })
    st.play(rate.to(RATE.zigzag), { duration: 2 })
    st.play(step.to(VALLEY.zigzag, { duration: VALLEY.zigzag * VALLEY.slowSecondsPerStep, rate: linear }))
  })
  s.step('Past the limit, it diverges', (st) => {
    st.say('Push it just past the [limit](limitMark). Now every swing is bigger than the last, the view has to pull back, and the loss climbs without end.')
    st.play(step.to(0), { duration: 1.5 })
    st.play(rate.to(RATE.past), { duration: 2 })
    st.play(step.to(VALLEY.zigzag, { duration: VALLEY.zigzag * VALLEY.slowSecondsPerStep, rate: linear }))
  })

  s.chapter('Where the limit comes from', { keep: [control, rateNow, dial, knob, limitMark, beyond, valleyRule, map, ...rings, levelNow, bottom, path, ...iterates, walker, history, lossCurve, cursor, diverged, lossNow] })
  s.step('Two directions, two factors', (st) => {
    st.say('Why there? The same climb takes a third of the distance across the valley: the ground is ten times steeper. So each step shrinks the two coordinates by different [factors](reasons).')
    st.play(step.to(0), { duration: 1.5 })
    st.play(lagged([growArrow(shallow), fadeIn(shallowTag), growArrow(steep), fadeIn(steepTag)], { lag: 0.4 }), rate.to(RATE.zigzag), { duration: 2.5 })
    st.play(lagged([write(along), write(across)], { lag: 0.6 }))
    st.wait(1.5)
    st.play(...slopes.map((one) => fadeOut(one)))
    st.play(step.to(VALLEY.zigzag, { duration: VALLEY.zigzag * VALLEY.secondsPerStep, rate: linear }))
  })
  s.step('Exactly at the limit', (st) => {
    st.say('Exactly at the limit the steep factor is minus one. The ball bounces across the valley forever, no closer and no further, and the [loss](lossNow) stops falling.')
    st.play(step.to(0), { duration: 1.5 })
    st.play(rate.to(RATE.edge), { duration: 2 })
    st.play(write(bound))
    st.play(step.to(VALLEY.zigzag, { duration: VALLEY.zigzag * VALLEY.secondsPerStep, rate: linear }))
  })
  s.step('One slider, every path', (st) => {
    st.say('So the steepest direction sets the speed limit, and the shallowest one sets how long you wait. Slide the [rate](dial) and watch the same walk change.')
    st.play(rewrite(bound, general), rate.to(RATE.small), { duration: 3 })
    st.play(rate.to(RATE.zigzag), { duration: 4 })
    st.play(rate.to(RATE.exact), { duration: 3 })
  })
})
