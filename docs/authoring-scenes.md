# Authoring scenes

A scene is one plain JavaScript module, `<name>.scene.js`, written against Mimir's API. People write scenes, and so
do coding agents; both follow the same loop with the same commands. The loop and its rules live in ONE place, the
skill (`skills/mimir/SKILL.md`), because that is the text an agent actually loads. This page is the map: what the
loop is, why each step exists, and how to change the skill without making generated scenes worse.

## The loop

```
storyboard  ->  write  ->  mimir check (until OK)  ->  mimir shot --sheet  ->  LOOK  ->  fix  ->  cues / filmstrip  ->  mimir open
```

| Step | Command | What it is for |
|---|---|---|
| Storyboard | (a file: `<name>.storyboard.md`) | Decide the one concrete picture, the steps, what each colour means, what is computed from what, and the acceptance items, before any code. Template: `skills/mimir/references/storyboard.md` |
| Write | (the scene file) | Start from the nearest complete scene in `skills/mimir/references/cookbook.md`, or from `mimir examples <name>` |
| Check | `mimir check <scene> --text` | Geometry, layout and story findings, each with the measured value and a literal fix. The last line starts with `OK` or `FAIL`. Exit 0 / 1 |
| Shoot | `mimir shot <scene> --sheet` | One PNG with a cell per step: the cheapest way to see the whole story (about a thousand tokens for an agent) |
| Look | (open the PNG) | What `check` cannot decide: does the picture explain? Checklist: `skills/mimir/references/critic.md` |
| Fix | (edit, then check again) | One issue per edit |
| Look closer | `mimir shot <scene> --cues`, `--fine t0:t1:n`, `--step k` | Where the pointer lands, how a motion reads, small text at full size |
| Hand over | `mimir open <scene>`, `mimir export <scene> -o out.html`, `--mp4 out.mp4` | The live viewer, one self-contained HTML file, a video |

Reference while writing: `mimir docs` (every name by module), `mimir docs <name>` (one declaration, its comment and
where an example uses it), `mimir docs reference` (everything, one line each), `mimir query <scene> …` (measure a
distance, a box, what is visible).

## The rules, and where they come from

The hard rules of the skill are the grammar of a 3Blue1Brown video, restated for an engine in which time is an
input:

- **Concrete first**: the first frame is the thing itself; abstractions arrive after the picture made them obvious.
- **Show it running** and **the payoff is a picture**: what turns, flows or counts does so on screen; the reason is a
  change or a comparison, not a sentence.
- **Labels are at most four words; narration carries sentences** (`st.say`), with `[words](id)` linking words to parts.
- **One colour, one meaning**, at most three hues.
- **Nothing faked: compute it.** Motion from a mechanism, a simulation or a function of a param; every number read
  from the same source.
- **Relations, not coordinates**: layouts, `nextTo`, `attach`, `graph()`, mechanisms.
- **Never claim a scene is right** without a clean check and frames you looked at after the last edit.

`check` enforces what can be measured (`TEXT-LONG`, `COLOR-COUNT`, `STATIC-STEP`, `GUIDE-TARGET`, `OCCLUDED`, …; the
catalogue is `src/check/RULES.md`). The rest is judged by looking, with the checklist.

## The skill folder

```
skills/mimir/
  SKILL.md                 the loop, the routing table (which API for which kind of subject), the hard rules
  gen-system.md            the extra instructions of a headless run (mimir new)
  assets/AGENTS.snippet.md the pointer for agents that read AGENTS.md
  references/
    storyboard.md          the storyboard template
    cookbook.md            three complete scenes (mechanism + plot, system with tokens, maths) and idioms
    critic.md              the checklist for looking at frames
    diagnostics.md         check codes and their usual fixes
    api.md, api-<module>.md   GENERATED from the typed reference: never edit by hand
```

Only `SKILL.md` is loaded when the skill fires; the references are opened on demand. Keep it that way: the measured
cost is in `docs/agents.md`.

### Changing it

1. **API changed?** `mimir skill refresh` rewrites `references/api*.md` from the same declarations `mimir docs`
   prints; `mimir skill check` (and the test suite) fails when they are stale.
2. **A scene in the skill changed?** Every complete scene in `SKILL.md` and `cookbook.md` is run through
   `mimir check` by `tests/e2e/new.test.ts`; a scene that does not pass clean fails the suite.
3. **The text changed?** Text is only as good as the scenes it produces. Run real generations on prompts that are
   not in `examples/` and LOOK at the sheets:

   ```
   mimir new "how does a bicycle gear change work" -o /tmp/try/bike
   mimir new "how does binary search work" -o /tmp/try/search
   ```

   Judge the sheet of each result line (`sheet`) against `references/critic.md`, read what the agent got wrong
   (`rounds`, `shots`, `denials`, `notes`), and change the skill, never the generated scene. Record what you
   measured in `docs/agents.md`. Do not tune on the held-out prompts of the evaluation (they are listed in the
   design notes): they exist to tell whether the skill generalises.
4. **Prefer fixing the tool.** If agents keep making a mistake that can be measured, it belongs in `mimir check`
   with a literal fix, not in a paragraph of the skill.

## Writing a good scene by hand

Everything above applies. Three habits matter most:

- Give every object you talk about an `id`, and draw it before the sentence that names it.
- Put one `s.param` at the centre and make everything that moves a function of it; `st.set(param, value)` sweeps it
  across a step.
- Declare what must be true (`s.probe`, `s.expect`, `expect.conserved`) and let `check` prove it at every sampled
  moment and slider position.
