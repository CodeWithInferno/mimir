# Mimir — design contract (v1)

Status: locked 2026-11-09; brought in line with what was built on 2026-11-10 (the M1 wave and the core / build
follow-ups). This file is the source of truth. If code and this file disagree, fix the code or raise it; do not
silently diverge. Every decision keeps its reason, stated as the evidence it rests on. Current state, measured sizes
and what does not work yet: `docs/STATUS.md`. How to extend it: `docs/EXTENDING.md`. Every default: `docs/CONFIG.md`.

## 0. What it is
Ask "how does X work" → an interactive, animated, narrated **working model** in the browser: 3D mechanisms,
2D system diagrams with moving tokens, plots and math, in 3Blue1Brown's visual grammar, with a guide (a pointer that
flies to each part as it is mentioned). Scenes are small JS files written by an AI agent against this API; the
agent's loop is `mimir check` → `mimir shot` → look → fix → `mimir open`. Output can be exported as ONE
self-contained HTML file, or as a video.

Owner's acceptance criteria (verbatim): "lightweight", "make diagrams", "if i ask how engine works can make a 3d
model of engine", "ai native", "peak ui like really good", "animations and all too", "one shot so u will be
testing it too", "3b1b video style", and, for the open-source release, "you cannot just hardcode things in this"
(the rules that follow from it: `docs/OSS-HYGIENE.md`).

## 1. Decisions (and why)
| # | Decision | Why (the evidence) |
|---|---|---|
| D1 | Scenes are plain **JS ES modules** against a small high-level API. No DSL, no JSON. | Models author code best. In a published slide-generation benchmark, giving the model a small helper library instead of the raw library took programs that execute from 50–71 % to 88–97 %. |
| D2 | **No Rust / WASM.** TypeScript everywhere, bun as toolchain. | The renderer has to run in the browser; every WASM option measured was heavier than its JS counterpart, and nothing in the engine costs more than microseconds in JS. |
| D3 | 3D = **three.js** (the only big dependency), lazy-loaded; 2D scenes never load it. | Measured: three.js with the 3D layer is 174 KB gzip; an own renderer is risk for no user value. |
| D4 | 2D = **SVG** in manim's frame space; labels / captions / UI = HTML; many-particle effects = a canvas sublayer. | Crisp text, free hit-testing, exact boxes for the linter, native draw-on. |
| D5 | **Time is an input.** Every visible property is a pure function of (story time τ, params). The scene script runs ONCE as a recorder; state at any τ is sampled, never replayed. | Scrubbing, `shot --at`, filmstrips, video export and determinism all need it; engines that replay from the start pay for every backward seek. |
| D6 | **The stage is 2D-first**: a 14.222 × 8 frame; the 3D viewport is one rectangular panel of it. Model-beside-plot with one shared cursor is a first-class pattern. | In a set of 17 "how does X work" prompts, 3D was essential in 4 and a model beside a plot in 7. |
| D7 | **Relations, not coordinates**: attach / nextTo / containers / between / built-in mechanisms; the runtime places labels; no trig in scene code; **degrees only**. Absolute `.at()` stays as a visible escape hatch. | Spatial mistakes are the failure that survives better models: published systems that resolve placement by code beat ones where the model writes coordinates. |
| D8 | **`check` carries the weight** (deterministic geometry / layout / story diagnostics with measured values and literal fixes); looking at frames is the second line. | In a published motion benchmark, feeding predicate-level reports back took success from 58.8 % to 93.6 %; vision models are weak judges of geometry. |
| D9 | API calls **never throw on bad input**: record a diagnostic, return an inert placeholder, keep rendering. | One bad line must not blank the scene; a hallucinated name is the commonest first-try failure. |
| D10 | Guide = spans in narration `[spoken words](verb:part)` compiled to a cue list that is a pure function of step time; the pointer is back-timed to land on its word; captions always, voice optional. | Narration is the clock: a step lasts as long as its words. |
| D11 | Packaging = the CLI + one skill. Generation (`mimir new`) goes through an **agent adapter** chosen by flag / env; the engine never calls a model. No server is needed for an agent to see renders. | The whole author → check → shot → look loop ran headless with a coding agent and nothing but the CLI; a PNG read from disk puts the same image in front of the model as an image returned by a tool. |
| D12 | UI and motion come from the design track; every UI animation is a pure function of progress. | Owner: "peak ui", "animations". |
| D13 | Size is judged by what ONE scene loads (gzip), not by the sum of every chunk: base runtime (`mimir.js`) ≤ 120 KB now, target 60; `mimir.js` + the 3D chunk ≤ 320; feature modules (kit, plot, diagram, flow, sim, tex) load on demand by the names a scene uses; font data has its own budget (280 KB; one chunk per face is planned). The all-chunks total is only a sanity cap (900 KB). Every limit is env-overridable (`MIMIR_BUDGET_*`), and over a limit the build fails. The CLI has zero runtime npm dependencies. | "lightweight". |
| D14 | **Presentation is "3b1b video style"**: a scene plays like a 3Blue1Brown video you can touch. Full-bleed black stage, near-invisible chrome, Computer Modern type, labels as plain typeset text on a thin leader line (not pills), a luminous light-on-black 3D look. The viewer **plays when it opens**. | Owner; and an early viewer that did not autoplay read as "a bunch of screenshots, not a video". |
| D15 | Long step-by-step explanations need **chapters** and a **read mode** (§3.4). | Owner ("how an LLM works"). |
| D16 | **Nothing is hardcoded** (docs/OSS-HYGIENE.md): no machine, no external tool assumed, no AI vendor, no topic, no magic number, no faked result. Every default that shapes output is a named setting in one store (§12); what a param is (cyclic, hidden) is declared, never read off its name; third-party notices travel inside every bundle and every export. | Owner: "you cannot just hardcode things in this"; the project is published as open source. |

Cut from v1 (do not build): CSG booleans, rigid-body physics, a global constraint solver, in-plane 2D inside a
tilted 3D view, glyph-level equation morphing, in-browser video recording, cloud TTS, MCP server, Safari QA.

## 2. Repository layout and ownership
```
package.json  tsconfig.json  bunfig.toml  AGENTS.md
bin/mimir                 launcher (runs src/cli/main.ts with bun)
scripts/build.ts          discovers modules by file name, generates barrels + the typed reference + docs/CONFIG.md,
                          bundles the chunks with their third-party notices, enforces the budgets
src/core/                 signals, params, time, nodes, kind registry, schema validation, diagnostics, timeline,
                          steps compiler, evaluation, the config store, math, colour, rate functions
src/r2d/                  SVG backend + 2D kinds + layout ops + the embedded Computer Modern faces
src/r3d/                  3D kinds (pure side), three.js backend, the look, view modes (cutaway / ghost / explode), id pass
src/kit/                  parametric parts with named anchors + mechanisms (on demand)
src/plot/                 axes, number lines, bars, matrices, readouts (on demand)
src/diagram/              nodes / edges / graphs with auto-layout, tokens, queues, traffic, sequences (on demand)
src/flow/  src/sim/       particles along paths, fill levels; ODEs, discrete events, algorithm steppers (on demand)
src/tex/                  formulas (KaTeX) and the faces a formula may need (on demand)
src/anim/                 verbs (write / create / fadeIn / transform / …), step transitions
src/guide/                narration spans, cue scheduler, pointer, marks, labels, captions, voice
src/check/                declarations (expect, allow) + the lazy dev chunk: engine, rules, sampling plan, query
src/player/               UI chrome (seed; replaced by the design track)
src/host/                 window.__mimir protocol, the viewer boot sequence, playback
src/cli/                  check, shot, open, export, docs, examples, init, query, new; CDP client; dev server
src/lib/                  pure libraries (no DOM, no three): paths, layout, solids, kinematics, guide timing, sim
src/index.ts              assembles the public API (also installed on globalThis)
src/_generated/  types/   written by the build; not in git
docs/topics/              guides served by `mimir docs <name>` (essentials = the one page an author always needs)
examples/                 golden scenes = few-shot exemplars = regression tests
tests/unit  tests/e2e     bun test; e2e drives the real CLI + headless Chrome
```
Rule for parallel builders: you own only the files named in your brief. Kinds, rules, verbs and settings
self-register through the registries, so nobody needs to edit a shared file. Names are owned: registering a name
another module registered fails the build.

## 3. Core model

### 3.1 Signals, params, time
- `Dyn<T> = T | (() => T)`. Any prop may be dynamic; dynamic functions must be pure (read params, `s.t()`,
  other signals, `part.world(anchor)`); they are re-evaluated every frame, memoised per frame, cycle-checked. A
  function that gives two answers for one time is `NOT-PURE`.
- `s.param(name, { value, min, max, step?, unit?, label?, cyclic?, period?, hidden? })` → callable signal `p()`;
  shows as a slider. `s.toggle(name, { value })`, `s.choice(name, { options, value })`. Steps tween params; the user
  can drag them.
  - **cyclic** is declared, never guessed from the name: `cyclic: true` (one cycle is the range) or `period: n`; a
    param whose unit is degrees and whose range is a whole number of turns is cyclic with period 360 unless it says
    `cyclic: false`. `check` samples phases of a cyclic param.
  - **hidden** params get no control and are not swept by `check`. `s.state(name, initial)` is a hidden param: a
    value only the story drives.
- `s.t()` = simulation time in seconds. By default it advances with story time; a step may set
  `st.clock({ speed, freeze })`. Speed is never negative.
- `s.signal(() => expr)` = named derived value. `s.probe(name, () => number)` exposes a value to `check` / `shot`.
- Stateful simulation: `ode({ y0, f, dt })`, `events({...})`, `stepper(states)` are **recomputed from t = 0 with a
  fixed step and cached**, so they are still pure functions of time. `s.rng(seed)` is the only randomness.
- Story time τ ∈ [0, D] maps to (step k, local time u). `state(τ, params)` is total and deterministic.

### 3.2 Nodes and kinds
```ts
interface Node {            // plain data until mounted; API functions never touch three.js or the DOM
  id: string; kind: string; space: '2d' | '3d'
  props: Record<string, Dyn<any>>; children: Node[]; parent: Node | null
  anchors: Record<string, Dyn<Vec3>>        // local named points: top bottom left right front back center + kit ones
  placement: Placement | null               // at most ONE: absolute | attach | nextTo | container | between | mechanism
  src: { line: number }                     // creation site in the scene file (for diagnostics)
}
defineKind({ name, space, schema, aliases?, anchors(node), bounds(node), outline?(node),   // pure maths, no backend
             build(node, ctx), update(handle, resolved, ctx),                              // backend side
             chunk?, solid?: boolean, sdf?(node, pLocal) })                                // lazy chunk; for check
```
- Schema validation at every call: unknown option → `API-UNKNOWN` with did-you-mean + valid list; wrong type →
  `API-TYPE` with one correct example; then an inert placeholder node is returned (D9).
- Every created node is in the scene. If a step introduces it with an enter verb it is hidden before that moment.
  An object created inside a step appears at that moment (otherwise a label made in step 3 would show during steps 1
  and 2); one created between `s.chapter()` and its first step appears when the chapter opens; anything else is
  visible from τ = 0. `fadeOut` / `st.hide` end its life.
- A 2D object placed on a 3D part, or on a screen-space object (`m.hud()`), lives on the screen: the 2D camera
  neither moves nor scales it.
- Evaluation per frame: params → signals → for each node resolve props (base value or dynamic fn, then timeline
  clips) → placement → world transform (lazy, memoised, cycle = `PLACE-CONFLICT`) → backends sync → guide / labels
  → render.

### 3.3 Timeline (recorder)
`s.step(title, st => {…})` runs once. Calls append clips at the step's cursor:
`Clip = { node|param|camera|view, prop, t0, t1, to, rate, scope: 'persist' | 'step' }`.
- persistent (fold forward like manim): `st.play(...)`, `m.to…`, `st.set(param, v)`, `st.camera(...)`,
  `st.show / hide`, `st.cutaway / ghost / explode`.
- step-scoped (auto-cleared with a transition when the step ends): `st.focus`, `st.label`, guide marks from
  `st.say`. This is what prevents remnants.
- Step duration = max(narration time, recorded plays) + a hold. Any step can be rendered alone: state at a step is
  the fold of persistent clips up to it plus its own scoped ones.
- Pacing defaults (manim's, where it has one): play 1 s, camera move 2 s, lag 0.1, hold 1 s, wait 1 s, `smooth`
  easing; a step whose only content is `st.set` lasts 3 s and any step with a sweep at least 2 s (1 s is too fast to
  read a crank turning); a chapter opening takes 0.8 s. Every one of these is a setting (`pace.*`, §12). One play,
  wait, sweep or camera move lasts at most 300 s.

### 3.4 Chapters and read mode (long explanations)
- `s.chapter(title, { keep?: Mob[] })` starts a chapter: everything on stage (except `keep`) fades out with a lagged
  fade, cameras reset, and the following steps belong to the chapter. The timeline shows chapters, then steps.
  A "full explanation" is 3–8 chapters of 2–6 steps each; `check` warns on a chapter longer than 90 s
  (`CHAPTER-LONG`).
- Every step's narration is also the **transcript**. Video mode shows it as subtitles; read mode shows the whole
  explanation as a typeset column beside the stage — one paragraph per step, chapter headings, the current step
  marked, click a paragraph to jump, linked part words still drive the guide pointer. `st.note(markdown)` adds
  text that appears only in read mode (extra depth, formulas).
- `mimir export --md` writes the transcript as markdown (the explanation as an article).

## 4. Stage
- Frame: 128/9 × 8 units (14.222…, so a 1280 × 720 stage is exactly 90 px per unit), origin centre, x right, y up.
  Safe area x ±6.6, y ±3.5. Background pure black.
- `s.viewport(where = 'full' | 'left' | 'right' | 'top' | 'bottom' | { x, y, width, height }, fraction?)` places the
  3D panel; `s.area(where)` returns the remaining rect for 2D content. Beside a 3D panel the 2D camera looks through
  the rest of the frame: `st.zoom` fits its target into that window (magnification 0.25 … 8) and never moves the 3D
  panel.
- 3D world: Y up, units arbitrary (the camera auto-fits; keep the subject ≈ 10 units). The look is "luminous"
  (D14): parts are drawn by their role (housings dark, the mechanism light), an accent colour is light rather than
  paint, every drawn line is a shading break. Every number of it is in the look table (`look.*`, §12).
- Labels are plain typeset text in the part's colour on a thin leader line, placed by the runtime (outside the
  silhouette, no overlaps, inside the safe area), anchored on a pixel of the part that is really visible.
- Type is the embedded Computer Modern faces (KaTeX's fonts, OFL): never a font the machine may or may not have.
- Palette tokens: BLUE #58C4DD TEAL #5CD0B3 GREEN #83C167 YELLOW #FFFF00 GOLD #F0AC5F RED #FC6255
  MAROON #C55F73 PURPLE #9A72AC PINK ORANGE WHITE BLACK GREY_A #DDD GREY_B #BBB GREY_C #888 GREY_D #444 GREY_E #222
  (`_A` lightest … `_E` darkest for every hue). Materials: steel aluminium iron brass copper rubber plastic glass
  ghost glow matte.

## 5. Authoring API (public surface; one way to do each thing)
The reference is generated from each module's `api.d.ts` (`types/mimir.d.ts`) and served in three layers, so an
author never has to hold all of it: `mimir docs essentials` (one page, about 3k tokens: scene, steps, params,
placement, the common kinds and verbs), `mimir docs module:<name>` (one line per name), `mimir docs <symbol>`
(description, declaration, a real use). The outline below is the shape, not the list.
```ts
export default scene({ title: string, subtitle?: string, defaults?: Settings }, (s: Scene) => void)

// ── 2D (frame space) ─────────────────────────────────────────────────────────────────────────────
text(str, { size?: number | 'hero' | 'title' | 'section' | 'body' | 'label' | 'note' | 'tiny', color?, weight? })
tex(latex, { size?, color? })   rewrite(a, b)   num(dyn, { decimals?, unit? })   readout(label, dyn)   badge(dynState)
rect  circle  ellipse  dot  line  arrow  polyline  polygon  path  arc  brace  group
row(items, { gap?, align? })   column   grid(items, { columns, gap? })   ring(items, { radius })
axes({ x, y, width, height })  → ax.plot  ax.area  ax.dot  ax.vline  ax.hline  ax.trail  ax.mark  ax.bracket  ax.toFrame
numberLine  bars  matrix  guide(a, b)                                   // plot
node  edge  graph  token  tokens  queue  timer  traffic  sequence       // diagram
m.at(x, y) | m.at(target)   m.shift(dx, dy)   m.nextTo(target, dir = 'right', gap = 0.25)   m.toEdge   m.alignTo   m.fit(rect)
m.pin(part3d, anchor?, { offset? })   m.hud()
m.color  m.fill  m.stroke  m.opacity  m.scale  m.rotate  m.z  m.set({ … })
m.center m.top m.bottom m.left m.right m.start m.end m.width m.height m.pointAt(alpha)

// ── 3D (world space) ─────────────────────────────────────────────────────────────────────────────
box  sphere  cylinder  cone  torus  tube  extrude  lathe  sweep  mesh  group  between(a, b, { radius? | part? })
repeat(n, i => part).ring({ radius, axis }) | .line({ step })
kit.gear  rack  shaft  bearing  spring  coil  piston  conRod  crankshaft  valve  cam  camshaft  pulley  flywheel  fan
    pipe  bolt  liner  block
p.at(x, y, z)   p.rotate({ about, deg: dyn })   p.scale(k)   p.attach(target, { my?, to?, gap? })   p.on   p.under   p.nextTo
p.anchor(name)   p.define(name, [x, y, z])   p.world(name?)   p.color   p.material   p.opacity   p.explode   part.allow(code)
crankSlider  gearPair  gearTrain  rackPinion  planetary  camFollower  belt  valveLift  fourStroke   // all trig lives here
s.cutaway({ axis, at?, parts? } | false)   s.ghost(parts | false)   s.explode(amount)   s.look({ … })
flow  burst  trail  field  fillLevel  gas  colorScale   mix(c1, c2, u)   ramp([c…])(u)

// ── state ────────────────────────────────────────────────────────────────────────────────────────
s.param  s.toggle  s.choice  s.state(name, initial)   s.t()   s.signal(fn)   s.probe(name, fn)   s.rng(seed)
ode  events  stepper  integrate
s.expect(name, () => boolean)   expect.inside  touching  above  ratio  conserved  during
s.config({ … }) | s.config(key)   s.check({ limits, off })   s.guide({ … })   s.transitions({ … })

// ── story ────────────────────────────────────────────────────────────────────────────────────────
s.chapter(title, { keep? })
s.step(title, st => {
  st.say('The [piston](piston) slides down and the [intake valve](ring:intakeValve) opens.')
  st.set(param, value, { duration? })        // default: sweeps over the whole step
  st.camera({ view?, target?, azimuth?, elevation?, distance?, zoom?, fit? })
  st.zoom(target2d | null, { zoom?, margin? })   st.focus(...parts)   st.label(part, text?)   st.show   st.hide   st.note(md)
  st.cutaway  st.ghost  st.explode  st.clock({ speed?, freeze? })   st.play(...anims, { duration?, lag? })   st.wait(seconds)
})
// verbs → Anim
write  create  uncreate  fadeIn  fadeOut  grow  growArrow  transform  derive  fadeTransform  moveAlong  rotate
flashAround  indicate  count  vary  timed   m.to.<any setter…>   p.to(value)   all  seq  lagged
```
Constants: palette, `UP DOWN LEFT RIGHT UL UR DL DR FRONT BACK ORIGIN`, `FRAME_W FRAME_H`, rate functions
(`smooth linear rushInto rushFrom thereAndBack doubleSmooth …`, transcribed from manim; its snake_case spellings are
accepted too). Every name is also on `globalThis` so a missing import never breaks a scene. Angles are degrees
everywhere. Option names are full words (`radius`, `width`…); `r w h d` are accepted silently. `[words](a+b)` needs
a verb that takes several parts (ring, glow, focus). Not built: the escape hatches `raw3d` / `svg` / `draw2d`.

## 6. Guide and narration
- Span grammar: `[spoken words](verb:targets,option)`; verb ∈ point (default) | ring | label | arrow | glow | focus;
  targets = `partId` | `partId.anchor` | `a+b` | `a->b`. A span whose target does not exist, or is not on stage when
  its words are spoken, is `GUIDE-TARGET`; an unknown verb is `API-UNKNOWN`. Both are found when the scene is built.
- Compile to a cue list `{verb, target, word@, fire@, land@, drawEnd, markEnd}`; flight = a quadratic bezier with a
  lifted control point, smoothstep, a fixed 0.5 s hop, a minimum perch of 0.35 s, back-timed to land as the word
  starts. Every speaking step starts with a 0.6 s lead-in so the pointer can land on an early word. Pointer pose and
  mark progress are pure functions of step time.
- Timing without audio: 16.5 characters a second (about 160 words a minute) plus pauses (comma 365 ms, sentence
  360 ms, the medians measured on a system voice). `speechSynthesis` is an optional live voice.
- Runtime rules: the guide never takes input; it anchors on the part's visible pixels; marks belong to their step;
  user input wins (dragging the camera cancels the camera cue); captions always render with span words coloured
  like their marks; the pointer (a white dart) is hidden while it rests.
- Narration lint (defaults 25 words a sentence, 3 marks a sentence, 10 s without a cue): `SAY-LONG`,
  `GUIDE-CROWDED`, `GUIDE-DEAD-AIR`, `GUIDE-LATE`, `SAY-SYMBOL`, `GUIDE-REPEAT`.
- All of the above numbers are settings (`guide.*`, §12; `s.guide({ … })` is the same thing said in the scene).

## 7. `check` — diagnostics contract
```
{CODE} {severity} | step {k} "{title}" t={t}s | #{id} | {file}:{line}
  what: one sentence with the measured value and the limit
  fix: 1–3 literal edits, most likely first
```
JSON form: an envelope `{ ok, errors, warnings, total, shown, diagnostics[] }`, each diagnostic
`{code, severity, step, t, ids, file, line, measured, limit, what, fix[]}` (+ `params` when it was found with params
pinned away from the story's values). At most 8 printed per run, errors first, grouped by root cause; `--all`
prints everything. Exit 0 clean, 1 errors (also a scene that never finishes building), 2 usage / internal. Step and
chapter numbers are 1-based wherever a person or the CLI sees them. Severity `unknown` is "not measured": report
`unknown`, never `pass`, for anything not actually measured.
- Build-time and core: API-UNKNOWN, API-TYPE, REF-MISSING, NUM-INVALID, RUNTIME-ERROR, ID-DUP, PLACE-CONFLICT,
  GUIDE-TARGET, NOT-PURE.
- Measured (src/check; catalogue with thresholds in `src/check/RULES.md`): EMPTY-FRAME, TEXT-OVERLAP, OFF-FRAME,
  OCCLUDED, FLOATING, INTERPENETRATE, COLLIDE-IN-MOTION, STATIC-STEP, DEAD-PARAM, EXPECT-FAILED, TEXT-LONG,
  PLACE-NONE, LABEL-COVERS, TEXT-TINY, CONTRAST-TEXT, TINY, SUBJECT-FIT, CONTAINED, COINCIDENT, PARAM-BREAKS,
  CAMERA-CLIP, NO-VISUAL-BEAT, HATCH-USE, CHAPTER-LONG, COLOR-COUNT.
- Owned by the module they are about: MECH-OPEN (kit), SIM-UNSTABLE (sim), TEX-INVALID, TEX-FONT (tex),
  TRAFFIC-COUNT, GRAPH-SHRUNK, GROUP-COVERS (diagram), the narration lint of §6 (guide). One owner per code. The
  rules of an on-demand module are loaded only for a scene that uses the module.
- Sampling: every step end state (0.001 s before the step ends); u = 0.25 / 0.5 / 0.75 of the moving part of a
  step; 8 phases of one period of each param that is **declared** cyclic; each visible param at min / default / max.
  Visibility from a flat-colour id pass; penetration from solid proxies; parts with material ghost / glass or
  `shell: true` are exempt housings. A part that is meant to break a rule says so: `part.allow(code, other?)`.
- Thresholds and the sampling plan are named defaults that a scene can change (`s.check({ limits, off })`; the
  check module is moving them into the config store as `check.<CODE>.<name>`, §12).

## 8. CLI contract
stdout = result only; stderr = logs; JSON when piped or `--json`; exit codes as above. A command builds `dist/`
when it is missing or older than the sources; when a build fails it answers from the last good one and marks every
result `stale`.
```
mimir check <scene> [--json] [--all]
mimir shot  <scene> [--steps | --at 1.5,3 | --step 2 | --cues | --fine t0:t1:n] [--set name=value] [--views iso,front]
            [--sheet] [--debug ids] [--size 1280x720] [--scale n] [--out dir]
                               → PNGs + manifest {path, step, t, camera, sha256} + probes JSON
mimir open  <scene>            dev server + live reload (opens the browser; the story plays)
mimir export <scene> -o out.html | --mp4 out.mp4 | --md out.md [--frames]
mimir docs [essentials | module:<name> | <symbol> | <guide> | reference]
mimir examples [name]          the example scenes, one line each; the source of one
mimir init <name>              a starter scene that already passes check
mimir query <scene> distance|contacts|bounds|visible|state|probes|coverage …   measured answers about the scene
mimir new "<prompt>" [-o dir] [--agent name]   generate a scene with a headless coding agent that follows the loop
```
Headless = a Chrome-family browser with `--headless=new` over raw CDP (no puppeteer): the stripped headless shell
renders WebGL on the CPU. It is discovered per platform (`MIMIR_CHROME` overrides) and runs with
`--disable-partial-raster --disable-gpu-rasterization`, without which the same time gave different antialiasing
after different histories. ffmpeg is optional (`MIMIR_FFMPEG` or PATH). `mimir.config.json` at the project root
holds the project's settings (`{ "defaults": { … } }`, §12); the CLI hands it to the viewer.

## 9. Host protocol (page side)
`viewer.html?scene=<module url>[&headless=1][&t=<tau>][&step=<k>][&set=name:value,…][&view=<name>][&debug=<mode>]`
`[&autoplay=0|1][&mode=<name>][&config=<url of mimir.config.json>][&features=<modules>]`
```
window.__mimir = {
  ready: Promise<void>,                 // also resolves when the scene failed: info().fatal
  info(): Manifest,                     // title, duration, steps, chapters, transcript, params (with cyclic, period,
                                        // hidden), parts, chunks, features, autoplay, mode, config, problems, fatal, …
  seek(τ), setParam(name, v), clearParam(name?), setView(pose | name | null),
  frame(): Promise<void>,               // resolves after the next settled render
  diagnostics(opts): Promise<Diag[]>, probes(), query(what, ids?, opts?), debug(mode), pick(x, y),
  state(): { tau, step, u, duration, params, overridden, caption, userView, playing, speed },
  play({ speed? }), pause(), playing,   // the one playback clock of the page
  on('ready' | 'frame' | 'resize' | 'view' | 'params' | 'play' | 'pause', fn), version
}
```
- **Headless: nothing moves.** Time advances only through `seek()`; `play()` does nothing; every frame is repainted
  from nothing (a frame is evidence).
- **With a person watching, the story plays** as soon as it is ready, in video mode (D14): `info().autoplay`,
  `info().mode`. `?autoplay=0` keeps it still, the setting `viewer.autoplay` does the same for a scene or a project,
  a page opened at a moment (`t=`, `step=`: a link to that moment, or a live reload that comes back where the author
  was) stays at it, and a person who asked for reduced motion is not played at unless the page says `autoplay=1`.
  While the story plays the params are the story's; pinning one by hand (`setParam`) pauses it. Playback belongs to
  the host: the wall clock only chooses τ, and pixels depend on (τ, params) alone. A player draws the transport and
  calls `play()` / `pause()`; one that keeps a clock of its own returns `play()` from its factory and the host calls
  that instead of starting its own.
- **Project settings**: `?config=<url>` is fetched before the scene is imported; a page that cannot fetch (an
  export) is given `globalThis.__mimirConfig = { defaults }` instead.
- Modules add manifest fields with `defineManifest` (`info().guide`, `info().r3d`).

## 10. Bundles
`mimir.js` (core, r2d, the pure side of r3d, anim verbs, guide timing, check declarations, host, the seed player) ·
`mimir.3d.js` (three.js + the 3D backends, lazy) · `mimir.check.js` (engine, rules, query, debug overlay; lazy, dev
only, never exported) · one `mimir.<module>api.js` per on-demand module (kit, plot, diagram, flow, sim, tex) with
its `mimir.check<module>.js` rules · a module's own chunks (`mimir.tex.js` is KaTeX; `mimir.guide.js`,
`mimir.kit.js` …) · data chunks (font faces, one group at a time).
- Chunks are chosen for each scene: the on-demand modules by the names its source uses (a name the scan cannot see
  is caught by a stand-in, which loads the module and builds the scene again), the rest after the builder has run,
  from the kinds actually used. Export inlines only what the scene loaded and tells the page which modules it holds.
- Every chunk opens with a `/*! … */` notice naming the third-party code and data inside it; exports carry them.
- Sizes are judged per scene (D13); the measured numbers are in `docs/STATUS.md`.

## 11. Tests and "done"
- unit (bun test) for every pure module; e2e runs the real CLI against `examples/` and against scenes built to
  break one rule each. `docs/EXTENDING.md` is executable: its module is built, typechecked, checked, shot and
  exported by the suite. `docs/CONFIG.md` is generated, and a test fails when it differs from the sources.
- Determinism is a test: the same times shot in two orders give the same sha256, inside one step, across steps, and
  at scale 2.
- Golden scenes: four-stroke engine (3D), data pipeline with queues / workers / retries (2D), gradient descent
  (2D). Held-out prompts for generation evals (never show to the generator while building): turbofan, RC circuit,
  transformer attention.
- Done = every golden scene passes `check` with 0 errors, frames judged against the rubric by someone who sees
  only pixels, the held-out prompts go through the real `mimir new` loop, and the UI matches the design.

## 12. Settings: one store for every default
Rule 5 of docs/OSS-HYGIENE.md: no magic number. Every constant that shapes output (durations, sizes, the look,
guide timing, check thresholds) is a named default in one store, documented, and overridable.
- A module registers its defaults: `defineConfig('pace', { play: 1, … })`. The comment on a key is its
  documentation; the build writes `docs/CONFIG.md` from the registrations, so the document cannot drift.
- Everything reads through one accessor: `model.config('pace.play', fallback?)`. `PACE` and `TEXT_SIZES` are live
  views of the store, so code written against them follows the scene.
- Three layers, nearest wins: the **scene** (`scene({ title, defaults: { pace: { play: 1.5 } } })`,
  `s.config({ 'pace.play': 1.5 })`), the **project** (`mimir.config.json`: `{ "defaults": { … } }`), the registered
  **default**. Values are plain data, never functions: settings are an input like params, so the same settings,
  time and params give the same pixels.
- Unknown keys and wrong types are diagnostics with the nearest name; the default stays in force. A setting changed
  after something already read it warns. Keys of a chunk that is not loaded are judged by `mimir check`, whose dev
  chunk knows every key of the build.
- In the store today: `pace.*`, `text.size.*`, `camera.*`, `viewer.*` (core and host), `look.*` (the 3D look;
  `s.look()` is the same thing said in the scene), `guide.*` (`s.guide()` likewise). Still in tables of their own,
  each named and overridable per scene: check limits (`s.check`), transitions, verbs, diagram, flow, sim, plot.
