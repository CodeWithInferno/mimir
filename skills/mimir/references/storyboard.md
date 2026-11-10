# Storyboard

Write this file (`<name>.storyboard.md`) before the scene. It is short, and it is where a scene is won or lost:
a scene that follows a clear storyboard needs one or two fix rounds; a scene written straight from the prompt
needs a rewrite.

```markdown
# <the title, as a question or a claim>

Question: <what was asked, in the asker's words; do not swap it for an easier neighbour>
Answered by showing: <the "how" happening on screen: the change, the mechanism in action, the algorithm deciding>
The one picture: <the concrete thing the whole scene hangs on, and what moves in it>
Kind: <mechanism | system | algorithm | maths>, built from <the API pieces, by name: e.g. kit.gear + belt, graph + traffic, row of cells + stepper, axes + tex>
Computed from: <the one source every motion and number reads: a mechanism, a simulation, a function of a param>
Params: <name (range, unit): what dragging it shows>
Payoff: <the change or the side-by-side comparison that SHOWS the reason; not a sentence, not a typed result>
Layout: <what is where on the stage: left / right / centre, what stays throughout; the subject fills the frame>

Colours: <BLUE = …, YELLOW = …, grey = everything that is not the point>   (at most three hues)

Steps:
1. <title> | on screen: <what is there> | changes: <the one thing that moves or appears> | says: "<one or two sentences>"
2. …

Accept (yes / no, judged on the rendered frames):
- [ ] <the first frame shows the thing itself, not a title or a formula>
- [ ] <step k shows the asked-for "how" happening, not just its result>
- [ ] <the fact the viewer should take away is visible in step k without reading the caption>
- [ ] …
```

What makes it good:

- **Read the API of the kind first** (the table in SKILL.md). A storyboard written in the engine's words ("two
  `kit.gear`s joined by `belt`") can be built; one written in free words gets rebuilt from boxes.
- **Start where a newcomer starts.** Step 1 shows the thing as it is met in the world (the real parts of the
  machine, the shelf of books, the swing), not its abstraction. If a part is hard to recognise as a flat shape,
  it belongs in the 3D panel.
- **It runs.** From the second step on something is turning, flowing or counting, and a param lets the viewer do
  it by hand.
- **One idea a step, and each step changes the picture.** If two steps would look the same, merge them or find
  what moves. 4 to 8 steps; a long explanation gets chapters (`s.chapter`) of 2 to 6 steps.
- **Say it once, show it once.** The sentence names what the eye should go to; the picture carries the idea.
  Sentences under 25 words, one or two linked words each.
- **A question about a change shows the change.** A shift, a switch, a failure, a decision: one step shows it
  happening (before, during, after) on the same model. Two finished cases side by side explain the consequence,
  not the change.
- **The surprise or the reason is a step of its own,** shown by a change (a param sweep, a comparison side by
  side, a count that grows), never by a paragraph or a number typed on the stage. If the reason is "this is
  faster / stronger / more than that", put this and that side by side on the same param.
- **Decide the layout now:** what sits left, what sits right, where numbers go, what stays on stage throughout.
  The model beside its plot or its counts, tied by one shared param, is the workhorse.
- **Acceptance items are about pixels.** "The chain sits on the small sprocket in step 3", not "the scene is clear".
