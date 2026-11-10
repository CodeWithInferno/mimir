---
name: mimir
description: Builds an explainer you can watch and touch with Mimir, an animated, narrated working model of how something works (a mechanism in 3D, a system diagram with moving tokens, an algorithm, a plot or a formula) in the visual grammar of a 3Blue1Brown video, exported as one self-contained HTML file or an mp4. Use when the user asks how something works and wants to see it, or says "explain it visually", "interactive diagram", "3D model of", "simulate", "explainer", "mimir scene". Writes a scene module, runs mimir check until it is clean, renders frames, looks at them and fixes what it sees. Not for slide decks, static charts or photo-real renders.
allowed-tools: Bash(mimir *) Read(/${CLAUDE_SKILL_DIR}/**)
license: MIT
metadata:
  version: "0.1.0"
---

# Mimir scenes

A scene is ONE plain JavaScript module, `<name>.scene.js`. It describes objects, how they depend on each other and
on time, and a story told in steps. `mimir` checks it, renders it, and you LOOK at what it rendered.

```js
import { scene, rect, text, arrow, row, create, fadeIn, BLUE, GREY_B } from 'mimir'

export default scene({ title: 'How a request is served' }, (s) => {
  const load = s.param('load', { value: 20, min: 0, max: 100, unit: '%', label: 'Load' }) // a slider the story can move
  const client = rect({ id: 'client', width: 2.4, height: 1.4, radius: 0.15, color: BLUE })
  const server = rect({ id: 'server', width: 2.4, height: 1.4, radius: 0.15 })
  row([client, server], { gap: 2 }).at(0, 0.5) // placed by a relation; ONE .at() for the whole layout
  const wire = arrow(client, server, { id: 'wire' }) // ends on the edges of the boxes, and follows them
  const busy = text(() => `${Math.round(load())} % busy`, { id: 'busy', size: 'label', color: GREY_B }).nextTo(server, 'down', 0.3) // computed, never typed in

  s.step('Two machines', (st) => {
    st.say('A [client](client) asks, and a [server](server) answers.') // sentences live here; [words](id) sends the pointer
    st.play(create(client), create(server), { lag: 0.3 })
    st.play(create(wire))
  })
  s.step('Under load', (st) => {
    st.say('As requests pile up the server gets [busier](busy).')
    st.play(fadeIn(busy))
    st.set(load, 90) // sweeps over the whole step
  })
})
```

## A small concept (one idea, up to 5 steps): the short path

Everything a small scene needs is on ONE page, [PAGE.md](PAGE.md) in this folder: the loop, `explain()` (the
declarative way, first choice when this engine has it), the minimum of the full API, a pattern -> block table and
the rules. `mimir new "<prompt>"` launches an agent with that page and nothing else. By hand it is the same loop:

1. Plan in your head (no storyboard file), write `<name>.scene.js`, and in the same message run
   `mimir review <name>.scene.js --sheet`: the linter, a text account of every step (what is on stage, where, what
   changed, where each narration link lands), composition FLAGs and the path of one small sheet, in one call.
2. Open that sheet ONCE. Then fix every error, every FLAG and what you saw in ONE edit, and run `mimir review` again.
3. Review once more only if it still reports errors. Stop. No cue sheets or filmstrips unless the request is about
   how something moves.

Read nothing else by default: `mimir docs <name>` answers any single name. The loop below is for anything bigger
(a mechanism in 3D, a system with several chapters), where the storyboard and the second look pay for themselves.

## The loop: anything bigger than a small concept

1. **Pick the kind and read its API first** (the table below). Plan in the engine's vocabulary: if a mechanism,
   layout or simulation function exists for what you want to show, the scene is built on it. Never guess a name or
   an option; `mimir docs <name>` prints one declaration with an example.
2. **Storyboard** in `<name>.storyboard.md` before any code, from `references/storyboard.md`: the ONE concrete
   picture, 4 to 8 steps, what each colour means, what is computed from what, the payoff, acceptance items.
3. **Write** `<name>.scene.js`, starting from the nearest scene in `references/cookbook.md`.
4. **Check until clean:** `mimir check <name>.scene.js --text`. The last line must start with `OK`. Each finding
   names the object, the line, the measured value and a literal fix: apply the first fix that fits. Fix EVERY
   finding of one check before you run it again. The same code on the same object twice: take the other fix or
   rewrite that part. After 4 rounds, simplify the scene instead of patching it.
5. **Shoot the story sheet:** `mimir shot <name>.scene.js --sheet` (one cell per step; it prints the path of the PNG).
6. **LOOK at the sheet** (open the PNG with your image-reading tool) as a newcomer who cannot read the code, and
   answer for every step, in writing, before you edit anything:
   - Does the scene answer the question as it was asked: is the asked-for "how" SHOWN happening (the change, the
     mechanism in action), not only named or shown by its result?
   - Is the first frame the thing itself, recognisable without the caption?
   - Does the subject fill the stage and sit at its centre (the model spans at least half the frame; nothing
     huddled along the top with a band of black under it)?
   - Is there one obvious place to look, and did the picture change from the step before?
   - Is the point of each step a motion, a comparison or a count that grows, or is it only said in text?
   - Is any shown fact wrong: direction, order, count, which part moves, a number that disagrees with the caption?
   Then list the issues, worst first: `[HIGH|MED|LOW] step k / #id: what is wrong -> the direction of the fix`.
   A first draft always has some; "it passes check" is not an answer. Full checklist: `references/critic.md`.
7. **Fix** the HIGH and MED issues of that look in one pass, then go back to 4. A fix that makes it worse is
   reverted. Expect two rounds of look-and-fix. When the "how" is missing, add the step that shows it; a weak
   storyboard is rewritten, not patched. Once the scene is clean and looked at, change it only for a HIGH issue.
8. **Look closer at what moves or points** (part of the job, not an extra): `mimir shot <name>.scene.js --cues`
   (one frame per pointer landing: is it on the thing the words name?) and
   `mimir shot <name>.scene.js --fine <t0>:<t1>:8` (a filmstrip of the motion that carries the idea: does it read,
   in the right direction?). A full frame for small text: `mimir shot <name>.scene.js --step <k>`.
9. **Hand over:** `mimir open <name>.scene.js` (the live viewer) or `mimir export <name>.scene.js -o <name>.html`.

| The subject is | Build it from | Read (in `references/`) |
|---|---|---|
| a machine, a physical mechanism | its real parts in the 3D panel: `kit` parts or primitives, assembled and moved by a mechanism function (`gearPair`, `gearTrain`, `belt`, `crankSlider`, `camFollower`, `rackPinion`, `planetary`), with a plot or counts beside it. A flat schematic may sit BESIDE the model for what one view cannot show; it never replaces it | `api-kit.md` `api-r3d.md` |
| a system, a protocol, a pipeline | `graph()` for the boxes and wires, `traffic()` / `tokens()` / `sequence()` for what moves through them | `api-diagram.md` `api-flow.md` |
| an algorithm, a data structure | the data as objects in a `row` / `grid`, the real algorithm recorded with `stepper()`, a param that walks its states | `api-sim.md` `api-plot.md` |
| a law, a function, a formula | the concrete model beside `axes()`, tied by one param; `ode()` for physics; `tex()` last | `api-plot.md` `api-sim.md` `api-tex.md` |

Always also: `api-core.md`, `api-r2d.md`, `api-anim.md`, `api-guide.md`.

Create and change files with your file tools; the shell is for `mimir` only. Run each `mimir` command exactly as
written, one command per call: no `;`, no `&&`, no `$(...)`, no redirection, no `echo $?`. Every command prints
its own status. If the shell says `mimir: command not found`, stop and say so.

## Hard rules (the grammar of the video)

- **Concrete first.** The first frame is the thing as it is met in the world, recognisable to someone who has not
  read the title: the real parts of the machine, the shelf of sorted books, the swinging weight. Rectangles and
  bars that stand for parts are an abstraction; so are names, numbers and formulas. They arrive after the picture
  has made them obvious, beside the real thing and never instead of it. No title cards.
- **Show it running.** What turns, slides, flows or counts in the world does so on screen, driven by a param the
  viewer can drag. A still diagram of a machine is not an explanation.
- **The payoff is a picture.** The reason or the surprise is shown by a change or a comparison (two cases side by
  side on one param, a count that grows, a bar that halves), never by a sentence or a typed result on the stage.
- **Labels are at most four words.** Sentences are narration: `st.say(...)`. Never put a sentence on the stage.
- **One step, one idea, one visible change.** A step in which nothing moves or appears is not a step.
- **One colour, one meaning,** for the whole scene; at most three hues on screen. Grey is for what is not the point.
- **Nothing faked: compute it.** Motion comes from a mechanism, a simulation (`ode`, `events`, `traffic`,
  `stepper`) or a function of a param. Every number on screen is read from the same source (`text(() => …)`,
  `readout`, `num`). No typed-in results, no keyframes that imitate physics.
- **Relations, not coordinates.** `row` / `column` / `grid`, `nextTo`, `attach`, `graph()`, mechanisms and
  `s.area()` place things. `.at(x, y)` is for the one anchor a layout hangs from. No arithmetic or trigonometry
  to place things.
- **Point at what you name.** Give every object you talk about an `id`, and draw it before the sentence that names
  it: `st.say('The [piston](piston) slides.')`. `[words](ring:a+b)` circles, `(label:id)` names, `(focus:id)` dims
  the rest (`mimir docs Step.say`). One or two links a sentence, sentences under 25 words.
- **Dim, do not delete; derive, do not cut.** `st.focus(a, b)` for attention, `derive(a, b)` when one thing comes
  from another, `fadeOut` only for what really leaves.
- **Use the whole stage, from its centre.** Frame 14.2 × 8, origin centre, y up; content inside x ±6.6, y from
  −2.6 to 3.5 (the caption owns the strip below). Put the main object at about (0, 0.5), large, and hang the rest
  from it (`nextTo`, one `column`); do not stack things downward from the top edge. Degrees everywhere.

## Never claim a scene is right

Not from the code, and not from `check` alone. A scene is done when the last `mimir check` is `OK` on the file as
it is now AND you have looked, after your last edit, at the story sheet, the cue sheet and a filmstrip of the main
motion. In your final message say which check and which pictures that was, answer the storyboard's acceptance
items from the frames, and list what is still weak.
What you could not verify is `unverified`, not fine.

## References: open only what you need

In `references/` next to this file (open them with your file-reading tool):

| file | when |
|---|---|
| `storyboard.md` | step 2: the storyboard template and what makes a good one |
| `api.md` | the list of `api-<module>.md` files, one per module |
| `cookbook.md` | three complete scenes to start from: mechanism + plot, system with tokens, maths; idioms |
| `critic.md` | step 6: the full checklist for looking at frames |
| `diagnostics.md` | a `check` code whose fix is not obvious |

More working scenes: `mimir examples` lists them, `mimir examples <name>` prints one.
