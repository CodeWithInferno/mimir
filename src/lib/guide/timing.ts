/**
 * Word timing for narration. Without audio: characters at a fixed pace plus pauses after punctuation
 * (measured: comma 365 ms, sentence end 360 ms). With real word onsets or a real audio length, the
 * estimate is only used to interpolate between the known times.
 */
import type { NarrationTiming, ParsedNarration, TimingOptions } from './types.ts'

/** Trailing punctuation of a token, optionally followed by closing quotes or brackets. */
const TRAILING_PUNCTUATION = /[.!?…,;:]+["'”’)\]]*$/

/** Seconds of silence that follow a spoken token. */
export function pauseAfter(token: string, commaPause = 0.365, sentencePause = 0.36): number {
  const match = TRAILING_PUNCTUATION.exec(token)
  if (match) return /[.!?]/.test(match[0]) ? sentencePause : commaPause
  if (token === '-' || token.includes('—') || token.includes('–')) return commaPause
  return 0
}

/** When each word starts and ends, and how long the narration lasts; real word times win when given. */
export function estimateTiming(parsed: ParsedNarration, options: TimingOptions = {}): NarrationTiming {
  const charsPerSecond = positiveOr(options.charsPerSecond, 16.5)
  const commaPause = nonNegativeOr(options.commaPause, 0.365)
  const sentencePause = nonNegativeOr(options.sentencePause, 0.36)
  const leadIn = nonNegativeOr(options.leadIn, 0)
  const realDuration = options.duration !== undefined && Number.isFinite(options.duration) && options.duration > 0 ? options.duration : undefined

  const words = parsed.words
  const count = words.length
  const wordStarts = new Array<number>(count)
  const wordEnds = new Array<number>(count)

  // pass 1: the estimate, in seconds from the start of speech
  let clock = 0
  for (let i = 0; i < count; i++) {
    const word = words[i]!
    if (i > 0) clock += (word.start - words[i - 1]!.end) / charsPerSecond
    wordStarts[i] = clock
    clock += (word.end - word.start) / charsPerSecond
    wordEnds[i] = clock
    clock += pauseAfter(word.text, commaPause, sentencePause)
  }
  const estimated = clock

  // pass 2: bend the estimate through the real onsets (a monotone piecewise-linear map)
  const anchorEstimate: number[] = []
  const anchorReal: number[] = []
  collectAnchors(parsed, options.wordTimes, wordStarts, anchorEstimate, anchorReal)
  const anchors = anchorEstimate.length
  const lastEstimate = anchors ? anchorEstimate[anchors - 1]! : 0
  const lastReal = anchors ? anchorReal[anchors - 1]! : 0
  const tailScale =
    realDuration === undefined ? 1 : anchors === 0 ? (estimated > 0 ? realDuration / estimated : 1) : realDuration > lastReal && estimated > lastEstimate ? (realDuration - lastReal) / (estimated - lastEstimate) : 1

  const warp = (seconds: number): number => {
    if (anchors === 0) return seconds * tailScale
    if (seconds <= anchorEstimate[0]!) return anchorEstimate[0]! > 0 ? (seconds / anchorEstimate[0]!) * anchorReal[0]! : anchorReal[0]!
    for (let k = 1; k < anchors; k++) {
      if (seconds <= anchorEstimate[k]!) {
        const width = anchorEstimate[k]! - anchorEstimate[k - 1]!
        return width > 0 ? anchorReal[k - 1]! + ((seconds - anchorEstimate[k - 1]!) / width) * (anchorReal[k]! - anchorReal[k - 1]!) : anchorReal[k]!
      }
    }
    return lastReal + (seconds - lastEstimate) * tailScale
  }

  if (anchors > 0 || tailScale !== 1) {
    for (let i = 0; i < count; i++) {
      wordStarts[i] = warp(wordStarts[i]!)
      wordEnds[i] = warp(wordEnds[i]!)
    }
  }
  const lastEnd = count ? wordEnds[count - 1]! : 0
  const speechDuration = Math.max(realDuration ?? warp(estimated), lastEnd)

  if (leadIn > 0) {
    for (let i = 0; i < count; i++) {
      wordStarts[i] = wordStarts[i]! + leadIn
      wordEnds[i] = wordEnds[i]! + leadIn
    }
  }

  const sentenceRanges: [number, number][] = []
  for (const sentence of parsed.sentences) {
    const first = sentence.firstWord
    const last = sentence.firstWord + sentence.wordCount - 1
    sentenceRanges.push([first < count ? wordStarts[first]! : leadIn, last >= 0 && last < count ? wordEnds[last]! : leadIn])
  }

  return {
    duration: leadIn + speechDuration,
    wordStarts,
    wordEnds,
    sentenceRanges,
    speechStart: count ? wordStarts[0]! : leadIn,
    speechEnd: count ? wordEnds[count - 1]! : leadIn,
  }
}

/** Turn `wordTimes` into (estimated onset, real onset) pairs: sorted by word, one per word, never going back in time. */
function collectAnchors(
  parsed: ParsedNarration,
  wordTimes: TimingOptions['wordTimes'],
  estimatedStarts: readonly number[],
  outEstimate: number[],
  outReal: number[],
): void {
  if (!wordTimes || wordTimes.length === 0) return
  const words = parsed.words
  const realByWord = new Array<number>(words.length).fill(NaN)
  let cursor = 0
  for (let i = 0; i < wordTimes.length; i++) {
    const entry = wordTimes[i]
    let wordIndex: number
    let time: number
    if (typeof entry === 'number') {
      wordIndex = i
      time = entry
    } else if (entry && typeof entry === 'object') {
      const offset = entry.offset
      time = entry.time
      if (!Number.isFinite(offset)) continue
      // the word containing the offset, or the next one; records usually arrive in order
      if (cursor >= words.length || (cursor > 0 && words[cursor - 1]!.end > offset)) cursor = 0
      while (cursor < words.length && words[cursor]!.end <= offset) cursor += 1
      wordIndex = cursor
    } else {
      continue
    }
    if (wordIndex < 0 || wordIndex >= words.length || !Number.isFinite(time) || time < 0) continue
    if (Number.isNaN(realByWord[wordIndex]!)) realByWord[wordIndex] = time
  }
  let previous = -Infinity
  for (let i = 0; i < words.length; i++) {
    const time = realByWord[i]!
    if (Number.isNaN(time) || time < previous) continue
    outEstimate.push(estimatedStarts[i]!)
    outReal.push(time)
    previous = time
  }
}

function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
}

function nonNegativeOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback
}
