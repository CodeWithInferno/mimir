# Mimir — status after the write-once pass (explain(), one-call generation, shapes from maths)

Four passes are recorded here, newest first. **Section M3** is the write-once pass of 2026-11-10; section M2 the
integration before it.

## M3. Write once

### What exists now (and the command that proves it)

| What | Proof |
|---|---|
| `explain({ title, controls, stage, story })`: blocks on a stage and a story, no positions, sizes or timings; blocks `cells`, `flow`, `chart`, `layers`, `machine`, `formula`, `sequence`, `custom` | `bun test tests/unit/quick` (155 tests); fifteen `examples/quick-*.scene.js`, each `mimir review` clean |
| The page a model writes from is true: every script on it runs as written, every name exists | `bun test tests/unit/quick/reference.test.ts`; `mimir docs quick` |
| Shapes from maths: `curve`, `polar`, `outset`, `moved`, `areaOf`, `areaBetween`, `lengthOf` | `bun test tests/unit/lib/curves.test.ts`; the rotary engine on the page is 24 lines of formulas |
| `mimir new` writes once by default: one call of a model, reviewed by the engine, at most one correction | `bun test tests/unit/cli/once.test.ts tests/e2e/once.test.ts`; numbers in docs/agents.md, "Write once" |
| `mimir new --edit <scene>`: a change in one call | the same tests |
| `mimir review`: lint + an account of every step + composition findings; in an `explain()` scene size and place are the stage's (`NOTE`, not `FLAG`) | `bun test tests/unit/cli/lean.test.ts` |
| `mimir bench [--once \| --loop] [--fast]`: real generations, one table | docs/agents.md |
| A scene is held to the check rules of every module it is built on (an `explain()` scene skipped the rules of graphs, parts and formulas before) | `featureClosure` in `src/host/index.ts`; the quick examples are checked with those rules on |
| A result longer than 64 KB is whole when it is piped (it was cut off at exit) | `writeAll` in `src/cli/io.ts`; `mimir review <a long scene> --json \| wc -c` |

### What a writer no longer has to get right (each cost a real generation a second call)

A comparison of ONE slot in `cells`; a formula term named loosely (`F1 d1` for `F_1 \cdot d_1`); `rect` taken apart
in `custom()` and then called as the shape; a line between two points inside a drawing of one's own (it now follows
the block); an object named as a target but made a second time outside the drawing; words that shrank with a
drawing that was scaled down; a part in no joint (a fixed part); a solid block round a rotor that nobody declared a
housing; a ring that is one (it stays solid); parts of one machine that touch or sit in each other; a link to a part
a block does not have (a warning: the words still land on the block); a curve named with a phrase; chart marks that
met; a step that changes nothing (a pulse, not a dimmed frame). `tests/unit/quick/absorb.test.ts` and
`machine.test.ts` hold every case.

### What does not work / was not verified

- `ready` is the engine's review, not a look. A drawing can pass and still be plain or badly composed: free
  drawings in `custom()` are the weakest (the stage fits and centres them and nothing else).
- The cheapest model writes correct but plain scenes and prefers still drawings; in one round it tilted a lever the
  wrong way.
- Inside a `machine()` collisions between its own parts are no longer reported (they are declared fits). A script
  states what must hold with `checks`.
- Sixteen of sixteen in one call is the last of four rounds on the same requests; the first was 8 of 12. Requests
  of a new kind have not been run. Only the `claude` writer was run for real; `codex` is untested.
- A sequence of two or three parties is now spread over the frame by default (`actorGapFor`): a full-API scene
  that relied on the old gap of 2.6 gets a wider diagram.
- The loop (`--loop`) was not measured again after `explain()` landed; its page still teaches the full API beside it.
- Not run on Safari, Firefox, Windows or Linux; no real phone; no voice.

---

Section M2 was written by the integration engineer of the second wave. Earlier passes follow, newest first. **Section M2 below** was written 2026-11-10 by the integration engineer
after the second wave (the real player, the skill and `mimir new` adapters, the config store, the open-source audit,
guide / 3D / flow fixes, and four scenes written by authors from the public reference only). Section 0 is the core and
build pass before it; sections 1 to 8 are the M1 merge. Where they disagree, the higher section is newer.
Everything was run on one machine (macOS, bun 1.3.11, TypeScript 7.0.2, Google Chrome with `--headless=new`). A row
without a command was not verified and says so. The history of M0.5 / M0.6 is in the appendix.

## M2. The integration of the second wave

### What exists now (and the command that proves it)
| What | Proof |
|---|---|
| Build, types, tests | `bun scripts/build.ts` (0.5 s) · `bun run typecheck` · `bun test`: **1867 pass, 0 fail** in 108 files, 458 s (1597 before the wave); `bun test tests/unit` alone: 68 s |
| Hygiene | `bun scripts/hygiene.ts --strict` is clean: no pending violation is left. | `bun run hygiene` |
| **The player** (`src/player/`, chunk `mimir.player.js`, 50.0 KB gzip, loaded only with a person watching): watch (plays by itself, the chrome sleeps while it plays), read (the explanation as a column), explore (parameters, views, parts), a line of time with chapters, palette, share, notes on parts, an erratum for scene errors, a home page | `bun test tests/e2e/player.test.ts tests/e2e/player-home.test.ts tests/unit/player`; looked at in headless Chrome at 1440 x 900 on `four-stroke-engine` and `job-queue` (watch awake and asleep, read, explore) |
| One clock on a page: the player's. `__mimir.play()` / `pause()` / `playing` / `state().playing` and the `play` / `pause` events speak for it (`PlayerInstance.transport`); without a player the host's own clock runs | `bun test tests/e2e/real-viewer.test.ts -t "the viewer plays"` |
| `mimir open` starts playing; an exported HTML file plays from `file://` with the network off (0 http requests, 16 `file:` / `blob:` requests) | measured with a headless page on `mimir open --no-open` and on an export of `four-stroke-engine`; `bun scripts/offline-proof.ts <file> <png>` |
| **Video export in parts**: 150 frames a part in `<out>.parts/`, joined without re-encoding; progress on stderr every 5 s; a frame that does not come back is tried again on a fresh page (3 tries); a run that gives up names the frame and the slow step, keeps its finished parts, and the same command continues; `timing` in the JSON result | `bun test tests/unit/cli/video.test.ts` (real ffmpeg, stand-in pages) · the four videos below · by hand: an export of `hello-3d` interrupted after two parts, the same command again said "continuing: 300 of 542 frames", rendered 242 and gave the frame hash of an unbroken run |
| `mimir new` with adapters, `mimir serve`, `mimir skill`, `--budget-usd`; the skill in `skills/mimir/`; the repository as a plugin | `bun test tests/e2e/new.test.ts tests/unit/cli/agents.test.ts` · `claude plugin validate . --strict` passes · a real generation was NOT run in this pass |
| The config store reaches the guide (`guide.*`, documented from the comments of its one table) and the 3D look (`look.*`) | `bun test tests/unit/integration/config.test.ts` |
| `s.param` / `s.toggle` / `s.choice` take `group` and `hidden`; `cyclic` / `period` as before | `bun test tests/unit/core/params.test.ts` |
| `s.chapter(title, { keepCamera: true })`; a chapter that opens while the 2D camera is zoomed eases back over the opening (it was a cut) | `bun test tests/unit/core/authors.test.ts` |
| `opacity` is an option of every part of a plot; `fadeIn` / `fadeOut` with `scale` change the size about the object's own centre | `bun test tests/unit/plot/authors.test.ts` |
| Rules of the whole story (GUIDE-TARGET) measure the story as it plays, not with the last sampled slider value pinned; a part declared `allow('OCCLUDED')` is not asked about its visible share a second time | `bun test tests/e2e/check-rules.test.ts -t "GUIDE-TARGET judges"` |
| A part whose place depends on the 3D camera is left out of the camera fit, whoever asks first (in the live page a scene carried "size became NaN" and did not play) | `bun test tests/unit/core/authors.test.ts -t "whoever asks first"` |

### The four authored scenes as videos (1920 x 1080, 30 fps, `--jobs 4`)
| Scene | Story | Frames | Export took | Slowest frame (seek + screenshot) | File |
|---|---|---|---|---|---|
| `job-queue` | 118.7 s | 3,562 | 64.5 s (81.4 s with the test suite running beside it) | 37 + 63 ms | 4.6 MB |
| `four-stroke-engine` | 92.1 s | 2,763 | 93.2 s (156.4 s with the suite beside it) | 80 + 202 ms | 14.6 MB |
| `gradient-descent` | 183.6 s | 5,509 | 96.6 s (123.4 s) | 27 + 73 ms | 10.2 MB |
| `neural-network` | 185.0 s | 5,549 | 110.2 s (134.7 s) | 64 + 101 ms | 8.3 MB |

Command: `bin/mimir export examples/<name>.scene.js --mp4 <file> --json`. No frame was tried twice in any of the eight
runs. Six frames of each video were looked at: all four tell their story and nothing is broken; what is wrong is
small (`gradient-descent`: the red word "diverged" is cut off by the left edge of the frame in the divergence step;
`job-queue`: the opening sits in the upper two thirds of the frame, and a faint count travels beside the top worker
in one frame; `neural-network`: the heat map shows a faint grid between its cells and the opening uses the left half
of the frame only; `four-stroke-engine`: the gas is drawn as dark dots on a bright body).

Why the authors could not export: under a load average of 24 to 128 one `Page.captureScreenshot` took more than
the 30 s limit, and one late frame threw the whole video away (no retry, nothing kept). On a quiet machine no frame
of these scenes takes longer than half a second (the slowest of 17,383 was 0.47 s, with the suite running beside
it), and the rate does not fall over 5,549 frames, so nothing leaks. The limit is still `MIMIR_TIMEOUT`.

### Sizes (gzip, `bun scripts/build.ts`)
`mimir.js` 101.2 KB (budget 120) · with `mimir.3d.js` 275.4 KB (320) · all code 543.5 KB (900) · font data 251.8 KB
(280) · `mimir.player.js` 50.0 KB. An exported HTML file: `hello-3d` 1.33 MB, `four-stroke-engine` 1.54 MB.

### Timings (one run each, wall clock, browser start included, while the test suite was running)
| Command | `hello-3d` | `job-queue` | `four-stroke-engine` |
|---|---|---|---|
| `mimir check` | 1.0 s | 1.0 s | 2.6 s |
| `mimir shot --sheet` | 1.5 s | not run | 2.0 s |
| `mimir export -o x.html` | 1.3 s | not run | 1.9 s |
| `mimir export --mp4` | 13.6 s (542 frames) | see the table above | see the table above |

### What does not work / was not done
1. `bun run hygiene` is red in the maintainers' repository until the internal notes are untracked (see the table).
2. Authors' findings that are NOT fixed (each is reproducible from the author's report): `fit()` on a `graph` is
   reported as a placement cycle; a chapter ends the life of objects that exist from the start but are hidden by an
   opacity function; a plot curve in a `group()` with its axes is not drawn; anchors of a `graph` read while the
   scene is built are those before it is fitted to `width` / `height`; `st.label` on a dot inside closed curves lands
   on a tick label; a chapter resets the 3D camera in no time when nothing leaves the stage (use `keepCamera: true`);
   `traffic()` has no dead-letter destination; the pointer aimed at an `axes` lands on one of its text labels.
3. `keepCamera` is tested for the 2D camera only; the 3D camera takes the same branch but no test or frame proves it.
4. The player: no switch that names every part, no answering backend for Ask, no recording, no wheel zoom in 2D.
   Not run: a real phone, Safari, Firefox, a screen reader, real speech.
5. `mimir new`: no generation was run in this pass; one adapter has ever been run end to end.
6. The CLI side of `mimir.config.json` (discovery from the scene's directory, `&config=`, inline in exports) is not
   built: the file is honoured only when the page is given `config=`.
7. Linux and Windows were never run.

## 0. Core and build follow-ups (what the open-source rules and the authors asked for)

### What was added
| What | Where | Proof |
|---|---|---|
| **One config store** for every default that shapes output: `defineConfig` (a module registers its defaults, the comment on a key is its documentation), `model.config(key, fallback?)` (the one accessor), `scene({ title, defaults })` and `s.config({ … })` for a scene, `mimir.config.json` (`{ "defaults": { … } }`) for a project. Unknown keys and wrong types are diagnostics with the nearest name; a setting changed after it was used warns | `src/core/config.ts`; DESIGN §12; `docs/CONFIG.md`; EXTENDING 2.16 | `bun test tests/unit/core/config.test.ts` (15); `bun test tests/e2e/real-viewer.test.ts -t "mimir.config.json"`; `bun test tests/e2e/extending.test.ts -t settings` |
| In the store: `pace.*` (18 keys: play, camera, hold, lag, sweep, chapter timing …), `text.size.*` (the type scale), `camera.*` (default view, field of view, fill), `viewer.*` (autoplay, mode, speed), `look.*` (the whole 3D look table, 223 keys; `s.look()` still works and is said last), `guide.*` (28 keys; `s.guide()` likewise). `PACE` and `TEXT_SIZES` are live views of the store, so every module that already read them follows a scene's settings without a change | `src/core/{rate,text,camera}.ts`, `src/host/index.ts`, two lines each in `src/r3d/look.ts`, `src/r3d/index.ts`, `src/guide/index.ts` | the same tests; `docs/CONFIG.md` lists 291 settings |
| **`docs/CONFIG.md` is generated** by the build from the registrations and the comments on the keys; a test fails when the file and the sources differ | `scripts/build.ts` (`--print-config` prints it) | `bun test tests/unit/integration/config.test.ts` |
| **Params say what they are**: `cyclic: true` / `period: n` (a param in degrees over whole turns is cyclic by default, `cyclic: false` switches that off), `hidden: true`, and `s.state(name, initial)` for a value only the story drives. `info().params[]` carries `cyclic`, `period`, `hidden`. The checker no longer reads a param's name: `isCyclic` is the declaration, hidden params are not swept | `src/core/scene.ts`; `src/check/plan.ts` (outside this pass's files: see "for other owners") | `bun test tests/unit/core/params.test.ts tests/unit/runtime/check.test.ts` |
| **The viewer plays when it opens** (not headless), in video mode: `info().autoplay`, `info().mode`; `?autoplay=0`, the setting `viewer.autoplay`, a page opened at a moment (`t=`, `step=`: a live reload comes back where the author was and stays there), or a person who prefers reduced motion keep it still. Pinning a param by hand pauses the story (while it plays, the params are the story's). Playback is the host's: `__mimir.play({ speed? })`, `pause()`, `playing`, events `play` / `pause` (with `ended`). **Headless: nothing moves**, `play()` does nothing | `src/host/index.ts`; DESIGN §9; the seed player now only draws the transport | `bun test tests/e2e/real-viewer.test.ts -t "the viewer plays"` (a live page advances on its own, stops at the end, `autoplay=0` and headless stay at τ = 0) |
| **Third-party notices travel with the code**: every chunk opens with a `/*! … */` line naming the npm packages bundled into it (name, version, licence, copyright lines, read from `node_modules`: three.js in the 3D chunk, KaTeX in the tex chunk) and carrying the header of every file that embeds font data (KaTeX fonts, OFL). Exports keep them. A bundled package without a licence, or a data file whose header names none, fails the build | `scripts/build.ts`; `dist/build.json` `notices` | `bun test tests/e2e/real-viewer.test.ts -t "third-party notices"` (greps the build, an exported 3D scene and an exported formula) |
| **Generated files are out of git**: `src/_generated/`, `types/mimir.d.ts`, `types/mimir.module.d.ts` are ignored. The CLI builds when `dist/` is missing, `bun run typecheck` writes the barrels first, `bun test` does so through `tests/setup.ts` (`bunfig.toml`) | `.gitignore`, `package.json`, `bunfig.toml`, `tests/setup.ts` | `bun test tests/e2e/extending.test.ts -t "a fresh clone"`; done by hand on a copy without the generated files: `mimir docs box`, `bun run typecheck`, `bun test tests/unit/integration` |
| **The reference in three layers**: `mimir docs essentials` (one page: scene, steps, params, placement, the common kinds and verbs), `mimir docs module:<name>` (one line per name, with the members the module adds to Scene / Step), `mimir docs <symbol>`. `module:` / `symbol:` / `guide:` say which is meant when a name is both (flow, guide, tex); a bare name that is both answers with the symbol and says how to get the module | `docs/topics/essentials.md`; `src/cli/commands/docs.ts` (outside this pass's files); the build now writes one banner per module into the reference | `bun test tests/unit/integration/reference.test.ts` (5) |
| **On-demand loading is robust**: the names of modules that are not loaded are stand-ins that note the module and throw; the viewer then loads it and builds the scene again. So `globalThis['ax' + 'es']`, a name touched while the module is evaluated, and a scene whose source cannot be read all work, and an unreadable source no longer loads every module | `src/host/index.ts` (`featureStubs`, `FeatureNeeded`) | `bun test tests/e2e/real-viewer.test.ts -t "on-demand modules"` |
| **`check` no longer pulls every module**: the rules of an on-demand module are a dev chunk of their own (`mimir.checkkit.js`, `checkdiagram`, `checksim`, `checktex`), loaded with `mimir.check.js` only for a scene that uses the module | `scripts/build.ts`, `src/host/index.ts` | the same test (a plain 2D scene loads `mimir.js`, `mimir.fonts.js`, `mimir.check.js` and nothing else during check) |
| Smaller things: the host's version is the package's (compiled in); one `STEP_END_EPSILON` in the core; a player may live in `src/player/player.chunk.ts` and is then loaded only with a person watching (proved on a scratch copy: `mimir.js` 2.6 KB smaller) | | `bun test tests/e2e/extending.test.ts -t "a player in its own chunk"` |

### The reference, measured
No tokenizer is in the repository, so the cost is given as a range: a token of code-heavy English is 3 to 4
characters (`tests/unit/integration/reference.test.ts` prints the table).

| What an author reads | Characters | Tokens (chars / 4 … chars / 3) |
|---|---|---|
| `mimir docs reference` (everything; never needed whole) | 91,277 | 22,800 … 30,400 |
| `mimir docs essentials` (always) | 8,781 | 2,200 … 2,930 |
| `mimir docs module:<name>` (when a scene needs the module) | 1,718 (tex) … 13,800 (kit) | 430 … 4,600 |
| `mimir docs <symbol>` | a few hundred | about 100 … 300 |

Commands and shapes are stable for the skill to build on: `mimir docs` (the index; `--json`: `{ topics, names,
modules: [{ module, names }], guides: [{ name, title }] }`), `mimir docs essentials` (`--json`: `{ guide, title,
text }`), `mimir docs module:<name>` (text: `# <name>` then one line per declaration `signature   // first line of
its comment`, members indented; `--json`: `{ topic, entries: [{ name, kind, topic, line, doc, decl }] }`),
`mimir docs <symbol>` (text: comment, declaration, `example (<file>:<line>):`; `--json`: `{ entries, example?,
also? }`). The essentials page's example scene passes `mimir check` and was looked at as a sheet; a test checks that
every name the page uses is in the reference and that the page stays under 4,000 tokens at 3 characters a token.

### Sizes after this pass (gzip, `bun scripts/build.ts`)
`mimir.js` 99.8 KB (limit 120; it was 95.1) · `mimir.js` + `mimir.3d.js` 273.4 (limit 320) · all code 484.0 (cap 900) ·
font data 251.8 (limit 280). **The first load of a scene went up by about 5 KB, not down**: the config store, the
declared params, playback, the stand-ins and the project settings are 4.7 KB of `mimir.js`, and each data chunk
gained its notice (0.1 to 0.5 KB).

| A scene loads | Before | After | Chunks |
|---|---|---|---|
| hello-2d, neural-network | 192.8 | 198.0 | `mimir.js`, fonts, guide |
| request-flow | 222.1 | 227.4 | + diagram API and drawing |
| formula | 286.1 | 291.4 | + tex API and KaTeX |
| hello-3d | 366.3 | 371.6 | + the 3D chunk |
| slider-crank | 393.1 | 398.5 | + kit API and backends |
| combined (tests/e2e/scenes/real) | 552.7 | 558.4 | 15 chunks |

(The chunk lists are from `mimir export` of each scene; the sizes from the two builds' `dist/build.json`.) `check` of
a scene is cheaper where it counts: the 40-part fixture went from 867 ms to 617 ms in the page, because the rules
of modules the scene does not use are no longer loaded.

Not done of the size work, with what each would bring (measured):
- **One chunk per font face.** The four faces are 25.8 (regular), 24.9 (bold), 16.7 (italic) and 16.1 KB (math
  italic) gzip. A scene that only sets regular text would load 58 KB less. It needs `src/r2d` (one data file and one
  chunk per face, the faces asked for by what the scene's texts use) and `src/tex` (its `main` group names the four
  faces as one chunk): not this pass's files.
- **The pure side of r3d on demand.** `src/r3d/index.ts` is 26.9 KB of the 276.6 KB (minified) of `mimir.js`,
  about 9.5 KB gzip, and a 2D scene never calls it. Only `src/check/solids.ts` imports it from outside, so
  `export const lazy = true` would do it once the build lets the 3D chunk build on an API chunk (today the 3D
  chunk is bundled before the API chunks).
- **The player when headless**: 2.6 KB, by naming the file `player.chunk.ts` (shown above). Left to the player's
  owner: a second player file beside the first would register twice.
- The guide's pure side (9.5 KB minified) and the anim verbs (14.1 KB) are needed by most scenes; not moved.

### For other owners (what this pass needs, or changed outside its own files)
The edits below were made in this pass's clone to prove the features end to end. They are small and are also in one
patch against the tree the clone was made from (`.mimir/handover/outside-brief.patch`, 332 lines, applies cleanly).
- `src/check/plan.ts` (check): `isCyclic` returns `p.cyclic`; the phases cover one `period`; hidden params are not
  swept. Still to do there: register the limits with `defineConfig('check', …)` (reading
  `model.config('check.<CODE>.<name>', fallback)` works already; registered keys are documented and typos in them
  are reported), and read `STEP_END_EPSILON` from the core instead of its own copy (`src/cli/manifest.ts` has a third).
- `src/r3d/look.ts`, `src/r3d/index.ts` (r3d): the look table is registered (`defineConfig('look', LOOK)`), and
  `lookOverrides()` puts the store's `look.*` under what `s.look()` said. `VIEW_PACE` is still computed when the
  module is imported, so `pace.play` / `pace.camera` do not reach `st.ghost` / `st.cutaway` / `st.explode`.
- `src/guide/index.ts` (guide): `GUIDE_DEFAULTS` is registered and `guideConfig()` starts from the store.
  `GUIDE_MOTION` is not in the store.
- `src/player/index.ts` (player): the seed uses `host.play()` / `host.pause()`, follows the `play` / `pause` events
  and skips hidden params. A new player must do the same, or return `play()` from its factory if it keeps its own
  clock; it should read `info().mode` and live in `player.chunk.ts`.
- `src/cli/commands/docs.ts` (cli): `module:` / `symbol:` / `guide:` prefixes, the module view with members.
- `src/cli` still to do: find `mimir.config.json` (from the scene's directory up to the project root), add
  `&config=<url>` to the viewer URL for `check` / `shot` / `open`, and write
  `<script>globalThis.__mimirConfig = …</script>` before the boot script of an export. The host side is done and
  tested with a page that is given the URL and one that is given the object.
- `.gitignore`, `package.json` (`typecheck` writes the barrels first), new `bunfig.toml` and `tests/setup.ts`.
  The generated files that are tracked today have to leave the index once (`git rm --cached`).
- anim (`TRANSITION_DEFAULTS`, `VERB_DEFAULTS`), diagram, flow, sim, plot: one `defineConfig(group, TABLE)` each
  puts their tables in the store and in `docs/CONFIG.md`; reading through `model.config` makes them overridable.
- tex: the header of its font data files names the licence but not the copyright holders; the r2d file does.

### Tests of this pass
- `bun run typecheck`: exit 0. `bun scripts/build.ts`: exit 0 with the budgets on.
- 1636 tests in 95 files (1597 in 91 before; 39 new). Before the pass, on a quiet machine: `bun test`, 1597 pass, 0
  fail, 361 s. After it the machine was under heavy load from other test runs and one `bun test` over everything
  could not finish clean (see the first point below), so every file was run in its own process and a test that
  failed was run again by name: 1628 passed the first time, 8 failed because the browser did not start or the
  command did not exit (kit examples 1, check-rules 2, cli-commands 2, cli-real 3), and all 8 passed when run
  again. Nothing failed twice. One real regression was found this way and fixed: with autoplay a live reload no
  longer came back at the author's moment (now a page opened with `t=` stays there, and pinning a param pauses).
- Looked at: the sheets of hello-3d, slider-crank, request-flow and of the essentials page's scene. Pixels: 12
  frames (4 times of hello-3d, request-flow, slider-crank) have the same sha256 as the build before the pass.
  Determinism: 12 times shot in two orders for request-flow, slider-crank, hello-2d, and slider-crank at scale 2:
  one sha256 per time in both orders, 12 distinct pictures each. Every example: `mimir check` 0 errors, 0 warnings
  (`broken`: 4 errors, as designed).

### What does not work / was not verified in this pass
- **The CLI sometimes does not exit for about 15 minutes after it has printed its result** (about 1 run in 20
  while this machine was under heavy load from other test runs). Seen with the tree as it was before this pass as
  well (20 runs each, alternating: one stall of 965 s with the old code, one of 828 s with the new), so it is not
  caused by these changes. A stalled run showed the browser process and its helpers in the exiting state for
  minutes, and `timed out after 10000 ms connecting to the browser's DevTools endpoint`. It is in the browser
  handling of `src/cli` (and this machine); every e2e test that hits it times out. See the test row below.
- `mimir open` was not looked at by a person in this pass either; autoplay is proven by a test that drives a live
  (not headless) page, not by watching it.
- Reduced motion (`prefers-reduced-motion`) switching autoplay off is implemented and was not exercised by a test.
- Unknown keys of a group that lives in a lazy chunk are reported by `mimir check` (and when that chunk is loaded),
  not by `mimir shot` of a scene that never loads it.
- The comment-to-documentation reader of the build handles object literals as they are written in the tree; 8 of
  291 settings have no description (values that one table spreads from another, one guide key).
- Nothing was run on Linux or Windows.

# The M1 merge (the integration pass, as written then)

**The eleven modules of the wave work together.** r3d (luminous look, extrude / lathe / sweep / mesh / repeat,
cutaway / ghost / explode), kit (parts + mechanisms), r2d (2D kinds + embedded Computer Modern), plot, anim, diagram,
flow + sim, guide, check, cli and tex were green each in its own clone and had never been built together. Merged:
**build exit 0 with the budgets on, typecheck clean, 1597 tests pass, 0 fail (91 files, 309 s)**. Every example
passes `mimir check` with 0 errors and 0 warnings, and I looked at the sheet of every one (section 5).

Three things in this pass are structural, not fixes (details in section 4):
1. **Feature modules are on demand.** The six feature modules together took `mimir.js` to 141.1 KB gzip (limit
   120). Their `index.ts` files are now chunks of their own, loaded before a scene that uses one of their names.
   `mimir.js` is 95.1 KB; a 2D scene with no plot / diagram / formula loads none of them.
2. **One owner per name, per face and per finding.** Four things existed twice after the copy: the rule TEXT-LONG
   (check and guide), glyph-by-glyph Write (r2d and anim), the four Computer Modern text faces (r2d and tex), and the
   page side of `mimir query` (check and cli). Each has one owner now.
3. **The code budget was full** when this was written (478.7 of 480 KB gzip). The limit now counts what one scene
   loads (DESIGN D13) and the all-chunks total is only a sanity cap of 900 KB: section 0 has today's numbers.

## 1. What exists (and the command that proves it)

| What | Proof | Result |
|---|---|---|
| Build, budgets on | `bun scripts/build.ts` | exit 0; sizes in section 3. `--where` lists the largest source files per chunk |
| Whole suite | `bun test` | **1597 pass, 0 fail, 91 files, 309 s** (976 in 51 files before the wave) |
| Typecheck | `bun run typecheck` | exit 0, no output, 0.24 s |
| Every example typechecks against the reference | `bunx tsc --ignoreConfig --noEmit --allowJs --checkJs --noImplicitAny false --target es2022 --module esnext --moduleResolution bundler --skipLibCheck --lib es2023,dom types/mimir.d.ts examples/<all but broken>.scene.js tests/e2e/scenes/real/combined.scene.js` | no output (with `noImplicitAny` on, the plain-JS helper functions of three examples are implicit any; hello-2d / hello-3d are clean under strict) |
| `check` on every example | `for f in examples/*.scene.js; do bin/mimir check $f --text --all \| tail -1; done` | 16 × `OK 0 errors, 0 warnings`; `broken`: `FAIL 4 errors` (as designed) |
| The modules together | `bin/mimir check tests/e2e/scenes/real/combined.scene.js`; `bun test tests/e2e/real-viewer.test.ts -t "modules together"` | one story with a kit `crankSlider` + cut liner in the 3D panel, a plot traced by the mechanism with a `guide` tie from the 3D piston, a readout, a KaTeX formula, narration spans on 3D parts and 2D objects (pointer, label, ring), `write` / `create` / `derive`, a chapter, a graph with tokens (also on an edge that ends on the 3D piston), flow particles, `st.zoom`. Clean; `info().features` = diagram, flow, kit, plot, tex; chunks 3d, anim, diagram, flow, fonts, guide, kit, plot, tex |
| Determinism on the merged tree | by hand: `bin/mimir shot <scene> --at <12 times>` once ascending and once shuffled, sha256 compared per time; the same for the combined scene in the test above; `bun test tests/unit/anim/viewer.test.ts`; `bun test tests/e2e/real-viewer.test.ts -t determinism` | request-flow (2D), slider-crank (3D), combined: 12 times each, 12 distinct pictures, **one sha256 per time in both orders** (36 times, 0 differ) |
| Export, offline | `bin/mimir export <scene> -o x.html && bun scripts/offline-proof.ts x.html x.png --t <t>` | request-flow 513 KB (231 KB gzip), slider-crank 1.20 MB (406 KB), combined 1.72 MB (566 KB): ready, no fatal, 1 `file:` request (itself) + blobs, nothing blocked, no console error, frame not empty. Every chunk and face used is inside; the page is told its on-demand modules (`?features=…`) |
| Video | `bin/mimir export examples/hello-3d.scene.js --mp4 out.mp4`; `ffprobe` | 542 frames, 1920 × 1080, 30 fps, h264 yuv420p, 18.07 s, 1.19 MB, written in 13 s. Three frames extracted with ffmpeg and looked at (labels, captions lit word by word) |
| On-demand modules | `bun test tests/unit/integration`; `bun test tests/e2e/extending.test.ts -t "lazy chunks"` | which modules a scene uses is read off its source (names in comments, strings, members and own declarations do not count); hello-2d exports `mimir.js` + `mimir.fonts.js` + `mimir.guide.js` only |
| The compact reference | `bin/mimir docs reference` | 432 lines, 65.5 KB: every module's declarations one line each with the first line of the comment, members of Scene / Step / kit … indented, the palette on one line. `types/mimir.d.ts` is 1431 lines of ambient declarations (110.8 KB); the 391 lines of `declare module 'mimir'` plumbing are in `types/mimir.module.d.ts` |
| `mimir query`, measured | `bun test tests/e2e/cli-real.test.ts -t query` | bounds, distance (solid to solid, point to point, point to surface), contacts (one part or all), visible (pixels from the id pass, what hides it), state; a wrong id or point is exit 2 with the nearest name |
| Check rules | `bun test tests/e2e/check-rules.test.ts` (20 rules, each on a scene built to break it and one built to stay clean); `bun test tests/unit/check tests/unit/guide tests/unit/kit tests/unit/diagram tests/unit/sim tests/unit/tex` | 47 codes exist: 19 measured ones of `src/check` and MECH-OPEN (catalogue with thresholds: `src/check/RULES.md`), 14 build-time and M0 codes, 7 of the guide, 3 of diagram, 2 of tex, SIM-UNSTABLE |
| `docs/EXTENDING.md` is true | `bun test tests/e2e/extending.test.ts` | 12 tests: the document's module builds, typechecks, checks, shoots, exports |
| Rows of M0.6 that still hold (stale dist, registries own their names, backend errors carry the scene line, id pass, JSON import, a scene that never finishes, chapters / transcript, 2D camera) | `bun test tests/e2e` | pass |

Public surface: 194 names (`bin/mimir docs` lists them by module). Evidence images of this pass (not tracked):
a local evidence folder (the sheet of every example and of the combined scene, three mp4 frames, the offline export).

## 2. What does not work / is not there

- **Player**: still the M0 seed (play / pause, step keys, scrubber, sliders, orbit). No chapter timeline, no read
  mode, no voice toggle (autoplay: section 0) (`mimir:voice` is never dispatched). The guide publishes `info().guide` for it.
- **`mimir open` was not looked at by a person** in this pass (its e2e test runs it headless). Interactive use of
  the wave's features (hover, drag while a guide cue runs, live reload with a new on-demand module) is unverified.
- **Voice** (`speechSynthesis`) never ran with real speech; only its pure side is tested.
- **Not built**: `raw3d` / `svg` / `draw2d` escape hatches, `st.note` in a read-mode column, `skills/mimir/`, the
  Claude Code plugin manifest, `docs/topics/*.md` (the command lists them when they exist), `THIRD_PARTY_NOTICES.md`
  (KaTeX MIT, KaTeX fonts OFL 1.1, Computer Modern kerning pairs, manim-derived rate functions and verb timings:
  the modules' reports name each), README / CONTRIBUTING / hygiene script (the build's review notes: not done
  in this pass, and not made worse: `scripts/dev-shot.ts`, which hardcoded a Chrome path, is deleted).
- **Non-uniform scale** still does not exist. A clipping kind clips with one rectangle.
- **`NOT-PURE`** still compares two evaluations at step ends with default params only.
- **Only this machine was tested**: macOS, one Chrome, one GPU. Linux, Windows, other browsers: not run.
- Every "known gap" of the eleven reports (`the build's review notes`) still stands unless section 4 says it
  was closed.

## 3. Sizes and timings (measured)

| Chunk | min | gzip | |
|---|---|---|---|
| `mimir.js` (core, r2d, r3d pure side, anim verbs, guide timing, check declarations, host, seed player) | 262.2 KB | **95.1 KB** | limit 120 |
| `mimir.3d.js` (three.js, fat lines, r3d look / edges / shaders) | 647.9 KB | 173.5 KB | with `mimir.js`: 268.5 of 320 |
| `mimir.check.js` (engine, rules of every module, query, debug overlay) | 127.7 KB | 48.7 KB | dev only, never exported |
| `mimir.anim.js` (morph stand-in, flashAround) | 13.7 KB | 5.8 KB | |
| `mimir.guide.js` (pointer, marks, labels, captions, voice) | 32.4 KB | 13.6 KB | |
| `mimir.shapes.js` | 1.0 KB | 0.7 KB | |
| `mimir.kitapi.js` / `mimir.kit.js` | 49.1 / 24.8 KB | 16.9 / 10.0 KB | on demand |
| `mimir.diagramapi.js` / `mimir.diagram.js` | 32.3 / 43.0 KB | 11.7 / 17.7 KB | on demand |
| `mimir.flowapi.js` / `mimir.flow.js` / `mimir.flow3d.js` | 18.4 / 15.4 / 3.5 KB | 6.7 / 6.8 / 1.7 KB | on demand |
| `mimir.plotapi.js` / `mimir.plot.js` | 14.9 / 33.7 KB | 5.0 / 12.5 KB | on demand |
| `mimir.simapi.js` | 19.8 KB | 7.8 KB | on demand |
| `mimir.texapi.js` / `mimir.tex.js` (KaTeX is 268 of the 296 KB) | 10.3 / 295.9 KB | 4.5 / 88.8 KB | on demand |
| **all code** | | **478.7 KB** | **limit 480** |
| `mimir.fonts.js` (data: 4 Computer Modern faces, every scene with text) | 111.7 KB | 84.1 KB | |
| `mimir.texsize / texams / texbold / texitalic / texcal / texfancy / texsans.js` (data: faces a formula may need) | 25.4 / 36.8 / 21.6 / 22.1 / 9.3 / 42.4 / 63.1 KB | 19.0 / 27.8 / 16.3 / 16.7 / 7.0 / 31.9 / 47.4 KB | |
| **all font data** | | **250.3 KB** | limit 280 |

What a scene loads (gzip, sum of its chunks): hello-2d 192.8 KB (`mimir.js` + faces + guide); hello-3d 366.3 KB;
slider-crank (kit) 393.2 KB; the combined scene 552.7 KB (468.6 KB of code: it uses nearly every module). The faces
chunk is 84 KB of that in every case.
DESIGN D13's final targets (base 60 KB, a 3D scene 260 KB) are **not** met: section 6.

| Timing | Measured |
|---|---|
| `check` hello-3d, browser start included | 0.93 – 1.00 s wall (three runs; 0.5 s before the wave: more rules, one more chunk round) |
| `check` of 40 parts × 8 steps in the page | 0.83 s (46 samples, 34 rendered, 16 id passes) |
| `export --mp4`, 542 frames at 1920 × 1080 | 13 s (47 frames/s, 4 pages) |
| `bun test` | 309 s (108 s before: 621 more tests, most of the new ones with a browser) |
| `bun scripts/build.ts` | 0.23 s |

## 4. What the merge changed

### Applied from the clones (each came with a test)
- guide: `src/lib/guide/parse.ts` (an unclosed "(" no longer swallows the next span); its expectations in
  `tests/unit/core/findings.test.ts` and `tests/unit/runtime/kinds.test.ts` (lead-in, parser problems at `st.say`).
- check: `__mimir.query()` on the host and `runQuery` in the check barrel; `examples/hello-3d.scene.js` (the axle
  stopped short of the rod, a stand under it); `tests/e2e/scenes/real/chapters.scene.js` (a black tag on a light
  face); the OCCLUDED line in `tests/e2e/extending.test.ts`; `'unknown'` in the core `Severity` type; `pure: true`
  on the kit's MECH-OPEN rule (now a field of core's `RuleDef`); an `sdf` for `cone`.
- r2d: the text options in `tests/unit/core/hardening.test.ts`.
- cli: `scripts/dev-shot.ts` and its package script are gone; `unimplemented.ts` was not copied.
- tex: its own recipe for sharing faces (below); `katex` in package.json.
- Every engineer's request about `tests/e2e/extending.test.ts:428`: the list of generated barrels is no longer
  absolute (the barrels of the removed modules must be gone, the five base ones present).

### Rejected or replaced
- **anim's stand-in `polyline` in src/r2d** (marked DO NOT MERGE): not merged; r2d's real `polyline` runs
  `examples/verbs.scene.js` unchanged.
- **anim's glyph-by-glyph Write overlay**: removed. r2d's text backend does it natively (`WRITE` in
  `src/r2d/svg.ts`); the overlay re-split the same glyphs and made every scene with a written title load
  `mimir.anim.js`. `write()` now records the reveal only.
- **guide's TEXT-LONG rule**: removed. `src/check/rules-story.ts` owns the code (labels by words and characters,
  captions by characters); it took over the guide's fix for a label made by a span. The limit is
  `s.check({ limits: { labelWords } })`; `s.guide({ maximumLabelWords })` is gone.
- **tex's `texmain` chunk**: removed. The 'main' group (Main Regular / Italic / Bold, Math Italic) is r2d's faces
  chunk, registered under KaTeX's family names; `texbold` / `texitalic` lost the two faces they duplicated. Font data
  went from 334.0 to 250.3 KB.
- **tex's proposal to leave its font chunks out of the ceiling by name**: replaced by a general rule (a chunk that
  is ≥ 90 % embedded binary data is a data chunk with its own limit, `MIMIR_BUDGET_DATA`).
- **kit's `p.on()` / `p.under()`**: moved to `src/r3d` unchanged (DESIGN §5 lists them as general 3D placement, and
  a scene that calls them need not name the kit).
- **cli's own page side for `mimir query`** (boxes, through bridge internals): the CLI's contract was already
  "the viewer's `__mimir.query()` first"; with check merged that path is always taken. The answers are check's
  (measured on solids). Check's query gained what the CLI's had and it lacked: a wrong point name, a point where a
  part is needed, 2D against 3D (`space: 'mixed'`, no distance), contacts of every part. The CLI turns
  `{ error, fix }` into exit 2. The five e2e tests of `cli-real.test.ts` were rewritten against the measured shape.
- **The chunk lists the r2d and anim clones expected** in the e2e tests: superseded by the lists of the merged tree.

### Changed in shared code (regression tests: `tests/unit/integration/merge.test.ts` unless named)
| Change | Why |
|---|---|
| On-demand API chunks (`scripts/build.ts`, `src/host`, `src/index.ts`, `src/cli/commands/export.ts`; `export const lazy = true` in six `index.ts`) | `mimir.js` was 141.1 KB; EXTENDING section 1 has the rule |
| Data chunks have their own budget (`scripts/build.ts`) | embedded faces are not code |
| A kind's own setter wins over a general one of the same name (`src/core/node.ts`) | r2d's general `fit` shadowed `axes.fit` (plot's report) |
| A chapter does not clear a container whose members have not entered (`src/core/model.ts`) | a graph drawn in chapter 2 never appeared |
| Schema type `node` ties an object to the space of what it names (`src/core/model.ts`) | tokens on an edge that ends on a 3D part were drawn somewhere else under `st.zoom` |
| diagram, plot and guide set and measure text with r2d's faces and tables (`FONT_TEXT`, `lineMetrics`) | they used the core's `FONT_SERIF` (a font the machine may not have) and an estimate: labels were centred off by their real width |
| `st.label` asks for the faces chunk (`src/guide`) | a scene whose only text was a label had none |
| kit placements name the parts their mechanism joins | check called the rod on its crank pin a collision |
| `create` / `write` / `uncreate` accept 3D parts (`src/anim/verbs.ts`) | r3d draws a part's edge lines on, then fills; anim still reported API-TYPE (18 errors in look-gallery) |
| `cone`, `extrude`, `lathe`, `sweep` have an `sdf`; `mesh()` soups are measured; `role: 'fluid'` is a housing for check | "not measured" notes and a valve "colliding" with the water it stands in |
| OCCLUDED "never visible" asks whether the part draws anything alone | a `burst` between its bursts was "hidden by other parts" |
| PLACE-NONE: a group of placed members is placed | a group of axis lines and a curve were "a pile at the origin" |
| NO-VISUAL-BEAT / GUIDE-DEAD-AIR: a step that shows something new, or in which something moves with time alone, is a beat (`src/guide/check.ts`) | every one-step fixture and every flow scene warned |
| GUIDE-TARGET: a target whose box has no height is inside the frame; OCCLUDED covers GUIDE-TARGET on the same part | a level dashed line was "outside the frame"; one covered part was reported under two codes |
| Narration lint defaults 25 words / 3 marks / 10 s (`GUIDE_DEFAULTS`) | the project's research notes (W203, W208, W202); the guide had the library's 14 / 2 / 3 and nine examples warned |
| No black outline behind dark text (`BACKSTROKE_FROM`, `src/r2d/svg.ts`) | black numbers on the light neurons of neural-network were smeared blobs |
| The label of a node that is down keeps 0.6 opacity (`DIAGRAM_DEFAULTS.downLabel`) | 0.5 failed CONTRAST-TEXT |
| `st.zoom` margin is documented as a factor (core `api.d.ts`) | it read like frame units |
| `mimir docs reference`; the reference without the module-form block; `mimir init` draws its parts with its title | author notes 2; the starter failed GUIDE-TARGET |

### Examples changed (only what `check` asked for, each a literal fix of the diagnostic)
hello-3d (above) · formula (`glow:legA+legB`: a pointer takes one part) · request-flow (`ring:a+b`, the sentence
split in two) · pendulum, sine-explorer, verbs (the parts are drawn before the title is written, so a named part is
on stage when its word is spoken; dots declared `allow('TINY')`) · slider-crank, hydraulic-press, look-gallery,
guided-tour (declared fits and housings: `allow('OCCLUDED')`, `allow('INTERPENETRATE', other)`,
`allow('MECH-OPEN')` for a rope) · shapes (three hues instead of four).

### Test expectations changed (nothing weakened; each is outdated by another module, and the reason is at the line)
- chunk lists: `tests/unit/{tex/tex,tex/fonts,plot/kinds,r2d/type,r2d/browser}.test.ts`, `tests/e2e/{extending,real-viewer}.test.ts`.
- guide: `tests/unit/guide/check.test.ts` (TEXT-LONG read from check's rule; the strict lint limits are set
  explicitly; the talk-only step is the second step), `guide.test.ts` (`countWords` went with the duplicate rule).
- anim: `verbs.test.ts` (outline verbs on a 3D part; no write records), `morph.test.ts` (`glyphProgress` /
  `glyphStyle` went with the overlay), `viewer.test.ts` (new times inside the same motions: every speaking step is
  0.6 s longer).
- check: `engine.test.ts` (MECH-OPEN is owned by the kit when its rule file was imported; the wording of a wrong
  point), `solid.test.ts` (the "kind without a solid" is a test kind: no public kind is without one any more);
  `tests/e2e/check-rules.test.ts` (OCCLUDED's fix is `st.ghost(wall)`; SAY-LONG beside TEXT-LONG on a 50-word
  caption; the cone fixture is measured and clean; the 3D part of the contrast fixture is white, because a tinted
  part is dark enough for white text under the luminous look).
- `tests/e2e/real-viewer.test.ts`: NO-VISUAL-BEAT beside STATIC-STEP on the talk-only step; the scale-2 times moved
  by the lead-in. `tests/e2e/cli-commands.test.ts`: the last line of `mimir docs`.
- New: `tests/unit/integration/merge.test.ts` (10), two in `tests/unit/cli/docs.test.ts`, "the modules together"
  in `tests/e2e/real-viewer.test.ts`, the scene `tests/e2e/scenes/real/combined.scene.js`.

## 5. Every example, looked at (1280 × 720 sheets, a local evidence folder)

| Example | check | Looks right? |
|---|---|---|
| hello-2d (old engine) | clean | yes: Computer Modern, boxes, arrows on the box edges, caption |
| hello-3d (old engine) | clean | yes: luminous look, labels as text on leaders, focus in step 2 |
| neural-network (old engine) | clean | yes after the backstroke fix (numbers on light neurons were smeared) |
| slider-crank | clean | yes: closest to the look-development sheet (cut liner, focus outline, labels) |
| gear-train, cam-and-valve | clean | yes |
| hydraulic-press | clean | yes; the two labels of step 1 sit above the model on long leaders |
| look-gallery | clean | yes: solid, focus, ghost, cutaway (hatched walls), exploded; the model is small in the frame |
| guided-tour | clean | mostly: `ring` round the two tall posts is two tall thin ellipses |
| formula | clean | yes |
| request-flow | clean | yes: on a par with the hand-built pipeline reel (thin outlines, slots, ring worker) |
| pendulum, verbs, shapes | clean | yes |
| pipe-flow | clean | mostly: in step 3 the pointer rests on the word "throat" of a readout and covers two letters |
| sine-explorer | clean | mostly: in step 3 the pointer rests on the "one period" bracket label |
| combined (tests/e2e/scenes/real) | clean | yes: all five steps, and the offline export |

Small in every sheet: captions and labels are 0.25 / 0.21 units (18 / 15 px at 1280 wide); readable at full size.

## 6. Open problems, in priority order

1. *(Decided since: DESIGN D13 counts what one scene loads; the all-chunks cap is 900 KB.)* **The code budget: 478.7 of 480 KB gzip, and the build fails over it.** The next module, or a few fixes, turns
   `bun scripts/build.ts` red. KaTeX alone is 88.8 KB and three.js with the 3D layer 173.5 KB. This needs the design
   owner: raise the wave ceiling, or count what a scene loads instead of the sum of everything (with on-demand
   modules a scene pays for what it names: 108.7 KB of code for hello-2d, 309.1 KB for slider-crank, 468.6 KB for the
   combined scene, which uses nearly all of it).
2. **D13's final targets are not met**: base 95.1 KB (target 60), a 3D scene 366 KB with faces and guide (target
   260). The faces are 84 KB of every scene with text (four faces in one chunk: Regular alone would do for most
   scenes; one chunk per face is the next step, like tex's groups). The base still holds r3d's pure side (25.7 KB
   min), the anim verbs and the seed player; r3d and the player can go on demand the same way.
3. *(Closed in section 0: stand-ins catch what the scan cannot see, an unreadable source starts with no module, and check loads only the rules of the modules in use.)* **Which on-demand modules a scene uses is read off its source.** A name reached only through computed access
   (`globalThis['ax' + 'es']`) is not seen and the scene fails with "not a function". A scene opened from `file://`
   (not an export) loads every module. Loading the check chunk loads every module's API (rule files import them);
   that is dev only, but it registers their kinds and hooks in that page.
4. *(Autoplay is done in the host, section 0; the chrome is still the seed.)* **Player**: seed only (section 2). The owner's note "a bunch of screenshots, not a video" stands until it
   autoplays; `export --mp4` exists and works.
5. **Two limits for one question.** OCCLUDED wants 60 % of a labelled or pointed-at part visible, the guide's
   GUIDE-TARGET 30 % at the moment a mark lands. Kit assemblies sit at 36 – 59 % for parts inside a cut liner, so
   three examples declare `allow('OCCLUDED')`. A housing as the subject of a label should probably be exempt.
6. **A pointer may rest on text** (pipe-flow, sine-explorer): the guide's perch does not avoid text boxes of other
   objects. **A ring round a thin part** is a thin ellipse (guided-tour).
7. **CONTRAST-TEXT does not know the backstroke**: white text with its black outline on a yellow box is flagged at
   1.1:1 although it reads.
8. **TINY on dots**: a dot that the guide points at is under the 4 % rule by nature; two examples declare it.
   A kind-level "marker" would be the general answer.
9. **`mimir query`**: `--tolerance` and the page side agree, but the CLI's own box-based page side is still in
   `src/cli/pageside.ts` as the fallback for a viewer without `query()`; with check in every build it is dead code.
10. **The check chunk is 48.7 KB and runs every module's rules on every scene**; `check` of hello-3d went from 0.5
    to 0.95 s.
11. Everything in "Open problems after M0.6" that was not about the main-chunk budget still stands (determinism is
    proven for what was shot, on this Chrome; `NOT-PURE` at step ends only; EMPTY-FRAME counts DOM boxes).
12. Open-source audit items (licences, notices, README, hygiene script, the launcher that needs bun): not started.

## 7. Differences from DESIGN.md added by the wave, for the design owner

*(All of these are in DESIGN.md now: it was brought in line with what was built in the pass of section 0.)*

- §10 bundles: `mimir.tex.js` is KaTeX, not Temml; there are 25 chunk files, not 4 (section 3).
- §7: codes that are not in the list: SIM-UNSTABLE (flow / sim), TEX-INVALID, TEX-FONT (tex), SAY-LONG,
  GUIDE-CROWDED, GUIDE-DEAD-AIR, GUIDE-LATE, SAY-SYMBOL, GUIDE-REPEAT (guide), TRAFFIC-COUNT, GRAPH-SHRUNK,
  GROUP-COVERS (diagram), CHAPTER-LONG, COLOR-COUNT (check), NOT-PURE (core). Severity `unknown` exists.
- §6: the pointer is a white dart, hidden while docked; labels are plain typeset text on a leader in the part's
  colour (D14), not pills (§4); every speaking step starts with a 0.6 s lead-in; a span that lands on a part that
  is not on stage yet is an error (`GUIDE-TARGET`).
- §5: added names: `uncreate`, `growArrow`, `rotate`, `count`, `vary`, `timed`, `s.transitions`, `rackPinion`,
  `planetary`, `gearTrain`, `valveLift`, `fourStroke`, `kit.liner / block / flywheel / bolt / camshaft`, `numberLine`,
  `bars`, `matrix`, `guide`, `traffic`, `sequence`, `trail`, `field`, `fillLevel`, `gas`, `colorScale`, `integrate`,
  `rewrite`, `s.check`, `s.guide`, `part.allow`, `st.zoom` margin as a factor. `[words](a+b)` needs a verb that
  takes several parts (ring, glow, focus).
- §8: `mimir examples`, `mimir init`, `mimir docs reference`, `query contacts | probes | coverage`,
  `export --md [--frames]`; `shot --cues`.
- §9: `__mimir.query()`, `info().features`, `info().guide`, `info().r3d`; `?features=` in the page contract.
- D13: see section 6, items 1 and 2.

## 8. Where to plug in

`docs/EXTENDING.md` (built by the test suite) has every recipe; section 1 has the module shape, the four budgets
and on-demand modules. How to verify a module is unchanged from M0.6:
```
bun scripts/build.ts [--where]                         # sizes; fails with the reason
bun test tests/unit/<yours>                            # pure side
bin/mimir check <scene> --text --all                   # diagnostics, exit code
bin/mimir shot <scene> --sheet --out /tmp/x            # then LOOK at /tmp/x/sheet.png
bin/mimir shot <scene> --at 7.3,6.5 --out /tmp/a; bin/mimir shot <scene> --at 6.5,7.3 --out /tmp/b   # same sha256 per time
bin/mimir export <scene> -o /tmp/x.html && bun scripts/offline-proof.ts /tmp/x.html /tmp/x.png
bin/mimir docs reference                               # what an author reads
bun test && bun run typecheck                          # before you report
```

---

# Appendix: history (M0.5 and M0.6, as written then)

## 4. Differences from DESIGN.md, for the design owner

Moved to the contract in this pass:
- **A play lasts 1 s** (`m.to…`, `param.to(v)`: §3.3). It was 2 s. Five unit-test expectations changed with it.
- Everything in §3.4 that is data: `s.chapter(title, { keep })`, `st.note(markdown)`, the transcript.
- `st.zoom(target | null)`, `m.hud()`, `m.pin(part, anchor?, { offset? })` (§5).
- §10 "chunks are chosen after the scene builder has run, from the kinds actually used": true now, for any chunk.

Still different (kept because it is better, or not decided):
- **Objects created inside a step appear at that moment**, not at τ = 0 (§3.2 says "visible from τ = 0" for anything
  without an enter verb). Kept: otherwise a label made in step 3 shows during steps 1 and 2. The same rule now holds
  for chapters: objects created between `s.chapter()` and its first step appear when the chapter opens.
- **A step whose only content is `st.set` lasts 3 s, and any step with a sweep at least 2 s** (§3.3 gives no number
  for a sweep; 1 s is too fast to read a crank turning).
- A chapter opening takes 0.8 s at the start of its first step (0.5 s fade per object, lagged); §3.4 gives no number.
  Cameras reset during it: the 3D camera to the default view fitted over that chapter's steps, the 2D camera to the
  whole frame.
- `m.pin` to a 3D part makes the object a screen-space billboard (like `m.hud()`): the 2D camera does not zoom the
  3D panel, so it does not zoom what is pinned to it. `st.zoom` never moves the 3D panel.
- `m.pointAt(alpha)` walks the object's **outline** by length (for a line or an arrow that is along it). `m.start` /
  `m.end` are the ends of an open outline, the left / right edge otherwise.
- `m.fill()` / `m.stroke()` on an object without that option (a text) is `API-UNKNOWN`; on a group it reaches the
  shapes inside.
- `check` JSON is an envelope `{ ok, errors, warnings, total, shown, diagnostics[] }`; each diagnostic is the §7
  record. Extra flags `--text`, `shot --scale`. Step and chapter numbers are 1-based wherever a person or the CLI
  sees them.
- camelCase rate names are the documented ones; `s.viewport({ x, y, width, height })` is centre + size; extra API
  (`m.set`, `st.camera({ zoom })`, `FRONT`, `BACK`, `ORIGIN`, `PINK`, `ORANGE`, `_A`…`_E` shades).
- `window.__mimir` has `state()`, `clearParam()`, `on()`, `pick()`, `version` beyond §9; `info()` has `chapters`,
  `transcript`, `chunks`, `steps[].chapter` and whatever modules add with `defineManifest`.
- Labels are still pills (§4 and the seed); D14 asks for plain typeset text with a thin leader. That is the guide's.
- Headless Chrome runs with `--disable-partial-raster --disable-gpu-rasterization` (2D raster on the CPU, WebGL on
  the GPU as before): without them the same time gave different antialiasing after different histories. `mimir open`
  uses the person's own browser and is not affected.
- Live reload is injected by the dev server, not owned by the player. The launcher is bun-only (§2 describes a node
  fallback).
- **D13 budget**: see section 8. The 60 KB line for "core + 2D + player" cannot hold the M1 and M2 code as one
  chunk; the engine lets every module ship its weight lazily. The decision is whether the 60 KB applies to
  `mimir.js` or to what a typical scene loads. It is now urgent: 0.3 KB is left and the build enforces the limit.

Added in M0.6 (each is a consequence of a verifier finding):
- **A 2D object placed on a 3D part, or on a screen-space object, is in screen space** (`at(part)`, `nextTo(part)`,
  a line or arrow with such an end, like `pin`): the 2D camera neither moves nor scales it. §5 says this only of
  `m.pin` and `m.hud()`.
- **Beside a 3D panel the 2D camera looks through the rest of the frame**: `st.zoom` fits its target into that
  window and zoomed 2D content is cut at its edge. The magnification is limited to 0.25 … 8. `st.zoom(undefined)` is
  `REF-MISSING` (null is the way back).
- A scene that never becomes ready (an endless loop, a pending top-level await) is a load error of the scene:
  `RUNTIME-ERROR`, **exit 1** (it was a timeout with exit 2). §8 only names the three exit codes.
- JSON additions, all optional and absent when they do not apply: `params` on a diagnostic found with params pinned;
  `stale` + `build_error` on the `check` envelope; `stale` on `shot` manifest entries and on the `export` result.
- `NOT-PURE` is a new code (a dynamic function or probe that gives two answers for the same time); §7 has no code for
  D5's purity rule. `DEAD-PARAM` now means "changes nothing that can be seen": a param read only by a probe, by a
  hidden object, or to less than a hundredth of a unit is dead.
- One play, wait, sweep or camera move lasts at most 300 s (`NUM-INVALID` beyond); `st.clock({ speed })` must not be
  negative; a signal cycle is `RUNTIME-ERROR` at the signal's line and the value is NaN.
- `__mimir.debug(mode)` returns a promise: the debug overlay is loaded with the dev chunk on first use.
- `c.line(…, { px: true })` widths are pixels of a 1280-wide stage and scale with the stage (they were CSS px).
- `FRAME_W` is 128 / 9 exactly (it was 14.2222): a 1280 × 720 stage is 1280 × 720 at 90 px per unit.
- Headless frames are repainted from nothing (the DOM layers are taken out of the stage and put back each frame).

## 7. What changed in M0.5

Per finding of `the build's review notes` (regression test in brackets; `H` = `tests/unit/core/hardening.test.ts`,
`X` = `tests/e2e/extending.test.ts`, `R` = `tests/e2e/real-viewer.test.ts`, `I` = `tests/unit/cli/infra.test.ts`):

| # | Finding | Fix |
|---|---|---|
| 1 | 2D object referring to a 3D part | `Frame.point(v, owner)` / `into` / `boxIn` convert between the three spaces; resolved points carry their space; `project(target, space?)` [H, R] |
| 2 | chunks | `CHUNKS` table in `scripts/build.ts`, `<name>.chunk.ts`, `chunk` on `KindDef`, `model.requireChunk`, generated loaders, the runtime loads `model.chunksNeeded()`, export inlines what was loaded [H, X] |
| 3 | silent overwrite | ledger (`src/core/ledger.ts`): owner per registration, conflicts fail the build, `override: true` [H, X] |
| 4 | stale dist | `dist/build.json` records the set of input files; a different set rebuilds; a failed build falls back to the last good dist with a warning; the build is atomic and removes stale chunk files and barrels; `mimir docs` rebuilds too [I, X] |
| 5 | overlays read the previous frame | `layout(frame, laid)` → rects, then `paint(frame)`; `after` declares the order; `laid.rects()` holds this frame only [H, X] |
| 6 | composite kinds | `model.child` (`parent.part` ids, no counter), setters and clips propagate to the parts that have the channel or report, `textRects`, composite screen rects [H, X] |
| 7 | typed reference | `MobOf<Self>` / `PartOf<Self>` [X] |
| 8 | kind-name switches | `outline` hook; exit points, `pointAt`, `start` / `end` derive from it [H] |
| 9 | 3D backend context | `instanced` / `place`, `line` / `points`, `material(slot, look)`, `defineLook` + `VIEW` + `frame.look`, clipping planes through every material and the id pass [H, X] |
| 10 | id pass | memoised per frame in `Runtime.idPass`, `at` per part, per-part passes read only the part's rectangle, `visiblePoint` [X] |
| 11 | chapters / read mode | `s.chapter`, `st.note`, `st.narration`, `StepRec.chapter`, `defineFinalize`, `defineManifest`, `info().chapters` / `.transcript` [H, R, X] |
| 12 | 2D camera | `frame.camera2d()`, `toScreen` / `fromScreen`, `st.zoom`, `m.hud`, used by project, the stage mapping and every SVG holder [H, R] |
| 13 | 2D renderer | canvas layers between SVG segments (`c.canvas` / `c.begin`), `clip` hook, `c.defs` + `c.uid` [X] |
| 14 | clip channel names | `Step.clip` validates against built-in channels, kind options and look channels [H] |
| 15 | dynamic clip targets | called with `(node, frame)` [H] |
| 16 | EXTENDING.md | rewritten; executable |
| 17 | backend errors without a line | the line of the object being drawn [H, X] |
| 18 | scale limits | `defineInterp(kind \| '*', channel, fn)`; `{ array }` / `{ record }` / `{ object }` schema types; `fix` on overlay rects [H]. Non-uniform scale: deferred |

Also:
- **Determinism.** The new test found two real defects that M0's scenes never triggered. (a) The edge lines of a
  fading 3D part were drawn solid or faded depending on what had been shown before: three compiles an opaque
  material with alpha forced to 1, and the edge material changed `transparent` without `needsUpdate`. Fixed in
  `src/r3d/three.ts`. (b) Headless Chrome patched raster tiles over the previous frame and cached GPU paths at the
  scale of earlier frames: up to 40 px differed by a few levels after a different history. Fixed with two browser
  flags (`src/cli/chrome.ts`).
- Module-level code now gets a scene line under bun (stack frames without a column are parsed).
- OFF-FRAME no longer reports 2D objects that the 2D camera has zoomed out of view (hud objects and 3D parts are
  still held to the frame); `chapters.scene.js` has an object that would trip it.
- A named second material given as a preset name multiplies its opacity into the part's, like one given as numbers.
- `src/check/index.ts` no longer puts the sampling plan into the core (`src/check/plan.ts`, check chunk).
- Tests whose expectations changed: five in `tests/unit/core/{timeline,rate}.test.ts` (2 s → 1 s play); one in
  `tests/unit/cli/infra.test.ts` (it forbade any flag containing `disable-gpu`; it now forbids disabling the GPU
  and requires the two raster flags). Nothing was deleted.

## 7b. What changed in M0.6

Per finding of the two verifier reports (regression test in brackets; `F` = `tests/unit/core/findings.test.ts`,
`R` = `tests/e2e/real-viewer.test.ts`, `X` = `tests/e2e/extending.test.ts`, `I` = `tests/unit/cli/infra.test.ts`,
`C` = `tests/e2e/cli.test.ts`, `K` = `tests/unit/runtime/check.test.ts`). Every finding was reproduced first, with
the verifier's command where there was one.

Break-it run:

| # | Finding | Root cause → fix |
|---|---|---|
| 1 | shots depend on the order (major) | three causes, see "determinism" below [R, X] |
| 2 | narration spans not validated (major) | nothing looked at them. The core checks every span when the scene is built (`GUIDE-TARGET`, `API-UNKNOWN` against `defineSpanVerb`); the seed parser no longer lets an unclosed span swallow the next one and reports it [F] |
| 3 | async builder / step silently truncated (major) | the return value was dropped. A promise is `API-TYPE` at the `scene()` / step line; a closed step and a finalised model ignore and report late calls (`model.late`) [F] |
| 4 | diagnostics at a param extreme do not say so (major) | the sample's params never reached the report. The engine adds the clause, `params` and the repro command; OFF-FRAME gives a fix about the param there; NUM-INVALID / RUNTIME-ERROR from a frame with pinned params say it themselves [F, R] |
| 5 | `st.zoom` beside a 3D panel breaks the frame, check OK (major) | 2D objects on a 3D part were in the zoomed 2D world, and the zoom used the whole frame. They are screen objects now (`settleSpaces`), the 2D camera has a window (`model.area2d`), zoomed 2D content is clipped to it, zoom is bounded [F, R] |
| 6 | a scene that imports JSON cannot be exported | only `.js` was embedded. JSON modules become script modules (`export default …`), the import attribute is dropped; a `fetch` of a file gets an error that says what to do [R] |
| 7 | an endless loop exits 2 with a browser timeout | the blocked page could not answer. Timeouts while waiting for ready become `info.fatal` → one RUNTIME-ERROR, exit 1 [R, C, I] |
| 8 | `shot --set` values and `--debug` not validated | checked against `info().params` (kind, range, options) and the three modes [R, I, args] |
| 9 | shot / export silent about scene errors; `-o <dir>` internal error | a warning on stderr and in `warnings`; a usage error before any work; the draft is removed unless it is the file that failed its own check [R] |
| 10 | params named like Object members are NaN | `in` on plain objects. `Object.hasOwn`, null-prototype records; an empty id is `API-TYPE` [F] |
| 11 | `ramp()` / `bezier()` throw; `st.narration` with a node kills the CLI | no validation. Both report and return something usable; narration records plain strings; a manifest value that is not JSON is reported by key (that last part: pure side only, section 8) [F] |
| 12 | impure functions, signal cycles, negative clock | `NOT-PURE` (two fresh frames per step end, compared); a signal cycle is named at the signal's line; `speed < 0` is `NUM-INVALID` [F] |
| 13 | silent accepts | unknown `scene()` options, durations over 300 s, focus / label on something hidden (GUIDE-TARGET warn), scale 0 through a function, `between(a, a)`, a torus that closes on itself, `st.zoom(undefined / hud / NaN / empty rect)`, DEAD-PARAM for what cannot be seen, a fix on every RUNTIME-ERROR, EMPTY-FRAME naming the part that is far away [F, K] |
| 14 | a failed build answers `ok: true` from stale code | `stale` + `build_error` on stdout for check, `stale` on shot entries and the export result; a file that does not parse is named with its line [X] |
| 15 | the stage is 1279 × 719 | `FRAME_W = 14.2222`. Exact 128 / 9 [F, R, X] |
| 16 | SIGKILL leaves a profile directory | nothing can run then. The next launch removes `mimir-chrome-*` older than 10 minutes that no process mentions [I] |
| 17 | the solids perf test fails under load | a wall-clock limit with 10% margin. Best of 7 of min(wall, CPU), asserted relative to a yardstick measured in the same process; the absolute 50 ms only with `MIMIR_PERF=1` |

Extend-it run:

| # | Finding | Root cause → fix |
|---|---|---|
| 1 | a library used by a chunk and an `index.ts` lands whole in `mimir.js` (major) | the bridge published whole files. Names are bridged one by one, and `src/lib/**` (pure) is copied into the chunk that imports it. The build fails over a budget [X] |
| 2 | a view mode on a composite or group does nothing (major) | `Frame.look` read the node's own channel only. `lookValue`: own, else the parent's, else the scene's [F] |
| 3 | `st.zoom` on a target placed on a 3D part: garbage camera (major) | the camera was resolved from bounds that needed the camera, in the same memo. Such targets are screen objects and are reported at the `st.zoom` line; the targets are measured in a scratch frame whose 2D camera is the identity [F] |
| 4 | the explode recipe cannot read where its part is (major) | `world(node)` inside its own `offset` is a cycle. `frame.rest(node)`; the recipe in the document is built and shot (`st.spread`) [F, X] |
| 5 | `z` not inherited by the parts of a composite (major) | sorted by own `z`. `frame.z(node)` adds the ancestors' [F] |
| 6 | `st.focus` leaves the body of an unfocused composite bright (major) | the selector skipped nodes with children. It skips containers only [F] |
| 7 | a nullable number becomes NUM-INVALID and 0 (major) | `typed()` did not know the spec. null stays null [F] |
| 8 | 3D code cannot have a lazy chunk (major) | one chunk name per kind, and only `three.ts` could import three. `chunk: string \| string[]` with `'3d'` always added; a module's chunk may import three (shared with the 3D chunk by name, loaded after it); a scene with 3D parts and no 3D renderer is a RUNTIME-ERROR (that last part is not exercised, section 8) [X, hardening] |
| 9 | the docs test breaks with any other module that has a chunk (major) | absolute expectations. It measures what the document's module adds to the tree it is built on [X] |
| 10 | instances beyond the capacity dropped | `Math.min(items, capacity)`. `place()` makes room [X] |
| 11 | a part cannot opt out with the rest value; typos on VIEW | "rest" meant "inherit". A part that has the channel decides, whatever the value; VIEW clips and view channels on 2D objects are validated [F] |
| 12 | no tweenable setter for one kind | `defineKindSetter(kind, name, fn)` + `MobOf<Self, To>` [F, X] |
| 13 | a canvas kind ignores shift and offset | `begin()` did not apply the node's transform [X] |
| 14 | chunk naming unenforced | the build fails on a `*.chunk.ts` it would leave out and on a kind naming a missing chunk; the runtime error names the kind [X] |
| 15 | TEXT-OVERLAP prints a part id as code | the fix names the composite the author made [X] |
| 16 | a setter's patch split across a composite; style schema not exported | `model.route` sends the whole patch to the objects that have its first channel; `STYLE` is exported from r2d [F] |
| 17 | a finalize hook builds action records by hand | `model.addAction` (and `st.action` uses it) [F] |
| 18 | `px` lines ignore the stage size | widths are pixels of a 1280-wide stage. Measured with the verifier's script: 6 px at 1280, 12 device px at 2×, 3 px at 640, 9 px at 1920 (no automated test) |

**Determinism** (break-it 1). The verifier's pair (`--at 7.3,6.5` against `--at 6.5,7.3`) reproduced with its hashes.
Three independent causes, found by shooting 24 to 40 pseudo-random times ascending, descending and shuffled:
1. *Label pills and the caption at fractional positions* (`will-change: transform`, `translate(123.45px)`): the
   browser composites such an element from the raster of where it was in the frame before. Fixed in the guide: `left`
   / `top` on whole device pixels (`c.snap`), no `will-change`.
2. *The browser's own repaint*: a rectangle that moved by 0.009 px between two shots (`hello-2d`, t = 11.66 and
   11.7) kept the antialiased rim of its previous position: 532 px differed by up to 8 levels although the DOM was
   identical; hiding and showing the SVG restored the right pixels. Neither Chrome flag of M0.5 prevents it. Fixed
   in `Runtime.render`: a headless frame takes every DOM layer out of the stage and puts it back, which invalidates
   all of their pixels. No measurable cost (section 3).
3. *Label elements in creation order*: a pill was appended when its label was first shown, so which of two
   overlapping pills was on top depended on which had been seen first (found at `--scale 2`). They are inserted in
   story order now.

Tests whose expectations changed (nothing deleted): the signal-cycle test in `tests/unit/core/signals.test.ts` (it
expected the cycle to count as undefined; now NaN and a diagnostic); the DEAD-PARAM test in
`tests/unit/runtime/check.test.ts` (a probe-only param was alive); the zoom test in
`tests/unit/core/hardening.test.ts` (a text beside a hud object was zoomed; the `chunk` field of a kind is now
`chunks`); the chapters test in `tests/e2e/real-viewer.test.ts` (the zoomed rectangle was centred on the frame, now
on the 2D window); the hang test in `tests/e2e/cli.test.ts` (exit 2 → exit 1 with a diagnostic); the `--debug`
message in `tests/unit/cli/args.test.ts`; two shape tests in `tests/unit/cli` (new optional fields).

