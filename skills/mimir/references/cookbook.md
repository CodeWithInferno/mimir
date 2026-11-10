# Cookbook: three scenes to start from

Each scene below is complete and passes `mimir check`. They are cut down from the example scenes
(`mimir examples <name>` prints the full ones): start from the nearest, keep its shape, change the subject.

Contents: 1. a mechanism beside its plot · 2. a system with moving tokens · 3. maths: a model, a curve, a formula ·
4. idioms that apply everywhere

## 1. A mechanism beside its plot

From `slider-crank` and `gear-train`. The shape: a 3D model built from `kit` parts in one panel, assembled and
moved by a mechanism function, and beside it a plot or numbers read back from that same mechanism. One param
drives everything.

```js
import { scene, kit, crankSlider, axes, guide, readout, create, fadeIn, lagged, BLUE, YELLOW } from 'mimir'

export default scene({ title: 'How a crank moves a piston' }, (s) => {
  const mm = 0.02 // real dimensions at one scale: 1 unit = 50 mm
  const crank = s.param('crank', { value: 0, min: 0, max: 360, unit: '°', label: 'Crank angle' })
  s.viewport('left', 0.42) // the 3D panel; s.area() is the rest of the frame

  // the model: kit parts, assembled and moved by the mechanism (no trigonometry in the scene)
  const crankshaft = kit.crankshaft({ id: 'crankshaft', throw: 43 * mm, journal: 55 * mm, crankpin: 45 * mm, pinLength: 26 * mm, webThickness: 18 * mm, overhung: true, material: 'iron' })
  const rod = kit.conRod({ id: 'rod', length: 139 * mm, bigEnd: 46 * mm, smallEnd: 22.5 * mm, thickness: 22 * mm, material: 'aluminium' })
  const piston = kit.piston({ id: 'piston', bore: 86 * mm, pin: 22 * mm, color: BLUE })
  const slide = crankSlider({ id: 'slide', crank: crankshaft, rod, slider: piston, axis: 'up', angle: crank })

  // the plot: every value is read back from the mechanism, and a guide ties the model to its point on the curve
  const side = s.area()
  const travel = () => 100 * slide.fraction()
  const plot = axes({ id: 'plot', x: [0, 360], y: [0, 100], width: 5.4, height: 2.6, xUnit: '°', yUnit: '%', ticks: { x: 90, y: 50 } }).at(side.center[0], 0.8)
  const curve = plot.trail(() => [crank(), travel()], { id: 'curve', color: BLUE })
  const cursor = plot.dot(() => [crank(), travel()], { id: 'cursor', color: YELLOW })
  cursor.allow('TINY') // a dot is small by nature: say so, and check stops asking
  const tie = guide(piston.anchor('crown'), cursor, { id: 'tie' })
  const reading = readout('travel', travel, { id: 'reading', unit: '%', decimals: 1 }).nextTo(plot, 'down', 0.45)

  s.step('The parts', (st) => {
    st.say('A [crankshaft](crankshaft) turns, and a [rod](label:rod) ties its pin to a [piston](ring:piston).')
    st.camera({ view: 'front' }) // the view in which every part that is named can be seen
    st.play(lagged([crankshaft, rod, piston].map((part) => create(part)), { lag: 0.25 }))
  })
  s.step('Travel against angle', (st) => {
    st.say('Plot how far the piston has [travelled](cursor) against the crank angle.')
    st.play(create(plot), fadeIn(cursor), fadeIn(tie), fadeIn(curve), { lag: 0.2 })
    st.play(fadeIn(reading))
    st.set(crank, 360, { duration: 6 }) // one param drives the model, the curve and the number
  })
})
```

- `s.viewport('left', 0.42)` puts the 3D panel; `s.area()` is the rectangle left for 2D. Never overlap the two.
- The mechanism (`crankSlider`, `gearPair`, `gearTrain`, `rackPinion`, `planetary`, `camFollower`, `belt`) places
  and turns the parts. Place only the first part; do not `.at()` or rotate what a mechanism owns.
- Read results from what the mechanism returns (`slide.fraction()`, `train.ratio`, `train.turned(i)`): the model and
  the number can then never disagree.
- A part that is named in a step must be visible there. `check` (OCCLUDED) names a view that shows it:
  `st.camera({ view: 'front' })`, or `st.ghost(housing)`, or cut the housing (`kit.liner({ cut: 'half' })`).
- No kit part for what you need? Build it from primitives (`box`, `cylinder`, `torus`, `extrude`, `lathe`,
  `sweep`, `repeat(n, i => …).ring(…)`) and join them with `attach` / `on` / `between`. `mimir examples hello-3d`,
  `mimir examples guided-tour` and `mimir examples hydraulic-press` do exactly that.
- When one view cannot show the motion that matters (something moves towards the viewer, or sideways behind
  another part), turn the camera in that step (`st.camera({ view: 'top' })`), or put a small flat schematic of
  that one motion beside the model, driven by the same param. The model stays on stage.
- A mechanism that really is flat (a lever, a pendulum, a linkage seen side-on) can be drawn in 2D, as what it
  looks like: real outlines (`circle`, `polygon`, `path`, `arc`) whose points are functions of a param, as in
  `mimir examples pendulum`. Never as boxes that stand for parts.

## 2. A system with moving tokens

From `request-flow`. The shape: `graph()` lays out the boxes and edges, `traffic()` runs a seeded simulation over
them, and every token and count on screen belongs to that simulation.

```js
import { scene, graph, traffic, text, row, column, fadeIn, GREEN, BLUE, WHITE, GREY_C } from 'mimir'

export default scene({ title: 'How a request finds its answer' }, (s) => {
  // the system: graph() lays it out; nothing is positioned by hand
  const g = graph({
    nodes: {
      client: 'client',
      balancer: { label: 'load balancer', shape: 'queue', slots: 5 }, // requests wait in its slots
      a: { label: 'server A', shape: 'ring' }, // the ring fills while the server works
      b: { label: 'server B', shape: 'ring' },
      db: { label: 'database', shape: 'cylinder' },
    },
    edges: [['client', 'balancer'], ['balancer', 'a'], ['balancer', 'b'], ['a', 'db'], ['b', 'db']],
  }).at(0, 0.7)

  // the traffic: rules and a seed, not keyframes. Every token on screen is a request of this simulation.
  const sim = traffic(g, {
    seed: 11,
    sources: { client: { every: [0.9, 1.4] } },
    stations: { a: { service: [0.7, 1.1] }, b: { service: [0.7, 1.1] } },
    travel: 0.7,
  })
  // numbers on screen are counts of the simulation, so they always add up
  const sent = sim.count('sent'), done = sim.count('done', g.nodes.db)
  const count = (value, name, color) => column([text(() => String(value()), { size: 'label', color }), text(name, { size: 'tiny', color: GREY_C })], { gap: 0.14 })
  const counts = row([count(sent, 'sent', WHITE), count(done, 'answered', GREEN), count(() => sent() - done(), 'under way', BLUE)], { gap: 0.9, align: 'top' }).at(0, -2.3)

  s.step('The parts', (st) => {
    st.say('A [client](client), a [load balancer](balancer) and two [servers](ring:a+b).') // one or two marks a sentence
    st.say('Behind them, a [database](db).')
    st.play(g.draw())
  })
  s.step('Requests', (st) => {
    st.say('Each request goes to the [balancer](balancer), which hands it to the server that has been idle longest.')
    st.play(fadeIn(sim)) // the simulation's clock starts here
    st.play(fadeIn(counts))
    st.wait(6)
  })
  s.step('A server dies', (st) => {
    st.say('When [server B](b) dies, everything goes through A and a line forms at the balancer.')
    g.nodes.b.down()
    st.wait(7)
  })
})
```

- Node shapes: `box` (default), `pill`, `circle`, `cylinder` (a store), `queue` (slots that fill), `ring` (fills
  while it works). `g.nodes.<name>` is the object; its id is the node's name, so `[words](name)` points at it.
- State changes are calls made inside a step (`g.nodes.b.down()`, `.down(false)`): from that moment the simulation
  follows the new rule.
- Without a simulation: `tokens(g.edge('a', 'b'), { count, speed })` for a steady stream, `token({ on: edge, at: () => u })`
  for one message whose position you compute, `sequence()` for messages between actors over time.
- A fixed protocol (a handshake, a request and its reply) is a story, not traffic: one `token` per message, moved
  by `st.play(...)` step by step.

## 3. Maths: a model, a curve, a formula

From `sine-explorer` and `formula`. The shape: the concrete model on the left, its plot on the right, one param
through both, a dashed `guide` that ties them, and the formula written last.

```js
import { scene, axes, guide, line, readout, tex, create, write, fadeIn, linear, BLUE, YELLOW, WHITE, GREY_B } from 'mimir'

export default scene({ title: 'Where a sine wave comes from' }, (s) => {
  const angle = s.param('angle', { value: 0, min: 0, max: 360, unit: '°', label: 'Angle' })
  // the one piece of maths in the scene; everything drawn reads it
  const height = (degrees) => Math.sin((degrees * Math.PI) / 180)
  const tip = () => [Math.cos((angle() * Math.PI) / 180), height(angle())]

  // left: the concrete thing, a point going round a circle (its own small axes, so one unit is the same length in both)
  const plane = axes({ id: 'plane', x: [-1.5, 1.5], y: [-1.5, 1.5], width: 3, height: 3, axis: 'zero', ticks: false }).at(-4.6, 0.4)
  plane.plot(() => Array.from({ length: 121 }, (_, i) => [Math.cos((i * Math.PI) / 60), Math.sin((i * Math.PI) / 60)]), { id: 'circle', color: GREY_B, strokeWidth: 2 })
  const arm = line(plane.toFrame(0, 0), plane.toFrame(tip), { id: 'arm', color: WHITE, strokeWidth: 3, buff: 0 })
  const point = plane.dot(tip, { id: 'point', color: YELLOW })

  // right: its height against the angle; the curve draws on up to the angle, a guide carries the height across
  const plot = axes({ id: 'plot', x: [0, 360], y: [-1.5, 1.5], width: 6, height: 3, xUnit: '°', xLabel: 'angle', yLabel: 'height', ticks: { x: 90, y: [-1, 0, 1] } }).at(2.4, 0.4)
  const wave = plot.plot(height, { id: 'wave', color: BLUE, to: angle })
  const cursor = plot.dot(() => [angle(), height(angle())], { id: 'cursor', color: YELLOW })
  point.allow('TINY')
  cursor.allow('TINY')
  const tie = guide(point, cursor, { id: 'tie' })
  const reading = readout('height', () => height(angle()), { id: 'reading', decimals: 2 }).nextTo(plot, 'down', 0.35)
  // the formula comes last, once the picture has made it obvious
  const law = tex(String.raw`h = \sin\theta`, { id: 'law', colors: { [String.raw`\theta`]: YELLOW } }).nextTo(plane, 'down', 0.5)

  s.step('A point on a circle', (st) => {
    st.say('Take a [point](point) on a [circle](circle), at the end of an [arm](arm) that can turn.')
    st.play(create(plane), create(arm), { lag: 0.4 })
    st.set(angle, 60, { duration: 1.5 })
  })
  s.step('Its height against the angle', (st) => {
    st.say('Plot the [height](cursor) of the point against the angle. The [dashed line](tie) carries it across.')
    st.play(create(plot), fadeIn(tie), fadeIn(reading), { lag: 0.3 })
    st.set(angle, 360, { duration: 5, rate: linear })
  })
  s.step('The name of the curve', (st) => {
    st.say('That [curve](wave) is the sine of the angle.')
    st.play(write(law))
  })
})
```

- `plot.plot(fn, { to: param })` draws the curve on as the param moves; `plot.dot`, `plot.vline`, `plot.area`,
  `plot.bracket`, `plot.mark` follow values. `plot.toFrame(x, y)` is the frame point of a plot value.
- `tex()` sets LaTeX (use `String.raw`). `formula.part('x^2')` is one term as an object: colour it, scale it, point
  at it. `rewrite(a, b)` turns one line into the next with the shared terms gliding.
- State that evolves in time: `ode({ y0, f })` (physics), `events({ init, next })` (arrivals, queues),
  `stepper(function* () { … yield state … })` (an algorithm, state by state: read `steps.at(i)` with a param `i`
  that the story sweeps, and draw every cell, pointer and count as a function of that state).
- Data: `bars(() => values())`, `matrix(rows)`, `numberLine()`.

## 4. Idioms that apply everywhere

- **A param is the spine.** `const p = s.param(...)`; everything that moves is a function of `p()`.
  `st.set(p, v)` sweeps it across the whole step (use this for "watch it turn"); `st.play(p.to(v))` moves it as one
  beat in a sequence of plays.
- **Dynamic anything.** Any option may be a function: `rect({ width: () => 1 + load() })`,
  `text(() => `${n()} left`)`, `.at(() => [x(), y()])`, `.color(() => (hot() ? RED : GREY_B))`.
- **Layout.** The main object first, large, at the centre of the stage: `main.at(0, 0.5)` (a row of cells about
  12 units wide; a model about 5 units tall). Everything else hangs from it: `heading.nextTo(main, 'up', 0.5)`,
  `counts.nextTo(main, 'down', 0.5)`, or one `column([heading, main, counts], { gap: 0.5 }).at(0, 0.4)`.
  `row`, `column`, `grid([...], { columns })` for members; `thing.fit(s.area('right'))` beside a 3D panel.
  Anchors: `box.top`, `box.right`, `line.pointAt(0.5)`.
- **Entrances.** `create` for shapes and lines (drawn on), `write` for text and formulas, `fadeIn` for groups and
  readouts, `grow` / `growArrow` from a point; `lagged([...], { lag: 0.2 })` for several of a kind.
- **Attention.** `st.focus(a, b)` dims the rest for one step; `st.label(part, 'two words')` names a part for one
  step; `flashAround(m)` once, for the thing that matters; `st.zoom(target)` moves the 2D camera in, `st.zoom(null)` back.
- **Declare what must be true** and let `check` prove it: `s.probe('ratio', () => …)`,
  `s.expect('teeth mesh', () => …)`, `expect.conserved('total')`.
- **Tell `check` what is by design:** `dot.allow('TINY')`, `liner.allow('OCCLUDED')`. Only for a real design
  decision, with a comment that says why; never to silence a finding you do not understand.
