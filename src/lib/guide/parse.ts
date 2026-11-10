/**
 * Narration parser. Grammar (ordinary markdown link syntax):
 *
 *   span    := "[" spoken words "]" "(" action ")"
 *   action  := [ verb ":" ] targets [ "," option ]*      verb defaults to point
 *   targets := part ( "+" part )*  |  part "->" part       parts are scene NAMES, never pixels
 *
 * The words inside the brackets are spoken; a bad span degrades to plain speech and an entry in `errors`.
 */
import { nearestName } from './names.ts'
import type {
  GuideVerb,
  NarrationError,
  NarrationSentence,
  NarrationSpan,
  NarrationWord,
  ParsedNarration,
  VerbInfo,
} from './types.ts'

/** The closed verb set: which verbs move the pointer, how many parts each takes, how long its mark lives. */
export const GUIDE_VERBS: Readonly<Record<GuideVerb, VerbInfo>> = Object.freeze({
  point: { pointer: true, arity: 'one', lifetime: 'pointer' },
  ring: { pointer: true, arity: 'many', lifetime: 'step' },
  label: { pointer: true, arity: 'one', lifetime: 'step' },
  arrow: { pointer: true, arity: 'pair', lifetime: 'step' },
  glow: { pointer: false, arity: 'many', lifetime: 'span' },
  focus: { pointer: false, arity: 'many', lifetime: 'camera' },
})

/** Verb names in documentation order. */
export const GUIDE_VERB_NAMES: readonly GuideVerb[] = Object.freeze(['point', 'ring', 'label', 'arrow', 'glow', 'focus'])

/** A part reference: an identifier, dotted for sub-parts and anchors (`engine.piston`, `piston.top`). */
const PART_REF = /^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z0-9_][A-Za-z0-9_-]*)*$/

/** A token that closes a sentence: . ! ? optionally followed by closing quotes or brackets. */
const SENTENCE_END = /[.!?]+["'”’)\]]*$/

/** true when `verb` is one of the six guide verbs. */
export function isGuideVerb(verb: string): verb is GuideVerb {
  return Object.hasOwn(GUIDE_VERBS, verb)
}

interface RawSpan {
  verb: GuideVerb
  targets: string[]
  arrow?: [string, string]
  options: string[]
  rawStart: number
  rawEnd: number
  source: string
  at: number
}

interface Action {
  verb: GuideVerb
  targets: string[]
  arrow?: [string, string]
  options: string[]
}

/** Parse narration into spoken text, words, sentences and guide spans; never throws, problems go to `errors`. */
export function parseNarration(text: string): ParsedNarration {
  const source = typeof text === 'string' ? text : text === null || text === undefined ? '' : String(text)
  const errors: NarrationError[] = []
  const rawSpans: RawSpan[] = []
  let spoken = ''
  let index = 0

  while (index < source.length) {
    const char = source[index]!
    const next = source[index + 1]

    if (char === '\\' && (next === '[' || next === ']')) {
      spoken += next
      index += 2
      continue
    }
    if (char !== '[') {
      spoken += char
      index += 1
      continue
    }

    const closeBracket = source.indexOf(']', index + 1)
    const nestedOpen = source.indexOf('[', index + 1)
    if (closeBracket < 0 || (nestedOpen >= 0 && nestedOpen < closeBracket)) {
      errors.push({
        code: 'GUIDE-SYNTAX',
        severity: 'error',
        at: index,
        what: closeBracket < 0 ? `"[" at character ${index} is never closed` : `"[" at character ${index} has another "[" inside it`,
        fix: ['write the span as [spoken words](partId)', 'write \\[ for a literal bracket'],
      })
      spoken += char
      index += 1
      continue
    }

    const words = source.slice(index + 1, closeBracket)
    if (source[closeBracket + 1] !== '(') {
      errors.push({
        code: 'GUIDE-BARE',
        severity: 'warn',
        at: index,
        what: `"[${words}]" has no (target); square brackets are reserved for guide spans`,
        fix: [`[${words}](partId)`, `remove the brackets: ${words}`],
      })
      spoken += words
      index = closeBracket + 1
      continue
    }

    const closeParen = source.indexOf(')', closeBracket + 2)
    // a "(" that meets another "[" before its ")" was never closed: it must not swallow the span that follows
    const nextOpen = source.indexOf('[', closeBracket + 2)
    if (closeParen < 0 || (nextOpen >= 0 && nextOpen < closeParen)) {
      errors.push({
        code: 'GUIDE-SYNTAX',
        severity: 'error',
        at: closeBracket + 1,
        what: `"(" after "[${words}]" is never closed`,
        fix: [`[${words}](partId)`],
      })
      spoken += words
      index = closeBracket + 1
      continue
    }

    const authored = source.slice(index, closeParen + 1)
    const action = parseAction(source.slice(closeBracket + 2, closeParen).trim(), words, authored, index, errors)
    const rawStart = spoken.length
    spoken += words
    if (action) rawSpans.push({ ...action, rawStart, rawEnd: spoken.length, source: authored, at: index })
    index = closeParen + 1
  }

  return assemble(spoken, rawSpans, errors)
}

function parseAction(action: string, words: string, authored: string, at: number, errors: NarrationError[]): Action | null {
  const bracket = `[${words}]`
  if (!action) {
    errors.push({
      code: 'GUIDE-SYNTAX',
      severity: 'error',
      at,
      what: `${authored} names no part`,
      fix: [`${bracket}(partId)`, `remove the span: ${words}`],
    })
    return null
  }

  const pieces = action.split(',').map((piece) => piece.trim())
  const head = pieces[0]!
  const options = pieces.slice(1).filter((piece) => piece.length > 0)
  const tail = options.length ? ',' + options.join(',') : ''

  const colon = head.indexOf(':')
  const verbText = colon >= 0 ? head.slice(0, colon).trim().toLowerCase() : ''
  const targetText = (colon >= 0 ? head.slice(colon + 1) : head).trim()
  const isPair = targetText.includes('->')

  let verb: GuideVerb
  if (colon < 0) {
    verb = isPair ? 'arrow' : 'point'
  } else if (isGuideVerb(verbText)) {
    verb = verbText
  } else {
    const nearest = nearestName(verbText, GUIDE_VERB_NAMES)
    errors.push({
      code: 'GUIDE-VERB',
      severity: 'error',
      at,
      what: `unknown guide verb "${verbText}" in ${authored} (verbs: ${GUIDE_VERB_NAMES.join(', ')})`,
      fix: nearest
        ? [`${bracket}(${nearest}:${targetText}${tail})`, `${bracket}(${targetText}${tail})`]
        : [`${bracket}(${targetText}${tail})`, `${bracket}(ring:${targetText}${tail})`],
    })
    return null
  }

  let targets: string[]
  let arrow: [string, string] | undefined
  if (isPair) {
    const parts = targetText.split('->').map((piece) => stripHash(piece.trim()))
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      errors.push({
        code: 'GUIDE-ARROW',
        severity: 'error',
        at,
        what: `"${targetText}" in ${authored} is not exactly from->to`,
        fix: [`${bracket}(arrow:fromPart->toPart)`],
      })
      return null
    }
    if (verb !== 'arrow') {
      errors.push({
        code: 'GUIDE-SHAPE',
        severity: 'error',
        at,
        what: `"${verb}" does not take from->to in ${authored}; only arrow does`,
        fix: [`${bracket}(arrow:${parts[0]}->${parts[1]}${tail})`, `${bracket}(${verb}:${GUIDE_VERBS[verb].arity === 'many' ? parts.join('+') : parts[1]}${tail})`],
      })
      return null
    }
    targets = parts
    arrow = [parts[0], parts[1]]
  } else {
    targets = targetText
      .split('+')
      .map((piece) => stripHash(piece.trim()))
      .filter((piece) => piece.length > 0)
    if (verb === 'arrow') {
      errors.push({
        code: 'GUIDE-ARROW',
        severity: 'error',
        at,
        what: `arrow needs two parts written from->to, got "${targetText}" in ${authored}`,
        fix:
          targets.length === 2
            ? [`${bracket}(arrow:${targets[0]}->${targets[1]}${tail})`]
            : [`${bracket}(arrow:fromPart->${targets[0] ?? 'toPart'}${tail})`, `${bracket}(${targets[0] ?? 'partId'}${tail})`],
      })
      return null
    }
    if (targets.length === 0) {
      errors.push({
        code: 'GUIDE-SYNTAX',
        severity: 'error',
        at,
        what: `${authored} names no part`,
        fix: [`${bracket}(${verb}:partId)`, `remove the span: ${words}`],
      })
      return null
    }
    if (GUIDE_VERBS[verb].arity === 'one' && targets.length !== 1) {
      errors.push({
        code: 'GUIDE-SHAPE',
        severity: 'error',
        at,
        what: `"${verb}" takes exactly one part, got ${targets.length} in ${authored}`,
        fix: [`${bracket}(ring:${targets.join('+')}${tail})`, `${bracket}(${verb === 'point' ? '' : verb + ':'}${targets[0]}${tail})`],
      })
      return null
    }
  }

  for (const part of targets) {
    if (!PART_REF.test(part)) {
      errors.push({
        code: 'GUIDE-NAME',
        severity: 'error',
        at,
        what: `"${part}" in ${authored} is not a part name; the guide takes names from the scene, never pixels or free text`,
        fix: [`${bracket}(${colon >= 0 ? verb + ':' : ''}partId)`],
        ref: part,
      })
      return null
    }
  }

  return arrow ? { verb, targets, arrow, options } : { verb, targets, options }
}

/** `#piston` is how check prints an id; accept it as `piston`. */
function stripHash(part: string): string {
  return part.startsWith('#') ? part.slice(1) : part
}

/** Collapse whitespace, then cut the spoken text into words and sentences and locate every span in it. */
function assemble(spoken: string, rawSpans: RawSpan[], errors: NarrationError[]): ParsedNarration {
  // offsetMap[i] = offset of raw character i after collapsing whitespace runs and trimming the ends
  const offsetMap = new Array<number>(spoken.length + 1)
  let plain = ''
  let previousWasSpace = true
  for (let i = 0; i < spoken.length; i++) {
    offsetMap[i] = plain.length
    const code = spoken.charCodeAt(i)
    const isSpace = code === 32 || (code >= 9 && code <= 13) || code === 0xa0
    if (isSpace) {
      if (!previousWasSpace) plain += ' '
      previousWasSpace = true
    } else {
      plain += spoken[i]
      previousWasSpace = false
    }
  }
  offsetMap[spoken.length] = plain.length
  if (plain.endsWith(' ')) plain = plain.slice(0, -1)

  const words: NarrationWord[] = []
  const sentences: NarrationSentence[] = []
  let sentenceFirstWord = 0
  let cursor = 0
  while (cursor < plain.length) {
    let end = plain.indexOf(' ', cursor)
    if (end < 0) end = plain.length
    const token = plain.slice(cursor, end)
    words.push({ text: token, start: cursor, end, sentence: sentences.length, span: -1 })
    if (SENTENCE_END.test(token)) {
      closeSentence(plain, words, sentences, sentenceFirstWord)
      sentenceFirstWord = words.length
    }
    cursor = end + 1
  }
  if (sentenceFirstWord < words.length) closeSentence(plain, words, sentences, sentenceFirstWord)

  const spans: NarrationSpan[] = []
  let searchFrom = 0
  for (const raw of rawSpans) {
    let start = Math.min(offsetMap[raw.rawStart]!, plain.length)
    let end = Math.min(offsetMap[raw.rawEnd]!, plain.length)
    while (start < end && plain[start] === ' ') start += 1
    while (end > start && plain[end - 1] === ' ') end -= 1

    // first word that ends after the span starts: the word it covers, or the next word for an empty span
    while (searchFrom < words.length && words[searchFrom]!.end <= start) searchFrom += 1
    const firstWord = searchFrom
    let wordCount = 0
    while (firstWord + wordCount < words.length && words[firstWord + wordCount]!.start < end) wordCount += 1

    const spanIndex = spans.length
    for (let k = firstWord; k < firstWord + wordCount; k++) {
      if (words[k]!.span < 0) words[k]!.span = spanIndex
    }
    const sentence = sentences.length === 0 ? -1 : firstWord < words.length ? words[firstWord]!.sentence : sentences.length - 1
    const span: NarrationSpan = {
      start,
      end,
      words: plain.slice(start, end),
      verb: raw.verb,
      targets: raw.targets,
      options: raw.options,
      firstWord,
      wordCount,
      sentence,
      source: raw.source,
      at: raw.at,
    }
    if (raw.arrow) span.arrow = raw.arrow
    spans.push(span)
  }

  return { plain, words, sentences, spans, errors }
}

function closeSentence(plain: string, words: NarrationWord[], sentences: NarrationSentence[], firstWord: number): void {
  const start = words[firstWord]!.start
  const end = words[words.length - 1]!.end
  sentences.push({ text: plain.slice(start, end), start, end, firstWord, wordCount: words.length - firstWord })
}
