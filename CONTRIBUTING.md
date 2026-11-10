# Contributing to Mimir

Thank you for helping. This file covers setup, how the code is organised, how to test, the hygiene rules every
change must keep, and how to add an example. The design contract is [docs/DESIGN.md](docs/DESIGN.md); the recipes
for extending the engine are in [docs/EXTENDING.md](docs/EXTENDING.md); the current state is
[docs/STATUS.md](docs/STATUS.md). [AGENTS.md](AGENTS.md) holds the same conventions in the short form that people
and coding agents read before they change the engine; where this file and AGENTS.md disagree, that is a bug in one
of them.

## Setup

You need [bun](https://bun.sh) (the project is developed with 1.3.11) and a Chrome-family browser for the
end-to-end tests. ffmpeg is optional: the video tests are skipped without it. Nothing else: no global packages, no
API key.

```sh
git clone https://github.com/CodeWithInferno/mimir.git && cd mimir
bun install
bun scripts/build.ts          # builds dist/ and prints the size of every chunk against its budget
bun run typecheck
bun test                      # unit + end-to-end; about six minutes on an idle machine; needs the browser
bun run hygiene               # the mechanical check of docs/OSS-HYGIENE.md
bin/mimir check examples/hello-2d.scene.js --text     # prints: OK 0 errors, 0 warnings
```

If the browser is somewhere unusual, set `MIMIR_CHROME=/path/to/chrome`. A run without a browser has not tested
your change. The suites clear `MIMIR_CHROME_ARGS` and `MIMIR_TIMEOUT` from the environment of the commands they
start; a machine that needs browser flags (no GPU, no user namespaces) sets `MIMIR_TEST_CHROME_ARGS` and
`MIMIR_TEST_TIMEOUT` instead (`tests/support/env.ts`; not every suite reads them yet).

Platforms: macOS is what the project is developed and tested on. Linux has browser discovery and a CI job that has
not run yet. Windows is untested: discovery, a `bin\mimir.cmd` launcher and process handling are written for it and
have never been run there, and the end-to-end tests use `ps` and shell scripts. Patches and reports are welcome.

## How the code is organised

```
bin/mimir        launcher: runs src/cli/main.ts with bun (bin/mimir.cmd on Windows)
src/core/        signals, params, time, nodes, registries, schema validation, diagnostics, timeline
src/r2d/         SVG backend, the 2D kinds, the embedded faces    src/r3d/   three.js backend, 3D kinds, view modes
src/anim/        verbs                                            src/guide/ narration, pointer, labels, captions
src/kit/         parametric parts and mechanisms                  src/plot/  axes, plots, readouts
src/diagram/     nodes, edges, graph layout, tokens               src/flow/  particle flows       src/sim/  ode, events
src/tex/         typeset mathematics (KaTeX)                      src/check/ the diagnostics engine and rules
src/player/      the viewer's controls                            src/host/  the page-side protocol (window.__mimir)
src/cli/         commands, headless browser driver, local server, agent adapters
src/lib/         pure libraries (no DOM, no three.js, no bun or node APIs)
scripts/         build.ts, offline-proof.ts, hygiene.ts           types/     the typed reference (generated)
examples/        scenes: documentation, gallery and regression tests at once
tests/unit       pure modules                                     tests/e2e  the real CLI against a headless browser
```

### Module conventions

A feature is a directory under `src/`. The build script finds a module's files by name; you never edit a shared
file to register something.

| File | Goes into | Contains |
|---|---|---|
| `src/<module>/index.ts` | the main chunk, or the module's own API chunk `dist/mimir.<module>api.js` when it says `export const lazy = true` (loaded before a scene that uses one of its names) | public API functions, kind definitions (schema, anchors, bounds, outline), verbs. Must not import three.js or touch the DOM when imported. Exports `api`, the public names. |
| `src/<module>/three.ts` | the lazy 3D chunk | three.js backends of the module's 3D kinds |
| `src/<module>/check.ts` | the lazy check chunk (development only, never exported) | check rules |
| `src/<module>/<name>.chunk.ts` | its own lazy chunk `dist/mimir.<name>.js` | heavy code: backends, layout engines, parsers. The name is lowercase letters and digits. |
| `src/<module>/api.d.ts` | `types/mimir.d.ts` | the typed reference of the module's public names, one line of JSDoc each |

- Everything registers itself: `defineKind`, `defineKindBackend`, `defineVerb`, `defineStepAction`, `defineRule`,
  `defineOverlay`, `defineLook` and the others listed in `docs/EXTENDING.md`. Every recipe in that file is built
  and run by `tests/e2e/extending.test.ts`, so it is true.
- Names are owned. Registering a name another module registered fails the build and names both files; pass
  `override: true` to replace a definition on purpose.
- Size is budgeted (KB gzip, the limits are named at the top of `scripts/build.ts` and each has an environment
  override): the main chunk, the main chunk with the 3D chunk, all code together, and embedded font data.
  `bun scripts/build.ts` prints every chunk against its budget. **Over a budget the build fails.** Keep `index.ts`
  to constructors, schemas, bounds, anchors and outlines; put the rest in a chunk.
- `src/lib/**` is pure: plain arrays for vectors (`Vec2`, `Vec3` from `src/lib/types.ts`), unit tests in
  `tests/unit/lib/`.

### Rules that are easy to break

- **Time is an input.** Nothing that affects pixels may read `Date.now`, `performance.now` or `Math.random`, or
  depend on how many frames were rendered before. To prove it, shoot the same times in two different orders and
  compare the hashes: `bin/mimir shot <scene> --at 2,5,2` must print the same sha256 for both frames at 2.
- **API calls never throw on bad input.** Report a diagnostic with a fix, return an inert placeholder, keep going.
  One bad line must not blank a scene.
- **Degrees** in every public API. The 2D frame is 14.222 by 8 units, origin at the centre, y up. 3D is y up.
- **One documented way to do each thing.** Option names are full words (`radius`, `width`, `height`, `depth`).
- **Report "unknown", never "pass"**, for anything a rule did not actually measure.
- **One owner per name and per finding.** A second module that draws or reports the same thing is a duplicate to
  remove. Text on the stage is set in the embedded faces (`FONT_TEXT`, `lineMetrics` from `src/r2d`), never in a
  font the machine may or may not have.
- Anything visible: render it and look at the PNG. Diagnostics do not catch ugly.

## Tests

```sh
bun test                         # everything
bun test tests/unit              # pure modules, no browser, a few seconds
bun test tests/e2e               # the real CLI and viewer against a headless browser
bun run typecheck                # tsc over src, tests and scripts
bun scripts/build.ts             # also the size check
```

- Every pure module has unit tests. Every command, rule or kind has an end-to-end assertion: add a scene under
  `tests/e2e/scenes/real/` and an assertion in `tests/e2e/real-viewer.test.ts`.
- A bug fix comes with a test that fails without the fix.
- Tests write only under the operating system's temporary directory (`os.tmpdir()`, never a literal `/tmp`) and
  remove what they wrote. A test never asserts a wall-clock time as it is: timing targets are asserted with
  `MIMIR_PERF=1` and with generous room otherwise.
- Never weaken or delete a test to make a change pass. If an expectation is wrong, say so in the pull request.
- Say what you ran. A pull request description lists the commands that were run and their result, and says what
  was not verified.

## Hygiene rules

Mimir must give the same result on anybody's machine, with anybody's tools. The full text is
[docs/OSS-HYGIENE.md](docs/OSS-HYGIENE.md); `bun run hygiene` (`scripts/hygiene.ts`) checks what can be checked
mechanically and runs in CI and in `bun test`. An exception is an entry in `scripts/hygiene.allow.json` with a
reason; an entry marked `"pending": true` is a known violation that waits for its owner, and
`bun run hygiene:strict` fails on those. In short:

1. **No machine.** No absolute paths, user names, home directories or host names in source, tests, examples or
   documentation. Paths come from `import.meta`, the working directory, environment variables or the OS temporary
   directory. No fixed port without a fallback to a free one.
2. **No external tool assumed.** The browser is discovered per platform and `MIMIR_CHROME` overrides it; a missing
   tool is a clear message that says how to fix it. ffmpeg is optional. Fonts are embedded, never assumed installed.
3. **No AI vendor.** The engine never calls a model. Generation goes through an adapter chosen by flag, environment
   variable or configuration; model names live only in documented, overridable adapter defaults. No keys in the
   repository. Nothing phones home. Exported files make no network request.
4. **No topic.** Engine code never special-cases a scene, an id, a title or a subject. If an example needs
   something, the engine gets a general feature.
5. **No magic number.** Every constant that shapes output (durations, sizes, colours, thresholds, sampling plans)
   is a named default in one place, documented and overridable.
6. **No faked result.** What a scene shows is computed by the scene. Anything shown in the README or a gallery is
   reproducible with one documented command from files in this repository.

Also: no generated files or media in git (`dist/`, frames, videos, `node_modules/`), no personal data, no secrets,
and every third-party asset or ported algorithm is added to [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) in
the same pull request.

## Adding an example

Examples are what new users read first and what agents copy from, so the bar is higher than for a test scene.

1. Create `examples/<name>.scene.js`. Use only the public API (`import { ... } from 'mimir'`); if you need
   something the API lacks, that is a feature request for the engine, not a workaround in the scene.
2. Compute what you show. A simulation is simulated, a mechanism moves by its kinematics, a count is counted.
   Randomness comes from `s.rng(seed)` only. Expose the numbers that matter with `s.probe(name, fn)` so that they
   can be asserted.
3. Start the file with a comment of a few lines: what it explains, the story in one line, and what is computed.
4. Run the loop until it is clean and looks right:
   ```sh
   bin/mimir check examples/<name>.scene.js --text        # must print OK 0 errors, 0 warnings
   bin/mimir shot examples/<name>.scene.js --sheet --out .mimir/shots/<name>    # look at sheet.png
   bin/mimir shot examples/<name>.scene.js --at 2,5,2 --out .mimir/shots/<name>-det   # the two frames at 2: same sha256
   bin/mimir export examples/<name>.scene.js -o .mimir/<name>.html && bun scripts/offline-proof.ts .mimir/<name>.html .mimir/<name>.png
   ```
5. Put it under test: every file in `examples/` is checked clean by `tests/e2e/check-rules.test.ts`; assert its
   probes in a test of the module it shows if it has any.
6. Add a row to the gallery table in `README.md`. The three commands above the table regenerate its video, its
   interactive file and its frames; do not commit any of them.

## Pull requests

- One change per pull request. Keep generated files (`src/_generated/`, `types/mimir.d.ts`) in sync by running
  `bun scripts/build.ts` before you commit.
- Fill in the pull request template: what changed, how it was verified, what was not.
- Commit messages: imperative mood, what and why. No tool or assistant attributions in commit metadata.
- By contributing you agree that your contribution is licensed under the MIT licence of this project.
- Be kind. The [code of conduct](CODE_OF_CONDUCT.md) applies everywhere the project is discussed.

## Reporting bugs and security issues

Bugs and feature requests: open an issue with the template. Security issues: do not open a public issue; follow
[SECURITY.md](SECURITY.md).
