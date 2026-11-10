# Getting started

This page takes you from nothing to a scene of your own. Everything here was run on macOS with bun 1.3.11 and
Google Chrome. Linux is expected to behave the same and has not been run by the authors; Windows is untested (the
README says what is known).

## 1. Install

You need two things on the machine:

- **bun**, the JavaScript runtime Mimir's command line runs on: `curl -fsSL https://bun.sh/install | bash`, or one
  of the other ways on https://bun.sh.
- **A Chrome-family browser**: Google Chrome, Chromium, Microsoft Edge or Brave. Mimir starts it headless to check
  scenes and render frames. It is found on `PATH` and in the standard install locations; if yours is elsewhere, set
  `MIMIR_CHROME=/path/to/the/browser/binary`.
- Optional: **ffmpeg**, only for `mimir export --mp4` (on `PATH`, or `MIMIR_FFMPEG=/path/to/ffmpeg`).

Then:

```sh
git clone https://github.com/CodeWithInferno/mimir.git && cd mimir
bun install
bin/mimir --version
```

There is nothing to build by hand. The first command that needs the viewer builds it into `dist/` (well under a
second on an idle machine) and later commands rebuild it when the sources change.

To type `mimir` instead of `bin/mimir`, link the launcher into a directory on your `PATH`:

```sh
ln -s "$PWD/bin/mimir" ~/.local/bin/mimir
```

The rest of this page writes `mimir`.

## 2. Open an example

```sh
mimir open examples/slider-crank.scene.js
```

This starts a server on `127.0.0.1` on a free port (`--port` or `MIMIR_PORT` choose one), prints the address and
opens it in your default browser. Press play, drag the slider, scrub the timeline, drag the model to turn it. Edit
the scene file and the page reloads where you were. Stop the server with Ctrl+C. `mimir examples` lists the other
examples.

## 3. Run the loop on it

```sh
mimir check examples/slider-crank.scene.js
```

prints `OK 0 errors, 0 warnings`. Try the deliberately broken example to see what a problem looks like:

```sh
mimir check examples/broken.scene.js
```

```
API-UNKNOWN error | #a | examples/broken.scene.js:8
  what: rect() has no option "widht".
  fix: use "width". Valid options: id, opacity, width, height, radius, color, fill, fillOpacity, stroke, strokeWidth, dashed.
...
FAIL 4 errors, 0 warnings
```

Each diagnostic names a code, the object, the file and line, what is wrong with the measured value, and a fix.

Render frames:

```sh
mimir shot examples/slider-crank.scene.js --sheet
```

writes one PNG per step, `sheet.png` (all of them on one page), `manifest.json` and one `*.probes.json` per frame
into `.mimir/shots/slider-crank/`. Open `sheet.png` and look at it. This is the step that matters most: a scene
can pass every check and still explain nothing.

Export:

```sh
mimir export examples/slider-crank.scene.js -o slider-crank.html
mimir export examples/slider-crank.scene.js --mp4 slider-crank.mp4      # needs ffmpeg
```

The first writes one file (about 1.2 MB for this scene: it carries three.js and the fonts; a 2D scene is a few
hundred KB) that you can open from disk, attach to a message or put on any static host. It needs no server and
makes no network request. The second renders every frame of the story and encodes a 1920 by 1080 video.

## 4. Write your first scene

Create `pendulum.scene.js` anywhere (it does not have to be inside the repository):

```js
import { scene, circle, line, text, create, write, GREY_B, YELLOW } from 'mimir'

export default scene({ title: 'A swinging weight' }, s => {
  // one number drives the picture: the angle of the string, in degrees
  const angle = s.param('angle', { value: 30, min: -60, max: 60, unit: '°', label: 'angle' })
  const length = 4

  // where the weight is, computed from the angle (not typed in)
  const tip = () => {
    const a = (angle() * Math.PI) / 180
    return [length * Math.sin(a), 3 - length * Math.cos(a)]
  }

  const pivot = circle({ id: 'pivot', radius: 0.08, fill: GREY_B, stroke: GREY_B }).at(0, 3)
  const weight = circle({ id: 'weight', radius: 0.4, fill: YELLOW, fillOpacity: 1, stroke: YELLOW }).at(tip)
  const string = line(pivot, weight, { id: 'string', color: GREY_B })
  const readout = text(() => `${Math.round(angle())}°`, { size: 'label' }).at(0, -2.8)

  s.probe('height', () => tip()[1])

  s.step('A weight on a string', st => {
    st.play(create(pivot), create(string), create(weight))
    st.play(write(readout))
    st.say('A [weight](weight) hangs from a string fixed at the top.')
  })

  s.step('Let it go', st => {
    st.say('Released, it swings down through the bottom and up the other side.')
    st.set(angle, -30)
  })
})
```

Then run the loop:

```sh
mimir check pendulum.scene.js          # fix what it reports, repeat until: OK 0 errors, 0 warnings
mimir shot pendulum.scene.js --sheet   # look at .mimir/shots/pendulum/sheet.png
mimir open pendulum.scene.js           # watch it, drag the slider
```

This scene was run through `check` when this page was written. It only shows the geometry; a real pendulum
computes its angle over time from its physics, which `examples/pendulum.scene.js` does with `ode()`. `mimir init
<name>` writes a starter scene if you would rather begin from a file that already passes `check`.

What to notice in it:

- `import ... from 'mimir'` works from any directory: the viewer resolves it. There is no `npm install` for a scene.
- The script runs **once**. `s.param`, the shapes and the steps are recorded; the viewer then evaluates the state
  at whatever time is asked for. That is why a property that changes is given as a function (`.at(tip)`,
  `text(() => ...)`).
- Things are placed by relation where possible: `line(pivot, weight)` follows both ends.
- Angles are degrees. The 2D frame is 14.222 units wide and 8 high with the origin in the centre and y pointing up.

## 5. Look things up

```sh
mimir docs                 # every public name, by module
mimir docs Step.say        # one entry: its signature and one line of explanation
mimir docs circle
mimir --help               # the commands
mimir shot --help          # one command
```

`mimir docs reference` prints every declaration on one line each, and `types/mimir.d.ts` is the same reference as
a file. If `mimir docs <name>` does not find a name, it does not exist. `mimir examples <name>` prints an example
to copy from.

## Troubleshooting

| You see | What it means | What to do |
|---|---|---|
| `mimir: bun is required but was not found on PATH` | the launcher could not find bun | install bun, or add its directory to `PATH` |
| `no Chrome-family browser found (looked for …)` | no browser on `PATH` or in the standard locations of your platform | install one, or set `MIMIR_CHROME=/path/to/binary` |
| `MIMIR_CHROME points to a file that does not exist` | the override is wrong | fix the path; an override is never silently ignored |
| `the browser exited before it was ready: … sandbox …` | the browser cannot set up its sandbox (containers, CI) | if you trust the scenes you run: `MIMIR_CHROME_ARGS=--no-sandbox` |
| `scene file not found: ...` | the path is relative to the directory you are in | check the path |
| `timed out ... waiting for ...` | the scene did not become ready in 30 s, or the machine is very busy | look for an import that never resolves or a loop that never ends; `MIMIR_TIMEOUT=<milliseconds>` raises the limit |
| `port <n> is already in use` | you asked for a port with `--port` or `MIMIR_PORT` and it is taken | leave both out: a free port is chosen |
| a `403` from the local server | the request was not addressed to `127.0.0.1` / `localhost` with the server's port | open the address that `mimir open` printed |
| a scene's `fetch('./data.xyz')` or import gets a `404` | the local server only hands out web file types, and never dot files | rename the file, or `MIMIR_SERVE_EXTENSIONS=xyz` |
| `mimir export --mp4 needs ffmpeg` | ffmpeg is not installed | install it, or set `MIMIR_FFMPEG`; HTML export does not need it |
| `WARNING: building the viewer failed ... using the last good build` | a source file of the engine is broken | fix the error it prints; results are marked `stale` until then |
| output is JSON when you expected text | stdout is not a terminal | add `--text` |

Set `MIMIR_DEBUG=1` to get a stack trace with an internal error, and include it in the bug report.

## Next

- [cli.md](cli.md): every command, flag and environment variable
- `mimir docs`, `mimir examples`: the API and scenes to copy from
- [../README.md](../README.md), "Using it from a coding agent": letting an agent do the writing
- [EXTENDING.md](EXTENDING.md): adding to the engine itself
