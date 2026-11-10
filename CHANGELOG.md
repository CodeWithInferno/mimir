# Changelog

All notable changes to this project are recorded in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html). Until 1.0.0 any release may change the scene API; such
changes are listed under "Changed" with what to edit in a scene.

## [Unreleased]

0.1.0 is published to npm as `mimir-explain` (the name `mimir` belongs to another package). It needs bun.

### Added

- `explain({ title, controls, stage, story })`: a scene as blocks on a stage and a story, with no positions, sizes or
  timings. Blocks: `cells`, `flow`, `chart`, `layers`, `machine`, `formula`, `sequence`, `custom`.
- Shapes from formulas: `curve`, `polar`, `outset`, `moved`, `areaOf`, `areaBetween`, `lengthOf`.
- `mimir new` writes once: one call of a model answers with the scene, the engine reviews it and asks again only when
  the review finds something. `--edit <scene>` changes a scene in one call; `--loop` is the agent loop; `--fast`,
  `--effort`, `--open`.
- `mimir review` (lint, an account of every step, composition findings) and `mimir bench` (real generations, one table).

- Scene runtime: scenes are plain JS modules; the script runs once and records a timeline, and the state at any
  story time is a pure function of time and parameter values. Parameters, toggles, choices, signals, probes, a
  seeded random generator; steps, chapters and notes; a 2D camera (`st.zoom`) and a 3D camera (`st.camera`).
- 2D: text in embedded Computer Modern faces, shapes, lines and arrows, layouts (`row`, `column`, `grid`, `ring`).
- 3D: primitives, `extrude`, `lathe`, `sweep`, `mesh`, `repeat`; a luminous look with edge lines; the view modes
  cutaway, ghost and explode.
- Kit: parametric parts (gears, pistons, rods, crankshafts, cams, springs, liners …) and mechanisms (`crankSlider`,
  `gearPair`, `gearTrain`, `rackPinion`, `planetary`, `camFollower`, `belt`, `valveLift`, `fourStroke`).
- Plots (`axes`, `numberLine`, `bars`, `matrix`, readouts), diagrams (`node`, `edge`, `graph` with layout, tokens,
  queues, timers, traffic, sequence), flows and simulation (`flow`, `burst`, `trail`, `field`, `ode`, `events`,
  `stepper`), typeset mathematics (`tex`, `rewrite`, with KaTeX).
- Verbs: `write`, `create`, `uncreate`, `fadeIn`, `fadeOut`, `grow`, `transform`, `derive`, `fadeTransform`,
  `moveAlong`, `rotate`, `flashAround`, `indicate` and the combinators `all`, `seq`, `lagged`.
- Guide: narration spans `[words](verb:part)`, a pointer that flies to the part as its word is spoken, labels on
  leaders, rings, glow, focus, captions lit word by word.
- `mimir check`: diagnostics with a code, the scene line, the measured value against a named limit and literal
  fixes; rules for the API, placement, solids (collisions, floating and contained parts), the picture (occlusion,
  text contrast and size, framing), the story and the narration. Every threshold is a named limit
  (`src/check/RULES.md`), overridable per scene with `s.check({ limits })`.
- CLI: `check`, `shot` (frames, story sheets, filmstrips, cue frames, turntables, manifest with sha256, probes),
  `open` (live reload on a free loopback port), `export` (one self-contained HTML file with a no-network content
  security policy, `--mp4` through ffmpeg, `--md` transcript), `docs`, `examples`, `init`, `query`, and `new`
  (generation through an agent adapter chosen by flag or environment).
- Lazy chunks: a scene loads, and an export carries, only the modules and font faces it uses.
- Twenty examples (`bin/mimir examples`), each checked clean by the test suite (`broken` is wrong on purpose).
- The player (watch, read, explore), loaded as a chunk of its own only with a person watching; the viewer plays by
  itself when it opens.
- `mimir serve` (the player's home page and a local API), `mimir skill` (install the skill, regenerate and check its
  API reference), the skill in `skills/mimir/`, plugin manifests, `mimir new --budget-usd`.
- A config store for every default (`scene({ defaults })`, `s.config()`, `docs/CONFIG.md`); `cyclic`, `period`,
  `group` and `hidden` on parameters; `s.state()`.
- `mimir export --mp4` renders in parts with progress on stderr, tries a slow frame again on a fresh page, and a
  run that stopped continues from its finished parts.
- `s.chapter(title, { keepCamera: true })`; a chapter that opens while the 2D camera is zoomed eases back.
- `opacity` as an option of every part of a plot.
- `bun run hygiene`: the mechanical check of `docs/OSS-HYGIENE.md`.

### Security

- The local server refuses requests with a foreign `Host` header, dot files, file types that are not on its list
  and symbolic links that leave the served directories; `mimir open` no longer prefers a fixed port.

### Known gaps

- See README, "What is not built yet", and `docs/STATUS.md`.

[Unreleased]: https://github.com/CodeWithInferno/mimir/commits/main
