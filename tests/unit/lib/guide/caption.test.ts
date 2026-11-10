import { describe, expect, test } from 'bun:test'
import { captionState, captionWordState, estimateTiming, parseNarration } from '../../../../src/lib/guide/index.ts'

describe('captionState', () => {
  const parsed = parseNarration('The [piston](piston) slides down, and the [intake valve](ring:intakeValve) opens. Then it stops.')
  const timing = estimateTiming(parsed, { leadIn: 0.4 })
  const count = parsed.words.length

  test('before speech starts nothing is spoken and the first sentence is shown', () => {
    expect(captionState(parsed, timing, 0)).toEqual({ spokenCount: 0, currentWord: -1, wordProgress: 0, speaking: false, sentence: 0, span: -1 })
    expect(captionState(parsed, timing, 0.39).currentWord).toBe(-1)
    expect(captionState(parsed, timing, -3).spokenCount).toBe(0)
  })

  test('each word becomes current exactly at its onset', () => {
    for (let i = 0; i < count; i++) {
      const state = captionState(parsed, timing, timing.wordStarts[i]!)
      expect(state.currentWord).toBe(i)
      expect(state.spokenCount).toBe(i + 1)
      expect(state.wordProgress).toBe(0)
      expect(state.speaking).toBe(true)
      expect(state.sentence).toBe(parsed.words[i]!.sentence)
      expect(state.span).toBe(parsed.words[i]!.span)
    }
  })

  test('span words report their span so the caption can colour them like their mark', () => {
    const spans = parsed.words.map((_, i) => captionState(parsed, timing, (timing.wordStarts[i]! + timing.wordEnds[i]!) / 2).span)
    expect(spans).toEqual([-1, 0, -1, -1, -1, -1, 1, 1, -1, -1, -1, -1])
    expect(parsed.spans[spans[6]!]!.verb).toBe('ring')
  })

  test('word progress runs 0..1 through the word; the word is held through the pause after it', () => {
    const comma = 3 // "down,"
    expect(parsed.words[comma]!.text).toBe('down,')
    const middle = captionState(parsed, timing, (timing.wordStarts[comma]! + timing.wordEnds[comma]!) / 2)
    expect(middle.wordProgress).toBeCloseTo(0.5, 9)
    const pause = captionState(parsed, timing, timing.wordEnds[comma]! + 0.2)
    expect(pause.currentWord).toBe(comma)
    expect(pause.wordProgress).toBe(1)
    expect(pause.speaking).toBe(false)
  })

  test('the sentence index switches when the next sentence starts, not during the pause', () => {
    const lastOfFirst = parsed.sentences[0]!.wordCount - 1
    expect(captionState(parsed, timing, timing.wordEnds[lastOfFirst]! + 0.3).sentence).toBe(0)
    expect(captionState(parsed, timing, timing.wordStarts[lastOfFirst + 1]!).sentence).toBe(1)
  })

  test('after the narration every word is spoken and none is current', () => {
    const state = captionState(parsed, timing, timing.duration)
    expect(state).toEqual({ spokenCount: count, currentWord: -1, wordProgress: 1, speaking: false, sentence: 1, span: -1 })
    expect(captionState(parsed, timing, timing.duration + 60)).toEqual(state)
  })

  test('spokenCount never decreases with time', () => {
    let previous = 0
    for (let t = -1; t < timing.duration + 1; t += 0.013) {
      const state = captionState(parsed, timing, t)
      expect(state.spokenCount).toBeGreaterThanOrEqual(previous)
      expect(state.currentWord).toBeLessThan(state.spokenCount)
      previous = state.spokenCount
    }
    expect(previous).toBe(count)
  })

  test('captionWordState splits words into spoken / current / upcoming', () => {
    const state = captionState(parsed, timing, timing.wordStarts[4]! + 0.01)
    expect(parsed.words.map((_, i) => captionWordState(state, i))).toEqual([
      'spoken', 'spoken', 'spoken', 'spoken', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming',
    ])
    const done = captionState(parsed, timing, timing.duration + 1)
    expect(parsed.words.every((_, i) => captionWordState(done, i) === 'spoken')).toBe(true)
    const before = captionState(parsed, timing, 0)
    expect(parsed.words.every((_, i) => captionWordState(before, i) === 'upcoming')).toBe(true)
  })

  test('pure: same t, same state, in any order', () => {
    const times = [0.5, 3.3, 1.2, 3.3, 0.5, 7]
    const states = times.map((t) => captionState(parsed, timing, t))
    expect(states[0]).toEqual(states[4]!)
    expect(states[1]).toEqual(states[3]!)
    expect(captionState(parsed, timing, 1.2)).toEqual(states[2]!)
  })

  test('empty narration and junk time do not throw', () => {
    const empty = parseNarration('')
    expect(captionState(empty, estimateTiming(empty), 1)).toEqual({ spokenCount: 0, currentWord: -1, wordProgress: 0, speaking: false, sentence: -1, span: -1 })
    expect(captionState(parsed, timing, NaN).spokenCount).toBe(0)
  })

  test('real word times drive the caption when given', () => {
    const onsets = parsed.words.map((_, i) => 1 + i)
    const real = estimateTiming(parsed, { wordTimes: onsets })
    expect(captionState(parsed, real, 0.99).currentWord).toBe(-1)
    expect(captionState(parsed, real, 4.5).currentWord).toBe(3)
    expect(captionState(parsed, real, 7).currentWord).toBe(6)
  })
})
