# The rules of `mimir check`

Every diagnostic has the form of DESIGN §7: the code and severity, the step and time, the part by id, the scene
file and line, one sentence with the measured value and the limit, and one to three literal edits (most likely first,
a relation before a number) plus, where it helps, the command that shows the state. An `error` is a fact that was
measured; a `warn` is a judgement a person may overrule; `info` explains other findings; `unknown` means the rule
could not measure something and says so instead of passing it.

Thresholds and the sampling plan are the named defaults of `src/check/limits.ts`: no rule holds a number of its
own. The whole list, with defaults, is in [Limits](#limits) at the end. A default is changed, the later winning, by

1. the project's configuration: the key `check.<CODE>.<name>` (for example `check.OCCLUDED.occludedVisible`), read
   through the core's config store, `model.config(key, fallback)`, when the core has one;
2. the scene: `s.check({ limits: { name: value }, off: ['CODE'] })`;
3. one object, one rule: `part.allow('CODE')` or `part.allow('CODE', other)`.

Where a rule looks: **step ends** (the picture the author sees), **transitions** (`planTransitions` evenly spaced
moments of every step that moves: 25 / 50 / 75 %), **params** (each slider at its minimum, default and maximum, one
at a time), **phases** (`planPhases` = 8 positions of every cyclic param), and for declared claims also
`timelineSamples` = 48 moments spread over the story. Rules marked *pixels* need the browser; the others are pure
maths and also run under `bun test`.

A param is **cyclic** when the scene says so, `s.param(name, { cyclic: true })` (`cyclic: false` rules it out). When
it says nothing, a param whose declared `unit` is degrees (`°`, `deg`, `degrees`) and whose range is a whole number
of turns is taken to go round. The name of a param never decides anything.

## Recorded while the scene is built (forwarded as they are)

| Code | Severity | What it measures | Threshold | Example message | Exemption |
|---|---|---|---|---|---|
| `API-UNKNOWN` | error | a call, option, enum value, anchor, limit or rule name that does not exist | any | `rect() has no option "widht".` fix: `use "width"` | none |
| `API-TYPE` | error | wrong type or arity for a known option; an async builder; a call after the scene was built | any | `st.label(): the text must be a string, got object.` | none |
| `REF-MISSING` | error | a reference to an object or probe that does not exist | any | `expect.conserved('nope'): there is no probe "nope".` | none |
| `NUM-INVALID` | error | NaN, infinity, a size or scale that is not positive, at any sampled state | any | `width of #n became NaN when q = 10 (its maximum).` | none |
| `RUNTIME-ERROR` | error | an exception while building, evaluating or drawing; the rest still renders | any | `TypeError: … (in step 4 "Exhaust").` | none |
| `ID-DUP` | error | two objects (or params) with one id | any | `two objects are both called "valve" (lines 31 and 35).` | none |
| `PLACE-CONFLICT` | error | two placements on one object, or a placement cycle | any | `#label is placed twice (nextTo, then attach by .attach()).` | none |
| `GUIDE-TARGET` | error / warn | a narration span that names no object; `st.focus` / `st.label` on something not on stage. The guide adds the measured part (a mark that lands on a part that is hidden, outside the frame or covered): `src/guide/check.ts` | any | `st.say(): "[piston](…pistn)" points at "pistn", and no object has that id.` | none |

## Placement

| Code | Severity | What it measures | Threshold | Example message | Exemption |
|---|---|---|---|---|---|
| `PLACE-NONE` | error | top-level objects that were never placed (no `at`, `attach`, `nextTo`, `shift`, layout) and lie on top of each other at the origin. 3D: their solids overlap; 2D: boxes of about the same size overlap by half | ≥ 2 objects of the same sort (solids, shapes, texts) | `2 objects were never placed, so they all sit at the origin on top of each other: #spring, #retainer.` fix: `retainer.attach(spring, { my: 'bottom', to: 'top' })` | one object at the origin; a text on a shape; a small shape inside a large one; a housing |
| `HATCH-USE` | info | share of placed objects that use literal coordinates (`.at(x, y, z)`) or bypass the engine (`raw3d`, `svg`, `draw2d`), said only when one of them is behind a finding about solids | > 30 % (`hatchShare`) and a FLOATING / INTERPENETRATE / COLLIDE-IN-MOTION / COINCIDENT / CONTAINED on one of them | `3 of 3 placed objects use literal coordinates (.at(x, y, z)); 1 of them is behind FLOATING: #cap.` | never an error; silent when nothing was found |

## Solids (3D, world space, pure maths)

A solid is a visible 3D part whose kind has `sdf`, `solid: true`, or mesh options (`positions`, `indices`); a
composite kind that describes itself is one solid. Proxies come from `src/lib/solids`; they are measured where the
part rests (`frame.rest`: an exploded view or an enter shift is not a mistake in the model). A kind with
`solid: true` and no `sdf` is only a box: its overlaps are reported as `unknown`.

| Code | Severity | What it measures | Threshold | Example message | Exemption |
|---|---|---|---|---|---|
| `INTERPENETRATE` | error | two solids that **move against each other** and overlap at the end of a step: overlap depth = deepest surface point of one inside the other | depth > 2 % of the thinner part's smallest extent (`interpenetrateDepth`) | `#slider and #rail overlap by 0.1 units at the end of step 1 (limit 0.008: 2% of the thinner part) and they move against each other: a collision.` | a housing (material `ghost` / `glass`, `shell: true`, or made one by a view mode); a declared fit: `a.attach(b)`, `between(a, b)`, `a.pin(b)`, `a.at(b)`, `a.nextTo(b)`, a mechanism that names both, `expect.inside(a, b)`; `a.allow('INTERPENETRATE', b)`; a part that is still entering |
| `INTERPENETRATE` | warn | two solids that overlap and **never** move against each other (same relative place, same depth in every sample): one body built from primitives, or a misplaced part. One line per cluster | same depth limit | `#body and #cabin overlap by 0.3 units and never move against each other: one body built from 2 parts, or a part in the wrong place.` fix: `group([body, cabin])` | as above, and members of one `group()` |
| `COLLIDE-IN-MOTION` | error | the same overlap found only on the way: at a transition sample or a phase of a cyclic param, while the parts are clear at the end of every step. Reports the first sample and the deepest | same depth limit | `#ram passes through #post (0.25 units deep) 50% of the way through step 2 (t = 3.94 s); they are clear at the end of every step, so the still frames do not show it.` | as INTERPENETRATE |
| `PARAM-BREAKS` | error | the same overlap found only with a slider at its minimum or maximum (the story never goes there) | same depth limit | `the scene is sound where the story has "stroke", but when stroke = 3 (its maximum) #piston cuts 0.3 units into #head (INTERPENETRATE).` | as INTERPENETRATE. Other rules found at a slider extreme keep their own code and say `when p = 10 (its maximum)` |
| `FLOATING` | error | a part (or a group that holds together) connected to nothing at the end of every step it is on stage in, and close: contact graph over solid proxies, declared relations and groups | contact = surfaces within 1 % of the model span (`floatContact`); near miss = gap ≤ 8 % of the model's span when at least two other parts hold together (`floatNear`), or gap ≤ 50 % of the part's own thinnest extent in any scene (`floatClose`); groups under 1 % of the span ignored | `#lamp touches nothing else: the nearest part, #top, is 0.3 units away (along -Y).` fix: `lamp.nextTo(top, 'up', 0)` | `part.allow('FLOATING')`; a housing; a part that moves relative to its neighbour (an orbit, a part in flight) or is attached in some step; scenes where nothing holds together and the gaps are wider than the parts (planets, charges) |
| `FLOATING` | warn | the same, far from the model | the model holds ≥ 3 parts (`floatAssembly`) and at least half of all solids | `#lamp touches nothing else: the nearest part, #top, is 3.5 units away (along -Y), far from the 5 parts that hold together.` | as above |
| `CONTAINED` | error | a solid completely inside another solid that is opaque and whole at the end of **every** step it is on stage in (it can never be seen) | 100 % of its surface inside | `#core is completely inside #housing (100% of its surface), which is solid and opaque in every step: #core can never be seen.` | the container is a housing, transparent or cut open in some step; `expect.inside(a, b)`; `a.allow('CONTAINED', b)`. A relation does **not** exempt it: `a.attach(b)` without anchors is how it usually happens |
| `COINCIDENT` | error | two solids of the same size in the same place: volume overlap as intersection over union | IoU > 0.9 (`coincidentIou`) | `#intake and #exhaust are the same size in the same place (their volumes overlap 100%): only one of them can be seen.` | a housing; `a.allow('COINCIDENT', b)` |
| `CAMERA-CLIP` | error | the camera position inside an opaque solid, at a step end or on the way to it | signed distance < 0 | `the camera is inside #block at the end of step 2: the frame shows the inside of the part, or nothing.` | a housing or a part that is cut; `part.allow('CAMERA-CLIP')` |
| `MECH-OPEN` | error | an invariant that a mechanism declared about itself (`declareInvariant` in `src/check/index.ts`) at every sample, 8 phases and the slider extremes; first and worst | residual > 1 % of the scene's span (`mechOpen`), or the invariant's own tolerance | `the rod end #eye stays on the crank pin #pin does not hold: it is off by 0.6 units when crank = 135.` | none (it is the mechanism's own claim) |
| `MECH-OPEN` | warn | a part placed `between` two points whose distance changes: a rigid rod is being stretched | change > 1 % of the scene's span (`mechOpen`) | `#rod spans two points whose distance goes from 2.8 when crank = 0 (its minimum) to 5.7 at the end of step 1: a rigid rod cannot change length by 2.9.` | `rod.allow('MECH-OPEN')` (a spring, a beam, a string) |

`MECH-OPEN` is shared. The module that builds mechanisms registers the rule for the invariants of its own
mechanisms; this module adds, under the same code, the two rows above (run by the engine through `alsoRun`, not
claimed in the rule registry, because a code has one owner there).

## Declared truth (pure maths)

| Code | Severity | What it measures | Threshold | Example message | Exemption |
|---|---|---|---|---|---|
| `EXPECT-FAILED` | error | `s.expect(name, fn)` and `expect.inside / touching / above / ratio / conserved`, at every sample of the plan and 48 moments of the story; `expect.during(step, …)` limits it to one step. Reports the first failing state, how many fail, and the worst | inside: 0.1 % of the span; touching: the contact tolerance (3D) or 0.02 units (2D); above: 0; ratio and conserved: 1 % relative (`ratioTolerance`, `conservedTolerance`); each takes `{ tolerance }` | `expect.above(valve, piston) is false 50% of the way through step 2 (t = 4.18 s): the lowest point of #valve (y = 1.3) is 0.06 below the top of #piston (y = 1.36). It fails in 27 of the 64 states it was checked in.` | a claim whose objects are never on stage together is `unknown` |

## The picture at the end of each step (pixels)

| Code | Severity | What it measures | Threshold | Example message | Exemption |
|---|---|---|---|---|---|
| `EMPTY-FRAME` | error | share of the frame that anything covers (2D boxes on a grid + id-pass pixels) | < 0.5 % | `0.3% of the frame is covered (nothing visible is inside the frame).` | none |
| `OFF-FRAME` | error | a visible object or text beyond the frame (2D) or the 3D panel; also at slider extremes | text: any pixel; objects: > 10 % of their area | `34% of crankshaft is beyond the bottom edge of the 3D panel (extends 96 px past it).` | 2D objects the 2D camera zoomed away from |
| `TEXT-OVERLAP` | error | two pieces of text (text objects, text inside kinds, labels, the caption) that intersect | > 2 px and > 2 % of the smaller | `text "First label here" and text "Second label here" overlap by 277 x 39 px (85% of the smaller).` | none |
| `OCCLUDED` | error | a 3D part that the step focuses, labels or names in its narration: pixels that show in the id pass ÷ pixels when drawn alone. A housing is seen around what it holds: pixels where a part **inside** the target shows (a solid smaller than it with at least half of its box in the target's box, `occludedInside`) count as seen. Names what is in front and a view that was rendered and measured | < 30 % visible (`occludedVisible`, the one limit this rule and the guide's GUIDE-TARGET are meant to share); parts under 40 px alone are not judged (`occludedMinPixels`) | `none of #ball can be seen at the end of step 1 (0 of 13855 px) while it is labelled there (at least 30%): #wall is in front of it.` fix: `st.camera({ view: 'top' }) shows 100% of it` | housings (material `ghost` / `glass`, `shell: true`, made one by a view mode) do not hide anything and are not judged; `part.allow('OCCLUDED')` |
| `OCCLUDED` | warn | a 3D part that is on stage and inside the panel but shows no pixel at the end of any step | 0 px in every step | `#post0 is on stage but not one pixel of it shows at the end of any step: other parts are always in front of it.` | as above; reported as CONTAINED when that is the cause |
| `LABEL-COVERS` | warn | a text box over a part the step points at, other than the one it names: share of the points of the part that show (3D: picked on a 14 × 14 grid; 2D: its box) | > 25 % (`labelCovers`) | `text "takes one request" hides 48% of #worker, which is focused in this step (at most 25%).` | the part's own label; a text placed on the part or inside it |
| `TEXT-TINY` | error | font size of text objects on screen (size × scale × 2D zoom); height of text boxes drawn by kinds and overlays | < 2 % of the frame height: 14 px at 720p (`textTiny`) | `text "the fine print" is 7.3 px tall (minimum 14 px on a 720 px frame: 2% of its height).` | `text.allow('TEXT-TINY')` |
| `CONTRAST-TEXT` | error | WCAG contrast of a text object against what is behind it: black, the median pixel of the 3D picture under its box (read back from the canvas), filled 2D shapes drawn before it. A text that draws an outline round its glyphs (the `backstroke` option, at least `contrastOutlinePx` wide) is read against that outline: the better of the two ratios counts | < 4.5 : 1, or < 3 : 1 from 24 px (`contrastSmall`, `contrastLarge`, `largeTextPx`; WCAG 2.1 SC 1.4.3) | `text "white on yellow" has a contrast of 1.1:1 against #sign (#ffff00); text this size needs 4.5:1.` (with `backstroke: 0`) fix: `onSign.color(BLACK) gives 19.6:1` | text that is dimmed by `st.focus` or still entering; `text.allow('CONTRAST-TEXT')`. Labels and captions drawn by the guide are not covered (they bring their own plate) |
| `TINY` | warn | an object that is never large enough to make out (largest size over all step ends); a part a step points at that stays small during that whole step (measured at `tinyMoments` moments of it). A **point marker**, a kind that declares `marker: true` (a dot on a curve), is exempt from the second: it is small by nature and the guide's mark is what the viewer finds | never ≥ 6 px at 720p (`tinyPixels`); pointed at and never ≥ 4 % of the frame height (`tinyFocused`) | `#chip is focused in step 1 but never more than 18 px across there (3% of the frame height; what a step is about should reach 4%).` | text (TEXT-TINY); housings; `part.allow('TINY')`; an object that is large in some step |
| `SUBJECT-FIT` | warn | 3D panel only: the box around everything the id pass shows against the panel; the largest single part | fills < 45 % of the panel in width and in height (`subjectFill`); one part > 85 % of its pixels (`subjectMax`) | `everything drawn in the 3D panel fits in 23% of its height (133 x 167 px of 1280 x 720): the camera is about 3.5x too far.` | none; silent when EMPTY-FRAME or CAMERA-CLIP explains it |
| `COLOR-COUNT` | warn | distinct hues among what is visible and not pushed back: stroke, fill and part colours; hues closer than 40° count as one, greys do not count (pure maths) | > 3 (`hueCount`, `hueMerge`, `hueChroma`) | `5 different hues are on screen at once (a viewer tracks about 3): purple (#box5), red (#box1), yellow (#box4), green (#box3), blue (#box2).` | dimmed objects; housings |

## The story (pure maths)

| Code | Severity | What it measures | Threshold | Example message | Exemption |
|---|---|---|---|---|---|
| `STATIC-STEP` | warn | a step whose end state, and every state inside it, is the picture of the step before | no difference | `the picture at the end of step 2 is identical to step 1.` | none |
| `DEAD-PARAM` | error | a slider that changes nothing that can be seen, at any time | no visible difference to a hundredth of a unit | `moving "unused" from 0 to 10 changes nothing that can be seen …` | none |
| `NOT-PURE` | error | a dynamic function or probe that answers differently for the same time and params | any difference | `rotate of #a gave two different values for the same time and params …` | none |
| `TEXT-LONG` | warn | words and characters of labels; characters of one `st.say()` | label > 4 words or 28 characters (`labelWords`, `labelChars`); caption > 180 characters, two lines of 90 (`captionChars`) | `the label on #queue is 9 words long (a label is a name: at most 4 words, 28 characters): "the queue where requests wait for a free worker".` | none |
| `CHAPTER-LONG` | warn | seconds from the first step of a chapter to its last; a narrated story without chapters is held to the same length | > 90 s (`chapterSeconds`) | `chapter 1 "Everything at once" lasts 104 s (2 steps; about 90 s at most).` fix: `start a new chapter before step 2` | none |

## How the output is arranged

- One report per (rule, objects), at the first sample that shows it.
- **Causes before effects.** When the code on the left is reported, the codes on the right about the same objects
  are dropped (`CAUSES` in `src/check/engine.ts`): `PLACE-NONE` → INTERPENETRATE, COLLIDE-IN-MOTION, COINCIDENT,
  CONTAINED, TEXT-OVERLAP, OCCLUDED, FLOATING · `COINCIDENT` → INTERPENETRATE, COLLIDE-IN-MOTION, CONTAINED, OCCLUDED ·
  `CONTAINED` → INTERPENETRATE, COLLIDE-IN-MOTION, OCCLUDED · `MECH-OPEN` → FLOATING, INTERPENETRATE,
  COLLIDE-IN-MOTION · `OFF-FRAME` → OCCLUDED, SUBJECT-FIT · `CAMERA-CLIP` and `EMPTY-FRAME` → what the same step
  reports about framing. Nothing measured is said about an object whose constructor call failed.
- **Many of one kind are one line**: six parts that hover the same way are `… 5 more like it: #float1, #float2, …`
  (FLOATING, TINY, TEXT-TINY, TEXT-LONG, LABEL-COVERS, the "never visible" form of OCCLUDED).
- Errors first, then warnings, info, unknown; inside a severity what explains the most comes first (`ORDER`). The
  CLI prints at most 8; `--all` prints every one.
- At most three edits per diagnostic, plus one `see it: mimir shot …` command.

## The page side of `mimir query`

`runQuery(runtime, request)` in `src/check/query.ts` (exported by the check chunk; `__mimir.query` calls it). Two
ways to ask: `query(what, ids, { tolerance? })` about the state on screen, or one object
`{ what, args, step | t, set, tolerance, samples }` about any moment and slider setting (the page is put back as it
was). An id may name a point: `piston.top`. A bad request is answered with `{ error, fix }`.

| what | answers |
|---|---|
| `distance a b` | signed distance between the two solids (negative = overlap depth), `relation` apart / touching / overlapping, `gap`, `depth`, the axis, the closest points, the distance between centres; boxes when one is not a solid; point to surface for `a.anchor` |
| `contacts id` | what it touches, what it overlaps (with depth), the nearest part it does not touch, `floating` |
| `bounds id` | world box, size, centre, and the rectangle on screen in px |
| `visible id` | on stage, enter progress, opacity; 3D: visible pixels ÷ pixels alone, and what is in front; 2D: inside the frame (pixels are `unknown`) |
| `state` | time, step, params, probes, camera, what is on stage / hidden / focused / labelled, positions |
| `probes` | every probe at `samples` moments of the story, with its range |
| `coverage` | what the last check measured, skipped and could not measure; the claims and exceptions the scene declared |

## Not covered

Rules that were considered and are not implemented: ROT-UNIT,
RNG-UNSEEDED (NOT-PURE covers functions), PERF, SAFE-MARGIN, TEXT-CROWD, CONTRAST-PART, LEADER-CROSS, MATE-GAP
(`expect.touching` covers a declared mate), Z-FIGHT, SCALE-MISMATCH, SIM-UNSTABLE, TOO-FAST, TOO-BUSY, REMNANT,
NO-VISUAL-BEAT. COLLIDE-IN-MOTION re-runs the solid overlap only, not TEXT-OVERLAP or OFF-FRAME: text that crosses
during a transition is ordinary.

## Limits

Every limit of `src/check/limits.ts`: its name (what `s.check({ limits })` takes), the rule it belongs to, its
default and what it means. The configuration key is `check.<rule>.<name>`; `PLAN` is the sampling plan and `ENGINE`
what several rules share. `tests/unit/check/limits.test.ts` fails when a limit is missing from this table or its
default here differs from the code.

| Limit | Rule | Default | Meaning |
|---|---|---|---|
| `emptyFrame` | `EMPTY-FRAME` | 0.005 | EMPTY-FRAME: least share of the frame that something must cover |
| `emptyGrid` | `EMPTY-FRAME` | 96 | EMPTY-FRAME: 2D boxes are counted on a grid with this many columns (the rows follow the shape of the frame) |
| `emptyFar` | `EMPTY-FRAME` | 50 | EMPTY-FRAME: a 3D part this many times farther from the middle of the model than the next one is named as the reason the camera is so far out |
| `offFrame` | `OFF-FRAME` | 0.1 | OFF-FRAME: share of an object's area that may lie beyond the frame |
| `offFrameTextPixels` | `OFF-FRAME` | 1.5 | OFF-FRAME: px a text may reach past the frame (antialiasing and side bearings; more than this is cut-off text) |
| `textOverlapPixels` | `TEXT-OVERLAP` | 2 | TEXT-OVERLAP: two texts overlap when they share more than this many px each way and this share of the smaller |
| `textOverlap` | `TEXT-OVERLAP` | 0.02 | TEXT-OVERLAP: two texts overlap when they share more than this many px each way and this share of the smaller |
| `pileOverlap` | `PLACE-NONE` | 0.5 | PLACE-NONE: unplaced 2D objects pile up when they share this much of the smaller one and are of similar size (the smaller at least pileSimilar of the larger) |
| `pileSimilar` | `PLACE-NONE` | 0.5 | PLACE-NONE: unplaced 2D objects pile up when they share this much of the smaller one and are of similar size (the smaller at least pileSimilar of the larger) |
| `occludedVisible` | `OCCLUDED` | 0.3 | OCCLUDED and GUIDE-TARGET: a part that is focused, labelled or pointed at must show at least this share of its own pixels. ONE number for both rules: the guide judges the moment a mark lands, this module the end of the step. Tuned on the examples: parts that read well inside a cut cylinder or under the load they carry show 36 to 59 %. |
| `occludedDeclared` | `OCCLUDED` | 0.25 | OCCLUDED and GUIDE-TARGET: the smaller share that must still show when every part in front of it was declared with `part.allow('OCCLUDED', other)` (parts of one machine sit in front of each other by design). |
| `occludedMinPixels` | `OCCLUDED` | 40 | OCCLUDED: a part smaller than this many pixels when drawn alone is not judged (TINY speaks about it) |
| `occludedInside` | `OCCLUDED` | 0.5 | OCCLUDED: a part is inside the one that is pointed at (so it does not hide it: a housing is seen around what it holds) when at least this share of its box lies in the other's box |
| `occludedViewGain` | `OCCLUDED` | 0.02 | OCCLUDED: a suggested view must show this much more of the part than the best one before it to replace it |
| `interpenetrateDepth` | `INTERPENETRATE` | 0.02 | INTERPENETRATE: overlap depth, as a share of the smaller part's smallest extent |
| `rigidDepthChange` | `INTERPENETRATE` | 0.1 | INTERPENETRATE: two parts whose overlap depth changes by less than this share while they keep their relative place are one rigid body |
| `floatContact` | `FLOATING` | 0.01 | FLOATING: surfaces closer than this share of the model's span are in contact |
| `floatMinSpan` | `FLOATING` | 0.01 | FLOATING: a detached group smaller than this share of the model's span is ignored |
| `floatNear` | `FLOATING` | 0.08 | FLOATING: beside a model that holds together, a gap up to this share of the model's span is a near miss (error); beyond it a stray (warn) |
| `floatClose` | `FLOATING` | 0.5 | FLOATING: a gap up to this share of the detached part's own thinnest extent is a near miss even when nothing else in the scene holds together |
| `floatAssembly` | `FLOATING` | 3 | FLOATING: a stray far from the model is reported only when the model holds at least this many parts in contact |
| `coincidentIou` | `COINCIDENT` | 0.9 | COINCIDENT: volume overlap (intersection over union) of two parts |
| `mechOpen` | `MECH-OPEN` | 0.01 | MECH-OPEN: residual of a declared invariant, as a share of the scene's span; also how much a rod may change length |
| `solidSamples` | `ENGINE` | 64 | surface samples per solid for the pair queries (src/lib/solids) |
| `labelWords` | `TEXT-LONG` | 4 | TEXT-LONG: a label is a name, not a sentence |
| `labelChars` | `TEXT-LONG` | 28 | TEXT-LONG: a label is a name, not a sentence |
| `captionChars` | `TEXT-LONG` | 180 | TEXT-LONG: one st.say() is at most two subtitle lines of 90 characters |
| `textTiny` | `TEXT-TINY` | 0.02 | TEXT-TINY: font size as a share of the frame height (14 px at 720p) |
| `contrastSmall` | `CONTRAST-TEXT` | 4.5 | CONTRAST-TEXT: WCAG 2.1 SC 1.4.3 contrast ratios, and the font size (px at 720p) from which text counts as large |
| `contrastLarge` | `CONTRAST-TEXT` | 3 | CONTRAST-TEXT: WCAG 2.1 SC 1.4.3 contrast ratios, and the font size (px at 720p) from which text counts as large |
| `largeTextPx` | `CONTRAST-TEXT` | 24 | CONTRAST-TEXT: WCAG 2.1 SC 1.4.3 contrast ratios, and the font size (px at 720p) from which text counts as large |
| `contrastOutlinePx` | `CONTRAST-TEXT` | 1 | CONTRAST-TEXT: an outline round the glyphs (the text backstroke) carries the text when it is at least this wide, px at 720p, on each side of a glyph |
| `tinyPixels` | `TINY` | 6 | TINY: the longer side of a visible object in px at 720p; and a focused object as a share of the frame height (a point marker is exempt from the second: its kind says `marker: true`) |
| `tinyFocused` | `TINY` | 0.04 | TINY: the longer side of a visible object in px at 720p; and a focused object as a share of the frame height (a point marker is exempt from the second: its kind says `marker: true`) |
| `tinyMoments` | `TINY` | 5 | TINY: how many evenly spaced moments of a step (both ends included) a pointed-at part is measured at |
| `subjectFill` | `SUBJECT-FIT` | 0.45 | SUBJECT-FIT: the model must fill this share of the 3D panel in width or in height; one part must not cover more than subjectMax of it |
| `subjectMax` | `SUBJECT-FIT` | 0.85 | SUBJECT-FIT: the model must fill this share of the 3D panel in width or in height; one part must not cover more than subjectMax of it |
| `labelCovers` | `LABEL-COVERS` | 0.25 | LABEL-COVERS: share of another focused part that a text box may hide; a 3D part is probed on a coverGrid × coverGrid grid over its box |
| `coverGrid` | `LABEL-COVERS` | 14 | LABEL-COVERS: share of another focused part that a text box may hide; a 3D part is probed on a coverGrid × coverGrid grid over its box |
| `behindShare` | `CONTRAST-TEXT` | 0.5 | CONTRAST-TEXT: a filled shape (or the 3D panel) is behind a text when it lies under this share of the text's box |
| `chapterSeconds` | `CHAPTER-LONG` | 90 | CHAPTER-LONG: seconds |
| `hueCount` | `COLOR-COUNT` | 3 | COLOR-COUNT: distinct hues on screen at once; hues closer than hueMerge degrees count as one; below hueChroma a colour is a grey |
| `hueMerge` | `COLOR-COUNT` | 40 | COLOR-COUNT: distinct hues on screen at once; hues closer than hueMerge degrees count as one; below hueChroma a colour is a grey |
| `hueChroma` | `COLOR-COUNT` | 0.2 | COLOR-COUNT: distinct hues on screen at once; hues closer than hueMerge degrees count as one; below hueChroma a colour is a grey |
| `hatchShare` | `HATCH-USE` | 0.3 | HATCH-USE: share of the placed objects that are positioned with absolute coordinates |
| `ratioTolerance` | `EXPECT-FAILED` | 0.01 | expect.ratio / expect.conserved: relative tolerance |
| `conservedTolerance` | `EXPECT-FAILED` | 0.01 | expect.ratio / expect.conserved: relative tolerance |
| `timelineSamples` | `ENGINE` | 48 | how many times along the story probes are sampled for expect.conserved, expect.ratio and `mimir query probes` |
| `viewTrials` | `OCCLUDED` | 5 | at most this many alternative views are measured to suggest a camera for an occluded part, for this many parts per run |
| `viewTrialParts` | `OCCLUDED` | 3 | at most this many alternative views are measured to suggest a camera for an occluded part, for this many parts per run |
| `deadParamDigits` | `DEAD-PARAM` | 2 | DEAD-PARAM: a change smaller than 10^-digits of a unit is not a visible change |
| `deadParamProbe` | `DEAD-PARAM` | 0.637 | DEAD-PARAM: besides the minimum and the maximum a slider is tried at this share of its range (off centre on purpose: a symmetric picture looks the same at the middle) |
| `sameBox` | `COINCIDENT` | 0.2 | COINCIDENT: two parts whose boxes differ by less than this share of the part's span, corner by corner, are candidates (their volumes are then compared) |
| `pileVolume` | `PLACE-NONE` | 0.25 | PLACE-NONE: unplaced solids pile up when their boxes share more than this much of the smaller one's volume |
| `planTransitions` | `PLAN` | 3 | the sampling plan: evenly spaced moments inside every step that moves (3 = 25 / 50 / 75 %) |
| `planPhases` | `PLAN` | 8 | the sampling plan: positions of every cyclic param (one turn is divided in this many) |
