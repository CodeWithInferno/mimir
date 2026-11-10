import { describe, expect, test } from 'bun:test'
import { estimateTiming, parseNarration, pauseAfter } from '../../../../src/lib/guide/index.ts'
import type { NarrationTiming, ParsedNarration } from '../../../../src/lib/guide/index.ts'

const CPS = 16.5

function expectMonotone(parsed: ParsedNarration, timing: NarrationTiming): void {
  expect(timing.wordStarts.length).toBe(parsed.words.length)
  expect(timing.wordEnds.length).toBe(parsed.words.length)
  for (let i = 0; i < parsed.words.length; i++) {
    expect(Number.isFinite(timing.wordStarts[i]!)).toBe(true)
    expect(timing.wordEnds[i]!).toBeGreaterThanOrEqual(timing.wordStarts[i]!)
    if (i > 0) expect(timing.wordStarts[i]!).toBeGreaterThanOrEqual(timing.wordEnds[i - 1]!)
  }
  if (parsed.words.length) {
    expect(timing.wordStarts[0]!).toBeGreaterThanOrEqual(0)
    expect(timing.duration).toBeGreaterThanOrEqual(timing.wordEnds[parsed.words.length - 1]!)
    expect(timing.speechStart).toBe(timing.wordStarts[0]!)
    expect(timing.speechEnd).toBe(timing.wordEnds[parsed.words.length - 1]!)
  }
  expect(timing.sentenceRanges.length).toBe(parsed.sentences.length)
  for (let s = 0; s < parsed.sentences.length; s++) {
    const [start, end] = timing.sentenceRanges[s]!
    expect(end).toBeGreaterThanOrEqual(start)
    if (s > 0) expect(start).toBeGreaterThanOrEqual(timing.sentenceRanges[s - 1]![1])
  }
}

describe('estimateTiming - estimate', () => {
  test('one word takes its characters at 16.5 chars/s', () => {
    const timing = estimateTiming(parseNarration('hello'))
    expect(timing.wordStarts).toEqual([0])
    expect(timing.wordEnds[0]!).toBeCloseTo(5 / CPS, 12)
    expect(timing.duration).toBeCloseTo(5 / CPS, 12)
  })

  test('commas pause 365 ms and sentence ends 360 ms, after the word', () => {
    const timing = estimateTiming(parseNarration('a, b. c'))
    expect(timing.wordStarts[0]!).toBe(0)
    expect(timing.wordEnds[0]!).toBeCloseTo(2 / CPS, 12)
    expect(timing.wordStarts[1]!).toBeCloseTo(3 / CPS + 0.365, 12)
    expect(timing.wordEnds[1]!).toBeCloseTo(5 / CPS + 0.365, 12)
    expect(timing.wordStarts[2]!).toBeCloseTo(6 / CPS + 0.365 + 0.36, 12)
    expect(timing.duration).toBeCloseTo(7 / CPS + 0.365 + 0.36, 12)
  })

  test('the pause after the last sentence counts towards the duration', () => {
    const timing = estimateTiming(parseNarration('Done.'))
    expect(timing.speechEnd).toBeCloseTo(5 / CPS, 12)
    expect(timing.duration).toBeCloseTo(5 / CPS + 0.36, 12)
  })

  test('pauseAfter classifies trailing punctuation only', () => {
    expect(pauseAfter('down.')).toBe(0.36)
    expect(pauseAfter('really?!')).toBe(0.36)
    expect(pauseAfter('"yes."')).toBe(0.36)
    expect(pauseAfter('opens,')).toBe(0.365)
    expect(pauseAfter('ratio:')).toBe(0.365)
    expect(pauseAfter('wait…')).toBe(0.365)
    expect(pauseAfter('—')).toBe(0.365)
    expect(pauseAfter('-')).toBe(0.365)
    expect(pauseAfter('3.5')).toBe(0)
    expect(pauseAfter('1,000')).toBe(0)
    expect(pauseAfter('9:30')).toBe(0)
    expect(pauseAfter('well-known')).toBe(0)
    expect(pauseAfter('down.', 1, 2)).toBe(2)
    expect(pauseAfter('down,', 1, 2)).toBe(1)
  })

  test('options change the pace and the pauses; junk options fall back to the defaults', () => {
    const parsed = parseNarration('one, two. three')
    const base = estimateTiming(parsed)
    const fast = estimateTiming(parsed, { charsPerSecond: 33, commaPause: 0, sentencePause: 0 })
    expect(fast.duration).toBeCloseTo(parsed.plain.length / 33, 12)
    expect(estimateTiming(parsed, { charsPerSecond: 0, commaPause: -1, sentencePause: NaN })).toEqual(base)
    expect(estimateTiming(parsed, { duration: -3, leadIn: -1 })).toEqual(base)
  })

  test('sentence ranges are the first word start to the last word end', () => {
    const parsed = parseNarration('One two. Three four five.')
    const timing = estimateTiming(parsed)
    expect(timing.sentenceRanges).toEqual([
      [timing.wordStarts[0]!, timing.wordEnds[1]!],
      [timing.wordStarts[2]!, timing.wordEnds[4]!],
    ])
    expect(timing.sentenceRanges[1]![0] - timing.sentenceRanges[0]![1]).toBeCloseTo(1 / CPS + 0.36, 12)
  })

  test('empty narration has no words and no duration', () => {
    const timing = estimateTiming(parseNarration(''))
    expect(timing).toEqual({ duration: 0, wordStarts: [], wordEnds: [], sentenceRanges: [], speechStart: 0, speechEnd: 0 })
    expect(estimateTiming(parseNarration(''), { leadIn: 0.4 }).duration).toBe(0.4)
  })

  test('leadIn shifts every time by the same amount', () => {
    const parsed = parseNarration('The piston slides down, then up. Again.')
    const base = estimateTiming(parsed)
    const shifted = estimateTiming(parsed, { leadIn: 0.4 })
    expect(shifted.duration).toBeCloseTo(base.duration + 0.4, 12)
    for (let i = 0; i < parsed.words.length; i++) {
      expect(shifted.wordStarts[i]!).toBeCloseTo(base.wordStarts[i]! + 0.4, 12)
      expect(shifted.wordEnds[i]!).toBeCloseTo(base.wordEnds[i]! + 0.4, 12)
    }
    expect(shifted.speechStart).toBeCloseTo(0.4, 12)
  })
})

describe('estimateTiming - real times', () => {
  const parsed = parseNarration('the [piston](piston) slides down and the [intake valve](ring:intakeValve) opens.')

  test('a real audio length stretches the estimate to fit it', () => {
    const estimate = estimateTiming(parsed)
    const real = estimateTiming(parsed, { duration: 4 })
    expect(real.duration).toBe(4)
    const scale = 4 / estimate.duration
    for (let i = 0; i < parsed.words.length; i++) expect(real.wordStarts[i]!).toBeCloseTo(estimate.wordStarts[i]! * scale, 12)
    expectMonotone(parsed, real)
  })

  test('per-word onsets are used verbatim', () => {
    const onsets = parsed.words.map((_, i) => 0.2 + i * 0.41)
    const timing = estimateTiming(parsed, { wordTimes: onsets })
    expect(timing.wordStarts).toEqual(onsets)
    expectMonotone(parsed, timing)
  })

  test('sparse {offset, time} records pin their words and the rest is interpolated (probe 8)', () => {
    const first = parsed.spans[0]!
    const second = parsed.spans[1]!
    const timing = estimateTiming(parsed, {
      wordTimes: [
        { offset: 0, time: 0 },
        { offset: first.start, time: 1.25 },
        { offset: second.start, time: 3.1 },
      ],
    })
    expect(timing.wordStarts[first.firstWord]!).toBe(1.25)
    expect(timing.wordStarts[second.firstWord]!).toBe(3.1)
    expectMonotone(parsed, timing)
    // words between two pinned onsets keep the estimate's proportions
    const estimate = estimateTiming(parsed)
    const a = first.firstWord
    const b = second.firstWord
    const k = a + 2
    const share = (estimate.wordStarts[k]! - estimate.wordStarts[a]!) / (estimate.wordStarts[b]! - estimate.wordStarts[a]!)
    expect(timing.wordStarts[k]!).toBeCloseTo(1.25 + share * (3.1 - 1.25), 12)
    // after the last pinned word the estimated pace carries on
    expect(timing.duration - 3.1).toBeCloseTo(estimate.duration - estimate.wordStarts[b]!, 12)
  })

  test('an offset inside a word, or in the space before it, pins that word', () => {
    const simple = parseNarration('alpha beta gamma')
    const inside = estimateTiming(simple, { wordTimes: [{ offset: 8, time: 2 }] })
    expect(inside.wordStarts[1]!).toBe(2)
    const before = estimateTiming(simple, { wordTimes: [{ offset: 5, time: 2 }] })
    expect(before.wordStarts[1]!).toBe(2)
    // words before the first pinned one scale from zero
    expect(before.wordStarts[0]!).toBe(0)
  })

  test('real onsets and a real length together: the tail is stretched to the length', () => {
    const simple = parseNarration('alpha beta gamma delta')
    const timing = estimateTiming(simple, { wordTimes: [0, 1], duration: 5 })
    expect(timing.wordStarts[0]!).toBe(0)
    expect(timing.wordStarts[1]!).toBe(1)
    expect(timing.duration).toBe(5)
    expect(timing.speechEnd).toBeCloseTo(5, 12)
    expectMonotone(simple, timing)
  })
})

describe('estimateTiming - monotonicity', () => {
  const texts = [
    'On the intake stroke the [piston](engine.piston) slides down. The [intake valve](ring:engine.intakeValve) opens, and [fuel and air](arrow:engine.intakePort->engine.cylinder) rush in to fill the space. Then the [spark plug](label:engine.sparkPlug) waits for its moment.',
    'a',
    'Wait... what?! Yes; no: maybe — fine, "ok." Done',
    '[](focus:x)Start. [a](a) [b](b) [c](c), [d](glow:d+e)! End [](focus:y)',
    'It needs 3.5 volts, 1,000 turns and 9:30 on the clock.',
  ]

  test('word starts never decrease, words never overlap, the duration covers the last word', () => {
    for (const text of texts) {
      const parsed = parseNarration(text)
      expectMonotone(parsed, estimateTiming(parsed))
      expectMonotone(parsed, estimateTiming(parsed, { leadIn: 0.3 }))
      expectMonotone(parsed, estimateTiming(parsed, { duration: 2.5 }))
      expectMonotone(parsed, estimateTiming(parsed, { charsPerSecond: 3, commaPause: 2, sentencePause: 0 }))
    }
  })

  test('hostile real times (backwards, NaN, negative, too many, out of range) still give a monotone result', () => {
    for (const text of texts) {
      const parsed = parseNarration(text)
      const count = parsed.words.length
      const backwards = parsed.words.map((_, i) => (count - i) * 0.3)
      const junk = parsed.words.map((_, i) => (i % 3 === 0 ? NaN : i % 3 === 1 ? i * 0.5 : -1))
      const zigzag = parsed.words.map((_, i) => (i % 2 ? i * 0.2 : i * 0.7))
      const tooMany = Array.from({ length: count + 5 }, (_, i) => i * 0.25)
      expectMonotone(parsed, estimateTiming(parsed, { wordTimes: backwards }))
      expectMonotone(parsed, estimateTiming(parsed, { wordTimes: junk }))
      expectMonotone(parsed, estimateTiming(parsed, { wordTimes: zigzag }))
      expectMonotone(parsed, estimateTiming(parsed, { wordTimes: tooMany }))
      expectMonotone(parsed, estimateTiming(parsed, { wordTimes: zigzag, duration: 1, leadIn: 0.5 }))
      expectMonotone(
        parsed,
        estimateTiming(parsed, {
          wordTimes: [
            { offset: 9999, time: 1 },
            { offset: -5, time: 0.5 },
            { offset: 3, time: 0.2 },
            { offset: NaN, time: 3 },
            { offset: 1, time: Infinity },
          ],
        }),
      )
    }
  })

  test('the same input gives the same timing', () => {
    const parsed = parseNarration(texts[0]!)
    expect(JSON.stringify(estimateTiming(parsed, { leadIn: 0.2 }))).toBe(JSON.stringify(estimateTiming(parsed, { leadIn: 0.2 })))
  })
})
