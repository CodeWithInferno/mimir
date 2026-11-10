// How a neural network works.
// Story: one neuron -> what feeds it -> weights -> sum and squash -> layers -> numbers flow forward -> weights are
// knobs -> examples -> what the network believes -> its error -> the update rule -> learning -> a day it never saw.
// Nothing here is drawn by hand. The network is real and trains itself (plain gradient descent on forty generated
// days) while the scene is built: every number, every line width, the shaded belief behind the examples, the error
// curve and the numbers in the update rule are read from that training run. The sliders recompute the whole picture.
import {
  scene, graph, token, text, tex, axes, matrix, readout, circle, row,
  fadeIn, fadeOut, create, write, derive, transform, rewrite, lagged, mix, smooth, linear,
  BLUE, RED, YELLOW, WHITE, BLACK, GREY_B, GREY_C,
} from 'mimir'

// ── the network and its training (no drawing here) ───────────────────────────────────────────────────────
const HIDDEN = [0, 1, 2] // three neurons in the middle layer
const ROUNDS = 400 // rounds of gradient descent
const RATE = 3 // the learning rate (eta in the update rule)
const DAYS = 40 // examples to learn from
const MARGIN = 0.15 // the truth the examples follow: a beach day when sun - wind is above this
const CLEAR = 0.3 // the two test days are this far from that line: a plainly dull day and a plainly fine one
const SEED = 7

const sigmoid = (z) => 1 / (1 + Math.exp(-z))
const lerp = (a, b, u) => a + (b - a) * u
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
/** The sum a hidden neuron forms before it squashes it. */
const sumOf = (q, j, x) => q.a[j] * x[0] + q.b[j] * x[1] + q.c[j]
const hiddenOf = (q, x) => HIDDEN.map((j) => sigmoid(sumOf(q, j, x)))
const outputOf = (q, h) => sigmoid(HIDDEN.reduce((sum, j) => sum + q.v[j] * h[j], q.d))
const answerOf = (q, x) => outputOf(q, hiddenOf(q, x))
const copyOf = (q) => ({ a: [...q.a], b: [...q.b], c: [...q.c], v: [...q.v], d: q.d })
// the nine connections: which weight each one is, and the two neurons it joins
const WIRES = [
  ...HIDDEN.map((j) => ({ key: 'a', j, from: 'sun', to: `h${j + 1}` })),
  ...HIDDEN.map((j) => ({ key: 'b', j, from: 'wind', to: `h${j + 1}` })),
  ...HIDDEN.map((j) => ({ key: 'v', j, from: `h${j + 1}`, to: 'out' })),
]

/** Train a 2-3-1 network on "is it a beach day?". Returns the examples and what every round did. */
function train(rng) {
  const draw = () => {
    const sun = rng(), wind = rng()
    return { x: [sun, wind], y: sun - wind > MARGIN ? 1 : 0 }
  }
  const days = Array.from({ length: DAYS }, draw)
  const small = () => rng.range(-1, 1)
  const p = { a: HIDDEN.map(small), b: HIDDEN.map(small), c: HIDDEN.map(small), v: HIDDEN.map(small), d: small() }
  // the error that gradient descent walks down: the mean cross-entropy over the examples
  const errorOf = (q) => days.reduce((sum, { x, y }) => {
    const out = clamp(answerOf(q, x), 1e-9, 1 - 1e-9)
    return sum - (y ? Math.log(out) : Math.log(1 - out))
  }, 0) / days.length
  const wrongOf = (q) => days.filter(({ x, y }) => (answerOf(q, x) > 0.5 ? 1 : 0) !== y).length
  const history = [copyOf(p)], errors = [errorOf(p)], wrong = [wrongOf(p)], slopes = []
  for (let round = 0; round < ROUNDS; round++) {
    const g = { a: [0, 0, 0], b: [0, 0, 0], c: [0, 0, 0], v: [0, 0, 0], d: 0 }
    for (const { x, y } of days) {
      const h = hiddenOf(p, x)
      const dOut = outputOf(p, h) - y // slope of the cross-entropy at the output
      for (const j of HIDDEN) {
        const dHidden = dOut * p.v[j] * h[j] * (1 - h[j])
        g.v[j] += dOut * h[j] / days.length
        g.a[j] += dHidden * x[0] / days.length
        g.b[j] += dHidden * x[1] / days.length
        g.c[j] += dHidden / days.length
      }
      g.d += dOut / days.length
    }
    slopes.push(g) // dE/dw for every weight, this round
    for (const j of HIDDEN) {
      p.a[j] -= RATE * g.a[j]; p.b[j] -= RATE * g.b[j]; p.c[j] -= RATE * g.c[j]; p.v[j] -= RATE * g.v[j]
    }
    p.d -= RATE * g.d
    history.push(copyOf(p)); errors.push(errorOf(p)); wrong.push(wrongOf(p))
  }
  // two days the network never trained on, one of each kind, drawn after training from the same stream. They are
  // picked by the truth alone (plainly on one side of the line), never by what the network says about them.
  const unseen = (kind) => {
    for (let tries = 0; tries < 1000; tries++) {
      const day = draw()
      if (day.y === kind && Math.abs(day.x[0] - day.x[1] - MARGIN) > CLEAR) return day
    }
    return draw()
  }
  return { days, history, errors, wrong, slopes, unseen: [unseen(0), unseen(1)] }
}

// ── how the picture is drawn (named, so nothing below is a bare number) ──────────────────────────────────
const LOOK = {
  lit: 0.46, // above this a neuron is light enough for dark text (the grey on which black and white read equally well)
  strong: 8, // a weight this large is drawn at full width
  wire: [1.5, 7], // line width of the weakest and the strongest connection
  faint: 0.45, // opacity of the weakest connection
  pulse: [0.06, 0.15], // radius of the dot that carries a small and a large signal
  carried: 8, // a signal (input x weight) this large is drawn at full size
  beliefCells: 16, // the belief behind the examples is asked on a grid of this many cells each way
  beliefTint: 0.72, // how far the belief colours are darkened so the example dots stay readable
  straight: 0.001, // bend of a connection in degrees: graph() routes an edge with bend 0 round the nodes, a neural network is drawn with straight lines
  shrink: 0.6, // size of the network once it shares the frame with the examples
}
// one forward pass, as shares of its time: the inputs change, the signal crosses to the hidden layer, the hidden
// neurons take it in, it crosses to the output, the output takes it in
const PASS = { inputs: [0, 0.16], first: [0.18, 0.5], hidden: [0.5, 0.62], second: [0.64, 0.9], output: [0.9, 1] }
const share = (u, [from, to]) => clamp((u - from) / (to - from), 0, 1)
const TUNED = WIRES.length + HIDDEN.length + 1 // numbers training tunes: the weights, a bias per hidden neuron, the output's bias
const R = String.raw
const signed = (v, digits = 1) => `${v < 0 ? '−' : '+'} ${Math.abs(v).toFixed(digits)}`
const plain = (v, digits = 1) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`
const hue = (v) => (v >= 0 ? BLUE : RED)

export default scene({ title: 'How a neural network works' }, (s) => {
  // ── the model ──────────────────────────────────────────────────────────────────────────────────────
  const { days, history, errors, wrong, slopes, unseen } = train(s.rng(SEED))
  const trained = history[ROUNDS]
  const argmax = (score) => HIDDEN.reduce((best, j) => (score(j) > score(best) ? j : best), 0)
  // the story walks through four days: the examples the trained network is surest about (a clear no, a clear yes),
  // then the two days it never saw
  const bySureness = [...days].sort((p, q) => answerOf(trained, p.x) - answerOf(trained, q.x))
  const tour = [bySureness[0], bySureness[DAYS - 1], ...unseen]
  // the neuron the story opens on: the hidden one that listens most to BOTH inputs
  const M = argmax((j) => Math.min(Math.abs(trained.a[j]), Math.abs(trained.b[j])))
  // the weight the story turns by hand and later follows through one update: of the nine, the one whose sign
  // matters most to the answer for the clear yes
  const turned = (wire, q = trained) => { const flipped = copyOf(q); flipped[wire.key][wire.j] = -flipped[wire.key][wire.j]; return flipped }
  const swing = (wire) => Math.abs(answerOf(turned(wire), tour[1].x) - answerOf(trained, tour[1].x))
  const KNOB = WIRES.reduce((best, wire) => (swing(wire) > swing(best) ? wire : best))
  const knobWeight = (q) => q[KNOB.key][KNOB.j]

  const sun = s.param('sun', { value: 0.5, min: 0, max: 1, step: 0.01, label: 'sun (one neuron)' })
  const wind = s.param('wind', { value: 0.5, min: 0, max: 1, step: 0.01, label: 'wind (one neuron)' })
  const example = s.param('example', { value: 0, min: 0, max: tour.length - 1, step: 0.01, label: 'day fed to the network' })
  const knobStart = Math.round(knobWeight(trained) * 10) / 10
  const knob = s.param('weight', { value: knobStart, min: -15, max: 15, step: 0.1, label: 'one weight' })
  const round = s.param('round', { value: ROUNDS, min: 0, max: ROUNDS, step: 1, label: 'training round' })

  // the weights at the current round (between two recorded rounds while it moves), plus the hand-turned knob
  const weights = s.signal(() => {
    const r = clamp(round(), 0, ROUNDS)
    const i = Math.min(ROUNDS - 1, Math.floor(r)), u = r - i
    const p0 = history[i], p1 = history[i + 1]
    const blend = (k) => HIDDEN.map((j) => lerp(p0[k][j], p1[k][j], u))
    const q = { a: blend('a'), b: blend('b'), c: blend('c'), v: blend('v'), d: lerp(p0.d, p1.d, u) }
    q[KNOB.key][KNOB.j] += knob() - knobStart
    return q
  })
  const error = s.signal(() => {
    const r = clamp(round(), 0, ROUNDS)
    const i = Math.min(ROUNDS - 1, Math.floor(r))
    return lerp(errors[i], errors[i + 1], r - i)
  })

  // one neuron on its own (chapter 1): its two inputs are the sliders
  const lone = {
    sum: () => sumOf(weights(), M, [sun(), wind()]),
    value: () => sigmoid(sumOf(weights(), M, [sun(), wind()])),
  }
  // the whole network (from chapter 2): fed one day after another. Between two days the signal travels layer by
  // layer, and each layer shows what has reached it so far.
  const pass = s.signal(() => {
    const e = clamp(example(), 0, tour.length - 1)
    const k = Math.min(tour.length - 2, Math.floor(e)), u = e - k
    const from = tour[k].x, to = tour[k + 1].x
    const reached = (span) => { const v = smooth(share(u, span)); return [lerp(from[0], to[0], v), lerp(from[1], to[1], v)] }
    const q = weights()
    const x = reached(PASS.inputs)
    const h = hiddenOf(q, reached(PASS.hidden))
    return { u, x, h, out: outputOf(q, hiddenOf(q, reached(PASS.output))), sent: hiddenOf(q, x) }
  })
  // what the network answers for every possible day, on a grid (row 0 is the windiest)
  const N = LOOK.beliefCells
  const belief = s.signal(() => {
    const q = weights()
    return Array.from({ length: N }, (_, r) => Array.from({ length: N }, (_, c) => answerOf(q, [(c + 0.5) / N, 1 - (r + 0.5) / N])))
  })

  // where the network is undecided: for each amount of sun, the wind at which its answer crosses one half
  const COLUMNS = 3 * N
  const boundary = s.signal(() => {
    const q = weights(), points = []
    for (let i = 0; i <= COLUMNS; i++) {
      const sunAt = i / COLUMNS, yes = (windAt) => answerOf(q, [sunAt, windAt]) > 0.5
      let calm = 0, windy = 1
      if (yes(calm) === yes(windy)) continue // this much sun gets the same answer whatever the wind
      for (let halving = 0; halving < 24; halving++) {
        const mid = (calm + windy) / 2
        if (yes(mid) === yes(calm)) calm = mid; else windy = mid
      }
      points.push([sunAt, (calm + windy) / 2])
    }
    return points
  })
  // when the error starts to fall and when most of it is gone (read from the run; they pace the last chapter)
  const takeoff = errors.findIndex((e) => e < errors[0] * 0.9)
  const landed = errors.findIndex((e) => e < errors[0] * 0.2)
  const slowStart = takeoff > ROUNDS / 40 // the narration only says "little seems to happen" when that is what this run did

  s.probe('answer', () => pass().out)
  s.probe('takeoffRound', () => takeoff)
  s.probe('landedRound', () => landed)
  s.probe('boundaryPoints', () => boundary().length)
  s.probe('error', error)
  s.probe('errorBefore', () => errors[0])
  s.probe('errorAfter', () => errors[ROUNDS])
  s.probe('wrongBefore', () => wrong[0])
  s.probe('wrongAfter', () => wrong[ROUNDS])
  s.probe('loneNeuron', lone.value)
  s.probe('weightTurned', () => knobWeight(weights()))
  s.probe('answerWithWeightTurned', () => answerOf(turned(KNOB), tour[1].x))
  s.probe('answerClearNo', () => answerOf(trained, tour[0].x))
  s.probe('answerClearYes', () => answerOf(trained, tour[1].x))
  s.probe('answerUnseenNo', () => answerOf(trained, tour[2].x))
  s.probe('answerUnseenYes', () => answerOf(trained, tour[3].x))
  // claims the story makes, checked on the real numbers
  s.expect('training makes the error smaller', () => errors[ROUNDS] < errors[0])
  s.expect('the opening neuron has one weight of each sign', () => trained.a[M] * trained.b[M] < 0)
  s.expect('the update rule gives the next weight', () => Math.abs(knobWeight(history[0]) - RATE * knobWeight(slopes[0]) - knobWeight(history[1])) < 1e-9)
  s.expect('the unseen days are answered right', () => answerOf(trained, tour[2].x) < 0.5 && answerOf(trained, tour[3].x) > 0.5)
  s.expect('the error falls most of the way before the last round', () => takeoff >= 0 && landed > takeoff && landed < ROUNDS)
  s.expect('turning the weight flips the answer', () => answerOf(trained, tour[1].x) > 0.5 && answerOf(turned(KNOB), tour[1].x) < 0.5)

  // ── the picture ────────────────────────────────────────────────────────────────────────────────────
  const strength = (w) => Math.min(1, Math.abs(w) / LOOK.strong)
  /** A neuron: a circle as light as its number, with the number inside. */
  const neuron = (value, width, labelSize) => ({
    shape: 'circle', width, color: WHITE, strokeWidth: 2.5, fill: WHITE, fillOpacity: value,
    label: () => value().toFixed(2), labelAt: 'inside', labelSize, labelColor: () => (value() > LOOK.lit ? BLACK : WHITE),
  })
  /** A connection: blue pushes up, red pulls down, wider = stronger. */
  const wire = (weight) => ({
    arrow: false, bend: LOOK.straight,
    color: () => hue(weight()),
    strokeWidth: () => lerp(LOOK.wire[0], LOOK.wire[1], strength(weight())),
    opacity: () => lerp(LOOK.faint, 1, strength(weight())),
  })
  const stage = s.area()
  const left = s.area('left', 0.44)
  const right = s.area('right', 0.5)

  // chapter 1: one neuron and the two inputs it listens to, laid out by graph()
  const one = graph({
    nodes: { sunOne: neuron(sun, 1.1, 'label'), windOne: neuron(wind, 1.1, 'label'), neuron: neuron(lone.value, 1.6, 'body') },
    edges: [['sunOne', 'neuron', wire(() => weights().a[M])], ['windOne', 'neuron', wire(() => weights().b[M])]],
    nodeGap: 1.3, rankGap: 2.4, width: left.width, height: stage.height * 0.6,
  }).at(left.center[0] + 0.7, stage.center[1] + 0.3)
  const sunWire = one.edge('sunOne', 'neuron'), windWire = one.edge('windOne', 'neuron')
  const sunName = text('sun', { size: 'label', color: GREY_B }).nextTo(one.nodes.sunOne, 'left', 0.3)
  const windName = text('wind', { size: 'label', color: GREY_B }).nextTo(one.nodes.windOne, 'left', 0.3)
  const sunWeight = text(() => plain(weights().a[M]), { id: 'sunWeight', size: 'label', color: () => hue(weights().a[M]) }).nextTo(sunWire.pointAt(0.5), 'up', 0.2)
  const windWeight = text(() => plain(weights().b[M]), { id: 'windWeight', size: 'label', color: () => hue(weights().b[M]) }).nextTo(windWire.pointAt(0.5), 'down', 0.2)
  const upWire = trained.a[M] >= 0 ? sunWire : windWire, downWire = trained.a[M] >= 0 ? windWire : sunWire

  // the weighted sum, written out with the live numbers: weight x input + weight x input + bias = sum
  const term = (str, color = WHITE, id) => text(str, { id, size: 'label', color })
  const sumParts = {
    sunWeight: term(() => plain(weights().a[M]), () => hue(weights().a[M])),
    sunTimes: term('×', GREY_B),
    sunValue: term(() => sun().toFixed(2)),
    windWeight: term(() => signed(weights().b[M]), () => hue(weights().b[M])),
    windTimes: term('×', GREY_B),
    windValue: term(() => wind().toFixed(2)),
    bias: term(() => signed(weights().c[M]), GREY_B, 'bias'),
    equals: term('=', GREY_B),
    total: term(() => plain(lone.sum(), 2), YELLOW, 'sum'),
  }
  const sumLine = row(Object.values(sumParts), { id: 'sumLine', gap: 0.16 }).at(right.center[0], right.top - 1.0).alignTo(right, 'right')
  const biasName = text('bias', { size: 'note', color: GREY_C }).nextTo(sumParts.bias, 'up', 0.2)
  const sumName = text('sum', { size: 'note', color: YELLOW }).nextTo(sumParts.total, 'up', 0.2)

  // the squash: the sum goes in along the bottom, the neuron's number comes out on the left
  const reach = Math.ceil(Math.max(...[[0, 0], [0, 1], [1, 0], [1, 1]].map((x) => Math.abs(sumOf(trained, M, x)))))
  const squash = axes({ id: 'squash', x: [-reach, reach], y: [0, 1], width: right.width * 0.72, height: 2.1, xLabel: 'sum', yLabel: 'neuron', ticks: { x: [-reach, 0, reach], y: [0, 1] } })
    .nextTo(sumLine, 'down', 0.9)
  squash.plot(sigmoid, { id: 'squashCurve', color: GREY_B, strokeWidth: 3 })
  const squashDrop = squash.vline(lone.sum, { to: lone.value, color: YELLOW })
  const squashLevel = squash.hline(lone.value, { from: -reach, to: lone.sum, color: GREY_B })
  const squashDot = squash.dot(() => [lone.sum(), lone.value()], { id: 'squashDot', color: YELLOW, radius: 0.09 })
  squashDot.allow('TINY')

  // from chapter 2: the whole network, laid out by graph()
  const net = graph({
    nodes: {
      sun: neuron(() => pass().x[0], 1.15, 'label'), wind: neuron(() => pass().x[1], 1.15, 'label'),
      h1: neuron(() => pass().h[0], 1.15, 'label'), h2: neuron(() => pass().h[1], 1.15, 'label'), h3: neuron(() => pass().h[2], 1.15, 'label'),
      out: neuron(() => pass().out, 1.15, 'label'),
    },
    edges: WIRES.map(({ key, j, from, to }) => [from, to, wire(() => weights()[key][j])]),
    nodeGap: 0.6, rankGap: 3.1, width: stage.width * 0.8, height: stage.height * 0.7,
  }).at(stage.center[0] - 0.4, stage.center[1] + 0.35)
  const hiddenIds = HIDDEN.map((j) => `h${j + 1}`)
  const sunTag = text('sun', { size: 'label', color: GREY_B }).nextTo(net.nodes.sun, 'left', 0.25)
  const windTag = text('wind', { size: 'label', color: GREY_B }).nextTo(net.nodes.wind, 'left', 0.25)
  const answerTag = text('beach day?', { size: 'label', color: GREY_B }).nextTo(net.nodes.out, 'right', 0.25)
  const hiddenTitle = text('hidden layer', { size: 'note', color: GREY_C }).nextTo(net.nodes.h1, 'up', 0.3)
  const inputsTitle = text('inputs', { size: 'note', color: GREY_C }).nextTo(net.nodes.sun, 'up', 0.3).alignTo(hiddenTitle, 'up')
  const outputTitle = text('output', { size: 'note', color: GREY_C }).nextTo(net.nodes.out, 'up', 0.3).alignTo(hiddenTitle, 'up')

  // the signal of one forward pass: a dot per connection, as large as what it carries (input x weight)
  const during = (u, [from, to]) => (u > from && u < to ? 1 : 0)
  const pulse = (wireOf, carried, span) => token({
    on: wireOf, at: () => share(pass().u, span), color: YELLOW,
    radius: () => lerp(LOOK.pulse[0], LOOK.pulse[1], Math.sqrt(Math.min(1, Math.abs(carried()) / LOOK.carried))),
    opacity: () => during(pass().u, span),
  }).allow('TINY')
  const fed = { a: () => pass().x[0], b: () => pass().x[1], v: (j) => pass().sent[j] } // what goes into a connection
  const pulses = WIRES.map(({ key, j, from, to }) => pulse(net.edge(from, to), () => weights()[key][j] * fed[key](j), key === 'v' ? PASS.second : PASS.first))

  // the weight the story turns by hand
  const knobWire = net.edge(KNOB.from, KNOB.to)
  const knobPath = WIRES.filter((wire) => wire === KNOB || wire.from === KNOB.to).map((wire) => net.edge(wire.from, wire.to)) // from the knob on to the output
  const knobTag = readout('weight', () => knobWeight(weights()), { id: 'knobTag', decimals: 2, size: 'note', color: () => hue(knobWeight(weights())), labelColor: GREY_B })
    .nextTo(net.nodes[KNOB.from], KNOB.from === 'wind' || KNOB.from === `h${HIDDEN.length}` ? 'down' : 'up', 0.25) // beside the neuron it leaves, clear of the other wires

  // chapter 3: the examples, as points (sun across, wind up), over what the network believes about every possible day
  const side = Math.min(right.width * 0.5, stage.height * 0.44)
  const plotTop = stage.top - 0.2
  const scatter = axes({ id: 'examples', x: [0, 1], y: [0, 1], width: side, height: side, xLabel: 'sun', yLabel: 'wind', ticks: { x: [0, 1], y: [0, 1] } })
    .at(right.center[0] + 0.45, plotTop - side / 2)
  const cell = () => (scatter.toFrame(1, 0)()[0] - scatter.toFrame(0, 0)()[0]) / N
  const beliefMap = matrix(belief, { id: 'belief', cellSize: cell, gap: 0, range: [0, 1], colors: [mix(RED, BLACK, LOOK.beliefTint), BLACK, mix(BLUE, BLACK, LOOK.beliefTint)] })
    .at(scatter.toFrame(0.5, 0.5)).z(-1)
  const boundaryLine = scatter.plot(boundary, { id: 'boundary', color: WHITE, strokeWidth: 3 })
  const dayDots = days.map((day, i) => scatter.dot(day.x, { id: `day${i}`, color: day.y ? BLUE : RED, radius: 0.055 }).allow('TINY'))
  const firstYes = days.findIndex((day) => day.y === 1), firstNo = days.findIndex((day) => day.y === 0)
  const today = circle({ id: 'today', radius: 0.13, stroke: YELLOW, strokeWidth: 3 }).at(scatter.toFrame(() => pass().x)).allow('TINY')

  // the error, and its curve round by round
  const errorTop = Math.ceil(Math.max(...errors) * 10) / 10
  const errorPlot = axes({ id: 'errorPlot', x: [0, ROUNDS], y: [0, errorTop], width: right.width * 0.66, height: 1.2, yLabel: 'error', ticks: { x: [0, ROUNDS / 2, ROUNDS], y: [0, errorTop] } })
    .nextTo(scatter, 'down', 0.55)
  const errorCurve = errorPlot.plot(errors.map((e, i) => [i, e]), { id: 'errorCurve', color: YELLOW, to: round, strokeWidth: 3 })
  const errorDot = errorPlot.dot(() => [round(), error()], { id: 'errorDot', color: YELLOW, radius: 0.08 }).allow('TINY')
  const errorNow = readout('error', error, { id: 'errorNow', decimals: 2, size: 'label', color: YELLOW, labelColor: YELLOW })
    .at(errorPlot.toFrame(ROUNDS * 0.66, errorTop * 0.82))
  const roundNow = readout('round', () => Math.round(round()), { id: 'roundNow', decimals: 0, size: 'note', color: GREY_B, labelColor: GREY_B })
    .nextTo(errorNow, 'down', 0.2)

  // chapter 4: the update rule, then the same line with the real numbers of round 1 for the weight turned by hand
  const w0 = knobWeight(history[0]), w1 = knobWeight(history[1]), slope0 = knobWeight(slopes[0])
  const group = (v) => (v < 0 ? `(${plain(v, 3)})` : plain(v, 3))
  const rule = tex(R`w \leftarrow w - \eta \, \frac{\partial E}{\partial w}`, { id: 'rule', size: 'label', colors: { E: YELLOW } })
    .nextTo(net, 'down', 0.6)
  const ruleNumbers = tex(R`${plain(w1, 2)} \leftarrow ${plain(w0, 2)} - ${RATE} \times ${group(slope0)}`, { id: 'ruleNumbers', size: 'label' })
    .nextTo(rule, 'down', 0.4)

  // which way to move each input so the opening neuron lights up or dims (read from the trained weights, not assumed)
  const lifts = (weight) => (weight > 0 ? 0.95 : 0.05)
  const dims = (weight) => (weight > 0 ? 0.05 : 0.95)

  // ── the story ──────────────────────────────────────────────────────────────────────────────────────
  // In every step the narration starts first and the moves run under it; st.wait() holds a move back until its words.
  s.chapter('One neuron')

  s.step('A neuron holds a number', (st) => {
    st.zoom(one.nodes.neuron, { margin: 3, duration: 0 })
    st.set(sun, dims(trained.a[M]), { duration: 0 })
    st.set(wind, dims(trained.b[M]), { duration: 0 })
    st.play(create(one.nodes.neuron))
    st.say('A [neuron](neuron) holds one number between zero and one. Think of it as how lit up it is.')
    st.wait(2.5)
    st.play(sun.to(lifts(trained.a[M]), { duration: 3 }), wind.to(lifts(trained.b[M]), { duration: 3 }))
    st.note('This is one real neuron of the small network the scene trains while it loads. Nothing about it is drawn by hand: drag the sliders and it recomputes.')
  })

  s.step('It listens to its inputs', (st) => {
    st.say('Its number comes from the neurons that feed it. Here they hold two facts about a day: how [sunny](sunOne) it is, and how [windy](windOne).')
    st.zoom(null)
    st.play(lagged([fadeIn(one.nodes.sunOne, { shift: [0.5, 0] }), fadeIn(one.nodes.windOne, { shift: [0.5, 0] })], { lag: 0.3 }), write(sunName), write(windName))
    st.play(create(sunWire), create(windWire))
    st.wait(2)
    st.play(wind.to(dims(trained.b[M]), { duration: 2.5 }))
    st.play(wind.to(lifts(trained.b[M]), { duration: 2 }))
    st.note('The inputs are numbers too: 0 is no sun at all, 1 is as sunny as it gets. Anything you can turn into numbers can be an input: pixels, sound, words.')
  })

  s.step('Every connection has a weight', (st) => {
    st.say(`Each connection carries a weight. A [blue](${upWire.id}) weight pushes the neuron up when its input grows, and a [red](${downWire.id}) one pulls it down.`)
    st.play(write(sunWeight), write(windWeight))
    st.wait(3.5)
    st.play(sun.to(dims(trained.a[M]), { duration: 2.5 }))
    st.play(sun.to(lifts(trained.a[M]), { duration: 2 }))
    st.note('A weight says how much the neuron cares about one input, and in which direction. The line is drawn wider the larger the weight is.')
  })

  s.step('Multiply and add', (st) => {
    st.say('The neuron multiplies every input by its weight and adds the results, plus a constant of its own, the [bias](bias). That gives one [sum](sum).')
    st.play(
      derive(sunWeight, sumParts.sunWeight), derive(one.nodes.sunOne, sumParts.sunValue), fadeIn(sumParts.sunTimes),
      derive(windWeight, sumParts.windWeight), derive(one.nodes.windOne, sumParts.windValue), fadeIn(sumParts.windTimes),
      { duration: 2, lag: 0.15 },
    )
    st.wait(2.5)
    st.play(fadeIn(sumParts.bias), write(biasName))
    st.wait(1)
    st.play(fadeIn(sumParts.equals), write(sumParts.total), write(sumName))
    st.play(wind.to(dims(trained.b[M]), { duration: 2.5 }))
    st.note('In symbols: `z = w1·x1 + w2·x2 + b`. The bias `b` shifts the point at which the neuron switches on.')
  })

  s.step('Then squash', (st) => {
    st.say('The sum can be any size, so the neuron squashes it into the range from zero to one.')
    st.play(create(squash))
    st.play(derive(sumParts.total, squashDot), fadeIn(squashDrop), fadeIn(squashLevel))
    st.wait(3.5)
    st.say('The [dot](squashDot) slides along this curve, and its height is the number the [neuron](neuron) shows.')
    st.play(wind.to(lifts(trained.b[M]), { duration: 3.5 }))
    st.play(sun.to(tour[0].x[0], { duration: 1.5 }), wind.to(tour[0].x[1], { duration: 1.5 }))
    st.note('The curve is the sigmoid, `1 / (1 + e^(-z))`. A large positive sum lands near 1, a large negative one near 0, and only sums near zero are undecided. Modern networks often use other squashing curves; the idea is the same.')
  })

  s.chapter('A network', { keep: [one, sunName, windName] })

  s.step('Stack neurons into layers', (st) => {
    st.say('Wire many such neurons together in layers and you have a network. This one reads the weather and answers one question: is it a [beach day](out)?')
    st.play(
      transform(one.nodes.neuron, net.nodes[hiddenIds[M]]), transform(one.nodes.sunOne, net.nodes.sun), transform(one.nodes.windOne, net.nodes.wind),
      transform(sunWire, net.edge('sun', hiddenIds[M])), transform(windWire, net.edge('wind', hiddenIds[M])),
      transform(sunName, sunTag), transform(windName, windTag),
      { duration: 2 },
    )
    const others = HIDDEN.filter((j) => j !== M)
    st.play(lagged([...others.map((j) => fadeIn(net.nodes[hiddenIds[j]])), fadeIn(net.nodes.out)], { lag: 0.3 }))
    st.play(lagged([
      ...others.flatMap((j) => [create(net.edge('sun', hiddenIds[j])), create(net.edge('wind', hiddenIds[j]))]),
      ...HIDDEN.map((j) => create(net.edge(hiddenIds[j], 'out'))),
    ], { lag: 0.15 }), { duration: 2 })
    st.play(lagged([write(inputsTitle), write(hiddenTitle), write(outputTitle), write(answerTag)], { lag: 0.2 }))
    st.note(`Two inputs, ${HIDDEN.length} hidden neurons, one output: ${TUNED} numbers to tune (${WIRES.length} weights and ${TUNED - WIRES.length} biases). Large language models are the same construction with billions of them.`)
  })

  s.step('Numbers flow forward', (st) => {
    st.show(...pulses)
    st.say('Feed it a sunny, calm day.')
    st.say('Every [connection](sun-h1) carries its input times its weight to the [hidden layer](ring:h1+h2+h3), which adds and squashes.')
    st.say('Then the [output](out) does the same with what the hidden layer sends on.')
    st.wait(0.4)
    st.play(example.to(1, { duration: 12.5, rate: linear }))
    st.note('This is called the forward pass. The dots are sized by what each connection carries: input times weight. A neuron only changes once the signal has reached it, so the answer appears last.')
  })

  s.step('The weights are the knobs', (st) => {
    st.say(`Everything the network knows is in its weights. Turn just [one](${knobWire.id}) the other way, and the same day gets a different [answer](out).`)
    st.focus(...knobPath, net.nodes[KNOB.from], net.nodes[KNOB.to], net.nodes.out, knobTag, answerTag)
    st.play(fadeIn(knobTag))
    st.wait(2.5)
    st.play(knob.to(-knobStart, { duration: 3 }))
    st.play(knob.to(knobStart, { duration: 2 }))
    st.play(fadeOut(knobTag))
    st.note('Drag the "one weight" slider yourself: the answer for this day follows at once, because the picture is the real network.')
  })

  s.chapter('What it should learn', { keep: [net, sunTag, windTag, answerTag, ...pulses] })

  s.step('Examples', (st) => {
    st.say(`Nobody sets the weights by hand. We collect examples instead: ${DAYS} days, each one a point. [Blue](day${firstYes}) was a beach day, [red](day${firstNo}) was not.`)
    st.play(net.to.at(left.center[0] + 1.0, stage.top - stage.height * 0.27).scale(LOOK.shrink), { duration: 2 })
    st.play(create(scatter))
    st.play(derive(net.nodes.sun, today), { duration: 1.5 })
    st.play(lagged(dayDots.map((d) => fadeIn(d)), { lag: 0.05 }), { duration: 2.5 })
    st.note(`Each point is one day: how sunny across, how windy up. The ring marks the day the network is being fed right now. The examples here are generated: a day counts as a beach day when sun minus wind is above ${MARGIN}.`)
  })

  s.step('Start from random weights', (st) => {
    st.say('Now forget the good weights and start from random ones. The network still answers, but its [answer](out) means nothing yet.')
    st.wait(1)
    st.play(round.to(0, { duration: 3 }))
    st.note('Random starting weights are how real training begins too. Here they are drawn between -1 and 1 from a seeded stream, so the scene is the same every time.')
  })

  s.step('What the network believes', (st) => {
    st.say('Ask this network about every possible day and shade the plot with its [answers](glow:belief): blue where it says yes, red where it says no.')
    st.wait(2.5)
    st.play(fadeIn(beliefMap), fadeIn(boundaryLine), { duration: 2 })
    st.say('So far the shading ignores the points.')
    st.note(`The shading is the network itself, asked on a ${N} by ${N} grid of days. Where blue shading lies under red points (or red under blue), it is wrong. The white line, once there is one, is where it is undecided.`)
  })

  s.step('Measure the error', (st) => {
    st.say(`Compare its answers with the truth on all ${DAYS} days and you get one number, the [error](errorNow).`)
    st.wait(4)
    st.play(write(errorNow))
    st.wait(1.5)
    st.say('We will follow it [round by round](errorPlot).')
    st.play(create(errorPlot))
    st.play(derive(errorNow, errorDot), fadeIn(roundNow))
    st.note('The error here is the cross-entropy: the average of `-log(answer)` for the days that were beach days and `-log(1 - answer)` for the others. Confidently wrong answers cost the most.')
  })

  s.chapter('Learning', { keep: [net, sunTag, windTag, answerTag, ...pulses, scatter, beliefMap, boundaryLine, ...dayDots, today, errorPlot, errorCurve, errorDot, errorNow, roundNow] })

  s.step('The update rule', (st) => {
    st.say('Learning is one [rule](rule), applied to every weight at once: move it a small step in the direction that makes the error smaller.')
    st.wait(1)
    st.play(write(rule), { duration: 2 })
    st.wait(5)
    st.say(`For [this weight](${knobWire.id}), the first round is this small step.`)
    st.play(fadeIn(knobTag))
    st.play(rewrite(rule, ruleNumbers, { keep: true }))
    st.play(round.to(1, { duration: 2 }))
    st.note('`∂E/∂w` is the slope of the error with respect to one weight: how much the error grows if that weight grows. Stepping against the slope is gradient descent; `η` (here ' + RATE + ') sets the step size. Finding all the slopes at once is what backpropagation does.')
  })

  s.step('Round after round', (st) => {
    st.say(slowStart ? 'Repeat that, round after round. At first little seems to happen.' : 'Repeat that, round after round.')
    st.play(fadeOut(ruleNumbers), fadeOut(knobTag))
    st.play(round.to(takeoff, { duration: 4, rate: linear }))
    st.say('Then the [error](errorCurve) falls, and the [boundary](boundary) swings in between the blue points and the red ones.')
    st.play(round.to(landed, { duration: 8.5, rate: linear }))
    st.say('The weights settle into values nobody chose.')
    st.play(round.to(ROUNDS, { duration: 3.5 }))
    st.note(`${ROUNDS} rounds, each one a forward pass over all ${DAYS} days and one small step for all ${TUNED} numbers. The story lingers on the rounds where the error falls and hurries through the long tail after them.`)
  })

  s.step('A day it never saw', (st) => {
    st.say('Now feed it [days](today) that were never among the examples. A dull, windy one comes out near zero.')
    st.wait(2)
    st.play(example.to(2, { duration: 6, rate: linear }))
    st.say('A sunny, calm one comes out near one. That is all a neural network is: numbers flowing through weights that were tuned on examples.')
    st.play(example.to(3, { duration: 6, rate: linear }))
    st.note('Answering well on days outside the examples is called generalising, and it is the whole point: the network has picked up the rule behind the examples, not the examples themselves.')
  })
})
