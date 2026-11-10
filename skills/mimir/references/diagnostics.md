# Diagnostics: what `mimir check` says and what to do

Every finding has this shape, and the `fix:` line is a literal edit, most likely first:

```
CODE severity | step k "title" t=3.2s | #id | file.scene.js:41
  what: one sentence with the measured value and the limit
  fix: edit 1; edit 2; edit 3
```

`error` = measured, must be fixed. `warn` = a judgement you may overrule after looking. `unknown` = could not be
measured (never read it as a pass). `mimir check <scene> --text --all` prints every finding (8 by default, causes
before their effects: fix from the top, then check again, because one cause often clears several lines).

Measure before you move things: `mimir query <scene> bounds <id>`, `distance <a> <b>`, `visible <id>`,
`contacts <id>`, `state --step <k>`.

| Code | It means | Usual fix |
|---|---|---|
| `API-UNKNOWN`, `API-TYPE` | a name, option or value that does not exist, or has the wrong type | take the name the message offers; `mimir docs <name>` for the real signature. Do not invent options |
| `REF-MISSING` | a variable is undefined where an object is expected | define it above the line, check the spelling |
| `NUM-INVALID` | a size or position became NaN or infinite (often at a slider's end) | guard the formula (division by zero, square root of a negative), narrow the param's range |
| `RUNTIME-ERROR` | the scene threw | read the line it names; a dynamic function must return a value for every time and param |
| `ID-DUP` | two objects share an id | rename one |
| `PLACE-NONE` | objects were never placed and lie on each other at the origin | put them in a `row` / `column` / `grid`, or `nextTo` / `attach` them |
| `PLACE-CONFLICT` | an object has two placements (`at` then `nextTo`, or inside a layout and placed again) | keep one; move the group, not the member |
| `GUIDE-TARGET` | `[words](id)` names nothing, or a part that is not on stage (or not visible enough) when its word is spoken | fix the id; draw the part earlier in the step (`st.play(create(part))` before the plays that follow), or name it in a later step |
| `GUIDE-CROWDED` | more than three linked words in one sentence | keep one or two; split the sentence into two `st.say` calls |
| `SAY-LONG`, `TEXT-LONG` | a sentence over 25 words, a caption over two lines, a label over four words | split the sentence; move the words of a long label into narration |
| `GUIDE-DEAD-AIR`, `NO-VISUAL-BEAT`, `STATIC-STEP` | a long stretch of talk, or a whole step, in which nothing changes | make something move or appear in that step, or merge it with its neighbour |
| `TEXT-OVERLAP` | two texts intersect (labels, numbers, the caption at the bottom) | move one with a relation (`nextTo` the other side, a larger `gap`); keep stage text above y = -2.6; shorten it |
| `OFF-FRAME` | something is beyond the frame or the 3D panel | `group.fit(s.area(...))`, a smaller size or gap, or a camera `fit`; at a slider's end: narrow the range |
| `TEXT-TINY` | text under 14 px at 720p | a larger size name (`'note'` is the smallest that reads); do not scale a layout down to fit, remove something |
| `CONTRAST-TEXT` | text that does not stand out from what is behind it | a lighter text colour, or move it off the filled shape |
| `COLOR-COUNT` | more than three hues at once | one hue per meaning; grey for the rest; `st.focus` dims what is not the point |
| `OCCLUDED` | a 3D part that the step names is hidden by another | the view the message measured (`st.camera({ view })`), `st.ghost(what is in front)`, a cutaway, or an exploded view |
| `SUBJECT-FIT`, `TINY` | the model is small in its panel, or a part the step is about is too small to make out | `st.camera({ fit: [parts] })`, a larger panel (`s.viewport('left', 0.55)`), or `st.zoom(part)` in 2D |
| `INTERPENETRATE`, `COLLIDE-IN-MOTION`, `PARAM-BREAKS` | two solids overlap: at a step end, on the way, or at a slider's end | let a mechanism or `attach` place the part instead of coordinates; correct the dimension; narrow the param |
| `FLOATING` | a 3D part touches nothing | `attach` / `on` / `between` it to its neighbour |
| `MECH-OPEN` | a mechanism's parts do not close (a rod that would have to stretch) | give the mechanism dimensions that can close (rod longer than the crank throw), do not move its parts by hand |
| `DEAD-PARAM` | a slider changes nothing visible | use it in what is drawn, or remove it |
| `EXPECT-FAILED` | something you declared true is not | the scene is wrong, or the claim is: find out which with `mimir query <scene> probes` |
| `NOT-PURE` | a dynamic function gives two answers for the same time | no `Math.random`, no `Date.now`, no counters: use `s.rng(seed)`, `s.t()`, params |
| `SIM-UNSTABLE` | an `ode` blows up | a smaller `dt`, or a gentler equation |
| `TEX-INVALID` | LaTeX that cannot be set | use `String.raw`, check the braces; KaTeX's command set |
| `CHAPTER-LONG` | more than about 90 s without a chapter break | `s.chapter('…')` before the step it names |

Two findings that look alike but are not mistakes: a dot or a thin line flagged `TINY`, and a housing flagged
`OCCLUDED` in front of what it holds. Declare the design decision on the object (`dot.allow('TINY')`,
`liner.allow('OCCLUDED')`) with a comment that says why. Never use `allow` or `s.check({ off })` to hide a
finding you have not understood.
