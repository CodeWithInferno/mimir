# Extending Mimir

How to add kinds, verbs, step actions, overlays, view modes, check rules and whole lazy chunks **without editing a
shared file**. Every code block below that carries a `file=` tag is part of one module, `src/demo/`, plus the scene
that uses it. That module is not in the tree: `tests/e2e/extending.test.ts` cuts it out of this file, puts it into a
scratch copy of the repository, and builds, typechecks, checks, shoots and exports it on every test run. If a recipe
here stops being true, that test fails.

Read `docs/DESIGN.md` first (the contract) and `docs/STATUS.md` (what exists, who owns what).

## 1. The shape of a module

```
src/<module>/index.ts          main chunk     pure side: kinds (schema, bounds, anchors, outline), verbs, step actions,
                                              overlays, looks, hooks, 2D backends. Exports `api` = its public names.
                               or its own     with `export const lazy = true`: an ON-DEMAND module. Its index.ts (and what
                               API chunk      that alone imports) becomes dist/mimir.<module>api.js, loaded before a scene
                                              that uses one of its public names (see "On-demand modules" below).
src/<module>/three.ts          chunk '3d'     three.js backends of its 3D kinds
src/<module>/check.ts          chunk 'check'  its check rules (development only, never exported)
src/<module>/<name>.chunk.ts   chunk <name>   the module's own lazy chunk: dist/mimir.<name>.js
src/<module>/api.d.ts          typed reference fragment for its public names (one-line JSDoc each)
```

`bun scripts/build.ts` finds these files by name (the `CHUNKS` table at the top of the script is the whole rule),
imports each once, generates the barrels in `src/_generated/`, bundles `dist/mimir.js` and one `dist/mimir.<chunk>.js`
per chunk, writes `dist/viewer.html`, `dist/build.json`, `types/mimir.d.ts` (the reference an author reads: ambient
declarations only) and `types/mimir.module.d.ts` (the same names as exports of `'mimir'`, for the type checker), and
prints min + gzip sizes against the budgets of DESIGN D13. `--barrels` stops after the barrels and the types;
`--where` lists the largest source files of every chunk.

**Budget.** Four limits, in KB gzip (`MIMIR_BUDGET_CORE` / `_WITH3D` / `_ALL` / `_DATA` override them): `mimir.js`
alone (120 during the feature wave, DESIGN D13); `mimir.js` + `mimir.3d.js` (320); the code of every chunk a viewer
can load, together (480); and the data chunks together (280). A data chunk is one that is at least 90 % embedded
binary data (font faces as base64): it is not code, is loaded one group of faces at a time, and has its own limit so
type can neither hide in the code budget nor eat it. Everything the `index.ts` of a module that is not on demand
imports lands in the main chunk. **Over a budget the build fails** (and the CLI keeps answering from the last good
`dist/`, marked stale); `--no-strict` or `MIMIR_BUILD_STRICT=0` only reports it. Put weight in a lazy chunk (recipe
2.5), and make a feature module on demand: a scene pays only for what it uses. What a chunk imports is shared or
copied like this:

- from a module file of the main chunk (`'../core/index.ts'`, `'./index.ts'` …): **shared, name by name**. The chunk
  reads the live objects, so registries are the same ones, and the main chunk keeps nothing extra for it.
- from `src/lib/**` (pure, no state): **copied into the chunk**, tree-shaken to the names it imports. A layout engine
  that only your chunk uses costs the main chunk nothing, whoever else imports from the same library file.
- from `three` and from files of the 3D chunk, in a module's own chunk (recipe 2.5): **shared with the 3D chunk**, name
  by name; the 3D chunk is then loaded first.

**On-demand modules.** A feature module (kit, plot, diagram, flow, sim, tex) says `export const lazy = true` in its
`index.ts`. The build then bundles that `index.ts` as `dist/mimir.<module>api.js` instead of into `mimir.js`, and
records the module's public names (and the method names it adds to other objects with `defineSetter` / `defineMethod`
/ `defineSceneMethod` / `defineStepAction`) in `src/_generated/chunks.ts`. Before the viewer imports a scene it reads
the scene's source and the local modules it imports, and loads the API chunk of every module one of whose names
stands there as a word of its own (comments, the text of strings, member names like `info.guide` and names the scene
declares itself with `const` / `let` / `function` do not count). The names then become exports of `'mimir'` (live
bindings) and globals. `info().features` lists what was loaded; an export embeds exactly those chunks and tells the
page which ones (`?features=…`), because it cannot read the source under its no-network policy. A scene whose source
cannot be read (opened from `file://`) starts with none. The names of the modules that are not loaded are stand-ins:
touching one (a call, a member) notes its module and throws, and the viewer loads the module and builds the scene
again, so a name the scan cannot see (`globalThis['ax' + 'es']`) works all the same; a page that was told its
modules and does not hold the one it needs (an export) says which one is missing. The other chunks of an on-demand
module read its files from the API chunk by name; the API chunk is loaded first. Its `check.ts` is a dev chunk of
its own (`dist/mimir.check<module>.js`), loaded with `mimir.check.js` only for a scene that uses the module: `check`
never pulls in a module the scene did not ask for. Nothing changes
under bun: tests import `src/<module>/index.ts` as before. A chunk name that ends in `api` is reserved. Whatever a
scene needs without naming the module must stay in a module that is not on demand (that is why `p.on()` / `p.under()`
live in `src/r3d`).

**Third-party notices.** Every chunk starts with a `/*! … */` line naming what is bundled into it: each npm package
whose code is in the chunk (name, version, licence and the copyright lines of its licence file, read from
`node_modules`), and the opening comment of every source file that embeds binary data or opens with a legal
comment (`/*! … */`). So a file that embeds a font face says, in its first lines, where the data is from and under
which licence, and the build fails when it does not. `mimir export` inlines chunks whole: the notices travel with
every exported file. `dist/build.json` lists them (`notices`).

**Generated files** (`src/_generated/`, `types/mimir.d.ts`, `types/mimir.module.d.ts`, `dist/`) are not in git. The
CLI builds when `dist/` is missing or older than the sources, `bun run typecheck` writes the barrels first, and
`bun test` does so through `tests/setup.ts` when they are missing. `docs/CONFIG.md` is generated too and is in git
(people read it there); a test fails when it differs from what the build would write.

**The player** is only needed with a person watching. A player module that names its file
`src/player/player.chunk.ts` (instead of `index.ts`) is the lazy chunk `player`: the viewer loads it when the page is
not headless, and `check` / `shot` never pay for it.

Rules the build enforces (it fails with the reason; a failed build leaves the last good `dist/` in place):

- Every module file must import cleanly under bun with no DOM: do not touch `document`, `window` or WebGL at import
  time. Using them **inside** functions that run in the browser (backends, overlays) is fine.
- `three` is imported by `three.ts` and by a module's own chunk (which then builds on the 3D chunk), never by an
  `index.ts` and never by a check rule: a rule measures through `RuleCtx`.
- A chunk file is named `<name>.chunk.ts`, the name being lowercase letters and digits (it becomes
  `dist/mimir.<name>.js`); any other `*.chunk.ts` fails the build. So does a kind that names a chunk no file makes.
- **Names are owned.** Every `define*` call claims its name in a ledger (`ownerOf('kind', 'rect')` → `'r2d/kinds.ts'`).
  A second registration of the same kind, backend, setter, method, getter, kind method, verb, step action, scene
  method, kind setter, overlay, rule, placement, interpolation, look, span verb, hook or renderer is refused (the first stays in force) and
  the build fails, naming both files. To replace a seed definition on purpose say `override: true` (section 2.15).
- Two modules may not export the same public `api` name.
- A file imported by two lazy chunks (and by no `index.ts`) would exist twice; the build refuses it (files under
  `src/lib/` are pure and may be copied).
- `api.d.ts` is an ambient fragment: only `declare …`, `interface`, `type` at the top level, no `import` / `export`.
  Shared types (`Dyn`, `Mob`, `MobOf`, `Part`, `PartOf`, `Placed`, `Anim`, `Step`, `Scene`, `Color`, `PointLike` …)
  come from the other fragments; add methods to `Step`, `Scene`, `MobSetters<R>`, `PartSetters<R>` by declaring the
  interface again (declaration merging).

Import from other modules through their `index.ts` (`'../core/index.ts'`, `'../r2d/index.ts'` …), with the `.ts`
extension; the pure libraries directly (`'../lib/path/index.ts'`). Import **names** (`import { a, b } from`), not
namespaces: the build shares exactly the names a chunk imports. Type-only imports from `'../r3d/three.ts'` are fine
anywhere.

```ts file=src/demo/index.ts
// src/demo/index.ts: the pure side of the demo module (main chunk). Nothing here touches the DOM at import time.
import {
  anim, boxOf, closeConfigGroup, defineConfig, defineFinalize, defineInterp, defineKind, defineKindMethod, defineKindSetter, defineLook, defineManifest, defineOverlay, defineStepAction, defineVerb, NOOP_ANIM, PACE, selector, thereAndBack, verbTarget, VIEW,
  type Frame, type Handle, type MNode, type OverlayRect, type Rect, type Vec3,
} from '../core/index.ts'
import { circle, line, text, type Ctx2D } from '../r2d/index.ts'
import { circlePath, polygonPath } from '../lib/path/index.ts'
```

`export const api = { … }` at the end of `index.ts` lists the public names. They become exports of `'mimir'` and
globals (a scene with a missing import still runs).

## 2. Recipes

### 2.1 A 2D kind

`defineKind` returns the public constructor. It validates options against the schema at every call (unknown option
→ `API-UNKNOWN` with a did-you-mean, wrong type → `API-TYPE` with an example, NaN → `NUM-INVALID`, each with the
scene line), never throws, and always returns a node. A 2D kind can carry its SVG backend inline.

```ts file=src/demo/index.ts
// ── 1. a 2D kind: maths + SVG backend together ───────────────────────────────────────────────────────
const starPoints = (n: number, radius: number, inner: number): [number, number][] =>
  Array.from({ length: n * 2 }, (_, i) => { const rad = i % 2 ? radius * inner : radius; const a = (i / (n * 2)) * 2 * Math.PI; return [Math.sin(a) * rad, Math.cos(a) * rad] })
export const star = defineKind({
  name: 'star',
  space: '2d',
  schema: {
    points: { type: 'int', default: 5, example: 'points: 5' },
    radius: { type: 'positive', default: 1 },
    inner: { type: 'unit', default: 0.45 }, // inner radius as a share of the outer one
    color: { type: 'color', default: '#FFFF00' },
    fill: { type: 'color', nullable: true, default: null },
    fillOpacity: { type: 'unit', default: 1 },
    strokeWidth: { type: 'nonneg', default: 2 },
  },
  bounds: (_node, r) => boxOf(r.radius, r.radius, 0), // local box, pure maths
  anchors: (_node, r) => ({ tip: [0, r.radius, 0] }), // extra anchors; the standard ones come from bounds
  // the outline, in local coordinates: arrows stop on it, m.pointAt() walks it, morphs start from it
  outline: (_node, r) => polygonPath(starPoints(r.points, r.radius, r.inner)),
  build: (_node, c: Ctx2D) => c.draw(c.el<SVGPolygonElement>('polygon'), 'stroke'), // 'stroke' = create() can draw it on
  update(el: SVGPolygonElement, r, c: Ctx2D, node) {
    // c.K = SVG units per frame unit; SVG y points down
    c.set(el, { points: starPoints(r.points, r.radius, r.inner).map(([x, y]) => `${(x * c.K).toFixed(2)},${(-y * c.K).toFixed(2)}`).join(' ') })
    c.paint(el, r, node) // stroke / fill / dash from the standard style options
  },
})
```

- `bounds` is the local box around the node's origin, in frame units, y up. Layout (`nextTo`, `row`), anchors and
  check use it, so it must match what is drawn. It must not depend on the node's own world transform.
- `outline` is the one place 2D geometry lives: local coordinates (frame coordinates for `worldGeometry` kinds), in
  the path format of `src/lib/path` (`rectPath`, `circlePath`, `polygonPath`, `parsePath` … build it). Lines and
  arrows that end on the object stop where their ray leaves the outline, `m.pointAt(alpha)` walks it by length,
  `m.start` / `m.end` are its ends when it is open, and `frame.outline(node)` hands it (in frame coordinates) to
  anything that morphs or traces. Without the hook the outline is the rectangle of `bounds`.
- `r` = the options resolved for this frame: functions evaluated, clips applied, points converted into the node's
  own space (a 2D kind that is given a 3D part as a point receives where that part is drawn).
- Schema types: `'number' 'positive' 'nonneg' 'unit' 'int' 'boolean' 'string' 'text' 'color' 'vec2' 'vec3' 'point'
  'node' 'nodes' 'fn' 'material' 'any'`, an array of strings (enum), `{ array: T, min?, max? }`, `{ record: T }`,
  `{ object: Schema }`. Wrap in `{ type, default, example, tokens, nullable, dynamic }` when needed (`nullable`: null
  is a value of the option, for every type: `limit: { type: 'number', nullable: true, default: null }` resolves to
  null, not to 0). `id` and `opacity` exist on every kind. The standard style options of a shape are one schema:
  `import { STYLE } from '../r2d/index.ts'` and spread it (`color fill fillOpacity stroke strokeWidth dashed`). `r w h d` are accepted for `radius width height depth` everywhere; add more with
  `aliases`.
- `positional: ['text']` / `['a', 'b']` names leading positional arguments; `required` lists the mandatory ones.
- `worldGeometry: true` for shapes drawn between points (lines): the node has no transform of its own.
- `container: true` for kinds that only group children; `text: true` for kinds that are one piece of text.
- `Ctx2D`: `K` (SVG units per frame unit = 100; SVG y points down, so negate y), `el(tag, attrs)`, `set(el, attrs)`
  (skips unchanged attributes), `draw(el, role)` (`'stroke'` outlines draw on with `create`, `'fill'` shapes fade in
  late, `'text'` is written), `paint(el, r, node)` (stroke / fill / dash from `color fill fillOpacity stroke
  strokeWidth dashed`), `defs` + `uid(prefix)` (gradients, markers: an id nobody else on the page has), `canvas()` +
  `begin(layer)` (recipe 2.5), `frame`, `runtime`. Return an `SVGElement`, or an object with `g` / `el` holding the
  root element. The holder of every node carries the 2D camera and the node's transform; a backend draws in local
  units and never thinks about zoom.

### 2.2 A composite 2D kind

Build the parts in `init` with `model.child(parent, name, constructor, …args)`. A part is a real node: it is a child
of the composite (so it moves, fades and is focused with it), its id is `<parent id>.<name>` (`gauge.needle`, or
`boiler.needle` for `gauge({ id: 'boiler' })`), and it uses no counter, so the author's first circle is still
`circle1`.

```ts file=src/demo/index.ts
// ── 2. a composite 2D kind: parts are real nodes, named gauge.dial, gauge.needle, gauge.readout ───────
const needleTip = (value: number, radius: number): Vec3 => { const a = (-120 + 240 * value) * (Math.PI / 180); return [Math.sin(a) * radius * 0.8, Math.cos(a) * radius * 0.8, 0] }
export const gauge = defineKind({
  name: 'gauge',
  space: '2d',
  schema: {
    value: { type: 'unit', default: 0.5, example: 'value: () => load() / 100' },
    radius: { type: 'positive', default: 1 },
    unit: { type: 'text', default: '%' },
    color: { type: 'color', default: '#BBBBBB' },
  },
  bounds: (_node, r) => boxOf(r.radius, r.radius, 0),
  outline: (_node, r) => circlePath({ radius: r.radius }),
  anchors: (_node, r) => ({ tip: needleTip(r.value, r.radius) }), // a moving anchor: other objects can follow the needle
  // the unit caption is drawn by this kind's own backend (below), so the text rules are told where it is
  textRects: (_node, r) => [{ text: r.unit, rect: { x: -0.15 * r.radius, y: -0.48 * r.radius, width: 0.3 * r.radius, height: 0.24 * r.radius } }],
  init(node, model) {
    // functions read the PARENT's options in the frame being drawn, so the parts follow tweens and params
    const of = <T,>(name: string) => (): T => model.now().prop<T>(node, name)
    const self = node as Handle
    model.child(node, 'dial', circle, { radius: of<number>('radius'), color: of<string>('color') })
    model.child(node, 'needle', line, self.anchor('center'), self.anchor('tip'), { color: '#FFFF00', strokeWidth: 4 }) // a line between two anchors of the parent follows it
    model.child(node, 'readout', text, () => String(Math.round(of<number>('value')() * 100)), { size: 'note' }).at(0, () => 0.3 * of<number>('radius')())
  },
  build: (_node, c: Ctx2D) => c.el<SVGTextElement>('text', { 'text-anchor': 'middle', fill: '#888888' }),
  update(el: SVGTextElement, r, c: Ctx2D) {
    c.set(el, { y: 0.42 * r.radius * c.K, 'font-size': 0.2 * r.radius * c.K })
    if (el.textContent !== r.unit) el.textContent = r.unit
  },
})
/** g.percent(): a method only gauges have. Typed through MobOf<Gauge> in api.d.ts. */
defineKindMethod('gauge', 'percent', (node: MNode) => () => Math.round(node.model.now().prop<number>(node, 'value') * 100))
/** g.level(0.8) sets the value, and g.to.level(0.8) is the tween to it: a setter only gauges have. Typed through MobOf<Gauge, GaugeTo>. */
defineKindSetter('gauge', 'level', (_node: MNode, v: unknown) => (typeof v === 'number' || typeof v === 'function' ? { value: v } : null))
```

- Give a part an option as a **function of the parent's option** (`of('radius')` above) and it follows tweens and
  params of the parent. A line between two anchors of the parent follows the parent.
- Style setters land where they can: `gauge.color(TEAL)` sets the gauge's own `color` (which its dial reads). On an
  object that has no such option the change goes to the nearest parts that do: `group([a, b]).fill(RED, 0.2)` fills
  `a` and `b`, and `group.to.color(RED)` tweens them. One call lands on one set of objects: what `.stroke(RED, 5)`
  sets (`stroke` and `strokeWidth`) goes together to the objects that have the first of them. When nothing inside
  has it either, that is `API-UNKNOWN`. The same rule applies to `st.clip(node, channel, …)`: a channel nobody has is
  reported and nothing is recorded.
- A composite is one object to the viewer. `z` adds up down the tree (`node.z(2)` raises the label and the badge with
  the box: `frame.z(node)`), opacity and fades multiply, and `st.focus` pushes back what a composite draws itself
  together with its parts.
- `defineKindSetter(kind, name, (node, ...args) => patch)` adds a setter only that kind has, on the object **and** on
  its `to` (a tween): `g.level(0.8)`, `st.play(g.to.level(0.8))`. Type both sides (recipe 2.12).
- `textRects` declares text that the kind draws in its own backend (local boxes, y up). `TEXT-OVERLAP` and every rule
  that asks `c.textBoxes()` then sees it. Text made with a child `text()` needs nothing: it is a text node.
- `defineKindMethod(kind, name, fn)` adds a method only that kind has. Type it with `MobOf<Self>` (recipe 2.12) so
  it survives chaining.
- The screen rectangle of a composite (`screenRect`, the ring in 2.7, labels) is what it draws itself plus its parts.

### 2.3 Clipping what children draw

A kind with a `clip` hook cuts what its **descendants** draw to a local rectangle (itself it draws in full). Plots
inside axes, a window onto a larger picture.

```ts file=src/demo/index.ts
// ── 3. a container that clips its children ────────────────────────────────────────────────────────────
export const porthole = defineKind({
  name: 'porthole',
  space: '2d',
  positional: ['children'],
  schema: { children: { type: 'nodes', default: [] }, width: { type: 'positive', default: 3 }, height: { type: 'positive', default: 2 }, color: { type: 'color', default: '#888888' } },
  bounds: (_node, r) => boxOf(r.width / 2, r.height / 2, 0),
  // what the children draw is cut to this local rectangle (x, y = min corner, y up)
  clip: (_node, r): Rect => ({ x: -r.width / 2, y: -r.height / 2, width: r.width, height: r.height }),
  init(node, model) { for (const c of (node.props.children as MNode[]) ?? []) model.adopt(node, c); delete node.props.children },
  build: (_node, c: Ctx2D) => c.draw(c.el<SVGRectElement>('rect', { fill: 'none', 'stroke-width': 2 }), 'stroke'),
  update(el: SVGRectElement, r, c: Ctx2D) { c.set(el, { x: (-r.width / 2) * c.K, y: (-r.height / 2) * c.K, width: r.width * c.K, height: r.height * c.K, stroke: r.color }) },
})
```

The nearest clipping ancestor wins. Canvas layers (2.5) are clipped too, and `screenRect` of a clipped node is cut
to what shows.

### 2.4 A 3D kind, with instancing and lines

The pure side goes in `index.ts` (so scenes, layout, projection and check work without a GPU):

```ts file=src/demo/index.ts
// ── 4. a 3D kind: the pure side here, the three.js side in ./three.ts ─────────────────────────────────
/** where bead i sits, in the part's local space: the backend, the hull and the anchors all use this one function */
export const beadAt = (i: number, count: number, radius: number, spin = 0): Vec3 => {
  const a = (i / count) * 2 * Math.PI + spin * (Math.PI / 180)
  return [radius * Math.sin(a), 0, radius * Math.cos(a)]
}
export const beads = defineKind({
  name: 'beads',
  space: '3d',
  schema: {
    count: { type: 'int', default: 12 },
    radius: { type: 'positive', default: 1.5 }, // of the ring
    bead: { type: 'positive', default: 0.18 }, // radius of one bead
    spin: { type: 'number', default: 0 }, // degrees
    color: { type: 'color', nullable: true, default: null },
    material: { type: 'material', default: 'plastic' },
  },
  bounds: (_node, r) => boxOf(r.radius + r.bead, r.bead, r.radius + r.bead),
  hull: (_node, r) => Array.from({ length: 16 }, (_, i) => beadAt(i, 16, r.radius + r.bead)), // tighter silhouette than the box
  anchors: (_node, r) => ({ first: beadAt(0, r.count, r.radius, r.spin) }),
})
```

The three.js side goes in `three.ts`:

```ts file=src/demo/three.ts
// src/demo/three.ts: the three.js side (3D chunk). Only this file of the module may import three.
import { Group, SphereGeometry, type InstancedMesh } from 'three'
import type { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { defineKindBackend, type Vec3 } from '../core/index.ts'
import type { Ctx3D } from '../r3d/three.ts'
import { beadAt } from './index.ts'

const circleOf = (radius: number, n = 64): Vec3[] => Array.from({ length: n }, (_, i) => [radius * Math.sin((i / n) * 2 * Math.PI), 0, radius * Math.cos((i / n) * 2 * Math.PI)] as Vec3)

defineKindBackend<{ object: Group; balls: InstancedMesh; wire: Line2 }, Ctx3D>('beads', {
  build(_node, c) {
    const object = new Group()
    const balls = c.instanced(new SphereGeometry(1, 24, 14), 8) // many copies in one draw call, with the node's material; room for 8 to start with, place() makes more
    const wire = c.line(circleOf(1), { width: 0.04, closed: true, material: 'wire' }) // a line of constant width, with a second material
    c.material('wire', { color: '#FFFFFF', emissive: 0.8, roughness: 1 }) // still fades, dims, slices and shows in the id pass
    object.add(balls, wire)
    return { object, balls, wire }
  },
  update(h, r, c) {
    c.place(h.balls, Array.from({ length: r.count }, (_, i) => ({ p: beadAt(i, r.count, r.radius, r.spin), s: r.bead }))) // position (+ optional q, s) of every copy, local space
    c.points(h.wire, circleOf(r.radius), { closed: true })
  },
})
```

- World space is y up. Sizes are full extents, the part is centred on its origin, revolved shapes have their axis
  along y. Position, rotation and scale are applied by the renderer from the core's world transform; a backend only
  shapes geometry (scale a unit geometry for plain sizes: it costs nothing per frame).
- `hull` = local points whose projection approximates the silhouette (default: the 8 box corners). The camera fit,
  `OFF-FRAME` and the id pass use it; give round or thin shapes a tighter one, and never a smaller one than the truth.
- `solid: true` and `sdf(node, r, pLocal)` describe the part as a solid for the rules that measure solids
  (INTERPENETRATE, COLLIDE-IN-MOTION, FLOATING, CONTAINED, COINCIDENT: `src/check/RULES.md`). A kind that says
  `solid: true` and gives no `sdf` (and is no mesh) is reported as "not measured", never passed: every solid kind of
  `src/r3d` has one. `role: 'fluid'` (PART_LOOK) and housings (`shell: true`, ghost / glass) are seen through and
  stood in. A mechanism's placement record names the parts it joins (`parts`), which makes a pin in its bore a
  declared fit, not a collision.
- `Ctx3D`:
  - `mesh(geometry, { edges?, edgeAngle?, flat?, material? })`: a mesh with the node's standard material and edge
    lines. `geometry(mesh, key, make)` rebuilds only when `key` changes.
  - `instanced(geometry, capacity, { flat?, material? })` + `place(mesh, [{ p, q?, s? }, …])`: many copies in one
    draw call. `capacity` is only the room to start with: `place` makes more when it is given more copies (a count
    that follows a param), so every copy is drawn.
  - `line(points, { width?, px?, closed?, material? })` + `points(line, points, { width?, closed? })`: a line of
    constant width, in world units (a wire) or with `px: true` in pixels of a 1280-wide stage (a trail: it scales
    with the stage like everything else).
  - `material(slot, look)`: the look of a named second material (`'wire'` above): a preset name or overrides
    (`color metalness roughness opacity emissive`) on top of the part's own look.
  - `frame`, `runtime`.
- Never create a three.js material yourself. Everything made through `Ctx3D` gets the part's colour and material
  preset, opacity, enter fades, focus dimming, view modes (2.9), picking and the id pass. A material of your own gets
  none of them.
- Return an `Object3D`, or `{ object, … }`.

### 2.5 A module in its own lazy chunk (and a canvas layer)

A kind names the chunk it needs with `chunk` (a name, or a list of names). The runtime loads exactly the chunks named
by the kinds a scene uses (`model.chunksNeeded()`; a 3D kind always needs `'3d'` as well, whatever it names), before
anything is drawn, and `mimir export` inlines exactly those. The file is `src/<module>/<name>.chunk.ts` with a name
of lowercase letters and digits; a kind that names a chunk no file makes fails the build. Code that is not tied to a kind asks with `model.requireChunk('name')` (a step action whose overlay
lives in a chunk).

The pure side stays in `index.ts`, because a scene calls the constructor before any chunk is loaded:

```ts file=src/demo/index.ts
// ── 5. a kind whose drawing side lives in the module's own lazy chunk (./demo.chunk.ts) ──────────────────
/** Filled in by the chunk when it loads. The pure side (bounds) works without it. */
export const slots: { sparkAt?: (i: number, count: number, t: number, radius: number) => [number, number] } = {}
export const sparks = defineKind({
  name: 'sparks',
  space: '2d',
  chunk: 'demo', // the runtime loads dist/mimir.demo.js for scenes that use this kind, and only for those
  worldGeometry: true, // drawn in frame coordinates: the node has no transform of its own
  schema: { at: { type: 'point', example: 'at: box' }, count: { type: 'int', default: 40 }, radius: { type: 'positive', default: 1 }, color: { type: 'color', default: '#FFFF00' } },
  bounds: (_node, r) => ({ min: [r.at[0] - r.radius, r.at[1] - r.radius, 0], max: [r.at[0] + r.radius, r.at[1] + r.radius, 0] }),
})
```

Everything else goes into `<name>.chunk.ts`:

```ts file=src/demo/demo.chunk.ts
// src/demo/demo.chunk.ts: the module's own lazy chunk (dist/mimir.demo.js). Loaded only for scenes that use a kind
// with `chunk: 'demo'`. Heavy code goes here instead of the main chunk: big backends, layout engines, parsers.
import { defineKindBackend } from '../core/index.ts'
import type { Canvas2D, Ctx2D } from '../r2d/index.ts'
import { slots } from './index.ts'

// a pure function the main-chunk side can call once the chunk is there (import the slot, never this file)
slots.sparkAt = (i, count, t, radius) => {
  const a = i * 2.399963 + t * 0.5 // a sunflower spiral that turns; time is an input, never a clock
  const d = radius * Math.sqrt((i + 0.5) / count) * (1 + 0.06 * Math.sin(t * 1.3 + i))
  return [Math.cos(a) * d, Math.sin(a) * d]
}

defineKindBackend<Canvas2D, Ctx2D>('sparks', {
  build: (_node, c) => c.canvas(), // a canvas layer in this node's place in the z order
  update(layer, r, c) {
    const g = c.begin(layer) // cleared; 1 unit = 1 frame unit, y up; camera, the parent's clip and the node's opacity applied
    g.fillStyle = r.color
    for (let i = 0; i < r.count; i++) {
      const [dx, dy] = slots.sparkAt!(i, r.count, c.frame.t, r.radius)
      g.beginPath()
      g.arc(r.at[0] + dx, r.at[1] + dy, 0.035, 0, 2 * Math.PI)
      g.fill()
    }
  },
})
```

- A chunk file registers through the same registries (`defineKindBackend`, `defineOverlay`, `defineRule` are all
  fine there). To hand **functions** to the main-chunk side, fill a slot that `index.ts` exports, as `slots.sparkAt`
  above; the pure side must work (bounds, anchors) before the slot is filled. Never import the chunk file from
  `index.ts`: that would pull it into the main chunk.
- `c.canvas()` gives a real canvas at device resolution in the node's place in the z order (the SVG is split
  around it); a canvas kind draws nothing else. `c.begin(layer)` gives its 2D context for this frame: cleared, in
  frame units with y up (flip with `g.scale(1, -1)` before drawing text), with the 2D camera, the node's own `shift`
  and `offset` (so `m.to.shift`, an enter shift and an explode move the marks like any other object), and the clip
  of a clipping ancestor applied, and `globalAlpha` set to the node's opacity × enter progress (so a fade is per mark).
  Draw every mark of the frame: nothing survives from the frame before. A canvas kind is `worldGeometry: true` and
  must give `bounds`, because only the kind knows where its marks are.
- Test a chunk under bun by importing the file itself (`import '../../src/demo/demo.chunk.ts'`).

**A 3D module's own chunk.** Everything in a `three.ts` goes into the one 3D chunk, which every 3D scene loads. A
module with heavy 3D backends (a parts kit) puts them in its own chunk instead: the kind names it, the file may
import `three`, and the build shares three.js with the 3D chunk instead of copying it (name by name; the 3D chunk is
loaded first). The module's code is then paid for only by scenes that use it.

```ts file=src/demo/index.ts
// ── 5b. a 3D kind whose backend lives in the module's own chunk (./demoparts.chunk.ts), not in the 3D chunk ──
export const orbit = defineKind({
  name: 'orbit',
  space: '3d',
  chunk: 'demoparts', // the 3D chunk is needed as well, and is loaded first: a 3D kind always has '3d'
  schema: { radius: { type: 'positive', default: 2 }, tube: { type: 'positive', default: 0.03 }, color: { type: 'color', nullable: true, default: null }, material: { type: 'material', default: 'glow' } },
  bounds: (_node, r) => boxOf(r.radius + r.tube, r.tube, r.radius + r.tube),
})
```

```ts file=src/demo/demoparts.chunk.ts
// src/demo/demoparts.chunk.ts: a lazy chunk that builds on the 3D chunk. It may import three: the build shares the
// names with mimir.3d.js instead of bundling a second three.js, so this file costs what is written in it.
import { TorusGeometry, type Mesh } from 'three'
import { defineKindBackend } from '../core/index.ts'
import type { Ctx3D } from '../r3d/three.ts'

defineKindBackend<Mesh, Ctx3D>('orbit', {
  build: (_node, c) => c.mesh(new TorusGeometry(1, 0.02, 8, 96), { edges: false }),
  update(mesh, r, c) {
    c.geometry(mesh, `${r.radius}:${r.tube}`, () => new TorusGeometry(r.radius, r.tube, 8, 96).rotateX(Math.PI / 2)) // lying flat: axis along y
  },
})
```

- What such a chunk takes from `three` is published by the 3D chunk: a three.js class that nothing else uses is added
  to `mimir.3d.js` (and counts against its budget); your own code stays in your chunk.
- A value import from `'../r3d/three.ts'` (or any file of the 3D chunk) is shared the same way.

### 2.6 A verb

```ts file=src/demo/index.ts
// ── 6. a verb ────────────────────────────────────────────────────────────────────────────────────────
export const pulse = defineVerb('pulse', (target: unknown, opts: { scale?: number } = {}) => {
  const node = verbTarget(target, 'pulse()') // reports REF-MISSING / API-TYPE itself
  if (!node) return NOOP_ANIM('pulse', PACE.enter)
  return anim('pulse', PACE.enter, (rec, at, duration) => {
    // a clip = one channel of one target over [at, at + duration]; thereAndBack ends where it began
    // the default is a setting (2.16), read from the scene being built: a scene or a project can change it
    rec.clip(node, 'enterScale', opts.scale ?? rec.model.config<number>('demo.pulse.scale'), { at, duration, rate: thereAndBack })
  })
})
```

- `anim(verb, defaultDuration, record)`; `record(rec, at, duration, rate)` appends clips with
  `rec.clip(target, channel, to, { at, duration, rate?, from?, scope? })`. `at` is seconds from the start of the step.
- A clip tweens from the folded value to `to`: a value, or a function `(node, frame) => value` (one selector clip can
  move every node differently: `selector(test)` as the target, `to: (node, frame) => …`). `from` starts it somewhere
  else (enter effects). A rate that ends at 0 (`thereAndBack`, `wiggle`) is a pulse: the value returns by itself.
- Channels every node has: `present` (0..1, with `revealMode` `'fade' | 'create' | 'write'`), `opacity`, `dim`,
  `scale`, `enterScale` (multiplies scale), `shift`, `offset` (both add to the position), `rotate`, `placement`, `z`;
  plus every option of its kind and every look channel (2.9). Numbers, vectors and colours blend; anything else
  switches at 50%. `defineInterp(kind | '*', channel, fn)` overrides the blend for one kind or for all.
- An enter verb is a clip of `present` to 1: the node is then hidden before that moment (DESIGN §3.2).
- A play lasts 1 s unless it says otherwise (`PACE.play`; DESIGN §3.3). `PACE` reads the config store: inside a
  scene it is that scene's pacing (2.16).
- Setters: `defineSetter(space, name, (node, ...args) => patch)` installs `m.name()` **and** `m.to.name()` from one
  function that returns `{ channel: value }`, for every object of that space; `defineKindSetter(kind, name, fn)` does
  the same for one kind. `defineMethod` / `defineGetter` / `defineKindMethod(kind, …)` add plain members.
- Durations are seconds and at most 300 for one play, wait or camera move; a longer one is `NUM-INVALID`.

### 2.7 A step action and the overlay that draws it

An overlay works in two steps, so that nothing on screen can depend on the frame that was shown before:
`layout(frame, laid)` decides where things go and returns the rectangles they cover; `paint(frame)` draws what
layout decided. Every layout runs before any paint.

```ts file=src/demo/index.ts
// ── 7. a step action + the overlay that draws it ─────────────────────────────────────────────────────
interface RingData { node: MNode }
defineStepAction('ring', (st, part: unknown) => {
  const node = st.node(part, 'st.ring()') // a node or its id; reports and returns null otherwise
  if (node) st.action<RingData>('ring', { node }) // step-scoped by default: gone when the step ends
})
const NS = 'http://www.w3.org/2000/svg'
defineOverlay({
  name: 'demo.ring',
  z: 5,
  create(c) {
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%')
    c.root.appendChild(svg)
    const circles: SVGCircleElement[] = []
    let plan: { x: number; y: number; radius: number; env: number }[] = []
    return {
      // step 1: where the rings go in THIS frame, and the rectangles they cover
      layout(frame) {
        plan = []
        const rects: OverlayRect[] = []
        for (const a of frame.actions<RingData>('ring')) { // what is in force now, with its fade envelope
          const box = c.screenRect(a.data.node) // stage px; null when hidden
          if (!box) continue
          const radius = Math.hypot(box.width, box.height) / 2 + c.px(0.1)
          const x = box.x + box.width / 2, y = box.y + box.height / 2
          plan.push({ x, y, radius, env: a.env })
          rects.push({ id: `ring:${a.data.node.id}`, kind: 'mark', ids: [a.data.node.id], rect: { x: x - radius, y: y - radius, width: 2 * radius, height: 2 * radius } })
        }
        return rects
      },
      // step 2: draw exactly what layout decided
      paint() {
        plan.forEach((p, i) => {
          const el = (circles[i] ??= svg.appendChild(document.createElementNS(NS, 'circle')))
          const length = 2 * Math.PI * p.radius
          el.style.display = ''
          el.setAttribute('cx', p.x.toFixed(2))
          el.setAttribute('cy', p.y.toFixed(2))
          el.setAttribute('r', p.radius.toFixed(2))
          el.setAttribute('fill', 'none')
          el.setAttribute('stroke', '#FFFF00')
          el.setAttribute('stroke-width', c.px(0.03).toFixed(2))
          el.setAttribute('stroke-dasharray', `${(length * p.env).toFixed(2)} ${length.toFixed(2)}`) // a pure function of time
        })
        for (let i = plan.length; i < circles.length; i++) circles[i]!.style.display = 'none'
      },
      dispose() { svg.remove() },
    }
  },
})
```

- `st.action(type, data, { at?, duration?, scope? })` records something overlays and backends read every frame.
  Default scope `'step'`: it fades in, lives for the step and clears over the first 0.4 s of the next one. That is
  what prevents remnants. Use `scope: 'persist'` to keep it. Outside a step (a finalize hook) the same record is made
  with `model.addAction(type, data, { step, at?, duration?, scope? })`.
- A step function that has returned is closed: `st.…` calls that arrive later (after an `await`) record nothing and
  are reported. The scene builder and its steps are synchronous.
- Recorder members: `st.cursor`, `st.now`, `st.advance(s)`, `st.need(s)` (the step lasts at least this long),
  `st.node(v, call)`, `st.model`, `st.narration(text, { plain, spans, at, duration })` (the transcript: `st.say` calls
  it). `defineSceneMethod(name, (s, ...args) => …)` adds `s.name()`.
- An overlay gets `root` (an absolutely positioned element over the stage, `pointer-events: none`), `stage()`,
  `px(units)`, `snap(px)`, `toStage([x, y])`, `project(target)`, `screenRect(node)` and `visiblePoint(node)` (a pixel
  of a 3D part that is really visible, from the id pass; it costs a render and a read-back per frame, so use it for
  the few things that must not point at a covered spot).
- **Three rules keep an overlay a function of the frame alone** (each was a real defect: the same time gave different
  pixels after a different history).
  1. Place HTML elements with `left` / `top` on whole device pixels: `el.style.left = c.snap(x) + 'px'`. No
     `transform` with fractions, no `will-change`: the browser composites such an element from the raster of where
     it was in the frame before. SVG and canvas content needs no snapping.
  2. DOM order is paint order. Elements made lazily (one per label, when it first shows) must be inserted in an
     order that comes from the story (the action's `seq`), never appended in the order they happened to be made.
  3. Keep nothing from an earlier frame: no "last position" to ease from, no measurement cached by time.
  The headless runtime also repaints every DOM layer from nothing for each frame (shots and `check` are evidence), so
  a missed invalidation of the browser cannot leak one frame into the next.
- The rectangles `layout` returns (`{ id, kind: 'label' | 'text' | 'mark', rect, ids?, text?, src?, fix? }`, stage
  px) are what `TEXT-OVERLAP` checks (`label` and `text` kinds) and what later overlays may read. `fix` is printed
  when the rectangle collides.

### 2.8 An overlay that depends on other overlays' rectangles

Name the overlays you read in `after`: you are then laid out after them whatever your `z` (paint order). `laid.rects()`
gives every rectangle produced so far **in this frame**; `laid.rects('guide.caption')` one overlay's. Reading an
overlay that is not laid out before you is an error with the fix in its text.

```ts file=src/demo/index.ts
// ── 8. an overlay that depends on other overlays' rectangles ─────────────────────────────────────────
interface BadgeData { text: string }
defineStepAction('badge', (st, label: unknown) => { st.action<BadgeData>('badge', { text: String(label) }) })
defineOverlay({
  name: 'demo.badge',
  z: 1, // painted UNDER the rings, the labels and the caption …
  after: ['guide.caption', 'guide.labels', 'demo.ring'], // … but laid out after them, because it reads their rectangles
  create(c) {
    const el = document.createElement('div')
    el.style.cssText = 'position:absolute;left:0;top:0;font:600 13px ui-sans-serif,system-ui,sans-serif;color:#000;background:#5CD0B3;border-radius:4px;white-space:nowrap;display:none'
    c.root.appendChild(el)
    let plan: { x: number; y: number; env: number } | null = null
    const hits = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    return {
      layout(frame, laid) {
        const cur = frame.actions<BadgeData>('badge').at(-1)
        if (!cur) { plan = null; return [] }
        const fs = c.px(0.2)
        el.style.display = ''
        el.style.fontSize = `${fs.toFixed(2)}px`
        el.style.padding = `${(fs * 0.25).toFixed(2)}px ${(fs * 0.6).toFixed(2)}px`
        if (el.textContent !== cur.data.text) el.textContent = cur.data.text
        const width = el.offsetWidth, height = el.offsetHeight
        // sit on top of the caption, left edges aligned; then move up past any label or mark laid out in this frame
        const caption = laid.rects('guide.caption')[0]?.rect
        const rect = caption ? { x: caption.x, y: caption.y - height - c.px(0.08), width, height } : { x: c.px(0.5), y: c.stage().height - c.px(0.5) - height, width, height }
        const taken = laid.rects().map((r) => r.rect).sort((a, b) => b.y - a.y)
        for (const t of taken) if (t !== caption && hits(rect, t)) rect.y = t.y - height - c.px(0.08)
        // HTML goes on whole device pixels (c.snap): at a fractional position the browser would composite it from an earlier frame's raster
        rect.x = c.snap(rect.x)
        rect.y = c.snap(rect.y)
        plan = { x: rect.x, y: rect.y, env: cur.env }
        return [{ id: 'badge', kind: 'text', rect, text: cur.data.text, src: cur.action.src, fix: ['shorten the badge text', 'or show fewer marks in this step'] }]
      },
      paint() {
        if (!plan) { el.style.display = 'none'; return }
        el.style.left = plan.x + 'px'
        el.style.top = plan.y + 'px'
        el.style.opacity = plan.env.toFixed(3)
      },
      dispose() { el.remove() },
    }
  },
})
```

### 2.9 A view mode

A view mode is a **look**: a pure function that edits what the 3D renderer applies to each part
(`{ color, opacity, metalness, roughness, emissive, dim, shell, clip, edges }`). Its channel is scene-level (clips on
`VIEW`, base value `model.view[channel]`, read with `frame.viewValue(channel)`), and any single part can decide for
itself with a clip on a channel of the same name (`st.clip(part, 'slice', …)`, or a `selector`).

```ts file=src/demo/index.ts
// ── 9. a view mode: st.slice({ axis, at }) cuts every 3D part with one plane ──────────────────────────
interface Slice { axis: 'x' | 'y' | 'z'; at: number }
const AXIS: Record<string, Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }
// the look: a pure edit of what the renderer applies to each part. Everything beyond `at` along the axis is cut away.
defineLook('slice', (look, v: Slice) => { const n = AXIS[v.axis] ?? AXIS.z!; look.clip.push({ normal: [-n[0], -n[1], -n[2]], constant: v.at }) })
// a scene-level channel blends like any other: here the cut plane slides between two positions
defineInterp('*', 'slice', (a: Slice | null, b: Slice | null, u: number) => (a && b && a.axis === b.axis ? { axis: b.axis, at: a.at + (b.at - a.at) * u } : u >= 0.5 ? b : a))
defineStepAction('slice', (st, opts: unknown) => {
  const o = opts as Partial<Slice> | false | null
  const value: Slice | null = o ? { axis: o.axis === 'x' || o.axis === 'y' ? o.axis : 'z', at: typeof o.at === 'number' ? o.at : 0 } : null
  st.clip(VIEW, 'slice', value, { duration: PACE.enter }) // VIEW = the clip target of scene-level view channels
})
```

- The look runs whenever the value for a part is not null / undefined / false / `rest`. Give an amount a rest value
  (`defineLook('ghost', fn, { rest: 0 })`) so that tweens start from it.
- **Who decides** (`frame.lookValue(part, channel)`): a part that has the channel set (as an option, or by a clip that
  has started) decides for itself **and for everything inside it**, whatever the value, the rest value included.
  Until then it has what its parent has, and a root has the scene-level value. So `st.ghost(piston)` on a composite
  reaches the parts that draw, a group passes a view mode to its children, and `st.clip(piston, 'ghost', 0)` under a
  scene-wide ghost takes the piston out of it (the tween starts from what the piston had inherited).
- A clip on `VIEW` with a name that is not a view channel is `API-UNKNOWN` (with the list); a view channel on a 2D
  object is reported too: looks are for 3D parts.
- `look.clip` takes world-space planes: everything with `dot(normal, p) + constant < 0` is cut away, edge lines,
  second materials, lines and the id pass included. `look.shell = true` makes a part a housing: not picked, not
  counted as hiding others.
- `frame.look(node)` is the result, without a GPU: rules and tests read it.

A look cannot move a part. To push an assembly apart, record one selector clip on `offset` whose target is a function
of the part: anchors, labels and everything attached then follow. The function reads where the part is **at rest**
with `frame.rest(node)` (its world transform with every `offset` taken as zero): `frame.world(node)` would ask for
the very offset being computed, which is a cycle (`PLACE-CONFLICT`).

```ts file=src/demo/index.ts
// ── 9b. explode: one selector clip on `offset`, each part pushed away from the origin by a share of its distance ──
defineStepAction('spread', (st, amount: unknown) => {
  const k = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0
  // every 3D root gets its own target, read from where it rests (frame.rest), so the cue can be played at any time
  st.clip(selector((n) => n.space === '3d' && !n.parent), 'offset', (node: MNode, frame: Frame): Vec3 => { const p = frame.rest(node).p; return [p[0] * k, p[1] * k, p[2] * k] }, { duration: PACE.enter })
})
```

### 2.10 Finalize and manifest hooks

```ts file=src/demo/index.ts
// ── 10. finalize and manifest hooks ──────────────────────────────────────────────────────────────────
// runs once after the scene builder, before lifetimes are fixed: a module can still record clips here
defineFinalize('demo.twinkle', (model) => {
  for (const node of model.nodes) {
    if (node.kind !== 'star' || model.clipsFor(node, 'enterScale')) continue
    // a star the story never animates twinkles once when the story starts
    model.addClip({ target: node, prop: 'enterScale', to: 1.25, t0: 0.2, t1: 1.0, rate: thereAndBack, scope: 'persist', step: 0, src: node.src, seq: 0 })
  }
})
// adds a field to __mimir.info() (the player and the CLI read it)
defineManifest('demo', (model) => ({ gauges: model.nodes.filter((n) => n.kind === 'gauge').map((n) => n.id), rings: model.actions.filter((a) => a.type === 'ring').length }))

export const api = { star, gauge, porthole, beads, sparks, orbit, pulse }
```

- `defineFinalize(name, fn(model))` runs once after the scene builder, before lifetimes, clip order and the duration
  are fixed. It can read everything recorded (`model.nodes`, `model.steps`, `model.actions`, `model.clipsFor`) and
  still add clips (`model.addClip`) and actions (`model.addAction(type, data, { step, at?, duration?, scope? })`: the
  record `st.action` makes). It cannot evaluate frames yet.
- `defineManifest(key, fn(model, runtime))` adds `info()[key]`. The value must be JSON: one that is not (a node, a
  cycle) is reported with the key and left out.
- Narration: `st.narration(text, { plain, spans })` records plain strings whatever it is given. When the scene is
  built every span is checked: a target that is not the id of an object is `GUIDE-TARGET`, a verb nobody declared
  with `defineSpanVerb(name)` is `API-UNKNOWN` (the guide declares point, ring, label, arrow, glow, focus).
- `info()` already carries the read-mode data: `chapters` (`{ index, title, t0, t1, steps, keep }`), `steps[].chapter`
  and `transcript` (one entry per step: `{ step, title, chapter, chapterTitle, t0, t1, narration: [{ text, plain, t0,
  duration, spans: [{ start, end, words, verb, targets, options }] }], note }`), and `chunks`.

### 2.11 Check rules

```ts file=src/demo/check.ts
// src/demo/check.ts: check rules (lazy check chunk). A rule never imports three: it measures through RuleCtx.
import { defineRule } from '../core/index.ts'

defineRule({
  code: 'DEMO-TINY',
  severity: 'warn',
  phase: 'sample', // once per sample of the plan
  on: ['step-end'],
  run(c) {
    if (!c.stage) return // no browser: nothing was measured, so report nothing
    for (const n of c.visible('2d')) {
      if (n.parent) continue // parts of a composite are judged with their parent
      const r = c.screenRect(n)
      if (!r) continue
      const size = Math.max(r.width, r.height)
      if (size >= 12) continue
      c.report({ ids: [n.id], line: n.src.line, measured: Math.round(size), limit: 12, what: `${n.id} is ${Math.round(size)} px across (minimum 12 px).`, fix: [`${n.id}.scale(${Math.ceil(12 / Math.max(size, 1))})`] })
    }
  },
})

defineRule({
  code: 'DEMO-COVERED',
  severity: 'warn',
  phase: 'sample',
  on: ['step-end'],
  run(c) {
    const pass = c.idPass({ solo: true }) // rendered once per sample, shared with every other rule that asks
    if (!pass) return // no 3D in this scene, or no browser
    for (const part of Object.values(pass.parts)) {
      if (!part.total || part.pixels / part.total >= 0.25) continue
      const node = c.model.byId.get(part.id)
      c.report({ ids: [part.id], line: node?.src.line ?? null, measured: Math.round((100 * part.pixels) / part.total), limit: 25, what: `only ${Math.round((100 * part.pixels) / part.total)}% of ${part.id} can be seen (${part.pixels} of ${part.total} px).`, fix: [`st.camera({ fit: [${part.id}] })`, 'or make what covers it a ghost'] })
    }
  },
})
```

- `phase: 'sample'` runs once per sample of the plan (`on`: `'step-end' | 'transition' | 'param' | 'phase'`),
  `'story'` once with `c.samples` and `c.stateAt(τ, params)`, `'static'` once at the end.
- Report with the measured value, the limit and 1–3 literal fixes. The engine fills in step, time and file, and
  keeps one report per (rule, objects). At a sample with a param pinned away from the story's value (`c.sample.kind`
  `'param'` or `'phase'`, `c.sample.params`) it also adds "when p = 10 (its maximum)" to the sentence, a `params` field
  to the JSON and the command that shows that state; give a fix about the param there, not a literal move of the
  object (it would break the default picture).
- `RuleCtx`: `model`, `runtime`, `sample`, `frame`, `samples`, `stateAt`, `visible(space?)`, `stage`,
  `screenRect(node)`, `overlayRects()`, `textBoxes()` (every piece of text on screen: text nodes, `textRects` of
  kinds, overlays), `idPass({ solo? })`, `report(…)`.
- `idPass()` is rendered once per sample and shared by every rule. Per part: `pixels` (visible), `total` (drawn alone;
  with `{ solo: true }`, and always for housings), `rect`, and `at` (a visible pixel near the middle of what shows).
- A story rule gets `frame = null`. To measure at another time, `c.runtime.seek(τ)` then `c.runtime.render(true)`;
  the engine restores the time afterwards.
- Without a browser `runtime` and `stage` are null: report nothing you did not measure.

### 2.12 The typed reference

```ts file=src/demo/api.d.ts
/** A star with `points` tips; inner = inner radius as a share of the outer one. Extra anchor: 'tip'. */
declare function star(opts?: { id?: string; points?: number; radius?: Dyn<number>; inner?: Dyn<number>; color?: Dyn<Color>; fill?: Dyn<Color | null>; fillOpacity?: Dyn<number>; strokeWidth?: Dyn<number>; opacity?: Dyn<number> }): Mob
/** What g.to gives: the standard tweens plus the gauge's own setter. */
interface GaugeTo extends MobSetters<GaugeTo>, Anim {
  /** Tween the value: st.play(g.to.level(0.8)). */
  level(value: Dyn<number>): GaugeTo
}
/** A gauge keeps its own members through chained setters because it extends MobOf<Gauge, GaugeTo>, not Mob. */
interface Gauge extends MobOf<Gauge, GaugeTo> {
  /** The value as a whole percentage, live: g.percent()() → 85. */
  percent(): () => number
  /** Set the value (0..1); g.to.level(v) tweens to it. */
  level(value: Dyn<number>): Gauge
}
/** A dial with a needle; value 0..1. Parts: <id>.dial, <id>.needle, <id>.readout. Extra anchor: 'tip' (the needle's end). */
declare function gauge(opts?: { id?: string; value?: Dyn<number>; radius?: Dyn<number>; unit?: Dyn<string>; color?: Dyn<Color>; opacity?: Dyn<number> }): Gauge
/** A frame that clips the objects inside it to its rectangle. */
declare function porthole(children: Mob[], opts?: { id?: string; width?: Dyn<number>; height?: Dyn<number>; color?: Dyn<Color>; opacity?: Dyn<number> }): Mob
/** A ring of beads on a wire, lying flat (axis along y). Extra anchor: 'first'. */
declare function beads(opts?: { id?: string; count?: number; radius?: Dyn<number>; bead?: Dyn<number>; spin?: Dyn<number>; color?: Dyn<Color>; material?: MaterialName; opacity?: Dyn<number> }): Part
/** Small particles swirling around a point (drawn on a canvas layer). */
declare function sparks(opts: { id?: string; at: PointLike; count?: number; radius?: Dyn<number>; color?: Dyn<Color>; opacity?: Dyn<number> }): Mob
/** A thin glowing ring lying flat (axis along y). */
declare function orbit(opts?: { id?: string; radius?: Dyn<number>; tube?: Dyn<number>; color?: Dyn<Color>; material?: MaterialName; opacity?: Dyn<number> }): Part
/** Swell and settle back (1 s). */
declare function pulse(m: Placed<unknown>, opts?: { scale?: number }): Anim
interface Step {
  /** Draw a ring around a part for this step. */
  ring(part: Placed<unknown> | string): Step
  /** Show a small badge on top of the caption for this step; it moves out of the way of labels and rings. */
  badge(text: string): Step
  /** Cut every 3D part with a plane: what lies beyond `at` along the axis disappears. false removes the cut. */
  slice(opts: { axis?: 'x' | 'y' | 'z'; at?: number } | false): Step
  /** Push every 3D part away from the origin by this share of its distance (0 puts them back). */
  spread(amount: number): Step
}
```

A kind with methods of its own returns an interface that extends `MobOf<Self>` (or `PartOf<Self>`), not `Mob`: every
chained setter then returns `Self`, so `gauge(…).at(…).color(…).percent()` typechecks. A kind with setters of its own
(`defineKindSetter`) also names the type of its `to`: `MobOf<Self, SelfTo>` with `interface SelfTo extends
MobSetters<SelfTo>, Anim { … }`, so `g.to.level(0.3).color(RED)` typechecks. `mimir docs <name>` reads these
declarations; so do agents.

### 2.13 The scene that exercises all of it, with a 2D object pinned to a 3D anchor

```js file=demo.scene.js
import { scene, star, gauge, porthole, beads, sparks, orbit, pulse, text, arrow, box, create, fadeIn, BLUE, TEAL, RED, GREY_B } from 'mimir'
export default scene({ title: 'Extension demo' }, (s) => {
  s.viewport('right', 0.5)
  const load = s.param('load', { value: 20, min: 0, max: 100, unit: '%' })
  const title = text('Extension demo', { size: 'label', color: GREY_B }).at(-3.5, 3.4).hud() // stays put when the 2D camera moves

  s.chapter('New kinds')
  const a = star({ id: 'star', points: 5, radius: 0.7, fill: '#FFFF00', fillOpacity: 0.2 }).at(-5.4, 1.2)
  const g = gauge({ id: 'gauge', value: () => load() / 100, radius: 0.9 }).at(-3.2, 1.2).color(TEAL) // still a Gauge after .at().color()
  const link = arrow(a, g) // stops on the star's outline and on the gauge's circle
  const speck = star({ id: 'speck', radius: 0.04 }).at(-6.4, -2.6)
  const window = porthole([star({ id: 'peek', radius: 0.9, color: RED }).at(0.9, 0.2), sparks({ id: 'dust', at: [-4.3, -1.3], count: 60, radius: 1.4 })], { id: 'window', width: 2.4, height: 1.6 }).at(-4.3, -1.3)
  const ring = beads({ id: 'ring', count: 14, radius: 1.6, spin: () => load() * 3.6, color: BLUE })
  const core = box({ id: 'core', width: 1.2, height: 1.2, depth: 1.2, color: TEAL }).attach(ring, { to: 'center' })
  const halo = orbit({ id: 'halo', radius: 2.1 }).at(0, 0.9, 0) // its backend comes from the module's own 3D chunk
  const tag = text('core', { size: 'note' }).pin(core, 'top', { offset: [0, 0.35] }) // a 2D label on a 3D anchor
  const pointer = arrow(g, ring) // a 2D arrow that ends where the 3D part is drawn
  s.probe('percent', g.percent())

  s.step('Kinds', (st) => {
    st.say('A [star](star), a [gauge](ring:gauge) built from parts, and a ring of beads.')
    st.note('The gauge is a **composite**: `gauge.dial`, `gauge.needle` and `gauge.readout` are real objects.')
    st.play(create(a), create(g), fadeIn(link))
    st.badge('new kinds')
  })
  s.step('Marks and a cut', (st) => {
    st.say('A ring mark, a pulse, and a slice through the 3D part.')
    st.play(pulse(a, { scale: 1.4 }))
    st.ring(g)
    st.ring(core)
    st.label(ring, 'beads')
    st.badge('marks')
    st.slice({ axis: 'z', at: 0.2 })
    st.spread(0.6) // the halo moves away from the origin; the ring and the cube rest there and stay
    st.set(load, 85)
  })

  s.chapter('A closer look', { keep: [title, g] })
  s.step('Zoom', (st) => {
    st.say('The 2D camera moves in on the gauge; the title stays where it is.')
    st.zoom(g, { margin: 2.2 })
    st.slice(false)
    st.spread(0)
    st.play(g.to.level(0.3)) // the gauge's own setter, as a tween
  })
})
```

- `m.pin(part, anchor?, { offset? })` puts a 2D object on a 3D anchor: it sits where the anchor is drawn, follows it,
  and is in screen space (the 2D camera does not zoom the 3D panel, nor what is pinned to it).
- Any other reference from 2D to 3D resolves the same way: `m.at(part)`, `m.nextTo(part, 'left')`, `line(m, part)`,
  `arrow(m, part.anchor('top'))`. **Such an object lives on the screen too** (`spaceOf(node) === 'hud'`), like one
  marked `m.hud()` and like one placed relative to a hud object: the 2D camera neither moves nor scales it, and an
  arrow from a zoomed 2D note to a 3D part still joins the two. This is decided once, when the scene is built, from
  what the scene wrote (an object, an anchor); a function that returns a part cannot be seen through. The other
  direction (a 3D part placed relative to a 2D object) is `API-TYPE` with the fix.
- `st.zoom(target | null)` moves the 2D camera. Beside a 3D panel it looks through the part of the frame the panel
  leaves free (`model.area2d()`): the target is fitted into that window, and zoomed 2D content is cut at its edge
  instead of covering the panel. The magnification stays within 0.25 to 8. A target that is on the screen (a 3D
  part, a hud object, something placed on one) is `API-TYPE`: the 2D camera does not move it.
- `s.chapter(title, { keep })` clears the stage and resets both cameras; `st.note(markdown)` adds read-mode text.

### 2.14 Remove or rename a module

Delete (or rename) the directory. That is all: `dist/build.json` records which files `dist/` was built from, so the
next `mimir` command sees that the set changed and rebuilds; the barrels in `src/_generated/`, the chunk files in
`dist/` and the typed reference lose the module. Run `bun scripts/build.ts` yourself before `bun run typecheck` if no
`mimir` command ran in between (the barrels are what the typecheck reads).

If a module breaks the build, every `mimir` command keeps working on the last good `dist/` and prints the build
error as a `WARNING` on stderr until it is fixed.

### 2.15 Replace a seed definition

The guide and the player are meant to be replaced wholesale: replace the directory (`src/guide/`, `src/player/`) and
there is only one registration. To replace a single definition from another module, say so:

```ts
defineKind({ name: 'rect', space: '2d', override: true, schema: { … }, … })   // also: defineOverlay({ …, override: true }), defineRule({ …, override: true })
defineStepAction('label', (st, part, text) => { … }, { override: true })      // every other define* takes { override: true } as its last argument
```

Without `override: true` the build fails with both owners; with it, the ledger records what was replaced
(`registrations()`).

### 2.16 Settings: a default that a scene or a project can change

No number that shapes output is private to a module (docs/OSS-HYGIENE.md, rule 5). Register the module's defaults
once; the comment on each key is its documentation.

```ts file=src/demo/index.ts
// ── 16. settings: the module's defaults, in the config store ─────────────────────────────────────────────
export const DEMO_DEFAULTS = {
  pulse: {
    /** how far pulse() swells its target, as a factor of its size */
    scale: 1.3,
  },
}
defineConfig('demo', DEMO_DEFAULTS, { min: 0 })
closeConfigGroup('demo') // every key of 'demo' is registered here, in the main chunk: an unknown one is wrong at once
```

- `defineConfig(group, table, rules?)`: nested objects are groups (`demo.pulse.scale`), a list is one value, a
  function is not a value. `rules`: `{ min }` for every number of the group, `{ oneOf: { key: [...] } }` for a text
  that takes named values. A key another module registered fails the build like any other name (`override: true`).
- Read it where it is used, never at import time: `model.config('demo.pulse.scale')` (a step has `rec.model`, a
  kind hook `node.model`, a frame `frame.model`). `config(key)` from the core does the same for code that has no
  model at hand; `liveConfig(group, table)` registers a flat table and returns a view whose members read the store
  (that is what `PACE` and `TEXT_SIZES` are). The order is: the scene (`scene({ defaults })`, `s.config()`), the
  project (`mimir.config.json`), the registered default, then the fallback of `model.config(key, fallback)`.
- `model.settings.group('demo')` is the whole group as a nested object with everything applied;
  `model.settings.overrides('demo')` only what was set (a deep partial, or null). Keys that are wrong are left out.
- The build writes `docs/CONFIG.md` from every registration: the key, the default, and the comment on the key in the
  source (a `/** … */` or `//` above the key or before it on its line, or `// …` at the end of the line; a table
  passed by name is found in the same file or the file it is imported from; comments written on the fields of a
  type are used when the values carry none). A key without a comment is listed without a description and the build
  says how many there are.
- Unknown keys and wrong types are diagnostics with the nearest name. A group that is closed is judged where the
  value is set. A group whose keys are registered by a lazy chunk (the 3D look) is judged when that chunk arrives
  (`model.settings.recheck()`, called by the runtime after it loaded the scene's chunks) and by `mimir check`, whose
  dev chunk is told every key of the build. A group nobody registers under but whose keys code reads with a
  fallback cannot be judged by name: register the keys.

## 3. Frame state and projection helpers

`Frame` = the state at one (τ, params, view). It is lazy, memoised and never mutated by rendering; get one from
`model.state(τ, params?)`, `runtime.frame` (what is on screen) or the argument of `layout(frame)` / `paint(frame)`.

There are three coordinate spaces: **3D** world, the **2D** frame that the 2D camera looks at (where 2D objects
live), and the **screen** in frame units (14.222 × 8, what you see). `m.hud()` objects live on the screen, and so
does every 2D object that is placed on a 3D part or on another screen object (decided when the scene is built).
`spaceOf(node)` says which one a node is in.

| member | gives |
|---|---|
| `tau`, `k`, `step`, `u`, `t` | story time, 0-based step index, its record (`step.chapter`, `step.narration`, `step.notes`), seconds into it, simulation time |
| `prop(node, channel)`, `props(node)` | one resolved channel / all resolved options of a node |
| `param(def)`, `probes()` | a param's value (override, else the story's), every probe by name |
| `value(dyn, fallback?)`, `memo(key, fn)`, `run(fn)` | evaluate a value-or-function in this frame; per-frame memo with cycle detection; run code with this frame as "now" |
| `world(node)`, `rest(node)` | world transform `{ p, q, s }` (position, quaternion, uniform scale); the same with every `offset` taken as zero (where a part is when nothing is pushed apart) |
| `anchor(node, name?)`, `anchorOut`, `anchorNames`, `anchorLocal` | position / outward direction / names / local position of anchors (2D objects also have `start` and `end`) |
| `point(ref, owner?)`, `into(owner, from, p)`, `boxIn(owner, target)` | `[x, y(, z)]`, a node, an anchor or a function → a point; with `owner`, in the owner's space (3D → where it is drawn) |
| `localBounds(node)`, `bounds(node)`, `hull(node)` | local box, axis-aligned box in the node's space, silhouette points |
| `outline(node)`, `textRects(node)` | 2D outline as a path (frame coordinates); the text a node draws, as screen rectangles |
| `reveal(node)`, `opacity(node)`, `dim(node)`, `z(node)`, `visible(node)`, `visibleLeaves(space?)` | enter progress `{ p, mode }`, opacity with ancestors, focus dimming, stacking order with ancestors, what is drawn |
| `look(node)`, `lookValue(node, channel)`, `viewValue(channel)` | what the 3D renderer applies to a part (view modes included); the value of one view channel for a part (its own, its ancestors', the scene's); a scene-level view channel |
| `actions(type?)` | active actions `{ action, data, env, age }` (`env` = 0..1 fade envelope) |
| `camera()`, `cameraBasis()`, `aspect()`, `subject(nodes?)` | pose `{ target, azimuth, elevation, distance, fov }` of the 3D panel |
| `camera2d()`, `zoomed()`, `toScreen(p)`, `fromScreen(p)` | the 2D camera `{ center, zoom }` (screen = (p − center) × zoom); whether it shows anything but the whole frame; 2D point ↔ screen position |
| `project3(p)` | 3D world point → `{ x, y, depth, visible }` on screen |
| `project(target, space?)` | node / anchor / coordinates → screen position + `visible`. Coordinates are read in `space`, else in the space a resolved option carries (`r.a` of a line), else `[x, y, z]` is 3D and `[x, y]` 2D |
| `frameRect(node)` | pure-maths rectangle on screen (2D box through the 2D camera, or projected hull) |
| `signature({ excludeActions?, digits? })` | hash of everything visible (hidden and fully transparent objects all count the same); equal = nothing the viewer sees differs. `digits: 2` compares to a hundredth of a unit: "the same to the eye" |
| `paramClause()`, `reproHint()` | "when p = 10 (its maximum)" and the `mimir shot … --set` command for a frame with pinned params ('' and [] otherwise) |

`Runtime` (browser) adds stage pixels: `stage()` → `{ width, height, scale }` (px per frame unit), `px(units)`,
`toStage([x, y])` / `toFrame(x, y)` (2D point ↔ px, through the 2D camera), `screenToStage(q)` / `stageToScreen(x, y)`
/ `rectToStage(rect)` (screen frame units ↔ px), `project(target, space?)` → `{ x, y, visible, depth }` in stage px,
`screenRect(node)` (measured DOM box for 2D, projected silhouette for 3D, with its parts for a composite; null when
hidden), `pick(x, y)`, `idPass({ solo? })`, `visiblePoint(node)`, `overlayRects()`, `chunks`,
`seek / setParam / clearParam / setView / render / settled / on('frame' | 'resize' | 'view' | 'params')`.

Inside scene code the same things are reached through `part.world(name)`, `part.anchor(name)`, `m.top`, params
(`p()`), `s.t()`: they read from the frame being evaluated.

## 4. Conventions

- **Time is an input.** Nothing that affects pixels may read `Date.now`, `performance.now`, `Math.random`, or
  remember earlier frames. Same (τ, params) → same pixels; the e2e tests shoot the same times in different orders
  and compare hashes. In three.js that includes material flags: a change of `transparent` needs `needsUpdate`
  (`Ctx3D` does it for you), or the picture depends on what was drawn before. State that needs memory is recomputed from t = 0 and cached per model
  (`model.store(key, init)`), keyed on inputs. For HTML overlays see the three rules in 2.7. `check` evaluates every
  dynamic option and probe twice at the same time and reports a function that answers differently (`NOT-PURE`).
  Prove it for anything new: shoot a handful of times ascending, descending and shuffled, inside one step as well as
  across steps, and compare the sha256 per time.
- **The scene is recorded in one synchronous pass.** An `async` builder or step function is `API-TYPE`; calls that
  arrive after the scene was built are ignored and reported.
- **API calls never throw on bad input.** Validate with `validateOptions(call, opts, schema, aliases, model)` +
  `reportProblems(model, problems, ids)`, or `model.diagnostics.add({ code, what, fix, ids })`; return the node (or
  `NOOP_ANIM()`), keep going. Exceptions inside registered functions are caught and become `RUNTIME-ERROR`; one
  thrown while an object is being drawn is reported at the scene line that created the object.
- **Messages**: `what` = one sentence with the measured value; `fix` = literal edits, most likely first. The scene
  line is captured for you (the first stack frame outside the engine).
- **Degrees** everywhere. Full words for options. One way to do each thing; accept common slips silently through
  `aliases`, never document them.
- **Ids are readable** (`rect1`, the `id` option, `parent.part`) and appear in diagnostics, labels and debug views.
- 2D sizes are frame units (14.222 × 8); stroke width 1 = 0.01 units; text size is manim's `font_size`
  (48 = body; `emOf(size)` gives the em in frame units; `measure(text, weight, font)` gives real widths in a browser
  and an estimate under bun).
- Colours: palette tokens are plain strings; `mix(a, b, u)` blends in squared RGB.
- Tests: pure sides under `bun test` (build a scene with `compile(scene({ title }, s => { … }))`, then
  `model.state(τ)`); anything visible with a shot you have looked at (`mimir shot --debug ids` draws boxes, ids,
  `textRects` and the visible point of every 3D part). The registries are process-wide: give test-only kinds names
  nothing else uses.

## 5. Pitfalls

- **Nodes are probed by name.** Reading a member that does not exist on a node, on `s` or on `st` while a scene is
  being built is reported as `API-UNKNOWN` (that is how `m.colour()` gets a did-you-mean). Engine code must not
  duck-type nodes with ad-hoc property reads: use `isNode(v)`, `isAnchorRef(v)`, `isAnim(v)`, or names that start
  with `is` + capital / `_`.
- **Setters inside a step are instant changes at the cursor**, not changes of the base value; outside a step they
  set the base. A second placement on the same object is `PLACE-CONFLICT` (the first is kept); `shift` is not a
  placement.
- **`r` already holds resolved values.** Do not read `node.props` in `bounds` / `update` (it may hold functions).
  The exception is asking what the author passed (`isNode(node.props.a)`).
- **Do not cache across frames by time order.** Cache by inputs, on the model (`model.store`) or on your handle
  with a key (`ctx.geometry(mesh, key, make)`, `set()` for SVG attributes).
- **Coordinates returned by a function are taken as they are.** `m.at(part)` and `m.at(part.anchor('top'))` are
  converted between spaces; `m.at(() => part.world('top'))` hands over raw 3D numbers. Pass the object or the anchor.
- **Step-scoped is the default for marks.** If something of yours is still visible in the next step, it was
  recorded as `persist`.
- **The last `rate` value matters.** A clip whose rate ends at 0 leaves no trace; one that ends at 0.7
  (`notQuiteThere`) leaves the value 70% of the way.
- **3D: go through `Ctx3D`.** A backend that creates its own material loses colour / opacity / dim / enter fades,
  view modes, picking and the id pass.
- **Lazy chunks**: a file imported by two chunks (and by no `index.ts`) would exist twice; the build refuses it. Put
  shared helpers under an `index.ts`. A chunk file is imported under bun by the build: no DOM at import time there
  either.
- **Public names and registry names are global.** Pick names that cannot collide with another module's; the build
  fails on a clash and names both owners.
- **Objects made between `s.chapter()` and its first step belong to that chapter**: they appear when it opens, not
  at τ = 0. Objects made inside a step appear at that moment. A chapter clears what is on stage; a container whose
  members have not entered yet (a graph before its `draw()`) is not on stage and is left alone.
- **Text you draw yourself is set in the embedded faces.** Use `FONT_TEXT` / `FONT_MATH` from `'../r2d/index.ts'` (or
  `var(--mimir-font-text)` in CSS) and measure with `lineMetrics(text, faceOf('serif', weight, italic))`: the
  widths come from tables, so bounds are the same before the faces chunk has arrived and without a browser. Ask for
  the faces with `model.requireChunk(FONT_CHUNK)` when a scene could show your text and no `text()`. `FONT_SERIF` of
  the core names fonts a machine may not have: do not use it for anything on the stage.
- **A kind's own setter wins.** `defineKindSetter('axes', 'fit', …)` replaces a general `defineSetter('2d', 'fit', …)`
  for that kind, on the object and on `.to`.
- **An option that names another object ties yours to its space.** Schema types `point` and `node` (a token's `on`)
  are followed when the spaces are settled: a 2D object on something that sits on a 3D part is on the screen too.
- **A rule that needs no pixels says `pure: true`** (`defineRule`): a sample that only such rules read is not
  rendered. Two rules must not report one finding under two codes: name the cause in `CAUSES` of
  `src/check/engine.ts` (OCCLUDED covers the guide's GUIDE-TARGET on the same part).
- **Narration names what is on stage.** A span lands when its word is spoken; an object that enters later in the
  step is `GUIDE-TARGET`. Plays in ONE `st.play(…)` run together: draw the parts in the play that writes the title.
