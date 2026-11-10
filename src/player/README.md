# The player

The chrome round the engine's stage: watch (the default: it plays by itself and the chrome sleeps), read, explore, a
part's note, ask, the command palette, share, the scene-error overlay, and the home page of a server that has one.
It talks to a scene through `window.__mimir` (the host protocol, `src/host`) and nothing else. The stage, its
captions, labels and pointer are the engine's: the player places the stage and never draws inside it.

## Files

| File | What it is |
| --- | --- |
| `index.ts` | Main chunk, no DOM: `info().player` (name, colour, group and description of each part) and `part.describe(text)`. |
| `names.ts` | How an id reads as a name. Imports nothing: both sides use it. |
| `player.chunk.ts` | The lazy chunk `dist/mimir.player.js`. The host loads it only with a person watching; `mimir export` inlines it. |
| `app.ts` | State, layout, one draw function, the line of time, the transport, modes, wake, keys, the stage making room. |
| `caption.ts` | The narrator's sentence under a stage too small to carry the engine's own captions (a phone held upright). |
| `read.ts` `explore.ts` `note.ts` `layers.ts` `home.ts` | One part of the chrome each. Each registers a `Feature` (layout, draw, ink). |
| `layout.ts` `story.ts` `motion.ts` | Pure: metrics for a window size, what follows from the manifest, easings and the runner. Unit-tested. |
| `css.ts` `styles.ts` | The stylesheet: tokens and components, scoped to `.m-root` / `.m-app`; what the real player adds. |

## Rules

- **State, then one draw.** `S` is what the reader chose; named channels of the runner hold every change in progress;
  `layout()` measures once per window size; `draw()` writes transforms and opacities. A motion sets channel values and
  nothing else, so every animation is a function of a progress value.
- **Two clocks.** Story time is only ever passed to `host.seek()`; the wall clock chooses the moment and drives the
  chrome. Nothing the stage draws depends on the player.
- **Nothing is made up.** A control exists only when the scene or the host has what it needs: no parameters, no
  parameters panel; a 2D scene has no view; `Ask` is hidden unless `window.__mimir.ask` is a function; `Download`
  needs a server that says it packs pages; the generating view shows the server's events and nothing else.
- **Every constant is named**: durations in `motion.ts` (`D`), metrics in `layout.ts` (`LAYOUT`), story defaults in
  `story.ts`, each feature's own at the top of its file.

## What a host may add

| Hook | Effect |
| --- | --- |
| `window.__mimir.ask = (q: AskRequest) => Promise<AskAnswer>` (`note.ts`) | `Ask` appears; the answer shown is the one returned. |
| `<meta name="mimir-server" content="scenes new export">` in the viewer page | The way home and `Download as one HTML file` are offered without asking the server first. |
| `GET /api/scenes`, `POST /api/new`, `GET /api/new/<id>/events`, `GET /api/export?scene=` | The home page, the build as it happens, the download (`home.ts`, `layers.ts`). |

A viewer opened without a scene asks `GET /api/scenes` once; a viewer that shows a scene asks a server for nothing
it did not declare (a request for a missing route is an error in the page's console).

## Type

The chrome is set in the faces the stage itself uses: the engine's embedded Computer Modern (KaTeX Main regular,
italic and bold, in `dist/mimir.fonts.js`, SIL OFL 1.1). The player adds **no font data: 0 bytes**. The judged design
used five subsets of New Computer Modern (82,312 bytes, GUST Font License); they are not shipped, because the data
budget has 29.7 KB left and one typeface across stage and chrome is the better trade. Under 18 px the chrome adds
0.012 em of tracking, which does what the design's 8 pt master did. Code (file names, ids, the erratum's frame) is
set in the reader's own monospace face: the only type that is not embedded.

## Query parameters (besides the host's)

`mode=video|read|explore`, `play=0` (do not start by itself), `rm=1|0` (force reduced motion on or off), `touch=1|0`
(force coarse-pointer targets).
