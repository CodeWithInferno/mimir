# Command line reference

```
mimir <command> [options]
mimir --help            mimir <command> --help            mimir --version
```

`mimir --help` and `mimir <command> --help` are generated from the same table the parser uses and are always
current; this page adds what the help text has no room for.

| Command | What it does |
|---|---|
| `check` | run the scene headless and print its diagnostics |
| `shot` | render PNG frames, story sheets and filmstrips |
| `open` | local server with live reload; opens the browser |
| `export` | write one self-contained HTML file, a video, or the transcript as an article |
| `docs` | exact lookup in the typed reference |
| `examples` | list the example scenes; print the source of one |
| `init` | write a starter scene to edit |
| `query` | measure the scene: distances, contacts, bounds, visibility, state, probes |
| `new` | generate a scene from a prompt with a headless coding agent |
| `serve` | the player's home page and a small local API (scenes, new, export) on 127.0.0.1; `mimir serve --help` |
| `skill` | install the skill for a coding agent, regenerate or check its API reference; `mimir skill --help` |

## Conventions

- **stdout carries the result only; logs go to stderr.** You can pipe stdout into a JSON parser.
- **Output format**: compact JSON when stdout is not a terminal or with `--json`; readable text on a terminal or
  with `--text`. An agent that wants to read text must pass `--text`. `mimir docs` is the exception: text unless
  `--json` is given.
- **Exit codes**: `0` success and no errors in the scene; `1` the scene has at least one error; `2` wrong usage or
  an internal failure. Interrupted by a signal: `130` (SIGINT), `143` (SIGTERM), `129` (SIGHUP).
- **Paths** are relative to the directory you run the command in. A scene can live anywhere; its relative imports
  work, and `import … from 'mimir'` is resolved by the viewer.
- **The viewer** (`dist/`) is built on demand and rebuilt when the engine's sources change. If the build fails,
  the last good build answers, every result is marked `stale`, and a warning with the build error goes to stderr.
- **The browser** is started headless with a throwaway profile for each command and is ended with the command,
  also on Ctrl+C.

## mimir check

```
mimir check <scene> [--all] [--json | --text]
```

| Flag | Meaning |
|---|---|
| `--all` | print every diagnostic. Default: at most 8, errors first |

Text form, one block per diagnostic, then a summary line:

```
API-UNKNOWN error | #a | examples/broken.scene.js:8
  what: rect() has no option "widht".
  fix: use "width". Valid options: id, opacity, width, height, radius, color, fill, fillOpacity, stroke, strokeWidth, dashed.
FAIL 4 errors, 0 warnings
```

A clean scene prints `OK 0 errors, 0 warnings`. Diagnostics found while the story is sampled also carry
`step <k> "<title>"` and the story time. JSON form: `{ ok, errors, warnings, total, shown, diagnostics: [{ code,
severity, step, t, ids, file, line, measured, limit, what, fix }] }`.

Exit `0` when there is no error (warnings do not fail), `1` otherwise.

Every rule, what it measures, its threshold and its exemptions are in
[`src/check/RULES.md`](../src/check/RULES.md). Thresholds are named limits: a scene changes one with
`s.check({ limits: { name: value }, off: ['CODE'] })` and exempts one object with `part.allow('CODE')`.

## mimir shot

```
mimir shot <scene> [--steps | --step 2 | --at 1.5,3 | --at crank=90 | --cues | --fine 2:4:12]
                   [--set name=value ...] [--views iso,front,top | --turntable] [--sheet] [--cols n]
                   [--debug ids] [--size 1280x720] [--scale 1] [--out dir]
```

| Flag | Meaning | Default |
|---|---|---|
| `--steps` | the end state of every step | this is the default mode |
| `--step 2` | the end state of step 2 (steps are numbered from 1) | |
| `--at 1.5,3` | exact story times in seconds; a time may repeat | |
| `--at crank=90` | the moment the story brings a parameter to a value | |
| `--cues` | one frame per guide cue of the narration, when its mark has landed (writes a sheet) | |
| `--fine 2:4:12` | a filmstrip: 12 evenly spaced frames from 2 s to 4 s, to judge motion (writes a sheet) | |
| `--set name=value` | pin a parameter; repeatable; `true` / `false` for toggles | the scene's values |
| `--views iso,front` | render every frame from each named 3D view | the story's camera |
| `--turntable[=n]` | render every frame from n camera angles around the subject | 8 |
| `--sheet` | also write one story sheet: a captioned cell per frame, a row per chapter | off |
| `--cols n` | columns of the sheet | as many as keep a cell readable |
| `--debug ids` | `ids` = every part outlined in its own colour with a legend; `boxes`; `safe` = the safe area | off |
| `--size 1280x720` | frame size in CSS pixels | `1280x720` |
| `--scale 2` | device scale factor; PNG pixels = size × scale | `1` |
| `-o, --out dir` | output directory | `.mimir/shots/<scene name>` under the working directory |

Written to the output directory: one PNG per frame, one `<frame>.probes.json` with the parameter values and the
scene's probes at that moment, `manifest.json`, and `sheet.png` with `--sheet`. stdout is the manifest:
`[{ path, step, title, t, camera, width, height, sha256 }]`, the sheet last.

The same story time gives the same `sha256`, whatever was rendered before it, in the same browser on the same
machine. Hashes are not promised to match across browsers, GPUs or operating systems.

If the scene has errors, a warning on stderr says how many and the frames show what could still be built; the exit
code is still `0`. `shot` renders, `check` judges.

## mimir open

```
mimir open <scene> [--port n] [--no-open]
```

Starts a local server with live reload and opens the scene in your default browser. Runs until interrupted. A
reload keeps the story time, the camera you dragged and the sliders you moved.

| Flag | Meaning | Default |
|---|---|---|
| `--port n` | port to listen on | `MIMIR_PORT` when set, otherwise **any free port** (the address is printed) |
| `--no-open` | do not launch the browser; just print the address | launches it |

There is no fixed default port. A port that was asked for and is taken is an error (exit 2) that says so.

stdout is the address (text) or `{ "url", "port", "scene" }` (JSON). The server:

- listens on `127.0.0.1` only;
- answers only requests whose `Host` header is its own loopback address (`127.0.0.1`, `localhost` or `[::1]` with
  its port); anything else gets `403`, so a web page that points a foreign name at your machine cannot read from it;
- serves the viewer and the directory of the scene file, and from them only files of web types (code, JSON, CSS,
  images, fonts, sound, video, text and CSV); `MIMIR_SERVE_EXTENSIONS=glb,bin` adds extensions;
- never serves a dot file or anything inside a dot directory (`.env`, `.git/`), nor a path outside those two
  directories, also not through a symbolic link.

Read [SECURITY.md](../SECURITY.md) before opening a scene you did not write.

## mimir export

```
mimir export <scene> [-o out.html] [--mp4 out.mp4] [--md out.md [--frames]] [--set name=value ...]
```

At least one of `-o`, `--mp4`, `--md`; they can be combined in one run.

| Flag | Meaning | Default |
|---|---|---|
| `-o, --out file` | the HTML file: the scene, the chunks of the engine it uses, the fonts it loads, all inline. It carries a content security policy that forbids every network request, and the command opens the written file from `file://` to verify that it runs | |
| `--fonts used\|all` | HTML: embed the font files this scene loads, or every font of the viewer | `used` |
| `--mp4 file` | a video: every frame is rendered by seeking the story and piped to ffmpeg (H.264, yuv420p) | |
| `--fps n` | video frames per second | 30 |
| `--size WxH` | video frame size (even numbers); frame size of `--md --frames` | 1920x1080; 1280x720 |
| `--crf n` | video quality, x264 constant rate factor 0 to 51, lower is better | 16 |
| `--from t`, `--to t` | video range in story seconds | the whole story |
| `--jobs n` | browser pages that render video frames in parallel (the frames do not depend on it) | 4 |
| `--md file` | the transcript as markdown: chapters, steps, narration, notes | |
| `--frames` | with `--md`: a frame image per step, written next to the file | off |
| `--set name=value` | pin a parameter; repeatable | |

A video is rendered in parts of 150 frames, each a finished file in `<file>.parts/` until they are joined (without
encoding again) and the folder is removed. Progress goes to stderr every five seconds (frame, share, rate, time
left). A frame whose seek or screenshot does not come back within `MIMIR_TIMEOUT` is tried again on a fresh page,
three times in all; then the run stops with exit 2, names the frame and the slow step, and keeps the finished parts:
the same command continues from them (parts are reused only for the same scene file, build, size, rate, quality,
range and `--set`). A scene that throws in a frame fails at once. The JSON result carries `timing` (seconds, frames
rendered, resumed and retried, the slowest frame with its seek and screenshot times).

Video needs ffmpeg: `MIMIR_FFMPEG`, else `ffmpeg` on `PATH`. Without one, `--mp4` exits 2 before any browser starts
and says how to install it; HTML and markdown export do not need it. One module (`src/cli/video.ts`) finds ffmpeg
for the whole CLI.

To prove that an exported file is self-contained with the network switched off:

```sh
bun scripts/offline-proof.ts out.html proof.png
```

## mimir docs, examples, init

```
mimir docs [symbol|module|topic] [--json]
mimir examples [name]
mimir init <name> [-o dir] [--force]
```

- `mimir docs` lists every public name by module. With a symbol it prints the declaration, its description and
  where an example uses it: `mimir docs circle`, `mimir docs Step.say`. With a module (`core`, `r2d`, `kit` …) it
  prints that module's declarations one line each; `mimir docs reference` prints every module that way.
- `mimir examples` lists the example scenes with their titles; `mimir examples <name>` prints the source of one.
- `mimir init <name>` writes a starter scene `<name>.scene.js` that passes `check`.

## mimir query

```
mimir query <scene> distance <a> <b> | contacts [id] | bounds <id> | visible <id> | state | probes
                    [--at t | --at name=value | --step k] [--set name=value ...] [--tolerance x]
```

Measures the scene at a moment (default: the end of the last step) and prints JSON; every answer says what it was
measured from. An id may name a point of a part: `piston.top`. A wrong id is exit 2 with the nearest name.

## mimir new

```
mimir new "<prompt>" [-o dir] [--agent name] [--model m] [--max-turns n] [--budget-usd x] [--system file]
                     [--resume id] [--timeout s]
```

Generates a scene by running the write, check, shot, look loop through an agent adapter. The engine never calls a
model: an adapter only knows how to start one headless agent as a local process and how to read its output.

- The adapter is chosen with `--agent`, else `MIMIR_AGENT`, else the built-in default (see `mimir new --help` for
  the names). `--agent command` runs the command in `MIMIR_AGENT_COMMAND` with the request in its environment, so
  any agent can be used without changing the engine.
- `--model` / `MIMIR_MODEL` override the adapter's default model; `--max-turns` and `--budget-usd` bound the run.
- Authentication is the agent's own business; Mimir reads, stores and forwards no credential. What the agent sends
  to its own service (your prompt, the scene) is between you and that agent.
- stdout is NDJSON: one progress event per line, the last line `{"event":"result", ok, scene, …}`. When the agent
  stops, `mimir new` runs `mimir check` on the scene itself: exit `0` only when a scene was written and has no
  error, `1` when the agent failed or the scene has errors, `2` for usage or setup (no agent installed, no system
  prompt file).

## Environment variables

| Variable | Meaning | Default |
|---|---|---|
| `MIMIR_CHROME` | the browser binary to drive. If set and the file does not exist, that is an error, never a fallback | discovered: Google Chrome, Chromium, Microsoft Edge, Brave; on Linux and Windows `PATH` first, then the usual install locations |
| `MIMIR_CHROME_ARGS` | extra flags for the browser: plain flags separated by spaces, or a JSON array (`["--flag", "--dir=/a path"]`) when an argument holds a space | none |
| `MIMIR_FFMPEG` | the ffmpeg binary for `export --mp4` | `ffmpeg` on `PATH` |
| `MIMIR_TIMEOUT` | milliseconds a scene may take to become ready, and each later call to the page | `30000` |
| `MIMIR_PORT` | port of `mimir open` when `--port` is not given | any free port |
| `MIMIR_SERVE_EXTENSIONS` | file extensions the local server hands out besides its list, separated by commas | none |
| `MIMIR_VIEWER_ROOT` | directory with a `viewer.html` to use instead of the built `dist/` | `dist/` of the checkout |
| `MIMIR_EXAMPLES`, `MIMIR_TOPICS` | directories `mimir examples` and `mimir docs <topic>` read | `examples/`, `docs/topics/` of the checkout |
| `MIMIR_AGENT`, `MIMIR_AGENT_COMMAND`, `MIMIR_AGENT_BIN`, `MIMIR_MODEL`, `MIMIR_MAX_TURNS`, `MIMIR_MAX_USD`, `MIMIR_GEN_SYSTEM` | `mimir new`: the adapter, the command of the `command` adapter, the agent's binary, the model, the limits, the system prompt file | see `mimir new --help` |
| `MIMIR_BUILD_STRICT` | `0` makes a size-budget overrun a report instead of a build failure | strict |
| `MIMIR_BUDGET_CORE`, `MIMIR_BUDGET_WITH3D`, `MIMIR_BUDGET_ALL`, `MIMIR_BUDGET_DATA` | the size budgets of `scripts/build.ts`, KB gzip | 120, 320, 900, 280 |
| `MIMIR_DEBUG` | any value: print a stack trace with an internal error | off |
| `MIMIR_BUN` | Windows launcher only (`bin\mimir.cmd`): the bun executable | `bun` on `PATH` |
| `BUN_INSTALL` | where the POSIX launcher looks for bun when it is not on `PATH` | `~/.bun` |
| `TMPDIR` | where throwaway browser profiles are created | the system temporary directory |

For the tests only: `MIMIR_TEST_CHROME_ARGS` and `MIMIR_TEST_TIMEOUT` are passed to the CLI as `MIMIR_CHROME_ARGS`
and `MIMIR_TIMEOUT` by the end-to-end suites that use `tests/support/env.ts` (a CI runner without a GPU needs
them); `MIMIR_PERF=1` asserts the absolute timing targets of the pure libraries; `MIMIR_HYGIENE_NAMES=a,b` adds
names that `bun run hygiene` must not find in any file.

Mimir reads no configuration file, writes nothing outside the output directory you name (default `.mimir/` in the
working directory), `dist/` in its own checkout and throwaway profiles in the temporary directory, and makes no
network request.

## Scripts for contributors

| Command | What it does |
|---|---|
| `bun scripts/build.ts` | build `dist/`, regenerate `src/_generated/` and `types/mimir.d.ts`, print chunk sizes against the budgets; `--no-strict` reports an overrun instead of failing, `--where` lists the largest sources per chunk |
| `bun run typecheck` | `tsc --noEmit` over `src`, `tests`, `scripts` |
| `bun test` / `bun run test:unit` / `bun run test:e2e` | all tests / pure modules / the real CLI with a headless browser |
| `bun scripts/offline-proof.ts <html> <png>` | open an exported file with the network off, report every request, write a screenshot |
| `bun run hygiene` | the mechanical check of [OSS-HYGIENE.md](OSS-HYGIENE.md): exit 0 clean, 1 findings. Exceptions and known violations are in `scripts/hygiene.allow.json`; `bun run hygiene:strict` also fails on the known violations and must pass before a release |
