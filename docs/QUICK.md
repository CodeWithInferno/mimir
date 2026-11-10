# Quick scenes — `explain()`: write it once, it just renders

The bar this layer is held to is a diagram language: you write a short script and it just renders. An explainer is
more than a diagram (it moves, it is narrated, it can be a machine), but making one must stay that quick, for small
ideas and for complex ones, and must not cost a model a loop of checking and fixing.

So this layer has ONE job: a SHORT declarative script, written ONCE, becomes a correct, good-looking, animated,
narrated explanation, with no coordinates, no sizes, no timings, and no check-and-fix loop.

## Guarantees (these are the product; test each)
1. **Zero layout.** The author never writes a position, a size, a duration or a camera. The stage arranges blocks,
   fits content, reserves the caption strip, places labels, paces steps from the narration.
2. **Valid by construction.** Any script that parses renders with `mimir check` clean on the first try: nothing
   off-frame, no overlapping text, no dead step. Bad input (unknown block, unknown key, unknown link target) never
   throws: it renders what it can and reports one precise diagnostic with did-you-mean.
3. **Short.** A small concept is 15–40 lines; a complex system or mechanism 40–90.
4. **Instant.** Building a quick scene takes milliseconds; `mimir check` + one sheet in about a second.
5. **Nothing faked.** Blocks are driven by real things: an algorithm that actually runs, a seeded simulation,
   real kinematics, a real function.
6. **Still the same engine.** `explain()` returns a normal scene: the player, export, mp4, read mode all work, and
   an author can drop to the full API inside `custom()`.

## Shape
```js
import { explain, cells, flow, chart, machine, sequence, formula, layers } from 'mimir'

export default explain({
  title: 'How binary search works',
  stage: { row: cells([3, 8, 12, 17, 21, 34, 42, 55], { pointers: ['lo', 'mid', 'hi'], index: true }) },
  story: function* ({ row }) {                      // a real run; every yield is one step
    const target = 34; let lo = 0, hi = row.length - 1
    yield { say: `We want ${target}. The [row](row) is sorted.`, row: { lo, hi } }
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      yield { say: `Look at the [middle](row.mid): ${row.value(mid)}.`, row: { mid } }
      if (row.value(mid) === target) { yield { say: 'Found it.', row: { found: mid, lit: mid } }; return }
      if (row.value(mid) < target) lo = mid + 1; else hi = mid - 1
      yield { say: 'Half of the row can no longer hold it.', row: { lo, hi, mid: null, lit: [lo, hi] } }
    }
  },
})
```
(`examples/quick-binary-search.scene.js`, 18 lines; `quick-handshake` 17, `quick-bubble-sort` 16. None holds a
position, a size or a duration, and `mimir check` is clean on all three: tests/unit/quick/core-browser.test.ts.)
```js
export default explain({
  title: 'How a job queue survives a failing worker',
  stage: {
    system: flow('producer -> queue[8] -> worker*3 -> database; worker -fail-> retry -> queue; retry -3x-> dead letters',
                 { jobs: { count: 40, every: 0.5, service: [1.2, 1.9], seed: 7 } }),
    depth: chart({ y: 'queue depth', x: 'time', follow: 'system.queue' }),
  },
  story: [
    { say: 'One job travels the line: [producer](system.producer), [queue](system.queue), a [worker](system.worker1), the [database](system.database).', system: { until: 6 } },
    { say: 'Send jobs faster than one worker can finish them and a line forms.', system: { until: 14 } },
    { say: 'A [worker](system.worker3) crashes. Its job goes back and another worker finishes it.', system: { crash: 'worker3', until: 30 } },
    { say: 'A poison job fails everywhere. Each retry waits twice as long, then it is set aside.', system: { poison: 1, until: 44 } },
    { say: 'Nothing is lost: [in](system.in) = [done](system.done) + queued + in flight + [dead](system.dead).', system: { until: 'end', show: 'conservation' } },
  ],
})
```
```js
export default explain({
  title: 'Turning becomes sliding',
  controls: { crank: { from: 0, to: 360, unit: '°', cyclic: true } },
  stage: {
    engine: machine({
      parts: { crank: kit.crankshaft({ throw: 43 }), rod: kit.conRod({ length: 139 }), piston: kit.piston({ bore: 86 }), liner: kit.liner({ bore: 86, cut: 'half' }) },
      joints: [crankSlider({ crank: 'crank', rod: 'rod', slider: 'piston', angle: 'crank' }), ['liner', 'around', 'piston']],
    }),
    height: chart({ x: 'crank', y: 'piston height', curve: ({ engine }) => engine.probe('piston.travel') }),
  },
  story: [
    { say: 'A [rod](engine.rod) ties the [crank](engine.crank) to a [piston](engine.piston) that can only slide.', set: { crank: 60 } },
    { say: 'After a quarter turn the piston is already past the middle.', set: { crank: 90 }, height: { mark: 90 } },
    { say: 'Half a turn is one full stroke.', set: { crank: 180 } },
  ],
})
```

## Contract (frozen — E1 owns it; block authors code against it)
```ts
export interface BlockDef<State = Record<string, unknown>> {
  kind: string                                   // 'cells' | 'flow' | 'chart' | 'machine' | ...
  is3d?: boolean                                 // gets the 3D panel
  prefer?: { aspect?: number; weight?: number }  // hints for the stage (aspect = width / height)
  /** Create the block's objects inside `rect` (2D frame units) or as the 3D panel. No absolute placement outside it. */
  build(ctx: BlockCtx): BlockHandle<State>
}
export interface BlockCtx {
  s: Scene; id: string; rect: Area               // the rectangle the stage gives this block
  control(name: string): Param<number> | undefined
  block(id: string): BlockHandle | undefined     // other blocks (for links such as chart.follow)
  report(what: string, fix?: string): void       // a diagnostic; never throw
}
export interface BlockHandle<State = Record<string, unknown>> {
  root: Placed<unknown>                          // faded in when the block is introduced
  initial: State
  /** Link targets for narration and `focus`: '' is the block itself, 'mid' -> 'row.mid'. */
  target(path: string): Placed<unknown> | undefined
  targets(): string[]                            // for did-you-mean
  /** Record, inside step `st`, the transition from `prev` to `prev + change`. Unspecified keys keep their value. */
  apply(st: Step, change: Partial<State>, prev: State): State
  /** What an author can read while writing the story (row.value(i), engine.probe(name), row.length ...). */
  api: Record<string, unknown>
  /** One line of plain text describing the block in `state` (for `mimir review`). */
  describe(state: State): string
}
defineBlock(def)   // registry; unknown kinds are a diagnostic with did-you-mean
```
`explain(spec)`: validates the spec, lays out `stage` blocks (one: centred; a 3D block + 2D blocks: panel left,
others stacked right; several 2D: rows / columns by `prefer`), reserves the caption strip and an optional title,
introduces blocks with a default enter when first mentioned, compiles each step (`say` with `[words](block.path)`
links -> narration + focus + pointer; `set` -> controls sweep; `<block>: change` -> `handle.apply`; `chapter`,
`note`; step length from the narration), and returns a normal scene. A generator story is run once at build time.

## Shapes from maths
A shape that is not in the kit is its formula, not a list of points typed by hand or pushed in a loop:
`curve((t) => [x, y])` (one full turn in radians by default), `polar((a) => radius)`, `outset(outline, d)` (a wall is
a curve and its outset: `extrude(outset(wall, 0.12), { depth, holes: [wall] })`), `moved(outline, { at, turn })` (an
outline where a pose puts it: the pose a `follows` joint answers), `areaOf`, `areaBetween`, `lengthOf` (real numbers
for a chart). Pure helpers in `src/lib/curves.ts`; the rotary engine in `docs/topics/quick.md` is 24 lines of them.

## Valid by construction means: take the natural mistake in its stride
Every finding that sends a writer back for a second writing is a cost. A mistake that has one obvious meaning is
given that meaning (and the account says so); only what is truly ambiguous is reported, and what can still be drawn
is reported as a warning. The list of what is absorbed today is in docs/STATUS.md, section M3; a new case goes into
`tests/unit/quick/absorb.test.ts` with the generation that found it.

## Rules for block authors
- Use the engine's existing public kinds and helpers (graph, edge, token, queue, axes, kit, crankSlider, st.say …)
  — do not re-implement drawing. Everything inside your `rect`; fit to it; text sizes from the engine's ladder.
- Every visual transition between states is automatic and smooth (moves, fades, counts), never a pop.
- Every default is a named default in your block's table; every option is optional.
- No topic-specific code: a block is a GENERAL shape of explanation.
- Unit tests under bun (no browser) for the spec parser and state reducer; one browser test that the example
  renders, `check` is clean and frames at three steps differ. LOOK at a sheet of each example.

## What exists today (src/quick; every claim below is covered by tests/unit/quick)

The author's page is `docs/topics/quick.md` (`mimir docs quick`): every option and state key, one line each.

**One name per block.** `import { explain, cells, flow, chart, layers, train, machine, formula, sequence, custom } from 'mimir'`.
`flow` and `sequence` are names the engine already had; each stays ONE function. `sequence({ actors, messages })` (the
diagram module) is adopted as a block when it stands in `stage`. `flow(x)` (the flow module) returns the system block
when `x` is a system (`'a -> b -> c'` or `{ nodes, links }`) and particles when `x` is a path: the flow module has a
`flowSystem.make` hook that src/quick/index.ts sets. Neither is listed in the quick module's `api`.

**Stage.** `layoutStage()` (src/quick/stage.ts, pure): one block gets the content area; a 3D block gets the panel on
the left (58 % of the width) and the 2D blocks are stacked on its right; several 2D blocks are tried as a row, a column
and (from four) a grid of two columns, and the arrangement in which the worst-off block is largest wins. Inside a row or
a column the room is divided by water-filling on `prefer.aspect` and `prefer.weight`: every block is drawn as large as
the others allow, none is given room it cannot use, what is left is shared evenly. Everything is inside the safe margin,
above the caption strip and under the title line. A block that keeps its proportions draws into `fitAspect(rect, aspect)`
(centred), so nothing hangs at the top of a rectangle. The numbers are `STAGE_DEFAULTS`; `explain({ layout })` overrides.

**Story.** A list of steps, or a function (a generator) that is run once while the scene is built: each yielded step
is recorded before the function goes on. Step keys: `say`, `set`, `chapter`, `note`, `focus`, `title`, and
`<block>: change` (or a list of changes, played one after the other). A step without `say` is a short silent beat.
The WHOLE stage comes on in step one, in stage order (a block that waited for its first mention left a hole in the
frame); a 3D block only fades in (a rise would move what its probes read). The narration starts when the arrivals are
on stage; its links are resolved AFTER the step's block changes, so a step can point at what it has just made.

**Absorbed, not reported** (src/quick/narration.ts runs the engine's own narration lint on every sentence while the scene
is built and applies each finding's fix): more than three links in a sentence (the first three stay marks, the rest are
plain words), links too close for the pointer to travel (the later one glows), the same part twice in a row, symbols and
abbreviations (`=`, `%`, `->`, `e.g.` become words), a sentence over 25 words (spoken as two). A step that would change
nothing on stage gets a focus on what the story touched last (no STATIC-STEP). A flow told to crash a node lands the
fault at the first moment in that step at which the node holds a job; a node idle all step long goes down idle and
`describe` says so. A custom block is scaled and centred into its rectangle whatever coordinates it was drawn in. A
chart given a reader without arguments (a machine's probe) against a control plots it by reading it with the control at
each x. A machine comes on stage framed on its whole travel. What was adjusted is listed per step in the account.

**Bad input never throws.** One diagnostic each, with did-you-mean and the valid list: an unknown key of `explain()`
(`API-UNKNOWN`), an unknown block kind, an unknown step key, an unknown state of a block (the rest of the change is
applied), a link to a part a block does not have (it then points at the whole block) or to a block that is not on the
stage (the words are spoken without a mark; both `GUIDE-TARGET`). A block whose `build` throws is left out.

**Blocks.** cells, sequence, formula, custom (src/quick/cells.ts, sequence.ts, formula.ts, block.ts); flow, chart,
layers + train (flow.ts with flowparse.ts and flowsim.ts, chart.ts, layers.ts); machine (machine.ts, joints.ts). Any
other engine object (`graph(…)`, a group, a kit part) in `stage` is a block too: fitted into its rectangle, linkable by
its part ids, with no state of its own. Options and state keys: docs/topics/quick.md.

**Contract additions (all optional; nothing documented above was changed).** `BlockHandle.keys` (the states a step may
set; default: the keys of `initial`; `null` accepts every key: flow, chart and layers validate for themselves),
`BlockHandle.enter(st)` (how the block comes on stage; machine uses it to set its camera), `BlockHandle.extras()`.
`defineBlock({ kind, example?, adopt?, adopts? })`. Helpers in src/quick/block.ts: `didYouMean`, `areaOf`, `inset`,
`fitScale`, `fitAspect`, `textWidth`. `quickBlocks(model?)`: the handles and final states of a compiled scene (tests).

**Describe.** Every explain() scene keeps a plain-text account: per step what is said, what each link points at, what
the layer adjusted, which blocks enter, which controls move, and one line per block from `handle.describe(state)`, with
`*` on the blocks that changed. `mimir check <scene> --describe` prints it; it is `info().quick` on the page's host
object; under bun `describeAccount(quickAccount(model))`.

**Not there yet.** `controls: { hidden }` is recorded only (the player shows every param); `cyclic` is set on the
param's def for blocks that sample it (the engine itself still finds a cyclic param by unit or name). An exploded view
of a machine. A system too large for its rectangle is drawn small (TEXT-TINY guards it; the stage cannot enlarge a frame).
