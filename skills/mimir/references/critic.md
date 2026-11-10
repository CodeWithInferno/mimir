# Looking at frames: the critic checklist

`check` decides geometry (overlap, off-frame, hidden parts, contrast, dead sliders): do not re-judge those by eye,
and do not state a measurement you did not get from `mimir check` or `mimir query`. Looking decides the rest:
whether the picture explains.

## How to look

1. Open the story sheet (`mimir shot <scene> --sheet`). Read it like a comic, with the captions covered: does the
   sequence of pictures alone tell the story?
2. For each step answer the checklist below with Yes / No / Unclear and the cell you read it from. "Unclear" is an
   answer: open that step at full size (`mimir shot <scene> --step <k>`) instead of guessing.
3. Open the cue sheet (`mimir shot <scene> --cues`) when the narration links words to parts, and a filmstrip
   (`mimir shot <scene> --fine <t0>:<t1>:8`) for each motion that carries the idea.
4. Write at most 5 issues, worst first: `[HIGH|MED|LOW] step k / #id: what is wrong -> the direction of the fix`.
   Fix HIGH ones, one per edit, and look again. Stop when there is no HIGH issue and the scene's own acceptance
   items are Yes; list what remains.

## Checklist

| Group | Question |
|---|---|
| Truth | 1. Does each step show what its title and sentence say? |
| Truth | 2. Is any shown fact wrong: direction of motion, order, count, which part moves, a number that does not match the picture? |
| Truth | 3. Is anything the request asked for missing? |
| Concrete | 4. Is the first frame the thing itself, recognisable without reading? |
| Attention | 5. In each step, is there one obvious place to look, and is it the thing the sentence names? |
| Attention | 6. Does the pointer or mark land on the right part (cue sheet)? |
| Legibility | 7. Can every label be read at this size, and does each sit by its part? |
| Legibility | 8. Is any label a sentence that belongs in narration, or is there more text than picture? |
| Space | 9. Is the subject large enough, centred where it matters, with nothing cut off or crowded into a corner? |
| Space | 10. Does anything look detached, sunk in, or passing through something? (confirm with `mimir query`) |
| Time | 11. Between consecutive steps, is it clear what changed? Is anything left over from an earlier step? |
| Time | 12. Does the motion read in the filmstrip: smooth, in the right direction, long enough to follow? |
| Interaction | 13. Does each slider change what its name says, across its whole range? |
| Restraint | 14. Does each colour mean one thing, the same in every step? Is grey used for what is not the point? |
| Restraint | 15. Is the idea carried by the picture rather than by text and numbers? |
| Verdict | 16. Could a newcomer explain it after watching? If not, which step fails? |

## What a sheet cannot show

A cell of the sheet is small: it is for composition and flow. Small text is judged at full size (`--step <k>`),
motion in a filmstrip, the pointer in the cue sheet. Whether it is beautiful is a person's call: say what you
saw, not that it is good.
