# explain(): write it once, it renders

A scene is ONE object: which blocks are on stage, and a story. Never write a position, size, duration or camera.
`mimir check <scene>` must say `OK 0 errors, 0 warnings`; `mimir check <scene> --describe` prints what every step says, points at and changes.

```js
import { explain, cells, flow, chart, layers, train, machine, formula, sequence, custom, kit, crankSlider } from 'mimir'
export default explain({ title, controls, stage, story })
```
- `title`: one line at the top.
- `controls: { crank: { from: 0, to: 360, value?, step?, unit?: '°', label?, cyclic?: true } }`: sliders. A step moves one with `set`.
- `stage: { id: block, … }`: reading order. The stage arranges, fits and centres; every block is on stage from step one.
- `story`: a list of steps, or `function* ({ id: api, … }) { yield step }` (a real algorithm; runs once, each step is applied before it resumes).

## A step
- `say: 'A [rod](engine.rod) ties …'`: narration. `[words](block.part)` points at a part; `[words](block)` at the block; `a+b` several. Links are resolved after the step's changes. Too many links, links back to back, symbols (= % ->) and over-long sentences are repaired for you.
- `<blockId>: { state: value }` (or a list of them, played in turn): what changes in that block. Keys below.
- `set: { crank: 90 }`: sweep a control during the step.
- `focus: 'row.mid'` dims the rest; `chapter: 'Title'`; `note: 'markdown'`; `title: 'Step title'`.
- Step length comes from the narration. A step that shows nothing new gets a focus on what was touched last.

## Blocks
**cells(values, { pointers?: ['lo', 'hi'], index?: true, labels?: [...] })**: a row for algorithms.
State: `<pointer>: slot | null` · `lit: [from, to] | null` (rest dims) · `dim: [from, to]` · `compare: [i, j] | i` · `swap: [i, j]` · `insert: { at?, value }` · `remove: i` · `found: i | [i…]` · `done: i | [i…]` (accumulates).
Reads: `row.value(i)`, `row.values()`, `row.length`, `row.at('lo')`, `row.indexOf(v)`. Links: `row`, `row.<pointer>`, `row.<slot>`.

**flow(system, { jobs?, direction?: 'right' | 'down' })**: a system that runs (seeded simulation).
System: `'client -> queue[8] -> worker*3 -> database; worker -fail-> retry -> queue; retry -3x-> dead letters'`: `name[8]` a queue, `name*3` replicas (worker1…), `-fail->` where failed jobs go, `-3x->` after 3 failures, `-miss 35%->` that share takes the link, `;` separates chains. Ids are camelCase (`deadLetters`).
`jobs: { count: 20, every: 1, service: [0.8, 1.2] | { server: [0.9, 1.3], cache: 0.3 }, seed: 1 }`; without `jobs` nothing runs by itself.
State: `until: 12 | 'end'` (run the clock) · `crash: 'worker2' | { node, for: 8 }` (lands when the node holds a job) · `recover: 'worker2'` · `poison: 1` (a job that fails everywhere) · `rate: 2` (jobs / s) · `show: 'conservation'` · by hand: `send: 'a -> b -> c'`, `busy | fail | idle: 'node'`.
Links: `system.<node>`, `system.worker` (first replica), `system.in | done | queued | inFlight | dead`. Reads: `count(name)`, `depth(node)`, `time()`, `end()`.

**chart({ x?, y?, curve?, curves?, points?, follow?, cursor? })**: a plot that reads real numbers.
`x`, `y`: `'name'` | `[min, max]` | `{ name, range }` | a control's name (axis spans it, cursor follows it). `curve: (x, env) => y`, or `(env) => readFunction` such as `({ engine }) => engine.probe('piston.y')`; `env.<control>` is its value, `env.<block>` that block's reads. `curves: { name: source }`. `points: [[x, y]…] | (env) => points`. `follow: 'system.queue' | 'system.done' | 'net.error'`: a number of an earlier block over its clock.
State: `mark: x | [x, 'label']` · `band: [from, to, 'label']` · `tangentAt: x | null` · `drawTo: x` · `show | hide: 'curveName'`.
Links (for a chart with the id `height`): `height`, `height.curve`, `height.<curve name>`, `height.cursor`, `height.tangent`, `height.mark1`.

**layers({ sizes: [2, 3, 1], inputs?, outputs?, names?, train?, feed?, values?, weights? })**: a neural network.
`train: { data: [{ x: [..], y: 0 | 1 }] | (random) => data, rate: 1, rounds: 200, seed: 1 }` really trains it. `feed: ['sun', 'wind']` controls drive the inputs.
State: `round: n | 'end'` · `pulse: true` (one forward pass) · `focus: '2.1' | '1.2-2.1' | null` (layer.node, from 1) · `set: { values, weights }` (untrained).
Links: `net.2.1`, `net.1.2-2.1`. Reads: `error(round?)`, `value(layer, i)`; a chart follows `'net.error'`.

**machine({ parts, joints, view?, camera?, labels?, probes?, checks? })**: a 3D mechanism that really moves.
`parts: { name: part }`: kit parts (`kit.gear({ teeth, module, width })`, `kit.rack({ teeth, module })`, `kit.shaft`, `kit.piston({ bore })`, `kit.conRod({ length })`, `kit.crankshaft({ throw })`, `kit.liner({ bore, cut: 'half' })`, `kit.valve`, `kit.cam`, `kit.spring`, `kit.pulley`, `kit.flywheel`, `kit.bearing`; `mimir docs kit`) or your own: `box({ width, height, depth })`, `cylinder({ radius, height })` (axis y), `extrude(outline, { depth, holes?: [outline] })` (flat in x-y, pushed along z; an outline comes from a formula, see Shapes from maths), `lathe`, `sweep`; add `{ color }`. Name a point: `.define('tip', [x, y, z])`. One consistent unit; the camera fits.
`joints`, one line each:
- `['a', 'spins', { by, about?: 'z', at?: 'b.anchor' | [x, y, z], pivot?: 'ownAnchor' }]` · `['a', 'slides', { by, along?: 'y' }]`: `by` = a control name, a number, or `(c, m) => number` (`c.turn` = a control).
- `['a', 'on', 'b.anchor', { my?: 'ownAnchor', offset? }]` rides rigidly on b · `['rod', 'between', 'a.pin', 'b.pin']` · `['case', 'around', 'rotor']` a housing (ghosted when it hides what it holds).
- `['a', 'follows', (c, m) => ({ at: [x, y, z], turn: deg, about?: 'z' })]`: your own closed-form law. `m.point('a.anchor')`, `m.angle('a')`, `m.distance(p, q)`.
- kit mechanisms by part NAME: `crankSlider({ crank, rod, slider, angle })`, `gearPair('a', 'b', { angle })`, `gearTrain(['a', 'b', 'c'], { angle })`, `rackPinion({ rack, pinion, angle })`, `camFollower({ cam, follower, angle })`, `planetary`, `belt('a', 'b', { angle })`; `angle` = a control name or `(c) => degrees`.
- `['g', 'gas', { phase: (c) => 0..1 | colour, from?: 'a.x', to?: 'b.y' }]` · `[['a.out', 'b.in'], 'particles', { when: (c) => boolean }]`.
`checks: { 'the pin stays in the slot': (c, m) => distanceOff }` is measured over every control (0 = holds). The parts of one machine may touch and sit in each other (a pin in its slot): that is not reported; `checks` is where a script says what must hold. `probes: { name: (c, m) => number }`.
State: `camera: 'iso' | 'front' | 'side' | 'top' | '<part>'` · `view: 'solid' | 'ghost' | 'cutaway'` · `spin: true` · `highlight: 'part' | [..] | null` · `label: ['rod'] | { rod: 'text' }`.
Links: `engine.<part>`. Reads: `engine.probe('piston.y' | 'part.angle' | 'part.travel' | '<probe name>')` → a function for a chart.

**formula('a^2 + b^2 = c^2', { colors? })**: state `highlight: 'c^2' | null`, `latex: '…'` (shared terms glide). Links: `eq`, `eq.c^2`.

**sequence({ actors: ['client', 'server'], messages: [['client', 'server', 'SYN'], …] })**: state `upTo: n | 'end'`, `lost: n`, `retry: n` (messages from 1). Links: `wire.client`, `wire.m2`.

**custom(({ area }) => object | { root, targets: { name: object }, change(st, change, state), describe(state), api })**: anything else, with the 2D API: `rect({ width, height, radius, color, fill })`, `circle({ radius })`, `text('words', { size: 'label' | 'note', color })`, `line(a, b)`, `arrow(a, b)`, `group([…])`, `row([…], { gap })`, `column`, `grid([…], { columns, gap })`; place with `.at(x, y)` in any coordinates of your own: the result is scaled and centred into the block (`fit: false` keeps it as drawn). Objects that a `change` fades in are hidden until then. In `change`: `st.play(obj.to.color(GREEN))`, `st.play(obj.to.shift(dx, dy))`, `st.play(fadeIn(obj))`, `indicate(obj)`. Colours: `BLUE TEAL GREEN GOLD RED WHITE GREY_B`. Any engine object (`graph({ … })`, a kit part) can also stand in `stage` directly.

## Shapes from maths
A shape that is not in the kit is its formula. Never type a list of points or push them in a loop.
- `curve((t) => [x, y], { from?, to?, samples? })`: the points of a curve. `t` makes one full turn in RADIANS (0 to 2π) by default, which closes the outline; an open stretch names its ends. `polar((a) => radius)`: the same from a radius at every angle.
- `outset(outline, d)`: the same outline `d` further out. A casing is a ring: `extrude(outset(wall, 0.12), { depth, holes: [wall] })`.
- `moved(outline, { at: [x, y], turn: degrees })`: an outline where a pose puts it. A pose is what a `follows` joint answers, so write the pose ONCE as a function and use it for the joint and for the maths.
- `areaOf(outline)`, `areaBetween(curveA, curveB)` (two stretches between the same two points), `lengthOf(points)`: real numbers for a chart.
- Points go wherever points are taken: `extrude(curve(…))`, and in `custom`: `polygon(curve(…))`, `polyline(curve(…))`.

## Four scripts
```js
export default explain({
  title: 'How binary search works',
  stage: { row: cells([3, 8, 12, 17, 21, 34, 42, 55], { pointers: ['lo', 'mid', 'hi'], index: true }) },
  story: function* ({ row }) {
    const target = 34; let lo = 0, hi = row.length - 1
    yield { say: `We want ${target}. The [row](row) is sorted.`, row: { lo, hi } }
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      yield { say: `Look at the [middle](row.mid): ${row.value(mid)}.`, row: { mid } }
      if (row.value(mid) === target) { yield { say: 'Found it.', row: { found: mid } }; return }
      if (row.value(mid) < target) lo = mid + 1; else hi = mid - 1
      yield { say: 'Half of the row can no longer hold it.', row: { lo, hi, mid: null, lit: [lo, hi] } }
    }
  },
})
```
```js
export default explain({
  title: 'How a job queue survives a failing worker',
  stage: {
    system: flow('producer -> queue[8] -> worker*3 -> database; worker -fail-> retry -> queue; retry -3x-> dead letters', { jobs: { count: 30, every: 0.9, service: [2, 2.6], seed: 7 } }),
    depth: chart({ x: 'time', y: 'jobs waiting', follow: 'system.queue' }),
  },
  story: [
    { say: 'Jobs go from the [producer](system.producer) through a [queue](system.queue) to a [worker](system.worker1).', system: { until: 8 } },
    { say: 'A [worker](system.worker2) crashes. Its job waits at [retry](system.retry), then joins the queue again.', system: { crash: 'worker2', until: 22 } },
    { say: 'Nothing is lost: every job is [done](system.done), waiting or [dead](system.dead).', system: { until: 'end', show: 'conservation' } },
  ],
})
```
```js
export default explain({
  title: 'Turning becomes sliding',
  controls: { crank: { from: 0, to: 360, unit: '°', cyclic: true } },
  stage: {
    engine: machine({
      parts: { crank: kit.crankshaft({ throw: 0.86, overhung: true }), rod: kit.conRod({ length: 2.78 }), piston: kit.piston({ bore: 1.72 }), liner: kit.liner({ bore: 1.72, cut: 'half' }) },
      joints: [crankSlider({ crank: 'crank', rod: 'rod', slider: 'piston', angle: 'crank' }), ['liner', 'around', 'piston']],
    }),
    height: chart({ x: 'crank', y: 'piston height', curve: ({ engine }) => engine.probe('piston.y') }),
  },
  story: [
    { say: 'A [rod](engine.rod) ties the [crank](engine.crank) to a [piston](engine.piston) that can only slide.', set: { crank: 60 } },
    { say: 'Half a turn is one full stroke.', set: { crank: 180 }, engine: { camera: 'front' } },
    { say: 'The second half pushes it back.', set: { crank: 360 } },
  ],
})
```
```js
import { explain, machine, chart, extrude, curve, polar, outset, moved, areaBetween, GOLD } from 'mimir'
const R = 1.05, E = 0.15, THIRD = (2 * Math.PI) / 3, rad = (deg) => (deg * Math.PI) / 180
const wall = (t) => [E * Math.cos(3 * t) + R * Math.cos(t), E * Math.sin(3 * t) + R * Math.sin(t)]   // the chamber: an epitrochoid
const flank = (a) => 0.61 * (R / 2 / Math.cos((a % THIRD) - THIRD / 2)) + 0.39 * R                    // a rounded triangle, tips at R
const pose = (c) => ({ at: [E * Math.cos(rad(c.shaft)), E * Math.sin(rad(c.shaft)), 0], turn: c.shaft / 3 })
const chamber = (shaft) => areaBetween(curve(wall, { from: rad(shaft) / 3, to: rad(shaft) / 3 + THIRD, samples: 48 }), moved(polar(flank, { from: 0, to: THIRD, samples: 48 }), pose({ shaft })))
export default explain({
  title: 'An engine with no pistons',
  controls: { shaft: { from: 0, to: 1080, unit: '°', cyclic: true } },
  stage: {
    engine: machine({
      parts: {
        housing: extrude(outset(curve(wall), 0.12), { depth: 0.4, holes: [curve(wall)] }),
        rotor: extrude(polar(flank), { depth: 0.36, holes: [curve((t) => [0.3 * Math.cos(t), 0.3 * Math.sin(t)])] }),
        lobe: extrude(curve((t) => [0.29 * Math.cos(t), 0.29 * Math.sin(t)]), { depth: 0.36, color: GOLD }),
      },
      joints: [['rotor', 'follows', pose], ['lobe', 'follows', (c) => ({ at: pose(c).at, turn: c.shaft })], ['housing', 'around', 'rotor']],
      camera: 'front',
    }),
    volume: chart({ x: 'shaft', y: 'chamber volume', curve: (x) => chamber(x) }),
  },
  story: [
    { say: 'A three-cornered [rotor](engine.rotor) rides on an eccentric [lobe](engine.lobe) inside a [housing](engine.housing).', set: { shaft: 90 } },
    { say: 'The shaft turns three times for one turn of the rotor, and all three tips stay on the wall.', set: { shaft: 360 } },
    { say: 'Each face traps a pocket that [grows and shrinks](volume): intake, compression, power, exhaust.', set: { shaft: 1080 }, engine: { camera: 'iso' } },
  ],
})
```
Mistakes never throw: an unknown key, block, state or link target is one diagnostic with did-you-mean, and the rest renders.
