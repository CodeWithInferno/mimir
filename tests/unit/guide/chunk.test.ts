// The pure pieces of the drawing chunk: caption line breaking and the voice follower. No DOM.
import { describe, expect, test } from 'bun:test'
import { rect } from '../../../src/r2d/index.ts'
import { breakCost, captionRuns } from '../../../src/guide/guide.chunk.ts'
import { VOICE_MAX_STEP, VOICE_TRIM, voiceLines, voiceStep, voiceTrim } from '../../../src/guide/voice.ts'
import { allOverlays, compile, scene } from '../../../src/core/index.ts'

const words = (text: string, cues: Record<number, number> = {}) => text.split(' ').map((t, i) => ({ text: t, cue: cues[i] ?? -1 }))
/** every word 10 px per character, one space of 10 px between words */
const metrics = (list: { text: string }[]) => { const left: number[] = [], right: number[] = []; let x = 0; for (const w of list) { left.push(x); x += w.text.length * 10; right.push(x); x += 10 } return { left, right } }

describe('the guide chunk registers its overlays', () => {
  test('marks under labels under the caption under the pointer', () => {
    const order = allOverlays().map((o) => o.name).filter((n) => n.startsWith('guide.'))
    expect(order).toEqual(['guide.marks', 'guide.labels', 'guide.caption', 'guide.pointer'])
  })
})

describe('caption lines', () => {
  test('a sentence that fits is one run; a wider one is cut at the pause nearest its middle', () => {
    const list = words('The piston slides down, and the intake valve opens wide.')
    const { left, right } = metrics(list)
    expect(captionRuns(list, left, right, 0, list.length, 10_000)).toEqual([[0, list.length]])
    expect(captionRuns(list, left, right, 0, list.length, 330)).toEqual([[0, 4], [4, 10]]) // after the comma
    const narrow = captionRuns(list, left, right, 0, list.length, 160)
    expect(narrow[0]![0]).toBe(0)
    expect(narrow[narrow.length - 1]![1]).toBe(list.length)
    for (let i = 1; i < narrow.length; i++) expect(narrow[i]![0]).toBe(narrow[i - 1]![1]) // nothing lost, nothing twice
    for (const [a, b] of narrow) expect(b - a === 1 || right[b - 1]! - left[a]! <= 160).toBe(true)
  })
  test('the name of a part is not cut in two when anything else fits', () => {
    const list = words('Now the big intake valve opens up slowly', { 3: 0, 4: 0 })
    expect(breakCost(list, 4)).toBeGreaterThan(breakCost(list, 3))
    expect(breakCost(words('down, and'), 1)).toBe(0)
    const { left, right } = metrics(list)
    const runs = captionRuns(list, left, right, 0, list.length, 250)
    expect(runs.some(([a, b]) => a <= 3 && b >= 5)).toBe(true)
  })
})

describe('voice follows the story', () => {
  const model = compile(scene({ title: 'voice' }, (s: any) => {
    rect({ id: 'a' })
    s.step('one', (st: any) => { st.say('The [first](a) sentence.'); st.say('And a second one.') })
    s.step('two', (st: any) => { st.say('A third.') })
  }))
  const lines = voiceLines(model)
  test('every sentence, in story time, with its word onsets', () => {
    expect(lines.map((l) => l.text)).toEqual(['The first sentence.', 'And a second one.', 'A third.'])
    expect(lines[0]!.t0).toBeGreaterThan(0)
    expect(lines[1]!.t0).toBeGreaterThan(lines[0]!.t1)
    expect(lines[2]!.t0).toBeGreaterThan(model.steps[1]!.t0)
    expect(lines[0]!.words.map((w) => w.offset)).toEqual([0, 4, 10])
  })
  test('a sentence starts when playback crosses its first word; a scrub or a jump stops the voice', () => {
    const t = lines[1]!.t0
    expect(voiceStep(lines, t - 0.02, t + 0.01)).toBe(1)
    expect(voiceStep(lines, t + 0.01, t + 0.03)).toBeNull()
    expect(voiceStep(lines, t + 0.01, t - 0.5)).toBe('stop')
    expect(voiceStep(lines, 0, 0 + VOICE_MAX_STEP + 0.1)).toBe('stop')
    expect(voiceStep(lines, t, t)).toBeNull()
  })
  test('the rate trim follows word boundaries, a little at a time, inside its bounds', () => {
    expect(voiceTrim(1, 2, 2)).toBe(1)
    expect(voiceTrim(1, 2, 2.2)).toBeCloseTo(1.1, 9) // the voice is behind: faster
    expect(voiceTrim(1, 2, 4)).toBeCloseTo(1 + VOICE_TRIM.step, 9) // … but never by a leap
    expect(voiceTrim(VOICE_TRIM.max, 2, 4)).toBe(VOICE_TRIM.max)
    expect(voiceTrim(1, 0.1, 5)).toBe(1) // too early in the sentence to tell
  })
})
