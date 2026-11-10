/** Caption state as a pure function of step time: which words are spoken, which is current, which span it belongs to. */
import type { CaptionState, NarrationTiming, ParsedNarration } from './types.ts'

/** Which word is being spoken at step time `t`, how many have been, and which sentence and span that word is in. */
export function captionState(parsed: ParsedNarration, timing: NarrationTiming, t: number): CaptionState {
  const words = parsed.words
  const starts = timing.wordStarts
  const count = Math.min(words.length, starts.length)
  const firstSentence = parsed.sentences.length > 0 ? 0 : -1

  // number of words whose onset is <= t (upper bound by bisection; onsets never decrease)
  let low = 0
  let high = count
  while (low < high) {
    const middle = (low + high) >> 1
    if (starts[middle]! <= t) low = middle + 1
    else high = middle
  }
  const spokenCount = low
  if (spokenCount === 0) {
    return { spokenCount: 0, currentWord: -1, wordProgress: 0, speaking: false, sentence: firstSentence, span: -1 }
  }

  const index = spokenCount - 1
  const word = words[index]!
  if (t >= timing.duration) {
    return { spokenCount, currentWord: -1, wordProgress: 1, speaking: false, sentence: word.sentence, span: -1 }
  }
  const start = starts[index]!
  const end = index < timing.wordEnds.length ? timing.wordEnds[index]! : start
  const wordProgress = end > start ? Math.min(1, (t - start) / (end - start)) : 1
  return { spokenCount, currentWord: index, wordProgress, speaking: t < end, sentence: word.sentence, span: word.span }
}

/** How to draw word `wordIndex` given a caption state: already 'spoken', the 'current' one, or still 'upcoming'. */
export function captionWordState(state: CaptionState, wordIndex: number): 'spoken' | 'current' | 'upcoming' {
  if (wordIndex === state.currentWord) return 'current'
  return wordIndex < state.spokenCount ? 'spoken' : 'upcoming'
}
