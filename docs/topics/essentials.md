# Mimir essentials

What nearly every scene needs, on one page. The rest is served on demand, never all at once:
`mimir docs module:<name>` lists a module one line per name (core r2d r3d anim guide check kit plot diagram flow
sim tex), `mimir docs <symbol>` gives one name with its description and a real use (`mimir docs Step.say`,
`mimir docs kit.gear`), `mimir examples` lists whole scenes, `docs/CONFIG.md` every default.

## The loop

```
mimir check scene.js          diagnostics: CODE, line, the measured value, literal fixes. Repeat until 0 errors.
mimir shot scene.js --sheet   one picture of every step. Look at it: check cannot see ugly.
mimir open scene.js           the live viewer (it plays)     mimir export scene.js -o out.html [--mp4 out.mp4]
```

## A scene

A scene is one JS module. The builder runs once and records; nothing in it runs per frame except the functions you
pass as values.

```js
import { scene, rect, text, arrow, row, write, create, fadeIn, lagged, mix, BLUE, TEAL, GREEN, RED, GREY_B } from 'mimir'

export default scene({ title: 'A queue fills up' }, (s) => {
  // a param is a slider in the viewer and a value the story can move; call it to read it
  const load = s.param('load', { value: 10, min: 0, max: 100, unit: '%', label: 'Load' })

  // objects: made once, placed by relation. A value may be a function of params: it is re-evaluated every frame
  const title = text('A queue fills up', { size: 'section' }).at(0, 3)
  const source = rect({ id: 'source', width: 2.4, height: 1.4, radius: 0.15, color: BLUE }).fill(BLUE, 0.15)
  const queue = rect({ id: 'queue', width: 2.4, height: 1.4, radius: 0.15, color: () => mix(GREEN, RED, load() / 100) })
    .fill(() => mix(GREEN, RED, load() / 100), 0.2)
  row([source, queue], { gap: 2.2 }).at(0, 0.2)
  const names = [text('Source', { size: 'label' }).at(source), text('Queue', { size: 'label' }).at(queue)]
  const link = arrow(source, queue).color(TEAL)
  const level = text(() => `${Math.round(load())}% full`, { size: 'note', color: GREY_B }).nextTo(queue, 'down', 0.4)

  // one idea per step. st.say is the caption; [words](id) sends the guide's pointer to that object as they are spoken
  s.step('Two parts', (st) => {
    st.say('A [source](source) sends work to a [queue](queue).')
    st.play(write(title), lagged([create(source), create(queue)], { lag: 0.3 })) // together
    st.play(lagged(names.map((n) => fadeIn(n)), { lag: 0.2 }))                    // then this
  })
  s.step('It fills', (st) => {
    st.say('When work arrives faster than it leaves, the [queue](queue) fills.')
    st.play(create(link), fadeIn(level))
    st.set(load, 90)              // sweeps over the WHOLE step, beside everything else in it
  })
  s.step('And drains', (st) => {
    st.say('Slow the source and it drains again.')
    st.play(load.to(20))          // a play like any other: in sequence, 1 s (or { duration })
    st.wait(1)
  })
})
```

## Stage and units

- The frame is 14.22 × 8 units, origin at the centre, y up. Keep content inside x ±6.6, y ±3.5. Black background.
- Angles are degrees everywhere. Option names are full words (`radius`, `width`, `height`, `depth`).
- Colours: `BLUE TEAL GREEN YELLOW GOLD RED MAROON PURPLE PINK ORANGE GREY WHITE BLACK`, shades `BLUE_A` (light) to
  `BLUE_E` (dark), or `'#rrggbb'`. `mix(a, b, u)` blends. About three hues on screen at once.
- Text sizes: `'hero' 'title' 'section' 'body' 'label' 'note' 'tiny'` or a number. A text is a label of a few words;
  sentences belong in `st.say`.
- Give every object you will talk about an `id`: narration, diagnostics and `mimir query` use it.

## Objects

2D (frame space): `text(str, { size, color })` · `rect({ width, height, radius })` · `circle({ radius })` ·
`line(a, b)` · `arrow(a, b, { bend, dashed })` (an end given as an object stops at its edge) · `dot(point)` ·
`polyline(points)` · `brace(target, 'down')` · `group([a, b])` · layouts `row(items, { gap })`,
`column(items, { gap })`, `grid(items, { columns, gap })`.

3D (world space, y up; the camera fits the model by itself): `box({ width, height, depth })` · `sphere({ radius })` ·
`cylinder({ radius, height })` · `cone` · `tube({ radius, thickness, height })` · `between(a, b, { radius })` (a rod
that follows both ends) · `group([a, b])`. Look: `color: BLUE` (an accent), `material: 'steel'` (`aluminium iron
brass copper rubber plastic glass`), `shell: true` for a housing that encloses other parts.
`s.viewport('left', 0.6)` puts the 3D panel on one side; `s.area()` is the rectangle left for 2D.

Mechanisms and machine parts (`kit`), plots and number lines (`plot`), node-and-edge diagrams with tokens
(`diagram`), particles (`flow`), ODEs and event simulations (`sim`) and formulas (`tex`) are modules of their own:
read `mimir docs module:<name>` before using one. Never compute a linkage with trigonometry: `kit` has it.

## Placement: relations, not coordinates

Each object gets ONE placement; `.shift(dx, dy)` adjusts it afterwards.

```js
label.nextTo(box, 'right', 0.3)        // beside: 'up' 'down' 'left' 'right' (3D also 'front' 'back')
tag.at(box)                            // on its centre; tag.at(box.top) on an anchor; tag.at(1, 2) absolute (last resort)
lid.attach(body, { my: 'bottom', to: 'top' })   // 3D: my anchor on its anchor, follows it rigidly
wheel.rotate({ about: 'z', deg: angle })        // 3D: deg may be a param or a function
wheel.define('pin', [0, 0.25, -1.6]); pin.attach(wheel, { my: 'bottom', to: 'pin' })   // your own anchor
note.pin(piston, 'top', { offset: [0, 0.4] })   // a 2D text that follows a 3D part
```

Anchors: `center top bottom left right` (3D also `front back`), read as `box.top` or `part.anchor('pin')`;
`part.world('top')` is its position now, for use inside functions: `.at(() => [0, pin.world()[1] + 2, 0])`.
Style setters chain and take values or functions: `.color(c)` `.fill(c, opacity)` `.stroke(c, width)` `.opacity(a)`
`.scale(k)` `.z(i)`.

## Params and state

```js
const angle = s.param('angle', { value: 0, min: 0, max: 360, unit: '°' })   // degrees over whole turns: cyclic
const phase = s.param('phase', { value: 0, min: 0, max: 1, cyclic: true })  // say it when the unit does not
const lit = s.state('lit', false)        // only the story drives it: no control in the viewer
const speed = s.signal(() => angle() * 2)   // a derived value;  s.t() is simulation time in seconds
s.probe('height', () => piston.world()[1])  // a number `mimir check` and `mimir shot` can read
```

A param that nothing visible reads is an error (`DEAD-PARAM`). `s.toggle(name, { value })` and
`s.choice(name, { options, value })` are the other two kinds.

## Steps

```js
s.step('Title', (st) => {
  st.say('The [piston](piston) rises and the [valve](ring:valve) opens.')   // verbs: point (default) ring label glow focus; arrow:a->b
  st.play(fadeIn(a), b.to.shift(1, 0), { duration: 2 })   // everything in one play runs together; plays run in sequence
  st.set(angle, 360)                 // sweep a param over the whole step
  st.camera({ view: 'front' })       // 3D: 'iso' 'front' 'side' 'top', or { fit: [part] }, { azimuth, elevation }
  st.zoom(target)                    // 2D camera: an object, a list, or null for the whole frame
  st.focus(piston, rod)              // dim everything else for this step
  st.label(piston, 'piston')         // a name on a leader line, for this step
  st.wait(1)
})
```

Verbs (each returns an animation for `st.play`): `write(text)` · `create(shape)` · `fadeIn(m, { shift })` ·
`fadeOut(m)` · `grow(m)` · `transform(a, b)` · `indicate(m)` · `flashAround(m)` · `moveAlong(m, path)` ·
`m.to.<any setter>` (`box.to.shift(2, 0).color(RED)`) · `param.to(value)`. Combine with `lagged([…], { lag })`,
`seq(a, b)`, `all(a, b)`. An object first shown by a verb is hidden until then; one created inside a step appears at
that moment. Focus, labels and guide marks clear when their step ends.

A long explanation is chapters of 2 to 6 steps: `s.chapter('Title', { keep: [title] })` clears the stage (except
`keep`) and resets the cameras before the steps that follow.

## Settings

Every default (durations, text sizes, the 3D look, guide timing, check limits) is a named setting:
`scene({ title, defaults: { pace: { play: 1.5 }, 'guide.captions': false } }, s => { … })`, or `mimir.config.json`
(`{ "defaults": { … } }`) for a whole project. Keys: `docs/CONFIG.md`.

## What check will tell you

`API-UNKNOWN` / `API-TYPE` name the nearest correct spelling. `TEXT-OVERLAP`, `OFF-FRAME`, `OCCLUDED`, `FLOATING`,
`INTERPENETRATE` give the measured overlap and the edit that fixes it. `GUIDE-TARGET`: a span names an id that does
not exist or is not on stage yet. A part that is meant to break a rule says so: `part.allow('OCCLUDED')`.
